/* Labels on a real asset: E1b of docs/labels-log.md §8 on the Halloween pack,
   as labels-kit-log.md §6 planned it. A sketch, not the engine: nothing
   imports it, and the label store is label-core.mjs's stand-in for typed
   leaves.

     node experiments/label-mesh.mjs           D = 8, 10, 12; writes docs/labels-mesh-results.md and docs/images/labels-mesh-*.png
     node experiments/label-mesh.mjs --quick   D = 8 and 10, prints only
     node experiments/label-mesh.mjs --D=10    one depth, prints only
     (an asset other than the pack: --asset=path.glb, prints only)

   Why the pack: its 135K triangles paint from one gradient atlas of 27
   swatches, so a swatch is a material a modeller chose, a face at a time.
   Per-voxel colour for an asset is RGB words (labels-kit-log §6, decided
   2026-11-08); the swatches here are a test of the label DAG on a mesh, not
   a way to store its colour.

   a. The swatches. The atlas is 9 columns × 3 rows of vertical gradients,
      the columns not all one width (128 to 159 texels). The cuts are found
      from the image: the mean colour jump between neighbouring texel columns
      (rows), its 8 (2) largest peaks at least 50 texels apart. Labels 1–27
      row by row from the top left; 0 is air. A triangle's swatch is the one
      under its UV centroid (texel as mesh-asset's sampler finds it), so a
      voxel's label is its nearest triangle's swatch, as §6 asked. Triangles
      whose corners fall in two swatches are counted, not split.
   b. The classifier. A voxel's nearest triangle is the asset triangle (caps
      have no texture) nearest its centre, ties to the lower index. Found
      top down: a cell keeps, of its parent's candidates, every triangle
      within d + 2r of its centre (d the nearest from the centre, r the
      half-diagonal), which holds every triangle nearest to some point in
      the cell. A cell whose candidates share one swatch is decided.
   c. The inside of a closed shell (labels-kit-log §6: occupied, so not
      don't-care, since an edit can break the shell), two rules:
        nearest    every occupied voxel takes its nearest triangle's swatch:
                   the fill a solid-painted shell would have.
        interior   a voxel no asset triangle touches (the build's own triBox
                   test) is INTERIOR, label 28; the rest as nearest. The
                   touched voxels are a bit DAG of their own, the *skin*: the
                   same build with every asset triangle an open sheet and no
                   caps. In conservative mode a voxel the skin misses is
                   never shown (the surface between it and an air neighbour
                   would touch one of the two, and a touched voxel is filled).
   d. Three DAGs a world, as in label-kit.mjs: shape (mesh-core's build,
      conservative), A (one DAG of labels) and masked (beside the shape, air
      as don't-care). A and masked come from one walk of shape and skin
      together. Node counts are what each root reaches, label leaves left out.
   e. The checks, every depth and rule (the script stops if one fails): the
      shape against mesh-core's dense oracle at D = 8; skin ⊆ shape; A's
      occupancy is the shape, root id for root id; shape + masked rebuild A,
      interning nothing new. A's labels against an oracle of its own: a grid
      of triangles registered by their boxes, the nearest found by searching
      rings until no unseen triangle can be closer, and touched by triBox
      over the voxel's grid cell. Every voxel at D = 8, and 20,000 occupied
      voxels drawn by rank deeper.
   f. E3 (label-kit.mjs §d): the exact plurality against the centre and first
      rules. INTERIOR votes for nothing, as air does: it isn't a colour. And
      for the nearest rule, how often a cell's plurality over its volume
      differs from the plurality over its skin, which is closer to what the
      cell shows (the interior rule's plurality, INTERIOR ignored, is the
      skin's by construction). */
import fs from 'node:fs';
import { createStore, createCounts, EMPTY, FULL, FIRST_NODE } from '../dag-core.js';
import { voxelize, denseOracle, triBox, closestOnTri } from './mesh-core.mjs';
import { readGlb, analyse, place, cutouts, sampler, preview, encodePng } from './mesh-asset.mjs';
import { createLabelStore, painter, occupancyOf, recombine, expandLabels, labelAt, histograms, occurrences, plurality,
         centreLabel, firstLabel, sampledRule } from './label-core.mjs';

const args = process.argv.slice(2), opt = k => args.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const quick = args.includes('--quick'), argD = opt('D'), argAsset = opt('asset');
const DS = argD ? [+argD] : quick ? [8, 10] : [8, 10, 12];
const WRITE = !quick && !argD && !argAsset;
const ASSET = argAsset ?? new URL('../test-3d-models/stylized-halloween-asset/source/WBA_Halloween_Pack.glb', import.meta.url).pathname;
const SAMPLES = 20000;
const fmt = (x, d = 0) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '-';
const pct = (a, b, d = 2) => b ? fmt(100 * a / b, d) + '%' : '-';
const OUT = [];
const say = s => { console.log(s); OUT.push(s); };
const row = cells => say('| ' + cells.join(' | ') + ' |');
const now = () => performance.now();
const note = s => process.stderr.write(s + '\n');

