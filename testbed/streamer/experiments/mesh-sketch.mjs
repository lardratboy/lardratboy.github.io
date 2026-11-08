/* Meshes as volumes: a sketch for docs/colororgeneralfields.md. Not the engine:
   no tests, no viewer, nothing imports it.

   Three stand-ins for game assets, made here so the sketch needs no files and no
   dependencies: a low-poly rock (a displaced icosphere, one closed shell), a hut
   (closed boxes and a prism that overlap, plus an open sign), and a tree (a
   closed trunk under crossed open cards, the way game foliage is made). Each
   triangle has UVs and a material, and a procedural "texture" stands in for the
   image a real asset would sample.

     node experiments/mesh-sketch.mjs           D = 8, 10, 12, both modes, the oracle at D = 8 (~3 min)
     node experiments/mesh-sketch.mjs --quick   D = 8 and 10
     node experiments/mesh-sketch.mjs --D=12    one depth

   a. The build. dag-core's fromField, top down. A cell carries the triangles
      that touch its box (filtered from its parent's, with Akenine-Möller's
      separating-axis test), its centre's winding number, and the crossings that
      got it there: a child's winding number is its parent's plus the signed
      crossings of the segment between their centres, which lies inside the
      parent's box, so only the parent's triangles can cross it. No triangle in
      the box means one value for the whole box. Two modes:
        centres       a voxel is solid iff its centre is inside a closed shell;
                      open sheets (cards, signs) are voxelized conservatively
        conservative  centres, plus every voxel any triangle touches
      Open sheets never count toward inside: a crossing count is path
      dependent across an open sheet, so a component with a boundary edge is
      surface only (the generalized winding number would be the robust form;
      see the doc).
   b. The oracle at D = 8: an independent dense voxelization (signed crossings
      along x-rows from −∞, and every triangle's own box of voxels tested), held
      to store.expand() byte for byte.
   c. Baked words. A second walk over the tree of occurrences (not the DAG:
      colour belongs to a place) gives each attributed unit a word from the
      nearest triangle's texture: every voxel of a full block of level ≤ K, one
      word for a full block above K. That count, c′, is a function of the node,
      so a unit's rank is read off c′ on the way down, binaryoutput §6's rank
      with c′ in place of the voxel count. Words, how many shown voxels share a
      block's word, and the cost of a rank walk.
   d. Coarse means for free. Words are in rank order, and a node's units are one
      contiguous range of ranks, so a prefix sum over (colour × voxels the word
      stands for) gives the exact count-weighted mean under any node, at any lod,
      in two reads. Checked against a brute-force mean. */
import { createStore, createCounts, EMPTY, FULL, FIRST_NODE, prune } from '../dag-core.js';
import { fastChunk } from '../job-core.js';
import { triBox, voxelize, denseOracle, closestOnTri } from './mesh-core.mjs';

const quick = process.argv.includes('--quick');
const argD = process.argv.find(a => a.startsWith('--D='));
const DEPTHS = argD ? [+argD.slice(4)] : quick ? [8, 10] : [8, 10, 12];
const fmt = (x, d = 0) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '-';
const row = cells => console.log('| ' + cells.join(' | ') + ' |');
const say = s => console.log(s);

