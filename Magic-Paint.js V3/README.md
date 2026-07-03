````markdown
# 🎨 Magic Paint 3.0

**Magic Paint** は、ブラウザ上で動作するオープンな2Dアニメーション・イラスト制作ツールです。

HTML5 Canvas をベースに、タイムラインアニメーション・レイヤー・MODシステムを搭載し、さらに **Three.js（WebGL）** による3D描画にも対応しています。

Magic Paintは、「誰でも自由に作品や拡張機能を作れること」を目標に開発されています。

---

# 📸 スクリーンショット

> ※ スクリーンショットは後日追加予定

```
docs/images/screenshot.png
```

---

# ✨ 主な機能

## 🖌 描画

- ペンツール
- ブラシツール
- 消しゴム
- 線
- 四角形
- 円
- 三角形
- 多角形
- 塗りつぶし

---

## 🎬 アニメーション

- タイムライン
- キーフレーム
- フレーム編集
- プレビュー

---

## 📂 レイヤー

- レイヤー追加
- レイヤーフォルダ
- レイヤーカラー
- レイヤーロック
- 表示 / 非表示
- ドラッグによる並び替え
- Three.jsオブジェクト対応

---

## 🌐 Three.js (WebGL)

- WebGL描画
- Three.js統合
- 2D・3D共通レイヤー

---

## 📦 エクスポート

- PNG
- 透明背景PNG
- レイヤー対応
- Three.jsを含めた書き出し

---

## 🔌 MODシステム

Magic PaintはMODに対応しています。

### MOD API

- createLayer()
- registerTool()
- registerBrush()
- registerShape()
- addObject()
- registerRenderer()

---

## 🧩 MOD SDK

現在整備中

- API Reference
- 開発ガイド
- サンプルMOD

---

# 📁 ディレクトリ構成

```text
AppCore/
├── animation/
├── canvas/
├── core/
├── export/
├── io/
├── mod/
└── ui/

mods/
docs/
backups/
app.py
index.html
style.css
README.md
```

---

# 🚀 起動方法

## 必要環境

- Python 3.x
- Flask

---

## インストール

```bash
pip install flask
```

---

## 起動

```bash
python app.py
```

ブラウザで

```
http://127.0.0.1:5000
```

を開いてください。

---

# 🌎 対応ブラウザ

推奨

- Google Chrome
- Microsoft Edge
- Firefox

最新版を推奨します。

---

# ⌨ ショートカット

|キー|機能|
|----|----|
|Ctrl + Z|Undo|
|Ctrl + Shift + Z|Redo|
|Delete|削除|
|Ctrl + C|コピー（予定）|
|Ctrl + V|貼り付け（予定）|

---

# 📚 今後の予定

## Version 3.1

- Magic Paint Command
- AI Framework
- AI Provider対応
- AIによるCanvas API生成
- AIによるThree.jsコード生成
- AppCore配布方式改善

---

## Version 4.0

- AIアシスタント
- AIアニメーション生成
- AI画像編集支援
- AIによるMOD作成支援

---

# 🤝 コントリビュート

バグ報告・改善案・要望は Issue よりお願いします。

MODの開発も歓迎します。

---

# 📄 ライセンス

Copyright © 2026 Magic Paint Project.

All Rights Reserved.

---

# ⭐ Magic Paint

> Create your imagination.
>
> **Canvas. Animation. WebGL. AI.**
````
