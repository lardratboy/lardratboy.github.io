/* Step 5's Node numbers (docs/scene-plan.md §2, docs/scene-log.md §5): the knight
   dropped into the D = 14 kit the way the viewer drops it, without the viewer.
   The aim is edit-core's pick straight down at a spot, the landing scene-core's
   dropAt and snapRef, the bake the scene log's drop: the page's path, call for
   call, on a real store holding the kit's pruned keys as themselves.

     node experiments/scene-try.mjs            ~1 min, prints only
     SCENE_FILES=a.vdag,b.vdag                 other children (the first is "the D = 8 one")

   What it prints:
     a. one drop of each kind into a fresh kit: bake ms, the store's growth, the
        root's growth (nodes reachable from the new root less the old root's: what
        a file would hold), the place memo's growth, and the paint (level-6 blocks,
        the chunks a flip repaints at lod 0);
     b. a session: N drops at hashed spots all over the kit, snap 16 against the
        voxel snap, upright and with the four turns: what a copy costs when y is
        wherever the roof is, and how large the place memo gets.
   The knight's files are worlds/scene/knight-d8.vdag and -d10.vdag (see
   test/browser/scene-shots.mjs for the command that makes them). It measures
   times, so run it on an idle machine. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, prune, storeView, createCounts, createClasses, OH48 } from '../dag-core.js';
import { createTailer } from '../stream-core.js';
import { kitDesc, buildKit } from '../kit-core.js';
import { pick } from '../edit-core.js';
import { readVdag } from '../vdag-core.js';
import { createSceneLog, childFrame, dropAt, snapRef, Y_TURNS, placeMemoSize } from '../scene-core.js';
import { mix } from '../actor-core.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = (process.env.SCENE_FILES || 'worlds/scene/knight-d8.vdag,worlds/scene/knight-d10.vdag').split(',');
const D = +(process.argv.find(a => a.startsWith('--D='))?.slice(4) ?? 14), SIDE = 2 ** D;
const N = +(process.argv.find(a => a.startsWith('--n='))?.slice(4) ?? 48);

const children = [];
for (const f of FILES){
  const file = path.join(ROOT, f);
  if (!fs.existsSync(file)){ console.error(`no ${f}: see test/browser/scene-shots.mjs for how it's made`); process.exit(1); }
  const { worlds: [w] } = await readVdag(fs.readFileSync(file));
  const baked = w.colour?.kind === 'baked';
  // As the page's childOf makes a shelf entry a child.
  children.push({ store: storeView({ keys: w.keys }), root: w.root, D: w.D, colour: w.colour ?? null, ...(baked ? { skin: w.colour.skin } : {}), name: path.basename(f) });
}

const t0 = performance.now(), kit = buildKit(kitDesc({ D })), kitKeys = prune(kit.store.snapshot().keys, [kit.root]);
console.log(`kit D = ${D}: ${kitKeys.keys.length / 9} nodes, built in ${(performance.now() - t0).toFixed(0)} ms`);
const freshKit = () => {
  const store = createStore(), root = store.importKeys(kitKeys.keys)[kitKeys.map[kit.root]];
  return { store, root };
};
const reach = (store, root) => prune(store.snapshot().keys, [root]).keys.length / 9;

/* One drop as the page's dropAim + editStep make it: pick down at (x, z), the box
   against the face, the snap relative to the first live copy. */
function drop(S, log, world, x, z, { turn = 0, scale = 0, grid = 16 } = {}){
  const hit = pick(S.store, log.root, D, [x + 0.5, SIDE - 0.5, z + 0.5], [0, -1, 0]);
  if (!hit) return null;
  const T = Y_TURNS[turn], f = childFrame({ world, at: [0, 0, 0], turn: T, scale });
  const ref = grid > 1 ? snapRef(log.placements(), world, T, scale) : null;
  const at = dropAt(hit, { lo: f.lo, hi: f.hi }, { grid, ref });
  if (!at) return null;       // the column reaches the world's top: no face from above
  const n0 = S.store.size, m0 = placeMemoSize(S.store), r0 = log.root, t = performance.now();
  const step = log.drop(S.store, D, { world, at, turn: T, scale });
  const ms = performance.now() - t;
  if (!step) return null;
  return { at, ms, store: S.store.size - n0, memo: placeMemoSize(S.store) - m0, paint: step.paint.length, r0, snapped: !!ref };
}
const SCALE = ['¼', '½', '1', '×2', '×4'];
const fmt = n => n.toLocaleString('en-US');

