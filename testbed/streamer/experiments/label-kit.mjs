/* Labels on the kit: E1b of docs/labels-log.md §8, the product problem at
   scale. A sketch, not the engine: nothing imports it, and the label store is
   label-core.mjs's stand-in for typed leaves.

     node experiments/label-kit.mjs           every table; writes docs/labels-kit-results.md (~3.5 min)
     node experiments/label-kit.mjs --quick   D = 8 to 12, prints only
     node experiments/label-kit.mjs --D=14    one depth, prints only

   The caves (label-sketch.mjs) had no product problem: nothing there repeats
   in two materials, so shape A (one DAG of labels) and masked B (the bit DAG
   plus a label DAG with air as don't-care) came out within 1%. The kit is
   the opposite: the same 16³ part sits in thousands of places. Give it
   materials and A has to hold a copy of a part for every material it wears,
   while masked B's label DAG never sees the part's shape at all.

   a. The materials (M of them, 1…M; 0 is air) come from a hash of their own
      (MAT_SALT), never from kitPlan's draws, so the kit and its pins are the
      kit as it is. Each variant paints at one level c of the plan: every
      filled slot of every level-c entry paints its whole child one material.
        part       c = 1, by the part in the slot: a part is always one
                   material. No product: no part wears two.
        assembly   c = 1, by the level-1 entry: everything in assembly j is
                   one material. A part wears as many materials as there are
                   assemblies placing it, at most libs[0].
        slot       c = 1, by (entry, slot): each placement of a part in an
                   assembly its own material. The product.
        placement  c = 2, by (level-2 entry, slot): each placement of an
                   assembly its own material, so a whole 64³ assembly wears
                   several. The product one level up.
   b. Three DAGs a world, built from the plan as buildKit builds the shape
      (a 4³ grid is 8 interns and 1; a turn is a transform; no graft):
        shape      buildKit's, pruned. Unchanged.
        A          parts painted (label-core's painter), composed in a label
                   store. Turns leave label chains alone.
        masked     the same composition with every intern collapsing (label-
                   core's internMasked), and a painted part a chain: a part
                   of one material is that material, whatever its air.
      Node counts are what the root reaches, label leaves left out (the
      shape has none: a voxel is FULL).
   c. The checks, every world and variant: A's occupancy is buildKit's shape,
      root id for root id (so the label build composes the plan the way
      buildKit does); shape + masked rebuild A, root id for root id, interning
      nothing new (so masked B loses nothing). At D = 8, A against an oracle
      that walks the plan for every voxel with its own arithmetic (kit-core's
      unturn, as kitColour's frameOf has it, down to the part), and the exact
      plurality against counting every cell's voxels, lods 1–4. Past D = 8, A
      against the oracle at random voxels.
   d. E3's rules (label-sketch.mjs §c), as functions of the A node, weighted
      by occurrences: the exact plurality, the centre-point rule decided for
      colour, and the baked rule of §8's decision 2 (each sub-cell votes for
      its first occupied voxel's label: a stand-in for its first word). Ties
      go to the lower label. */
import { writeFileSync } from 'node:fs';
import { createStore, EMPTY, FIRST_NODE } from '../dag-core.js';
import { hash32 } from '../specimen-core.js';
import { kitDesc, kitPlan, buildKit, kitParam, PART, PART_LEVELS, PART_NAMES, PARTS, partOcc, ornamentOcc, sideOf } from '../kit-core.js';
import { createLabelStore, painter, occupancyOf, recombine, expandLabels, labelAt, histograms, occurrences, plurality,
         centreLabel, firstLabel, sampledRule } from './label-core.mjs';

const quick = process.argv.includes('--quick');
const argD = process.argv.find(a => a.startsWith('--D='));
const DS = argD ? [+argD.slice(4)] : quick ? [8, 10, 12] : [8, 10, 12, 14, 16];
const M_DEFAULT = 8;
const fmt = (x, d = 0) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }) : '-';
const pct = (a, b, d = 2) => b ? fmt(100 * a / b, d) + '%' : '-';
const OUT = [];
const say = s => { console.log(s); OUT.push(s); };
const row = cells => say('| ' + cells.join(' | ') + ' |');
const now = () => performance.now();

