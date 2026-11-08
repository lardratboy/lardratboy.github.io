/* A sketch for docs/dagconvolutions.md: can a DAG hold a distance field, and does
   hash-consing survive a convolution? Not an engine change: nothing here is wired to
   the viewer, and no core file is touched.

   The idea it tests. A finite kernel of radius T makes a cell's output a function of
   what's within T of it. So a level-k output node (2^k ≥ T) is a function of the 27
   input nodes around it, whatever their place in the world: memoize on those ids and
   every repeat in the input is a repeat in the output. Hashlife (Gosper 1984) did
   this for time steps on a hash-consed quadtree.

   A signed distance is an infinite kernel, so its output never repeats. A *truncated*
   one is finite: past ±T it saturates, far air becomes EMPTY (and stays sparse) and
   deep rock becomes one solid value. A pyramid of them, ±T cells at every lod, covers
   all distances at a precision that coarsens with distance. That's "a convolution
   over all the lods".

   A band is stored in an ordinary createStore: level 1's children are values rather
   than ids (the key holds the level, so they can't be confused), and 0 means far air,
   so an all-far node interns to EMPTY. Values are exact squared distances, voxel
   centre to voxel centre: 1..T² in air, T² + 1..2T² in rock, 2T² + 1 deep rock.

   Sections:
     a. the oracle: everything below against a dense distance transform, itself
        checked against brute force.
     b. bands: how much sharing survives, by world and T.
     c. pyramids: all the lods, and how good a lower bound they give.
     d. rays: what shooting K rays says about the distance, against the truth.
     e. uses: dilation and erosion as new DAGs; sphere tracing against the walk.
     f. edits: the memo makes a band incremental for free.
     g. fields per node: d(x, A ∪ B) = min(d(x, A), d(x, B)), so a node's own field,
        reaching T past its box, is a function of the node alone, and a query is a
        min over the neighbours within T. The sharing survives whole; the query pays.

   node experiments/dagconv-sketch.mjs                everything (~35 min)
   node experiments/dagconv-sketch.mjs --only=ab      only those sections
   node experiments/dagconv-sketch.mjs --big          also hills and caves at D = 12, kit 14
   node experiments/dagconv-sketch.mjs --worlds=caves,clay   bands and pyramids of those
   It measures job times, so run it on an idle machine. */
import { createStore, createCounts, EMPTY, FULL, FIRST_NODE } from '../dag-core.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { kitDesc, buildKit } from '../kit-core.js';
import { caveDesc, buildCaves } from '../cave-core.js';
import { clayDesc, buildClay } from '../clay-core.js';
import { place, pick } from '../edit-core.js';

const arg = (name, d) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const only = arg('only', 'abcdefg'), BIG = process.argv.includes('--big');
const fmt = (x, d = 2) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d }) : '-';
const say = s => console.log(s);
const row = cells => say('| ' + cells.join(' | ') + ' |');
const head = cells => { row(cells); row(cells.map(() => '---')); };
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const rng = seed => () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32; };
const SQRT3 = Math.sqrt(3);

const shapeWorld = (name, D) => { const store = createStore(), { root } = store.fromField(D, fieldOf(SHAPES.find(s => s.name === name), D)); return { name: `${name} D=${D}`, store, root, D }; };
const kitWorld = D => { const k = buildKit(kitDesc({ D })); return { name: `kit D=${D}`, store: k.store, root: k.root, D }; };
const caveWorld = (D, G) => { const c = buildCaves(caveDesc(G ? { D, G } : { D })); return { name: `caves D=${D}`, store: c.store, root: c.root, D }; };
const clayWorld = () => { const c = buildClay(clayDesc()); return { name: 'clay D=20', store: c.store, root: c.root, D: 20 }; };
const sizeOf = s => s.snapshot().keys.length / 9;

/* ---- the distance transform (Felzenszwalb & Huttenlocher): a min-convolution with
   a parabola, one axis at a time. Squared distances, so exact integers. ---------- */
const INF = 1e9;
function dt1d(f, off, stride, n, v, z, g){
  let k = 0, m = 0;
  for (let q = 0; q < n; q++){ g[q] = f[off + q * stride]; }
  let any = false;
  for (let q = 0; q < n; q++) if (g[q] < INF){ any = true; break; }
  if (!any) return;
  while (g[m] >= INF) m++;
  v[0] = m; z[0] = -Infinity; z[1] = Infinity;
  for (let q = m + 1; q < n; q++){
    if (g[q] >= INF) continue;
    let s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * (q - v[k]));
    while (s <= z[k]){ k--; s = ((g[q] + q * q) - (g[v[k]] + v[k] * v[k])) / (2 * (q - v[k])); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++){
    while (z[k + 1] < q) k++;
    const r = q - v[k];
    f[off + q * stride] = r * r + g[v[k]];
  }
}
function dt3d(f, W){
  const v = new Int32Array(W), z = new Float64Array(W + 1), g = new Float64Array(W), WW = W * W;
  for (let c = 0; c < WW; c++) dt1d(f, c * W, 1, W, v, z, g);                                  // x
  for (let b = 0; b < W; b++) for (let a = 0; a < W; a++) dt1d(f, a + b * WW, W, W, v, z, g);  // y
  for (let b = 0; b < W; b++) for (let a = 0; a < W; a++) dt1d(f, a + b * W, WW, W, v, z, g);  // z
}

