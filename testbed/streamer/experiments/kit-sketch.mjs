/* A sketch of the kit world (docs/kit-plan.md): nested 4³ assemblies over
   a small library of parts, built straight into one DAG, and a CPU ray
   caster to look at it. Not the world itself: no layout table, no
   colour field, no viewer. It exists to answer "what does it cost, and
   what does it look like?" before the plan is decided.

   The build (buildKit):
   - level 0 is a library of 16³ parts: structural ones (block, slab,
     beam, post, frame, shell, window, step) and a few block-showroom
     specimens as ornaments, or specimens only (`base: 'specimens'`);
   - each level above is a library of assemblies. An assembly is a 4³
     grid of slots, the slots a mask picks (frame, cross, pillars, …)
     filled, each with a part from the library below, turned by one of
     the 24 proper rotations (or not, `turns: false`). A 4³ grid of
     level-k nodes is two binary levels: 8 interns at k + 1 and one at
     k + 2, no graft, no union;
   - the world is the top library's first entry, so D = 4 + 2·levels.
   Every choice is a hash of (seed, level, entry), so a kit is its
   descriptor.

   The renderer (render) walks the DAG front to back: a node's children
   in the order o ^ a, a the ray's sign bits, is an order in which no
   child is behind a later one, so the first FULL leaf the walk reaches
   is the hit. Colour is the gamut (x, y, z → r, g, b) of the hit inside
   a frame of side `part`, the stand-in for "object position as colour".
   2 × 2 samples a pixel. One sample a pixel was noise at a distance:
   the parts' 1-voxel detail aliases, which the viewer's coarse lods
   average away and a single ray doesn't.

   node experiments/kit-sketch.mjs            numbers and docs/images/kit-sketch-*.png
   node experiments/kit-sketch.mjs --print    numbers only
   node experiments/kit-sketch.mjs <names>    only those variants (comma-separated) */
import { writeFileSync } from 'node:fs';
import { createStore, pruneWorld, createCounts, EMPTY, FULL } from '../dag-core.js';
import { buildRecipe } from '../lattice-core.js';
import { PROPER } from '../scatter-core.js';
import { hash32 } from '../specimen-core.js';
import { png } from './dataprism.mjs';

const rng = (...k) => {
  let s = 0x9e3779b9;
  for (const v of k) s = hash32(s, v >>> 0) >>> 0;
  return () => (s = hash32(s, 0x85ebca6b) >>> 0) / 4294967296;
};

/* ---- the masks: which of an assembly's 4³ slots are filled -------------- */
const ext = v => v === 0 || v === 3, mid = v => v === 1 || v === 2;
const cnt = (...b) => b.filter(Boolean).length;
const maskOf = f => {
  const m = [];
  for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (f(x, y, z)) m.push(x + 4 * y + 16 * z);
  return m;
};
export const MASKS = {
  frame:   maskOf((x, y, z) => cnt(ext(x), ext(y), ext(z)) >= 2),          // the 12 edges, 32 slots
  cross:   maskOf((x, y, z) => cnt(mid(x), mid(y), mid(z)) >= 2),          // three bars through the middle
  pillars: maskOf((x, y, z) => (ext(x) && ext(z)) || y === 0),             // four columns on a floor
  tower:   maskOf((x, y, z) => (mid(x) && mid(z)) || (y === 3 && cnt(mid(x), mid(z)) >= 1)),
  slabs:   maskOf((x, y, z) => y === 0 || (y === 3 && (ext(x) || ext(z)))),
  arches:  maskOf((x, y, z) => y === 3 || (ext(x) && ext(z))),
  stair:   maskOf((x, y, z) => y <= x && (!mid(z) || y === x)),
  corners: maskOf((x, y, z) => cnt(ext(x), ext(y), ext(z)) === 3 || cnt(mid(x), mid(y), mid(z)) === 3),
};

/* ---- level 0: structural parts, 16³ ------------------------------------- */
const occOf = (R, f) => {
  const o = new Uint8Array(R ** 3);
  let i = 0;
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) o[i++] = f(x, y, z) ? 1 : 0;
  return o;
};
const rim = v => v < 2 || v >= 14;
export const PARTS = {
  block:  () => true,
  slab:   (x, y) => y < 4,
  beam:   (x, y, z) => y < 4 && z >= 6 && z < 10,
  post:   (x, y, z) => x >= 5 && x < 11 && z >= 5 && z < 11,
  frame:  (x, y, z) => cnt(rim(x), rim(y), rim(z)) >= 2,
  shell:  (x, y, z) => cnt(rim(x), rim(y), rim(z)) >= 1,
  window: (x, y, z) => z < 3 && !(x % 8 >= 2 && x % 8 < 6 && y % 8 >= 2 && y % 8 < 6),
  step:   (x, y) => y < 4 * (1 + Math.floor(x / 4)),
};

