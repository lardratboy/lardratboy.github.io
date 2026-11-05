/* What a larger set of ornaments would cost (docs/kit-findings.md §5).

     node experiments/kit-ornaments.mjs     # ~3 min; prints the tables as markdown, writes nothing

   You asked (2026-11-04) what raising the kit's ornaments from 0…16 to
   1…2,048 would cost. KIT_LIMITS.ornaments caps them (16 then, 256 since
   §5's answers), so this sets the descriptor's field past the cap after
   kitDesc has checked it;
   kitPlan and buildKit read desc.ornaments and nothing else checks it.
   Three tables:
   1. The build: nodes before and after the prune, Oh classes, voxels,
      build time (parts, which is mostly generating the ornaments, then
      compose), how many ornaments the level-1 library actually placed,
      and what share of its non-floor slots are ornaments. Floor slots
      draw only from the block, slab and step, so they're left out.
   2. The ornaments themselves: time to generate 2,048, nodes each, and
      how many are distinct (plain DAG roots and Oh classes).
   3. The D = 14 street view, kit.mjs's, at detail 2 with colour: the cut,
      cubes, jobs and distinct records, with 4, 16, 256 and 2,048
      ornaments.
   It measures job times, so run it on an idle machine. */
import { kitDesc, kitPlan, buildKit, ornamentOcc, PART_NAMES } from '../kit-core.js';
import { createCounts, createClasses, createStore, OH48 } from '../dag-core.js';
import { createWorld, worldSnapshot, selectChunks, createJobRunner, clearance } from '../stream-core.js';
import { colourOf } from '../colours.js';

const P = PART_NAMES.length;
const fmt = n => n.toLocaleString('en-US');
const med = a => { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const descOf = (D, ornaments, libs = null) => { const d = kitDesc({ D, libs }); d.ornaments = ornaments; return d; };   // past the cap

/* ---- 1. the build ------------------------------------------------------------ */
function buildRow(D, ornaments, libs){
  const d = descOf(D, ornaments, libs), plan = kitPlan(d), k = buildKit(d, plan), l1 = plan.levels[1], used = new Set();
  let slots = 0, orn = 0;
  for (let j = 0; j < l1.n; j++) for (let s = 0; s < 64; s++){
    const c = l1.child[64 * j + s];
    if (c < 0 || (l1.grounded[j] && (s >> 2 & 3) === 0)) continue;
    slots++; used.add(c); if (c >= P) orn++;
  }
  return { D, ornaments, libs: d.libs.join('·'), raw: k.raw, nodes: k.nodes, oh: k.nodes < 400000 ? createClasses(k.store, OH48).size : null,
           voxels: createCounts(k.store).of(k.root), parts: k.ms.parts, compose: k.ms.compose, total: k.totalMs,
           used: [...used].filter(c => c >= P).length, slots, share: orn / slots };
}
const builds = [];
for (const n of [0, 4, 16, 64, 256, 1024, 2048]) builds.push(buildRow(14, n, null));
builds.push(buildRow(16, 2048, null));
builds.push(buildRow(14, 2048, [64, 6, 4, 3]));
builds.push(buildRow(14, 2048, [256, 16, 4, 3]));

/* ---- 2. the ornaments themselves ------------------------------------------------- */
const st = createStore(), roots = [], t0 = performance.now();
for (let n = 0; n < 2048; n++) roots.push(st.fromDense(ornamentOcc(n), 16).root);
const genMs = performance.now() - t0, cl = createClasses(st, OH48);
const gen = { ms: genMs, nodes: st.size, distinct: new Set(roots).size, classes: new Set(roots.map(r => cl.cls(r))).size };

/* ---- 3. the street view ----------------------------------------------------------- */
const hash = (a, h = 0x811c9dc5) => { for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 0x01000193); return h >>> 0; };
const views = [];
for (const n of [4, 16, 256, 2048]){
  const desc = descOf(14, n), k = buildKit(desc), counts = createCounts(k.store), classes = createClasses(k.store, OH48);
  const world = createWorld(k.store, k.root, 14), eye = [0.02, 0.12, 0.02].map(x => x * world.side);
  while (clearance(world, eye, 2048).d < 16) eye[1] += world.side / 256;
  const run = createJobRunner(worldSnapshot(k.store, k.root, 14, { counts, classes, colour: desc }), colourOf);
  const sel = selectChunks(world, eye, { detail: 2 }), ms = [], recs = new Set();
  let cubes = 0;
  for (const c of [...sel.nodes.values()].slice(0, 2)) run({ lod: c.lod, cx: c.x, cy: c.y, cz: c.z, lodRule: c.lod ? 'adaptive' : 'any', kind: 'records' });
  for (const c of sel.nodes.values()){
    const r = run({ lod: c.lod, cx: c.x, cy: c.y, cz: c.z, lodRule: c.lod ? 'adaptive' : 'any', kind: 'records' });
    ms.push(r.ms); cubes += r.recordCount; recs.add(`${c.lod}:${hash(r.records)}:${r.count}`);
  }
  views.push({ n, eye: eye.map(Math.round), chunks: sel.nodes.size, leaves: sel.leaves.length, cubes, jobMed: med(ms), jobSum: ms.reduce((a, b) => a + b, 0), distinct: recs.size });
  console.error(`street, ${n} ornaments: ${sel.nodes.size} chunks, ${(views.at(-1).jobSum / 1000).toFixed(1)} s of jobs`);
}

/* ---- the tables ------------------------------------------------------------------- */
const out = [];
out.push('### 1. The build', '',
  '| D | ornaments | libraries | built | nodes | Oh classes | voxels | build ms (parts + compose) | ornaments used | non-floor level-1 slots | ornament share |',
  '|---|---|---|---|---|---|---|---|---|---|---|');
for (const b of builds) out.push(`| ${b.D} | ${fmt(b.ornaments)} | ${b.libs} | ${fmt(b.raw)} | ${fmt(b.nodes)} | ${b.oh === null ? '—' : fmt(b.oh)} | ${(b.voxels / 1e9).toFixed(1)}G | ` +
  `${b.total.toFixed(0)} (${b.parts.toFixed(0)} + ${b.compose.toFixed(0)}) | ${fmt(b.used)} | ${fmt(b.slots)} | ${(100 * b.share).toFixed(0)}% |`);
out.push('', '### 2. The ornaments', '',
  `2,048 ornaments (seed 1): generated and interned in ${gen.ms.toFixed(0)} ms, ${fmt(gen.nodes)} nodes (${(gen.nodes / 2048).toFixed(0)} each, untransformed), ` +
  `${fmt(gen.distinct)} distinct, ${fmt(gen.classes)} Oh classes.`);
out.push('', '### 3. The D = 14 street (detail 2, colour)', '',
  '| ornaments | chunks | leaves | cubes | job ms median | jobs s | distinct records |', '|---|---|---|---|---|---|---|');
for (const v of views) out.push(`| ${fmt(v.n)} | ${v.chunks} | ${v.leaves} | ${(v.cubes / 1e6).toFixed(2)}M | ${v.jobMed.toFixed(1)} | ${(v.jobSum / 1000).toFixed(1)} | ${v.distinct} (${(100 * v.distinct / v.chunks).toFixed(0)}%) |`);
console.log(out.join('\n'));
