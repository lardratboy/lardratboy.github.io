/* An OpenVDB grid to world files: vdb/index.html's conversion (and
   vdb/vdb-vdag.mjs's), pure. vdb-core.js reads the file; this decides which
   voxels of the world are solid and what colour the visible ones are, and
   hands the store to convert-core's finishDepth, so a world is written,
   read back and pictured exactly as a .glb's or a .ply's.

   What's solid. A grid is a value at every integer point of its index space
   (a voxel's value sits at its centre), active or not. The world's voxel v
   asks the grid at its centre's place p in index space (`frameOf`), by one
   rule, `g(p) > 0` (`fieldOf`), where g is
     inside   threshold − value       a level set: the inside (value < 0)
     above    value − threshold       a fog volume: density over a threshold
     active   ±1 by the active bit     the grid's topology, whatever its values
   (a vec3 grid's value is its length). A level set says so in its class and
   gets `inside`, a fog volume `above` (0.05, so faint wisps don't swell it),
   anything else `active`.

   Sampling: `trilinear` interpolates g between the eight voxels round p
   (OpenVDB's BoxSampler), so a world finer than the grid gets smooth
   surfaces, not stairs of grid voxels; `nearest` takes the voxel p falls in.
   `active` is always nearest. Where p lands on a voxel's centre exactly,
   both are that voxel (an axis with no fraction reads one voxel, not two),
   which is what makes `native` exact.

   The fit. `native` is one world voxel a grid voxel, the grid's own; any
   other depth D scales the solid box to 92% of the world's side, centred
   in x and z and 4% off the floor, as convert/'s point clouds are. A
   Blender fluid cache is z-up (the viewer is y-up): `up` turns it, found
   by the cache's `file_base_resolution` entry when 'auto'.

   Building. store.fromField asks a cell at a time: a cell's voxels sample p
   over a box of grid voxels (its corners' p, rounded out by the stencil),
   and `range` says from per-node minima and maxima of g whether every
   voxel there has g > 0 (full), none (empty) or some (split it). Since
   p(v) is one monotone expression, the box of a cell holds every voxel any
   of its samples reads, exactly, so a cell said full or empty is. A smooth
   grid costs its surface, not its volume.

   The skin is the solid voxels with a face to air or the world's edge (the
   faces a chunk can show), read off the shape's DAG (`skinOf`): resampling
   the grid seven times a voxel was most of the time. Its words, one per skin voxel
   in rank (Morton) order, are the colour source asked at the voxel's p:
     grid:<vec3 grid>        Houdini's Cd: linear RGB, to sRGB by 1/2.2
     rgb:<r>,<g>,<b>[/<d>]   three scalar grids (Blender's color_r, _g, _b),
                             divided by a fourth where Blender keeps colour
                             premultiplied by density
     heat:<grid>, grey:<grid> a scalar through a ramp over its active range
   each in its own grid's index space (through world space when the
   transforms differ), interpolated over the active voxels only, so colour
   doesn't fade to the background's black at the edge of the smoke.
   `gamma` (on by default; README question 5, 2026-11-24) is that 1/2.2:
   off, a linear value v is the word's 255·v as it stands.

   Point data grids (OpenVDB points, Houdini's VDB points; README question
   1, 2026-11-24: "we should handle point .vdb"): the solid is the points,
   `points` its rule, made the way convert/ makes a PLY cloud (ply-core's
   pointsDepth): each point fills its voxel, or a cube or a ball round it
   (`point`), points under `opacity` (by an Alpha, alpha or opacity
   attribute) are dropped first, and a voxel's word is the mean colour of
   its points (`attr:<a vec3 attribute>`, Cd by default, through `gamma`).
   A depth fits the points' world positions, so a turned or stretched grid
   comes out as it is in the world; `native` is one world voxel a grid
   voxel, in its index space. */
import { createStore, createCounts, EMPTY } from '../dag-core.js';
import { rgb8 } from '../attr-core.js';
import { inspectVdb, readGrid, readPoints, worldOf } from './vdb-core.js';
import { finishDepth, stager } from '../convert/convert-core.js';
import { pointBox, pointsDepth, kernelOf } from '../convert/ply-core.js';

export const DEPTHS = [6, 7, 8, 9, 10], MAX_NATIVE_D = 12, MAX_POINTS_D = 10;
export const MODES = ['inside', 'above', 'active', 'points'], SAMPLINGS = ['trilinear', 'nearest'];
// A point attribute that's a colour, or an opacity, by its name (Houdini's Cd and Alpha first).
export const COLOUR_NAME = /^(cd|col|color|colour|albedo|rgb|diffuse)$/i, ALPHA_NAME = /^(alpha|opacity)$/i;
export const FOG_THRESHOLD = 0.05;
export const nameOf = fileName => fileName.replace(/^.*[\\/]/, '').replace(/\.vdb$/i, '');
export const slugOf = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'volume';

/* ---- what a file offers, and what to make of it by default ---------------------- */
const isScalar = g => !g.why && ['float', 'double', 'int32', 'int64', 'uint32', 'bool', 'mask'].includes(g.value);
const isVec3 = g => !g.why && ['vec3s', 'vec3d', 'vec3i'].includes(g.value);
const isPoints = g => !g.why && !!g.points;
export function summaryOf(file){
  return file.grids.map(g => ({
    name: g.uniqueName, type: g.value ?? g.typeName, half: g.half, class: g.class, why: g.why,
    voxels: typeof g.meta.file_voxel_count === 'number' ? g.meta.file_voxel_count : null,
    bbox: Array.isArray(g.meta.file_bbox_min) && Array.isArray(g.meta.file_bbox_max) ? [g.meta.file_bbox_min, g.meta.file_bbox_max] : null,
    map: g.transform.name, compression: g.compression,
  }));
}
// The grid to take the shape from: a level set, else density, else the first volume, else the first point grid.
export function defaultShape(file){
  const ok = file.grids.filter(g => !g.why && (isScalar(g) || isVec3(g)));
  return (ok.find(g => g.class === 'level set') ?? ok.find(g => /^density$/i.test(g.name)) ?? ok.find(g => g.class === 'fog volume' && isScalar(g)) ?? ok[0]
          ?? file.grids.find(isPoints))?.uniqueName ?? null;
}
export const modeOf = g => g.points ? 'points' : g.class === 'level set' ? 'inside' : g.class === 'fog volume' && !['bool', 'mask'].includes(g.value) ? 'above' : 'active';
export const thresholdOf = mode => mode === 'above' ? FOG_THRESHOLD : 0;
/* A grid's box in the world, from the bounding box its metadata gives (null
   if it gives none, or the transform isn't affine). */