/* ---- a. one drop of each kind ---------------------------------------------------- */
{
  console.log('\na. One drop into a fresh kit, then a second copy\n');
  console.log('| child | scale | turn | height | bake ms | store + | root + | memo + | paint | tail ms, with poses | counts only | second copy, snap 16: ms | root + | second, voxel snap: ms | root + |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  // The courtyard of the shots at D = 14, the same fraction of the side elsewhere.
  const X = Math.round(7650 * SIDE / 16384), Z = Math.round(3550 * SIDE / 16384);
  const cases = [];
  for (const scale of [-1, 0, 1]) cases.push([0, scale, 0]);
  cases.push([0, 0, 1]);
  if (children[1]) for (const scale of [-2, -1, 0]) cases.push([1, scale, 0]);
  for (const [c, scale, turn] of cases){
    const world = children[c];
    if (world.D + scale > D) continue;
    const row = [];
    for (const grid of [16, 1]){
      const S = freshKit(), log = createSceneLog(S.root);
      // The page's tailer for the kit: counts and poses of the new nodes, and the
      // drop. Its time is most of what the HUD calls setRoot. Made before the drop,
      // as the page's is made with the snapshot, so the kit's own nodes aren't in it.
      const counts = createCounts(S.store), classes = createClasses(S.store, OH48), tail = createTailer(S.store, { counts, classes, scene: log });
      const plain = createTailer(S.store, { counts: createCounts(S.store) });
      tail(); plain();
      const a = drop(S, log, world, X, Z, { turn, scale, grid });
      let tPlain = performance.now(); plain(); tPlain = performance.now() - tPlain;
      let tTail = performance.now(); tail(); tTail = performance.now() - tTail;
      if (!a){ row.push(world.name, SCALE[scale + 2], turn, 'no landing'); break; }
      const ra = reach(S.store, log.root) - reach(S.store, a.r0);
      // The second copy a knight's width and a bit along x: 7 off the 16 grid, so
      // the voxel snap leaves it there and the 16 snap moves it on.
      const f = childFrame({ world, at: [0, 0, 0], turn: Y_TURNS[turn], scale });
      const b = drop(S, log, world, X + (f.hi[0] - f.lo[0]) + 23, Z, { turn, scale, grid });
      const rb = b ? reach(S.store, log.root) - reach(S.store, b.r0) : NaN;
      if (grid === 16) row.push(world.name, SCALE[scale + 2], turn, f.hi[1] - f.lo[1], a.ms.toFixed(0), fmt(a.store), fmt(ra), fmt(a.memo), a.paint, tTail.toFixed(0), tPlain.toFixed(0));
      row.push(b ? b.ms.toFixed(0) : '–', b ? `${fmt(rb)} (${(100 * rb / ra).toFixed(0)}%)` : '–');
    }
    console.log(`| ${row.join(' | ')} |`);
  }
}

/* ---- b. a session ----------------------------------------------------------------- */
{
  console.log(`\nb. A session: ${N} drops of ${children[0].name} at hashed spots over the whole kit\n`);
  console.log('| snap | turns | landed | bake ms, all | median | worst | store + | root + | a copy, of the first | place memo | heights mod 16 |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  const world = children[0];
  let first = null;
  for (const [grid, turns] of [[16, 1], [1, 1], [16, 4], [1, 4]]){
    const S = freshKit(), log = createSceneLog(S.root), n0 = S.store.size, r0 = reach(S.store, S.root), ms = [], ys = new Set();
    for (let i = 0; i < N; i++){
      const x = 300 + mix(7, i, 1) % (SIDE - 600), z = 300 + mix(7, i, 2) % (SIDE - 600);
      const r = drop(S, log, world, x, z, { turn: turns > 1 ? mix(7, i, 3) % turns : 0, grid });
      if (!r) continue;
      ms.push(r.ms); ys.add((r.at[1] % 16 + 16) % 16);
      if (first === null) first = reach(S.store, log.root) - r0;
    }
    const sorted = [...ms].sort((a, b) => a - b), grown = reach(S.store, log.root) - r0;
    console.log(`| ${grid === 16 ? '16' : 'voxel'} | ${turns === 1 ? 'upright' : 'four about y'} | ${ms.length} | ${ms.reduce((a, b) => a + b, 0).toFixed(0)} | ${sorted[sorted.length >> 1].toFixed(0)} | ${sorted[sorted.length - 1].toFixed(0)} | ` +
                `${fmt(S.store.size - n0)} | ${fmt(grown)} | ${(100 * grown / ms.length / first).toFixed(0)}% | ${fmt(placeMemoSize(S.store))} | ${ys.size} |`);
  }
}
