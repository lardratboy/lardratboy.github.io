/* docs/vdagplacement.md's numbers: dropping a world file into worlds other than
   the kit (hills, the scatter, flat ground), and turning it more ways than about y.
   A sketch, not the engine: it prints, writes nothing, and has no tests of its
   own. Everything it calls is scene-core's, scatter-core's and edit-core's,
   unchanged.

     node experiments/placement-sketch.mjs                 ~2 min (a and b at D = 10, 11)
     node --max-old-space-size=8192 experiments/placement-sketch.mjs --only=ab --D=12
                                                           the D = 12 scatter (~2 min; run
                                                           with that heap, not tried without)
     --only=abcde                                     pick sections

   a. THE SCATTER AS A SCENE. The scatter world built its own way (rotateOcc,
      restingY, splitBlocks, graft), then the same world as hills plus one
      placement a specimen through bakeScene, from the scatter's own table. The
      two roots must be the same id in one store. That's the check; the times
      say what each way costs.
   b. A REAL STORE for a world the workers built: the pruned keys imported into a
      createStore, as the kit's are at install. Each node must keep its id.
   c. WHERE A DROP LANDS. Aims as a flying eye makes them, through pick and
      dropAt: which face is hit, how far the landing moves when the crosshair
      moves one pixel, and how much of the child ends up inside the ground.
      On hills, against the scatter's own rule (restingY).
   d. WHAT A DROP COSTS in each parent, by the page's path (scene-try.mjs's).
   e. THE 24 TURNS: each one dropped on flat ground, and the turns sorted by
      where they send the child's underside.

   The child is the knight (worlds/scene/knight-d8.vdag, made by mesh-vdag.mjs;
   see test/browser/scene-shots.mjs) when it's there, and a specimen always.
   It measures times, so run it on an idle machine. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, prune, storeView, createCounts, createClasses, OH48, applyG, MUL } from '../dag-core.js';
import { createSpecimenCore, sampleRecipe, binaryLevels } from '../specimen-core.js';
import { scatterDesc, buildScatter, groundOf, rotateOcc, restingY, TABLE_WORDS, PROPER } from '../scatter-core.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { kitDesc, buildKit } from '../kit-core.js';
import { clayDesc, buildClay } from '../clay-core.js';
import { createTailer } from '../stream-core.js';
import { pick } from '../edit-core.js';
import { readVdag } from '../vdag-core.js';
import { bakeScene, prepared, createSceneLog, childFrame, dropAt, snapRef, Y_TURNS, placeMemoSize } from '../scene-core.js';
import { mix } from '../actor-core.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const ONLY = arg('only') ?? 'abcde', DS = (arg('D') ?? '10,11').split(',').map(Number);
const fmt = n => Math.round(n).toLocaleString('en-US');
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const reach = (store, root) => prune(store.snapshot().keys, [root]).keys.length / 9;
const now = () => performance.now();

/* ---- the children ------------------------------------------------------------- */
const core = createSpecimenCore(), LEVELS = binaryLevels(6);
const specimenOcc = n => { const r = sampleRecipe(core, n, LEVELS); return core.buildBlock(r.P, r.levels).occ; };
// One store a specimen, as a shelf entry has its own keys.
const specimenWorld = (n, occ = specimenOcc(n)) => { const store = createStore(); return { store, root: store.fromDense(occ, 64).root, D: 6, name: `specimen ${n}` }; };
let knight = null;
{ const f = path.join(ROOT, 'worlds/scene/knight-d8.vdag');
  if (fs.existsSync(f)){
    const { worlds: [w] } = await readVdag(fs.readFileSync(f)), baked = w.colour?.kind === 'baked';
    knight = { store: storeView({ keys: w.keys }), root: w.root, D: w.D, colour: w.colour ?? null, ...(baked ? { skin: w.colour.skin } : {}), name: 'knight (D = 8)' };
  } else console.log('no worlds/scene/knight-d8.vdag: the knight\'s rows are left out (test/browser/scene-shots.mjs says how it\'s made)'); }

