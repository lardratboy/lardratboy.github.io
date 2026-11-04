/* ================== SCATTER CORE (pure) ===============================
   The scatter world (docs/scatter-plan.md): block-showroom specimens on a
   terrain, every one unique, each turned by one of the 24 rotations of
   the cube and resting on the ground's voxels, all in ONE DAG, so the
   streamer, both paths and the stencil take it like any other world.
   Pure: imports dag-core.js, specimen-core.js and the shapes.

   A world is a descriptor, { seed, D, pitch, R, ground }, and everything
   follows from it:
   - the LAYOUT (scatterLayout): the ground is cut into cells of pitch P
     in x and z, one specimen per cell, its R³ box at a hashed offset with
     at least `margin` voxels to the cell's edge, so no two boxes meet,
     and a hashed proper rotation;
   - the SPECIMENS: recipe n = 0, 1, 2, … of specimen-core's sampler,
     skipping any whose Oh fingerprint was seen before, so no two placed
     specimens are the same shape however turned. Cell c gets the c-th
     survivor;
   - the PLACEMENT (placeSpecimen): rotate, rest on the ground (the lowest
     y at which no voxel is inside it, so at least one stands on it), cut
     into the world's R³ blocks, intern them;
   - the WORLD: the ground built top-down (fromField), the blocks grafted
     in (dag-core's graft, a union per block).

   The build runs in two passes because uniqueness needs every earlier
   recipe's fingerprint before a cell can be given its specimen:
     A  fingerprintRange: build recipes, fingerprint them, keep the
        occupancy (a worker keeps its own; docs/scatter-plan.md,
        decision 8);
     B  placeRange: for the recipes chosen, place each in its cell, in a
        store of the caller's (a worker's own), returning the blocks.
   buildScatter does both on one thread (Node, the tests, the pool's
   fallback); the page spreads them over its workers and merges with
   dag-core's importKeys. The merged world is the same set of voxels
   however the work was split; scatter-core.test.js checks that by
   importing one build into another's store, where equal content must
   come out as the equal id.

   Coordinates: voxels, x and z across the ground, y up; a box's low
   corner is (x0, y0, z0). An Oh element e acts as dag-core's applyG on
   coordinates centred in the box: w[i] = ±v[PERM[e >> 3][i]], minus
   where bit i of e is set.
   ===================================================================== */
import { createStore, pruneWorld } from './dag-core.js';
import { createSpecimenCore, sampleRecipe, binaryLevels, hash32 } from './specimen-core.js';
import { SHAPES, fieldOf, colourFieldOf } from './experiments/shapes.mjs';

export const SCATTER_DEFAULTS = { seed: 1, D: 12, pitch: 128, R: 64, margin: 4, ground: 'hills' };
export const scatterDesc = (over = {}) => ({ ...SCATTER_DEFAULTS, ...over });

/* ---- the 24 rotations --------------------------------------------------- */
const PERM = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const PERM_SIGN = [1, -1, -1, 1, 1, -1];
const detOf = e => PERM_SIGN[e >> 3] * (((e & 1) + (e >> 1 & 1) + (e >> 2 & 1)) & 1 ? -1 : 1);
// The Oh elements with determinant +1: rotations, no mirror images.
export const PROPER = Array.from({ length: 48 }, (_, e) => e).filter(e => detOf(e) === 1);

/* occ (R³, x fastest) turned by e about the box's centre. */
export function rotateOcc(occ, R, e){
  const P = PERM[e >> 3], out = new Uint8Array(R * R * R), v = [0, 0, 0];
  const fl = [e & 1, e >> 1 & 1, e >> 2 & 1];
  for (let z = 0, i = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++, i++){
    if (!occ[i]) continue;
    v[0] = x; v[1] = y; v[2] = z;
    const a = fl[0] ? R - 1 - v[P[0]] : v[P[0]], b = fl[1] ? R - 1 - v[P[1]] : v[P[1]], c = fl[2] ? R - 1 - v[P[2]] : v[P[2]];
    out[a + R * (b + R * c)] = 1;
  }
  return out;
}
/* The point u (box coordinates, 0…R) that e turned into w: the inverse,
   for the colour field, which asks about the turned specimen. */