export function buildKit({ seed = 1, libs = [8, 6, 4, 1], families = null, turns = true, base = 'struct', ornaments = 4 } = {}){
  const R = 16, k0 = 4, t0 = performance.now(), store = createStore(), m = libs.length;
  const specimen = n => store.fromDense(buildRecipe({ R, seed, axes: 'random', n: [1, 1, 1] }, n), R).root;
  const lib = [base === 'specimens' ? Array.from({ length: 16 }, (_, n) => specimen(n))
             : [...Object.values(PARTS).map(f => store.fromDense(occOf(R, f), R).root), ...Array.from({ length: ornaments }, (_, n) => specimen(n))]];
  const tParts = performance.now();
  const g = new Uint32Array(64), ch = new Uint32Array(8), top = new Uint32Array(8);
  // A 4³ grid of level-k ids (g, slot x + 4y + 16z) as one level-(k + 2) node.
  const compose = k => {
    for (let O = 0; O < 8; O++){
      for (let o = 0; o < 8; o++) ch[o] = g[(2 * (O & 1) + (o & 1)) + 4 * (2 * (O >> 1 & 1) + (o >> 1 & 1)) + 16 * (2 * (O >> 2) + (o >> 2))];
      top[O] = store.intern(k + 1, ch);
    }
    return store.intern(k + 2, top);
  };
  const names = Object.keys(MASKS);
  for (let l = 1; l <= m; l++){
    const fam = families?.[l - 1] || names, out = [];
    for (let j = 0; j < libs[l - 1]; j++){
      const r = rng(seed, l, j), f = fam[Math.floor(r() * fam.length)];
      g.fill(EMPTY);
      for (const s of MASKS[f]){
        const c = lib[l - 1][Math.floor(r() * lib[l - 1].length)], e = turns ? PROPER[Math.floor(r() * 24)] : 0;
        g[s] = store.transform(c, e);
      }
      out.push(compose(k0 + 2 * (l - 1)));
    }
    lib.push(out);
  }
  const D = k0 + 2 * m, raw = store.size, { store: pruned, root } = pruneWorld(store, lib[m][0]);
  return { store: pruned, root, D, nodes: pruned.size, raw, ms: performance.now() - t0, partsMs: tParts - t0 };
}

/* ---- the preview -------------------------------------------------------- */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const SKY = [18, 18, 26];

function trace(store, root, D, o, d){
  const inv = d.map(x => 1 / (Math.abs(x) < 1e-12 ? 1e-12 : x)), a = (d[0] < 0 ? 1 : 0) | (d[1] < 0 ? 2 : 0) | (d[2] < 0 ? 4 : 0);
  let hit = null;
  const box = (x0, y0, z0, s) => {
    let tn = -Infinity, tf = Infinity, ax = 0;
    const b = [x0, y0, z0];
    for (let i = 0; i < 3; i++){
      let t1 = (b[i] - o[i]) * inv[i], t2 = (b[i] + s - o[i]) * inv[i];
      if (t1 > t2){ const q = t1; t1 = t2; t2 = q; }
      if (t1 > tn){ tn = t1; ax = i; }
      if (t2 < tf) tf = t2;
    }
    return tf >= Math.max(tn, 0) ? [Math.max(tn, 0), ax] : null;
  };
  const walk = (id, lev, x0, y0, z0, at) => {
    if (id === FULL){ hit = { t: at[0], ax: at[1] }; return true; }
    const hs = 2 ** (lev - 1);
    for (let k = 0; k < 8; k++){
      const oc = k ^ a, c = store.child(id, oc);
      if (c === EMPTY) continue;
      const cx = x0 + (oc & 1) * hs, cy = y0 + (oc >> 1 & 1) * hs, cz = z0 + (oc >> 2) * hs, b = box(cx, cy, cz, hs);
      if (b && walk(c, lev - 1, cx, cy, cz, b)) return true;
    }
    return false;
  };
  const b = box(0, 0, 0, 2 ** D);
  if (b && root !== EMPTY) walk(root, D, 0, 0, 0, b);
  return hit;
}

/* `colour`, a colour field (colours.js: a point in voxel units to rgb8's
   packed RGB), replaces the stand-in gamut: experiments/kit.mjs passes
   the kit's own (kit-core's kitColour), read just inside the hit face. */
