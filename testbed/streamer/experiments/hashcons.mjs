/* The step-2 hash-cons experiment (docs/hashcons-plan.md).

     node experiments/hashcons.mjs            # full corpus, ~2 min, ~1 GB peak
     node experiments/hashcons.mjs --quick    # R=16 and R=64 only, ~15 s

   Builds block-showroom specimens, interns them into one dag-core store
   per resolution, and writes
     docs/hashcons-results.md   generated tables (overwritten every run)
     docs/data/hashcons.json    every per-specimen number behind them
   The reading of the tables is hand-written, in docs/hashcons-findings.md,
   so a re-run never overwrites it.

   One store per R, not one per specimen: the per-specimen census only
   walks what that specimen's root reaches, so it is unaffected by sharing,
   and the corpus census over all roots is the cross-specimen ("shared
   dictionary") number for free. Classes are updated incrementally after
   each specimen for the same reason. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createStore, createClasses, census, MIRROR8, OH48 } from '../dag-core.js';
import { loadShowroom, showroomRevision, STACKS, sampleRecipe } from './showroom-corpus.mjs';
import { SHAPES, denseShape } from './shapes.mjs';
import { loadTestbed, rowsOf, automatonOf, denseOf, independentCount, AXIS_NAMES } from './testbed-corpus.mjs';

const QUICK = process.argv.includes('--quick');
const core = await loadShowroom();
const NG = core.GROUPS.length;

/* ---- the corpus ---------------------------------------------------------
   Only even binary depths (R = 16, 64, 256), so every R is a whole number
   of radix-4 levels and the 64-tree byte model applies without a partial
   root. "global" recipes fold by one group about the centre, one specimen
   per archetype per group, so every group sees the same 12 envelopes
   (at R=256, 4 archetypes per group to keep the run to minutes).
   "tier" recipes fold each tier by its own group (Recipe.tierSymmetry),
   over both a radix-2 and a radix-4 stack, since there the stack matters. */
const PLAN = [
  { R: 16,  global: 'tower4', perGroup: 12, tier: ['tower4', 'n4'],   perTier: 24 },
  { R: 64,  global: 'bin6',   perGroup: 12, tier: ['bin6', 'quad3'],  perTier: 12 },
  { R: 256, global: 'bin8',   perGroup: 4,  tier: ['bin8', 'quad4'],  perTier: 4 },
].filter(p => !QUICK || p.R <= 64);

const BRICKS = [[2, 4], [3, 8], [4, 16]];      // [level, side]
/* Three corpora per R: block-showroom specimens folded globally, folded
   per tier, and the simple shapes of shapes.mjs (smooth content, added
   for Q16 after the first run: docs/hashcons-log.md §8). */
const KINDS = ['global', 'tier', 'shape'];

/* Surface voxels: occupied with at least one empty 6-neighbour, the
   outside of the grid counting as empty (a specimen stands in air). A
   non-empty brick with no surface voxel is necessarily solid, since an
   occupied voxel next to an empty one inside the brick would be surface. */
function surfaceStats(occ, R){
  const at = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= R || y >= R || z >= R) ? 0 : occ[x + R * (y + R * z)];
  const surf = BRICKS.map(([, b]) => new Uint8Array((R / b) ** 3));
  let surface = 0;
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
    if (!occ[x + R * (y + R * z)]) continue;
    if (at(x-1,y,z) && at(x+1,y,z) && at(x,y-1,z) && at(x,y+1,z) && at(x,y,z-1) && at(x,y,z+1)) continue;
    surface++;
    BRICKS.forEach(([, b], i) => { const n = R / b; surf[i][((x / b) | 0) + n * (((y / b) | 0) + n * ((z / b) | 0))] = 1; });
  }
  return { surface, surfaceBricks: surf.map(a => a.reduce((s, v) => s + v, 0)) };
}