/* ---- the parents: pruned keys, imported fresh for each use ----------------------- */
const parents = new Map();
function parentOf(name){
  if (parents.has(name)) return parents.get(name);
  let w, classes = false;
  if (name === 'hills'){ const store = createStore(), D = 10; w = { store, root: store.fromField(D, fieldOf(SHAPES.find(s => s.name === 'hills'), D)).root, D }; classes = true; }
  else if (name === 'scatter') w = buildScatter(scatterDesc({ D: 10 }));
  else if (name === 'kit'){ w = buildKit(kitDesc({ D: 12 })); classes = true; }
  else if (name === 'flat') w = buildClay(clayDesc({ D: 20, lump: 0, ground: true }));
  const { keys, map } = prune(w.store.snapshot().keys, [w.root]);
  const P = { name, D: w.D, side: 2 ** w.D, keys, root: map[w.root], classes };
  parents.set(name, P);
  return P;
}
const LABEL = { hills: 'hills, D = 10', scatter: 'scatter, D = 10', kit: 'kit, D = 12', flat: 'flat ground, D = 20' };
const fresh = P => { const store = createStore(), ids = store.importKeys(P.keys); return { store, root: ids[P.root], D: P.D, side: P.side }; };

/* ---- a, b: the scatter as a scene, and its real store ------------------------------ */
if (/[ab]/.test(ONLY)){
  const rowsA = [], rowsB = [];
  for (const D of DS){
    const desc = scatterDesc({ D }), w = buildScatter(desc), N = w.layout.cells.length;
    if (ONLY.includes('a')){
      const S = createStore();
      let t = now();
      const ground = S.fromField(D, groundOf(desc).field).root, groundMs = now() - t;
      t = now();
      const placements = [];
      for (let c = 0; c < N; c++){
        const o = TABLE_WORDS * c, n = w.table[o];
        placements.push({ world: specimenWorld(n), at: [w.table[o + 2], w.table[o + 3], w.table[o + 4]], turn: w.table[o + 1], scale: 0 });
      }
      const childMs = now() - t;
      t = now();
      const baked = bakeScene(S, ground, D, placements), bakeMs = now() - t;
      const raw = S.size, memo = placeMemoSize(S), nodes = reach(S, baked);
      // The scatter's own root in this store: equal content has to be the equal id.
      const same = S.importKeys(w.store.snapshot().keys)[w.root] === baked;
      if (!same) throw new Error(`D = ${D}: the baked scene isn't the scatter world`);
      rowsA.push(`| ${D} | ${fmt(N)} | ${fmt(w.ms.place)} | ${fmt(w.ms.graft)} | ${fmt(w.ms.prune)} | ${fmt(childMs)} | ${fmt(bakeMs)} | ${(bakeMs / N).toFixed(1)} | ${fmt(raw)} | ${fmt(nodes)} | ${fmt(w.nodes)} | ${fmt(memo)} | the same id |`);
    }
    if (ONLY.includes('b')){
      const keys = w.store.snapshot().keys, n = keys.length / 9;
      let t = now();
      const real = createStore(), ids = real.importKeys(keys), ms = now() - t;
      let moved = 0;
      for (let i = 0; i < ids.length; i++) if (ids[i] !== i) moved++;
      if (moved) throw new Error(`D = ${D}: ${moved} ids moved in the import`);
      t = now();
      createCounts(real);
      const countMs = now() - t;
      rowsB.push(`| scatter, D = ${D} | ${fmt(n)} | ${fmt(ms)} | ${(1e6 * ms / n).toFixed(0)} | ${(keys.byteLength / 2 ** 20).toFixed(1)} | ${fmt(countMs)} | every id kept |`);
    }
  }
  if (rowsA.length){
    console.log('\na. The scatter world as hills plus one placement a specimen (one thread)\n');
    console.log('| D | specimens | its own way: pass B ms | graft ms | prune ms | as a scene: children ms (generate + fromDense) | bakeScene ms | a specimen | store after | reachable | the scatter\'s nodes | place memo | root |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |');
    console.log(rowsA.join('\n'));
  }
  if (rowsB.length){
    console.log('\nb. A real store from a worker-built world\'s pruned keys (createStore + importKeys)\n');
    console.log('| world | nodes | import ms | ns a node | keys MB | counts again ms | ids |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: | --- |');
    console.log(rowsB.join('\n'));
  }
}

