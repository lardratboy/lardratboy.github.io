/* ================== LATTICE CORE (pure) ===============================
   The lattice world (docs/lattice3d-plan.md): block-showroom specimens on
   a 3D grid, nx × ny × nz of them, each in an R³ box with R anywhere from
   5 to 64, all in ONE DAG, like the scatter world, so the streamer, both
   paths and the stencil take it unchanged. Pure: imports dag-core.js,
   specimen-core.js and scatter-core.js (whose rotation, fingerprint,
   cutting and merge it reuses).

   A world is a descriptor, latticeDesc({ seed, R, n, gap, rotate, axes,
   align }), and everything follows from it:
   - the LAYOUT (latticeLayout): cell (i, j, k) has its box's low corner
     at gap + (i, j, k)·pitch, pitch = R + gap, so boxes never meet and
     the world starts and ends with a gap. `align` raises the gap until
     the pitch is a power of two, which puts every box inside one block
     of B at the same offset (docs/lattice3d-findings.md §3, §9). i runs
     along x, j up y, k along z; cell c = i + nx·(j + ny·k). Each box is upright (rotation
     0) unless `rotate`, then one of the 24 proper rotations, hashed;
   - the RECIPES (recipeOf). axes 'random': recipe n of specimen-core's
     sampler (shifted by the seed), and cell c gets the c-th whose Oh
     fingerprint wasn't seen before, as in the scatter world. axes
     'traits': cell c's recipe has its symmetry group set by i, its
     density by j and its field by k (each wrapping), the rest hashed,
     so flying along an axis changes one trait. Trait cells don't need
     to be unique, so they skip the fingerprints;
   - the LEVEL STACK (stackOf): R's prime factors, largest outermost
     (12 → 3·2·2, 27 → 3·3·3, 64 → 2⁶). For most recipes the stack only
     matters through R (foldedAxis is linear in u; docs/hashcons-log.md):
     only the six t: fields and tierSymmetry read the digits. A prime R
     is one level, so a t: field has no tiers to work with there, which
     is block-showroom's `classic` (R = 9, one level) behaviour too;
   - the WORLD: every specimen cut into blocks of side B, the power of
     two at least R (scatter-core's splitBlocks), grafted into an empty
     world of side 2^D, the smallest that holds the lattice (D ≥ 6, one
     chunk).

   The build has the scatter world's two passes (A: build and
   fingerprint; B: place in a store of one's own), and the page spreads
   them over the same short-lived workers (scatter-build.js,
   scatter-worker.js dispatch on desc.kind). The merged world is the same
   voxels however the work is split; lattice-core.test.js checks it the
   scatter way, by importing one build into another's store.

   The budget (budgetOf): R and n multiply fast. A specimen costs about
   nodesPerR2(R)·R² nodes (its surface; measured, docs/lattice3d-log.md
   §7), a repeated one in the same turn and phase nothing, and the whole world is copied into every chunk worker, so a lattice
   is refused past LATTICE_LIMITS.nodes estimated nodes or
   LATTICE_LIMITS.specimens specimens. The page's size control stops at
   maxCube(R).

   Uniqueness can run out at small R: at R = 5, 8,000 recipes hold only
   4,100 different specimens (docs/lattice3d-log.md §0). Pass A stops at
   recipeCap(N) recipes, and if fewer than N were unique by then, the
   cells past the last unique one repeat the unique ones in order
   (pickCells). The build reports how many cells repeat.
   ===================================================================== */
import { createStore, pruneWorld, EMPTY } from './dag-core.js';
import { createSpecimenCore, sampleRecipe, hash32 } from './specimen-core.js';
import { rotateOcc, fingerprint, splitBlocks, pickUnique, moreUntil, assignCells, unturn, PROPER, TABLE_WORDS } from './scatter-core.js';

export { TABLE_WORDS };
/* n to 128 a side and 128³ specimens (asked for 2026-11-03: "allow up to
   128^3"); the nodes and D are what stop a lattice before that at most R
   (docs/lattice3d-log.md §5). D stops at 12, the deepest world the viewer
   was tested with (the shapes, the scatter world). */
