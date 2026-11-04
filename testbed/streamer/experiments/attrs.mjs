/* Step 6: attribute words, measured (docs/attrs-plan.md, "Measurements").

     node experiments/attrs.mjs            # ~4 min; writes docs/attrs-results.md and docs/data/attrs.json
     node experiments/attrs.mjs --quick    # small worlds, prints only (~30 s)

   Three tables:
   1. Mean accuracy. A coarse cell's word with the mean descending
      meanDepth = 0, 1, 2 levels, against the exact mean (meanDepth = lod),
      cell for cell over every shown cell of sampled chunks. The error of a
      word is its largest channel difference in 6-bit steps.
   2. Job time. A records job with and without colour, per meanDepth, and
      a page job with and without colour: median ms per chunk on the same
      sampled chunks. Measured, so run it on an idle machine.
   3. Bytes per view. The converged cut at the default detail, raster only
      and ray only (rayLod 0): records and their words; pages (grids and
      deduplicated bricks, as step 5 counted them) and their attribute
      blocks (16 mask words per brick run plus a word per shown cell).
      attributes-q13.md §6 estimated these from step 5's counts; this
      measures them.
   Nothing here touches a GPU. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createStore, createCounts, createClasses, OH48, EMPTY, FIRST_NODE } from '../dag-core.js';
import { expandChunk, chunkNode } from '../chunk-core.js';
import { createWorld, worldSnapshot, selectChunks, createJobRunner, resultBytes, MEAN_DEPTH } from '../stream-core.js';
import { PAGE_WORDS, BRICK_WORDS, ATTR_NONE, createBrickPool, installPage } from '../ray-core.js';
import { attrRGB } from '../attr-core.js';
import { colourOf } from '../colours.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { loadTestbed, rowsOf, automatonOf, AXIS_NAMES } from './testbed-corpus.mjs';

const QUICK = process.argv.includes('--quick');
const tb = loadTestbed(), ROWS = rowsOf(tb);
function rowWorld(index, L, view){
  const row = ROWS[index], s = createStore(), a = automatonOf(tb, row.cfgFor(L));
  const { root, D } = s.fromRadix4(L, a.start, a.step, a.accept, a.keyOf);
  return { name: `${row.label}${row.depth === '-' ? '' : ' ' + row.depth}`, kind: AXIS_NAMES[row.axis], store: s, root, D,
           colour: { kind: 'row', D }, ...view };
}
function shapeWorld(name, D, view){
  const s = createStore(), { root } = s.fromField(D, fieldOf(SHAPES.find(x => x.name === name), D));
  return { name, kind: 'shape', store: s, root, D, colour: { kind: 'shape', name, D }, ...view };
}
const INSIDE = { eye: [0.5, 0.62, 0.5], yaw: 2.4, pitch: -0.3 };
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const mb = b => (b / 1048576).toFixed(b < 10 * 1048576 ? 2 : 1);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const out = { quick: QUICK, accuracy: [], jobs: [], views: [] };
const t0 = performance.now();

// Up to n chunks at a lod, spread over the grid, that hold something
// (the first version took empty ones too, and timed the seed row's jobs
// at 0.01 ms). Completely full chunks are skipped as well: their jobs are
// shortcuts, timed in step 4.
function sampleChunks(w, lod, n){
  const g = 2 ** Math.max(0, w.D - lod - 6), out = [], full = 8 ** (lod + 6);
  const counts = w.counts ||= createCounts(w.store);
  for (let i = 0; out.length < n && i < 256 * n; i++){
    const c = { lod, cx: (i * 5 + 1) % g, cy: (i * 3 + (i >> 2)) % g, cz: (i * 7 + 2) % g };
    if (out.some(o => o.cx === c.cx && o.cy === c.cy && o.cz === c.cz)) continue;
    const { id } = chunkNode(w.store, w.root, w.D, lod, c.cx, c.cy, c.cz);
    if (id === EMPTY || (id >= FIRST_NODE && counts.of(id) === full)) continue;
    out.push(c);
  }
  return out;
}

/* ---- 1. mean accuracy ---------------------------------------------------- */
const ACC_WORLDS = QUICK ? [() => shapeWorld('terrain', 9), () => rowWorld(146, 4)]
  : [() => shapeWorld('sphere', 10), () => shapeWorld('terrain', 10), () => shapeWorld('gyroid', 10), () => shapeWorld('half-space', 10),
     () => rowWorld(146, 5), () => rowWorld(100, 5)];
