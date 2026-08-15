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
  console.error('環境変数 ANTHROPIC_API_KEY が設定されていません');
  process.exit(1);
}

const SYSTEM = `あなたは「Gesture UI Lab」というWebデモの実況ナビゲーターです。
ユーザーはWebカメラの前で手のジェスチャーと表情だけでUIを操作しています。
日本語で2文以内、80文字程度。実況と次に試す操作の提案を混ぜ、毎回違う言い回しにしてください。`;

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
    `【UI状態】${JSON.stringify(ui)}\n` +
    `【直近の操作】${events.length ? events.map(e => e.type + (e.target ? `:${e.target}` : '')).join(', ') : '（まだ操作なし）'}\n` +
    `これを踏まえて一言お願いします。`;

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