/* ---- a band: truncated signed distance as a DAG, memoized on 27 ids ------------- */
const L = 4, N = 16;
function createBand(src, D, T, { quant = false, out = createStore(), memo = new Map() } = {}){
  const W = N + 2 * T, TT = T * T, DEEP = 2 * TT + 1;
  const occ = new Uint8Array(W ** 3), air = new Float64Array(W ** 3), rock = new Float64Array(W ** 3), vals = new Uint16Array(N ** 3);
  const stats = { calls: 0, misses: 0, leaves: 0, leafMs: 0 };
  const tuples = Array.from({ length: D + 2 }, () => new Uint32Array(27));
  const kids = Array.from({ length: D + 2 }, () => new Uint32Array(8));
  const deep = [DEEP];
  const deepOf = k => { while (deep.length <= k) deep.push(out.intern(deep.length, new Uint32Array(8).fill(deep[deep.length - 1]))); return deep[k]; };
  const code = quant
    ? { air: d2 => d2 > TT ? 0 : Math.round(Math.sqrt(d2)), rock: d2 => d2 > TT ? 2 * T + 1 : T + Math.round(Math.sqrt(d2)) }
    : { air: d2 => d2 > TT ? 0 : d2, rock: d2 => d2 > TT ? DEEP : TT + d2 };
  const DEEPV = quant ? 2 * T + 1 : DEEP;
  if (quant) deep[0] = DEEPV;

  const fill = (id, k, x, y, z) => {
    if (id === EMPTY) return;
    const s = 2 ** k;
    if (x >= W || y >= W || z >= W || x + s <= 0 || y + s <= 0 || z + s <= 0) return;
    if (k === 0){ occ[x + W * (y + W * z)] = 1; return; }
    const h = s / 2;
    for (let o = 0; o < 8; o++) fill(src.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
  };
  const pack = (k, x, y, z) => {
    if (k === 0) return vals[x + N * (y + N * z)];
    const h = 1 << (k - 1), c = kids[k];
    for (let o = 0; o < 8; o++) c[o] = pack(k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
    return out.intern(k, c);
  };
  function leaf(t){
    const t0 = performance.now();
    occ.fill(0);
    for (let z = 0, i = 0; z < 3; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++, i++)
      fill(t[i], L, T + (x - 1) * N, T + (y - 1) * N, T + (z - 1) * N);
    for (let i = 0; i < occ.length; i++){ air[i] = occ[i] ? 0 : INF; rock[i] = occ[i] ? INF : 0; }
    dt3d(air, W); dt3d(rock, W);
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
      const g = (x + T) + W * ((y + T) + W * (z + T));
      vals[x + N * (y + N * z)] = occ[g] ? code.rock(rock[g]) : code.air(air[g]);
    }
    const id = pack(L, 0, 0, 0);
    stats.leaves++; stats.leafMs += performance.now() - t0;
    return id;
  }
  function go(k, t){
    stats.calls++;
    const first = t[0];
    let same = true, nonEmpty = false;
    for (let i = 0; i < 27; i++){ if (t[i] !== first) same = false; if (t[i] !== EMPTY) nonEmpty = true; }
    if (!nonEmpty) return EMPTY;
    if (same && first === src.solid(k)) return deepOf(k);
    const key = k + ':' + t.join(',');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    stats.misses++;
    let id;
    if (k === L) id = leaf(t);
    else {
      const c = new Uint32Array(8), next = tuples[k - 1];
      for (let o = 0; o < 8; o++){
        const ox = o & 1, oy = o >> 1 & 1, oz = o >> 2;
        for (let z = 0, i = 0; z < 3; z++) for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++, i++){
          const cx = 2 + ox + (x - 1), cy = 2 + oy + (y - 1), cz = 2 + oz + (z - 1);
          const p = t[(cx >> 1) + 3 * (cy >> 1) + 9 * (cz >> 1)];
          next[i] = p === EMPTY ? EMPTY : src.child(p, (cx & 1) | (cy & 1) << 1 | (cz & 1) << 2);
        }
        c[o] = go(k - 1, next);
      }
      id = out.intern(k, c);
    }
    memo.set(key, id);
    return id;
  }
  const rootOf = root => {
    if (D < L) throw new Error('band: world shallower than a leaf');
    const t = tuples[D]; t.fill(EMPTY); t[13] = root;
    return go(D, t);
  };
  return { out, rootOf, stats, memo, T, D, DEEPV, code, deepOf };
}
/* A band's value at a voxel: 0 far air, 1..T² air, T² + 1..2T² rock, 2T² + 1 deep. */
let READS = 0;
function valueAt(out, root, D, x, y, z){
  let id = root;
  for (let k = D - 1; k >= 0; k--){
    if (id === EMPTY) return 0;
    READS++;
    id = out.child(id, (x >> k & 1) | (y >> k & 1) << 1 | (z >> k & 1) << 2);
  }
  return id;
}
/* A band's own census: places (with repeats) against distinct outputs at level 4,
   leaving out far air and deep rock. */
function census(band, root){
  const deep = band.deepOf(L), { keys } = band.out.snapshot(), n = keys.length / 9, mult = new Float64Array(n + FIRST_NODE);
  if (root >= FIRST_NODE) mult[root] = 1;
  let places = 0, distinct = 0;
  for (let id = n + FIRST_NODE - 1; id >= FIRST_NODE; id--){
    const m = mult[id];
    if (!m) continue;
    const p = (id - FIRST_NODE) * 9, k = keys[p];
    if (k > L){ for (let o = 1; o <= 8; o++) if (keys[p + o] >= FIRST_NODE) mult[keys[p + o]] += m; }
    else if (k === L && id !== deep){ places += m; distinct++; }
  }
  return { places, distinct };
}

