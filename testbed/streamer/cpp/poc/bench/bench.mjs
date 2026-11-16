/* bench.mjs — vdagbench's twin in JavaScript, through the repo's own modules
   unchanged (vdag-core, dag-core, stream-core's selectChunks and
   createJobRunner, which runs job-core's fastChunk, colours.js's baked field).

     node cpp/poc/bench/bench.mjs <file.vdag> [--world i] [--detail 4] [--max 1024]
          [--rule shadow] [--threads 4] [--reps 5] [--eye view|centre|x,y,z]... [--json]

   The same steps as bench.cpp, in the same order: load, the cut, every node of
   the cut as a job on one thread (cold: a fresh runner each rep; warm: the same
   runner again), then on N worker_threads, each holding its own copy of the
   snapshot as a browser chunk worker does. The checksum is the same FNV-1a over
   the same numbers in the same order, so equal checksums mean the two did
   exactly the same work, byte for byte.

   Two differences from the browser viewer, both on purpose and both matched in
   C++: no poses (createClasses; only the ray path needs them), and colour only
   for baked worlds and the named kinds C++ has ported (scatter, kit, dungeon);
   the others (caves, terrain, lattice, ...) are drawn in gamut with no words on
   both sides. --no-colour drops colour on both. */
import { readFile } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const mod = f => import(path.join(ROOT, f));
const { readVdag, graphDecoder } = await mod('vdag-core.js');
const { createStore, createCounts, storeView } = await mod('dag-core.js');
const { createWorld, selectChunks, worldSnapshot, createJobRunner } = await mod('stream-core.js');
const { colourOf } = await mod('colours.js');

const args = process.argv.slice(2);
const opt = { world: 0, detail: 4, max: 1024, rule: 'shadow', threads: 4, reps: 5, eyes: [], json: false, colour: true, file: null };
for (let i = 0; i < args.length; i++){
  const a = args[i], next = () => args[++i];
  if (a === '--world') opt.world = +next();
  else if (a === '--detail') opt.detail = +next();
  else if (a === '--max') opt.max = +next();
  else if (a === '--rule') opt.rule = next();
  else if (a === '--threads') opt.threads = Math.max(1, +next());
  else if (a === '--reps') opt.reps = Math.max(1, +next());
  else if (a === '--eye') opt.eyes.push(next());
  else if (a === '--json') opt.json = true;
  else if (a === '--no-colour') opt.colour = false;
  else if (!a.startsWith('-')) opt.file = a;
  else { console.error(`unknown option ${a}`); process.exit(2); }
}
if (!opt.file){ console.error('usage: node bench.mjs <file.vdag> [options]'); process.exit(2); }
if (!opt.eyes.length) opt.eyes = ['view', 'centre'];

const now = () => performance.now();
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const min = a => Math.min(...a);

/* ---- load ------------------------------------------------------------------
   readVdag is the whole reader (it prunes each world and checks DESC's counts
   and the colour print, which C++ doesn't); `decode` is the part C++ does:
   gunzip and the graph alone. */
let t0 = now();
const bytes = new Uint8Array(await readFile(opt.file));
const tRead = now() - t0;
t0 = now();
const { worlds } = await readVdag(bytes, { colourOf });
const tReadVdag = now() - t0;
// The decode alone, as C++ does it: NODE's gunzip and the graph into one store.
let tUnpack = 0, tDecode = 0;
{
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), dec = new TextDecoder();
  let node = null, Ds = null;
  for (let p = 8; p < bytes.length;){
    const tag = dec.decode(bytes.subarray(p, p + 4)), n = dv.getUint32(p + 4, true), b = bytes.subarray(p + 8, p + 8 + n);
    if (tag === 'NODE') node = b;
    if (tag === 'ROOT'){ Ds = Array.from(b.subarray(1, 1 + b[0])); }
    p += 8 + n;
  }
  t0 = now();
  let payload = node.subarray(2);
  if (node[1] === 1){
    const s = new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip'));
    payload = new Uint8Array(await new Response(s).arrayBuffer());
  }
  tUnpack = now() - t0;
  t0 = now();
  graphDecoder(createStore()).decode(payload, Ds);
  tDecode = now() - t0;
}
const w = worlds[opt.world];
t0 = now();
const view = storeView({ keys: w.keys }), counts = createCounts(view);
const tCounts = now() - t0;
/* Colour: a baked world's words, or a named field of a kind the C++ has
   (cpp/poc/src/fields.cpp), so both sides compute the same words. Every other
   kind is drawn in gamut on both sides, with no words. */
