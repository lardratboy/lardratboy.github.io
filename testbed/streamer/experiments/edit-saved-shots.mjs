/* A saved clay world edited again, drawn at lods 1–3 under option A, A′ (never
   built) and A″ (built 2026-11-27), for docs/edit-saved-plan.md Q2 ("build A and
   look at lod 2–3") and edit-saved-log §5 ("build A″ and show me the same
   pictures").

     node experiments/edit-saved-shots.mjs [outdir]     (default docs/images)

   Two sets of sheets: edit-saved-{view}-lod{l}.png is A | A′ | diff, as first
   made (the same bytes: that's the check that A below is the A that was built),
   and edit-saved-a2-{view}-lod{l}.png is A | A″ | diff.

   The world: clay at D = 9, a 128 ball on its ground, saved once with two blocks
   (flatten-core, six-bit words as a file gives them back) and reopened as a plain
   baked world. Then a second session through one log, as the page makes it: a
   named sphere dropped half into the ball's top, the baked balls (baked-worlds.js)
   half into the ground at its foot, blocks of three sizes on the ground, the ball
   and the sphere, and a level-4 break into the ball's front (its insides, drawn by
   baked-core's fallback).

   **Not the viewer.** The words are exactly the job's (expandWorld, the viewer's
   `shadow` rule, seams on), and A″'s are the engine's scene.mean. A is the
   engine's sceneField too, over the same drops, but handed a block table whose
   `latestIn` asks `lookup` at the cell's centre, which was A's block rule. A′ is
   written here, not in the engine: for a cell some op owns under A, the
   count-weighted mean of its eight sub-cells, each by A one level down; for a cell
   no op owns, the base's mean, as under A. "Owns" is asked of the engine itself:
   A's field over a base whose mean answers NaN, so a NaN is a cell A gives the
   base. Then a small
   CPU ray caster draws the shown cells of a 256³ box round the ball, each face lit
   by one light, no fog, no SSAO. So colours are the viewer's, shading isn't.

   Prints, for each lod, how many shown cells A and A′ (then A and A″) give
   different words, and by how many six-bit steps at most. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { createStore, createCounts, EMPTY } from '../dag-core.js';
import { expandWorld, mortonXYZ, cellOf } from '../chunk-core.js';
import { attrOf8, attrRGB, packAttr } from '../attr-core.js';
import { buildClay, clayDesc, clayPlace } from '../clay-core.js';
import { colourOf } from '../colours.js';
import { createOneLog, createOneTable, LOG_WORDS, BLOCK } from '../log-core.js';
import { sceneField } from '../scene-core.js';
import { flatten } from '../flatten-core.js';
import { sixBitWords } from '../vdag-core.js';
import { PALETTE, createBlockTable, BREAK } from '../edit-core.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { solidBaked } from '../test/baked-worlds.js';

const OUT = process.argv[2] || new URL('../docs/images/', import.meta.url).pathname;
const D = 9, desc = clayDesc({ D, lump: 128, ground: true }), P = clayPlace(desc), [cx, cy, cz] = P.centre, r = P.r;

/* ---- the first session, saved -------------------------------------------------- */
const first = buildClay(desc), log1 = createOneLog(first.root);
log1.place(first.store, D, { level: 3, X: cx >> 3, Y: (cy + r) >> 3, Z: cz >> 3 }, PALETTE[1]);      // on the top
log1.place(first.store, D, { level: 2, X: (cx + r + 16) >> 2, Y: cy - r + 8 >> 2, Z: cz >> 2 }, PALETTE[3]);
const counts1 = createCounts(first.store), t1 = createOneTable(first.store, (c, Dc) => colourOf(c, { store: first.store, counts: createCounts(first.store), D: Dc }));
t1.sync(log1.delta()); counts1.update();
const file = flatten(first.store, log1.root, D, t1.field(colourOf(desc)));