export function worldBox(g){
  const lo = g.meta.file_bbox_min, hi = g.meta.file_bbox_max, m = g.transform.matrix;
  if (!Array.isArray(lo) || !Array.isArray(hi) || !m) return null;
  const a = [Infinity, Infinity, Infinity], b = [-Infinity, -Infinity, -Infinity], out = [0, 0, 0];
  for (let c = 0; c < 8; c++){
    apply4(m, [c & 1 ? hi[0] + 0.5 : lo[0] - 0.5, c & 2 ? hi[1] + 0.5 : lo[1] - 0.5, c & 4 ? hi[2] + 0.5 : lo[2] - 0.5], out);
    for (let k = 0; k < 3; k++){ a[k] = Math.min(a[k], out[k]); b[k] = Math.max(b[k], out[k]); }
  }
  return { lo: a, hi: b };
}
const overlaps = (g, h) => {
  const A = worldBox(g), B = worldBox(h);
  return !A || !B || [0, 1, 2].every(k => A.lo[k] < B.hi[k] && B.lo[k] < A.hi[k]);
};
/* The colour to bake by default: a Cd-like vec3 grid, else Blender's three
   channels, but only where they are: a grid whose box misses the shape's
   would colour it with the background. */
export function defaultColour(file, shape){
  const S = file.grids.find(g => g.uniqueName === shape);
  const near = g => !S || overlaps(g, S);
  const by = n => file.grids.find(g => !g.why && g.name === n && near(g));
  const vec = file.grids.find(g => isVec3(g) && near(g) && /^(cd|col|color|colour|albedo|rgb|diffuse)$/i.test(g.name));
  if (vec) return `grid:${vec.uniqueName}`;
  const [r, gg, b] = ['color_r', 'color_g', 'color_b'].map(by);
  if (r && gg && b && isScalar(r) && isScalar(gg) && isScalar(b)){
    const d = by('density');
    return `rgb:${r.uniqueName},${gg.uniqueName},${b.uniqueName}${d && isBlender(file) ? `/${d.uniqueName}` : ''}`;
  }
  return 'none';
}
export const isBlender = file => file.grids.some(g => Array.isArray(g.meta.file_base_resolution));
// Every colour a file can be baked with, for a page's menu.
export function colourChoices(file){
  const out = [{ value: 'none', label: 'none (the shape alone)' }];
  for (const g of file.grids) if (isVec3(g)) out.push({ value: `grid:${g.uniqueName}`, label: `${g.uniqueName} (RGB)` });
  const d = defaultColour(file, null);
  if (d.startsWith('rgb:')) out.push({ value: d, label: `${d.slice(4).replace(/\//, ' ÷ ')}` });
  for (const g of file.grids) if (isScalar(g) && !['bool', 'mask'].includes(g.value)){
    out.push({ value: `heat:${g.uniqueName}`, label: `${g.uniqueName} as heat` }, { value: `grey:${g.uniqueName}`, label: `${g.uniqueName} as grey` });
  }
  return out;
}
export function parseColour(spec, file){
  const grid = n => {
    const g = file.grids.find(x => x.uniqueName === n);
    if (!g) throw new Error(`colour: no grid ${n}`);
    if (g.why) throw new Error(`colour: ${n}: ${g.why}`);
    return g;
  };
  if (spec === 'none') return null;
  let m;
  if ((m = /^attr:(.+)$/.exec(spec))) return { kind: 'attr', name: m[1] };
  if ((m = /^grid:(.+)$/.exec(spec))){ const g = grid(m[1]); if (!isVec3(g)) throw new Error(`colour: ${m[1]} isn't a vec3 grid`); return { kind: 'vec3', grids: [g] }; }
  if ((m = /^rgb:([^,]+),([^,]+),([^/]+)(?:\/(.+))?$/.exec(spec))){
    const gs = [m[1], m[2], m[3]].map(grid), d = m[4] ? grid(m[4]) : null;
    for (const g of [...gs, ...(d ? [d] : [])]) if (!isScalar(g)) throw new Error(`colour: ${g.uniqueName} isn't a scalar grid`);
    return { kind: 'rgb', grids: gs, divide: d };
  }
  if ((m = /^(heat|grey):(.+)$/.exec(spec))){ const g = grid(m[2]); if (!isScalar(g)) throw new Error(`colour: ${m[2]} isn't a scalar grid`); return { kind: m[1], grids: [g] }; }
  throw new Error(`colour: ${spec}? (none, grid:<vec3>, rgb:<r>,<g>,<b>[/<divisor>], heat:<scalar>, grey:<scalar>, or a point grid's attr:<vec3 attribute>)`);
}

/* ---- the field g over one tree ---------------------------------------------------------
   `g(x, y, z)` at a grid voxel, and `range(x0, y0, z0, x1, y1, z1)` over an
   inclusive box: 1 if g > 0 everywhere in it, 0 if nowhere, −1 if both,
   from minima and maxima kept per leaf and per internal node and stopping
   as soon as it's seen both. */
