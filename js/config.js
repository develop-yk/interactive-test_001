/**
 * 設定ファイル
 * ------------------------------------------------------------------
 * ここだけ書き換えれば「API なしのローカル動作」→「Claude API 連携」に切り替わります。
 */

/* MediaPipe Tasks Vision（バージョンは固定推奨。@latest は破壊的変更を拾うことがある） */
export const MP_VERSION = '1.0.1';
export const MP_CDN     = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
export const MP_WASM    = `${MP_CDN}/wasm`;

export const MODEL_HAND = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
export const MODEL_FACE = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

/* GPU が使えない環境では自動で 'CPU' にフォールバックします */
export const DELEGATE = 'GPU';

/**
 * Claude API プロキシのエンドポイント。
 * 空文字 = ローカル応答モード（API キー不要でそのまま動く）。
 *
 * Step 2 に進むときは server/ 配下のプロキシをデプロイし、その URL をここに書きます。
 *   例: 'https://gesture-ui-lab.<your-subdomain>.workers.dev/api/comment'
 *
 * ⚠️ ブラウザから api.anthropic.com を直接叩かないこと。
 *    API キーがフロントに出てしまい、CORS でも弾かれます。必ずプロキシ経由で。
 */
export const AI_ENDPOINT = '';

/* AI に投げる最短間隔（ms）。連打防止＆コスト対策 */
export const AI_MIN_INTERVAL = 8000;

/* ジェスチャー判定のしきい値 */
export const TUNING = {
  pinchOn      : 0.34,  // 手のサイズで正規化した 親指-人差指 距離（この値未満でピンチ開始）
  pinchOff     : 0.46,  // ヒステリシス（この値を超えたらピンチ解除）
  smoothMinCut : 1.2,   // One Euro フィルタ
  smoothBeta   : 0.035,
  smileOn      : 0.42,  // mouthSmile 平均がこの値を超えたら「笑顔」
  browOn       : 0.45,
  jawOn        : 0.35,
  yawGain      : 26,    // 首の向き → 背景視差の強さ(px)
};
