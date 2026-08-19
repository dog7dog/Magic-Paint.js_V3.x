async function openPreview(download = false) {
  if (window.__jeModeHandlers?.[jeMode]?.preview) {
    const code = document.getElementById('je-code')?.value.trim() || '';
    window.__jeModeHandlers[jeMode].preview(code, download);
    return;
  }

  // KFエンジン v2 の補間ロジック(interpolation.js)と、パス/アニメーション判定の
  // 純粋処理(runtime.js)は、実ファイルのまま取得して書き出しHTMLに埋め込む。
  // 手動コピーによる同期漏れを防ぐため、ロジックは常にこの1箇所だけに置く。
  // （playback.js/keyframe.jsは本体専用の再生制御・UI処理を含むため対象外）
  let interpSrc, runtimeSrc;
  try {
    const fetchSrc = path => fetch(path).then(r => {
      if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
      return r.text();
    });
    [interpSrc, runtimeSrc] = await Promise.all([
      fetchSrc('AppCore/animation/interpolation.js'),
      fetchSrc('AppCore/animation/runtime.js')
    ]);
  } catch (e) {
    toast('ti-alert-triangle', 'プレビュー生成に失敗しました（共有ロジックの取得エラー: ' + e.message + '）');
    return;
  }

  // SVG/GSAP変換で座標が飛ぶ問題を避けるため、
  // プレビューは編集画面と同じCanvas座標で再生する。
  const previewShapes = JSON.parse(JSON.stringify(shapes.map(s => {
    const { snap, _orig, ...rest } = s;
    return rest;
  })));

  const previewRenderers = {};

  for (const [type, renderer] of Object.entries(window.AnimationApp?.customRenderers || {})) {
    if (renderer.previewDrawCode) {
      previewRenderers[type] = renderer.previewDrawCode;
    }
  }
  const previewBrushes = {};

  for (const [id, brush] of Object.entries(window.AnimationApp?.customBrushes || {})) {
    if (brush.previewDrawCode) {
      previewBrushes[id] = brush.previewDrawCode;
    }
  }

  const payload = {
    width: cv.width,
    height: cv.height,
    bg: canvasBg || '#111111',
    totalDur,
    looping,
    fps: (typeof FPS !== 'undefined' ? FPS : 24),
    shapes: previewShapes,
    renderers: previewRenderers,
    brushes: previewBrushes
  };


  const html = `<!DOCTYPE html>
  <html lang="ja">
  <head>
  <meta charset="UTF-8">
  <title>Motion Logic Canvas — Canvas Preview</title>
  <style>
  * { box-sizing:border-box; }
  body {
    margin:0;
    background:#111;
    min-height:100vh;
    display:flex;
    align-items:center;
    justify-content:center;
    overflow:auto;
    font-family:system-ui,sans-serif;
  }
  #wrap {
    display:flex;
    flex-direction:column;
    gap:10px;
    align-items:center;
  }
  canvas {
    background:${canvasBg || '#111111'};
    max-width:96vw;
    max-height:88vh;
    border-radius:8px;
    box-shadow:0 12px 40px rgba(0,0,0,.45);
  }
  #bar {
    display:flex;
    align-items:center;
    gap:8px;
    color:#ddd;
    font-size:12px;
  }
  button {
    background:#222;
    color:#eee;
    border:1px solid #444;
    border-radius:6px;
    padding:6px 10px;
    cursor:pointer;
  }
  button:hover { border-color:#3B8AE6; }
  </style>
  </head>
  <body>
  <div id="wrap">
    <canvas id="pv" width="${cv.width}" height="${cv.height}"></canvas>
    <div id="bar">
      <button id="play">停止</button>
      <button id="restart">最初から</button>
      <span id="time">0.00s</span>
    </div>
  </div>
  <script>
  const data = ${JSON.stringify(payload)};
  // runtime.js（本体と共有）が参照する totalDur を、Preview側の値で用意する。
  const totalDur = data.totalDur;
  const canvas = document.getElementById('pv');
  const ctx = canvas.getContext('2d');
  const previewRenderers = {};
    console.log('renderers data', data.renderers);
    for (const [type, code] of Object.entries(data.renderers || {})) {
      previewRenderers[type] = new Function("ctx", "s", code);
    }
    console.log('previewRenderers', previewRenderers);
  const previewBrushes = {};
  for (const [id, code] of Object.entries(data.brushes || {})) {
    previewBrushes[id] = new Function("ctx", "pts", "s", code);
  }
  let playing = true;
  let lastPreviewDraw = 0;
  let start = performance.now();
  let pauseAt = 0;

  function polyPts(cx, cy, r, n, a0) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = a0 + i * 2 * Math.PI / n;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function getCenter(s) {
    switch (s.type) {
      case 'rect':
      case 'text': return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
      case 'webgl-image': return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
      case 'circle': return { x: s.cx, y: s.cy };
      case 'triangle':
      case 'polygon': return { x: s.cx, y: s.cy };
      case 'line': return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
      case 'pen':
      case 'brush':
      case 'mod-brush': {
        const b = getBounds(s);
        return {
          x: b.x + b.w / 2,
          y: b.y + b.h / 2
        };
      }
      default:
        // MOD図形（star等）は cx/cy を中心として持つ規約に合わせる
        if (Number.isFinite(s.cx) && Number.isFinite(s.cy)) return { x: s.cx, y: s.cy };
        return { x: s.x || 0, y: s.y || 0 };
    }
  }

  function getBounds(s) {
    switch (s.type) {
      case 'rect':
      case 'text': return { x: s.x, y: s.y, w: s.w, h: s.h };
      case 'webgl-image': return { x: s.x, y: s.y, w: s.w, h: s.h };
      case 'circle': return { x: s.cx - s.rx, y: s.cy - s.ry, w: s.rx * 2, h: s.ry * 2 };
      case 'triangle':
      case 'polygon': {
        const n = s.type === 'triangle' ? 3 : (s.sides || 6);
        const sx = s.scaleX || 1, sy = s.scaleY || 1;
        const a0 = s.type === 'triangle' ? ((s.rot || 0) - 90) * Math.PI / 180 : (s.rot || 0) * Math.PI / 180;
        const xs = [], ys = [];
        for (let i = 0; i < n; i++) {
          const a = a0 + i * 2 * Math.PI / n;
          xs.push(s.cx + s.r * Math.cos(a) * sx);
          ys.push(s.cy + s.r * Math.sin(a) * sy);
        }
        const x = Math.min(...xs), y = Math.min(...ys);
        return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
      }
      case 'line': {
        const x = Math.min(s.x1, s.x2) - 4, y = Math.min(s.y1, s.y2) - 4;
        return { x, y, w: Math.abs(s.x2 - s.x1) + 8, h: Math.abs(s.y2 - s.y1) + 8 };
      }
      case 'pen':
      case 'brush': {
        if (!s.pts || !s.pts.length) return { x:0,y:0,w:0,h:0 };
        const xs = s.pts.map(p => p.x), ys = s.pts.map(p => p.y);
        const pad = (s.sw || 2) / 2;
        const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
        return { x, y, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
      }
      default: {
        // MOD図形（star等）は cx/cy を中心、r を半径として持つ規約に合わせる
        if (Number.isFinite(s.cx) && Number.isFinite(s.cy)) {
          const r = Number.isFinite(s.r) ? s.r : 40;
          const sx = s.scaleX || 1, sy = s.scaleY || 1;
          return { x: s.cx - r * sx, y: s.cy - r * sy, w: r * 2 * sx, h: r * 2 * sy };
        }
        return { x:0,y:0,w:0,h:0 };
      }
    }
  }

  // getGroupMembers / getGroupAnimationOwner は runtime.js の埋め込みで
  // 提供される（本体と共有）。ここでは data.shapes を明示的に渡して呼ぶ。

  function getGroupBounds(groupId) {
    const members = getGroupMembers(groupId, false, data.shapes);
    if (!members.length) return null;

    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    members.forEach(s => {
      const b = getBounds(s);
      x1 = Math.min(x1, b.x);
      y1 = Math.min(y1, b.y);
      x2 = Math.max(x2, b.x + b.w);
      y2 = Math.max(y2, b.y + b.h);
    });

    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }

  // ══ KFエンジン v2: 共有ランタイム ══════════════════════════════
  // AppCore/animation/interpolation.js（EASINGS/applyEasing/sampleKeyframes等）と
  // AppCore/animation/runtime.js（shapeHasAnimation/getGroupMembers/
  // getGroupAnimationOwner/pathProgressKeyframes/getPathTimeRange/
  // getPathProgressForTime/getPathPos/applyAnimationTransform/
  // drawAnimatedShape）の実ソースをそのまま埋め込む。手動複製ではないため、
  // 本体を変更すればここも自動的に追従する。
  // runtime.js は totalDur というローカル変数がスコープ内にあることを前提にする。
  // getGroupMembers/getGroupAnimationOwner の shapesRef 引数は、呼び出し側
  // (drawPreviewAnimatedScene/getGroupBounds)で必ず data.shapes を明示的に渡す
  // （本体のような bare な shapes 変数がPreview側には無いため）。
  ${interpSrc}

  ${runtimeSrc}

  // ── テキスト（Google Fonts）─────────────────────────────────────
  // AppCore/canvas/shapes.js の ensureGoogleFont/wrapTextLines と同じロジック。
  // プレビューは独立したHTMLとして書き出す/新規タブで開くため、
  // <script src>で共有できず、ここに複製している。
  // ensureGoogleFont は本体では読み込み完了時に redraw() を呼ぶが、
  // プレビューは常時 requestAnimationFrame(render) で描画し続けているため、
  // 明示的な再描画呼び出しは不要（フォールバックフォント→本フォントは自然に切り替わる）。
  const PREVIEW_GOOGLE_FONTS = [
    'Noto Sans JP', 'Noto Serif JP', 'M PLUS Rounded 1c', 'Kosugi Maru', 'Shippori Mincho',
    'Roboto', 'Poppins', 'Playfair Display', 'Pacifico', 'Bebas Neue'
  ];
  const _previewLoadedGoogleFonts = new Set();
  function previewEnsureGoogleFont(family) {
    if (!family || !PREVIEW_GOOGLE_FONTS.includes(family) || _previewLoadedGoogleFonts.has(family)) return;
    _previewLoadedGoogleFonts.add(family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' +
      encodeURIComponent(family).replace(/%20/g, '+') + ':wght@400;700&display=swap';
    document.head.appendChild(link);
  }

  function wrapTextLines(text, fontFamily, fontSize, maxWidth) {
    const w = Math.max(10, maxWidth);
    ctx.save();
    ctx.font = fontSize + 'px ' + (fontFamily || 'sans-serif');

    const breakToken = tok => {
      const out = [];
      let cur = tok;
      while (ctx.measureText(cur).width > w && cur.length > 1) {
        let lo = 1;
        while (lo < cur.length && ctx.measureText(cur.slice(0, lo + 1)).width <= w) lo++;
        out.push(cur.slice(0, lo));
        cur = cur.slice(lo);
      }
      if (cur) out.push(cur);
      return out;
    };

    const lines = [];
    (text || '').split('\\n').forEach(paragraph => {
      if (paragraph === '') { lines.push(''); return; }
      const tokens = paragraph.split(/(\\s+)/).filter(t => t.length);
      let cur = '';
      tokens.forEach(tok => {
        const test = cur + tok;
        if (cur && ctx.measureText(test).width > w) {
          lines.push(cur);
          cur = '';
          if (ctx.measureText(tok).width > w) {
            const pieces = breakToken(tok);
            cur = pieces.pop() || '';
            lines.push(...pieces);
          } else {
            cur = tok.replace(/^\\s+/, '');
          }
        } else {
          cur = test;
        }
      });
      if (cur) lines.push(cur);
    });

    ctx.restore();
    return lines.length ? lines : [''];
  }

  function drawShape(s) {
    if (s.hidden) return;
    ctx.save();
    ctx.globalAlpha = (s.opa ?? 100) / 100;
    ctx.strokeStyle = s.color || '#fff';
    ctx.fillStyle = s.color || '#fff';
    ctx.lineWidth = s.sw || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(s.dash && s.dash !== '0' ? String(s.dash).split(',').map(Number) : []);

    switch (s.type) {
      case 'webgl-image': {
        window.__magicPaintPreviewImageCache ||= {};
        let img = window.__magicPaintPreviewImageCache[s.src];
        if (!img) {
          img = new Image();
          img.src = s.src;
          window.__magicPaintPreviewImageCache[s.src] = img;
        }
        ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
        ctx.rotate((s.rot || 0) * Math.PI / 180);
        if (img.complete && img.naturalWidth) {
          ctx.drawImage(img, -s.w / 2, -s.h / 2, s.w, s.h);
        } else {
          ctx.fillStyle = 'rgba(255,255,255,.08)';
          ctx.fillRect(-s.w / 2, -s.h / 2, s.w, s.h);
          ctx.strokeStyle = 'rgba(255,255,255,.35)';
          ctx.strokeRect(-s.w / 2, -s.h / 2, s.w, s.h);
        }
        break;
      }
      case 'rect':
        ctx.translate(s.x + s.w/2, s.y + s.h/2);
        ctx.rotate((s.rot || 0) * Math.PI / 180);
        ctx.beginPath();
        ctx.roundRect(-s.w/2, -s.h/2, s.w, s.h, s.rr || 0);
        if (s.fill) ctx.fill();
        ctx.stroke();
        break;
      case 'circle':
        ctx.beginPath();
        ctx.ellipse(s.cx, s.cy, s.rx, s.ry, (s.rot || 0) * Math.PI / 180, 0, Math.PI * 2);
        if (s.fill) ctx.fill();
        ctx.stroke();
        break;
      case 'triangle': {
        const scX = s.scaleX || 1, scY = s.scaleY || 1;
        ctx.translate(s.cx, s.cy);
        ctx.scale(scX, scY);
        ctx.rotate(((s.rot || 0) - 90) * Math.PI / 180);
        const p = polyPts(0, 0, s.r, 3, 0);
        ctx.beginPath();
        ctx.moveTo(p[0].x, p[0].y);
        p.forEach(q => ctx.lineTo(q.x, q.y));
        ctx.closePath();
        if (s.fill) ctx.fill();
        ctx.stroke();
        break;
      }
      case 'polygon': {
        const scX = s.scaleX || 1, scY = s.scaleY || 1;
        ctx.translate(s.cx, s.cy);
        ctx.scale(scX, scY);
        ctx.rotate((s.rot || 0) * Math.PI / 180);
        const p = polyPts(0, 0, s.r, s.sides || 6, 0);
        ctx.beginPath();
        ctx.moveTo(p[0].x, p[0].y);
        p.forEach(q => ctx.lineTo(q.x, q.y));
        ctx.closePath();
        if (s.fill) ctx.fill();
        ctx.stroke();
        break;
      }
      case 'line':
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
        break;
      case 'pen':
      case 'brush':
        if (!s.pts || s.pts.length < 2) break;
        ctx.beginPath();
        ctx.moveTo(s.pts[0].x, s.pts[0].y);
        s.pts.forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();
        break;
      case 'mod-brush': {
        const brush = previewBrushes[s.brushId];

        if (brush && s.pts && s.pts.length > 1) {
          brush(ctx, s.pts, s);
        }

        break;
      }
      case 'text': {
        const fam = s.fontFamily || 'sans-serif';
        const fs = s.fontSize || 24;
        const lh = Math.round(fs * 1.3);
        const pad = 4;
        previewEnsureGoogleFont(fam);
        ctx.translate(s.x + s.w / 2, s.y + s.h / 2);
        ctx.rotate((s.rot || 0) * Math.PI / 180);
        ctx.translate(-s.w / 2, -s.h / 2);
        ctx.font = fs + 'px ' + fam;
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillStyle = s.color || '#fff';
        const lines = wrapTextLines(s.text || '', fam, fs, s.w - pad * 2);
        lines.forEach((line, i) => ctx.fillText(line, pad, pad + i * lh));
        break;
      }

    default: {
      const renderer = previewRenderers[s.type];

      if (renderer) {
        renderer(ctx, s);
      }
      break;
    }
  }

  ctx.restore();

  }

  // 角丸矩形は本体(renderer.js)と同じく native の ctx.roundRect() を使う
  // （手書きの quadraticCurveTo実装は撤去）。

  // applyAnimationTransform / drawAnimatedShape は runtime.js の埋め込みで
  // 提供される（本体と共有）。ここでは data.shapes を辿るPreview固有の
  // 走査(drawPreviewAnimatedScene)だけを持つ。

  function drawPreviewAnimatedScene(localTime, progress) {
    const drawnGroups = new Set();

    // 本体の drawAnimatedScene と同様、data.shapes を直接読む。
    // applyAnimationTransform/drawAnimatedShape/getGroupMembers等は
    // 図形オブジェクトを一切変更しない(読み取り専用)ため、
    // 毎フレームのクローンは不要。
    for (const s of data.shapes) {
      if (s.hidden) continue;

      if (s.groupId) {
        if (drawnGroups.has(s.groupId)) continue;
        drawnGroups.add(s.groupId);

        const members = getGroupMembers(s.groupId, false, data.shapes);
        const owner = getGroupAnimationOwner(s.groupId, true, data.shapes);
        const b = getGroupBounds(s.groupId);
        if (!members.length || !owner || !b) continue;

        const center = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
        ctx.save();
        const kfP = applyAnimationTransform(owner, center, localTime, progress);
        members.forEach(member => drawAnimatedShape(member, kfP));
        ctx.restore();
        continue;
      }

      const center = getCenter(s);
      ctx.save();
      const kfP = applyAnimationTransform(s, center, localTime, progress);
      drawAnimatedShape(s, kfP);
      ctx.restore();
    }
  }

  function render(now) {
  const frameInterval = 1000 / (data.fps || 24);
    if (now - lastPreviewDraw < frameInterval) {
      requestAnimationFrame(render);
      return;
    }

lastPreviewDraw = now;
    const elapsed = playing ? (now - start) / 1000 : pauseAt;
    const localTime = data.looping ? (elapsed % data.totalDur) : Math.min(elapsed, data.totalDur);
    const t = data.totalDur > 0 ? localTime / data.totalDur : 0;

    ctx.clearRect(0, 0, data.width, data.height);
    ctx.fillStyle = data.bg;
    ctx.fillRect(0, 0, data.width, data.height);

    drawPreviewAnimatedScene(localTime, t);

    document.getElementById('time').textContent = localTime.toFixed(2) + 's';
    requestAnimationFrame(render);
  }
  document.getElementById('play').onclick = () => {
  playing = !playing;

  if (playing) {
    start = performance.now() - pauseAt * 1000;
    document.getElementById('play').textContent = '停止';
  } else {
    pauseAt = (performance.now() - start) / 1000;
    document.getElementById('play').textContent = '再生';
    }
  };

  document.getElementById('restart').onclick = () => {
    start = performance.now();
    pauseAt = 0;
    playing = true;
    document.getElementById('play').textContent = '停止';
  };

  requestAnimationFrame(render);
  </script>
  </body>
  </html>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  if (download) {
    const a = document.createElement('a');
    a.href = url;
    a.download = 'animation.html';
    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('ti-file-export', 'HTMLを書き出しました');
    return;
  }
  const win = window.open(url, 'mlc-preview',
    `width=${Math.min(cv.width + 60, 1400)},height=${Math.min(cv.height + 110, 900)}`);
  if (!win) toast('ti-alert-triangle', 'ポップアップをブロックされました');
  else setTimeout(() => URL.revokeObjectURL(url), 5000);
}
