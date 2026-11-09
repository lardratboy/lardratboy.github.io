/* Labels beside the shape: E1 + E3 of docs/multidag-attributes.md §8, on the
   caves. A sketch, not the engine: nothing imports it, and the label store is
   a stand-in for dag-core's typed leaves (§3 B, not built).

     node experiments/label-sketch.mjs           D = 8, 10, 12 (seed 1) and D = 10 seed 9; writes
                                                 docs/labels-results.md (~3 min, ~1 GB)
     node experiments/label-sketch.mjs --quick   D = 8 and 10, prints only (~20 s)
     node experiments/label-sketch.mjs --D=12    one depth (seed 1), prints only

   The labels are cave-core's (caveLabelCell, held to voxelLabel by
   test/cave-core.test.js): air 0, rock 1, sea 2, pool water 3, lava 4.

   a. Three ways to store them (§3):
        A         one DAG whose leaves are labels, 0 meaning empty. It holds the
                  shape too: occupancy is "label ≠ 0".
        B, full   the bit DAG for shape, and beside it a label DAG with air as a
                  label. That label DAG *is* A (same voxels, same leaves), so
                  B, full costs the shape on top of A and saves nothing.
        B, masked the bit DAG for shape, and a label DAG with air as "don't
                  care": a cell whose occupied voxels share one label is that
                  label, whatever its air looks like. It needs the shape beside
                  it to say which voxels are there, and in return never splits
                  on the surface. This is the B the doc's sharing argument needs.
      The masked DAG is made canonical by a collapse after the build (all
      children one label or don't-care → that label), so it doesn't depend on
      how conservative the classifier's terms are.
   b. The checks, every run: A's occupancy is the shape DAG (root id for root
      id, mapped into the shape's store), and shape + masked rebuild A (root id
      for root id), so B, masked loses nothing. At D = 8 (G = 48, seed 7, the
      test's world), A against voxelLabel voxel for voxel, and E3's exact
      plurality against counting every cell's voxels.
   c. E3, the material's coarse rule (§6). A node's label histogram (voxels of
      each non-air label under it) is a sum over its children, so it is a
      function of the A node and shares like the node does. The exact rule is
      the histogram's plurality. The approximation is the one decided for the
      word (attributes-q13 §3): the count-weighted plurality of the points the
      coarse mean samples, meanDepth levels down (chunk-core's meanUnder: a
      sub-cell's weight is its voxel count, its label the field's at its
      centre). Air samples vote for nothing; a cell whose samples are all air
      gets no answer. Both rules are functions of the A node, so each is
      computed once a unique node and weighted by how often the node occurs
      at that level: the whole world, exactly, at DAG cost.
      Ties go to the lower label, in both rules. */
import { writeFileSync } from 'node:fs';
import { EMPTY, FIRST_NODE } from '../dag-core.js';
import { createLabelStore as labelStore, occupancyOf, recombine, expandLabels, histograms, occurrences, plurality as pluralityOf, centreLabel, sampledRule } from './label-core.mjs';
import { caveDesc, cavePlan, caveInfo, buildCaves, heightsOf, caveLabelCell, voxelLabel, CAVE_LABELS, AIR } from '../cave-core.js';

const quick = process.argv.includes('--quick');
const argD = process.argv.find(a => a.startsWith('--D='));
const WORLDS = argD ? [{ D: +argD.slice(4), seed: 1 }]
  : quick ? [{ D: 8, seed: 1 }, { D: 10, seed: 1 }, { D: 10, seed: 9 }]
  : [{ D: 8, seed: 1 }, { D: 10, seed: 1 }, { D: 10, seed: 9 }, { D: 12, seed: 1 }];
const NL = CAVE_LABELS.length;          // 5, air included
const createLabelStore = () => labelStore(NL);
const fmt = (x, d = 0) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '-';
const pct = (a, b, d = 2) => b ? fmt(100 * a / b, d) + '%' : '-';
const OUT = [];
const say = s => { console.log(s); OUT.push(s); };
const row = cells => say('| ' + cells.join(' | ') + ' |');
const now = () => performance.now();

