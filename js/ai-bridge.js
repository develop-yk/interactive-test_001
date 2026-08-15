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
    n => `「${n}」を選びましたね。指先だけで選択できるのが手トラッキングの気持ちいいところです。`,
    n => `${n} を開きました。次はピンチしたまま横に動かして Intensity を触ってみてください。`,
  ],
  toggle: [
    v => v ? 'Wireframe を ON にしました。表示のモードが切り替わります。' : 'Wireframe を OFF に戻しました。',
  ],
  smile: [
    c => `笑顔を検出しました（通算 ${c} 回）。表情は 52 個のブレンドシェイプ値として毎フレーム取れています。`,
  ],
  grab: [
    t => `${t} を掴んでいます。グーで掴んで、手を開くと放せます。`,
  ],
  idle: [
    () => '手をカメラに映すとカーソルが出ます。人差し指で狙って、親指とくっつけるとクリックです。',
    () => '両手を映して間隔を変えると Zoom ゲージが動きます。',
    () => '顔を左右に振ると背景が視差で動きます。首の向きは 4x4 の変換行列から取り出しています。',
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
      this.modeEl.textContent = 'Claude API 接続モード';
      this.modeEl.classList.add('live');
    }
    this.say('こんにちは。ジェスチャーの様子を見ています。操作してみてください。');
  }

  /** UI 側で起きたことを溜めておく（AI に渡す文脈になる） */
  push(ev) {
    this.events.push({ ...ev, t: Math.round(performance.now()) });
    if (this.events.length > 40) this.events.shift();

    // ローカルモードでは、意味のあるイベントに即時反応するとデモとして分かりやすい
    if (!this.live && ['select', 'toggle', 'smile', 'grab'].includes(ev.type)) {
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
      const n = { select: 0, toggle: 0, smile: 0, grab: 0 };
      recent.forEach(t => { if (t in n) n[t]++; });
      return this.say(
        `直近の操作: ${recent.join(' → ')}。` +
        `いま Intensity ${uiState.intensity}、Zoom ${uiState.zoom}×、` +
        `選択中は ${uiState.selectedCard ?? 'なし'} です。` +
        (this.live ? '' : '（ローカル応答モード。config.js の AI_ENDPOINT を設定すると Claude が答えます）')
      );
    }

    this._busy = true;
    const thinking = this.say('考えています…', 'thinking');
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
      const text = data.text ?? '(応答が空でした)';
      this.say(text);
      this.history.push({ role: 'assistant', content: text });
      this.events.length = 0;
    } catch (e) {
      thinking.remove();
      console.error('[ai-bridge]', e);
      this.say(`API 呼び出しに失敗しました: ${e.message}`);
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