for (const make of ACC_WORLDS){
  const w = make(), counts = createCounts(w.store), colour = colourOf(w.colour);
  for (const lod of [1, 2, 3, 4]){
    if (w.D < lod + 6) continue;
    const chunks = sampleChunks(w, lod, QUICK ? 4 : 8);
    const exact = chunks.map(c => expandChunk(w.store, w.root, w.D, c, { counts, lodRule: 'adaptive', seams: true, colour, meanDepth: lod }));
    for (const m of [0, 1, 2]){
      if (m >= lod) continue;
      const errs = [];
      chunks.forEach((c, i) => {
        const got = expandChunk(w.store, w.root, w.D, c, { counts, lodRule: 'adaptive', seams: true, colour, meanDepth: m });
        got.attrs.forEach((a, j) => {
          const x = attrRGB(a), y = attrRGB(exact[i].attrs[j]);
          errs.push(Math.max(Math.abs(x[0] - y[0]), Math.abs(x[1] - y[1]), Math.abs(x[2] - y[2])));
        });
      });
      if (!errs.length) continue;
      const row = { world: w.name, lod, meanDepth: m, words: errs.length, exact: errs.filter(e => e === 0).length / errs.length,
                    within1: errs.filter(e => e <= 1).length / errs.length, mean: errs.reduce((a, b) => a + b, 0) / errs.length,
                    p99: pct(errs, 0.99), max: errs.reduce((a, b) => Math.max(a, b), 0) };
      out.accuracy.push(row);
      console.log('accuracy', JSON.stringify(row));
    }
  }
}

/* ---- 2. job time ----------------------------------------------------------- */
const JOB_WORLDS = QUICK ? [() => rowWorld(146, 5), () => shapeWorld('terrain', 9)]
  : [() => rowWorld(146, 6), () => rowWorld(100, 6), () => shapeWorld('sphere', 10), () => shapeWorld('terrain', 10)];
for (const make of JOB_WORLDS){
  const w = make(), counts = createCounts(w.store), classes = createClasses(w.store, OH48);
  const plainSnap = worldSnapshot(w.store, w.root, w.D, { counts, classes }), colourSnap = { ...plainSnap, colour: w.colour };
  for (const lod of [0, 1, 2, 3]){
    const chunks = sampleChunks(w, lod, QUICK ? 6 : 12), rule = lod ? 'adaptive' : 'any';
    const time = (run, kind) => {
      for (const c of chunks.slice(0, 2)) run({ ...c, lodRule: rule, kind });      // warm up
      const ms = [];
      let words = 0;
      for (const c of chunks){ const r = run({ ...c, lodRule: rule, kind }); ms.push(r.ms); words += r.attrs ? r.attrs.length : (r.shown || 0); }
      return { ms: med(ms), words: words / chunks.length };
    };
    const row = { world: w.name, lod, records: time(createJobRunner(plainSnap), 'records').ms };
    for (const m of [0, 1, 2]){
      if (m > lod && m > 0) continue;
      const r = time(createJobRunner(colourSnap, colourOf, { meanDepth: m }), 'records');
      row[`m${m}`] = r.ms; row.words = r.words;
    }
    row.page = time(createJobRunner(plainSnap), 'page').ms;
    row.pageColour = time(createJobRunner(colourSnap, colourOf), 'page').ms;
    out.jobs.push(row);
    console.log('jobs', JSON.stringify(row));
  }
}

/* ---- 3. bytes per view ----------------------------------------------------- */
const VIEW_WORLDS = QUICK ? [() => rowWorld(146, 6, INSIDE), () => shapeWorld('terrain', 9, { eye: [0.5, 0.62, 0.15] })]
  : [() => rowWorld(146, 8, INSIDE), () => rowWorld(142, 8, INSIDE), () => rowWorld(100, 8, INSIDE),
     () => shapeWorld('terrain', 11, { eye: [0.5, 0.53, 0.15] }), () => shapeWorld('sphere', 12, { eye: [0.5, 0.55, -0.12] }),
     () => shapeWorld('half-space', 12, { eye: [0.5, 0.75, 0.75] })];
