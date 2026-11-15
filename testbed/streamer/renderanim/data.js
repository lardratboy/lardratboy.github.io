/* ================== THE RENDER FILM'S DATA (pure) ========================
   Everything the film shows about the pipeline is computed here by the
   repo's own code, called unchanged: kit-core builds the world, dag-core
   counts it, stream-core cuts it, snapshots it, runs its jobs and streams
   it, chunk-core expands the one chunk the film opens up. No DOM and no gl,
   so Node can import it:

     node renderanim/check.mjs

   prints every number the film shows and holds them to checks of its own.

   THE WORLD is the stream viewer's opening world, the kit at D = 8 in
   level-1 colour frames, seed 1 (stream-viewer.html's KIT_OPENING): 256³
   voxels, a ground layer of sixteen 64³ chunks and four corner towers.
   The viewer draws it at detail 4, which at D = 8 puts every chunk at
   lod 0. The film's cut uses a lower detail, so the coarse lods show.

   THE JOBS are the workers' own: createJobRunner over worldSnapshot, the
   very function chunk-worker.js calls, run here on the main thread (the
   pool's 'compatibility' mode does the same). Every non-empty chunk at
   lods 0, 1 and 2 is run once: 41 jobs, about 0.3 s.

   THE FOCUS CHUNK, (1, 0, 1) at lod 0, is expanded a second time by
   chunk-core's expandChunk with `cells: true`, so the film can show the
   cells the walk visits, buried ones too. Its records must equal the job's
   byte for byte (check.mjs holds that), since the job is job-core's
   fastChunk and the film says they're the same bytes.

   THE STREAM is a replay: the real createStreamer, fed by four simulated
   workers on a virtual clock, the loop of experiments/stream-sim.mjs with
   its job-time model (TEST_COST), so the schedule is the same every time
   the page loads. The film plays it slower than real time and says so.
   ======================================================================== */
import { createCounts, createClasses, OH48, EMPTY, FULL, FIRST_NODE } from '../dag-core.js';
import { expandChunk, chunkNode, nodeAt, mortonXYZ, mortonOf, cellOf, maskOf, poseOf, packRecord, CHUNK_LEVELS } from '../chunk-core.js';
import { createWorld, selectChunks, coverOf, worldSnapshot, createJobRunner, createStreamer, keyOf, DEFAULTS, SIDES } from '../stream-core.js';
import { kitDesc, buildKit } from '../kit-core.js';
import { colourOf } from '../colours.js';
import { TEST_COST } from '../experiments/stream-sim.mjs';

export const KIT = { D: 8, colourLevel: 1, seed: 1 };      // stream-viewer.html's KIT_OPENING, seed 1
export const FOCUS = { lod: 0, cx: 1, cy: 0, cz: 1 };       // the chunk the film opens up
export const FILM_DETAIL = 0.6;                              // the film's cut; the viewer's is 4
export const lodRuleOf = lod => lod === 0 ? 'any' : 'shadow';  // the viewer's (state.rule = 'shadow')
export const SIDE_NAMES = ['+X', '−X', '+Y', '−Y', '+Z', '−Z'];
const now = () => (typeof performance !== 'undefined' ? performance : Date).now();

