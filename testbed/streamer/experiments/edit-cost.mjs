/* What edit-core.js costs for real (docs/edit-log.md §4): a click on the clay
   worlds, the colour table's lookups and rebuilds, and what the exact "is it
   full?" test costs a job. Prints only; ~10 s. It measures job times, so run it
   on an idle machine. The sketch's numbers (experiments/csg-sketch.mjs, sections
   M and P) were on other worlds and on the sketch's own place and pick. */
import os from 'node:os';
import { createStore, createCounts, EMPTY, isFull } from '../dag-core.js';
import { aimAt, place, createBlockTable, editedField, createEditLog } from '../edit-core.js';
import { buildClay, clayDesc, clayColour } from '../clay-core.js';
import { rgb8 } from '../attr-core.js';
import { expandChunk, nodeAt } from '../chunk-core.js';

const now = () => performance.now();
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const f = n => n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 10 ? n.toFixed(1) : n.toFixed(2);
function mulberry(seed){ let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

console.log(`load average ${os.loadavg()[0].toFixed(1)}, Node ${process.version}\n`);

/* ---- a click, on the page's own worlds ------------------------------------ */
console.log('## A click: aim (pick + targets), then place or break through the log\n');
console.log('| world | block side | aim µs, median / p99 | edit µs, median / p99 | new nodes a click | clicks that changed nothing |');
console.log('|---|---:|---|---|---:|---:|');
for (const [name, over] of [['clay ball, D = 20', {}], ['clay block, D = 20', { shape: 'block' }], ['ball on ground, D = 20', { ground: true }], ['flat ground, D = 20', { lump: 0, ground: true }]])
for (const level of [0, 3]){
  const desc = clayDesc(over), store = createStore(), { root } = buildClay(desc, store), log = createEditLog(root), rand = mulberry(7), D = desc.D, c = 2 ** (D - 1);
  const top = over.ground ? c + (over.lump === 0 ? 0 : 200) : c;
  const aimUs = [], editUs = [], made = [];
  let nothing = 0;
  for (let i = 0; i < 3000; i++){
    const a = rand() * 6.283, e = 0.2 + rand() * 1.2, r = (20 + rand() * 90) * 2 ** level;
    const o = [c + r * Math.cos(e) * Math.cos(a), top + r * Math.sin(e), c + r * Math.cos(e) * Math.sin(a)];
    const d = [c + (rand() - 0.5) * 60 * 2 ** level - o[0], top - o[1], c + (rand() - 0.5) * 60 * 2 ** level - o[2]];
    let t0 = now();
    const aim = aimAt(store, log.root, D, o, d, level);
    aimUs.push((now() - t0) * 1e3);
    if (!aim) continue;
    const placing = rand() < 0.6 && aim.placeAt, before = store.size;
    t0 = now();
    const changed = placing ? log.place(store, D, aim.placeAt, 0x3050a0) : log.erase(store, D, aim.breakAt);
    editUs.push((now() - t0) * 1e3);
    made.push(store.size - before);
    if (!changed) nothing++;
  }
  console.log(`| ${name} | ${2 ** level} | ${f(pct(aimUs, 0.5))} / ${f(pct(aimUs, 0.99))} | ${f(pct(editUs, 0.5))} / ${f(pct(editUs, 0.99))} | ${pct(made, 0.5)} | ${nothing} of ${editUs.length} |`);
}

/* ---- the colour table ------------------------------------------------------- */
console.log('\n## The colour table: a lookup through editedField, and rebuilding from the log\n');
console.log('| ops | sizes in use | lookup ns, block hit | lookup ns, base field | rebuild ms | table MB | delta, whole log, MB |');
console.log('|---:|---:|---:|---:|---:|---:|---:|');
const clay = clayColour(clayDesc(), rgb8);
for (const [N, levels] of [[1000, [0]], [10000, [0]], [100000, [0]], [100000, [0, 1, 2, 3, 4, 5, 6]]]){
  const store = createStore(), log = createEditLog(EMPTY), rand = mulberry(9), D = 20, c = 2 ** 19;
  for (let i = 0; log.count < N; i++){
    const l = levels[i % levels.length], s = 512;
    log.place(store, D, { level: l, X: (c + Math.floor(rand() * s) * 2 ** l) >> l, Y: (c + Math.floor(rand() * s) * 2 ** l) >> l, Z: (c + Math.floor(rand() * s) * 2 ** l) >> l }, i & 0xffffff);
  }
  const delta = log.delta(), table = createBlockTable(), field = editedField(clay, table);
  let t0 = now(); table.sync(delta); let build = now() - t0;
  for (let i = 0; i < 4; i++){ const t2 = createBlockTable(); t0 = now(); t2.sync(delta); build = Math.min(build, now() - t0); }
  const ops = log.ops(), P = 1e6;
  const hit = new Float64Array(3 * 4096), miss = new Float64Array(3 * 4096);
  for (let i = 0; i < 4096; i++){
    const j = Math.floor(rand() * N) * 5, l = ops[j], S = 2 ** l;
    hit[3 * i] = ops[j + 1] * S + 0.5; hit[3 * i + 1] = ops[j + 2] * S + 0.5; hit[3 * i + 2] = ops[j + 3] * S + 0.5;
    miss[3 * i] = 1000 + rand() * 1000; miss[3 * i + 1] = 1000 + rand() * 1000; miss[3 * i + 2] = 1000 + rand() * 1000;
  }
  const time = pts => { let s = 0; const t = now(); for (let i = 0; i < P; i++){ const k = 3 * (i & 4095); s += field(pts[k], pts[k + 1], pts[k + 2]); } return [(now() - t) / P * 1e6, s]; };
  const [hitNs] = time(hit), [missNs] = time(miss);
  console.log(`| ${N.toLocaleString('en-US')} | ${levels.length} | ${f(hitNs)} | ${f(missNs)} | ${f(build)} | ${f(table.bytes() / 1048576)} | ${f(delta.ops.byteLength / 1048576)} |`);
}

/* ---- isFull against the count ------------------------------------------------ */
console.log('\n## The exact full test, against the count it replaced\n');
{
  const store = createStore(), D = 28, solid = store.solid(D), holed = place(store, solid, D, 0, 2 ** 20, 2 ** 20, 2 ** 20, EMPTY), counts = createCounts(store);
  const ids = [[12, 'solid chunk', store.solid(18), 18], [12, 'holed chunk', nodeAt(store, holed, D, 18, 4, 4, 4), 18], [20, 'solid chunk', store.solid(26), 26], [20, 'holed chunk', nodeAt(store, holed, D, 26, 0, 0, 0), 26], [4, 'solid chunk', store.solid(10), 10]];
  console.log('| lod | node | count test ns | isFull ns |\n|---:|---|---:|---:|');
  for (const [lod, name, id, level] of ids){
    const N = 2e6, pow = 8 ** level;
    let s = 0, t0 = now();
    for (let i = 0; i < N; i++) if (counts.of(id) === pow) s++;
    const a = (now() - t0) / N * 1e6;
    t0 = now();
    for (let i = 0; i < N; i++) if (isFull(store, counts, id, level)) s++;
    console.log(`| ${lod} | ${name} | ${f(a)} | ${f((now() - t0) / N * 1e6)} |`);
    if (s < 0) console.log(s);
  }
  console.log('\n| lod | job | ms, median of 5 |\n|---:|---|---:|');
  for (const lod of [12, 16, 20]){
    const time = (root, name) => {
      counts.update();     // the hole's nodes are new
      const ms = [];
      for (let i = 0; i < 5; i++){ const t0 = now(); expandChunk(store, root, D, { lod, cx: 1, cy: 1, cz: 1 }, { counts, lodRule: 'adaptive', seams: true }); ms.push(now() - t0); }
      console.log(`| ${lod} | ${name} | ${f(pct(ms, 0.5))} |`);
    };
    time(place(store, solid, D, 0, 2 ** (lod + 7), 2 ** (lod + 6) * 1.5, 2 ** (lod + 6) * 1.5, EMPTY), 'a hole across the boundary: now walked');
    time(place(store, solid, D, 0, 2 ** (lod + 6) * 1.5, 2 ** (lod + 6) * 1.5, 2 ** (lod + 6) * 1.5, EMPTY), 'a hole in its middle: now walked');
  }
}