/* ---- a. the swatches -------------------------------------------------------- */
function cutsOf(jump, n, gap){
  const order = [...jump.keys()].sort((a, b) => jump[b] - jump[a]), cuts = [];
  for (const i of order){
    if (cuts.length === n) break;
    if (i > 0 && cuts.every(c => Math.abs(c - i) >= gap)) cuts.push(i);
  }
  return cuts.sort((a, b) => a - b);
}
function swatchesOf(img, nx = 9, ny = 3){
  const { w, h, rgba } = img, cj = new Float64Array(w), rj = new Float64Array(h);
  const d = (o, q) => Math.hypot(rgba[o] - rgba[q], rgba[o + 1] - rgba[q + 1], rgba[o + 2] - rgba[q + 2]);
  for (let y = 0; y < h; y++) for (let x = 1; x < w; x++) cj[x] += d(4 * (x + w * y), 4 * (x - 1 + w * y));
  for (let y = 1; y < h; y++) for (let x = 0; x < w; x++) rj[y] += d(4 * (x + w * y), 4 * (x + w * (y - 1)));
  const xs = [0, ...cutsOf(cj, nx - 1, 50), w], ys = [0, ...cutsOf(rj, ny - 1, 50), h];
  const colOf = new Uint8Array(w), rowOf = new Uint8Array(h);
  for (let i = 0; i < nx; i++) colOf.fill(i, xs[i], xs[i + 1]);
  for (let j = 0; j < ny; j++) rowOf.fill(j, ys[j], ys[j + 1]);
  // A swatch's colour for the previews: the mean of its middle half.
  const colour = [[0, 0, 0]];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
    const s = [0, 0, 0]; let n = 0;
    const x0 = xs[i] + (xs[i + 1] - xs[i]) / 4, x1 = xs[i + 1] - (xs[i + 1] - xs[i]) / 4, y0 = ys[j] + (ys[j + 1] - ys[j]) / 4, y1 = ys[j + 1] - (ys[j + 1] - ys[j]) / 4;
    for (let y = Math.floor(y0); y < y1; y++) for (let x = Math.floor(x0); x < x1; x++){ const o = 4 * (x + w * y); s[0] += rgba[o]; s[1] += rgba[o + 1]; s[2] += rgba[o + 2]; n++; }
    colour.push(s.map(v => v / n));
  }
  // The texel lookup is the sampler's: u and v wrapped, v down the image.
  const at = (u, v) => 1 + colOf[Math.floor((u - Math.floor(u)) * w)] + nx * rowOf[Math.floor((v - Math.floor(v)) * h)];
  return { xs, ys, n: nx * ny, colour, at };
}

/* ---- the asset, at depth D ------------------------------------------------------ */
const G = readGlb(ASSET), AN = analyse(G);
if (G.materials.length !== 1 || !G.materials[0].image) throw new Error('this sketch reads one textured material (the pack\'s atlas)');
const SW = swatchesOf(G.materials[0].image), INTERIOR = SW.n + 1, NL = SW.n + 2;
const DEGEN = { n: 0 }, SPANS = { n: 0, of: 0 };

function prepare(D){
  const M = place(G, AN, D);
  if (cutouts(G, M, sampler(G, M))) throw new Error('alpha cutouts: the classifier would have to ask keep() per voxel');
  // Asset triangles first, caps after (place's order): nA of them.
  let nA = 0; while (nA < M.n && M.src[nA] >= 0) nA++;
  for (let i = nA; i < M.n; i++) if (M.src[i] >= 0) throw new Error('place() no longer puts caps last');
  const tri = new Uint8Array(nA);
  let spans = 0, degen = 0;
  for (let i = 0; i < nA; i++){
    const t = M.src[i], u = [0, 1, 2].map(e => G.UV[6 * t + 2 * e]), v = [0, 1, 2].map(e => G.UV[6 * t + 2 * e + 1]);
    const cu = (u[0] + u[1] + u[2]) / 3, cv = (v[0] + v[1] + v[2]) / 3;
    tri[i] = SW.at(cu, cv);
    // Corners pulled 2% toward the centroid, so a corner exactly on a cut doesn't count.
    for (let e = 0; e < 3; e++) if (SW.at(0.98 * u[e] + 0.02 * cu, 0.98 * v[e] + 0.02 * cv) !== tri[i]){ spans++; break; }
    const o = 3 * i, a = M.E1, b = M.E2;
    if (Math.hypot(a[o + 1] * b[o + 2] - a[o + 2] * b[o + 1], a[o + 2] * b[o] - a[o] * b[o + 2], a[o] * b[o + 1] - a[o + 1] * b[o]) === 0) degen++;
  }
  SPANS.n = spans; SPANS.of = nA; DEGEN.n = degen;
  // The skin: asset triangles only, every one an open sheet.
  const Mskin = { n: nA, V0: M.V0, E1: M.E1, E2: M.E2, closed: new Int8Array(nA), side: M.side };
  const store = createStore();
  const shape = voxelize(M, D, 'conservative', store), skin = voxelize(Mskin, D, 'conservative', store);
  return { D, M, nA, tri, store, shape, skin };
}

