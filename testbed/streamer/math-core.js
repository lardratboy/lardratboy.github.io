/* ================== MATH CORE (pure) ====================================
   The math world (docs/math-world.md, asked for 2026-11-20): famous
   surfaces and interesting solids (math-shapes.js), each voxelized at a
   size R from 32 to 128 and a turn about y, standing on the scatter's
   hills crust, all in ONE DAG. The scatter world's sibling: the same
   ground (scatter-core's groundOf), the same resting rule (restingY), the
   same cut into blocks (splitBlocks) and the same graft and prune. What
   differs is where the voxels come from: a formula, not a recipe, so
   there is no uniqueness pass, and an object can be turned by any yaw,
   not only the cube's 24 turns, because it is voxelized already turned.
   Pure: imports dag-core.js, specimen-core.js's hash, scatter-core.js and
   the shapes.

   A world is a descriptor, { seed, D, pitch, rMin, rMax, margin, ground,
   repeat }, and everything follows from it:
   - the LAYOUT (mathLayout): the ground cut into cells of pitch P in x and
     z, one object a cell. The objects come from a deck: every shape once
     in a hashed order, then every shape again in another, so each shape
     appears ⌊N/S⌋ or ⌈N/S⌉ times and no seed leaves one out. Each cell
     hashes its object's R in its own size range within [rMin, rMax]
     (sizeRange), its yaw (a 4,096th of a turn,
     or a quarter turn for an `axial` shape) and its box's place in the
     cell, `margin` voxels at least from the cell's edge;
   - the PLACEMENT (placeRange): voxelize, rest on the ground, cut into
     blocks of side B (the power of two ≥ rMax), intern them;
   - the WORLD: the ground built top-down, the blocks grafted in, pruned.
   buildMath does it on one thread (Node, the tests, the page's fallback);
   the page deals the cells round its workers (scatter-build.js) and an
   assembler merges their parts in a fixed order. The same world either
   way: math-core.test.js imports a three-part build into a one-part
   build's store and wants the same root id.

   THE VOXELIZER (voxelize). An object's frame is (−1, 1)³, y up; voxel i
   of the box has its centre at p = (2i + 1)/R − 1 in the box's frame, and
   the object's frame is the box's turned back by the yaw. Each kind is
   voxelized its own way (math-shapes.js says which):
   - solid: inside(p) at every voxel centre;
   - sheet: f at every voxel centre (and a voxel round the box, for the
     gradient), kept where |f| ≤ τ|∇f|, ∇f by central differences on that
     grid: a slab of half thickness τ round f = 0 to first order;
   - surface and curve: points in the box's voxels, each grid quad (or
     polyline segment) cut into steps of at most STEP voxels, each step a
     ball. The balls are put down once per half-voxel cell (a bitset of
     (2R)³), centred on that cell's centre, so a dense sampling costs the
     cells it visits, not the samples: a Klein bottle at R = 128 visits
     ~80,000 cells for ~600,000 samples.
   The shell's half thickness (sheets and surfaces) is SHELL(R) = max(1.1,
   R/44) voxels, so a surface is 2.2 voxels thick at R = 32 and 5.8 at 128:
   thinner and a coarse lod opens holes in it (docs/lodacne.md), thicker
   and the small ones turn into lumps. A tube is its shape's radius, never
   under 1.2 voxels.
   Then DUST: 26-connected pieces under 1% of the largest are dropped. The
   Mandelbulb at R = 128 was one piece of 418,885 voxels and 213 specks of
   1 to 9 (the iteration's tendrils, caught by a centre here and there),
   which would hang in the air over the hills. The Borromean rings are three
   pieces of about a third each, and stay three.

   THE COLOUR (mathColour). The ground's own, except inside an object's box
   above the ground: the gamut of the point's place in the object's own
   frame, turned with it, lifted as the kit's (40 + 215·t, so no corner is
   black). `repeat` k = 1 spreads one gamut over the object's cube; k > 1
   repeats it k times along each axis, a sawtooth, the kit's cyclic gamut
   with the object's cube as the frame: k = 2 is a gamut per unit cube of
   the object's frame (asked for 2026-11-20). The default is k = 1, one
   plain gamut an object (the user, 2026-11-20: "gamut with 0 repeats, the
   user can choose the other afterwards if they wish"); it was 2 at first.
   ===================================================================== */