export const LATTICE_LIMITS = { R: [5, 64], n: [1, 128], gap: [0, 128], nodes: 24e6, specimens: 128 ** 3, D: 12 };
// The default gap between boxes: a quarter of a box, at least 2 voxels.
export const gapOf = R => Math.max(2, Math.round(R / 4));
export const LATTICE_DEFAULTS = { seed: 1, R: 32, n: [8, 8, 8], gap: null, rotate: false, axes: 'random', align: false };
const int = (v, [lo, hi], what) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`lattice: ${what} ${v} is not an integer in ${lo}…${hi}`);
  return v;
};
const pow2At = R => 2 ** Math.ceil(Math.log2(R));

/* The descriptor, filled and checked: the given fields, plus `kind`, the
   resolved gap, pitch, block side B and world depth D. With `align` the
   resolved gap is the one that makes the pitch the next power of two
   (it is idempotent, so a permalink of an aligned lattice holds the gap
   it got, and reads back the same; the aligned gap is checked too, so
   every descriptor accepted reads back). D past LATTICE_LIMITS.D isn't
   refused here: budgetOf says so, as it does for nodes. */
export function latticeDesc(over = {}){
  const d = { ...LATTICE_DEFAULTS, ...over, kind: 'lattice' };
  d.n = Array.isArray(d.n) ? d.n.slice(0, 3) : [d.n, d.n, d.n];
  int(d.R, LATTICE_LIMITS.R, 'R');
  d.n.forEach((v, a) => int(v, LATTICE_LIMITS.n, 'xyz'[a] + ' size'));
  if (d.gap == null) d.gap = gapOf(d.R);
  int(d.gap, LATTICE_LIMITS.gap, 'gap');
  int(d.seed, [1, 0xffff], 'seed');
  if (d.axes !== 'random' && d.axes !== 'traits') throw new Error(`lattice: axes '${d.axes}'`);
  d.rotate = !!d.rotate;
  d.align = !!d.align;
  if (d.align) int(d.gap = pow2At(d.R + d.gap) - d.R, LATTICE_LIMITS.gap, 'aligned gap');
  d.pitch = d.R + d.gap;
  d.B = pow2At(d.R);
  d.D = Math.max(6, Math.ceil(Math.log2(Math.max(...d.n) * d.pitch + d.gap)));
  return d;
}

/* R's prime factors, largest first (index 0 is the outermost level). */
export function stackOf(R){
  const f = [];
  let r = R;
  for (let p = 2; p * p <= r; p++) while (r % p === 0){ f.push(p); r /= p; }
  if (r > 1) f.push(r);
  return f.sort((a, b) => b - a).map(radix => ({ radix, gap: 0 }));
}

/* ---- the budget ------------------------------------------------------------
   An estimate of the pruned world's nodes, the smaller of two bounds:

   1. Per specimen: nodesPerR2(R)·R² a specimen, everything included (its
      blocks' nodes and its share of the tree above them). Measured pruned
      over R = 5 … 64, n = 3 … 16, the default gap and gap 0, upright and
      turned, random and traits (docs/lattice3d-log.md §7): the worst is
      0.236 at R = 5, 0.274 at R = 28, 0.375 at R = 63, each at the
      smallest n, where the least is shared (at 128³, R = 5 is 0.057–
      0.080). The ramp 0.25 + 0.003·R is above every one, and it's 0.4,
      the old flat rate, from R = 50 up, so no lattice gets less room
      than before.
   2. By repeats, when B divides the pitch: then every specimen sits at
      the same offset in a block of its own (x0 mod B = B − R), so one
      placed again in the same turn is the same block, and hash-consing
      makes it free. Pass A stops at recipeCap(N) recipes, so a random
      lattice has at most that many different specimens, times 24 turns
      if turned. Those are charged bound 1's rate; the tree above the
      blocks isn't shared, so it's charged in full: every cell above
      block level a node (upperTree). That lets R = 6 … 13 reach 128³
      when aligned (R = 6 and 13 by default: their pitches are 8 and 16).
      Only then: with any other pitch, neighbours share blocks, and
      graft's unions make nodes that belong to one place, which nothing
      here counts. (Other pitches never gained from it anyway: a pitch of
      12 against blocks of 8 already has 8 offsets, 8 × 2^18 = 2M.)
   'traits' lattices have every cell its own recipe: bound 2 is N.
   NODES_SHARED pays for what every lattice shares, once (the 255 level-1
   nodes, the common 4³ patterns), so small lattices are covered too.
   LATTICE_LIMITS.nodes is 24M (R = 5 at 128³ was 21M estimated at the
   old rate; 3.0–4.2M real once pruned). */
