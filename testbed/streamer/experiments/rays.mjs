/* Step 5: the ray path, measured (docs/ray-plan.md).

     node experiments/rays.mjs            # ~3 min; writes docs/ray-results.md and docs/data/ray.json
     node experiments/rays.mjs --quick    # small worlds, prints only (~20 s)

   For each world, at step 4's default detail (2) with the whole cut
   resident, and for each split between raster and ray (rayLod = ∞, 3, 1,
   0), what the converged view costs:
   - GPU bytes: records for the rasterized chunks; for the traced ones a
     2 KB grid per page plus 64 B per *distinct* brick (deduplicated by DAG
     node and lod, as the viewer does), and what the bricks would cost
     without deduplication;
   - cubes the raster still draws, and chunks the ray traces;
   - job time per chunk, records against pages;
   - march steps per pixel of a 160 × 120 view, from ray-core's traceCPU
     over the same arrays the shader reads: the GPU's work, up to a
     constant per step (the GPU's own time needs your machine:
     stream-viewer.html?bench).
   And since the depth bound and the path by density (docs/ray-depth-plan.md):
   - a fifth split, `density`: each chunk traced when its records per
     footprint pixel exceed rayDensity · band, as the streamer decides it
     when every chunk is resident as records (the bench's order: raster
     first), for your canvas (2560 × 1107, the second bench's);
   - and a sixth, `occupancy` (docs/path-occupancy.md): the same, with the
     threshold falling from 0.27 for an empty chunk to 0.025 for a full
     one, the viewer's default since (0.26 → 0.015 until the scatter
     world's bench joined the fit);
   - steps with the bound: each pixel's tMax is the distance to the first
     cell it hits in a chunk the split rasterizes (found by tracing the
     view with every chunk as a page), so a covered pixel stops there.
   An eighth and ninth (2026-11-03), the kit world (docs/kit-plan.md) at
   D = 14, from the viewer's default view outside it and from a street.
   A seventh world, the scatter world (docs/scatter-plan.md: 1,024
   block-showroom specimens on hills, D = 12), from the viewer's default
   view.
   And since the stencil (docs/stencil-pass.md):
   - the pixels the ray pass runs on, those whose ray enters a traced
     chunk's box (grown by one of its cells) before the raster's surface,
     as the viewer's markTraced marks them, and the bounded steps summed
     over them alone, per pixel of the view.
   Nothing here touches a GPU. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createStore, createCounts, createClasses, OH48 } from '../dag-core.js';
import { createWorld, worldSnapshot, selectChunks, coverOf, createJobRunner, resultBytes, chooseKinds, DEFAULTS, clearance } from '../stream-core.js';
import { PAGE_WORDS, BRICK_WORDS, KIND_RAY, KIND_RASTER, createBrickPool, installPage, buildCoverTree, traceCPU } from '../ray-core.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { loadTestbed, rowsOf, automatonOf, AXIS_NAMES } from './testbed-corpus.mjs';
import { buildScatter, scatterDesc, groundOf } from '../scatter-core.js';
import { kitDesc, buildKit } from '../kit-core.js';

const QUICK = process.argv.includes('--quick');
const started = performance.now();
const tb = loadTestbed(), ROWS = rowsOf(tb);
function rowWorld(index, L, view){
  const row = ROWS[index], s = createStore(), a = automatonOf(tb, row.cfgFor(L));
  const { root, D } = s.fromRadix4(L, a.start, a.step, a.accept, a.keyOf);
  return { name: `${row.label}${row.depth === '-' ? '' : ' ' + row.depth}`, kind: AXIS_NAMES[row.axis], store: s, root, D, ...view };
}
function shapeWorld(name, D, view){
  const s = createStore(), { root } = s.fromField(D, fieldOf(SHAPES.find(x => x.name === name), D));
  return { name, kind: 'shape', store: s, root, D, ...view };
}
// The scatter world (docs/scatter-plan.md) from the viewer's default
// view: 160 voxels over the ground near one edge, looking across the field.
function scatterWorld(D){
  const desc = scatterDesc({ D }), b = buildScatter(desc), side = 2 ** D, x = 0.5 * side, z = 0.03 * side;
  return { name: `scatter (${b.layout.cells.length} specimens)`, kind: 'scatter', store: b.store, root: b.root, D,
           eyeAbs: [x, groundOf(desc).top(x, z) + 160, z], yaw: 0, pitch: -0.16 };
}
// The kit world (docs/kit-plan.md): its views as the viewer and the shots have them.
// Raised a 256th of the side at a time until 16 voxels clear, as in
// experiments/kit.mjs: at D = 12 the street's fraction is inside a solid.
function kitWorld(D, name, view){
  const k = buildKit(kitDesc({ D })), world = createWorld(k.store, k.root, D), eyeAbs = view.eye.map(v => v * world.side);
  while (clearance(world, eyeAbs, 2048).d < 16) eyeAbs[1] += world.side / 256;
  return { name: `kit D=${D} ${name}`, kind: 'kit', store: k.store, root: k.root, D, ...view, eyeAbs };
}
const KIT_DEFAULT = { eye: [-0.35, 0.9, -0.45], yaw: 0.68, pitch: -0.5 }, KIT_STREET = { eye: [0.02, 0.12, 0.02], yaw: 0.78, pitch: -0.05 };
// Eyes as fractions of the side, with a view direction (yaw, pitch), as in
// the viewer: inside the rows looking across them, above the terrain
// looking along it, off the sphere looking at it, above the half-space.
const INSIDE = { eye: [0.5, 0.62, 0.5], yaw: 2.4, pitch: -0.3 };
const WORLDS = QUICK ? [
  () => rowWorld(146, 6, INSIDE),
  () => shapeWorld('terrain', 9, { eye: [0.5, 0.62, 0.15], yaw: 0, pitch: -0.3 }),
  () => scatterWorld(10),
  () => kitWorld(12, 'street', KIT_STREET),
] : [
  () => rowWorld(146, 8, INSIDE),
  () => rowWorld(142, 8, INSIDE),
  () => rowWorld(100, 8, INSIDE),
  () => shapeWorld('terrain', 11, { eye: [0.5, 0.53, 0.15], yaw: 0, pitch: -0.25 }),
  () => shapeWorld('sphere', 12, { eye: [0.5, 0.55, -0.12], yaw: 0, pitch: -0.08 }),
  () => shapeWorld('half-space', 12, { eye: [0.5, 0.75, 0.75], yaw: 3.6, pitch: -0.4 }),
  () => scatterWorld(12),
  () => kitWorld(14, 'default', KIT_DEFAULT),
  () => kitWorld(14, 'street', KIT_STREET),
];
const RAY_LODS = [Infinity, 'density', 'occupancy', 3, 1, 0];
const W = 160, H = 120;
// The density rules on your canvas (the second bench's, 2026-11-01): the
// first version's constant threshold, and the viewer's default since, by
// occupancy (docs/path-occupancy.md).
const CANVAS = [2560, 1107];
const DENSITY = { ...DEFAULTS, rayDensity: 0.2, densityBand: 1.5, pxPerRadian: CANVAS[1] / (2 * Math.tan(0.45)), screenPixels: CANVAS[0] * CANVAS[1] };
const OCCUPANCY = { ...DENSITY, rayDensity: 0.27, rayDensityFull: 0.025 };

const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : NaN; };
const mb = b => (b / 1048576).toFixed(b < 10 * 1048576 ? 2 : 1);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');

// The camera basis of stream-viewer.html's rayBasis, at aspect W/H.
function basis(yaw, pitch){
  const f = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
  const z = f.map(v => -v), n = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
  const x = n(cross([0, 1, 0], z)), y = cross(z, x), t = Math.tan(0.45);
  return { fwd: f, rightT: x.map(v => v * t * W / H), upT: y.map(v => v * t) };
}

// Where the ray from `o` along d enters the box lo..lo+size grown by pad
// (0 if o is inside it), or Infinity if it never does.
function boxEntry(o, d, lo, size, pad){
  let t0 = -Infinity, t1 = Infinity;
  for (let a = 0; a < 3; a++){
    const ta = (lo[a] - pad - o[a]) / d[a], tb = (lo[a] + size + pad - o[a]) / d[a];
    t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb));
  }
  return t0 <= t1 && t1 > 0 ? Math.max(t0, 0) : Infinity;
}

const out = { quick: QUICK, worlds: [], views: [] };
for (const make of WORLDS){
  const w = make(), t0 = performance.now();
  const counts = createCounts(w.store), classes = createClasses(w.store, OH48);
  const world = createWorld(w.store, w.root, w.D), run = createJobRunner(worldSnapshot(w.store, w.root, w.D, { counts, classes }));
  const side = world.side, eye = w.eyeAbs || w.eye.map(v => v * side);
  const sel = selectChunks(world, eye, { detail: 2 });
  const fr = coverOf(sel, () => true);                     // converged: every leaf drawn
  const memo = new Map();
  const job = (c, kind) => {
    const k = c.key + '/' + kind;
    if (!memo.has(k)) memo.set(k, run({ lod: c.lod, cx: c.x, cy: c.y, cz: c.z, lodRule: c.lod ? 'adaptive' : 'any', kind }));
    return memo.get(k);
  };
  out.worlds.push({ name: w.name, kind: w.kind, D: w.D, nodes: w.store.size, leaves: sel.leaves.length, split: sel.nodes.size - sel.leaves.length });
  const B = basis(w.yaw, w.pitch);
  // Each pixel's ray, and its first hit with every drawn chunk a page: the
  // nearest surface of either path, and so the raster depth of any split
  // that rasterizes the chunk it falls in.
  const dirs = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){
    const nx = (x + 0.5) / W * 2 - 1, ny = (y + 0.5) / H * 2 - 1;
    const d = B.fwd.map((f, a) => f + nx * B.rightT[a] + ny * B.upT[a]), n = Math.hypot(...d);
    dirs.push(d.map(v => v / n));
  }
  const arraysOf = isRay => {
    const pool = createBrickPool(1 << 22), slotOf = new Map(), list = [];
    for (const c of sel.nodes.values()) if (isRay(c)) list.push(c);
    const pages = new Uint32Array(PAGE_WORDS * (list.length + 1));
    let bricks = new Uint32Array(BRICK_WORDS * 4096);
    list.forEach((c, i) => {
      pages.set(installPage(pool, c.lod, job(c, 'page'), (slot, bits) => {
        if (BRICK_WORDS * (slot + 1) > bricks.length){ const b2 = new Uint32Array(2 * bricks.length); b2.set(bricks); bricks = b2; }
        bricks.set(bits, BRICK_WORDS * slot);
      }), PAGE_WORDS * (i + 1));
      slotOf.set(c.key, i + 1);
    });
    const tree = buildCoverTree(world.top, fr.draw, d => isRay(d) ? { kind: KIND_RAY, page: slotOf.get(d.key) } : { kind: KIND_RASTER });
    return { tree, pages, bricks, top: world.top, D: w.D };
  };
  const allRay = arraysOf(() => true);
  const chunkOf = cell => fr.draw.find(q => [0, 1, 2].every(a => cell[a] >= q.lo[a] && cell[a] < q.lo[a] + q.size));
  const firstHits = dirs.map(d => { const t = traceCPU(allRay, eye, d); return t.hit ? { t: t.t, chunk: chunkOf(t.cell) } : null; });
  // The density splits' kinds, from every chunk resident as records.
  const asRecords = key => { const r = job(sel.nodes.get(key), 'records'); return { kind: 'records', recordCount: r.recordCount, occupancy: r.occupied / 64 ** 3 }; };
  const ruled = { density: chooseKinds(sel, asRecords, DENSITY), occupancy: chooseKinds(sel, asRecords, OCCUPANCY) };
  for (const rayLod of RAY_LODS){
    const isRay = c => ruled[rayLod] ? ruled[rayLod].get(c.key) === 'page' : c.lod >= rayLod;
    // Resident: the whole cut (leaves and split chunks), as the streamer keeps it.
    let recordBytes = 0, pageGrids = 0, brickRefs = 0, cubes = 0, rayDrawn = 0;
    const pool = createBrickPool(1 << 22), pagesArr = [], slotOf = new Map();
    const recMs = [], pageMs = [];
    for (const c of sel.nodes.values()){
      if (isRay(c)){
        const p = job(c, 'page');
        pageMs.push(p.ms); pageGrids++;
        for (let b = 0; b < PAGE_WORDS; b++) if (p.grid[b]) brickRefs++;
        slotOf.set(c.key, pagesArr.length);
        pagesArr.push(installPage(pool, c.lod, p, () => {}));
      } else {
        const r = job(c, 'records');
        recMs.push(r.ms); recordBytes += resultBytes(r);
      }
    }
    for (const d of fr.draw){
      if (isRay(d)) rayDrawn++;
      else { const r = job(d, 'records'); cubes += d.open ? r.records.length : r.count; }
    }
    const brickBytes = pool.size * BRICK_WORDS * 4, gridBytes = pageGrids * PAGE_WORDS * 4;
    // March steps for every pixel, over the arrays exactly as uploaded:
    // unbounded (step 5's ray pass), and bounded by the raster's depth.
    // And over the stencil's pixels only: those whose ray enters a traced
    // box, grown by a cell as markTraced grows it, before the raster.
    let steps = null, bounded = null, hits = 0, covered = 0, marked = 0, stencilled = 0;
    if (rayDrawn){
      const R = arraysOf(isRay), boxes = fr.draw.filter(isRay);
      steps = []; bounded = [];
      dirs.forEach((d, i) => {
        const f = firstHits[i], tMax = f && f.chunk && !isRay(f.chunk) ? f.t : Infinity;
        const t = traceCPU(R, eye, d), b = traceCPU(R, eye, d, 4096, 0, tMax);
        steps.push(t.steps); bounded.push(b.steps);
        if (t.hit) hits++;
        if (tMax < Infinity) covered++;
        if (boxes.some(q => boxEntry(eye, d, q.lo, q.size, q.size / 64) < tMax)){ marked++; stencilled += b.steps; }
      });
    }
    const stats = a => ({ median: med(a), p95: pct(a, 0.95), max: Math.max(...a), mean: a.reduce((x, y) => x + y, 0) / a.length });
    out.views.push({
      world: w.name, rayLod, recordBytes, gridBytes, brickBytes, brickBytesNoDedup: brickRefs * BRICK_WORDS * 4,
      distinctBricks: pool.size, brickRefs, cubes, rayDrawn, rasterDrawn: fr.draw.length - rayDrawn,
      recMs: med(recMs), pageMs: med(pageMs), pageMsP95: pct(pageMs, 0.95),
      steps: steps ? stats(steps) : null, bounded: bounded ? stats(bounded) : null,
      hitShare: steps ? hits / steps.length : null, coveredShare: steps ? covered / steps.length : null,
      markedShare: steps ? marked / steps.length : null, stencilledMean: steps ? stencilled / steps.length : null,
    });
  }
  console.log(`${w.name} (D=${w.D}): ${((performance.now() - t0) / 1000).toFixed(0)} s, ${memo.size} jobs`);
}
const seconds = (performance.now() - started) / 1000;

const lodName = l => l === Infinity ? 'raster only' : l === 0 ? 'ray only' : l === 'density' ? `density > ${DENSITY.rayDensity}`
                    : l === 'occupancy' ? `density > ${OCCUPANCY.rayDensity}…${OCCUPANCY.rayDensityFull}` : `ray ≥ lod ${l}`;
const text = [
  '# Step 5 results: the ray path',
  '',
  `Generated by \`node experiments/rays.mjs${QUICK ? ' --quick' : ''}\` on ${new Date().toISOString().slice(0, 10)} in ${seconds.toFixed(0)} s. ` +
  'The reading is in [ray-findings.md](ray-findings.md), the method in [ray-plan.md](ray-plan.md). Each world is viewed at detail 2 with the whole cut resident, as the streamer keeps it. ' +
  'Job times are this machine\'s in Node; march steps are ray-core\'s traceCPU over the arrays the shader reads, for a 160 × 120 view. Nothing here touches a GPU.',
  '',
  '## Worlds',
  '',
  table(['world', 'kind', 'D', 'DAG nodes', 'leaves', 'split'], out.worlds.map(w => [w.name, w.kind, w.D, w.nodes.toLocaleString('en'), w.leaves, w.split])),
  '',
  '## 1. What the view costs, by split',
  '',
  '*records* are the rasterized chunks\' bytes; *pages* the traced chunks\' grids (2 KB each) plus their distinct bricks (64 B each). ' +
  '*no dedup* is what the bricks would cost if every page kept its own. *cubes* are what the raster still draws.',
  '',
  table(['world', 'split', 'records MB', 'pages MB', 'total MB', 'bricks: distinct / used', 'no dedup MB', 'cubes', 'raster / ray chunks'],
    out.views.map(v => [v.world, lodName(v.rayLod), mb(v.recordBytes), mb(v.gridBytes + v.brickBytes), mb(v.recordBytes + v.gridBytes + v.brickBytes),
      `${v.distinctBricks.toLocaleString('en')} / ${v.brickRefs.toLocaleString('en')}`, mb(v.brickBytesNoDedup + v.gridBytes),
      v.cubes.toLocaleString('en'), `${v.rasterDrawn} / ${v.rayDrawn}`])),
  '',
  '## 2. Jobs and march steps',
  '',
  '*job ms* is the median per chunk (records jobs at lods below the split, page jobs above it). *steps* are per pixel, for the traced part of the view; a pixel that crosses only raster chunks still marches past them.',
  '',
  table(['world', 'split', 'records job ms', 'page job ms (p95)', 'steps median', 'p95', 'max', 'mean', 'pixels hit'],
    out.views.filter(v => v.steps).map(v => [v.world, lodName(v.rayLod), Number.isFinite(v.recMs) ? v.recMs.toFixed(1) : '–',
      `${v.pageMs.toFixed(1)} (${v.pageMsP95.toFixed(1)})`, v.steps.median, v.steps.p95, v.steps.max, v.steps.mean.toFixed(1), (100 * v.hitShare).toFixed(0) + '%'])),
  '',
  '## 3. The depth bound and the path by density',
  '',
  'Added with [ray-depth-plan.md](ray-depth-plan.md). *density* traces a chunk when its records per pixel of its footprint exceed ' +
  `${DENSITY.rayDensity} · ${DENSITY.densityBand} (the streamer's rule for a chunk resident as records, on a ${CANVAS.join(' × ')} canvas). ` +
  `*density > ${OCCUPANCY.rayDensity}…${OCCUPANCY.rayDensityFull}* is the same with the threshold linear in the chunk's occupancy, from ` +
  `${OCCUPANCY.rayDensity} empty to ${OCCUPANCY.rayDensityFull} full ([path-occupancy.md](path-occupancy.md)). ` +
  '*covered* is the share of pixels whose nearest surface is rasterized: there the bounded march stops at the raster\'s depth. ' +
  '*steps* are the mean per pixel over the whole view, unbounded (step 5) and bounded. ' +
  '*marked* is the share of pixels the stencil lets the ray pass run on ([stencil-pass.md](stencil-pass.md)): those whose ray enters a traced chunk\'s box, grown by one of its cells, before the raster\'s surface. ' +
  '*stencilled* is the bounded steps summed over the marked pixels only, still per pixel of the whole view: the ray pass\'s work, up to a constant per step.',
  '',
  table(['world', 'split', 'raster / ray chunks', 'cubes', 'MB', 'covered', 'mean steps unbounded → bounded', 'p95', 'max', 'marked', 'stencilled'],
    out.views.filter(v => v.steps).map(v => [v.world, lodName(v.rayLod), `${v.rasterDrawn} / ${v.rayDrawn}`, v.cubes.toLocaleString('en'),
      mb(v.recordBytes + v.gridBytes + v.brickBytes), (100 * v.coveredShare).toFixed(0) + '%',
      `${v.steps.mean.toFixed(1)} → **${v.bounded.mean.toFixed(1)}**`, `${v.steps.p95} → ${v.bounded.p95}`, `${v.steps.max} → ${v.bounded.max}`,
      (100 * v.markedShare).toFixed(0) + '%', `**${v.stencilledMean.toFixed(1)}**`])),
  '',
].join('\n');

if (QUICK) console.log(text);
else {
  mkdirSync(new URL('../docs/data/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../docs/ray-results.md', import.meta.url), text);
  writeFileSync(new URL('../docs/data/ray.json', import.meta.url), JSON.stringify(out, (k, v) => v === Infinity ? 'Infinity' : v, 1));
  console.log(`wrote docs/ray-results.md and docs/data/ray.json (${seconds.toFixed(0)} s)`);
}
