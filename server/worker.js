/**
 * Cloudflare Workers 用 Claude API プロキシ（Step 2 用・推奨）
 * ------------------------------------------------------------------
 * GitHub Pages は静的配信なので API キーを置けません。
 * このプロキシを別途デプロイし、config.js の AI_ENDPOINT にその URL を設定します。
 *
 * デプロイ手順:
 *   1) npm i -g wrangler && wrangler login
 *   2) cd server && wrangler deploy
 *   3) wrangler secret put ANTHROPIC_API_KEY        （キーを貼り付け）
 *   4) wrangler secret put ALLOWED_ORIGIN           （例: https://develop-yk.github.io）
 *   5) 表示された https://xxx.workers.dev を config.js の AI_ENDPOINT に設定
 */

const MODEL = 'claude-haiku-4-5-20251001'; // 低レイテンシ重視。品質重視なら claude-sonnet-5

const SYSTEM = `あなたは「Gesture UI Lab」というWebデモの実況ナビゲーターです。
ユーザーはWebカメラの前で手のジェスチャーと表情だけでUIを操作しています。
渡されるのは直近の操作イベントログと現在のUI状態です。

制約:
- 日本語で、2文以内、80文字程度まで。
- 実況＋次に試すと面白い操作の提案を混ぜる。
- 毎回同じ言い回しにしない。
- 箇条書き・見出し・絵文字の多用はしない。`;

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405, headers: cors });
    }

    let body;
    try { body = await request.json(); }
    catch { return json({ error: 'invalid json' }, 400, cors); }

    const { events = [], ui = {}, history = [] } = body;

    const userMsg =
      `【UI状態】${JSON.stringify(ui)}\n` +
      `【直近の操作】${events.length ? events.map(e => e.type + (e.target ? `:${e.target}` : '')).join(', ') : '（まだ操作なし）'}\n` +
      `これを踏まえて一言お願いします。`;

    const messages = [
      ...history.slice(-4).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: userMsg },
    ];

    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 200,
          system: SYSTEM,
          messages,
        }),
      });

      if (!r.ok) return json({ error: 'upstream', detail: await r.text() }, 502, cors);

      const data = await r.json();
      const text = (data.content ?? [])
        .filter(b => b.type === 'text').map(b => b.text).join('').trim();

      return json({ text }, 200, cors);
    } catch (e) {
      return json({ error: String(e) }, 500, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...cors },
  });
}