/* ---- the materials ------------------------------------------------------------ */
const MAT_SALT = 0x6d61746c;          // 'matl'
const matHash = (M, ...k) => {
  let s = MAT_SALT;
  for (const v of k) s = hash32(s, v >>> 0) >>> 0;
  return 1 + s % M;
};
const VARIANTS = [
  { name: 'part', c: 1, mat: (M, j, s, child) => matHash(M, 0, child) },
  { name: 'assembly', c: 1, mat: (M, j) => matHash(M, 1, j) },
  { name: 'slot', c: 1, mat: (M, j, s) => matHash(M, 1, j, s) },
  { name: 'placement', c: 2, mat: (M, j, s) => matHash(M, 2, j, s) },
];

/* ---- the parts, as bit DAGs and dense ---------------------------------------- */
function partsOf(desc){
  const ps = createStore(), occs = [];
  for (const n of PART_NAMES) occs.push(partOcc(PARTS[n]));
  for (let n = 0; n < desc.ornaments; n++) occs.push(ornamentOcc(n));
  return { ps, occs, roots: occs.map(o => ps.fromDense(o, PART).root) };
}

/* ---- the label build ------------------------------------------------------------
   buildKit's composition in a label store. Levels below c are built painted,
   on demand: (level, entry, material) → its subtree, every voxel that
   material. Level c's slots pick the painted child their material names;
   above c, entries are composed as they are. `masked` interns through the
   collapse, and a painted part is its material's chain. */
function buildLabels(desc, plan, v, M, parts, masked){
  const L = createLabelStore(1 + M), { L: levels } = plan;
  const intern = masked ? L.internMasked : (k, ch) => L.store.intern(k, ch);
  const fill = painter(L, parts.ps);
  const grid = (g, k) => {
    const ch = new Uint32Array(8), top = new Uint32Array(8);
    for (let O = 0; O < 8; O++){
      for (let o = 0; o < 8; o++) ch[o] = g[(2 * (O & 1) + (o & 1)) + 4 * (2 * (O >> 1 & 1) + (o >> 1 & 1)) + 16 * (2 * (O >> 2) + (o >> 2))];
      top[O] = intern(k + 1, ch);
    }
    return intern(k + 2, top);
  };
  const painted = new Map();
  const paintedOf = (l, j, m) => {
    if (l === 0) return masked ? L.uniform(m, PART_LEVELS) : fill(parts.roots[j], m);
    const key = (l * 65536 + j) * 256 + m;
    let r = painted.get(key);
    if (r !== undefined) return r;
    const { child, turn } = plan.levels[l], g = new Uint32Array(64);
    for (let s = 0; s < 64; s++){
      const c = child[64 * j + s];
      g[s] = c < 0 ? EMPTY : L.transform(paintedOf(l - 1, c, m), turn[64 * j + s]);
    }
    r = grid(g, PART_LEVELS + 2 * (l - 1));
    painted.set(key, r);
    return r;
  };
  const lib = [];
  for (let l = v.c; l <= levels; l++){
    const { n, child, turn } = plan.levels[l], out = [];
    for (let j = 0; j < n; j++){
      const g = new Uint32Array(64);
      for (let s = 0; s < 64; s++){
        const c = child[64 * j + s];
        if (c < 0){ g[s] = EMPTY; continue; }
        const below = l === v.c ? paintedOf(l - 1, c, v.mat(M, j, s, c)) : lib[l - 1][c];
        g[s] = L.transform(below, turn[64 * j + s]);
      }
      out.push(grid(g, PART_LEVELS + 2 * (l - 1)));
    }
    lib[l] = out;
  }
  return { L, root: lib[levels][0] };
}

// Nodes a level the root reaches (a label leaf's "children" are its label: not followed).
function reach(st, root, D){
  const seen = new Uint8Array(st.maxId + 1), lev = new Array(D + 1).fill(0);
  if (root >= FIRST_NODE) seen[root] = 1;
  for (let id = root; id >= FIRST_NODE; id--){
    if (!seen[id]) continue;
    const k = st.levelOf(id);
    lev[k]++;
    if (k === 0) continue;
    for (let o = 0; o < 8; o++){ const c = st.child(id, o); if (c >= FIRST_NODE) seen[c] = 1; }
  }
  return { lev, total: lev.reduce((a, b, k) => a + (k ? b : 0), 0) };
}

