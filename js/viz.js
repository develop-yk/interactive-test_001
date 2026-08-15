/**
 * viz.js — カメラスルーの画に重ねる全画面ランドマーク描画
 *
 *  video は CSS の object-fit:cover + scaleX(-1) で全画面に敷いている。
 *  canvas も同じ画面サイズにするので、正規化ランドマーク(0..1)を
 *  「cover で切り取られた矩形」へ手動でマッピングし直す必要がある。
 *  DrawingUtils は canvas 全体に等倍で描く前提なので、ここでは使わず自前で描く。
 *  （そのぶん番号ラベルやバウンディングボックスなど自由に足せる）
 *
 *  モード:
 *    'simple'   … 骨格線と顔の輪郭だけ。UI の文字が読みやすい
 *    'detailed' … 顔メッシュ / 虹彩 / 番号付きランドマーク / bbox / 信頼度
 */
import { HandLandmarker, FaceLandmarker }
  from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';

const C = {
  right : '#5cc8ff',
  left  : '#ff6ba9',
  face  : 'rgba(150,205,255,0.85)',
  mesh  : 'rgba(150,205,255,0.13)',
  iris  : '#ffd76b',
  pinch : '#ffffff',
  label : 'rgba(6,10,18,0.72)',
};

/* 顔のパーツごとの接続。ライブラリの静的プロパティをそのまま使う */
const FACE_PARTS = () => [
  [FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,   C.face, 1.6],
  [FaceLandmarker.FACE_LANDMARKS_LIPS,        C.face, 1.2],
  [FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,    C.face, 1.2],
  [FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,   C.face, 1.2],
  [FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,  C.face, 1.2],
  [FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, C.face, 1.2],
];

const FINGER_TIPS = [4, 8, 12, 16, 20];

export class Viz {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video  = video;
    this.ctx    = canvas.getContext('2d');
    this.mode   = 'simple';
    this.dpr    = Math.min(window.devicePixelRatio || 1, 2);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  setMode(m) { this.mode = m; return m; }
  toggleMode() { return this.setMode(this.mode === 'simple' ? 'detailed' : 'simple'); }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.w = w; this.h = h;
    this.canvas.width  = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width  = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  /** object-fit:cover と同じ矩形を求める（映像とランドマークをぴったり合わせるため） */
  _fit() {
    const vw = this.video.videoWidth  || 4;
    const vh = this.video.videoHeight || 3;
    const s  = Math.max(this.w / vw, this.h / vh);
    const dw = vw * s, dh = vh * s;
    return { ox: (this.w - dw) / 2, oy: (this.h - dh) / 2, dw, dh };
  }

  /** 正規化ランドマーク → 画面座標（x は鏡像なので反転） */
  _mk(fit) {
    return lm => ({ x: fit.ox + (1 - lm.x) * fit.dw, y: fit.oy + lm.y * fit.dh });
  }

  render(handRes, faceRes, states) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const fit = this._fit();
    const P = this._mk(fit);
    const detailed = this.mode === 'detailed';

    /* ---------------- 顔 ---------------- */
    const faceLm = faceRes?.faceLandmarks?.[0];
    if (faceLm) {
      if (detailed) {
        this._conns(faceLm, FaceLandmarker.FACE_LANDMARKS_TESSELATION, P, C.mesh, 0.5);
      }
      for (const [conns, color, lw] of FACE_PARTS()) {
        this._conns(faceLm, conns, P, color, lw);
      }
      if (detailed) {
        this._conns(faceLm, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,  P, C.iris, 2);
        this._conns(faceLm, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, P, C.iris, 2);

        const b = this._bbox(faceLm, P);
        this._box(b, 'rgba(150,205,255,0.5)');
        const f = states?.face;
        const deg = r => `${(r * 57.3).toFixed(0)}°`;
        this._tag(b.x, b.y - 8,
          `FACE  yaw ${deg(f?.yaw ?? 0)}  pitch ${deg(f?.pitch ?? 0)}  roll ${deg(f?.roll ?? 0)}`,
          C.face);
        this._tag(b.x, b.y + b.h + 20,
          `smile ${(f?.smileScore ?? 0).toFixed(2)}  brow ${(f?.browScore ?? 0).toFixed(2)}  jaw ${(f?.jawScore ?? 0).toFixed(2)}`,
          C.face);
      }
    }

