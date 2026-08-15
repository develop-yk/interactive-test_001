/**
 * ui.js — ジェスチャーで操作される UI ウィジェット群
 *
 * 「カーソル位置 + ピンチの押下/離上」だけを入力として受け取り、
 * hover / click / drag を自前でディスパッチします（マウスイベントは使わない）。
 *
 * ドラッグは 2 種類:
 *   slider … Spin speed スライダー
 *   rotate … ワイヤーフレーム 3D オブジェクトの回転
 */
import { TUNING } from './config.js';

const BS_ROWS = [
  ['mouthSmileLeft',  'Smile L'],
  ['mouthSmileRight', 'Smile R'],
  ['browInnerUp',     'Brow up'],
  ['jawOpen',         'Jaw open'],
  ['eyeBlinkLeft',    'Blink L'],
  ['eyeBlinkRight',   'Blink R'],
];

/** hover / 押下の対象になる要素 */
const HIT = '[data-clickable], #slider, #toggle, [data-rotatable]';

/**
 * ピンチ確定時に使う「狙い」の有効期限（ms）。
 * 指を閉じ始める前に hover していた要素を latch しておき、押下時にそれを使う。
 */
const AIM_TTL_MS = 400;

/** 滞留選択（dwell）: data-dwell を持つ要素にこの時間カーソルを乗せ続けると決定 */
const DWELL_MS = 2000;

/** 滞留で掴んだスライダーを手放す距離（スライダー帯から縦にこれだけ離れる） */
const STICKY_EXIT_PX = 90;

export class UI {
  constructor(root) {
    this.root       = root;
    this.board      = root.querySelector('#board');
    this.slider     = root.querySelector('#slider');
    this.sliderVal  = root.querySelector('#sliderVal');
    this.toggle     = root.querySelector('#toggle');
    this.zoomFill   = root.querySelector('#zoomFill');
    this.zoomVal    = root.querySelector('#zoomVal');
    this.bsEl       = root.querySelector('#blendshapes');
    this.reaction   = root.querySelector('#reaction');
    this.toastEl    = root.querySelector('#toast');
    this.shapeStage = root.querySelector('#shapeStage');
    this.shapeHint  = root.querySelector('#shapeHint');
    this.shapeAngle = root.querySelector('#shapeAngle');
    this.shapeTabs  = [...root.querySelectorAll('.shape-tab')];

    this.sliderValue = 0.5;
    this.zoom        = 1.0;
    this.likes       = 0;
    this.shapeKey    = 'prism';

    this.shape   = null;       // main.js が Shape3D インスタンスを注入する
    this.onEvent = () => {};   // 操作イベントの購読フック（AI 連携を戻すときに使う）
    this.actions = {};         // data-action="xxx" のボタン用フック

    this._drag  = null;        // { type:'slider' } | { type:'rotate', x, y }
    this._hover = null;
    this._aim  = null;         // 手が開いていたときに狙っていた要素
    this._aimT = -1e9;
    this._dwellEl = null;      // 滞留中の要素
    this._dwellT0 = 0;
    this._dwellFired = false;
    this._bsBars = {};
    this._toastT = 0;

    this._buildBlendshapes();
    // ヒントは一定時間で自動的に消す（回転すればその時点で消える）
    this._hintT = setTimeout(() => this.shapeHint?.classList.add('is-hidden'), 9000);
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
      if (this._drag.type === 'slider') {
        this._setSliderFromX(h.x);
        if (this._drag.sticky) {
          // 滞留で掴んだ場合はピンチしていないので「離上」が来ない。
          // スライダーの帯から縦に大きく外れる／ピンチする、のどちらかで終了する。
          const r = this.slider.getBoundingClientRect();
          const away = h.y < r.top - STICKY_EXIT_PX || h.y > r.bottom + STICKY_EXIT_PX;
          if (away || h.justPinched || !h.present) this._endDrag();
          return;
        }
      } else {
        this.shape?.rotateBy(h.x - this._drag.x, h.y - this._drag.y);
        this._drag.x = h.x; this._drag.y = h.y;
      }
      if (h.justReleased || !h.present) this._endDrag();
      return;
    }

    if (!h.present) { this._setHover(null); this._clearDwell(); return; }

    const hit = this._elementAt(h.x, h.y, HIT);
    this._setHover(hit);