/* ---- b, c, d. the label walk ---------------------------------------------------
   One walk over shape and skin (one store), carrying the candidate list; A and
   masked come out of it together. */
function buildLabels(W, rule){
  const { D, M, nA, tri, store } = W, R3 = Math.sqrt(3);
  const LA = createLabelStore(NL), LM = createLabelStore(NL), fill = painter(LA, store);
  const lists = Array.from({ length: D + 2 }, () => new Int32Array(nA)), lens = new Int32Array(D + 2);
  for (let i = 0; i < nA; i++) lists[D + 1][i] = i;
  lens[D + 1] = nA;
  const dist = new Float64Array(nA), bary = [0, 0, 0], p = [0, 0, 0];
  const chA = Array.from({ length: D + 1 }, () => new Uint32Array(8)), chM = Array.from({ length: D + 1 }, () => new Uint32Array(8));
  let cells = 0, tests = 0, masked = EMPTY;
  // The candidates of cell (k, x, y, z) from its parent's; returns the one
  // swatch they share, or 0; at k = 0, the nearest's swatch.
  const narrow = (k, x, y, z) => {
    const P = lists[k + 1], np = lens[k + 1], out = lists[k], s = 2 ** k, h = s / 2;
    p[0] = x * s + h; p[1] = y * s + h; p[2] = z * s + h;
    let best = Infinity, bi = -1;
    for (let j = 0; j < np; j++){
      const i = P[j], d = closestOnTri(M, i, p, bary);
      dist[j] = d; tests++;
      if (d < best){ best = d; bi = i; }
    }
    if (k === 0){ lens[k] = 0; return tri[bi]; }
    const lim = Math.sqrt(best) + 2 * h * R3 + 1e-9 * s;
    let n = 0, one = tri[bi];
    for (let j = 0; j < np; j++) if (Math.sqrt(dist[j]) <= lim){ out[n++] = P[j]; if (tri[P[j]] !== one) one = 0; }
    lens[k] = n;
    return one;
  };
  const rec = (k, x, y, z, s, sk) => {
    if (s === EMPTY){ masked = EMPTY; return EMPTY; }
    cells++;
    let lab = 0;
    if (rule === 'interior' && sk === EMPTY) lab = INTERIOR;
    else {
      const one = narrow(k, x, y, z);
      if (k === 0) lab = rule === 'interior' && sk !== FULL ? INTERIOR : one;
      else if (rule === 'nearest' || sk === s) lab = one;
    }
    if (lab){ masked = LM.uniform(lab, k); return fill(s, lab); }
    const a = chA[k], m = chM[k];
    for (let o = 0; o < 8; o++){
      a[o] = rec(k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2), store.child(s, o), sk === EMPTY ? EMPTY : store.child(sk, o));
      m[o] = masked;
    }
    masked = LM.internMasked(k, m);
    return LA.store.intern(k, a);
  };
  const t = now(), A = rec(D, 0, 0, 0, W.shape.root, W.skin.root), M_ = masked;
  return { LA, LM, A, M: M_, ms: now() - t, cells, tests };
}

// Nodes a level the root reaches (label-kit.mjs's: a leaf's "children" are its label).
function reach(st, root, D){
  const seen = new Uint8Array(st.maxId + 1), lev = new Array(D + 1).fill(0);
  if (root >= FIRST_NODE) seen[root] = 1;
  for (let id = root; id >= FIRST_NODE; id--){
    if (!seen[id]) continue;
    const k = st.levelOf(id);
    lev[k]++;
    if (k === 0) continue;
    for (let o = 0; o < 8; o++){ const c = st.child(id, o); if (c >= FIRST_NODE) seen[c] = 1; }
  }
  return { lev, total: lev.reduce((a, b, k) => a + (k ? b : 0), 0) };
}

/* ---- e. the oracle ------------------------------------------------------------------
   Its own search: asset triangles registered in a grid of side C by their
   boxes, rings searched outward from the voxel's cell. After rings 0…r, a
   triangle not yet seen lies outside the (2r + 1)³ block, so at least r·C
   away: stop once the best is closer than that. Ties to the lower index,
   as the walk's. Touched: triBox, with the build's grown half-side, over
   the voxel's own cell. */