import { createStore, pruneWorld } from './dag-core.js';
import { hash32 } from './specimen-core.js';
import { groundOf, scatterGround, restingY, splitBlocks } from './scatter-core.js';
import { SHAPES, colourFieldOf } from './experiments/shapes.mjs';
import { MATH_SHAPES, MATH_FAMILIES } from './math-shapes.js';

export { MATH_SHAPES, MATH_FAMILIES };
export const MATH_LIMITS = { D: [8, 12], R: [32, 128], seed: [1, 0xffff], repeat: [1, 8] };
/* pitch 192: a cell holds the largest object (128) with 28 voxels to spare
   each side at most, so the field reads as objects with room between, not
   a crowd (the scatter's 64 in 128 is half full; this is two thirds at
   most and about two fifths on average). D = 11 holds 100. */
export const MATH_DEFAULTS = { seed: 1, D: 11, pitch: 192, rMin: 32, rMax: 128, margin: 4, ground: 'hills', repeat: 1 };
export const YAW_STEPS = 4096, STEP = 0.45, TABLE_WORDS = 7;
export const SHELL = R => Math.max(1.1, R / 44);
export const TUBE_MIN = 1.2;
const TAU = 2 * Math.PI;
const int = (v, [lo, hi], what) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`math: ${what} ${v} is not an integer in ${lo}…${hi}`);
  return v;
};

/* The descriptor, filled and checked. B, the blocks' side, is the power of
   two at least rMax: a box then meets at most two blocks an axis. */
export function mathDesc(over = {}){
  const d = { ...MATH_DEFAULTS, ...over, kind: 'math' };
  int(d.D, MATH_LIMITS.D, 'D'); int(d.seed, MATH_LIMITS.seed, 'seed'); int(d.repeat, MATH_LIMITS.repeat, 'repeat');
  int(d.rMin, MATH_LIMITS.R, 'smallest R'); int(d.rMax, MATH_LIMITS.R, 'largest R');
  if (d.rMin > d.rMax) throw new Error(`math: smallest R ${d.rMin} over the largest ${d.rMax}`);
  if (d.pitch < d.rMax + 2 * d.margin) throw new Error(`math: pitch ${d.pitch} leaves no room for R = ${d.rMax} with margin ${d.margin}`);
  if (d.pitch > 2 ** d.D) throw new Error(`math: pitch ${d.pitch} is wider than the world (D = ${d.D})`);
  d.B = 2 ** Math.ceil(Math.log2(d.rMax));
  return d;
}
/* The link: ?math=repeat,rMin,rMax (the seed and the depth are the world id's
   and the depth's, as the scatter's). */
export const mathParam = d => `${d.repeat},${d.rMin},${d.rMax}`;
export function mathFromParam(s, seed = 1, D = MATH_DEFAULTS.D){
  const [repeat, rMin, rMax] = String(s).split(',').map(Number);
  return mathDesc({ seed, D, repeat, rMin: rMin || MATH_DEFAULTS.rMin, rMax: rMax || MATH_DEFAULTS.rMax });
}

/* A yaw a as [cos, sin] of a/YAW_STEPS of a turn. The quarter turns are
   exact (Math.cos(π/2) is 6e-17, not 0), so an axial shape's turned copy is
   its voxels turned, voxel for voxel: math-core.test.js holds it to
   scatter-core's rotateOcc. */
const QUARTER = [[1, 0], [0, 1], [-1, 0], [0, -1]];
export function yawOf(a){
  if (a % (YAW_STEPS / 4) === 0) return QUARTER[a / (YAW_STEPS / 4)];
  return [Math.cos(TAU * a / YAW_STEPS), Math.sin(TAU * a / YAW_STEPS)];
}

/* ---- fitting a surface or a curve into its frame ---------------------------
   The raw points (a surface's grid, a curve's polylines) turned so the raw
   axis `up` is y (a proper turn: z up is (x, z, −y)), centred on their box,
   scaled into the unit cylinder (or the cube, if axial) less a margin for
   the shell or the tube. Cached by shape and detail: a few ms a shape. */
