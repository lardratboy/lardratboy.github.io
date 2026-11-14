/* ================== THE CHAPTERS =======================================
   Each chapter is { key, title, dur, steps, cam(t), env(t)?, draw(c) }:
   - cam(t) gives the camera at the chapter's own time t (seconds), as
     { target, yaw, pitch, dist } or with an `eye` that overrides the orbit;
   - steps are the caption's paragraphs, each from its start time;
   - draw(c) fills the frame: c.F is the renderer's frame builder (cubes,
     batches, faces, lines), c.g the 2D overlay, c.t the time.
   Everything is a function of t, so scrubbing and stepping back are exact.

   The data is data.js's: the town (D = 5), its tree and DAG, the four
   lods' records, the world (D = 11) and its cut and jobs. Coordinates: a
   town voxel (x, y, z) sits at (x + ½ − 16, y + ½, z + ½ − 16), so the
   town stands centred on the floor grid.
   ======================================================================== */
import { M4 } from './gl.js';
import { applyG, INV } from '../dag-core.js';
import { attrRGB } from '../attr-core.js';
import { hexOf, Y_TURNS, TOWN_D } from './data.js';
import { text, panel, pill, label3, screenOf, bits, table, fmt, rgb01, measure, css,
         INK, DIM, FAINT, ACCENT, PINK, GOLD, GREEN, RED, VIOLET, LEVEL, LOD } from './ui.js';

/* ---- easing and time ------------------------------------------------------ */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const win = (t, a, b) => clamp((t - a) / (b - a));
const sm = x => x * x * (3 - 2 * x);
const eo = x => 1 - (1 - x) ** 3;
const eio = x => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
const back = x => { const c = 1.7; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2; };
const lerp = (a, b, u) => a + (b - a) * u;
const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const fade = (t, a, b, c, d) => Math.min(win(t, a, b), 1 - win(t, c, d));
function hash(i, s = 0){
  let h = Math.imul(i ^ 0x9e3779b9 ^ Math.imul(s, 0x85ebca6b), 0x27d4eb2d);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}
function hsv(h, s, v){
  const f = n => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
// Smoothly through camera keys [[t, cam], ...].
function camKeys(t, keys){
  if (t <= keys[0][0]) return { ...keys[0][1] };
  for (let i = 0; i < keys.length - 1; i++){
    const [t0, a] = keys[i], [t1, b] = keys[i + 1];
    if (t < t1){
      const u = eio((t - t0) / (t1 - t0));
      return { target: lerp3(a.target, b.target, u), yaw: lerp(a.yaw, b.yaw, u), pitch: lerp(a.pitch, b.pitch, u),
               dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), u)), fov: lerp(a.fov ?? 0.75, b.fov ?? 0.75, u) };
    }
  }
  return { ...keys[keys.length - 1][1] };
}
const C3 = hex => rgb01(hex);
const attrCol = w => { const [r, g, b] = attrRGB(w); return [r / 63, g / 63, b / 63]; };

/* ---- what every chapter shares ------------------------------------------------ */
export function prepare(R, D){
  const P = { R, D };
  const T = D.town, R32 = 32;
  const blockAt = new Map(T.blocks.map((b, i) => [b.bx + ',' + b.by + ',' + b.bz, i]));
  // Every voxel of the town.
  P.vox = [];
  for (let z = 0; z < R32; z++) for (let y = 0; y < R32; y++) for (let x = 0; x < R32; x++){
    const i = x + R32 * (y + R32 * z);
    if (!T.occ[i]) continue;
    P.vox.push({ x, y, z, w: [x + 0.5 - 16, y + 0.5, z + 0.5 - 16], c: hexOf(T.col[i]), h: hash(i, 1),
                 b: blockAt.get((x >> 3) + ',' + (y >> 3) + ',' + (z >> 3)) });
  }
  const inst = list => {
    const a = new Float32Array(list.length * 11);
    list.forEach((q, i) => a.set([q.p[0], q.p[1], q.p[2], q.s, q.s, q.s, q.c[0], q.c[1], q.c[2], 1, q.glow || 0], i * 11));
    return a;
  };
  // The town at each lod: its records, centred.
  P.lodCells = D.townJobs.map(j => j.recs.map((q, i) => {
    const s = j.cellSize;
    return { p: [(q.x + 0.5) * s - 16, (q.y + 0.5) * s, (q.z + 0.5) * s - 16], s, c: attrCol(q.attr), h: hash(i, 7 + j.lod), q };
  }));
  P.townBatch = P.lodCells.map(cells => R.makeBatch(inst(cells)));
  // Town-centred copies for turning (the world chapter): x and z about 0.
  P.townCentred = P.townBatch;

  // The four houses facing four ways, each as a batch about its block's
  // centre (the first block of each facing in layout order).
  P.lifted = [0, 1, 2, 3].map(f => {
    const bi = T.blocks.findIndex(b => b.kind === 'house' && b.face === f);
    const b = T.blocks[bi], db = D.blocks[bi];
    const cx = b.bx * 8 + 4, cz = b.bz * 8 + 4;
    const cells = P.vox.filter(v => v.b === bi).map(v => ({ p: [v.x + 0.5 - cx, v.y + 0.5, v.z + 0.5 - cz], s: 1, c: v.c }));
    return { f, bi, id: db.id, cls: db.cls, pose: db.pose, home: [cx - 16, 0, cz - 16], batch: R.makeBatch(inst(cells)) };
  });
  const liftedSet = new Set(P.lifted.map(l => l.bi));
  P.townMinusLifted = R.makeBatch(inst(P.vox.filter(v => !liftedSet.has(v.b)).map(v => ({ p: v.w, s: 1, c: v.c }))));
  // The canonical house under all 48 elements of Oh, about its centre.
  const h0 = P.lifted[0];
  const canon = P.vox.filter(v => v.b === h0.bi).map(v => ({ q: [v.x - (h0.home[0] + 16) + 0.5, v.y + 0.5 - 4, v.z - (h0.home[2] + 16) + 0.5], c: v.c }));
  P.oh = Array.from({ length: 48 }, (_, e) => {
    const cells = canon.map(v => { const p = applyG(v.q, e); return { p: [p[0], p[1] + 4, p[2]], s: 1, c: v.c }; });
    const perm = e >> 3, sgn = e & 7, odd = [1, 2, 5].includes(perm), flips = (sgn & 1) + (sgn >> 1 & 1) + (sgn >> 2 & 1);
    return { e, mirror: (odd ? 1 : 0) ^ (flips & 1), batch: R.makeBatch(inst(cells)) };
  });

  // The tree and the DAG, laid out (the tree and hash-consing chapters).
  const tr = D.tree;
  const Y = { 5: 66, 4: 52, 3: 38, 2: 23, 1: 6 }, RT = { 5: 0, 4: 8, 3: 18, 2: 34, 1: 62 }, RD = { 5: 0, 4: 6, 3: 10, 2: 19, 1: 25 };
  P.treeY = Y; P.treeR = RT; P.dagR = RD;
  P.nodes = tr.nodes.map(n => {
    const k = n.level, s = 2 ** k;
    const centre = [n.x * s + s / 2 - 16, n.y * s + s / 2, n.z * s + s / 2 - 16];
    const th = 2 * Math.PI * (n.order + 0.5) / tr.count[k] + 0.3 * k;
    const td = 2 * Math.PI * (n.slot + 0.5) / tr.uniq[k] + 0.3 * k;
    const slotCol = hsv((n.slot * 0.618034 + k * 0.17) % 1, 0.62, 1.0);
    return { ...n, centre, size: s, tree: [RT[k] * Math.cos(th), Y[k], RT[k] * Math.sin(th)],
             dag: [RD[k] * Math.cos(td), Y[k], RD[k] * Math.sin(td)], lc: C3(LEVEL[k]), sc: slotCol, h: hash(n.order, k) };
  });
  // A voxel's parent box, for the octree chapter's last split.
  P.vox.forEach(v => { v.pc = [(v.x >> 1) * 2 + 1 - 16, (v.y >> 1) * 2 + 1, (v.z >> 1) * 2 + 1 - 16]; });

  // The key of the house's node, for the hash-consing chapter.
  P.houseKey = Array.from({ length: 8 }, (_, o) => D.store.child(h0.id, o));

  // World chapters: face batches by job stamp, made on first use.
  P.faceBatches = new Map();
  P.facesOf = job => {
    let b = P.faceBatches.get(job.key);
    if (!b){ b = R.makeFaceBatch(job.words, job.cols); P.faceBatches.set(job.key, b); }
    return b;
  };
  const [fx, fz] = D.focus;
  P.woff = [-(fx * 32 + 16), 0, -(fz * 32 + 16)];     // world voxels -> scene
  P.focus = [fx, fz];

  // The stream chapter's schedule: 28 jobs over four workers.
  const jobs = [], free = [0, 0, 0, 0];
  const lods = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];
  for (let i = 0; i < 30; i++){
    const spawn = 1.0 + i * 0.42;
    let w = 0; for (let k = 1; k < 4; k++) if (free[k] < free[w]) w = k;
    const start = Math.max(spawn + 0.7, free[w]), work = 0.8 + hash(i, 3) * 0.9;
    free[w] = start + work;
    jobs.push({ i, lod: lods[i % 12], spawn, w, start, done: start + work, land: start + work + 0.7, slot: i % 24 });
  }
  P.streamJobs = jobs;

  // The colour chapters: the pyramid's lods, the skin in rank order, its
  // words' colours, and the block sums' running means (one a row boundary).
  const Cc = D.colour;
  P.pyrBatch = Cc.pyramid.map(p => R.makeBatch(inst(p.recs.map(q => {
    const s = p.cellSize;
    return { p: [(q.x + 0.5) * s - 16, (q.y + 0.5) * s, (q.z + 0.5) * s - 16], s, c: attrCol(q.attr) };
  }))));
  P.skinCells = Cc.skin.map(([x, y, z]) => ({ p: [x + 0.5 - 16, y + 0.5, z + 0.5 - 16], c: hexOf(T.col[x + 32 * (y + 32 * z)]) }));
  P.wordCol = Array.from(Cc.words, hexOf);
  P.prefix = [];
  for (let k = 0, acc = [0, 0, 0]; k <= Math.floor(Cc.words.length / 64); k++){
    P.prefix.push(k ? acc.map(v => v / (64 * k) / 255) : [0, 0, 0]);
    for (let i = 64 * k; i < Math.min(64 * k + 64, Cc.words.length); i++){ const w = Cc.words[i]; acc[0] += w & 255; acc[1] += w >> 8 & 255; acc[2] += w >> 16 & 255; }
  }

  // The ray chapter: an eye, an image plane, and every ray's march.
  P.rays = buildRays(T, D);
  return P;
}

/* ---- rays (the ray chapter) -------------------------------------------------
   A two-level march, as the ray pass's: through the 4³ grid of 8³ bricks,
   and inside an occupied brick through its cells, to the first full one.
   On the CPU and in voxel units; the page's tracer is ray-core's traceCPU,
   this one only has to make a picture of the same idea. */
function dda(o, d, lo, hi, cell, cb){
  // Cells of side `cell` in [lo, hi)³ along o + t·d, from where the ray enters.
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++){
    if (Math.abs(d[a]) < 1e-12){ if (o[a] < lo[a] || o[a] >= hi[a]) return; continue; }
    let ta = (lo[a] - o[a]) / d[a], tb = (hi[a] - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (t0 >= t1) return;
  const p = [0, 1, 2].map(a => o[a] + d[a] * (t0 + 1e-7));
  const c = [0, 1, 2].map(a => Math.min(Math.floor((p[a] - lo[a]) / cell), (hi[a] - lo[a]) / cell - 1));
  const step = d.map(v => v > 0 ? 1 : -1), n = (hi[0] - lo[0]) / cell;
  const next = [0, 1, 2].map(a => d[a] === 0 ? Infinity : (lo[a] + (c[a] + (d[a] > 0 ? 1 : 0)) * cell - o[a]) / d[a]);
  const dt = d.map(v => v === 0 ? Infinity : cell / Math.abs(v));
  let t = t0;
  for (let guard = 0; guard < 200; guard++){
    const a = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : (next[1] < next[2] ? 1 : 2);
    const tOut = Math.min(next[a], t1);
    if (cb(c.slice(), t, tOut)) return true;
    t = next[a]; c[a] += step[a]; next[a] += dt[a];
    if (c[a] < 0 || c[a] >= n || t >= t1) return;
  }
}
function buildRays(T, D){
  const occ = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < 32 && y < 32 && z < 32 && T.occ[x + 32 * (y + 32 * z)];
  const brickIds = new Map();
  D.blocks.forEach(b => brickIds.set(b.bx + ',' + b.by + ',' + b.bz, b.id));
  const uniq = [...new Set(D.blocks.map(b => b.id))];
  const eye = [8, 44, 74];                  // voxel units (scene + 16 on x, z)
  const W = 40, H = 25, ps = 0.85, planeZ = 56;
  const look = [16, 9, 16];
  const k = (eye[2] - planeZ) / (eye[2] - look[2]);
  const pc = [eye[0] + (look[0] - eye[0]) * k, eye[1] + (look[1] - eye[1]) * k, planeZ];
  const march = (px, py) => {
    const P = [pc[0] + (px - (W - 1) / 2) * ps, pc[1] - (py - (H - 1) / 2) * ps, planeZ];
    const d = [P[0] - eye[0], P[1] - eye[1], P[2] - eye[2]], L = Math.hypot(...d);
    for (let a = 0; a < 3; a++) d[a] /= L;
    const steps = [];
    let hit = null;
    dda(eye, d, [0, 0, 0], [32, 32, 32], 8, (b, tIn, tOut) => {
      const id = brickIds.get(b.join(','));
      steps.push({ kind: 'brick', c: b, t: tIn, id });
      if (id === undefined) return false;
      const lo = b.map(v => v * 8), hi = lo.map(v => v + 8);
      return dda(eye, d, lo, hi, 1, (v, t2) => {
        steps.push({ kind: 'cell', c: v, t: t2 });
        if (occ(v[0], v[1], v[2])){ hit = { c: v, t: t2 }; return true; }
        return false;
      });
    });
    return { P, d, steps, hit, col: hit ? hexOf(T.col[hit.c[0] + 32 * (hit.c[1] + 32 * hit.c[2])]) : null, tEnd: hit ? hit.t : 120 };
  };
  const all = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) all.push({ x, y, ...march(x, y) });
  // Rays to follow step by step: ones that hit after crossing a few bricks.
  const pickXY = [[9, 15], [20, 10], [29, 16], [14, 20], [33, 12], [24, 19]];
  const shown = pickXY.map(([x, y]) => all[y * W + x]);
  return { eye, W, H, ps, pc, planeZ, all, shown, brickIds, uniq };
}
const V2S = v => [v[0] - 16, v[1], v[2] - 16];   // voxel units -> scene

