/**
 * ローカル検証用の Claude API プロキシ（Node 18+ / 依存パッケージなし）
 * ------------------------------------------------------------------
 *   ANTHROPIC_API_KEY=sk-ant-... node server/local-proxy.mjs
 *   → http://localhost:8787/api/comment
 *
 *   config.js の AI_ENDPOINT に 'http://localhost:8787/api/comment' を設定して使う。
 *   ※ 本番（GitHub Pages）では worker.js の方を使ってください。
 */
import http from 'node:http';

const PORT   = process.env.PORT || 8787;
const KEY    = process.env.ANTHROPIC_API_KEY;
const MODEL  = process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001';

if (!KEY) {
  console.error('Environment variable ANTHROPIC_API_KEY is not set');
  process.exit(1);
}

const SYSTEM = `You are the live commentator for a web demo called "Gesture UI Demo".
The user operates the interface with hand gestures and facial expression in front of a webcam.
Reply in English, 2 sentences maximum, around 30 words. Mix a short play-by-play with a
suggestion of what to try next, and vary your phrasing every time. No emoji.`;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (req.method !== 'POST')    { res.writeHead(405, cors); return res.end('Method Not Allowed'); }

  let raw = '';
  for await (const c of req) raw += c;

  let body;
  try { body = JSON.parse(raw); }
  catch { res.writeHead(400, cors); return res.end('{"error":"invalid json"}'); }

  const { events = [], ui = {}, history = [] } = body;
  const userMsg =
    `[UI state] ${JSON.stringify(ui)}\n` +
    `[Recent actions] ${events.length ? events.map(e => e.type + (e.target ? `:${e.target}` : '')).join(', ') : '(nothing yet)'}\n` +
    `Give me one short remark based on this.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 200,
        system: SYSTEM,
        messages: [
          ...history.slice(-4).map(h => ({ role: h.role, content: h.content })),
          { role: 'user', content: userMsg },
        ],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      res.writeHead(502, { 'content-type': 'application/json', ...cors });
      return res.end(JSON.stringify({ error: 'upstream', detail: data }));
    }
    const text = (data.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...cors });
    res.end(JSON.stringify({ text }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json', ...cors });
    res.end(JSON.stringify({ error: String(e) }));
  }
}).listen(PORT, () => console.log(`proxy → http://localhost:${PORT}/api/comment  (model: ${MODEL})`));
