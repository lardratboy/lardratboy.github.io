/* What saving an edited world costs (flatten-core.js, docs/save-edits-log.md §2).

   For each world the page can edit: its voxels, its skin (the voxels that can
   show, dag-core's surfaceOf), whether that skin is under FLAT_MAX, and for the
   ones that are, the flatten (prune, skin, words from the world's own named
   field) and the file writeVdag makes of it at six bits. No edits: the cost of
   a save is the world's skin, and a few blocks or drops move it by their own
   surface. The words are the field's own, so they cost what a coloured job's
   lod-0 colour costs, per voxel.

   Prints only. It measures times, so run it on an idle machine:
     node --max-old-space-size=8000 experiments/flatten-cost.mjs [filter] */
import { createCounts, surfaceOf } from '../dag-core.js';
import { flattenSteps, flatWorld, FLAT_MAX } from '../flatten-core.js';
import { writeVdag } from '../vdag-core.js';
import { colourOf } from '../colours.js';
import { buildClay, clayDesc } from '../clay-core.js';
import { buildKit, kitDesc } from '../kit-core.js';
import { buildCity, cityDesc } from '../city-core.js';
import { buildDungeon, dungeonDesc, dungeonPlan } from '../dungeon-core.js';
import { buildScatter, scatterDesc } from '../scatter-core.js';
import { buildCaves, caveDesc } from '../cave-core.js';
import { buildMath, mathDesc } from '../math-core.js';

// Each as the page builds it, with the colour descriptor the page hands the workers.
const W = (w, desc, D) => ({ store: w.store, root: w.root, D, desc });
const CASES = [
  ['clay D=20 (a 256 ball)', () => { const d = clayDesc(); return W(buildClay(d), d, d.D); }],
  ['clay D=12 on ground', () => { const d = clayDesc({ D: 12, ground: true }); return W(buildClay(d), d, 12); }],
  ['flat ground D=20', () => { const d = clayDesc({ D: 20, ground: true, lump: 0 }); return W(buildClay(d), d, 20); }],
  ['dungeon D=10', () => { const d = dungeonDesc({ D: 10 }), p = dungeonPlan(d); return W(buildDungeon(d, { plan: p }), { ...d, table: p.codes }, 10); }],
  ['kit D=10', () => { const d = kitDesc({ D: 10 }); return W(buildKit(d), d, 10); }],
  ['kit D=12', () => { const d = kitDesc({ D: 12 }); return W(buildKit(d), d, 12); }],
  ['city D=11', () => { const d = cityDesc({ D: 11 }); return W(buildCity(d), d, 11); }],
  ['city D=13', () => { const d = cityDesc({ D: 13 }); return W(buildCity(d), d, 13); }],
  ['scatter D=10', () => { const d = scatterDesc({ D: 10 }), s = buildScatter(d); return W(s, { kind: 'scatter', ...d, table: s.table }, 10); }],
  ['caves D=10', () => { const d = caveDesc({ D: 10 }); return W(buildCaves(d), d, 10); }],
  ['math D=10', () => { const d = mathDesc({ D: 10 }), m = buildMath(d); return W(m, { ...d, table: m.table }, 10); }],
];
const filter = process.argv[2] ?? '';
const fmt = n => n >= 1e9 ? `${(n / 1e9).toFixed(2)}G` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
console.log(`FLAT_MAX = ${fmt(FLAT_MAX)} skin voxels\n`);
console.log('| world | voxels | skin | skin ms | saved? | words ms | ns a word | write ms | file |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const [name, build] of CASES){
  if (!name.includes(filter)) continue;
  const w = build(), counts = createCounts(w.store);
  const t0 = performance.now(), sk = surfaceOf(w.store, w.root, w.D), skinMs = performance.now() - t0;
  counts.update();
  const voxels = counts.of(w.root), skin = counts.of(sk);
  if (skin > FLAT_MAX){ console.log(`| ${name} | ${fmt(voxels)} | ${fmt(skin)} | ${skinMs.toFixed(0)} | no | | | | |`); continue; }
  let field = null;
  try { field = colourOf(w.desc, { store: w.store, counts, D: w.D }); }
  catch (e){ console.log(`| ${name} | ${fmt(voxels)} | ${fmt(skin)} | ${skinMs.toFixed(0)} | (no field: ${e.message}) | | | | |`); continue; }
  // The flatten itself, timed by phase (its skin is a fresh store's, so it pays for it again).
  const steps = flattenSteps(w.store, w.root, w.D, field), t = {};
  let last = performance.now(), phase = 'start', r;
  for (;;){ r = steps.next(); const now = performance.now(); t[phase] = (t[phase] ?? 0) + now - last; last = now; if (r.done) break; phase = r.value.phase; }
  const f = r.value, t1 = performance.now(), file = await writeVdag([flatWorld(f, { name })]), writeMs = performance.now() - t1;
  console.log(`| ${name} | ${fmt(voxels)} | ${fmt(skin)} | ${skinMs.toFixed(0)} | yes | ${t.words.toFixed(0)} | ${(t.words * 1e6 / f.skinVoxels).toFixed(0)} | ${writeMs.toFixed(0)} | ${(file.length / 1e6).toFixed(1)} MB |`);
}