/* ---- meshes ------------------------------------------------------------------ */
// A mesh: positions (indexed, so shells share vertices), and per triangle three
// vertex indices, three UVs and a material.
function meshBuilder(){
  const P = [], T = [];
  return {
    P, T,
    v(x, y, z){ P.push([x, y, z]); return P.length - 1; },
    tri(a, b, c, uv, mat){ T.push({ v: [a, b, c], uv, mat }); },
    quad(a, b, c, d, mat){ this.tri(a, b, c, [[0, 0], [1, 0], [1, 1]], mat); this.tri(a, c, d, [[0, 0], [1, 1], [0, 1]], mat); },
    // A closed box, outward-facing.
    box(x0, y0, z0, x1, y1, z1, mat){
      const c = [];
      for (let i = 0; i < 8; i++) c.push(this.v(i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0));
      const F = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
      for (const [a, b, cc, d] of F) this.quad(c[a], c[b], c[cc], c[d], mat);
    },
  };
}
const hash3 = (i, j, k) => { let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1); h = Math.imul(h ^ h >>> 15, 0x85ebca6b); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
function noise3(x, y, z){
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), f = t => t * t * (3 - 2 * t);
  const u = f(x - i), v = f(y - j), w = f(z - k), L = (a, b, t) => a + (b - a) * t;
  const h = (a, b, c) => hash3(i + a, j + b, k + c);
  return L(L(L(h(0, 0, 0), h(1, 0, 0), u), L(h(0, 1, 0), h(1, 1, 0), u), v), L(L(h(0, 0, 1), h(1, 0, 1), u), L(h(0, 1, 1), h(1, 1, 1), u), v), w);
}
function rock(){
  const m = meshBuilder(), t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
           [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  V = V.map(p => { const l = Math.hypot(...p); return p.map(c => c / l); });
  for (let s = 0; s < 3; s++){                       // 20 · 4³ = 1,280 triangles
    const mid = new Map(), nf = [];
    const m2 = (a, b) => { const k = a < b ? a * 1e6 + b : b * 1e6 + a; if (!mid.has(k)){ const p = V[a].map((c, i) => c + V[b][i]), l = Math.hypot(...p); V.push(p.map(c => c / l)); mid.set(k, V.length - 1); } return mid.get(k); };
    for (const [a, b, c] of F){ const ab = m2(a, b), bc = m2(b, c), ca = m2(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = nf;
  }
  // Displace: two octaves of value noise, flattened underneath like a rock that sits.
  const ids = V.map(p => {
    const r = 0.75 + 0.35 * noise3(p[0] * 2 + 7, p[1] * 2, p[2] * 2) + 0.12 * noise3(p[0] * 6, p[1] * 6 + 3, p[2] * 6);
    return m.v(p[0] * r * 1.2, Math.max(-0.45, p[1] * r * 0.8), p[2] * r);
  });
  const uvOf = p => [0.5 + Math.atan2(p[2], p[0]) / (2 * Math.PI), Math.acos(Math.max(-1, Math.min(1, p[1]))) / Math.PI];
  for (const [a, b, c] of F) m.tri(ids[a], ids[b], ids[c], [uvOf(V[a]), uvOf(V[b]), uvOf(V[c])], 0);
  return { name: 'rock', ...m };
}
function hut(){
  const m = meshBuilder();
  m.box(-0.6, -0.5, -0.45, 0.6, 0.25, 0.45, 1);          // walls
  m.box(-0.12, -0.5, 0.42, 0.12, -0.05, 0.5, 4);          // a door, overlapping the wall
  // The roof: a closed prism with eaves, overlapping the walls' top.
  const e = 0.12, a = m.v(-0.6 - e, 0.15, -0.45 - e), b = m.v(0.6 + e, 0.15, -0.45 - e), c = m.v(0.6 + e, 0.15, 0.45 + e), d = m.v(-0.6 - e, 0.15, 0.45 + e);
  const r0 = m.v(-0.6 - e, 0.62, 0), r1 = m.v(0.6 + e, 0.62, 0);
  m.quad(a, r0, r1, b, 2); m.quad(c, r1, r0, d, 2); m.tri(a, d, r0, [[0, 0], [1, 0], [0.5, 1]], 2); m.tri(b, r1, c, [[0, 0], [0.5, 1], [1, 0]], 2); m.quad(a, b, c, d, 2);
  m.box(0.25, 0.3, -0.15, 0.4, 0.75, 0.0, 3);             // a chimney through the roof
  // An open sign on a post: two triangles with nothing behind them.
  const s0 = m.v(-0.95, -0.1, 0.55), s1 = m.v(-0.7, -0.1, 0.55), s2 = m.v(-0.7, 0.1, 0.55), s3 = m.v(-0.95, 0.1, 0.55);
  m.quad(s0, s1, s2, s3, 5);
  m.box(-0.84, -0.5, 0.53, -0.81, -0.1, 0.56, 4);
  return { name: 'hut', ...m };
}
function tree(){
  const m = meshBuilder(), N = 12, bot = [], top = [];
  for (let i = 0; i < N; i++){
    const a = 2 * Math.PI * i / N;
    bot.push(m.v(0.09 * Math.cos(a), -0.5, 0.09 * Math.sin(a))); top.push(m.v(0.06 * Math.cos(a), 0.25, 0.06 * Math.sin(a)));
  }
  const cb = m.v(0, -0.5, 0), ct = m.v(0, 0.25, 0);
  for (let i = 0; i < N; i++){
    const j = (i + 1) % N;
    m.quad(bot[i], top[i], top[j], bot[j], 6);
    m.tri(cb, bot[i], bot[j], [[0.5, 0.5], [0, 0], [1, 0]], 6); m.tri(ct, top[j], top[i], [[0.5, 0.5], [1, 0], [0, 0]], 6);
  }
  // 32 crossed cards round a crown, each an open quad, as game foliage is made.
  for (let i = 0; i < 32; i++){
    const yaw = 2.399963 * i, y = 0.05 + 0.5 * hash3(i, 1, 2), r = 0.1 + 0.25 * hash3(i, 3, 4), s = 0.22;
    const cx = r * Math.cos(yaw), cz = r * Math.sin(yaw), ux = Math.cos(yaw + 1.1) * s, uz = Math.sin(yaw + 1.1) * s;
    const p = [m.v(cx - ux, y - s, cz - uz), m.v(cx + ux, y - s, cz + uz), m.v(cx + ux, y + s, cz + uz), m.v(cx - ux, y + s, cz - uz)];
    m.quad(p[0], p[1], p[2], p[3], 7);
  }
  return { name: 'tree', ...m };
}
// The textures: 8-bit RGB from (u, v, material), standing in for image lookups.
function texture(u, v, mat){
  const n = noise3(u * 40, v * 40, mat * 13.1);
  switch (mat){
    case 0: { const g = 90 + 70 * n; return [g, g * 0.95, g * 0.9]; }                       // rock
    case 1: { const plank = Math.floor(v * 12) % 2 ? 1 : 0.85; return [150 * plank + 30 * n, 105 * plank + 20 * n, 70 * plank]; }  // planks
    case 2: { const tile = (Math.floor(u * 10) + Math.floor(v * 6)) % 2 ? 1 : 0.8; return [170 * tile, 60 * tile, 40 * tile]; }   // roof tiles
    case 3: return [120 + 40 * n, 120 + 40 * n, 125 + 40 * n];                                 // chimney stone
    case 4: return [90 + 20 * n, 60, 35];                                                        // door, post
    case 5: return [220, 200 - 60 * n, 120];                                                     // sign
    case 6: { const bark = 0.8 + 0.2 * Math.sin(u * 60 + 6 * n); return [100 * bark, 70 * bark, 45 * bark]; }  // trunk
    default: return [50 + 60 * n, 130 + 70 * n, 40 + 30 * n];                                   // leaves
  }
}

/* ---- prepared triangles, in world voxel units -------------------------------------
   A component with an edge used by one triangle is open: surface only. */
function prepare(mesh, D){
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.P) for (let a = 0; a < 3; a++){ lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
  const side = 2 ** D, ext = Math.max(...hi.map((h, a) => h - lo[a])), s = 0.92 * side / ext;
  // Centred in x and z, standing on the floor of the world plus a 4% margin, and
  // nudged off the voxel grid by an irrational offset so no centre lies exactly on a face.
  const off = [0, 1, 2].map(a => (a === 1 ? 0.04 * side : (side - (hi[a] - lo[a]) * s) / 2) - lo[a] * s + 0.0137 * Math.SQRT2 * (a + 1));
  const W = mesh.P.map(p => p.map((c, a) => c * s + off[a]));
  // Components and their boundary edges.
  const parent = W.map((_, i) => i), find = i => { while (parent[i] !== i) i = parent[i] = parent[parent[i]]; return i; };
  const edges = new Map();
  for (const t of mesh.T){
    const [a, b, c] = t.v; parent[find(a)] = find(b); parent[find(b)] = find(c);
    for (const [u, v] of [[a, b], [b, c], [c, a]]){ const k = Math.min(u, v) * 1e6 + Math.max(u, v); edges.set(k, (edges.get(k) || 0) + 1); }
  }
  const openComp = new Set();
  for (const t of mesh.T){ const [a, b, c] = t.v; for (const [u, v] of [[a, b], [b, c], [c, a]]) if (edges.get(Math.min(u, v) * 1e6 + Math.max(u, v)) === 1) openComp.add(find(a)); }
  // Each closed shell's signed volume: a shell modelled inside out (common in
  // game assets) gets its crossings flipped, so every shell counts +1 inside and
  // overlapping shells union instead of cancelling.
  const vol = new Map();
  for (const t of mesh.T){
    const [a, b, c] = t.v.map(j => W[j]), r = find(t.v[0]);
    vol.set(r, (vol.get(r) || 0) + (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6);
  }
  const n = mesh.T.length, V0 = new Float64Array(3 * n), E1 = new Float64Array(3 * n), E2 = new Float64Array(3 * n), closed = new Int8Array(n);
  for (let i = 0; i < n; i++){
    const [a, b, c] = mesh.T[i].v.map(j => W[j]), r = find(mesh.T[i].v[0]);
    for (let k = 0; k < 3; k++){ V0[3 * i + k] = a[k]; E1[3 * i + k] = b[k] - a[k]; E2[3 * i + k] = c[k] - a[k]; }
    closed[i] = openComp.has(r) ? 0 : vol.get(r) < 0 ? -1 : 1;     // 0 open, ±1 a shell's orientation
  }
  return { n, V0, E1, E2, closed, tris: mesh.T, side, open: openComp.size };
}

/* ---- c. baked words ------------------------------------------------------------------
   c′(node) under K: EMPTY 0, a voxel 1, a full node of level ≤ K its voxels, a
   full node above K one word, anything else the sum of its children. A function
   of the node, so a table over ids, children first. */
function unitsTable(store, root, D, K){
  const top = store.maxId ?? (store.snapshot().keys.length / 9 + FIRST_NODE - 1), U = new Float64Array(top + 1);
  U[FULL] = 1;
  const full = []; for (let k = 0; k <= D; k++) full.push(store.solid(k));
  for (let id = FIRST_NODE; id <= top; id++){
    const k = store.levelOf(id);
    if (id === full[k]){ U[id] = k <= K ? 8 ** k : 1; continue; }
    let s = 0; for (let o = 0; o < 8; o++) s += U[store.child(id, o)];
    U[id] = s;
  }
  return U;
}
/* The bake: a walk over occurrences in Morton order, which is rank order. Each
   unit's word comes from the nearest triangle (among the nearest ancestor's
   candidates) to its centre: closest point, barycentric UV, texture. Also the
   voxel weight each word stands for, for the prefix sums. */
function bake(M, store, root, D, K){
  const words = [], weight = [];
  const all = Int32Array.from({ length: M.n }, (_, i) => i), bary = [0, 0, 0], best = [0, 0, 0], c = [0, 0, 0];
  const lists = [];
  const word = (k, x, y, z, list) => {
    const s = 2 ** k; c[0] = (x + 0.5) * s; c[1] = (y + 0.5) * s; c[2] = (z + 0.5) * s;
    let bi = -1, bd = Infinity;
    for (let j = 0; j < list.length; j++){ const d = closestOnTri(M, list[j], c, bary); if (d < bd){ bd = d; bi = list[j]; best[0] = bary[0]; best[1] = bary[1]; best[2] = bary[2]; } }
    const t = M.tris[bi], u = best[0] * t.uv[0][0] + best[1] * t.uv[1][0] + best[2] * t.uv[2][0], v = best[0] * t.uv[0][1] + best[1] * t.uv[1][1] + best[2] * t.uv[2][1];
    const [r, g, b] = texture(u, v, t.mat);
    words.push(Math.round(r) | Math.round(g) << 8 | Math.round(b) << 16); weight.push(8 ** k);
  };
  const full = []; for (let k = 0; k <= D; k++) full.push(store.solid(k));
  const walk = (id, k, x, y, z, list) => {
    if (id === EMPTY) return;
    // The candidates for this box, or the parent's if none touch it.
    const s = 2 ** k, cc = [(x + 0.5) * s, (y + 0.5) * s, (z + 0.5) * s], g = s / 2 * (1 + 1e-9) + 1e-9;
    const mine = list.filter(i => triBox(M, i, cc, g));
    const near = mine.length ? mine : list;
    if (id === FULL || id === full[k]){
      if (k > K){ word(k, x, y, z, near); return; }
      // Every voxel of a small full block gets its own word, in Morton order.
      const each = (kk, X, Y, Z, L2) => {
        if (kk === 0){ word(0, X, Y, Z, L2); return; }
        const ss = 2 ** kk, c2 = [(X + 0.5) * ss, (Y + 0.5) * ss, (Z + 0.5) * ss], m2 = L2.filter(i => triBox(M, i, c2, ss / 2 + 1e-9));
        for (let o = 0; o < 8; o++) each(kk - 1, 2 * X + (o & 1), 2 * Y + (o >> 1 & 1), 2 * Z + (o >> 2), m2.length ? m2 : L2);
      };
      each(k, x, y, z, near);
      return;
    }
    for (let o = 0; o < 8; o++) walk(store.child(id, o), k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2), near);
  };
  const t0 = performance.now();
  walk(root, D, 0, 0, 0, Array.from(all));
  return { words: Uint32Array.from(words), weight: Float64Array.from(weight), ms: performance.now() - t0 };
}
// A unit's rank, from c′ on the way down: binaryoutput §6's walk, with units.
function rankOf(store, U, root, D, x, y, z, K, full){
  let id = root, r = 0;
  for (let k = D - 1; k >= 0; k--){
    if (id === full[k + 1] && k + 1 > K) return r;          // one word stands for this block
    const o = (x >> k & 1) | (y >> k & 1) << 1 | (z >> k & 1) << 2;
    for (let j = 0; j < o; j++) r += U[store.child(id, j)];
    id = store.child(id, o);
    if (id === EMPTY) return -1;
  }
  return r;
}

/* ---- run ------------------------------------------------------------------------------ */
const MESHES = [rock(), hut(), tree()];
say(`# Mesh sketch\n\nMeshes: ${MESHES.map(m => `${m.name} ${m.T.length} triangles`).join(', ')}.\n`);

say('## a. Build: nodes, voxels, time\n');
row(['mesh', 'D', 'mode', 'open parts', 'nodes (pruned)', 'solid voxels', 'build s', 'cells asked', 'triangle tests', 'tests / cell']);
row(Array(10).fill('---'));
const built = [];
for (const m of MESHES) for (const D of DEPTHS) for (const mode of ['centres', 'conservative']){
  const M = prepare(m, D), b = voxelize(M, D, mode);
  const counts = createCounts(b.store), keys = prune(b.store.snapshot().keys, [b.root]);
  const nodes = keys.keys.length / 9;
  row([m.name, D, mode, M.open, fmt(nodes), fmt(counts.of(b.root)), fmt(b.ms / 1000, 1), fmt(b.cells), fmt(b.triTests), fmt(b.triTests / b.cells, 1)]);
  built.push({ m, D, mode, M, ...b, counts });
}

if (DEPTHS.includes(8)){
  say('\n## b. The dense oracle at D = 8\n');
  for (const B of built.filter(b => b.D === 8)){
    const want = denseOracle(B.M, 8, B.mode), got = B.store.expand(B.root, 8);
    let diff = 0; for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) diff++;
    say(`- ${B.m.name}, ${B.mode}: ${diff === 0 ? 'equal, voxel for voxel' : `**${diff} voxels differ**`} (${fmt(want.reduce((s, v) => s + v, 0))} solid)`);
  }
}

say('\n## c. Baked words (centres mode)\n');
row(['mesh', 'D', 'K', 'words', 'shown voxels', 'words / shown', 'MB raw', 'shown on a shared word', 'bake s', 'rank walk ns']);
row(Array(10).fill('---'));
for (const B of built.filter(b => b.mode === 'centres' && b.D <= (quick ? 10 : 11))){
  // Shown voxels, by the fast job at lod 0 over every chunk.
  let shown = 0; const shownCells = [];
  const g = Math.max(1, 2 ** (B.D - 6));
  for (let cz = 0; cz < g; cz++) for (let cy = 0; cy < g; cy++) for (let cx = 0; cx < g; cx++){
    const r = fastChunk(B.store, B.root, B.D, { lod: 0, cx, cy, cz }, { counts: B.counts, lodRule: 'any' });
    shown += r.count;
    if (shownCells.length < 200000) for (let i = 0; i < r.count; i += 7){ const c = r.records[i] & 0x3ffff; let x = 0, y = 0, z = 0; for (let b = 0; b < 6; b++){ x |= (c >> 3 * b & 1) << b; y |= (c >> 3 * b + 1 & 1) << b; z |= (c >> 3 * b + 2 & 1) << b; } shownCells.push([cx * 64 + x, cy * 64 + y, cz * 64 + z]); }
  }
  B.shown = shown;
  const full = []; for (let k = 0; k <= B.D; k++) full.push(B.store.solid(k));
  for (const K of [1, 2, 3]){
    const U = unitsTable(B.store, B.root, B.D, K), bk = bake(B.M, B.store, B.root, B.D, K);
    if (bk.words.length !== U[B.root]) throw new Error(`${B.m.name} D=${B.D} K=${K}: bake made ${bk.words.length} words, c′ says ${U[B.root]}`);
    // Shown voxels whose word stands for more than themselves.
    let shared = 0;
    for (const [x, y, z] of shownCells){
      let id = B.root;
      for (let k = B.D - 1; k >= 0; k--){ if (id === full[k + 1] && k + 1 > K){ shared++; break; } id = B.store.child(id, (x >> k & 1) | (y >> k & 1) << 1 | (z >> k & 1) << 2); }
    }
    const t0 = performance.now(); let chk = 0;
    for (let rep = 0; rep < 4; rep++) for (const [x, y, z] of shownCells) chk += rankOf(B.store, U, B.root, B.D, x, y, z, K, full);
    const ns = (performance.now() - t0) * 1e6 / (4 * shownCells.length);
    if (!(chk > 0)) throw new Error('rank walk');
    row([B.m.name, B.D, K, fmt(bk.words.length), fmt(shown), fmt(bk.words.length / shown, 2), fmt(bk.words.length * 4 / 1e6, 1), `${fmt(100 * shared / shownCells.length, 1)}%`, fmt(bk.ms / 1000, 1), fmt(ns)]);
    if (K === 2) B.baked = { U, ...bk };
  }
}

/* The shell scheme, counted only: every voxel on the faces of a maximal full
   block (a full node whose parent isn't full) gets its own word, and the block's
   interior one more. A shown voxel has an empty neighbour outside its maximal
   block, so it's on that block's face: every shown voxel has its own word. The
   units of a full node depend on which of its faces are its block's faces, a
   function of (node, 6-bit mask), so ranks still come off a table. Not built,
   because the count says not to: 9–22 words a shown voxel on the rock and the
   hut, against K = 1's 1.8–2.9. The maximal blocks of an octree near a surface
   are mostly small, and most of their faces are buried against each other. */
say('\n## c′. The shell scheme (counted, not built)\n');
row(['mesh', 'D', 'words', 'shown voxels', 'words / shown', 'maximal full blocks']);
row(Array(6).fill('---'));
for (const B of built.filter(b => b.mode === 'centres')){
  const full = []; for (let k = 0; k <= B.D; k++) full.push(B.store.solid(k));
  let words = 0, blocks = 0;
  const walk = (id, k) => {
    if (id === EMPTY) return;
    if (id === FULL || id === full[k]){ const s = 2 ** k; blocks++; words += s <= 2 ? s ** 3 : s ** 3 - (s - 2) ** 3 + 1; return; }
    for (let o = 0; o < 8; o++) walk(B.store.child(id, o), k - 1);
  };
  walk(B.root, B.D);
  row([B.m.name, B.D, fmt(words), B.shown ? fmt(B.shown) : '-', B.shown ? fmt(words / B.shown, 2) : '-', fmt(blocks)]);
}

say('\n## d. Exact coarse means from prefix sums (K = 2)\n');
for (const B of built.filter(b => b.baked)){
  const { U, words, weight } = B.baked, n = words.length;
  // Prefix sums of colour × weight, and of weight.
  const S = [new Float64Array(n + 1), new Float64Array(n + 1), new Float64Array(n + 1)], Wt = new Float64Array(n + 1);
  for (let i = 0; i < n; i++){ for (let c = 0; c < 3; c++) S[c][i + 1] = S[c][i] + (words[i] >> 8 * c & 255) * weight[i]; Wt[i + 1] = Wt[i] + weight[i]; }
  // Every node occurrence at level 3 (an 8³ cell) under the root: its range [r, r + U).
  let checked = 0, worst = 0;
  const full = []; for (let k = 0; k <= B.D; k++) full.push(B.store.solid(k));
  const visit = (id, k, r) => {
    if (id === EMPTY || checked > 5000) return;
    if (id === full[k] && k > 2) return;      // one word: its mean is the word
    if (k === 3){
      const a = r, b = r + U[id], w = Wt[b] - Wt[a];
      // Brute force: the same mean by summing the words in the range one by one.
      let br = 0, bw = 0; for (let i = a; i < b; i++){ br += (words[i] & 255) * weight[i]; bw += weight[i]; }
      if (bw !== w) throw new Error('weights');
      worst = Math.max(worst, Math.abs(br / bw - (S[0][b] - S[0][a]) / w));
      if (w !== B.counts.of(id)) throw new Error(`voxels under a node: prefix ${w}, counts ${B.counts.of(id)}`);
      checked++;
      return;
    }
    let rr = r;
    for (let o = 0; o < 8; o++){ const c = B.store.child(id, o); visit(c, k - 1, rr); rr += U[c]; }
  };
  visit(B.root, B.D, 0);
  say(`- ${B.m.name} D=${B.D}: ${fmt(checked)} level-3 cells, each mean in two reads; worst difference from the summed words ${worst.toExponential(1)}; voxel weights equal the node's count`);
}
