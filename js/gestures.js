/**
 * gestures.js — ランドマーク配列を「UI が扱える状態」に翻訳する層
 *
 *  HandLandmarker の 21点:
 *    0=手首 / 1-4=親指 / 5-8=人差指 / 9-12=中指 / 13-16=薬指 / 17-20=小指
 *    各指は MCP, PIP, DIP, TIP の順
 *
 *  ここでやること:
 *    - 手のサイズで正規化 → カメラとの距離に依存しない判定
 *    - ヒステリシス付きピンチ判定（境界でのチャタリング防止）
 *    - One Euro フィルタでカーソルを滑らかに（遅延を増やさずジッタだけ消す）
 *    - 顔の 4x4 変換行列から yaw / pitch / roll を取り出す
 */
import { TUNING } from './config.js';

/* ---------- One Euro Filter ---------- */
class LowPass {
  constructor() { this.y = null; }
  filter(x, a) { this.y = (this.y === null) ? x : a * x + (1 - a) * this.y; return this.y; }
}
export class OneEuro {
  constructor(minCutoff = 1.0, beta = 0.02, dCutoff = 1.0) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.x = new LowPass(); this.dx = new LowPass(); this.tPrev = null; this.xPrev = null;
  }
  _alpha(cutoff, dt) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(value, tMs) {
    if (this.tPrev === null) { this.tPrev = tMs; this.xPrev = value; return this.x.filter(value, 1); }
    const dt = Math.max((tMs - this.tPrev) / 1000, 1e-3);
    this.tPrev = tMs;
    const dRate = (value - this.xPrev) / dt;
    this.xPrev = value;
    const edx = this.dx.filter(dRate, this._alpha(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.x.filter(value, this._alpha(cutoff, dt));
  }
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z ?? 0) - (b.z ?? 0));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

const TIPS = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const PIPS = { thumb: 2, index: 6, middle: 10, ring: 14, pinky: 18 };

/** 1本の手の状態を保持・更新する */
export class HandState {
  constructor(label) {
    this.label     = label;      // 'Left' | 'Right'
    this.present   = false;
    this.pinching  = false;
    this.justPinched  = false;   // このフレームで押された（= click）
    this.justReleased = false;
    this.gesture   = 'none';     // none | point | pinch | fist | open | peace
    this.x = 0; this.y = 0;      // 画面座標(px)
    this.nx = 0; this.ny = 0;    // 正規化(0-1, 画面基準・ミラー済み)
    this.pinchAmount = 1;
    this.fx = new OneEuro(TUNING.smoothMinCut, TUNING.smoothBeta);
    this.fy = new OneEuro(TUNING.smoothMinCut, TUNING.smoothBeta);
    this._lostFrames = 0;
  }

