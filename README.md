# Gesture UI Demo — MediaPipe × Claude

ノートPCの Web カメラだけで、**手のジェスチャーと表情で Web UI を操作する**リアルタイム体験のプロトタイプです。
カメラスルーの画を全画面に敷き、**センシング結果（ランドマーク）と UI を同じ画面に重ねて**表示します。
推論はすべてブラウザ内（WebAssembly + WebGL）で完結し、**映像は一切サーバーに送信されません**。

API キー不要。GitHub Pages に置くだけで動きます。

> **Claude 連携について**: 画面から Commentary パネルを外したため、AI 実況は現在オフです。
> 実装（`js/ai-bridge.js` と `server/`）はリポジトリに残してあるので、
> 表示先の DOM を用意して `main.js` で `AIBridge` を再度 new すれば復帰できます。手順は後述。

---

## 何ができるか

| 入力 | 動作 | 画面表記 |
|---|---|---|
| 人差し指 | カーソル移動 | Point |
| ピンチ（親指＋人差し指） | クリック／スライダーのドラッグ | Pinch |
| **3D オブジェクト上でピンチして動かす** | **ワイヤーフレームを上下左右に回転** | Pinch |
| パー（手を開く） | 3D オブジェクトの姿勢をリセット | Open |
| 両手の間隔 | 3D オブジェクトのスケール | Zoom (2 hands) |
| 笑顔 | 「いいね」を送る（52 ブレンドシェイプから判定） | Smile |
| 首の向き | 背景のパララックス | — |

**画面上の表記はすべて英語**です（このドキュメントとソースコード中のコメントのみ日本語）。
絵文字・アイコンは一切使っていません。パネルの位置は固定で、掴んで動かす操作はありません。
3D オブジェクトの回転だけがピンチドラッグの対象です。
Claude コメンタリーの応答も英語で返るよう、プロキシ側のシステムプロンプトを設定してあります。

---

## 画面構成

カメラの画を全画面に鏡像で敷き、その上に UI、さらにその上にランドマークを重ねています。
**ランドマークは UI パネルより前面**に描くので、パネルに手をかざしても「認識できている」ことが常に見えます。

```
z=4  ランドマーク AR オーバーレイ  ← canvas（全画面・pointer-events:none）
z=3  UI パネル                     ← 半透明ガラス。左右に寄せて中央に自分が映る
z=2  暗幕                          ← UI を読みやすくする
z=1  カメラスルー                  ← video（object-fit:cover + scaleX(-1)）
z=0  装飾グリッド
```

パネル配置:

| | 内容 |
|---|---|
| 左カラム 上 | Pinch and Drag（スライダー / トグル / Zoom） |
| 左カラム 下 | Facial Expression |
| 右カラム | **Wireframe Object（3D）— 上から下まで 1 枚** |
| 中央 | 空けてある（自分が映る） |

オーバーレイは常に全部盛り（詳細表示のみ）です。切替 UI は置いていません。

| | 表示内容 |
|---|---|
| 手 | 骨格線、関節点、ピンチ線、21点の番号、bbox、`RIGHT 0.97 · pinch · gap 0.21` |
| 顔 | メッシュ（tesselation）、輪郭・目・眉・唇、虹彩、`FACE yaw 12° pitch -5° roll 2°`、表情スコア |

---

## 技術構成

```
index.html
├─ js/config.js      設定（MediaPipe のバージョン、しきい値、AI エンドポイント）
├─ js/tracker.js     カメラ起動 ＋ MediaPipe 推論ループ（描画は持たない）
├─ js/gestures.js    ランドマーク → ジェスチャー状態（純粋ロジック / DOM 非依存）
├─ js/viz.js         全画面 AR オーバーレイ描画
├─ js/shape3d.js     ワイヤーフレーム 3D レンダラー（依存ライブラリなし）
├─ js/ui.js          カーソルとピンチで駆動する UI ウィジェット
├─ js/ai-bridge.js   Claude 連携レイヤー（未接続ならローカル応答にフォールバック）
└─ js/main.js        全体の配線
server/
├─ worker.js         Cloudflare Workers 用プロキシ（本番向け・推奨）
└─ local-proxy.mjs   Node 単体のローカル検証用プロキシ
```

### 座標マッピングについて（`js/viz.js`）

video は CSS の `object-fit:cover` で全画面に敷いているので、**映像の一部は画面外にはみ出しています**。
MediaPipe が返す正規化ランドマーク(0..1)をそのまま canvas 幅にかけると位置がズレます。
`_fit()` で cover と同じ矩形を計算し直し、`_mk()` で鏡像反転も含めてマッピングしています。