/* ---- the oracle -------------------------------------------------------------------
   A voxel's label by walking the plan from the top: the slot its centre is in,
   the point moved into the child's frame and turned back (kitColour's frameOf,
   inlined again here), down to the part's own voxel. The material is the
   variant's, read at level c on the way down. */
const PERM = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
function labelOracle(plan, v, M, occs){
  const { L } = plan, CH = plan.levels.map(l => l && l.child), TU = plan.levels.map(l => l && l.turn);
  const u = [0, 0, 0], w = [0, 0, 0];
  return (x, y, z) => {
    let px = x + 0.5, py = y + 0.5, pz = z + 0.5, j = 0, mat = 0;
    for (let l = L; l >= 1; l--){
      const s = sideOf(l - 1), i = Math.floor(px / s), k = Math.floor(py / s), m = Math.floor(pz / s);
      const slot = i + 4 * k + 16 * m, next = CH[l][64 * j + slot];
      if (next < 0) return 0;
      if (l === v.c) mat = v.mat(M, j, slot, next);
      w[0] = px - i * s; w[1] = py - k * s; w[2] = pz - m * s;
      const e = TU[l][64 * j + slot], P = PERM[e >> 3];
      for (let a = 0; a < 3; a++) u[P[a]] = (e >> a & 1) ? s - w[a] : w[a];
      px = u[0]; py = u[1]; pz = u[2]; j = next;
    }
    return occs[j][Math.floor(px) + PART * (Math.floor(py) + PART * Math.floor(pz))] ? mat : 0;
  };
}
// A small deterministic stream for the random voxels.
const stream = seed => () => (seed = hash32(seed, 0x2545f491) >>> 0) / 4294967296;

