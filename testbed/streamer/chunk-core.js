/* ================== CHUNK CORE (pure) ================================
   expand(chunk, lod): one 64³ chunk of a dag-core DAG, as instance records.
   ifsandwhats.md §8.5 step 3, under §10.3's binary numbers
   (docs/expand-plan.md). No DOM, no gl; the only import is dag-core.js, so
   a module worker can load it as is, which is the job §8.1 gives
   block-showroom's GenerationPool.

   The record is block-showroom's instance record (instanceArrays) with
   the 12-byte centre dropped, because the shader can rebuild a centre from
   the cell index, the chunk origin and the cell size:

     bits  0–17  cell index inside the 64³ chunk, Morton (octant-major)
     bits 18–23  face mask, +X −X +Y −Y +Z −Z (block-showroom's FACE_D order)
     bits 24–29  Oh pose of the 8³ brick the cell sits in (dag-core's `e`)
     bits 30–31  spare

   4 bytes per drawn voxel, against block-showroom's 14 (12 centre + mask +
   orbit), and buried voxels (mask 0) are not emitted at all.

   Morton because the DAG's octant order is Morton (octant = bx | by<<1 |
   bz<<2), so a depth-first walk emits records already sorted by index, and
   `index >> 9` is the 8³ brick. Bit 3k of the index is bit k of x, 3k+1 of
   y, 3k+2 of z.

   Step 6 adds an attribute word per record (attr-core.js's layout), in a
   parallel array in the same order, so a record's index is its rank among
   the chunk's shown cells (Q13: only shown voxels get a word). See
   cellAttr for the coarse mean.
   ===================================================================== */
import { EMPTY, FIRST_NODE } from './dag-core.js';
import { attrOf8 } from './attr-core.js';

export const CHUNK_LEVELS = 6, CHUNK_SIDE = 64;
export const BRICK_LEVELS = 3;                  // the pose is the 8³ brick's (Q16)
export const MASK_SHIFT = 18, POSE_SHIFT = 24;
export const CELL_MASK = (1 << MASK_SHIFT) - 1;

/* ---- Morton, 6 bits per axis ------------------------------------------
   Two 64-entry tables beat bit tricks here: they are what the decode in
   the shader does too (three shifts and masks per axis), written out once
   so both sides can be read against each other. */
const SPREAD = new Uint32Array(64);
for (let v = 0; v < 64; v++){
  let s = 0;
  for (let b = 0; b < 6; b++) if (v >> b & 1) s |= 1 << (3 * b);
  SPREAD[v] = s;
}
export const mortonOf = (x, y, z) => SPREAD[x] | SPREAD[y] << 1 | SPREAD[z] << 2;
export function mortonXYZ(i){
  let x = 0, y = 0, z = 0;
  for (let b = 0; b < 6; b++){
    x |= (i >> (3 * b)     & 1) << b;
    y |= (i >> (3 * b + 1) & 1) << b;
    z |= (i >> (3 * b + 2) & 1) << b;
  }
  return [x, y, z];
}

export const packRecord = (cell, mask, pose) => (cell | mask << MASK_SHIFT | pose << POSE_SHIFT) >>> 0;
export const cellOf = r => r & CELL_MASK;
export const maskOf = r => r >>> MASK_SHIFT & 63;
export const poseOf = r => r >>> POSE_SHIFT & 63;

const popcount6 = m => (m & 1) + (m >> 1 & 1) + (m >> 2 & 1) + (m >> 3 & 1) + (m >> 4 & 1) + (m >> 5 & 1);

/* ---- seams between lods (docs/stream-plan.md, decision 11) --------------
   The apron hides a face against the neighbouring chunk's cell at the
   same lod. When the virtualiser draws that neighbour at another lod, the
   hidden face can leave a crack, so the vertex shader also shows a cell's
   boundary faces on every side the virtualiser flags open (uOpenSides).
   boundaryBits says which of a cell's faces lie on the chunk's boundary,
   in the mask's order; shownMask is the CPU twin of the shader's
   recShown(), and chunk-viewer.html's probe holds the two to each other.
   With every side open, shownMask is exactly border: 'closed''s mask. */