```js
const s  = Math.max(screenW / videoW, screenH / videoH);   // cover
const dw = videoW * s, dh = videoH * s;
const ox = (screenW - dw) / 2, oy = (screenH - dh) / 2;
screenX = ox + (1 - lm.x) * dw;   // ← 鏡像なので x を反転
screenY = oy + lm.y * dh;
```

この計算は「画面上で実際に映像が描かれた位置」と突き合わせて誤差 0px を確認済みです。
MediaPipe 付属の `DrawingUtils` は canvas 全体に等倍で描く前提なので、ここでは使わず自前で描いています
（そのぶん番号ラベルや bbox を自由に足せます）。描画コストは実測で 0.9ms 前後 per frame です。

使用モデル（いずれも Google 公式ホスティング、初回のみ約 11MB ダウンロード）:

- `hand_landmarker.task` — 21点 × 最大2手
- `face_landmarker.task` — 478点 ＋ 52 ブレンドシェイプ ＋ 4×4 頭部姿勢行列

ライブラリは `@mediapipe/tasks-vision@1.0.1` を jsDelivr から ESM で読み込みます。
バージョンは **固定** しています（`@latest` は破壊的変更を拾うことがあるため）。
上げるときは `js/config.js` の `MP_VERSION` と `js/tracker.js` の `import` 文の**両方**を揃えてください。

### ワイヤーフレーム 3D（`js/shape3d.js`）

three.js は使わず、頂点配列 → 回転行列 → 透視投影 を自前で回しています（追加の依存ゼロ）。

| 立体 | 頂点 | 辺 | 面 |
|---|---|---|---|
| Rectangular prism | 8 | 12 | 6 |
| Triangular pyramid | 4 | 6 | 4 |
| Regular dodecahedron | 20 | 30 | 12 |

正十二面体の頂点は `(±1,±1,±1)` と `(0,±1/φ,±φ)` の巡回で作り、
**辺は「頂点間距離がちょうど 2/φ の対」を拾って自動生成**しています（手打ちの 30 行より安全）。
3 立体すべてオイラーの多面体定理 `V − E + F = 2` を満たすことをテストで確認済みです。

- 奥の辺から順に描き、深度に応じて線の濃さ・太さ・グローを変えて立体感を出しています
- ピンチを離した後は慣性で回り続け、止まるとゆっくり自転します（展示で放置されたとき用）
- 上下の回転は ±83° でクランプ（真上を越えて反転しないように）
- 両手ズームは 3D のスケールに反映されます

> **落とし穴**: `canvas.width` への代入は中身をクリアします。ResizeObserver は
> 強制レイアウトのたびに同じサイズで再発火しうるので、`resize()` は
> 寸法が変わったときだけ書き換えるようガードしています。これを入れないと
> レイアウト計算のタイミングで 3D が一瞬消えます。

---

## ローカルで動かす

`file://` では動きません（カメラ API はセキュアコンテキスト必須）。簡易サーバーを立ててください。

```bash
cd interactive-test_001
python3 -m http.server 8000
# → http://localhost:8000/ を Chrome で開く（localhost はセキュアコンテキスト扱い）
```

---

## GitHub Pages に公開する

このリポジトリには `.github/workflows/pages.yml` が入っているので、
**リポジトリ設定を一度だけ変えれば** `main` への push で自動デプロイされます。

1. GitHub → リポジトリ → **Settings** → **Pages**
2. **Build and deployment › Source** を **GitHub Actions** に変更
3. `main` に push（下記）
4. 数十秒後 → `https://develop-yk.github.io/interactive-test_001/`

```bash
git add -A
git commit -m "Update gesture UI demo"
git push origin main
```

Pages は HTTPS で配信されるので、カメラ許可のダイアログがそのまま出ます。

> Actions を使わず「Deploy from a branch → main / (root)」でも動きます。
> その場合 Jekyll に `.github` などを無視されないよう、同梱の `.nojekyll` をそのまま残してください。

---

## Step 2: Claude API を繋ぐ

### なぜプロキシが要るのか

- `api.anthropic.com` はブラウザからの直接呼び出しに **CORS を許可していません**
- GitHub Pages は静的配信なので、フロントに API キーを書くと**閲覧者全員に見えます**

そのため `ブラウザ → 自前プロキシ → Claude API` という構成にします。キーはプロキシ側にだけ置きます。

### Cloudflare Workers（推奨・無料枠で足ります）

```bash
npm i -g wrangler
wrangler login
cd server
wrangler deploy
wrangler secret put ANTHROPIC_API_KEY     # sk-ant-... を貼る
wrangler secret put ALLOWED_ORIGIN        # https://develop-yk.github.io
```

デプロイ後に表示される URL を `js/config.js` に設定します。

