/**
 * tracker.js — カメラ起動と MediaPipe Tasks Vision の推論ループ
 *
 * HandLandmarker (21点 × 最大2手) と FaceLandmarker (478点 + 52 blendshapes)
 * を同じ映像フレームに対して VIDEO モードで走らせます。
 */
// ※ import 文の URL は静的な文字列である必要があるため、config.js の MP_VERSION と
//    ここのバージョン番号は揃えてください（現在: 1.0.1）。
import {
  FilesetResolver, HandLandmarker, FaceLandmarker
} from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';

import { MP_WASM, MODEL_HAND, MODEL_FACE, DELEGATE } from './config.js';

export class Tracker {
  constructor(video) {
    this.video   = video;
    this.hand    = null;
    this.face    = null;
    this.running = false;
    this.lastTs  = -1;
    this.fps     = 0;
    this._frames = 0;
    this._fpsT0  = 0;
    this.onResults = () => {};
  }

  /** モデルのロード（数秒かかる。約 11MB） */
  async load(onProgress = () => {}) {
    onProgress('Loading WASM runtime\u2026');
    const vision = await FilesetResolver.forVisionTasks(MP_WASM);

    const make = async (delegate) => {
      onProgress(`Loading models\u2026 (${delegate})`);
      const [hand, face] = await Promise.all([
        HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_HAND, delegate },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }),
        FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: MODEL_FACE, delegate },
          runningMode: 'VIDEO',
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
        }),
      ]);
      return { hand, face };
    };

    try {
      ({ hand: this.hand, face: this.face } = await make(DELEGATE));
    } catch (e) {
      console.warn('[tracker] GPU delegate failed, falling back to CPU', e);
      ({ hand: this.hand, face: this.face } = await make('CPU'));
    }

    return this;
  }

  /** カメラ起動（HTTPS もしくは localhost が必須） */
  async startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('This browser does not support getUserMedia');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();
    return stream;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._fpsT0 = performance.now();
    const loop = () => {
      if (!this.running) return;
      this._tick();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  _tick() {
    const v = this.video;
    if (v.readyState < 2 || v.currentTime === this.lastTs) return;
    this.lastTs = v.currentTime;

    // 両モデルに同一の単調増加タイムスタンプを渡す
    const ts = performance.now();
    let handRes = null, faceRes = null;
    try {
      handRes = this.hand.detectForVideo(v, ts);
      faceRes = this.face.detectForVideo(v, ts);
    } catch (e) {
      console.error('[tracker] inference error', e);
      return;
    }

    this._frames++;
    if (ts - this._fpsT0 >= 500) {
      this.fps = Math.round((this._frames * 1000) / (ts - this._fpsT0));
      this._frames = 0; this._fpsT0 = ts;
    }

    // 描画は viz.js（全画面 AR オーバーレイ）に任せる
    this.onResults(handRes, faceRes);
  }
}
