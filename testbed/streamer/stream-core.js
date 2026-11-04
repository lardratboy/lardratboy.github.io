/* ================== STREAM CORE (pure) ===============================
   The chunk virtualiser: ifsandwhats.md §8.5 step 4, "the 3D clipmap over
   GenerationPool and Virtualiser, with the existing byte and upload
   budgets and the keep-old-while-waiting fallback" (docs/stream-plan.md).
   No DOM, no gl, no Worker: everything here is a decision, so Node can run
   the whole streamer against a simulated clock and simulated workers
   (experiments/stream-sim.mjs). The browser half is stream-pool.js (the
   workers) and stream-viewer.html (the draws).

   Four parts, in the order a frame uses them:

   1. selectChunks: which chunks the eye wants. A distance-refined cut of
      the chunk octree (decisions 1–3).
   2. coverOf: what to draw now, from what is resident. The finest
      complete cover of each region, so a parent stays up until all its
      children are in, and children stay until their parent is (4).
   3. createStreamer: the cache, the job order, admission under the
      per-frame budgets, and LRU eviction (5–7), i.e. block-showroom's
      Virtualiser and GenerationPool.service(), keyed by (lod, chunk).
   4. createJobRunner: what a worker does with a job. One expandChunk.

   Addresses. A chunk at lod l is a 64³ grid of level-l cells, i.e. the
   DAG node at level l + 6, and the chunk grid at lod l has side
   2^(D − l − 6). The top chunk (lod D − 6) is the whole world. Positions
   (the eye, chunk corners) are in level-0 voxels, as doubles.
   ===================================================================== */
import { EMPTY, FULL, FIRST_NODE, storeView } from './dag-core.js';
import { CHUNK_LEVELS, CHUNK_SIDE, chunkNode, expandChunk } from './chunk-core.js';
import { pageJob, RUN_HEAD, ATTR_NONE } from './ray-core.js';

// Face order of the record's mask and of uOpenSides: +X −X +Y −Y +Z −Z.
export const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export const keyOf = (lod, x, y, z) => lod + ':' + x + ',' + y + ',' + z;

/* A streamable world: a DAG root of depth D in some store (a dag-core
   store or a storeView). `top` is the lod of the one chunk that holds it
   all; below D = 6 that is lod 0, and the world sits in the chunk's low
   corner (chunk-core's chunkNode does the same). */
export function createWorld(store, root, D){
  return { store, root, D, top: Math.max(0, D - CHUNK_LEVELS), side: 2 ** D };
}
const gridSide = (world, lod) => Math.max(1, 2 ** (world.D - lod - CHUNK_LEVELS));

function makeChunk(lod, x, y, z, id, parent){
  const size = CHUNK_SIDE * 2 ** lod;
  return { key: keyOf(lod, x, y, z), lod, x, y, z, id, size, lo: [x * size, y * size, z * size],
           parent, kids: null, dist: 0 };
}
// The non-empty children of a chunk, read straight off its DAG node.
export function childrenOf(world, c){
  if (c.lod === 0 || c.id < FIRST_NODE) return [];
  const out = [];
  for (let o = 0; o < 8; o++){
    const id = world.store.child(c.id, o);
    if (id !== EMPTY) out.push(makeChunk(c.lod - 1, 2 * c.x + (o & 1), 2 * c.y + (o >> 1 & 1), 2 * c.z + (o >> 2), id, c));
  }
  return out;
}
export function boxDistance(eye, c){
  let d2 = 0;
  for (let a = 0; a < 3; a++){
    const lo = c.lo[a], hi = lo + c.size, v = eye[a];
    const d = v < lo ? lo - v : v > hi ? v - hi : 0;
    d2 += d * d;
  }
  return Math.sqrt(d2);
}

/* ---- 1. the cut ------------------------------------------------------------
   Split a chunk into its non-empty children while the eye is closer to
   its box than `detail` chunk sides and its lod is above minLod. That is
   §8.4's clipmap (ring k at depth L − k), but as a cut of the octree it is
   also a partition: every voxel of the world lies in exactly one leaf.

   Splits are taken in order of dist / size, the chunk that looks largest
   first, from a binary heap; `maxChunks` refuses a split that would pass
   it, so a cap costs detail where it shows least (block-showroom's
   MAX_VISIBLE). `capped` counts the refusals.

   Face neighbours differ by at most one lod when detail ≥ 1 and the cap
   doesn't bind. Say leaf c at lod l (side S) had a lod l − 2 leaf across
   one face. That leaf's parent p (side S/2) was split, so it is < K·S/2
   from the eye, and p lies inside c's face neighbour, within S/2 of c.
   So c is < K·S/2 + S/2 away, yet as a leaf it is ≥ K·S away: that needs
   K < 1. (I first wrote √3 here, which is the bound for boxes that touch
   at a corner; the test found it slack. Seams only meet across faces.)
   The seam tail relies on it (chunk-core.js, stream-plan.md decision 11). */