function oracleOf(W){
  const { D, M, nA, tri } = W, side = 2 ** D, C = Math.max(4, side / 64), g = Math.ceil(side / C), bins = Array.from({ length: g * g * g }, () => []);
  for (let i = 0; i < nA; i++){
    const o = 3 * i, lo = [], hi = [];
    // Boxes grown a little: the touched test grows the voxel by 1e-9, which can reach past its grid cell.
    for (let k = 0; k < 3; k++){ const a = M.V0[o + k], b = a + M.E1[o + k], c = a + M.E2[o + k]; lo.push(Math.max(0, Math.floor((Math.min(a, b, c) - 1e-6) / C))); hi.push(Math.min(g - 1, Math.floor((Math.max(a, b, c) + 1e-6) / C))); }
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) bins[x + g * (y + g * z)].push(i);
  }
  const bary = [0, 0, 0], GROW = 0.5 * (1 + 1e-9) + 1e-9;
  return (x, y, z, rule) => {
    const p = [x + 0.5, y + 0.5, z + 0.5], c = p.map(v => Math.min(g - 1, Math.floor(v / C)));
    if (rule === 'interior'){
      let touched = false;
      for (const i of bins[c[0] + g * (c[1] + g * c[2])]) if (triBox(M, i, p, GROW)){ touched = true; break; }
      if (!touched) return INTERIOR;
    }
    let bd = Infinity, bi = -1;
    for (let r = 0; r <= g; r++){
      // Rings 0 … r − 1 are done: an unseen triangle is at least (r − 1)·C away.
      if (Math.sqrt(bd) < (r - 1) * C) break;
      for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++){
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const X = c[0] + dx, Y = c[1] + dy, Z = c[2] + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= g || Y >= g || Z >= g) continue;
        for (const i of bins[X + g * (Y + g * Z)]){
          const d = closestOnTri(M, i, p, bary);
          if (d < bd || (d === bd && i < bi)){ bd = d; bi = i; }
        }
      }
    }
    return tri[bi];
  };
}
// The r-th occupied voxel in Morton order, by counts on the way down.
function nth(store, counts, root, D, r){
  let id = root, x = 0, y = 0, z = 0;
  for (let k = D - 1; k >= 0; k--){
    for (let o = 0; o < 8; o++){
      const c = store.child(id, o), n = c === EMPTY ? 0 : counts.of(c);
      if (r < n){ id = c; x |= (o & 1) << k; y |= (o >> 1 & 1) << k; z |= (o >> 2) << k; break; }
      r -= n;
    }
  }
  return [x, y, z];
}
const stream = seed => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

/* ---- a depth, a rule ------------------------------------------------------------------ */
const LODS = [1, 2, 3, 4, 5, 6, 7, 8];
function run(W, rule, { e3 = false } = {}){
  const { D, store } = W, b = buildLabels(W, rule), { LA, LM } = b;
  const sr = reach(store, W.shape.root, D), ar = reach(LA.store, b.A, D), mr = reach(LM.store, b.M, D);
  const r = { D, rule, shape: sr.total, shapeLev: sr.lev, A: ar.total, ALev: ar.lev, M_: mr.total, MLev: mr.lev, ms: b.ms, cells: b.cells, tests: b.tests, LA, Aroot: b.A };
  // checks
  r.okShape = occupancyOf(LA, b.A, store).root === W.shape.root;
  const before = LA.store.size, rc = recombine(LA, store, W.shape.root, LM, b.M);
  r.okMasked = rc.root === b.A && LA.store.size === before;
  r.pairs = rc.pairs;
  const oracle = oracleOf(W);
  if (D === 8){
    const S = 256, got = expandLabels(LA, b.A, D), occ = store.expand(W.shape.root, D);
    let bad = 0, n = 0;
    for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
      const i = x + S * (y + S * z), want = occ[i] ? oracle(x, y, z, rule) : 0;
      if (want) n++;
      if (got[i] !== want) bad++;
    }
    r.oracleBad = bad; r.oracleN = n;
  } else {
    const counts = createCounts(store), total = counts.of(W.shape.root), rnd = stream(D * 7919 + (rule === 'interior' ? 1 : 0));
    let bad = 0;
    for (let i = 0; i < SAMPLES; i++){
      const [x, y, z] = nth(store, counts, W.shape.root, D, Math.floor(rnd() * total));
      if (labelAt(LA, b.A, D, x, y, z) !== oracle(x, y, z, rule)) bad++;
    }
    r.oracleBad = bad; r.oracleN = SAMPLES;
  }
  // labels used, voxels per label, histogram entries
  const H = histograms(LA), oc = occurrences(LA.store, b.A);
  r.H = H; r.oc = oc;
  r.perLabel = new Float64Array(NL);
  for (let j = 1; j < NL; j++) r.perLabel[j] = H[b.A * NL + j];
  r.entries = new Array(NL + 1).fill(0);
  for (let id = FIRST_NODE + LA.NLEAF; id <= LA.store.maxId; id++){
    if (!oc[id]) continue;
    let n = 0, sum = 0;
    for (let j = 1; j < NL; j++) if (H[id * NL + j] > 0){ n++; sum += H[id * NL + j]; }
    if (sum < 8 ** LA.store.levelOf(id)) n++;
    r.entries[n]++;
  }
  if (e3) r.e3 = e3Of(LA, b.A, H, oc, D);
  const failed = !r.okShape || !r.okMasked || r.oracleBad;
  if (failed) throw new Error(`a check failed: D = ${D}, ${rule}: ${JSON.stringify({ okShape: r.okShape, okMasked: r.okMasked, oracle: r.oracleBad })}`);
  return r;
}