export const NODES_SHARED = 65536;
export const nodesPerR2 = R => Math.min(0.4, 0.25 + 0.003 * R);
export const specimensOf = desc => desc.n[0] * desc.n[1] * desc.n[2];
export const nodesPerSpecimen = R => nodesPerR2(R) * R * R;
// One block a specimen, all at the same offset in it: bound 2 holds.
export const oneBlock = desc => desc.pitch % desc.B === 0;
// The most different blocks a lattice of one block a specimen can place.
export function distinctOf(desc){
  const N = specimensOf(desc);
  return desc.axes === 'traits' ? N : Math.min(N, recipeCap(N) * (desc.rotate ? 24 : 1));
}
// Every cell from 2B up to the world, as if each held a node of its own.
export function upperTree(desc){
  let cells = 0;
  for (let side = 2 * desc.B; side <= 2 ** desc.D; side *= 2)
    cells += desc.n.reduce((p, n) => p * Math.ceil((n * desc.pitch + desc.gap) / side), 1);
  return cells;
}
export function estimateNodes(desc){
  const per = nodesPerSpecimen(desc.R);
  const bound1 = specimensOf(desc) * per;
  return NODES_SHARED + Math.ceil(oneBlock(desc) ? Math.min(bound1, distinctOf(desc) * per + upperTree(desc)) : bound1);
}
export function budgetOf(desc){
  const specimens = specimensOf(desc), nodes = estimateNodes(desc), span = Math.max(...desc.n) * desc.pitch + desc.gap;
  const reason = specimens > LATTICE_LIMITS.specimens ? `${specimens.toLocaleString()} specimens (at most ${LATTICE_LIMITS.specimens.toLocaleString()})`
    : nodes > LATTICE_LIMITS.nodes ? `~${(nodes / 1e6).toFixed(1)}M nodes (at most ${LATTICE_LIMITS.nodes / 1e6}M)`
    : desc.D > LATTICE_LIMITS.D ? `${span.toLocaleString()} voxels across (at most ${(2 ** LATTICE_LIMITS.D).toLocaleString()})` : null;
  return { ok: !reason, specimens, nodes, reason };
}
// The largest cube side within the budget at R, with this gap (and align).
export function maxCube(R, { gap = null, align = false } = {}){
  let n = 1;
  while (n < LATTICE_LIMITS.n[1] && budgetOf(latticeDesc({ R, n: n + 1, gap, align })).ok) n++;
  return n;
}

/* ---- the layout ------------------------------------------------------------ */
export function latticeLayout(desc){
  const { n: [nx, ny, nz], gap, pitch, seed, rotate } = desc, cells = [];
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++){
    const h = hash32(hash32(i + nx * (j + ny * k), seed * 0x9e3779b1), 0x7f4a7c15);
    cells.push({ i, j, k, x0: gap + i * pitch, y0: gap + j * pitch, z0: gap + k * pitch, rot: rotate ? PROPER[h % 24] : 0 });
  }
  return { side: 2 ** desc.D, perAxis: desc.n.slice(), cells };
}

/* ---- recipes -----------------------------------------------------------------
   Recipe n of the lattice: in 'random', the sampler's recipe n + base,
   where the seed picks base, so lattice:2 is a different set of
   specimens; in 'traits', cell n's own recipe. */
const SEED_STRIDE = 0x100000;
export function recipeOf(core, desc, n){
  const levels = stackOf(desc.R), base = (desc.seed - 1) * SEED_STRIDE;
  if (desc.axes !== 'traits') return sampleRecipe(core, base + n, levels);
  const [nx, ny] = desc.n, i = n % nx, j = Math.floor(n / nx) % ny, k = Math.floor(n / (nx * ny));
  return sampleRecipe(core, base + n, levels, { sym: i % core.GROUPS.length, density: 0.10 + (j % 12) * 0.055, field: k % core.FIELD_NAMES.length });
}
const coreCache = { core: null };
const specimenCore = () => coreCache.core || (coreCache.core = createSpecimenCore());
export function buildRecipe(desc, n){
  const core = specimenCore(), r = recipeOf(core, desc, n), b = core.buildBlock(r.P, r.levels);
  if (b.R !== desc.R) throw new Error(`lattice: recipe ${n} built R = ${b.R}, not ${desc.R}`);
  return b.occ;
}

