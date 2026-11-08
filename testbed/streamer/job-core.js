/* ================== JOB CORE (pure) ==================================
   fastChunk: the chunk job, faster, and byte for byte the same records,
   words, counts and seam tail as chunk-core's expandChunk with seams
   (docs/computedags.md §9 step 1, docs/job-speed-log.md).

   expandChunk stays the reference. CLAUDE.md keeps shortcuts out of it so
   the dense oracles in test/chunk-core.test.js and test/attrs.test.js hold
   the plain walk, and test/job-core.test.js holds this one to it on every
   chunk of a dozen worlds, every lod rule and with colour. The job runner
   (stream-core's createJobRunner) calls this one.

   Where the reference spends its time (computedags.md §1): terrain and caves
   walk 262,144 occupied cells to show about 4,000, because most of a chunk at
   the surface is rock. Three changes, each exact:

   1. **Full nodes list only their shell.** A completely full node of side
      s ≥ 4 cells has (s − 2)³ interior cells whose six neighbours all lie
      inside it, so they show no face. None of them is on the chunk's
      boundary either (a node inside the chunk that reaches a chunk face does
      so with its own face), so none can join the seam tail. The walk fills
      the node's block of the occupancy grid at once, row by row, lists the
      cells on its six faces in Morton order, and adds the interior to
      `occupied` as a number. The face loop then never sees the interior.
      The same in an apron slab: a full node fills its part of the slab and
      stops.

   2. **A per-brick rule's choice is a function of the brick's node** (the
      lod-rule rule in CLAUDE.md, which brick dedup already rests on). So the
      kept cells of a brick are computed once per (rule, lod, node) as a
      512-bit mask, 64 bytes, and every later occurrence walks the brick
      guided by the mask: no listing, no sort. computedags.md §5 proposed it
      for the GPU; it pays on the CPU first. A full brick keeps every cell
      under every rule we draw with (checked once per job, not assumed), so
      it never needs a mask and takes path 1.

   3. **The seam test asks each coarse neighbour once, from near by.** A
      buried boundary cell joins the tail if a coarser neighbour across one of
      its boundary faces isn't full. The reference walks from the root for
      each of up to six faces of up to 24K cells, and 2×2 boundary cells share
      one coarse neighbour. Here each answer is cached for the job, and the
      walk starts from the neighbouring chunk's node: 5 child reads, not
      D − lod − 1.

   What is not reproduced: `keptVoxels` (a float64 sum whose order changes
   when interiors are added as one number; the runner never returned it),
   `cells` (page jobs still use expandChunk), `border: 'closed'` and
   `rayDepth` (experiments only). Same imports as chunk-core, so a module
   worker loads it as is.
   ===================================================================== */
import { EMPTY, FIRST_NODE, isFull } from './dag-core.js';
import { CHUNK_LEVELS, BRICK_LEVELS, LOD_RULES, PER_BRICK, TIE_RANK, chunkNode, keepCount,
         boundaryBits, packRecord, cellAttr } from './chunk-core.js';

/* A full node is filled and shelled when it is at least 2^SHELL_MIN cells on a
   side. At side 2 every cell is on the shell, so there is nothing to skip. */
export const SHELL_MIN = 2;

/* Masks kept per cache before it starts again. 64 bytes each, plus the Map's
   own overhead: about 10 MB per worker at the cap. */
export const MASK_CAP = 1 << 16;

const ALL = 'all';                       // a brick that keeps every occupied cell

/* A runner holds one cache for its snapshot's life. Node ids are append-only
   and a node never changes, and counts are per id, so a mask stays right
   across edits (an edit makes new ids; it never rewrites one). */
export function createJobCache(){
  const maps = new Map();
  let size = 0, hits = 0, misses = 0;
  return {
    mapOf(rule, lod){
      const k = rule + ':' + lod;
      let m = maps.get(k);
      if (!m){ m = new Map(); maps.set(k, m); }
      return m;
    },
    added(){ if (++size > MASK_CAP){ for (const m of maps.values()) m.clear(); size = 0; } },
    hit(){ hits++; }, miss(){ misses++; },
    get stats(){ return { size, hits, misses }; },
  };
}

