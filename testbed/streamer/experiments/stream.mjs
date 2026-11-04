/* Step 4: the chunk virtualiser, measured (docs/stream-plan.md, decision 14).

     node experiments/stream.mjs            # ~4 min, ~1.5 GB; writes docs/stream-results.md and docs/data/stream.json
     node experiments/stream.mjs --quick    # small worlds, prints only (~20 s)

   Everything runs the real streamer (stream-core.js) and real chunk jobs
   (createJobRunner: expandChunk with seams on a worldSnapshot) through
   experiments/stream-sim.mjs, whose workers live on a virtual clock and
   take each job's *measured* time. So the numbers are this machine's
   expand speed and nothing else: no GPU, no SwiftShader, no frame loop.

   Five measurements, one table each in the results:
   1. What a view costs at rest: the cut, the bytes resident, the cubes
      drawn, the seam tail, the job times and the per-frame bookkeeping,
      at detail 2 (the default) with and without the 1024-chunk cap.
   2. The detail sweep: how all of that grows with K.
   3. Flights: a circle through the eye at 16, 64 and 256 lod-0 chunks a
      second (×64 voxels), with 1 and 4 workers. How often the view falls back,
      how coarse it gets, jobs and uploads per second, and how long it
      takes to settle after stopping.
   4. Leaves only against the whole cut (decision 4 as first built, and as
      fixed): the flight that forced split chunks into the working set.
   5. §6's tiny cache against 256 MB, on an out-and-back flight: what
      keeping nothing costs in jobs.
   Since 2026-11-03 the worlds include the kit (docs/kit-plan.md, decision
   9) at D = 14 and 16, from a street of it, where it has content at every
   scale around the eye. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createStore, createCounts, createClasses, OH48 } from '../dag-core.js';
import { createWorld, worldSnapshot, selectChunks, coverOf, clearance } from '../stream-core.js';
import { createSim, line } from './stream-sim.mjs';
import { SHAPES, fieldOf } from './shapes.mjs';
import { loadTestbed, rowsOf, automatonOf, AXIS_NAMES } from './testbed-corpus.mjs';
import { kitDesc, buildKit } from '../kit-core.js';

const QUICK = process.argv.includes('--quick');
const started = performance.now();
const tb = loadTestbed(), ROWS = rowsOf(tb);

/* ---- worlds ---------------------------------------------------------------- */
function rowWorld(index, L, eye){
  const row = ROWS[index], s = createStore(), a = automatonOf(tb, row.cfgFor(L));
  const { root, D } = s.fromRadix4(L, a.start, a.step, a.accept, a.keyOf);
  return { name: `${row.label}${row.depth === '-' ? '' : ' ' + row.depth}`, kind: AXIS_NAMES[row.axis], store: s, root, D, eye };
}
function shapeWorld(name, D, eye){
  const s = createStore(), t0 = performance.now(), { root } = s.fromField(D, fieldOf(SHAPES.find(x => x.name === name), D));
  return { name, kind: 'shape', store: s, root, D, eye, buildMs: performance.now() - t0 };
}
// Raised a 256th of the side at a time until 16 voxels clear: at D = 12
// the street's fraction is inside a solid (experiments/kit.mjs, §3).
function kitWorld(D, at){
  const t0 = performance.now(), k = buildKit(kitDesc({ D })), buildMs = performance.now() - t0, world = createWorld(k.store, k.root, D), eye = at.map(v => v * world.side);
  while (clearance(world, eye, 2048).d < 16) eye[1] += world.side / 256;
  return { name: `kit D=${D}`, kind: 'kit', store: k.store, root: k.root, D, eye: eye.map(v => v / world.side), buildMs };
}
// Eyes as fractions of the world side: inside the rows' cube, above the
// terrain, just off the sphere, above the half-space's plane; in a street
// of the kit (stream-shots' kit-street).
const KIT_STREET = [0.02, 0.12, 0.02];
const IN = [0.5, 0.62, 0.5];
const WORLDS = QUICK ? [
  () => rowWorld(146, 6, IN),
  () => shapeWorld('terrain', 9, [0.5, 0.68, 0.5]),
  () => kitWorld(12, KIT_STREET),
] : [
  () => rowWorld(146, 8, IN),                       // seed scan #42.0: random rule, porous
  () => rowWorld(142, 8, IN),                       // Oh uniform
  () => rowWorld(100, 8, IN),                       // a graph system
  () => rowWorld(92, 8, IN),                        // octahedron: a convex solid
  () => shapeWorld('terrain', 11, [0.5, 0.68, 0.5]),
  () => shapeWorld('sphere', 12, [0.5, 0.5, 0.08]),
  () => shapeWorld('half-space', 12, [0.5, 0.75, 0.75]),
  () => kitWorld(14, KIT_STREET),
  () => kitWorld(16, KIT_STREET),
];
const FLY_ALL = QUICK ? [0, 1] : [0, 4];           // worlds flown with 1 and 4 workers; the rest with 4 only