/* ---- c. where a drop lands ---------------------------------------------------------
   An eye 40 to 200 voxels over the surface, looking down at a pitch, any yaw:
   the page's fwd(). PIXEL is one pixel of a window 1,000 high (the viewer's
   half-fov tangent is tan 0.45). Voxel snap, so the snap's own moves aren't in
   it. "Buried" is the share of the child's voxels that were solid already:
   child + world − union, by counts. */
const PIXEL = 2 * Math.tan(0.45) / 1000;
const fwdOf = (yaw, pitch) => [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
if (ONLY.includes('c')){
  console.log('\nc. Where a drop lands (dropAt, the voxel snap), by parent and pitch\n');
  console.log('| parent | child | pitch | aims | on a top face | on a side face | from under | next pixel: another face | lands > 4 voxels away | > a quarter of the box | largest move | buried, top face (median) | buried, side face (median) |');
  console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  const kids = [specimenWorld(0), ...(knight ? [knight] : [])];
  for (const name of ['flat', 'hills', 'kit']){
    const P = parentOf(name), S = fresh(P), counts = createCounts(S.store);
    for (const world of kids){
      const f = childFrame({ world, at: [0, 0, 0], turn: 0, scale: 0 }), box = { lo: f.lo, hi: f.hi };
      const size = box.hi.map((v, i) => v - box.lo[i]), quarter = Math.min(...size) / 4;
      const T = prepared(S.store, { world, turn: 0, scale: 0 });
      counts.update();
      const childVox = counts.of(T.id);
      for (const deg of [-60, -30, -15]){
        const N = 1500, pitch = deg * Math.PI / 180;
        let aims = 0, top = 0, side = 0, under = 0, flips = 0, far4 = 0, farQ = 0, worst = 0, pairs = 0;
        const buriedTop = [], buriedSide = [];
        for (let i = 0; i < N; i++){
          const x = Math.floor(P.side * (0.25 + 0.5 * (mix(11, i, 1) % 4096) / 4096)), z = Math.floor(P.side * (0.25 + 0.5 * (mix(11, i, 2) % 4096) / 4096));
          const down = pick(S.store, S.root, P.D, [x + 0.5, P.side - 0.5, z + 0.5], [0, -1, 0]);
          if (!down) continue;
          const eye = [x + 0.5, down.y + 1 + 40 + mix(11, i, 3) % 160, z + 0.5], yaw = 2 * Math.PI * (mix(11, i, 4) % 4096) / 4096;
          if (eye[1] >= P.side) continue;
          const hit = pick(S.store, S.root, P.D, eye, fwdOf(yaw, pitch));
          if (!hit || hit.axis < 0) continue;
          const at = dropAt(hit, box);
          aims++;
          const kind = hit.axis !== 1 ? 'side' : hit.normal > 0 ? 'top' : 'under';
          if (kind === 'top') top++; else if (kind === 'side') side++; else under++;
          // The pixel to the right and the pixel above.
          for (const [dy, dp] of [[PIXEL / Math.cos(pitch), 0], [0, PIXEL]]){
            const h2 = pick(S.store, S.root, P.D, eye, fwdOf(yaw + dy, pitch + dp));
            if (!h2 || h2.axis < 0) continue;
            const at2 = dropAt(h2, box), move = Math.max(...at.map((v, k) => Math.abs(v - at2[k])));
            pairs++;
            if (h2.axis !== hit.axis || h2.normal !== hit.normal) flips++;
            if (move > 4) far4++;
            if (move > quarter) farQ++;
            worst = Math.max(worst, move);
          }
          // Buried: on a sample, since each one is a bake.
          if (i % 25 === 0 && kind !== 'under' && at.every((v, k) => v >= 0 && v + 2 ** world.D <= P.side)){
            const r2 = bakeScene(S.store, S.root, P.D, [{ world, at, turn: 0, scale: 0 }]);
            counts.update();
            (kind === 'top' ? buriedTop : buriedSide).push(100 * (childVox + counts.of(S.root) - counts.of(r2)) / childVox);
          }
        }
        const pc = (a, b) => b ? `${(100 * a / b).toFixed(a && a / b < 0.01 ? 1 : 0)}%` : '–', b = a => a.length ? `${median(a).toFixed(0)}% (${a.length})` : '–';
        console.log(`| ${LABEL[name]} | ${world.name}, ${size.join(' × ')} | ${deg}° | ${aims} | ${pc(top, aims)} | ${pc(side, aims)} | ${pc(under, aims)} | ${pc(flips, pairs)} | ${pc(far4, pairs)} | ${pc(farQ, pairs)} | ${worst} | ${b(buriedTop)} | ${b(buriedSide)} |`);
      }
    }
  }

  /* On hills, dropAt against the scatter's rule. restingY is the lowest y at which
     no voxel of the specimen is in the ground. "Lift" is how far above dropAt's y
     that is; "buried" at dropAt's y is counted on the dense specimen against the
     ground's top voxel, a second way to the counts above. What resting leaves
     open on the downhill side is docs/scatter-results.md §3's overhang. */
  console.log('\nc2. On hills (D = 10): dropAt against the scatter\'s resting rule, 12 specimens\n');
  console.log('| face hit | drops | dropAt buries (median) | p90 | worst | resting lifts it by (median, voxels) | p90 | worst |');
  console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  { const P = parentOf('hills'), S = fresh(P), desc = scatterDesc({ D: 10 }), top = groundOf(desc).top, R = 64;
    const out = { top: { buried: [], lift: [] }, side: { buried: [], lift: [] } };
    for (let s = 0; s < 12; s++){
      const occ = specimenOcc(s), world = specimenWorld(s, occ), f = childFrame({ world, at: [0, 0, 0], turn: 0, scale: 0 }), box = { lo: f.lo, hi: f.hi };
      let vox = 0;
      for (let i = 0; i < occ.length; i++) vox += occ[i];
      for (let i = 0; i < 60; i++){
        const x = Math.floor(P.side * (0.2 + 0.6 * (mix(13, s, i, 1) % 4096) / 4096)), z = Math.floor(P.side * (0.2 + 0.6 * (mix(13, s, i, 2) % 4096) / 4096));
        const eye = [x + 0.5, top(x, z) + 1 + 60 + mix(13, s, i, 3) % 100, z + 0.5];
        const hit = pick(S.store, S.root, P.D, eye, fwdOf(2 * Math.PI * (mix(13, s, i, 4) % 4096) / 4096, -(15 + mix(13, s, i, 5) % 45) * Math.PI / 180));
        if (!hit || hit.axis < 0 || (hit.axis === 1 && hit.normal < 0)) continue;
        const at = dropAt(hit, box);
        if (at.some((v, k) => v < 0 || v + R > P.side)) continue;
        let buried = 0;
        for (let zz = 0, k = 0; zz < R; zz++) for (let yy = 0; yy < R; yy++) for (let xx = 0; xx < R; xx++, k++)
          if (occ[k] && at[1] + yy <= top(at[0] + xx, at[2] + zz)) buried++;
        const yRest = restingY(occ, R, at[0], at[2], top);
        const o = out[hit.axis === 1 ? 'top' : 'side'];
        o.buried.push(100 * buried / vox); o.lift.push(yRest - at[1]);
      }
    }
    const p = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
    for (const k of ['top', 'side']){
      const o = out[k];
      console.log(`| ${k} | ${o.buried.length} | ${p(o.buried, 0.5).toFixed(0)}% | ${p(o.buried, 0.9).toFixed(0)}% | ${p(o.buried, 1).toFixed(0)}% | ${p(o.lift, 0.5)} | ${p(o.lift, 0.9)} | ${p(o.lift, 1)} |`);
    }
  }
}

/* ---- d. what a drop costs, by parent ------------------------------------------------
   scene-try.mjs's drop: pick straight down, dropAt, the snap relative to the first
   live copy, the scene log. The tail is the page's: counts, and poses where the
   page keeps them (the shapes and the kit; the scatter and clay are poseless). */
function drop(S, log, world, x, z, { turn = 0, scale = 0, grid = 16 } = {}){
  const hit = pick(S.store, log.root, S.D, [x + 0.5, S.side - 0.5, z + 0.5], [0, -1, 0]);
  if (!hit) return null;
  const f = childFrame({ world, at: [0, 0, 0], turn, scale });
  const ref = grid > 1 ? snapRef(log.placements(), world, turn, scale) : null;
  const at = dropAt(hit, { lo: f.lo, hi: f.hi }, { grid, ref });
  if (!at) return null;
  const n0 = S.store.size, r0 = log.root, t = now();
  const step = log.drop(S.store, S.D, { world, at, turn, scale });
  const ms = now() - t;
  return step ? { at, ms, store: S.store.size - n0, paint: step.paint.length, r0, f } : null;
}
if (ONLY.includes('d')){
  console.log('\nd. One drop, then a second copy, by parent (the page\'s path; the 16 snap)\n');
  console.log('| parent | nodes | child | bake ms | store + | root + | paint | tail ms | poses in it | second copy: ms | root + | third, on the voxel snap: ms | root + |');
  console.log('| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |');
  for (const name of ['flat', 'hills', 'scatter', 'kit']){
    const P = parentOf(name);
    for (const world of [specimenWorld(0), ...(knight ? [knight] : [])]){
      const S = fresh(P), log = createSceneLog(S.root), counts = createCounts(S.store), classes = P.classes ? createClasses(S.store, OH48) : null;
      const tail = createTailer(S.store, { counts, classes, scene: log });
      tail();
      const X = Math.floor(P.side * 0.47), Z = Math.floor(P.side * 0.22);
      const a = drop(S, log, world, X, Z);
      if (!a){ console.log(`| ${LABEL[name]} | ${fmt(P.keys.length / 9)} | ${world.name} | no landing |`); continue; }
      let tTail = now(); tail(); tTail = now() - tTail;
      const ra = reach(S.store, log.root) - reach(S.store, a.r0), w = a.f.hi[0] - a.f.lo[0];
      const b = drop(S, log, world, X + w + 23, Z), rb = b ? reach(S.store, log.root) - reach(S.store, b.r0) : NaN;
      const c = drop(S, log, world, X + 2 * (w + 23) + 5, Z, { grid: 1 }), rc = c ? reach(S.store, log.root) - reach(S.store, c.r0) : NaN;
      const pc = r => `${fmt(r)} (${(100 * r / ra).toFixed(0)}%)`;
      console.log(`| ${LABEL[name]} | ${fmt(P.keys.length / 9)} | ${world.name} | ${a.ms.toFixed(1)} | ${fmt(a.store)} | ${fmt(ra)} | ${a.paint} | ${tTail.toFixed(1)} | ${classes ? 'yes' : 'no'} | ${b ? b.ms.toFixed(1) : '–'} | ${b ? pc(rb) : '–'} | ${c ? c.ms.toFixed(1) : '–'} | ${c ? pc(rc) : '–'} |`);
    }
  }
}

/* ---- e. the 24 turns ---------------------------------------------------------------- */
if (ONLY.includes('e')){
  // Where each proper turn sends the child's underside (−y), and the four of each.
  const NAMES = { '0,-1,0': '−y (stands)', '0,1,0': '+y (hangs from a ceiling)', '-1,0,0': '−x', '1,0,0': '+x', '0,0,-1': '−z', '0,0,1': '+z' };
  const groups = new Map();
  for (const e of PROPER){
    const k = applyG([0, -1, 0], e).map(v => v + 0).join();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  console.log('\ne. The 24 proper turns, by where the child\'s underside goes\n');
  console.log('| underside toward | the four turns (dag-core\'s Oh encoding) | is a coset of the y turns |');
  console.log('| --- | --- | --- |');
  for (const [k, es] of groups){
    // e·Y for the four spins about the child's own y: the same down, four headings.
    const coset = Y_TURNS.map(y => MUL[es[0] * 48 + y]).sort((a, b) => a - b).join() === [...es].sort((a, b) => a - b).join();
    console.log(`| ${NAMES[k]} | ${es.join(', ')} | ${coset ? 'yes' : 'NO'} |`);
  }
  if (groups.size !== 6 || [...groups.values()].some(g => g.length !== 4)) throw new Error('the 24 turns aren\'t six downs of four spins');
  // Quarter turns about the world's axes, as elements, and that they generate all 24.
  const quarter = axis => PROPER.find(e => { const v = [0, 0, 0]; v[axis] = 1; const a = applyG(v, e), o = [0, 0, 0]; o[(axis + 1) % 3] = 1; const b = applyG(o, e);
    return a[axis] === 1 && b[(axis + 2) % 3] === 1; });
  const gens = [0, 1, 2].map(quarter), seen = new Set([0]);
  for (let grew = true; grew;){ grew = false; for (const e of [...seen]) for (const g of gens){ const n = MUL[g * 48 + e]; if (!seen.has(n)){ seen.add(n); grew = true; } } }
  console.log(`\nquarter turns about x, y, z: elements ${gens.join(', ')}; composed (MUL) they reach ${seen.size} turns; Y_TURNS = ${Y_TURNS.join(', ')}`);

  for (const world of [specimenWorld(0), ...(knight ? [knight] : [])]){
    const P = parentOf('flat'), S = fresh(P), log = createSceneLog(S.root);
    const X0 = P.side / 2 - 6000, Z0 = P.side / 2;
    const rows = [];
    let k = 0;
    for (const [key, es] of groups) for (const e of es){
      const a = drop(S, log, world, X0 + 500 * (k++), Z0, { turn: e });
      const ra = reach(S.store, log.root) - reach(S.store, a.r0);
      const b = drop(S, log, world, X0 + 500 * (k - 1), Z0 + 400, { turn: e });
      rows.push({ e, key, ms: a.ms, store: a.store, root: ra, ms2: b.ms, size: a.f.hi.map((v, i) => v - a.f.lo[i]), y: Y_TURNS.includes(e) });
    }
    const sum = (rs, f) => rs.reduce((s, r) => s + f(r), 0), ys = rows.filter(r => r.y), first = rows.find(r => r.e === 0);
    console.log(`\n${world.name} on flat ground (D = 20), each turn dropped once, then a second copy 400 over (snapped)\n`);
    console.log('| turns | bake ms, all | store + | root + | a turn, of the upright one\'s root + | second copies: ms, all |');
    console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
    console.log(`| upright alone | ${first.ms.toFixed(0)} | ${fmt(first.store)} | ${fmt(first.root)} | 100% | ${first.ms2.toFixed(1)} |`);
    console.log(`| the four about y | ${sum(ys, r => r.ms).toFixed(0)} | ${fmt(sum(ys, r => r.store))} | ${fmt(sum(ys, r => r.root))} | ${(100 * sum(ys, r => r.root) / 4 / first.root).toFixed(0)}% | ${sum(ys, r => r.ms2).toFixed(1)} |`);
    console.log(`| all 24 | ${sum(rows, r => r.ms).toFixed(0)} | ${fmt(sum(rows, r => r.store))} | ${fmt(sum(rows, r => r.root))} | ${(100 * sum(rows, r => r.root) / 24 / first.root).toFixed(0)}% | ${sum(rows, r => r.ms2).toFixed(1)} |`);
    const lying = rows.filter(r => r.key !== '0,-1,0' && r.key !== '0,1,0');
    console.log(`\nbox: upright ${first.size.join(' × ')}; on its side ${lying[0].size.join(' × ')} or ${lying.find(r => r.size.join() !== lying[0].size.join())?.size.join(' × ') ?? 'the same'}`);
  }
}
