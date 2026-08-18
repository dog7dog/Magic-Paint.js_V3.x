// ══════════════════════════════════════════════════════════════
// Library Manager: MODが許可した外部ライブラリの一元管理
//
//   mod.json / manifest.json（宣言）または MOD の main.js（手続き）
//   から登録され、AnimationApp.libraries として公開される。
//   ここが唯一の「外部ライブラリを読み込む経路」になる。
//
//     mod.json ──┐
//                ├─▶ MOD Loader ─▶ Library Manager ─▶ AnimationApp.libraries
//     main.js ───┘                                          │
//                                                            ▼
//                                     MOD / テキストエディタ / AI生成コード
//
//   テキストエディタ/AI生成コードは get()/has()/list() だけを使う想定。
//   load() はMOD側（main.js・mod.json経由のローダー）が使う入口で、
//   テキストエディタの実行エンジン自身が勝手にCDNを取りに行くことはしない
//   （window.AnimationApp はグローバルなので完全なサンドボックスではなく、
//   あくまで「エディタ側に自動読み込みロジックを持たせない」という設計上の
//   取り決め）。
// ══════════════════════════════════════════════════════════════

(function () {
  const registry = {}; // id -> { id, name, description, source, load, _promise }

  // opts.load が渡されていればそれをそのまま使う（cannon.jsのUMD読み込みのような
  // カスタム処理向け）。無ければ opts.type/url から汎用ローダーを組み立てる。
  function makeLoader(id, opts) {
    if (typeof opts.load === 'function') return opts.load;

    const { type, url, globalName } = opts;
    if (!url) {
      return () => Promise.reject(new Error('load関数もurlも指定されていません: ' + id));
    }

    if (type === 'module') {
      return () => import(/* webpackIgnore: true */ url);
    }

    // 既定: 従来型 <script> タグ読み込み（UMDグローバルビルド向け）
    return () => new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-mp-lib="' + id + '"]');
      if (existing) {
        existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true));
        existing.addEventListener('error', reject);
        return;
      }
      const s = document.createElement('script');
      s.src = url;
      s.dataset.mpLib = id;
      s.onload = () => resolve(globalName ? window[globalName] : true);
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  // 登録のみ行う（読み込みはしない）。mod.json宣言・MOD初期化時の
  // 「使えるようにしておく」用途はこちらを使う。
  function register(id, opts = {}, source = 'mod') {
    if (!id) return;
    registry[id] = {
      id,
      name: opts.name || id,
      description: opts.description || '',
      source, // 'mod.json' | 'mod'（デバッグ・将来のUI表示用）
      load: makeLoader(id, opts),
      _promise: null
    };
  }

  window.AnimationApp = window.AnimationApp || {};
  window.AnimationApp.libraries = {
    // MOD側の入口: 宣言 + 即読み込み。
    // 例: const CANNON = await api.libraries.load({ name:'cannon', type:'module', url:'...' });
    load(opts) {
      if (!opts || !(opts.id || opts.name)) {
        return Promise.reject(new Error('id または name は必須です'));
      }
      const id = opts.id || opts.name;
      if (!registry[id]) register(id, opts, 'mod');
      return this.get(id);
    },

    // MOD側の入口その2: 「使えるようにだけしておく」宣言のみの登録（即読み込みしない）。
    // load()はPromiseの性質上どうしても呼んだ瞬間に読み込みが始まってしまうため、
    // MOD初期化時に「重いライブラリを宣言だけしておき、実際に必要になった
    // (get()が呼ばれた)時に初めて読み込む」ことを可能にするために用意している。
    // mod.json / manifest.json の libraries 宣言も内部的にこれを使う。
    declare(id, opts = {}) {
      if (!registry[id]) register(id, opts, opts.source || 'mod');
    },

    // 登録済みライブラリを取得する（未読み込みなら初回だけ読み込み、以降はキャッシュを返す）。
    // テキストエディタ/AI生成コードはこれだけを使う想定。
    get(id) {
      const entry = registry[id];
      if (!entry) return Promise.reject(new Error('未登録のライブラリです: ' + id));
      if (!entry._promise) entry._promise = Promise.resolve(entry.load());
      return entry._promise;
    },

    has(id) {
      return Boolean(registry[id]);
    },

    list() {
      return Object.values(registry).map(({ id, name, description, source }) => ({ id, name, description, source }));
    }
  };
})();
