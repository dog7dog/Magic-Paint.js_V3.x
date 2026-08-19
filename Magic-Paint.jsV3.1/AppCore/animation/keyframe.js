// ══════════════════════════════════════════════════════════════
// KFエンジン v2: データ操作（本体UI専用）
//   shape.keyframes はフラットな1オブジェクトの配列
//     { t, x, y, rotation, scaleX, scaleY, opacity, color, easing }
//   補間そのものは interpolation.js の sampleKeyframes() に委譲する。
//   Previewとも共有できるパス/アニメーション判定処理は runtime.js に
//   切り出し済み。ここにはUIから呼ばれるデータの読み書きだけを置く。
//   Canvas描画・再生ループは playback.js 側の責務。
// ══════════════════════════════════════════════════════════════

function getAnimationCenter(s) {
  if (s?.groupId) {
    const b = getGroupBounds(s.groupId);
    if (b) return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  }
  return getCenter(s);
}

// shapeHasAnimation は AppCore/animation/runtime.js へ移動（本体・Preview共有）。

function markGroupAnimationOwner(s) {
  if (!s?.groupId) return;
  getGroupMembers(s.groupId, true).forEach(m => delete m.groupAnimOwner);
  s.groupAnimOwner = true;
}

// 図形の「今のライブな見た目」をv2のフラットな形で返す（KFの影響を受けない基準値）
function animationPropsForShape(s) {
  if (!s) return null;
  const c = getAnimationCenter(s);
  return {
    opacity: s.opa ?? 100,
    rotation: s.rot ?? 0,
    scaleX: s.scaleX ?? 1,
    scaleY: s.scaleY ?? 1,
    color: s.color,
    x: c.x,
    y: c.y
  };
}

// 現在の再生位置でのプロパティ（KFがあれば補間結果で上書き）
function animationPropsForShapeAtCurrentTime(s) {
  const props = animationPropsForShape(s);
  if (!props) return null;
  const owner = getAnimationOwnerForShape(s);
  if (!owner) return props;

  const cur = parseFloat((animT * totalDur).toFixed(2));
  const kfP = sampleKeyframes(owner.keyframes, cur);
  if (!kfP) return props;

  ['opacity', 'rotation', 'scaleX', 'scaleY'].forEach(key => {
    const v = Number(kfP[key]);
    if (Number.isFinite(v)) props[key] = v;
  });
  if (kfP.color) props.color = kfP.color;

  // パスがある図形は位置をパス側に任せる（KFのx/yでは動かさない）
  const useKfPosition = !(owner.animPath && owner.animPath.length > 1);
  if (useKfPosition) {
    const kx = Number(kfP.x), ky = Number(kfP.y);
    if (Number.isFinite(kx)) props.x = kx;
    if (Number.isFinite(ky)) props.y = ky;
  }
  return props;
}

function currentRotationForShape(s) {
  const props = animationPropsForShapeAtCurrentTime(s);
  const rot = Number(props?.rotation ?? s?.rot ?? 0);
  return Number.isFinite(rot) ? Math.round(rot * 100) / 100 : 0;
}

// 現在の再生位置にKFを追加/更新する。overridesで一部プロパティだけ上書きできる
// （例: { rotation: 180 } なら回転だけ変え、他は現在の見た目を保持）。
// options.t で追加先の時刻を明示指定できる（省略時は現在の再生位置）。
function upsertKeyframeAtCurrentTime(overrides = {}, options = {}) {
  if (!selected) { setStatus('図形を選択してください'); return null; }
  const animOwner = getSelectedAnimationOwner();
  if (!animOwner) return null;

  const currentT = parseFloat((animT * totalDur).toFixed(2));
  const targetT = Number.isFinite(Number(options.t))
    ? Math.max(0, Math.min(totalDur, Number(options.t)))
    : currentT;
  const props = animationPropsForShapeAtCurrentTime(selected);
  if (!props) return null;
  Object.assign(props, overrides);

  saveState();
  animOwner.keyframes ||= [];

  // 初めてのKFを0秒以外に追加するときは、それ以前の静止状態を
  // 0秒地点のアンカーとして明示的に残す（相手が無いといきなり
  // 目標値へ飛んでしまうため）。以後はここを起点に滑らかに補間される。
  if (!animOwner.keyframes.length && targetT > 0.01) {
    const baseProps = animOwner._kfBaseProps || animationPropsForShape(selected) || props;
    animOwner.keyframes.push({ t: 0, ...baseProps, easing: 'linear' });
  }

  const existing = animOwner.keyframes.find(k => Math.abs(k.t - targetT) < 0.01);
  if (existing) {
    Object.assign(existing, props, { t: targetT, easing: existing.easing || 'linear' });
  } else {
    animOwner.keyframes.push({ t: targetT, ...props, easing: 'linear' });
  }

  animOwner.autoRotate = 0;
  markGroupAnimationOwner(animOwner);
  animOwner.keyframes.sort((a, b) => a.t - b.t);
  renderAnimationCanvasFrame(animT);
  syncProps();
  drawTimeline();
  updateCode();
  return { t: targetT, existing: Boolean(existing), owner: animOwner };
}