/* ---- byte models ----------------------------------------------------------
   Deliberately simple, stated so they can be argued with. Pointers are
   4 bytes; an Oh label (6 bits) or mirror label (3 bits) packs into the
   pointer's top bits, which leaves 26 bits of index, ample here.
   - SVO tree: 4 B header per node at levels >= 3, 4 B pointer per child,
     4³ leaves (level 2) stored inline as one 64-bit mask.
   - SVDAG (Kämpe et al. 2013): the same, over unique nodes.
   - SSVDAG-8 / -48: the same, over classes.
   - 64-tree DAG: a 4³ node at even level >= 4 is an 8 B mask plus 4 B per
     non-empty 4³ child; 4³ leaves are 8 B each.
   - b³ brick pages: unique bricks as b³-bit occupancy, an SVDAG above
     them, and attributes at 1 B/voxel for every *positional* brick that
     has surface (attributes don't deduplicate, occupancy does). */
const sum = (a, from, to) => { let s = 0; for (let k = from; k <= to; k++) s += a[k] || 0; return s; };
function bytes(c, D){
  const tree = 4 * sum(c.svo, 3, D) + 4 * sum(c.svo, 2, D - 1) + 8 * c.svo[2];
  const svdag = 4 * sum(c.dag, 3, D) + 4 * sum(c.kids, 3, D) + 8 * c.dag[2];
  const ss = i => 4 * sum(c.classes[i], 3, D) + 4 * sum(c.classKids[i], 3, D) + 8 * c.classes[i][2];
  let t64 = 8 * c.dag[2];
  for (let k = 4; k <= D; k += 2) t64 += 8 * c.dag[k] + 4 * c.grandkids[k];
  return { tree, svdag, ssvdag8: ss(0), ssvdag48: ss(1), tree64: t64 };
}
function brickBytes(c, D, level, side, surfaceBricks){
  const top = 4 * sum(c.dag, level + 1, D) + 4 * sum(c.kids, level + 1, D);
  const occ = c.dag[level] * side ** 3 / 8;
  const occOh = c.classes[1][level] * side ** 3 / 8;
  return { top, occ, occOh, attr: surfaceBricks * side ** 3 };
}

/* ---- run ------------------------------------------------------------------ */
const started = performance.now();
let records = [];
const corpora = [];
for (const plan of PLAN){
  const store = createStore();
  const views = [createClasses(store, MIRROR8), createClasses(store, OH48)];
  const jobs = [];
  for (let sym = 0; sym < NG; sym++) for (let a = 0; a < plan.perGroup; a++){
    const arch = plan.perGroup >= 12 ? a : (a * 3 + sym) % 12;     // R=256: spread 4 archetypes per group
    jobs.push({ kind: 'global', stack: plan.global, ...sampleRecipe(core, plan.R * 1000 + sym * 16 + a, STACKS[plan.global], { sym, arch }) });
  }
  for (const stack of plan.tier) for (let n = 0; n < plan.perTier; n++)
    jobs.push({ kind: 'tier', stack, ...sampleRecipe(core, plan.R * 1000 + 500 + n, STACKS[stack], { tierSymmetry: true }) });
  // Shapes from R=64 up: at R=16 the 0.1-thick shell is thinner than a
  // voxel and falls between the centres.
  if (plan.R >= 64) for (const shape of SHAPES) jobs.push({ kind: 'shape', stack: '-', shape });

  const roots = Object.fromEntries(KINDS.map(k => [k, []]));
  for (const job of jobs){
    const t0 = performance.now();
    const { occ, R, filled } = job.shape ? { ...denseShape(job.shape, plan.R), R: plan.R } : core.buildBlock(job.P, job.levels);
    const t1 = performance.now();
    if (!filled){
      // Radix-2 tier folds send every digit of a 2³ toward one corner, so
      // some envelopes (hollow, totem, ...) see no cell at all. block-showroom
      // draws these empty too. Recorded, but left out of every statistic.
      records.push({ R, kind: job.kind, stack: job.stack, empty: true, ...(job.shape ? { shape: job.shape.name } : { sym: job.P.sym,
        tiers: job.levels.map(l => l.sym), arch: core.ARCH_NAMES[job.P.arch], field: core.FIELD_NAMES[job.P.field] }) });
      continue;
    }
    const { root, D } = store.fromDense(occ, R);
    views.forEach(v => v.update());
    const t2 = performance.now();
    const c = census(store, [root], views);
    const { surface, surfaceBricks } = surfaceStats(occ, R);
    roots[job.kind].push(root);
    const g = job.shape ? null : core.GROUPS[job.P.sym];
    records.push({
      R, D, kind: job.kind, stack: job.stack,
      ...(job.shape ? { shape: job.shape.name } : {
        sym: job.P.sym, group: g.name, order: g.order,
        tiers: job.P.tierSymmetry ? job.levels.map(l => core.GROUPS[l.sym].name.split(':')[0]) : null,
        arch: core.ARCH_NAMES[job.P.arch], field: core.FIELD_NAMES[job.P.field], lift: core.LIFT_NAMES[job.P.lift],
        density: +job.P.density.toFixed(3), seed: job.P.seed.toString(16).padStart(16, '0') }),
      voxels: filled, surface, stab: views[1].stabOfNode(root),
      svo: [...c.svo], dag: [...c.dag], m8: c.classes[0], oh: c.classes[1],
      bytes: bytes(c, D),
      bricks: BRICKS.map(([level, side], i) => ({ side, nonEmpty: c.svo[level], surfaceBricks: surfaceBricks[i],
        unique: c.dag[level], uniqueM8: c.classes[0][level], uniqueOh: c.classes[1][level],
        ...brickBytes(c, D, level, side, surfaceBricks[i]) })),
      ms: { build: +(t1 - t0).toFixed(1), dag: +(t2 - t1).toFixed(1) },
    });
  }
  for (const kind of KINDS){
    const D = Math.log2(plan.R), c = census(store, roots[kind], views, D);
    corpora.push({ R: plan.R, kind, specimens: roots[kind].length, svo: [...c.svo], dag: [...c.dag],
      m8: c.classes[0], oh: c.classes[1], bytes: bytes(c, D) });
  }
  console.log(`R=${plan.R}: ${jobs.length} specimens, store ${store.size} nodes, ` +
              `${views[1].size} Oh classes, ${((performance.now() - started) / 1000).toFixed(1)} s`);
}
const seconds = (performance.now() - started) / 1000;