/* ---- f. E3 ------------------------------------------------------------------------------
   label-kit.mjs's, with INTERIOR voting for nothing: the exact plurality
   leaves it out (plurality over labels 1…NL − 2), and so do the samples. */
function e3Of(L, root, H, oc, D){
  const shown = (L, id, f) => { const v = centreLabel(L, id, f); return v === INTERIOR ? 0 : v; };
  const firstShown = (L, id) => { const v = firstLabel(L, id); return v === INTERIOR ? 0 : v; };
  const centre = sampledRule(L, H, shown), first = sampledRule(L, H, firstShown), out = [];
  for (const lod of LODS){
    if (lod > D) break;
    const e = { lod, cells: 0, voxels: 0, mixed: 0, partial: 0, unique: 0, interiorWins: 0, rules: [] }, ids = [];
    for (let id = FIRST_NODE + L.NLEAF; id <= L.store.maxId; id++) if (oc[id] > 0 && L.store.levelOf(id) === lod) ids.push(id);
    e.unique = ids.length;
    const exact = ids.map(id => plurality(H, NL - 1, id * NL));
    ids.forEach(id => {
      let n = 0, sum = 0;
      for (let j = 1; j < NL; j++) if (H[id * NL + j] > 0){ sum += H[id * NL + j]; if (j !== INTERIOR) n++; }
      e.cells += oc[id]; e.voxels += oc[id] * sum;
      if (n >= 2) e.mixed += oc[id];
      if (sum < 8 ** lod) e.partial += oc[id];
      if (plurality(H, NL, id * NL) === INTERIOR) e.interiorWins += oc[id];
    });
    for (const [rule, f] of [['centre', centre], ['first', first]]) for (const m of [0, 1, 2, lod]){
      const q = { rule, meanDepth: m, wrong: 0, none: 0, lost: 0 };
      ids.forEach((id, i) => {
        const a = f(id, lod, m);
        if (a === exact[i]) return;
        if (a === 0){ q.none += oc[id]; return; }
        q.wrong += oc[id];
        q.lost += oc[id] * (H[id * NL + exact[i]] - H[id * NL + a]);
      });
      e.rules.push(q);
    }
    out.push(e);
  }
  return out;
}
/* The nearest rule's volume plurality against its skin plurality: walk the
   nearest A and the interior A together (same occupancy), and for each
   (a, b) pair of cells at a lod, compare a's plurality with b's, INTERIOR
   left out of b's (its other labels are the skin's, exactly). */
function volumeVsSkin(n, i, D){
  const out = [];
  let level = new Map([[n.Aroot * 2 ** 26 + i.Aroot, 1]]);
  for (let k = D; k >= 1; k--){
    if (k <= 8){
      const e = { lod: k, cells: 0, skinCells: 0, differ: 0, lost: 0, skinVoxels: 0 };
      for (const [key, occ] of level){
        const a = Math.floor(key / 2 ** 26), b = key % 2 ** 26;
        // Histograms hold chains too (a chain's is 8^k of its label), so no case for them.
        const pa = plurality(n.H, NL, a * NL), pb = plurality(i.H, NL - 1, b * NL);
        e.cells += occ;
        if (!pb) continue;
        e.skinCells += occ;
        let sv = 0; for (let j = 1; j < INTERIOR; j++) sv += i.H[b * NL + j];
        e.skinVoxels += occ * sv;
        if (pa !== pb){ e.differ += occ; e.lost += occ * (i.H[b * NL + pb] - i.H[b * NL + pa]); }
      }
      out.unshift(e);
    }
    if (k === 1) break;
    const next = new Map();
    for (const [key, occ] of level){
      const a = Math.floor(key / 2 ** 26), b = key % 2 ** 26;
      for (let o = 0; o < 8; o++){
        const ca = n.LA.store.child(a, o), cb = i.LA.store.child(b, o);
        if ((ca === EMPTY) !== (cb === EMPTY)) throw new Error('nearest and interior A differ in occupancy');
        if (ca === EMPTY) continue;
        const kk = ca * 2 ** 26 + cb;
        next.set(kk, (next.get(kk) ?? 0) + occ);
      }
    }
    level = next;
  }
  return out;
}