export function unturn(w, R, e){
  const P = PERM[e >> 3], u = [0, 0, 0];
  for (let i = 0; i < 3; i++) u[P[i]] = (e >> i & 1) ? R - w[i] : w[i];
  return u;
}

/* ---- uniqueness ---------------------------------------------------------
   An Oh fingerprint: the minimum, over the 48 elements of Oh, of a 64-bit
   hash of the transformed voxel set. The set {g·h·S : g ∈ Oh} is
   {g·S : g ∈ Oh}, so a turned or mirrored copy has the same minimum, and
   a true duplicate is never missed; two different shapes share one only
   by a 64-bit collision. The hash of a set is order-free: per voxel,
   random per-axis tables summed and mixed, then summed over the voxels,
   in two lanes. scatter-core.test.js holds it to dag-core's classes.

   The first version hashed each voxel's orbit under Oh (its centred
   coordinates up to sign and order), invariant by construction and one
   pass instead of 48. It merged two pairs of different specimens among
   the first 1,040 recipes (59 and 226, 331 and 388): their voxels fall
   in the same orbits in the same numbers, and specimens built from
   symmetry groups do that (docs/scatter-log.md §3). */
const AXIS_TABLES = (() => {
  const t = new Uint32Array(6 * 256);
  for (let i = 0; i < t.length; i++) t[i] = hash32(i, 0x9e3779b1);
  return t;
})();
export function fingerprint(occ, R){
  if (R > 256) throw new Error('fingerprint: R > 256');
  let n = 0;
  for (let i = 0; i < occ.length; i++) n += occ[i];
  const c = new Uint8Array(3 * n);
  for (let z = 0, i = 0, k = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++, i++)
    if (occ[i]){ c[k++] = x; c[k++] = y; c[k++] = z; }
  let best1 = 0xffffffff, best2 = 0xffffffff;
  const T = AXIS_TABLES;
  for (let e = 0; e < 48; e++){
    const P = PERM[e >> 3], f0 = e & 1, f1 = e >> 1 & 1, f2 = e >> 2 & 1, p0 = P[0], p1 = P[1], p2 = P[2];
    let h1 = 0, h2 = 0;
    for (let k = 0; k < c.length; k += 3){
      const a = f0 ? R - 1 - c[k + p0] : c[k + p0], b = f1 ? R - 1 - c[k + p1] : c[k + p1], d = f2 ? R - 1 - c[k + p2] : c[k + p2];
      let u = (T[a] + T[256 + b] + T[512 + d]) >>> 0, v = (T[768 + a] + T[1024 + b] + T[1280 + d]) >>> 0;
      u = Math.imul(u ^ (u >>> 15), 0x2c1b3c6d); u ^= u >>> 12;
      v = Math.imul(v ^ (v >>> 13), 0x297a2d39); v ^= v >>> 15;
      h1 = (h1 + u) >>> 0; h2 = (h2 + v) >>> 0;
    }
    if (h1 < best1 || (h1 === best1 && h2 < best2)){ best1 = h1; best2 = h2; }
  }
  return `${n}:${best1.toString(16)}:${best2.toString(16)}`;
}

/* ---- the layout -----------------------------------------------------------
   Cells of pitch P across the ground; each one's box at a hashed offset
   in [margin, P − R − margin] on x and z, and a hashed proper rotation.
   Row-major in (i, j), i along x. */
export function scatterLayout(desc){
  const { seed, D, pitch, R, margin } = desc, side = 2 ** D, n = Math.floor(side / pitch), span = pitch - R - 2 * margin + 1;
  if (span < 1) throw new Error(`scatter: pitch ${pitch} leaves no room for R = ${R} with margin ${margin}`);
  const cells = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++){
    const h = hash32(hash32(i, seed * 0x9e3779b1), j * 977 + 13);
    cells.push({ i, j, x0: i * pitch + margin + h % span, z0: j * pitch + margin + hash32(h, 0x85ebca6b) % span,
                 rot: PROPER[hash32(h, 0xc2b2ae35) % 24] });
  }
  return { side, perAxis: n, cells };
}