    /* ---------------- 手 ---------------- */
    const hands = handRes?.landmarks ?? [];
    hands.forEach((lm, i) => {
      const cat    = handRes.handedness?.[i]?.[0];
      const isLeft = cat?.categoryName === 'Left';
      const color  = isLeft ? C.left : C.right;
      const st     = isLeft ? states?.left : states?.right;

      // 骨格
      this._conns(lm, HandLandmarker.HAND_CONNECTIONS, P, color, detailed ? 3 : 2.6, true);

      // 関節点
      ctx.fillStyle = '#fff';
      lm.forEach((p, n) => {
        const q = P(p);
        const r = FINGER_TIPS.includes(n) ? 4 : 2.6;
        ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 6.284); ctx.fill();
      });

      // ピンチの可視化（親指TIP ↔ 人差指TIP）
      const a = P(lm[4]), b = P(lm[8]);
      const on = !!st?.pinching;
      ctx.strokeStyle = on ? C.pinch : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = on ? 3 : 1.5;
      ctx.setLineDash(on ? [] : [4, 5]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      if (on) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        ctx.strokeStyle = C.pinch; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(mx, my, 13, 0, 6.284); ctx.stroke();
      }

      if (detailed) {
        // 番号
        ctx.font = '600 10px ui-monospace, Menlo, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        lm.forEach((p, n) => { const q = P(p); ctx.fillText(String(n), q.x + 6, q.y - 6); });

        const bb = this._bbox(lm, P);
        this._box(bb, color);
        const name = isLeft ? 'LEFT' : 'RIGHT';
        this._tag(bb.x, bb.y - 8,
          `${name} ${(cat?.score ?? 0).toFixed(2)} · ${st?.gesture ?? '-'} · gap ${(st?.pinchAmount ?? 0).toFixed(2)}`,
          color);
      }
    });
  }

  /* ---------------- 描画ヘルパ ---------------- */

  _conns(lm, conns, P, color, lw, glow = false) {
    if (!conns) return;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = 10; }
    ctx.beginPath();
    for (const c of conns) {
      const a = lm[c.start], b = lm[c.end];
      if (!a || !b) continue;
      const p = P(a), q = P(b);
      ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  _bbox(lm, P) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of lm) {
      const p = P(l);
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    const pad = 12;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  }

  /** 角だけのブラケット枠（全周を描くと画面がうるさくなる） */
  _box(b, color) {
    const ctx = this.ctx;
    const c = Math.min(18, b.w / 3, b.h / 3);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y + c);           ctx.lineTo(b.x, b.y);           ctx.lineTo(b.x + c, b.y);
    ctx.moveTo(b.x + b.w - c, b.y);     ctx.lineTo(b.x + b.w, b.y);     ctx.lineTo(b.x + b.w, b.y + c);
    ctx.moveTo(b.x + b.w, b.y + b.h-c); ctx.lineTo(b.x + b.w, b.y+b.h); ctx.lineTo(b.x + b.w - c, b.y + b.h);
    ctx.moveTo(b.x + c, b.y + b.h);     ctx.lineTo(b.x, b.y + b.h);     ctx.lineTo(b.x, b.y + b.h - c);
    ctx.stroke();
  }

  /** 画面外にはみ出さないようクランプしたラベル */
  _tag(x, y, text, color) {
    const ctx = this.ctx;
    ctx.font = '600 11px ui-monospace, Menlo, monospace';
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const w = ctx.measureText(text).width;
    const px = Math.max(8, Math.min(x, this.w - w - 10));
    const py = Math.max(16, Math.min(y, this.h - 6));
    ctx.fillStyle = C.label;
    ctx.fillRect(px - 5, py - 12, w + 10, 17);
    ctx.fillStyle = color;
    ctx.fillText(text, px, py);
  }
}