/* ---- a world, a variant ------------------------------------------------------------ */
const shapes = new Map();               // kitParam → { desc, plan, shape, parts, levels }
function shapeOf(over){
  const desc = kitDesc(over), key = `${desc.seed}:${kitParam(desc)}`;
  if (!shapes.has(key)){
    const plan = kitPlan(desc), t = now(), k = buildKit(desc, plan), ms = now() - t;
    shapes.set(key, { desc, plan, shape: k, ms, parts: partsOf(desc), reach: reach(k.store, k.root, desc.D) });
  }
  return shapes.get(key);
}
const LODS = [1, 2, 3, 4, 5, 6, 7, 8];
function run(over, v, M = M_DEFAULT, { dense = false, samples = 0, e3 = false } = {}){
  const { desc, plan, shape, parts, reach: sr, ms: shapeMs } = shapeOf(over), D = desc.D;
  const r = { D, desc, v: v.name, M, shape: sr.total, shapeLev: sr.lev, shapeMs };
  if (sr.total !== shape.nodes) throw new Error(`reach ${sr.total} ≠ buildKit's ${shape.nodes}`);
  let t = now(); const A = buildLabels(desc, plan, v, M, parts, false); r.AMs = now() - t;
  t = now(); const B = buildLabels(desc, plan, v, M, parts, true); r.MMs = now() - t;
  const ar = reach(A.L.store, A.root, D), mr = reach(B.L.store, B.root, D);
  r.A = ar.total; r.ALev = ar.lev; r.M_ = mr.total; r.MLev = mr.lev;
  const L = A.L;

  // checks
  const occ = occupancyOf(L, A.root, shape.store);
  r.okShape = occ.root === shape.root && shape.store.size === shape.nodes;
  const before = L.store.size, rc = recombine(L, shape.store, shape.root, B.L, B.root);
  r.okMasked = rc.root === A.root && L.store.size === before;
  r.pairs = rc.pairs;
  const oracle = labelOracle(plan, v, M, parts.occs), H = histograms(L), NL = L.NL;
  if (dense){
    const S = 2 ** D, got = expandLabels(L, A.root, D);
    let bad = 0, occd = 0;
    for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
      const want = oracle(x, y, z);
      if (want) occd++;
      if (got[x + S * (y + S * z)] !== want) bad++;
    }
    r.denseBad = bad; r.denseOcc = occd;
    let pbad = 0;
    for (let lod = 1; lod <= 4; lod++){
      const s = 2 ** lod, n = S / s;
      for (let Z = 0; Z < n; Z++) for (let Y = 0; Y < n; Y++) for (let X = 0; X < n; X++){
        const c = new Float64Array(NL);
        for (let z = 0; z < s; z++) for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) c[got[X * s + x + S * (Y * s + y + S * (Z * s + z))]]++;
        let id = A.root;
        for (let k = D - 1; k >= lod && id !== EMPTY && !L.labelOf.has(id); k--)
          id = L.store.child(id, ((X >> (k - lod)) & 1) | ((Y >> (k - lod)) & 1) << 1 | ((Z >> (k - lod)) & 1) << 2);
        const lab = L.labelOf.get(id), fromH = id === EMPTY ? 0 : lab !== undefined ? lab : plurality(H, NL, id * NL);
        if (fromH !== plurality(c, NL)) pbad++;
      }
    }
    r.pluralityBad = pbad;
  }
  if (samples){
    const rnd = stream(D * 977 + M), S = 2 ** D;
    let bad = 0, occd = 0;
    for (let i = 0; i < samples; i++){
      const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S), z = Math.floor(rnd() * S), want = oracle(x, y, z);
      if (want) occd++;
      if (labelAt(L, A.root, D, x, y, z) !== want) bad++;
    }
    r.sampleBad = bad; r.sampleOcc = occd;
  }

  // histograms: entries a reachable A node's histogram holds, air counted where it has some
  const oc = occurrences(L.store, A.root);
  r.entries = new Array(NL + 1).fill(0);
  for (let id = FIRST_NODE + L.NLEAF; id <= L.store.maxId; id++){
    if (!oc[id]) continue;
    let n = 0, sum = 0;
    for (let j = 1; j < NL; j++) if (H[id * NL + j] > 0){ n++; sum += H[id * NL + j]; }
    if (sum < 8 ** L.store.levelOf(id)) n++;
    r.entries[n]++;
  }

  if (e3){
    const centre = sampledRule(L, H, centreLabel), first = sampledRule(L, H, (L, id) => firstLabel(L, id));
    r.e3 = [];
    for (const lod of LODS){
      if (lod > D) break;
      const e = { lod, cells: 0, voxels: 0, mixed: 0, partial: 0, unique: 0, rules: [] }, ids = [];
      for (let id = FIRST_NODE + L.NLEAF; id <= L.store.maxId; id++) if (oc[id] > 0 && L.store.levelOf(id) === lod) ids.push(id);
      // chains count too: a uniform cell is a cell, one label, never wrong
      e.unique = ids.length;
      const exact = ids.map(id => plurality(H, NL, id * NL));
      ids.forEach(id => {
        let n = 0, sum = 0;
        for (let j = 1; j < NL; j++) if (H[id * NL + j] > 0){ n++; sum += H[id * NL + j]; }
        e.cells += oc[id]; e.voxels += oc[id] * sum;
        if (n >= 2) e.mixed += oc[id];
        if (sum < 8 ** lod) e.partial += oc[id];
      });
      for (const [rule, f] of [['centre', centre], ['first', first]]) for (const m of [0, 1, 2, lod]){
        const q = { rule, meanDepth: m, wrong: 0, none: 0, lost: 0 };
        ids.forEach((id, i) => {
          const a = f(id, lod, m);
          if (a === exact[i]) return;
          if (a === 0){ q.none += oc[id]; return; }
          q.wrong += oc[id];
          q.lost += oc[id] * (H[id * NL + exact[i]] - H[id * NL + a]);
        });
        e.rules.push(q);
      }
      // sampling every voxel is the exact rule, either way
      for (const q of e.rules) if (q.meanDepth === lod && (q.wrong || q.none)) r.badFullDepth = true;
      r.e3.push(e);
    }
  }
  const failed = !r.okShape || !r.okMasked || r.denseBad || r.pluralityBad || r.sampleBad || r.badFullDepth;
  if (failed) throw new Error(`a check failed: D = ${D}, ${v.name}, M = ${M}: ${JSON.stringify({ okShape: r.okShape, okMasked: r.okMasked, dense: r.denseBad, plurality: r.pluralityBad, samples: r.sampleBad, fullDepth: r.badFullDepth })}`);
  return r;
}

