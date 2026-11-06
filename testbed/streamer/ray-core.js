/* ================== RAY CORE (pure) ==================================
   The ray path's data and its CPU twin: ifsandwhats.md §8.5 step 5
   (docs/ray-plan.md). No DOM, no gl. The GPU half is ray-glsl.js, and
   every structure here is laid out exactly as the textures hold it, so
   the CPU functions read the same words the shader reads.

   A **page** is one chunk at its lod, as two Morton-ordered grids:

     grid    512 words: the 8³ bricks of the chunk's 64³ cells. Word b is
             the brick's atlas slot, or 0 when the brick is empty. b is
             mortonOf(bx, by, bz), so it equals a record's cell index >> 9.
     brick   512 bits = 16 words: the brick's 8³ cells. Bit l of word
             (l >> 5) is cell mortonOf(x, y, z) & 511 inside the brick.

   Bricks are shared. A brick's cells at a lod depend only on its DAG node
   (CLAUDE.md requires that of every lod rule), so the pool keys bricks by
   (node id, lod), and one atlas slot serves every chunk that holds that
   node. A testbed row has under 250 nodes, so its whole far field needs
   only a few distinct bricks.

   The **cover tree** is what the ray walks to find the page under a point:
   the drawn chunks of stream-core's cover and their ancestors, as an
   octree from the top chunk. Twelve words a node:

     0 kind   0 split, 1 ray page, 2 raster chunk (the ray skips it)
     1 lod    2 page slot (ray pages)    3 unused
     4–11     child node indices by octant; 0 = nothing there (node 0 is
              the root, which is never a child)

   A raster chunk, an empty octant and an undrawn region all read as empty
   space to the ray: raster draws the first, and nothing is drawn in the
   others. The cover is a partition, so the two paths never draw the same
   voxel, and the depth test composes them.

   **Attributes** (step 6, docs/attrs-plan.md decisions 7–9). Only shown
   cells get a word (Q13), and whether a cell is shown depends on its
   neighbours, so a page's words can't live in the shared bricks. Each page
   brings an attribute block of runs, one per brick with shown cells:
     run     16 words of shown mask (laid out like a brick's bits), then
             one attribute word per shown cell in Morton order.
   The block goes into a global **heap** (one R32UI texture, HEAP_W words
   a row) at a base the allocator picks, and a second page texture,
   pageAttr (R32UI, PAGE_WORDS a row like the pages), holds for each grid
   entry its run's heap index, or ATTR_NONE when the brick shows nothing.
   A hit's word is the run's word at the cell's rank among the shown bits
   (attrAtCPU); a cell outside the mask (the ray started inside the
   solid) has none.
   ===================================================================== */
import { EMPTY, FIRST_NODE, isFull } from './dag-core.js';
import { CHUNK_LEVELS, mortonOf, nodeAt, cellOf } from './chunk-core.js';

export const PAGE_WORDS = 512, BRICK_WORDS = 16, TREE_WORDS = 12;
export const KIND_SPLIT = 0, KIND_RAY = 1, KIND_RASTER = 2;
export const ATTR_NONE = 0xffffffff, HEAP_W = 4096, RUN_HEAD = BRICK_WORDS;

/* ---- pages ---------------------------------------------------------------
   From a chunk's kept cells (expandChunk's opts.cells, packed
   x | y<<8 | z<<16, buried cells included: a ray can start inside
   anything), the page's bricks as bit sets, keyed by brick index. */
export function bricksFromCells(cells){
  const bricks = new Map();
  for (let i = 0; i < cells.length; i++){
    const p = cells[i], x = p & 255, y = p >> 8 & 255, z = p >> 16;
    const b = mortonOf(x >> 3, y >> 3, z >> 3), l = mortonOf(x & 7, y & 7, z & 7);
    let bits = bricks.get(b);
    if (!bits){ bits = new Uint32Array(BRICK_WORDS); bricks.set(b, bits); }
    bits[l >> 5] = (bits[l >> 5] | 1 << (l & 31)) >>> 0;
  }
  return bricks;
}