/* ---- a pyramid: the same band at every lod ------------------------------------- */
/* The world at lod + 1: a cell is solid if anything's in it (the 'any' rule), so
   solids only grow, and a coarse distance is a bound both ways (see `bounds`). */
function coarsen(src, root, D){
  const out = createStore(), memo = new Map();
  const go = (id, k) => {
    if (id === EMPTY) return EMPTY;
    if (k === 1) return FULL;
    let r = memo.get(id);
    if (r !== undefined) return r;
    const c = new Uint32Array(8);
    for (let o = 0; o < 8; o++) c[o] = go(src.child(id, o), k - 1);
    r = out.intern(k - 1, c);
    memo.set(id, r);
    return r;
  };
  return { store: out, root: go(root, D), D: D - 1 };
}
function createPyramid(w, T){
  const levels = [];
  let s = w.store, r = w.root, d = w.D;
  const t0 = performance.now();
  for (let l = 0; d >= L; l++){
    const band = createBand(s, d, T), root = band.rootOf(r);
    levels.push({ l, band, root, D: d, nodes: sizeOf(band.out) });
    if (d === L) break;
    const c = coarsen(s, r, d);
    s = c.store; r = c.root; d = c.D;
  }
  return { levels, T, ms: performance.now() - t0, nodes: levels.reduce((a, b) => a + b.nodes, 0) };
}
/* Bounds on the true voxel-centre distance from an air voxel to the nearest rock.
   A lod-l distance d is between cell centres, and a voxel centre is within
   √3(2^l − 1)/2 of its cell's, at both ends, so true ∈ d·2^l ± √3(2^l − 1). A far cell
   says d > T, so it's a lower bound of its own. Fine to coarse, stopping at the first
   lod that sees anything. */
function bounds(P, x, y, z){
  const T = P.T, TT = T * T;
  let lo = 0;
  for (const { l, band, root, D } of P.levels){
    const v = valueAt(band.out, root, D, x >> l, y >> l, z >> l), pad = SQRT3 * (2 ** l - 1), s = 2 ** l;
    if (v === 0){ lo = Math.max(lo, T * s - pad); continue; }
    const d = v > TT ? 0 : Math.sqrt(v);
    return { lo: Math.max(lo, d * s - pad), hi: d * s + pad, l };
  }
  return { lo, hi: Infinity, l: P.levels.length };
}
/* What the walk knows today: the largest aligned empty node around a voxel, and the
   distance from the voxel's centre to the first voxel centre outside it. */
function alignedLower(store, root, D, x, y, z){
  let id = root;
  for (let k = D; k >= 1; k--){
    if (id === EMPTY){
      const s = 2 ** k, ox = x % s, oy = y % s, oz = z % s;
      return Math.min(ox, s - 1 - ox, oy, s - 1 - oy, oz, s - 1 - oz) + 1;
    }
    id = store.child(id, (x >> (k - 1) & 1) | (y >> (k - 1) & 1) << 1 | (z >> (k - 1) & 1) << 2);
  }
  return id === EMPTY ? 1 : 0;
}

/* ---- a dense truth, world padded with air so rock at the edge is right ---------- */
function denseTruth(w, pad){
  const R = 2 ** w.D, P = R + 2 * pad, occ = w.store.expand(w.root, w.D);
  const air = new Float64Array(P ** 3).fill(INF), rock = new Float64Array(P ** 3).fill(0);
  for (let z = 0, i = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++, i++)
    if (occ[i]){ const g = (x + pad) + P * ((y + pad) + P * (z + pad)); air[g] = 0; rock[g] = INF; }
  dt3d(air, P); dt3d(rock, P);
  return { occ, R, at: (x, y, z) => { const g = (x + pad) + P * ((y + pad) + P * (z + pad)); return occ[x + R * (y + R * z)] ? rock[g] : air[g]; } };
}
const airPoints = (w, n, seed = 4242) => {
  const r = rng(seed), R = 2 ** w.D, out = [];
  for (let tries = 0; out.length < 3 * n && tries < 400 * n; tries++){
    const x = Math.floor(r() * R), y = Math.floor(r() * R), z = Math.floor(r() * R);
    if (!w.store.query(w.root, w.D, x, y, z)) out.push(x, y, z);
  }
  return out;
};
function solidPoint(store, root, D, r){
  let id = root, x = 0, y = 0, z = 0;
  const opts = [];
  for (let k = D - 1; k >= 0; k--){
    opts.length = 0;
    for (let o = 0; o < 8; o++) if (store.child(id, o) !== EMPTY) opts.push(o);
    const o = opts[Math.floor(r() * opts.length)];
    id = store.child(id, o); x = 2 * x + (o & 1); y = 2 * y + (o >> 1 & 1); z = 2 * z + (o >> 2);
  }
  return [x, y, z];
}

/* A new DAG from a band: voxels past a threshold. Dilate by r: rock, or air with
   d² ≤ r². Erode by r: rock with d² > r². A function of the band's node, so one
   memoized sweep, and the output is an ordinary world. */