function deleteKeyframeAtCurrentTime() {
  if (!selected) { setStatus('図形を選択してください'); return; }
  const animOwner = getSelectedAnimationOwner();
  if (!animOwner?.keyframes?.length) { setStatus('削除するKFがありません'); return; }

  const t = parseFloat((animT * totalDur).toFixed(2));
  const kfs = userKeyframesForShape(animOwner);
  if (!kfs.length) { setStatus('削除するKFがありません'); return; }

  const nearest = kfs
    .map(k => ({ k, d: Math.abs(Number(k.t) - t) }))
    .sort((a, b) => a.d - b.d)[0];
  const tolerance = Math.max(0.2, 3 / Math.max(1, FPS || 24));
  if (!nearest || nearest.d > tolerance) {
    setStatus('近いKFがありません: 最寄り ' + Number(nearest.k.t).toFixed(2) + 's');
    toast('ti-alert-triangle', '赤い再生位置をKFに近づけてください');
    return;
  }

  saveState();
  animOwner.keyframes = animOwner.keyframes.filter(k => k !== nearest.k);

  // 残り1点だけ、しかもそれが暗黙のベースアンカー(0秒)なら
  // アニメーションとして意味を持たないので一緒に片付ける
  if (animOwner.keyframes.length === 1 && animOwner.keyframes[0].t <= 0.01) {
    animOwner.keyframes = [];
  }
  if (!animOwner.keyframes.length) {
    delete animOwner._kfBaseProps;
    if (!shapeHasAnimation(animOwner)) delete animOwner.groupAnimOwner;
  }

  renderAnimationCanvasFrame(animT);
  syncProps();
  drawTimeline();
  updateCode();
  setStatus('KF削除: ' + Number(nearest.k.t).toFixed(2) + 's');
  toast('ti-diamond-off', Number(nearest.k.t).toFixed(2) + 's のKFを削除');
}

function setRotationKeyframeFromInput() {
  if (!selected) { setStatus('図形を選択してください'); return; }
  const input = document.getElementById('p-anim-rot');
  const valEl = document.getElementById('p-anim-rot-v');
  const durInput = document.getElementById('p-anim-rot-dur');
  const rotVal = Number(input?.value);
  const duration = Number(durInput?.value);

  if (!Number.isFinite(rotVal)) { setStatus('回転角度を入力してください'); return; }
  if (valEl) valEl.textContent = rotVal + '°';

  const animOwner = getSelectedAnimationOwner();
  if (!animOwner) return;

  const startT = parseFloat((animT * totalDur).toFixed(2));
  const dur = Number.isFinite(duration) && duration > 0 ? Math.max(0.05, duration) : 0;

  if (dur > 0) {
    const endT = parseFloat((startT + dur).toFixed(2));
    const startRot = currentRotationForShape(selected);
    const startProps = animationPropsForShapeAtCurrentTime(selected) || animationPropsForShape(selected);

    saveState();
    if (endT > totalDur) {
      totalDur = endT;
      if (tlDurInput) tlDurInput.value = Number.isInteger(totalDur) ? String(totalDur) : totalDur.toFixed(2);
    }

    animOwner.keyframes ||= [];
    animOwner.autoRotate = 0;

    const existingStart = animOwner.keyframes.find(k => Math.abs(Number(k.t) - startT) < 0.01);
    if (existingStart) {
      Object.assign(existingStart, startProps, { t: startT, rotation: startRot, easing: existingStart.easing || 'linear' });
    } else {
      animOwner.keyframes.push({ t: startT, ...startProps, rotation: startRot, easing: 'linear' });
    }

    const existingEnd = animOwner.keyframes.find(k => Math.abs(Number(k.t) - endT) < 0.01);
    if (existingEnd) {
      Object.assign(existingEnd, startProps, { t: endT, rotation: rotVal, easing: existingEnd.easing || 'linear' });
    } else {
      animOwner.keyframes.push({ t: endT, ...startProps, rotation: rotVal, easing: 'linear' });
    }

    markGroupAnimationOwner(animOwner);
    animOwner.keyframes.sort((a, b) => a.t - b.t);
    renderAnimationCanvasFrame(animT);
    syncProps();
    drawTimeline();
    updateCode();
    setStatus('回転: ' + startT.toFixed(2) + 's から ' + dur.toFixed(2) + '秒 → ' + rotVal + '°');
    toast('ti-rotate-clockwise', startT.toFixed(2) + 's → ' + endT.toFixed(2) + 's (' + rotVal + '°)');
    return;
  }

  // 時間未指定: 現在位置に単独KF追加（従来動作。回転だけ上書きする）
  const currentT = startT;
  const firstRotationKf = !hasUserKeyframes(animOwner) && currentT <= 0.01;
  const targetT = firstRotationKf ? totalDur : currentT;
  const result = upsertKeyframeAtCurrentTime({ rotation: rotVal }, { t: targetT });
  if (!result) return;
  if (firstRotationKf && totalDur > 0) {
    animT = Math.max(0, Math.min(1, targetT / totalDur));
    renderAnimationCanvasFrame(animT);
    drawTimeline();
  }
  setStatus((result.existing ? '回転KF更新: ' : '回転KF追加: ') + rotVal + '° / ' + result.t.toFixed(2) + 's');
  toast('ti-rotate-clockwise', result.t.toFixed(2) + 's に ' + rotVal + '°');
}

