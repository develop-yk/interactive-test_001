/**
 * ui.js — ジェスチャーで操作される UI ウィジェット群
 *
 * 「カーソル位置 + ピンチの押下/離上」だけを入力として受け取り、
 * hover / click / drag を自前でディスパッチします（マウスイベントは使わない）。
 */

const CARD_DATA = [
  { emoji: '🎛️', name: 'Mixer',    tag: 'audio'  },
  { emoji: '🗺️', name: 'Map',      tag: 'geo'    },
  { emoji: '📊', name: 'Chart',    tag: 'data'   },
  { emoji: '🧩', name: 'Modules',  tag: 'system' },
  { emoji: '🎞️', name: 'Timeline', tag: 'video'  },
  { emoji: '🛰️', name: 'Sensors',  tag: 'iot'    },
];

const BS_ROWS = [
  ['mouthSmileLeft',  '口角(左)'],
  ['mouthSmileRight', '口角(右)'],
  ['browInnerUp',     '眉を上げる'],
  ['jawOpen',         '口を開く'],
  ['eyeBlinkLeft',    'まばたき(左)'],
  ['eyeBlinkRight',   'まばたき(右)'],
];

export class UI {
  constructor(root) {
    this.root       = root;
    this.board      = root.querySelector('#board');
    this.cardsEl    = root.querySelector('#cards');
    this.cardNote   = root.querySelector('#cardNote');
    this.slider     = root.querySelector('#slider');
    this.sliderVal  = root.querySelector('#sliderVal');
    this.toggle     = root.querySelector('#toggle');
    this.zoomFill   = root.querySelector('#zoomFill');
    this.zoomVal    = root.querySelector('#zoomVal');
    this.bsEl       = root.querySelector('#blendshapes');
    this.reaction   = root.querySelector('#reaction');
    this.toastEl    = root.querySelector('#toast');
    this.aiAskBtn   = root.querySelector('#aiAskBtn');

    this.sliderValue = 0.5;
    this.zoom        = 1.0;
    this.likes       = 0;
    this.selected    = null;

    this.onEvent = () => {};   // main.js が購読（AI へのイベントログ用）
    this.actions = {};         // data-action="xxx" のボタンから呼ばれる関数を main.js が登録

    this._drag  = null;        // { type:'slider' } | { type:'panel', el, dx, dy }
    this._hover = null;
    this._bsBars = {};
    this._toastT = 0;

    this._buildCards();
    this._buildBlendshapes();
  }

  _buildCards() {
    this.cardsEl.innerHTML = '';
    for (const c of CARD_DATA) {
      const el = document.createElement('div');
      el.className = 'card';
      el.dataset.clickable = '';
      el.dataset.name = c.name;
      el.innerHTML = `<div class="emoji">${c.emoji}</div><div class="name">${c.name}</div>
                      <div class="muted" style="font-size:10px">${c.tag}</div>`;
      this.cardsEl.appendChild(el);
    }
  }

  _buildBlendshapes() {
    this.bsEl.innerHTML = '';
    for (const [key, label] of BS_ROWS) {
      const row = document.createElement('div');
      row.className = 'bs-row';
      row.innerHTML = `<span>${label}</span><div class="bs-bar"><i></i></div><span class="bs-val">0.00</span>`;
      this.bsEl.appendChild(row);
      this._bsBars[key] = { row, bar: row.querySelector('i'), val: row.querySelector('.bs-val') };
    }
  }

  /* ---------------- 入力ディスパッチ ---------------- */

  /**
   * @param {{x:number,y:number,pinching:boolean,justPinched:boolean,justReleased:boolean,gesture:string,present:boolean}} h
   * @param {boolean} primary 主導権を持つ手か（右手優先）
   */
  handleHand(h, primary) {
    if (!primary) return;

    // --- ドラッグ継続 ---
    if (this._drag) {
      if (this._drag.type === 'slider') this._setSliderFromX(h.x);
      if (this._drag.type === 'panel') {
        const el = this._drag.el;
        el.style.transform =
          `translate(${h.x - this._drag.dx}px, ${h.y - this._drag.dy}px)`;
      }
      if (h.justReleased || !h.present) this._endDrag();
      return;
    }

    if (!h.present) { this._setHover(null); return; }

    // --- グーでパネルを掴む ---
    if (h.gesture === 'fist') {
      const panel = this._elementAt(h.x, h.y, '[data-grabbable]');
      if (panel) {
        // 掴んだ瞬間の translate 量を基準にする（掴み直しても飛ばないように）
        const t = getComputedStyle(panel).transform;
        const cur = (!t || t === 'none') ? { m41: 0, m42: 0 } : new DOMMatrixReadOnly(t);
        this._drag = { type: 'panel', el: panel, dx: h.x - cur.m41, dy: h.y - cur.m42 };
        panel.classList.add('grabbed');
        this.toast('パネルを掴みました（手を開くと放します）');
        this.onEvent({ type: 'grab', target: panel.querySelector('.panel-title')?.textContent ?? 'panel' });
        return;
      }
    }

    // --- hover ---
    const hit = this._elementAt(h.x, h.y, '[data-clickable], #slider, #toggle');
    this._setHover(hit);

    // --- 押下 ---
    if (h.justPinched && hit) {
      if (hit === this.slider)      this._beginSliderDrag(h.x);
      else if (hit === this.toggle) this._toggleSwitch();
      else if (hit === this.aiAskBtn) this.onEvent({ type: 'ask' });
      else if (hit.classList.contains('card')) this._selectCard(hit);
      else if (hit.dataset.action) this.actions[hit.dataset.action]?.(hit);
    }
  }