export function selectChunks(world, eye, { detail = 2, maxChunks = 1024, minLod = 0 } = {}){
  const nodes = new Map(), leaves = [];
  const sel = { world, eye: [eye[0], eye[1], eye[2]], detail, nodes, leaves, leafKeys: new Set(), root: null, capped: 0 };
  if (world.root === EMPTY) return sel;
  const root = sel.root = makeChunk(world.top, 0, 0, 0, world.root, null);
  root.dist = boxDistance(eye, root);
  const heap = [root], rank = c => c.dist / c.size;
  const push = c => {
    heap.push(c);
    for (let i = heap.length - 1; i > 0;){
      const p = (i - 1) >> 1;
      if (rank(heap[p]) <= rank(heap[i])) break;
      [heap[p], heap[i]] = [heap[i], heap[p]]; i = p;
    }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length){
      heap[0] = last;
      for (let i = 0;;){
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && rank(heap[l]) < rank(heap[m])) m = l;
        if (r < heap.length && rank(heap[r]) < rank(heap[m])) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  let count = 1;
  while (heap.length){
    const c = pop();
    nodes.set(c.key, c);
    if (c.lod > minLod && c.dist < detail * c.size){
      const kids = childrenOf(world, c);
      if (count - 1 + kids.length <= maxChunks){
        c.kids = kids; count += kids.length - 1;
        for (const k of kids){ k.dist = boxDistance(eye, k); push(k); }
        continue;
      }
      sel.capped++;
    }
    leaves.push(c);
    sel.leafKeys.add(c.key);
  }
  leaves.sort((a, b) => a.dist - b.dist || b.lod - a.lod);
  return sel;
}

/* ---- 2. the cover ----------------------------------------------------------
   What to draw, given which chunks are resident (`has(key)`). Bottom-up
   over the cut, each node returns a list of resident chunks that tiles
   its region and whether the tiling is complete:
     a leaf      itself if resident; else its non-empty children if all of
                 them are resident (it was split last time, and is waiting
                 to merge); else whichever children are, incomplete;
     a split     its children's tilings if all are complete; else itself if
                 resident (it was a leaf last time, and its children are
                 still coming); else the children's partial tilings.
   "Complete beats finer": a region never mixes a chunk with its own
   descendants, so nothing is drawn twice, and the image only changes
   once a replacement is whole. The parent and the children are one lod
   apart, so the fallback is one lod coarser or finer in normal motion;
   a jump of several lods falls back to whatever is resident above, and
   the pinned top chunk guarantees that something is.

   Each drawn chunk also gets `open`: the sides whose same-lod neighbour
   exists in the DAG but isn't drawn, so it is drawn at another lod or
   not at all, and the apron's hidden faces must show (chunk-core's seam
   tail). A neighbour outside the world or EMPTY is never open, since the
   apron saw nothing there either.

   Every leaf is then accounted for exactly once, as one of:
     drawn     the leaf itself;
     up        under a drawn ancestor (coarser than wanted);
     down      all its children drawn (finer than wanted);
     hole      none of those (partly drawn children count as a hole). */
export function coverOf(sel, has){
  const out = { draw: [], drawKeys: new Set(), holes: [], up: 0, down: 0, maxUp: 0 };
  if (!sel.root) return out;
  const world = sel.world, kidCache = new Map();
  const kidsOf = c => { let k = kidCache.get(c.key); if (!k){ k = childrenOf(world, c); kidCache.set(c.key, k); } return k; };
  const tile = c => {
    if (!c.kids){
      if (has(c.key)) return { list: [c], complete: true };
      const kids = kidsOf(c), got = kids.filter(k => has(k.key));
      return { list: got, complete: kids.length > 0 && got.length === kids.length };
    }
    const parts = c.kids.map(tile);
    if (parts.every(p => p.complete)) return { list: parts.flatMap(p => p.list), complete: true };
    if (has(c.key)) return { list: [c], complete: true };
    return { list: parts.flatMap(p => p.list), complete: false };
  };
  out.draw = tile(sel.root).list;
  for (const d of out.draw) out.drawKeys.add(d.key);
  for (const leaf of sel.leaves){
    if (out.drawKeys.has(leaf.key)) continue;
    let a = leaf.parent;
    while (a && !out.drawKeys.has(a.key)) a = a.parent;
    if (a){ out.up++; out.maxUp = Math.max(out.maxUp, a.lod - leaf.lod); continue; }
    const kids = kidCache.get(leaf.key);
    if (kids && kids.length && kids.every(k => out.drawKeys.has(k.key))){ out.down++; continue; }
    out.holes.push(leaf);
  }
  for (const d of out.draw){
    let open = 0;
    const g = gridSide(world, d.lod);
    SIDES.forEach(([dx, dy, dz], f) => {
      const x = d.x + dx, y = d.y + dy, z = d.z + dz;
      if (x < 0 || y < 0 || z < 0 || x >= g || y >= g || z >= g) return;
      const k = keyOf(d.lod, x, y, z);
      if (out.drawKeys.has(k)) return;
      // In the cut means non-empty; otherwise ask the DAG (D steps).
      if (!sel.nodes.has(k) && chunkNode(world.store, world.root, world.D, d.lod, x, y, z).id === EMPTY) return;
      open |= 1 << f;
    });
    d.open = open;
  }
  return out;
}

/* ---- 2b. the path: raster or ray, per chunk ------------------------------------
   ray-findings.md question 5, from your three benches (2026-11-01): the
   right path depends on content density, not lod. Raster costs per cube
   (3–6 ns on your GPU) and a ray per pixel it marches (0.2 ns a pixel
   where content is dense and rays hit at once, 4 ns where it is sparse).
   The seed row drew 4× faster as cubes; the dense graph row 100× faster
   traced. A single rayLod can't pick both, since both rows put every leaf
   at lod 3 or above (docs/ray-depth-plan.md, decisions 4–7).

   So each chunk of the cut gets a kind, from its density: the cubes it
   draws (`recordCount`, which every job reports, records or page) over
   its footprint, the pixels its box covers on screen. More than its
   threshold records a pixel: trace it. With hysteresis: a chunk resident
   as records turns into a page only above threshold · band, and a page
   back into records only below threshold / band, so a chunk near the
   line doesn't flip back and forth (each flip is a job).

   The threshold depends on the chunk's occupancy, its kept cells over
   64³ (docs/path-occupancy.md). Tracing beats raster when
       footprint · c_px(occupancy)  <  cubes · c_cube,
   and a ray's cost per pixel falls as the chunk fills, because it stops
   sooner. Records per pixel alone couldn't separate the graph row's near
   chunks (97% full, traced at 0.11 ns a footprint pixel) from the seed
   row's densest (1.6% full, 0.91 ns): on screen the graph chunks looked
   the sparser. So the threshold c_px / c_cube runs linearly from
   `rayDensity` for an empty chunk to `rayDensityFull` for a full one,
   fitted to your three benches (0.26 and 0.015). rayDensityFull null
   is the constant rule of the first version. `recordCount` leaves out
   the seam tail: raster draws it only at an open side, and on the graph
   row it was 58% of the records, so counting it made full chunks look
   2.4× dearer as cubes than they draw. A chunk
   with no count yet (never loaded, or evicted) takes its parent's kind:
   the cut walks parents first, and content this self-similar is usually
   as dense one lod down. If that guess was wrong, the chunk loads once in
   the wrong kind, reports its count, and is asked for again.

   The footprint is a square of side pxPerRadian · size / (dist + size/2),
   the box's angular size from about its centre, capped at the screen.
   Inside the clipmap that is nearly constant for a leaf at lod ≥ 1
   (dist is between detail and 2·detail sides), so the rule mostly asks
   "how many cubes does this chunk have"; it is the lod-0 chunks near the
   eye whose footprint grows, and a dense one there goes back to cubes.

   rayLod still forces every chunk at lod ≥ rayLod to a page, and
   `kindRule(c)`, when given, overrides everything (the tests and the
   viewer's self-test use a checkerboard, so that raster and ray chunks
   meet everywhere). */
export function chunkFootprint(c, cfg){
  const side = cfg.pxPerRadian * c.size / (c.dist + c.size / 2);
  return Math.min(cfg.screenPixels, side * side);
}
function kindFor(c, e, parentKind, cfg){
  if (cfg.kindRule) return cfg.kindRule(c);
  if (c.lod >= cfg.rayLod) return 'page';
  if (!(cfg.rayDensity < Infinity)) return 'records';
  const prior = e ? e.kind : parentKind || 'records', n = e ? e.recordCount : null;
  if (n == null) return prior;
  const density = n / chunkFootprint(c, cfg), threshold = densityThreshold(e.occupancy, cfg);
  return prior === 'page' ? (density * cfg.densityBand < threshold ? 'records' : 'page')
                          : (density > threshold * cfg.densityBand ? 'page' : 'records');
}
// Records per footprint pixel above which a chunk of this occupancy (kept
// cells over 64³; 0 when unknown) is cheaper traced.
export function densityThreshold(occupancy, cfg){
  if (cfg.rayDensityFull == null) return cfg.rayDensity;
  const o = occupancy ?? 0;
  return cfg.rayDensity + (cfg.rayDensityFull - cfg.rayDensity) * o;
}
// Every chunk of the cut, parents first (selectChunks inserts a chunk
// after its parent), keyed: 'records' or 'page'. entryOf(key): the
// resident entry, if any.
export function chooseKinds(sel, entryOf, cfg){
  const kinds = new Map();
  if (!sel || !sel.root) return kinds;
  for (const c of sel.nodes.values())
    kinds.set(c.key, kindFor(c, entryOf(c.key), c.parent ? kinds.get(c.parent.key) : null, cfg));
  return kinds;
}

/* ---- 3. the streamer -------------------------------------------------------
   block-showroom's Virtualiser + GenerationPool, minus the threads:
   - `update(eye)` re-cuts, re-covers, marks what is seen, evicts, and
     re-orders the job queue. Call it when the eye moves.
   - `nextJob()` hands the pool its next job, or null. It reserves
     `resultBytes` through each job's estimate and keeps at most
     `resultLimit` jobs in flight or waiting, as dispatch() does there.
   - `complete(job, result)` / `fail(job, error)` come back from the pool.
     A result for a superseded revision, or for a chunk the cut no longer
     holds, is discarded. A chunk that has failed twice isn't asked again.
   - `service()` once a frame: admit waiting results, nearest-first, while
     under `installMs` and `uploadBytes` (the first one always goes, so an
     oversize result can't stall the queue), then re-cover and evict.
   **The whole cut is wanted, split chunks too**, not just its leaves:
   the mip chain a VT keeps. A first version asked only for leaves, and in
   a simulated flight the workers never caught up, so most leaves sat
   under split chunks that had never been loaded; "complete beats finer"
   then fell all the way back to the pinned top chunk, and the whole
   world was drawn at its coarsest lod for the entire flight
   (docs/stream-log.md §3). With split chunks resident, a missing leaf
   falls back to its parent, one lod up, and a merge is instant because
   the parent is already there. It costs the split chunks: about one
   for every seven leaves.

   Eviction is LRU by the frame a chunk was last wanted or drawn, under
   `cacheBytes` and `cacheMax`, and never touches a chunk in the cut, a
   drawn chunk or the pinned top chunk. So the cache can exceed its
   budget, by exactly the working set: §6's "tiny cache" test.

   The gl side plugs in through two hooks: install(entry) uploads the
   records and returns a handle (kept as entry.gpu), dispose(entry) frees
   it. Both default to nothing, which is what Node uses.

   Job order: the pinned top chunk, then holes, then everything else by
   dist / size (decision 6). A missing chunk whose region a fallback
   covers can wait; a hole can't. */
export const DEFAULTS = {
  detail: 2, maxChunks: 1024, minLod: 0,
  // false: want only the cut's leaves, the first version's rule, kept so
  // experiments/stream.mjs can show what it costs (docs/stream-log.md §3).
  splitsResident: true,
  // Step 5 (docs/ray-plan.md, decision 1): chunks at lod >= rayLod are
  // expanded as ray pages, the rest as records. Infinity is step 4.
  rayLod: Infinity,
  // The path by density (§2b, docs/ray-depth-plan.md): below rayLod, a
  // chunk with more than rayDensity records per pixel of its footprint is
  // traced. Infinity: never. rayDensityFull, when set, is the threshold
  // for a full chunk, and rayDensity the one for an empty chunk, linear
  // in occupancy between them (docs/path-occupancy.md); null keeps one
  // threshold for all. band is the hysteresis factor either side.
  // pxPerRadian and screenPixels describe the viewport (the viewer sets
  // them from its canvas; these are 1920 × 1080 at the viewer's 0.9 rad
  // vertical field of view). kindRule(chunk), when set, decides alone.
  rayDensity: Infinity, rayDensityFull: null, densityBand: 1.5, pxPerRadian: 1080 / (2 * Math.tan(0.45)), screenPixels: 1920 * 1080,
  kindRule: null,
  lodRuleOf: lod => lod === 0 ? 'any' : 'adaptive',   // Q6, decided in step 3b
  installMs: 1.0, uploadBytes: 8 * 1048576, resultBytes: 96 * 1048576,
  cacheBytes: 256 * 1048576, cacheMax: 4096, resultLimit: 64, maxInstalls: 32,
  // Worst case for one chunk: a record per cell of a 64³ checkerboard,
  // plus the seam tail of its boundary shell, and an attribute word for
  // each (step 6), so 8 bytes a cell.
  estimate: 8 * (CHUNK_SIDE ** 3 / 2 + 6 * CHUNK_SIDE ** 2),
};

export function createStreamer(options = {}){
  const cfg = { ...DEFAULTS, ...options };
  const now = cfg.now || (() => performance.now());
  const install = cfg.install || (() => null), dispose = cfg.dispose || (() => {});
  const S = {
    cfg, world: null, revision: 0, serial: 0,
    cache: new Map(), cacheBytes: 0, pending: new Map(), results: [], failures: new Map(),
    sel: null, frame: coverOf({ root: null }, () => false), queue: [], tick: 0, pinned: null, kinds: new Map(),
    stats: { installs: 0, evictions: 0, discarded: 0, failed: 0, uploaded: 0, lastUpload: 0, lastInstalls: 0,
             selectMs: 0, coverMs: 0, switches: 0 },
  };
  const has = key => S.cache.has(key);

  function setWorld(world){
    reset();
    S.world = world; S.sel = null; S.queue = [];
    S.pinned = world && world.root !== EMPTY ? keyOf(world.top, 0, 0, 0) : null;
    S.frame = coverOf({ root: null }, has);
  }
  // Forget every chunk and every job, keeping the world: a new revision.
  function reset(){
    S.revision++;
    for (const e of S.cache.values()) dispose(e);
    S.cache.clear(); S.cacheBytes = 0;
    S.pending.clear(); S.results.length = 0; S.failures.clear();
    S.frame = coverOf({ root: null }, has);
  }
  /* Options take effect at the next update(). A new rayLod or rayDensity
     used to flush the cache (step 5), so the view went blank and reloaded;
     now it only changes which kind each chunk wants, and a chunk of the
     old kind is drawn until its replacement is admitted (§2b). */
  function setOptions(o){ Object.assign(cfg, o); }
  // The kind chunk `key` wants: decided in recover(), for the cut's chunks.
  const kindOf = key => S.kinds.get(key) || 'records';
  // Resident, but not in the kind its chunk wants now.
  const stale = key => { const e = S.cache.get(key); return !!e && e.kind !== kindOf(key); };

  function recover(){
    const t0 = now();
    S.frame = coverOf(S.sel, has);
    S.stats.coverMs = now() - t0;
    S.kinds = chooseKinds(S.sel, key => S.cache.get(key), cfg);
    S.tick++;
    for (const leaf of S.sel.leaves){ const e = S.cache.get(leaf.key); if (e) e.seen = S.tick; }
    for (const d of S.frame.draw){ const e = S.cache.get(d.key); if (e) e.seen = S.tick; }
    for (const c of S.sel.nodes.values()){ const e = S.cache.get(c.key); if (e) e.seen = S.tick; }
    // The job queue: the pinned top chunk, holes (nearest first), then every
    // other missing chunk of the cut, split ones included, by dist / size.
    // A split chunk ranks below `detail` and most leaves at or above it, so
    // this loads coarse to fine, and a chunk's parent is normally in before
    // it is (docs/stream-log.md §3 has the flight that forced this).
    // Last come chunks resident in the wrong kind (§2b): they already draw
    // correctly, so a switch only makes them cheaper.
    const holeKeys = new Set(S.frame.holes.map(h => h.key)), q = [];
    if (S.pinned && !has(S.pinned)) q.push(S.sel.root);
    for (const leaf of S.sel.leaves) if (!has(leaf.key) && holeKeys.has(leaf.key)) q.push(leaf);
    const rest = [], switches = [], wanted = cfg.splitsResident ? S.sel.nodes.values() : S.sel.leaves;
    for (const c of wanted){
      if (!has(c.key) && !holeKeys.has(c.key) && c.key !== S.pinned) rest.push(c);
      else if (stale(c.key)) switches.push(c);
    }
    const byRank = (a, b) => a.dist / a.size - b.dist / b.size || b.lod - a.lod;
    rest.sort(byRank); switches.sort(byRank);
    S.queue = q.concat(rest, switches);
    evict();
  }
  function update(eye){
    if (!S.world) return S.frame;
    const t0 = now();
    S.sel = selectChunks(S.world, eye, cfg);
    S.stats.selectMs = now() - t0;
    recover();
    return S.frame;
  }

  const protectedKeys = () => {
    const p = new Set(S.frame.drawKeys);
    if (S.sel) for (const k of (cfg.splitsResident ? S.sel.nodes.keys() : S.sel.leafKeys)) p.add(k);
    if (S.pinned) p.add(S.pinned);
    return p;
  };
  function evict(){
    if (S.cache.size <= cfg.cacheMax && S.cacheBytes <= cfg.cacheBytes) return;
    const keep = protectedKeys(), cold = [];
    for (const [k, e] of S.cache) if (!keep.has(k)) cold.push(e);
    cold.sort((a, b) => a.seen - b.seen);
    for (const e of cold){
      if (S.cache.size <= cfg.cacheMax && S.cacheBytes <= cfg.cacheBytes) break;
      dispose(e);
      S.cache.delete(e.key); S.cacheBytes -= e.bytes; S.stats.evictions++;
    }
  }

  // Wanted: anything in the cut, leaf or split (a split one is still a
  // fallback for its children), plus the pinned top chunk.
  const demanded = key => key === S.pinned || (S.sel !== null && S.sel.nodes.has(key));
  const reserved = () => {
    let b = 0;
    for (const j of S.pending.values()) if (!j.done) b += j.estimate;
    for (const r of S.results) b += r.bytes;
    return b;
  };
  function nextJob(){
    if (!S.world) return null;
    let inFlight = 0;
    for (const j of S.pending.values()) if (!j.done) inFlight++;
    if (inFlight + S.results.length >= cfg.resultLimit) return null;
    const r = reserved();
    for (const c of S.queue){
      if ((has(c.key) && !stale(c.key)) || S.pending.has(c.key) || (S.failures.get(c.key) || 0) >= 2) continue;
      if (r && r + cfg.estimate > cfg.resultBytes) return null;
      const job = { key: c.key, lod: c.lod, cx: c.x, cy: c.y, cz: c.z, lodRule: cfg.lodRuleOf(c.lod), kind: kindOf(c.key),
                    revision: S.revision, jobId: ++S.serial, estimate: cfg.estimate, done: false };
      S.pending.set(c.key, job);
      return job;
    }
    return null;
  }
  function complete(job, result){
    if (job.revision !== S.revision) return;
    if (S.pending.get(job.key) !== job) return;
    if (!demanded(job.key)){ S.pending.delete(job.key); S.stats.discarded++; return; }
    job.done = true;
    S.results.push({ job, result, bytes: resultBytes(result) });
  }
  function fail(job, error){
    if (job.revision !== S.revision || S.pending.get(job.key) !== job) return;
    S.pending.delete(job.key);
    S.failures.set(job.key, (S.failures.get(job.key) || 0) + 1);
    S.stats.failed++;
    if (S.failures.get(job.key) >= 2) console.warn('chunk expansion failed twice', job.key, error);
  }

  function service(){
    S.stats.lastUpload = 0; S.stats.lastInstalls = 0;
    if (!S.results.length || !S.sel) return false;
    const started = now();
    // A result nobody wants any more goes, and so does one of the wrong
    // kind for a chunk already resident in the right one (the kind flipped
    // back while it was out). One of the wrong kind for a chunk that isn't
    // resident is still taken: it fills the region until the right one comes.
    S.results = S.results.filter(item => {
      const k = item.job.key;
      if (demanded(k) && !(has(k) && !stale(k) && item.job.kind !== kindOf(k))) return true;
      S.pending.delete(k); S.stats.discarded++; return false;
    });
    const holeKeys = new Set(S.frame.holes.map(h => h.key));
    const rank = item => {
      const k = item.job.key, c = S.sel.nodes.get(k);
      return k === S.pinned ? -2 : holeKeys.has(k) ? -1 : (c ? c.dist / c.size : 1e9);
    };
    S.results.sort((a, b) => rank(a) - rank(b));
    let accepted = 0, bytes = 0;
    while (S.results.length && accepted < cfg.maxInstalls){
      const item = S.results[0], { job, result } = item;
      if (accepted && (now() - started >= cfg.installMs || bytes + item.bytes > cfg.uploadBytes)) break;
      S.results.shift(); S.pending.delete(job.key); S.failures.delete(job.key);
      const size = CHUNK_SIDE * 2 ** job.lod;
      // recordCount: the cubes this chunk draws, whichever kind it is, and
      // occupancy, its kept cells over 64³, for its density (§2b); null
      // when the job couldn't say.
      const entry = { key: job.key, kind: job.kind, lod: job.lod, x: job.cx, y: job.cy, z: job.cz,
                      origin: [job.cx * size, job.cy * size, job.cz * size], cellSize: 2 ** job.lod,
                      bytes: item.bytes, seen: S.tick, gpu: null, recordCount: result.recordCount ?? null,
                      occupancy: result.occupied != null ? result.occupied / CHUNK_SIDE ** 3 : null };
      if (job.kind === 'page'){
        // A page keeps its grid of node ids: the brick pool releases by it.
        // words / shown: attribute words and shown cells (step 6), equal
        // when the world has a colour (frameChecker).
        entry.page = result; entry.count = 0; entry.total = 0; entry.cells = result.count;
        entry.shown = result.shown || 0; entry.words = result.attr ? result.attr.length - RUN_HEAD * result.attrAt.reduce((a, v) => a + (v !== ATTR_NONE), 0) : 0;
      } else {
        // words: how many attribute words came with the records (step 6);
        // one per record when the world has a colour (frameChecker).
        Object.assign(entry, { records: result.records, attrs: result.attrs || null, count: result.count, borderStart: result.borderStart,
                               total: result.records.length, quads: result.quads, words: result.attrs ? result.attrs.length : 0 });
      }
      entry.gpu = install(entry);
      if (!cfg.keepRecords){ entry.records = null; entry.attrs = null; if (entry.page) entry.page = { grid: entry.page.grid, count: entry.page.count }; }
      // A switch of kind: the old entry was drawn until this moment.
      const old = S.cache.get(job.key);
      if (old){ dispose(old); S.cacheBytes -= old.bytes; S.stats.switches++; }
      S.cache.set(job.key, entry); S.cacheBytes += entry.bytes;
      accepted++; bytes += item.bytes;
    }
    S.stats.installs += accepted; S.stats.uploaded += bytes;
    S.stats.lastUpload = bytes; S.stats.lastInstalls = accepted;
    if (accepted) recover();
    return accepted > 0;
  }

  return {
    S, setWorld, setOptions, update, nextJob, complete, fail, service, evict,
    get frame(){ return S.frame; }, get sel(){ return S.sel; }, get revision(){ return S.revision; },
    entry: key => S.cache.get(key), kindOf, stale,
    protectedKeys,
  };
}

/* ---- the eye's clearance (§9.3) --------------------------------------------
   How far the eye is from the nearest voxel, from the DAG alone: a
   best-first search over nodes by box distance, so the first voxel popped
   is the nearest. It stops after `budget` nodes and then returns the
   distance at the head of the queue, which is still a lower bound,
   because nothing still queued is nearer. The viewer drives its speed and
   near plane with it: a 2^16 world crosses in seconds, and a gap of one
   voxel is still flyable.

   The first version took the walls of the empty node holding the eye,
   which reads 0 whenever the eye sits on a node boundary (x = 512 in a
   1024 world is on the root's middle plane), however empty both sides
   are. */
export function clearance(world, eye, budget = 4096){
  const { store, root, D } = world;
  if (root === EMPTY) return { d: Infinity, exact: true };
  const box = (lo, size) => {
    let d2 = 0;
    for (let a = 0; a < 3; a++){ const v = eye[a], d = v < lo[a] ? lo[a] - v : v > lo[a] + size ? v - lo[a] - size : 0; d2 += d * d; }
    return Math.sqrt(d2);
  };
  const heap = [{ id: root, k: D, lo: [0, 0, 0], d: box([0, 0, 0], 2 ** D) }];
  const up = i => { while (i > 0){ const p = (i - 1) >> 1; if (heap[p].d <= heap[i].d) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const down = i => { for (;;){ const l = 2 * i + 1, r = l + 1; let m = i;
    if (l < heap.length && heap[l].d < heap[m].d) m = l; if (r < heap.length && heap[r].d < heap[m].d) m = r;
    if (m === i) return; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } };
  for (let n = 0; heap.length; n++){
    const top = heap[0], last = heap.pop();
    if (heap.length){ heap[0] = last; down(0); }
    if (top.k === 0) return { d: top.d, exact: true };
    if (n >= budget) return { d: top.d, exact: false };
    const h = 2 ** (top.k - 1);
    for (let o = 0; o < 8; o++){
      const id = store.child(top.id, o);
      if (id === EMPTY) continue;
      const lo = [top.lo[0] + (o & 1) * h, top.lo[1] + (o >> 1 & 1) * h, top.lo[2] + (o >> 2) * h];
      heap.push({ id, k: top.k - 1, lo, d: box(lo, h) }); up(heap.length - 1);
    }
  }
  return { d: Infinity, exact: true };
}

/* ---- 4. the job ------------------------------------------------------------
   What a worker holds: a snapshot of the DAG and two arrays over its ids,
   copied once per world (decision 9). worldSnapshot builds it on the main
   thread, where the store, the counts and the classes already are; a
   worker (chunk-worker.js), the main-thread fallback and the Node
   simulator all expand chunks through createJobRunner. Every job expands
   with seams, since any chunk may end up next to another lod. */
/* `colour` is the world's colour descriptor (colours.js), not a function:
   the snapshot is posted to workers, and a worker turns it back into a
   field with the colourOf it was handed (docs/attrs-plan.md, decision 2).
   null means no attributes. */
export function worldSnapshot(store, root, D, { counts, classes = null, colour = null } = {}){
  const top = store.maxId, c = new Float64Array(top + 1), poses = classes ? new Uint8Array(top + 1) : null;
  c[FULL] = 1;
  for (let id = FIRST_NODE; id <= top; id++){
    c[id] = counts.of(id);
    if (poses) poses[id] = classes.pose(id);
  }
  return { D, root, keys: store.snapshot().keys, counts: c, poses, colour };
}
/* The buried-chunk shortcut (expand-findings question 3, measured in
   docs/stream-findings.md): a chunk whose node is completely full, with
   all six same-lod neighbours completely full too, has every cell buried
   with no face showing, and no seam tail either, since each boundary
   cell's coarser neighbour lies inside a full neighbour. So it expands to
   nothing, and the job says so without walking its 262,144 cells, which
   is most of a terrain's cut underground. A neighbour outside the world
   is empty, not full, so the world's own walls are always walked. */
const resultBytes = r => r.kind === 'page' ? r.grid.byteLength + r.ids.byteLength + r.bits.byteLength + (r.attr ? r.attr.byteLength + r.attrAt.byteLength : 0)
                                           : r.records.byteLength + (r.attrs ? r.attrs.byteLength : 0);
export { resultBytes };

/* colourOf (colours.js) resolves the snapshot's colour descriptor. It is
   passed in rather than imported, so this file keeps its imports and a
   test can hand in any field. With a colour, every records job also
   returns `attrs`, one word per record (step 6), and meanDepth is the
   coarse mean's depth (chunk-core's cellAttr). */
export const MEAN_DEPTH = 1;
export function createJobRunner(snap, colourOf = null, { meanDepth = MEAN_DEPTH } = {}){
  const store = storeView(snap), C = snap.counts, P = snap.poses;
  const colour = snap.colour && colourOf ? colourOf(snap.colour) : null;
  const counts = { of: id => C[id] }, classes = P ? { pose: id => P[id] } : null;
  const full = (lod, x, y, z) => {
    const id = chunkNode(store, snap.root, snap.D, lod, x, y, z).id;
    return id !== EMPTY && C[id] === 8 ** (lod + CHUNK_LEVELS);
  };
  return job => {
    const t0 = performance.now(), { lod, cx, cy, cz } = job;
    const buried = () => snap.D >= lod + CHUNK_LEVELS && full(lod, cx, cy, cz) && SIDES.every(([dx, dy, dz]) => full(lod, cx + dx, cy + dy, cz + dz));
    if (job.kind === 'page'){
      // A coloured page needs its shown cells, so it expands with seams
      // and the colour; the cells (all kept ones) don't change with either.
      const page = pageJob(store, snap.root, snap.D, counts, job,
        () => expandChunk(store, snap.root, snap.D, { lod, cx, cy, cz },
                          colour ? { counts, lodRule: job.lodRule, cells: true, seams: true, colour, meanDepth }
                                 : { counts, lodRule: job.lodRule, cells: true }),
        { coloured: !!colour, buried });
      return { ...page, ms: performance.now() - t0 };
    }
    if (buried())
      return { records: new Uint32Array(0), attrs: colour ? new Uint32Array(0) : null, count: 0, borderStart: 0, quads: 0,
               occupied: CHUNK_SIDE ** 3, recordCount: 0, buriedChunk: true, ms: performance.now() - t0 };
    const c = expandChunk(store, snap.root, snap.D, { lod, cx, cy, cz },
                          { classes, counts, lodRule: job.lodRule, seams: true, colour, meanDepth });
    return { records: c.records, attrs: c.attrs || null, count: c.count, borderStart: c.borderStart, quads: c.quads,
             occupied: c.occupied, recordCount: c.count, ms: performance.now() - t0 };
  };
}