/* ---- report ---------------------------------------------------------------- */
const empties = records.filter(r => r.empty);
const all = records;
records = records.filter(r => !r.empty);
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[n >> 1] : (s[n/2 - 1] + s[n/2]) / 2) : NaN; };
const fx = (x, d = 1) => Number.isFinite(x) ? x.toFixed(d) : '-';
const n0 = x => Math.round(x).toLocaleString('en-US');
const kb = x => { const u = ['KB', 'MB', 'GB', 'TB', 'PB']; let v = x / 1024, i = 0; while (v >= 1024 && i < u.length - 1){ v /= 1024; i++; } return `${v.toFixed(1)} ${u[i]}`; };
const pct = x => `${(100 * x).toFixed(1)}%`;
const nodes = (a, D) => sum(a, 2, D);         // levels 2..D: 4³ leaves and up
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');

const md = [];
md.push(`# Hash-cons results (generated)`, '',
  `Generated by \`node experiments/hashcons.mjs${QUICK ? ' --quick' : ''}\` on ${new Date().toISOString().slice(0, 10)} in ${seconds.toFixed(0)} s. ` +
  `Don't edit: re-running overwrites this file. What the numbers mean is in [hashcons-findings.md](hashcons-findings.md), and the method is in [hashcons-plan.md](hashcons-plan.md). ` +
  `Every per-specimen number is in [data/hashcons.json](data/hashcons.json).`, '',
  `- block-showroom: \`${showroomRevision()}\`, through \`createBimoblockCore().buildBlock\``,
  `- ${records.length} specimens, plus ${empties.length} tier-folded ones that came out empty and are excluded (${empties.map(r => `${r.stack} ${r.arch}`).join(', ')}). "global" means one group folds the whole specimen; "tier" means each tier folds by its own group (\`tierSymmetry\`)`,
  `- **Node counts are levels 2..D**: 4³ leaves (one 64-bit mask each) and every level above. Level-1 (2³) nodes live inside the leaves`,
  `- **Labels:** *M8* is SSVDAG's 8 mirrors; *Oh* is all 48 elements of the cube group`, '');

