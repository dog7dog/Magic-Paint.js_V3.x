// ══════════════════════════════════════════════════════════════
// Feature Pack: 動画 / 連番PNG / GIF 書き出し
//   - WebM: MediaRecorder で canvas.captureStream を録画
//   - 連番PNG: 各フレームを ZIP なしで個別DL or 1枚結合シート
//   - APNG風: フレームを縦に並べたスプライトシート
//
//   既存の renderAnimationCanvasFrame(animT 0..1) を使ってフレーム生成
// ══════════════════════════════════════════════════════════════

function mpExportSupported() {
  return typeof cv !== 'undefined' && typeof renderAnimationCanvasFrame === 'function';
}

// ── フレームを1枚ずつ描画してコールバック ──
async function mpEachFrame(fps, onFrame) {
  const wasAnimating = typeof animating !== 'undefined' && animating;
  if (wasAnimating && typeof stopAnim === 'function') stopAnim();
  const savedT = animT;

  const dur = Math.max(0.1, totalDur || 3);
  const total = Math.max(1, Math.round(dur * fps));
  for (let i = 0; i < total; i++) {
    const t = total <= 1 ? 0 : i / (total - 1);
    animT = t;
    renderAnimationCanvasFrame(t);
    await onFrame(i, total);
  }
  // 復帰
  animT = savedT;
  renderAnimationCanvasFrame(savedT);
  if (typeof drawTimeline === 'function') drawTimeline();
}