export const boundaryBits = (x, y, z) =>
  (x === 63 ? 1 : 0) | (x === 0 ? 2 : 0) | (y === 63 ? 4 : 0) | (y === 0 ? 8 : 0) | (z === 63 ? 16 : 0) | (z === 0 ? 32 : 0);
export function shownMask(r, openSides){
  const [x, y, z] = mortonXYZ(cellOf(r));
  return maskOf(r) | (boundaryBits(x, y, z) & openSides);
}

/* ---- addressing --------------------------------------------------------
   A DAG of depth D has, at level l, a grid of side 2^(D−l) nodes. A chunk at
   lod l is a node at level l + 6, i.e. 64³ level-l cells. When the whole
   world is smaller than one chunk (D < l + 6, every specimen below R=64 at
   lod 0), chunk (0,0,0) holds the world in its low corner and every other
   chunk is empty: the walk below starts at the root, and the Morton index
   simply has its high bits zero. */
export function nodeAt(store, root, D, level, X, Y, Z){
  const side = 2 ** (D - level);
  if (X < 0 || Y < 0 || Z < 0 || X >= side || Y >= side || Z >= side) return EMPTY;
  let id = root;
  for (let k = D - 1; k >= level && id >= FIRST_NODE; k--){
    const b = k - level;
    id = store.child(id, (X >> b & 1) | (Y >> b & 1) << 1 | (Z >> b & 1) << 2);
  }
  return id;
}
export function chunkNode(store, root, D, lod, cx, cy, cz){
  if (D >= lod + CHUNK_LEVELS) return { id: nodeAt(store, root, D, lod + CHUNK_LEVELS, cx, cy, cz), level: lod + CHUNK_LEVELS };
  return { id: (cx | cy | cz) === 0 ? root : EMPTY, level: D };
}

/* The occupancy grid is 66³ bytes: the chunk plus a one-cell apron on every
   side, so the face test below never branches on a border. 287 KB, reused
   across calls (a worker expands one chunk at a time). */
const G = 66, GG = G * G;
const gIndex = (x, y, z) => (x + 1) + G * ((y + 1) + G * (z + 1));
let grid = null;

/* ---- coarse cells: which ones a lod keeps (docs/coverage-plan.md) -------
   At lod 0 a cell is a voxel and there is nothing to decide. At lod l a
   cell is a level-l node holding c of its 8^l voxels, and a rule decides
   whether it is drawn:

     any       c ≥ 1. Step 3's rule, the default. Exact on smooth solids,
               but it fills porous content in solid (expand-findings §4).
     majority  2c ≥ 8^l, per cell. It gets the fewest voxels wrong per
               cell, and it erases anything thinner than half a cell.
     volume    per 8³ brick of cells: keep the k = round(C / 8^l) cells
               with the most voxels, C being the brick's voxel count. The
               brick keeps its volume to within half a cell.
     opacity   per brick: k = round(n·(1 − (1 − p)^(2^l))), where p is the
               brick's density and n its cell count. That is
               block-showroom's siteTier() target, with a coarse cell
               2^l fine cells deep instead of 3, and p taken from the
               brick instead of the whole world, because a streamed world
               has no global density. A ray crossing 2^l fine cells of
               density p hits one with that probability, so the coarse
               brick blocks as much light along an axis as the fine one.

     adaptive  opacity with the depth measured per brick, not assumed (see
               keepCount): m = 1 for a solid, 2^l for independent noise.

   The brick is the pose brick (a node at level lod + 3, Q16). It nests
   inside the chunk, so the apron walk sees exactly what the neighbouring
   chunk draws, and a brick's coarse version depends only on its node.
   Ties (and a flat sheet makes nearly every cell a tie) are broken by
   TIE_RANK, a fixed shuffle of the 512 Morton indices inside a brick.
   Ranking by Morton index itself would always drop the brick's high
   corner first, which leaves regular holes. */