/* ---- the passes ------------------------------------------------------------- */
/* Pass A ('random' only): recipes [n0, n1), built and fingerprinted.
   `keep` (a Map) gets each occupancy, so pass B needn't build it again,
   up to KEEP_VOXELS voxels a keeper: at 128³ and R = 16 that would be
   0.9 GB, and past it pass B builds the rest again (placeRange). */
export const KEEP_VOXELS = 2 ** 26;
export function printRange(desc, n0, n1, keep = null){
  const out = [], room = Math.floor(KEEP_VOXELS / desc.R ** 3);
  for (let n = n0; n < n1; n++){
    const occ = buildRecipe(desc, n);
    if (keep && keep.size < room) keep.set(n, occ);
    out.push(fingerprint(occ, desc.R));
  }
  return out;
}
/* How far pass A may go for N cells, and which recipe each cell gets:
   the first N unique ones, or, once the cap is reached, the unique ones
   found, repeated in order. Fewer than N means "more recipes".
   The cap is 4N + 64, and never more than RECIPE_CAP: at 128³ (2M cells)
   4N would be 8M recipes, half an hour on one thread at R = 5 for a
   yield near nothing (docs/lattice3d-log.md §5). 2^18 is above 4N + 64
   for every lattice up to 40³, so the lattices before 128³ build as they
   did. Past that it binds even at R = 16: its largest cube (61³, 226,981
   cells) found 165,929 different specimens in 2^18 recipes, and 61,052
   cells repeat (lattice3d-results.md §4). */
export const RECIPE_CAP = 2 ** 18;
export const recipeCap = N => Math.min(4 * N + 64, RECIPE_CAP);
export function nextRange(have, N, picked){
  const n1 = Math.min(recipeCap(N), moreUntil(have, N, picked));
  // pickCells fills every cell once the cap is reached, so asking again
  // with nothing left to try is a bug, not a slow build.
  if (n1 <= have) throw new Error(`lattice: pass A at its cap (${have} recipes) with ${picked} of ${N} cells`);
  return n1;
}
export function pickCells(prints, N){
  const u = pickUnique(prints, N);
  if (u.length >= N || prints.length < recipeCap(N) || !u.length) return u;
  return Array.from({ length: N }, (_, c) => u[c % u.length]);
}
// Every cell's recipe in 'traits': its own.
export const traitPicks = N => Array.from({ length: N }, (_, c) => c);
/* Pass B's jobs for some cells: scatter-core's assignCells for those
   cells only, so the page makes 32K job objects at a time, not 2M. */
export const cellJobs = (layout, picked, cells) => cells.map(cell => ({ n: picked[cell], cell, ...layout.cells[cell] }));

/* Pass B: each { n, cell } placed in `store`: the specimen (from `occs`,
   or built again), turned by the cell's rotation, cut into blocks of side
   B. Returns the blocks and each placement's voxel count. */
export function placeRange(desc, jobs, store, occs = null){
  const blocks = [], placed = [], { R, B } = desc;
  for (const { n, cell, x0, y0, z0, rot } of jobs){
    const occ = (occs && occs.get(n)) || buildRecipe(desc, n), rocc = rot ? rotateOcc(occ, R, rot) : occ;
    let count = 0;
    for (let i = 0; i < occ.length; i++) count += occ[i];
    for (const b of splitBlocks(store, rocc, R, x0, y0, z0, B)) blocks.push(b);
    placed.push({ cell, n, count });
  }
  return { blocks, placed };
}
/* One part of pass B into the world's store, as scatter-core's mergePart:
   its keys imported (null: placed in the world's store already), its
   blocks' ids mapped, its placements written to the table, one row of
   TABLE_WORDS per cell: recipe n, rotation, x0, y0, z0, voxels. */
export function mergePart(store, layout, table, blocks, { keys, blocks: b, placed }){
  const map = keys ? store.importKeys(keys) : null;
  // In place: the part's blocks are its own, and at 128³ a copy of each
  // was 5M more objects on the page's heap (docs/lattice3d-log.md §5).
  for (const x of b){ if (map) x.node = map[x.node]; blocks.push(x); }
  for (const { cell, n, count } of placed){
    const c = layout.cells[cell];
    table.set([n, c.rot, c.x0, c.y0, c.z0, count], TABLE_WORDS * cell);
  }
}
// What the build tells the HUD about its picks.
// (No spreads over picked or prints: at 128³ they're 2M long, past the
// engine's argument limit.)
export function pickStats(picked){
  const unique = new Set(picked).size;
  let last = -1;
  for (const n of picked) if (n > last) last = n;
  return { unique, repeats: picked.length - unique, skipped: last + 1 - unique };
}

