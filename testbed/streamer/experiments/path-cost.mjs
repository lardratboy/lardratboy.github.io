/* The path's cost model, fitted to your benches (docs/path-occupancy.md).

     node experiments/path-cost.mjs           # ~40 s; writes docs/path-cost-results.md and docs/data/path-cost.json
     node experiments/path-cost.mjs --print   # prints only

   ray-depth-findings.md question 3. The streamer picks raster or ray per
   chunk (stream-core §2b), and traces a chunk when
       footprint · c_px(occupancy)  <  cubes · c_cube,
   so it needs c_px, a ray's cost per pixel of a chunk's footprint, as a
   function of how full the chunk is. This rebuilds your four bench views
   (the same worlds, eyes and canvases, the cut converged at detail 2),
   and for each:
   - the leaves inside the frustum, as the viewer culls them: their cubes
     (records that show a face, the ones raster draws with no side open),
     their footprints and their occupancy (kept cells over 64³);
   - c_cube from the bench's raster row (ms over cubes drawn), and c_px
     from its ray-only row (ms over the visible leaves' summed footprints);
   then fits c_px(o) = a + b·o by least squares over the views, and
   turns it into the rule's two thresholds: c_px(0) / c_cube for an empty
   chunk and c_px(1) / c_cube for a full one.

   Last, which leaves each rule traces, raster first as the bench switches
   them, and what the model says the frame costs: cubes left × c_cube
   plus the traced footprints × c_px. That ray term assumes the pass
   covers only the traced chunks' pixels, which the stencil now makes
   true (ray-depth-findings question 2, docs/stencil-pass.md). The seed
   and graph rows' bench times were taken before it, with a full-screen
   pass; the terrain and scatter views' after it.

   The bench numbers are wall clock (Safari 27, Apple GPU, 2026-11-01,
   ray-depth-findings.md; the terrain and scatter views rebenched
   2026-11-02, stencil-pass.md §7–8), clear and blit included. Nothing here touches
   a GPU.

   A view marked `check` (the lattice, benched in Chrome 2026-11-03; the
   kit, 2026-11-04, whose rays the occupancy line doesn't predict) is
   rebuilt and reported but kept out of the fit: another browser on the
   same GPU costs twice as much a cube, and one view would pull the
   Safari fit toward it. §4 holds it to the rule instead: the rule's
   choice against the bench's best row, and the thresholds its own
   numbers imply. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createStore, createCounts, createClasses, OH48 } from '../dag-core.js';
import { createWorld, worldSnapshot, selectChunks, coverOf, createJobRunner, chunkFootprint, DEFAULTS } from '../stream-core.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { loadTestbed, rowsOf, automatonOf } from './testbed-corpus.mjs';
import { buildScatter, scatterDesc } from '../scatter-core.js';
import { buildLattice, latticeDesc } from '../lattice-core.js';
import { buildKit, kitDesc } from '../kit-core.js';

const PRINT = process.argv.includes('--print');
const started = performance.now();
const tb = loadTestbed(), ROWS = rowsOf(tb);
// Your second bench's canvas; a view benched on another says so (`canvas`).
const CANVAS = [2560, 1107], CELLS = 64 ** 3;
const viewportOf = ([w, h]) => ({ ...DEFAULTS, pxPerRadian: h / (2 * Math.tan(0.45)), screenPixels: w * h });

function rowWorld(index, L){
  const row = ROWS[index], s = createStore(), a = automatonOf(tb, row.cfgFor(L));
  const { root, D } = s.fromRadix4(L, a.start, a.step, a.accept, a.keyOf);
  return { store: s, root, D };
}
function shapeWorld(name, D){
  const s = createStore(), { root } = s.fromField(D, fieldOf(SHAPES.find(x => x.name === name), D));
  return { store: s, root, D };
}
// Your bench links, and their rows (ms): raster only, and ray only.
const VIEWS = [
  { name: 'seed row #42.0, inside', make: () => rowWorld(146, 8), eye: [32768, 40632, 32768], yaw: 2.4, pitch: -0.3, raster: 1.35, cubes: 364e3, ray: 10.2 },
  { name: 'graph row ·FEV/OFEV, inside', make: () => rowWorld(100, 8), eye: [32768, 40632, 32768], yaw: 2.4, pitch: -0.3, raster: 3.55, cubes: 1.17e6, ray: 0.86 },
  // Rebenched 2026-11-02 with the stencil, on the taller canvas
  // (docs/stencil-pass.md §8); 2026-11-01's was 1.83 raster, 511K cubes,
  // 11.2 ray only at 2560 × 1107.
  { name: 'terrain D = 11, low', make: () => shapeWorld('terrain', 11), eye: [1024, 1090, 300], yaw: 0, pitch: -0.25, canvas: [2560, 1357], raster: 1.74, cubes: 473.6e3, ray: 16.75 },
  // 2026-11-02, the scatter world's default view (docs/stencil-pass.md §6),
  // on a taller canvas: the rebench, with the pass that no longer discards.
  // Its ray-only row marks 86% of the canvas; the first bench (2.95 raster,
  // 14.49 ray, the discarding pass) was within 1% of it on both.
  { name: 'scatter D = 12, default view', make: () => { const b = buildScatter(scatterDesc({ D: 12 })); return { store: b.store, root: b.root, D: 12 }; },
    eye: [2048, 1863, 122.88], yaw: 0, pitch: -0.16, canvas: [2560, 1357], raster: 2.98, cubes: 895e3, ray: 14.37 },
  // 2026-11-03, Chrome on the same Apple GPU (docs/path-occupancy.md §6):
  // the lattice at R = 64, 10³ (lattice:1, upright, random, gap 16), the
  // first world with no ground. A check, not fitted (see the top).
  { name: 'lattice R = 64, 10³ (Chrome)', check: true,
    make: () => { const b = buildLattice(latticeDesc({ R: 64, n: 10 })); return { store: b.store, root: b.root, D: b.D }; },
    eye: [-405, 1139, -811], yaw: 0.588, pitch: -0.463, canvas: [2560, 1323], raster: 1.31, cubes: 192.8e3, ray: 3.33,
    rows: { density: 1.31, 'ray ≥ lod 3': 3.14, 'ray ≥ lod 1': 3.25 } },
  // 2026-11-04, the kit world at D = 16 from a street (kit-findings.md
  // question 4: kit:1, ?kit=16,8.6.4.3.2,4,1,2), wall clock, no timer
  // extension, on the Safari rebenches' canvas. The first view whose
  // ray-only row beats its raster row while the rule picks raster for most
  // chunks: 12.4M cubes in the cut, 3.95M drawn, ~1% full. In the ray rows
  // A check, not fitted: its rays cost half what the occupancy line
  // predicts (from a street they meet a wall soon; the seed row's, as
  // sparse, run deep), so a line through it fits neither it nor the
  // others. `refit` is the fit with it in, for the comparison
  // (path-occupancy.md §7).
  { name: 'kit D = 16, street', check: true, refit: true,
    make: () => { const b = buildKit(kitDesc({ D: 16 })); return { store: b.store, root: b.root, D: 16 }; },
    eye: [1311, 7864, 1311], yaw: 0.78, pitch: -0.05, canvas: [2560, 1357], raster: 16.46, cubes: 3.95e6, ray: 15.17,
    rows: { density: 17.93, 'ray ≥ lod 3': 14.23, 'ray ≥ lod 1': 14.93 } },
];

// The viewer's frustum (viewProj's 0.9 rad vertical field of view at the
// canvas's aspect), as four side planes through the eye and the forward
// one; boxVisible's test.
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
function planesOf(yaw, pitch, canvas){
  const f = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
  const z = f.map(v => -v), x = norm(cross([0, 1, 0], z)), y = cross(z, x), t = Math.tan(0.45), aspect = canvas[0] / canvas[1];
  const planes = [f];
  for (const [axis, tan] of [[x, t * aspect], [y, t]]) for (const s of [1, -1]) planes.push(norm(f.map((v, i) => v * tan - s * axis[i])));
  return planes;
}
const visible = (planes, rel, size) => planes.every(p =>
  p[0] * (rel[0] + (p[0] > 0 ? size : 0)) + p[1] * (rel[1] + (p[1] > 0 ? size : 0)) + p[2] * (rel[2] + (p[2] > 0 ? size : 0)) >= 0);

const sum = (a, f) => a.reduce((t, x) => t + f(x), 0);
const views = [];
for (const v of VIEWS){
  const w = v.make(), counts = createCounts(w.store), classes = createClasses(w.store, OH48);
  const world = createWorld(w.store, w.root, w.D), run = createJobRunner(worldSnapshot(w.store, w.root, w.D, { counts, classes }));
  const sel = selectChunks(world, v.eye, { detail: 2 }), drawn = new Set(coverOf(sel, () => true).draw.map(d => d.key)), canvas = v.canvas || CANVAS, planes = planesOf(v.yaw, v.pitch, canvas);
  const leaves = [];
  for (const c of sel.nodes.values()){
    if (!drawn.has(c.key)) continue;
    const r = run({ lod: c.lod, cx: c.x, cy: c.y, cz: c.z, lodRule: c.lod ? 'adaptive' : 'any', kind: 'records' });
    const rel = [0, 1, 2].map(a => [c.x, c.y, c.z][a] * c.size - v.eye[a]);
    leaves.push({ key: c.key, cubes: r.recordCount, withTail: r.records.length, occupancy: r.occupied / CELLS,
                  footprint: chunkFootprint(c, viewportOf(canvas)), visible: visible(planes, rel, c.size) });
  }
  const seen = leaves.filter(l => l.visible), fp = sum(seen, l => l.footprint);
  views.push({ ...v, make: undefined, leaves, visibleLeaves: seen.length, visibleCubes: sum(seen, l => l.cubes), visibleWithTail: sum(seen, l => l.withTail),
               footprint: fp, occupancy: sum(seen, l => l.footprint * l.occupancy) / fp,
               nsPerCube: v.raster * 1e6 / v.cubes, nsPerPixel: v.ray * 1e6 / fp });
  console.log(`${v.name}: ${leaves.length} leaves, ${seen.length} visible, ${((performance.now() - started) / 1000).toFixed(0)} s`);
}

// c_px(o) = a + b·o, least squares; c_cube, the mean of the raster rows.
// Over the fitted views only (not `check`); `refit` adds the views marked
// so (the kit), to show what they would do to the rule.
function fitOf(list){
  const mo = sum(list, v => v.occupancy) / list.length, mp = sum(list, v => v.nsPerPixel) / list.length;
  const b = sum(list, v => (v.occupancy - mo) * (v.nsPerPixel - mp)) / sum(list, v => (v.occupancy - mo) ** 2), a = mp - b * mo;
  const cCube = sum(list, v => v.nsPerCube) / list.length;
  return { a, b, cCube, empty: a / cCube, full: (a + b) / cCube };
}
const fitted = views.filter(v => !v.check), fit = fitOf(fitted), refit = fitOf(views.filter(v => !v.check || v.refit));
const { a, b, cCube } = fit, cPx = o => a + b * o;

// The rules, raster first (a chunk resident as records turns into a page
// above threshold · band), and the model's frame.
const BAND = 1.5;
const RULES = [
  { name: 'constant 0.2, seam tail counted (the bench\'s)', th: () => 0.2, n: l => l.withTail },
  { name: 'constant 0.2', th: () => 0.2, n: l => l.cubes },
  { name: 'by occupancy, 0.26 → 0.015 (fitted to three views)', th: o => 0.26 + (0.015 - 0.26) * o, n: l => l.cubes },
  { name: 'by occupancy, 0.27 → 0.025 (refitted to four, the default)', th: o => 0.27 + (0.025 - 0.27) * o, n: l => l.cubes },
  // 2026-11-04: the fit with the kit's street bench in it (refit).
  { name: `by occupancy, ${refit.empty.toFixed(2)} → ${refit.full.toFixed(3)} (refitted with the kit)`, th: o => refit.empty + (refit.full - refit.empty) * o, n: l => l.cubes },
];
const outcomes = [];
for (const v of views) for (const r of RULES){
  const traced = l => r.n(l) / l.footprint > r.th(l.occupancy) * BAND;
  const seen = v.leaves.filter(l => l.visible), t = seen.filter(traced), k = seen.filter(l => !traced(l));
  const rasterMs = sum(k, l => l.cubes) * cCube / 1e6, rayMs = sum(t, l => l.footprint * cPx(l.occupancy)) / 1e6;
  outcomes.push({ view: v.name, rule: r.name, traced: v.leaves.filter(traced).length, leaves: v.leaves.length, visibleTraced: t.length,
                  visible: seen.length, cubesLeft: sum(k, l => l.cubes), rasterMs, rayMs, totalMs: rasterMs + rayMs });
}
const seconds = (performance.now() - started) / 1000;

const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const K = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'K' : String(n);
const text = [
  '# The path\'s cost model, fitted',
  '',
  `Generated by \`node experiments/path-cost.mjs\` on ${new Date().toISOString().slice(0, 10)} in ${seconds.toFixed(0)} s. ` +
  'The reading is in [path-occupancy.md](path-occupancy.md). Your four bench views, rebuilt on their canvases; the bench times are yours ' +
  '(Safari 27, Apple GPU, wall clock: the seed and graph rows 2026-11-01 at 2560 × 1107, the terrain and scatter views rebenched 2026-11-02 at 2560 × 1357). Nothing here touches a GPU.',
  '',
  '## 1. The views',
  '',
  '*visible* leaves are those inside the frustum, as the viewer culls them. *cubes* are the records that show a face (what raster draws with no side open); ' +
  '*with tail* adds the seam tail. *footprint* is the visible leaves\' summed footprints (pixels; they overlap). *occupancy* is footprint-weighted. ' +
  '*ns / cube* is the bench\'s raster row over its cubes; *ns / footprint px* its ray-only row over the footprint.',
  '',
  table(['view', 'leaves', 'visible', 'cubes', 'with tail', 'footprint', 'occupancy', 'raster ms', 'ray only ms', 'ns / cube', 'ns / footprint px', 'fit'],
    views.map(v => [v.check ? `${v.name} *(check)*` : v.name, v.leaves.length, v.visibleLeaves, K(v.visibleCubes), K(v.visibleWithTail), (v.footprint / 1e6).toFixed(1) + 'M',
      v.occupancy.toFixed(3), v.raster, v.ray, v.nsPerCube.toFixed(2), v.nsPerPixel.toFixed(3), cPx(v.occupancy).toFixed(3)])),
  '',
  '## 2. The fit',
  '',
  `- c_px(o) = **${a.toFixed(3)} ${b < 0 ? '−' : '+'} ${Math.abs(b).toFixed(3)}·o** ns a footprint pixel: ${cPx(0).toFixed(3)} for an empty chunk, ${cPx(1).toFixed(3)} for a full one.`,
  `- c_cube = **${cCube.toFixed(2)} ns** (the mean of the raster rows).`,
  `- So the threshold runs from **${fit.empty.toFixed(3)}** records a pixel (empty) to **${fit.full.toFixed(3)}** (full). The viewer uses 0.27 and 0.025 (0.26 and 0.015 before the scatter bench). The terrain rebench moved the fit\'s full end to 0.029; the default stayed, because 0.03 traces fewer chunks and the model makes no view faster with it (stencil-pass.md §8).`,
  `- With the kit\'s street bench in the fit (a check, see §4), it would run from **${refit.empty.toFixed(3)}** to **${refit.full.toFixed(3)}** (c_px(o) = ${refit.a.toFixed(3)} ${refit.b < 0 ? '−' : '+'} ${Math.abs(refit.b).toFixed(3)}·o, c_cube ${refit.cCube.toFixed(2)} ns). §3 has what that rule would trace; the default stays (path-occupancy.md §7).`,
  '',
  '## 3. What each rule traces, and the model\'s frame',
  '',
  'Raster first, as the bench switches: a leaf is traced above threshold × 1.5. *model ms* is cubes left × c_cube + traced footprints × c_px, ' +
  'which assumes the ray pass covers only the traced chunks\' pixels, as the stencil now makes it ([stencil-pass.md](stencil-pass.md)). The seed and graph rows\' bench times were taken with the full-screen pass, the terrain and scatter views\' with the stencil.',
  '',
  table(['view', 'rule', 'traced (all leaves)', 'traced (visible)', 'cubes left', 'model ms: raster + ray = total'],
    outcomes.map(o => [o.view, o.rule, `${o.traced} / ${o.leaves}`, `${o.visibleTraced} / ${o.visible}`, K(o.cubesLeft),
      `${o.rasterMs.toFixed(2)} + ${o.rayMs.toFixed(2)} = **${o.totalMs.toFixed(2)}**`])),
  '',
  '## 4. The check views',
  '',
  'Not in the fit. For each: what the default rule traces (from §3), the bench\'s rows, and the thresholds the view\'s own numbers imply ' +
  '(its ns / footprint px over its ns / cube, at its occupancy): if the rule\'s threshold at that occupancy is on the same side of every visible chunk\'s density, the browser\'s different costs don\'t change the choice.',
  '',
  ...views.filter(v => v.check).flatMap(v => {
    const o = outcomes.find(x => x.view === v.name && /the default/.test(x.rule)), own = v.nsPerPixel / v.nsPerCube, rule = 0.27 + (0.025 - 0.27) * v.occupancy;
    const seen = v.leaves.filter(l => l.visible), dens = seen.map(l => l.cubes / l.footprint).sort((x, y) => x - y);
    const rows = { 'raster only': v.raster, ...v.rows, 'ray only': v.ray }, best = Object.entries(rows).sort((x, y) => x[1] - y[1])[0];
    return [`**${v.name}**`, '',
      `- the default rule traces ${o.visibleTraced} of ${o.visible} visible leaves (raster first, as the bench switches);`,
      `- the bench: ${Object.entries(rows).map(([k, ms]) => `${k} ${ms} ms`).join(', ')}; best: **${best[0]}**;`,
      `- its own costs: ${v.nsPerCube.toFixed(2)} ns a cube, ${v.nsPerPixel.toFixed(3)} ns a footprint pixel at occupancy ${v.occupancy.toFixed(3)}, so its own threshold there is **${own.toFixed(3)}** records a pixel; the rule's is ${rule.toFixed(3)};`,
      `- the visible leaves' densities (cubes over footprint): ${dens.map(d => d.toFixed(3)).join(', ')}.`, ''];
  }),
].join('\n');

console.log(text);
if (!PRINT){
  mkdirSync(new URL('../docs/data/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../docs/path-cost-results.md', import.meta.url), text);
  writeFileSync(new URL('../docs/data/path-cost.json', import.meta.url), JSON.stringify({ fit, refit, views: views.map(({ leaves, ...v }) => v), outcomes }, null, 1));
}