md.push(`## 1. Corpus totals`, '',
  `Each corpus is interned into one shared store, so "DAG" here includes sharing *between* specimens (§5 separates that out).`, '',
  table(['R', 'kind', 'specimens', 'voxels', 'SVO nodes', 'DAG nodes', 'M8 classes', 'Oh classes', 'SVO→DAG', 'DAG→Oh', 'SVO bytes', 'SVDAG', 'SSVDAG-48', '64-tree DAG'],
    corpora.map(c => { const D = Math.log2(c.R); return [c.R, c.kind, c.specimens, n0(c.svo[0]), n0(nodes(c.svo, D)), n0(nodes(c.dag, D)),
      n0(nodes(c.m8, D)), n0(nodes(c.oh, D)), `${fx(nodes(c.svo, D) / nodes(c.dag, D))}×`, `${fx(nodes(c.dag, D) / nodes(c.oh, D))}×`,
      kb(c.bytes.tree), kb(c.bytes.svdag), kb(c.bytes.ssvdag48), kb(c.bytes.tree64)]; })), '');

md.push(`## 2. Symmetry: does a group of order |G| shrink by |G|?`, '',
  `Per specimen, then the median over each group's specimens (global recipes only). *Stab* is the root's measured stabilizer in Oh: it can exceed |G| when the envelope and field happen to have more symmetry than the fold forces. *Oh gain* is DAG nodes over Oh classes, i.e. what the labels buy on top of plain hash-consing. *Bytes gain* is SVDAG bytes over SSVDAG-48 bytes, which is smaller because labelled pointers don't shrink.`, '');
for (const R of PLAN.map(p => p.R)){
  const rows = [];
  for (let sym = 0; sym < NG; sym++){
    const rs = records.filter(r => r.R === R && r.kind === 'global' && r.sym === sym);
    if (!rs.length) continue;
    const D = rs[0].D;
    rows.push([core.GROUPS[sym].name, core.GROUPS[sym].order, rs.length, median(rs.map(r => r.stab)),
      `${fx(median(rs.map(r => nodes(r.svo, D) / nodes(r.dag, D))))}×`,
      `${fx(median(rs.map(r => nodes(r.dag, D) / nodes(r.m8, D))))}×`,
      `${fx(median(rs.map(r => nodes(r.dag, D) / nodes(r.oh, D))))}×`,
      `${fx(median(rs.map(r => r.bytes.svdag / r.bytes.ssvdag48)))}×`,
      kb(median(rs.map(r => r.bytes.svdag))), kb(median(rs.map(r => r.bytes.ssvdag48)))]);
  }
  md.push(`### R = ${R}`, '', table(['group', '\\|G\\|', 'n', 'median stab', 'SVO→DAG', 'M8 gain', 'Oh gain', 'bytes gain', 'SVDAG (median)', 'SSVDAG-48 (median)'], rows), '');
}
const tierRows = PLAN.map(p => p.R).flatMap(R => [...new Set(records.filter(r => r.R === R && r.kind === 'tier').map(r => r.stack))].map(stack => {
  const rs = records.filter(r => r.R === R && r.kind === 'tier' && r.stack === stack), D = rs[0].D;
  return [R, stack, rs.length, `${fx(median(rs.map(r => nodes(r.svo, D) / nodes(r.dag, D))))}×`,
    `${fx(median(rs.map(r => nodes(r.dag, D) / nodes(r.oh, D))))}×`, `${fx(median(rs.map(r => r.bytes.svdag / r.bytes.ssvdag48)))}×`,
    kb(median(rs.map(r => r.bytes.svdag))), kb(median(rs.map(r => r.bytes.ssvdag48)))];
}));
md.push(`### Tier-folded specimens`, '', `Each tier folds by its own group, so the symmetry repeats at every scale, the way an IFS does.`, '',
  table(['R', 'stack', 'n', 'SVO→DAG', 'Oh gain', 'bytes gain', 'SVDAG (median)', 'SSVDAG-48 (median)'], tierRows), '');

md.push(`### Simple shapes (smooth content)`, '',
  `The fields in experiments/shapes.mjs. *Surface fill* is per brick size, as in §4: seen voxels over the voxels of the bricks that have surface. *16³ ÷ 8³ attributes* is how much more 1 B/voxel attribute memory 16³ bricks need than 8³.`, '');
