// ══════════════════════════════════════════════════════════════
// KFエンジン v2: 再生ループ + フレーム描画（本体専用）
//   再生ボタン・requestAnimationFrame管理・タイムライン同期など、
//   本体だけが持つ「再生制御」をここに置く。
//   「現在時刻→KF補間→トランスフォーム適用→描画」という
//   Previewとも共有できる純粋な処理そのものは runtime.js に、
//   データ操作は keyframe.js、補間の中身は interpolation.js が担当。
// ══════════════════════════════════════════════════════════════

function drawAnimatedScene(cur, progress) {
  const drawnGroups = new Set();

  const drawWithOwner = (items, owner, center) => {
    ctx.save();
    const kfP = applyAnimationTransform(owner, center, cur, progress);
    items.forEach(item => drawAnimatedShape(item, kfP));
    ctx.restore();
  };

  shapes.forEach(s => {
    if (s.hidden) return;

    if (s.groupId) {
      if (drawnGroups.has(s.groupId)) return;
      drawnGroups.add(s.groupId);

      const members = getGroupMembers(s.groupId);
      const owner = getGroupAnimationOwner(s.groupId);
      const b = getGroupBounds(s.groupId);
      if (!members.length || !owner || !b) return;

      drawWithOwner(members, owner, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
      return;
    }

    drawWithOwner([s], s, getCenter(s));
  });
}

// getPathPos は AppCore/animation/runtime.js へ移動（本体・Preview共有）。

function renderAnimationCanvasFrame(progress) {
  const cur = progress * totalDur;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.fillStyle = canvasBg;
  ctx.fillRect(0, 0, cv.width, cv.height);

  drawAnimatedScene(cur, progress);

  shapes.forEach(s => {
    if (!s.animPath || s.animPath.length < 2) return;
    ctx.save();
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.moveTo(s.animPath[0].x, s.animPath[0].y);
    s.animPath.forEach(p => ctx.lineTo(p.x, p.y));
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.restore();
  });
}

function animStep(ts) {
  const frameInterval = 1000 / FPS;

  if (ts - lastFrameDraw < frameInterval) {
    animFrame = requestAnimationFrame(animStep);
    return;
  }

  lastFrameDraw = ts;

  if (physicsRunning) { stopAnim(); return; }
  if (!lastTs) lastTs = ts;
  const dt = (ts - lastTs) / 1000; lastTs = ts;
  animT += dt / totalDur;
  if (animT > 1) { if (looping) animT = 0; else { animT = 1; stopAnim(); return; } }

  renderAnimationCanvasFrame(animT);

  drawTimeline();
  animFrame = requestAnimationFrame(animStep);
}

function startAnim(options = {}) {

  if (physicsRunning) return;
  const restart = Boolean(options && options.restart);
  if (animating) cancelAnimationFrame(animFrame);
  if (typeof gsap !== 'undefined') {
    try {
      gsap.globalTimeline.clear();
      gsap.globalTimeline.resume();
      gsap.globalTimeline.paused(false);
    } catch (e) { }
  }
  document.getElementById('je-svg-overlay')?.remove();
  _jeSvg = null;
  lastFrameDraw = 0;
  if (restart || animT >= 1) animT = 0;
  animating = true; lastTs = null;
  setPlaybackButtonState(true);
  const dbg = getAnimationDebugSummary();
  setStatus("再生中... グループ:" + dbg.animatedGroups + "/" + dbg.groups + " 単体:" + dbg.solo);
  animFrame = requestAnimationFrame(animStep);
}

function stopAnim() {
  animating = false;
  cancelAnimationFrame(animFrame);
  setPlaybackButtonState(false);
  if (!physicsRunning) setStatus('停止');
  renderAnimationCanvasFrame(animT);
}

function toggleAnim() { animating ? stopAnim() : startAnim(); }

// mods/cannon_physics MOD が physicsRunning フラグの読み書きで本体と排他制御している。
// project.js の新規プロジェクト作成時に stopAnim() とセットで呼ばれ、物理演算中でも
// 確実に状態をリセットするための後始末用。
function stopPhysics() {
  physicsRunning = false;
  redraw();
}
