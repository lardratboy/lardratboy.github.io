/* What step 1's quick wins buy (docs/computedags.md §9 step 1,
   docs/job-speed-log.md): chunk-core's expandChunk, the reference, against
   job-core's fastChunk, on the cut at rest of computedags §1's five views and
   flat ground at D = 20. One thread, every leaf (or every k-th one, to keep
   the run short), each job run `REPS` times for its median, then the median
   over leaves. The two are checked equal on every job timed.

     node experiments/job-speed.mjs            the table, with and without colour
     node experiments/job-speed.mjs --quick    fewer leaves, no colour

   Colour is the runner's: poses and the world's field at meanDepth 1, as
   createJobRunner does. "cold" is a fresh mask cache per job, "warm" the
   runner's cache after one pass over the view, which is what a flight that
   comes back sees. It measures job times, so run it on an idle machine. */
import { createStore, createCounts, createClasses, OH48, EMPTY } from '../dag-core.js';
import { expandChunk } from '../chunk-core.js';
import { fastChunk, createJobCache } from '../job-core.js';
import { createWorld, selectChunks } from '../stream-core.js';
import { colourOf } from '../colours.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { kitDesc, buildKit } from '../kit-core.js';
import { caveDesc, buildCaves } from '../cave-core.js';
import { clayDesc, buildClay } from '../clay-core.js';

const quick = process.argv.includes('--quick'), REPS = quick ? 3 : 5;
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
const fmt = (x, d = 1) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '-';
const row = cells => console.log('| ' + cells.join(' | ') + ' |');
const time = f => { const ms = []; let out; for (let r = 0; r < REPS; r++){ const t = performance.now(); out = f(); ms.push(performance.now() - t); } return [median(ms), out]; };

const shape = (name, D) => {
  const store = createStore(), { root } = store.fromField(D, fieldOf(SHAPES.find(s => s.name === name), D));
  return { name: `${name} D=${D}`, store, root, D, colour: { kind: 'shape', name, D } };
};
const kit = D => { const desc = kitDesc({ D }), k = buildKit(desc); return { name: `kit D=${D}`, store: k.store, root: k.root, D, colour: desc }; };
const caves = D => { const desc = caveDesc({ D }), c = buildCaves(desc); return { name: `caves D=${D}`, store: c.store, root: c.root, D, colour: desc }; };
const flat = D => { const desc = clayDesc({ D, lump: 0, ground: true }), c = buildClay(desc); return { name: `flat ground D=${D}`, store: c.store, root: c.root, D, colour: desc }; };

const VIEWS = [
  [() => shape('hills', 12), [0.5, 0.75, 0.5]], [() => shape('gyroid', 11), [0.5, 0.5, 0.5]],
  [() => kit(14), [0.02, 0.12, 0.02]], [() => kit(16), [0.02, 0.12, 0.02]], [() => caves(12), [0.5, 0.42, 0.5]],
  [() => flat(20), [0.1, 0.5001, 0.3]],
];
const same = (a, b) => a.records.length === b.records.length && a.records.every((r, i) => r === b.records[i])
  && (!b.attrs || b.attrs.every((r, i) => r === a.attrs[i])) && a.occupied === b.occupied && a.quads === b.quads;

for (const coloured of quick ? [false] : [false, true]){
  console.log(`\n### ${coloured ? 'With poses and colour (the runner\'s job)' : 'No poses, no colour'}\n`);
  row(['world', 'leaves timed', 'reference ms med / p95', 'fast cold', 'fast warm', 'speed-up med (warm)', 'sum ref / sum warm', 'listed / occupied']);
  row(Array(8).fill('---'));
  for (const [make, e] of VIEWS){
    const w = make(), counts = createCounts(w.store), classes = coloured ? createClasses(w.store, OH48) : null, colour = coloured ? colourOf(w.colour) : null;
    const world = createWorld(w.store, w.root, w.D), leaves = selectChunks(world, e.map(v => v * world.side), { detail: 2 }).leaves.filter(c => c.id !== EMPTY);
    const step = Math.max(1, Math.floor(leaves.length / (quick ? 24 : 96))), picked = leaves.filter((_, i) => i % step === 0);
    const warm = createJobCache(), ref = [], cold = [], hot = [], speed = [];
    let occupied = 0;
    const optsOf = c => ({ classes, counts, lodRule: c.lod ? 'adaptive' : 'any', colour, meanDepth: 1 });
    for (const c of picked) fastChunk(w.store, w.root, w.D, { lod: c.lod, cx: c.x, cy: c.y, cz: c.z }, { ...optsOf(c), cache: warm });
    for (const c of picked){
      const k = { lod: c.lod, cx: c.x, cy: c.y, cz: c.z }, o = optsOf(c);
      const [a, ra] = time(() => expandChunk(w.store, w.root, w.D, k, { ...o, seams: true }));
      const [b, rb] = time(() => fastChunk(w.store, w.root, w.D, k, { ...o, cache: createJobCache() }));
      const [h, rh] = time(() => fastChunk(w.store, w.root, w.D, k, { ...o, cache: warm }));
      if (!same(rb, ra) || !same(rh, ra)) throw new Error(`${w.name}: lod ${c.lod} chunk ${c.x},${c.y},${c.z} differs from expandChunk`);
      ref.push(a); cold.push(b); hot.push(h); speed.push(a / h);
      occupied += ra.occupied;
    }
    // How many cells the fast walk still visits: occupied less the shells' interiors.
    let visits = 0;
    for (const c of picked){
      const k = { lod: c.lod, cx: c.x, cy: c.y, cz: c.z }, r = fastChunk(w.store, w.root, w.D, k, { ...optsOf(c), cache: warm });
      visits += r.listed;
    }
    const sum = a => a.reduce((s, x) => s + x, 0);
    row([w.name, `${picked.length} of ${leaves.length}`, `${fmt(median(ref))} / ${fmt(pct(ref, 0.95))}`, `${fmt(median(cold))} / ${fmt(pct(cold, 0.95))}`,
         `${fmt(median(hot))} / ${fmt(pct(hot, 0.95))}`, `${fmt(median(speed))}×`, `${fmt(sum(ref) / sum(hot))}×`,
         `${fmt(100 * visits / occupied, 0)}%`]);
  }
}
