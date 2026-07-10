// ══════════════════════════════════════════════════════════════
// Feature Pack: ビューポート
//   グリッド / スナップ / ズーム・パン / オニオンスキン
//   既存 redraw(), canvasCoords(), renderAnimationCanvasFrame() を
//   ラップして機能追加（コア改変なし）
// ══════════════════════════════════════════════════════════════

const mpView = {
  grid: false,
  gridSize: 32,
  snap: false,
  onion: false,
  onionFrames: 2,
  zoom: 1,
};

// ── 設定の永続化 ──
function mpViewLoad() {
  try {
    const s = JSON.parse(localStorage.getItem('mpView') || '{}');
    Object.assign(mpView, s);
  } catch (e) {}
  mpView.zoom = 1; // ズームは毎回リセット
}
function mpViewSave() {
  const { grid, gridSize, snap, onion, onionFrames } = mpView;
  localStorage.setItem('mpView', JSON.stringify({ grid, gridSize, snap, onion, onionFrames }));
}

// ══════════════════════════════════════════════════════════════
// グリッド + オニオン: redraw をラップ
// ══════════════════════════════════════════════════════════════
let _mpOrigRedraw = null;
function mpInstallRedrawHook() {
  if (typeof redraw !== 'function' || _mpOrigRedraw) return;
  _mpOrigRedraw = redraw;
  window.redraw = function () {
    _mpOrigRedraw();
    if (mpView.grid) mpDrawGrid();
    if (mpView.onion && !animating) mpDrawOnion();
  };
  // グローバル参照も更新（他モジュールが redraw を直接呼ぶ場合に備える）
  try { redraw = window.redraw; } catch (e) {}
}

function mpDrawGrid() {
  const g = mpView.gridSize;
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = g; x < cv.width; x += g) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, cv.height); }
  for (let y = g; y < cv.height; y += g) { ctx.moveTo(0, y + 0.5); ctx.lineTo(cv.width, y + 0.5); }
  ctx.stroke();
  // 中心線
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.beginPath();
  ctx.moveTo(cv.width / 2 + 0.5, 0); ctx.lineTo(cv.width / 2 + 0.5, cv.height);
  ctx.moveTo(0, cv.height / 2 + 0.5); ctx.lineTo(cv.width, cv.height / 2 + 0.5);
  ctx.stroke();
  ctx.restore();
}

// オニオンスキン: 前後フレームを薄く重ねる
function mpDrawOnion() {
  if (typeof renderAnimationCanvasFrame !== 'function') return;
  if (!shapes.some(s => s.animPath || (s.keyframes && s.keyframes.length))) return;
  const cur = animT;
  const span = 1 / Math.max(1, (totalDur || 3) * (FPS || 24)) * 4; // 数フレーム分
  const offs = [];
  for (let i = 1; i <= mpView.onionFrames; i++) { offs.push(-span * i, span * i); }

  ctx.save();
  offs.forEach(off => {
    const t = cur + off;
    if (t < 0 || t > 1) return;
    const alpha = 0.18 * (1 - Math.abs(off) / (span * (mpView.onionFrames + 1)));
    // 別キャンバスに描いて重ねる（メインを汚さない）
    const oc = document.createElement('canvas');
    oc.width = cv.width; oc.height = cv.height;
    const octx = oc.getContext('2d');
    // renderAnimationCanvasFrame はメイン ctx に描くため、一時的に退避が必要
    // ここでは簡易に: 過去/未来位置の figure だけを色付きで表示
    ctx.globalAlpha = Math.max(0.05, alpha);
    ctx.fillStyle = off < 0 ? 'rgba(255,80,80,1)' : 'rgba(80,160,255,1)';
    shapes.forEach(s => {
      if (!s.animPath || s.animPath.length < 2) return;
      const idx = Math.min(s.animPath.length - 1, Math.max(0, Math.round(t * (s.animPath.length - 1))));
      const p = s.animPath[idx];
      if (!p) return;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    });
  });
  ctx.restore();
}

// ══════════════════════════════════════════════════════════════
// スナップ: canvasCoords をラップして格子に吸着
// ══════════════════════════════════════════════════════════════
let _mpOrigCoords = null;
function mpInstallCoordsHook() {
  if (typeof canvasCoords !== 'function' || _mpOrigCoords) return;
  _mpOrigCoords = canvasCoords;
  window.canvasCoords = function (e) {
    let p = mpApplyZoomToCoords(e);
    if (mpView.snap && mpView.grid) {
      const g = mpView.gridSize;
      p = { x: Math.round(p.x / g) * g, y: Math.round(p.y / g) * g };
    }
    return p;
  };
  try { canvasCoords = window.canvasCoords; } catch (e) {}
}

// ズーム適用時は rect スケールを補正
function mpApplyZoomToCoords(e) {
  const r = cv.getBoundingClientRect();
  const scaleX = cv.width / r.width;
  const scaleY = cv.height / r.height;
  return { x: (e.clientX - r.left) * scaleX, y: (e.clientY - r.top) * scaleY };
}

