// ══════════════════════════════════════════════════════════════
// KFエンジン v2: 再生ループ + フレーム描画
//   「現在時刻→KF補間→トランスフォーム適用→描画」の一本化された
//   パイプラインをここに集約する。データ操作は keyframe.js、
//   補間の中身は interpolation.js が担当。
// ══════════════════════════════════════════════════════════════

function applyAnimationTransform(owner, center, cur, progress) {
  const kfP = sampleKeyframes(owner.keyframes, cur);
  const pathProgress = getPathProgressForTime(owner, cur, progress);
  const pos = getPathPos(pathProgress ?? progress, owner.animPath || null);
  const pathDx = pos && owner.animPath && owner.animPath[0] ? pos.x - owner.animPath[0].x : 0;
  const pathDy = pos && owner.animPath && owner.animPath[0] ? pos.y - owner.animPath[0].y : 0;
  const useKfPosition = !(owner.animPath && owner.animPath.length > 1);
  const kfDx = useKfPosition && kfP && Number.isFinite(kfP.x) ? kfP.x - center.x : 0;
  const kfDy = useKfPosition && kfP && Number.isFinite(kfP.y) ? kfP.y - center.y : 0;
  const dx = pathDx + kfDx;
  const dy = pathDy + kfDy;

  if (dx || dy) {
    ctx.translate(dx, dy);
  }

  const kfRot = kfP && Number.isFinite(Number(kfP.rotation)) ? Number(kfP.rotation) : null;
  const kfScaleX = kfP && Number.isFinite(Number(kfP.scaleX)) ? Number(kfP.scaleX) : null;
  const kfScaleY = kfP && Number.isFinite(Number(kfP.scaleY)) ? Number(kfP.scaleY) : null;

  if (kfRot !== null || kfScaleX !== null || kfScaleY !== null) {
    ctx.translate(center.x, center.y);
    if (kfRot !== null) {
      ctx.rotate(((kfRot - (owner.rot || 0)) * Math.PI) / 180);
    }
    if (kfScaleX !== null || kfScaleY !== null) {
      // 図形自身が持つ静的な scaleX/scaleY(三角形/多角形など)と二重に
      // 掛からないよう、KF値との「比」だけを追加で適用する
      const baseSx = owner.scaleX || 1, baseSy = owner.scaleY || 1;
      ctx.scale((kfScaleX ?? baseSx) / baseSx, (kfScaleY ?? baseSy) / baseSy);
    }
    ctx.translate(-center.x, -center.y);
  }

  if (owner.autoRotate) {
    ctx.translate(center.x, center.y);
    ctx.rotate(owner.autoRotate * cur * Math.PI / 180);
    ctx.translate(-center.x, -center.y);
  }

  return kfP;
}

function drawAnimatedShape(s, kfP = null) {
  if (!kfP) {
    drawShape(s, ctx);
    return;
  }

  const kfOpa = Number(kfP.opacity);
  drawShape({
    ...s,
    opa: Number.isFinite(kfOpa) ? kfOpa : s.opa,
    color: kfP.color || s.color
  }, ctx);
}

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

function getPathPos(t, path) {
  if (!path || path.length < 2) return null;

  // 座標系は変えない。保存された animPath をそのまま使う。
  // 点の番号ではなく線の長さで補間するだけにする。
  const segs = [];
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.001) continue;
    segs.push({ a, b, len });
    total += len;
  }
  if (!segs.length) return path[0];

  let d = Math.max(0, Math.min(1, t)) * total;
  for (const seg of segs) {
    if (d <= seg.len) {
      const f = d / seg.len;
      return {
        x: seg.a.x + (seg.b.x - seg.a.x) * f,
        y: seg.a.y + (seg.b.y - seg.a.y) * f
      };
    }
    d -= seg.len;
  }
  return path[path.length - 1];
}

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

// ── 物理演算（削除済み）──────────────────────────────────
function togglePhysics() {
  setStatus('物理演算は削除済みです');
}
function startPhysics() {
  setStatus('物理演算は削除済みです');
}
function stopPhysics() {
  physicsRunning = false;
  redraw();
}
function applyFrame(objects) {
  // 物理演算なし
}