export function fieldOf(tree, mode, threshold){
  if (!MODES.includes(mode)) throw new Error(`what's solid: ${mode}? (${MODES.join(', ')})`);
  const { comps, dims, total, nodes, leafValues, leafMask, leafOrigin, leafCount, leafLog2: L, probe } = tree;
  const depth = dims.length, top = total[0];
  const gv = mode === 'active' ? null
    : comps === 1 ? (mode === 'inside' ? v => threshold - v : v => v - threshold)
    : (mode === 'inside' ? (a, b, c) => threshold - Math.hypot(a, b, c) : (a, b, c) => Math.hypot(a, b, c) - threshold);
  const gOf = (vals, o, act) => gv ? (comps === 1 ? gv(vals[o]) : gv(vals[o], vals[o + 1], vals[o + 2])) : (act ? 1 : -1);
  const bgG = gOf(tree.background, 0, 0);
  // Per leaf and per internal node: min and max of g over every voxel it holds.
  const LS = 1 << 3 * L, LM = (1 << L) - 1, words = LS / 32;
  const leafMin = new Float64Array(leafCount), leafMax = new Float64Array(leafCount);
  for (let j = 0; j < leafCount; j++){
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < LS; i++){
      const g = gOf(leafValues, (j * LS + i) * comps, (leafMask[j * words + (i >>> 5)] >>> (i & 31)) & 1);
      if (g < lo) lo = g; if (g > hi) hi = g;
    }
    leafMin[j] = lo; leafMax[j] = hi;
  }
  const nodeMin = new Float64Array(nodes.length), nodeMax = new Float64Array(nodes.length);
  const tileG = (node, i) => gOf(node.values, i * comps, (node.valueMask[i >>> 5] >>> (i & 31)) & 1);
  for (let id = nodes.length - 1; id >= 0; id--){          // children have higher ids than their parents
    const node = nodes[id], leafKids = node.level + 2 >= depth;
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < node.child.length; i++){
      const ch = node.child[i];
      let a, b;
      if (ch < 0) a = b = tileG(node, i);
      else if (leafKids){ a = leafMin[ch]; b = leafMax[ch]; }
      else { a = nodeMin[ch]; b = nodeMax[ch]; }
      if (a < lo) lo = a; if (b > hi) hi = b;
    }
    nodeMin[id] = lo; nodeMax[id] = hi;
  }
  const roots = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (const t of tree.rootTiles) roots.set(key(...t.origin), { g: gOf(t.value, 0, t.active ? 1 : 0) });
  for (const ch of tree.rootChildren) roots.set(key(...ch.origin), { node: ch.node });

  const out = new Float64Array(comps);
  const g = (x, y, z) => { const act = probe(x, y, z, out); return gOf(out, 0, act); };

  let pos = false, neg = false;
  const see = (lo, hi) => { if (hi > 0) pos = true; if (lo <= 0) neg = true; return pos && neg; };
  let X0, Y0, Z0, X1, Y1, Z1;
  const leafRange = j => {
    const ox = leafOrigin[3 * j], oy = leafOrigin[3 * j + 1], oz = leafOrigin[3 * j + 2];
    if (X0 <= ox && Y0 <= oy && Z0 <= oz && X1 >= ox + LM && Y1 >= oy + LM && Z1 >= oz + LM) return see(leafMin[j], leafMax[j]);
    const a0 = Math.max(X0, ox) - ox, a1 = Math.min(X1, ox + LM) - ox, b0 = Math.max(Y0, oy) - oy, b1 = Math.min(Y1, oy + LM) - oy;
    const c0 = Math.max(Z0, oz) - oz, c1 = Math.min(Z1, oz + LM) - oz;
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) for (let c = c0; c <= c1; c++){
      const i = a << 2 * L | b << L | c, v = gOf(leafValues, (j * LS + i) * comps, (leafMask[j * words + (i >>> 5)] >>> (i & 31)) & 1);
      if (see(v, v)) return true;
    }
    return false;
  };
  const nodeRange = id => {
    const node = nodes[id], [ox, oy, oz] = node.origin, span = 2 ** total[node.level] - 1;
    if (X0 <= ox && Y0 <= oy && Z0 <= oz && X1 >= ox + span && Y1 >= oy + span && Z1 >= oz + span) return see(nodeMin[id], nodeMax[id]);
    const n = node.log2, below = total[node.level + 1], leafKids = node.level + 2 >= depth;
    const a0 = (Math.max(X0, ox) - ox) >> below, a1 = (Math.min(X1, ox + span) - ox) >> below;
    const b0 = (Math.max(Y0, oy) - oy) >> below, b1 = (Math.min(Y1, oy + span) - oy) >> below;
    const c0 = (Math.max(Z0, oz) - oz) >> below, c1 = (Math.min(Z1, oz + span) - oz) >> below;
    for (let a = a0; a <= a1; a++) for (let b = b0; b <= b1; b++) for (let c = c0; c <= c1; c++){
      const i = a << 2 * n | b << n | c, ch = node.child[i];
      if (ch < 0){ const v = tileG(node, i); if (see(v, v)) return true; }
      else if (leafKids ? leafRange(ch) : nodeRange(ch)) return true;
    }
    return false;
  };
  function range(x0, y0, z0, x1, y1, z1){
    pos = neg = false; X0 = x0; Y0 = y0; Z0 = z0; X1 = x1; Y1 = y1; Z1 = z1;
    const s = 2 ** top;
    for (let bx = Math.floor(x0 / s); bx <= Math.floor(x1 / s); bx++) for (let by = Math.floor(y0 / s); by <= Math.floor(y1 / s); by++)
      for (let bz = Math.floor(z0 / s); bz <= Math.floor(z1 / s); bz++){
        const e = roots.get(key(bx * s, by * s, bz * s));
        if (!e ? see(bgG, bgG) : e.node == null ? see(e.g, e.g) : nodeRange(e.node)) return -1;
      }
    return pos ? 1 : 0;
  }
  /* The solid voxels' bounding box, in index space: leaves voxel by voxel,
     tiles whole. Null if nothing's solid; it throws if the background is
     (the solid would have no end). */
  function solidBox(){
    if (bgG > 0) throw new Error('the background itself is solid by this rule: the volume would have no end (try another rule or threshold)');
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    const add = (x, y, z, w) => { if (x < lo[0]) lo[0] = x; if (y < lo[1]) lo[1] = y; if (z < lo[2]) lo[2] = z; if (x + w > hi[0]) hi[0] = x + w; if (y + w > hi[1]) hi[1] = y + w; if (z + w > hi[2]) hi[2] = z + w; };
    for (const t of tree.rootTiles) if (gOf(t.value, 0, t.active ? 1 : 0) > 0) add(...t.origin, 2 ** top - 1);
    const visit = id => {
      const node = nodes[id];
      if (nodeMax[id] <= 0) return;
      const n = node.log2, below = total[node.level + 1], leafKids = node.level + 2 >= depth, M = (1 << n) - 1;
      for (let i = 0; i < node.child.length; i++){
        const ch = node.child[i];
        if (ch >= 0){ if (leafKids) visitLeaf(ch); else visit(ch); continue; }
        if (tileG(node, i) > 0) add(node.origin[0] + ((i >> 2 * n) << below), node.origin[1] + (((i >> n) & M) << below), node.origin[2] + ((i & M) << below), 2 ** below - 1);
      }
    };
    const visitLeaf = j => {
      if (leafMax[j] <= 0) return;
      for (let i = 0; i < LS; i++) if (gOf(leafValues, (j * LS + i) * comps, (leafMask[j * words + (i >>> 5)] >>> (i & 31)) & 1) > 0)
        add(leafOrigin[3 * j] + (i >> 2 * L), leafOrigin[3 * j + 1] + ((i >> L) & LM), leafOrigin[3 * j + 2] + (i & LM), 0);
    };
    for (const ch of tree.rootChildren) visit(ch.node);
    return lo[0] === Infinity ? null : { lo, hi };
  }
  return { g, range, solidBox, mode, threshold, bgG };
}

