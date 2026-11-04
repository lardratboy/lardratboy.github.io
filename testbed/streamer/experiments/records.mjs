/* What step 3's records cost, over the three corpora (docs/expand-plan.md).

     node experiments/records.mjs            # R=256 worlds, ~1 min
     node experiments/records.mjs --quick    # R=128, prints only, ~10 s

   Every world is expanded at lod 0, 1 and 2, with the apron and with
   closed borders, and writes docs/records-results.md (overwritten every
   run; the reading is docs/expand-findings.md). The questions:
   - bytes: 4 B per drawn voxel against block-showroom's 14 B per occupied
     voxel, and how much of that is skipping buried voxels;
   - per-cube or per-face instances (§8.2): a per-cube record submits 12
     triangles, a per-face record (cell + 3-bit face, also 4 B) submits 2,
     so per-face wins when quads per record is below 6;
   - what closed borders would overdraw;
   - how much "any" bloats coarse lods (§5.4): coarse occupied volume over
     true volume;
   - how long expanding a chunk takes. */
import { writeFileSync } from 'node:fs';
import { createStore, createClasses, OH48 } from '../dag-core.js';
import { expandWorld } from '../chunk-core.js';
import { showroomAvailable, loadShowroom, showroomRevision, STACKS, sampleRecipe } from './showroom-corpus.mjs';
import { SHAPES, denseShape } from './shapes.mjs';
import { loadTestbed, rowsOf, automatonOf, AXIS_NAMES } from './testbed-corpus.mjs';

const QUICK = process.argv.includes('--quick');
const R = QUICK ? 128 : 256, D = Math.log2(R);
const started = performance.now();

/* ---- the worlds ---------------------------------------------------------
   Specimens: one per group, global fold, plus four tier-folded (porous).
   Shapes: all eight (smooth). Testbed rows: every row at L = D/2 radix-4
   levels, straight from its automaton, never densely; rows are reported
   per axis. */
const worlds = [];
if (showroomAvailable()){
  const core = await loadShowroom(), stack = QUICK ? 'bin7' : 'bin8';
  for (let sym = 0; sym < core.GROUPS.length; sym++){
    const { P, levels } = sampleRecipe(core, 5000 + sym, STACKS[stack], { sym });
    worlds.push({ corpus: 'specimens', name: `${core.GROUPS[sym].name}`, dense: () => core.buildBlock(P, levels).occ });
  }
  for (let n = 0; n < 4; n++){
    const { P, levels } = sampleRecipe(core, 5100 + n, STACKS[stack], { tierSymmetry: true });
    worlds.push({ corpus: 'specimens', name: `tier #${n}`, dense: () => core.buildBlock(P, levels).occ });
  }
}
for (const sh of SHAPES) worlds.push({ corpus: 'shapes', name: sh.name, dense: () => denseShape(sh, R).occ });
if (D % 2 === 0){
  const tb = loadTestbed();
  for (const row of rowsOf(tb)) worlds.push({ corpus: 'testbed rows', name: `${row.label} ${row.depth}`, axis: row.axis,
    auto: automatonOf(tb, row.cfgFor(D / 2)) });
}

/* ---- measure ------------------------------------------------------------ */
const sum = (a, k) => a.reduce((s, c) => s + c[k], 0);
const results = [];
for (const w of worlds){
  const s = createStore();
  const { root } = w.auto ? s.fromRadix4(D / 2, w.auto.start, w.auto.step, w.auto.accept, w.auto.keyOf) : s.fromDense(w.dense(), R);
  const classes = createClasses(s, OH48);
  const r = { ...w, lods: [] };
  delete r.dense; delete r.auto;
  for (const lod of [0, 1, 2]){
    const t0 = performance.now();
    const apron = expandWorld(s, root, D, lod, { classes });
    const ms = performance.now() - t0;
    const closed = expandWorld(s, root, D, lod, { classes, border: 'closed' });
    r.lods.push({ lod, chunks: apron.length, occupied: sum(apron, 'occupied'), records: sum(apron, 'count'),
      quads: sum(apron, 'quads'), closedQuads: sum(closed, 'quads'), closedRecords: sum(closed, 'count'),
      msPerChunk: ms / Math.max(1, apron.length) });
  }
  if (r.lods[0].occupied) results.push(r);
}
const seconds = (performance.now() - started) / 1000;

/* ---- report ------------------------------------------------------------- */
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n/2 - 1] + s[n/2]) / 2) : NaN; };
const fx = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : '-';
const n0 = x => Math.round(x).toLocaleString('en-US');
const kb = x => { const u = ['KB', 'MB', 'GB']; let v = x / 1024, i = 0; while (v >= 1024 && i < u.length - 1){ v /= 1024; i++; } return `${v.toFixed(1)} ${u[i]}`; };
const pct = x => `${(100 * x).toFixed(1)}%`;
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');