// 選択中KF（再生位置に最も近いもの）のeasingを変更する
function setEasingForNearestKeyframe(easingName) {
  const animOwner = getSelectedAnimationOwner();
  const kfs = userKeyframesForShape(animOwner);
  if (!kfs.length) return false;
  const t = parseFloat((animT * totalDur).toFixed(2));
  const nearest = kfs.map(k => ({ k, d: Math.abs(Number(k.t) - t) })).sort((a, b) => a.d - b.d)[0];
  const tolerance = Math.max(0.2, 3 / Math.max(1, FPS || 24));
  if (!nearest || nearest.d > tolerance) return false;

  saveState();
  nearest.k.easing = easingName;
  renderAnimationCanvasFrame(animT);
  drawTimeline();
  updateCode();
  return true;
}

// 再生位置に最も近いKF（無ければnull）。プロパティパネルのeasing表示用。
function nearestKeyframeAtCurrentTime(s) {
  const animOwner = getAnimationOwnerForShape(s);
  const kfs = userKeyframesForShape(animOwner);
  if (!kfs.length) return null;
  const t = parseFloat((animT * totalDur).toFixed(2));
  const nearest = kfs.map(k => ({ k, d: Math.abs(Number(k.t) - t) })).sort((a, b) => a.d - b.d)[0];
  const tolerance = Math.max(0.2, 3 / Math.max(1, FPS || 24));
  return nearest && nearest.d <= tolerance ? nearest.k : null;
}

function userKeyframesForShape(s) {
  return (s?.keyframes || []).slice().sort((a, b) => a.t - b.t);
}

function hasUserKeyframes(s) {
  return userKeyframesForShape(s).length > 0;
}