for (const R of PLAN.map(p => p.R)){
  const rs = records.filter(r => r.R === R && r.kind === 'shape'); if (!rs.length) continue;
  md.push(`#### R = ${R}`, '', table(['shape', 'voxels', 'surface', 'stab', 'SVO→DAG', 'Oh gain', 'SVDAG', 'SSVDAG-48', 'fill 4³', 'fill 8³', 'fill 16³', '16³ ÷ 8³ attributes'],
    rs.map(r => [r.shape, n0(r.voxels), pct(r.surface / r.voxels), r.stab,
      `${fx(nodes(r.svo, r.D) / nodes(r.dag, r.D))}×`, `${fx(nodes(r.dag, r.D) / nodes(r.oh, r.D))}×`, kb(r.bytes.svdag), kb(r.bytes.ssvdag48),
      ...r.bricks.map(b => pct(r.surface / (b.surfaceBricks * b.side ** 3))), `${fx(r.bricks[2].attr / r.bricks[1].attr, 2)}×`])), '');
}

md.push(`## 3. Where the deduplication happens, level by level`, '',
  `Summed over each corpus's per-specimen DAGs (no cross-specimen sharing). Level k nodes cover 2^k voxels per side: level 2 = 4³ leaves, level 3 = 8³, level 4 = 16³.`, '');
for (const R of PLAN.map(p => p.R)) for (const kind of KINDS){
  const rs = records.filter(r => r.R === R && r.kind === kind); if (!rs.length) continue;
  const D = rs[0].D, S = key => Array.from({ length: D + 1 }, (_, k) => rs.reduce((s, r) => s + (r[key][k] || 0), 0));
  const svo = S('svo'), dag = S('dag'), m8 = S('m8'), oh = S('oh');
  md.push(`### R = ${R}, ${kind}`, '', table(['level', 'side', 'SVO', 'DAG', 'M8', 'Oh', 'SVO→DAG', 'DAG→Oh'],
    Array.from({ length: D }, (_, i) => i + 1).map(k => [k, `${1 << k}³`, n0(svo[k]), n0(dag[k]), n0(m8[k]), n0(oh[k]), `${fx(svo[k] / dag[k])}×`, `${fx(dag[k] / oh[k])}×`])), '');
}

md.push(`## 4. Bricks: 4³, 8³ or 16³ (Q16)`, '',
  `Totals over each corpus's specimens. *Surface bricks* contain at least one surface voxel; the rest of the non-empty bricks are solid. *Surface fill* is surface voxels over the voxels of the surface bricks: the fraction of a 1 B/voxel attribute page that's actually seen. *Unique* bricks are per specimen, summed. The bytes columns follow the byte model in the script's header.`, '');
for (const R of PLAN.map(p => p.R)) for (const kind of KINDS){
  const rs = records.filter(r => r.R === R && r.kind === kind); if (!rs.length) continue;
  const surface = rs.reduce((s, r) => s + r.surface, 0), voxels = rs.reduce((s, r) => s + r.voxels, 0);
  md.push(`### R = ${R}, ${kind}: ${n0(voxels)} voxels, ${n0(surface)} on the surface (${pct(surface / voxels)})`, '',
    table(['brick', 'non-empty', 'surface', 'solid', 'occupancy fill', 'surface fill', 'unique', 'unique Oh', 'tree above', 'occupancy', 'occupancy (Oh)', 'attributes (1 B/voxel)'],
      BRICKS.map((_, i) => {
        const B = key => rs.reduce((s, r) => s + r.bricks[i][key], 0), side = rs[0].bricks[i].side;
        return [`${side}³`, n0(B('nonEmpty')), n0(B('surfaceBricks')), n0(B('nonEmpty') - B('surfaceBricks')),
          pct(voxels / (B('nonEmpty') * side ** 3)), pct(surface / (B('surfaceBricks') * side ** 3)),
          n0(B('unique')), n0(B('uniqueOh')), kb(B('top')), kb(B('occ')), kb(B('occOh')), kb(B('attr'))];
      })), '');
}

