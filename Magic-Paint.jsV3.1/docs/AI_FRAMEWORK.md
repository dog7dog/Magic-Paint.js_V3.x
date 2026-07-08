# Magic Paint AI Framework v2

Magic Paint にAIチャット機能を統合するフレームワークです。
自然言語で指示すると、AIが Canvas API / Three.js / Magic Paint内部API のコードを生成し、
プレビュー確認後にレイヤー適用・MOD化・エディタ送りができます。
キャンバスのスクリーンショットを添付して「添削して」も可能です（Vision対応）。

---

## 構成

```text
ユーザー
↓
AIチャットパネル (AppCore/ai/ai_panel.js)
↓  ┌ Vision画像 / シーン情報 / 選択図形 を添付可能
Flask /api/ai (ai_api.py)
↓
OpenAI / Gemini / Claude / Grok（urllib.requestで直接HTTP通信・SDK不使用）
↓
生成結果 → コード表示 → 危険ワードチェック → プレビュー(編集可) → 適用 / MOD化 / エディタ送り
```

### 追加ファイル

```text
ai_api.py                    ... バックエンド（Python 3.7対応）
AppCore/ai/
├ ai_client.js               ... /api/ai 通信レイヤー + キャンバスキャプチャ
├ ai_panel.js                ... チャットUI / キー管理 / 履歴 / 統計
└ ai_apply.js                ... 危険ワードチェック / プレビュー / 適用 / MOD化
```

---

## 主な機能

### チャット & コード生成
- 4プロバイダー（OpenAI / Gemini / Claude / Grok）を切り替え
- APIキー登録・削除（マスク表示）・接続テスト
- モデル選択 + カスタムモデル名の直接入力
- temperature（創造性）スライダー
- **再生成**ボタン / **クイックアクション**チップ（星空・花火・雪・炎・波・パーティクル・3D 等）

### Vision（画像理解）
- 📷 キャンバスのスクリーンショットをワンタップ添付 → 「これ添削して」
- 📎 画像ファイル添付（最大3枚 / 各4MBまで）

### コンテキスト送信
- 🧊 シーン情報（図形一覧・サイズ・FPS）をAIに渡して整合性のある修正コードを生成
- 👆 選択中の図形JSONを渡してピンポイント修正

### 生成コードの扱い
- **プレビュー**（別キャンバスで安全に再生・その場でコード編集も可能）
- **適用**（`AIコード`レイヤーとして追加。毎フレーム `t` 付き実行 / Undo・保存対象）
- **MOD化**（`registerMod`等を含むコードを `mods/` に書き込み即ロード）
- **エディタへ**（JSエディタのファイルとして追加）
- **コピー**

### 会話管理
- 会話はサーバーDBに自動保存 → 履歴から読み込み / リネーム / 削除
- 会話を Markdown で書き出し
- 新規会話ボタン

### その他
- 📊 使用統計（プロバイダー別の回数・成功数・画像数・平均応答ms・文字数、過去30日）
- パネル幅のドラッグリサイズ（記憶される）
- `Ctrl + /` でパネル開閉

---

## API仕様（バックエンド）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/ai/keys` | プロバイダー一覧（キーはマスク済み、vision可否付き） |
| POST | `/api/ai/keys` | `{provider, api_key, model}` キー保存 |
| POST | `/api/ai/keys/<provider>/model` | モデルのみ変更 |
| DELETE | `/api/ai/keys/<provider>` | キー削除 |
| POST | `/api/ai/test` | 接続テスト |
| POST | `/api/ai` | チャット送信（画像・temperature・会話ID対応） |
| GET | `/api/ai/conversations` | 会話一覧 |
| GET | `/api/ai/conversations/<id>` | 会話取得（メッセージ入り） |
| PUT | `/api/ai/conversations/<id>` | リネーム |
| DELETE | `/api/ai/conversations/<id>` | 削除 |
| GET | `/api/ai/stats` | 使用統計（過去30日） |
| POST | `/api/ai/mods` | AI生成MODのインストール |

### DBテーブル（初回アクセス時に自動作成）

```sql
ai_settings(provider PK, api_key, model, updated_at)
ai_conversations(id PK, title, provider, created_at, updated_at)
ai_messages(id PK, conversation_id, role, content, images, created_at)
ai_logs(id PK, provider, model, prompt_chars, response_chars,
        image_count, duration_ms, ok, created_at)
```

※ 現在は1環境1キー管理です。将来ユーザー登録を入れる場合は各テーブルに
`user_id` を追加してください。

---

## チャット送信ペイロード例

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "temperature": 0.7,
  "conversation_id": 12,
  "messages": [
    { "role": "user", "content": "この絵を明るくして",
      "images": ["data:image/png;base64,...."] }
  ]
}
```

画像は「最後のユーザーメッセージのみ」送信されます（トークン節約）。

---

## 対応プロバイダー

| provider | エンドポイント | デフォルトモデル | Vision |
|---|---|---|---|
| openai | api.openai.com/v1/chat/completions | gpt-4o-mini | ✓ |
| gemini | generativelanguage.googleapis.com | gemini-2.0-flash | ✓ |
| claude | api.anthropic.com/v1/messages | claude-sonnet-4-5 | ✓ |
| grok | api.x.ai/v1/chat/completions | grok-3-mini | ✓ |

モデル一覧は `ai_api.py` の `PROVIDERS` で変更できます。

---

## セキュリティ

- APIキーはMySQLに保存（`lolipop_config.py` のDB接続情報を使用）
- キーはレスポンス・ログ・エラーに**一切含めません**（マスク表示のみ、エラー本文は `***` 置換）
- `ai_logs` にもキーは記録しません（統計は文字数・回数・時間のみ）
- 生成コードは**即実行しません**。必ず「プレビュー」「適用」操作を経由
- 危険ワード（`fetch` / `localStorage` / `document.cookie` / `eval` / `new Function` /
  `import` / `WebSocket` / `indexedDB` 等）を含むコードは実行前に警告
- MODインストールは ID を `^[a-z0-9_]{1,40}$` に制限、パストラバーサル検証、
  固定ファイル名（mod.json / main.js / style.css）のみ、サイズ上限あり
- 添付画像は image/* のみ・サイズ上限あり

---

## 動作環境

- Python 3.7（`match` / `:=` / `list[str]` / `removeprefix` / `zoneinfo` 不使用）
- 追加パッケージ不要（AI通信・画像処理とも標準ライブラリ `urllib` / `base64` のみ）
- ロリポップCGI環境対応（`.htaccess` の既存 `^(api|...)` リライトで `/api/ai` も動作）
