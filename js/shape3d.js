/**
 * shape3d.js — 依存ライブラリなしのワイヤーフレーム 3D レンダラー
 *
 *  three.js を入れるほどの規模ではないので、頂点配列 → 回転行列 → 透視投影 を自前で回す。
 *  ピンチドラッグで rotX / rotY を動かし、離した後は慣性で回り続け、
 *  止まったらゆっくり自動回転する（展示で放置されたときに動いていてほしいので）。
 */

const PHI = (1 + Math.sqrt(5)) / 2;

/* ---------- 立体の定義 ---------- */

/** 直方体（各辺の長さが異なる） */
function rectangularPrism() {
  const [a, b, c] = [1.15, 0.78, 0.62];
  const V = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    V.push([sx * a, sy * b, sz * c]);
  }
  // 3bit のインデックスなので、1bit だけ違う頂点同士が辺になる
  const E = [];
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const d = i ^ j;
    if (d === 1 || d === 2 || d === 4) E.push([i, j]);
  }
  return { V, E };
}

/** 正四面体 */
function triangularPyramid() {
  const k = 0.95;
  const V = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(v => v.map(x => x * k));
  const E = [];
  for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) E.push([i, j]);
  return { V, E };
}

/** 正十二面体（20頂点 / 30辺） */
function regularDodecahedron() {
  const i = 1 / PHI, p = PHI;
  const V = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) V.push([sx, sy, sz]);
  for (const sy of [-1, 1]) for (const sz of [-1, 1]) V.push([0, sy * i, sz * p]);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) V.push([sx * i, sy * p, 0]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) V.push([sx * p, 0, sz * i]);

  // 正多面体は「最短距離で結ばれた頂点対 = 辺」。辺長 2/φ を許容誤差つきで拾う
  const E = [];
  const target = 2 / PHI;
  for (let a = 0; a < V.length; a++) for (let b = a + 1; b < V.length; b++) {
    const d = Math.hypot(V[a][0] - V[b][0], V[a][1] - V[b][1], V[a][2] - V[b][2]);
    if (Math.abs(d - target) < 1e-6) E.push([a, b]);
  }
  const k = 0.72;
  return { V: V.map(v => v.map(x => x * k)), E };
}

export const SHAPES = {
  prism:   { label: 'Rectangular prism',   build: rectangularPrism },
  pyramid: { label: 'Triangular pyramid',  build: triangularPyramid },
  dodeca:  { label: 'Regular dodecahedron', build: regularDodecahedron },
};

/* ---------- レンダラー ---------- */

const CAM_DIST = 4.2;   // カメラまでの距離（オブジェクト単位）
const FOCAL    = 2.6;