/* ---- previews: labels on the surface, and a slice through a solid --------------------- */
const MAGENTA = [235, 0, 235], AIRC = [238, 236, 232];
function labelImages(W, rN, rI, tag){
  const { D, store, M } = W, colour = l => l === INTERIOR ? MAGENTA : SW.colour[l];
  const front = preview(store, W.shape.root, D, (x, y, z) => colour(labelAt(rN.LA, rN.Aroot, D, x, y, z)), 'front');
  fs.writeFileSync(new URL(`../docs/images/labels-mesh-${tag}-front.png`, import.meta.url), front);
  // The slice: through the middle of the largest solid component, along z.
  const big = AN.comps.find(c => c.solid), lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const want = new Set(big.tris);
  for (let i = 0; i < W.nA; i++) if (want.has(M.src[i])) for (const e of [0, 1, 2]) for (let k = 0; k < 3; k++){
    const v = M.V0[3 * i + k] + (e === 1 ? M.E1[3 * i + k] : e === 2 ? M.E2[3 * i + k] : 0);
    lo[k] = Math.min(lo[k], v); hi[k] = Math.max(hi[k], v);
  }
  // Framed by what the plane holds near the component, not by the component's
  // box: the component may be part of a figure (the mummy's head and body
  // are two), and its box cropped the figure twice.
  const zc = Math.floor((lo[2] + hi[2]) / 2), S = 2 ** D, ext = Math.max(hi[0] - lo[0], hi[1] - lo[1]);
  const fx0 = Math.max(0, Math.floor(lo[0] - ext)), fx1 = Math.min(S, Math.ceil(hi[0] + ext)), fy0 = Math.max(0, Math.floor(lo[1] - ext)), fy1 = Math.min(S, Math.ceil(hi[1] + ext));
  let bx0 = S, bx1 = 0, by0 = S, by1 = 0;
  for (let y = fy0; y < fy1; y++) for (let x = fx0; x < fx1; x++) if (labelAt(rN.LA, rN.Aroot, D, x, y, zc)){ bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x + 1); by0 = Math.min(by0, y); by1 = Math.max(by1, y + 1); }
  const x0 = Math.max(0, bx0 - 8), x1 = Math.min(S, bx1 + 8), y0 = Math.max(0, by0 - 8), y1 = Math.min(S, by1 + 8);
  const w = x1 - x0, h = y1 - y0, sc = Math.max(2, Math.floor(600 / Math.max(w, h)));
  for (const r of [rN, rI]){
    const rgb = new Uint8Array(3 * w * sc * h * sc);
    for (let j = 0; j < h * sc; j++) for (let i = 0; i < w * sc; i++){
      const x = x0 + Math.floor(i / sc), y = y1 - 1 - Math.floor(j / sc), l = labelAt(r.LA, r.Aroot, D, x, y, zc), c = l ? colour(l) : AIRC, o = 3 * (i + w * sc * j);
      rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
    }
    fs.writeFileSync(new URL(`../docs/images/labels-mesh-${tag}-slice-${r.rule}.png`, import.meta.url), encodePng(w * sc, h * sc, rgb));
  }
  return { zc, box: [x0, x1, y0, y1], tris: big.tris.length };
}

/* ---- the report ------------------------------------------------------------------------- */
say('# Labels on the Halloween pack: results\n');
say('Generated by `node experiments/label-mesh.mjs` (labels-log.md §8, E1b on a mesh asset). The readings are in [labels-mesh-log.md](labels-mesh-log.md).\n');
say(`The pack: ${fmt(AN.nt)} triangles, ${fmt(AN.comps.length)} components, ${AN.comps.filter(c => c.solid).length} of them closed solids. Atlas ${G.materials[0].image.w}², cut at x = ${SW.xs.slice(1, -1).join(', ')} and y = ${SW.ys.slice(1, -1).join(', ')}: ${SW.n} swatches, labels 1–${SW.n}; INTERIOR is ${INTERIOR}; 0 is air. *shape* is mesh-core's conservative build, *skin* the voxels an asset triangle touches, *A* one DAG of labels, *masked* the label DAG beside the shape with air as don't-care. Node counts are what each root reaches.\n`);

const results = [], worlds = new Map();
for (const D of DS){
  let t = now();
  const W = prepare(D);
  W.prepMs = now() - t;
  if (D === 8){
    const want = denseOracle(W.M, 8, 'conservative'), got = W.store.expand(W.shape.root, 8);
    let diff = 0; for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) diff++;
    if (diff) throw new Error(`D = 8: the shape differs from the dense oracle in ${diff} voxels`);
  }
  const counts = createCounts(W.store);
  W.voxels = counts.of(W.shape.root); W.skinVoxels = counts.of(W.skin.root);
  if (W.store.union(W.shape.root, W.skin.root) !== W.shape.root) throw new Error(`D = ${D}: the skin isn't inside the shape`);
  W.skinNodes = reach(W.store, W.skin.root, D).total;
  worlds.set(D, W);
  const big = D === DS[DS.length - 1];
  for (const rule of ['nearest', 'interior']){
    const r = run(W, rule, { e3: big });
    r.W = W;
    results.push(r);
    note(`D = ${D} ${rule}: ${fmt(r.ms / 1000, 1)} s, ${fmt(r.tests)} triangle tests, A ${fmt(r.A)}, masked ${fmt(r.M_)}`);
  }
}