  /** landmarks が null ならロスト扱い（数フレーム猶予を持たせてチラつきを防ぐ） */
  update(landmarks, tMs, vw, vh) {
    this.justPinched = this.justReleased = false;

    if (!landmarks) {
      if (++this._lostFrames > 6) {
        if (this.pinching) { this.pinching = false; this.justReleased = true; }
        this.present = false; this.gesture = 'none';
      }
      return this;
    }
    this._lostFrames = 0;
    this.present = true;

    const L = landmarks;
    // 手のサイズ = 手首→中指MCP。カメラ距離が変わっても比率は保たれる
    const scale = Math.max(dist(L[0], L[9]), 1e-4);

    // --- ピンチ（親指TIP ↔ 人差指TIP）---
    const pinchDist = dist(L[4], L[8]) / scale;
    this.pinchAmount = pinchDist;
    if (!this.pinching && pinchDist < TUNING.pinchOn) {
      this.pinching = true; this.justPinched = true;
    } else if (this.pinching && pinchDist > TUNING.pinchOff) {
      this.pinching = false; this.justReleased = true;
    }

    // --- 指の伸展判定（TIP が PIP より手首から遠いか）---
    const ext = {};
    for (const k of Object.keys(TIPS)) {
      ext[k] = dist(L[0], L[TIPS[k]]) > dist(L[0], L[PIPS[k]]) * 1.08;
    }
    const nExt = Object.values(ext).filter(Boolean).length;

    if (this.pinching)                              this.gesture = 'pinch';
    else if (nExt <= 1 && !ext.index)               this.gesture = 'fist';
    else if (nExt >= 4)                             this.gesture = 'open';
    else if (ext.index && ext.middle && !ext.ring)  this.gesture = 'peace';
    else if (ext.index && nExt <= 2)                this.gesture = 'point';
    else                                            this.gesture = 'none';

    // --- カーソル位置 ---
    // ピンチ中は親指と人差指の中点（つまむ点）を使うと直感に合う
    const p = this.pinching
      ? { x: (L[4].x + L[8].x) / 2, y: (L[4].y + L[8].y) / 2 }
      : L[8];

    // カメラは鏡像で見せているので x を反転。
    // さらに中央 20%〜80% の範囲を画面全体に拡大して、腕を大きく動かさずに端まで届くように。
    const EXP = 1.9;
    const rx = clamp01(0.5 + (0.5 - p.x) * EXP);
    const ry = clamp01(0.5 + (p.y - 0.5) * EXP);

    this.nx = rx; this.ny = ry;
    this.x = this.fx.filter(rx * vw, tMs);
    this.y = this.fy.filter(ry * vh, tMs);
    return this;
  }
}

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

/** 顔の状態 */
export class FaceState {
  constructor() {
    this.present = false;
    this.yaw = 0; this.pitch = 0; this.roll = 0;   // rad
    this.bs = {};                                   // blendshape 名 → 0..1
    this.smiling = false; this.browUp = false; this.mouthOpen = false;
    this.justSmiled = false;
    this._smileFrames = 0;
    this._smileLatch = false;
  }

  update(faceRes) {
    this.justSmiled = false;
    const lm = faceRes?.faceLandmarks?.[0];
    if (!lm) { this.present = false; return this; }
    this.present = true;

    // blendshapes
    const cats = faceRes.faceBlendshapes?.[0]?.categories ?? [];
    for (const c of cats) this.bs[c.categoryName] = c.score;

    const smile = ((this.bs.mouthSmileLeft ?? 0) + (this.bs.mouthSmileRight ?? 0)) / 2;
    const brow  = ((this.bs.browInnerUp ?? 0) + (this.bs.browOuterUpLeft ?? 0)) / 2;
    const jaw   = this.bs.jawOpen ?? 0;

    this.smiling   = smile > TUNING.smileOn;
    this.browUp    = brow  > TUNING.browOn;
    this.mouthOpen = jaw   > TUNING.jawOn;
    this.smileScore = smile; this.browScore = brow; this.jawScore = jaw;

    // 笑顔を 8 フレーム以上維持したら 1 回だけ発火（誤爆防止）
    if (this.smiling) {
      this._smileFrames++;
      if (this._smileFrames > 8 && !this._smileLatch) { this._smileLatch = true; this.justSmiled = true; }
    } else if (this._smileFrames > 0 && !this.smiling) {
      this._smileFrames = 0; this._smileLatch = false;
    }

    // 4x4 変換行列（column-major）から姿勢角
    const m = faceRes.facialTransformationMatrixes?.[0]?.data;
    if (m && m.length === 16) {
      const r00 = m[0], r10 = m[1], r20 = m[2], r21 = m[6], r22 = m[10];
      this.pitch = Math.atan2(-r20, Math.hypot(r21, r22));
      this.yaw   = Math.atan2(r10, r00);
      this.roll  = Math.atan2(r21, r22);
    }
    return this;
  }
}

/** 両手の距離（= ズーム）。両手が見えていないときは null */
export function twoHandSpread(left, right) {
  if (!left.present || !right.present) return null;
  return dist2({ x: left.nx, y: left.ny }, { x: right.nx, y: right.ny });
}

export const GESTURE_JP = {
  none: '—', point: '☝️ 指差し', pinch: '🤏 ピンチ',
  fist: '✊ グー', open: '✋ パー', peace: '✌️ ピース',
};