/* ---- helpers ------------------------------------------------------------------ */
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const mb = b => (b / 1048576).toFixed(b < 10 * 1048576 ? 2 : 1);
const f2 = x => Number.isFinite(x) ? x.toFixed(2) : '–';
const f1 = x => Number.isFinite(x) ? x.toFixed(1) : '–';
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const lodSpan = leaves => { const l = leaves.map(c => c.lod); return `${Math.min(...l)}–${Math.max(...l)}`; };

/* What a converged view costs: expand every chunk of the cut (memoised),
   cover it as if all were resident, and add it up. */
function atRest(P, eye, opts){
  const t0 = performance.now(); const sel = selectChunks(P.world, eye, opts); const selectMs = performance.now() - t0;
  const res = new Map();
  for (const c of sel.nodes.values()) res.set(c.key, P.sim.run({ key: c.key, lod: c.lod, cx: c.x, cy: c.y, cz: c.z, lodRule: c.lod ? 'adaptive' : 'any' }));
  const t1 = performance.now(); const fr = coverOf(sel, k => res.has(k)); const coverMs = performance.now() - t1;
  let bytes = 0, splitBytes = 0, tailBytes = 0, cubes = 0, tailDrawn = 0;
  for (const c of sel.nodes.values()){
    const r = res.get(c.key);
    bytes += r.records.byteLength; tailBytes += 4 * (r.records.length - r.count);
    if (c.kids) splitBytes += r.records.byteLength;
  }
  for (const d of fr.draw){ const r = res.get(d.key); cubes += r.count; if (d.open){ cubes += r.records.length - r.count; tailDrawn += r.records.length - r.count; } }
  const ms = [...sel.nodes.values()].map(c => res.get(c.key).ms);
  return { leaves: sel.leaves.length, split: sel.nodes.size - sel.leaves.length, capped: sel.capped, lods: lodSpan(sel.leaves),
           bytes, splitBytes, tailBytes, cubes, tailDrawn, open: fr.draw.filter(d => d.open).length,
           msMed: med(ms), msP95: pct(ms, 0.95), msMax: Math.max(...ms), msSum: ms.reduce((a, b) => a + b, 0),
           selectMs, coverMs };
}

/* One flight: settle at the eye, then fly a horizontal circle through it
   (centred on the world's vertical axis) at `speed` voxels a second for
   `flyMs`, then stop and wait until the cut is resident again (at most
   20 s). `back` flies the same arc out and back. A circle works for any
   speed in any world, where a straight line leaves a small world in a
   fraction of a second. */
const FLY_MS = QUICK ? 4000 : 10000;
function flight(P, { speed, workers, options = {}, back = false }){
  const s = P.world.side, eye = P.eye.map(v => v * s), c = [s / 2, eye[1], s / 2];
  const r = Math.hypot(eye[0] - c[0], eye[2] - c[2]) || 0.3 * s, a0 = Math.atan2(eye[2] - c[2], eye[0] - c[0]);
  const at = d => [c[0] + r * Math.cos(a0 + d / r), c[1], c[2] + r * Math.sin(a0 + d / r)];
  const moveMs = (back ? 2 : 1) * FLY_MS;
  let settled = -1, stopT = -1, settleMs = NaN;
  const path = t => {
    if (settled < 0) return eye;
    const u = Math.min(t - settled, moveMs) / 1000;
    const d = back && u > FLY_MS / 1000 ? speed * (2 * FLY_MS / 1000 - u) : speed * u;
    return at(d);
  };
  // Leaves only never makes split chunks resident, so "settled" there
  // means every leaf is in.
  const conv = row => (options.splitsResident === false ? row.missing : row.missingAll) === 0
                   && row.pending === 0 && row.holes === 0 && row.up === 0 && row.down === 0;
  const motion = [], rest = [];
  P.sim.fly({ path, frames: Math.ceil((30000 + moveMs + 20000) * 0.06), workers, options, check: row => {
    if (settled < 0){ if (conv(row)) settled = row.t; return false; }
    if (row.t - settled <= moveMs){ motion.push(row); return false; }
    if (stopT < 0) stopT = row.t;
    rest.push(row);
    if (conv(row)){ settleMs = row.t - stopT; return true; }
    return row.t - stopT > 20000;
  } });
  const fall = motion.filter(r => r.up || r.down || r.holes);
  const secs = moveMs / 1000;
  return {
    world: P.name, speed, workers, flyMs: moveMs, frames: motion.length, sidesPerS: speed / s,
    fallbackShare: fall.length / Math.max(1, motion.length),
    coarseShare: motion.reduce((a, r) => a + r.up / Math.max(1, r.leaves), 0) / Math.max(1, motion.length),
    maxUp: Math.max(0, ...motion.map(r => r.maxUp)),
    topAlone: motion.filter(r => r.drawn === 1 && r.leaves > 1).length,
    holes: motion.reduce((a, r) => a + r.holes, 0),
    jobsPerS: motion.reduce((a, r) => a + r.started, 0) / secs,
    jobs: motion.reduce((a, r) => a + r.started, 0) + rest.reduce((a, r) => a + r.started, 0),
    uploadMBs: motion.reduce((a, r) => a + r.upload, 0) / secs / 1048576,
    peakMB: Math.max(0, ...motion.concat(rest).map(r => r.cacheBytes)) / 1048576,
    settleMs,
  };
}

