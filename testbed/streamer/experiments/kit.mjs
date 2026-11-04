/* The kit world, measured (docs/kit-plan.md, decision 9).

     node experiments/kit.mjs            # ~2 min; writes docs/kit-results.md, docs/data/kit.json, docs/images/kit-*.png
     node experiments/kit.mjs --print    # the tables only, no previews, nothing written

   Four measurements, a table each:
   1. The knobs: nodes (built, then pruned), Oh classes (48, the labelled
      edges of step 2) and mirror classes (8, SSVDAG's), voxels and how
      much of the cube they fill, and the build's time (parts, compose,
      prune) and the plan's alone (what each chunk worker pays to rebuild
      the colour field from the descriptor). Over D, the ground, the
      library sizes and the ornaments.
   2. The colour field: ns a point at each colour level, on 64³ runs of
      voxel centres, as a records job calls it.
   3. The views: the streamer's cut at rest (detail 2, no chunk cap) from
      the viewer's default view and from a street, at D = 12, 14 and 16:
      chunks, cubes, records jobs with colour (median, p95, sum) and how
      many of the cut's chunks are copies. A copy is a chunk whose DAG
      node another chunk of the cut at the same lod already has; a cache
      keyed by (node, lod) would expand it once (kit-plan.md §3), up to
      its seams and colour, which depend on where it is. So the table
      also counts the distinct records+words a job actually returns.
   4. Previews (CPU ray caster, experiments/kit-sketch.mjs's), coloured
      by kitColour: docs/images/kit-*.png.
   It measures job times, so run it on an idle machine. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCounts, createClasses, OH48, MIRROR8 } from '../dag-core.js';
import { createWorld, worldSnapshot, selectChunks, createJobRunner, clearance } from '../stream-core.js';
import { kitDesc, kitPlan, buildKit, kitColour, kitParam, sideOf } from '../kit-core.js';
import { rgb8 } from '../attr-core.js';
import { colourOf } from '../colours.js';
import { render } from './kit-sketch.mjs';

const PRINT = process.argv.includes('--print');
const started = performance.now();
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const n = x => x.toLocaleString('en');
const big = x => x >= 1e12 ? (x / 1e12).toFixed(2) + 'T' : x >= 1e9 ? (x / 1e9).toFixed(2) + 'G' : x >= 1e6 ? (x / 1e6).toFixed(1) + 'M' : n(x);
// Classes over more nodes than this take seconds each and say nothing new.
const CLASSES_MAX = 400000;

/* ---- 1. the knobs ------------------------------------------------------------ */
const KNOBS = [
  ...[12, 14, 16].flatMap(D => [{ D }, { D, ground: false }]),
  { D: 14, libs: [1, 1, 1, 1] },
  { D: 14, libs: [2, 2, 2, 2] },
  { D: 14, libs: [24, 16, 12, 8] },
  { D: 14, libs: [128, 64, 32, 16] },
  { D: 14, libs: [1024, 256, 64, 16] },
  { D: 14, ornaments: 0 },
  { D: 14, ornaments: 16 },
  { D: 14, seed: 2 },
  { D: 14, seed: 3 },
];
const knobs = [];
for (const over of KNOBS){
  const desc = kitDesc(over), k = buildKit(desc), t0 = performance.now();
  for (let i = 0; i < 9; i++) kitPlan(desc);
  const planMs = (performance.now() - t0) / 9, voxels = createCounts(k.store).of(k.root);
  const small = k.nodes <= CLASSES_MAX;
  knobs.push({ param: kitParam(desc), seed: desc.seed, over, D: desc.D, raw: k.raw, nodes: k.nodes, dropped: k.dropped, voxels, fill: voxels / 2 ** (3 * desc.D),
               oh: small ? createClasses(k.store, OH48).size : null, mirror: small ? createClasses(k.store, MIRROR8).size : null,
               ms: k.ms, totalMs: k.totalMs, planMs, top: kitPlan(desc).levels[desc.L].mask[0] });
  console.error(`knobs ${kitParam(desc)} seed ${desc.seed}: ${n(k.nodes)} nodes, ${k.totalMs.toFixed(0)} ms`);
}

/* ---- 2. the colour field ------------------------------------------------------- */
const colourCost = [];
{
  const base = kitDesc({ D: 16 });
  for (let c = 0; c <= base.L; c++){
    const f = kitColour({ ...base, colourLevel: c }, rgb8);
    let s = 0, calls = 0;
    const t0 = performance.now();
    for (const [x0, y0, z0] of [[1311, 7864, 1311], [30000, 40, 20000], [5000, 3000, 60000]])
      for (let z = 0; z < 64; z++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++, calls++) s += f(x0 + x + 0.5, y0 + y + 0.5, z0 + z + 0.5);
    colourCost.push({ level: c, side: sideOf(c), ns: (performance.now() - t0) * 1e6 / calls, check: s & 1 });
  }
}