/* One row per world (specimens, shapes) or per axis (rows, medians). */
function groups(){
  const out = [];
  for (const r of results.filter(r => r.corpus !== 'testbed rows')) out.push({ corpus: r.corpus, name: r.name, rs: [r] });
  AXIS_NAMES.forEach((name, axis) => {
    const rs = results.filter(r => r.corpus === 'testbed rows' && r.axis === axis);
    if (rs.length) out.push({ corpus: 'testbed rows', name: `${name} (${rs.length}, median)`, rs });
  });
  return out;
}
const med = (rs, f) => median(rs.map(f));
const L0 = r => r.lods[0];

const md = [];
md.push(`# Record results (generated)`, '',
  `Generated by \`node experiments/records.mjs${QUICK ? ' --quick' : ''}\` on ${new Date().toISOString().slice(0, 10)} in ${seconds.toFixed(0)} s, at R = ${R}. ` +
  `Don't edit: re-running overwrites this file. The reading is in [expand-findings.md](expand-findings.md), the method in [expand-plan.md](expand-plan.md).`, '',
  `- block-showroom: \`${showroomAvailable() ? showroomRevision() : 'not found, specimens skipped'}\``,
  `- ${results.length} worlds: ${['specimens', 'shapes', 'testbed rows'].map(c => `${results.filter(r => r.corpus === c).length} ${c}`).join(', ')} (empty rows excluded)`,
  `- *showroom* is block-showroom's record: 14 B per occupied voxel, buried ones included. *records* is ours: 4 B per voxel that shows a face`, '');

md.push(`## 1. Bytes at lod 0`, '',
  table(['corpus', 'world', 'occupied', 'records', 'buried skipped', 'showroom', 'records (4 B)', 'smaller by'],
    groups().map(({ corpus, name, rs }) => [corpus, name, n0(med(rs, r => L0(r).occupied)), n0(med(rs, r => L0(r).records)),
      pct(med(rs, r => 1 - L0(r).records / L0(r).occupied)), kb(med(rs, r => 14 * L0(r).occupied)), kb(med(rs, r => 4 * L0(r).records)),
      `${fx(med(rs, r => 14 * L0(r).occupied / (4 * L0(r).records)))}×`])), '');

md.push(`## 2. Per-cube or per-face instances, lod 0`, '',
  `A per-cube instance submits 12 triangles and a per-face instance 2; both records are 4 B. *Per-face / per-cube* below 1 means per-face is cheaper on both counts.`, '',
  table(['corpus', 'world', 'quads per record', 'per-cube tris', 'per-face tris', 'per-face / per-cube (tris)', 'per-face / per-cube (bytes)'],
    groups().map(({ corpus, name, rs }) => [corpus, name, fx(med(rs, r => L0(r).quads / L0(r).records), 2),
      n0(med(rs, r => 12 * L0(r).records)), n0(med(rs, r => 2 * L0(r).quads)),
      fx(med(rs, r => 2 * L0(r).quads / (12 * L0(r).records)), 2), fx(med(rs, r => L0(r).quads / L0(r).records), 2)])), '');

md.push(`## 3. Closed borders: what skipping the apron would overdraw`, '',
  `Extra quads and records when every chunk treats its outside as empty, over the apron's exact count, at each lod.`, '',
  table(['corpus', 'world', 'chunks (lod 0)', 'extra quads lod 0', 'lod 1', 'lod 2', 'extra records lod 0'],
    groups().map(({ corpus, name, rs }) => [corpus, name, med(rs, r => L0(r).chunks),
      ...[0, 1, 2].map(l => pct(med(rs, r => r.lods[l].closedQuads / Math.max(1, r.lods[l].quads) - 1))),
      pct(med(rs, r => L0(r).closedRecords / L0(r).records - 1))])), '');

md.push(`## 4. LOD: what "any" does to volume and records`, '',
  `*Volume* is occupied coarse cells × 8^lod over occupied voxels: 1.00 means the coarse version holds exactly the true volume, and 2.00 that it has doubled. *Records* is records at that lod over records at lod 0.`, '',
  table(['corpus', 'world', 'volume lod 1', 'lod 2', 'records lod 1', 'lod 2', 'ms per chunk lod 0'],
    groups().map(({ corpus, name, rs }) => [corpus, name,
      ...[1, 2].map(l => `${fx(med(rs, r => r.lods[l].occupied * 8 ** l / L0(r).occupied), 2)}`),
      ...[1, 2].map(l => `${fx(med(rs, r => r.lods[l].records / L0(r).records), 3)}`),
      fx(med(rs, r => L0(r).msPerChunk), 1)])), '');

const totals = c => { const rs = results.filter(r => r.corpus === c); return rs.length ? [c, rs.length, kb(14 * rs.reduce((s, r) => s + L0(r).occupied, 0)), kb(4 * rs.reduce((s, r) => s + L0(r).records, 0))] : null; };
md.push(`## 5. Corpus totals, lod 0`, '',
  table(['corpus', 'worlds', 'showroom', 'records'], ['specimens', 'shapes', 'testbed rows'].map(totals).filter(Boolean)), '');

const text = md.join('\n');
if (QUICK) console.log(text);
else { writeFileSync(new URL('../docs/records-results.md', import.meta.url), text); console.log(`wrote docs/records-results.md (${seconds.toFixed(0)} s)`); }