/* A page as a worker sends it: the brick grid as DAG node ids (0 = empty),
   and each distinct node's bits once. The main thread turns node ids into
   atlas slots (createBrickPool). The node of brick (bx, by, bz) of chunk
   (cx, cy, cz) at lod l is the level-(l+3) node at (8cx + bx, …). */
export function pageFromCells(store, root, D, { lod, cx, cy, cz }, cells){
  const bricks = bricksFromCells(cells), grid = new Uint32Array(PAGE_WORDS);
  const ids = [], bits = [];
  const seen = new Set();
  for (const [b, set] of bricks){
    let bx = 0, by = 0, bz = 0;
    for (let k = 0; k < 3; k++){ bx |= (b >> 3 * k & 1) << k; by |= (b >> 3 * k + 1 & 1) << k; bz |= (b >> 3 * k + 2 & 1) << k; }
    const id = nodeAt(store, root, D, lod + 3, 8 * cx + bx, 8 * cy + by, 8 * cz + bz);
    if (id === EMPTY) throw new Error(`pageFromCells: brick ${b} has cells but no node`);
    grid[b] = id;
    if (!seen.has(id)){ seen.add(id); ids.push(id); bits.push(set); }
  }
  const flat = new Uint32Array(BRICK_WORDS * bits.length);
  bits.forEach((s, i) => flat.set(s, BRICK_WORDS * i));
  return { kind: 'page', grid, ids: Uint32Array.from(ids), bits: flat, count: cells.length };
}

/* A completely full chunk is a full page without a walk: every rule keeps
   every full cell (docs/stream-plan.md's lemma), so all 512 bricks are the
   one solid node at level lod + 3, all bits set. */
export function fullPage(store, root, D, { lod, cx, cy, cz }){
  const id = nodeAt(store, root, D, lod + 3, 8 * cx, 8 * cy, 8 * cz);
  return { kind: 'page', grid: new Uint32Array(PAGE_WORDS).fill(id), ids: Uint32Array.of(id),
           bits: new Uint32Array(BRICK_WORDS).fill(0xffffffff), count: 64 ** 3 };
}

/* ---- a page's attribute block (step 6) -----------------------------------------
   From expandChunk's records and words with seams (records, then the seam
   tail): the shown cells are exactly those (docs/attrs-plan.md decision
   8). The tail comes after the main records, so the pairs are sorted by
   cell first; a cell's index is its brick (index >> 9) and its place in
   the brick (index & 511), as in the page grid and the brick bits.
   attrAt[b] is the run's offset in the block, ATTR_NONE for a brick with
   nothing shown. */
export function pageAttrBlock(records, attrs){
  const n = records.length, order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => cellOf(records[a]) - cellOf(records[b]));
  const attrAt = new Uint32Array(PAGE_WORDS).fill(ATTR_NONE);
  let len = 0;
  for (let i = 0; i < n; i++){
    const b = cellOf(records[order[i]]) >> 9;
    if (attrAt[b] === ATTR_NONE){ attrAt[b] = len; len += RUN_HEAD; }
    len++;
  }
  const attr = new Uint32Array(len), next = new Uint32Array(PAGE_WORDS);
  for (let i = 0; i < n; i++){
    const j = order[i], c = cellOf(records[j]), b = c >> 9, l = c & 511, run = attrAt[b];
    attr[run + (l >> 5)] = (attr[run + (l >> 5)] | 1 << (l & 31)) >>> 0;
    attr[run + RUN_HEAD + next[b]++] = attrs[j];
  }
  return { attr, attrAt, shown: n };
}

const popcount32 = x => { x -= x >>> 1 & 0x55555555; x = (x & 0x33333333) + (x >>> 2 & 0x33333333); return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24; };
/* The word of voxel v of the ray page at tree node `node` (corner lo), or
   ATTR_NONE. R adds two arrays to classifyPagesCPU's: pageAttr (PAGE_WORDS
   per page slot, heap indices) and heap. GLSL_RAY_ATTR's rayAttr is this
   function line for line. */