/* ---- the report ---------------------------------------------------------------------- */
say('# Labels on the kit: results\n');
say('Generated by `node experiments/label-kit.mjs` (labels-log.md §8, E1b on the kit). The readings are in [labels-kit-log.md](labels-kit-log.md).\n');
say(`Materials 1–M from a hash of their own; M = ${M_DEFAULT} unless a table says otherwise. Kits are the defaults (\`kitDesc({ D })\`: seed 1, default libraries, 4 ornaments, ground on) unless named. *shape* is buildKit's pruned DAG, *A* one DAG of labels, *masked* the label DAG beside the shape with air as don't-care; node counts are what each root reaches.\n`);

say('## The check worlds (D = 8, every variant, dense)\n');
row(['variant', 'occupied voxels', 'A against the oracle, every voxel', 'exact plurality against counted voxels, lods 1–4']);
row(['---', '---:', '---:', '---:']);
for (const v of VARIANTS){
  const r = run({ D: 8 }, v, M_DEFAULT, { dense: true });
  row([v.name, fmt(r.denseOcc), `${r.denseBad} wrong`, `${r.pluralityBad} wrong`]);
}
say('\nOn every world and variant below: A\'s occupancy is buildKit\'s shape (root id for root id), shape + masked rebuild A (root id for root id, nothing new interned), A agrees with the oracle at 200,000 random voxels, and sampling every voxel gives the exact plurality, both rules. All held, or the script would have stopped.\n');

const results = [];
for (const D of DS) for (const v of VARIANTS){
  const r = run({ D }, v, M_DEFAULT, { samples: 200000, e3: D === 14 || (D === DS[DS.length - 1] && !DS.includes(14)) });
  results.push(r);
  process.stderr.write(`D = ${D} ${v.name}: A ${fmt(r.AMs, 0)} ms, masked ${fmt(r.MMs, 0)} ms\n`);
}

