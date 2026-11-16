/* make-worlds.mjs — world files with named colour for the C++ proof of
   concept, written by the repo's own builders and writeVdag, into
   cpp/poc/worlds/ (gitignored):

     dungeon-d10.vdag   dungeonDesc({ D: 10, floors: 4 }), seed 1: the viewer's default
     dungeon-d12.vdag   D = 12, 8 floors
     kit-d12.vdag       kitDesc({ D: 12 }), seed 1
     scatter-d10.vdag   scatterDesc({ D: 10 }), seed 1, on today's 8-voxel crust

   Each carries its descriptor (and table, for the dungeon and the scatter) as
   its colour, a print of the field, and the stream viewer's opening view, so
   vdagview opens where the browser would.

     node cpp/poc/bench/make-worlds.mjs           (~15 s) */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../../..'), OUT = path.resolve(HERE, '../worlds');
const mod = f => import(path.join(ROOT, f));
const { writeVdag } = await mod('vdag-core.js');
const { colourOf } = await mod('colours.js');
const { dungeonDesc, dungeonPlan, buildDungeon, dungeonInfo } = await mod('dungeon-core.js');
const { kitDesc, buildKit } = await mod('kit-core.js');
const { scatterDesc, buildScatter } = await mod('scatter-core.js');
const { SHAPES } = await mod('experiments/shapes.mjs');
await mkdir(OUT, { recursive: true });

async function save(name, store, root, D, colour, view){
  const t = performance.now();
  const bytes = await writeVdag([{ keys: store.snapshot().keys, root, D, name, colour, view }], { colourOf });
  await writeFile(path.join(OUT, `${name}.vdag`), bytes);
  console.log(`${name}.vdag  ${(bytes.length / 1024).toFixed(0)} KB, ${store.size} nodes (written in ${(performance.now() - t).toFixed(0)} ms)`);
}

for (const [D, floors] of [[10, 4], [12, 8]]){
  const desc = dungeonDesc({ D, floors, seed: 1 }), plan = dungeonPlan(desc), { store, root } = buildDungeon(desc, { plan });
  await save(`dungeon-d${D}`, store, root, D, { ...desc, table: Int32Array.from(plan.codes) }, dungeonInfo(plan).view);
}
{
  const desc = kitDesc({ D: 12 }), { store, root } = buildKit(desc), s = 2 ** 12;
  await save('kit-d12', store, root, 12, desc, { eye: [-0.35 * s, 0.9 * s, -0.45 * s], yaw: 0.68, pitch: -0.5 });
}
{
  const desc = scatterDesc({ D: 10 }), { store, root, table } = buildScatter(desc), s = 2 ** 10;
  // The viewer's: a couple of specimen heights over the ground near one edge, looking across.
  const hills = SHAPES.find(x => x.name === 'hills'), x = 0.5 * s, z = 0.03 * s;
  const top = (hills.height(2 * x / s - 1, 2 * z / s - 1) + 1) * s / 2;
  await save('scatter-d10', store, root, 10, { kind: 'scatter', ...desc, table }, { eye: [x, top + 160, z], yaw: 0, pitch: -0.16 });
}