/* ---- run ------------------------------------------------------------------------ */
const out = { quick: QUICK, worlds: [], rest: [], sweep: [], flights: [], leavesOnly: [], tiny: [] };
for (const [wi, make] of WORLDS.entries()){
  const w = make(), t0 = performance.now();
  const counts = createCounts(w.store), classes = createClasses(w.store, OH48);
  const snap = worldSnapshot(w.store, w.root, w.D, { counts, classes });
  const world = createWorld(w.store, w.root, w.D), sim = createSim({ world, snap });
  const P = { ...w, world, sim, eye: w.eye };
  const prepMs = performance.now() - t0;
  out.worlds.push({ name: w.name, kind: w.kind, D: w.D, nodes: w.store.size, buildMs: w.buildMs ?? 0, prepMs, snapMB: (snap.keys.byteLength + snap.counts.byteLength + snap.poses.byteLength) / 1048576 });
  const eye = w.eye.map(v => v * world.side);
  for (const cap of [Infinity, 1024]) out.rest.push({ world: w.name, cap, ...atRest(P, eye, { detail: 2, maxChunks: cap }) });
  for (const K of [1, 1.5, 2, 3]) out.sweep.push({ world: w.name, K, ...atRest(P, eye, { detail: K, maxChunks: Infinity }) });
  for (const chunksPerS of [16, 64, 256]) for (const workers of FLY_ALL.includes(wi) ? [1, 4] : [4])
    out.flights.push(flight(P, { speed: chunksPerS * 64, workers }));
  if (FLY_ALL.includes(wi)){
    for (const splitsResident of [false, true])
      out.leavesOnly.push({ splitsResident, ...flight(P, { speed: 64 * 64, workers: 4, options: { splitsResident } }) });
    for (const tiny of [false, true])
      out.tiny.push({ tiny, ...flight(P, { speed: 64 * 64, workers: 4, back: true, options: tiny ? { cacheBytes: 1, cacheMax: 1 } : {} }) });
  }
  console.log(`${w.name} (D=${w.D}): ${((performance.now() - t0) / 1000).toFixed(0)} s, ${sim.memo.size} chunks expanded`);
}
const seconds = (performance.now() - started) / 1000;