say('## E1b: nodes\n');
row(['D', 'variant', 'shape', 'A', 'masked label', 'B, masked = shape + masked', 'A / shape', 'masked / shape', 'B, masked / A', '(shape, mixed label) pairs', 'A ms', 'masked ms']);
row(['---:', '---', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:']);
for (const r of results) row([r.D, r.v, fmt(r.shape), fmt(r.A), fmt(r.M_), fmt(r.shape + r.M_), fmt(r.A / r.shape, 2), fmt(r.M_ / r.shape, 2), fmt((r.shape + r.M_) / r.A, 3), fmt(r.pairs), fmt(r.AMs, 0), fmt(r.MMs, 0)]);

const big = DS.includes(14) ? 14 : DS[DS.length - 1];
say(`\nNodes per level at D = ${big} (shape; then A and masked for each variant):\n`);
const bigR = results.filter(r => r.D === big);
row(['level', 'shape', ...bigR.flatMap(r => [`A ${r.v}`, `masked ${r.v}`])]);
row(['---:', '---:', ...bigR.flatMap(() => ['---:', '---:'])]);
for (let k = 1; k <= big; k++) row([k, fmt(bigR[0].shapeLev[k]), ...bigR.flatMap(r => [fmt(r.ALev[k]), fmt(r.MLev[k])])]);

say(`\n## How many materials (D = ${big})\n`);
say('M = 1 is the shape painted one colour: A is the shape, node for node, and the masked DAG one chain.\n');
row(['M', ...VARIANTS.flatMap(v => [`A ${v.name}`, `masked ${v.name}`])]);
row(['---:', ...VARIANTS.flatMap(() => ['---:', '---:'])]);
const MS = quick || argD ? [1, 2, 8, 64] : [1, 2, 4, 8, 16, 64, 255];
for (const M of MS){
  const rs = VARIANTS.map(v => run({ D: big }, v, M, { samples: 20000 }));
  if (M === 1 && rs.some(r => r.A !== r.shape || r.M_ !== big)) throw new Error('M = 1: A should be the shape and masked one chain');
  row([M, ...rs.flatMap(r => [fmt(r.A), fmt(r.M_)])]);
}

say(`\n## Bigger libraries and more ornaments (D = ${big}, M = ${M_DEFAULT})\n`);
say('Shape, A and masked label nodes; B/A is (shape + masked) / A.\n');
const KITS = big === 14
  ? [{ D: 14 }, { D: 14, ornaments: 16 }, { D: 14, ornaments: 64 }, { D: 14, libs: [24, 16, 12, 8] }, { D: 14, libs: [128, 64, 32, 16] }, { D: 14, libs: [128, 64, 32, 16], ornaments: 64 }]
  : [{ D: big }, { D: big, ornaments: 16 }];
row(['kit', 'shape', ...VARIANTS.flatMap(v => [`A ${v.name}`, `masked ${v.name}`, `B/A ${v.name}`])]);
row(['---', '---:', ...VARIANTS.flatMap(() => ['---:', '---:', '---:'])]);
for (const k of KITS){
  const rs = VARIANTS.map(v => run(k, v, M_DEFAULT, { samples: 20000 }));
  row([kitParam(rs[0].desc), fmt(rs[0].shape), ...rs.flatMap(r => [fmt(r.A), fmt(r.M_), fmt((r.shape + r.M_) / r.A, 3)])]);
}

say('\n## Histograms\n');
say('Entries in a reachable A node\'s histogram, air counted as an entry where the node has any:\n');
row(['D', 'variant', '1', '2', '3', '4', '5+']);
row(['---:', '---', '---:', '---:', '---:', '---:', '---:']);
for (const r of results){
  const n = r.entries.reduce((a, b) => a + b, 0), e = r.entries;
  row([r.D, r.v, pct(e[1], n, 1), pct(e[2], n, 1), pct(e[3], n, 1), pct(e[4], n, 1), pct(e.slice(5).reduce((a, b) => a + b, 0), n, 1)]);
}

say(`\n## E3: exact against sampled (D = ${big})\n`);
say('Cells are occurrences in the world. *Partial*: some air. *Mixed*: two or more materials. *centre* is the rule decided for colour (a sub-cell votes for the label at its centre point, air voting for nothing); *first* is the baked rule (a sub-cell votes for its first occupied voxel\'s label, Morton order). *No answer*: every vote was air (centre only: first always has one). *Wrong*: another material than the exact plurality. *Lost*: the exact label\'s voxels beyond the named one\'s, in the wrong cells, over all occupied voxels at that lod.\n');
for (const r of results.filter(r => r.e3)){
  say(`### ${r.v}\n`);
  row(['lod', 'unique nodes', 'cells', 'partial', 'mixed', 'meanDepth', 'centre: no answer', 'of partial', 'centre: wrong', 'of mixed', 'centre: lost', 'first: wrong', 'of mixed', 'first: lost']);
  row(['---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:', '---:']);
  for (const e of r.e3) for (const m of [0, 1, 2]){
    const c = e.rules.find(q => q.rule === 'centre' && q.meanDepth === m), f = e.rules.find(q => q.rule === 'first' && q.meanDepth === m);
    const top = m === 0;
    row([top ? e.lod : '', top ? fmt(e.unique) : '', top ? fmt(e.cells) : '', top ? pct(e.partial, e.cells) : '', top ? pct(e.mixed, e.cells) : '', m,
         pct(c.none, e.cells), pct(c.none, e.partial, 1), pct(c.wrong, e.cells, 3), pct(c.wrong, e.mixed, 1), pct(c.lost, e.voxels, 4),
         pct(f.wrong, e.cells, 3), pct(f.wrong, e.mixed, 1), pct(f.lost, e.voxels, 4)]);
  }
  say('');
}
if (!quick && !argD){
  writeFileSync(new URL('../docs/labels-kit-results.md', import.meta.url), OUT.join('\n') + '\n');
  process.stderr.write('wrote docs/labels-kit-results.md\n');
}
