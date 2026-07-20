// ══════════════════════════════════════════════════════════════
// ツールバーのオーバーフロー折りたたみ
//   #topbar / #editor-topbar が入りきらないボタン(MODが追加した分など)を
//   末尾から「⋯」メニューへ自動的に収納する
//
//   MOD UI は registerUI() により
//     .mod-ui-block > (.mod-ui-title) + .mod-ui-body > 実際のボタン群
//   というラッパー構造で追加され、#editor-topbar の場合はさらに
//   #editor-mod-ui-area にまとめて入る。これらを丸ごと収納するのではなく、
//   中の要素を1つずつ個別に収納することで、MODがいくつ増えても
//   本体側の操作をできるだけ残す。
// ══════════════════════════════════════════════════════════════

function mpDebounce(fn, wait) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// 「中身をまとめるためだけのラッパー」を再帰的に展開し、個々のボタン単位の
// リストにする。#editor-mod-ui-area / .mod-ui-block / .mod-ui-body はすべて
// このラッパー扱い（#topbar 直下の .mod-ui-block も含めて統一的に展開する）。
function mpUnwrapUiWrapper(el) {
  const isWrapperContainer =
    el.id === 'editor-mod-ui-area' ||
    (el.classList && (el.classList.contains('mod-ui-block') || el.classList.contains('mod-ui-body')));
  if (isWrapperContainer) {
    const kids = [...el.children].filter(c => !c.classList.contains('mod-ui-title'));
    // 中身が空（すでに全部収納済み）なら、空の殻は移動対象にせず無視する
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

  function flattenedUnits() {
    return [...toolbar.children]
      .filter(c => c !== wrap)
      .flatMap(mpUnwrapUiWrapper);
  }

  function isOverflowing() {
    return toolbar.scrollWidth > toolbar.clientWidth + 1;
  }

  function collapseOne() {
    const units = flattenedUnits();
    if (!units.length) return false;
    menu.insertBefore(units[units.length - 1], menu.firstChild);
    return true;
  }

  function expandOne() {
    const first = menu.firstElementChild;
    if (!first) return false;
    toolbar.insertBefore(first, wrap);
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

    // collapseOne/expandOne 自身が起こしたDOM変更の記録をここで消費し、
    // 下のMutationObserverのコールバックに渡らないようにする。
    // これをしないと「収納/復元 → それを検知して再度sync()」という
    // フィードバックループになり、ボタンが揺れ動いて不安定に見える原因になる。
    observer.takeRecords();
  }

  const debouncedSync = mpDebounce(sync, 80);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(debouncedSync).observe(toolbar);
  } else {
    window.addEventListener('resize', debouncedSync);
  }

  // subtree:true で #editor-mod-ui-area や .mod-ui-block への
  // 追加/削除(MODの動的登録)も検知する。wrap内部の変化(自分自身の収納/復元操作)は無視。
  const observer = new MutationObserver(muts => {
    const relevant = muts.some(m => !wrap.contains(m.target));
    if (relevant) debouncedSync();
  });
  observer.observe(toolbar, { childList: true, subtree: true });

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