    // 指を閉じる動作そのものでカーソルが 40px 前後ぶれる。押した瞬間の位置で
    // 判定すると、狙いを外したり隣のボタンを踏んだりする。
    // そこで「手が開いていた時点で狙っていた要素」を latch し、押下時にそれを使う。
    // 手を離して別の場所へ動かせば latch も追従するので、古い対象が残ることはない。
    //
    // 時刻はフレーム側から受け取る（h.t）。描画が詰まっても推論フレームの時刻で
    // 数えるので、滞留時間が実機の負荷で伸び縮みしない。
    const now = h.t ?? performance.now();
    if (h.pinchAmount > TUNING.pinchOff) { this._aim = hit; this._aimT = now; }

    const aimFresh = now - this._aimT < AIM_TTL_MS;
    const target = (aimFresh ? (this._aim ?? hit) : hit);

    if (h.justPinched && target && target.isConnected) {
      this._activate(target, h, false);
      // ピンチで決めた要素の上に留まっている間は、滞留で二重に発火させない
      this._clearDwell();
      if ('dwell' in (target.dataset ?? {})) { this._dwellEl = target; this._dwellFired = true; }
      return;
    }

    // ピンチが苦手でも操作できるように、滞留でも決定できるようにしておく
    this._updateDwell(hit, h, now);
  }

  /**
   * ピンチ／滞留のどちらからも呼ばれる決定処理
   * @param {boolean} viaDwell 滞留由来なら true（スライダーをスティッキーに掴む）
   */
  _activate(target, h, viaDwell) {
    if (target === this.slider)          this._beginSliderDrag(h.x, viaDwell);
    else if (target === this.toggle)     this._toggleSwitch();
    else if (target === this.shapeStage) this._beginRotate(h);
    else if (target.dataset.shape)       this._selectShape(target.dataset.shape);
    else if (target.dataset.action)      this.actions[target.dataset.action]?.(target);
    this._flash(target);
  }

  /* ---------------- 滞留選択（dwell） ---------------- */

  _updateDwell(hit, h, now) {
    // 対象は data-dwell を持つ要素だけ。すでに選ばれているものは進めない
    const el = (hit && 'dwell' in hit.dataset && !hit.classList.contains('is-on')) ? hit : null;

    if (el !== this._dwellEl) {
      this._clearDwell();
      this._dwellEl = el;
      this._dwellT0 = now;
      this._dwellFired = false;
    }
    if (!el) return;

    // 一度決めたら、カーソルが離れるまで再発火しない
    if (this._dwellFired) { this._paintDwell(el, 0); return; }

    // ピンチしたままでも滞留は進む。回転ドラッグ中はそもそもこの関数に来ない
    // （上のドラッグ分岐で return している）ので、誤爆の心配はない。
    const p = Math.min(1, (now - this._dwellT0) / DWELL_MS);
    this._paintDwell(el, p);

    if (p >= 1 && !this._dwellFired) {
      this._dwellFired = true;
      this._activate(el, h, true);
      this._paintDwell(el, 0);
    }
  }

  _paintDwell(el, p) {
    el.style.setProperty('--dwell', p.toFixed(3));
    el.classList.toggle('dwelling', p > 0.02);
  }

  _clearDwell() {
    if (this._dwellEl) {
      this._dwellEl.style.removeProperty('--dwell');
      this._dwellEl.classList.remove('dwelling');
    }
    this._dwellEl = null;
    this._dwellFired = false;
  }

  /* ---------------- マウス操作（ジェスチャーと併用可） ---------------- */

  /**
   * 形状ボタン / Vertices トグル / Spin speed スライダーをマウスでも操作できるようにする。
   * ジェスチャー側の _drag には触れないので、両者が競合することはない。
   * 検証・登壇時のフォールバックとしても使う。
   */
  enableMouse() {
    for (const t of this.shapeTabs) {
      t.addEventListener('click', () => this._selectShape(t.dataset.shape));
    }

    this.toggle.addEventListener('click', () => this._toggleSwitch());
    this.toggle.addEventListener('keydown', e => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this._toggleSwitch(); }
    });

    // スライダーはポインタキャプチャで掴む。枠の外へカーソルが出ても追従する
    const sl = this.slider;
    const move = e => this._setSliderFromX(e.clientX);
    sl.addEventListener('pointerdown', e => {
      e.preventDefault();
      sl.setPointerCapture?.(e.pointerId);
      sl.classList.add('drag');
      move(e);
    });
    sl.addEventListener('pointermove', e => {
      if (sl.hasPointerCapture?.(e.pointerId)) move(e);
    });
    const release = e => {
      if (sl.hasPointerCapture?.(e.pointerId)) sl.releasePointerCapture(e.pointerId);
      sl.classList.remove('drag');
    };
    sl.addEventListener('pointerup', release);
    sl.addEventListener('pointercancel', release);

    // 矢印キーでも動かせるようにしておく（細かい値合わせに便利）
    sl.addEventListener('keydown', e => {
      const step = e.shiftKey ? 0.1 : 0.02;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown')  { e.preventDefault(); this.setSlider(this.sliderValue - step); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   { e.preventDefault(); this.setSlider(this.sliderValue + step); }
    });
  }

  /** 値を直接指定してスライダーを更新する（キーボード / 外部から） */
  setSlider(v) {
    const r = this.slider.getBoundingClientRect();
    this._setSliderFromX(r.left + Math.min(1, Math.max(0, v)) * r.width);
  }

  /** 押したことが目で分かるように一瞬光らせる */
  _flash(el) {
    el.classList.add('pressed');
    setTimeout(() => el.classList.remove('pressed'), 220);
  }

  /** ドラッグ中は主導権を持つ手を切り替えたくないので、main.js から参照する */
  get dragging() { return this._drag !== null; }

  /** パー（開いた手）で 3D オブジェクトの姿勢をリセット */
  handleReset() {
    if (!this.shape) return;
    this.shape.reset();
    this.toast('Object reset');
  }

  _elementAt(x, y, selector) {
    for (const el of document.elementsFromPoint(x, y)) {
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
    if (this._drag.type === 'slider') {
      this.slider.classList.remove('drag', 'sticky');
    } else {
      this.shape?.endDrag();
      this.shapeStage.classList.remove('drag');
      this.onEvent({ type: 'rotate', target: this.shapeKey });
    }
    this._drag = null;
  }

  _beginSliderDrag(x, sticky = false) {
    this._drag = { type: 'slider', sticky };
    this.slider.classList.add('drag');
    this.slider.classList.toggle('sticky', !!sticky);
    if (sticky) this.toast('Slider grabbed — move sideways, then move away to finish');
    this._setSliderFromX(x);
  }

  _beginRotate(h) {
    this._drag = { type: 'rotate', x: h.x, y: h.y };
    this.shape?.beginDrag();
    this.shapeStage.classList.add('drag');
    clearTimeout(this._hintT);
    this.shapeHint.classList.add('is-hidden');
  }

  _setSliderFromX(x) {
    const r = this.slider.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, (x - r.left) / r.width));
    this.sliderValue = v;
    this.slider.querySelector('.slider-fill').style.width = `${v * 100}%`;
    this.slider.querySelector('.slider-knob').style.left  = `${v * 100}%`;
    this.sliderVal.textContent = v.toFixed(2);
    this.slider.setAttribute('aria-valuenow', v.toFixed(2));
    this.shape?.setSpin(v);          // 3D の自動回転スピードへ
  }

  _toggleSwitch() {
    const on = !this.toggle.classList.contains('on');
    this.toggle.classList.toggle('on', on);
    this.toggle.setAttribute('aria-checked', String(on));
    this.shape?.setVertices(on);     // 3D の頂点表示へ
    this.toast(on ? 'Vertices ON' : 'Vertices OFF');
    this.onEvent({ type: 'toggle', value: on });
  }

  /** 3D オブジェクトの切り替え（マウスクリックからも呼ばれる） */
  _selectShape(key) {
    if (!this.shape?.setShape(key)) return;
    this.shapeKey = key;
    let label = key;
    for (const t of this.shapeTabs) {
      const on = t.dataset.shape === key;
      t.classList.toggle('is-on', on);
      if (on) label = t.textContent.trim();
    }
    this.toast(label);
    this.onEvent({ type: 'select', target: label });
  }

  /* ---------------- 表示更新 ---------------- */

  setZoom(spread) {
    if (spread == null) return;
    // 両手間の正規化距離 0.15〜0.75 を 0.6〜2.4 倍にマップ
    const z = 0.6 + (Math.min(0.75, Math.max(0.15, spread)) - 0.15) / 0.6 * 1.8;
    this.zoom += (z - this.zoom) * 0.25;
    this.zoomFill.style.width = `${((this.zoom - 0.6) / 1.8) * 100}%`;
    this.zoomVal.textContent = `${this.zoom.toFixed(2)}×`;
    this.shape?.setZoom(this.zoom);
  }

  /** 毎フレーム: 3D の姿勢表示を更新 */
  tick() {
    if (!this.shape) return;
    const a = this.shape.angles();
    this.shapeAngle.textContent = `${a.y}° / ${a.x}°`;
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
      shape: this.shapeKey,
      rotation: this.shape?.angles() ?? null,
      spin: +this.sliderValue.toFixed(2),
      vertices: this.toggle.classList.contains('on'),
      zoom: +this.zoom.toFixed(2),
      likes: this.likes,
    };
  }
}