/* ---- the wall of words (the baked chapters) -----------------------------------
   A baked field's words in rank order, 64 a row, so a row is one block of the
   block sums. The town stands to its left. */
const WALL0 = [6, 57, -10], WPITCH = 0.92, BAKE_TOWN = [-38, 0, 0];
const wallAt = i => [WALL0[0] + (i % 64) * WPITCH + WPITCH / 2, WALL0[1] - Math.floor(i / 64) * WPITCH, WALL0[2]];
function drawWall(F, P, { upto, dim, glow }){
  const n = Math.min(Math.ceil(upto), P.wordCol.length);
  for (let i = 0; i < n; i++){
    const p = wallAt(i), c = P.wordCol[i], d = dim(i), s = 0.8 * Math.min(1, back(clamp((upto - i) / 40)));
    if (s <= 0.01) continue;
    F.box(p[0], p[1], p[2], s, s, 0.3, c[0] * d, c[1] * d, c[2] * d, 1, glow(i));
  }
}

/* ---- drawing helpers ---------------------------------------------------------- */
function townCells(F, cells, { scale = 1, glow = 0, alpha = 1, tint = null, tintAmt = 0, off = [0, 0, 0] } = {}){
  for (const q of cells){
    const s = q.s * scale;
    if (s <= 0.001) continue;
    let c = q.c;
    if (tint) c = [lerp(c[0], tint[0], tintAmt), lerp(c[1], tint[1], tintAmt), lerp(c[2], tint[2], tintAmt)];
    F.cube(q.p[0] + off[0], q.p[1] + off[1], q.p[2] + off[2], s, c[0], c[1], c[2], alpha, glow);
  }
}
function wireRot(F, c, s, a, col, w = 1.5, opts){
  const h = s / 2, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(a * 0.7), sb = Math.sin(a * 0.7);
  const P = [];
  for (let i = 0; i < 8; i++){
    let x = (i & 1 ? h : -h), y = (i & 2 ? h : -h), z = (i & 4 ? h : -h);
    [x, z] = [x * ca + z * sa, -x * sa + z * ca];
    [y, z] = [y * cb - z * sb, y * sb + z * cb];
    P.push([c[0] + x, c[1] + y, c[2] + z]);
  }
  for (const [i, j] of [[0,1],[2,3],[4,5],[6,7],[0,2],[1,3],[4,6],[5,7],[0,4],[1,5],[2,6],[3,7]]) F.seg(P[i], P[j], col, w, opts);
}
const bez = (a, b, c, u) => [0, 1, 2].map(i => (1 - u) * (1 - u) * a[i] + 2 * (1 - u) * u * b[i] + u * u * c[i]);
function circle(F, c, r, col, w = 1.5, n = 96, opts){
  let prev = null;
  for (let i = 0; i <= n; i++){
    const a = i / n * Math.PI * 2, p = [c[0] + r * Math.cos(a), c[1], c[2] + r * Math.sin(a)];
    if (prev) F.seg(prev, p, col, w, opts);
    prev = p;
  }
}
const withA = (c, a) => [c[0], c[1], c[2], a];

/* The cut and its chunks, drawn: faces from each chunk's job (by stamp),
   and optionally its box in its lod's colour. */
function drawCut(P, F, eyeVox, { detail = 1, boxes = 0, maxChunks = 1024 } = {}){
  const D = P.D, sel = D.select(eyeVox, { detail, maxChunks });
  const woff = P.woff, byLod = [0, 0, 0, 0, 0, 0];
  const stamps = new Set();
  let faces = 0, records = 0;
  for (const c of sel.leaves){
    const job = D.jobs.job(c);
    stamps.add(job.key);
    byLod[c.lod]++; faces += job.faces; records += job.count;
    const o = [c.lo[0] + woff[0], c.lo[1] + woff[1], c.lo[2] + woff[2]];
    F.faces(P.facesOf(job), o, 2 ** c.lod);
    if (boxes > 0){
      const col = C3(LOD[c.lod]);
      F.wire(o, [o[0] + c.size, o[1] + c.size, o[2] + c.size], withA(col, boxes * 0.85), 1.4 + c.lod * 0.25);
    }
  }
  return { sel, byLod, faces, records, stamps: stamps.size, leaves: sel.leaves.length };
}

