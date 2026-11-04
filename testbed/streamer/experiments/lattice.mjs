/* The lattice world, measured (docs/lattice3d-plan.md).

     node experiments/lattice.mjs           # ~25 min, ~3 GB; writes docs/lattice3d-results.md and docs/data/lattice.json
     node experiments/lattice.mjs --quick   # 4³ at every R, prints (~30 s)

   It measures job times, so run it on an idle machine.

   1. Every R the sweep visits, at the largest cube the first budget
      allowed (2M estimated nodes, 32³; the cubes §4 grew from), upright,
      random axes, on one thread:
      buildLattice's phases (pass A: build and fingerprint; pass B: cut
      and intern; the graft), and the world: nodes against the budget's
      estimate, nodes per specimen over R², blocks per specimen, recipes
      tried, cells that had to repeat.
   2. Turned against upright, and traits against random, at a few R.
   3. How many different specimens the first k recipes hold at small R:
      why pass A has a cap (lattice-core's recipeCap) and the cells past
      it repeat.
   4. The largest lattices the budget allows now (to 128³, 24M estimated
      nodes; maxCube), at a few R, one thread.
   5. align: the pitch rounded up to a power of two, against R + gap, at
      the same R and cube. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createCounts } from '../dag-core.js';
import { buildLattice, latticeDesc, maxCube, estimateNodes, stackOf, printRange, recipeCap, NODES_SHARED, RECIPE_CAP, LATTICE_LIMITS } from '../lattice-core.js';

const QUICK = process.argv.includes('--quick');
const started = performance.now();
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const n = v => v.toLocaleString('en');
const f = (v, d = 0) => v.toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d });
const stack = R => stackOf(R).map(l => l.radix).join('·');

function measure(over){
  const desc = latticeDesc(over), t0 = performance.now(), b = buildLattice(desc), total = performance.now() - t0;
  const N = b.layout.cells.length, voxels = createCounts(b.store).of(b.root);
  return { param: { R: desc.R, n: desc.n, gap: desc.gap, rotate: desc.rotate, axes: desc.axes, align: desc.align }, pitch: desc.pitch, D: desc.D, specimens: N,
           nodes: b.nodes, estimate: estimateNodes(desc), perSpecimen: b.nodes / N, perR2: b.nodes / N / desc.R ** 2,
           snapshotBytes: 44 * b.nodes, blocks: b.blocks, blocksPerSpecimen: b.blocks / N, unique: b.unique, repeats: b.repeats,
           recipes: desc.axes === 'traits' ? N : b.picked.reduce((m, v) => Math.max(m, v), -1) + 1, skipped: b.skipped, voxels, fill: voxels / N / desc.R ** 3,
           dropped: b.dropped, ms: { passA: b.ms.build, passB: b.ms.place, graft: b.ms.graft, prune: b.ms.prune, total, perSpecimen: total / N } };
}

const RS = [5, 6, 7, 8, 9, 12, 13, 16, 17, 24, 27, 31, 32, 37, 48, 63, 64];
const out = { quick: QUICK, nodesPerR2: 'min(0.4, 0.25 + 0.003·R)', nodesShared: NODES_SHARED, limits: LATTICE_LIMITS, recipeCap: RECIPE_CAP,
              sweep: [], variants: [], yield: [], largest: [], align: [] };
// The first budget's largest cube: 0.4·R² nodes a specimen, at most 2M, and 32³.
const firstCube = R => { let n = 1; while (n < 32 && (n + 1) ** 3 * 0.4 * R * R <= 2e6) n++; return n; };
for (const R of RS){
  const m = QUICK ? 4 : firstCube(R);
  out.sweep.push(measure({ R, n: m }));
  console.log(`R=${R} ${m}³: ${n(out.sweep.at(-1).nodes)} nodes, ${(out.sweep.at(-1).ms.total / 1000).toFixed(1)} s (${((performance.now() - started) / 1000).toFixed(0)} s in)`);
}
for (const [R, size] of QUICK ? [[16, 4]] : [[8, 16], [16, 10], [32, 8], [64, 6]]){
  const base = { R, n: size };
  for (const v of [{}, { rotate: true }, { axes: 'traits' }]) out.variants.push(measure({ ...base, ...v }));
  console.log(`variants R=${R}`);
}
// Distinct specimens among the first k recipes, by fingerprint.
for (const R of QUICK ? [5] : [5, 6, 7, 8, 9]){
  const marks = QUICK ? [1000, 2000] : [1000, 4000, 16000, 32000], desc = latticeDesc({ R, n: 1 }), seen = new Set(), row = { R, at: {} };
  let k = 0;
  for (const m of marks){
    for (const p of printRange(desc, k, m)) seen.add(p);
    k = m; row.at[m] = seen.size;
  }
  out.yield.push(row);
  console.log(`yield R=${R}: ${JSON.stringify(row.at)}`);
}

for (const over of QUICK ? [{ R: 5, n: 16 }] : [{ R: 5 }, { R: 5, gap: 0, rotate: true }, { R: 6 }, { R: 16 }, { R: 64 }]){
  const side = over.n || maxCube(over.R, over);
  out.largest.push(measure({ ...over, n: side }));
  console.log(`largest R=${over.R} ${side}³: ${n(out.largest.at(-1).nodes)} nodes, ${(out.largest.at(-1).ms.total / 1000).toFixed(1)} s`);
}
for (const [R, size] of QUICK ? [[12, 4]] : [[5, 24], [12, 16], [24, 10], [33, 8], [48, 6]]){
  for (const align of [false, true]) out.align.push(measure({ R, n: size, align }));
  console.log(`align R=${R}`);
}

const seconds = (performance.now() - started) / 1000;
const S = out.sweep, V = out.variants, Y = out.yield, G = out.largest, P = out.align;
const text = [
  '# The lattice world: results',
  '',
  `Generated by \`node experiments/lattice.mjs${QUICK ? ' --quick' : ''}\` on ${new Date().toISOString().slice(0, 10)} in ${seconds.toFixed(0)} s, one thread, Node ${process.versions.node}. ` +
  'The reading is in [lattice3d-findings.md](lattice3d-findings.md), the method in [lattice3d-plan.md](lattice3d-plan.md).',
  '',
  `## 1. Every R at the first budget's largest cube${QUICK ? ' (quick: 4³)' : ''}`,
  '',
  `Upright, random axes, the default gap (R/4, at least 2), at the largest cube the first budget allowed (2M estimated nodes at 0.4·R² a specimen, 32³ at most); §4 has the largest lattices now. Snapshot bytes at 44 a node (no poses). Nodes are after pruning (dag-core's prune: only what the root reaches); "pruned away" is what graft left behind.`,
  '',
  table(['R', 'stack', 'cube', 'specimens', 'D', 'nodes', 'pruned away', 'estimate', 'nodes / specimen', '/ R²', 'snapshot', 'blocks / specimen', 'fill', 'recipes tried', 'cells repeated', 'pass A', 'pass B', 'graft', 'ms / specimen'],
    S.map(r => [r.param.R, stack(r.param.R), `${r.param.n[0]}³`, n(r.specimens), r.D, n(r.nodes), n(r.dropped), n(r.estimate), f(r.perSpecimen, 1), f(r.perR2, 3),
                `${f(r.snapshotBytes / 1048576, 1)} MB`, f(r.blocksPerSpecimen, 2), `${f(100 * r.fill, 1)}%`, n(r.recipes), n(r.repeats),
                `${f(r.ms.passA / 1000, 1)} s`, `${f(r.ms.passB / 1000, 1)} s`, `${f(r.ms.graft)} ms`, f(r.ms.perSpecimen, 2)])),
  '',
  '## 2. Turned and trait lattices',
  '',
  'The same R and cube, upright and random (the default), turned (one of the 24 rotations each), and with trait axes (group × density × field, no fingerprints).',
  '',
  table(['R', 'cube', 'variant', 'nodes', 'nodes / specimen', 'blocks / specimen', 'pass A', 'pass B', 'total'],
    V.map(r => [r.param.R, `${r.param.n[0]}³`, r.param.axes === 'traits' ? 'traits' : r.param.rotate ? 'turned' : 'upright', n(r.nodes), f(r.perSpecimen, 1),
                f(r.blocksPerSpecimen, 2), `${f(r.ms.passA / 1000, 2)} s`, `${f(r.ms.passB / 1000, 2)} s`, `${f(r.ms.total / 1000, 2)} s`])),
  '',
  '## 3. Different specimens among the first k recipes',
  '',
  `Distinct Oh fingerprints. Pass A stops at recipeCap(N) = min(4N + 64, ${n(RECIPE_CAP)}) recipes; the cells past the last unique one then repeat the unique ones in order.`,
  '',
  table(['R', 'stack', ...Object.keys(Y[0].at).map(k => `first ${n(+k)}`)], Y.map(r => [r.R, stack(r.R), ...Object.values(r.at).map(v => n(v))])),
  '',
  '## 4. The largest lattices now',
  '',
  `The largest cube the budget allows at each R (${n(LATTICE_LIMITS.nodes)} estimated nodes: min(0.4, 0.25 + 0.003·R)·R² a specimen, or, with B dividing the pitch, that for each of at most ${n(RECIPE_CAP)} different specimens plus the tree above the blocks; + ${n(NODES_SHARED)}; at most 128³ and D = ${LATTICE_LIMITS.D}), random axes, one thread. Pass B reuses pass A's occupancies, so a lattice whose cells mostly repeat builds fast.`,
  '',
  table(['R', 'gap', 'turned', 'cube', 'specimens', 'D', 'nodes', 'pruned away', 'estimate', 'nodes / specimen', 'snapshot', 'blocks / specimen', 'unique', 'cells repeated', 'pass A', 'pass B', 'graft', 'prune', 'total'],
    G.map(r => [r.param.R, r.param.gap, r.param.rotate ? 'yes' : 'no', `${r.param.n[0]}³`, n(r.specimens), r.D, n(r.nodes), n(r.dropped), n(r.estimate), f(r.perSpecimen, 2),
                `${f(r.snapshotBytes / 1048576, 0)} MB`, f(r.blocksPerSpecimen, 2), n(r.unique), n(r.repeats),
                `${f(r.ms.passA / 1000, 1)} s`, `${f(r.ms.passB / 1000, 1)} s`, `${f(r.ms.graft / 1000, 1)} s`, `${f(r.ms.prune / 1000, 1)} s`, `${f(r.ms.total / 1000, 1)} s`])),
  '',
  '## 5. align: a power-of-two pitch',
  '',
  'The same R and cube with the pitch R + gap (the default gap) and rounded up to a power of two (the gap grows to make it).',
  '',
  table(['R', 'cube', 'pitch', 'gap', 'nodes', 'pruned away', 'nodes / specimen', 'blocks / specimen', 'total'],
    P.map(r => [r.param.R, `${r.param.n[0]}³`, `${r.pitch}${r.param.align ? ' (aligned)' : ''}`, r.param.gap, n(r.nodes), n(r.dropped), f(r.perSpecimen, 1), f(r.blocksPerSpecimen, 2), `${f(r.ms.total / 1000, 2)} s`])),
  '',
].join('\n');
if (QUICK) console.log('\n' + text);
else {
  mkdirSync('docs/data', { recursive: true });
  writeFileSync('docs/lattice3d-results.md', text);
  writeFileSync('docs/data/lattice.json', JSON.stringify(out, null, 1));
  console.log(`wrote docs/lattice3d-results.md and docs/data/lattice.json (${seconds.toFixed(0)} s)`);
}
