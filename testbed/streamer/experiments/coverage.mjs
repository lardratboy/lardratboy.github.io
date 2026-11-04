/* What each LOD rule keeps, over the three corpora (docs/coverage-plan.md).

     node experiments/coverage.mjs            # R=256 worlds, a few minutes
     node experiments/coverage.mjs --quick    # R=128, prints only

   Every world is expanded at lod 1, 2 and 3 under each of chunk-core's
   LOD_RULES, and the run writes docs/coverage-results.md and
   docs/data/coverage.json (both overwritten every run; the reading is
   docs/coverage-findings.md). Four measures, each against the true voxels:

   - volume: kept cells × 8^lod over true voxels. 1.00 is right, and 2.00
     means the lod doubled the volume (records.mjs §4 measured "any").
   - voxel error: voxels the coarse version gets wrong, both ways (cells
     drawn over empty space, plus true voxels under dropped cells), over
     true voxels. Exact, from keptVoxels. A rule can hit volume 1.00 with a
     large error by putting the volume in the wrong places; this catches it.
   - slab coverage: what a viewer sees. Along each axis, every column of
     voxels is cut into segments one brick deep (8 coarse cells = 8·2^lod
     voxels), and a segment counts as hit if anything in it is occupied.
     Coverage is coarse hits over fine hits, read at fine resolution, so
     1.00 means the lod blocks as much light at the brick scale as the
     true voxels do. Slab error is the segments that disagree, either way,
     over fine hits. A whole-world silhouette would say 1.00 for nearly
     every specimen, because 256 voxels of anything porous are opaque.
   - records: records at that lod over records at lod 0, i.e. the draw
     cost the lod buys back.

   Section 3 sweeps opacity's m (keepCount's `depth`: m = 1 is volume,
   m = 2^lod is opacity) at lod 2 and 3, on the specimens, the shapes and
   every 8th row of each testbed axis, to see which effective depth
   brings slab coverage to 1.00, and whether one m fits all content. */
import { writeFileSync } from 'node:fs';
import { createStore, createCounts } from '../dag-core.js';
import { expandWorld, LOD_RULES } from '../chunk-core.js';
import { showroomAvailable, loadShowroom, showroomRevision, STACKS, sampleRecipe } from './showroom-corpus.mjs';
import { SHAPES, denseShape } from './shapes.mjs';
import { loadTestbed, rowsOf, automatonOf, AXIS_NAMES } from './testbed-corpus.mjs';

const QUICK = process.argv.includes('--quick');
const R = QUICK ? 128 : 256, D = Math.log2(R);
const LODS = [1, 2, 3];
const SWEEP_LODS = [2, 3], SWEEP_M = [1, 1.5, 2, 2.5, 3, 4, 6, 8];
const started = performance.now();

/* ---- the worlds: the same as records.mjs -------------------------------- */
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
/* Adversarial content, kept here rather than in shapes.mjs (which the
   hash-cons results also read): structures one voxel thick, where a
   coarse cell is mostly empty yet the structure is opaque face-on. The
   adaptive rule assumes correlation is the same along every axis, and a
   sheet is the case where it isn't. */
const thinWorld = (name, inside) => ({ corpus: 'thin', name, dense: () => {
  const occ = new Uint8Array(R ** 3);
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) if (inside(x, y, z)) occ[x + R * (y + R * z)] = 1;
  return occ;
} });
worlds.push(
  thinWorld('flat sheet', (x, y, z) => z === (R >> 1) + 5),
  thinWorld('tilted sheet', (x, y, z) => Math.abs(x + 2 * y + 3 * z - 3 * R) < Math.sqrt(14) / 2),
  thinWorld('wire lattice', (x, y, z) => ((x & 15) === 5) + ((y & 15) === 5) + ((z & 15) === 5) >= 2),
);
if (D % 2 === 0){
  const tb = loadTestbed();
    const perAxis = new Map();
  for (const row of rowsOf(tb)){
    const nth = perAxis.get(row.axis) || 0;
    perAxis.set(row.axis, nth + 1);
    worlds.push({ corpus: 'testbed rows', name: `${row.label} ${row.depth}`, axis: row.axis, sweep: nth % 8 === 0,
      auto: automatonOf(tb, row.cfgFor(D / 2)) });
  }
}