/* ---- the ground ------------------------------------------------------------
   The ground's top voxel in world column (X, Z): the largest Y whose
   centre is inside the shape, found from the shape's own `inside`, the
   expression fromField decides voxels with, so "resting on the ground"
   means on the voxels the DAG really holds. The ground is a heightfield
   (inside is monotone in y), so a guess from the height and a step or two
   either way finds it. -1: no ground in this column. */
export function groundOf(desc){
  const shape = SHAPES.find(s => s.name === desc.ground);
  if (!shape) throw new Error(`scatter: no shape '${desc.ground}'`);
  const side = 2 ** desc.D, p = i => (2 * i + 1) / side - 1;
  const top = (X, Z) => {
    const x = p(X), z = p(Z), inside = Y => Y >= 0 && Y < side && shape.inside(x, p(Y), z);
    let Y = Math.max(-1, Math.min(side - 1, Math.floor(((-shape.f(x, 0, z) + 1) * side - 1) / 2)));
    while (Y + 1 < side && inside(Y + 1)) Y++;
    while (Y >= 0 && !inside(Y)) Y--;
    return Y;
  };
  return { shape, top, field: fieldOf(shape, desc.D) };
}

/* The resting height: the lowest y0 at which every occupied column of the
   turned specimen has its lowest voxel above the ground's top voxel, so
   no voxel is buried and at least one stands directly on the ground. */
export function restingY(rocc, R, x0, z0, top){
  let y0 = 0;
  for (let z = 0; z < R; z++) for (let x = 0; x < R; x++){
    let yb = -1;
    for (let y = 0; y < R; y++) if (rocc[x + R * (y + R * z)]){ yb = y; break; }
    if (yb >= 0) y0 = Math.max(y0, top(x0 + x, z0 + z) + 1 - yb);
  }
  return y0;
}

/* The turned specimen at (x0, y0, z0), cut along the world's B-aligned
   grid into up to 8 blocks of side B, each interned in `store`:
   [{ x, y, z, node }] at block coordinates, level log2(B). B is a power
   of two at least R, so a box still meets at most two blocks an axis:
   the scatter world's R = 64 cuts at B = R, the lattice world's R = 5 … 64
   at the next power of two up (lattice-core.js). */
export function splitBlocks(store, rocc, R, x0, y0, z0, B = R){
  // Per axis, which of the (at most) two blocks a box coordinate falls in
  // and where in it: the first version keyed a Map by a string per voxel,
  // which was most of the placement's time (docs/scatter-log.md §3).
  if (B < R || (B & (B - 1))) throw new Error(`splitBlocks: block side ${B} for R = ${R}`);
  const b0 = [Math.floor(x0 / B), Math.floor(y0 / B), Math.floor(z0 / B)], o = [x0, y0, z0];
  const half = [0, 1, 2].map(a => Uint8Array.from({ length: R }, (_, u) => (o[a] + u) >= (b0[a] + 1) * B ? 1 : 0));
  const local = [0, 1, 2].map(a => Uint32Array.from({ length: R }, (_, u) => o[a] + u - (b0[a] + half[a][u]) * B));
  const grids = new Array(8).fill(null), BB = B * B;
  for (let z = 0, i = 0; z < R; z++){
    const hz = half[2][z] << 2, lz = local[2][z] * BB;
    for (let y = 0; y < R; y++){
      const hy = hz | half[1][y] << 1, ly = lz + local[1][y] * B;
      for (let x = 0; x < R; x++, i++){
        if (!rocc[i]) continue;
        const g = hy | half[0][x];
        (grids[g] || (grids[g] = new Uint8Array(BB * B)))[ly + local[0][x]] = 1;
      }
    }
  }
  const out = [];
  grids.forEach((occ, g) => { if (occ) out.push({ x: b0[0] + (g & 1), y: b0[1] + (g >> 1 & 1), z: b0[2] + (g >> 2), node: store.fromDense(occ, B).root }); });
  return out;
}