/* ---- the frame: world voxel v ↔ index-space point p ---------------------------------
   Per world axis a: the grid axis it reads (`src`), which way (`sign`), and
   q(v) = (v + ½ − off) · inv grid voxels from the box's edge, so
   p = lo − ½ + q along a grid axis that runs with it, hi + ½ − q against.
   One expression, monotone in v, used for every sample and every cell's
   box alike. */
export function frameOf(box, D, { native = false, up = 'y' } = {}){
  const n = [0, 1, 2].map(a => box.hi[a] - box.lo[a] + 1);
  // World axis → grid axis: y-up as is; z-up turns (x, y, z) to (x, z, −y), a rotation, no mirror.
  const axes = up === 'z' ? [{ src: 0, sign: 1 }, { src: 2, sign: 1 }, { src: 1, sign: -1 }] : [{ src: 0, sign: 1 }, { src: 1, sign: 1 }, { src: 2, sign: 1 }];
  const m = axes.map(x => n[x.src]), side = 2 ** D;
  let s, off;
  if (native){
    off = [Math.floor((side - m[0]) / 2), Math.max(1, Math.round(0.04 * side)), Math.floor((side - m[2]) / 2)];
    if (m[0] + 2 > side || m[2] + 2 > side || off[1] + m[1] + 1 > side) throw new Error(`the grid (${m.join(' × ')}) doesn't fit 2^${D}`);
    s = 1;
  } else {
    const E = Math.max(...m);
    s = 0.92 * side / E;
    off = [(side - m[0] * s) / 2, 0.04 * side, (side - m[2] * s) / 2];
  }
  const inv = 1 / s;
  const F = axes.map((x, a) => ({ ...x, off: off[a], base: x.sign > 0 ? box.lo[x.src] - 0.5 : box.hi[x.src] + 0.5 }));
  const p = (a, v) => { const f = F[a], q = (v + 0.5 - f.off) * inv; return f.sign > 0 ? f.base + q : f.base - q; };
  return { D, side, s, inv, F, p, native, up, M: { side, lo: off.slice(), hi: off.map((o, a) => o + m[a] * s) }, n: m };
}
// The smallest D that holds the grid one voxel a voxel.
export function nativeDepth(box, up = 'y'){
  for (let D = 1; D <= 30; D++){ try { frameOf(box, D, { native: true, up }); return D; } catch {} }
  throw new Error('no depth holds it');
}

/* ---- the world, the skin and the words ------------------------------------------------- */
export function buildDepth(field, frame, { sampling = 'trilinear', store = createStore(), stage = () => {}, skin: wantSkin = true } = {}){
  const { D, side, F, p } = frame, near = sampling === 'nearest' || field.mode === 'active';
  /* Whether a box of world voxels [v0, v1] is all solid (1), all air (0) or
     can't say (−1). The grid voxels its samples read are the box of their
     p, rounded out by the stencil, and range() answers from those. But a
     trilinear g is multilinear between grid points, so over a box spanning
     at most two grid cells an axis its extremes are at the corners of the
     pieces the grid cuts it into: those (at most 27) decide it exactly. That
     matters where the world is finer than the grid: a cell within a grid
     voxel of the surface sees both signs in its stencil, and would be split
     to its voxels, a shell as thick as a grid voxel is wide. The tolerance
     sends a cell whose extreme is within rounding of 0 down to its voxels,
     where the sample itself decides. (No fixture sits a hair from 0, so the
     tests hold what it keeps, g = 0 as air, not the rounding it's for.) */
  const lo = new Int32Array(3), hi = new Int32Array(3), U = new Float64Array(3), Wd = new Float64Array(3);
  const B27 = new Float64Array(27), cs = [new Float64Array(3), new Float64Array(3), new Float64Array(3)], nc = new Int32Array(3);
  const hull = () => {
    for (let a = 0; a < 3; a++){
      const f = Math.floor(U[a]);
      lo[a] = f; nc[a] = 0;
      cs[a][nc[a]++] = U[a] - f;
      if (Math.floor(Wd[a]) > f) cs[a][nc[a]++] = 1;
      cs[a][nc[a]++] = Wd[a] - f;
    }
    const ex = nc.map(n => n === 3 ? 3 : 2);
    let big = 0;
    for (let k = 0; k < ex[2]; k++) for (let j = 0; j < ex[1]; j++) for (let i = 0; i < ex[0]; i++){
      const v = field.g(lo[0] + i, lo[1] + j, lo[2] + k); B27[i + 3 * j + 9 * k] = v;
      if (Math.abs(v) > big) big = Math.abs(v);
    }
    let mn = Infinity, mx = -Infinity;
    for (let c = 0; c < nc[2]; c++) for (let b = 0; b < nc[1]; b++) for (let a = 0; a < nc[0]; a++){
      let x = cs[0][a], y = cs[1][b], z = cs[2][c];
      const i = Math.min(1, Math.floor(x)), j = Math.min(1, Math.floor(y)), k = Math.min(1, Math.floor(z));
      x -= i; y -= j; z -= k;
      const o = i + 3 * j + 9 * k;
      const v = (1 - z) * ((1 - y) * ((1 - x) * B27[o] + x * B27[o + 1]) + y * ((1 - x) * B27[o + 3] + x * B27[o + 4]))
              + z * ((1 - y) * ((1 - x) * B27[o + 9] + x * B27[o + 10]) + y * ((1 - x) * B27[o + 12] + x * B27[o + 13]));
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
    const tol = 1e-9 * big;
    return mn > tol ? 1 : mx < -tol ? 0 : -1;
  };
  const boxOf = (v0, v1) => {
    let small = !near;
    for (let a = 0; a < 3; a++){
      const s = F[a].src, p0 = p(a, v0[a]), p1 = p(a, v1[a]), u = Math.min(p0, p1), w = Math.max(p0, p1);
      U[s] = u; Wd[s] = w;
      if (near){ lo[s] = Math.floor(u + 0.5); hi[s] = Math.floor(w + 0.5); }
      else { lo[s] = Math.floor(u); hi[s] = Math.floor(w) + 1; if (hi[s] - lo[s] > 2) small = false; }
    }
    if (small) return hull();
    return field.range(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2]);
  };
  // One world voxel, exactly: g at its p, nearest or trilinear (an axis with no fraction reads one voxel).
  const P = new Float64Array(3), I = new Int32Array(3), T = new Float64Array(3), G8 = new Float64Array(8), cI = new Float64Array(3).fill(NaN);
  let have = 0;
  const pointOf = (x, y, z) => { P[F[0].src] = p(0, x); P[F[1].src] = p(1, y); P[F[2].src] = p(2, z); return P; };
  const solidAt = (x, y, z) => {
    pointOf(x, y, z);
    if (near) return field.g(Math.floor(P[0] + 0.5), Math.floor(P[1] + 0.5), Math.floor(P[2] + 0.5)) > 0;
    for (let a = 0; a < 3; a++){ I[a] = Math.floor(P[a]); T[a] = P[a] - I[a]; }
    // A world finer than the grid samples the same eight voxels many times
    // running (Morton order keeps neighbours together): keep the last eight.
    if (I[0] !== cI[0] || I[1] !== cI[1] || I[2] !== cI[2]){ cI[0] = I[0]; cI[1] = I[1]; cI[2] = I[2]; have = 0; }
    let sum = 0;
    for (let c = 0; c < 8; c++){
      let w = 1;
      for (let a = 0; a < 3; a++){ const t = c >> a & 1 ? T[a] : 1 - T[a]; w *= t; }
      if (w === 0) continue;
      if (!(have >> c & 1)){ G8[c] = field.g(I[0] + (c & 1), I[1] + (c >> 1 & 1), I[2] + (c >> 2 & 1)); have |= 1 << c; }
      sum += w * G8[c];
    }
    return sum > 0;
  };
  const v0 = [0, 0, 0], v1 = [0, 0, 0];
  const cellBox = (k, x, y, z) => {
    const s = 2 ** k;
    v0[0] = x * s; v0[1] = y * s; v0[2] = z * s;
    v1[0] = x * s + s - 1; v1[1] = y * s + s - 1; v1[2] = z * s + s - 1;
  };
  stage('shape');
  // At level 0 the sample itself decides: a box query there would only repeat it.
  const shape = store.fromField(D, (k, x, y, z) => {
    if (!k) return solidAt(x, y, z) ? 1 : 0;
    cellBox(k, x, y, z);
    return boxOf(v0, v1);
  }).root;
  // A world with no colour has no words, so no skin to give them to.
  if (!wantSkin) return { store, root: shape, skin: null, solidAt, pointOf };
  stage('skin');
  const skin = skinOf(store, shape, D);
  if (store.union(shape, skin) !== shape) throw new Error(`D = ${D}: the skin isn't inside the shape`);
  return { store, root: shape, skin, solidAt, pointOf };
}
/* The skin from the shape's DAG alone: a solid voxel with a face on air or
   on the world's edge. A cell is a node of the shape; a full one whose six
   face neighbours (same level, inside the world) are full has none, an
   empty one none, anything else is split. Edges and corners don't matter:
   a voxel shows a face only toward a face neighbour. */