md.push(`## 5. Sharing between specimens`, '',
  `Each corpus's specimens' own unique nodes, summed, against the unique nodes of the whole corpus interned together. The difference is what a shared node dictionary saves across a lattice of specimens.`, '');
for (const c of corpora){
  const rs = records.filter(r => r.R === c.R && r.kind === c.kind), D = Math.log2(c.R);
  const own = k => rs.reduce((s, r) => s + (r.dag[k] || 0), 0), ownOh = k => rs.reduce((s, r) => s + (r.oh[k] || 0), 0);
  md.push(`### R = ${c.R}, ${c.kind}`, '', table(['level', 'Σ per-specimen DAG', 'corpus DAG', 'shared', 'Σ per-specimen Oh', 'corpus Oh', 'shared'],
    Array.from({ length: D - 1 }, (_, i) => i + 2).map(k => [k, n0(own(k)), n0(c.dag[k]), `${fx(own(k) / c.dag[k], 2)}×`, n0(ownOh(k)), n0(c.oh[k]), `${fx(ownOh(k) / c.oh[k], 2)}×`])), '');
}

md.push(`## 6. Per-specimen bytes (a 64³ specimen is one Q10 chunk)`, '',
  table(['R', 'kind', 'n', 'voxels (median)', 'SVO tree', 'SVDAG', 'SSVDAG-8', 'SSVDAG-48', '64-tree DAG', '16³ pages: occupancy + tree', '8³ pages: occupancy + tree'],
    PLAN.map(p => p.R).flatMap(R => KINDS.map(kind => {
      const rs = records.filter(r => r.R === R && r.kind === kind); if (!rs.length) return null;
      const m = f => kb(median(rs.map(f)));
      return [R, kind, rs.length, n0(median(rs.map(r => r.voxels))), m(r => r.bytes.tree), m(r => r.bytes.svdag), m(r => r.bytes.ssvdag8), m(r => r.bytes.ssvdag48),
        m(r => r.bytes.tree64), m(r => r.bricks[2].occ + r.bricks[2].top), m(r => r.bricks[1].occ + r.bricks[1].top)];
    }).filter(Boolean))), '');

/* ---- sol-v4's rows -------------------------------------------------------
   Built straight from each row's automaton (fromRadix4), never densely,
   so L = 8 (side 65,536) is as cheap as L = 4. Every build is checked
   first: at L <= 3 its root must be the same id as fromDense applied to
   classifyCPU's occupancy (one store, so equal voxel sets mean equal ids),
   and at L = 4, 5 and 8 its voxel count must equal the core's own counters.
   A failure is printed in the report and fails the run. */
const tb = loadTestbed(), tbRows = rowsOf(tb), tbStart = performance.now();
let rootChecks = 0, countChecks = 0;
const tbFail = [];
for (const row of tbRows){
  for (const L of [1, 2, 3]){
    const cfg = row.cfgFor(L), st = createStore(), a = automatonOf(tb, cfg);
    const A = st.fromRadix4(L, a.start, a.step, a.accept, a.keyOf), B = st.fromDense(denseOf(tb, cfg, L), 4 ** L);
    rootChecks++;
    if (A.root !== B.root) tbFail.push(`${row.label} ${row.depth} L=${L}: automaton root ${A.root} != dense root ${B.root}`);
  }
}
const tbRecords = [];
for (const L of [4, 8]){
  const st = createStore(), vs = [createClasses(st, MIRROR8), createClasses(st, OH48)];
  for (const row of tbRows){
    const cfg = row.cfgFor(L), a = automatonOf(tb, cfg);
    const { root, D, states } = st.fromRadix4(L, a.start, a.step, a.accept, a.keyOf);
    vs.forEach(v => v.update());
    const c = census(st, [root], vs, D);
    for (const LL of (L === 4 ? [4, 5] : [8])){
      const cf = row.cfgFor(LL), ind = independentCount(tb, row, cf, LL);
      if (ind === null) continue;
      let got = c.svo[0];
      if (LL !== L){ const s2 = createStore(), a2 = automatonOf(tb, cf), r2 = s2.fromRadix4(LL, a2.start, a2.step, a2.accept, a2.keyOf); got = census(s2, [r2.root], [], r2.D).svo[0]; }
      countChecks++;
      if (got !== ind) tbFail.push(`${row.label} ${row.depth} L=${LL}: census ${got} voxels, core counter ${ind}`);
    }
    tbRecords.push({ L, D, axis: row.axis, label: row.label, depth: row.depth, states, voxels: c.svo[0],
      svo: [...c.svo], dag: [...c.dag], m8: c.classes[0], oh: c.classes[1], stab: vs[1].stabOfNode(root), bytes: bytes(c, D) });
  }
}
const tbSeconds = (performance.now() - tbStart) / 1000;
console.log(`testbed rows: ${tbRows.length} rows, ${rootChecks} root checks, ${countChecks} count checks, ${tbFail.length} failures, ${tbSeconds.toFixed(1)} s`);