// パス(animPath)の全長(px)。パス速度⇄パス時間の相互変換に使う。
function getPathLength(path) {
  if (!path || path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
}

// pathProgressKeyframes / getPathTimeRange / getPathProgressForTime は
// AppCore/animation/runtime.js へ移動（本体・Preview共有）。

function setPathDurationFromPlayhead() {
  if (!selected) { setStatus('図形を選択してください'); return; }
  const animOwner = getSelectedAnimationOwner();
  if (!animOwner?.animPath || animOwner.animPath.length < 2) {
    setStatus('先にパスを描いてください');
    return;
  }

  const input = document.getElementById('p-path-duration');
  const duration = Number(input?.value);
  if (!Number.isFinite(duration) || duration <= 0) {
    setStatus('パス秒数を入力してください');
    toast('ti-alert-triangle', '0より大きい秒数を入れてください');
    return;
  }

  const startT = parseFloat((animT * totalDur).toFixed(2));
  const dur = Math.max(0.05, duration);
  const endT = parseFloat((startT + dur).toFixed(2));

  saveState();
  if (endT > totalDur) {
    totalDur = endT;
    if (tlDurInput) tlDurInput.value = Number.isInteger(totalDur) ? String(totalDur) : totalDur.toFixed(2);
  }
  animT = totalDur > 0 ? Math.max(0, Math.min(1, startT / totalDur)) : 0;

  animOwner.keyframes ||= [];
  // 既存のパス進み具合KF(pathProgressを持つもの)は置き換える
  animOwner.keyframes = animOwner.keyframes.filter(k => !Number.isFinite(Number(k.pathProgress)));
  animOwner.keyframes.push({ t: startT, pathProgress: 0, easing: 'linear' });
  animOwner.keyframes.push({ t: endT, pathProgress: 1, easing: 'linear' });
  animOwner.keyframes.sort((a, b) => a.t - b.t);
  markGroupAnimationOwner(animOwner);

  renderAnimationCanvasFrame(animT);
  syncProps();
  drawTimeline();
  updateCode();
  setStatus('パス時間: ' + startT.toFixed(2) + 's から ' + dur.toFixed(2) + '秒');
  toast('ti-clock-play', startT.toFixed(2) + 's から ' + dur.toFixed(2) + '秒');
}

function rememberAnimationBase(s) {
  if (!s) return;
  const owner = getAnimationOwnerForShape(s);
  if (!owner || hasUserKeyframes(owner) || owner._kfBaseProps) return;
  const props = animationPropsForShape(s);
  if (props) owner._kfBaseProps = props;
}

// getGroupAnimationOwner は AppCore/animation/runtime.js へ移動（本体・Preview共有）。

function getSelectedAnimationOwner() {
  if (!selected) return null;
  if (!selected.groupId) return selected;
  return getGroupAnimationOwner(selected.groupId, false) || selected;
}

function getAnimationOwnerForShape(s) {
  if (s && s.groupId) return getGroupAnimationOwner(s.groupId, false) || s;
  return s;
}

function getAnimationDebugSummary() {
  const groups = [...new Set(shapes.filter(s => s.groupId).map(s => s.groupId))];
  const animatedGroups = groups.filter(id => {
    const owner = getGroupAnimationOwner(id, false);
    return owner && shapeHasAnimation(owner);
  }).length;
  const solo = shapes.filter(s => !s.groupId && shapeHasAnimation(s)).length;
  return { groups: groups.length, animatedGroups, solo };
}

// ── 旧データ形式(v1)からの移行 ──────────────────────────────────
// 旧: keyframes = [{ t, props: {opa, rot, x, y, color}, autoHold?, kind?, pathStart? }]
// 新: keyframes = [{ t, opacity, rotation, x, y, color, easing }]
function migrateLegacyKeyframes(shape) {
  if (!shape || !Array.isArray(shape.keyframes) || !shape.keyframes.length) return;
  const isLegacy = shape.keyframes.some(k => k && typeof k.props === 'object');
  if (!isLegacy) return;

  // 旧仕様では「パス開始」を兼ねたKFがあった。pathStartT が未設定なら引き継ぐ。
  if (!Number.isFinite(Number(shape.pathStartT))) {
    const pathStartKf = shape.keyframes.find(k => k.pathStart || k.kind === 'path-start');
    if (pathStartKf) shape.pathStartT = Number(pathStartKf.t) || 0;
  }

  shape.keyframes = shape.keyframes
    .filter(k => !k.autoHold) // 自動生成された保持用フレームは新方式では不要
    .map(k => {
      const p = k.props || {};
      const out = { t: Number(k.t) || 0, easing: 'linear' };
      if (Number.isFinite(Number(p.opa))) out.opacity = Number(p.opa);
      if (Number.isFinite(Number(p.rot))) out.rotation = Number(p.rot);
      if (Number.isFinite(Number(p.x))) out.x = Number(p.x);
      if (Number.isFinite(Number(p.y))) out.y = Number(p.y);
      if (p.color) out.color = p.color;
      return out;
    });

  delete shape._kfBaseProps; // 旧形式のprops構造で保存されていたため作り直す
}

// ── パスの時間指定(pathStartT/pathEndTスカラー)をpathProgress KFへ移行 ──
// 旧: shape.pathStartT / shape.pathEndT （個別スカラー値）
// 新: shape.keyframes 内の { t, pathProgress: 0|1, easing } エントリ
// isLegacy判定を経ない（props構造ではない）通常のv2データにも
// pathStartT/pathEndTが残っている場合があるため、無条件に実行する。
function migratePathTimingScalars(shape) {
  if (!shape) return;
  const hasStart = Number.isFinite(Number(shape.pathStartT));
  const hasEnd = Number.isFinite(Number(shape.pathEndT));
  if (!hasStart && !hasEnd) return;

  shape.keyframes ||= [];
  if (hasStart) {
    shape.keyframes.push({ t: Number(shape.pathStartT), pathProgress: 0, easing: 'linear' });
  }
  if (hasEnd) {
    shape.keyframes.push({ t: Number(shape.pathEndT), pathProgress: 1, easing: 'linear' });
  }
  shape.keyframes.sort((a, b) => a.t - b.t);
  delete shape.pathStartT;
  delete shape.pathEndT;
}