/* ---- the world, its snapshot and every job ------------------------------- */
export function buildAll(){
  const t0 = now();
  const desc = kitDesc(KIT);
  const kit = buildKit(desc);
  const { store, root } = kit, D = desc.D;
  const counts = createCounts(store), classes = createClasses(store, OH48);
  const t1 = now();
  const snap = worldSnapshot(store, root, D, { counts, classes, colour: desc });
  const runner = createJobRunner(snap, colourOf);
  const world = createWorld(store, root, D);
  const colour = colourOf(desc);

  // Every non-empty chunk at every lod, through the workers' runner.
  const jobs = new Map();
  let jobMs = 0;
  for (let lod = 0; lod <= world.top; lod++){
    const side = 2 ** (D - lod - CHUNK_LEVELS);
    for (let cz = 0; cz < side; cz++) for (let cy = 0; cy < side; cy++) for (let cx = 0; cx < side; cx++){
      const node = chunkNode(store, root, D, lod, cx, cy, cz);
      if (node.id === EMPTY) continue;
      const job = { lod, cx, cy, cz, lodRule: lodRuleOf(lod) };
      const r = runner(job);
      jobMs += r.ms;
      const size = 64 * 2 ** lod, key = keyOf(lod, cx, cy, cz);
      jobs.set(key, { key, lod, x: cx, y: cy, z: cz, id: node.id, size, lo: [cx * size, cy * size, cz * size], cellSize: 2 ** lod, ...r });
    }
  }
  const t2 = now();

  // The focus chunk again, by chunk-core's expandChunk, with every cell it kept.
  const fkey = keyOf(FOCUS.lod, FOCUS.cx, FOCUS.cy, FOCUS.cz);
  const fjob = jobs.get(fkey);
  const fx = expandChunk(store, root, D, FOCUS, { classes, counts, lodRule: 'any', seams: true, colour, meanDepth: 1, cells: true });
  const focus = buildFocus({ store, root, D, counts, classes, colour, fjob, fx });

  // What the job chapter shows: real job objects, from a streamer's own nextJob.
  const jobView = firstJobs(world, fkey);

  // The stream: a replay of the real streamer on a virtual clock.
  const stream = simulate(world, jobs);

  // The seams chapter: a real cover with lod 0 against lod 1, everything resident.
  const seams = seamCover(world);

  const nodes = store.size, voxels = counts.of(root);
  return {
    desc, kit, store, root, D, counts, classes, snap, runner, world, colour, jobs, focus, jobView, stream, seams,
    nodes, voxels, maxId: store.maxId, oh: classes.size,
    bytes: { keys: snap.keys.byteLength, counts: snap.counts.byteLength, poses: snap.poses.byteLength },
    times: { build: t1 - t0, jobs: jobMs, wall: t2 - t1 },
    select: (eye, detail = FILM_DETAIL) => selectChunks(world, eye, { detail }),
    totals: totalsOf(jobs),
  };
}

function totalsOf(jobs){
  const t = { lod: [0, 0, 0].map(() => ({ chunks: 0, records: 0, occupied: 0, bytes: 0 })) };
  for (const j of jobs.values()){
    const L = t.lod[j.lod];
    L.chunks++; L.records += j.count; L.occupied += j.occupied; L.bytes += j.records.byteLength + (j.attrs ? j.attrs.byteLength : 0);
  }
  return t;
}

/* ---- the focus chunk ---------------------------------------------------------
   What the walk, faces and record chapters need: its cells in walk order (as
   records with every face, so the GPU can draw them the way it draws the real
   ones), the apron cells its six neighbours contribute, how many subtrees the
   walk skipped as EMPTY, its path from the root, and one record to follow. */