const FITS = new Map();
export function fitted(shape, d){
  const key = shape.name + '|' + d;
  if (FITS.has(key)) return FITS.get(key);
  let paths, dims = null;
  if (shape.kind === 'surface'){
    // One grid a patch (`patches`, 1 if not said: the Calabi–Yau section has 25).
    const [nu, nv] = shape.grid, o = [0, 0, 0];
    paths = [];
    for (let q = 0; q < (shape.patches ?? 1); q++){
      const g = new Float64Array(3 * (nu + 1) * (nv + 1));
      for (let j = 0, k = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k += 3){ shape.at(i / nu, j / nv, o, q); g[k] = o[0]; g[k + 1] = o[1]; g[k + 2] = o[2]; }
      paths.push(g);
    }
    dims = [nu + 1, nv + 1];
  } else paths = shape.paths(d).map(p => Float64Array.from(p));
  const up = shape.up ?? 1;
  for (const p of paths) for (let k = 0; k < p.length; k += 3){
    const x = p[k], y = p[k + 1], z = p[k + 2];
    if (up === 2){ p[k + 1] = z; p[k + 2] = -y; } else if (up === 0){ p[k] = y; p[k + 1] = x; p[k + 2] = -z; }
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  // A surface's point that isn't drawn is NaN (Costa's surface out past its
  // clip, toward its ends at infinity): left out of the fit, and every grid
  // quad with such a corner is left out of the voxels.
  for (const p of paths) for (let k = 0; k < p.length; k += 3) if (p[k] === p[k]) for (let a = 0; a < 3; a++){ lo[a] = Math.min(lo[a], p[k + a]); hi[a] = Math.max(hi[a], p[k + a]); }
  /* A shape may give its fit (`fit: { c, ext }`, after the turn to y up)
     rather than have it read off its points. Costa's surface does: its
     extreme points lie at its clip, near its ends, where ζ divides by a θ1
     near zero and Chrome's last bits and Node's differ (Math's functions
     aren't the same to the ulp in both), so a fit read off them moved every
     point a hair, and 3 of 66,790 voxels with it (the page's D = 11 world
     against buildMath's). */
  const c = shape.fit ? shape.fit.c.slice() : lo.map((v, a) => (v + hi[a]) / 2);
  let ext = (hi[1] - lo[1]) / 2;
  if (shape.fit) ext = shape.fit.ext;
  else if (shape.axial) ext = Math.max(ext, (hi[0] - lo[0]) / 2, (hi[2] - lo[2]) / 2);
  else for (const p of paths) for (let k = 0; k < p.length; k += 3) if (p[k] === p[k]) ext = Math.max(ext, Math.hypot(p[k] - c[0], p[k + 2] - c[2]));
  // The shell's or the tube's reach in the frame at the smallest R it can be
  // drawn at (MATH_LIMITS: 32, where a shell of 1.1 voxels is 2.2/32 of the
  // frame and a tube of 1.2 is 2.4/32; above that they shrink or hold), plus
  // the half-voxel cell a ball is centred on (√3/4 of a voxel, 0.014).
  const tube = shape.kind === 'curve' ? tubeOf(shape, d) : 0;
  const margin = (shape.kind === 'curve' ? Math.max(tube, 2 * TUBE_MIN / 32) : 2 * 1.1 / 32) + 0.016;
  const s = (1 - margin) / ext;
  for (const p of paths) for (let k = 0; k < p.length; k += 3) for (let a = 0; a < 3; a++) p[k + a] = (p[k + a] - c[a]) * s;
  const out = { paths, dims, tube };
  FITS.set(key, out);
  return out;
}
const tubeOf = (shape, d) => typeof shape.tube === 'function' ? shape.tube(d) : shape.tube;

/* ---- the voxelizer -------------------------------------------------------------
   `shape` at side R and yaw, into an R³ occupancy (x fastest). `pad` widens
   the box by that many voxels on every side, the object where it was: the
   test's way to see what would fall outside. `skip: false` asks every voxel,
   not only those inside the unit cylinder (the test again: the cylinder is a
   promise, and the skip would hide a broken one). `cells: true` hands back a
   surface's or a curve's half-voxel cells too (the bitset), for the test's
   check that the sampling leaves no gap. */
export function voxelize(shape, R, yaw, { pad = 0, skip = true, cells = false } = {}){
  const d = shape.detail ? shape.detail(R) : 0, S = R + 2 * pad, occ = new Uint8Array(S * S * S), [c, s] = yawOf(yaw);
  const P = i => (2 * (i - pad) + 1) / R - 1, cyl = skip && !shape.axial;
  let voxels = 0, clipped = 0, seenCells = null;
  if (shape.kind === 'solid'){
    for (let k = 0, n = 0; k < S; k++){ const bz = P(k);
      for (let j = 0; j < S; j++){ const by = P(j);
        for (let i = 0; i < S; i++, n++){ const bx = P(i);
          if (cyl && bx * bx + bz * bz > 1) continue;
          if (shape.inside(c * bx - s * bz, by, s * bx + c * bz, d)){ occ[n] = 1; voxels++; }
        } } }
  } else if (shape.kind === 'sheet'){
    // f on the box's voxel centres and one more round it: index i + 1 is voxel i.
    const G = S + 2, F = new Float64Array(G * G * G), tau = SHELL(R) * 2 / R, h2 = 4 / R;
    for (let k = 0, n = 0; k < G; k++){ const bz = P(k - 1);
      for (let j = 0; j < G; j++){ const by = P(j - 1);
        for (let i = 0; i < G; i++, n++){ const bx = P(i - 1); F[n] = shape.f(c * bx - s * bz, by, s * bx + c * bz); } } }
    for (let k = 0, n = 0; k < S; k++){ const bz = P(k);
      for (let j = 0; j < S; j++){ const by = P(j);
        for (let i = 0; i < S; i++, n++){ const bx = P(i);
          if (cyl && bx * bx + bz * bz > 1) continue;
          const m = (i + 1) + G * ((j + 1) + G * (k + 1)), f = F[m];
          const gx = (F[m + 1] - F[m - 1]) / h2, gy = (F[m + G] - F[m - G]) / h2, gz = (F[m + G * G] - F[m - G * G]) / h2;
          if (Math.abs(f) <= tau * Math.sqrt(gx * gx + gy * gy + gz * gz)){
            const ox = c * bx - s * bz, oz = s * bx + c * bz;
            if (shape.clip(ox, by, oz)){ occ[n] = 1; voxels++; }
          }
        } } }
  } else {
    const { paths, dims, tube } = fitted(shape, d), rho = shape.kind === 'curve' ? Math.max(TUBE_MIN, tube * R / 2) : SHELL(R);
    const seen = seenCells = new Uint32Array(Math.ceil((2 * S) ** 3 / 32)), balls = ballsOf(rho), S2 = 2 * S, half = R / 2;
    /* A point of the object's frame into the padded box's voxel coordinates,
       SNAPPED to 2^-20 of a voxel. Chrome's Math and Node's differ in the
       last bit here and there (atan2, for one), and a symmetric surface puts
       points exactly on its planes of symmetry, which are half-cell
       boundaries of the box: Costa's at 0 came out as ±1e-16 by engine, and
       a ball moved (1 voxel of 66,555 between the page's D = 11 world and
       buildMath's). Snapped, an exact value stays exact in both engines; a
       value only differs if it lies within 1e-14 or so of a snap's midpoint. */
    const snapV = v => Math.round(v * 1048576) / 1048576;
    const toBox = p => { const V = new Float64Array(p.length);
      for (let k = 0; k < p.length; k += 3){ const x = p[k], z = p[k + 2];
        V[k] = snapV((c * x + s * z + 1) * half + pad); V[k + 1] = snapV((p[k + 1] + 1) * half + pad); V[k + 2] = snapV((-s * x + c * z + 1) * half + pad); }
      return V; };
    const put = (x, y, z) => {
      const kx = Math.floor(2 * x), ky = Math.floor(2 * y), kz = Math.floor(2 * z);
      if (kx < 0 || ky < 0 || kz < 0 || kx >= S2 || ky >= S2 || kz >= S2){ clipped++; return; }
      const b = kx + S2 * (ky + S2 * kz);
      if (seen[b >>> 5] & (1 << (b & 31))) return;
      seen[b >>> 5] |= 1 << (b & 31);
      const list = balls[(kx & 1) | (ky & 1) << 1 | (kz & 1) << 2], ix = kx >> 1, iy = ky >> 1, iz = kz >> 1;
      for (let q = 0; q < list.length; q += 3){
        const X = ix + list[q], Y = iy + list[q + 1], Z = iz + list[q + 2];
        if (X < 0 || Y < 0 || Z < 0 || X >= S || Y >= S || Z >= S){ clipped++; continue; }
        const n = X + S * (Y + S * Z);
        if (!occ[n]){ occ[n] = 1; voxels++; }
      }
    };
    if (dims) for (const path of paths){
      const [nu, nv] = dims, V = toBox(path), at = (i, j) => 3 * (i + nu * j);
      const d2 = (a, b) => Math.hypot(V[a] - V[b], V[a + 1] - V[b + 1], V[a + 2] - V[b + 2]);
      for (let j = 0; j + 1 < nv; j++) for (let i = 0; i + 1 < nu; i++){
        const A = at(i, j), B = at(i + 1, j), C = at(i, j + 1), E = at(i + 1, j + 1);
        // A quad with an undrawn corner is left out. Said, not needed: its
        // steps would be NaN and its loops never run (a mutant without
        // this line survived the suite: the same voxels).
        if (V[A] !== V[A] || V[B] !== V[B] || V[C] !== V[C] || V[E] !== V[E]) continue;
        const n = Math.max(1, Math.ceil(Math.max(d2(A, B), d2(C, E), d2(A, C), d2(B, E)) / STEP));
        for (let b = 0; b <= n; b++){ const v = b / n;
          for (let a = 0; a <= n; a++){ const u = a / n, w0 = (1 - u) * (1 - v), w1 = u * (1 - v), w2 = (1 - u) * v, w3 = u * v;
            put(w0 * V[A] + w1 * V[B] + w2 * V[C] + w3 * V[E], w0 * V[A + 1] + w1 * V[B + 1] + w2 * V[C + 1] + w3 * V[E + 1],
                w0 * V[A + 2] + w1 * V[B + 2] + w2 * V[C + 2] + w3 * V[E + 2]); } }
      }
    } else for (const p of paths){
      const V = toBox(p);
      for (let k = 0; k + 3 < V.length; k += 3){
        const n = Math.max(1, Math.ceil(Math.hypot(V[k + 3] - V[k], V[k + 4] - V[k + 1], V[k + 5] - V[k + 2]) / STEP));
        for (let a = 0; a <= n; a++){ const t = a / n; put(V[k] + t * (V[k + 3] - V[k]), V[k + 1] + t * (V[k + 4] - V[k + 1]), V[k + 2] + t * (V[k + 5] - V[k + 2])); }
      }
    }
  }
  return { occ, voxels: voxels - despeckle(occ, S), clipped, detail: d, ...(cells ? { cells: seenCells } : {}) };
}
/* Drop the pieces (26-connected) under DUST of the largest, in place; the
   voxels dropped. A flood from each unseen voxel in index order, so the
   labels, and what goes, are a function of the occupancy alone. */
export const DUST = 0.01;
function despeckle(occ, S){
  const label = new Int32Array(occ.length), sizes = [0], stack = [];
  for (let s = 0; s < occ.length; s++){
    if (!occ[s] || label[s]) continue;
    const id = sizes.length;
    let n = 0;
    label[s] = id; stack.push(s);
    while (stack.length){
      const v = stack.pop(), x = v % S, y = (v / S | 0) % S, z = v / (S * S) | 0;
      n++;
      for (let dz = -1; dz <= 1; dz++){ const Z = z + dz; if (Z < 0 || Z >= S) continue;
        for (let dy = -1; dy <= 1; dy++){ const Y = y + dy; if (Y < 0 || Y >= S) continue;
          for (let dx = -1; dx <= 1; dx++){ const X = x + dx; if (X < 0 || X >= S) continue;
            const w = X + S * (Y + S * Z);
            if (occ[w] && !label[w]){ label[w] = id; stack.push(w); }
          } } }
    }
    sizes.push(n);
  }
  if (sizes.length <= 2) return 0;
  const keep = DUST * Math.max(...sizes);
  let dropped = 0;
  for (let v = 0; v < occ.length; v++) if (occ[v] && sizes[label[v]] < keep){ occ[v] = 0; dropped++; }
  return dropped;
}
/* The voxels a ball of radius rho covers round a half-voxel cell's centre,
   by the cell's parity on each axis (its centre sits a quarter or three
   quarters into its voxel): offsets from the voxel holding the cell. */
const BALLS = new Map();
function ballsOf(rho){
  if (BALLS.has(rho)) return BALLS.get(rho);
  const r = Math.ceil(rho) + 1, out = [];
  for (let p = 0; p < 8; p++){
    const f = [p & 1, p >> 1 & 1, p >> 2 & 1].map(b => b ? 0.75 : 0.25), list = [];
    for (let z = -r; z <= r; z++) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
      if ((x + 0.5 - f[0]) ** 2 + (y + 0.5 - f[1]) ** 2 + (z + 0.5 - f[2]) ** 2 <= rho * rho) list.push(x, y, z);
    out.push(Int8Array.from(list));
  }
  BALLS.set(rho, out);
  return out;
}

/* ---- the layout -------------------------------------------------------------------
   Row-major in (i, j), i along x. The deck is a Fisher–Yates shuffle by
   hash, one a round of S cells. */
function deckOf(S, key){
  const a = Array.from({ length: S }, (_, i) => i);
  for (let k = S - 1; k > 0; k--){ const r = hash32(key, k) % (k + 1), t = a[k]; a[k] = a[r]; a[r] = t; }
  return a;
}
/* The sizes an object is drawn at (asked for 2026-11-20: "size should follow
   shape"): its own range (math-shapes.js's `size`) within the world's, or,
   when they don't meet, the world's end nearer to it (a knot that wants 96 and
   more, in a world of 32 to 64, is 64). */
export function sizeRange(shape, rMin, rMax){
  const [a, b] = shape.size ?? [rMin, rMax], lo = Math.max(a, rMin), hi = Math.min(b, rMax);
  if (lo <= hi) return [lo, hi];
  return b < rMin ? [rMin, rMin] : [rMax, rMax];
}
export function mathLayout(desc){
  const { seed, D, pitch, rMin, rMax, margin } = desc, side = 2 ** D, n = Math.floor(side / pitch), S = MATH_SHAPES.length, cells = [];
  let deck = null;
  for (let c = 0; c < n * n; c++){
    if (c % S === 0) deck = deckOf(S, hash32(seed, 0x6d617468 + c / S));
    const i = c % n, j = (c - i) / n, h = hash32(hash32(i, seed * 0x9e3779b1), j * 977 + 13);
    const shape = deck[c % S], [lo, hi] = sizeRange(MATH_SHAPES[shape], rMin, rMax), R = lo + hash32(h, 1) % (hi - lo + 1), span = pitch - R - 2 * margin + 1;
    const yaw = MATH_SHAPES[shape].axial ? (YAW_STEPS / 4) * (hash32(h, 2) & 3) : hash32(h, 2) % YAW_STEPS;
    cells.push({ i, j, shape, R, yaw, x0: i * pitch + margin + hash32(h, 3) % span, z0: j * pitch + margin + hash32(h, 4) % span });
  }
  return { side, perAxis: n, cells };
}
// A cell's job, for placeRange: the cell's number and its layout.
export const cellJobs = (layout, cells) => cells.map(cell => ({ cell, ...layout.cells[cell] }));

/* ---- placing ---------------------------------------------------------------------
   Each job's object voxelized, rested on the ground (scatter-core's
   restingY: every occupied column clear of the ground's top voxel, at least
   one standing on it), cut into blocks of side B and interned in `store`.
   Returns the blocks and each placement's y0 and voxel count. */
export function placeRange(desc, jobs, store, ground = groundOf(desc)){
  const blocks = [], placed = [], side = 2 ** desc.D;
  for (const { cell, shape, R, yaw, x0, z0 } of jobs){
    const { occ, voxels } = voxelize(MATH_SHAPES[shape], R, yaw), y0 = restingY(occ, R, x0, z0, ground.top);
    if (y0 + R > side) throw new Error(`math: cell ${cell} rests above the world (y0 ${y0})`);
    for (const b of splitBlocks(store, occ, R, x0, y0, z0, desc.B)) blocks.push(b);
    placed.push({ cell, y0, voxels });
  }
  return { blocks, placed };
}
/* The placement table, one row of TABLE_WORDS a cell: shape, R, yaw, x0,
   y0, z0, voxels. It goes in the colour descriptor (mathColour). One part
   of the build into the world's store: its keys imported (null: placed in
   the world's store already), its blocks' ids mapped, its rows written. */
export function mergePart(store, layout, table, blocks, { keys, blocks: b, placed }){
  const map = keys ? store.importKeys(keys) : null;
  for (const x of b) blocks.push(map ? { ...x, node: map[x.node] } : x);
  for (const { cell, y0, voxels } of placed){
    const c = layout.cells[cell];
    table.set([c.shape, c.R, c.yaw, c.x0, y0, c.z0, voxels], TABLE_WORDS * cell);
  }
}
/* Cells dealt to `k` parts with about equal work: the biggest first, each
   to the part with the least so far (R³, what a solid's voxelizing costs). */
export function dealCells(layout, k){
  const order = layout.cells.map((c, i) => i).sort((a, b) => layout.cells[b].R - layout.cells[a].R || a - b);
  const load = new Array(k).fill(0), parts = Array.from({ length: k }, () => []);
  for (const i of order){ let m = 0; for (let p = 1; p < k; p++) if (load[p] < load[m]) m = p; parts[m].push(i); load[m] += layout.cells[i].R ** 3; }
  for (const p of parts) p.sort((a, b) => a - b);
  return parts;
}

/* ---- the whole build, on one thread ------------------------------------------------
   `parts` splits the placing into that many stores merged by importKeys, as
   the page's workers do. */
export function buildMath(desc, { parts = 1, onPhase = () => {} } = {}){
  const t = {}, mark = (k, t0) => { t[k] = (t[k] || 0) + performance.now() - t0; };
  const layout = mathLayout(desc), N = layout.cells.length, store = createStore(), ground = groundOf(desc);
  let t0 = performance.now();
  onPhase('ground');
  const { root: groundRoot } = store.fromField(desc.D, ground.field);
  mark('ground', t0);
  t0 = performance.now();
  onPhase('placing');
  const blocks = [], table = new Int32Array(TABLE_WORDS * N);
  for (const cells of dealCells(layout, parts)){
    const local = parts === 1 ? store : createStore(), part = placeRange(desc, cellJobs(layout, cells), local, ground);
    mergePart(store, layout, table, blocks, { ...part, keys: parts === 1 ? null : local.snapshot().keys });
  }
  mark('place', t0);
  t0 = performance.now();
  onPhase('grafting');
  const grafted = store.graft(groundRoot, desc.D, Math.log2(desc.B), blocks);
  mark('graft', t0);
  t0 = performance.now();
  const { store: world, root, dropped } = pruneWorld(store, grafted);
  mark('prune', t0);
  return { store: world, root, D: desc.D, table, layout, blocks: blocks.length, ms: t, nodes: world.size, dropped };
}

/* What the panel says: objects by family, and the sizes. */
export function mathInfo(layout){
  const byFamily = MATH_FAMILIES.map(() => 0), shapes = new Set();
  let rLo = Infinity, rHi = 0;
  for (const c of layout.cells){ byFamily[MATH_SHAPES[c.shape].family]++; shapes.add(c.shape); rLo = Math.min(rLo, c.R); rHi = Math.max(rHi, c.R); }
  return { objects: layout.cells.length, shapes: shapes.size, byFamily, rLo, rHi };
}
// The ground's datum for a universe: the scatter's rule on the same ground.
export const mathGround = desc => scatterGround(desc);

/* ---- colour ---------------------------------------------------------------------- */
export const GAMUT_LIFT = 40, GAMUT_SPAN = 215;     // the kit's (kit-core.js)
export function mathColour(desc, rgb8){
  const ground = SHAPES.find(s => s.name === desc.ground), groundColour = colourFieldOf(ground, desc.D);
  const { table, pitch } = desc, k = desc.repeat, side = 2 ** desc.D, perAxis = Math.floor(side / pitch), s = 2 / side, N = perAxis * perAxis;
  const COS = new Float64Array(N), SIN = new Float64Array(N);
  for (let c = 0; c < N; c++) [COS[c], SIN[c]] = yawOf(table[TABLE_WORDS * c + 2]);
  const g = v => { const t = k * (v < 0 ? 0 : v >= 1 ? 0.9999999 : v); return GAMUT_LIFT + GAMUT_SPAN * (t - Math.floor(t)); };
  return (x, y, z) => {
    const i = Math.floor(x / pitch), j = Math.floor(z / pitch);
    if (i >= 0 && j >= 0 && i < perAxis && j < perAxis){
      const cell = j * perAxis + i, o = TABLE_WORDS * cell, R = table[o + 1], x0 = table[o + 3], y0 = table[o + 4], z0 = table[o + 5];
      if (x >= x0 && x < x0 + R && y >= y0 && y < y0 + R && z >= z0 && z < z0 + R && !ground.inside(x * s - 1, y * s - 1, z * s - 1)){
        const bx = 2 * (x - x0) / R - 1, by = 2 * (y - y0) / R - 1, bz = 2 * (z - z0) / R - 1, c = COS[cell], sn = SIN[cell];
        return rgb8(g((c * bx - sn * bz + 1) / 2), g((by + 1) / 2), g((sn * bx + c * bz + 1) / 2));
      }
    }
    return groundColour(x, y, z);
  };
}