// ══════════════════════════════════════════════════════════════
// ズーム / パン（CSS transform で cv-wrap 内を拡大）
// ══════════════════════════════════════════════════════════════
function mpApplyZoom() {
  const cvEl = cv;
  const three = document.getElementById('cv-three');
  const t = `scale(${mpView.zoom})`;
  cvEl.style.transformOrigin = 'top left';
  cvEl.style.transform = t;
  if (three) { three.style.transformOrigin = 'top left'; three.style.transform = t; }
  mpUpdateZoomBadge();
}
function mpSetZoom(z) {
  mpView.zoom = Math.max(0.25, Math.min(4, z));
  mpApplyZoom();
}
function mpZoomIn() { mpSetZoom(mpView.zoom * 1.2); setStatus('ズーム ' + Math.round(mpView.zoom * 100) + '%'); }
function mpZoomOut() { mpSetZoom(mpView.zoom / 1.2); setStatus('ズーム ' + Math.round(mpView.zoom * 100) + '%'); }
function mpZoomReset() { mpSetZoom(1); const wrap = document.getElementById('cv-wrap'); if (wrap && wrap.scrollTo) wrap.scrollTo(0, 0); setStatus('ズーム 100%'); }

function mpUpdateZoomBadge() {
  let badge = document.getElementById('mp-zoom-badge');
  if (!badge) {
    const wrap = document.getElementById('cv-wrap');
    if (!wrap) return;
    badge = document.createElement('div');
    badge.id = 'mp-zoom-badge';
    badge.innerHTML = `
      <button id="mp-zoom-out" title="ズームアウト"><i class="ti ti-minus"></i></button>
      <span id="mp-zoom-val">100%</span>
      <button id="mp-zoom-in" title="ズームイン"><i class="ti ti-plus"></i></button>
      <button id="mp-zoom-reset" title="リセット"><i class="ti ti-zoom-reset"></i></button>`;
    wrap.appendChild(badge);
    badge.querySelector('#mp-zoom-out').onclick = mpZoomOut;
    badge.querySelector('#mp-zoom-in').onclick = mpZoomIn;
    badge.querySelector('#mp-zoom-reset').onclick = mpZoomReset;
  }
  const v = document.getElementById('mp-zoom-val');
  if (v) v.textContent = Math.round(mpView.zoom * 100) + '%';
}

// Ctrl+ホイールでズーム / Spaceドラッグでパン
function mpInstallZoomPan() {
  const wrap = document.getElementById('cv-wrap');
  if (!wrap) return;

  wrap.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    mpSetZoom(mpView.zoom * (e.deltaY < 0 ? 1.1 : 0.9));
  }, { passive: false });

  let panning = false, sx0 = 0, sy0 = 0, sl = 0, st = 0;
  let spaceDown = false;
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) {
      spaceDown = true; wrap.style.cursor = 'grab'; e.preventDefault();
    }
  });
  document.addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceDown = false; wrap.style.cursor = ''; }
  });
  wrap.addEventListener('mousedown', e => {
    if (!spaceDown) return;
    panning = true; wrap.style.cursor = 'grabbing';
    sx0 = e.clientX; sy0 = e.clientY; sl = wrap.scrollLeft; st = wrap.scrollTop;
    e.preventDefault(); e.stopPropagation();
  }, true);
  window.addEventListener('mousemove', e => {
    if (!panning) return;
    wrap.scrollLeft = sl - (e.clientX - sx0);
    wrap.scrollTop = st - (e.clientY - sy0);
  });
  window.addEventListener('mouseup', () => {
    if (panning) { panning = false; wrap.style.cursor = spaceDown ? 'grab' : ''; }
  });
}

// ── トグル ──
function mpToggleGrid() {
  mpView.grid = !mpView.grid;
  mpViewSave();
  if (typeof redraw === 'function') redraw();
  setStatus('グリッド: ' + (mpView.grid ? 'ON' : 'OFF'));
  mpSyncViewButtons();
}
function mpToggleSnap() {
  mpView.snap = !mpView.snap;
  if (mpView.snap && !mpView.grid) { mpView.grid = true; if (typeof redraw === 'function') redraw(); }
  mpViewSave();
  setStatus('スナップ: ' + (mpView.snap ? 'ON' : 'OFF'));
  mpSyncViewButtons();
}
function mpToggleOnion() {
  mpView.onion = !mpView.onion;
  mpViewSave();
  if (typeof redraw === 'function') redraw();
  setStatus('オニオンスキン: ' + (mpView.onion ? 'ON' : 'OFF'));
  mpSyncViewButtons();
}

function mpSyncViewButtons() {
  document.getElementById('mp-grid-btn')?.classList.toggle('on', mpView.grid);
  document.getElementById('mp-snap-btn')?.classList.toggle('on', mpView.snap);
  document.getElementById('mp-onion-btn')?.classList.toggle('on', mpView.onion);
}

window.mpToggleGrid = mpToggleGrid;
window.mpToggleSnap = mpToggleSnap;
window.mpToggleOnion = mpToggleOnion;
window.mpZoomIn = mpZoomIn;
window.mpZoomOut = mpZoomOut;
window.mpZoomReset = mpZoomReset;
window.mpView = mpView;

// ── 初期化 ──
function mpViewInit() {
  mpViewLoad();
  mpInstallRedrawHook();
  mpInstallCoordsHook();
  mpInstallZoomPan();
  mpUpdateZoomBadge();
  mpSyncViewButtons();

  // ホットキー
  document.addEventListener('keydown', e => {
    const mod = e.metaKey || e.ctrlKey;
    const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
    if (inField) return;
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); mpZoomIn(); }
    else if (mod && e.key === '-') { e.preventDefault(); mpZoomOut(); }
    else if (mod && e.key === '0') { e.preventDefault(); mpZoomReset(); }
    else if (!mod && e.key.toLowerCase() === '@' && !e.shiftKey) { e.preventDefault(); mpToggleGrid(); }
  });

  if (mpView.grid && typeof redraw === 'function') redraw();
}

// core が全部読み込まれた後に初期化（app.js の後に読まれる想定だが保険）
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(mpViewInit, 200));
} else {
  setTimeout(mpViewInit, 200);
}