/* ---- report ------------------------------------------------------------------------ */
const kb = b => (b / 1024).toFixed(0);
const text = [
  '# Step 4 results: the chunk virtualiser',
  '',
  `Generated by \`node experiments/stream.mjs${QUICK ? ' --quick' : ''}\` on ${new Date().toISOString().slice(0, 10)} in ${seconds.toFixed(0)} s. ` +
  'The reading is in [stream-findings.md](stream-findings.md), the method in [stream-plan.md](stream-plan.md). ' +
  'Job times are this machine\'s, in Node, one thread per simulated worker; nothing here touches a GPU.',
  '',
  '## Worlds',
  '',
  table(['world', 'kind', 'D', 'side', 'DAG nodes', 'build ms', 'counts + classes + snapshot ms', 'snapshot MB (per worker)'],
    out.worlds.map(w => [w.name, w.kind, w.D, (2 ** w.D).toLocaleString('en'), w.nodes.toLocaleString('en'), w.buildMs.toFixed(0), w.prepMs.toFixed(0), w.snapMB.toFixed(2)])),
  '',
  '## 1. A view at rest (detail 2)',
  '',
  'Everything in the cut expanded and resident. *bytes* is the whole cut (leaves and split chunks), *split* is the split chunks\' share of it, ' +
  '*tail* the seam tails\' share. *cubes* is what the converged view draws (leaves, plus the tails of chunks with an open side). ' +
  '*job ms* is one chunk\'s expand time. *cut* and *cover* are the per-frame bookkeeping in ms.',
  '',
  table(['world', 'cap', 'leaves', 'split', 'capped', 'lods', 'MB', 'split %', 'tail %', 'cubes', 'open', 'job ms med / p95 / max', 'cut ms', 'cover ms'],
    out.rest.map(r => [r.world, r.cap === Infinity ? '∞' : r.cap, r.leaves, r.split, r.capped, r.lods, mb(r.bytes), (100 * r.splitBytes / r.bytes).toFixed(0),
      (100 * r.tailBytes / r.bytes).toFixed(1), r.cubes.toLocaleString('en'), r.open, `${f1(r.msMed)} / ${f1(r.msP95)} / ${f1(r.msMax)}`, f2(r.selectMs), f2(r.coverMs)])),
  '',
  '## 2. Detail sweep (no cap)',
  '',
  '*worker s* is the sum of job times: how long one worker takes to fill the view from nothing.',
  '',
  table(['world', 'K', 'leaves', 'split', 'lods', 'MB', 'cubes', 'worker s'],
    out.sweep.map(r => [r.world, r.K, r.leaves, r.split, r.lods, mb(r.bytes), r.cubes.toLocaleString('en'), (r.msSum / 1000).toFixed(1)])),
  '',
  '## 3. Flights',
  '',
  'A horizontal circle through the eye at the given speed in lod-0 chunks (64 voxels) a second, for ' + (QUICK ? 4 : 10) + ' s, after converging at the start. ' +
  '*sides/s* is the same speed in world sides a second. ' +
  '*fallback* is the share of moving frames that drew anything coarser or finer than wanted (or had a hole); *coarse* the mean share of leaves drawn by an ancestor; ' +
  '*max up* the largest lod gap seen; *top alone* the frames that drew only the pinned top chunk. *settle* is the time from stopping until the whole cut is resident.',
  '',
  table(['world', 'chunks/s', 'sides/s', 'workers', 'fallback', 'coarse', 'max up', 'top alone', 'holes', 'jobs/s', 'upload MB/s', 'peak MB', 'settle ms'],
    out.flights.map(r => [r.world, r.speed / 64, r.sidesPerS < 0.1 ? r.sidesPerS.toFixed(3) : r.sidesPerS.toFixed(1), r.workers, f2(r.fallbackShare), f2(r.coarseShare), r.maxUp, r.topAlone, r.holes, r.jobsPerS.toFixed(0), f1(r.uploadMBs), f1(r.peakMB), Number.isFinite(r.settleMs) ? r.settleMs.toFixed(0) : '> 20 s'])),
  '',
  '## 4. Leaves only, or the whole cut',
  '',
  '64 chunks a second, 4 workers. *leaves only* is the streamer as first built: it asks for and protects only the cut\'s leaves.',
  '',
  table(['world', 'wants', 'fallback', 'coarse', 'max up', 'top alone', 'jobs', 'peak MB', 'settle ms'],
    out.leavesOnly.map(r => [r.world, r.splitsResident ? 'whole cut' : 'leaves only', f2(r.fallbackShare), f2(r.coarseShare), r.maxUp, r.topAlone, r.jobs, f1(r.peakMB), Number.isFinite(r.settleMs) ? r.settleMs.toFixed(0) : '> 20 s'])),
  '',
  '## 5. The tiny cache (§6 phase 3)',
  '',
  'Out and back along the same arc at 64 chunks a second, 4 workers. A 1-byte cache keeps only what is protected (the cut, the drawn set, the top chunk), so the way back is expanded again.',
  '',
  table(['world', 'cache', 'fallback', 'coarse', 'holes', 'top alone', 'jobs', 'upload MB/s', 'peak MB', 'settle ms'],
    out.tiny.map(r => [r.world, r.tiny ? '1 byte' : '256 MB', f2(r.fallbackShare), f2(r.coarseShare), r.holes, r.topAlone, r.jobs, f1(r.uploadMBs), f1(r.peakMB), Number.isFinite(r.settleMs) ? r.settleMs.toFixed(0) : '> 20 s'])),
  '',
].join('\n');

if (QUICK) console.log(text);
else {
  mkdirSync(new URL('../docs/data/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../docs/stream-results.md', import.meta.url), text);
  writeFileSync(new URL('../docs/data/stream.json', import.meta.url), JSON.stringify(out, (k, v) => v === Infinity ? 'Infinity' : v, 1));
  console.log(`wrote docs/stream-results.md and docs/data/stream.json (${seconds.toFixed(0)} s)`);
}