/* The label store, the checks, histograms and the rules live in label-core.mjs
   (shared with label-kit.mjs, E1b on the kit). */
const plurality = (v, off = 0) => pluralityOf(v, NL, off);

/* ---- a world ------------------------------------------------------------------ */
function run({ D, seed, G = 192 }, { dense = false } = {}){
  const desc = caveDesc({ D, seed, G }), r = { D, seed, G };
  let t = now();
  const plan = cavePlan(desc), hts = heightsOf(plan, 0, 0, plan.S);
  r.info = caveInfo(plan); r.planMs = now() - t;
  t = now(); const shapeW = buildCaves(desc), shape = shapeW.store; r.shapeMs = now() - t;
  r.shape = shape.size;
  const L = createLabelStore();
  t = now(); const A = L.fromField(D, caveLabelCell(plan, hts)); r.AMs = now() - t;
  r.A = L.store.size - L.NLEAF;
  // The masked DAG in a store of its own, so its count is its own.
  const M = createLabelStore();
  t = now(); const mroot = M.fromField(D, caveLabelCell(plan, hts, { masked: true }), { masked: true }); r.MMs = now() - t;
  r.M = M.store.size - M.NLEAF;

  // checks
  const occ = occupancyOf(L, A, shape);
  r.okShape = occ.root === shapeW.root && shape.size === r.shape;
  // into A's own store: the same root, and no new nodes
  const before = L.store.size, rc = recombine(L, shape, shapeW.root, M, mroot);
  r.okMasked = rc.root === A && L.store.size === before;
  r.pairs = rc.pairs;

  // where A pays for the product: A nodes per shape node they map to
  const shapes = new Set();
  for (const s of occ.memo.values()) shapes.add(s);
  r.AInterior = occ.memo.size; r.AShapes = shapes.size;

  // nodes per level
  r.levels = [];
  for (let k = 0; k <= D; k++) r.levels.push([0, 0, 0]);
  for (let id = FIRST_NODE; id <= shape.maxId; id++) r.levels[shape.levelOf(id)][0]++;
  for (let id = FIRST_NODE + L.NLEAF; id <= L.store.maxId; id++) r.levels[L.store.levelOf(id)][1]++;
  for (let id = FIRST_NODE + M.NLEAF; id <= M.store.maxId; id++) r.levels[M.store.levelOf(id)][2]++;

  // histograms
  t = now(); const H = histograms(L); r.histMs = now() - t;
  const approx = sampledRule(L, H, centreLabel);
  r.entries = [0, 0, 0, 0, 0, 0];     // entries a node's histogram holds, air counted, by count 1–5
  for (let id = FIRST_NODE + L.NLEAF; id <= L.store.maxId; id++){
    if (!occ.memo.has(id)) continue;  // nodes the root doesn't reach (none: fromField interns only what it keeps)
    let n = 0, sum = 0;
    for (let j = 1; j < NL; j++) if (H[id * NL + j] > 0){ n++; sum += H[id * NL + j]; }
    if (sum < 8 ** L.store.levelOf(id)) n++;
    r.entries[n]++;
  }

  // E3
  const oc = occurrences(L.store, A);
  r.e3 = [];
  for (let lod = 1; lod <= 4; lod++){
    const e = { lod, cells: 0, voxels: 0, mixed: 0, partial: 0, unique: 0, rules: [] };
    const ids = [];
    for (let id = FIRST_NODE + L.NLEAF; id <= L.store.maxId; id++) if (L.store.levelOf(id) === lod && oc[id] > 0) ids.push(id);
    e.unique = ids.length;
    const exact = new Uint8Array(ids.length);
    ids.forEach((id, i) => {
      exact[i] = plurality(H, id * NL);
      let n = 0, sum = 0;
      for (let j = 1; j < NL; j++) if (H[id * NL + j] > 0){ n++; sum += H[id * NL + j]; }
      e.cells += oc[id]; e.voxels += oc[id] * sum;
      if (n >= 2) e.mixed += oc[id];
      if (sum < 8 ** lod) e.partial += oc[id];
    });
    for (const m of [0, 1, 2, lod]){
      const q = { meanDepth: m, wrong: 0, none: 0, noneVoxels: 0, lost: 0, confusion: new Map() };
      ids.forEach((id, i) => {
        const a = approx(id, lod, m);
        if (a === exact[i]) return;
        let sum = 0; for (let j = 1; j < NL; j++) sum += H[id * NL + j];
        if (a === 0){ q.none += oc[id]; q.noneVoxels += oc[id] * sum; return; }
        q.wrong += oc[id];
        q.lost += oc[id] * (H[id * NL + exact[i]] - H[id * NL + a]);
        const key = `${CAVE_LABELS[exact[i]]}→${a ? CAVE_LABELS[a] : 'none'}`;
        q.confusion.set(key, (q.confusion.get(key) || 0) + oc[id]);
      });
      e.rules.push(q);
    }
    // sampling every voxel is the exact rule
    r.okFullDepth = (r.okFullDepth ?? true) && e.rules[e.rules.length - 1].wrong === 0 && e.rules[e.rules.length - 1].none === 0;
    r.e3.push(e);
  }

  if (dense){
    const S = 2 ** D, got = expandLabels(L, A, D);
    let bad = 0;
    for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (got[x + S * (y + S * z)] !== voxelLabel(plan, x, y, z)) bad++;
    r.denseBad = bad;
    // exact plurality against counting each cell's voxels, lods 1–4
    let pbad = 0;
    for (let lod = 1; lod <= 4; lod++){
      const s = 2 ** lod, n = S / s, want = new Map();
      for (let Z = 0; Z < n; Z++) for (let Y = 0; Y < n; Y++) for (let X = 0; X < n; X++){
        const c = new Float64Array(NL);
        for (let z = 0; z < s; z++) for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) c[got[X * s + x + S * (Y * s + y + S * (Z * s + z))]]++;
        let id = A;
        for (let k = D - 1; k >= lod && id !== EMPTY && !L.labelOf.has(id); k--)
          id = L.store.child(id, ((X >> (k - lod)) & 1) | ((Y >> (k - lod)) & 1) << 1 | ((Z >> (k - lod)) & 1) << 2);
        const lab = L.labelOf.get(id), fromH = id === EMPTY ? 0 : lab !== undefined ? lab : plurality(H, id * NL);
        if (fromH !== plurality(c)) pbad++;
      }
    }
    r.pluralityBad = pbad;
  }
  return r;
}
/* ---- the report ---------------------------------------------------------------- */
const results = [];
say('# Labels beside the shape: results\n');
say('Generated by `node experiments/label-sketch.mjs` (multidag-attributes.md §8, E1 + E3, on the caves). The readings are in [labels-log.md](labels-log.md).\n');
say('## The check world (D = 8, G = 48, seed 7)\n');
{
  const r = run({ D: 8, seed: 7, G: 48 }, { dense: true });
  say(`A against voxelLabel, every voxel: ${r.denseBad} wrong. Exact plurality against counted voxels, lods 1–4, every cell: ${r.pluralityBad} wrong.`);
  say(`A's occupancy is the shape DAG: ${r.okShape}. Shape + masked rebuild A: ${r.okMasked}. Sampling every voxel is exact: ${r.okFullDepth}.\n`);
  if (r.denseBad || r.pluralityBad || !r.okShape || !r.okMasked || !r.okFullDepth) throw new Error('a check failed');
}
for (const w of WORLDS){
  const r = run(w);
  if (!r.okShape || !r.okMasked || !r.okFullDepth) throw new Error(`a check failed at D = ${w.D}, seed ${w.seed}`);
  results.push(r);
  process.stderr.write(`D = ${w.D} seed ${w.seed}: shape ${fmt(r.shapeMs / 1000, 1)} s, A ${fmt(r.AMs / 1000, 1)} s, masked ${fmt(r.MMs / 1000, 1)} s\n`);
}
const name = r => `D = ${r.D}, seed ${r.seed}`;
say('## E1: nodes\n');
say('Checks on every world: A\'s occupancy is the shape DAG, shape + masked rebuild A, and sampling every voxel gives the exact plurality. All held.\n');
row(['world', 'pools (lava)', 'shape', 'A', 'B, full = shape + A', 'masked label', 'B, masked = shape + masked', 'B, masked / A']);
row(['---', '---:', '---:', '---:', '---:', '---:', '---:', '---:']);
for (const r of results) row([name(r), `${r.info.pools} (${r.info.lava})`, fmt(r.shape), fmt(r.A), fmt(r.shape + r.A), fmt(r.M), fmt(r.shape + r.M), fmt((r.shape + r.M) / r.A, 3)]);
say('\nWhere A pays for shape and label together: its nodes against the shape nodes they map to (the product, §3).\n');
row(['world', 'A nodes', 'distinct shapes under them', 'A per shape', '(shape, mixed label) pairs, masked']);
row(['---', '---:', '---:', '---:', '---:']);
for (const r of results) row([name(r), fmt(r.AInterior), fmt(r.AShapes), fmt(r.AInterior / r.AShapes, 3), fmt(r.pairs)]);
say('\nBuild times (s, one thread):\n');
row(['world', 'plan', 'shape', 'A', 'masked']);
row(['---', '---:', '---:', '---:', '---:']);
for (const r of results) row([name(r), fmt(r.planMs / 1000, 2), fmt(r.shapeMs / 1000, 1), fmt(r.AMs / 1000, 1), fmt(r.MMs / 1000, 1)]);
const big = results[results.length - 1];
say(`\nNodes per level, ${name(big)}:\n`);
row(['level', 'shape', 'A', 'masked label']);
row(['---:', '---:', '---:', '---:']);
big.levels.forEach((v, k) => row([k, fmt(v[0]), fmt(v[1]), fmt(v[2])]));

