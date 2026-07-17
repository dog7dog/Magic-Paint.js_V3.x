// ══════════════════════════════════════════════════════════════
// ツールバーのオーバーフロー折りたたみ
//   #topbar / #editor-topbar が入りきらないボタン(MODが追加した分など)を
//   末尾から「⋯」メニューへ自動的に収納する
//
//   #editor-topbar の場合、MOD UI(position:'editor-top')は内側の
//   #editor-mod-ui-area にまとめて追加される。これをブロック単位で
//   丸ごと収納するのではなく、中の要素を1つずつ個別に収納することで、
//   MODが増えても本体側の操作(プレビュー等)をできるだけ残す。
// ══════════════════════════════════════════════════════════════

function mpDebounce(fn, wait) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// toolbarId ごとに「優先して individually 収納する内側コンテナ」のidを定義
const MP_TOOLBAR_INNER_SOURCES = {
  'editor-topbar': ['editor-mod-ui-area']
};

// registerUI() が作る .mod-ui-block > (.mod-ui-title) + .mod-ui-body > 実際のボタン群
// というラッパー構造を展開し、個々のボタン単位のリストにする（ブロックごと収納しないため）
function mpUnwrapUiWrapper(el) {
  if (el.classList && (el.classList.contains('mod-ui-block') || el.classList.contains('mod-ui-body'))) {
    const kids = [...el.children].filter(c => !c.classList.contains('mod-ui-title'));
    // 中身を個別ボタンへ展開する。既に空（全ボタンが収納済み）なら
    // 中身のない殻を移動対象にせず、そのまま無視する
    return kids.length ? kids.flatMap(mpUnwrapUiWrapper) : [];
  }
  return [el];
}

function mpInitToolbarOverflow(toolbarId) {
  const toolbar = document.getElementById(toolbarId);
  if (!toolbar) return;

  const wrapId = toolbarId + '-overflow-wrap';
  let wrap = document.getElementById(wrapId);
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = wrapId;
    wrap.className = 'mp-menu-wrap tb-overflow-wrap';
    wrap.innerHTML =
      '<button class="tb-btn tb-overflow-btn" type="button" title="もっと見る"><i class="ti ti-dots"></i></button>' +
      '<div class="mp-menu tb-overflow-menu"></div>';
    toolbar.appendChild(wrap);

    const btn = wrap.querySelector('.tb-overflow-btn');
    const menuEl = wrap.querySelector('.tb-overflow-menu');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      menuEl.classList.toggle('open');
    });
    menuEl.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => menuEl.classList.remove('open'));
  }
  const menu = wrap.querySelector('.tb-overflow-menu');

  // 収納の優先順位: 内側コンテナ(MODが追加したUI)を先に個別で使い切ってから、
  // 最後の手段としてツールバー本体の直下の子(内側コンテナ自身とwrapを除く)を使う。
  const innerIds = MP_TOOLBAR_INNER_SOURCES[toolbarId] || [];
  const innerSources = innerIds.map(id => document.getElementById(id)).filter(Boolean);
  const sourceOrder = [...innerSources, toolbar];

  function isOverflowing() {
    return toolbar.scrollWidth > toolbar.clientWidth + 1;
  }

  function lastCollapsibleChild() {
    for (const src of sourceOrder) {
      if (src !== toolbar) {
        // 内側コンテナ(MOD UIエリア)は .mod-ui-block/.mod-ui-body を展開し、
        // 個々のボタン単位で末尾から取る
        const units = [...src.children].flatMap(mpUnwrapUiWrapper);
        if (units.length) return { parent: src, el: units[units.length - 1] };
        continue;
      }
      // toolbar自身から取る場合は wrap と内側コンテナは対象外（最後の手段）
      let child = src.lastElementChild;
      while (child && (child === wrap || innerSources.includes(child))) {
        child = child.previousElementSibling;
      }
      if (child) return { parent: src, el: child };
    }
    return null;
  }

  function collapseOne() {
    const found = lastCollapsibleChild();
    if (!found) return false;
    found.el.dataset.tbOverflowFrom = found.parent === toolbar ? '' : found.parent.id;
    menu.insertBefore(found.el, menu.firstChild);
    return true;
  }

  function expandOne() {
    const first = menu.firstElementChild;
    if (!first) return false;
    const fromId = first.dataset.tbOverflowFrom;
    const target = fromId ? document.getElementById(fromId) : null;
    delete first.dataset.tbOverflowFrom;
    if (target) {
      target.appendChild(first);
    } else {
      toolbar.insertBefore(first, wrap);
    }
    return true;
  }

  function sync() {
    // 「⋯」ボタン自身の幅も判定に含めるため、判定中は常に表示しておく
    wrap.style.display = 'inline-block';

    let guard = 0;
    while (isOverflowing() && guard++ < 100) {
      if (!collapseOne()) break;
    }
    guard = 0;
    while (menu.firstElementChild && guard++ < 100) {
      if (!expandOne()) break;
      if (isOverflowing()) { collapseOne(); break; }
    }
    wrap.style.display = menu.firstElementChild ? 'inline-block' : 'none';
  }

  const debouncedSync = mpDebounce(sync, 80);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(debouncedSync).observe(toolbar);
  } else {
    window.addEventListener('resize', debouncedSync);
  }

  // subtree:true で #editor-mod-ui-area のような内側コンテナへの
  // 追加/削除(MODの動的登録)も検知する。wrap内部の変化(自分自身の収納/復元操作)は無視。
  new MutationObserver(muts => {
    const relevant = muts.some(m => !wrap.contains(m.target));
    if (relevant) debouncedSync();
  }).observe(toolbar, { childList: true, subtree: true });

  setTimeout(sync, 50);
}

function mpInitAllToolbarOverflow() {
  mpInitToolbarOverflow('topbar');
  mpInitToolbarOverflow('editor-topbar');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(mpInitAllToolbarOverflow, 200));
} else {
  setTimeout(mpInitAllToolbarOverflow, 200);
}
