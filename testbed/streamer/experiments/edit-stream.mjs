/* What a click costs the view (docs/edit-stream-log.md §6): the streamer's
   transaction on the page's own worlds, in Node, on the simulator's virtual clock,
   with real jobs at their measured times. Prints only; about 2 minutes. It measures
   job times, so run it on an idle machine.

   No browser ran, so upload, install and message hops aren't in these frames, and
   the first real latency number has to wait for step 4. What this does say is how
   many chunks an edit holds up and how long four workers take over them.

   The columns: a click happens, its edit opens, jobs run, and the flip shows it. Then
   the split chunks, which aren't drawn, catch up behind it. */
import os from 'node:os';
import { createStore, createCounts } from '../dag-core.js';
import { createWorld, worldSnapshot, createTailer } from '../stream-core.js';
import { aimAt, pick, createEditLog } from '../edit-core.js';
import { buildClay, clayDesc } from '../clay-core.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { createSim, still } from './stream-sim.mjs';

const now = () => performance.now();
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const top = a => a.length ? Math.max(...a) : NaN;
const f = n => n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 10 ? n.toFixed(1) : n.toFixed(2);
function mulberry(seed){ let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const CLICKS = 12;
const clay = (name, over, eyeOf) => ({ name, build(){
  const desc = clayDesc(over), store = createStore(), { root } = buildClay(desc, store);
  return { store, root, D: desc.D, colour: { kind: 'clay', ...desc }, eye: eyeOf(2 ** (desc.D - 1)), dir: [0.02, -1, 0.03] };
} });
const WORLDS = [
  clay('clay ball, D = 20', {}, c => [c + 3, c + 170, c + 5]),
  clay('ball on ground, D = 20', { ground: true }, c => [c + 400, c + 35, c + 5]),
  clay('flat ground, D = 20', { lump: 0, ground: true }, c => [c + 3, c + 35, c + 5]),
  { name: 'terrain, D = 12', build(){
    const D = 12, store = createStore(), { root } = store.fromField(D, fieldOf(SHAPES.find(x => x.name === 'terrain'), D));
    // 35 voxels above whatever is under the world's centre.
    const hit = pick(store, root, D, [2048.5, 4095.5, 2048.5], [0, -1, 0]);
    return { store, root, D, colour: { kind: 'shape', name: 'terrain', D }, eye: [2048.5, hit.y + 35, 2048.5], dir: [0.02, -1, 0.03] };
  } },
];

console.log(`load average ${os.loadavg()[0].toFixed(1)}, Node ${process.version}, ${CLICKS} clicks a row at 4 workers, measured job times\n`);
console.log('| world | edit | cut | chunks in the flip, median / most | their job ms, median / most | frames, click to flip, median / most | KB in the flip | split chunks behind it | frames until all current | setRoot ms | recover ms, plain → editing | tail KB |');
console.log('|---|---|---:|---|---:|---|---:|---:|---:|---:|---|---:|');

for (const def of WORLDS) for (const placing of [true, false]){
  const { store, root, D, colour, eye, dir } = def.build();
  const counts = createCounts(store), snap = worldSnapshot(store, root, D, { counts, colour });
  const log = createEditLog(root), tailer = createTailer(store, { counts, log });
  const sim = createSim({ world: createWorld(store, root, D), snap });
  let tailBytes = 0;
  const st = sim.makeStreamer({ publish: () => { const t = tailer(); tailBytes = t.keys.byteLength + t.counts.byteLength + (t.edits ? t.edits.ops.byteLength : 0); sim.tail(t); } });
  const rand = mulberry(7);

  // Settled first, at the measured job times, in one flight with the clicks: a
  // flight's workers end with it.
  const rows = [], jobMs = [], counted = new Set(), setRootMs = [], plain = [], editing = [];
  let clicks = 0, wait = -1, c = null;
  const click = () => {
    const d = [dir[0] + (rand() - 0.5) * 0.2, dir[1] + (rand() - 0.5) * 0.2, dir[2] + (rand() - 0.5) * 0.2];
    const aim = aimAt(store, log.root, D, eye, d, 0);
    if (!aim) throw new Error(`${def.name}: nothing in reach`);
    const change = placing && aim.placeAt ? log.place(store, D, aim.placeAt, 0xff4020) : log.erase(store, D, aim.breakAt);
    if (!change) return false;
    const t0 = now();
    st.setRoot(log.root, change);
    setRootMs.push(now() - t0);
    return true;
  };
  sim.fly({ streamer: st, path: still(eye), frames: 1e6,
    before(){
      if (!st.sel || c || wait > 0){ if (wait > 0) wait--; return; }
      if ([...st.sel.nodes.keys()].some(k => !st.S.cache.has(k) || st.stale(k)) || st.S.pending.size) return;
      if (clicks === CLICKS) return;
      if (click()){ c = { flip: null, group: 0, bytes: 0 }; clicks++; }
    },
    check(row, { st }){
      if (st.S.edit){
        const t0 = now(); st.update(eye); editing.push(now() - t0);
        for (const it of st.S.edit.held.values()) if (!counted.has(it.job.jobId)){ counted.add(it.job.jobId); jobMs.push(it.result.ms); }
      } else if (!c){ const t0 = now(); st.update(eye); plain.push(now() - t0); }
      if (!c) return clicks === CLICKS && !st.editing && st.S.pending.size === 0 && [...st.sel.nodes.keys()].every(k => !st.stale(k));
      c.frames = (c.frames || 0) + 1;
      if (row.flipped && !c.flip){ c.flip = c.frames; c.group = row.flipped; c.bytes = row.flipBytes; c.behind = row.out; c.cut = row.nodes; }
      if (!c.flip && !st.editing && !row.flipped && row.flips){ c.flip = c.frames; c.group = 0; c.behind = row.out; c.cut = row.nodes; }
      if (c.flip && !st.editing && st.S.pending.size === 0 && row.out === 0){
        rows.push({ ...c, tail: tailBytes, end: c.frames });
        c = null; wait = 10;
      }
    } });
  const g = rows.map(r => r.group);
  console.log(`| ${def.name} | ${placing ? 'place' : 'break'} | ${rows[0].cut} | ${med(g)} / ${top(g)} | ${f(med(jobMs))} / ${f(top(jobMs))} | ${med(rows.map(r => r.flip))} / ${top(rows.map(r => r.flip))} | ${f(med(rows.map(r => r.bytes)) / 1024)} | ${med(rows.map(r => r.behind))} | ${med(rows.map(r => r.end))} | ${f(med(setRootMs))} | ${f(med(plain))} → ${f(med(editing))} | ${f(med(rows.map(r => r.tail)) / 1024)} |`);
}