export const LOD_RULES = ['any', 'majority', 'volume', 'opacity', 'adaptive'];
export const PER_BRICK = new Set(['volume', 'opacity', 'adaptive']);
export const TIE_RANK = (() => {
  const h = i => { let x = Math.imul(i + 0x9e37, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); return (x ^ x >>> 16) >>> 0; };
  const order = Array.from({ length: 512 }, (_, i) => i).sort((a, b) => h(a) - h(b) || a - b);
  const rank = new Uint16Array(512);
  order.forEach((i, r) => { rank[i] = r; });
  return rank;
})();

/* How many cells a per-brick rule keeps, from the brick's voxel count C,
   its cell count n, the lod, and how many of its cells are occupied.

   The two rules are one family: k = n·(1 − (1 − p)^m) with p = C/(n·8^l).
   m = 1 gives n·p = C/8^l, which is volume; m = 2^l is opacity. m is how
   many independent fine cells a ray through one coarse cell is taken to
   cross. `depth` overrides it for opacity, so experiments/coverage.mjs can
   sweep it; volume is kept as its own exact formula, since n·(1 − (1 − p))
   can round differently from C/8^l in floating point.

   The sweep found no single m: the best one per world ran from 1 (solids)
   to 6 (porous specimens) at lod 3 (docs/coverage-findings.md §3). m is
   a correlation length, and the brick already holds a measure of it. If
   its voxels were independent, a cell of 8^l of them would be occupied
   with probability q = 1 − (1 − p)^(8^l); if they were one solid lump,
   q = p. So the share of occupied cells q gives the number of
   independent samples per cell, s = log(1 − q) / log(1 − p), and a ray
   crosses about s^(1/3) of them. That is adaptive's m, clamped to
   [1, 2^l] (q = 1 means "no evidence of correlation", so 2^l). */
export function adaptiveDepth(C, n, lod, occupied){
  const p = C / (n * 8 ** lod), q = occupied / n, top = 2 ** lod;
  if (q >= 1 || p >= 1) return top;
  const s = Math.log(1 - q) / Math.log(1 - p);
  return Math.min(top, Math.max(1, Math.cbrt(s)));
}
export function keepCount(rule, C, n, lod, occupied, depth = 2 ** lod){
  const v = 8 ** lod;
  if (rule === 'adaptive') depth = adaptiveDepth(C, n, lod, occupied);
  const k = rule === 'volume' ? Math.round(C / v)
          : Math.round(n * (1 - (1 - C / (n * v)) ** depth));
  return Math.min(k, occupied);
}

/* Depth-first, octant order, so cells come out in Morton order. `lo`/`hi`
   clip the walk to a box of cells (inclusive, chunk-relative): the whole
   chunk for the interior, a one-cell slab for an apron, so an apron costs a
   walk of the neighbour's facing side and nothing else. At the brick level
   (`ctx.brickAt`) the pose is read, and a per-brick rule takes over. */
function walk(ctx, id, k, X0, Y0, Z0, index, pose){
  if (id === EMPTY) return;
  if (k === ctx.brickAt){
    if (ctx.classes && id >= FIRST_NODE) pose = ctx.classes.pose(id);
    if (ctx.perBrick){ brick(ctx, id, k, X0, Y0, Z0, index, pose); return; }
  }
  if (k === ctx.lod){
    const c = ctx.counts ? ctx.counts.of(id) : 1;
    if (ctx.rule === 'majority' && 2 * c < ctx.cellVoxels) return;
    ctx.visit(X0, Y0, Z0, index, pose, c, id);
    return;
  }
  const h = 1 << (k - 1 - ctx.lod), lo = ctx.lo, hi = ctx.hi;
  for (let o = 0; o < 8; o++){
    const x = X0 + (o & 1) * h, y = Y0 + (o >> 1 & 1) * h, z = Z0 + (o >> 2) * h;
    if (x > hi[0] || y > hi[1] || z > hi[2] || x + h <= lo[0] || y + h <= lo[1] || z + h <= lo[2]) continue;
    walk(ctx, ctx.store.child(id, o), k - 1, x, y, z, index << 3 | o, pose);
  }
}