function threshold(band, root, D, keep){
  const out = createStore(), memo = new Map();
  const go = (id, k) => {
    if (k === 0) return keep(id) ? FULL : EMPTY;
    if (id === EMPTY && k > 0){ if (keep(0)) return out.solid(k); return EMPTY; }
    const key = id * 64 + k;
    let r = memo.get(key);
    if (r !== undefined) return r;
    const c = new Uint32Array(8);
    for (let o = 0; o < 8; o++) c[o] = go(band.out.child(id, o), k - 1);
    r = out.intern(k, c);
    memo.set(key, r);
    return r;
  };
  return { store: out, root: go(root, D), D };
}

/* ---- fields per node: the sharing kept, the min paid at query time ---------------
   For any partition into boxes, the distance to a set is the min of the distances to
   its pieces, so each 16³ node needs two fields of its own over (16 + 2T)³: the
   distance to its own rock and to its own air. Bytes, squared, 255 past T. EMPTY and a
   solid are nodes like any other. The world's outside is air, from a virtual EMPTY. */
function createFields(src, D, T){
  const W = N + 2 * T, TT = T * T, fields = new Map(), occ = new Uint8Array(W ** 3), f = new Float64Array(W ** 3);
  const stats = { floods: 0, ms: 0 };
  const fill = (id, k, x, y, z) => {
    if (id === EMPTY) return;
    if (k === 0){ occ[x + W * (y + W * z)] = 1; return; }
    const h = 1 << (k - 1);
    for (let o = 0; o < 8; o++) fill(src.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
  };
  const ofNode = id => {
    let g = fields.get(id);
    if (g) return g;
    const t0 = performance.now();
    occ.fill(0); fill(id, L, T, T, T);
    const rock = new Uint8Array(W ** 3), air = new Uint8Array(W ** 3);
    for (const [to, wantRock] of [[rock, true], [air, false]]){
      f.fill(INF);
      for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
        const i = (x + T) + W * ((y + T) + W * (z + T));
        if (!!occ[i] === wantRock) f[i] = 0;
      }
      dt3d(f, W);
      for (let i = 0; i < f.length; i++) to[i] = f[i] > TT ? 255 : f[i];
    }
    g = { rock, air };
    fields.set(id, g);
    stats.floods++; stats.ms += performance.now() - t0;
    return g;
  };
  return { ofNode, fields, stats, W, T, TT, src, D };
}
function nodeAt16(F, root, X, Y, Z){
  const S = 2 ** (F.D - L);
  if (X < 0 || Y < 0 || Z < 0 || X >= S || Y >= S || Z >= S) return EMPTY;
  let id = root;
  for (let k = F.D - L - 1; k >= 0 && id !== EMPTY; k--) id = F.src.child(id, (X >> k & 1) | (Y >> k & 1) << 1 | (Z >> k & 1) << 2);
  return id;
}
/* The squared distance to the other side, truncated: from air to rock, or rock to air.
   Only neighbours whose box lies within T of the voxel can matter: 1 to 8 of them. */
let LOOKUPS = 0;
function fieldAt(F, root, x, y, z){
  const X = x >> L, Y = y >> L, Z = z >> L, lx = x & 15, ly = y & 15, lz = z & 15, T = F.T, W = F.W;
  const solid = F.src.query(root, F.D, x, y, z);
  const ax0 = lx < T ? -1 : 0, ax1 = lx >= N - T ? 1 : 0, ay0 = ly < T ? -1 : 0, ay1 = ly >= N - T ? 1 : 0, az0 = lz < T ? -1 : 0, az1 = lz >= N - T ? 1 : 0;
  let best = 255;
  for (let dz = az0; dz <= az1; dz++) for (let dy = ay0; dy <= ay1; dy++) for (let dx = ax0; dx <= ax1; dx++){
    const g = F.ofNode(nodeAt16(F, root, X + dx, Y + dy, Z + dz)), i = (lx - dx * N + T) + W * ((ly - dy * N + T) + W * (lz - dz * N + T));
    LOOKUPS++;
    const v = solid ? g.air[i] : g.rock[i];
    if (v < best) best = v;
  }
  return { solid, d2: best };
}
/* Every distinct 16³ node a world uses. */
function nodesAt16(store, root, D){
  const seen = new Set(), out = new Set();
  const go = (id, k) => {
    if (id === EMPTY){ out.add(EMPTY); return; }
    if (k === L){ out.add(id); return; }
    if (seen.has(id)) return;
    seen.add(id);
    for (let o = 0; o < 8; o++) go(store.child(id, o), k - 1);
  };
  go(root, D);
  out.add(EMPTY);
  return out;
}