/* ---- 3. the views ---------------------------------------------------------------
   The default view is the viewer's (stream-viewer.html's defaultView);
   the street is the shots' kit-street, at the same fraction of the side
   at every D, raised a 256th of the side at a time until it's at least
   16 voxels from anything: at D = 12 the fraction is inside a solid (the
   first run measured a cut from inside one). */
const VIEWS = {
  default: { eye: [-0.35, 0.9, -0.45], yaw: 0.68, pitch: -0.5 },
  street: { eye: [0.02, 0.12, 0.02], yaw: 0.78, pitch: -0.05 },
};
const hash = (a, h = 0x811c9dc5) => { for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 0x01000193); return h >>> 0; };
const views = [];
for (const D of [12, 14, 16]) for (const [name, v] of Object.entries(VIEWS)){
  const desc = kitDesc({ D }), k = buildKit(desc), counts = createCounts(k.store), classes = createClasses(k.store, OH48);
  const world = createWorld(k.store, k.root, D), side = world.side, eye = v.eye.map(x => x * side);
  while (clearance(world, eye, 2048).d < 16) eye[1] += side / 256;
  const run = createJobRunner(worldSnapshot(k.store, k.root, D, { counts, classes, colour: desc }), colourOf);
  const sel = selectChunks(world, eye, { detail: 2 }), ms = [], ids = new Set(), outs = new Set(), recs = new Set();
  let cubes = 0, words = 0;
  for (const c of [...sel.nodes.values()].slice(0, 2)) run({ lod: c.lod, cx: c.x, cy: c.y, cz: c.z, lodRule: c.lod ? 'adaptive' : 'any', kind: 'records' });
  for (const c of sel.nodes.values()){
    const r = run({ lod: c.lod, cx: c.x, cy: c.y, cz: c.z, lodRule: c.lod ? 'adaptive' : 'any', kind: 'records' });
    ms.push(r.ms); cubes += r.recordCount; words += r.attrs ? r.attrs.length : 0;
    ids.add(`${c.lod}:${c.id}`);
    outs.add(`${c.lod}:${hash(r.records)}:${r.attrs ? hash(r.attrs) : 0}:${r.count}`);
    recs.add(`${c.lod}:${hash(r.records)}:${r.count}`);
  }
  const lods = sel.leaves.map(c => c.lod), clear = clearance(world, eye, 2048).d;
  views.push({ D, view: name, eye: eye.map(Math.round), clear, chunks: sel.nodes.size, leaves: sel.leaves.length, lods: `${Math.min(...lods)}–${Math.max(...lods)}`,
               cubes, words, jobMed: med(ms), jobP95: pct(ms, 0.95), jobSum: ms.reduce((a, b) => a + b, 0), distinctNodes: ids.size, distinctRecords: recs.size, distinctOut: outs.size });
  console.error(`view D=${D} ${name}: ${sel.nodes.size} chunks, ${(ms.reduce((a, b) => a + b, 0) / 1000).toFixed(1)} s of jobs`);
}