export function attrAtCPU(R, node, lx, ly, lz, x, y, z){
  const { tree, pageAttr, heap } = R;
  const lod = tree[node * TREE_WORDS + 1], page = tree[node * TREE_WORDS + 2];
  const cx = (x - lx) >> lod, cy = (y - ly) >> lod, cz = (z - lz) >> lod;
  const run = pageAttr[page * PAGE_WORDS + mortonOf(cx >> 3, cy >> 3, cz >> 3)];
  if (run === ATTR_NONE) return ATTR_NONE;
  const l = mortonOf(cx & 7, cy & 7, cz & 7), w = l >> 5, m = heap[run + w];
  if (!(m >>> (l & 31) & 1)) return ATTR_NONE;
  let rank = popcount32(m & ((1 << (l & 31)) - 1) >>> 0);
  for (let k = 0; k < w; k++) rank += popcount32(heap[run + k]);
  return heap[run + RUN_HEAD + rank];
}
// The word a traceCPU hit shows: the hit voxel's page, found again.
export function hitAttrCPU(R, cell){
  const leaf = { node: -1, lo: null, size: 0 };
  if (classifyPagesCPU(R, cell[0], cell[1], cell[2], leaf) !== 0 || leaf.node < 0) return ATTR_NONE;
  return attrAtCPU(R, leaf.node, leaf.lo[0], leaf.lo[1], leaf.lo[2], cell[0], cell[1], cell[2]);
}

/* ---- the attribute heap --------------------------------------------------------
   Word runs in one big texture, first fit with coalescing (decision 9).
   A page's block is one contiguous run, so a heap index plus an offset is
   a word; the viewer uploads it in at most three texSubImage2D calls (the
   first partial row, whole rows, the last partial row). alloc returns the
   start, or -1 when no free run is long enough. Index 0 is never handed
   out, so a zero in pageAttr can't look like a run by accident. */
export function createHeap(capacity){
  const free = [[1, capacity - 1]], used = new Map();
  let inUse = 0;
  return {
    capacity, get used(){ return inUse; }, get runs(){ return free.length; },
    alloc(n){
      if (n <= 0) return 0;
      for (let i = 0; i < free.length; i++){
        const [start, len] = free[i];
        if (len < n) continue;
        if (len === n) free.splice(i, 1); else free[i] = [start + n, len - n];
        used.set(start, n); inUse += n;
        return start;
      }
      return -1;
    },
    free(start){
      if (start === 0) return;
      const n = used.get(start);
      if (n === undefined) throw new Error(`heap: free of ${start}, never allocated`);
      used.delete(start); inUse -= n;
      let i = 0;
      while (i < free.length && free[i][0] < start) i++;
      free.splice(i, 0, [start, n]);
      if (i + 1 < free.length && free[i][0] + free[i][1] === free[i + 1][0]){ free[i][1] += free[i + 1][1]; free.splice(i + 1, 1); }
      if (i > 0 && free[i - 1][0] + free[i - 1][1] === free[i][0]){ free[i - 1][1] += free[i][1]; free.splice(i, 1); }
    },
  };
}

/* ---- the brick pool ----------------------------------------------------------
   Atlas slots for bricks, one per (node id, lod), counted by the resident
   pages that use them. Slot 0 is never handed out: in a page grid it means
   "empty brick". acquire returns { slot, fresh } (fresh: upload the bits);
   release frees the slot when its last page goes. The pool knows nothing
   of gl: the viewer uploads fresh slots, and nothing needs freeing on the
   GPU, since a slot is simply written again when reused. */