/* Content classes for the summary. The shell and the gyroid are smooth
   but thin, so they get their own class: they are where the rules differ
   on content that isn't porous. */
const THIN = new Set(['shell', 'gyroid']);
const classOf = w => w.corpus === 'thin' ? 'thin (1-voxel sheets, wires)' : w.corpus === 'shapes' ? (THIN.has(w.name) ? 'thin smooth (shell, gyroid)' : 'solid smooth') :
                     w.corpus === 'specimens' ? 'porous specimens' : 'testbed rows';
const CLASSES = ['solid smooth', 'thin smooth (shell, gyroid)', 'thin (1-voxel sheets, wires)', 'porous specimens', 'testbed rows'];

/* ---- slab segments -------------------------------------------------------
   seg[a][(u + R·v)·n + s] = 1 if column (u, v) along axis a has anything in
   segment s, segments being S voxels long and n = R / S per column. The
   fine maps are built once, at the shortest segment (lod 1), and merged
   pairwise for each coarser lod: a 32-voxel segment is hit iff one of its
   two 16-voxel halves is. */
function fineSegments(occ, S){
  const n = R / S, sh = Math.log2(S), seg = [0, 1, 2].map(() => new Uint8Array(R * R * n));
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++){
    const row = R * (y + R * z);
    for (let x = 0; x < R; x++){
      if (!occ[x + row]) continue;
      seg[0][(y + R * z) * n + (x >> sh)] = 1;
      seg[1][(x + R * z) * n + (y >> sh)] = 1;
      seg[2][(x + R * y) * n + (z >> sh)] = 1;
    }
  }
  return seg;
}
const halve = (seg, n) => seg.map(a => {
  const out = new Uint8Array(a.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = a[2 * i] | a[2 * i + 1];
  return out;
});
// Coarse segments: 8 cells deep on a grid of side N, compared at fine (u, v).
function slabCompare(kept, N, l, fine, n){
  const cs = [0, 1, 2].map(() => new Uint8Array(N * N * n));
  for (let Z = 0; Z < N; Z++) for (let Y = 0; Y < N; Y++) for (let X = 0; X < N; X++){
    if (!kept[X + N * (Y + N * Z)]) continue;
    cs[0][(Y + N * Z) * n + (X >> 3)] = 1;
    cs[1][(X + N * Z) * n + (Y >> 3)] = 1;
    cs[2][(X + N * Y) * n + (Z >> 3)] = 1;
  }
  let fineHits = 0, coarseHits = 0, wrong = 0;
  for (let a = 0; a < 3; a++) for (let v = 0; v < R; v++) for (let u = 0; u < R; u++){
    const fb = (u + R * v) * n, cb = ((u >> l) + N * (v >> l)) * n;
    for (let s = 0; s < n; s++){
      const f = fine[a][fb + s], c = cs[a][cb + s];
      fineHits += f; coarseHits += c; wrong += f ^ c;
    }
  }
  return { coverage: coarseHits / fineHits, slabError: wrong / fineHits };
}
function keptGrid(chunks, N){
  const out = new Uint8Array(N ** 3);
  for (const c of chunks){
    const ox = c.origin[0] / c.cellSize, oy = c.origin[1] / c.cellSize, oz = c.origin[2] / c.cellSize;
    for (const p of c.cells) out[(ox + (p & 255)) + N * ((oy + (p >> 8 & 255)) + N * (oz + (p >> 16)))] = 1;
  }
  return out;
}

/* ---- measure ------------------------------------------------------------ */
const sum = (a, k) => a.reduce((s, c) => s + c[k], 0);
const results = [];
for (const w of worlds){
  const s = createStore();
  const { root } = w.auto ? s.fromRadix4(D / 2, w.auto.start, w.auto.step, w.auto.accept, w.auto.keyOf) : s.fromDense(w.dense(), R);
  const counts = createCounts(s), V = counts.of(root);
  if (!V) continue;
  const occ = s.expand(root, D);
  const records0 = sum(expandWorld(s, root, D, 0), 'count');
  const r = { corpus: w.corpus, name: w.name, axis: w.axis, cls: classOf(w), voxels: V, records0, lods: {}, sweep: {} };
  const sweep = w.corpus !== 'testbed rows' || w.sweep;
  let fine = fineSegments(occ, 16);
  for (const l of LODS){
    if (l > 1) fine = halve(fine, R / (8 << l) * 2);
    const N = R >> l, n = R / (8 << l), v = 8 ** l;
    r.lods[l] = {};
    for (const rule of LOD_RULES){
      const t0 = performance.now();
      const chunks = expandWorld(s, root, D, l, { lodRule: rule, counts, cells: true });
      const ms = performance.now() - t0;
      const occupied = sum(chunks, 'occupied'), kept = sum(chunks, 'keptVoxels');
      r.lods[l][rule] = {
        volume: occupied * v / V,
        voxelError: (occupied * v - kept + (V - kept)) / V,
        ...slabCompare(keptGrid(chunks, N), N, l, fine, n),
        records: sum(chunks, 'count') / records0,
        msPerChunk: ms / Math.max(1, chunks.length),
      };
    }
    if (sweep && SWEEP_LODS.includes(l)){
      r.sweep[l] = SWEEP_M.map(m => {
        const chunks = expandWorld(s, root, D, l, { lodRule: 'opacity', counts, cells: true, rayDepth: m });
        const occupied = sum(chunks, 'occupied'), kept = sum(chunks, 'keptVoxels');
        return { m, volume: occupied * v / V, voxelError: (occupied * v - kept + (V - kept)) / V,
                 ...slabCompare(keptGrid(chunks, N), N, l, fine, n) };
      });
    }
  }
  results.push(r);
  if (!QUICK) process.stdout.write('.');
}
if (!QUICK) process.stdout.write('\n');
const seconds = (performance.now() - started) / 1000;

/* ---- report ------------------------------------------------------------- */
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n/2 - 1] + s[n/2]) / 2) : NaN; };
const fx = (x, d = 2) => Number.isFinite(x) ? x.toFixed(d) : '-';
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const med = (rs, f) => median(rs.map(f));