md.push(`## 7. sol-v4's contact-sheet rows`, '',
  `${tbRows.length} rows: the six axes with the page's defaults (seed 42, density 0.44, field 0), and rule rows in all four depth modes (g48 = 13). Each is built straight from its automaton with \`fromRadix4\`, never densely, so L = 8 (side 65,536, binary depth 16) costs about as much as L = 4. In ${tbSeconds.toFixed(1)} s.`, '',
  `**Oracle checks:** ${rootChecks} roots compared with \`fromDense(classifyCPU)\` at L ≤ 3, and ${countChecks} voxel counts compared with the core's counters at L = 4, 5 and 8. **${tbFail.length ? tbFail.length + ' FAILED' : 'All equal'}.**`, '');
if (tbFail.length) md.push(...tbFail.map(f => `- FAIL: ${f}`), '');
md.push(`*States* is how many (level, state) pairs the automaton reached, the bound §1 predicts hash-consing meets or beats (each radix-4 state becomes at most 1 + 8 binary nodes). Medians per axis:`, '');
for (const L of [4, 8]){
  const D = 2 * L;
  md.push(`### L = ${L} (side ${n0(4 ** L)})`, '', table(['axis', 'rows', 'voxels', 'SVO nodes', 'DAG nodes', 'max DAG nodes', 'Oh classes', 'states', 'SVO tree bytes', 'SVDAG', 'SSVDAG-48'],
    AXIS_NAMES.map((name, ax) => {
      const rs = tbRecords.filter(r => r.L === L && r.axis === ax), m = f => median(rs.map(f));
      return [name, rs.length, n0(m(r => r.voxels)), n0(m(r => nodes(r.svo, D))), n0(m(r => nodes(r.dag, D))), n0(Math.max(...rs.map(r => nodes(r.dag, D)))),
        n0(m(r => nodes(r.oh, D))), n0(m(r => r.states)), kb(m(r => r.bytes.tree)), kb(m(r => r.bytes.svdag)), kb(m(r => r.bytes.ssvdag48))];
    })), '');
}
md.push(`### Every row at L = 8, uniform depth`, '', table(['axis', 'row', 'voxels', 'DAG nodes', 'Oh classes', 'states', 'stab', 'SVDAG', 'SVO tree'],
  tbRecords.filter(r => r.L === 8 && (r.depth === 'uniform' || r.depth === '-')).map(r => [AXIS_NAMES[r.axis], `\`${r.label}\``, n0(r.voxels),
    n0(nodes(r.dag, 16)), n0(nodes(r.oh, 16)), n0(r.states), r.stab, kb(r.bytes.svdag), kb(r.bytes.tree)])), '');

mkdirSync(new URL('../docs/data/', import.meta.url), { recursive: true });
if (!QUICK){
  writeFileSync(new URL('../docs/hashcons-results.md', import.meta.url), md.join('\n'));
  writeFileSync(new URL('../docs/data/hashcons.json', import.meta.url),
    JSON.stringify({ generated: new Date().toISOString(), showroom: showroomRevision(), seconds: +seconds.toFixed(1), corpora, records: all, testbed: tbRecords }));
  console.log(`wrote docs/hashcons-results.md and docs/data/hashcons.json (${seconds.toFixed(0)} s)`);
} else {
  console.log(md.join('\n'));
}
if (tbFail.length){ console.error(tbFail.join('\n')); process.exitCode = 1; }