function buildFocus({ store, root, D, counts, classes, colour, fjob, fx }){
  const n = fx.occupied, cells = fx.cells;
  // Cells in walk order as records with all six faces: index | 63 << 18.
  const all = new Uint32Array(n), walkIdx = new Uint32Array(n);
  let sorted = true;
  for (let i = 0; i < n; i++){
    const p = cells[i], x = p & 255, y = p >> 8 & 255, z = p >> 16;
    walkIdx[i] = mortonOf(x, y, z);
    all[i] = packRecord(walkIdx[i], 63, 0);
    if (i && walkIdx[i] <= walkIdx[i - 1]) sorted = false;
  }
  // The walk, counted: per level below the chunk's node, how many children
  // were non-empty, EMPTY, FULL. The tree walk expandChunk does, not the DAG.
  const node = fjob.id, levels = [];
  for (let k = 0; k <= CHUNK_LEVELS; k++) levels.push({ k, nodes: 0, empty: 0, full: 0 });
  (function walk(id, k){
    levels[k].nodes++;
    if (id === FULL) levels[k].full++;
    if (k === 0) return;
    for (let o = 0; o < 8; o++){
      const c = id === FULL ? FULL : store.child(id, o);
      if (c === EMPTY){ levels[k - 1].empty++; continue; }
      walk(c, k - 1);
    }
  })(node, CHUNK_LEVELS);

  // The path from the root to the chunk's node: an octant digit a level.
  const path = [];
  {
    let id = root;
    const X = FOCUS.cx, Y = FOCUS.cy, Z = FOCUS.cz, level = FOCUS.lod + CHUNK_LEVELS;
    for (let k = D - 1; k >= level; k--){
      const b = k - level, o = (X >> b & 1) | (Y >> b & 1) << 1 | (Z >> b & 1) << 2;
      const next = store.child(id, o);
      path.push({ level: k + 1, id, o, next, bits: [X >> b & 1, Y >> b & 1, Z >> b & 1], size: 2 ** (k + 1) });
      id = next;
    }
    // Each step's box: the node at level k + 1 that holds the chunk.
    for (const s of path){
      const sh = s.level - level;
      s.lo = [(X >> sh) * s.size, (Y >> sh) * s.size, (Z >> sh) * s.size];
    }
  }

  // The apron: the one-cell slabs of the six neighbours that face us, as
  // chunk-relative cells (−1 or 64 on the side's axis).
  const apron = [];
  SIDES.forEach(([dx, dy, dz], f) => {
    const nb = { lod: FOCUS.lod, cx: FOCUS.cx + dx, cy: FOCUS.cy + dy, cz: FOCUS.cz + dz };
    const id = chunkNode(store, root, D, nb.lod, nb.cx, nb.cy, nb.cz).id;
    const list = [];
    if (id !== EMPTY){
      const e = expandChunk(store, root, D, nb, { lodRule: 'any', cells: true });
      const axis = dx ? 0 : dy ? 1 : 2, want = (dx || dy || dz) > 0 ? 0 : 63;
      for (const p of e.cells){
        const c = [p & 255, p >> 8 & 255, p >> 16];
        if (c[axis] !== want) continue;
        c[axis] = want === 0 ? 64 : -1;
        list.push(c);
      }
    }
    apron.push({ side: f, name: SIDE_NAMES[f], id, cells: list });
  });

  // One record to follow: a cell on top of a step, showing +Y and two sides,
  // high up and near the middle, so the camera sees all three.
  let best = -1, score = -Infinity;
  for (let i = 0; i < fjob.count; i++){
    const r = fjob.records[i], m = maskOf(r);
    if (!(m & 4) || popcount(m) !== 3 || !(m & 3) || !(m & 48)) continue;
    const [x, y, z] = mortonXYZ(cellOf(r));
    const s = y * 4 - Math.hypot(x - 36, z - 30) - (m & 2 ? 0 : 6) - (m & 32 ? 0 : 6);
    if (s > score){ score = s; best = i; }
  }
  const rec = fjob.records[best], [rx, ry, rz] = mortonXYZ(cellOf(rec));

  // The focus record's neighbours, for the faces chapter: a 5 × 4 × 5 block of
  // cells round it, each with its occupancy and (if shown) its mask.
  const occ = new Set(), recAt = new Map();
  for (let i = 0; i < n; i++) occ.add(cells[i]);
  for (let i = 0; i < fjob.count; i++) recAt.set(cellOf(fjob.records[i]), fjob.records[i]);

  return {
    key: fjob.key, job: fjob, fx, cells, all, sorted, levels, path, apron, node,
    occupied: n, count: fjob.count, buried: n - fjob.count, tail: fjob.records.length - fjob.count,
    record: { index: best, rec, x: rx, y: ry, z: rz, cell: cellOf(rec), mask: maskOf(rec), pose: poseOf(rec), attr: fjob.attrs[best] },
    occupiedAt: (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < 64 && y < 64 && z < 64 && occ.has(x | y << 8 | z << 16),
    recordAt: (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < 64 && y < 64 && z < 64 ? recAt.get(mortonOf(x, y, z)) ?? null : null,
    same: sameBytes(fx, fjob),
  };
}
const popcount = m => { let c = 0; for (; m; m &= m - 1) c++; return c; };
function sameBytes(a, b){
  if (a.records.length !== b.records.length || a.count !== b.count) return false;
  for (let i = 0; i < a.records.length; i++) if (a.records[i] !== b.records[i] || a.attrs[i] !== b.attrs[i]) return false;
  return true;
}

/* ---- jobs as the streamer makes them --------------------------------------
   A streamer over the world, one update from an eye above the focus chunk,
   and nextJob() until it hands out the focus chunk's job: the first job (the
   pinned top chunk) and that one, as the pool would receive them. */
function firstJobs(world, fkey){
  const st = createStreamer({ now: () => 0, detail: FILM_DETAIL, lodRuleOf });
  st.setWorld(world);
  st.update([96, 70, 96]);
  const first = st.nextJob(), list = [first];
  let focus = first;
  while (focus && focus.key !== fkey){ focus = st.nextJob(); if (focus) list.push(focus); }
  const message = j => ({ type: 'expand', jobId: j.jobId, world: 1, lod: j.lod, cx: j.cx, cy: j.cy, cz: j.cz, lodRule: j.lodRule, kind: j.kind, root: j.root });
  return { first, focus, order: list.map(j => j.key), message: message(focus), bytes: JSON.stringify(message(focus)).length };
}

/* ---- the stream, replayed ---------------------------------------------------
   experiments/stream-sim.mjs's loop, written out so every frame can keep what
   the film draws: the cut, the cover, the workers' jobs and the installs. One
   frame is 1/60 s of virtual time: the eye moves, update, each worker finishes
   and takes jobs until its current one runs past the frame, then service. A
   job takes TEST_COST(result) ms, the sim's model of expandChunk's time.

   The cache is cut to 30 chunks (the real default is 4,096), so this small
   world shows eviction: every chunk of it fits in the real one. */
export const STREAM = { frames: 150, workers: 4, frameMs: 1000 / 60, cacheMax: 30, detail: FILM_DETAIL };
export function streamPath(t){
  // t in virtual ms. Down from high over one corner, across the ground, and up
  // the far tower.
  const u = Math.min(1, t / (STREAM.frames * STREAM.frameMs));
  const keys = [[-70, 150, -40], [40, 60, 60], [140, 34, 120], [230, 70, 200], [250, 150, 250]];
  const s = u * (keys.length - 1), i = Math.min(keys.length - 2, Math.floor(s)), f = s - i, e = f * f * (3 - 2 * f);
  const a = keys[i], b = keys[i + 1];
  return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
}
function simulate(world, jobs){
  const installed = [], evicted = [];
  const st = createStreamer({ now: () => 0, keepRecords: false, detail: STREAM.detail, cacheMax: STREAM.cacheMax,
                              lodRuleOf,
                              install: e => { installed.push(e.key); return e.total ? { key: e.key } : null; },
                              dispose: e => { evicted.push(e.key); } });
  st.setWorld(world);
  const slots = Array.from({ length: STREAM.workers }, () => ({ job: null, result: null, done: 0, free: 0, t0: 0 }));
  const frames = [], bars = [];
  let t = 0;
  for (let f = 0; f < STREAM.frames; f++){
    t += STREAM.frameMs;
    installed.length = 0; evicted.length = 0;
    const eye = streamPath(t);
    st.update(eye);
    for (let w = 0; w < slots.length; w++){
      const s = slots[w];
      for (;;){
        if (s.job){
          if (s.done > t) break;
          st.complete(s.job, s.result);
          bars.push({ w, key: s.job.key, lod: s.job.lod, t0: s.t0, t1: s.done, jobId: s.job.jobId });
          s.free = s.done; s.job = null;
        }
        const job = st.nextJob();
        if (!job) break;
        const r = jobs.get(job.key);
        if (!r) throw new Error('stream: no job for ' + job.key);
        s.job = job; s.result = r; s.t0 = Math.max(s.free, t - STREAM.frameMs); s.done = s.t0 + TEST_COST(r);
      }
    }
    st.service();
    const S = st.S, fr = st.frame;
    frames.push({
      f, t, eye,
      nodes: [...st.sel.nodes.values()].map(c => ({ key: c.key, lod: c.lod, lo: c.lo, size: c.size, leaf: !c.kids })),
      draw: fr.draw.map(d => ({ key: d.key, open: d.open, lod: d.lod })),
      holes: fr.holes.map(h => h.key), up: fr.up, down: fr.down,
      installed: [...installed], evicted: evicted.filter(k => !S.cache.has(k)),
      resident: S.cache.size, cacheBytes: S.cacheBytes, upload: S.stats.lastUpload,
      inFlight: [...S.pending.values()].filter(j => !j.done).length, results: S.results.length,
      running: slots.map(s => s.job ? { key: s.job.key, lod: s.job.lod, t0: s.t0, t1: s.done } : null),
      queue: S.queue.filter(c => !S.cache.has(c.key) && !S.pending.has(c.key)).slice(0, 5).map(c => c.key),
    });
  }
  for (const [w, s] of slots.entries()) if (s.job) bars.push({ w, key: s.job.key, lod: s.job.lod, t0: s.t0, t1: s.done, open: true });
  return { frames, bars, stats: { ...st.S.stats }, frameMs: STREAM.frameMs };
}

/* ---- seams -------------------------------------------------------------------
   A cut whose leaves are lod 0 on one side and lod 1 on the other, and its
   cover with everything resident: coverOf's own `open` sides. */
function seamCover(world){
  const eye = [60, 20, 100];
  const sel = selectChunks(world, eye, { detail: 0.45 });
  const cover = coverOf(sel, () => true);
  return { eye, draw: cover.draw.map(d => ({ key: d.key, lod: d.lod, open: d.open, lo: d.lo, size: d.size })) };
}