export class Shape3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.dpr    = Math.min(window.devicePixelRatio || 1, 2);

    this.key   = 'prism';
    this.geo   = SHAPES.prism.build();
    this.scale = 1;
    this.spin  = 0.007;        // 放置時の自動回転量(rad/frame)。Spin speed スライダーが変える
    this.showVertices = true;  // 頂点の点を描くか。Vertices トグルが変える

    this.rotX = -0.32; this.rotY = 0.62;
    this.velX = 0;     this.velY = 0;
    this.dragging = false;

    this.resize();
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas.parentElement ?? canvas);

    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  setShape(key) {
    if (!SHAPES[key] || key === this.key) return false;
    this.key = key;
    this.geo = SHAPES[key].build();
    this._pop = 1;                       // 切り替え時の軽い演出
    return true;
  }

  /** Spin speed スライダー(0..1) → 自動回転量。0 で完全停止 */
  setSpin(v01) {
    this.spin = Math.max(0, Math.min(1, v01)) * 0.014;
  }

  /** Vertices トグル → 頂点の点を描くか */
  setVertices(on) { this.showVertices = !!on; }

  /** 両手ズーム(0.6〜2.4)を控えめなスケールに写す */
  setZoom(z) {
    if (z == null) return;
    this.scale = 0.62 + (Math.min(2.4, Math.max(0.6, z)) - 0.6) / 1.8 * 0.85;
  }

  /** カーソルの移動量(px)で回す。横移動=Y軸まわり、縦移動=X軸まわり */
  rotateBy(dx, dy) {
    const k = 0.009;
    this.rotY += dx * k;
    this.rotX += dy * k;
    this.velY = dx * k;
    this.velX = dy * k;
    // 真上／真下を越えて反転しないよう制限
    this.rotX = Math.max(-1.45, Math.min(1.45, this.rotX));
  }

  beginDrag() { this.dragging = true;  this.velX = this.velY = 0; }
  endDrag()   { this.dragging = false; }

  reset() {
    this.rotX = -0.32; this.rotY = 0.62;
    this.velX = this.velY = 0;
    this._pop = 1;
  }

  resize() {
    const host = this.canvas.parentElement ?? this.canvas;
    const w = Math.max(1, host.clientWidth);
    const h = Math.max(1, host.clientHeight);
    const cw = Math.round(w * this.dpr);
    const ch = Math.round(h * this.dpr);

    // canvas.width への代入は中身をクリアしてしまう。ResizeObserver は
    // 強制レイアウトのたびに同じサイズで再発火しうるので、変化時だけ書き換える。
    if (this.canvas.width === cw && this.canvas.height === ch) { this.w = w; this.h = h; return; }

    this.w = w; this.h = h;
    this.canvas.width  = cw;
    this.canvas.height = ch;
    this.canvas.style.width  = `${w}px`;
    this.canvas.style.height = `${h}px`;
  }

  _loop() {
    if (!this.dragging) {
      this.rotY += this.velY;
      this.rotX = Math.max(-1.45, Math.min(1.45, this.rotX + this.velX));
      this.velX *= 0.93; this.velY *= 0.93;
      if (Math.abs(this.velY) < 1e-4) this.velY = 0;
      if (Math.abs(this.velX) < 1e-4) this.velX = 0;
      if (!this.velX && !this.velY) this.rotY += this.spin;   // 放置時の自転
    }
    if (this._pop) this._pop = Math.max(0, this._pop - 0.06);
    this._draw();
    requestAnimationFrame(this._loop);
  }

  _draw() {
    const { ctx, w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2;
    // 縦長のパネルでは幅が効くので、幅基準でやや大きめに取る
    const unit = Math.min(w * 0.46, h * 0.42) * this.scale * (1 + (this._pop || 0) * 0.12);

    const cxr = Math.cos(this.rotX), sxr = Math.sin(this.rotX);
    const cyr = Math.cos(this.rotY), syr = Math.sin(this.rotY);

    // 頂点を回転 → 透視投影
    const P = this.geo.V.map(([x, y, z]) => {
      const x1 =  x * cyr + z * syr;
      const z1 = -x * syr + z * cyr;
      const y2 =  y * cxr - z1 * sxr;
      const z2 =  y * sxr + z1 * cxr;
      const zc = z2 + CAM_DIST;
      const k  = (FOCAL / zc) * unit;
      return { x: cx + x1 * k, y: cy - y2 * k, z: z2 };
    });

    // 奥の辺から描く（重なりが自然に見える）
    const edges = this.geo.E
      .map(([a, b]) => ({ a, b, mz: (P[a].z + P[b].z) / 2 }))
      .sort((p, q) => p.mz - q.mz);

    ctx.lineCap = 'round';
    for (const e of edges) {
      const t = Math.max(0, Math.min(1, (e.mz + 1.3) / 2.6));  // 手前ほど 1
      ctx.strokeStyle = `rgba(92,200,255,${(0.22 + t * 0.72).toFixed(3)})`;
      ctx.lineWidth = 1 + t * 1.5;
      ctx.shadowColor = 'rgba(92,200,255,0.7)';
      ctx.shadowBlur = t * 8;
      ctx.beginPath();
      ctx.moveTo(P[e.a].x, P[e.a].y);
      ctx.lineTo(P[e.b].x, P[e.b].y);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // 頂点
    if (this.showVertices) {
      for (const p of P) {
        const t = Math.max(0, Math.min(1, (p.z + 1.3) / 2.6));
        ctx.fillStyle = `rgba(255,255,255,${(0.25 + t * 0.7).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 1.3 + t * 1.7, 0, 6.284);
        ctx.fill();
      }
    }
  }

  /** 現在の姿勢（度） */
  angles() {
    return { x: Math.round(this.rotX * 57.3), y: Math.round((this.rotY * 57.3) % 360) };
  }
}
