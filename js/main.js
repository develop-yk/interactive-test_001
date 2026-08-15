/**
 * main.js — 全体の配線
 *   カメラ → Tracker(MediaPipe) → gestures(状態化) → UI(操作) / Viz(AR描画) / Shape3D(3D)
 */
import { Tracker } from './tracker.js';
import { Viz } from './viz.js';
import { Shape3D } from './shape3d.js';
import { HandState, FaceState, twoHandSpread, GESTURE_LABEL } from './gestures.js';
import { UI } from './ui.js';
import { TUNING } from './config.js';

const $ = s => document.querySelector(s);

const gate       = $('#gate');
const startBtn   = $('#startBtn');
const gateStatus = $('#gateStatus');
const stage      = $('#stage');

const hudL    = $('#hudGestureL');
const hudR    = $('#hudGestureR');
const hudFace = $('#hudFace');
const hudFps  = $('#hudFps');
const centerStatus = $('#centerStatus');
const curR    = $('#cursorR');
const curL    = $('#cursorL');

const ui  = new UI(document);
const viz = new Viz($('#overlay'), $('#video'));

// ワイヤーフレーム 3D。自前の rAF ループで回るので、カメラが止まっていても動く
const shape = new Shape3D($('#shapeCanvas'));
ui.shape = shape;
// マウスでも切り替えられるようにしておく（検証・登壇時のフォールバック）
ui.shapeTabs.forEach(t => t.addEventListener('click', () => ui._selectShape(t.dataset.shape)));

const left  = new HandState('Left');
const right = new HandState('Right');
const face  = new FaceState();

let tracker = null;
let lastOpenPalm = 0;
let primaryHand = null;   // 操作の主導権を持つ手

/* ---------------- 起動 ---------------- */

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  const setStatus = (m, err = false) => {
    gateStatus.textContent = m;
    gateStatus.classList.toggle('err', err);
  };

  try {
    if (!window.isSecureContext) {
      throw new Error('Camera access requires HTTPS or localhost (file:// will not work)');
    }
    tracker = new Tracker($('#video'));

    setStatus('Waiting for camera permission\u2026');
    await tracker.startCamera();

    await tracker.load(setStatus);
    tracker.onResults = onResults;
    tracker.start();

    viz.resize();
    stage.hidden = false;
    requestAnimationFrame(() => shape.resize());   // パネルが可視になってから実寸を取る
    gate.classList.add('hidden');
    setTimeout(() => gate.remove(), 600);

  } catch (e) {
    console.error(e);
    startBtn.disabled = false;
    const msg = e?.name === 'NotAllowedError'
      ? 'Camera access was denied. Allow it from the camera icon in the address bar.'
      : e?.name === 'NotFoundError'
        ? 'No camera device was found.'
        : (e?.message ?? String(e));
    setStatus(msg, true);
  }
});

/* ---------------- 毎フレーム ---------------- */

function onResults(handRes, faceRes) {
  const vw = window.innerWidth, vh = window.innerHeight;
  const t  = performance.now();

  let lLm = null, rLm = null;
  const lms = handRes?.landmarks ?? [];
  lms.forEach((lm, i) => {
    const name = handRes.handedness?.[i]?.[0]?.categoryName;
    if (name === 'Left') lLm = lm; else rLm = lm;
  });

  left.update(lLm, t, vw, vh);
  right.update(rLm, t, vw, vh);
  face.update(faceRes);

  // --- カメラスルーの画にランドマークを重ねる（UI より前面）---
  viz.render(handRes, faceRes, { left, right, face });

  // --- UI 操作 ---
  // 主導権は「ピンチしている手」を最優先。両手が映っていても、
  // 左手でつまめば左手で操作できる（右手固定だと片手が使えず操作を取りこぼす）。
  // ドラッグ中だけは途中で持ち手が入れ替わらないよう固定する。
  if (!ui.dragging || !primaryHand?.present) {
    primaryHand = right.pinching ? right
                : left.pinching  ? left
                : right.present  ? right
                : left.present   ? left
                : null;
  }
  const primary = primaryHand;
  ui.handleHand(right, primary === right);
  ui.handleHand(left,  primary === left);

  if (primary && primary.gesture === 'open' && t - lastOpenPalm > 1200) {
    lastOpenPalm = t;
    ui.handleReset();
  }

  ui.setZoom(twoHandSpread(left, right));
  ui.tick();
  ui.setFace(face);
  if (face.present) ui.setParallax(face.yaw, face.pitch, TUNING.yawGain);

  paintCursor(curR, right);
  paintCursor(curL, left);

  // --- HUD ---
  hudL.textContent = `Left ${GESTURE_LABEL[left.gesture]}`;
  hudR.textContent = `Right ${GESTURE_LABEL[right.gesture]}`;
  hudL.classList.toggle('hot', left.present);
  hudR.classList.toggle('hot', right.present);
  hudFace.textContent = face.present
    ? `Face ${face.smiling ? 'smiling' : face.mouthOpen ? 'mouth open' : 'tracked'} / yaw ${(face.yaw * 57.3).toFixed(0)}\u00b0`
    : 'Face \u2014';
  hudFace.classList.toggle('hot', face.present);
  hudFps.textContent = `${tracker.fps} fps`;

  const nHands = (left.present ? 1 : 0) + (right.present ? 1 : 0);
  const live = nHands > 0 || face.present;
  centerStatus.classList.toggle('live', live);
  centerStatus.textContent = live
    ? `Tracking ${nHands} hand${nHands === 1 ? '' : 's'} / ${face.present ? 1 : 0} face \u2014 ${nHands * 21 + (face.present ? 478 : 0)} landmarks`
    : 'Hold your hand up to the camera';
}

function paintCursor(el, h) {
  el.classList.toggle('on', h.present);
  el.classList.toggle('pinch', h.pinching);
  if (!h.present) return;
  el.style.transform = `translate(${h.x}px, ${h.y}px)`;
  const p = Math.max(0, Math.min(1, (h.pinchAmount - 0.2) / 0.6));
  const c = 2 * Math.PI * 19;
  const ring = el.querySelector('.ring');
  ring.style.strokeDasharray  = `${c}`;
  ring.style.strokeDashoffset = `${c * p}`;
}

// デバッグ用。DevTools から __lab.ui / __lab.right などを覗ける。
//   __lab.ui.handleHand({x:400,y:300,present:true,pinching:true,justPinched:true,
//                        justReleased:false,gesture:'pinch'}, true)
window.__lab = { get tracker() { return tracker; }, ui, viz, shape, left, right, face };
window.__gest = { HandState, FaceState };   // 単体検証から素の判定ロジックを触るため

// タブが裏に回ったら推論を止めて電池と発熱を節約
document.addEventListener('visibilitychange', () => {
  if (!tracker) return;
  document.hidden ? tracker.stop() : tracker.start();
});
