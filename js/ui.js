/**
 * ui.js — ジェスチャーで操作される UI ウィジェット群
 *
 * 「カーソル位置 + ピンチの押下/離上」だけを入力として受け取り、
 * hover / click / drag を自前でディスパッチします（マウスイベントは使わない）。
 */

const CARD_DATA = [
  { name: 'Mixer',    tag: 'audio'  },
  { name: 'Map',      tag: 'geo'    },
  { name: 'Chart',    tag: 'data'   },
  { name: 'Modules',  tag: 'system' },
  { name: 'Timeline', tag: 'video'  },
  { name: 'Sensors',  tag: 'iot'    },
];

const BS_ROWS = [
  ['mouthSmileLeft',  'Smile L'],
  ['mouthSmileRight', 'Smile R'],
  ['browInnerUp',     'Brow up'],
  ['jawOpen',         'Jaw open'],
  ['eyeBlinkLeft',    'Blink L'],
  ['eyeBlinkRight',   'Blink R'],
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

    this._drag  = null;        // スライダーをドラッグ中か
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
      el.innerHTML = `<div class="name">${c.name}</div><div class="tag">${c.tag}</div>`;
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

    // --- スライダーのドラッグ継続 ---
    if (this._drag) {
      this._setSliderFromX(h.x);
      if (h.justReleased || !h.present) this._endDrag();
      return;
    }

    if (!h.present) { this._setHover(null); return; }

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

  /** パー（開いた手）でカードの選択を解除 */
  handleReset() {
    this.cardsEl.querySelectorAll('.card').forEach(c => c.classList.remove('active'));
    if (this.selected) { this.selected = null; this.cardNote.textContent = 'Selection cleared'; }
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
    this.slider.classList.remove('drag');
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
    this.cardNote.textContent = `Selected: ${this.selected}`;
    this.toast(`${this.selected} selected`);
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
      this.reaction.innerHTML = `<span>Likes &times;${this.likes}</span>`;
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

  /** 絵文字は使わず、小さな円のパーティクルで弾ける演出をつくる */
  burst() {
    const n = 18;
    const colors = ['#54e0a0', '#5cc8ff', '#ff6ba9', '#ffffff'];
    const r = this.reaction.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    for (let i = 0; i < n; i++) {
      const s = document.createElement('div');
      const size = 5 + Math.random() * 5;
      Object.assign(s.style, {
        position: 'fixed', left: `${cx}px`, top: `${cy}px`,
        width: `${size}px`, height: `${size}px`, margin: `${-size / 2}px 0 0 ${-size / 2}px`,
        borderRadius: '50%', background: colors[i % colors.length],
        boxShadow: `0 0 10px ${colors[i % colors.length]}`,
        zIndex: 60, pointerEvents: 'none',
        transition: 'transform .85s cubic-bezier(.15,.75,.3,1), opacity .85s ease-out',
      });
      document.body.appendChild(s);
      requestAnimationFrame(() => {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
        const d = 60 + Math.random() * 90;
        s.style.transform = `translate(${Math.cos(a) * d}px, ${Math.sin(a) * d - 24}px) scale(.3)`;
        s.style.opacity = '0';
      });
      setTimeout(() => s.remove(), 900);
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