/* ---- the saved world, edited again ------------------------------------------------ */
const store = createStore();
store.importKeys(file.keys);
const colour = { kind: 'baked', skin: file.skin, words: sixBitWords(file.words), bits: 6 }, log = createOneLog(file.root);
const balls = solidBaked(6, 3), sp = createStore();
const kids = {
  sphere: { store: sp, root: sp.fromField(6, fieldOf(SHAPES.find(s => s.name === 'sphere'), 6)).root, D: 6, colour: { kind: 'shape', name: 'sphere', D: 6 } },
  balls: { store: balls.store, root: balls.root, D: 6, skin: balls.skin, colour: { kind: 'baked', skin: balls.skin, words: balls.words } },
};
const ground = cy - r + r / 8;            // the ball stands r/8 into the ground: its top is y = 2^(D−1)
const ops = [
  log.drop(store, D, { world: kids.sphere, at: [cx + 6, cy + r - 34, cz - 40], turn: 0, scale: 0 }),          // half into the ball's top
  log.drop(store, D, { world: kids.balls, at: [cx - r - 44, ground - 30, cz - 70], turn: 0, scale: 0 }),        // half into the ground at its foot
  log.erase(store, D, { level: 4, X: (cx - 24) >> 4, Y: (cy + 8) >> 4, Z: (cz - r) >> 4 }),                    // into the ball's front
];
for (let i = 0; i < 4; i++) ops.push(log.place(store, D, { level: 3, X: (cx + 24 >> 3) + i % 2, Y: (ground >> 3) + (i >> 1), Z: (cz - r - 24) >> 3 }, PALETTE[2 + i]));
for (let i = 0; i < 6; i++) ops.push(log.place(store, D, { level: 2, X: (cx - 40 >> 2) + 3 * i, Y: (cy - 6) >> 2, Z: (cz - r - 2) >> 2 }, PALETTE[(i % 6) + 1]));
for (let i = 0; i < 8; i++) ops.push(log.place(store, D, { level: 1, X: (cx - 60 >> 1) + 3 * i, Y: ground >> 1, Z: (cz - r - 40 >> 1) + (i & 1) }, PALETTE[(i % 5) + 2]));   // on the ground
if (ops.some(o => !o)) throw new Error(`an op changed nothing: ${ops.map(o => !!o)}`);
const counts = createCounts(store), table = createOneTable(store, (c, Dc) => colourOf(c, { store, counts: createCounts(store), D: Dc }));
table.sync(log.delta());
counts.update();
const root = log.root, baseField = colourOf(colour, { store, counts, D }), A2 = table.field(baseField);
// A: the same drops, and the log's places in a table that answers a cell at its centre.
const places = createBlockTable(), delta = log.delta();
for (let s = 0, j = 0; s < delta.count; s++, j += LOG_WORDS)
  if (delta.ops[j] === BLOCK && delta.ops[j + 5] !== BREAK) places.add(delta.ops[j + 1], delta.ops[j + 2], delta.ops[j + 3], delta.ops[j + 4], delta.ops[j + 5], s);
const atCentre = {
  lookup: (x, y, z) => places.lookup(x, y, z),
  latestIn: (l, X, Y, Z) => places.lookup((X + 0.5) * 2 ** l, (Y + 0.5) * 2 ** l, (Z + 0.5) * 2 ** l),
  get seq(){ return places.seq; },
};
const A = sceneField(store, baseField, table.list, atCentre);
// Who owns a cell under A, by the engine's own rule: A's field over a base that answers NaN.
const nan = Object.assign(() => 0, { mean: (l, x, y, z, out = new Float64Array(3)) => out.fill(NaN) });
const owner = sceneField(store, nan, table.list, atCentre), probe = new Float64Array(3);
const owned = (l, x, y, z) => (owner.mean(l, x, y, z, probe), !Number.isNaN(probe[0]));

/* ---- A′: an owned cell blends its sub-cells, each by A ------------------------------ */
const sub = new Float64Array(3);
function nodeAt(l, X, Y, Z){
  let id = root;
  for (let k = D; k > l && id !== EMPTY; k--){ const b = k - 1 - l; id = store.child(id, (X >> b & 1) | (Y >> b & 1) << 1 | (Z >> b & 1) << 2); }
  return id;
}
function wordAprime(l, X, Y, Z, wordA){
  const s = 2 ** l;
  if (l === 0 || !owned(l, X * s, Y * s, Z * s)) return wordA;
  const id = nodeAt(l, X, Y, Z), h = s / 2;
  let R = 0, G = 0, B = 0;
  for (let o = 0; o < 8; o++){
    const c = store.child(id, o);
    if (c === EMPTY) continue;
    const w = counts.of(c);
    A.mean(l - 1, X * s + (o & 1) * h, Y * s + (o >> 1 & 1) * h, Z * s + (o >> 2) * h, sub);
    R += w * sub[0]; G += w * sub[1]; B += w * sub[2];
  }
  const n = counts.of(id);
  return attrOf8(R / n, G / n, B / n);
}