export function skinOf(store, shape, D){
  // One walk down, each node with its six face neighbours at its level
  // (−x, +x, −y, +y, −z, +z; outside the world is air), so a neighbour is a
  // child away, never a walk from the root.
  const kid = (id, k, o) => id === EMPTY ? EMPTY : id === store.solid(k) ? store.solid(k - 1) : store.child(id, o);
  const bufs = Array.from({ length: D + 1 }, () => ({ ch: new Uint32Array(8), n: new Uint32Array(6) }));
  const rec = (id, k, n) => {
    if (id === EMPTY) return EMPTY;
    const full = store.solid(k);
    if (id === full && n[0] === full && n[1] === full && n[2] === full && n[3] === full && n[4] === full && n[5] === full) return EMPTY;
    if (k === 0) return id;
    const { ch } = bufs[k], cn = new Uint32Array(6);
    for (let o = 0; o < 8; o++){
      for (let a = 0; a < 3; a++){
        const bit = 1 << a, high = o & bit;
        cn[2 * a] = high ? kid(id, k, o ^ bit) : kid(n[2 * a], k, o | bit);
        cn[2 * a + 1] = high ? kid(n[2 * a + 1], k, o ^ bit) : kid(id, k, o | bit);
      }
      ch[o] = rec(kid(id, k, o), k - 1, cn);
    }
    return store.intern(k, ch);
  };
  return rec(shape, D, new Uint32Array(6));
}

/* Every voxel of `root` in rank (Morton) order, as store.child's octants
   number them (x bit 0, y bit 1, z bit 2): `visit(x, y, z)`. */
