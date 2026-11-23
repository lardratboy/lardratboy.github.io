/* ================== THE CHAPTERS =======================================
   Each chapter is { key, stage, title, dur, side?, steps, cam(t), env(t)?,
   draw(c) } (animation/scenes.js's shape):
   - stage is the pipeline map's stage it lights (ui.js's STAGES);
   - side: the picture slides left for the code panel (main.js's layout);
   - cam(t) gives the camera at the chapter's own time t (seconds);
   - steps are the caption's paragraphs, each from its start time, or a
     function of the data that returns them, so captions carry live numbers;
   - draw(c) fills the frame: c.F builds the 3D frame (records drawn the
     viewer's way, cubes, lines), c.g is the 2D overlay, c.t the time.
   Everything is a function of t, so scrubbing and stepping back are exact.

   Coordinates: a world voxel v sits at v − (128, 0, 128) in the scene, so
   the kit stands centred on the floor grid.
   ======================================================================== */
import { M4 } from './gl.js';
import { FACE_OFF, CUBE_INDEX } from './gl.js';
import { snippet } from './code.js';
import { mortonXYZ, cellOf, maskOf, poseOf, nodeAt, quadsShown, boundaryBits } from '../chunk-core.js';
import { coverOf, selectChunks, keyOf, DEFAULTS } from '../stream-core.js';
import { attrRGB } from '../attr-core.js';
import { FILM_DETAIL, FOCUS, SIDE_NAMES, STREAM } from './data.js';
import { text, panel, pill, label3, screenOf, bits, table, fmt, rgb01, measure, css,
         INK, DIM, FAINT, ACCENT, PINK, GOLD, GREEN, RED, VIOLET, LOD,
         MAIN, WORKER, GPU, LANES, STAGES, drawMap, mapPos, codePanel, card, strip, arrow, along, dot2, roundRect } from './ui.js';

/* ---- easing and time ------------------------------------------------------ */
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const win = (t, a, b) => clamp((t - a) / (b - a));
const sm = x => x * x * (3 - 2 * x);
const eo = x => 1 - (1 - x) ** 3;
const eio = x => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
const lerp = (a, b, u) => a + (b - a) * u;
const lerp3 = (a, b, u) => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const fade = (t, a, b, c, d) => Math.min(win(t, a, b), 1 - win(t, c, d));
const hex = (v, n = 8) => '0x' + (v >>> 0).toString(16).padStart(n, '0');
const bin = (v, n) => (v >>> 0).toString(2).padStart(n, '0');
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
// The step whose time has come: steps [[t0, v], ...].
const stepAt = (t, steps) => { let v = steps[0][1]; for (const [t0, x] of steps) if (t >= t0) v = x; return v; };

const W2S = v => [v[0] - 128, v[1], v[2] - 128];
const BG = [0.035, 0.045, 0.07];
const lodCol = l => rgb01(LOD[l] || LOD[LOD.length - 1]);
const FACE6 = ['#ff6b7d', '#ffa25c', '#8fe388', '#d6f07a', '#5ad1ff', '#b69cff'];   // +X −X +Y −Y +Z −Z
const C4 = (c, a) => [c[0], c[1], c[2], a];
const k = n => n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'K' : fmt(n);
const bytes = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? (n / 1024).toFixed(1) + ' KB' : n + ' B';

/* ---- what every chapter shares ------------------------------------------------ */
export function prepare(R, D){
  const P = { R, D };
  Object.assign(R.env, { fog: 0.0011, fogCol: BG, top: [0.02, 0.026, 0.045], horizon: [0.06, 0.075, 0.11], bottom: [0.03, 0.035, 0.05],
                         grid: 1, gridY: -0.02, gridStep: 16, gridFade: 900, gridCol: [0.25, 0.55, 0.75], edge: 1 });
  // Every job's records, uploaded the way install() does it.
  P.batch = new Map();
  for (const j of D.jobs.values()) P.batch.set(j.key, R.makeRecordBatch(j.records, j.attrs));
  P.lod0 = [...D.jobs.values()].filter(j => j.lod === 0).map(j => j.key);
  P.job = key => D.jobs.get(key);

  // The focus chunk: its records batch is the job's; its cells in walk order
  // as records with all six faces; the apron as plain cubes.
  const F = P.F = D.focus, fj = F.job;
  P.forigin = W2S(fj.lo);
  P.fcentre = add3(P.forigin, [32, 32, 32]);
  P.cells = R.makeRecordBatch(F.all, null);
  const SIDE_COL = [RED, RED, GREEN, GREEN, ACCENT, ACCENT].map(rgb01);
  const ap = [];
  for (const a of F.apron) for (const c of a.cells) ap.push({ p: add3(P.forigin, [c[0] + 0.5, c[1] + 0.5, c[2] + 0.5]), c: SIDE_COL[a.side] });
  const inst = new Float32Array(ap.length * 11);
  ap.forEach((q, i) => inst.set([q.p[0], q.p[1], q.p[2], 0.92, 0.92, 0.92, q.c[0], q.c[1], q.c[2], 1, 0.35], i * 11));
  P.apron = R.makeBatch(inst);
  P.apronCount = ap.length;
  const r = F.record;
  P.rpos = add3(P.forigin, [r.x + 0.5, r.y + 0.5, r.z + 0.5]);

  // The path from the root to one voxel: root, level 7, the chunk (level 6),
  // the record's 8³ brick (level 3) and the voxel itself.
  const wv = [fj.lo[0] + r.x, fj.lo[1] + r.y, fj.lo[2] + r.z];
  const brickId = nodeAt(D.store, D.root, D.D, 3, wv[0] >> 3, wv[1] >> 3, wv[2] >> 3);
  P.pathBoxes = [
    ...F.path.map(s => ({ level: s.level, id: s.id, lo: s.lo, size: s.size, o: s.o })),
    { level: 6, id: F.node, lo: fj.lo, size: 64, o: null },
    { level: 3, id: brickId, lo: wv.map(v => v & ~7), size: 8, o: null },
    { level: 0, id: 1, lo: wv, size: 1, o: null },
  ];
  // A FULL node (id 1) has no row of its own: every child of it is FULL.
  P.rows = P.pathBoxes.slice(0, 4).map(b => ({ id: b.id, level: b.level,
    kids: Array.from({ length: 8 }, (_, o) => b.id < 2 ? b.id : D.store.child(b.id, o)), voxels: D.counts.of(b.id) }));

  // The draw chapter's viewer camera: an eye on the ground looking across the
  // world, its cover with everything resident, ordered and culled as
  // renderView does (frustumPlanes and boxVisible are the page's, copied).
  const veye = [40, 50, 30], vlook = [200, 30, 230];
  const sel = selectChunks(D.world, veye, { detail: FILM_DETAIL });
  const cover = coverOf(sel, () => true);
  const M = M4.mul(M4.persp(0.9, 16 / 9, 0.5, 700), M4.lookAt(veye, vlook));
  const planes = frustumPlanes(M);
  const list = cover.draw.map(d => {
    const rel = sub3(d.lo, veye);
    return { d, rel, dist: Math.hypot(rel[0] + d.size / 2, rel[1] + d.size / 2, rel[2] + d.size / 2), vis: boxVisible(planes, rel.map((v, i) => v + veye[i]), d.size) };
  }).sort((a, b) => a.dist - b.dist);
  P.view = { eye: veye, look: vlook, M, list, drawn: list.filter(q => q.vis), culled: list.filter(q => !q.vis) };

  // A buffer handed to postMessage with its buffer in the transfer list is
  // detached at once. Measured here, in this page, on a copy of the focus
  // chunk's records (Node has MessageChannel too).
  try {
    const copy = new Uint32Array(fj.records), before = copy.byteLength, ch = new MessageChannel();
    ch.port1.postMessage({ records: copy }, [copy.buffer]);
    P.detached = { before, after: copy.byteLength, length: copy.length };
    ch.port1.close(); ch.port2.close();
  } catch (e){ P.detached = null; }

  // Where the stream replay is at the chapter's time: slow round each burst of
  // jobs (the world arriving in frames 0–5, then the cut changing at 30, 45, 51
  // and 93; data.js's flight), quick between them. [chapter s, frame] keys.
  P.skeys = [[0, 0], [9, 6], [12.5, 29], [15.5, 33], [18, 44], [22, 53], [25, 92], [28, 97], [32, D.stream.frames.length - 1]];
  const seg = t => { const K = P.skeys; let i = 0; while (i + 2 < K.length && t >= K[i + 1][0]) i++; return i; };
  P.sframe = t => {
    const K = P.skeys, i = seg(t);
    return clamp(lerp(K[i][1], K[i + 1][1], clamp((t - K[i][0]) / (K[i + 1][0] - K[i][0]))), 0, D.stream.frames.length - 1);
  };
  // How much slower than real time the replay runs at t.
  P.sslow = t => { const K = P.skeys, i = seg(t); return (K[i + 1][0] - K[i][0]) / ((K[i + 1][1] - K[i][1]) * D.stream.frameMs / 1000); };
  return P;
}
function frustumPlanes(M){
  const r = i => [M[i], M[4 + i], M[8 + i], M[12 + i]];
  const r0 = r(0), r1 = r(1), r2 = r(2), r3 = r(3), out = [];
  for (const [a, sgn] of [[r0, 1], [r0, -1], [r1, 1], [r1, -1], [r2, 1], [r2, -1]])
    out.push(r3.map((v, i) => v + sgn * a[i]));
  return out;
}
function boxVisible(planes, lo, size){
  for (const p of planes){
    const x = lo[0] + (p[0] > 0 ? size : 0), y = lo[1] + (p[1] > 0 ? size : 0), z = lo[2] + (p[2] > 0 ? size : 0);
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
  }
  return true;
}

/* ---- shared drawing ------------------------------------------------------------- */
function chunk(c, key, o = {}){
  const j = c.P.job(key);
  if (!j) return;
  c.F.records(c.P.batch.get(key), W2S(j.lo), j.cellSize, o);
}
function world(c, o = {}){ for (const key of c.P.lod0) chunk(c, key, o); }
const dimWorld = (c, amt = 0.62) => world(c, { tint: BG, tintAmt: amt });
function box(F, lo, size, col, a = 1, w = 1.5, opts){
  const s = W2S(lo);
  F.wire(s, add3(s, [size, size, size]), C4(col, a), w, opts);
}
// The map, small, at the top: the chapter's stage lit.
function mini(c, key){
  if (c.W < 760) return;
  const w = Math.min(560, c.W - 480);
  drawMap(c.g, (c.W - w) / 2, 18, w, { active: key, alpha: 0.95 });
}
function code(c, name, { hl = null, span = 1, alpha = 1, y = null, note = null, maxLines = 30, w = null } = {}){
  const L = c.P.lay;
  if (L.narrow) return 0;
  const s = snippet(c.D.src, name);
  const line = typeof hl === 'string' ? s.hl?.(hl) ?? -1 : hl;
  return codePanel(c.g, s, L.codeX, y ?? L.codeY, w ?? L.codeW, { alpha, hl: line, span, note, maxLines });
}
// A highlight that walks through substrings: [[t, 'sub', span?], ...] → { hl, span } eased.
function hlWalk(c, name, t, steps){
  const s = snippet(c.D.src, name);
  if (!s.hl) return { hl: null };
  let i = 0;
  while (i + 1 < steps.length && t >= steps[i + 1][0]) i++;
  const a = s.hl(steps[i][1]);
  const span = steps[i][2] || 1;
  if (i + 1 < steps.length){
    const [t1, sub] = steps[i + 1], b = s.hl(sub), u = eio(win(t, t1 - 0.35, t1));
    if (u > 0 && b >= 0 && a >= 0) return { hl: a + (b - a) * u, span };
  }
  return { hl: a, span };
}
function codeWalk(c, name, t, steps, o = {}){
  const h = hlWalk(c, name, t, steps);
  return code(c, name, { ...o, hl: h.hl, span: h.span });
}
const left = c => c.P.lay.narrow ? c.W : c.P.lay.leftW;
// A table on a glass panel, for where it sits over the world.
function tableP(g, x, y, w, rows, o = {}){
  const a = o.alpha ?? 1, line = o.line ?? 22;
  panel(g, x - 14, y - 24, w + 28, (rows.length + (o.title ? 1 : 0)) * line + 22, { alpha: a });
  return table(g, x, y, w, rows, o);
}
const backdrop = (g, x, y, w, h, a) => panel(g, x - 14, y - 14, w + 28, h + 28, { alpha: a });
// A box in the overlay with a title and a lane colour.
function chip(g, x, y, w, h, title, sub, col, alpha = 1, glow = 0){
  if (alpha <= 0.003) return;
  panel(g, x, y, w, h, { alpha, stroke: css(rgb01(col), 0.5 + 0.4 * glow), fill: `rgba(12, 16, 26, ${0.78})` });
  if (glow > 0){ g.save(); g.globalAlpha = alpha * glow * 0.5; g.shadowColor = col; g.shadowBlur = 22; g.strokeStyle = col; roundRect(g, x, y, w, h, 14); g.stroke(); g.restore(); }
  text(g, title, x + 14, y + 22, { size: 12.5, weight: 700, color: col, alpha, mono: true, shadow: false });
  if (sub) text(g, sub, x + 14, y + 40, { size: 11.5, weight: 500, color: DIM, alpha, shadow: false });
}
function mortonBits(g, x, y, idx, { alpha = 1, cell = 16 } = {}){
  const AX = [RED, GREEN, ACCENT], NAME = ['x', 'y', 'z'];
  for (let i = 0; i < 18; i++){
    const b = 17 - i, ax = b % 3, on = idx >> b & 1, xx = x + i * (cell + 3);
    g.save(); g.globalAlpha = alpha;
    roundRect(g, xx, y, cell, cell * 1.3, 3);
    g.fillStyle = on ? AX[ax] : 'rgba(255,255,255,0.04)'; g.fill();
    g.strokeStyle = AX[ax]; g.lineWidth = 1; g.stroke(); g.restore();
    text(g, on ? '1' : '0', xx + cell / 2, y + cell * 0.88, { size: cell * 0.6, weight: 700, color: on ? '#0b0f18' : 'rgba(233,238,251,0.5)', align: 'center', mono: true, shadow: false, alpha });
    text(g, NAME[ax] + ((b / 3) | 0), xx + cell / 2, y + cell * 1.3 + 14, { size: 10, weight: 600, color: AX[ax], align: 'center', mono: true, shadow: false, alpha });
  }
  return 18 * (cell + 3);
}