/* ---- the two passes ------------------------------------------------------- */
const coreCache = { core: null };
const specimenCore = () => coreCache.core || (coreCache.core = createSpecimenCore());

// Pass A: recipes [n0, n1), built and fingerprinted. `keep` (a Map) gets each occupancy.
export function fingerprintRange(desc, n0, n1, keep = null){
  const core = specimenCore(), levels = binaryLevels(Math.log2(desc.R)), out = [];
  for (let n = n0; n < n1; n++){
    const r = sampleRecipe(core, n, levels), b = core.buildBlock(r.P, r.levels);
    if (b.R !== desc.R) throw new Error(`scatter: recipe ${n} built R = ${b.R}`);
    if (keep) keep.set(n, b.occ);
    out.push(fingerprint(b.occ, desc.R));
  }
  return out;
}
/* The first `count` recipes whose fingerprints weren't seen before, from
   the fingerprints of recipes 0, 1, 2, … in order. Fewer than `count`
   means more recipes are needed. */
export function pickUnique(prints, count){
  const seen = new Set(), picked = [];
  for (let n = 0; n < prints.length && picked.length < count; n++){
    if (seen.has(prints[n])) continue;
    seen.add(prints[n]); picked.push(n);
  }
  return picked;
}
/* Pass B: each { n, cell } placed in `store`: the specimen (from `occs`,
   or built again) turned by the cell's rotation and rested on the ground.
   Returns the blocks and each placement's y0. */
export function placeRange(desc, jobs, store, occs = null, ground = groundOf(desc)){
  const core = specimenCore(), levels = binaryLevels(Math.log2(desc.R)), blocks = [], placed = [];
  for (const { n, cell, x0, z0, rot } of jobs){
    let occ = occs && occs.get(n);
    if (!occ){ const r = sampleRecipe(core, n, levels); occ = core.buildBlock(r.P, r.levels).occ; }
    const rocc = rotateOcc(occ, desc.R, rot), y0 = restingY(rocc, desc.R, x0, z0, ground.top);
    if (y0 + desc.R > 2 ** desc.D) throw new Error(`scatter: cell ${cell} rests above the world (y0 ${y0})`);
    for (const b of splitBlocks(store, rocc, desc.R, x0, y0, z0)) blocks.push(b);
    placed.push({ cell, n, y0 });
    if (occs) occs.delete(n);
  }
  return { blocks, placed };
}

/* The placement table, one row of 6 per cell: recipe n, rotation, x0,
   y0, z0, and the fingerprint's count (the voxels placed). It goes in
   the colour descriptor (scatterColour) and the experiment. */
export const TABLE_WORDS = 6;

/* ---- assembling a world ---------------------------------------------------
   The steps between the passes, shared by buildScatter and the page's
   workers (scatter-build.js), so the merge the page does is the one the
   tests check.

   How far pass A must go: recipes [0, moreUntil(…)) cover `count` cells
   with a few to spare for duplicates (4 in the first 1,024), and a
   shortfall asks for 10% more of what is missing. */
export const moreUntil = (have, count, picked) => have + Math.ceil((count - picked) * (have ? 1.1 : 1.02)) + 4;
// Cell c gets the c-th surviving recipe: pass B's jobs.
export const assignCells = (layout, picked) => picked.map((n, cell) => ({ n, cell, ...layout.cells[cell] }));
/* One part of pass B into the world's store: its store's keys imported
   (null: placed in the world's store already), its blocks' ids mapped,
   its placements written to the table. */
export function mergePart(store, layout, prints, table, blocks, { keys, blocks: b, placed }){
  const map = keys ? store.importKeys(keys) : null;
  for (const x of b) blocks.push(map ? { ...x, node: map[x.node] } : x);
  for (const { cell, n, y0 } of placed){
    const c = layout.cells[cell];
    table.set([n, c.rot, c.x0, y0, c.z0, Number(prints[n].split(':')[0])], TABLE_WORDS * cell);
  }
}