  /** ✋ パー で選択解除・パネル位置リセット */
  handleReset() {
    this.cardsEl.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
    this.board.querySelectorAll('[data-grabbable]').forEach(p => {
      p.style.transform = ''; p.classList.remove('grabbed');
    });
    if (this.selected) { this.selected = null; this.cardNote.textContent = 'リセットしました'; }
  }

  _elementAt(x, y, selector) {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      const m = el.closest(selector);
      if (m) return m;
    }
    return null;
  }

  _setHover(el) {
    if (this._hover === el) return;
    this._hover?.classList.remove('hover');
    this._hover = el;
    el?.classList.add('hover');
  }

  _endDrag() {
    if (!this._drag) return;
    if (this._drag.type === 'slider') this.slider.classList.remove('drag');
    if (this._drag.type === 'panel')  this._drag.el.classList.remove('grabbed');
    this._drag = null;
  }

  _beginSliderDrag(x) {
    this._drag = { type: 'slider' };
    this.slider.classList.add('drag');
    this._setSliderFromX(x);
  }

  _setSliderFromX(x) {
    const r = this.slider.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, (x - r.left) / r.width));
    this.sliderValue = v;
    this.slider.querySelector('.slider-fill').style.width = `${v * 100}%`;
    this.slider.querySelector('.slider-knob').style.left  = `${v * 100}%`;
    this.sliderVal.textContent = v.toFixed(2);
    document.documentElement.style.setProperty('--accent-strength', v.toFixed(2));
  }

  _toggleSwitch() {
    const on = !this.toggle.classList.contains('on');
    this.toggle.classList.toggle('on', on);
    this.toggle.setAttribute('aria-checked', String(on));
    document.body.classList.toggle('wire', on);
    this.toast(on ? 'Wireframe ON' : 'Wireframe OFF');
    this.onEvent({ type: 'toggle', value: on });
  }

  _selectCard(el) {
    this.cardsEl.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
    el.classList.add('active', 'pop');
    setTimeout(() => el.classList.remove('pop'), 400);
    this.selected = el.dataset.name;
    this.cardNote.textContent = `選択中: ${this.selected}`;
    this.toast(`${this.selected} を選択`);
    this.onEvent({ type: 'select', target: this.selected });
  }

  /* ---------------- 表示更新 ---------------- */

  setZoom(spread) {
    if (spread == null) return;
    // 両手間の正規化距離 0.15〜0.75 を 0.6〜2.4 倍にマップ
    const z = 0.6 + (Math.min(0.75, Math.max(0.15, spread)) - 0.15) / 0.6 * 1.8;
    this.zoom += (z - this.zoom) * 0.25;
    this.zoomFill.style.width = `${((this.zoom - 0.6) / 1.8) * 100}%`;
    this.zoomVal.textContent = `${this.zoom.toFixed(2)}×`;
    this.board.style.setProperty('--zoom', this.zoom.toFixed(3));
    // パネルからはみ出さない範囲でスケール（0.6×→0.94 / 2.4×→1.10）
    this.cardsEl.style.transform = `scale(${(0.89 + this.zoom * 0.087).toFixed(3)})`;
  }

  setFace(face) {
    for (const [key, o] of Object.entries(this._bsBars)) {
      const v = face.bs?.[key] ?? 0;
      o.bar.style.width = `${(v * 100).toFixed(1)}%`;
      o.val.textContent = v.toFixed(2);
      o.row.classList.toggle('fire', v > 0.5);
    }
    this.reaction.classList.toggle('fire', !!face.smiling);
    if (face.justSmiled) {
      this.likes++;
      this.reaction.innerHTML = `<span>👍 いいね ×${this.likes}</span>`;
      this.burst();
      this.onEvent({ type: 'smile', count: this.likes });
    }
  }

  setParallax(yaw, pitch, gain) {
    const dx = Math.max(-1, Math.min(1, yaw   / 0.5)) * gain;
    const dy = Math.max(-1, Math.min(1, pitch / 0.5)) * gain * 0.6;
    document.querySelectorAll('.bg-layer,.bg-glow').forEach(el => {
      const d = parseFloat(el.dataset.depth || '1');
      el.style.transform = `translate3d(${-dx * d}px, ${-dy * d}px, 0)`;
    });
  }

  burst() {
    const n = 14;
    const r = this.reaction.getBoundingClientRect();
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      s.textContent = ['✨', '👍', '💚', '⭐'][i % 4];
      Object.assign(s.style, {
        position: 'fixed', left: `${r.left + r.width / 2}px`, top: `${r.top + r.height / 2}px`,
        zIndex: 60, pointerEvents: 'none', fontSize: '18px',
        transition: 'transform .9s cubic-bezier(.15,.7,.3,1), opacity .9s',
      });
      document.body.appendChild(s);
      requestAnimationFrame(() => {
        const a = (i / n) * Math.PI * 2, d = 70 + Math.random() * 90;
        s.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d - 30}px) scale(.4)`;
        s.style.opacity = '0';
      });
      setTimeout(() => s.remove(), 950);
    }
  }

  toast(msg) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('on');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this.toastEl.classList.remove('on'), 1600);
  }

  /** 現在の UI 状態のスナップショット（AI に渡す文脈） */
  snapshot() {
    return {
      selectedCard: this.selected,
      intensity: +this.sliderValue.toFixed(2),
      wireframe: this.toggle.classList.contains('on'),
      zoom: +this.zoom.toFixed(2),
      likes: this.likes,
    };
  }
}