export function createBrickPool(capacity){
  const byKey = new Map(), free = [];
  let next = 1;
  return {
    get size(){ return byKey.size; }, capacity,
    acquire(id, lod){
      const key = id * 64 + lod;
      let e = byKey.get(key);
      if (e){ e.refs++; return { slot: e.slot, fresh: false }; }
      const slot = free.length ? free.pop() : next <= capacity ? next++ : 0;
      if (!slot) throw new Error(`brick pool full (${capacity} slots)`);
      byKey.set(key, { slot, refs: 1 });
      return { slot, fresh: true };
    },
    release(id, lod){
      const key = id * 64 + lod, e = byKey.get(key);
      if (!e) throw new Error(`brick pool: release of ${id}/${lod}, never acquired`);
      if (--e.refs === 0){ byKey.delete(key); free.push(e.slot); }
    },
    refs: (id, lod) => byKey.get(id * 64 + lod)?.refs || 0,
  };
}
/* A page's grid of node ids as a grid of atlas slots, acquiring each brick
   (once per grid entry, so release can mirror it). `put(slot, bits)` is
   called for every fresh slot. */
export function installPage(pool, lod, page, put){
  const bitsOf = new Map();
  page.ids.forEach((id, i) => bitsOf.set(id, page.bits.subarray(BRICK_WORDS * i, BRICK_WORDS * (i + 1))));
  const slots = new Uint32Array(PAGE_WORDS);
  for (let b = 0; b < PAGE_WORDS; b++){
    const id = page.grid[b];
    if (!id) continue;
    const { slot, fresh } = pool.acquire(id, lod);
    if (fresh) put(slot, bitsOf.get(id));
    slots[b] = slot;
  }
  return slots;
}
export function releasePage(pool, lod, page){
  for (let b = 0; b < PAGE_WORDS; b++) if (page.grid[b]) pool.release(page.grid[b], lod);
}

/* ---- the cover tree ------------------------------------------------------------
   From the cover's draw list and, per drawn chunk, whether it is a ray
   page (and in which page slot) or a raster chunk. Every drawn chunk gets
   its path of split nodes from the top chunk down. */
export function buildCoverTree(top, draw, leafOf){
  const index = new Map(), words = [];
  const make = () => { const i = words.length / TREE_WORDS; for (let k = 0; k < TREE_WORDS; k++) words.push(0); return i; };
  make();
  index.set(top + ':0,0,0', 0);
  for (const d of draw){
    let parent = 0;
    for (let l = top; l > d.lod; l--){
      const s = l - d.lod, x = d.x >> s, y = d.y >> s, z = d.z >> s, key = l + ':' + x + ',' + y + ',' + z;
      if (!index.has(key)) index.set(key, make());
      const at = index.get(key);
      if (l < top){
        const o = (x & 1) | (y & 1) << 1 | (z & 1) << 2;
        words[parent * TREE_WORDS + 4 + o] = at;
      }
      parent = at;
    }
    const leaf = d.lod === top ? 0 : make(), { kind, page = 0 } = leafOf(d);
    if (d.lod < top) words[parent * TREE_WORDS + 4 + ((d.x & 1) | (d.y & 1) << 1 | (d.z & 1) << 2)] = leaf;
    words[leaf * TREE_WORDS] = kind; words[leaf * TREE_WORDS + 1] = d.lod; words[leaf * TREE_WORDS + 2] = page;
  }
  return Uint32Array.from(words);
}

/* ---- the CPU twin of GLSL_RAY ------------------------------------------------------
   R = { tree, pages, bricks, top, D }: the three arrays exactly as the
   textures hold them (pages: PAGE_WORDS per slot, bricks: BRICK_WORDS per
   slot), the top chunk's lod and the world's depth.

   classifyPagesCPU(R, x, y, z), voxel coordinates: 0 when the voxel lies
   in an occupied cell of a ray page; otherwise the side of an aligned
   empty block holding it: an empty octant of the tree, a raster chunk,
   an empty brick (8·2^lod), or inside a brick the largest empty aligned
   4³, 2³ or single cell (docs/ray-log.md §8). The last is free in Morton
   order: an aligned 2³ block of a brick is one byte of its bits, and an
   aligned 4³ block two whole words. On a sparse far view that halved the
   march (62 ms on a real GPU before it).

   `leaf`, when given, receives the ray page the voxel fell in (node,
   corner, side), so traceCPU can skip the walk from the root while the
   ray stays in that chunk (§5.3's option 1). The answer is the same
   either way: pageCell is the second half of the same function. */