/* ---- the whole build, on one thread ------------------------------------------
   `parts` splits pass B into that many stores merged by importKeys, as
   the page's workers do; the test builds 1 and 3 parts and requires the
   same world. */
export function buildScatter(desc, { parts = 1, onPhase = () => {} } = {}){
  const t = {}, mark = (k, t0) => { t[k] = (t[k] || 0) + performance.now() - t0; };
  const layout = scatterLayout(desc), N = layout.cells.length, store = createStore(), ground = groundOf(desc);
  let t0 = performance.now();
  onPhase('ground');
  const { root: groundRoot } = store.fromField(desc.D, ground.field);
  mark('ground', t0); t.groundNodes = store.size;
  t0 = performance.now();
  onPhase('specimens');
  const occs = new Map(), prints = [];
  let picked = [];
  while (picked.length < N){
    prints.push(...fingerprintRange(desc, prints.length, moreUntil(prints.length, N, picked.length), occs));
    picked = pickUnique(prints, N);
  }
  mark('build', t0);
  t0 = performance.now();
  onPhase('placing');
  const jobs = assignCells(layout, picked), blocks = [], table = new Int32Array(TABLE_WORDS * N);
  for (let p = 0; p < parts; p++){
    const local = parts === 1 ? store : createStore();
    const part = placeRange(desc, jobs.filter((_, k) => k % parts === p), local, occs, ground);
    mergePart(store, layout, prints, table, blocks, { ...part, keys: parts === 1 ? null : local.snapshot().keys });
  }
  mark('place', t0);
  t0 = performance.now();
  onPhase('grafting');
  const grafted = store.graft(groundRoot, desc.D, Math.log2(desc.R), blocks);
  mark('graft', t0);
  // Pruned as the lattice is: 3–4% of the store is pieces graft() unioned
  // (1,699,608 nodes to 1,643,104 at D = 12; docs/lattice3d-log.md §8).
  t0 = performance.now();
  const { store: world, root, dropped } = pruneWorld(store, grafted);
  mark('prune', t0);
  return { store: world, root, D: desc.D, table, layout, prints, picked, blocks: blocks.length,
           skipped: picked[N - 1] + 1 - N, ms: t, nodes: world.size, dropped };
}

/* ---- colour -----------------------------------------------------------------
   docs/scatter-plan.md, decision 10. The ground's own colour, except in a
   specimen's box above the ground, where it is block-showroom's gamut
   colour: the point's position in the specimen's own unturned frame, over
   R, as RGB, so the colour turns with the specimen. A point in voxel
   units (voxel i's centre is i + 0.5), 8-bit RGB packed by rgb8, as every
   colour field. desc carries the table (buildScatter's), and the field
   finds a point's cell, so its specimen, in O(1). */
export function scatterColour(desc, rgb8){
  const ground = SHAPES.find(s => s.name === desc.ground), groundColour = colourFieldOf(ground, desc.D);
  const { table, pitch, R } = desc, side = 2 ** desc.D, perAxis = Math.floor(side / pitch), s = 2 / side;
  return (x, y, z) => {
    const i = Math.floor(x / pitch), j = Math.floor(z / pitch);
    if (i >= 0 && j >= 0 && i < perAxis && j < perAxis){
      const o = TABLE_WORDS * (j * perAxis + i), x0 = table[o + 2], y0 = table[o + 3], z0 = table[o + 4];
      if (x >= x0 && x < x0 + R && y >= y0 && y < y0 + R && z >= z0 && z < z0 + R && !ground.inside(x * s - 1, y * s - 1, z * s - 1)){
        const u = unturn([x - x0, y - y0, z - z0], R, table[o + 1]);
        return rgb8(255 * u[0] / R, 255 * u[1] / R, 255 * u[2] / R);
      }
    }
    return groundColour(x, y, z);
  };
}
