// ══════════════════════════════════════════════════════════════
// ツールバーのオーバーフロー折りたたみ
//   #topbar / #editor-topbar が入りきらないボタン(MODが追加した分など)を
//   末尾から「⋯」メニューへ自動的に収納する
// ══════════════════════════════════════════════════════════════

function mpDebounce(fn, wait) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
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

  function isOverflowing() {
    return toolbar.scrollWidth > toolbar.clientWidth + 1;
  }

  function collapseOne() {
    const prev = wrap.previousElementSibling;
    if (!prev) return false;
    menu.insertBefore(prev, menu.firstChild);
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
    while (isOverflowing() && guard++ < 60) {
      if (!collapseOne()) break;
    }
    guard = 0;
    while (menu.firstElementChild && guard++ < 60) {
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

  new MutationObserver(muts => {
    const relevant = muts.some(m => !wrap.contains(m.target) && m.target !== menu);
    if (relevant) debouncedSync();
  }).observe(toolbar, { childList: true });

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