export function eachVoxel(store, root, D, visit){
  const rec = (id, k, x, y, z) => {
    if (id === EMPTY) return;
    if (k === 0){ visit(x, y, z); return; }
    const h = 2 ** (k - 1);
    for (let o = 0; o < 8; o++) rec(store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
  };
  rec(root, D, 0, 0, 0);
}

/* ---- colour sources ------------------------------------------------------------------------
   A sampler over one grid at a point in the shape grid's index space:
   mapped into the grid's own (through world space if the two transforms
   differ), then the active voxels round it weighted trilinearly (or the
   nearest), else the nearest voxel's value whatever it is. */
const invert4 = m => {
  // Row-vector affine [x y z 1]·M: the inverse of the 3 × 3 part and the moved translation.
  const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (!det) throw new Error('a transform with no inverse');
  const r = [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, 0, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, 0, C / det, -(a * h - b * g) / det, (a * e - b * d) / det, 0, 0, 0, 0, 1];
  const t = [m[12], m[13], m[14]];
  for (let k = 0; k < 3; k++) r[12 + k] = -(t[0] * r[k] + t[1] * r[4 + k] + t[2] * r[8 + k]);
  return r;
};
const apply4 = (m, p, out) => { for (let k = 0; k < 3; k++) out[k] = p[0] * m[k] + p[1] * m[4 + k] + p[2] * m[8 + k] + m[12 + k]; return out; };
export function samplerOf(tree, info, shapeInfo, { sampling = 'trilinear' } = {}){
  const same = info.transform.matrix && shapeInfo.transform.matrix && info.transform.matrix.every((v, k) => v === shapeInfo.transform.matrix[k]);
  if (!same && (!info.transform.matrix || !shapeInfo.transform.matrix)) throw new Error(`${info.uniqueName}: a frustum transform, and not the shape's: can't line the two up`);
  const toWorld = shapeInfo.transform.matrix, toIndex = same ? null : invert4(info.transform.matrix);
  const comps = tree.comps, out = new Float64Array(comps), acc = new Float64Array(comps), W = new Float64Array(3), Q = new Float64Array(3);
  const near = sampling === 'nearest';
  return (P, dst) => {
    const q = same ? P : apply4(toIndex, apply4(toWorld, P, W), Q);
    const nx = Math.floor(q[0] + 0.5), ny = Math.floor(q[1] + 0.5), nz = Math.floor(q[2] + 0.5);
    if (!near){
      const ix = Math.floor(q[0]), iy = Math.floor(q[1]), iz = Math.floor(q[2]), tx = q[0] - ix, ty = q[1] - iy, tz = q[2] - iz;
      let sw = 0;
      acc.fill(0);
      for (let c = 0; c < 8; c++){
        const w = (c & 1 ? tx : 1 - tx) * (c & 2 ? ty : 1 - ty) * (c & 4 ? tz : 1 - tz);
        if (w === 0) continue;
        if (!tree.probe(ix + (c & 1), iy + (c >> 1 & 1), iz + (c >> 2 & 1), out)) continue;
        sw += w;
        for (let k = 0; k < comps; k++) acc[k] += w * out[k];
      }
      if (sw > 0){ for (let k = 0; k < comps; k++) dst[k] = acc[k] / sw; return true; }
    }
    const act = tree.probe(nx, ny, nz, out);
    for (let k = 0; k < comps; k++) dst[k] = out[k];
    return !!act;
  };
}
// The active values' range of a scalar tree, for a ramp.
export function activeRange(tree){
  const { comps, leafCount, leafValues, leafMask, leafLog2: L, nodes } = tree, LS = 1 << 3 * L, words = LS / 32;
  let lo = Infinity, hi = -Infinity;
  const see = v => { if (v < lo) lo = v; if (v > hi) hi = v; };
  for (let j = 0; j < leafCount; j++) for (let i = 0; i < LS; i++) if ((leafMask[j * words + (i >>> 5)] >>> (i & 31)) & 1) see(leafValues[(j * LS + i) * comps]);
  for (const node of nodes) for (let i = 0; i < node.child.length; i++) if (node.child[i] < 0 && (node.valueMask[i >>> 5] >>> (i & 31)) & 1) see(node.values[i * comps]);
  for (const t of tree.rootTiles) if (t.active) see(t.value[0]);
  return lo === Infinity ? [0, 1] : [lo, hi];
}
const HEAT = [[0, 0, 0, 0], [0.25, 0.45, 0.02, 0.02], [0.5, 0.9, 0.25, 0.02], [0.75, 1, 0.72, 0.1], [1, 1, 1, 0.92]];
export function ramp(kind, t){
  t = Math.min(1, Math.max(0, t));
  if (kind === 'grey') return [t, t, t];
  for (let i = 1; i < HEAT.length; i++) if (t <= HEAT[i][0]){
    const [a, ...ca] = HEAT[i - 1], [b, ...cb] = HEAT[i], u = (t - a) / (b - a);
    return ca.map((c, k) => c + (cb[k] - c) * u);
  }
  return HEAT.at(-1).slice(1);
}
const toSrgbOn = v => 255 * Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2);
const asIs = v => 255 * Math.min(1, Math.max(0, v));
/* The words: the colour at each skin voxel's p, in rank order. `trees`
   are the colour source's grids, read. */
export function wordsOf(store, skin, D, count, pointOf, colour, trees, shapeInfo, { sampling = 'trilinear', gamma = true } = {}){
  const toSrgb = gamma ? toSrgbOn : asIs;
  const S = colour.grids.map((g, k) => samplerOf(trees[k], g, shapeInfo, { sampling }));
  const div = colour.divide ? samplerOf(trees[3], colour.divide, shapeInfo, { sampling }) : null;
  const words = new Uint32Array(count), v = new Float64Array(3), one = new Float64Array(1), d1 = new Float64Array(1);
  const range = colour.kind === 'heat' || colour.kind === 'grey' ? activeRange(trees[0]) : null;
  let i = 0;
  eachVoxel(store, skin, D, (x, y, z) => {
    const P = pointOf(x, y, z);
    let r, g, b;
    if (colour.kind === 'vec3'){ S[0](P, v); [r, g, b] = [toSrgb(v[0]), toSrgb(v[1]), toSrgb(v[2])]; }
    else if (colour.kind === 'rgb'){
      const c = [0, 1, 2].map(k => (S[k](P, one), one[0]));
      if (div){ div(P, d1); const d = d1[0]; for (let k = 0; k < 3; k++) c[k] = d > 1e-6 ? c[k] / d : c[k]; }
      [r, g, b] = c.map(toSrgb);
    } else {
      S[0](P, one);
      const t = range[1] > range[0] ? (one[0] - range[0]) / (range[1] - range[0]) : 1;
      [r, g, b] = ramp(colour.kind, t).map(c => 255 * c);
    }
    words[i++] = rgb8(r, g, b);
  });
  if (i !== count) throw new Error(`the skin has ${i} voxels, not ${count}`);
  return words;
}

/* ---- the whole conversion ----------------------------------------------------------------
   `src` is a vdb-core source (bytes, a File, a file handle). `depths` are
   D = 6–10 and/or 'native'. Settings left out take the file's defaults
   (defaultShape, modeOf, thresholdOf, defaultColour, the up axis), and
   onAsset gets what was chosen, so a page can show it and let it change. */