for (const make of VIEW_WORLDS){
  const w = make(), counts = createCounts(w.store), classes = createClasses(w.store, OH48);
  const world = createWorld(w.store, w.root, w.D);
  const run = createJobRunner(worldSnapshot(w.store, w.root, w.D, { counts, classes, colour: w.colour }), colourOf);
  const sel = selectChunks(world, w.eye.map(v => v * world.side), { detail: 2 });
  let records = 0, recordWords = 0, grids = 0, masks = 0, pageWords = 0, shown = 0;
  const pool = createBrickPool(1 << 22);
  for (const c of sel.nodes.values()){
    const job = { lod: c.lod, cx: c.x, cy: c.y, cz: c.z, lodRule: c.lod ? 'adaptive' : 'any' };
    const r = run({ ...job, kind: 'records' });
    records += r.records.byteLength; recordWords += r.attrs.byteLength;
    const p = run({ ...job, kind: 'page' });
    grids++; installPage(pool, c.lod, p, () => {});
    const runs = p.attrAt.reduce((a, v) => a + (v !== ATTR_NONE), 0);
    masks += 4 * BRICK_WORDS * runs; pageWords += 4 * p.shown; shown += p.shown;
  }
  const gridBytes = 4 * PAGE_WORDS * grids, brickBytes = 4 * BRICK_WORDS * pool.size;
  const row = { world: w.name, D: w.D, chunks: sel.nodes.size, records, recordWords, cubes: records / 4,
                pageOccupancy: gridBytes + brickBytes, pageAttr: masks + pageWords, masks, pageWords, shown };
  out.views.push(row);
  console.log('view', JSON.stringify(row));
}
out.seconds = Math.round((performance.now() - t0) / 1000);
console.log(`done in ${out.seconds} s`);

if (!QUICK){
  const acc = out.accuracy.map(r => [r.world, r.lod, r.meanDepth, r.words.toLocaleString(), (100 * r.exact).toFixed(1) + '%',
                                     (100 * r.within1).toFixed(1) + '%', r.mean.toFixed(2), r.p99, r.max]);
  const jobs = out.jobs.map(r => [r.world, r.lod, Math.round(r.words).toLocaleString(), r.records.toFixed(2),
                                  ...[0, 1, 2].map(m => r[`m${m}`] === undefined ? '–' : r[`m${m}`].toFixed(2)),
                                  r.page.toFixed(2), r.pageColour.toFixed(2)]);
  const views = out.views.map(r => [r.world, r.chunks, mb(r.records), mb(r.recordWords), mb(r.pageOccupancy), mb(r.pageAttr),
                                    mb(r.masks), mb(r.pageWords)]);
  const md = `# Step 6: attribute results

Generated by \`node experiments/attrs.mjs\` (${out.seconds} s). The reading is in [attrs-findings.md](attrs-findings.md).

## 1. Mean accuracy

A coarse word with the mean descending meanDepth levels, against the exact mean (meanDepth = lod), over every shown cell of 8 sampled chunks. Error: the largest channel difference, in 6-bit steps.

${table(['world', 'lod', 'meanDepth', 'words', 'exact', '≤ 1 step', 'mean', 'p99', 'max'], acc)}

## 2. Job time

Median ms per chunk over 12 sampled chunks, neither empty nor completely full. *records*: no colour. *m0–m2*: with colour, the mean descending that many levels (m${MEAN_DEPTH} is the default). *page*: a ray page without and with its attribute block.

${table(['world', 'lod', 'words / chunk', 'records', 'm0', 'm1', 'm2', 'page', 'page + words'], jobs)}

## 3. Bytes per view

The converged cut at detail 2, every chunk of it resident (leaves and split chunks, as the streamer keeps them). Raster: records and their words. Ray: pages (grids plus deduplicated bricks, step 5's count) and their attribute blocks (masks plus words), all chunks traced.

${table(['world', 'chunks', 'records MB', 'record words MB', 'page occupancy MB', 'page attributes MB', 'of which masks', 'of which words'], views)}
`;
  mkdirSync(new URL('../docs/data/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../docs/attrs-results.md', import.meta.url), md);
  writeFileSync(new URL('../docs/data/attrs.json', import.meta.url), JSON.stringify(out, null, 1));
  console.log('wrote docs/attrs-results.md and docs/data/attrs.json');
}