say('## The asset at each depth\n');
row(['D', 'shape nodes', 'occupied voxels', 'skin voxels', 'interior voxels', 'interior share', 'skin nodes', 'shape + skin build s']);
row(['---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:']);
for (const D of DS){ const W = worlds.get(D), r = results.find(r => r.D === D); row([D, fmt(r.shape), fmt(W.voxels), fmt(W.skinVoxels), fmt(W.voxels - W.skinVoxels), pct(W.voxels - W.skinVoxels, W.voxels, 1), fmt(W.skinNodes), fmt(W.prepMs / 1000, 1)]); }
say(`\nTriangles whose corners fall in more than one swatch (2% in from each corner): ${fmt(SPANS.n)} of ${fmt(SPANS.of)} (${pct(SPANS.n, SPANS.of)}). Degenerate (zero area): ${fmt(DEGEN.n)}.\n`);

say('## The checks\n');
row(['D', 'rule', 'A against the oracle', 'A\'s occupancy = shape', 'shape + masked = A']);
row(['---:', '---', '---', '---', '---']);
for (const r of results) row([r.D, r.rule, `${r.oracleBad} wrong of ${fmt(r.oracleN)} ${r.D === 8 ? 'occupied voxels (every voxel checked)' : 'sampled occupied voxels'}`, r.okShape ? 'root id' : '**no**', r.okMasked ? 'root id, nothing new' : '**no**']);
say('\nThe shape equals mesh-core\'s dense oracle at D = 8, and the skin lies inside the shape (their union is the shape, by id) at every depth.\n');

say('## E1b: nodes\n');
row(['D', 'rule', 'shape', 'A', 'masked label', 'B, masked = shape + masked', 'A / shape', 'masked / shape', 'B, masked / A', '(shape, mixed label) pairs', 'cells walked', 'triangle tests', 'walk s']);
row(['---:', '---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:']);
for (const r of results) row([r.D, r.rule, fmt(r.shape), fmt(r.A), fmt(r.M_), fmt(r.shape + r.M_), fmt(r.A / r.shape, 2), fmt(r.M_ / r.shape, 3), fmt((r.shape + r.M_) / r.A, 3), fmt(r.pairs), fmt(r.cells), fmt(r.tests), fmt(r.ms / 1000, 1)]);

const big = DS[DS.length - 1], bigR = results.filter(r => r.D === big);
say(`\nNodes per level at D = ${big}:\n`);
row(['level', 'shape', ...bigR.flatMap(r => [`A ${r.rule}`, `masked ${r.rule}`])]);
row(['---:', '---:', ...bigR.flatMap(() => ['---:', '---:'])]);
for (let k = 0; k <= big; k++) row([k, fmt(bigR[0].shapeLev[k]), ...bigR.flatMap(r => [fmt(r.ALev[k]), fmt(r.MLev[k])])]);
say('\nLevel 0 counts the label leaves A and masked reach (one per label); the totals above leave them out.\n');

say(`## Bytes, against baked words (D = ${big})\n`);
say('Every node is 9 words here (8 children and a level). A baked word stream holds a word per shown voxel; the skin is an upper bound on the shown voxels (conservative mode shows no voxel the skin misses).\n');
row(['', 'words', 'per skin voxel']);
row(['---', '---:', '---:']);
const Wb = worlds.get(big);
row(['shape (bit DAG)', fmt(9 * bigR[0].shape), fmt(9 * bigR[0].shape / Wb.skinVoxels, 3)]);
for (const r of bigR) row([`masked label DAG, ${r.rule}`, fmt(9 * r.M_), fmt(9 * r.M_ / Wb.skinVoxels, 3)]);
row(['baked words, at most', fmt(Wb.skinVoxels), '1']);

say(`\n## Voxels per label (D = ${big})\n`);
row(['label', 'colour', ...bigR.map(r => r.rule)]);
row(['---:', '---', ...bigR.map(() => '---:')]);
const hex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
for (let j = 1; j < NL; j++){
  if (bigR.every(r => !r.perLabel[j])) continue;
  row([j === INTERIOR ? 'INTERIOR' : j, j === INTERIOR ? '' : `\`${hex(SW.colour[j])}\``, ...bigR.map(r => pct(r.perLabel[j], Wb.voxels, 2))]);
}
say(`\nLabels in use: ${bigR.map(r => `${r.rule} ${[...r.perLabel].filter(v => v > 0).length}`).join(', ')}.\n`);

