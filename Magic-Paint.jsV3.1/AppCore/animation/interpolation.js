// ══════════════════════════════════════════════════════════════
// KFエンジン v2: 補間 + easing
//   DOM/グローバル状態(shapes, ctx 等)に一切依存しない純粋関数のみを置く。
//   export/preview.js は openPreview() 実行時に本ファイルを fetch() して
//   書き出し用HTMLの<script>にそのまま埋め込む。手動コピーではないため、
//   ここを変更するだけで書き出し側にも自動的に反映される。
// ══════════════════════════════════════════════════════════════

const EASINGS = {
  linear: f => f,
  easeIn: f => f * f,
  easeOut: f => 1 - (1 - f) * (1 - f),
  easeInOut: f => (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2)
};

function applyEasing(name, f) {
  const fn = EASINGS[name] || EASINGS.linear;
  return fn(Math.max(0, Math.min(1, f)));
}

// KFの中から補間対象にする数値プロパティのキー一覧を返す。
// t / easing / color は制御用・非数値のため除外する。
const KF_NON_NUMERIC_KEYS = new Set(['t', 'easing', 'color']);
function numericKeysOfKf(kf) {
  return Object.keys(kf).filter(
    k => !KF_NON_NUMERIC_KEYS.has(k) && Number.isFinite(Number(kf[k]))
  );
}

// keyframes(順不同可) と 時刻t から、補間済みのフラットなプロパティ
// オブジェクトを返す。KFが無ければ null。
// 先頭KFより前 / 末尾KFより後ろは、その端点の値でホールドする
// （旧実装の autoHold 合成フレームに相当する挙動を、データを増やさず
// 補間関数の仕様として持たせている）。
// 補間対象プロパティは固定列挙ではなく、両端のKFに共通する数値キーを
// 動的に走査するため、将来 sw/rr やMOD独自プロパティを足しても
// この関数は無改修で対応できる。
function sampleKeyframes(keyframes, t) {
  if (!keyframes || !keyframes.length) return null;
  const sorted = [...keyframes].sort((a, b) => a.t - b.t);

  if (t <= sorted[0].t) return { ...sorted[0] };
  const last = sorted[sorted.length - 1];
  if (t >= last.t) return { ...last };

  let k0 = sorted[0], k1 = last;
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].t <= t && t <= sorted[i + 1].t) {
      k0 = sorted[i];
      k1 = sorted[i + 1];
      break;
    }
  }

  const span = k1.t - k0.t;
  const rawF = span > 0 ? (t - k0.t) / span : 1;
  // easingは区間の開始側(k0)のものを使う
  const f = applyEasing(k0.easing, rawF);

  const keys = new Set([...numericKeysOfKf(k0), ...numericKeysOfKf(k1)]);
  const out = { t };
  keys.forEach(key => {
    const a = Number(k0[key]);
    const b = Number(k1[key]);
    if (Number.isFinite(a) && Number.isFinite(b)) out[key] = a + (b - a) * f;
    else if (Number.isFinite(a)) out[key] = a;
    else if (Number.isFinite(b)) out[key] = b;
  });
  out.color = k0.color ?? k1.color;
  out.easing = k0.easing || 'linear';
  return out;
}