export function pageCell(R, node, lx, ly, lz, x, y, z){
  const { tree, pages, bricks } = R;
  const lod = tree[node * TREE_WORDS + 1], page = tree[node * TREE_WORDS + 2];
  const cx = (x - lx) >> lod, cy = (y - ly) >> lod, cz = (z - lz) >> lod;
  const slot = pages[page * PAGE_WORDS + mortonOf(cx >> 3, cy >> 3, cz >> 3)];
  if (!slot) return 8 << lod;
  const l = mortonOf(cx & 7, cy & 7, cz & 7), base = slot * BRICK_WORDS;
  const w = bricks[base + (l >> 5)];
  if (w >>> (l & 31) & 1) return 0;
  const q = base + (l >> 6) * 2;
  if (bricks[q] === 0 && bricks[q + 1] === 0) return 4 << lod;
  if ((w >>> (l & 24) & 255) === 0) return 2 << lod;
  return 1 << lod;
}
export function classifyPagesCPU(R, x, y, z, leaf = null){
  const tree = R.tree;
  let i = 0, size = 64 * 2 ** R.top, lx = 0, ly = 0, lz = 0;
  for (let guard = 0; guard < 32; guard++){
    const kind = tree[i * TREE_WORDS];
    if (kind === KIND_SPLIT){
      const h = size / 2;
      let o = 0;
      if (x >= lx + h){ o |= 1; lx += h; }
      if (y >= ly + h){ o |= 2; ly += h; }
      if (z >= lz + h){ o |= 4; lz += h; }
      size = h;
      const c = tree[i * TREE_WORDS + 4 + o];
      if (!c) return size;
      i = c;
      continue;
    }
    if (kind !== KIND_RAY) return size;
    if (leaf){ leaf.node = i; leaf.lo = [lx, ly, lz]; leaf.size = size; }
    return pageCell(R, i, lx, ly, lz, x, y, z);
  }
  throw new Error('classifyPagesCPU: tree deeper than 32');
}

/* The skip march of sol-v4's traceTower and traceCPU, in voxel units:
   classify the current voxel; if it's empty, jump to the exit of the empty
   block it names. The cell is carried as an integer across the face the
   ray leaves by (on every axis whose face is crossed at that t), never
   re-derived from the rounded point: docs/tracer-cell-carry.md is the bug
   that rule fixed. Float64 here; GLSL_RAY does the same in float32.
   Returns { hit, t, cell, axis, steps }: the voxel where the ray enters an
   occupied cell, and the axis of the face it came through (-1 when it
   starts inside one). The march starts at tMin (0 by default; the viewer
   passes the near plane, so both paths clip the same).

   It stops at tMax (docs/ray-depth-plan.md, decision 1): the viewer passes
   the distance to the raster's nearest surface along this ray, so a pixel
   the raster already covers marches only up to it. A cell entered at
   t ≥ tMax is behind the raster and is never a hit. Before the bound,
   every pixel marched its whole ray, and tracing 14 far chunks of a
   terrain cost 5.4 ms on your GPU, more than half of tracing all 705
   (ray-findings.md, the third bench). */