/* ---- a: the oracle -------------------------------------------------------------- */
if (only.includes('a')){
  say('\n## a. The oracle\n');
  // The transform itself, against brute force over every pair.
  { const r = rng(5), W = 28, occ = new Uint8Array(W ** 3).map(() => r() < 0.03 ? 1 : 0), f = new Float64Array(W ** 3);
    for (let i = 0; i < f.length; i++) f[i] = occ[i] ? 0 : INF;
    dt3d(f, W);
    const solids = [];
    for (let z = 0, i = 0; z < W; z++) for (let y = 0; y < W; y++) for (let x = 0; x < W; x++, i++) if (occ[i]) solids.push([x, y, z]);
    for (let z = 0, i = 0; z < W; z++) for (let y = 0; y < W; y++) for (let x = 0; x < W; x++, i++){
      let best = INF; for (const [a, b, c] of solids) best = Math.min(best, (a - x) ** 2 + (b - y) ** 2 + (c - z) ** 2);
      if (best !== f[i]) throw new Error(`dt3d wrong at ${x},${y},${z}: ${f[i]} vs brute ${best}`);
    }
    say('- the distance transform equals brute force over every pair, 28³'); }
  for (const w of [shapeWorld('hills', 8), shapeWorld('gyroid', 8), kitWorld(8), caveWorld(8, 48)]){
    const truth = denseTruth(w, 17), R = truth.R;
    for (const T of [1, 4, 8]){
      const band = createBand(w.store, w.D, T), root = band.rootOf(w.root), TT = T * T, DEEP = 2 * TT + 1;
      for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
        const d2 = truth.at(x, y, z), solid = truth.occ[x + R * (y + R * z)];
        const want = solid ? (d2 > TT ? DEEP : TT + d2) : (d2 > TT ? 0 : d2), got = valueAt(band.out, root, w.D, x, y, z);
        if (got !== want) throw new Error(`band T=${T} on ${w.name} at ${x},${y},${z}: ${got}, dense says ${want}`);
      }
    }
    // Pyramid bounds, on every air voxel: the true distance lies inside them.
    const P = createPyramid(w, 4);
    let n = 0;
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
      if (truth.occ[x + R * (y + R * z)]) continue;
      const d = Math.sqrt(truth.at(x, y, z)), b = bounds(P, x, y, z);
      if (d < b.lo - 1e-9 || d > b.hi + 1e-9) throw new Error(`pyramid on ${w.name} at ${x},${y},${z}: ${d} outside ${b.lo}..${b.hi}`);
      const al = alignedLower(w.store, w.root, w.D, x, y, z);
      if (d < al - 1e-9) throw new Error(`aligned on ${w.name} at ${x},${y},${z}: ${d} < ${al}`);
      n++;
    }
    // Dilate and erode against the dense truth.
    const band = createBand(w.store, w.D, 4), root = band.rootOf(w.root);
    for (const r of [1, 2, 4]){
      const rr = r * r, dil = threshold(band, root, w.D, v => v > 16 || (v > 0 && v <= rr)), ero = threshold(band, root, w.D, v => v > 16 + rr);
      for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
        const solid = truth.occ[x + R * (y + R * z)], d2 = truth.at(x, y, z);
        if (dil.store.query(dil.root, dil.D, x, y, z) !== ((solid || d2 <= rr) ? 1 : 0)) throw new Error(`dilate ${r} on ${w.name}`);
        if (ero.store.query(ero.root, ero.D, x, y, z) !== ((solid && d2 > rr) ? 1 : 0)) throw new Error(`erode ${r} on ${w.name}`);
      }
    }
    // Fields per node, both signs, at every voxel: the min over neighbours is the truth.
    for (const T of [1, 4, 8]){
      const F = createFields(w.store, w.D, T), TT = T * T;
      for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
        const d2 = truth.at(x, y, z), got = fieldAt(F, w.root, x, y, z);
        if (got.d2 !== (d2 > TT ? 255 : d2)) throw new Error(`fields T=${T} on ${w.name} at ${x},${y},${z}: ${got.d2}, dense ${d2}`);
      }
    }
    say(`- ${w.name}: bands T = 1, 4, 8 and per-node fields T = 1, 4, 8 equal dense at all ${fmt(R ** 3, 0)} voxels; pyramid and aligned bounds hold on ${fmt(n, 0)} air voxels; dilate and erode r = 1, 2, 4 equal dense`);
  }
}

/* ---- b: bands ------------------------------------------------------------------- */
/* The kit past D = 12 is for --big: its neighbourhoods are far more varied than its
   parts (247,463 different inputs at D = 12), about 0.7 ms each at T = 4. --worlds=
   picks by name. */
const pickWorlds = arg('worlds', '').split(',').filter(Boolean);
const WORLDS = () => [['hills', () => shapeWorld('hills', 10)], ['gyroid', () => shapeWorld('gyroid', 10)], ['kit', () => kitWorld(10)], ['kit', () => kitWorld(12)], ['caves', () => caveWorld(10)], ['clay', clayWorld]]
  .concat(BIG ? [['hills12', () => shapeWorld('hills', 12)], ['caves12', () => caveWorld(12)], ['kit14', () => kitWorld(14)]] : [])
  .filter(([n]) => !pickWorlds.length || pickWorlds.includes(n)).map(([, make]) => make);
if (only.includes('b')){
  say('\n## b. Bands: one lod, exact squared distances (and T = 4 rounded to whole cells)\n');
  head(['world', 'occupancy nodes', 'T', 'values', '16³ places in the band', 'different inputs (27 ids)', 'different outputs', 'build ms', 'band nodes', '× occupancy', 'band MB', 'dense bytes MB']);
  for (const make of WORLDS()){
    const w = make(), n0 = sizeOf(w.store), big = w.name === 'hills D=12' || w.name === 'caves D=12' || w.name === 'kit D=14';
    for (const [T, quant] of big ? [[4, false]] : [[1, false], [2, false], [4, false], [8, false], [4, true]]){
      const band = createBand(w.store, w.D, T, { quant }), t0 = performance.now(), root = band.rootOf(w.root), ms = performance.now() - t0;
      const n = sizeOf(band.out), c = census(band, root);
      row([w.name, fmt(n0, 0), T + (quant ? ' rounded' : ''), quant ? 2 * T + 2 : 2 * T * T + 2, fmt(c.places, 0), fmt(band.stats.leaves, 0), fmt(c.distinct, 0), fmt(ms, 0), fmt(n, 0), fmt(n / n0, 1), fmt(n * 36 / 2 ** 20, 1), fmt(8 ** w.D / 2 ** 20, 0)]);
    }
  }
}

