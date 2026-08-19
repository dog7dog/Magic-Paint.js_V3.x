// ══════════════════════════════════════════════════════════════
// KFエンジン v2: 共有ランタイム
//   本体(index.html)からもPreview書き出しHTML(export/preview.js)からも
//   「完全に同じソース」として使う純粋処理だけを置く。
//   ここに置く関数は、以下のグローバルが呼び出し側スコープに
//   存在することだけを前提にする（本体では state.js 等の実体、
//   Previewでは openPreview() が同名で用意するローカル変数/関数）。
//     - ctx        : 描画先の CanvasRenderingContext2D
//     - totalDur   : タイムライン全体の長さ(秒)
//     - sampleKeyframes / applyEasing / EASINGS : interpolation.js
//     - drawShape  : 図形1つを ctx に描画する関数
//   図形配列だけは呼び出し側で「本体ならshapes、Previewならdata.shapes」と
//   異なるため、getGroupMembers/getGroupAnimationOwner は shapesRef引数で
//   受け取る（本体側は省略時デフォルトのグローバル shapes を使う）。
//
//   再生ボタン・requestAnimationFrame管理・タイムライン同期などの
//   「本体専用の再生制御」は playback.js 側に残し、ここには入れない
//   （Previewは自前の再生ループを持つため、混ぜると依存が絡む）。
// ══════════════════════════════════════════════════════════════

function shapeHasAnimation(s) {
  if (!s) return false;
  return Boolean(
    (s.animPath && s.animPath.length > 1) ||
    (s.keyframes && s.keyframes.length) ||
    s.autoRotate
  );
}

function getGroupMembers(groupId, includeHidden = false, shapesRef = shapes) {
  if (!groupId) return [];
  return shapesRef.filter(s => s.groupId === groupId && (includeHidden || !s.hidden));
}

function getGroupAnimationOwner(groupId, fallbackToFirst = true, shapesRef = shapes) {
  const members = getGroupMembers(groupId, true, shapesRef);
  return (
    members.find(s => s.groupAnimOwner && shapeHasAnimation(s)) ||
    members.find(shapeHasAnimation) ||
    (fallbackToFirst ? members[0] : null) ||
    null
  );
}

// パスの「進み具合(pathProgress: 0〜1)」を持つKFだけを抜き出す。
// 位置・回転などの他プロパティのKFと同じ配列に混在させつつ、
// パスの時間割り当てだけを独立して扱えるようにするためのフィルタ。
function pathProgressKeyframes(s) {
  return (s?.keyframes || []).filter(k => Number.isFinite(Number(k.pathProgress)));
}

// パスKF(pathProgress:0〜1)が無い図形は、これまで通り
// 「タイムライン全体(0〜totalDur)に等速で対応付け」をデフォルトにする。
function getPathTimeRange(s) {
  const kfs = pathProgressKeyframes(s);
  let start = 0, end = totalDur;
  if (kfs.length >= 2) {
    const sorted = [...kfs].sort((a, b) => a.pathProgress - b.pathProgress);
    start = sorted[0].t;
    end = sorted[sorted.length - 1].t;
  } else if (kfs.length === 1) {
    if (kfs[0].pathProgress <= 0) start = kfs[0].t;
    else if (kfs[0].pathProgress >= 1) end = kfs[0].t;
  }
  start = Math.max(0, Math.min(totalDur, start));
  end = Math.max(0, Math.min(totalDur, end));
  if (end <= start) {
    if (start >= totalDur) start = Math.max(0, totalDur - 0.5);
    end = Math.min(totalDur, start + 0.5);
  }
  if (end <= start) end = Math.max(start + 0.01, totalDur);
  return { start, end };
}

function getPathProgressForTime(s, cur, fallbackProgress) {
  if (!s?.animPath || s.animPath.length < 2) return null;

  // pathProgressKF が2点以上あれば、他のKFと同じ補間+easingエンジンで進み具合を出す
  // （区間ごとにease-in/out等をかけられる）
  const kfs = pathProgressKeyframes(s);
  if (kfs.length >= 2) {
    const sample = sampleKeyframes(kfs, cur);
    const p = Number(sample?.pathProgress);
    if (Number.isFinite(p)) return Math.max(0, Math.min(1, p));
  }

  // 明示的なタイミングKFが無い/1点だけの場合は、開始〜終了の範囲に対する
  // 単純な線形の進み具合にフォールバックする
  const range = getPathTimeRange(s);
  if (cur <= range.start) return 0;
  if (cur >= range.end) return 1;
  return (cur - range.start) / Math.max(0.001, range.end - range.start);
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
      return { x: seg.a.x + (seg.b.x - seg.a.x) * f, y: seg.a.y + (seg.b.y - seg.a.y) * f };
    }
    d -= seg.len;
  }
  return path[path.length - 1];
}

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