/* ---- the shown cells of the box, as words ------------------------------------------ */
const LO = [cx - 128, ground - 72, cz - 128], SIDE = 256;
function grids(l){
  const s = 2 ** l, n = SIDE >> l, gA = new Uint32Array(n ** 3), gP = new Uint32Array(n ** 3), gQ = new Uint32Array(n ** 3);
  let shown = 0, differ = 0, visible = 0, maxStep = 0, differQ = 0, visibleQ = 0, maxStepQ = 0;
  // A″: the engine's words, the same cells (only the colour differs).
  for (const c of expandWorld(store, root, D, l, { lodRule: 'shadow', counts, seams: true, colour: A2 })){
    const o = c.origin.map(v => v / c.cellSize);
    for (let j = 0; j < c.borderStart; j++){
      const [x, y, z] = mortonXYZ(cellOf(c.records[j])), gx = o[0] + x - LO[0] / s, gy = o[1] + y - LO[1] / s, gz = o[2] + z - LO[2] / s;
      if (gx < 0 || gy < 0 || gz < 0 || gx >= n || gy >= n || gz >= n) continue;
      gQ[gx + n * (gy + n * gz)] = c.attrs[j] + 1;
    }
  }
  for (const c of expandWorld(store, root, D, l, { lodRule: 'shadow', counts, seams: true, colour: A })){
    const o = c.origin.map(v => v / c.cellSize);
    for (let j = 0; j < c.borderStart; j++){
      const [x, y, z] = mortonXYZ(cellOf(c.records[j])), X = o[0] + x, Y = o[1] + y, Z = o[2] + z;
      const gx = X - LO[0] / s, gy = Y - LO[1] / s, gz = Z - LO[2] / s;
      if (gx < 0 || gy < 0 || gz < 0 || gx >= n || gy >= n || gz >= n) continue;
      const a = c.attrs[j], p = wordAprime(l, X, Y, Z, a), i = gx + n * (gy + n * gz);
      gA[i] = a + 1; gP[i] = p + 1; shown++;
      if (a !== p){ const st = steps(a, p); differ++; if (st >= 3) visible++; maxStep = Math.max(maxStep, st); }
      if (!gQ[i]) throw new Error(`lod ${l} cell ${X},${Y},${Z}: shown under A, not under A″`);
      const q = gQ[i] - 1;
      if (a !== q){ const st = steps(a, q); differQ++; if (st >= 3) visibleQ++; maxStepQ = Math.max(maxStepQ, st); }
    }
  }
  if (gQ.some((w, i) => w && !gA[i])) throw new Error(`lod ${l}: a cell shown under A″, not under A`);
  return { n, s, gA, gP, gQ, shown, differ, visible, maxStep, differQ, visibleQ, maxStepQ };
}

/* ---- a small ray caster ----------------------------------------------------------- */
const Wpx = 900, Hpx = 600, HALF = 0.45;
const norm = v => { const l = Math.hypot(...v); return v.map(q => q / l); }, cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const LIGHT = norm([-0.45, 0.85, -0.3]), SKY = [205, 215, 228];
// The whole box; the sphere's seam with the ball's top; the baked balls' seam with the ground.
const sphereAt = [cx + 6 + 32, cy + r - 34 + 32, cz - 40 + 32], ballsAt = [cx - r - 44 + 32, ground - 30 + 32, cz - 70 + 32];
const VIEWS = {
  wide: { eye: [cx + 70, cy + r + 60, cz - r - 150], at: [cx - 6, cy + 4, cz - 10] },
  top: { eye: sphereAt.map((v, i) => v + [-70, 26, -95][i]), at: sphereAt.map((v, i) => v + [-4, -22, 0][i]) },
  foot: { eye: ballsAt.map((v, i) => v + [70, 48, -95][i]), at: ballsAt.map((v, i) => v + [0, -8, 0][i]) },
};
let eye, fwd, right, up;
function look(v){ eye = v.eye; fwd = norm(v.at.map((q, i) => q - eye[i])); right = norm(cross(fwd, [0, 1, 0])); up = cross(right, fwd); }
function render(g, n, s){
  const img = new Uint8Array(Wpx * Hpx * 3), k = Math.tan(HALF);
  for (let py = 0; py < Hpx; py++) for (let px = 0; px < Wpx; px++){
    const sx = (2 * (px + 0.5) / Wpx - 1) * k * Wpx / Hpx, sy = (1 - 2 * (py + 0.5) / Hpx) * k;
    const d = norm(fwd.map((f, i) => f + right[i] * sx + up[i] * sy));
    let out = SKY;
    // The box in cell units.
    const o = eye.map((v, i) => (v - LO[i]) / s);
    let t0 = 0, t1 = Infinity, ent = -1;
    for (let i = 0; i < 3; i++){
      if (d[i] === 0){ if (o[i] < 0 || o[i] > n){ t0 = Infinity; } continue; }
      let a = (0 - o[i]) / d[i], b = (n - o[i]) / d[i];
      if (a > b) [a, b] = [b, a];
      if (a > t0){ t0 = a; ent = i; }
      t1 = Math.min(t1, b);
    }
    if (t0 < t1){
      const p = o.map((v, i) => v + d[i] * (t0 + 1e-7)), c = p.map(v => Math.min(n - 1, Math.max(0, Math.floor(v))));
      const step = d.map(v => v > 0 ? 1 : -1), tMax = c.map((v, i) => d[i] === 0 ? Infinity : ((v + (d[i] > 0 ? 1 : 0)) - o[i]) / d[i]), tD = d.map(v => v === 0 ? Infinity : Math.abs(1 / v));
      let axis = ent;
      for (let guard = 0; guard < 3 * n + 3; guard++){
        const w = g[c[0] + n * (c[1] + n * c[2])];
        if (w){
          const rgb = attrRGB(w - 1).map(q => q * 255 / 63), nrm = [0, 0, 0];
          if (axis >= 0) nrm[axis] = -step[axis];
          const lit = 0.42 + 0.58 * Math.max(0, nrm[0] * LIGHT[0] + nrm[1] * LIGHT[1] + nrm[2] * LIGHT[2]);
          out = rgb.map(q => Math.min(255, Math.round(q * lit)));
          break;
        }
        axis = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
        c[axis] += step[axis];
        if (c[axis] < 0 || c[axis] >= n) break;
        tMax[axis] += tD[axis];
      }
    }
    img.set(out, 3 * (px + Wpx * py));
  }
  return img;
}
// Where A and A′ differ: magenta by three six-bit steps or more (a step you'd see),
// pale pink by one or two, the rest of A greyed, drawn as one grid.
const steps = (a, b) => { const u = attrRGB(a), v = attrRGB(b); return Math.max(...u.map((q, k) => Math.abs(q - v[k]))); };
function diffGrid(gA, gP){
  const MAG = packAttr(57, 10, 50) + 1, PINK = packAttr(60, 44, 56) + 1;
  return gA.map((w, i) => {
    if (!w) return 0;
    if (w !== gP[i]) return steps(w - 1, gP[i] - 1) >= 3 ? MAG : PINK;
    const [R, G, B] = attrRGB(w - 1), q = Math.round((R + G + B) / 3 * 0.45 + 30);
    return packAttr(q, q, q) + 1;
  });
}