const G = 66, GG = G * G;
const gIndex = (x, y, z) => (x + 1) + G * ((y + 1) + G * (z + 1));
let grid = null;

/* Fill the grid over a box of cells, inclusive bounds, already clipped to
   the 66³ grid's range [-1, 64]. One `fill` per row. */
function fillBox(x0, y0, z0, x1, y1, z1){
  const len = x1 - x0 + 1;
  for (let z = z0; z <= z1; z++)
    for (let y = y0; y <= y1; y++){
      const g = gIndex(x0, y, z);
      grid.fill(1, g, g + len);
    }
}

/* The brick listing that makes a mask: the reference's listCells and sort,
   kept to the letter, since a mask must pick exactly the cells brick() would. */
const B_LOCAL = new Uint16Array(512), B_COUNT = new Float64Array(512), B_ORDER = new Uint16Array(512);
let bn = 0;
function listLocals(store, counts, lod, id, j, local){
  if (id === EMPTY) return;
  if (j === lod){ B_LOCAL[bn] = local; B_COUNT[bn] = counts.of(id); bn++; return; }
  for (let o = 0; o < 8; o++) listLocals(store, counts, lod, store.child(id, o), j - 1, local << 3 | o);
}
function makeMask(store, counts, rule, lod, id, k){
  bn = 0;
  listLocals(store, counts, lod, id, k, 0);
  const m = bn, keep = keepCount(rule, counts.of(id), 8 ** (k - lod), lod, m);
  if (keep >= m) return ALL;
  for (let i = 0; i < m; i++) B_ORDER[i] = i;
  const ord = B_ORDER.subarray(0, m).sort((a, b) => B_COUNT[b] - B_COUNT[a] || TIE_RANK[B_LOCAL[a]] - TIE_RANK[B_LOCAL[b]]);
  const mask = new Uint32Array(16);
  for (let i = 0; i < keep; i++){ const l = B_LOCAL[ord[i]]; mask[l >> 5] |= 1 << (l & 31); }
  return mask;
}
/* Does the mask keep anything in the Morton range of `span` locals from `a`?
   A subtree's locals are contiguous, and span is 1, 8, 64 or 512. */
function anyKept(mask, a, span){
  if (span === 1) return mask[a >> 5] >>> (a & 31) & 1;
  if (span === 8) return mask[a >> 5] >>> (a & 31) & 255;
  let w = a >> 5;
  for (const end = w + (span >> 5); w < end; w++) if (mask[w]) return 1;
  return 0;
}

/* Expand one chunk, as expandChunk(store, root, D, chunk, { classes, counts,
   lodRule, seams: true, colour, meanDepth }) does. `cache` is a
   createJobCache(); without one, masks are made and dropped per job. Returns
   the fields the job runner passes on. */
