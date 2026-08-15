/**
 * ai-bridge.js — Claude API 連携レイヤー（段階的に有効化できる設計）
 *
 *  Step 1（デフォルト / API キー不要）
 *      AI_ENDPOINT === ''  →  ローカルのルールベース応答を返す。
 *      GitHub Pages に置くだけで動く。デモ・展示はここで完結できる。
 *
 *  Step 2（Claude API 連携）
 *      server/ のプロキシをデプロイし、config.js の AI_ENDPOINT にその URL を設定する。
 *      ブラウザ → プロキシ → Claude Messages API という流れになり、
 *      API キーはサーバー側だけに存在する。
 *
 *  なぜプロキシが必要か:
 *      - api.anthropic.com はブラウザからの直接呼び出しに CORS を許していない
 *      - フロントに API キーを置くと閲覧者全員に漏れる（GitHub Pages は静的配信なので隠せない）
 */
import { AI_ENDPOINT, AI_MIN_INTERVAL } from './config.js';

const LOCAL_LINES = {
  select: [
    n => `Switched to the ${n}. Pinch anywhere on it and move your hand to spin it around.`,
    n => `${n} loaded. Open your palm at any point to snap it back to its starting pose.`,
  ],
  rotate: [
    () => 'Nice spin. Let go mid-motion and it keeps rotating with inertia.',
  ],
  toggle: [
    v => v ? 'Wireframe is now ON. The display mode has switched.' : 'Wireframe is back OFF.',
  ],
  smile: [
    c => `Smile detected (${c} so far). Expression comes through as 52 blendshape values every frame.`,
  ],
  idle: [
    () => 'Show a hand to the camera and a cursor appears. Aim with your index finger, touch your thumb to click.',
    () => 'Show both hands and change the distance between them to resize the wireframe object.',
    () => 'Turn your head and the background shifts. Head pose comes from a 4x4 transformation matrix.',
  ],
};

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export class AIBridge {
  constructor(logEl, modeEl) {
    this.logEl   = logEl;
    this.modeEl  = modeEl;
    this.live    = !!AI_ENDPOINT;
    this.events  = [];
    this.history = [];
    this._last   = 0;
    this._busy   = false;

    if (this.live) {
      this.modeEl.textContent = 'Claude API connected';
      this.modeEl.classList.add('live');
    }
    this.say('Hi. I am watching your gestures — go ahead and try something.');
  }

  /** UI 側で起きたことを溜めておく（AI に渡す文脈になる） */
  push(ev) {
    this.events.push({ ...ev, t: Math.round(performance.now()) });
    if (this.events.length > 40) this.events.shift();

    // ローカルモードでは、意味のあるイベントに即時反応するとデモとして分かりやすい
    if (!this.live && ['select', 'toggle', 'smile', 'rotate'].includes(ev.type)) {
      if (performance.now() - this._last < 2500) return;
      this._last = performance.now();
      const bank = LOCAL_LINES[ev.type];
      if (bank) this.say(pick(bank)(ev.target ?? ev.value ?? ev.count));
    }
  }

  /** 「いま何してた？」ボタン / 定期実行から呼ばれる */
  async ask(uiState, { auto = false } = {}) {
    const now = performance.now();
    if (this._busy) return;
    if (auto && now - this._last < AI_MIN_INTERVAL) return;
    this._last = now;

    if (!this.live) {
      const recent = this.events.slice(-6).map(e => e.type);
      if (!recent.length) return this.say(pick(LOCAL_LINES.idle)());
      return this.say(
        `Recent actions: ${recent.join(' > ')}. ` +
        `Intensity is ${uiState.intensity}, Zoom ${uiState.zoom}x, ` +
        `the object is a ${uiState.shape ?? 'none'}. ` +
        '(Local mode — set AI_ENDPOINT in config.js and Claude will answer instead.)'
      );
    }

    this._busy = true;
    const thinking = this.say('Thinking…', 'thinking');
    try {
      const res = await fetch(AI_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: this.events.slice(-20),
          ui: uiState,
          history: this.history.slice(-6),
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      const data = await res.json();
      thinking.remove();
      const text = data.text ?? '(empty response)';
      this.say(text);
      this.history.push({ role: 'assistant', content: text });
      this.events.length = 0;
    } catch (e) {
      thinking.remove();
      console.error('[ai-bridge]', e);
      this.say(`API request failed: ${e.message}`);
    } finally {
      this._busy = false;
    }
  }

  say(text, cls = '') {
    const el = document.createElement('div');
    el.className = `ai-msg ${cls}`.trim();
    el.textContent = text;
    this.logEl.appendChild(el);
    this.logEl.scrollTop = this.logEl.scrollHeight;
    while (this.logEl.children.length > 24) this.logEl.firstChild.remove();
    return el;
  }
}