const PORTED = ['baked', 'scatter', 'kit', 'dungeon'];
const kind = w.colour?.kind ?? null, baked = kind === 'baked';
const colour = opt.colour && PORTED.includes(kind) ? w.colour : null;
t0 = now();
const snap = worldSnapshot(view, w.root, w.D, { counts, colour });
const tSnap = now() - t0;
const side = 2 ** w.D;

console.log(`JS   ${opt.file}`);
console.log(`     world '${w.name || w.colour?.kind || 'world'}'  D = ${w.D}  nodes ${w.keys.length / 9}  voxels ${counts.of(w.root)}  ${baked && colour ? `baked, ${w.colour.words.length} words at ${w.colour.bits} bits` : colour ? `named colour: ${kind}` : 'no colour (gamut)'}`);
console.log(`     load  read ${tRead.toFixed(1)}  readVdag ${tReadVdag.toFixed(1)} (of which unpack ${tUnpack.toFixed(1)}  decode ${tDecode.toFixed(1)})  counts ${tCounts.toFixed(1)}  snapshot ${tSnap.toFixed(1)} ms`);

/* ---- the checksum: bench.cpp's, word for word ------------------------------- */
function fnv(h, v){
  for (let i = 0; i < 4; i++){ h ^= (v >>> (8 * i)) & 255; h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function checksum(jobs, res){
  const order = jobs.map((_, i) => i).sort((a, b) => jobs[a].lod - jobs[b].lod || jobs[a].cx - jobs[b].cx || jobs[a].cy - jobs[b].cy || jobs[a].cz - jobs[b].cz);
  let h = 0x811c9dc5;
  for (const i of order){
    const r = res[i], j = jobs[i];
    h = fnv(h, j.lod); h = fnv(h, j.cx); h = fnv(h, j.cy); h = fnv(h, j.cz);
    h = fnv(h, r.count); h = fnv(h, r.records.length); h = fnv(h, r.quads);
    for (let f = 0; f < 6; f++) h = fnv(h, r.openQuads[f]);
    h = fnv(h, r.occupied);
    for (const v of r.records) h = fnv(h, v);
    const a = r.attrs || [];
    h = fnv(h, a.length);
    for (const v of a) h = fnv(h, v);
  }
  return h >>> 0;
}

/* ---- workers ------------------------------------------------------------------
   Each worker gets the snapshot by structured clone (a copy each, as the
   browser's chunk workers do) and pulls jobs off a shared counter. */
const workerUrl = new URL('./bench-worker.mjs', import.meta.url);
const workers = Array.from({ length: opt.threads }, () => new Worker(workerUrl, { workerData: { root: ROOT, snap } }));
await Promise.all(workers.map(wk => new Promise(r => wk.once('message', r))));   // each says it's ready
async function runThreads(jobs){
  const counter = new Int32Array(new SharedArrayBuffer(4)), res = new Array(jobs.length);
  const t = now();
  await Promise.all(workers.map(wk => new Promise(resolve => {
    wk.once('message', out => { for (const [i, r] of out) res[i] = r; resolve(); });
    wk.postMessage({ jobs, counter });
  })));
  return { ms: now() - t, res };
}

const json = { lang: 'js', file: opt.file, load: tReadVdag + tCounts + tSnap, eyes: [] };
for (const e of opt.eyes){
  let eye;
  if (e === 'view') eye = w.view ? w.view.eye : [-0.35 * side, 0.9 * side, -0.45 * side];
  else if (e === 'centre') eye = [0.5 * side, 0.5 * side, 0.5 * side];
  else eye = e.split(',').map(Number);
  const cw = createWorld(view, w.root, w.D);
  let sel;
  const cutMs = [];
  for (let r = 0; r < 50; r++){ const t = now(); sel = selectChunks(cw, eye, { detail: opt.detail, maxChunks: opt.max }); cutMs.push(now() - t); }
  const nodes = [...sel.nodes.values()];
  const order = nodes.map((_, i) => i).sort((a, b) => nodes[a].dist / nodes[a].size - nodes[b].dist / nodes[b].size || nodes[b].lod - nodes[a].lod || a - b);
  const jobs = order.map(i => { const c = nodes[i]; return { kind: 'records', lod: c.lod, cx: c.x, cy: c.y, cz: c.z, lodRule: c.lod === 0 ? 'any' : opt.rule }; });

  const cold = [], warm = [];
  let res = null, perJob = [];
  for (let r = 0; r < opt.reps; r++){
    const run = createJobRunner(snap, colourOf);
    let t = now();
    res = jobs.map(j => run(j));
    cold.push(now() - t);
    t = now();
    res = jobs.map(j => run(j));
    warm.push(now() - t);
    if (r === opt.reps - 1) perJob = res.map(x => x.ms);
  }
  const sum = checksum(jobs, res);
  const multi = [];
  let mres = null;
  for (let r = 0; r < opt.reps; r++){ const o = await runThreads(jobs); multi.push(o.ms); mres = o.res; }
  const msum = checksum(jobs, mres);

  let recs = 0, tail = 0, words = 0, buried = 0, empty = 0, tris = 0;
  for (const x of res){ recs += x.count; tail += x.records.length - x.count; words += x.attrs ? x.attrs.length : 0; buried += x.buriedChunk ? 1 : 0; empty += !x.buriedChunk && !x.records.length ? 1 : 0; tris += 2 * x.quads; }
  const hist = {};
  for (const l of sel.leaves) hist[l.lod] = (hist[l.lod] || 0) + 1;
  const lods = Object.keys(hist).sort((a, b) => a - b).map(l => ` ${l}:${hist[l]}`).join('');
  console.log(`\n     eye ${e.padEnd(7)} [${eye.map(v => v.toFixed(1)).join(', ')}]  detail ${opt.detail}  rule ${opt.rule}`);
  console.log(`     cut   ${nodes.length} nodes, ${sel.leaves.length} leaves (lod${lods}), capped ${sel.capped}   ${median(cutMs).toFixed(3)} ms median`);
  console.log(`     jobs  ${jobs.length}  (${buried} buried, ${empty} empty)  records ${recs} + tail ${tail}  words ${words}  triangles ${tris}  bytes ${(4 * (recs + tail + words) / 1048576).toFixed(1)} MB`);
  console.log(`     1 thread   cold ${min(cold).toFixed(1)} ms (min of ${opt.reps})  warm ${min(warm).toFixed(1)} ms   per job: median ${median(perJob).toFixed(3)}  max ${Math.max(...perJob).toFixed(2)} ms`);
  console.log(`     ${opt.threads} threads  ${min(multi).toFixed(1)} ms wall (min of ${opt.reps})  = ${(min(cold) / min(multi)).toFixed(1)}x one thread cold`);
  console.log(`     checksum ${sum.toString(16).padStart(8, '0')}${msum === sum ? '' : '  (threads DIFFER!)'}`);
  json.eyes.push({ eye: e, nodes: nodes.length, leaves: sel.leaves.length, cutMs: median(cutMs), cold: min(cold), warm: min(warm), multi: min(multi),
                   threads: opt.threads, records: recs, tail, words, checksum: sum.toString(16).padStart(8, '0') });
}
if (opt.json) console.log(`\nJSON ${JSON.stringify(json)}`);
for (const wk of workers) await wk.terminate();