export function fastChunk(store, root, D, chunk, opts){
  const { lod = 0, cx = 0, cy = 0, cz = 0 } = chunk;
  const classes = opts.classes || null, counts = opts.counts, rule = opts.lodRule || 'any';
  const colour = opts.colour || null, meanDepth = opts.meanDepth ?? 1, cache = opts.cache || createJobCache();
  if (!LOD_RULES.includes(rule)) throw new Error(`fastChunk: unknown lodRule '${rule}'`);
  if (!counts) throw new Error('fastChunk: needs opts.counts (createCounts)');
  if (!grid) grid = new Uint8Array(G * G * G);
  grid.fill(0);

  const start = chunkNode(store, root, D, lod, cx, cy, cz);
  const perBrick = PER_BRICK.has(rule), majority = rule === 'majority', cellVoxels = 8 ** lod;
  const brickAt = Math.min(lod + BRICK_LEVELS, start.level);
  const masks = perBrick ? cache.mapOf(rule, lod) : null;
  // Does a full brick keep every cell? Yes for every rule we draw with, but
  // it's the rule's to say, so ask it once rather than assume it.
  const nBrick = 8 ** (brickAt - lod);
  const fullKeepsAll = !perBrick || keepCount(rule, 8 ** brickAt, nBrick, lod, nBrick) === nBrick;
  const maskOf = id => {
    let m = masks.get(id);
    if (m === undefined){ cache.miss(); m = makeMask(store, counts, rule, lod, id, brickAt); masks.set(id, m); cache.added(); }
    else cache.hit();
    return m;
  };

  let cells = new Uint32Array(4096), xyz = new Uint32Array(4096), poses = new Uint8Array(4096);
  let ids = colour ? new Uint32Array(4096) : null;
  let n = 0, interior = 0;
  const list = (x, y, z, index, pose, id) => {
    if (n === cells.length){
      const c2 = new Uint32Array(n * 2); c2.set(cells); cells = c2;
      const x2 = new Uint32Array(n * 2); x2.set(xyz); xyz = x2;
      const p2 = new Uint8Array(n * 2); p2.set(poses); poses = p2;
      if (ids){ const i2 = new Uint32Array(n * 2); i2.set(ids); ids = i2; }
    }
    cells[n] = index; xyz[n] = x | y << 8 | z << 16; poses[n] = pose;
    if (ids) ids[n] = id;
    n++;
  };

  /* The shell of a full node whose box is [f0, f1) on each axis: visit a child
     unless it lies strictly inside, and count the cells it holds if it does.
     Every child of a full node is full, so the count is its side cubed. */
  const shell = (id, k, X0, Y0, Z0, index, pose, fx0, fy0, fz0, fx1, fy1, fz1) => {
    if (k === brickAt && classes && id >= FIRST_NODE) pose = classes.pose(id);
    if (k === lod){ list(X0, Y0, Z0, index, pose, id); return; }
    const h = 1 << (k - 1 - lod);
    for (let o = 0; o < 8; o++){
      const x = X0 + (o & 1) * h, y = Y0 + (o >> 1 & 1) * h, z = Z0 + (o >> 2) * h;
      if (x > fx0 && x + h < fx1 && y > fy0 && y + h < fy1 && z > fz0 && z + h < fz1){ interior += h * h * h; continue; }
      shell(store.child(id, o), k - 1, x, y, z, index << 3 | o, pose, fx0, fy0, fz0, fx1, fy1, fz1);
    }
  };

  /* A brick under its mask, depth first, so cells still come out in Morton
     order. `local` is the cell's index inside the brick. In the apron (`lo`
     set), cells are clipped to the slab and only marked. */
  const masked = (id, j, x, y, z, index, local, pose, mask, lo, hi) => {
    if (id === EMPTY) return;
    if (j === lod){
      // The parent tested this bit and the slab already, as a range of one
      // and a box of one; only a brick of one cell (lod = D) arrives untested.
      if (!(mask[local >> 5] >>> (local & 31) & 1)) return;
      grid[gIndex(x, y, z)] = 1;
      if (!lo) list(x, y, z, index, pose, id);
      return;
    }
    const levels = j - 1 - lod, h = 1 << levels, span = 1 << 3 * levels;
    for (let o = 0; o < 8; o++){
      const l = local << 3 | o;
      if (!anyKept(mask, l * span, span)) continue;
      const cx = x + (o & 1) * h, cy = y + (o >> 1 & 1) * h, cz = z + (o >> 2) * h;
      if (lo && (cx > hi[0] || cy > hi[1] || cz > hi[2] || cx + h <= lo[0] || cy + h <= lo[1] || cz + h <= lo[2])) continue;
      masked(store.child(id, o), j - 1, cx, cy, cz, index << 3 | o, l, pose, mask, lo, hi);
    }
  };

  /* The chunk's own walk: the reference's walk, plus paths 1 and 2. */
  const walk = (id, k, X0, Y0, Z0, index, pose) => {
    if (id === EMPTY) return;
    if (k === brickAt){
      if (classes && id >= FIRST_NODE) pose = classes.pose(id);
      if (perBrick && !(fullKeepsAll && isFull(store, counts, id, k))){
        const mask = maskOf(id);
        if (mask !== ALL){ masked(id, k, X0, Y0, Z0, index, 0, pose, mask, null, null); return; }
      }
    }
    if (k === lod){
      if (majority && 2 * counts.of(id) < cellVoxels) return;
      grid[gIndex(X0, Y0, Z0)] = 1;
      list(X0, Y0, Z0, index, pose, id);
      return;
    }
    const s = 1 << (k - lod);
    if (k - lod >= SHELL_MIN && fullKeepsAll && isFull(store, counts, id, k)){
      fillBox(X0, Y0, Z0, X0 + s - 1, Y0 + s - 1, Z0 + s - 1);
      shell(id, k, X0, Y0, Z0, index, pose, X0, Y0, Z0, X0 + s, Y0 + s, Z0 + s);
      return;
    }
    const h = s >> 1;
    for (let o = 0; o < 8; o++)
      walk(store.child(id, o), k - 1, X0 + (o & 1) * h, Y0 + (o >> 1 & 1) * h, Z0 + (o >> 2) * h, index << 3 | o, pose);
  };
  walk(start.id, start.level, 0, 0, 0, 0, 0);
  const occupied = n + interior;

  /* An apron slab marks the grid where the neighbour draws, clipped to the box
     [lo, hi]. A full node marks its share of the slab in one go. */
  const apron = (id, k, X0, Y0, Z0, lo, hi) => {
    if (id === EMPTY) return;
    if (k === brickAt && perBrick && !(fullKeepsAll && isFull(store, counts, id, k))){
      const mask = maskOf(id);
      if (mask !== ALL){ masked(id, k, X0, Y0, Z0, 0, 0, 0, mask, lo, hi); return; }
    }
    if (k === lod){
      if (majority && 2 * counts.of(id) < cellVoxels) return;
      grid[gIndex(X0, Y0, Z0)] = 1;
      return;
    }
    const s = 1 << (k - lod);
    if (fullKeepsAll && isFull(store, counts, id, k)){
      fillBox(Math.max(X0, lo[0]), Math.max(Y0, lo[1]), Math.max(Z0, lo[2]),
              Math.min(X0 + s - 1, hi[0]), Math.min(Y0 + s - 1, hi[1]), Math.min(Z0 + s - 1, hi[2]));
      return;
    }
    const h = s >> 1;
    for (let o = 0; o < 8; o++){
      const x = X0 + (o & 1) * h, y = Y0 + (o >> 1 & 1) * h, z = Z0 + (o >> 2) * h;
      if (x > hi[0] || y > hi[1] || z > hi[2] || x + h <= lo[0] || y + h <= lo[1] || z + h <= lo[2]) continue;
      apron(store.child(id, o), k - 1, x, y, z, lo, hi);
    }
  };
  const nbIds = [EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY];
  for (let s = 0; s < 6; s++){
    const a = APRONS[s], nb = chunkNode(store, root, D, lod, cx + a.d[0], cy + a.d[1], cz + a.d[2]);
    nbIds[s] = nb.id;
    if (n > 0) apron(nb.id, nb.level, 64 * a.d[0], 64 * a.d[1], 64 * a.d[2], a.lo, a.hi);
  }

  /* Path 3: is the level-(lod + 1) node across a boundary face full? Cached in
     a 34³ table of the chunk's coarse cells and the coarse apron round them
     (2 = not asked yet). Only the six face neighbours are ever asked, and
     they are full chunk nodes whenever they aren't EMPTY (a world smaller
     than a chunk has only EMPTY neighbours, as in expandChunk's apron). */
  const full = COARSE.fill(2);
  const coarseFull = (x, y, z) => {
    const key = ((x >> 1) + 1) + 34 * (((y >> 1) + 1) + 34 * ((z >> 1) + 1));
    let f = full[key];
    if (f !== 2) return f === 1;
    const s = x > 63 ? 0 : x < 0 ? 1 : y > 63 ? 2 : y < 0 ? 3 : z > 63 ? 4 : 5;
    let id = nbIds[s];
    const lx = (x & 63) >> 1, ly = (y & 63) >> 1, lz = (z & 63) >> 1;
    for (let b = CHUNK_LEVELS - 2; b >= 0 && id >= FIRST_NODE; b--)
      id = store.child(id, (lx >> b & 1) | (ly >> b & 1) << 1 | (lz >> b & 1) << 2);
    f = id !== EMPTY && isFull(store, counts, id, lod + 1) ? 1 : 0;
    full[key] = f;
    return f === 1;
  };

  // Face masks and records: the reference's loop, over the listed cells.
  const records = new Uint32Array(n), attrs = colour ? new Uint32Array(n) : null;
  let count = 0, quads = 0, tn = 0;
  const tail = new Uint32Array(Math.min(n, 6 * 64 * 64)), tailAttrs = colour ? new Uint32Array(tail.length) : null;
  const X0 = cx * 64, Y0 = cy * 64, Z0 = cz * 64, cs = 2 ** lod;
  const attrAt = (i, x, y, z) => cellAttr(store, counts, colour, ids[i], lod, meanDepth, (X0 + x) * cs, (Y0 + y) * cs, (Z0 + z) * cs);
  const openQuads = [0, 0, 0, 0, 0, 0];
  const tallyOpen = b => { for (let s = 0; b; s++, b >>= 1) if (b & 1) openQuads[s]++; };
  for (let i = 0; i < n; i++){
    const p = xyz[i], x = p & 255, y = p >> 8 & 255, z = p >> 16;
    const g = gIndex(x, y, z);
    const m = (grid[g + 1] ? 0 : 1)  | (grid[g - 1] ? 0 : 2)
            | (grid[g + G] ? 0 : 4)  | (grid[g - G] ? 0 : 8)
            | (grid[g + GG] ? 0 : 16) | (grid[g - GG] ? 0 : 32);
    if (!m){
      const b = boundaryBits(x, y, z);
      if (b && ((b & 1 && !coarseFull(x + 1, y, z)) || (b & 2 && !coarseFull(x - 1, y, z))
             || (b & 4 && !coarseFull(x, y + 1, z)) || (b & 8 && !coarseFull(x, y - 1, z))
             || (b & 16 && !coarseFull(x, y, z + 1)) || (b & 32 && !coarseFull(x, y, z - 1)))){
        if (tailAttrs) tailAttrs[tn] = attrAt(i, x, y, z);
        tail[tn++] = packRecord(cells[i], 0, poses[i]);
        tallyOpen(b);
      }
      continue;
    }
    if (attrs) attrs[count] = attrAt(i, x, y, z);
    records[count++] = packRecord(cells[i], m, poses[i]);
    quads += popcount6(m);
    tallyOpen(boundaryBits(x, y, z) & ~m);
  }
  const recs = new Uint32Array(count + tn);
  recs.set(records.subarray(0, count)); recs.set(tail.subarray(0, tn), count);
  let words = null;
  if (attrs){ words = new Uint32Array(count + tn); words.set(attrs.subarray(0, count)); words.set(tailAttrs.subarray(0, tn), count); }
  // `listed` is how many cells the walk visited, for experiments/job-speed.mjs.
  return { records: recs, attrs: words, count, borderStart: count, borderCount: tn, quads, openQuads, occupied, buried: occupied - count, listed: n };
}

const COARSE = new Uint8Array(34 * 34 * 34);
const popcount6 = m => (m & 1) + (m >> 1 & 1) + (m >> 2 & 1) + (m >> 3 & 1) + (m >> 4 & 1) + (m >> 5 & 1);
const APRONS = [
  { d: [ 1, 0, 0], lo: [64, 0, 0], hi: [64, 63, 63] },
  { d: [-1, 0, 0], lo: [-1, 0, 0], hi: [-1, 63, 63] },
  { d: [ 0, 1, 0], lo: [0, 64, 0], hi: [63, 64, 63] },
  { d: [ 0,-1, 0], lo: [0, -1, 0], hi: [63, -1, 63] },
  { d: [ 0, 0, 1], lo: [0, 0, 64], hi: [63, 63, 64] },
  { d: [ 0, 0,-1], lo: [0, 0, -1], hi: [63, 63, -1] },
];