export function render(store, root, D, { eye, yaw, pitch, w = 640, h = 400, part = 1024, fog = null, ss = 2, colour = null }){
  const f = 1 / Math.tan(0.45), img = new Uint8Array(w * h * 3), side = 2 ** D, fz = fog || 3 * side;
  const fw = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
  // The viewer's basis (viewProj): x = norm(up × z), y = z × x, z = −forward.
  const zb = fw.map(v => -v), rt = norm(cross([0, 1, 0], zb)), up = cross(zb, rt), L = norm([0.45, 0.8, 0.3]);
  for (let py = 0; py < h; py++) for (let px = 0; px < w; px++){
    const sum = [0, 0, 0];
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++){
      const u = (2 * (px + (sx + 0.5) / ss) / w - 1) * (w / h) / f, v = (1 - 2 * (py + (sy + 0.5) / ss) / h) / f;
      const d = norm([0, 1, 2].map(a => fw[a] + u * rt[a] + v * up[a])), hit = trace(store, root, D, eye, d);
      let c = SKY;
      if (hit){
        const p = eye.map((e, a) => e + d[a] * (hit.t + 1e-4)), n = [0, 0, 0];
        n[hit.ax] = d[hit.ax] > 0 ? -1 : 1;
        const shade = 0.35 + 0.65 * Math.max(0, dot(n, L)), k = 0.85 * Math.min(1, hit.t / fz) ** 2;
        if (colour){
          const v = colour(...p.map(Math.floor).map(x => x + 0.5)), rgb = [v & 255, v >> 8 & 255, v >> 16 & 255];
          c = rgb.map((g, i) => g * shade * (1 - k) + SKY[i] * k);
        } else {
          const q = p.map(x => ((Math.floor(x) % part) + part) % part / part);
          c = q.map((g, i) => (50 + 205 * g) * shade * (1 - k) + SKY[i] * k);
        }
      }
      for (let i = 0; i < 3; i++) sum[i] += c[i];
    }
    img.set(sum.map(x => Math.max(0, Math.min(255, Math.round(x / (ss * ss))))), 3 * (py * w + px));
  }
  return png(w, h, img);
}

/* ---- the variants ------------------------------------------------------- */
const ARCH = [['frame', 'cross', 'arches', 'pillars', 'slabs'], ['tower', 'pillars', 'frame', 'arches'], ['frame', 'pillars', 'cross']];
export const VARIANTS = {
  specimens: { base: 'specimens', libs: [6, 4, 3, 1] },
  struct:    { libs: [8, 6, 4, 1], families: [...ARCH, ['frame']] },
  'struct-flat': { libs: [8, 6, 4, 1], families: [...ARCH, ['frame']], turns: false },
  struct14:  { libs: [8, 6, 4, 3, 1], families: [...ARCH, ['frame', 'pillars'], ['frame']] },
  struct16:  { libs: [8, 6, 4, 3, 2, 1], families: [...ARCH, ['frame', 'pillars'], ['frame', 'cross'], ['frame']] },
  'struct-wide': { libs: [24, 16, 12, 1], families: [...ARCH, ['frame']] },
};
// Views as fractions of the world's side, so one view fits every D.
const VIEWS = {
  far:  { eye: [-0.35, 0.9, -0.45], yaw: 0.68, pitch: -0.5, part: 1 / 4 },
  near: { eye: [0.3, 0.32, 0.05], yaw: 0.5, pitch: -0.15, part: 1 / 16, fog: 1 },
};
const PICTURES = { specimens: ['far'], struct: ['far', 'near'], struct14: ['far', 'near'] };

if (process.argv[1].endsWith('kit-sketch.mjs')){
  const args = process.argv.slice(2), print = args.includes('--print'), only = args.find(a => !a.startsWith('--'))?.split(',');
  console.log('| variant | D | side | nodes | voxels | build |\n|---|---|---|---|---|---|');
  for (const [name, v] of Object.entries(VARIANTS)){
    if (only && !only.includes(name)) continue;
    const k = buildKit(v), s = 2 ** k.D, voxels = createCounts(k.store).of(k.root);
    console.log(`| ${name} | ${k.D} | ${s.toLocaleString()}³ | ${k.nodes.toLocaleString()} | ${voxels.toLocaleString()} | ${k.ms.toFixed(0)} ms (parts ${k.partsMs.toFixed(0)}) |`);
    if (print) continue;
    for (const view of PICTURES[name] || []){
      const V = VIEWS[view], t = performance.now();
      writeFileSync(`docs/images/kit-sketch-${name}-${view}.png`, render(k.store, k.root, k.D, {
        eye: V.eye.map(x => x * s), yaw: V.yaw, pitch: V.pitch, part: V.part * s, fog: V.fog && V.fog * s }));
      console.error(`  ${name} ${view}: ${((performance.now() - t) / 1000).toFixed(1)} s`);
    }
  }
}