/* ---- c: pyramids ---------------------------------------------------------------- */
if (only.includes('c')){
  say('\n## c. Pyramids: ±T cells at every lod\n');
  head(['world', 'T', 'lods', 'build ms', 'nodes, all lods', '× occupancy', 'MB', 'lod 0 share']);
  for (const make of WORLDS()){
    const w = make();
    if (w.D > 12 || (w.D === 12 && !w.name.startsWith('kit'))) continue;
    for (const T of w.D === 12 ? [4] : [4, 8]){
      const P = createPyramid(w, T), n0 = sizeOf(w.store);
      row([w.name, T, P.levels.length, fmt(P.ms, 0), fmt(P.nodes, 0), fmt(P.nodes / n0, 1), fmt(P.nodes * 36 / 2 ** 20, 1), fmt(100 * P.levels[0].nodes / P.nodes, 0) + '%']);
    }
  }
  say('\nHow good a lower bound, from random air voxels at D = 8, in voxels (a safe step):\n');
  head(['world', 'true distance, mean', 'aligned empty node', 'pyramid T = 4', 'pyramid T = 8', 'ns: aligned', 'ns: T = 4']);
  for (const w of [shapeWorld('hills', 8), shapeWorld('gyroid', 8), kitWorld(8), caveWorld(8, 48)]){
    const truth = denseTruth(w, 17), pts = airPoints(w, 200000), n = pts.length / 3, P4 = createPyramid(w, 4), P8 = createPyramid(w, 8);
    let t = 0, a = 0, p4 = 0, p8 = 0;
    for (let i = 0; i < n; i++){
      const x = pts[3 * i], y = pts[3 * i + 1], z = pts[3 * i + 2];
      t += Math.sqrt(truth.at(x, y, z)); a += alignedLower(w.store, w.root, w.D, x, y, z);
      p4 += bounds(P4, x, y, z).lo; p8 += bounds(P8, x, y, z).lo;
    }
    let t0 = performance.now(), s = 0;
    for (let i = 0; i < n; i++) s += alignedLower(w.store, w.root, w.D, pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
    const aNs = (performance.now() - t0) / n * 1e6;
    t0 = performance.now();
    for (let i = 0; i < n; i++) s += bounds(P4, pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]).lo;
    const pNs = (performance.now() - t0) / n * 1e6;
    row([w.name, fmt(t / n, 1), fmt(a / n, 1), fmt(p4 / n, 1), fmt(p8 / n, 1), fmt(aNs, 0), fmt(pNs, 0)]);
  }
}

/* ---- d: rays -------------------------------------------------------------------- */
if (only.includes('d')){
  say('\n## d. Rays: K rays from a voxel, the nearest voxel any of them hits, against the truth (D = 8)\n');
  /* A Fibonacci sphere, the 6 axes, or the 26 grid directions. Each hit is a real rock
     voxel, so the estimate can only be too far, never too near. */
  const dirs = K => {
    if (K === 6) return [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    if (K === 26){ const o = []; for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z){ const l = Math.hypot(x, y, z); o.push([x / l, y / l, z / l]); } return o; }
    const o = [], g = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < K; i++){ const y = 1 - 2 * (i + 0.5) / K, r = Math.sqrt(1 - y * y), a = g * i; o.push([Math.cos(a) * r, y, Math.sin(a) * r]); }
    return o;
  };
  head(['world', 'K rays', 'mean true', 'mean estimate', 'too far, mean', 'within 1 voxel', 'off by > 2×', 'µs a query']);
  for (const w of [shapeWorld('hills', 8), shapeWorld('gyroid', 8), kitWorld(8), caveWorld(8, 48)]){
    const truth = denseTruth(w, 17), pts = airPoints(w, 2000);
    for (const K of [6, 26, 64, 256, 1024]){
      const D_ = dirs(K);
      let sumT = 0, sumE = 0, near = 0, far2 = 0, n = 0;
      const t0 = performance.now();
      for (let i = 0; i < pts.length / 3; i++){
        const x = pts[3 * i], y = pts[3 * i + 1], z = pts[3 * i + 2], o = [x + 0.5, y + 0.5, z + 0.5];
        let best = Infinity;
        for (const d of D_){
          const h = pick(w.store, w.root, w.D, o, d);
          if (h){ const e = Math.hypot(h.x - x, h.y - y, h.z - z); if (e < best) best = e; }
        }
        const tr = Math.sqrt(truth.at(x, y, z));
        if (tr >= INF / 2) continue;     // no rock anywhere
        if (best === Infinity) { far2++; n++; sumT += tr; continue; }
        if (best + 1e-9 < tr) throw new Error(`rays nearer than the truth on ${w.name}`);
        sumT += tr; sumE += best; n++;
        if (best - tr <= 1) near++;
        if (best > 2 * tr) far2++;
      }
      const us = (performance.now() - t0) / (pts.length / 3) * 1000;
      row([w.name, K, fmt(sumT / n, 1), fmt(sumE / n, 1), fmt(100 * (sumE / sumT - 1), 0) + '%', fmt(100 * near / n, 0) + '%', fmt(100 * far2 / n, 0) + '%', fmt(us, 0)]);
    }
  }
}