say('\n## Histograms\n');
say('Entries in a unique A node\'s histogram, air counted as an entry where the node has any:\n');
row(['world', '1', '2', '3', '4', '5', 'histogram bytes (4 float64 a node)']);
row(['---', '---:', '---:', '---:', '---:', '---:', '---:']);
for (const r of results){ const n = r.entries.reduce((a, b) => a + b, 0); row([name(r), ...r.entries.slice(1).map(v => pct(v, n, 1)), fmt(32 * r.A)]); }

say('\n## E3: exact against sampled\n');
say('Cells are occurrences in the world (every occupied cell at that lod), not unique nodes. *Partial*: cells with some air, where the surface (and so every shown cell but the few full ones on it) lies. *No answer*: every point the sampled rule reads is air (a partial sub-cell\'s centre), so it names no material; *their voxels* is the occupied voxels in those cells. *Wrong*: it names another material than the exact rule; only mixed cells can be wrong. *Lost*: the voxels the exact label covers beyond the sampled one\'s, in the wrong cells. Shares of voxels are over all occupied voxels at that lod.\n');
for (const r of results){
  say(`### ${name(r)}\n`);
  row(['lod', 'unique nodes', 'cells', 'partial (some air)', 'mixed (2+ labels)', 'meanDepth', 'no answer', 'of partial', 'their voxels', 'wrong', 'of mixed', 'lost voxels', 'commonest confusions']);
  row(['---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---']);
  for (const e of r.e3) for (const q of e.rules.slice(0, 3)){
    const conf = [...q.confusion].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${pct(v, q.wrong, 0)}`).join(', ');
    const first = q.meanDepth === 0;
    row([first ? e.lod : '', first ? fmt(e.unique) : '', first ? fmt(e.cells) : '', first ? pct(e.partial, e.cells) : '', first ? pct(e.mixed, e.cells) : '',
         q.meanDepth, pct(q.none, e.cells, 2), pct(q.none, e.partial, 1), pct(q.noneVoxels, e.voxels, 3), pct(q.wrong, e.cells, 3), pct(q.wrong, e.mixed, 1), pct(q.lost, e.voxels, 4), conf]);
  }
  say('');
}
if (!quick && !argD){
  writeFileSync(new URL('../docs/labels-results.md', import.meta.url), OUT.join('\n') + '\n');
  process.stderr.write('wrote docs/labels-results.md\n');
}