// ── WebM 録画 ──
async function mpExportWebM(opts) {
  opts = opts || {};
  if (!mpExportSupported()) { toast('ti-alert-triangle', '書き出しできません'); return; }
  if (typeof MediaRecorder === 'undefined' || !cv.captureStream) {
    toast('ti-alert-triangle', 'このブラウザは動画録画に非対応です');
    return;
  }
  const fps = opts.fps || FPS || 24;
  const dur = Math.max(0.1, totalDur || 3);

  // 対応MIME検出
  const mimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  let mime = '';
  for (const m of mimes) { if (MediaRecorder.isTypeSupported(m)) { mime = m; break; } }
  if (!mime) { toast('ti-alert-triangle', 'WebM非対応ブラウザです'); return; }

  const stream = cv.captureStream(fps);
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: opts.bitrate || 8_000_000 });
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };

  mpProgressOpen('WebM書き出し中...');
  const done = new Promise(res => { rec.onstop = res; });

  const wasAnimating = animating;
  if (wasAnimating) stopAnim();
  const savedT = animT;

  rec.start();
  const startTime = performance.now();
  // リアルタイムでアニメを1周再生しながら録画
  await new Promise(resolve => {
    function step(now) {
      const elapsed = (now - startTime) / 1000;
      const t = Math.min(1, elapsed / dur);
      animT = t;
      renderAnimationCanvasFrame(t);
      mpProgressSet(t);
      if (elapsed >= dur) { resolve(); return; }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
  rec.stop();
  await done;
  mpProgressClose();

  animT = savedT; renderAnimationCanvasFrame(savedT);
  if (typeof drawTimeline === 'function') drawTimeline();

  const blob = new Blob(chunks, { type: mime });
  mpDownloadBlob(blob, mpProjectName() + '.webm');
  toast('ti-video', 'WebMを書き出しました');
}

// ── スプライトシート（全フレームを格子状に1枚のPNG） ──
async function mpExportSpriteSheet(opts) {
  opts = opts || {};
  if (!mpExportSupported()) { toast('ti-alert-triangle', '書き出しできません'); return; }
  const fps = opts.fps || Math.min(12, FPS || 12);
  const cols = opts.cols || 5;

  const frames = [];
  mpProgressOpen('フレーム生成中...');
  await mpEachFrame(fps, async (i, total) => {
    const off = document.createElement('canvas');
    off.width = cv.width; off.height = cv.height;
    const octx = off.getContext('2d');
    octx.fillStyle = canvasBg || '#111';
    octx.fillRect(0, 0, off.width, off.height);
    octx.drawImage(cv, 0, 0);
    frames.push(off);
    mpProgressSet(i / total);
    if (i % 3 === 0) await mpTick();
  });
  mpProgressClose();

  const rows = Math.ceil(frames.length / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cv.width * cols;
  sheet.height = cv.height * rows;
  const sctx = sheet.getContext('2d');
  frames.forEach((f, i) => {
    const cx = (i % cols) * cv.width;
    const cy = Math.floor(i / cols) * cv.height;
    sctx.drawImage(f, cx, cy);
  });
  sheet.toBlob(b => {
    mpDownloadBlob(b, mpProjectName() + '_sprite_' + frames.length + 'f.png');
    toast('ti-grid-dots', `スプライトシート (${frames.length}フレーム) を書き出しました`);
  }, 'image/png');
}

// ── 連番PNG（各フレームを個別にダウンロード） ──
async function mpExportFrameSequence(opts) {
  opts = opts || {};
  if (!mpExportSupported()) { toast('ti-alert-triangle', '書き出しできません'); return; }
  const fps = opts.fps || Math.min(12, FPS || 12);
  const name = mpProjectName();

  mpProgressOpen('連番PNG書き出し中...');
  const blobs = [];
  await mpEachFrame(fps, async (i, total) => {
    const blob = await new Promise(res => cv.toBlob(res, 'image/png'));
    blobs.push({ i, blob });
    mpProgressSet(i / total);
    await mpTick();
  });
  mpProgressClose();

  // 連続DLはブラウザが弾くことがあるので間隔をあける
  for (const { i, blob } of blobs) {
    mpDownloadBlob(blob, `${name}_${String(i).padStart(4, '0')}.png`);
    await new Promise(r => setTimeout(r, 180));
  }
  toast('ti-photo', `${blobs.length}枚の連番PNGを書き出しました`);
}

// ── 共通ヘルパー ──
function mpProjectName() {
  const el = document.getElementById('proj-name');
  let n = el ? el.textContent.replace(/\.mlc$/, '') : 'magicpaint';
  return (n || 'magicpaint').trim().replace(/[\/\\:*?"<>|]/g, '_');
}
function mpDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function mpTick() { return new Promise(r => requestAnimationFrame(() => r())); }

// ── 進捗オーバーレイ ──
function mpProgressOpen(label) {
  mpProgressClose();
  const el = document.createElement('div');
  el.id = 'mp-progress';
  el.innerHTML = `
    <div class="mp-progress-box">
      <div class="mp-progress-label">${label}</div>
      <div class="mp-progress-bar"><div class="mp-progress-fill"></div></div>
      <div class="mp-progress-pct">0%</div>
    </div>`;
  document.body.appendChild(el);
}
function mpProgressSet(ratio) {
  const fill = document.querySelector('#mp-progress .mp-progress-fill');
  const pct = document.querySelector('#mp-progress .mp-progress-pct');
  if (fill) fill.style.width = Math.round(ratio * 100) + '%';
  if (pct) pct.textContent = Math.round(ratio * 100) + '%';
}
function mpProgressClose() {
  const el = document.getElementById('mp-progress');
  if (el) el.remove();
}

// ── 書き出しダイアログ ──
function mpOpenExportDialog() {
  if (document.getElementById('mp-export-dialog')) return;
  const el = document.createElement('div');
  el.id = 'mp-export-dialog';
  el.className = 'mp-overlay';
  el.innerHTML = `
    <div class="mp-dialog">
      <div class="mp-dialog-head">
        <span><i class="ti ti-movie"></i> メディア書き出し</span>
        <button class="mp-x"><i class="ti ti-x"></i></button>
      </div>
      <div class="mp-dialog-body">
        <label class="mp-field">
          <span>FPS</span>
          <select id="mp-exp-fps">
            <option>12</option><option>24</option><option selected>30</option><option>60</option>
          </select>
        </label>
        <div class="mp-export-grid">
          <button class="mp-export-card" data-type="webm">
            <i class="ti ti-video"></i><b>WebM動画</b><small>アニメを動画で保存</small>
          </button>
          <button class="mp-export-card" data-type="sprite">
            <i class="ti ti-grid-dots"></i><b>スプライトシート</b><small>全フレームを1枚に</small>
          </button>
          <button class="mp-export-card" data-type="sequence">
            <i class="ti ti-photo"></i><b>連番PNG</b><small>各フレームを個別に</small>
          </button>
          <button class="mp-export-card" data-type="png">
            <i class="ti ti-camera"></i><b>現在フレームPNG</b><small>今の画面を1枚</small>
          </button>
        </div>
        <div class="mp-dialog-note">動画はアニメーションを1周再生して録画します。再生時間はタイムラインの長さ（${(totalDur||3).toFixed(1)}秒）です。</div>
      </div>
    </div>`;
  document.body.appendChild(el);

  const close = () => el.remove();
  el.querySelector('.mp-x').onclick = close;
  el.addEventListener('click', e => { if (e.target === el) close(); });

  el.querySelectorAll('.mp-export-card').forEach(card => {
    card.onclick = async () => {
      const fps = parseInt(document.getElementById('mp-exp-fps').value, 10);
      const type = card.dataset.type;
      close();
      if (type === 'webm') await mpExportWebM({ fps });
      else if (type === 'sprite') await mpExportSpriteSheet({ fps });
      else if (type === 'sequence') await mpExportFrameSequence({ fps });
      else if (type === 'png') { if (typeof exportPNG === 'function') exportPNG(); }
    };
  });
}

window.mpOpenExportDialog = mpOpenExportDialog;
window.mpExportWebM = mpExportWebM;
window.mpExportSpriteSheet = mpExportSpriteSheet;