/* ---- the chapters ------------------------------------------------------------- */
export const SCENES = [
/* 1 ------------------------------------------------------------------------------ */
{
  key: 'map', stage: null, title: 'Three places, one road', dur: 17,
  steps: (P, D) => [
    [0, `The stream viewer turns a world file into pixels in three places. The <b>main thread</b> decides, four <b>workers</b> build, the <b>GPU</b> draws.`],
    [5.5, `What crosses between them is small and flat: the DAG once, as a <b>${bytes(D.bytes.keys + D.bytes.counts + D.bytes.poses)}</b> snapshot; then a job of a few numbers; then <b>8 bytes a cube</b> back, moved, not copied.`],
    [11, `This film follows one chunk of the stream viewer's opening world down that road, through the code that does it. Every number on screen is computed by the repo's own modules as the page loads.`],
  ],
  cam: t => ({ target: [0, 64, 0], yaw: 0.65 + 0.025 * t, pitch: 0.42, dist: 600 }),
  draw(c){
    const { g, t, W, H, D } = c;
    world(c, { tint: BG, tintAmt: lerp(0.35, 0.72, win(t, 1, 3)) });
    const w = Math.min(1180, W - 80), x = (W - w) / 2, y = Math.max(90, H * 0.2);
    const a = fade(t, 0.6, 1.4, 16.2, 17);
    const packet = t > 6 ? (t - 6) / 9.5 * (STAGES.length - 1) : -1;
    drawMap(g, x, y, w, { big: true, reveal: eo(win(t, 0.8, 5.5)), alpha: a, packet });
    // What travels, at the arrows where the lanes change.
    // Under the map, at the crossing each one makes.
    const msg = [[1, `snapshot, once: ${bytes(D.bytes.keys + D.bytes.counts + D.bytes.poses)}`, 6.2], [3.5, `a job: ${D.jobView.bytes} bytes`, 7.8],
                 [5.5, `records + words: 8 B a cube`, 9.5], [8.5, `one draw a chunk`, 12.6]];
    const yb = y + 34 + 3 * 78 + 26;
    if (w >= 600) for (const [i, s, t0] of msg){
      const [xm] = mapPos(x, y, w, Math.floor(i)), [xn] = mapPos(x, y, w, Math.ceil(i)), xx = xm + (xn - xm) * (i % 1);
      pill(g, s, xx, yb, { size: 11, color: GOLD, alpha: a * win(t, t0, t0 + 0.6), mono: true });
    }
  },
},
/* 2 ------------------------------------------------------------------------------ */
{
  key: 'dag', stage: 'dag', title: 'What the page holds: a DAG', dur: 19, side: true,
  steps: (P, D) => [
    [0, `The world is <b>${fmt(D.voxels)}</b> voxels, held as <b>${fmt(D.nodes)}</b> nodes. A node is nine numbers: its level, then the ids of its eight children, octant by octant. Id 0 is EMPTY, id 1 is FULL.`],
    [6, `Walking down is <code>store.child(id, octant)</code>: the root, its octant that holds our chunk, then the chunk's node, level 6, which covers 64³ voxels. Below it, an 8³ brick, then one voxel.`],
    [12.5, `There's no geometry here at all: no positions, no faces, no triangles. Everything the GPU will draw has to be made from these ids, chunk by chunk, as the eye needs it.`],
  ],
  cam: t => camKeys(t, [
    [0, { target: [0, 64, 0], yaw: 0.75, pitch: 0.45, dist: 560 }],
    [6, { target: [-40, 40, -40], yaw: 0.85, pitch: 0.5, dist: 300 }],
    [11, { target: [-30, 50, -30], yaw: 0.95, pitch: 0.55, dist: 150 }],
    [19, { target: [-28, 58, -28], yaw: 1.05, pitch: 0.6, dist: 95 }],
  ]),
  draw(c){
    const { F, g, t, P, D } = c;
    mini(c, 'dag');
    world(c, {});
    const show = [[0.5, 0], [3, 1], [6, 2], [9.5, 3], [12, 4]];
    P.pathBoxes.forEach((b, i) => {
      const a = win(t, show[i][0], show[i][0] + 0.8), col = i === 4 ? rgb01(GOLD) : lodCol([2, 1, 0, 0, 0][i] ?? 0);
      if (a <= 0) return;
      box(F, b.lo, b.size, i === 4 ? rgb01(GOLD) : [0.95, 0.97, 1], a * (i === 2 ? 1 : 0.8), i === 2 ? 2.5 : 1.6, { top: i >= 3 });
      const top = W2S([b.lo[0] + b.size / 2, b.lo[1] + b.size, b.lo[2] + b.size / 2]);
      label3(F, g, top, `level ${b.level} · id ${b.id}${b.id === 1 ? ' (FULL)' : ''}`, { alpha: a * (1 - win(t, show[i][0] + 6, show[i][0] + 7) * (i < 3 ? 0.6 : 0)), dy: [-18, -18, -18, -40, -16][i], dx: i === 4 ? 70 : 0, color: i === 4 ? GOLD : INK, size: 11.5, mono: true });
    });
    // The node table.
    const x = 34, y = 118, w = Math.min(560, left(c) - 70);
    const a = fade(t, 1, 2, 18.2, 19);
    panel(g, x, y, w, 52 + 26 * P.rows.length + 30, { alpha: a });
    text(g, 'store: 9 numbers a node', x + 16, y + 24, { size: 12, weight: 700, color: ACCENT, alpha: a, mono: true, shadow: false });
    text(g, 'id   level   child 0 … 7', x + 16, y + 44, { size: 11, weight: 600, color: DIM, alpha: a, mono: true, shadow: false });
    const cw = (w - 150) / 8;
    P.rows.forEach((r, i) => {
      const yy = y + 70 + 26 * i, ra = a * win(t, show[i][0], show[i][0] + 0.6);
      text(g, String(r.id).padStart(3), x + 16, yy, { size: 12.5, weight: 700, color: INK, alpha: ra, mono: true, shadow: false });
      text(g, String(r.level), x + 70, yy, { size: 12.5, weight: 600, color: GOLD, alpha: ra, mono: true, shadow: false });
      r.kids.forEach((id, o) => {
        const s = id === 0 ? '·' : id === 1 ? 'F' : String(id), xx = x + 110 + cw * (o + 0.5);
        const on = P.pathBoxes[i].o === o;
        if (on){ g.save(); g.globalAlpha = ra; g.fillStyle = 'rgba(90,209,255,0.18)'; roundRect(g, xx - cw / 2 + 2, yy - 16, cw - 4, 22, 5); g.fill(); g.restore(); }
        text(g, s, xx, yy, { size: 12, weight: on ? 700 : 500, color: id === 0 ? FAINT : id === 1 ? GREEN : on ? ACCENT : '#c8d0e4', align: 'center', alpha: ra, mono: true, shadow: false });
      });
    });
    text(g, `${fmt(D.nodes)} nodes × 9 × 4 bytes = ${fmt(D.bytes.keys)} bytes`, x + 16, y + 70 + 26 * P.rows.length + 4,
         { size: 11.5, weight: 600, color: DIM, alpha: a * win(t, 12.5, 13.5), mono: true, shadow: false });
    code(c, 'store', { alpha: fade(t, 1.5, 2.5, 18.2, 19), hl: 1 });
    code(c, 'nodeAt', { alpha: fade(t, 6, 7, 18.2, 19), y: P.lay.codeY + 110, hl: 'store.child(id', note: 'down by octants' });
  },
},
/* 3 ------------------------------------------------------------------------------ */
{
  key: 'snapshot', stage: 'snapshot', title: 'The snapshot, sent once', dur: 17, side: true,
  steps: (P, D) => [
    [0, `<code>worldSnapshot</code> flattens the store into typed arrays: <b>keys</b> (${fmt(D.bytes.keys)} bytes), each node's voxel <b>counts</b> (${fmt(D.bytes.counts)}), its Oh <b>pose</b> (${fmt(D.bytes.poses)}). The colour field travels as a <b>descriptor</b>, because a function can't be posted to a worker.`],
    [6.5, `<code>pool.setWorld</code> posts it once to each of the four workers. A structured clone, so each gets its own copy of the arrays.`],
    [11.5, `Each worker makes a <code>createJobRunner</code> over it: a read-only <code>storeView</code> of the keys, and the colour field rebuilt from the descriptor with <code>colourOf</code>. From here on, a job only has to name a chunk.`],
  ],
  cam: t => ({ target: [0, 64, 0], yaw: 0.8 + 0.02 * t, pitch: 0.45, dist: 620 }),
  draw(c){
    const { g, t, P, D } = c;
    mini(c, 'snapshot');
    dimWorld(c, 0.78);
    const L = left(c), x = 34, w = Math.min(600, L - 80), a = fade(t, 0.4, 1.2, 16.2, 17);
    let y = 128;
    const snap = D.snap, keys = snap.keys;
    // keys: 9 words a node, the first rows.
    const per = 9, rows = 6, cellW = (w - 0) / (per * 6);
    text(g, 'snap.keys', x, y - 12, { size: 12, weight: 700, color: INK, alpha: a, mono: true, shadow: false });
    text(g, `Uint32Array(${fmt(keys.length)}) · ${fmt(D.bytes.keys)} B`, x + w, y - 12, { size: 11.5, color: DIM, alpha: a, mono: true, align: 'right', shadow: false });
    g.save(); g.globalAlpha = a;
    for (let r = 0; r < rows; r++) for (let q = 0; q < 6; q++){
      const node = r * 6 + q, base = node * per;
      for (let i = 0; i < per; i++){
        const v = keys[base + i], xx = x + (q * per + i) * cellW, yy = y + r * 15;
        g.fillStyle = i === 0 ? '#7a6630' : v === 0 ? 'rgba(255,255,255,0.05)' : v === 1 ? '#4f8a4c' : css([0.2, 0.45 + 0.4 * (v % 7) / 7, 0.85], 0.9);
        g.fillRect(xx + 0.5, yy, cellW - 1, 13);
      }
    }
    g.restore();
    text(g, 'level · 8 child ids, node after node (gold: level, green: FULL, dark: EMPTY)', x, y + rows * 15 + 16, { size: 11, color: DIM, alpha: a, shadow: false });
    y += rows * 15 + 52;
    strip(g, x, y, w * 0.55, 14, { n: 96, colorOf: i => css([0.75, 0.55 + 0.4 * Math.min(1, Math.log2(1 + snap.counts[i + 2]) / 21), 0.35], 0.9), label: 'snap.counts', right: `Float64Array(${fmt(snap.counts.length)})`, alpha: a });
    strip(g, x + w * 0.62, y, w * 0.38, 14, { n: 64, colorOf: i => snap.poses[i + 2] ? css([0.6, 0.45, 0.9], 0.4 + 0.6 * snap.poses[i + 2] / 48) : 'rgba(255,255,255,0.06)', label: 'snap.poses', right: `Uint8Array(${fmt(snap.poses.length)})`, alpha: a });
    y += 44;
    const desc = D.desc;
    card(g, x, y, w * 0.55, 'snap.colour', [['kind', `'${desc.kind}'`, GOLD], ['D, seed', `${desc.D}, ${desc.seed}`], ['libs, ornaments', `[${desc.libs}], ${desc.ornaments}`], ['ground, colourLevel', `${desc.ground}, ${desc.colourLevel}`]], { alpha: a, color: GOLD });
    card(g, x + w * 0.62, y, w * 0.38, 'snap', [['D', snap.D], ['root', snap.root]], { alpha: a, color: ACCENT });
    // Four workers get a copy each.
    const wy = y + 150, ww = (w - 30) / 4;
    for (let i = 0; i < 4; i++){
      const wx = x + i * (ww + 10), u = win(t, 6.8 + i * 0.35, 8.6 + i * 0.35);
      const [px, py] = along(x + w * 0.31, y + 120, wx + ww / 2, wy, eo(u), -30);
      if (u > 0 && u < 1) dot2(g, px, py, 5, GOLD, 1, 14);
      const got = win(t, 8.6 + i * 0.35, 9.2 + i * 0.35), made = win(t, 11.8 + i * 0.3, 12.5 + i * 0.3);
      chip(g, wx, wy, ww, 62, `worker ${i + 1}`, made > 0.5 ? 'createJobRunner(snap, colourOf)' : got > 0.5 ? 'a copy of snap' : 'waiting', WORKER, a * win(t, 6.2, 7), made);
    }
    codeWalk(c, 'setWorld', t, [[0, 'setWorld(snap, revision){'], [6.5, "postMessage({ type: 'world'"], [9, 'for (const tail of this.tails)']], { alpha: fade(t, 0.5, 1.3, 16.2, 17) });
    code(c, 'workerWorld', { alpha: fade(t, 10.8, 11.6, 16.2, 17), y: P.lay.codeY + 300, hl: 'createJobRunner', note: 'in each worker' });
  },
},
/* 4 ------------------------------------------------------------------------------ */
{
  key: 'cut', stage: 'cut', title: 'Which chunks: the cut', dur: 21, side: true,
  steps: (P, D) => [
    [0, `Every frame the eye moves, <code>streamer.update(eye)</code> asks <code>selectChunks</code> which chunks it wants. A chunk at lod <i>l</i> is always 64³ cells of side 2<sup>l</sup>: lod 0 is voxels, lod 2 here is the whole world in one chunk.`],
    [6.5, `Start with the top chunk, and split a chunk into its non-empty children while the eye is nearer its box than <b>detail × its side</b>. What's left, the leaves, tiles the world, fine near the eye and coarse far off.`],
    [13.5, `The viewer runs at detail 4, which puts all of this small world at lod 0. The film uses ${FILM_DETAIL} so you can see the lods: <span style="color:${LOD[0]}">lod 0</span>, <span style="color:${LOD[1]}">lod 1</span>, <span style="color:${LOD[2]}">lod 2</span>.`],
  ],
  eyeAt: t => {
    const u = t / 21, a = 0.6 + 4.6 * u;
    return [128 + 150 * Math.cos(a) * (0.55 + 0.45 * Math.cos(u * 3)), 30 + 40 * (0.5 + 0.5 * Math.sin(u * 5)), 128 + 150 * Math.sin(a) * (0.55 + 0.45 * Math.cos(u * 3))];
  },
  cam: t => ({ target: [0, 30, 0], yaw: 0.7 + 0.12 * t / 21, pitch: 0.62, dist: 640 }),
  draw(c){
    const { F, g, t, P, D } = c;
    mini(c, 'cut');
    const eye = this.eyeAt(t), sel = D.select(eye, FILM_DETAIL);
    const counts = [0, 0, 0];
    for (const l of sel.leaves){
      counts[l.lod]++;
      chunk(c, l.key, { tint: lodCol(l.lod), tintAmt: 0.22 * win(t, 13.5, 14.5) });
      box(F, l.lo, l.size, lodCol(l.lod), 0.85, l.lod ? 2.2 : 1.5);
    }
    for (const n of sel.nodes.values()) if (n.kids) box(F, n.lo, n.size, [1, 1, 1], 0.12, 1);
    const e = W2S(eye);
    F.cube(e[0], e[1], e[2], 5, 1, 0.85, 0.4, 1, 1.2);
    F.seg(e, [e[0], 0, e[2]], [1, 0.82, 0.4, 0.5], 1.5);
    label3(F, g, e, 'eye', { dy: -20, color: GOLD, size: 12 });
    // The rule, live, for the nearest lod-1 leaf (or the top chunk if none).
    const probe = sel.leaves.find(l => l.lod === 1) || sel.leaves.find(l => l.lod === 2);
    if (probe){
      const ctr = W2S([probe.lo[0] + probe.size / 2, probe.lo[1] + probe.size, probe.lo[2] + probe.size / 2]);
      label3(F, g, ctr, `dist ${probe.dist.toFixed(0)} ≥ ${FILM_DETAIL} × ${probe.size} = ${(FILM_DETAIL * probe.size).toFixed(0)}: a leaf`,
             { dy: -26, color: LOD[probe.lod], size: 11, mono: true, alpha: win(t, 6.5, 7.5) });
    }
    const x = 34, y = 120;
    table(g, x, y, 220, [
      ['lod 0 leaves (cells of 1)', counts[0], LOD[0]], ['lod 1 leaves (cells of 2)', counts[1], LOD[1]], ['lod 2 leaves (cells of 4)', counts[2], LOD[2]],
      ['chunks in the cut', sel.nodes.size, INK],
    ], { title: 'SELECTCHUNKS, NOW', alpha: fade(t, 0.5, 1.5, 20.2, 21) });
    codeWalk(c, 'select', t, [[0, 'const c = pop();'], [6.5, 'if (splitsAt(c, rule)){'], [9, 'childrenOf(world, c)'], [12, 'leaves.push(c);']], { alpha: fade(t, 0.5, 1.3, 20.2, 21) });
  },
},
/* 5 ------------------------------------------------------------------------------ */
{
  key: 'job', stage: 'job', title: 'A job is a message', dur: 15, side: true,
  steps: (P, D) => [
    [0, `<code>streamer.nextJob()</code> takes the queue in order: the pinned top chunk first, then holes, then by distance over size. It hands the pool a plain object. This is the real one for our chunk, <b>${D.jobView.focus.key}</b>: the ${D.jobView.order.length}${['st', 'nd', 'rd'][D.jobView.order.length - 1] || 'th'} job from this eye.`],
    [6, `It reserves its worst case, <code>estimate</code> = 8 bytes for each of half a 64³ grid plus a seam shell (${fmt(D.jobView.focus.estimate)} bytes), against the 96 MB the results may hold. <code>stamp</code> is the seven nodes the job will read; an edit compares it later.`],
    [10, `<code>dispatch</code> posts only what a worker needs: where the chunk is, its lod rule, its kind, its root. ${D.jobView.bytes} bytes as JSON. The worker already has the world.`],
  ],
  cam: t => camKeys(t, [[0, { target: [-30, 30, -30], yaw: 0.8, pitch: 0.55, dist: 420 }], [15, { target: [-32, 30, -32], yaw: 0.95, pitch: 0.55, dist: 330 }]]),
  draw(c){
    const { F, g, t, P, D } = c;
    mini(c, 'job');
    for (const key of P.lod0) if (key !== P.F.key) chunk(c, key, { tint: BG, tintAmt: 0.62 });
    chunk(c, P.F.key, { glowLo: 0, glowHi: 1e9, glow: 0.25 + 0.15 * Math.sin(t * 3) });
    box(F, P.F.job.lo, 64, rgb01(GOLD), 1, 2.6, { top: true });
    label3(F, g, add3(P.forigin, [32, 64, 32]), `chunk ${P.F.key}`, { dy: -26, color: GOLD, size: 12, mono: true });
    const j = D.jobView.focus, m = D.jobView.message, x = 34, y = 122, w = Math.min(330, (left(c) - 90) / 2);
    const a = fade(t, 0.5, 1.3, 14.2, 15);
    card(g, x, y, w, 'nextJob() →', [
      ['key', `'${j.key}'`, GOLD], ['lod, cx, cy, cz', `${j.lod}, ${j.cx}, ${j.cy}, ${j.cz}`], ['lodRule', `'${j.lodRule}'`], ['kind', `'${j.kind}'`],
      ['revision, jobId', `${j.revision}, ${j.jobId}`], ['estimate', fmt(j.estimate), win(t, 6, 6.5) > 0.5 ? GOLD : INK], ['root', j.root],
      ['gen, colourRev', `${j.gen}, ${j.colourRev}`], ['stamp', `[${Array.from(j.stamp).join(', ')}]`, win(t, 7.5, 8) > 0.5 ? GOLD : INK],
    ], { alpha: a, color: MAIN });
    const x2 = x + w + 26, u = win(t, 10.2, 11.6);
    card(g, x2, y + 40, w, 'postMessage({', [
      ['type', `'${m.type}'`], ['jobId, world', `${m.jobId}, ${m.world}`], ['lod, cx, cy, cz', `${m.lod}, ${m.cx}, ${m.cy}, ${m.cz}`],
      ['lodRule, kind', `'${m.lodRule}', '${m.kind}'`], ['root', m.root],
    ], { alpha: a * win(t, 9.6, 10.3), color: MAIN, sub: `${D.jobView.bytes} bytes as JSON` });
    const wy = y + 290;
    chip(g, x2, wy, w, 52, 'worker 1', u >= 1 ? `runner(job): lod ${m.lod}, chunk ${m.cx},${m.cy},${m.cz}` : 'idle', WORKER, a * win(t, 9.6, 10.3), u >= 1 ? 1 : 0);
    if (u > 0 && u < 1){ const [px, py] = along(x2 + w / 2, y + 205, x2 + w / 2, wy, eo(u), 20); dot2(g, px, py, 5, GOLD, 1, 14); }
    code(c, 'nextJob', { alpha: fade(t, 0.5, 1.3, 9.4, 10.2), hl: t < 6 ? 'const job = {' : 'stamp: stampOf', span: t < 6 ? 2 : 1 });
    code(c, 'dispatch', { alpha: fade(t, 9.6, 10.4, 14.2, 15), hl: "postMessage({ type: 'expand'", span: 2 });
  },
},
/* 6 ------------------------------------------------------------------------------ */
{
  key: 'descend', stage: 'expand', title: 'In the worker: find the chunk\'s node', dur: 15, side: true,
  steps: (P, D) => [
    [0, `The worker's <code>runner(job)</code> first asks if the chunk is <b>buried</b>: its node FULL and all six neighbours FULL. Then nothing could show, and it returns no records without walking 262,144 cells. Underground terrain is mostly that; this world has none.`],
    [6, `Otherwise it walks down from the root to the chunk's node, one octant a level. The octant is a bit of each chunk coordinate, x first: <code>o = x | y<<1 | z<<2</code>. For chunk (${FOCUS.cx}, ${FOCUS.cy}, ${FOCUS.cz}) at D = 8 that's two steps.`],
    [11, `The node it lands on, id <b>${P.F.node}</b>, is the 64³ the job will expand. The job is chunk-core's <code>expandChunk</code>, computed by job-core's faster twin <code>fastChunk</code>, byte for byte.`],
  ],
  cam: t => camKeys(t, [[0, { target: [0, 60, 0], yaw: 0.75, pitch: 0.5, dist: 520 }], [7, { target: [-40, 40, -40], yaw: 0.85, pitch: 0.52, dist: 340 }], [15, { target: [-32, 32, -32], yaw: 0.9, pitch: 0.5, dist: 200 }]]),
  draw(c){
    const { F, g, t, P, D } = c;
    mini(c, 'expand');
    for (const key of P.lod0) if (key !== P.F.key) chunk(c, key, { tint: BG, tintAmt: lerp(0.55, 0.72, win(t, 9, 12)) });
    chunk(c, P.F.key, { glow: 0.3 * win(t, 11, 12), glowHi: 1e9 });
    const path = D.focus.path, x = 34, y = 128, a = fade(t, 0.5, 1.3, 14.2, 15);
    const steps = [...path.map((s, i) => ({ ...s, t0: 6.3 + i * 2 })), { level: 6, id: P.F.node, lo: P.F.job.lo, size: 64, t0: 10.3 }];
    steps.forEach((s, i) => {
      const u = win(t, s.t0, s.t0 + 0.8);
      if (u <= 0) return;
      box(F, s.lo, s.size, i === steps.length - 1 ? rgb01(GOLD) : lodCol(2 - i), u, i === steps.length - 1 ? 2.6 : 1.8, { top: true });
    });
    // The digits.
    const bx = Math.min(560, left(c) - 70);
    panel(g, x, y, bx, 64 + 54 * path.length + 36, { alpha: a * win(t, 5.6, 6.3) });
    text(g, `chunk (cx, cy, cz) = (${FOCUS.cx}, ${FOCUS.cy}, ${FOCUS.cz}) = (${bin(FOCUS.cx, 2)}, ${bin(FOCUS.cy, 2)}, ${bin(FOCUS.cz, 2)})₂`, x + 16, y + 28, { size: 12.5, weight: 650, color: INK, alpha: a * win(t, 5.6, 6.3), mono: true, shadow: false });
    path.forEach((s, i) => {
      const yy = y + 62 + 54 * i, u = win(t, 6.3 + i * 2, 7 + i * 2) * a;
      text(g, `level ${s.level}: bit ${s.level - 7} → (${s.bits.join(', ')})`, x + 16, yy, { size: 12, weight: 600, color: DIM, alpha: u, mono: true, shadow: false });
      text(g, `o = ${s.bits[0]} | ${s.bits[1]}<<1 | ${s.bits[2]}<<2 = ${s.o}`, x + 16, yy + 20, { size: 12.5, weight: 700, color: ACCENT, alpha: u, mono: true, shadow: false });
      text(g, `store.child(${s.id}, ${s.o}) = ${s.next}`, x + bx - 16, yy + 20, { size: 12.5, weight: 700, color: GOLD, alpha: u, mono: true, align: 'right', shadow: false });
    });
    text(g, `→ node ${P.F.node}: ${fmt(D.counts.of(P.F.node))} voxels under it`, x + 16, y + 62 + 54 * path.length + 10, { size: 12, weight: 650, color: GOLD, alpha: a * win(t, 10.3, 11), mono: true, shadow: false });
    codeWalk(c, 'runner', t, [[0, 'const buried = () =>'], [5.5, 'if (buried())'], [10.5, 'const c = fastChunk(']], { alpha: fade(t, 0.5, 1.3, 14.2, 15), maxLines: 24 });
    code(c, 'nodeAt', { alpha: fade(t, 6, 6.8, 14.2, 15), y: P.lay.codeY + 400, hl: 'id = store.child(id,', note: 'one octant a level' });
  },
},
/* 7 ------------------------------------------------------------------------------ */
{
  key: 'walk', stage: 'expand', title: 'Walk the node: cells in Morton order', dur: 21, side: true,
  steps: (P, D) => [
    [0, `The walk is depth-first, children in octant order 0 to 7: x is the low bit, then y, then z. An <b>EMPTY</b> child is skipped whole, however big. What's left, here <b>${fmt(P.F.occupied)}</b> occupied cells, comes out in the order you see.`],
    [7.5, `That order is <b>Morton order</b>: a cell's index is its path of octant digits, so its bits are x, y and z interleaved. The walk hands out indices already sorted, and <code>index >> 9</code> is the 8³ brick a cell lies in.`],
    [14.5, `Each visit marks the cell in a 66³ byte grid, the chunk plus one cell all round, and keeps its index, its place and its brick's Oh pose. Nothing is decided about faces yet.`],
  ],
  cam: t => ({ target: [-32, 26, -32], yaw: 0.62 + 0.4 * t / 21, pitch: 0.5, dist: 230 }),
  draw(c){
    const { F, g, t, P, D } = c;
    mini(c, 'expand');
    const n = P.F.occupied, shown = Math.max(1, Math.round(n * lerp(0, 1, win(t, 3, 15.5) ** 1.15)));
    // The chunk's eight octants.
    const oa = fade(t, 0.4, 1.4, 5, 7);
    box(F, P.F.job.lo, 64, [1, 1, 1], 0.6, 1.4);
    for (let o = 0; o < 8; o++){
      const lo = add3(P.F.job.lo, [(o & 1) * 32, (o >> 1 & 1) * 32, (o >> 2) * 32]);
      box(F, lo, 32, [0.5, 0.85, 1], 0.5 * oa, 1.2);
      label3(F, g, W2S(add3(lo, [16, 16, 16])), String(o), { alpha: oa, color: ACCENT, size: 13, mono: true });
    }
    F.records(P.cells, P.forigin, 1, { hi: shown, allFaces: true, mode: 1, rankN: n });
    // The Z-curve as a trail behind the newest cell, fainter toward its tail. It
    // was once the first 160 cells, which the walk passes a moment after t = 3
    // (87,096 cells in 12.5 s), so the line sat still by octant 0 while the cube
    // ran on; it lives as long as the cube now.
    const za = fade(t, 3, 4, 14.8, 15.6);
    if (za > 0){
      const TRAIL = 160, cells = P.F.cells, i0 = Math.max(0, shown - TRAIL);
      let prev = null;
      for (let i = i0; i < shown; i++){
        const p = cells[i], q = add3(P.forigin, [(p & 255) + 0.5, (p >> 8 & 255) + 0.5, (p >> 16) + 0.5]);
        if (prev) F.seg(prev, q, [1, 0.82, 0.4, za * (0.25 + 0.75 * (i - i0) / TRAIL)], 1.6, { top: true });
        prev = q;
      }
    }
    // The newest cell, and its index's bits.
    const i = shown - 1, p = P.F.cells[i], xyz = [p & 255, p >> 8 & 255, p >> 16], idx = P.F.all[i] & 0x3ffff;
    const q = add3(P.forigin, [xyz[0] + 0.5, xyz[1] + 0.5, xyz[2] + 0.5]);
    if (t > 3 && t < 15.6) F.cube(q[0], q[1], q[2], 1.6, 1, 0.85, 0.4, 1, 1.4);
    const x = 30, y = 122, a = fade(t, 3, 4, 20.2, 21);
    panel(g, x, y, 420, 128, { alpha: a });
    text(g, `visit ${fmt(i + 1)} of ${fmt(n)}: cell (${xyz.join(', ')})`, x + 16, y + 26, { size: 12.5, weight: 700, color: INK, alpha: a, mono: true, shadow: false });
    mortonBits(g, x + 16, y + 42, idx, { alpha: a, cell: c.W < 460 ? 13 : 17 });
    text(g, `Morton index ${fmt(idx)}`, x + 16, y + 112, { size: 12, weight: 650, color: GOLD, alpha: a, mono: true, shadow: false });
    const L = P.F.levels;
    tableP(g, x + 14, y + 178, 392, [
      ['16³ subtrees skipped as EMPTY', fmt(L[4].empty), FAINT], ['8³ subtrees skipped', fmt(L[3].empty), FAINT], ['4³ subtrees skipped', fmt(L[2].empty), FAINT],
      ['2³ subtrees skipped', fmt(L[1].empty), FAINT], ['voxels visited (occupied cells)', fmt(n), GOLD],
      ['sorted by index, as walked', P.F.sorted ? 'yes' : 'NO', P.F.sorted ? GREEN : RED],
    ], { title: 'THE WALK OF CHUNK ' + P.F.key, alpha: a * win(t, 6, 7) });
    codeWalk(c, 'walk', t, [[0, 'function walk('], [2.5, 'if (id === EMPTY) return;'], [5, 'for (let o = 0; o < 8; o++){'], [8, 'index << 3 | o'], [11.5, 'if (k === ctx.lod){'], [14.5, 'ctx.visit(X0, Y0, Z0, index, pose, c, id);']],
             { alpha: fade(t, 0.5, 1.3, 20.2, 21) });
  },
},
/* 8 ------------------------------------------------------------------------------ */
{
  key: 'faces', stage: 'expand', title: 'Which faces show', dur: 22, side: true,
  steps: (P, D) => [
    [0, `First the <b>apron</b>: the one-cell slab of each neighbouring chunk that faces this one is walked too, into the grid's border. ${fmt(P.apronCount)} cells here, from the four neighbours that exist. So a face against the next chunk is hidden exactly as inside the world.`],
    [7, `Then each cell asks its six neighbours in the grid: an empty one means that face shows. Cut the chunk open: as cells it's solid, as <b>records</b> it's a shell. <b>${fmt(P.F.buried)}</b> of ${fmt(P.F.occupied)} cells show no face and are dropped.`],
    [14.5, `Our cell, (${P.F.record.x}, ${P.F.record.y}, ${P.F.record.z}): air on −X, +Y and −Z, cells on +X, −Y and +Z. Its <b>mask</b> is one bit a face in the order +X −X +Y −Y +Z −Z: <code>${bin(P.F.record.mask, 6).split('').reverse().join('')}</code> written that way round, ${P.F.record.mask} as a number.`],
  ],
  cam: t => camKeys(t, [
    [0, { target: [-32, 28, -32], yaw: 0.55, pitch: 0.45, dist: 250 }],
    [7, { target: [-32, 28, -32], yaw: 1.15, pitch: 0.42, dist: 200 }],
    [13.5, { target: [-32, 30, -32], yaw: 1.35, pitch: 0.42, dist: 190 }],
    [16, { target: [-26.5, 63, -26.5], yaw: 0.95, pitch: 0.55, dist: 22 }],
    [22, { target: [-26.5, 63, -26.5], yaw: 0.75, pitch: 0.6, dist: 20 }],
  ]),
  draw(c){
    const { F, g, t, P, D } = c;
    mini(c, 'expand');
    const ra = win(t, 9.5, 11.5), cutX = P.forigin[0] + lerp(64, 30, eio(win(t, 7.5, 9.5)));
    const clip = t > 7.5 && t < 15 ? [1, 0, 0, cutX] : [0, 0, 0, 1];
    if (ra < 1) F.records(P.cells, P.forigin, 1, { allFaces: true, tint: [0.62, 0.66, 0.74], tintAmt: 0.85, clip, alpha: t < 9.5 ? 1 : 1 - ra });
    if (ra > 0) chunk(c, P.F.key, { clip, alpha: ra, glowLo: P.F.record.index, glowHi: P.F.record.index + 1, glow: 0.7 * win(t, 14.5, 15.5) });
    if (t > 14.5){
      // Neighbours shown lightly, so the zoom has context.
      for (const key of P.lod0) if (key !== P.F.key) chunk(c, key, { tint: BG, tintAmt: 0.5 });
    }
    const aa = fade(t, 0.5, 1.5, 7.5, 9);
    if (aa > 0) F.batch(P.apron, null, { alpha: aa });
    if (aa > 0) for (const a of P.F.apron) if (a.cells.length){
      const s = a.cells[(a.cells.length / 2) | 0];
      label3(F, c.g, add3(P.forigin, [s[0] + 0.5, s[1] + 4, s[2] + 0.5]), `${a.name} neighbour: ${fmt(a.cells.length)} cells`, { alpha: aa, dy: -16, size: 11, color: [RED, RED, GREEN, GREEN, ACCENT, ACCENT][a.side], mono: true });
    }
    // The six neighbour tests on our cell.
    const na = win(t, 15.5, 16.5);
    if (na > 0){
      const r = P.F.record, SID = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      SID.forEach((d, f) => {
        const solid = P.F.occupiedAt(r.x + d[0], r.y + d[1], r.z + d[2]) || (d[1] === 1 && false);
        const shown = (r.mask >> f & 1) === 1, col = rgb01(shown ? GREEN : RED);
        const a = na * win(t, 15.5 + f * 0.5, 16 + f * 0.5);
        const end = add3(P.rpos, d.map(v => v * 1.9));
        F.seg(add3(P.rpos, d.map(v => v * 0.55)), end, C4(col, a), 3, { top: true });
        label3(F, c.g, add3(P.rpos, d.map(v => v * 2.5)), `${SIDE_NAMES[f]} ${shown ? 'air → 1' : 'cell → 0'}`, { alpha: a, color: shown ? GREEN : RED, size: 11, mono: true });
      });
    }
    const x = 30, y = 122, a = fade(t, 9.5, 10.5, 21.2, 22);
    tableP(g, x + 14, y + 10, 350, [
      ['cells the walk kept', fmt(P.F.occupied), INK], ['records: a face or more shows', fmt(P.F.count), GREEN], ['buried: dropped', fmt(P.F.buried), FAINT],
      ['seam tail (see seams)', fmt(P.F.tail), GOLD],
    ], { title: 'EXPANDCHUNK ' + P.F.key, alpha: a });
    if (!P.lay.narrow) pill(g, `mask = ${bin(P.F.record.mask, 6)}₂ = ${P.F.record.mask}`, x + 110, y + 150, { size: 14, color: GREEN, alpha: win(t, 18.5, 19.5), mono: true });
    code(c, 'aprons', { alpha: fade(t, 0.5, 1.3, 6.6, 7.3), hl: 'walk(ctx, nb.id, nb.level' });
    codeWalk(c, 'masks', t, [[7, 'for (let i = 0; i < n; i++){'], [8.5, 'const m = (grid[g + 1] ? 0 : 1)', 3], [11.5, 'if (!m){'], [16, 'records[count++] = packRecord(cells[i], m, poses[i]);']],
             { alpha: fade(t, 7, 7.8, 21.2, 22) });
  },
},
/* 9 ------------------------------------------------------------------------------ */
{
  key: 'record', stage: 'expand', title: 'Four bytes a cube, four of colour', dur: 21, side: true,
  steps: (P, D) => [
    [0, `<code>packRecord(cell, mask, pose)</code> is the whole cube: 18 bits of Morton index, the 6-bit mask, the 6-bit pose of its 8³ brick. No position (the shader rebuilds it from the index), no normals, no vertices. Buried cells never got one.`],
    [10, `Beside each record, at the same index, goes its <b>attribute word</b>: <code>cellAttr</code> asks the world's colour field (the kit's, rebuilt from the descriptor), and <code>attrOf8</code> keeps 6 bits of each of R, G and B. The rest is reserved.`],
    [16, `So the job's answer is two <code>Uint32Array</code>s of ${fmt(P.F.job.records.length)}: the ${fmt(P.F.count)} records, then ${fmt(P.F.tail)} seam-tail cells, and their words. <b>${bytes(2 * 4 * P.F.job.records.length)}</b> for this chunk, 8 bytes a cube.`],
  ],
  cam: t => ({ target: [-26.5, 62, -26.5], yaw: 0.8 + 0.25 * t / 21, pitch: 0.58, dist: lerp(26, 70, eio(win(t, 15, 20))) }),
  draw(c){
    const { F, g, t, P, D } = c;
    mini(c, 'expand');
    const r = P.F.record;
    chunk(c, P.F.key, { glowLo: r.index, glowHi: r.index + 1, glow: 0.55 + 0.25 * Math.sin(t * 4) });
    for (const key of P.lod0) if (key !== P.F.key) chunk(c, key, { tint: BG, tintAmt: 0.5 });
    label3(F, g, add3(P.rpos, [0, 0.8, 0]), `record ${fmt(r.index)}`, { dy: -26, color: GOLD, size: 12, mono: true, alpha: win(t, 0.5, 1.2) });
    const x = 30, y = 128, a = fade(t, 0.6, 1.5, 20.2, 21);
    const [x6, y6, z6] = [r.x, r.y, r.z], faces = SIDE_NAMES.filter((_, f) => r.mask >> f & 1).join(' ');
    backdrop(g, x, y - 14, 612, 84, a);
    backdrop(g, x, y + 104, 612, 84, a * win(t, 10, 11));
    text(g, `record = ${hex(r.rec)}`, x, y, { size: 14, weight: 700, color: INK, alpha: a, mono: true });
    bits(g, x, y + 16, r.rec, [
      { name: 'cell (Morton)', at: 0, len: 18, color: ACCENT, sub: `${fmt(r.cell)} → (${x6}, ${y6}, ${z6})` },
      { name: 'mask', at: 18, len: 6, color: GREEN, sub: faces },
      { name: 'pose', at: 24, len: 6, color: GOLD, sub: String(r.pose) },
      { name: '', at: 30, len: 2, color: FAINT },
    ], { cell: 15, alpha: a, reveal: win(t, 0.8, 3.5) });
    const wa = a * win(t, 10, 11), w = r.attr, [r6, g6, b6] = attrRGB(w);
    text(g, `attrs[${fmt(r.index)}] = ${hex(w)}`, x, y + 118, { size: 14, weight: 700, color: INK, alpha: wa, mono: true });
    bits(g, x, y + 134, w, [
      { name: 'R', at: 2, len: 6, color: RED, sub: String(r6) }, { name: 'G', at: 10, len: 6, color: GREEN, sub: String(g6) },
      { name: 'B', at: 18, len: 6, color: ACCENT, sub: String(b6) },
      { name: '', at: 0, len: 2, color: FAINT }, { name: '', at: 8, len: 2, color: FAINT }, { name: '', at: 16, len: 2, color: FAINT }, { name: '', at: 24, len: 8, color: FAINT },
    ], { cell: 15, alpha: wa, reveal: win(t, 10.3, 12.5) });
    g.save(); g.globalAlpha = wa; g.fillStyle = `rgb(${r6 * 255 / 63}, ${g6 * 255 / 63}, ${b6 * 255 / 63})`; roundRect(g, x + 560, y + 134, 40, 40, 8); g.fill(); g.restore();
    const sa = a * win(t, 16, 17);
    tableP(g, x + 4, y + 262, 380, [
      ['records', `Uint32Array(${fmt(P.F.job.records.length)})`, ACCENT], ['attrs', `Uint32Array(${fmt(P.F.job.records.length)})`, PINK],
      ['count (drawn when no side is open)', fmt(P.F.count), INK], ['borderStart … end: the seam tail', fmt(P.F.tail), GOLD],
    ], { alpha: sa, title: 'THE JOB\'S RESULT' });
    code(c, 'pack', { alpha: fade(t, 0.5, 1.3, 9.6, 10.3), hl: 'packRecord' });
    code(c, 'cellAttr', { alpha: fade(t, 10, 10.8, 20.2, 21), hl: t < 13 ? 'if (lod === 0){' : 'return attrOf8(c & 255', span: t < 13 ? 1 : 1 });
  },
},
/* 10 ----------------------------------------------------------------------------- */
{
  key: 'reply', stage: 'reply', title: 'The reply moves, it doesn\'t copy', dur: 19, side: true,
  steps: (P, D) => [
    [0, `The worker posts the result back with the two buffers in the <b>transfer list</b>. Ownership moves to the main thread; nothing is copied. ${P.detached ? `Tried in this page: a ${fmt(P.detached.before)}-byte copy of our records reads <b>${P.detached.after} bytes</b> on the sending side once posted.` : ''}`],
    [7, `On the main thread, <code>StreamPool._finish</code> matches the reply to its job and calls <code>streamer.complete</code>, which drops a result nobody wants any more and queues the rest.`],
    [11.5, `Once a frame, <code>service()</code> admits them, the pinned chunk first, then holes, then nearest, while under <b>${DEFAULTS.installMs} ms</b> and <b>${DEFAULTS.uploadBytes / 1048576} MB</b> of uploads and ${DEFAULTS.maxInstalls} installs (the first always goes). Each becomes a cache entry, and <code>install(entry)</code> is called.`],
  ],
  cam: t => ({ target: [0, 64, 0], yaw: 1.1 + 0.02 * t, pitch: 0.45, dist: 640 }),
  draw(c){
    const { g, t, P, D } = c;
    mini(c, t < 7 ? 'reply' : 'admit');
    dimWorld(c, 0.8);
    const L = left(c), x = 30, w = Math.min(640, L - 70), a = fade(t, 0.4, 1.2, 18.2, 19), j = P.F.job;
    const cw = (w - 40) / 2, y = 128;
    chip(g, x, y, cw, 50, 'worker 1', 'self.postMessage({ jobId, result }, transfer)', WORKER, a);
    chip(g, x + cw + 40, y, cw, 50, 'main thread', 'StreamPool: worker.onmessage', MAIN, a);
    // The buffers travel.
    const u = eio(win(t, 2, 4.5));
    const bx = lerp(x + 14, x + cw + 54, u), by = y + 70;
    strip(g, bx, by + 16, cw - 28, 12, { n: 48, colorOf: i => css([0.35, 0.7, 1], 0.5 + 0.5 * ((i * 7) % 5) / 5), label: 'records.buffer', right: bytes(j.records.byteLength), alpha: a });
    strip(g, bx, by + 54, cw - 28, 12, { n: 48, colorOf: i => { const [r6, g6, b6] = attrRGB(j.attrs[i * 97 % j.attrs.length]); return `rgb(${r6 * 4},${g6 * 4},${b6 * 4})`; }, label: 'attrs.buffer', right: bytes(j.attrs.byteLength), alpha: a });
    if (u >= 1){
      text(g, 'byteLength: 0 (detached)', x + 14, by + 28, { size: 12, weight: 650, color: FAINT, alpha: a, mono: true, shadow: false });
      text(g, 'byteLength: 0 (detached)', x + 14, by + 66, { size: 12, weight: 650, color: FAINT, alpha: a, mono: true, shadow: false });
    }
    // The queue and the gate.
    const qa = a * win(t, 11.5, 12.3), qy = y + 170;
    if (qa > 0){
      text(g, 'S.results, sorted', x, qy, { size: 12, weight: 700, color: INK, alpha: qa, mono: true, shadow: false });
      const items = ['2:0,0,0 pinned', '0:1,0,1 hole', '0:1,0,0', '0:0,0,1', '1:1,0,1', '0:2,0,1'];
      const gate = x + w * 0.58;
      items.forEach((s, i) => {
        const pass = i < 4, tt = win(t, 12.5 + i * 0.5, 13.3 + i * 0.5);
        const xx = pass ? lerp(x + i * 4, gate + 20 + i * 4, eio(tt)) : x + i * 4, yy = qy + 14 + i * 26;
        chip(g, xx, yy, 170, 22, s, null, i === 0 ? GOLD : MAIN, qa * (pass && tt >= 1 ? 0.9 : 1));
      });
      g.save(); g.globalAlpha = qa; g.strokeStyle = GOLD; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(gate, qy + 8); g.lineTo(gate, qy + 176); g.stroke(); g.restore();
      text(g, `≤ ${DEFAULTS.installMs} ms · ≤ ${DEFAULTS.uploadBytes / 1048576} MB · ≤ ${DEFAULTS.maxInstalls}`, gate, qy + 196, { size: 11.5, weight: 650, color: GOLD, alpha: qa, mono: true, align: 'center', shadow: false });
      text(g, 'install(entry) →', gate + 30, qy + 4, { size: 12, weight: 700, color: MAIN, alpha: qa * win(t, 14, 15), mono: true, shadow: false });
    }
    code(c, 'transfer', { alpha: fade(t, 0.5, 1.3, 6.6, 7.3), hl: t < 2 ? 'const result = runner(data);' : 'self.postMessage({ jobId: data.jobId, result }, transfer);' });
    code(c, 'finish', { alpha: fade(t, 7, 7.8, 11.2, 11.9), hl: 'this.streamer.complete(job, msg.result);' });
    code(c, 'complete', { alpha: fade(t, 7.5, 8.3, 11.2, 11.9), y: P.lay.codeY + 170, hl: 'S.results.push(' });
    codeWalk(c, 'service', t, [[11.5, 'while (S.results.length'], [13, 'if (accepted && (now() - started >= cfg.installMs'], [15, 'installItem(item);']], { alpha: fade(t, 11.5, 12.3, 18.2, 19) });
    code(c, 'installItem', { alpha: fade(t, 14.5, 15.3, 18.2, 19), y: P.lay.codeY + 250, hl: 'entry.gpu = install(entry);' });
  },
},
/* 11 ----------------------------------------------------------------------------- */
{
  key: 'install', stage: 'install', title: 'install(): one buffer, two attributes', dur: 21, side: true,
  steps: (P, D) => [
    [0, `<code>install(entry)</code> is the page's half of the streamer: the GPU side. It packs the records and then their words into one <code>Uint32Array</code> of 2n, and uploads it with <code>bufferData</code>.`],
    [7, `A <b>vertex array object</b> remembers how to read it: attribute 0 is a record at byte 4i, attribute 1 its word at 4n + 4i, both integers (<code>vertexAttribIPointer</code>) with <b>divisor 1</b>: one value an instance, not a vertex. The VAO also binds the one shared cube index buffer.`],
    [14.5, `Then the streamer lets go of the arrays (<code>entry.records = null</code>). JavaScript keeps the counts and a VAO handle; the cubes live only on the GPU, ${bytes(8 * P.F.job.records.length)} for this chunk, until LRU eviction calls <code>dispose</code>.`],
  ],
  cam: t => ({ target: [-32, 20, -32], yaw: 1.0 + 0.2 * t / 21, pitch: 0.45, dist: 330 }),
  draw(c){
    const { F, g, t, P, D } = c;
    mini(c, 'install');
    const j = P.F.job, n = j.records.length;
    const up = win(t, 3, 6.5);
    for (const key of P.lod0) if (key !== P.F.key) chunk(c, key, { tint: BG, tintAmt: 0.8 });
    chunk(c, P.F.key, { hi: Math.round(n * up), glowLo: Math.round(n * up) - 2500, glowHi: Math.round(n * up), glow: up < 1 ? 0.8 : 0 });
    const L = left(c), x = 30, w = Math.min(660, L - 60), y = 132, a = fade(t, 0.4, 1.2, 20.2, 21);
    const cells = 120, half = cells / 2, fillR = win(t, 1.2, 2.8), fillW = win(t, 2.8, 4.2);
    backdrop(g, x, y - 16, w + 24, 76, a);
    text(g, `const both = new Uint32Array(2 * n);  // n = ${fmt(n)}`, x, y, { size: 12.5, weight: 650, color: INK, alpha: a, mono: true, shadow: false });
    const sy = y + 34, cw = w / cells;
    g.save(); g.globalAlpha = a;
    for (let i = 0; i < cells; i++){
      const isW = i >= half, f = isW ? (i - half) / half : i / half, on = isW ? f < fillW : f < fillR;
      let col = 'rgba(255,255,255,0.05)';
      if (on){
        if (isW){ const [r6, g6, b6] = attrRGB(j.attrs[Math.floor(f * n)]); col = `rgb(${r6 * 4},${g6 * 4},${b6 * 4})`; }
        else { const r = j.records[Math.floor(f * n)]; col = css([0.25, 0.45 + 0.4 * (maskOf(r) / 63), 0.95], 0.95); }
      }
      g.fillStyle = col; g.fillRect(x + i * cw, sy, cw - 1, 26);
    }
    g.restore();
    text(g, 'records', x, sy - 8, { size: 11.5, weight: 700, color: ACCENT, alpha: a, mono: true, shadow: false });
    text(g, 'words', x + w / 2, sy - 8, { size: 11.5, weight: 700, color: PINK, alpha: a, mono: true, shadow: false });
    for (const [u, s] of [[0, 'byte 0'], [0.5, `4n = ${fmt(4 * n)}`], [1, `8n = ${fmt(8 * n)}`]])
      text(g, s, x + w * u, sy + 44, { size: 10.5, color: DIM, alpha: a, mono: true, align: u === 0 ? 'left' : u === 1 ? 'right' : 'center', shadow: false });
    // The upload.
    const ua = a * win(t, 4.2, 5);
    arrow(g, x + w + 14, sy + 13, x + w + 14, sy + 92, { color: GPU, alpha: ua, w: 2 });
    pill(g, 'gl.bufferData(ARRAY_BUFFER, both, STATIC_DRAW)', x + w - 160, sy + 104, { size: 11, color: GPU, alpha: ua, mono: true });
    // The VAO.
    const va = a * win(t, 7, 8), vy = sy + 140, vw = Math.min(330, w * 0.52);
    panel(g, x, vy, vw, 150, { alpha: va, stroke: css(rgb01(GPU), 0.5) });
    text(g, 'VAO (one a chunk)', x + 14, vy + 22, { size: 12.5, weight: 700, color: GPU, alpha: va, mono: true, shadow: false });
    const rows = [['ELEMENT_ARRAY_BUFFER', 'cubeIndex (shared)', GOLD, 7.4], ['attrib 0 · aRec', 'uint, offset 0, divisor 1', ACCENT, 8.4], ['attrib 1 · aAttr', `uint, offset 4n, divisor 1`, PINK, 9.4]];
    rows.forEach(([k2, v, col, t0], i) => {
      const ra = va * win(t, t0, t0 + 0.6), yy = vy + 50 + 32 * i;
      text(g, k2, x + 14, yy, { size: 11.5, weight: 700, color: col, alpha: ra, mono: true, shadow: false });
      text(g, v, x + 14, yy + 15, { size: 11, color: DIM, alpha: ra, mono: true, shadow: false });
    });
    arrow(g, x + vw, vy + 62, x + 6, sy + 30, { color: ACCENT, alpha: va * win(t, 8.4, 9), bend: -40, w: 1.6 });
    arrow(g, x + vw, vy + 94, x + w / 2 + 6, sy + 30, { color: PINK, alpha: va * win(t, 9.4, 10), bend: -30, w: 1.6 });
    // JS lets go.
    const ga = a * win(t, 14.5, 15.5);
    if (ga > 0){
      g.save(); g.globalAlpha = ga * 0.8; g.fillStyle = 'rgba(5,7,12,0.7)'; g.fillRect(x - 4, y - 18, w + 8, 76); g.restore();
      text(g, 'entry.records = null; entry.attrs = null;', x + w / 2, y + 30, { size: 14, weight: 700, color: GOLD, alpha: ga, mono: true, align: 'center' });
      text(g, `on the GPU: ${bytes(8 * n)} · in JS: { vao, buf }`, x + vw + 20, vy + 140, { size: 12, weight: 650, color: GPU, alpha: ga, mono: true, shadow: false });
    }
    codeWalk(c, 'install', t, [[0, 'if (!entry.total) return null;'], [1.2, 'both.set(entry.records);'], [2.8, 'if (entry.attrs) both.set(entry.attrs, n);'], [4.2, 'gl.bufferData(gl.ARRAY_BUFFER, both, gl.STATIC_DRAW);'],
                               [7.4, 'gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIndex);'], [8.4, 'gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, 4, 0);', 2], [9.4, 'gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 4, 4 * n);', 2], [12, 'return { vao, buf };']],
             { alpha: fade(t, 0.5, 1.3, 20.2, 21) });
  },
},
/* 12 ----------------------------------------------------------------------------- */
{
  key: 'cube', stage: 'draw', title: 'One cube for every chunk', dur: 17, side: true,
  steps: (P, D) => [
    [0, `What's drawn for every record is one cube, from one tiny index buffer made once when the page starts: <code>cubeIndex</code>, 36 bytes of triangles (and 60 of wireframe lines after them).`],
    [5, `It indexes 24 corners, four a face, in the mask's face order: corners 0–3 are +X, 4–7 are −X, and so on. A face is two triangles, <code>b, b+1, b+2</code> and <code>b, b+2, b+3</code>. Corners aren't shared between faces, so each face knows which it is: <code>face = corner / 4</code>.`],
    [11.5, `There's no vertex buffer at all. The viewer draws the first 18 indices, three faces, and the vertex shader gets each as <code>gl_VertexID</code>, 0 to 11. It turns that into a corner of the face on the eye's side, one an axis, and looks its offset up in a constant table, <code>CORNER[24]</code>, the page's <code>FACE_OFF</code>.`],
  ],
  cam: t => ({ target: [0, 40, 0], yaw: 0.65 + 0.35 * t / 17, pitch: 0.38, dist: 135 }),
  env: () => ({ grid: 0.4 }),
  draw(c){
    const { F, g, t, P } = c;
    mini(c, 'draw');
    const S = 40, FCOL = FACE6.map(rgb01), C0 = [0, 40, 0];
    const corner = i => add3(C0, FACE_OFF[i].map(v => v * S));
    const inset = i => { const f = (i / 4) | 0, ctr = [0, 0, 0]; for (let q = 0; q < 4; q++){ const p = corner(4 * f + q); ctr[0] += p[0] / 4; ctr[1] += p[1] / 4; ctr[2] += p[2] / 4; } return lerp3(corner(i), ctr, 0.24); };
    const k = Math.floor(36 * win(t, 3, 11.5) + 1e-6), tris = Math.floor(k / 3);
    // Faces fill once both their triangles are in.
    for (let f = 0; f < 6; f++){
      const done = win(t, 3 + (f * 6 + 6) / 36 * 8.5, 3.5 + (f * 6 + 6) / 36 * 8.5);
      if (done <= 0) continue;
      const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][f], ctr = add3(C0, n.map(v => v * S / 2));
      const sz = n.map(v => v ? 0.4 : S * 0.98);
      F.box(ctr[0], ctr[1], ctr[2], sz[0], sz[1], sz[2], FCOL[f][0], FCOL[f][1], FCOL[f][2], 0.32 * done);
    }
    for (let q = 0; q < tris; q++){
      const a = CUBE_INDEX[3 * q], b = CUBE_INDEX[3 * q + 1], cc = CUBE_INDEX[3 * q + 2], col = C4(FCOL[(a / 4) | 0], 0.95);
      F.seg(inset(a), inset(b), col, 2.2, { top: true }); F.seg(inset(b), inset(cc), col, 2.2, { top: true }); F.seg(inset(cc), inset(a), col, 2.2, { top: true });
    }
    for (let i = 0; i < 24; i++){
      const a = win(t, 1 + i * 0.07, 1.4 + i * 0.07), p = inset(i);
      F.cube(p[0], p[1], p[2], 1.1, 1, 1, 1, 1, 0.6 * a);
      label3(F, g, p, String(i), { alpha: a, size: 11, mono: true, color: FACE6[(i / 4) | 0] });
    }
    // The index buffer, consumed.
    const L = left(c), x = 30, y = 136, w = Math.min(660, L - 60), cw = w / 36, a = fade(t, 0.4, 1.2, 16.2, 17);
    text(g, 'cubeIndex: Uint8Array, triangles', x, y - 10, { size: 12, weight: 700, color: INK, alpha: a, mono: true, shadow: false });
    for (let i = 0; i < 36; i++){
      const f = (i / 6) | 0, on = i < k;
      g.save(); g.globalAlpha = a; g.fillStyle = on ? css(FCOL[f], 0.85) : 'rgba(255,255,255,0.05)'; g.fillRect(x + i * cw, y, cw - 2, 24); g.restore();
      text(g, String(CUBE_INDEX[i]), x + i * cw + (cw - 2) / 2, y + 16.5, { size: 10.5, weight: 700, color: on ? '#0b0f18' : DIM, alpha: a, mono: true, align: 'center', shadow: false });
    }
    SIDE_NAMES.forEach((s, f) => text(g, `${s}: ${4 * f}–${4 * f + 3}`, x + (f * 6 + 3) * cw, y + 42, { size: 11, weight: 700, color: FACE6[f], alpha: a, align: 'center', mono: true, shadow: false }));
    code(c, 'cubeIndex', { alpha: fade(t, 0.5, 1.3, 11, 11.8), hl: t < 5 ? 'idx.set([b, b+1, b+2, b, b+2, b+3], 6 * f);' : 'const b = 4 * f;', span: 1 });
    code(c, 'faceOff', { alpha: fade(t, 11.5, 12.3, 16.2, 17), hl: 0, span: 4 });
    code(c, 'rasterVS', { alpha: fade(t, 12, 12.8, 16.2, 17), y: P.lay.codeY + 150, hl: 'uint v = uint(gl_VertexID), k = v / 4u;', span: 3 });
  },
},
/* 13 ----------------------------------------------------------------------------- */
{
  key: 'draw', stage: 'draw', title: 'renderView: one draw call a chunk', dur: 20, side: true,
  steps: (P, D) => [
    [0, `Each frame, <code>renderView</code> takes the streamer's cover (what to draw now), keeps the chunks resident and installed, and sorts them near to far. Chunks outside the view's frustum are skipped: here <b>${P.view.culled.length}</b> of ${P.view.list.length}.`],
    [6, `For each one it sets three uniforms and makes <b>one call</b>: <code>drawElementsInstanced(TRIANGLES, RD.tris, UNSIGNED_BYTE, 0, n)</code>. 18 indices, the first three faces of the cube index, and n instances: one cube per record. <code>uOrigin</code> is the chunk's corner <b>minus the eye</b>, so a huge world keeps its precision near the eye.`],
    [13.5, `That's the whole of the CPU's work per frame for raster chunks: a sort, a frustum test and a few uniforms a chunk. ${P.view.drawn.length} calls draw ${fmt(P.view.drawn.reduce((a, q) => a + P.job(q.d.key).count, 0))} cubes here.`],
  ],
  cam: t => ({ target: [-45, 20, -35], yaw: -0.95 + 0.12 * t / 20, pitch: 0.78, dist: 540 }),
  draw(c){
    const { F, g, t, P, D } = c;
    mini(c, 'draw');
    const V = P.view, k = Math.floor(V.drawn.length * win(t, 3, 13) + 1e-6);
    let inst = 0, tris = 0;
    V.drawn.forEach((q, i) => {
      const j = P.job(q.d.key), open = q.d.open, n = open ? j.records.length : j.count;
      if (i < k){
        chunk(c, q.d.key, { open, n, glowLo: 0, glowHi: i === k - 1 ? 1e9 : 0, glow: 0.45 });
        inst += n; tris += 2 * quadsShown(j.quads, j.openQuads, open);
      } else box(F, q.d.lo, q.d.size, lodCol(q.d.lod), 0.25, 1);
    });
    V.culled.forEach(q => box(F, q.d.lo, q.d.size, rgb01(RED), 0.45 * win(t, 1, 2), 1.2));
    // The view's eye and frustum.
    const e = W2S(V.eye), dir = sub3(V.look, V.eye), L = Math.hypot(...dir), f = dir.map(v => v / L);
    const right = [-f[2], 0, f[0]].map(v => v / Math.hypot(f[0], f[2])), up = [right[1] * f[2] - right[2] * f[1], right[2] * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
    const far = 190, hh = far * Math.tan(0.45), hw = hh * 16 / 9;
    const fc = add3(e, f.map(v => v * far)), corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => add3(fc, add3(right.map(v => v * a * hw), up.map(v => v * b * hh))));
    const fa = [1, 0.85, 0.4, 0.7];
    corners.forEach((p, i) => { F.seg(e, p, fa, 1.4, { top: true }); F.seg(p, corners[(i + 1) % 4], fa, 1.4, { top: true }); });
    F.cube(e[0], e[1], e[2], 6, 1, 0.85, 0.4, 1, 1.3);
    label3(F, g, e, 'the view\'s eye', { dy: -22, color: GOLD, size: 12 });
    // The chunk being drawn.
    const cur = V.drawn[Math.min(k, V.drawn.length) - 1];
    const x = 30, y = 124, a = fade(t, 0.5, 1.3, 19.2, 20);
    if (cur && t > 3){
      const j = P.job(cur.d.key), n = cur.d.open ? j.records.length : j.count;
      box(F, cur.d.lo, cur.d.size, rgb01(GOLD), 1, 2.6, { top: true });
      card(g, x, y, 330, `draw ${Math.min(k, V.drawn.length)} of ${V.drawn.length}: chunk ${cur.d.key}`, [
        ['uOrigin = lo − eye', `(${cur.rel.map(v => v.toFixed(0)).join(', ')})`, ACCENT], ['uCellSize = 2^lod', j.cellSize], ['uOpenSides', `${bin(cur.d.open, 6)}₂`],
        ['instances n', fmt(n), GOLD], ['so far: calls · cubes', `${Math.min(k, V.drawn.length)} · ${fmt(inst)}`, INK], ['triangles shown', fmt(tris), PINK],
        ['chunks culled', fmt(V.culled.length), RED],
      ], { alpha: a, color: GOLD });
    }
    code(c, 'drawList', { alpha: fade(t, 0.5, 1.3, 19.2, 20), hl: 'const e = streamer.entry(d.key);', span: 2, maxLines: 8 });
    codeWalk(c, 'drawCall', t, [[0, 'for (const { d, e, rel, size, origin, P, okey } of list){'], [1.5, 'if (!boxVisible(planes, rel, size))'], [3.5, 'const open = state.seams ? d.open : 0'], [6, 'gl.uniform3f(U.uOrigin', 3],
                                [8.5, 'gl.bindVertexArray(e.gpu.vao);'], [9.5, 'gl.drawElementsInstanced(gl.TRIANGLES, RD.tris'], [12, 'view.drawn++; view.instances += n;']],
             { alpha: fade(t, 0.5, 1.3, 19.2, 20), y: P.lay.codeY + 170 });
  },
},
/* 14 ----------------------------------------------------------------------------- */
{
  key: 'vertex', stage: 'vertex', title: 'The vertex shader rebuilds the cube', dur: 24, side: true,
  steps: (P, D) => [
    [0, `On the GPU the call runs the vertex shader 18 times per instance, over 12 corners: three faces of four. Each run gets its instance's record as <code>aRec</code> and its corner as <code>gl_VertexID</code>, 0 to 11. First the cell: <code>mortonDecode</code> pulls x, y and z back out of the index's bits.`],
    [5.5, `The cube's centre is <code>uOrigin + (cell + 0.5) · uCellSize</code>, and each corner adds <code>CORNER[corner] · uCellSize</code>. The same 24 offsets for every cube; only the record differs. Here all six faces are built, so you can see them.`],
    [11.5, `Which faces: <code>k = corner / 4</code> is an axis, and of its two faces only the one on the eye's side can face it, so <code>face = 2k + (c[k] < 0 ? 0 : 1)</code>. The other three are never sent. If the record's mask hides the face, the vertex is put at <code>(2, 2, 2, 1)</code>, outside clip space, so its triangles are clipped away whole. (Drawn here as flying off; the shader does it in one step.)`],
    [17.5, `Every instance of the chunk at once: the faces against neighbours go, and what's left is the chunk's surface. A vertex shader the size of a paragraph, no geometry stored anywhere.`],
  ],
  cam: t => camKeys(t, [
    [0, { target: [-26.5, 63.5, -26.5], yaw: 0.72, pitch: 0.5, dist: 13 }],
    [5.5, { target: [-26.5, 63.5, -26.5], yaw: 0.8, pitch: 0.45, dist: 7 }],
    [11, { target: [-26.5, 63.5, -26.5], yaw: 1.0, pitch: 0.42, dist: 6.5 }],
    [17, { target: [-26.5, 63, -26.5], yaw: 1.15, pitch: 0.55, dist: 15 }],
    [21.5, { target: [-32, 34, -32], yaw: 1.3, pitch: 0.5, dist: 150 }],
    [24, { target: [-32, 34, -32], yaw: 1.35, pitch: 0.5, dist: 160 }],
  ]),
  draw(c){
    const { F, g, t, P, D } = c;
    mini(c, 'vertex');
    const r = P.F.record, idx = r.index, b = P.batch.get(P.F.key), o = P.forigin;
    const grow = eio(win(t, 6, 10.5)), fling = t < 12 ? 0 : t < 16.5 ? eio(win(t, 12, 16.5)) : -1;
    const all = t > 17.5;
    if (!all){
      // The rest of the chunk fades out (dithered) while our one instance is
      // built alone, with the knobs; its neighbours would hide the faces it drops.
      const ra = 1 - win(t, 4, 5.5);
      F.records(b, o, 1, { hi: idx, tint: BG, tintAmt: 0.55, alpha: ra });
      F.records(b, o, 1, { lo: idx + 1, tint: BG, tintAmt: 0.55, alpha: ra });
      if (t > 5.5) F.records(b, o, 1, { lo: idx, hi: idx + 1, grow: Math.max(0.001, grow), hiddenT: t < 12 ? 0 : fling, glowLo: idx, glowHi: idx + 1, glow: 0.25 });
    } else {
      const u = eio(win(t, 18, 21));
      F.records(b, o, 1, { hiddenT: u < 1 ? u : -1 });
      for (const key of P.lod0) if (key !== P.F.key) chunk(c, key, { tint: BG, tintAmt: 0.6 * win(t, 20, 22) });
    }
    // The centre, the origin and the corners.
    const ca = fade(t, 0.8, 1.6, 11.5, 12.5);
    if (ca > 0){
      F.cube(P.rpos[0], P.rpos[1], P.rpos[2], 0.12, 1, 0.85, 0.4, 1, 1.5);
      label3(F, g, P.rpos, `centre (${(r.x + 0.5)}, ${r.y + 0.5}, ${r.z + 0.5}) + uOrigin`, { dy: 34, dx: 30, color: GOLD, size: 11.5, mono: true, alpha: ca * win(t, 2.5, 3.5) });
    }
    const pa = fade(t, 6, 7, 11.5, 12.5);
    if (pa > 0) for (let i = 0; i < 24; i++){
      const p = add3(P.rpos, FACE_OFF[i].map(v => v * grow));
      F.cube(p[0], p[1], p[2], 0.07, 1, 1, 1, 1, 0.8 * pa);
    }
    if (t > 12 && t < 17.5) for (let f = 0; f < 6; f++) if (!(r.mask >> f & 1)){
      const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][f];
      label3(F, g, add3(P.rpos, n.map(v => v * (0.5 + 5 * Math.max(0, fling)))), `${SIDE_NAMES[f]}: hidden → (2, 2, 2, 1)`, { alpha: fade(t, 12.3, 13, 15.5, 16.5), color: RED, size: 11, mono: true });
    }
    // What this one invocation sees.
    const x = 30, y = 124, a = fade(t, 0.6, 1.4, 17, 18);
    card(g, x, y, 340, 'one instance, one corner', [
      ['gl_InstanceID', fmt(idx)], ['aRec', hex(r.rec), ACCENT], ['recCell(aRec)', `(${r.x}, ${r.y}, ${r.z})`, ACCENT],
      ['uOrigin (here: the corner)', `(${P.F.job.lo.join(', ')})`], ['uCellSize', '1'],
      ['face = 2k + side', t < 11.5 ? '…' : '0 … 5', GOLD], ['faceShown', t < 11.5 ? '…' : SIDE_NAMES.map((s, f) => (r.mask >> f & 1) ? s : '').filter(Boolean).join(' '), GREEN],
    ], { alpha: a, color: GPU });
    codeWalk(c, 'rasterVS', t, [[0, 'void main(){'], [2, 'vAttr = aAttr;'], [5.5, 'vec3 p = c + CORNER[corner] * uCellSize;'], [8, 'gl_Position = uViewProj * vec4(q, 1.0);'],
                                [11.5, 'uint face = ALL_SIX ? k'], [13, 'if (!faceShown(aRec, face)']], { alpha: fade(t, 0.5, 1.3, 23.2, 24) });
    codeWalk(c, 'decode', t, [[0, 'uvec3 mortonDecode(uint i){'], [2.5, 'uvec3 recCell(uint r)'], [5.5, 'vec3  recCentre(uint r)'], [11.5, 'uint  recShown(uint r)'], [13, 'bool  faceShown(uint r, uint f)']],
             { alpha: fade(t, 0.8, 1.6, 23.2, 24), y: P.lay.codeY + 248, maxLines: 22 });
  },
},
/* 15 ----------------------------------------------------------------------------- */
{
  key: 'fragment', stage: 'fragment', title: 'Colour, light and fog, per pixel', dur: 16, side: true,
  steps: (P, D) => {
    const [r6, g6, b6] = attrRGB(P.F.record.attr);
    return [
      [0, `The record's word rides along as a <code>flat</code> varying, the same for every pixel of the cube. In attribute mode the fragment shader turns it into a colour: <code>attrRGB</code> takes the three 6-bit channels, divided by 63. Ours is (${r6}, ${g6}, ${b6}).`],
      [5.5, `<code>shadeOut</code> lights it: 0.55 everywhere, plus 0.45 of a key light from above and 0.12 of a fill from below. A face's normal is fixed by its face number, so each of the six faces gets one shade.`],
      [10.5, `Then fog with the distance to the eye, toward the background. That's the viewer's pixel. (The rest of this film uses its own light, with edges drawn in; this chapter switches to the page's.)`],
    ];
  },
  cam: t => ({ target: [-30, 36, -30], yaw: 0.85 + 0.25 * t / 16, pitch: 0.5, dist: lerp(150, 260, eio(win(t, 10, 15))) }),
  draw(c){
    const { g, t, P } = c;
    mini(c, 'fragment');
    const shade = t < 5.5 ? 3 : t < 10.5 ? 1 : 2;
    for (const key of P.lod0) chunk(c, key, { shade, vfog: 1 / (1.5 * 256) });   // the viewer's uFog: 1 / (1.5 · world side)
    const x = 30, y = 124, a = fade(t, 0.5, 1.3, 15.2, 16), [r6, g6, b6] = attrRGB(P.F.record.attr);
    card(g, x, y, 330, 'per pixel', [
      ['vAttr (flat)', hex(P.F.record.attr), PINK], ['attrRGB(vAttr) / 63', `(${(r6 / 63).toFixed(2)}, ${(g6 / 63).toFixed(2)}, ${(b6 / 63).toFixed(2)})`, PINK],
      ['+Y face: 0.55 + 0.45 · n·L₁', (0.55 + 0.45 * 0.8 / Math.hypot(0.5, 0.8, 0.35)).toFixed(3), shade >= 1 ? GOLD : FAINT],
      ['fog = 1 − e^(−dist · uFog)', shade === 2 ? 'on' : 'off', shade === 2 ? GOLD : FAINT],
    ], { alpha: a, color: GPU });
    g.save(); g.globalAlpha = a; g.fillStyle = `rgb(${r6 * 255 / 63}, ${g6 * 255 / 63}, ${b6 * 255 / 63})`; roundRect(g, x + 344, y + 8, 40, 40, 8); g.fill(); g.restore();
    code(c, 'fsMain', { alpha: fade(t, 0.5, 1.3, 15.2, 16), hl: t < 5.5 ? 'attrColour(vAttr)' : 'outColor = shadeOut(base, vNormal, vRel);' });
    codeWalk(c, 'shadeOut', t, [[0, 'vec4 shadeOut('], [5.5, 'float shade = 0.55', 2], [10.5, 'float fog = 1.0 - exp(', 2]], { alpha: fade(t, 1, 1.8, 15.2, 16), y: P.lay.codeY + 200 });
  },
},
/* 16 ----------------------------------------------------------------------------- */
{
  key: 'seams', stage: 'draw', title: 'Where two lods meet', dur: 22, side: true,
  steps: (P, D) => [
    [0, `This cut draws <span style="color:${LOD[0]}">lod 0</span> on the left and <span style="color:${LOD[1]}">lod 1</span> on the right. Each chunk's apron hid the faces against its <b>same-lod</b> neighbour, but that neighbour isn't drawn: a chunk of the other lod is. Slide lod 1 away and look at lod 0's side of the seam: it's full of holes, faces hidden against cubes that aren't there. Lod 1's side is the same.`],
    [9.5, `<code>coverOf</code> marks each drawn chunk's <b>open</b> sides: neighbours that exist but aren't drawn at its lod. Then the shader shows every boundary face on an open side (<code>recShown</code>), and the draw takes <code>n = total</code>, adding the job's <b>seam tail</b>: boundary cells the apron alone had buried. In gold.`],
    [16, `Pushed back together, the two lods close on each other with no crack. A cell joins the tail only if the coarser cell across it isn't full, so a solid chunk underground doesn't carry its whole boundary shell: the focus chunk's tail is ${fmt(P.F.tail)} cells.`],
  ],
  pick(D){
    return D.seams.draw.filter(d => d.lo[1] === 0 && (d.lod === 0 ? d.lo[0] < 128 : d.lo[0] === 128));
  },
  cam: t => camKeys(t, [
    [0, { target: [0, 30, -64], yaw: 0.75, pitch: 0.5, dist: 330 }],
    [3, { target: [0, 30, -64], yaw: 0.9, pitch: 0.45, dist: 300 }],
    [6.5, { target: [0, 22, -64], yaw: 1.5, pitch: 0.2, dist: 150 }],
    [14, { target: [0, 22, -64], yaw: 1.62, pitch: 0.2, dist: 140 }],
    [18, { target: [0, 30, -64], yaw: 0.85, pitch: 0.45, dist: 300 }],
    [22, { target: [0, 30, -64], yaw: 0.95, pitch: 0.45, dist: 290 }],
  ]),
  draw(c){
    const { F, g, t, P, D } = c;
    mini(c, 'draw');
    const on = t >= 9.5, ex = 240 * (eio(win(t, 3, 6.5)) - eio(win(t, 14, 18)));
    const list = this.pick(D);
    let added = 0, tail = 0;
    for (const d of list){
      const j = P.job(d.key), open = on ? d.open : 0, o = W2S(d.lo);
      if (d.lod === 1) o[0] += ex;
      c.F.records(P.batch.get(d.key), o, j.cellSize, { open, n: open ? j.records.length : j.count, tint: lodCol(d.lod), tintAmt: 0.22, seamGlow: on ? lerp(1, 0.35, win(t, 16, 18)) : 0 });
      if (d.open){ added += quadsShown(j.quads, j.openQuads, d.open) - j.quads; tail += j.records.length - j.count; }
      const lo = W2S(d.lo); if (d.lod === 1) lo[0] += ex;
      F.wire(lo, add3(lo, [d.size, d.size, d.size]), C4(lodCol(d.lod), 0.45), 1.3);
    }
    const x = 30, y = 124, a = fade(t, 0.5, 1.3, 21.2, 22);
    pill(g, on ? 'seams on: uOpenSides = open, n = total' : 'seams off: uOpenSides = 0, n = count', x + 170, y + 10, { size: 12.5, color: on ? GOLD : RED, alpha: a, mono: true });
    tableP(g, x + 14, y + 72, 330, [
      ...list.filter(d => d.open).map(d => [`chunk ${d.key}`, `open ${SIDE_NAMES.filter((_, f) => d.open >> f & 1).join(' ')}`, LOD[d.lod]]),
      ['faces the open sides add', fmt(added), GOLD], ['seam-tail cubes they add', fmt(tail), GOLD],
    ], { alpha: a * win(t, 9.5, 10.5), title: 'COVEROF: OPEN SIDES' });
    code(c, 'seamDraw', { alpha: fade(t, 0.5, 1.3, 21.2, 22), hl: 0 });
    code(c, 'recShown', { alpha: fade(t, 9.5, 10.3, 21.2, 22), y: P.lay.codeY + 80, hl: t < 12.5 ? 'uint  recShown(uint r)' : 'uint  boundaryBits(uvec3 c){', span: t < 12.5 ? 1 : 3 });
  },
},
/* 17 ----------------------------------------------------------------------------- */
{
  key: 'stream', stage: null, title: 'Every frame, the whole road', dur: 32, side: true,
  steps: (P, D) => [
    [0, `Now all of it at once: the real <code>createStreamer</code> on this world, its cut at detail ${STREAM.detail}, fed by four simulated workers on a virtual clock (experiments/stream-sim.mjs's loop and job-time model). Played slowed down, by up to ${Math.round(P.sslow(1))}× while chunks arrive; the timeline says how much.`],
    [4.5, `Frame one asks for everything and has nothing. The pinned top chunk comes first, and the whole world is drawn from it at lod 2; then lod 1 and lod 0 replace their parents only when <b>all</b> their siblings are in ("complete beats finer"), so nothing is drawn twice. This world is in by frame 6, ${(6 * STREAM.frameMs).toFixed(0)} ms.`],
    [12.5, `Then the eye flies on. When the cut changes, the new chunks are asked for, nearest first, run on whichever worker is free, and drawn the frame they're admitted; their parents cover for them until then. The cache is cut to ${STREAM.cacheMax} chunks here, so the least recently used are evicted and their buffers deleted.`],
    [25, `That's the stream viewer: <code>update</code>, <code>dispatch</code>, <code>service</code>, <code>draw</code>, once a frame. Everything else in this film happens inside one of those four calls.`],
  ],
  cam(t, P){
    const fr = P.D.stream.frames[Math.floor(P.sframe(t))], e = W2S(fr.eye);
    return { target: lerp3([0, 40, 0], [e[0] * 0.4, 40, e[2] * 0.4], 0.6), yaw: 0.6 + 0.6 * t / 32, pitch: 0.6, dist: 700 };
  },
  draw(c){
    const { F, g, t, P, D } = c;
    const S = D.stream, fi = P.sframe(t), f = Math.floor(fi), fr = S.frames[f];
    const lit = new Set(['cut', 'job', 'expand', 'reply', 'admit', 'install', 'draw', 'vertex', 'fragment']);
    if (c.W >= 760){ const w = Math.min(560, c.W - 480); drawMap(g, (c.W - w) / 2, 18, w, { lit, alpha: 0.95 }); }
    // Recently installed glow, by frames since.
    const age = new Map();
    for (let q = Math.max(0, f - 6); q <= f; q++) for (const k2 of S.frames[q].installed) age.set(k2, f - q);
    for (const d of fr.draw){
      const j = P.job(d.key), a2 = age.get(d.key);
      chunk(c, d.key, { open: d.open, n: d.open ? j.records.length : j.count, glowLo: 0, glowHi: a2 !== undefined ? 1e9 : 0, glow: a2 !== undefined ? 0.8 * (1 - a2 / 7) : 0 });
    }
    for (const n of fr.nodes) if (n.leaf) box(F, n.lo, n.size, lodCol(n.lod), 0.55, n.lod ? 1.8 : 1.2);
    const holes = new Set(fr.holes);
    for (const n of fr.nodes) if (holes.has(n.key)) box(F, n.lo, n.size, rgb01(RED), 0.9, 2.2);
    const e = W2S(fr.eye);
    F.cube(e[0], e[1], e[2], 6, 1, 0.85, 0.4, 1, 1.3);
    F.seg(e, [e[0], 0, e[2]], [1, 0.82, 0.4, 0.4], 1.4);
    // The workers, as a timeline.
    const L = P.lay, gw = L.narrow ? c.W - 60 : L.codeW, gx = L.narrow ? 30 : L.codeX, gh = 150, gy = c.H - 96 - gh;
    const a = fade(t, 0.5, 1.3, 31.2, 32) * (L.narrow ? 0 : 1);   // no room on a phone
    panel(g, gx, gy, gw, gh, { alpha: a });
    const T = (f + (fi - f)) * S.frameMs + S.frameMs, span = 240, t0 = T - span * 0.8, xOf = v => gx + 90 + (v - t0) / span * (gw - 104);
    text(g, 'WORKERS · virtual ms', gx + 14, gy + 20, { size: 10.5, weight: 800, color: WORKER, alpha: a, track: 1, shadow: false });
    text(g, `frame ${f + 1} · ${T.toFixed(0)} ms · ${Math.round(P.sslow(t))}× slower`, gx + gw - 14, gy + 20, { size: 11, weight: 650, color: DIM, alpha: a, mono: true, align: 'right', shadow: false });
    g.save(); g.beginPath(); g.rect(gx + 88, gy + 26, gw - 100, gh - 30); g.clip();
    for (let q = Math.floor(t0 / S.frameMs); q * S.frameMs < t0 + span; q++){
      const xx = xOf(q * S.frameMs);
      g.globalAlpha = a * 0.5; g.strokeStyle = 'rgba(140,190,255,0.18)'; g.beginPath(); g.moveTo(xx, gy + 30); g.lineTo(xx, gy + gh - 8); g.stroke();
    }
    for (const b of S.bars){
      if (b.t1 < t0 || b.t0 > T) continue;
      const x0 = xOf(b.t0), x1 = xOf(Math.min(b.t1, T)), yy = gy + 34 + b.w * 27;
      g.globalAlpha = a; g.fillStyle = css(lodCol(b.lod), b.t1 <= T ? 0.85 : 0.5);
      roundRect(g, x0, yy, Math.max(2, x1 - x0 - 1), 20, 4); g.fill();
      if (x1 - x0 > 50) text(g, b.key, x0 + 6, yy + 14, { size: 10.5, weight: 700, color: '#0b0f18', alpha: a, mono: true, shadow: false });
    }
    g.restore();
    for (let w = 0; w < 4; w++) text(g, `worker ${w + 1}`, gx + 14, gy + 48 + w * 27, { size: 11, weight: 600, color: DIM, alpha: a, mono: true, shadow: false });
    g.save(); g.globalAlpha = a; g.strokeStyle = GOLD; g.lineWidth = 1.5; const nx = xOf(T); g.beginPath(); g.moveTo(nx, gy + 28); g.lineTo(nx, gy + gh - 6); g.stroke(); g.restore();
    // The streamer's numbers.
    const x = 30, y = 124;
    tableP(g, x + 14, y, 300, [
      ['chunks in the cut', fr.nodes.length, INK], ['drawn (the cover)', fr.draw.length, INK], ['holes (nothing to draw)', fr.holes.length, fr.holes.length ? RED : FAINT],
      ['drawn coarser than wanted', fr.up, fr.up ? GOLD : FAINT],
      ['resident / cache max', `${fr.resident} / ${STREAM.cacheMax}`, INK], ['jobs in flight', fr.inFlight, WORKER],
      ['installed this frame', fr.installed.length ? `${fr.installed.length} (${bytes(fr.upload)})` : '0', fr.installed.length ? MAIN : FAINT],
      ['evicted this frame', fr.evicted.length ? fr.evicted.join(' ') : '0', fr.evicted.length ? RED : FAINT],
    ], { alpha: a, title: `STREAMER, FRAME ${f + 1}` });
    const step = ['streamer.update(e)', 'pool.dispatch();', 'streamer.service();', 'if (doDraw) draw();'][Math.floor(t / 1.1) % 4];
    code(c, 'frame', { alpha: fade(t, 0.5, 1.3, 31.2, 32), hl: step });
  },
},
/* 18 ----------------------------------------------------------------------------- */
{
  key: 'finale', stage: null, title: 'From 9 numbers a node to a frame', dur: 15,
  steps: (P, D) => {
    const T = D.totals.lod[0], tris = P.lod0.reduce((a, key) => a + 2 * P.job(key).quads, 0);
    return [
      [0, `The whole road for this world: <b>${fmt(D.nodes)}</b> nodes, a <b>${bytes(D.bytes.keys + D.bytes.counts + D.bytes.poses)}</b> snapshot, ${T.chunks} chunk jobs at lod 0, <b>${fmt(T.records)}</b> records and as many words (${bytes(T.bytes)}), ${T.chunks} draw calls, <b>${fmt(tris)}</b> triangles shown.`],
      [7.5, `The JavaScript decides and packs; the GPU only ever sees two integers a cube and one 36-byte cube. To read on: <code>docs/stream-plan.md</code>, <code>docs/expand-plan.md</code>, and the renderer explainer page, which runs these same cores on your own view.`],
    ];
  },
  cam: t => ({ target: [0, 50, 0], yaw: 1.4 + 0.05 * t, pitch: 0.4, dist: 600 }),
  draw(c){
    const { g, t, W, H } = c;
    world(c, { tint: BG, tintAmt: lerp(0, 0.6, win(t, 0.5, 2)) });
    const w = Math.min(1180, W - 80), x = (W - w) / 2, y = Math.max(90, H * 0.2);
    drawMap(g, x, y, w, { big: true, reveal: 1, alpha: fade(t, 0.8, 1.8, 14, 15), lit: new Set(STAGES.map(s => s.key)), packet: ((t * 1.2) % 1) * (STAGES.length - 1) });
  },
},
];
