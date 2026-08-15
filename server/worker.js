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

// UI の表記は英語で統一しているので、応答も英語で返させる
const SYSTEM = `You are the live commentator for a web demo called "Gesture UI Demo".
The user is operating the interface using only hand gestures and facial expression
in front of a webcam. You receive a log of their recent actions and the current UI state.

Rules:
- Reply in English, 2 sentences maximum, around 30 words.
- Mix a short play-by-play with a suggestion of what to try next.
- Vary your phrasing; never repeat the same sentence twice.
- No bullet lists, no headings, no emoji.`;

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
      `[UI state] ${JSON.stringify(ui)}\n` +
      `[Recent actions] ${events.length ? events.map(e => e.type + (e.target ? `:${e.target}` : '')).join(', ') : '(nothing yet)'}\n` +
      `Give me one short remark based on this.`;

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