/* One brick under a per-brick rule: list its occupied cells (all of them,
   ignoring the clip box, since the choice depends on the whole brick),
   keep the k fullest, then visit the kept ones inside the box in Morton
   order, so records stay sorted. Coordinates are Int16 because an apron
   brick sits at negative chunk-relative positions. */
const B_LOCAL = new Uint16Array(512), B_COUNT = new Float64Array(512), B_ORDER = new Uint16Array(512), B_ID = new Uint32Array(512);
const B_X = new Int16Array(512), B_Y = new Int16Array(512), B_Z = new Int16Array(512), B_KEEP = new Uint8Array(512);
let bn = 0;
function listCells(ctx, id, j, x, y, z, local){
  if (id === EMPTY) return;
  if (j === ctx.lod){
    B_LOCAL[bn] = local; B_X[bn] = x; B_Y[bn] = y; B_Z[bn] = z; B_COUNT[bn] = ctx.counts.of(id); B_ID[bn] = id; bn++;
    return;
  }
  const h = 1 << (j - 1 - ctx.lod);
  for (let o = 0; o < 8; o++)
    listCells(ctx, ctx.store.child(id, o), j - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h, local << 3 | o);
}
function brick(ctx, id, k, X0, Y0, Z0, index, pose){
  const { lo, hi } = ctx, levels = k - ctx.lod;
  bn = 0;
  listCells(ctx, id, k, X0, Y0, Z0, 0);
  const m = bn, keep = keepCount(ctx.rule, ctx.counts.of(id), 8 ** levels, ctx.lod, m, ctx.rayDepth);
  if (keep < m){
    for (let i = 0; i < m; i++){ B_ORDER[i] = i; B_KEEP[i] = 0; }
    const ord = B_ORDER.subarray(0, m).sort((a, b) => B_COUNT[b] - B_COUNT[a] || TIE_RANK[B_LOCAL[a]] - TIE_RANK[B_LOCAL[b]]);
    for (let i = 0; i < keep; i++) B_KEEP[ord[i]] = 1;
  } else B_KEEP.fill(1, 0, m);
  for (let i = 0; i < m; i++){
    if (!B_KEEP[i]) continue;
    const x = B_X[i], y = B_Y[i], z = B_Z[i];
    if (x < lo[0] || y < lo[1] || z < lo[2] || x > hi[0] || y > hi[1] || z > hi[2]) continue;
    ctx.visit(x, y, z, index << 3 * levels | B_LOCAL[i], pose, B_COUNT[i], B_ID[i]);
  }
}

/* ---- attributes: a shown cell's word (docs/attrs-plan.md, step 6) ---------
   At lod 0 a cell is a voxel, and its word is the colour field at the
   voxel's centre. At lod l the word is the mean of the cell's children,
   weighted by their voxel counts (Q13, your call 2026-10-10), so it is the
   mean of every voxel under the cell whichever lod it is built from.

   Exactly, that is 8^l field evaluations per cell, 512 at lod 3, and a job
   can't afford it. So the walk descends at most `meanDepth` levels below
   the cell (`floor` = lod − meanDepth), and a sub-cell at the floor counts
   as its voxel count times the field at its centre. Exact while lod ≤
   meanDepth; the error beyond is measured (experiments/attrs.mjs).

   Only occupied children are visited, and the sum is a float of 8-bit
   channels, quantized once at the end (decision 6): averaging 6-bit words
   lod by lod would round at every level. The field gets voxel units, a
   level-f cell's centre being its corner + 2^f / 2 (corner + 0.5 for a
   voxel). */