export async function convertVdb(src, { name = 'volume', depths = [8, 10], bits = 6, grid = null, mode = null, threshold = null, sampling = 'trilinear',
                                        colour = 'auto', up = 'auto', gamma = true, point = { shape: 'cube', r: 0 }, opacity = 0,
                                        thumbs = true, onAsset = () => {}, onStage = () => {}, onWorld = () => {} } = {}){
  if (bits !== 6 && bits !== 8) throw new Error('bits is 6 or 8');
  if (typeof gamma !== 'boolean') throw new Error(`gamma is on or off, not ${gamma}`);
  kernelOf(point.shape, point.r);
  if (!(opacity >= 0 && opacity <= 1)) throw new Error(`opacity is 0 to 1, not ${opacity}`);
  if (!SAMPLINGS.includes(sampling)) throw new Error(`sampling: ${sampling}? (${SAMPLINGS.join(', ')})`);
  if (!['auto', 'y', 'z'].includes(up)) throw new Error(`up: ${up}? (auto, y, z)`);
  if (!depths.length) throw new Error('no depth asked for');
  for (const D of depths) if (D !== 'native' && !DEPTHS.includes(D)) throw new Error(`D = ${D}: the converter makes ${DEPTHS[0]} to ${DEPTHS.at(-1)}, or native`);
  onStage(null, 'reading');
  const file = await inspectVdb(src);
  const shapeName = grid ?? defaultShape(file);
  if (!shapeName) throw new Error(`no grid here is a volume this reader reads${file.grids.length ? ` (${file.grids.map(g => `${g.uniqueName}: ${g.why ?? g.value}`).join('; ')})` : ''}`);
  const info = file.grids.find(g => g.uniqueName === shapeName);
  if (!info) throw new Error(`no grid named ${shapeName}`);
  if (info.why) throw new Error(`${shapeName}: ${info.why}`);
  if (info.points) return convertPoints(src, file, info, { name, depths, bits, mode, colour, up, gamma, point, opacity, thumbs, onAsset, onStage, onWorld });
  mode = mode ?? modeOf(info);
  if (mode === 'points') throw new Error(`${shapeName} is a volume: "points" is a point grid's rule`);
  threshold = threshold ?? thresholdOf(mode);
  if (!Number.isFinite(threshold)) throw new Error(`threshold: ${threshold}?`);
  const upAxis = up === 'auto' ? (isBlender(file) ? 'z' : 'y') : up;
  const colourSpec = colour === 'auto' ? defaultColour(file, shapeName) : colour, C = parseColour(colourSpec, file);
  const notes = [];
  if (info.transform.matrix){
    const m = info.transform.matrix, cols = [0, 1, 2].map(k => Math.hypot(m[4 * k], m[4 * k + 1], m[4 * k + 2]));
    const off = Math.abs(m[1]) + Math.abs(m[2]) + Math.abs(m[4]) + Math.abs(m[6]) + Math.abs(m[8]) + Math.abs(m[9]);
    if (Math.max(...cols) > Math.min(...cols) * (1 + 1e-6)) notes.push(`its voxels aren't cubes in the world (${cols.map(c => +c.toPrecision(4)).join(' × ')}): drawn as cubes`);
    if (off > 1e-9 * Math.max(...cols)) notes.push('it\'s turned in the world: drawn in its own index space');
  } else notes.push('a frustum transform: drawn in its index space');
  // Told twice: what was chosen as soon as the file's been looked at (so a
  // page can offer other choices even if this one fails), then the solid.
  const asset = { grids: summaryOf(file), version: file.version, library: file.library, grid: shapeName, class: info.class, mode, threshold, sampling, up: upAxis,
                  colour: colourSpec, notes,
                  // What a page offers to change: the grids a shape can come from (each with its default rule) and the colours.
                  shapes: shapesOf(file), colours: colourChoices(file), gamma };
  onAsset({ ...asset });
  const tree = await readGrid(src, file, info);
  onStage(null, 'analysing');
  const field = fieldOf(tree, mode, threshold), box = field.solidBox();
  if (!box) throw new Error(`nothing in ${shapeName} is solid by "${mode}"${mode === 'active' ? '' : ` at ${threshold}`}`);
  const colourTrees = [];
  if (C){
    for (const g of [...C.grids, ...(C.divide ? [C.divide] : [])]) colourTrees.push(g === info ? tree : await readGrid(src, file, g));
  }
  Object.assign(asset, { box, size: [0, 1, 2].map(a => box.hi[a] - box.lo[a] + 1), leaves: tree.leafCount, native: nativeDepth(box, upAxis) });
  onAsset({ ...asset });
  const slug = slugOf(name), worlds = [];
  for (const want of depths){
    const native = want === 'native', D = native ? asset.native : want;
    if (native && D > MAX_NATIVE_D) throw new Error(`native: the grid needs D = ${D}, past ${MAX_NATIVE_D}; pick a depth instead`);
    const ms = {}, stage = stager(D, ms, onStage), frame = frameOf(box, D, { native, up: upAxis });
    const b = buildDepth(field, frame, { sampling, stage, skin: !!C });
    let words = null;
    if (C){
      stage('words');
      const counts = createCounts(b.store);
      words = wordsOf(b.store, b.skin, D, counts.of(b.skin), b.pointOf, C, colourTrees, info, { sampling, gamma });
    }
    const world = await finishDepth({ store: b.store, root: b.root, D, M: frame.M, skin: C ? b.skin : undefined, words, bits, name, slug, thumbs, stage, ms,
                                      title: native ? `${name} (native, D = ${D})` : `${name} (D = ${D})`, file: native ? `${slug}-native-d${D}.vdag` : `${slug}-d${D}.vdag` });
    world.native = native;
    worlds.push(world); onWorld(world);
  }
  return { asset, worlds };
}

// The grids a shape can come from, each with its own rule and threshold.
const shapesOf = file => file.grids.filter(g => !g.why && (isScalar(g) || isVec3(g) || g.points)).map(g => ({ name: g.uniqueName, mode: modeOf(g), threshold: thresholdOf(modeOf(g)), points: !!g.points }));

/* ---- a point data grid ------------------------------------------------------------------
   Its points as convert/'s cloud: `xyz` in the viewer's frame (y up; a
   z-up grid turned (x, y, z) → (x, z, −y), a rotation), world positions
   for a fitted depth, the points' voxels for native; `rgb` 0–255 and
   `alpha` from the attributes asked for. */
export function cloudOf(tree, info, { colourAttr = null, alphaAttr = null, gamma = true, up = 'y', native = false } = {}){
  const n = tree.count, xyz = new Float64Array(3 * n), w = [0, 0, 0], m = info.transform.matrix, turn = up === 'z';
  if (!native && !m) throw new Error(`${info.uniqueName}: a frustum transform; only native places it`);
  for (let k = 0; k < n; k++){
    let x, y, z;
    if (native){ x = tree.voxel[3 * k]; y = tree.voxel[3 * k + 1]; z = tree.voxel[3 * k + 2]; }
    else { worldOf(tree, m, k, w); [x, y, z] = w; }
    xyz[3 * k] = x; xyz[3 * k + 1] = turn ? z : y; xyz[3 * k + 2] = turn ? -y : z;
  }
  const attr = name => tree.attributes.find(a => a.name === name);
  let rgb = null, alpha = null;
  if (colourAttr){
    const A = attr(colourAttr);
    if (!A || A.comps !== 3 || A.stride !== 1 || !A.values) throw new Error(`colour: ${colourAttr} isn't a vec3 attribute of ${info.uniqueName}`);
    const f = gamma ? toSrgbOn : asIs;
    rgb = new Float32Array(3 * n);
    for (let i = 0; i < 3 * n; i++) rgb[i] = f(A.values[i]);
  }
  if (alphaAttr){
    const A = attr(alphaAttr);
    if (!A || A.comps !== 1 || A.stride !== 1 || !A.values) throw new Error(`opacity: ${alphaAttr} isn't a scalar attribute of ${info.uniqueName}`);
    alpha = Float32Array.from(A.values);
  }
  return { xyz, rgb, alpha, n };
}
/* Native: one world voxel a grid voxel, the points' voxel box placed as
   frameOf places a volume's (centred in x and z, 4% off the floor). */