// pruneWorld moved to dag-core (the scatter world prunes too); re-exported for the tests and the page.
export { pruneWorld };

/* ---- the whole build, on one thread -----------------------------------------
   `parts` splits pass B into that many stores merged by importKeys, as the
   page's workers do; the test builds 1 and 3 parts and requires the same
   world. */
export function buildLattice(desc, { parts = 1, onPhase = () => {} } = {}){
  const t = {}, mark = (k, t0) => { t[k] = (t[k] || 0) + performance.now() - t0; };
  const layout = latticeLayout(desc), N = layout.cells.length, store = createStore(), occs = new Map();
  let t0 = performance.now(), picked;
  onPhase('specimens');
  if (desc.axes === 'traits') picked = traitPicks(N);
  else {
    const prints = [];
    picked = [];
    while (picked.length < N){
      for (const p of printRange(desc, prints.length, nextRange(prints.length, N, picked.length), occs)) prints.push(p);
      picked = pickCells(prints, N);
    }
  }
  mark('build', t0);
  t0 = performance.now();
  onPhase('placing');
  const jobs = assignCells(layout, picked), blocks = [], table = new Int32Array(TABLE_WORDS * N);
  for (let p = 0; p < parts; p++){
    const local = parts === 1 ? store : createStore();
    const part = placeRange(desc, jobs.filter((_, k) => k % parts === p), local, occs);
    mergePart(store, layout, table, blocks, { ...part, keys: parts === 1 ? null : local.snapshot().keys });
  }
  occs.clear();
  mark('place', t0);
  t0 = performance.now();
  onPhase('grafting');
  const grafted = store.graft(EMPTY, desc.D, Math.log2(desc.B), blocks);
  mark('graft', t0);
  t0 = performance.now();
  const { store: world, root, dropped } = pruneWorld(store, grafted);
  mark('prune', t0);
  return { store: world, root, D: desc.D, table, layout, picked, ...pickStats(picked), blocks: blocks.length, ms: t, nodes: world.size, dropped };
}

/* ---- colour -------------------------------------------------------------------
   block-showroom's gamut colour, as the scatter world's: a point in a box
   reads its position in the specimen's own unturned frame, over R, as
   RGB. Anything else is grey (there are no voxels there, but a coarse
   mean can sample a gap). desc carries the table. */
export function latticeColour(desc, rgb8){
  const { table, pitch, gap, R, n: [nx, ny, nz] } = desc, grey = rgb8(128, 128, 128);
  return (x, y, z) => {
    const i = Math.floor((x - gap) / pitch), j = Math.floor((y - gap) / pitch), k = Math.floor((z - gap) / pitch);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return grey;
    const o = TABLE_WORDS * (i + nx * (j + ny * k)), x0 = table[o + 2], y0 = table[o + 3], z0 = table[o + 4];
    if (x < x0 || x >= x0 + R || y < y0 || y >= y0 + R || z < z0 || z >= z0 + R) return grey;
    const u = unturn([x - x0, y - y0, z - z0], R, table[o + 1]);
    return rgb8(255 * u[0] / R, 255 * u[1] / R, 255 * u[2] / R);
  };
}

/* ---- the permalink ------------------------------------------------------------
   ?lattice=R,nx,ny,nz,gap,rotate,axes,align (the seed is the world id's,
   lattice:<seed>). Links from before align have 7 fields and read as
   align 0. */
export const latticeParam = d => [d.R, ...d.n, d.gap, d.rotate ? 1 : 0, d.axes, d.align ? 1 : 0].join(',');
export function latticeFromParam(s, seed = 1){
  const [R, nx, ny, nz, gap, rot, axes, align] = String(s).split(',');
  return latticeDesc({ seed, R: +R, n: [+nx, +ny, +nz], gap: gap === undefined || gap === '' ? null : +gap,
                       rotate: rot === '1', axes: axes || 'random', align: align === '1' });
}