say('## Histograms\n');
say('Entries in a reachable A node\'s histogram, air counted as an entry where the node has any:\n');
row(['D', 'rule', '1', '2', '3', '4', '5+']);
row(['---:', '---', '---:', '---:', '---:', '---:', '---:']);
for (const r of results){
  const n = r.entries.reduce((a, b) => a + b, 0), e = r.entries;
  row([r.D, r.rule, pct(e[1], n, 1), pct(e[2], n, 1), pct(e[3], n, 1), pct(e[4], n, 1), pct(e.slice(5).reduce((a, b) => a + b, 0), n, 1)]);
}

say(`\n## E3: exact against sampled (D = ${big})\n`);
say('Cells are occurrences in the world. *Partial*: some air. *Mixed*: two or more swatches (INTERIOR not counted). *INTERIOR wins*: cells whose plurality over every label would be INTERIOR, which the exact rule here leaves out. *centre*: a sub-cell votes for the label at its centre point; *first*: for its first occupied voxel\'s label, Morton order; air and INTERIOR vote for nothing. *No answer*: every vote was for nothing. *Wrong*: another swatch than the exact plurality. *Lost*: the exact swatch\'s voxels beyond the named one\'s, in the wrong cells, over all occupied voxels at that lod.\n');
for (const r of bigR){
  say(`### ${r.rule}\n`);
  row(['lod', 'unique nodes', 'cells', 'partial', 'mixed', 'INTERIOR wins', 'meanDepth', 'centre: no answer', 'centre: wrong', 'of mixed', 'centre: lost', 'first: no answer', 'first: wrong', 'of mixed', 'first: lost']);
  row(['---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:']);
  for (const e of r.e3) for (const m of [0, 1, 2]){
    const c = e.rules.find(q => q.rule === 'centre' && q.meanDepth === m), f = e.rules.find(q => q.rule === 'first' && q.meanDepth === m);
    const top = m === 0;
    row([top ? e.lod : '', top ? fmt(e.unique) : '', top ? fmt(e.cells) : '', top ? pct(e.partial, e.cells) : '', top ? pct(e.mixed, e.cells) : '', top ? pct(e.interiorWins, e.cells) : '', m,
         pct(c.none, e.cells), pct(c.wrong, e.cells, 3), pct(c.wrong, e.mixed, 1), pct(c.lost, e.voxels, 4),
         pct(f.none, e.cells), pct(f.wrong, e.cells, 3), pct(f.wrong, e.mixed, 1), pct(f.lost, e.voxels, 4)]);
  }
  for (const e of r.e3){ const q = e.rules.find(q => q.meanDepth === e.lod && (q.wrong || q.none)); if (q) throw new Error(`sampling every voxel isn't the exact plurality: lod ${e.lod}, ${q.rule}`); }
  say('');
}
say('Sampling every voxel (meanDepth = lod) gives the exact plurality under both rules, at every lod; the script checks it.\n');

say(`### The nearest rule: volume against skin (D = ${big})\n`);
say('A cell\'s plurality under the nearest rule counts its interior voxels, so a thick piece outvotes a thin one beside it. Against the plurality of the same cell\'s skin voxels (what the interior rule gives, INTERIOR left out). *Cells with skin*: cells holding any skin voxel; *lost*: the skin plurality\'s skin voxels beyond the volume plurality\'s, over all skin voxels at that lod.\n');
row(['lod', 'cells', 'cells with skin', 'volume ≠ skin', 'of cells with skin', 'skin voxels lost']);
row(['---:', '---:', '---:', '---:', '---:', '---:']);
const vs = volumeVsSkin(bigR.find(r => r.rule === 'nearest'), bigR.find(r => r.rule === 'interior'), big);
for (const e of vs) row([e.lod, fmt(e.cells), fmt(e.skinCells), fmt(e.differ), pct(e.differ, e.skinCells, 1), pct(e.lost, e.skinVoxels, 3)]);

if (WRITE){
  const pv = labelImages(worlds.get(10), results.find(r => r.D === 10 && r.rule === 'nearest'), results.find(r => r.D === 10 && r.rule === 'interior'), 'd10');
  say(`\n## Previews (D = 10)\n`);
  say(`\`docs/images/labels-mesh-d10-front.png\`: the pack from the front, each voxel its swatch's flat colour. \`-slice-nearest.png\` and \`-slice-interior.png\`: the slice z = ${pv.zc} through the largest closed solid (${fmt(pv.tris)} triangles), x ${pv.box[0]}–${pv.box[1]}, y ${pv.box[2]}–${pv.box[3]}, INTERIOR in magenta.\n`);
  fs.writeFileSync(new URL('../docs/labels-mesh-results.md', import.meta.url), OUT.join('\n') + '\n');
  note('wrote docs/labels-mesh-results.md and docs/images/labels-mesh-d10-*.png');
}