```js
export const AI_ENDPOINT = 'https://gesture-ui-demo-proxy.<your-subdomain>.workers.dev';
```

### 画面に戻すには

1. `index.html` の右カラムにログ用の DOM を追加する

```html
<div class="panel panel-ai">
  <h2 class="panel-title">Commentary</h2>
  <div class="ai-mode" id="aiMode">Local mode (API not connected)</div>
  <div class="ai-log" id="aiLog"></div>
  <button class="btn-ghost" id="aiAskBtn" data-clickable>Ask what I just did</button>
</div>
```

2. 右カラムの `col-solo` クラスを外す（2 枚並びに戻す）
3. `js/main.js` で `AIBridge` を import して `new AIBridge($('#aiLog'), $('#aiMode'))`、
   `ui.onEvent` を `ai.push` / `ai.ask` に繋ぐ
4. `css/style.css` に `.ai-log` / `.ai-msg` / `.ai-mode` / `.btn-ghost` のスタイルを戻す
   （削除前の版は git 履歴にあります）

### ローカルで試す場合

```bash
ANTHROPIC_API_KEY=sk-ant-... node server/local-proxy.mjs
# js/config.js → AI_ENDPOINT = 'http://localhost:8787/api/comment'
```

モデルは低レイテンシ重視で `claude-haiku-4-5-20251001` を既定にしています。
より凝った実況にしたい場合は `server/worker.js` の `MODEL` を `claude-sonnet-5` に変えてください。

### プロキシが受け取る JSON

```jsonc
{
  "events":  [{ "type": "select", "target": "Regular dodecahedron", "t": 12345 },
              { "type": "rotate", "target": "dodeca", "t": 13980 }],
  "ui":      { "shape": "dodeca", "rotation": { "x": -18, "y": 143 },
               "intensity": 0.8, "wireframe": true, "zoom": 1.4, "likes": 3 },
  "history": [{ "role": "assistant", "content": "..." }]
}
```

返すのは `{ "text": "..." }` だけです。ここを差し替えれば、実況以外（音声合成、シーン生成、
スコア判定など）にも転用できます。

---

## 調整ポイント

`js/config.js` の `TUNING` を触ると挙動が変わります。

| キー | 意味 | 上げると |
|---|---|---|
| `pinchOn` / `pinchOff` | ピンチ判定のしきい値（手のサイズで正規化済み） | 軽い指の閉じでも反応する |
| `smoothMinCut` / `smoothBeta` | One Euro フィルタ | 大きいほど追従が速く、ジッタは増える |
| `smileOn` / `browOn` / `jawOn` | 表情の発火しきい値 | 誤爆が減る（反応は鈍る） |
| `yawGain` | 首の向き → 背景視差の量(px) | 動きが派手になる |

カメラ映像の明るさと暗幕は `css/style.css` 冒頭の CSS 変数 `--cam-opacity` / `--scrim` です
（既定は標準の `.55` / `.42`）。会場の照明に合わせるならここを触ってください。
ランドマークの色や線の太さは `js/viz.js` の `C` にまとめてあります。

カーソルの可動域は `js/gestures.js` の `EXP`（既定 1.9）です。
腕を大きく動かさずに画面端へ届かせるため、カメラ中央付近を画面全体に拡大しています。

---

## 動作環境と注意点

- **Chrome / Edge（デスクトップ）推奨。** WebGL バックエンドが最も安定します
- GPU デリゲートに失敗した場合は自動で CPU にフォールバックします（フレームレートは落ちます）
- 初回はモデルのダウンロードで数秒〜十数秒かかります
- 逆光や暗所では検出が不安定になります。顔・手に光が当たる環境で試してください
- タブが非アクティブになると推論を止めます（発熱・電池対策）

## デバッグ

DevTools のコンソールから内部状態を覗けます。

```js
__lab.right.gesture        // 右手の現在のジェスチャー
__lab.face.bs              // ブレンドシェイプ値（52個）
__lab.tracker.fps
__lab.shape.setShape('dodeca')   // 3D の立体を切り替え
__lab.shape.rotateBy(60, 20)     // 手を使わずに回す

// 手を映さずに UI だけ試す
__lab.ui.handleHand({ x: 400, y: 300, present: true, pinching: true,
                      justPinched: true, justReleased: false, gesture: 'pinch' }, true)
```

---

## 参考

- [Hand landmarks detection guide for Web — Google AI Edge](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
- [Face landmark detection guide for Web — Google AI Edge](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/web_js)
- [@mediapipe/tasks-vision — npm](https://www.npmjs.com/package/@mediapipe/tasks-vision)
- [Claude Models overview](https://platform.claude.com/docs/en/about-claude/models/overview)