function groups(){
  const out = [];
  for (const r of results.filter(r => r.corpus !== 'testbed rows')) out.push({ corpus: r.corpus, name: r.name, rs: [r] });
  AXIS_NAMES.forEach((name, axis) => {
    const rs = results.filter(r => r.corpus === 'testbed rows' && r.axis === axis);
    if (rs.length) out.push({ corpus: 'testbed rows', name: `${name} (${rs.length}, median)`, rs });
  });
  return out;
}
const RULE_HEAD = LOD_RULES.map(r => `*${r}*`);
const perWorld = (l, key, d = 2) => table(['corpus', 'world', ...RULE_HEAD],
  groups().map(({ corpus, name, rs }) => [corpus, name, ...LOD_RULES.map(rule => fx(med(rs, r => r.lods[l][rule][key]), d))]));

const md = [];
md.push(`# Coverage results (generated)`, '',
  `Generated by \`node experiments/coverage.mjs${QUICK ? ' --quick' : ''}\` on ${new Date().toISOString().slice(0, 10)} in ${seconds.toFixed(0)} s, at R = ${R}. ` +
  `Don't edit: re-running overwrites this file. The reading is in [coverage-findings.md](coverage-findings.md), the method in [coverage-plan.md](coverage-plan.md). Every number is in [data/coverage.json](data/coverage.json).`, '',
  `- block-showroom: \`${showroomAvailable() ? showroomRevision() : 'not found, specimens skipped'}\``,
  `- ${results.length} worlds: ${['specimens', 'shapes', 'thin', 'testbed rows'].map(c => `${results.filter(r => r.corpus === c).length} ${c}`).join(', ')} (empty rows excluded)`,
  `- the rules (\`chunk-core.js\`, LOD_RULES): *any* keeps a coarse cell if anything is under it; *majority* if half its voxels are; *volume* keeps round(C / 8^lod) cells per 8³ brick; *opacity* keeps round(n·(1 − (1 − p)^(2^lod))) per brick; *adaptive* is *opacity* with the exponent measured per brick from its share of occupied cells`,
  `- *volume* is kept volume over true volume; *voxel error* is voxels wrong both ways over true voxels; *coverage* is brick-deep segments hit, coarse over fine; *slab error* is segments that disagree over fine hits; *records* is over lod-0 records`, '');