export function traceCPU(R, o, d, maxSteps = 4096, tMin = 0, tMax = Infinity){
  const S = 2 ** R.D, inv = [1 / d[0], 1 / d[1], 1 / d[2]];
  let tEnter = -Infinity, tExit = Infinity, axis = -1;
  for (let a = 0; a < 3; a++){
    const ta = (0 - o[a]) * inv[a], tb = (S - o[a]) * inv[a], lo = Math.min(ta, tb);
    if (lo > tEnter){ tEnter = lo; axis = a; }
    tExit = Math.min(tExit, Math.max(ta, tb));
  }
  const tEnd = Math.min(tExit, tMax);
  let t = Math.max(tEnter, tMin);
  if (t >= tEnd) return { hit: false, steps: 0 };
  if (tEnter < tMin) axis = -1;
  const cellAt = (tt, lo, hi) => [0, 1, 2].map(a => {
    const g = o[a] + tt * d[a];
    let c = Math.floor(g);
    if (d[a] < 0 && g === c) c--;
    return Math.max(lo[a], Math.min(hi[a], c));
  });
  let c = cellAt(t, [0, 0, 0], [S - 1, S - 1, S - 1]);
  // The ray page the last step was in: while the ray stays inside it, the
  // walk from the root is skipped (GLSL_RAY does the same).
  const leaf = { node: -1, lo: null, size: 0 };
  const inLeaf = () => leaf.node >= 0 && c.every((v, a) => v >= leaf.lo[a] && v < leaf.lo[a] + leaf.size);
  for (let step = 1; step <= maxSteps; step++){
    if (c.some(v => v < 0 || v >= S) || t >= tEnd) return { hit: false, steps: step };
    let size;
    if (inLeaf()) size = pageCell(R, leaf.node, leaf.lo[0], leaf.lo[1], leaf.lo[2], c[0], c[1], c[2]);
    else { leaf.node = -1; size = classifyPagesCPU(R, c[0], c[1], c[2], leaf); }
    if (size === 0) return { hit: true, t, cell: c, axis, steps: step };
    const lo = c.map(v => v - v % size);
    const tb = [0, 1, 2].map(a => ((d[a] > 0 ? lo[a] + size : lo[a]) - o[a]) * inv[a]);
    const te = Math.min(tb[0], tb[1], tb[2]);
    axis = tb[0] === te ? 0 : tb[1] === te ? 1 : 2;
    const next = cellAt(te, lo, lo.map(v => v + size - 1));
    for (let a = 0; a < 3; a++) if (tb[a] <= te) next[a] = d[a] > 0 ? lo[a] + size : lo[a] - 1;
    c = next; t = te;
  }
  return { hit: false, steps: maxSteps, truncated: true };
}

/* The page job, for createJobRunner: the chunk's kept cells as a page, or
   the full page without a walk when the chunk's node is completely full.
   `expand` is expandChunk with cells (and, for a coloured world, seams and
   the colour). With `coloured`, the page also carries its attribute
   block. A full chunk still needs its shown cells for that, unless
   `buried()` says all six neighbours are full too, the records job's
   shortcut: then nothing is shown, and the block is empty.

   Every page also reports `recordCount`, the cubes the same chunk would
   draw (expandChunk's `count`: the seam tail left out, since raster draws
   it only at an open side, and so the same with seams or without), so
   the streamer can judge its density whichever path it took
   (stream-core's chooseKinds). A full chunk that wasn't walked reports 0
   if it is buried and null (unknown) if not. `occupied` is its kept
   cells, as a records job reports them. */
export function pageJob(store, root, D, counts, chunk, expand, { coloured = false, buried = () => false } = {}){
  const { lod, cx, cy, cz } = chunk;
  const id = nodeAt(store, root, D, lod + CHUNK_LEVELS, cx, cy, cz);
  const withAttrs = (page, ex) => {
    const counted = { ...page, occupied: page.count, recordCount: ex ? ex.count : buried() ? 0 : null };
    if (!coloured) return counted;
    const block = ex ? pageAttrBlock(ex.records, ex.attrs) : { attr: new Uint32Array(0), attrAt: new Uint32Array(PAGE_WORDS).fill(ATTR_NONE), shown: 0 };
    return { ...counted, ...block };
  };
  if (id >= FIRST_NODE && isFull(store, counts, id, lod + CHUNK_LEVELS))
    return withAttrs({ ...fullPage(store, root, D, chunk), fullChunk: true }, coloured && !buried() ? expand() : null);
  const ex = expand();
  return withAttrs(pageFromCells(store, root, D, chunk, ex.cells), ex);
}