/* ---- e: uses -------------------------------------------------------------------- */
if (only.includes('e')){
  say('\n## e. Dilation and erosion: new worlds, from a band\n');
  head(['world', 'nodes', 'voxels', 'dilate 1: nodes / voxels', 'dilate 4: nodes / voxels', 'erode 1: nodes / voxels', 'ms, dilate 4 from a built band']);
  for (const make of [() => shapeWorld('hills', 10), () => kitWorld(10), () => kitWorld(12), () => caveWorld(10)]){
    const w = make(), band = createBand(w.store, w.D, 4), root = band.rootOf(w.root);
    const stat = keep => { const t0 = performance.now(), o = threshold(band, root, w.D, keep), ms = performance.now() - t0, c = createCounts(o.store); return { n: sizeOf(o.store), v: c.of(o.root), ms }; };
    const d1 = stat(v => v > 16 || (v > 0 && v <= 1)), d4 = stat(v => v > 0), e1 = stat(v => v > 17);
    row([w.name, fmt(sizeOf(w.store), 0), fmt(createCounts(w.store).of(w.root), 0), `${fmt(d1.n, 0)} / ${fmt(d1.v, 0)}`, `${fmt(d4.n, 0)} / ${fmt(d4.v, 0)}`, `${fmt(e1.n, 0)} / ${fmt(e1.v, 0)}`, fmt(d4.ms, 1)]);
  }
  say('\n## e. Sphere tracing the pyramid against the walk (rays from near surfaces, D = 10)\n');
  /* Same first voxel or it throws. A safe step from a point: the nearest rock's cube is
     at least lo − √3 away (half a diagonal at each end), and when that's nothing it
     steps to the next voxel exactly. Reads are `child` calls on either side. */
  head(['world', 'rays', 'walk: reads a ray', 'trace T = 4: steps', 'reads', 'trace T = 8: steps', 'reads', 'µs: walk', 'µs: T = 4', 'µs: T = 8']);
  for (const w of [shapeWorld('hills', 10), shapeWorld('gyroid', 10), kitWorld(10), caveWorld(10)]){
    const r = rng(77), R = 2 ** w.D, rays = [], M = 4000;
    while (rays.length < M){
      const s = solidPoint(w.store, w.root, w.D, r), o = [s[0] + 0.5 + (r() - 0.5) * 48, s[1] + 0.5 + (r() - 0.5) * 48, s[2] + 0.5 + (r() - 0.5) * 48];
      if (o.some(v => v < 1 || v > R - 1) || w.store.query(w.root, w.D, Math.floor(o[0]), Math.floor(o[1]), Math.floor(o[2]))) continue;
      const a = r() * 2 * Math.PI, y = 2 * r() - 1, q = Math.sqrt(1 - y * y);
      rays.push({ o, d: [q * Math.cos(a), y, q * Math.sin(a)] });
    }
    let walkReads = 0;
    const counted = { child: (id, c) => { walkReads++; return w.store.child(id, c); } };
    let t0 = performance.now();
    const hits = rays.map(ray => pick(w.store, w.root, w.D, ray.o, ray.d));
    const walkUs = (performance.now() - t0) / M * 1000;
    for (const ray of rays) pick(counted, w.root, w.D, ray.o, ray.d);
    const results = [];
    for (const T of [4, 8]){
      const P = createPyramid(w, T), l0 = P.levels[0], TT = T * T;
      const trace = ray => {
        let t = 0, steps = 0;
        for (;;){
          const px = ray.o[0] + t * ray.d[0], py = ray.o[1] + t * ray.d[1], pz = ray.o[2] + t * ray.d[2];
          if (px < 0 || py < 0 || pz < 0 || px >= R || py >= R || pz >= R) return { hit: null, steps };
          const x = Math.floor(px), y = Math.floor(py), z = Math.floor(pz);
          steps++;
          const v = valueAt(l0.band.out, l0.root, l0.D, x, y, z);
          if (v > TT) return { hit: [x, y, z], steps };
          const s = (v === 0 ? bounds(P, x, y, z).lo : Math.sqrt(v)) - SQRT3;
          if (s > 1e-6){ t += s; continue; }
          // The next voxel, exactly.
          let next = Infinity;
          for (let a = 0; a < 3; a++){
            const dd = ray.d[a];
            if (dd === 0) continue;
            const c = ray.o[a] + t * dd, f = dd > 0 ? Math.floor(c) + 1 : Math.ceil(c) - 1, e = (f - ray.o[a]) / dd;
            if (e > t && e < next) next = e;
          }
          t = next + 1e-9;
        }
      };
      READS = 0;
      let steps = 0, bad = 0;
      t0 = performance.now();
      const out = rays.map(trace);
      const us = (performance.now() - t0) / M * 1000;
      out.forEach((o, i) => {
        steps += o.steps;
        const h = hits[i];
        if (!h && !o.hit) return;
        if (!h || !o.hit || h.x !== o.hit[0] || h.y !== o.hit[1] || h.z !== o.hit[2]) bad++;
      });
      if (bad > M * 0.002) throw new Error(`trace disagrees with pick on ${bad} of ${M} rays, ${w.name}`);
      results.push({ steps: steps / M, reads: READS / M, us, bad });
    }
    row([w.name, M, fmt(walkReads / M, 0), fmt(results[0].steps, 1), fmt(results[0].reads, 0), fmt(results[1].steps, 1), fmt(results[1].reads, 0), fmt(walkUs, 1), fmt(results[0].us, 1), fmt(results[1].us, 1)]);
    say(`  (disagreements with pick, grazing corners: T=4 ${results[0].bad}, T=8 ${results[1].bad} of ${M})`);
  }
}

