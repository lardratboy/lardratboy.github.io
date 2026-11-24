/* The README's "Measured" tables: `node destroy/measure.mjs` (~10 s) prints them
   as markdown, measured on the cores in Node.

   The arena rows build each size with buildArena (grid on, as the selftest's
   oracle does; the page's worker builds without the grid and the page stamps
   what it posts, which costs about the same), then mesh every chunk.

   The blast rows blow the default arena's biggest specimen up three ways, by
   a copy of the page's explode() (destroy/index.html): the blast, the burst,
   the loose pieces cut free and the push, with the page's default radii
   (rocketR 7, the big rocket 1.8 of it, plasmaR 2.5). The shot lands where a
   ray from 60 voxels in front of the specimen meets its face, 0.4 of the way
   up. Then stepDebris at 60 Hz until every body has baked: "settled" is that
   time on the arena's clock, "worst step" the longest single step. A change
   to explode() doesn't reach this copy.

   The save rows (README, "Saving an arena") save each size as built with
   file-core's writeArena (the shape, the words, vdag-core's write), read it
   back with readVdag and open it with arenaOfWorld, which must give the
   grid back cell for cell. The page runs both in file-worker.js.

   It measures times, so run it on an idle machine. */
import { buildArena, arenaDesc } from './content-core.js';
import { meshChunk, raycast, blast, looseAround, detach, mixCell } from './arena-core.js';
import { createDebris, stepDebris, burst, pushBodies, makeBody, addBody } from './debris-core.js';
import { arenaShape, arenaWords, writeArena, arenaOfWorld } from './file-core.js';
import { readVdag } from '../vdag-core.js';
import { colourOf } from '../colours.js';
import { storeView, createCounts } from '../dag-core.js';

const fmt = n => Math.round(n).toLocaleString('en-US');
const ms = t => t < 10 ? `${t.toFixed(1)} ms` : `${Math.round(t)} ms`;

console.log('| arena | voxels | build | mesh, all chunks | instances | grid |\n|---|---|---|---|---|---|');
for (const size of [256, 384, 512]){
  const t0 = performance.now(), r = buildArena(arenaDesc({ size })), t1 = performance.now();
  const A = r.A; let q = 0;
  for (let c = 0; c < A.CX * A.CY * A.CZ; c++) q += meshChunk(A, c).count;
  const t2 = performance.now();
  if (A.count !== r.count) throw new Error(`count ${A.count} against ${r.count}`);
  console.log(`| ${size} × ${r.desc.height} × ${size}${size === 384 ? ' (default)' : ''} | ${fmt(A.count)} | ${ms(t1 - t0)} | ${ms(t2 - t1)} | ${fmt(q)} | ${Math.round(A.cells.byteLength / 1e6)} MB |`);
}

const SLAG = [70, 56, 50];
const shots = [['rocket, r 7', 7, 'rocket'], ['big rocket, r 12.6', 7 * 1.8, 'rocket'], ['plasma, r 2.5', 2.5, 'plasma']];
let target = null;
console.log('\n| shot | carved | bodies | carve + burst + loose | settled | worst step |\n|---|---|---|---|---|---|');
for (const [name, r, kind] of shots){
  const { A, placed } = buildArena(arenaDesc()), D = createDebris(), total = A.count;
  const p = placed.filter(p => p.name.startsWith('specimen')).sort((a, b) => b.size[0] * b.size[1] * b.size[2] - a.size[0] * a.size[1] * a.size[2])[0];
  const c = [p.at[0] + p.size[0] / 2, p.at[1] + p.size[1] * 0.4, p.at[2] + p.size[2] / 2];
  const eye = [c[0], c[1], p.at[2] + p.size[2] + 60], h = raycast(A, eye, [0, 0, -1], 200);
  if (!h) throw new Error(`no face in front of ${p.name}`);
  target ??= `${p.name}, ${p.size.join(' × ')}, ${fmt(p.voxels)} voxels (${Math.round(100 * p.voxels / (p.size[0] * p.size[1] * p.size[2]))}% solid)`;
  const plasma = kind === 'plasma', seed = 1, t0 = performance.now();
  const carved = blast(A, h.p, r, plasma ? { seed, jag: 0.15, scorch: 1.2, char: 0.25 } : { seed, jag: 0.35, scorch: 1.6, char: 0.4 });
  const n = carved.cols.length;
  if (plasma){
    for (let k = 0; k < n; k++) carved.cols[k] = mixCell(carved.cols[k], SLAG[0], SLAG[1], SLAG[2], 0.5);
    burst(D, carved, h.p, r, { seed, liquid: true, normal: h.n, speed: 9 + r * 2, hot: 1 });
  } else burst(D, carved, h.p, r, { seed, cluster: n > 3000 ? 3 : 2, speed: 26 + r * 2.6, hot: 0.35, normal: h.n });
  for (const piece of looseAround(A, carved.box)){ const d = detach(A, piece); addBody(D, makeBody(d.offs, d.cols, d.origin, [0, 0, 0], { kind: 'piece' })); }
  pushBodies(D, h.p, r * 2.5, plasma ? 12 : 55);
  const t1 = performance.now(), bodies = D.bodies.length;
  let frames = 0, worst = 0;
  while (D.bodies.length && frames < 60 * 60){
    const s = performance.now(); stepDebris(D, A, 1 / 60); worst = Math.max(worst, performance.now() - s); frames++;
    let inFlight = 0; for (const b of D.bodies) inFlight += b.n;
    if (A.count + inFlight !== total) throw new Error(`mass ${A.count} + ${inFlight} against ${total} at frame ${frames}`);
  }
  if (D.bodies.length) throw new Error(`${D.bodies.length} bodies still in flight after a minute`);
  console.log(`| ${name} | ${fmt(n)} | ${fmt(bodies)}${plasma ? ' drops' : ''} | ${ms(t1 - t0)} | ${(frames / 60).toFixed(1)} s | ${ms(worst)} |`);
}
console.log(`\nThe target: ${target}.`);

console.log('\n| arena | D | nodes | file | shape + words | write, all of it | read + open |\n|---|---|---|---|---|---|---|');
for (const size of [256, 384, 512]){
  const { A } = buildArena(arenaDesc({ size }));
  const t0 = performance.now(), { store, root, D } = arenaShape(A); arenaWords(A, store, root, D);
  const t1 = performance.now(), bytes = await writeArena(A), t2 = performance.now();
  const { worlds: [w] } = await readVdag(bytes, { colourOf }), view = storeView({ keys: w.keys }), counts = createCounts(view);
  const back = arenaOfWorld({ store: view, counts, root: w.root, D: w.D, name: w.name }, colourOf(w.colour, { store: view, counts, D: w.D })).A, t3 = performance.now();
  for (let i = 0; i < A.cells.length; i++) if (A.cells[i] !== back.cells[i]) throw new Error(`the ${size} arena came back different at cell ${i}`);
  console.log(`| ${size} × ${A.Y} × ${size} | ${w.D} | ${fmt(w.nodes)} | ${(bytes.length / 1048576).toFixed(1)} MB | ${ms(t1 - t0)} | ${ms(t2 - t1)} | ${ms(t3 - t2)} |`);
}