/* ---- PNG ------------------------------------------------------------------------------ */
const CRC = Uint32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = b => { let c = 0xffffffff; for (const v of b) c = CRC[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(rgb, w, h){
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((3 * w + 1) * h);
  for (let y = 0; y < h; y++){ raw[y * (3 * w + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + 3 * w * y, 3 * w).copy(raw, y * (3 * w + 1) + 1); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// A | A′ | diff side by side, 8 sky pixels between.
function sheet(panels){
  const G = 8, w = panels.length * Wpx + (panels.length - 1) * G, img = new Uint8Array(w * Hpx * 3);
  for (let i = 0; i < img.length; i += 3) img.set(SKY, i);
  panels.forEach((p, k) => { for (let y = 0; y < Hpx; y++) img.set(p.subarray(3 * Wpx * y, 3 * Wpx * (y + 1)), 3 * (y * w + k * (Wpx + G))); });
  return png(img, w, Hpx);
}
mkdirSync(OUT, { recursive: true });
console.log(`clay D = ${D}, a ${2 * r} ball on its ground, saved (${file.skinVoxels.toLocaleString()} skin words) and edited again: ${log.count} ops.\n`);
const pct = (k, n) => `${k.toLocaleString()} (${(100 * k / n).toFixed(1)}%)`, rows = [];
console.log('| lod | shown cells in the box | A ≠ A′ | of them 3+ six-bit steps apart | most steps apart |\n|---|---|---|---|---|');
for (const l of [1, 2, 3]){
  const g = grids(l), dg = diffGrid(g.gA, g.gP), dq = diffGrid(g.gA, g.gQ);
  for (const [name, v] of Object.entries(VIEWS)){
    look(v);
    const a = render(g.gA, g.n, g.s);
    writeFileSync(join(OUT, `edit-saved-${name}-lod${l}.png`), sheet([a, render(g.gP, g.n, g.s), render(dg, g.n, g.s)]));
    writeFileSync(join(OUT, `edit-saved-a2-${name}-lod${l}.png`), sheet([a, render(g.gQ, g.n, g.s), render(dq, g.n, g.s)]));
  }
  console.log(`| ${l} | ${g.shown.toLocaleString()} | ${pct(g.differ, g.shown)} | ${pct(g.visible, g.shown)} | ${g.maxStep} |`);
  rows.push(`| ${l} | ${g.shown.toLocaleString()} | ${pct(g.differQ, g.shown)} | ${pct(g.visibleQ, g.shown)} | ${g.maxStepQ} |`);
}
console.log('\n| lod | shown cells in the box | A ≠ A″ | of them 3+ six-bit steps apart | most steps apart |\n|---|---|---|---|---|\n' + rows.join('\n'));
console.log(`\nsheets in ${OUT}: edit-saved-{wide,top,foot}-lod{1,2,3}.png (A | A′ | diff), edit-saved-a2-…png (A | A″ | diff)`);