const ACC = new Float64Array(3);
function meanUnder(store, counts, colour, id, level, floor, x, y, z){
  if (id === EMPTY) return;
  if (level === floor){
    const w = counts ? counts.of(id) : 1, h = 2 ** level / 2, c = colour(x + h, y + h, z + h);
    ACC[0] += w * (c & 255); ACC[1] += w * (c >> 8 & 255); ACC[2] += w * (c >> 16 & 255);
    return;
  }
  const h = 2 ** (level - 1);
  for (let o = 0; o < 8; o++)
    meanUnder(store, counts, colour, store.child(id, o), level - 1, floor,
              x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
}
export function cellAttr(store, counts, colour, id, lod, meanDepth, x, y, z){
  if (lod === 0){
    const c = colour(x + 0.5, y + 0.5, z + 0.5);
    return attrOf8(c & 255, c >> 8 & 255, c >> 16 & 255);
  }
  ACC.fill(0);
  meanUnder(store, counts, colour, id, lod, Math.max(0, lod - meanDepth), x, y, z);
  const n = counts.of(id);
  return attrOf8(ACC[0] / n, ACC[1] / n, ACC[2] / n);
}

/* The six apron slabs: which neighbour chunk, where its corner sits
   relative to ours, and the one-cell box of it that faces us. */
const APRONS = [
  { d: [ 1, 0, 0], lo: [64, 0, 0], hi: [64, 63, 63] },
  { d: [-1, 0, 0], lo: [-1, 0, 0], hi: [-1, 63, 63] },
  { d: [ 0, 1, 0], lo: [0, 64, 0], hi: [63, 64, 63] },
  { d: [ 0,-1, 0], lo: [0, -1, 0], hi: [63, -1, 63] },
  { d: [ 0, 0, 1], lo: [0, 0, 64], hi: [63, 63, 64] },
  { d: [ 0, 0,-1], lo: [0, 0, -1], hi: [63, 63, -1] },
];
const WHOLE_LO = [0, 0, 0], WHOLE_HI = [63, 63, 63];

/* Expand one chunk.
     chunk  { lod, cx, cy, cz }: chunk coordinates on the lod's grid
     opts   classes  createClasses(store, OH48) result, for poses (else 0)
            border   'apron' (default): faces against a neighbouring chunk's
                     cells are hidden exactly as in the whole world;
                     'closed': outside the chunk counts as empty, so every
                     border face is emitted (the cheap option of §8.2)
            lodRule  'any' (default), 'majority', 'volume', 'opacity' or
                     'adaptive':
                     which coarse cells are drawn (see LOD_RULES above)
            counts   createCounts(store) result; needed by every rule but
                     'any', and for keptVoxels
            rayDepth opacity only: the m in keepCount (default 2^lod), for
                     experiments that sweep it
            cells    true: also return every kept cell, buried ones too,
                     as packed x | y<<8 | z<<16 (chunk-relative)
            seams    true: append the border tail (below); needs counts
            colour   a colour field (colours.js): also return `attrs`, one
                     attribute word per record, tail included, in record
                     order, so a record's index is its rank among the
                     chunk's shown cells (step 6). Needs counts above lod 0
            meanDepth  how many levels the coarse mean descends (default
                     1; see cellAttr)
   With seams, `records` is the main records (exactly what it is without
   seams) followed by the **border tail**: cells the apron alone buried,
   with mask 0, which only an open side can show. `borderStart` is where
   the tail begins; draw records [0, borderStart) when every side is
   exact and all of them when any side is open. A buried boundary cell
   joins the tail only if, across one of its boundary faces, the coarser
   cell (the level-(lod+1) node holding the neighbour) is not completely
   full. A full cell is drawn by every rule at every lod, so no crack can
   open against it (the proof is in docs/stream-plan.md), and without the
   test a solid chunk underground would carry its whole boundary shell,
   ~23K records.
   Returns the records plus what it cost and what it skipped. `origin` is
   the chunk's low corner in level-0 voxels and `cellSize` a cell's side in
   voxels; the shader's centre is origin + (cell + 0.5) · cellSize.
   `keptVoxels` is how many true voxels lie under the kept cells, so
   occupied·8^lod − keptVoxels is what the lod added that isn't there. */
export function expandChunk(store, root, D, chunk, opts = {}){
  const { lod = 0, cx = 0, cy = 0, cz = 0 } = chunk;
  const classes = opts.classes || null, border = opts.border || 'apron';
  const rule = opts.lodRule || 'any', counts = opts.counts || null;
  if (!LOD_RULES.includes(rule)) throw new Error(`expandChunk: unknown lodRule '${rule}'`);
  if (rule !== 'any' && !counts) throw new Error(`expandChunk: lodRule '${rule}' needs opts.counts (createCounts)`);
  if (opts.seams && !counts) throw new Error('expandChunk: seams need opts.counts (createCounts)');
  const colour = opts.colour || null, meanDepth = opts.meanDepth ?? 1;
  if (colour && lod > 0 && !counts) throw new Error('expandChunk: a coarse colour needs opts.counts (createCounts)');
  if (!grid) grid = new Uint8Array(G * G * G);
  grid.fill(0);

  const start = chunkNode(store, root, D, lod, cx, cy, cz);
  const ctx = { store, counts, classes, rule, lod, cellVoxels: 8 ** lod, rayDepth: opts.rayDepth ?? 2 ** lod,
                perBrick: PER_BRICK.has(rule),
                brickAt: Math.min(lod + BRICK_LEVELS, start.level),
                lo: WHOLE_LO, hi: WHOLE_HI, visit: null };
  // Occupied cells in walk order: index, packed xyz, pose.
  // With a colour, each cell's node too, for the mean under it.
  let cells = new Uint32Array(4096), xyz = new Uint32Array(4096), poses = new Uint8Array(4096);
  let ids = colour ? new Uint32Array(4096) : null;
  let n = 0, keptVoxels = 0;
  ctx.visit = (x, y, z, index, pose, c, id) => {
    if (n === cells.length){
      const c2 = new Uint32Array(n * 2); c2.set(cells); cells = c2;
      const x2 = new Uint32Array(n * 2); x2.set(xyz); xyz = x2;
      const p2 = new Uint8Array(n * 2); p2.set(poses); poses = p2;
      if (ids){ const i2 = new Uint32Array(n * 2); i2.set(ids); ids = i2; }
    }
    grid[gIndex(x, y, z)] = 1;
    cells[n] = index; xyz[n] = x | y << 8 | z << 16; poses[n] = pose;
    if (ids) ids[n] = id;
    n++;
    keptVoxels += c;
  };
  walk(ctx, start.id, start.level, 0, 0, 0, 0, 0);

  if (border === 'apron' && n > 0){
    ctx.classes = null;
    ctx.visit = (x, y, z) => { grid[gIndex(x, y, z)] = 1; };
    for (const a of APRONS){
      const nb = chunkNode(store, root, D, lod, cx + a.d[0], cy + a.d[1], cz + a.d[2]);
      // ctx.brickAt stays ours: a non-empty neighbour is always a full
      // chunk node, so its bricks sit at the same level (when the world is
      // smaller than a chunk, every neighbour is EMPTY).
      ctx.lo = a.lo; ctx.hi = a.hi;
      walk(ctx, nb.id, nb.level, 64 * a.d[0], 64 * a.d[1], 64 * a.d[2], 0, 0);
    }
  }

  // Face masks, and the records for every cell that shows a face.
  const records = new Uint32Array(n), attrs = colour ? new Uint32Array(n) : null;
  let count = 0, quads = 0, tail = null, tailAttrs = null, tn = 0;
  if (opts.seams){ tail = new Uint32Array(Math.min(n, 6 * 64 * 64)); if (colour) tailAttrs = new Uint32Array(tail.length); }
  const fullCount = 8 ** (lod + 1), X0 = cx * 64, Y0 = cy * 64, Z0 = cz * 64;
  const cs = 2 ** lod, attrAt = (i, x, y, z) => cellAttr(store, counts, colour, ids[i], lod, meanDepth, (X0 + x) * cs, (Y0 + y) * cs, (Z0 + z) * cs);
  const coarseFull = (x, y, z) => {
    const id = nodeAt(store, root, D, lod + 1, (X0 + x) >> 1, (Y0 + y) >> 1, (Z0 + z) >> 1);
    return id !== EMPTY && counts.of(id) === fullCount;
  };
  for (let i = 0; i < n; i++){
    const p = xyz[i], x = p & 255, y = p >> 8 & 255, z = p >> 16;
    const g = gIndex(x, y, z);
    const m = (grid[g + 1] ? 0 : 1)  | (grid[g - 1] ? 0 : 2)
            | (grid[g + G] ? 0 : 4)  | (grid[g - G] ? 0 : 8)
            | (grid[g + GG] ? 0 : 16) | (grid[g - GG] ? 0 : 32);
    if (!m){
      if (!tail) continue;
      const b = boundaryBits(x, y, z);
      if (b && ((b & 1 && !coarseFull(x + 1, y, z)) || (b & 2 && !coarseFull(x - 1, y, z))
             || (b & 4 && !coarseFull(x, y + 1, z)) || (b & 8 && !coarseFull(x, y - 1, z))
             || (b & 16 && !coarseFull(x, y, z + 1)) || (b & 32 && !coarseFull(x, y, z - 1)))){
        if (tailAttrs) tailAttrs[tn] = attrAt(i, x, y, z);
        tail[tn++] = packRecord(cells[i], 0, poses[i]);
      }
      continue;
    }
    if (attrs) attrs[count] = attrAt(i, x, y, z);
    records[count++] = packRecord(cells[i], m, poses[i]);
    quads += popcount6(m);
  }
  const cellSize = 2 ** lod, span = CHUNK_SIDE * cellSize;
  let recs = records.slice(0, count), words = attrs ? attrs.slice(0, count) : null;
  if (tail){ recs = new Uint32Array(count + tn); recs.set(records.subarray(0, count)); recs.set(tail.subarray(0, tn), count); }
  if (tailAttrs){ words = new Uint32Array(count + tn); words.set(attrs.subarray(0, count)); words.set(tailAttrs.subarray(0, tn), count); }
  const out = {
    records: recs, count, borderStart: count, borderCount: tn, quads, occupied: n, buried: n - count,
    lod, lodRule: rule, chunk: [cx, cy, cz], origin: [cx * span, cy * span, cz * span], cellSize,
    bytes: recs.byteLength, keptVoxels: counts ? keptVoxels : NaN,
  };
  if (words) out.attrs = words;
  if (opts.cells) out.cells = xyz.slice(0, n);
  return out;
}

/* Every non-empty chunk of the world at one lod, in chunk raster order. */
export function expandWorld(store, root, D, lod = 0, opts = {}){
  const side = Math.max(1, 2 ** (D - lod - CHUNK_LEVELS));
  const out = [];
  for (let cz = 0; cz < side; cz++) for (let cy = 0; cy < side; cy++) for (let cx = 0; cx < side; cx++){
    const c = expandChunk(store, root, D, { lod, cx, cy, cz }, opts);
    if (c.occupied) out.push(c);
  }
  return out;
}

/* A record's cell in voxel units: its low corner and side. The CPU side of
   the shader's decode; the viewer's probe holds the two to each other. */
export function cellBox(chunk, r){
  const [x, y, z] = mortonXYZ(cellOf(r)), s = chunk.cellSize, o = chunk.origin;
  return [o[0] + x * s, o[1] + y * s, o[2] + z * s, s];
}