/* ---- f: edits ------------------------------------------------------------------- */
if (only.includes('f')){
  say('\n## f. Edits: one voxel broken, the same memo kept, T = 4\n');
  head(['world', 'first build ms', 'first build: different inputs', 'edits', 'inputs missed per edit', 'ms per edit, median', 'new band nodes per edit', 'occupancy new nodes per edit']);
  for (const make of [() => shapeWorld('hills', 10), () => kitWorld(10), () => kitWorld(12), () => caveWorld(10), clayWorld]){
    const w = make(), band = createBand(w.store, w.D, 4), t0 = performance.now();
    let root = band.rootOf(w.root), src = w.root;
    const first = performance.now() - t0, firstLeaves = band.stats.leaves, r = rng(11), ms = [], E = 64;
    let leaves = 0, nb = 0, no = 0;
    for (let e = 0; e < E; e++){
      const p = solidPoint(w.store, src, w.D, r), b0 = sizeOf(band.out), o0 = sizeOf(w.store), l0 = band.stats.leaves;
      src = place(w.store, src, w.D, 0, p[0], p[1], p[2], EMPTY);
      const t1 = performance.now();
      root = band.rootOf(src);
      ms.push(performance.now() - t1);
      leaves += band.stats.leaves - l0; nb += sizeOf(band.out) - b0; no += sizeOf(w.store) - o0;
    }
    // A fresh memo in the same band store must land on the same root id: canonical.
    const check = createBand(w.store, w.D, 4, { out: band.out }), again = check.rootOf(src);
    if (again !== root) throw new Error(`incremental band on ${w.name} differs from a fresh one`);
    row([w.name, fmt(first, 0), fmt(firstLeaves, 0), E, fmt(leaves / E, 1), fmt(median(ms), 2), fmt(nb / E, 0), fmt(no / E, 1)]);
  }
}

/* ---- g: fields per node --------------------------------------------------------- */
if (only.includes('g')){
  say('\n## g. Fields per node, T = 4: a function of the node alone\n');
  head(['world', 'occupancy nodes', 'unique 16³', 'build ms', 'MB, lod 0', 'band MB, same T', 'all lods: unique', 'all lods: MB', 'all lods: ms', 'query ns', 'neighbours a query', 'edit: new floods', 'edit ms']);
  const BANDS = { 'hills D=10': 2.6, 'gyroid D=10': 5.2, 'kit D=10': 5.5, 'kit D=12': 18.3, 'caves D=10': 12.7, 'clay D=20': 1.7 };
  const worlds = [() => shapeWorld('hills', 10), () => shapeWorld('gyroid', 10), () => kitWorld(10), () => kitWorld(12), () => kitWorld(14), () => kitWorld(16), () => caveWorld(10), clayWorld];
  for (const make of worlds){
    const w = make(), n0 = sizeOf(w.store), T = 4, W = N + 2 * T, F = createFields(w.store, w.D, T), ids = nodesAt16(w.store, w.root, w.D);
    const t0 = performance.now();
    for (const id of ids) F.ofNode(id);
    const ms = performance.now() - t0, mb = ids.size * 2 * W ** 3 / 2 ** 20;
    // All lods: the same, on each coarser world.
    let s = w.store, r = w.root, d = w.D, uniq = 0, allMs = 0;
    for (;;){
      const f = createFields(s, d, T), u = nodesAt16(s, r, d), t1 = performance.now();
      for (const id of u) f.ofNode(id);
      allMs += performance.now() - t1; uniq += u.size;
      if (d === L) break;
      const c = coarsen(s, r, d); s = c.store; r = c.root; d = c.D;
    }
    // A query, near surfaces. Solid points jittered by up to 8 voxels.
    const R = 2 ** w.D, rr = rng(21), M = 200000, pts = new Int32Array(3 * M);
    for (let i = 0; i < M; i++){
      const p = solidPoint(w.store, w.root, w.D, rr);
      for (let a = 0; a < 3; a++) pts[3 * i + a] = Math.max(0, Math.min(R - 1, p[a] + Math.floor(rr() * 17) - 8));
    }
    LOOKUPS = 0;
    const t2 = performance.now();
    let sum = 0;
    for (let i = 0; i < M; i++) sum += fieldAt(F, w.root, pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]).d2;
    const ns = (performance.now() - t2) / M * 1e6, look = LOOKUPS / M;
    // An edit: at most one new 16³ node, so at most one flood, whatever it's next to.
    const before = F.stats.floods, em = [];
    let src = w.root;
    for (let e = 0; e < 64; e++){
      const p = solidPoint(w.store, src, w.D, rr);
      src = place(w.store, src, w.D, 0, p[0], p[1], p[2], EMPTY);
      const t3 = performance.now();
      F.ofNode(nodeAt16(F, src, p[0] >> L, p[1] >> L, p[2] >> L));
      em.push(performance.now() - t3);
    }
    row([w.name, fmt(n0, 0), fmt(ids.size, 0), fmt(ms, 0), fmt(mb, 1), BANDS[w.name] ?? 'not finished', fmt(uniq, 0), fmt(uniq * 2 * W ** 3 / 2 ** 20, 1), fmt(allMs, 0), fmt(ns, 0), fmt(look, 1), fmt((F.stats.floods - before) / 64, 2), fmt(median(em), 2)]);
  }
}