export function nativeFit(cloud){
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], { xyz, n } = cloud;
  for (let k = 0; k < n; k++) for (let a = 0; a < 3; a++){ const v = xyz[3 * k + a]; if (v < lo[a]) lo[a] = v; if (v > hi[a]) hi[a] = v; }
  const box = { lo, hi }, D = nativeDepth(box), F = frameOf(box, D, { native: true });
  // frameOf's voxel v reads grid lo + v − off, so a point's voxel g lands in g − lo + off.
  const off = [0, 1, 2].map(a => F.F[a].off - lo[a] + 0.5);
  return { D, fit: { side: F.side, s: 1, off, lo: F.M.lo, hi: F.M.hi } };
}
async function convertPoints(src, file, info, { name, depths, bits, mode, colour, up, gamma, point, opacity, thumbs, onAsset, onStage, onWorld }){
  if (mode != null && mode !== 'points') throw new Error(`${info.uniqueName} is a point grid: its rule is "points", not "${mode}"`);
  const upAxis = up === 'auto' ? (isBlender(file) ? 'z' : 'y') : up, notes = [];
  if (colour !== 'auto' && colour !== 'none' && !/^attr:./.test(colour)) throw new Error(`colour: ${colour}? (a point grid's colour is auto, none or attr:<a vec3 attribute>)`);
  const asset = { grids: summaryOf(file), version: file.version, library: file.library, grid: info.uniqueName, class: info.class, mode: 'points', threshold: 0,
                  sampling: null, up: upAxis, colour, notes, shapes: shapesOf(file), gamma, point, opacity,
                  colours: [{ value: 'auto', label: 'auto (Cd if it has one)' }, { value: 'none', label: 'none (the shape alone)' }] };
  onAsset({ ...asset });
  // Read only what a colour or an opacity could be (P always comes).
  const want = colour.startsWith('attr:') ? colour.slice(5) : null;
  const tree = await readPoints(src, file, info, { want: n => n === want || COLOUR_NAME.test(n) || ALPHA_NAME.test(n) });
  onStage(null, 'analysing');
  if (!tree.count) throw new Error(`${info.uniqueName} holds no points`);
  // A colour can be any float vec3 attribute but the positions, decoded or not (the menu; a choice is decoded the next time).
  const vec3s = tree.attributes.filter(a => a.name !== 'P' && a.comps === 3 && a.stride === 1 && !a.why && /^vec3[sdh]$/.test(a.valueType));
  const colourAttr = colour === 'auto' ? (vec3s.find(a => COLOUR_NAME.test(a.name))?.name ?? null) : colour === 'none' ? null : colour.slice(5);
  if (colourAttr && !vec3s.some(a => a.name === colourAttr && a.values)) throw new Error(`colour: ${colourAttr} isn't a vec3 attribute of ${info.uniqueName}`);
  const alphaAttr = opacity > 0 ? (tree.attributes.find(a => ALPHA_NAME.test(a.name) && a.comps === 1 && a.stride === 1 && a.values)?.name ?? null) : null;
  if (opacity > 0 && !alphaAttr) notes.push('no Alpha or opacity attribute: every point kept');
  if (colour === 'auto' && !colourAttr) notes.push('no Cd or other colour attribute: the shape alone');
  const skipped = tree.attributes.filter(a => a.why).map(a => `${a.name} (${a.why})`);
  if (skipped.length) notes.push(`not read: ${skipped.join(', ')}`);
  Object.assign(asset, { colour: colourAttr ? `attr:${colourAttr}` : 'none', points: tree.count, leaves: tree.leafCount, alpha: alphaAttr,
                         attributes: tree.attributes.map(a => ({ name: a.name, type: a.valueType, codec: a.codec, stride: a.stride })), groups: tree.groups.map(g => g.name),
                         colours: [{ value: 'none', label: 'none (the shape alone)' }, ...vec3s.map(a => ({ value: `attr:${a.name}`, label: `${a.name} (RGB)` }))] });
  const fitted = depths.filter(D => D !== 'native'), wantNative = depths.includes('native');
  const cloud = fitted.length ? cloudOf(tree, info, { colourAttr, alphaAttr, gamma, up: upAxis }) : null;
  const ncloud = wantNative ? cloudOf(tree, info, { colourAttr, alphaAttr, gamma, up: upAxis, native: true }) : null;
  const nf = ncloud ? nativeFit(ncloud) : null;
  if (nf){
    asset.native = nf.D;
    const mm = info.transform.matrix;
    if (mm && Math.abs(mm[1]) + Math.abs(mm[2]) + Math.abs(mm[4]) + Math.abs(mm[6]) + Math.abs(mm[8]) + Math.abs(mm[9]) > 1e-9 * Math.hypot(mm[0], mm[1], mm[2])) notes.push('native: in its own index space, not turned as it is in the world');
  }
  const box = cloud ? pointBox(cloud, { opacity }) : null, nbox = ncloud ? pointBox(ncloud, { opacity }) : null;
  const kept = (box ?? nbox).kept, faint = (box ?? nbox).faint;
  if (!kept) throw new Error(faint ? `every point is fainter than the opacity ${opacity}` : 'no point with a finite place');
  if (faint) notes.push(`${faint.toLocaleString('en-US')} points under opacity ${opacity} dropped`);
  asset.kept = kept;
  if (cloud) asset.size = [0, 1, 2].map(a => +(box.hi[a] - box.lo[a]).toPrecision(4));
  else asset.size = [0, 1, 2].map(a => nbox.hi[a] - nbox.lo[a] + 1);
  onAsset({ ...asset });
  const slug = slugOf(name), worlds = [];
  for (const want of depths){
    const native = want === 'native', D = native ? nf.D : want;
    if (native && D > MAX_POINTS_D) throw new Error(`native: the points need D = ${D}, past ${MAX_POINTS_D}; pick a depth instead`);
    const ms = {}, stage = stager(D, ms, onStage), store = createStore();
    stage('points');
    const r = pointsDepth(native ? ncloud : cloud, native ? nbox : box, D, store, { bake: !!colourAttr, point, fit: native ? nf.fit : null });
    const world = await finishDepth({ store, root: r.root, D, M: r.M, skin: r.words ? r.skin : undefined, words: r.words, bits, name, slug, thumbs, stage, ms,
                                      title: native ? `${name} (native, D = ${D})` : `${name} (D = ${D})`, file: native ? `${slug}-native-d${D}.vdag` : `${slug}-d${D}.vdag` });
    world.native = native; world.points = r.points;
    worlds.push(world); onWorld(world);
  }
  return { asset, worlds };
}