/* ====================================================================== */
export const SCENES = [

/* ---- 1. title ----------------------------------------------------------- */
{
  key: 'intro', title: 'A world as a DAG', dur: 10, noCaption: true,
  steps: [[0, '']],
  cam: t => ({ target: [0, 15, 0], yaw: 0.55 + t * 0.085, pitch: 0.36, dist: 98 - t * 1.6 }),
  draw({ F, g, t, W, H, P }){
    for (const v of P.vox){
      const d = 0.2 + v.y / 32 * 2.6 + v.h * 1.4;
      const u = clamp((t - d) / 0.85);
      if (u <= 0) continue;
      const e = eo(u);
      F.cube(v.w[0], v.w[1] + (1 - e) * 26, v.w[2], 0.35 + 0.65 * e, v.c[0], v.c[1], v.c[2], 1, (1 - u) * 1.2);
    }
    const a = fade(t, 1.2, 2.6, 8.8, 9.8);
    if (a > 0){
      g.save(); g.globalAlpha = a * 0.6; const gr = g.createLinearGradient(0, 0, 0, H * 0.45);
      gr.addColorStop(0, 'rgba(5,7,12,0.95)'); gr.addColorStop(1, 'rgba(5,7,12,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H * 0.45); g.restore();
    }
    text(g, 'vdag', W / 2, H * 0.2, { size: Math.min(96, W * 0.16), weight: 800, align: 'center', alpha: a, track: -2 });
    text(g, 'a voxel world as a directed acyclic graph', W / 2, H * 0.2 + 40, { size: Math.min(22, W * 0.045), weight: 500, color: DIM, align: 'center', alpha: a });
    text(g, 'hash-consed · streamed in chunks · drawn as records and rays', W / 2, H * 0.2 + 70, { size: 13.5, weight: 600, color: ACCENT, align: 'center', alpha: a * 0.9, track: 0.6 });
    const b = fade(t, 4.5, 5.5, 8.8, 9.8);
    pill(g, `one town · 32³ · ${fmt(P.D.census.svo[0])} voxels`, W / 2, H * 0.83, { alpha: b, size: 13, mono: true });
  },
},

/* ---- 2. the octree ---------------------------------------------------------- */
{
  key: 'octree', title: 'Halving space', dur: 17,
  steps: [
    [0, 'Start with the town\'s bounding cube: one node at <b>level 5</b>, 32 voxels a side.'],
    [1.6, 'Split it into 8 octants. An octant\'s number is its bits: <code>o = x | y≪1 | z≪2</code>, Morton order. Empty octants are id 0 and are never stored.'],
    [5.5, 'Keep splitting only what\'s occupied. A node at level <i>k</i> covers 2<sup>k</sup> voxels a side.'],
    [10.5, 'At level 0 are the voxels themselves. That\'s a <b>sparse voxel octree</b>.'],
  ],
  cam: t => ({ target: [0, 13, 0], yaw: 0.55 + t * 0.045, pitch: 0.42, dist: 86 }),
  draw({ F, g, t, W, H, P }){
    const s = clamp((t - 1.6) / 1.8, 0, 5);
    const grow = k => k === 5 ? win(t, 0.2, 1.2) : clamp(s - (4 - k));
    const faint = k => 1 - 0.86 * clamp(s - (5 - k));
    const byId = P.nodes;
    for (const n of byId){
      const k = n.level, a = grow(k);
      if (a <= 0) continue;
      const parent = n.parent >= 0 ? byId[n.parent] : null;
      const e = eo(a);
      const c = parent ? lerp3(parent.centre, n.centre, e) : n.centre;
      const sz = n.size * (parent ? 0.35 + 0.65 * e : 0.6 + 0.4 * e);
      const al = faint(k) * Math.min(1, a * 2.5);
      const lo = c.map(v => v - sz / 2), hi = c.map(v => v + sz / 2);
      F.wire(lo, hi, withA(n.lc, al * (k === 1 ? 0.75 : 0.95)), k >= 4 ? 2.4 : k === 1 ? 1.0 : 1.5);
      if (k >= 4 && al > 0.5) F.box(c[0], c[1], c[2], sz * 0.995, sz * 0.995, sz * 0.995, n.lc[0], n.lc[1], n.lc[2], 0.06 * al, 0.3);
    }
    // the voxels, out of their level-1 boxes
    const a0 = clamp(s - 4);
    if (a0 > 0) for (const v of P.vox){
      const u = clamp(a0 * 1.7 - v.h * 0.7);
      if (u <= 0) continue;
      const e = eo(u), p = lerp3(v.pc, v.w, e);
      F.cube(p[0], p[1], p[2], 0.3 + 0.7 * e, v.c[0], v.c[1], v.c[2], 1, (1 - e) * 0.8);
    }
    // the root's empty octants, and every octant's number
    const lab = fade(s, 0.15, 0.5, 1.9, 2.4);
    if (lab > 0){
      const present = new Set(byId.filter(n => n.level === 4).map(n => n.x | n.y << 1 | n.z << 2));
      for (let o = 0; o < 8; o++){
        const c = [(o & 1) * 16 + 8 - 16, (o >> 1 & 1) * 16 + 8, (o >> 2) * 16 + 8 - 16];
        if (!present.has(o)){
          F.box(c[0], c[1], c[2], 15.6, 15.6, 15.6, 1, 0.32, 0.4, 0.13 * lab, 0.6);
          F.wire(c.map(v => v - 7.8), c.map(v => v + 7.8), withA(C3(RED), 0.55 * lab), 1.4);
        }
        const bitsTxt = `${o >> 2 & 1}${o >> 1 & 1}${o & 1}`;
        label3(F, g, c, `${o} · zyx ${bitsTxt}${present.has(o) ? '' : ' · EMPTY, id 0'}`, { alpha: lab, size: 12, color: present.has(o) ? LEVEL[4] : RED, mono: true });
      }
    }
    // the count, level by level
    const x0 = W - 252, y0 = 86, show = win(t, 0.6, 1.4);
    panel(g, x0, y0, 220, 196, { alpha: show });
    const rows = [5, 4, 3, 2, 1].map(k => [`level ${k}  ·  ${2 ** k}³`, fmt(P.D.census.svo[k] * eo(grow(k))), LEVEL[k], grow(k) > 0 ? 1 : 0.25]);
    rows.push(['voxels', fmt(P.D.census.svo[0] * clamp(s - 4)), LEVEL[0], s > 4 ? 1 : 0.25]);
    table(g, x0 + 18, y0 + 30, 184, rows, { alpha: show, title: 'TREE NODES' });
  },
},

/* ---- 3. the tree -------------------------------------------------------------- */
{
  key: 'tree', title: 'The tree', dur: 14,
  steps: [
    [0, 'Lay the octree out as a tree. Every node is a record: its level and its eight child ids.'],
    [4.5, `1,231 nodes above the voxels: 1 · 6 · 22 · 168 · 1,034. Most of them say the same thing.`],
    [8.5, 'Colour each node by what it holds. <b>Same colour, same subtree</b>: a patch of lawn, a stretch of wall, a whole house.'],
  ],
  cam: t => camKeys(t, [[0, { target: [0, 18, 0], yaw: 1.15, pitch: 0.42, dist: 86 }],
                        [4.5, { target: [0, 32, 0], yaw: 1.55, pitch: 0.3, dist: 168 }],
                        [14, { target: [0, 32, 0], yaw: 2.15, pitch: 0.36, dist: 158 }]]),
  draw({ F, g, t, W, H, P }){
    const out = 1 - win(t, 0, 1.6);
    if (out > 0) F.batch(P.townBatch[0], null, { alpha: out });
    const col = sm(win(t, 8.5, 10.2));
    const pos = [];
    const NS = { 5: 3.4, 4: 2.6, 3: 1.9, 2: 1.05, 1: 0.46 };
    P.nodes.forEach((n, i) => {
      const k = n.level, u = sm(win(t, 0.5 + (5 - k) * 0.35 + n.h * 0.4, 3.4 + (5 - k) * 0.35 + n.h * 0.4));
      const p = lerp3(n.centre, n.tree, u);
      pos[i] = p;
      const c = lerp3(n.lc, n.sc, col);
      const sz = lerp(0.5, NS[k], u);
      F.cube(p[0], p[1], p[2], sz, c[0], c[1], c[2], 1, 0.35 + (1 - u) * 0.5);
    });
    const ea = win(t, 2.2, 4.2);
    if (ea > 0) P.nodes.forEach((n, i) => {
      if (n.parent < 0) return;
      const c = lerp3(P.nodes[n.parent].lc, n.lc, 0.5);
      F.seg(pos[n.parent], pos[i], withA(c, ea * (n.level === 1 ? 0.22 : 0.45)), n.level === 1 ? 1 : 1.5, { add: true });
    });
    const la = fade(t, 4.4, 5.4, 13, 14);
    for (const k of [5, 4, 3, 2, 1]){
      const n = P.D.tree.count[k], u = P.D.tree.uniq[k];
      const nn = `${fmt(n)} node${n === 1 ? '' : 's'}`;
      const s = col > 0.5 ? `level ${k} · ${nn} · ${u} distinct` : `level ${k} · ${nn}`;
      label3(F, g, [P.treeR[k] + 3, P.treeY[k], 0], s, { alpha: la, dx: 26, color: LEVEL[k], size: 12 });
    }
  },
},

/* ---- 4. hash-consing ------------------------------------------------------------ */
{
  key: 'hashcons', title: 'Hash-consing', dur: 17,
  steps: [
    [0, '<b>Hash-consing</b>: intern every node in a table keyed by its level and its eight child ids. Equal keys get one id.'],
    [4.2, 'Go bottom up. Once children are shared, their parents\' keys are equal too, and they merge. Ids come children first.'],
    [11.2, '<b>1,231 tree nodes become 109.</b> And all 5,606 voxels are one node: FULL, id 1. That\'s the DAG.'],
  ],
  cam: t => camKeys(t, [[0, { target: [0, 32, 0], yaw: 2.15, pitch: 0.36, dist: 158 }],
                        [6, { target: [0, 32, 0], yaw: 2.6, pitch: 0.32, dist: 132 }],
                        [17, { target: [0, 30, 0], yaw: 3.25, pitch: 0.26, dist: 128 }]]),
  draw({ F, g, t, W, H, P }){
    const WIN = { 1: [1.0, 4.2], 2: [4.4, 6.7], 3: [6.9, 8.9], 4: [9.1, 10.7], 5: [10.7, 10.8] };
    const m = k => win(t, WIN[k][0], WIN[k][1]);
    const NS = { 5: 3.4, 4: 2.6, 3: 1.9, 2: 1.05, 1: 0.46 }, NSD = { 5: 3.4, 4: 2.6, 3: 2.2, 2: 1.4, 1: 0.95 };
    const pos = [];
    P.nodes.forEach((n, i) => {
      const k = n.level, [a, b] = WIN[k];
      const u = sm(clamp((t - a - n.h * 0.5) / (b - a - 0.5)));
      const p = lerp3(n.tree, n.dag, u);
      pos[i] = p;
      const flash = Math.max(0, 1 - Math.abs(u - 0.5) * 3);
      F.cube(p[0], p[1], p[2], lerp(NS[k], NSD[k], u), n.sc[0], n.sc[1], n.sc[2], 1, 0.35 + flash * 0.9);
    });
    P.nodes.forEach((n, i) => {
      if (n.parent < 0) return;
      F.seg(pos[n.parent], pos[i], withA(n.sc, n.level === 1 ? 0.16 : 0.3), n.level === 1 ? 1 : 1.4, { add: true });
    });
    // FULL, under it all
    const fu = win(t, 11.2, 12.4);
    if (fu > 0){
      const fp = [0, -4, 0];
      F.cube(fp[0], fp[1], fp[2], 3.2 * back(fu), 1, 1, 1, 1, 0.6);
      const seen = new Set();
      P.nodes.forEach((n, i) => {
        if (n.level !== 1 || seen.has(n.slot)) return;
        seen.add(n.slot);
        F.seg(pos[i], fp, [0.75, 0.85, 1, 0.22 * fu], 1, { add: true });
      });
      label3(F, g, fp, 'FULL · id 1 · every voxel', { dy: 34, alpha: fu, color: INK, size: 12 });
    }
    // the tally
    const x0 = W - 270, y0 = 86, sh = win(t, 0.3, 1.0);
    panel(g, x0, y0, 238, 232, { alpha: sh });
    text(g, 'NODES', x0 + 18, y0 + 30, { size: 11, weight: 700, color: DIM, alpha: sh, track: 1.2, shadow: false });
    text(g, 'tree → DAG', x0 + 220, y0 + 30, { size: 11, weight: 600, color: FAINT, alpha: sh, align: 'right', shadow: false });
    let y = y0 + 56;
    for (const k of [5, 4, 3, 2, 1]){
      const a = P.D.census.svo[k], b = P.D.census.dag[k], v = lerp(a, b, m(k));
      table(g, x0 + 18, y, 202, [[`level ${k}`, fmt(v), LEVEL[k]]], { alpha: sh });
      y += 22;
    }
    table(g, x0 + 18, y, 202, [['voxels', fu > 0 ? '1 (FULL)' : fmt(P.D.census.svo[0]), LEVEL[0]]], { alpha: sh });
    y += 30;
    const tot = lerp(1231, 109, win(t, 1, 10.8));
    text(g, 'total', x0 + 34, y, { size: 13, color: DIM, alpha: sh, shadow: false });
    text(g, fmt(tot), x0 + 220, y, { size: 20, weight: 750, alpha: sh, align: 'right', mono: true, shadow: false, color: m(4) >= 1 ? GOLD : INK });
    // one key, as dag-core interns it
    const ka = fade(t, 12.5, 13.3, 17, 18);
    if (ka > 0){
      const [kx, ky] = W >= 1100 ? [W - 470 - 26, H - 190] : [26, 110];
      panel(g, kx, ky, 470, 92, { alpha: ka });
      text(g, 'store.intern(level, children) → id   ·   the house\'s key', kx + 18, ky + 26, { size: 11.5, weight: 650, color: DIM, alpha: ka, shadow: false });
      const key = `[ 3 │ ${P.houseKey.join(' ')} ]`;
      text(g, key, kx + 18, ky + 58, { size: 15, weight: 600, mono: true, alpha: ka, shadow: false, color: GOLD });
      text(g, `→ id ${P.lifted[0].id}`, kx + 452, ky + 58, { size: 15, weight: 700, mono: true, alpha: ka, align: 'right', shadow: false, color: ACCENT });
      text(g, 'level, then 8 child ids in octant order; 0 = EMPTY, 1 = FULL', kx + 18, ky + 80, { size: 11, color: FAINT, alpha: ka, shadow: false });
    }
  },
},

/* ---- 5. symmetry ----------------------------------------------------------------- */
{
  key: 'symmetry', title: 'Turned copies, one class', dur: 16,
  env: () => ({ fog: 0.0016 }),
  steps: [
    [0, 'Four houses facing four ways are four different nodes: ids 95, 96, 103 and 101.'],
    [4.5, 'Turn each back and they\'re the same voxels. dag-core\'s <code>createClasses</code> finds that without building any turned copy.'],
    [8.4, 'One <b>class</b>, with the turn moved onto the edge (SSVDAG). The town\'s 109 nodes are 31 classes.'],
    [10.8, 'A cube\'s turns and mirrors are the group <b>Oh</b>: 48 elements, 6 axis permutations × 8 sign flips. Each record carries its brick\'s pose, 6 bits.'],
  ],
  cam: t => camKeys(t, [[0, { target: [0, 12, 0], yaw: 0.25, pitch: 0.42, dist: 92 }],
                        [3.5, { target: [0, 30, 0], yaw: 0.05, pitch: 0.3, dist: 100 }],
                        [10.4, { target: [0, 40, 0], yaw: -0.02, pitch: 0.16, dist: 80 }],
                        [12.2, { target: [0, 34, -6], yaw: 0.0, pitch: 0.34, dist: 132 }],
                        [16, { target: [0, 34, -6], yaw: 0.14, pitch: 0.36, dist: 126 }]]),
  draw({ F, g, t, W, H, P }){
    F.batch(P.townMinusLifted, null, { alpha: 1 - win(t, 10.6, 12) });
    const L = sm(win(t, 0.8, 3.2)), Rr = sm(win(t, 4.6, 7.6)), Cc = sm(win(t, 8.4, 10.2)), G = win(t, 10.6, 12.6);
    const rowX = [-27, -9, 9, 27];
    // grid placement for the 48
    const cols = 12, sp = 11.5, gy0 = 56, gpos = e => [((e % cols) - (cols - 1) / 2) * sp, gy0 - Math.floor(e / cols) * 11.5, -6];
    P.lifted.forEach((h, i) => {
      const row = [rowX[i], 40, 8];
      let p = lerp3(h.home, row, L);
      p[1] += Math.sin(L * Math.PI) * 6;
      p = lerp3(p, [0, 40, 8], Cc);
      const g0 = gpos(0);
      if (G > 0) p = lerp3(p, g0, sm(G));
      const scale = lerp(1, 1.25, L) * lerp(1, 0.85, sm(G));
      const ang = Rr * h.f * Math.PI / 2;
      const vis = i === 0 ? 1 : 1 - win(t, 9.6, 10.3);
      if (vis > 0) F.batch(h.batch, M4.trs(p[0], p[1] - (G > 0 ? 4 * scale * sm(G) : 0), p[2], ang, scale), { alpha: vis, glow: Cc > 0 && Cc < 1 ? 0.2 : 0 });
      const la = fade(t, 1.8, 2.8, 8.3, 9.0);
      const s = Rr < 0.5 ? `id ${h.id} · turned ${h.f * 90}°` : `id ${h.id} · class ${h.cls}`;
      label3(F, g, [p[0], p[1] + 11, p[2]], s, { alpha: la, color: Rr < 0.5 ? INK : GOLD, size: 12, mono: true });
    });
    const ca = fade(t, 9.6, 10.2, 10.6, 11.2);
    label3(F, g, [0, 54, 8], '4 nodes  →  1 class', { alpha: ca, color: GOLD, size: 15 });
    // the 48
    if (G > 0) P.oh.forEach(o => {
      if (o.e === 0) return;
      const u = clamp(G * 1.6 - o.e / 48 * 0.6);
      if (u <= 0) return;
      const p = lerp3(gpos(0), gpos(o.e), eo(u));
      F.batch(o.batch, M4.trs(p[0], p[1] - 4 * 0.85, p[2], 0, 0.85 * eo(u)), { tint: C3(PINK), tintAmt: o.mirror ? 0.28 : 0 });
    });
    const ga = win(t, 12.4, 13.4);
    if (ga > 0){
      pill(g, '48 elements of Oh   ·   pink: mirrors (det −1)   ·   white: the 24 turns', W / 2, 92, { alpha: ga, size: 12.5 });
    }
    const x0 = W - 252, y0 = 86, pa = fade(t, 8.6, 9.4, 10.6, 11.4);
    panel(g, x0, y0, 220, 150, { alpha: pa });
    const cc = P.D.classCensus.classes[0];
    const rows = [5, 4, 3, 2, 1].map(k => [`level ${k}`, `${P.D.census.dag[k]} → ${cc[k]}`, LEVEL[k]]);
    table(g, x0 + 18, y0 + 30, 184, rows, { alpha: pa, title: 'NODES → OH CLASSES' });
  },
},

/* ---- 6. worlds ------------------------------------------------------------------- */
{
  key: 'worlds', title: 'Copies are free', dur: 15,
  steps: [
    [0, 'A world is more levels above the town. A level of 2 × 2 copies is one more node.'],
    [3.4, '64 × 64 towns, each turned by a hash: <b>4,096 towns, 22,962,176 voxels, 728 nodes</b>.'],
    [9.4, 'Far away a town is a few pixels wide and needs only a few cells. That\'s level of detail, and the DAG holds every level already.'],
  ],
  cam: t => {
    const u = sm(win(t, 0.8, 13.5));
    return { target: [lerp(0, -16, u), lerp(9, 0, u), lerp(0, -16, u)], yaw: 0.55 + t * 0.03, pitch: lerp(0.4, 0.92, u), dist: 78 * (1300 / 78) ** u, far: 20000 };
  },
  env: t => ({ fog: lerp(0.004, 0.00032, sm(win(t, 0.8, 13.5))), gridFade: 4000, gridStep: 32 }),
  draw({ F, g, t, W, H, P }){
    const [fx, fz] = P.focus, eye = F.view.eye;
    const ANG = { 0: 0, 41: -Math.PI / 2, 5: Math.PI, 44: Math.PI / 2 };
    let shown = 0;
    for (let tz = 0; tz < 64; tz++) for (let tx = 0; tx < 64; tx++){
      const dx = tx - fx, dz = tz - fz, r = Math.max(Math.abs(dx), Math.abs(dz));
      const t0 = r === 0 ? -1 : 1.6 + Math.sqrt(r) * 1.55 + hash(tx * 64 + tz, 5) * 0.3;
      const u = clamp((t - t0) / 0.5);
      if (u <= 0) continue;
      shown++;
      const c = [dx * 32, 0, dz * 32];
      const q = F.project([c[0], 8, c[2]]);
      if (!q || q[0] < -300 || q[1] < -300 || q[0] > F.view.w + 300 || q[1] > F.view.h + 300) continue;
      const d = Math.hypot(c[0] - eye[0], 8 - eye[1], c[2] - eye[2]);
      const lod = d < 330 ? 0 : d < 900 ? 1 : d < 2000 ? 2 : 3;
      F.batch(P.townBatch[lod], M4.trs(c[0], 0, c[2], ANG[P.D.turnOf(tx, tz)], back(u)));
    }
    const x0 = W - 290, y0 = 86, sh = win(t, 0.5, 1.2);
    panel(g, x0, y0, 258, 166, { alpha: sh });
    const rows = [
      ['towns', fmt(shown), INK],
      ['voxels', fmt(shown * P.D.census.svo[0]), INK],
      ['DAG nodes, whole world', fmt(P.D.worldCensus.dag.reduce((a, b) => a + b, 0)), GOLD, 0.25 + 0.75 * win(t, 3.4, 4.4)],
      ['of them the town\'s', fmt(P.D.census.dag.reduce((a, b) => a + b, 0)), DIM, 0.25 + 0.75 * win(t, 3.4, 4.4)],
    ];
    table(g, x0 + 18, y0 + 30, 222, rows, { alpha: sh, title: 'THE WORLD · D = 11' });
    text(g, 'identical copies: +1 node a level', x0 + 18, y0 + 148, { size: 11.5, color: FAINT, alpha: sh * win(t, 10, 11), shadow: false });
  },
},

/* ---- 7. the cut ------------------------------------------------------------------- */
{
  key: 'cut', title: 'The cut', dur: 17,
  steps: [
    [0, 'To stream, the eye wants fine chunks near it and coarse ones far off. A chunk is always 64³ cells; at <b>lod l</b> a cell is 2<sup>l</sup> voxels.'],
    [5.5, '<code>selectChunks</code> splits a chunk while the eye is nearer than its size. It\'s a cut through the octree, so every voxel lies in exactly one chunk.'],
    [11, 'Each chunk is one job, keyed by its <b>stamp</b>: the seven nodes it reads. Here every 64³ holds four towns turned at random, so each chunk is its own job; in a world of exact copies they\'d be one.'],
  ],
  eyeAt(t, P){
    const u = eio(win(t, 0, 17)), [fx, fz] = P.focus;
    const c = [fx * 32 + 16, 0, fz * 32 + 16];
    return [c[0] - 520 + 900 * u, 70 + 30 * Math.sin(u * Math.PI), c[2] + 430 - 760 * u];
  },
  cam(t, P){
    const e = this.eyeAt(t, P);
    return { target: [e[0] + P.woff[0], 0, e[2] + P.woff[2]], yaw: 0.65 + t * 0.022, pitch: lerp(1.05, 0.82, sm(win(t, 0, 17))), dist: 1250 - t * 18, far: 12000 };
  },
  env: () => ({ fog: 0.00022, grid: 0.5, gridStep: 64, gridFade: 3000 }),
  draw({ F, g, t, W, H, P }){
    const ev = this.eyeAt(t, P), es = add3(ev, P.woff);
    const st = drawCut(P, F, ev, { detail: 1, boxes: 1 });
    // the eye
    F.cube(es[0], es[1], es[2], 14, 1, 1, 1, 1, 1.5);
    F.seg([es[0], 0, es[2]], es, [1, 1, 1, 0.8], 2, { add: true });
    circle(F, [es[0], 1, es[2]], 26 + 6 * Math.sin(t * 4), [1, 1, 1, 0.6], 2, 48, { add: true });
    label3(F, g, es, 'eye', { dy: -30, size: 12, alpha: 1 });
    const x0 = W - 270, y0 = 86;
    panel(g, x0, y0, 238, 236);
    const rows = [0, 1, 2, 3, 4].map(l => [`lod ${l} · cell ${2 ** l} · ${64 * 2 ** l}³`, fmt(st.byLod[l]), LOD[l], st.byLod[l] ? 1 : 0.35]);
    let y = table(g, x0 + 18, y0 + 30, 202, rows, { title: 'CHUNKS IN THE CUT' });
    y += 8;
    text(g, `${st.leaves} chunks · ${st.stamps} distinct jobs`, x0 + 18, y, { size: 12.5, weight: 600, color: GOLD, shadow: false });
    text(g, `${fmt(st.records)} records`, x0 + 18, y + 20, { size: 12, color: DIM, shadow: false, mono: true });
    text(g, `${fmt(st.faces)} faces drawn`, x0 + 18, y + 38, { size: 12, color: DIM, shadow: false, mono: true });
  },
},

/* ---- 8. a chunk job ------------------------------------------------------------------ */
{
  key: 'job', title: 'A chunk job', dur: 18,
  steps: [
    [0, 'A job turns one chunk into <b>records</b>. <code>expandChunk</code> walks the chunk\'s node and marks every occupied cell: 5,606 here.'],
    [3, 'Cut it open. A cell whose six neighbours are all full can\'t be seen…'],
    [6.6, '…so it\'s never emitted. 1,674 buried cells drop out; 3,932 records are left.'],
    [10.2, 'A record is <b>4 bytes</b>: an 18-bit Morton cell, a 6-bit face mask, a 6-bit pose. No centre: the vertex shader rebuilds it.'],
  ],
  cam(t, P){
    const q = P.D.pick, p = [q.x + 0.5 - 16, q.y + 0.5, q.z + 0.5 - 16];
    return camKeys(t, [[0, { target: [0, 10, 0], yaw: 0.45, pitch: 0.42, dist: 84 }],
                       [3, { target: [0, 8, 0], yaw: 0.7, pitch: 0.36, dist: 74 }],
                       [9.6, { target: [0, 8, 0], yaw: 1.0, pitch: 0.4, dist: 78 }],
                       [11.6, { target: p, yaw: Math.PI + 0.55, pitch: 0.32, dist: 22 }],
                       [18, { target: p, yaw: Math.PI + 0.75, pitch: 0.28, dist: 20 }]]);
  },
  draw({ F, g, t, W, H, P }){
    const job = P.D.townJobs[0];
    const zc = lerp(17, 0, sm(win(t, 3, 4.6))) + lerp(0, 17, sm(win(t, 8.4, 9.8)));
    const bur = win(t, 4.8, 5.4), gone = sm(win(t, 6.6, 8.2));
    const focus = sm(win(t, 10.2, 11.4));
    const pick = P.D.pick;
    for (const q of P.lodCells[0]){
      if (q.p[2] > zc) continue;
      const isPick = q.q === pick;
      const dim = isPick ? 0 : focus * 0.72;
      F.cube(q.p[0], q.p[1], q.p[2], 1, q.c[0] * (1 - dim), q.c[1] * (1 - dim), q.c[2] * (1 - dim), 1, isPick ? focus * 0.25 : 0);
    }
    for (const b of job.buried){
      const p = [b[0] + 0.5 - 16, b[1] + 0.5, b[2] + 0.5 - 16];
      if (p[2] > zc) continue;
      const s = 1 - gone, k = hash(b[0] * 1024 + b[1] * 32 + b[2], 2);
      if (s <= 0) continue;
      F.cube(p[0], p[1] - gone * 3 * k, p[2], s, lerp(0.6, 1, bur), lerp(0.55, 0.25, bur), lerp(0.5, 0.32, bur), 1, bur * (0.6 + 0.4 * Math.sin(t * 7 + k * 6)));
    }
    // the cutting plane
    const pa = fade(t, 3, 3.4, 9.4, 9.9);
    if (pa > 0){
      const z = zc;
      const c = withA(C3(ACCENT), 0.8 * pa);
      F.seg([-17, 0, z], [17, 0, z], c, 2, { add: true }); F.seg([-17, 33, z], [17, 33, z], c, 2, { add: true });
      F.seg([-17, 0, z], [-17, 33, z], c, 2, { add: true }); F.seg([17, 0, z], [17, 33, z], c, 2, { add: true });
    }
    // the picked record's faces
    const q = pick, pp = [q.x + 0.5 - 16, q.y + 0.5, q.z + 0.5 - 16];
    if (focus > 0){
      const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      for (let f = 0; f < 6; f++){
        if (!(q.mask >> f & 1)) continue;
        const n = N[f], c = add3(pp, n.map(v => v * 0.52));
        const s = n.map(v => v ? 0.04 : 0.86);
        F.box(c[0], c[1], c[2], s[0], s[1], s[2], 0.35, 0.85, 1, 0.85 * focus, 1.5);
      }
      F.wire(pp.map(v => v - 0.52), pp.map(v => v + 0.52), withA(C3(ACCENT), focus), 2.2, { top: true });
      label3(F, g, pp, `cell (${q.x}, ${q.y}, ${q.z})`, { dx: -70, dy: -80, alpha: focus, color: ACCENT, size: 12, mono: true });
    }
    // stats
    const x0 = W - 270, y0 = 86;
    panel(g, x0, y0, 238, 150, { alpha: 1 - focus * 0.0 });
    table(g, x0 + 18, y0 + 30, 202, [
      ['occupied cells', fmt(job.out.occupied), INK],
      ['buried, not emitted', fmt(job.buried.length * win(t, 4.8, 6)), RED],
      ['records', fmt(lerp(job.out.occupied, job.out.count, gone)), ACCENT],
      ['bytes', fmt(4 * Math.round(lerp(job.out.occupied, job.out.count, gone))), GOLD],
    ], { title: 'ONE JOB · LOD 0' });
    text(g, 'block-showroom\'s record: 14 bytes', x0 + 18, y0 + 138, { size: 11.5, color: FAINT, shadow: false });
    // the record, bit by bit
    const ba = win(t, 11.2, 12.2);
    if (ba > 0){
      const cell = 13, bw = 32 * (cell + 2), [bx, by] = W >= 1100 ? [W - bw - 44, H - 236] : [44, 160];
      panel(g, bx - 18, by - 44, bw + 36, 148, { alpha: ba });
      text(g, `record 0x${q.r.toString(16).padStart(8, '0')}`, bx, by - 18, { size: 13, weight: 650, mono: true, alpha: ba, shadow: false });
      const faces = ['+X', '−X', '+Y', '−Y', '+Z', '−Z'].filter((_, f) => q.mask >> f & 1).join(' ');
      bits(g, bx, by, q.r, [
        { name: 'spare', at: 30, len: 2, color: '#59627a' },
        { name: 'pose', at: 24, len: 6, color: PINK, sub: `${q.pose}` },
        { name: 'mask', at: 18, len: 6, color: GOLD, sub: faces },
        { name: 'cell (Morton)', at: 0, len: 18, color: ACCENT, sub: `${q.cell} → (${q.x}, ${q.y}, ${q.z})` },
      ], { cell, alpha: ba, reveal: win(t, 11.2, 13) });
    }
  },
},

/* ---- 9. lods ----------------------------------------------------------------------------- */
{
  key: 'lod', title: 'Coarser lods', dur: 16,
  steps: [
    [0, 'A coarser lod is a level up the DAG: at lod <i>l</i> a cell is a level-<i>l</i> node, 2<sup>l</sup> voxels a side.'],
    [2.6, 'Lod 1: 756 records. A coarse cell\'s colour is the count-weighted mean of the voxels under it.'],
    [5.8, 'Which coarse cells to draw is a rule. The viewer\'s is <b>shadow</b>: the fullest cells of each 8³ brick, plus the best cell of every column along x, y and z, so no see-through hole opens.'],
    [11.6, '3,932 → 756 → 137 → 22 records: about a fifth as many each step, for a quarter of the pixels.'],
  ],
  cam: t => camKeys(t, [[0, { target: [0, 11, 0], yaw: 0.6, pitch: 0.4, dist: 82 }],
                        [10.5, { target: [0, 11, 0], yaw: 1.4, pitch: 0.38, dist: 82 }],
                        [12.4, { target: [0, 12, 0], yaw: 0.0, pitch: 0.3, dist: 150 }],
                        [16, { target: [0, 12, 0], yaw: 0.12, pitch: 0.32, dist: 146 }]]),
  draw({ F, g, t, W, H, P }){
    const M = [[2.6, 3.8], [5.8, 7.0], [9.0, 10.2]];
    const row = sm(win(t, 11.6, 12.8));
    const X = [-54, -18, 18, 54];
    const cur = M.filter(([a]) => t >= a).length;          // 0..3
    for (let l = 0; l <= 3; l++){
      let s = 0;
      if (l === cur){
        const [a, b] = M[l - 1] || [-1, -0.5];
        s = l === 0 ? 1 : 1;
        const u = l === 0 ? 1 : win(t, a, b);
        const off = [X[l] * row, 0, 0];
        for (const q of P.lodCells[l]){
          const v = clamp(u * 1.6 - q.h * 0.6);
          if (v > 0) F.cube(q.p[0] + off[0], q.p[1], q.p[2], q.s * back(v), q.c[0], q.c[1], q.c[2], 1, (1 - v) * 0.6);
        }
      } else if (l === cur - 1){
        const [a, b] = M[l];
        const u = win(t, a, b);
        if (u < 1) for (const q of P.lodCells[l]){
          const v = clamp(u * 1.6 - q.h * 0.6);
          if (v < 1) F.cube(q.p[0], q.p[1], q.p[2], q.s * (1 - eo(v)), q.c[0], q.c[1], q.c[2], 1, 0);
        }
      }
      if (row > 0 && l < cur){
        const u = clamp(row * 1.5 - (3 - l) * 0.15);
        if (u > 0) F.batch(P.townBatch[l], M4.trs(X[l], 0, 0, 0, back(u)));
      }
    }
    const x0 = W - 300, y0 = 86;
    panel(g, x0, y0, 268, 150);
    const rows = [0, 1, 2, 3].map(l => {
      const j = P.D.townJobs[l];
      return [`lod ${l} · cell ${2 ** l}`, `${fmt(j.out.count)} · ${fmt(j.out.bytes)} B`, LOD[l], l <= cur ? (l === cur ? 1 : 0.6) : 0.25];
    });
    table(g, x0 + 18, y0 + 30, 232, rows, { title: 'RECORDS · SHADOW RULE' });
    if (row > 0) for (let l = 0; l <= 3; l++) label3(F, g, [X[l], -3, 0], `lod ${l} · ${fmt(P.D.townJobs[l].out.count)}`, { alpha: win(t, 12.4, 13.2), color: LOD[l], size: 12.5, mono: true });
  },
},

/* ---- 10. streaming --------------------------------------------------------------------------- */
{
  key: 'stream', title: 'Streaming', dur: 17,
  steps: [
    [0, 'Every frame, <code>selectChunks</code> says what\'s wanted, nearest first.'],
    [3.8, '<code>createStreamer</code> hands out jobs under budgets (jobs in flight, bytes uploaded a frame) to four workers, each holding a snapshot of the DAG.'],
    [8.6, 'Records come back as transferable buffers and go straight to the GPU. When the cache is full, the least recently used chunk goes.'],
    [13, 'Until all of a chunk\'s children are in, its parent keeps drawing, so nothing pops out. An edit installs all of its results in one frame.'],
  ],
  cam: t => ({ target: [2, 0, 0], yaw: 0.12 * Math.sin(t * 0.25), pitch: 0.06 + 0.04 * Math.sin(t * 0.2), dist: 112 }),
  env: () => ({ grid: 0, fog: 0.001 }),
  draw({ F, g, t, W, H, P }){
    const lods = [0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];
    const listPos = i => [-52, 24 - i * 4.4, 0];
    const workPos = w => [-12, 16.5 - w * 11, 0];
    const slotPos = s => [22 + (s % 6) * 6.2, 15.5 - Math.floor(s / 6) * 6.2 - 3, 0];
    const intro = win(t, 0, 1);
    // wanted list
    for (let i = 0; i < 12; i++){
      const c = C3(LOD[lods[i]]), p = listPos(i), a = clamp(intro * 2 - i * 0.08);
      F.wire(p.map(v => v - 1.5), p.map(v => v + 1.5), withA(c, a), 1.6);
    }
    // workers
    const jobs = P.streamJobs;
    for (let w = 0; w < 4; w++){
      const p = workPos(w), busy = jobs.find(j => j.w === w && t >= j.start && t < j.done);
      const spin = busy ? (t - busy.start) * 5 : 0;
      wireRot(F, p, 6.5, spin + w, withA(busy ? C3(LOD[busy.lod]) : [0.6, 0.7, 0.9], busy ? 1 : 0.55), 2);
      if (busy){ const c = C3(LOD[busy.lod]); F.cube(p[0], p[1], p[2], 2.6, c[0], c[1], c[2], 1, 1.2); }
    }
    // cache slots
    const occupant = new Array(24).fill(null);
    for (const j of jobs) if (t >= j.land) occupant[j.slot] = j;
    for (let s = 0; s < 24; s++){
      const p = slotPos(s);
      F.wire(p.map(v => v - 2.6), p.map(v => v + 2.6), [0.45, 0.55, 0.75, 0.5], 1.2);
      const o = occupant[s];
      if (o){
        const u = clamp((t - o.land) / 0.4), c = C3(LOD[o.lod]);
        F.box(p[0], p[1], p[2], 4.2 * back(u), 4.2 * back(u), 1.4, c[0] * 0.85, c[1] * 0.85, c[2] * 0.85, 1, (1 - u) * 1.5);
      }
      const ev = jobs.find(j => j.slot === s && j.i >= 24 && t >= j.land - 0.5 && t < j.land);
      if (ev){ const k = 1 - (j => (j.land - t) / 0.5)(ev); F.wire(p.map(v => v - 3), p.map(v => v + 3), [1, 0.35, 0.4, 1 - k * 0.3], 2.4, { add: true }); }
    }
    // jobs in flight
    for (const j of jobs){
      const c = C3(LOD[j.lod]);
      if (t >= j.spawn && t < j.start){
        const u = sm(clamp((t - j.spawn) / (j.start - j.spawn))), a = listPos(j.i % 12), b = workPos(j.w);
        const p = bez(a, [lerp(a[0], b[0], 0.5), (a[1] + b[1]) / 2 + 6, 6], b, u);
        F.cube(p[0], p[1], p[2], 1.8, c[0], c[1], c[2], 1, 1.0);
      } else if (t >= j.done && t < j.land){
        const u = sm((t - j.done) / (j.land - j.done)), a = workPos(j.w), b = slotPos(j.slot);
        const p = bez(a, [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 8, 8], b, u);
        F.box(p[0], p[1], p[2], 2.6, 2.6, 0.7, c[0], c[1], c[2], 1, 1.3);
        for (let k = 1; k <= 6; k++){
          const q = bez(a, [(a[0] + b[0]) / 2, Math.max(a[1], b[1]) + 8, 8], b, Math.max(0, u - k * 0.03));
          F.cube(q[0], q[1], q[2], 0.6, c[0], c[1], c[2], 0.5 - k * 0.07, 1.5);
        }
      }
    }
    label3(F, g, [-52, 30, 0], 'the cut · wanted', { size: 12.5, alpha: intro, color: INK });
    label3(F, g, [-12, 25, 0], 'workers', { size: 12.5, alpha: intro, color: INK });
    label3(F, g, [37.5, 21, 0], 'GPU cache · LRU', { size: 12.5, alpha: intro, color: INK });
    // the cover: a parent stays until its eight children are in
    const ca = fade(t, 12.8, 13.6, 17, 18);
    if (ca > 0){
      const c0 = [36, -21, 0], s = 9;
      const kids = Array.from({ length: 8 }, (_, o) => ({ o, at: 13.6 + o * 0.32 + hash(o, 11) * 0.2 }));
      const all = kids.every(k => t >= k.at + 0.3);
      const pa = all ? 1 - win(t, kids[7].at + 0.4, kids[7].at + 0.9) : 1;
      if (pa > 0){ F.box(c0[0], c0[1], c0[2], s, s, s, 0.55, 0.9, 0.55, ca * pa, 0.2); }
      F.wire(c0.map(v => v - s / 2), c0.map(v => v + s / 2), withA(C3(GREEN), ca), 1.6);
      for (const k of kids){
        const u = clamp((t - k.at) / 0.3);
        if (u <= 0) continue;
        const c = [c0[0] + ((k.o & 1) - 0.5) * s / 2, c0[1] + ((k.o >> 1 & 1) - 0.5) * s / 2, c0[2] + ((k.o >> 2) - 0.5) * s / 2];
        const z = s / 2 * 0.94 * back(u), col = C3(LOD[0]);
        F.box(c[0], c[1], c[2], z, z, z, col[0], col[1], col[2], ca, (1 - u));
      }
      label3(F, g, [c0[0], c0[1] - 7.5, 0], all ? 'all 8 in: parent retires' : 'parent drawn until all 8 children land', { alpha: ca, size: 11.5, color: all ? GREEN : DIM });
    }
  },
},

/* ---- 11. raster --------------------------------------------------------------------------------- */
{
  key: 'raster', title: 'Drawing: instanced cubes', dur: 15,
  steps: [
    [0, 'Drawing is instancing: one cube, and one 4-byte record an instance.'],
    [2.2, 'Records come out of the walk in <b>Morton order</b>, a Z-shaped curve through the chunk. <code>index ≫ 9</code> is the 8³ brick.'],
    [8.6, 'The vertex shader decodes the cell and rebuilds the centre: <code>origin + (cell + ½) × cellSize</code>. Faces the mask hides collapse to nothing.'],
  ],
  cam: t => ({ target: [0, 11, 0], yaw: 0.85 + t * 0.06, pitch: 0.44 - t * 0.008, dist: 80 }),
  draw({ F, g, t, W, H, P }){
    const cells = P.lodCells[0], n = cells.length;
    const u = eio(win(t, 2.2, 12.6)), k = u * n;
    const tmpl = [-34, 30, -6], ta = 1 - win(t, 12.8, 14);
    // the template cube
    if (ta > 0){
      const s = 7, c = withA(C3(ACCENT), 0.9 * ta);
      F.wire(tmpl.map(v => v - s / 2), tmpl.map(v => v + s / 2), c, 2, { add: true });
      const h = s / 2;
      for (const [a, b] of [[[-h, -h, h], [h, h, h]], [[-h, -h, -h], [h, h, -h]], [[h, -h, -h], [h, h, h]], [[-h, -h, -h], [-h, h, h]], [[-h, h, -h], [h, h, h]], [[-h, -h, -h], [h, -h, h]]])
        F.seg(add3(tmpl, a), add3(tmpl, b), withA(C3(ACCENT), 0.45 * ta), 1.2, { add: true });
      label3(F, g, [tmpl[0], tmpl[1] + 6, tmpl[2]], 'one cube · 12 triangles', { alpha: ta * win(t, 0.4, 1.2), size: 12, color: ACCENT });
    }
    for (let i = 0; i < Math.ceil(k); i++){
      const q = cells[i], v = clamp(k - i);
      const pop = clamp((k - i) / 60);
      const s = back(Math.min(1, v * 1.2 + pop));
      F.cube(q.p[0], q.p[1], q.p[2], Math.min(1, s), q.c[0], q.c[1], q.c[2], 1, (1 - pop) * 1.4);
    }
    // the curve: faint behind, bright at its head
    const ca = 1 - win(t, 13.2, 14.6);
    if (ca > 0) for (let i = 1; i < Math.min(n, Math.ceil(k)); i++){
      const a = cells[i - 1].p, b = cells[i].p, age = k - i;
      if (age > 420) { if (i % 2 === 0) F.seg(a, b, [0.35, 0.8, 1, 0.12 * ca], 1, { add: true, top: true }); continue; }
      const h = 1 - age / 420, col = lerp3(C3(ACCENT), C3(PINK), h);
      F.seg(a, b, withA(col, (0.25 + 0.75 * h) * ca), 1 + 1.6 * h, { add: true, top: true });
    }
    if (k >= 1 && k < n){ const q = cells[Math.floor(k)]; F.cube(q.p[0], q.p[1], q.p[2], 1.25, 1, 0.5, 0.8, 1, 2); }
    // count and code
    const x0 = W - 270, y0 = 86;
    panel(g, x0, y0, 238, 98);
    table(g, x0 + 18, y0 + 30, 202, [['instances', fmt(Math.min(n, k)), ACCENT], ['bytes', fmt(4 * Math.min(n, k)), GOLD]], { title: 'ONE DRAW CALL' });
    const cA = win(t, 8.6, 9.4);
    if (cA > 0){
      const lines = [
        ['uint cell = rec & 0x3FFFFu;', '// 18 bits, Morton'],
        ['uint mask = rec >> 18 & 63u;', '// faces shown'],
        ['uint pose = rec >> 24 & 63u;', '// the brick\'s Oh'],
        ['vec3 c = uOrigin + (demorton(cell)', ''],
        ['         + 0.5) * uCellSize;', ''],
        ['if ((mask & faceBit) == 0u) collapse();', ''],
      ];
      const px = 28, py = 92, pw = 452;
      panel(g, px, py, pw, 28 + lines.length * 21, { alpha: cA });
      text(g, 'GLSL_DECODE · chunk-glsl.js (paraphrased)', px + 16, py + 22, { size: 11, weight: 700, color: DIM, alpha: cA, shadow: false, track: 0.6 });
      lines.forEach(([c, cm], i) => {
        const w = text(g, c, px + 16, py + 46 + i * 21, { size: 12.5, mono: true, alpha: cA * clamp((t - 8.8) * 4 - i * 0.6), shadow: false, color: INK });
        if (cm) text(g, cm, px + 26 + w, py + 46 + i * 21, { size: 12, mono: true, alpha: cA * clamp((t - 8.8) * 4 - i * 0.6), shadow: false, color: FAINT });
      });
    }
  },
},

/* ---- 12. rays ------------------------------------------------------------------------------------- */
{
  key: 'rays', title: 'Far away: rays', dur: 17,
  steps: [
    [0, 'Far chunks can be traced instead. A <b>page</b> is a chunk\'s grid of 8³ bricks, deduplicated in an atlas: the town\'s 22 bricks are 9.'],
    [4, 'A ray marches the brick grid, steps into an occupied brick\'s cells, and stops at the first full one.'],
    [10, 'Every pixel of a traced chunk gets one. A stencil marks just those pixels, and each ray stops at the raster\'s depth. (The viewer ships raster only: it felt snappier.)'],
  ],
  cam: t => camKeys(t, [[0, { target: [-2, 14, 4], yaw: 0.75, pitch: 0.36, dist: 92 }],
                        [4, { target: [-4, 20, 18], yaw: 1.1, pitch: 0.3, dist: 104 }],
                        [9.4, { target: [-4, 20, 20], yaw: 1.2, pitch: 0.28, dist: 104 }],
                        [11.4, { target: [-6, 17, 24], yaw: 0.42, pitch: 0.2, dist: 78 }],
                        [17, { target: [-6, 17, 24], yaw: 0.3, pitch: 0.18, dist: 74 }]]),
  draw({ F, g, t, W, H, P }){
    const Rz = P.rays, D = P.D;
    F.batch(P.townBatch[0], null, { alpha: 1 });
    // bricks, by atlas entry
    const ba = fade(t, 0.3, 1.2, 15.5, 16.5);
    const hueOf = id => hsv((Rz.uniq.indexOf(id) * 0.13 + 0.05) % 1, 0.65, 1);
    for (const b of D.blocks){
      const lo = [b.bx * 8 - 16, b.by * 8, b.bz * 8 - 16], c = hueOf(b.id);
      F.wire(lo, lo.map(v => v + 8), withA(c, ba * 0.75), 1.4);
    }
    if (ba > 0){
      // the atlas: one swatch per distinct brick
      const x0 = W - 270, y0 = 86;
      panel(g, x0, y0, 238, 118, { alpha: ba });
      text(g, 'BRICK ATLAS', x0 + 18, y0 + 30, { size: 11, weight: 700, color: DIM, alpha: ba, track: 1.2, shadow: false });
      Rz.uniq.forEach((id, i) => {
        const c = hueOf(id);
        g.save(); g.globalAlpha = ba; g.fillStyle = `rgb(${c.map(v => Math.round(v * 255)).join(',')})`;
        g.fillRect(x0 + 18 + i * 22, y0 + 44, 16, 16); g.restore();
      });
      text(g, `${D.blocks.length} bricks → ${Rz.uniq.length} in the atlas`, x0 + 18, y0 + 88, { size: 12.5, weight: 600, color: GOLD, alpha: ba, shadow: false });
    }
    // eye, image plane, frustum
    const E = V2S(Rz.eye), pa = win(t, 3.4, 4.2);
    const hw = Rz.W * Rz.ps / 2, hh = Rz.H * Rz.ps / 2, pc = V2S(Rz.pc);
    const corners = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => [pc[0] + x, pc[1] + y, pc[2]]);
    if (pa > 0){
      F.cube(E[0], E[1], E[2], 1.6, 1, 1, 1, 1, 1.4);
      for (let i = 0; i < 4; i++){
        F.seg(corners[i], corners[(i + 1) % 4], [1, 1, 1, 0.7 * pa], 1.6);
        F.seg(E, corners[i], [1, 1, 1, 0.25 * pa], 1);
      }
      label3(F, g, E, 'eye', { dy: -22, alpha: pa, size: 11.5 });
    }
    // rays followed step by step
    const st = Rz.shown;
    st.forEach((r, i) => {
      const t0 = 4.3 + i * 0.85, dur = 2.0;
      const u = win(t, t0, t0 + dur);
      if (u <= 0) return;
      const tEnd = r.tEnd, tc = tEnd * eio(u);
      const vis = 1 - win(t, 10.2, 11.2);
      if (vis <= 0) return;
      const pt = tt => V2S([Rz.eye[0] + r.d[0] * tt, Rz.eye[1] + r.d[1] * tt, Rz.eye[2] + r.d[2] * tt]);
      F.seg(E, pt(tc), [1, 0.85, 0.5, 0.9 * vis], 2.2, { add: true, top: true });
      for (const s of r.steps){
        if (s.t > tc) break;
        const age = clamp((tc - s.t) / 12);
        if (s.kind === 'brick'){
          const lo = [s.c[0] * 8 - 16, s.c[1] * 8, s.c[2] * 8 - 16];
          const col = s.id === undefined ? [0.5, 0.55, 0.7] : hueOf(s.id);
          F.wire(lo, lo.map(v => v + 8), withA(col, vis * (1 - age * 0.7)), 2.4, { add: true });
        } else {
          const lo = [s.c[0] - 16, s.c[1], s.c[2] - 16];
          F.wire(lo, lo.map(v => v + 1), [1, 0.9, 0.6, vis * (0.9 - age * 0.5)], 1.4, { add: true, top: true });
        }
      }
      if (u >= 1 && r.hit){
        const h = V2S(r.hit.c.map(v => v + 0.5)), k = clamp((t - t0 - dur) / 0.6);
        F.cube(h[0], h[1], h[2], 1.2 + 0.6 * Math.sin(k * Math.PI), 1, 0.95, 0.75, vis, 1.5 * (1 - k * 0.5));
      }
    });
    // the image, a scanline at a time
    const ia = win(t, 10, 14.5);
    if (ia > 0){
      const N = Rz.all.length, n = Math.floor(ia * N);
      for (let i = 0; i < n; i++){
        const r = Rz.all[i], P0 = V2S(r.P);
        const c = r.col || [0.07, 0.09, 0.14];
        F.box(P0[0], P0[1], P0[2], Rz.ps * 0.94, Rz.ps * 0.94, 0.12, c[0], c[1], c[2], 1, r.col ? 0.35 : 0);
      }
      for (let i = Math.max(0, n - 18); i < n; i++){
        const r = Rz.all[i];
        const end = V2S([Rz.eye[0] + r.d[0] * r.tEnd, Rz.eye[1] + r.d[1] * r.tEnd, Rz.eye[2] + r.d[2] * r.tEnd]);
        F.seg(V2S(r.P), end, [1, 0.8, 0.45, 0.35 * (1 - (n - i) / 18)], 1.2, { add: true });
      }
      label3(F, g, [pc[0], pc[1] + hh + 2, pc[2]], `${Rz.W} × ${Rz.H} rays`, { alpha: win(t, 10.4, 11), size: 11.5, color: GOLD, mono: true });
    }
  },
},

/* ---- 13. colour ----------------------------------------------------------------------------------- */
{
  key: 'colour', title: 'Colour is a field', dur: 15,
  steps: [
    [0, 'Colour isn\'t in the DAG. It\'s a <b>field</b> the job samples, one 32-bit word a record: 6 bits a channel, the rest reserved.'],
    [3.8, 'A coarse cell\'s word is the count-weighted mean of the voxels under it, so empty space doesn\'t darken it.'],
    [8.2, 'So two blocks can share a node and still differ: the pond and the lawn are both <b>id 102</b>. Shape is shared; colour is looked up.'],
  ],
  cam(t, P){
    const m = P.D.merge.rec, c = [(m.x + 0.5) * 2 - 16, (m.y + 0.5) * 2, (m.z + 0.5) * 2 - 16];
    return camKeys(t, [[0, { target: [0, 10, 0], yaw: 0.7, pitch: 0.45, dist: 74 }],
                       [1.8, { target: c, yaw: 0.6, pitch: 0.62, dist: 17 }],
                       [7.4, { target: c, yaw: 0.9, pitch: 0.58, dist: 16 }],
                       [9.4, { target: [0, 4, 0], yaw: Math.PI + 0.35, pitch: 0.82, dist: 72 }],
                       [15, { target: [0, 4, 0], yaw: Math.PI + 0.55, pitch: 0.86, dist: 70 }]]);
  },
  draw({ F, g, t, W, H, P }){
    const D = P.D, m = D.merge, rec = m.rec;
    const c0 = [(rec.x + 0.5) * 2 - 16, (rec.y + 0.5) * 2, (rec.z + 0.5) * 2 - 16];
    const ex = sm(win(t, 2, 3.4)) * (1 - sm(win(t, 4.2, 5.6)));
    const merged = sm(win(t, 4.2, 5.6));
    const away = 1 - win(t, 7.6, 8.4);
    // the town, with a hole where the cell is
    for (const q of P.lodCells[0]){
      const inCell = (q.q.x >> 1) === rec.x && (q.q.y >> 1) === rec.y && (q.q.z >> 1) === rec.z;
      if (inCell && t > 1.8 && away > 0) continue;
      F.cube(q.p[0], q.p[1], q.p[2], 1, q.c[0], q.c[1], q.c[2], 1, 0);
    }
    if (t > 1.8 && away > 0){
      const mc = attrCol(rec.attr);
      for (const k of m.kids){
        const off = [((k.o & 1) - 0.5), ((k.o >> 1 & 1) - 0.5), ((k.o >> 2) - 0.5)];
        const p = [c0[0] + off[0] * (1 + ex * 2.4), c0[1] + off[1] * (1 + ex * 2.4), c0[2] + off[2] * (1 + ex * 2.4)];
        if (k.on){
          const c = hexOf(k.col);
          const pp = lerp3(p, c0, merged), s = lerp(1, 2, merged), cc = lerp3(c, mc, merged);
          F.cube(pp[0], pp[1], pp[2], s * (merged > 0.98 ? 1 : 0.98), cc[0], cc[1], cc[2], away, merged * 0.25);
        } else if (ex > 0.05) F.wire(p.map(v => v - 0.48), p.map(v => v + 0.48), [0.6, 0.7, 0.9, 0.6 * ex], 1.2);
      }
      const on = m.kids.filter(k => k.on).length;
      label3(F, g, [c0[0], c0[1] + 2.6, c0[2]], merged > 0.5 ? `mean of ${on} voxels` : `${on} of 8 full`, { alpha: win(t, 2.4, 3) * away, size: 12, color: merged > 0.5 ? GOLD : INK });
    }
    // the word
    const wa = fade(t, 0.6, 1.4, 7.6, 8.4);
    if (wa > 0){
      const w = rec.attr, [r6, g6, b6] = attrRGB(w), cell = 13, bw = 32 * (cell + 2);
      const [bx, by] = W >= 1100 ? [W - bw - 44, H - 236] : [44, 160];
      panel(g, bx - 18, by - 44, bw + 36, 150, { alpha: wa });
      text(g, `attribute word 0x${w.toString(16).padStart(8, '0')}`, bx, by - 18, { size: 13, weight: 650, mono: true, alpha: wa, shadow: false });
      const mc = attrCol(w);
      g.save(); g.globalAlpha = wa; g.fillStyle = `rgb(${mc.map(v => Math.round(v * 255)).join(',')})`; g.fillRect(bx + bw - 24, by - 32, 24, 18); g.restore();
      bits(g, bx, by, w, [
        { name: 'reserved', at: 24, len: 8, color: '#59627a' },
        { name: 'B', at: 18, len: 6, color: '#6aa8ff', sub: `${b6}` },
        { name: '', at: 16, len: 2, color: '#59627a' },
        { name: 'G', at: 10, len: 6, color: GREEN, sub: `${g6}` },
        { name: '', at: 8, len: 2, color: '#59627a' },
        { name: 'R', at: 2, len: 6, color: RED, sub: `${r6}` },
        { name: '', at: 0, len: 2, color: '#59627a' },
      ], { cell, alpha: wa, reveal: win(t, 0.8, 2.4) });
    }
    // the pond and the lawn
    const pa = win(t, 9.2, 10.2);
    if (pa > 0){
      for (const kind of ['pond', 'ground']){
        const b = D.blocks.find(x => x.kind === kind);
        const lo = [b.bx * 8 - 16, 0, b.bz * 8 - 16], pulse = 0.65 + 0.35 * Math.sin(t * 5);
        F.wire(lo.map((v, i) => v - 0.1), [lo[0] + 8.1, 3.4, lo[2] + 8.1], withA(C3(GOLD), pa * pulse), 2.6, { add: true });
        label3(F, g, [lo[0] + 4, 3.5, lo[2] + 4], `${kind === 'pond' ? 'pond' : 'lawn'} · node id ${b.id}`, { dy: -46, alpha: pa, color: GOLD, size: 12.5, mono: true });
      }
    }
  },
},

/* ---- 14. the colour pyramid ------------------------------------------------- */
{
  key: 'pyramid', title: 'The colour pyramid', dur: 17,
  steps: [
    [0, 'Every node of the DAG is a cell at some lod: level <i>l</i>, 2<sup>l</sup> voxels a side. Here is the town at every lod, every non-empty node drawn.'],
    [5.4, 'Each cell\'s colour is the <b>mean of the voxels under it</b>, counted. Follow the flag up: 1 voxel, then 2, 12, 131, 259, then all 5,606.'],
    [12.2, 'The DAG stores none of these colours. A job works out a cell\'s word when it draws it, so the whole pyramid costs no memory at all.'],
  ],
  cam: t => camKeys(t, [[0, { target: [-60, 16, 0], yaw: 0.42, pitch: 0.3, dist: 120 }],
                        [5, { target: [6, 22, 0], yaw: 0.2, pitch: 0.24, dist: 250 }],
                        [17, { target: [4, 24, 0], yaw: 0.02, pitch: 0.2, dist: 262 }]]),
  draw({ F, g, t, W, H, P }){
    const C = P.D.colour, off = l => [(l - 2.5) * 46, l * 9, 0];
    for (let l = 0; l <= 5; l++){
      const u = win(t, 0.3 + l * 0.65, 0.9 + l * 0.65);
      if (u <= 0) continue;
      const o = off(l);
      F.batch(P.pyrBatch[l], M4.trs(o[0], o[1], o[2], 0, back(u)));
      const n = C.pyramid[l].count;
      label3(F, g, [o[0], o[1] - 5, 18], `lod ${l} · ${fmt(n)} cell${n === 1 ? '' : 's'}`, { alpha: u, color: LOD[l] || VIOLET, size: 12, mono: true });
    }
    // one voxel's line of ancestors
    let prev = null;
    const chain = [];
    C.lineage.forEach((L, l) => {
      const t0 = 5.4 + l * 1.05, a = win(t, t0, t0 + 0.55);
      if (a <= 0) return;
      const o = off(l), s = 2 ** l, pad = 0.2 + l * 0.15;
      const lo = [o[0] + (L.X << l) - 16 - pad, o[1] + (L.Y << l) - pad, o[2] + (L.Z << l) - 16 - pad];
      const hi = lo.map(v => v + s + 2 * pad), c = lo.map((v, i) => (v + hi[i]) / 2);
      const col = attrCol(L.word), pulse = 0.75 + 0.25 * Math.sin(t * 5 - l);
      F.wire(lo, hi, [1, 0.86, 0.45, a * pulse], 2.4, { add: true, top: true });
      if (prev){
        const e = lerp3(prev, c, eio(a));
        F.seg(prev, e, [1, 0.86, 0.45, 0.9], 2.6, { add: true, top: true });
      }
      label3(F, g, [c[0], hi[1], c[2]], `${fmt(L.count)} voxel${L.count === 1 ? '' : 's'}`, { dy: -34 - (l % 2) * 18, alpha: a, color: GOLD, size: 12 });
      chain.push({ L, col, a });
      prev = c;
    });
    // the chain as swatches
    const pa = win(t, 5.6, 6.4);
    if (pa > 0){
      const x0 = 26, y0 = 72;
      panel(g, x0, y0, 268, 214, { alpha: pa });
      text(g, 'ONE VOXEL, UP THE LEVELS', x0 + 18, y0 + 30, { size: 11, weight: 700, color: DIM, alpha: pa, track: 1.2, shadow: false });
      chain.forEach(({ L, col, a }, i) => {
        const y = y0 + 52 + i * 26;
        g.save(); g.globalAlpha = pa * a; g.fillStyle = css(col); g.fillRect(x0 + 18, y - 11, 34, 16); g.restore();
        text(g, `level ${L.level}`, x0 + 62, y + 2, { size: 12.5, color: DIM, alpha: pa * a, shadow: false });
        text(g, `${fmt(L.count)} · ${attrRGB(L.word).join(' ')}`, x0 + 250, y + 2, { size: 12, mono: true, align: 'right', alpha: pa * a, shadow: false });
      });
    }
  },
},

/* ---- 15. the mean, walked ---------------------------------------------------- */
{
  key: 'walk', title: 'The mean, walked', dur: 18,
  steps: [
    [0, 'Exactly, a coarse word is 8<sup>l</sup> field calls a cell: 512 at lod 3. A job can\'t afford that, so <code>cellAttr</code> walks down only <b>meanDepth</b> levels. The viewer\'s is 1.'],
    [3.2, 'At meanDepth 1 this lod-2 cell is its eight 2³ children. Empty ones are skipped; each other one counts as its voxel count…'],
    [7.2, '…times the field at its centre. A centre reads one voxel, and here five of the eight are air, so a field must answer everywhere (the town\'s takes the nearest voxel\'s colour).'],
    [11.4, 'Summed as 8-bit floats and quantized once. Against the exact mean, every voxel weighed, this is the town\'s worst cell. Exact costs more: meanDepth 2 makes a lod-2 job 16–18× its uncoloured time.'],
  ],
  cam(t, P){
    const w = P.D.colour.walk, c = [w.X * 4 + 2 - 16, w.Y * 4 + 2, w.Z * 4 + 2 - 16];
    return camKeys(t, [[0, { target: c, yaw: 0.6, pitch: 0.5, dist: 64 }],
                       [3.2, { target: [0, 44, 0], yaw: 0.45, pitch: 0.28, dist: 64 }],
                       [10.8, { target: [0, 44, 0], yaw: 0.25, pitch: 0.24, dist: 62 }],
                       [12.6, { target: [0, 44, 0], yaw: 0.1, pitch: 0.2, dist: 78 }],
                       [18, { target: [0, 44, 0], yaw: -0.05, pitch: 0.2, dist: 76 }]]);
  },
  env: () => ({ fog: 0.0025 }),
  draw({ F, g, t, W, H, P }){
    const w = P.D.colour.walk, S = 3.2, ST = [0, 44, 0];
    const cc = [w.X * 4 + 2, w.Y * 4 + 2, w.Z * 4 + 2];                // the cell's centre, voxels
    const townAt = p => [p[0] - 16, p[1], p[2] - 16];
    const L = sm(win(t, 1.0, 3.2)), E = sm(win(t, 3.4, 5.0)) * (1 - sm(win(t, 11.4, 12.4)));
    const stageAt = (p, o) => {
      const d = o === undefined ? [0, 0, 0] : [((o & 1) - 0.5) * 2, ((o >> 1 & 1) - 0.5) * 2, ((o >> 2) - 0.5) * 2];
      return [ST[0] + (p[0] - cc[0]) * S + d[0] * E * S * 1.4, ST[1] + (p[1] - cc[1]) * S + d[1] * E * S * 1.4, ST[2] + (p[2] - cc[2]) * S + d[2] * E * S * 1.4];
    };
    F.batch(P.townBatch[0], null, { tint: [0.05, 0.06, 0.09], tintAmt: 0.55 * L });
    // the cell in the town
    const lo = townAt([w.X * 4, w.Y * 4, w.Z * 4]);
    F.wire(lo.map(v => v - 0.15), lo.map(v => v + 4.15), [1, 0.86, 0.45, 0.9], 2.2, { add: true, top: true });
    const merge = sm(win(t, 12.4, 14.2));
    const res1 = [ST[0] - 17, ST[1], ST[2]], res2 = [ST[0] + 17, ST[1], ST[2]];
    // its voxels, lifted and pulled apart by child
    const exactFly = merge;
    for (const k of w.kids) for (const v of k.vox){
      const p0 = townAt([v.x + 0.5, v.y + 0.5, v.z + 0.5]), p1 = stageAt([v.x + 0.5, v.y + 0.5, v.z + 0.5], k.o);
      let p = lerp3(p0, p1, L), s = lerp(1, S * 0.94, L);
      const c = hexOf(v.col);
      if (exactFly > 0){ p = lerp3(p, res2, eio(exactFly)); s = lerp(s, 0.6, exactFly); }
      if (exactFly < 1) F.cube(p[0], p[1], p[2], s, c[0], c[1], c[2], 1, 0.05);
    }
    // children: boxes, counts, sample points, chips
    const sa = win(t, 7.2, 8.2);
    for (let o = 0; o < 8; o++){
      const k = w.kids.find(q => q.o === o);
      const corner = [w.X * 4 + 2 * (o & 1), w.Y * 4 + 2 * (o >> 1 & 1), w.Z * 4 + 2 * (o >> 2)];
      const a = stageAt(corner, o), b = stageAt(corner.map(v => v + 2), o);
      const ba = win(t, 3.6, 4.6) * (1 - win(t, 11.6, 12.4));
      if (ba <= 0) continue;
      if (!k){
        F.wire(a, b, [1, 0.42, 0.48, 0.5 * ba], 1.2);
        label3(F, g, lerp3(a, b, 0.5), 'empty · skipped', { alpha: ba * 0.85, size: 10.5, color: RED });
        continue;
      }
      F.wire(a, b, [0.55, 0.85, 1, 0.75 * ba], 1.5);
      label3(F, g, [lerp(a[0], b[0], 0.5), b[1], lerp(a[2], b[2], 0.5)], `count ${k.count}`, { dy: -14, alpha: ba * win(t, 4.4, 5.2), size: 11, color: ACCENT, mono: true });
      if (sa > 0){
        const sp = stageAt(k.sample, o), rv = stageAt(k.sample.map(v => v + 0.5), o);
        F.cube(sp[0], sp[1], sp[2], 0.55 + 0.15 * Math.sin(t * 6 + o), 1, 1, 1, ba, 1.8);
        F.seg(sp, rv, [1, 1, 1, 0.7 * sa * ba], 1.4, { top: true });
        if (k.sampleAir) F.wire(rv.map(v => v - S / 2), rv.map(v => v + S / 2), [1, 1, 1, 0.55 * sa * ba], 1.2, { top: true });
        // the chip: what this child adds, count × colour
        const c = hexOf(k.sampleCol), u = win(t, 8.0 + o * 0.12, 8.7 + o * 0.12);
        let cp = [lerp(a[0], b[0], 0.5), b[1] + 2.2, lerp(a[2], b[2], 0.5)];
        const m = sm(win(t, 11.4 + o * 0.06, 12.8 + o * 0.06));
        cp = lerp3(cp, res1, m);
        if (u > 0 && merge < 1) F.box(cp[0], cp[1], cp[2], 2.2 * back(u) * (1 - m * 0.6), 0.5 + 1.2 * k.count / 8, 2.2 * back(u) * (1 - m * 0.6), c[0], c[1], c[2], 1, 0.15);
        if (k.sampleAir && k === w.kids.find(q => q.sampleAir)) label3(F, g, rv, 'centre in air → the nearest voxel\'s colour', { dx: -60, dy: 70, alpha: sa * ba * (1 - m), size: 11, color: INK });
      }
    }
    // the two results
    const ra = win(t, 13.2, 14.4);
    if (ra > 0){
      const c1 = attrCol(w.md1), c2 = attrCol(w.exact), s = 6 * back(ra);
      F.cube(res1[0], res1[1], res1[2], s, c1[0], c1[1], c1[2], 1, 0.08);
      F.cube(res2[0], res2[1], res2[2], s, c2[0], c2[1], c2[2], 1, 0.08);
      label3(F, g, [res1[0], res1[1] + 5, res1[2]], `meanDepth 1 · 8 samples · ${attrRGB(w.md1).join(' ')}`, { dy: -18, alpha: ra, size: 12, color: ACCENT, mono: true });
      label3(F, g, [res2[0], res2[1] + 5, res2[2]], `exact · ${w.count} voxels · ${attrRGB(w.exact).join(' ')}`, { dy: -18, alpha: ra, size: 12, color: GOLD, mono: true });
    }
    // the sum, child by child
    const pa = win(t, 8.2, 9.0);
    if (pa > 0){
      const x0 = W - 300, y0 = 86, rows = w.kids;
      panel(g, x0, y0, 268, 70 + rows.length * 21 + 58, { alpha: pa });
      text(g, 'cellAttr · LOD 2 · MEANDEPTH 1', x0 + 18, y0 + 30, { size: 11, weight: 700, color: DIM, alpha: pa, track: 1, shadow: false });
      rows.forEach((k, i) => {
        const y = y0 + 54 + i * 21, c = hexOf(k.sampleCol);
        g.save(); g.globalAlpha = pa; g.fillStyle = css(c); g.fillRect(x0 + 18, y - 10, 22, 13); g.restore();
        text(g, `child ${k.o}`, x0 + 50, y + 1, { size: 12, color: DIM, alpha: pa, shadow: false });
        text(g, k.sampleAir ? 'air' : 'voxel', x0 + 118, y + 1, { size: 11.5, color: k.sampleAir ? PINK : FAINT, alpha: pa, shadow: false, mono: true });
        text(g, `× ${k.count}`, x0 + 250, y + 1, { size: 12.5, mono: true, align: 'right', alpha: pa, shadow: false });
      });
      const y = y0 + 54 + rows.length * 21 + 10;
      const [p, q] = [attrRGB(w.md1), attrRGB(w.exact)];
      text(g, `÷ ${w.count} voxels → ${p.join(' ')}`, x0 + 18, y, { size: 12.5, mono: true, color: ACCENT, alpha: pa, shadow: false });
      text(g, `exact ${q.join(' ')} · off by ${q.map((v, i) => Math.abs(v - p[i])).join(' / ')}`, x0 + 18, y + 22, { size: 12, mono: true, color: GOLD, alpha: pa * win(t, 13.2, 14), shadow: false });
    }
  },
},

/* ---- 16. baked: a word per skin voxel ------------------------------------------ */
{
  key: 'baked', title: 'Baked: a word per voxel', dur: 18,
  steps: [
    [0, 'An imported asset brings its own colours, one word for each voxel that can show: the <b>skin</b>. Inside voxels get none. This town\'s skin is 3,932 of its 5,606 voxels.'],
    [3.6, 'The words are kept in <b>rank order</b>, the skin\'s Morton order, the order a depth-first walk meets them. No coordinates are stored. Drawn 64 a row, as the block sums count them.'],
    [9.6, 'To find a voxel\'s word, walk down the skin and add up the voxel counts of the octants passed over. The sum is its rank; <code>words[rank]</code> is its colour.'],
    [15.6, 'Asked in Morton order, as a job asks, a walk starts where the last one could be trusted (the path memo): about one child read a voxel instead of D.'],
  ],
  cam: t => camKeys(t, [[0, { target: [-36, 12, 0], yaw: 0.55, pitch: 0.4, dist: 82 }],
                        [3.6, { target: [8, 17, 0], yaw: 0.14, pitch: 0.18, dist: 134 }],
                        [9.4, { target: [6, 16, 0], yaw: 0.2, pitch: 0.2, dist: 132 }],
                        [18, { target: [4, 16, 0], yaw: 0.3, pitch: 0.24, dist: 130 }]]),
  env: () => ({ fog: 0.0018 }),
  draw({ F, g, t, W, H, P }){
    const C = P.D.colour, TO = BAKE_TOWN, n = C.skinCount;
    // the town: a cut opens it, the inside goes, the skin stays
    const zc = lerp(17, 0, sm(win(t, 0.4, 1.6))) + lerp(0, 17, sm(win(t, 3.0, 3.8)));
    const gone = sm(win(t, 1.6, 2.8));
    const k = n * eio(win(t, 3.6, 9.4));
    for (let i = 0; i < n; i++){
      const q = P.skinCells[i];
      if (q.p[2] > zc) continue;
      const lit = i < k ? clamp(1 - (k - i) / 220) : 0;
      F.cube(q.p[0] + TO[0], q.p[1], q.p[2] + TO[2], 1, q.c[0], q.c[1], q.c[2], 1, lit * 0.9);
    }
    for (const b of P.D.townJobs[0].buried){
      const p = [b[0] + 0.5 - 16 + TO[0], b[1] + 0.5, b[2] + 0.5 - 16 + TO[2]];
      if (p[2] - TO[2] > zc || gone >= 1) continue;
      const s = 1 - gone;
      F.cube(p[0], p[1] - gone * 2, p[2], s, 0.95, 0.35, 0.42, 1, 0.5);
    }
    // the wall of words, written in rank order
    drawWall(F, P, { upto: k, dim: () => 1, glow: i => i < k ? clamp(1 - (k - i) / 90) * 1.2 : 0 });
    if (k > 1 && k < n){
      const lo = Math.max(1, Math.floor(k) - 360);
      for (let i = lo; i < Math.floor(k); i++){
        const a = P.skinCells[i - 1].p, b = P.skinCells[i].p, h = 1 - (k - i) / 360;
        F.seg([a[0] + TO[0], a[1], a[2] + TO[2]], [b[0] + TO[0], b[1], b[2] + TO[2]], withA(lerp3(C3(ACCENT), C3(PINK), h), 0.2 + 0.8 * h), 1 + 1.6 * h, { add: true, top: true });
      }
      const q = P.skinCells[Math.floor(k)].p, wp = wallAt(Math.floor(k));
      F.seg([q[0] + TO[0], q[1], q[2] + TO[2]], wp, [1, 0.8, 0.95, 0.55], 1.4, { add: true, top: true });
    }
    const wa = win(t, 4, 5);
    label3(F, g, [WALL0[0] + 29, WALL0[1] + 3, WALL0[2]], `words[0 … ${fmt(n - 1)}] · rank order · 64 a row`, { alpha: wa, size: 12, color: INK });
    label3(F, g, [TO[0], -3, 18], `skin · ${fmt(n)} voxels`, { alpha: win(t, 2.8, 3.6), size: 12, color: INK });
    // the rank walk of the flag
    const T0 = 9.8, step = 1.15;
    let sum = 0;
    const rows = [];
    C.trace.forEach((s, j) => {
      const t0 = T0 + j * step, a = win(t, t0, t0 + 0.4), out = 1 - win(t, t0 + step + 0.2, t0 + step + 0.6);
      if (a <= 0) return;
      sum += s.add; rows.push(s);
      if (out <= 0) return;
      const h = 2 ** (s.level - 1), al = a * out;
      const box = (c, size, col, w, fill) => {
        const lo = [c[0] - 16 + TO[0], c[1], c[2] - 16 + TO[2]], hi = [lo[0] + size, lo[1] + size, lo[2] + size];
        F.wire(lo, hi, col, w, { add: true, top: true });
        if (fill) F.box((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2, size, size, size, fill[0], fill[1], fill[2], 0.16 * al, 0.6);
      };
      box(s.corner, 2 * h, [1, 1, 1, 0.65 * al], 1.6);
      for (const b of s.before){
        const c = [s.corner[0] + (b.o & 1) * h, s.corner[1] + (b.o >> 1 & 1) * h, s.corner[2] + (b.o >> 2) * h];
        if (b.n) box(c, h, [1, 0.82, 0.4, 0.8 * al], 1.4, [1, 0.8, 0.35]);
        if (b.n && h >= 4) label3(F, g, [c[0] + h / 2 - 16 + TO[0], c[1] + h / 2, c[2] + h / 2 - 16 + TO[2]], `+${fmt(b.n)}`, { alpha: al, size: 11, color: GOLD, mono: true });
      }
      const tc = [s.corner[0] + (s.o & 1) * h, s.corner[1] + (s.o >> 1 & 1) * h, s.corner[2] + (s.o >> 2) * h];
      box(tc, h, [0.4, 0.85, 1, al], 2.4);
    });
    const fa = win(t, T0 + 5 * step, T0 + 5 * step + 0.6);
    if (fa > 0){
      const f = C.flag, fp = [f[0] + 0.5 - 16 + TO[0], f[1] + 0.5, f[2] + 0.5 - 16 + TO[2]], wp = wallAt(C.rank);
      F.cube(fp[0], fp[1], fp[2], 1.5 + 0.3 * Math.sin(t * 6), 1, 0.85, 0.4, 1, 1.4);
      F.seg(fp, lerp3(fp, wp, eio(fa)), [1, 0.85, 0.4, 0.9], 2.4, { add: true, top: true });
      if (fa >= 1) F.box(wp[0], wp[1], wp[2] + 0.4, 1.9, 1.9, 0.6, 1, 0.85, 0.4, 1, 1.4);
    }
    const pa = win(t, T0, T0 + 0.6);
    if (pa > 0){
      const x0 = 26, y0 = 72;
      panel(g, x0, y0, 268, 214, { alpha: pa });
      text(g, 'THE FLAG\'S RANK', x0 + 18, y0 + 30, { size: 11, weight: 700, color: DIM, alpha: pa, track: 1.2, shadow: false });
      rows.forEach((s, j) => {
        const y = y0 + 54 + j * 22;
        text(g, `level ${s.level} · octant ${s.o}`, x0 + 18, y, { size: 12.5, color: DIM, alpha: pa, shadow: false });
        text(g, `+${fmt(s.add)}`, x0 + 250, y, { size: 12.5, mono: true, color: GOLD, align: 'right', alpha: pa, shadow: false });
      });
      if (fa > 0){
        const y = y0 + 54 + 5 * 22 + 6, w = C.words[C.rank];
        text(g, `rank ${fmt(C.rank)} → words[${fmt(C.rank)}]`, x0 + 18, y, { size: 12.5, mono: true, color: INK, alpha: pa * fa, shadow: false });
        g.save(); g.globalAlpha = pa * fa; g.fillStyle = css(hexOf(w)); g.fillRect(x0 + 226, y - 11, 24, 15); g.restore();
      }
    }
  },
},

/* ---- 17. a cell is a range -------------------------------------------------------- */
{
  key: 'range', title: 'A cell is a range', dur: 17,
  steps: [
    [0, 'A cell\'s skin is one subtree, and a subtree is <b>one run of ranks</b>. This house brick\'s skin is words [248, 489).'],
    [3.8, 'So its mean is a range sum. A running sum every 64 words (the <b>block sums</b>, 0.4 bytes a word) covers the whole rows in two reads; only the ends are scanned, never more than 126 words.'],
    [9.4, 'One division of exact integers: the same float as adding all 241 words one by one, at every lod. A cell with no skin takes its nearest ancestor\'s mean, never climbing out of its own chunk.'],
    [13.6, 'The DAG still holds only shape. Colour rides beside it, a skin and a list of words, and every coarse colour is worked out from them exactly.'],
  ],
  cam: t => camKeys(t, [[0, { target: [4, 16, 0], yaw: 0.3, pitch: 0.24, dist: 130 }],
                        [3.8, { target: [38, 47, 0], yaw: 0.1, pitch: 0.1, dist: 74 }],
                        [9.2, { target: [36, 47, 0], yaw: 0.04, pitch: 0.1, dist: 76 }],
                        [11, { target: [-4, 16, 0], yaw: 0.3, pitch: 0.24, dist: 124 }],
                        [17, { target: [-4, 16, 0], yaw: 0.4, pitch: 0.28, dist: 120 }]]),
  env: () => ({ fog: 0.0018 }),
  draw({ F, g, t, W, H, P }){
    const C = P.D.colour, Rg = C.range, TO = BAKE_TOWN, n = C.skinCount;
    const r0 = Rg.start, r1 = Rg.start + Rg.n, A = Rg.A * 64, B = Rg.B * 64;
    const hl = win(t, 0.6, 1.6);
    const inRange = i => i >= r0 && i < r1;
    // the brick in the town
    const hb = Rg.block, blo = [hb.bx * 8 - 16 + TO[0], hb.by * 8, hb.bz * 8 - 16 + TO[2]];
    const fly = sm(win(t, 9.6, 11.4)), land = sm(win(t, 11.2, 12.4));
    for (let i = 0; i < n; i++){
      const q = P.skinCells[i], inb = inRange(i);
      if (inb && land > 0.98) continue;
      const d = inb ? 1 : 1 - 0.6 * hl;
      F.cube(q.p[0] + TO[0], q.p[1], q.p[2] + TO[2], inb ? 1 - land : 1, q.c[0] * d, q.c[1] * d, q.c[2] * d, 1, inb ? hl * 0.35 : 0);
    }
    const pulse = 0.7 + 0.3 * Math.sin(t * 5);
    F.wire(blo.map(v => v - 0.15), blo.map(v => v + 8.15), [1, 0.86, 0.45, hl * pulse * (1 - land * 0.5)], 2.4, { add: true, top: true });
    // the wall, the run lit; scanned ends sweep, whole rows by block sums
    const scan = win(t, 5.6, 8.8), nh = Rg.head, nt = Rg.tail;
    const scanned = i => (i >= r0 && i < A && (i - r0) < scan * nh) || (i >= B && i < r1 && (i - B) < scan * nt);
    drawWall(F, P, {
      upto: n,
      dim: i => inRange(i) ? 1 : 1 - 0.75 * hl,
      glow: i => scanned(i) ? 1.4 : inRange(i) ? 0.25 * hl : 0,
    });
    // rows summed by the block sums: a frame round them, and the two sums read
    const ra = win(t, 4.2, 5.0) * (1 - win(t, 9.4, 10));
    if (ra > 0){
      const a = wallAt(A), b = wallAt(B - 1);
      F.wire([WALL0[0] - 0.7, b[1] - 0.6, WALL0[2] - 0.3], [WALL0[0] + 64 * WPITCH - 0.2, a[1] + 0.6, WALL0[2] + 0.6], [1, 0.86, 0.45, ra], 2.2, { add: true, top: true });
      label3(F, g, [WALL0[0] - 1, (a[1] + b[1]) / 2, WALL0[2]], `rows ${Rg.A}–${Rg.B - 1}: S[${Rg.B}] − S[${Rg.A}]`, { dx: -96, alpha: ra, size: 12, color: GOLD, mono: true });
    }
    // block sums: a ramp, one bar a row boundary
    const bx0 = WALL0[0] + 64 * WPITCH + 1.4, ba = win(t, 3.8, 4.6);
    for (let k = 0; k < P.prefix.length; k++){
      const y = WALL0[1] + WPITCH / 2 - k * WPITCH, len = 7 * k / (P.prefix.length - 1), c = P.prefix[k];
      const on = k === Rg.A || k === Rg.B;
      const u = clamp(ba * 1.5 - k / P.prefix.length * 0.5);
      if (u <= 0 || len <= 0) continue;
      F.box(bx0 + len * u / 2, y, WALL0[2], len * u, WPITCH * 0.42, 0.3, c[0], c[1], c[2], 1, on ? 1.2 * ra + 0.1 : 0.05);
      if (on && ra > 0) label3(F, g, [bx0 + len + 0.6, y, WALL0[2]], `S[${k}]`, { dx: 30, alpha: ra, size: 11, color: GOLD, mono: true });
    }
    label3(F, g, [bx0 + 4, WALL0[1] + 3, WALL0[2]], 'block sums', { alpha: ba, size: 11.5, color: DIM });
    // the mean: the run collapses to one colour, which lands on the brick
    const mc = [Rg.mean[0] / 255, Rg.mean[1] / 255, Rg.mean[2] / 255];
    const mid = wallAt(Math.floor((r0 + r1) / 2)), bc = blo.map(v => v + 4);
    if (fly > 0){
      const p = land > 0 ? lerp3([mid[0], mid[1] + 2, mid[2] + 2], bc, eio(land)) : [mid[0], mid[1] + 2 * fly, mid[2] + 2 * fly];
      const s = lerp(lerp(1, 3.2, fly), 8, land);
      F.cube(p[0], p[1], p[2], s, mc[0], mc[1], mc[2], 1, (1 - land) * 0.5);
    }
    if (land > 0.5) label3(F, g, [bc[0], blo[1] + 8, bc[2]], `one level-3 cell · ${Rg.mean.map(v => v.toFixed(2)).join(', ')}`, { dy: -40, alpha: win(t, 12, 12.8), size: 12, color: GOLD, mono: true });
    // the cost
    const pa = win(t, 0.8, 1.6);
    if (pa > 0){
      const x0 = 26, y0 = 72;
      panel(g, x0, y0, 268, 172, { alpha: pa });
      table(g, x0 + 18, y0 + 30, 232, [
        ['ranks', `[${fmt(r0)}, ${fmt(r1)})`, INK],
        ['words', fmt(Rg.n), INK],
        ['block-sum reads', Rg.rows ? '2' : '0', GOLD, win(t, 4.2, 5)],
        ['words scanned', `${Rg.head} + ${Rg.tail}`, ACCENT, win(t, 5.6, 6.4)],
        ['mean = Σ ÷ n', Rg.mean.map(v => v.toFixed(1)).join(' '), INK, win(t, 9.6, 10.4)],
      ], { alpha: pa, title: 'baked.mean(3, …)' });
    }
  },
},

/* ---- 18. finale ------------------------------------------------------------------------------------- */
{
  key: 'finale', title: 'All together', dur: 17,
  steps: [
    [0, 'Put together: 728 nodes hold 22,962,176 voxels, and the cut, the jobs and the cache draw them as you fly.'],
  ],
  eyeAt(t, P){
    const [fx, fz] = P.focus, c = [fx * 32 + 16, 0, fz * 32 + 16];
    const u = t / 17;
    const a = -0.6 + u * 1.9;
    return [c[0] + Math.cos(a) * 340 - 120, 52 + 34 * Math.sin(u * Math.PI), c[2] + Math.sin(a) * 340 - 80];
  },
  cam(t, P){
    const e = this.eyeAt(t, P), f = this.eyeAt(t + 1.2, P);
    const es = add3(e, P.woff), fs = add3(f, P.woff);
    return { eye: es, target: [fs[0], fs[1] - 22, fs[2]], dist: 60, near: 0.6, far: 9000, fov: 0.95 };
  },
  env: () => ({ fog: 0.0011, grid: 0 }),
  draw({ F, g, t, W, H, P }){
    const st = drawCut(P, F, this.eyeAt(t, P), { detail: 1, boxes: 0.0 });
    const a = win(t, 9, 10.5);
    if (a > 0){
      g.save(); g.globalAlpha = a * 0.55; const gr = g.createLinearGradient(0, H * 0.1, 0, H * 0.6);
      gr.addColorStop(0, 'rgba(5,7,12,0.95)'); gr.addColorStop(1, 'rgba(5,7,12,0)'); g.fillStyle = gr; g.fillRect(0, 0, W, H * 0.6); g.restore();
      text(g, 'vdag', W / 2, H * 0.22, { size: Math.min(88, W * 0.15), weight: 800, align: 'center', alpha: a, track: -2 });
      text(g, 'hash-consed · streamed · drawn', W / 2, H * 0.22 + 38, { size: 18, weight: 500, color: DIM, align: 'center', alpha: a });
      text(g, 'every number in this film was computed live by dag-core.js, chunk-core.js and stream-core.js',
           W / 2, H * 0.22 + 68, { size: 12.5, weight: 600, color: ACCENT, align: 'center', alpha: win(t, 10.5, 12), track: 0.3 });
    }
    const x0 = W - 250, y0 = 86;
    panel(g, x0, y0, 218, 98, { alpha: 1 - a * 0.6 });
    table(g, x0 + 18, y0 + 30, 182, [['chunks', fmt(st.leaves), INK], ['faces', fmt(st.faces), ACCENT]], { title: 'THIS FRAME', alpha: 1 - a * 0.6 });
  },
},
];

/* Chunks the world chapters will ask for, so they can be made ahead. */
export function prefetchList(P){
  const out = [];
  for (const sc of SCENES) if (sc.eyeAt){
    for (let t = 0; t <= sc.dur; t += 0.35){
      const sel = P.D.select(sc.eyeAt(t, P), { detail: 1, maxChunks: 1024 });
      out.push(...sel.leaves);
    }
  }
  return out;
}