/* ---- 4. previews ------------------------------------------------------------------ */
const PREVIEWS = [
  { file: 'kit-far', over: { D: 14 }, view: VIEWS.default, colourLevel: 4, ss: 3 },
  { file: 'kit-far-level2', over: { D: 14 }, view: VIEWS.default, colourLevel: 2, ss: 4 },
  { file: 'kit-street', over: { D: 14 }, view: { ...VIEWS.street, fog: 1.5 }, colourLevel: 2, ss: 3 },
  { file: 'kit-floating-far', over: { D: 14, ground: false }, view: VIEWS.default, colourLevel: 4, ss: 3 },
  { file: 'kit-d16-far', over: { D: 16 }, view: VIEWS.default, colourLevel: 4, ss: 3 },
  { file: 'kit-d16-street', over: { D: 16 }, view: { ...VIEWS.street, fog: 1.5 }, colourLevel: 3, ss: 3 },
];
const previews = [];
if (!PRINT){
  mkdirSync('docs/images', { recursive: true });
  for (const p of PREVIEWS){
    const desc = kitDesc({ ...p.over, colourLevel: p.colourLevel }), k = buildKit(desc), s = 2 ** desc.D, t0 = performance.now();
    writeFileSync(`docs/images/${p.file}.png`, render(k.store, k.root, desc.D, { eye: p.view.eye.map(x => x * s), yaw: p.view.yaw, pitch: p.view.pitch,
      ss: p.ss, colour: kitColour(desc, rgb8), fog: p.view.fog ? p.view.fog * s : null }));
    previews.push({ ...p, param: kitParam(desc), s: (performance.now() - t0) / 1000 });
    console.error(`preview ${p.file}: ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  }
}

/* ---- the report --------------------------------------------------------------------- */
const md = [
  '# The kit world: results',
  '',
  `Generated by \`node experiments/kit.mjs\` (${((performance.now() - started) / 1000).toFixed(0)} s). Readings in [kit-findings.md](kit-findings.md); the plan in [kit-plan.md](kit-plan.md).`,
  '',
  '## 1. The knobs',
  '',
  'A kit is `?kit=D,libraries,ornaments,ground,colour level` (seed 1 unless given). *built* is the store before the prune; *nodes* after it. *Oh* and *mirror* are the classes under 48 and 8 transforms (`createClasses`). *build* is parts + compose + prune; *plan* is `kitPlan` alone, what a chunk worker pays to rebuild the colour field.',
  '',
  table(['kit', 'seed', 'top mask', 'built', 'nodes', 'Oh classes', 'mirror classes', 'voxels', 'fill', 'build ms (parts + compose + prune)', 'plan ms'],
    knobs.map(r => [r.param, r.seed, r.top, n(r.raw), n(r.nodes), r.oh === null ? '–' : n(r.oh), r.mirror === null ? '–' : n(r.mirror), big(r.voxels), (100 * r.fill).toFixed(2) + '%',
                    `${r.totalMs.toFixed(0)} (${r.ms.parts.toFixed(0)} + ${r.ms.compose.toFixed(0)} + ${r.ms.prune.toFixed(0)})`, r.planMs.toFixed(2)])),
  '',
  '## 2. The colour field',
  '',
  'ns a call on three 64³ runs of voxel centres in the default D = 16 kit, by the level whose frames the gamut is read in. The walk is L − c steps.',
  '',
  table(['colour level', 'frame side', 'ns a point'], colourCost.map(r => [r.level, n(r.side) + '³', r.ns.toFixed(0)])),
  '',
  '## 3. The views',
  '',
  'The cut at rest, detail 2, no chunk cap, every chunk of it (leaves and split) expanded as a records job with colour (meanDepth 1), one thread. *clear* is the distance to the nearest voxel (stream-core\'s `clearance`). *distinct nodes* counts the cut\'s (lod, node) pairs; *distinct records* the distinct records a job returns (seams and the apron included, so a copy whose neighbours differ is distinct); *distinct jobs* records and words together (the colour depends on where the copy is).',
  '',
  table(['D', 'view', 'eye', 'clear', 'chunks', 'leaves', 'lods', 'cubes', 'job ms med / p95', 'jobs s', 'distinct nodes', 'distinct records', 'distinct jobs'],
    views.map(r => [r.D, r.view, r.eye.join(', '), n(Math.round(r.clear)), n(r.chunks), n(r.leaves), r.lods, n(r.cubes), `${r.jobMed.toFixed(1)} / ${r.jobP95.toFixed(1)}`,
                    (r.jobSum / 1000).toFixed(1), `${n(r.distinctNodes)} (${(100 * r.distinctNodes / r.chunks).toFixed(0)}%)`, `${n(r.distinctRecords)} (${(100 * r.distinctRecords / r.chunks).toFixed(0)}%)`, `${n(r.distinctOut)} (${(100 * r.distinctOut / r.chunks).toFixed(0)}%)`])),
  '',
  '## 4. Previews',
  '',
  'CPU ray caster (`experiments/kit-sketch.mjs`\'s `render`), coloured by `kitColour` at the level given, samples a pixel squared as given. Far views alias at fine colour levels: the viewer\'s coarse lods average what a ray can\'t.',
  '',
  ...previews.flatMap(p => [`**${p.file}**: \`${p.param}\`, ${p.ss}² samples, ${p.s.toFixed(0)} s.`, '', `![${p.file}](images/${p.file}.png)`, '']),
];
if (PRINT) console.log(md.join('\n'));
else {
  mkdirSync('docs/data', { recursive: true });
  writeFileSync('docs/kit-results.md', md.join('\n') + '\n');
  writeFileSync('docs/data/kit.json', JSON.stringify({ knobs, colourCost, views, previews }, null, 1) + '\n');
  console.error('wrote docs/kit-results.md, docs/data/kit.json');
}
