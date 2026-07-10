// ══════════════════════════════════════════════════════════════
// AI Framework v2: ai_client.js
// /api/ai バックエンドとの通信レイヤー
// ══════════════════════════════════════════════════════════════
const AIClient = {

  async _json(res, fallbackMsg) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
      const err = new Error(data.error || `${fallbackMsg} (HTTP ${res.status})`);
      err.needKey = !!data.need_key;
      err.exists = !!data.exists;
      err.data = data;
      throw err;
    }
    return data;
  },

  // ── キー ──
  async listKeys() {
    const res = await fetch('api/ai/keys');
    return this._json(res, 'キー一覧の取得に失敗');
  },
  async saveKey(provider, apiKey, model) {
    const res = await fetch('api/ai/keys', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, api_key: apiKey, model: model || null })
    });
    return this._json(res, 'キーの保存に失敗');
  },
  async saveModel(provider, model) {
    const res = await fetch(`/api/ai/keys/${encodeURIComponent(provider)}/model`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model })
    });
    return this._json(res, 'モデルの保存に失敗');
  },
  async deleteKey(provider) {
    const res = await fetch(`/api/ai/keys/${encodeURIComponent(provider)}`, { method: 'DELETE' });
    return this._json(res, 'キーの削除に失敗');
  },
  async testConnection(provider, model) {
    const res = await fetch('api/ai/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model: model || null })
    });
    return this._json(res, '接続テストに失敗');
  },

  // ── チャット ──
  // messages: [{ role, content, images?:[dataURL] }]
  // opts: { model, temperature, conversationId, save }
  async chat(provider, messages, opts) {
    opts = opts || {};
    const res = await fetch('api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider, messages,
        model: opts.model || null,
        temperature: (opts.temperature == null ? null : opts.temperature),
        conversation_id: opts.conversationId || null,
        save: opts.save !== false
      })
    });
    return this._json(res, 'AIリクエストに失敗');
  },

  // ── 会話履歴 ──
  async listConversations() {
    const res = await fetch('api/ai/conversations');
    return this._json(res, '会話一覧の取得に失敗');
  },
  async getConversation(id) {
    const res = await fetch(`/api/ai/conversations/${id}`);
    return this._json(res, '会話の取得に失敗');
  },
  async renameConversation(id, title) {
    const res = await fetch(`/api/ai/conversations/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    return this._json(res, 'リネームに失敗');
  },
  async deleteConversation(id) {
    const res = await fetch(`/api/ai/conversations/${id}`, { method: 'DELETE' });
    return this._json(res, '削除に失敗');
  },

  // ── 統計 ──
  async stats() {
    const res = await fetch('api/ai/stats');
    return this._json(res, '統計の取得に失敗');
  },

  // ── MODインストール ──
  async installMod(mod) {
    const res = await fetch('/api/ai/mods', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mod)
    });
    return this._json(res, 'MODのインストールに失敗');
  },

  // ── 応答パース: ```コード``` を抽出 ──
  // 戻り値: { text, blocks:[{ lang, code }] }
  parseResponse(content) {
    const blocks = [];
    const text = (content || '').replace(
      /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g,
      (m, lang, code) => {
        blocks.push({ lang: (lang || 'javascript').toLowerCase(), code: code.trim() });
        return `\n〔コード ${blocks.length}〕\n`;
      }
    );
    return { text: text.trim(), blocks };
  },

  // ── キャンバスのスクリーンショットを dataURL で取得 ──
  captureCanvas(maxW) {
    maxW = maxW || 1024;
    try {
      const src = (typeof cv !== 'undefined' && cv) ? cv : document.getElementById('cv');
      if (!src) return null;
      const scale = Math.min(1, maxW / src.width);
      const w = Math.max(1, Math.round(src.width * scale));
      const h = Math.max(1, Math.round(src.height * scale));
      const off = document.createElement('canvas');
      off.width = w; off.height = h;
      const octx = off.getContext('2d');
      octx.fillStyle = (typeof canvasBg !== 'undefined' && canvasBg) ? canvasBg : '#111111';
      octx.fillRect(0, 0, w, h);
      octx.drawImage(src, 0, 0, w, h);
      const three = document.getElementById('cv-three');
      if (three && three.width) {
        try { octx.drawImage(three, 0, 0, w, h); } catch (e) {}
      }
      return off.toDataURL('image/png');
    } catch (e) {
      console.warn('[AI] captureCanvas失敗', e);
      return null;
    }
  }
};

window.AIClient = AIClient;
