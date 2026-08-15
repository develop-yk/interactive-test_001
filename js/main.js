/**
 * main.js — 全体の配線
 *   カメラ → Tracker(MediaPipe) → gestures(状態化) → UI(操作) / Viz(AR描画) / AIBridge(解説)
 */
import { Tracker } from './tracker.js';
import { Viz } from './viz.js';
import { HandState, FaceState, twoHandSpread, GESTURE_JP } from './gestures.js';
import { UI } from './ui.js';
import { AIBridge } from './ai-bridge.js';
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
const vizBtn  = $('#vizBtn');
const camBtn  = $('#camBtn');
const centerStatus = $('#centerStatus');
const curR    = $('#cursorR');
const curL    = $('#cursorL');

const ui  = new UI(document);
const ai  = new AIBridge($('#aiLog'), $('#aiMode'));
const viz = new Viz($('#overlay'), $('#video'));

ui.onEvent = ev => {
  if (ev.type === 'ask') ai.ask(ui.snapshot());
  else ai.push(ev);
};

const left  = new HandState('Left');
const right = new HandState('Right');
const face  = new FaceState();

let tracker = null;
let lastOpenPalm = 0;

/* ---------------- 表示モードの切り替え ---------------- */

const VIZ_LABEL = { simple: '可視化: シンプル', detailed: '可視化: 詳細' };
function cycleViz() {
  const m = viz.toggleMode();
  vizBtn.textContent = VIZ_LABEL[m];
  ui.toast(m === 'detailed'
    ? '詳細モード：顔メッシュ・番号・信頼度・bbox を表示'
    : 'シンプルモード：骨格と輪郭のみ');
}

// カメラ映像の明るさ 3 段階（UI の可読性と「映っている感」のバランス調整用）
const CAM_LEVELS = [
  { name: '標準', cam: .55, scrim: .42 },
  { name: '明るく', cam: .85, scrim: .22 },
  { name: '暗く', cam: .22, scrim: .60 },
];
let camLevel = 0;
function cycleCam() {
  camLevel = (camLevel + 1) % CAM_LEVELS.length;
  const l = CAM_LEVELS[camLevel];
  document.documentElement.style.setProperty('--cam-opacity', l.cam);
  document.documentElement.style.setProperty('--scrim', l.scrim);
  camBtn.textContent = `映像: ${l.name}`;
}

// マウス / キーボード / ジェスチャーのどれでも切り替えられるようにしておく
vizBtn.addEventListener('click', cycleViz);
camBtn.addEventListener('click', cycleCam);
ui.actions.viz = cycleViz;
ui.actions.cam = cycleCam;
addEventListener('keydown', e => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'v') cycleViz();
  if (k === 'c') cycleCam();
});

/* ---------------- 起動 ---------------- */

startBtn.addEventListener('click', async () => {
  startBtn.disabled = true;
  const setStatus = (m, err = false) => {
    gateStatus.textContent = m;
    gateStatus.classList.toggle('err', err);
  };

  try {
    if (!window.isSecureContext) {
      throw new Error('HTTPS または localhost でないとカメラを使えません（file:// では動きません）');
    }
    tracker = new Tracker($('#video'));

    setStatus('カメラの許可を待っています…');
    await tracker.startCamera();

    await tracker.load(setStatus);
    tracker.onResults = onResults;
    tracker.start();

    viz.resize();
    stage.hidden = false;
    gate.classList.add('hidden');
    setTimeout(() => gate.remove(), 600);

    setInterval(() => ai.ask(ui.snapshot(), { auto: true }), 12000);

  } catch (e) {
    console.error(e);
    startBtn.disabled = false;
    const msg = e?.name === 'NotAllowedError'
      ? 'カメラの利用が拒否されました。ブラウザのアドレスバーのカメラアイコンから許可してください。'
      : e?.name === 'NotFoundError'
        ? '利用できるカメラが見つかりませんでした。'
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

  // --- UI 操作。主導権は右手 → 無ければ左手 ---
  const primary = right.present ? right : (left.present ? left : null);
  ui.handleHand(right, primary === right);
  ui.handleHand(left,  primary === left);

  if (primary && primary.gesture === 'open' && t - lastOpenPalm > 1200) {
    lastOpenPalm = t;
    ui.handleReset();
  }

  ui.setZoom(twoHandSpread(left, right));
  ui.setFace(face);
  if (face.present) ui.setParallax(face.yaw, face.pitch, TUNING.yawGain);

  paintCursor(curR, right);
  paintCursor(curL, left);

  // --- HUD ---
  hudL.textContent = `左手 ${GESTURE_JP[left.gesture]}`;
  hudR.textContent = `右手 ${GESTURE_JP[right.gesture]}`;
  hudL.classList.toggle('hot', left.present);
  hudR.classList.toggle('hot', right.present);
  hudFace.textContent = face.present
    ? `顔 ${face.smiling ? '🙂 笑顔' : face.mouthOpen ? '😮 口開' : '検出中'} / yaw ${(face.yaw * 57.3).toFixed(0)}°`
    : '顔 —';
  hudFace.classList.toggle('hot', face.present);
  hudFps.textContent = `${tracker.fps} fps`;

  const nHands = (left.present ? 1 : 0) + (right.present ? 1 : 0);
  const live = nHands > 0 || face.present;
  centerStatus.classList.toggle('live', live);
  centerStatus.textContent = live
    ? `検出中: 手 ${nHands} / 顔 ${face.present ? 1 : 0} — ランドマーク ${nHands * 21 + (face.present ? 478 : 0)} 点`
    : 'カメラの前で手をかざしてください';
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
//   __lab.viz.setMode('detailed')
//   __lab.ui.handleHand({x:400,y:300,present:true,pinching:true,justPinched:true,
//                        justReleased:false,gesture:'pinch'}, true)
window.__lab = { get tracker() { return tracker; }, ui, ai, viz, left, right, face };

// タブが裏に回ったら推論を止めて電池と発熱を節約
document.addEventListener('visibilitychange', () => {
  if (!tracker) return;
  document.hidden ? tracker.stop() : tracker.start();
});