md.push(`## 1. Summary: medians per content class`, '');
for (const key of [['voxelError', 'voxel error'], ['coverage', 'coverage'], ['slabError', 'slab error'], ['volume', 'volume'], ['records', 'records']]){
  md.push(`### ${key[1]}`, '',
    table(['class', 'worlds', ...LODS.flatMap(l => LOD_RULES.map(rule => `${rule} ${l}`))],
      CLASSES.map(c => { const rs = results.filter(r => r.cls === c); return rs.length ? [c, rs.length,
        ...LODS.flatMap(l => LOD_RULES.map(rule => fx(med(rs, r => r.lods[l][rule][key[0]]), key[0] === 'records' ? 3 : 2)))] : null; }).filter(Boolean)), '');
}

md.push(`## 2. Per world at lod 2`, '');
md.push(`### Slab coverage (1.00 = blocks as much light as the true voxels)`, '', perWorld(2, 'coverage'), '');
md.push(`### Slab error`, '', perWorld(2, 'slabError'), '');
md.push(`### Voxel error`, '', perWorld(2, 'voxelError'), '');
md.push(`### Volume`, '', perWorld(2, 'volume'), '');
md.push(`### Records over lod 0`, '', perWorld(2, 'records', 3), '');

md.push(`## 3. Sweeping opacity's depth m`, '',
  `k = round(n·(1 − (1 − p)^m)) per brick: m = 1 is *volume*, m = 2^lod is *opacity*. Medians per class over the swept worlds (every specimen and shape, and every 8th row of each testbed axis). *Best m* is, per world, the m whose slab coverage is closest to 1.00, shown as min / median / max over the class.`, '');
for (const l of SWEEP_LODS){
  const swept = results.filter(r => r.sweep[l]);
  for (const [key, label] of [['coverage', 'slab coverage'], ['slabError', 'slab error'], ['voxelError', 'voxel error']])
    md.push(`### lod ${l}: ${label}`, '',
      table(['class', 'worlds', ...SWEEP_M.map(m => `m = ${m}${m === 1 ? ' (volume)' : m === 2 ** l ? ' (opacity)' : ''}`)],
        CLASSES.map(c => { const rs = swept.filter(r => r.cls === c);
          return rs.length ? [c, rs.length, ...SWEEP_M.map((m, i) => fx(med(rs, r => r.sweep[l][i][key])))] : null; }).filter(Boolean)), '');
  md.push(`### lod ${l}: best m per world`, '',
    table(['class', 'worlds', 'best m (min / median / max)', 'its slab error (median)', 'its voxel error (median)'],
      CLASSES.map(c => { const rs = swept.filter(r => r.cls === c);
        if (!rs.length) return null;
        const best = rs.map(r => r.sweep[l].reduce((a, b) => Math.abs(b.coverage - 1) < Math.abs(a.coverage - 1) ? b : a));
        const ms = best.map(b => b.m).sort((a, b) => a - b);
        return [c, rs.length, `${ms[0]} / ${median(ms)} / ${ms[ms.length - 1]}`, fx(median(best.map(b => b.slabError))), fx(median(best.map(b => b.voxelError)))];
      }).filter(Boolean)), '');
}

md.push(`## 4. Cost: ms per chunk at lod 1 (median per class)`, '',
  table(['class', ...RULE_HEAD], CLASSES.map(c => { const rs = results.filter(r => r.cls === c);
    return rs.length ? [c, ...LOD_RULES.map(rule => fx(med(rs, r => r.lods[1][rule].msPerChunk), 1))] : null; }).filter(Boolean)), '');

const text = md.join('\n');
if (QUICK) console.log(text);
else {
  writeFileSync(new URL('../docs/coverage-results.md', import.meta.url), text);
  // Four decimals is far below anything the findings read, and halves the file.
  const round = (k, v) => typeof v === 'number' && !Number.isInteger(v) ? +v.toFixed(4) : v;
  writeFileSync(new URL('../docs/data/coverage.json', import.meta.url), JSON.stringify({ R, seconds, results }, round, 1));
  console.log(`wrote docs/coverage-results.md and docs/data/coverage.json (${seconds.toFixed(0)} s)`);
}
