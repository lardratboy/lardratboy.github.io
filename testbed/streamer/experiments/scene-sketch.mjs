/* A sketch for docs/scenegraph.md §9 and §11: worlds placed in a world, the
   knight in the kit (§10 Q1, "level design, knight in the kit world sounds
   awesome"). Nothing imports this, nothing is drawn.

   **Promoted** (2026-11-10, docs/scene-plan.md step 1): bakeScene,
   compositeWorld and their helpers are scene-core.js now, and section a's
   oracle is test/scene-core.test.js, with the mutants made from the core's
   text. This file imports them, and keeps its tables and its own dense
   stamp. The description below is the sketch's, and holds for the core.

   A *placement* is a child world (a store, a root, a depth) put into a
   parent: `at` (whole voxels of the parent, any integer, so it may hang off
   the parent's edge), `turn` (one of the 24 rotations, dag-core's Oh
   encoding, the turn rotateOcc and store.transform make), and `scale` (a
   power of two, 2^scale parent voxels a child voxel; negative is smaller,
   by the *any* rule: a parent voxel is solid when any child voxel under it
   is). Order: turn the child's cube about its centre, scale it, then move
   it. Turns and scales commute, so the order of those two doesn't matter.

   Two ways to put a placement in a world, which must agree:
     bake       the child's voxels merged into the parent's DAG (§10 Q2:
                static children are baked). bakeScene imports the child into
                the parent's store, lifts or coarsens it, turns it with
                store.transform, then places it top-down: a parent node that
                lands exactly on a child node *is* that node (so an aligned
                copy shares everything below its alignment, §3.1), and only
                the nodes cut by the offset are new. Then `union`.
     overlay    the parent's DAG untouched, the child asked in its own frame
                (compositeWorld): actor-core's three questions, solid, room
                and fill, answered by the parent and every child whose
                bounds meet the box. The turn costs nothing here: a box is
                mapped back through it, never the child through the turn.
   They share nothing but boxHits and the store's child(), so each holds the
   other: a baked scene must be the dense stamp's root id, and fliers on the
   overlay must move byte for byte as on the bake.

   Sections:
     a. the oracle, D = 8: bakes against a dense stamp by root id (the
        knight, specimens and kit parts, every scale from −2 to +2, all 24
        turns, offsets that hang off every edge); the composite's solid and
        fill against the bake's on random boxes, its rooms empty in the bake;
        fliers on the composite (shuffled, rooms on and off) against the
        bake, byte for byte. (The mutants are the test's now.)
     b. baking the knight into the kit, D = 12: what one knight costs by
        where it lands (alignment, turn, scale), then 64 of them.
     c. colliding with overlays, D = 12: fliers round 16 knights, overlaid
        against baked (the same bytes, held again), µs a tick, probes by how
        many children they touch, the rooms' saving; then 256 children.
     d. a moving overlay: a knight walking through a flock a voxel at a
        time (§4.1 cases 1 and 2), rescues in its path, rooms lost.
   Not here: crews riding a moving world and fliers changing worlds (§10
   Q6), which need the world asked in 1/256 voxel (§11.4), and world against
   world (Q7, version 2).

   node experiments/scene-sketch.mjs                 everything (~2 min)
   node experiments/scene-sketch.mjs --only=ab       only those sections
   node experiments/scene-sketch.mjs --quick         fewer fliers and ticks (~1.5 min)
   node experiments/scene-sketch.mjs --knight=<file> another child world (a .vdag)
   The knight is test-3d-models/armored-knight-character's D = 8 file
   (gitignored: mesh-vdag.mjs makes it from the asset); without it a
   block-showroom specimen of R = 64 stands in, and the tables say so.
   Prints only. It measures times, so run it on an idle machine. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStore, prune, storeView, EMPTY } from '../dag-core.js';
import { kitDesc, buildKit, ornamentOcc, PART, Y_TURNS } from '../kit-core.js';
import { buildRecipe } from '../lattice-core.js';
import { rotateOcc, PROPER } from '../scatter-core.js';
import { dagWorld, createActors, spawnNear, tickFliers, restHits, rescue, FLIER, mix } from '../actor-core.js';
import { bakeScene, compositeWorld, prepared, contentBox, isSolidId } from '../scene-core.js';
import { readVdag } from '../vdag-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(HERE);
const arg = (name, d) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const only = arg('only', 'abcd'), quick = process.argv.includes('--quick');
const KNIGHT = arg('knight', path.join(ROOT, 'test-3d-models/armored-knight-character/armored-knight-character-d8.vdag'));
const fmt = (x, d = 2) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d }) : '-';
const pct = x => `${(100 * x).toFixed(x < 0.1 ? 1 : 0)}%`;
const say = s => console.log(s);
const row = cells => say('| ' + cells.join(' | ') + ' |');
const now = () => performance.now();
const rng = seed => () => (seed = mix(seed, 0x51ce)) / 2 ** 32;

const nodesOf = (store, root) => prune(store.snapshot().keys, [root]).keys.length / 9;

/* ---- the dense stamp ------------------------------------------------------------
   The oracle's own arithmetic, sharing nothing with the bake but rotateOcc:
   expand the child, turn it, scale it (repeat each voxel, or OR blocks for
   *any*), and OR it in at `at`, clipped. fromDense in the bake's store must
   then give the bake's root id. */
function expandOf(store, root, D){
  const R = 2 ** D, occ = new Uint8Array(R * R * R);
  const walk = (id, k, x, y, z) => {
    if (id === EMPTY) return;
    const s = 2 ** k;
    if (isSolidId(store, id)){
      for (let c = z; c < z + s; c++) for (let b = y; b < y + s; b++) occ.fill(1, x + R * (b + R * c), x + s + R * (b + R * c));
      return;
    }
    const h = s / 2;
    for (let o = 0; o < 8; o++) walk(store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
  };
  walk(root, D, 0, 0, 0);
  return occ;
}
function stampDense(occ, N, p){
  const { store, root, D } = p.world, s = p.scale ?? 0;
  let R = 2 ** D, c = rotateOcc(expandOf(store, root, D), R, p.turn ?? 0);
  if (s !== 0){
    const R2 = s > 0 ? R << s : R >> -s, c2 = new Uint8Array(R2 * R2 * R2);
    if (s > 0){ for (let z = 0; z < R2; z++) for (let y = 0; y < R2; y++) for (let x = 0; x < R2; x++) c2[x + R2 * (y + R2 * z)] = c[(x >> s) + R * ((y >> s) + R * (z >> s))]; }
    else { const t = -s; for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) if (c[x + R * (y + R * z)]) c2[(x >> t) + R2 * ((y >> t) + R2 * (z >> t))] = 1; }
    c = c2; R = R2;
  }
  for (let z = 0; z < R; z++){
    const Z = z + p.at[2]; if (Z < 0 || Z >= N) continue;
    for (let y = 0; y < R; y++){
      const Y = y + p.at[1]; if (Y < 0 || Y >= N) continue;
      for (let x = 0; x < R; x++){
        const X = x + p.at[0];
        if (X >= 0 && X < N && c[x + R * (y + R * z)]) occ[X + N * (Y + N * Z)] = 1;
      }
    }
  }
}

/* ---- fliers -------------------------------------------------------------------- */
const sizeOf = i => [2 + i % 5, 2 + (i >> 2) % 5, 2 + (i >> 4) % 5];
/* N fliers spawned round the given centres (one each, in turn), then T
   ticks; the order shuffled by `shuffle` (a seed) or in slot order. Returns
   a hash of every tick's bytes and the stats. */
function flight(world, centres, { N, T, radius = 48, shuffle = 0, rooms = true, stats = null, each = null }){
  const A = createActors(N), params = { ...FLIER, seed: 7 };
  for (let i = 0; i < N; i++) spawnNear(world, A, i, sizeOf(i), mix(3, i), centres[i % centres.length], radius, 64, 0);
  let h = 0;
  const order = Int32Array.from({ length: N }, (_, i) => i);
  for (let t = 0; t < T; t++){
    if (each) each(A, t);
    if (shuffle) for (let i = N - 1; i > 0; i--){ const j = mix(shuffle, t, i) % (i + 1); [order[i], order[j]] = [order[j], order[i]]; }
    tickFliers(each?.world ?? world, A, params, { order: shuffle ? order : null, rooms, stats });
    for (const arr of [A.pos, A.vel, A.epoch, A.until, A.alive]) for (let i = 0; i < arr.length; i++) h = mix(h, arr[i]);
  }
  return { hash: h, A };
}

/* ---- the child worlds ---------------------------------------------------------- */
async function knightWorld(){
  if (fs.existsSync(KNIGHT)){
    const { worlds: [w] } = await readVdag(fs.readFileSync(KNIGHT));
    return { name: 'knight', store: storeView({ keys: w.keys }), root: w.root, D: w.D };
  }
  const store = createStore(), occ = buildRecipe({ R: 64, seed: 1, axes: 'random' }, 0);
  return { name: 'specimen R = 64 (no knight file)', store, root: store.fromDense(occ, 64).root, D: 6 };
}
function denseChild(name, occ, R){
  const store = createStore();
  return { name, store, root: store.fromDense(occ, R).root, D: Math.log2(R) };
}
// R = 48 padded into 64, so its cube has a margin: the clip and the bounds differ.
function padded(occ, R, N){
  const out = new Uint8Array(N * N * N);
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) out[(x + 5) + N * ((y + 3) + N * (z + 7))] = occ[x + R * (y + R * z)];
  return out;
}

/* ================================================================================
   a. the oracle */
async function sectionA(knight){
  say('## a. The oracle (D = 8)\n');
  const t0 = now(), D = 8, N = 256;
  const spec = denseChild('specimen R = 48', padded(buildRecipe({ R: 48, seed: 1, axes: 'random' }, 2), 48, 64), 64);
  const orn = denseChild('ornament 16³', ornamentOcc(3), PART);
  const kn = knight.D <= 8 ? knight : null;
  const kit = buildKit(kitDesc({ D }));
  const r = rng(11);
  const randAt = (side, margin) => [0, 1, 2].map(() => Math.floor(r() * (N + 2 * margin - side)) - margin);
  const scenes = [];
  // The knight at every scale that fits, turned and off the grid.
  if (kn) for (const scale of [-2, -1, 0]) scenes.push([{ world: kn, at: scale === 0 ? [0, -6, 0] : randAt(2 ** (kn.D + scale), 8), turn: PROPER[(scale + 7) * 3 % 24], scale }]);
  // Every turn, specimens and ornaments at random scales and offsets, some off the world's edges.
  for (let k = 0; k < 24; k++){
    const list = [];
    for (let j = 0; j < 3; j++){
      const w = (k + j) % 2 ? spec : orn, scale = Math.floor(r() * 5) - 2, scaled = 2 ** (w.D + scale);
      if (scaled > N) continue;
      list.push({ world: w, at: randAt(scaled, scaled / 2), turn: PROPER[(k + 7 * j) % 24], scale });
    }
    // One aligned copy each time: the shared case.
    list.push({ world: orn, at: [64 * (k % 4), 128, 16 * (k % 16)], turn: PROPER[k], scale: 0 });
    scenes.push(list);
  }
  let bakes = 0, boxes = 0, fills = 0, rooms = 0;
  const failures = [];
  const checkScene = (placements, label, deep) => {
    const store = createStore(), base = store.importKeys(prune(kit.store.snapshot().keys, [kit.root]).keys)[kit.root];
    const baked = bakeScene(store, base, D, placements);
    const occ = expandOf(store, base, D);
    for (const p of placements) stampDense(occ, N, p);
    if (store.fromDense(occ, N).root !== baked){ failures.push(`${label}: the bake isn't the dense stamp`); return; }
    bakes++;
    const B = dagWorld(store, baked, D), C = compositeWorld({ store, root: base, D }, placements);
    const q = rng(mix(5, bakes)), lo = [0, 0, 0], hi = [0, 0, 0], out = new Int32Array(6);
    // Boxes round each child's bounds, half of them small, some off the world.
    for (let n = 0; n < (deep ? 4000 : 1500); n++){
      const c = C.kids[n % C.kids.length], big = q() < 0.5 ? 2 : 24;
      for (let a = 0; a < 3; a++){
        lo[a] = Math.floor(c.lo[a] - 8 + q() * (c.hi[a] - c.lo[a] + 16)) - (q() < 0.02 ? 300 : 0);
        hi[a] = lo[a] + 1 + Math.floor(q() * big);
      }
      if (C.solid(lo, hi) !== B.solid(lo, hi)){ failures.push(`${label}: solid(${lo}, ${hi}) differs`); return; }
      boxes++;
      // Fills before the rooms' `continue`: the first version had them after
      // it, so only clear boxes were filled, and the fill-unturned mutant lived.
      if (n % 10 === 0 && lo.every(v => v >= -4) && hi.every(v => v <= N + 4)){
        const f1 = C.fill(lo, hi), f2 = B.fill(lo, hi);
        if (f1.some((v, i) => v !== f2[i])){ failures.push(`${label}: fill differs`); return; }
        fills++;
      }
      // Rooms are asked for clear boxes inside the world, as a tick asks them.
      if (lo.some(v => v < 0) || hi.some(v => v > N) || B.solid(lo, hi)) continue;
      C.room(lo, hi, out, 0);
      if (out[0] <= out[3]){
        const rl = [out[0], out[1], out[2]], rh = [out[3], out[4], out[5]];
        if (B.solid(rl, rh) || lo.some((v, a) => v < rl[a] || hi[a] > rh[a])){ failures.push(`${label}: a room isn't empty, or doesn't hold its box (${lo}, ${hi} in ${rl}, ${rh})`); return; }
        rooms++;
      }
    }
    if (!deep) return;
    // Fliers: composite shuffled, rooms on and off, against the bake in slot order.
    const centres = C.kids.map(c => c.lo.map((v, a) => (v + c.hi[a]) >> 1));
    const F = { N: quick ? 40 : 100, T: quick ? 80 : 200 };
    const ref = flight(B, centres, F).hash;
    for (const [name, o] of [['shuffled', { shuffle: 9 }], ['no rooms', { rooms: false }], ['shuffled, no rooms', { shuffle: 4, rooms: false }]])
      if (flight(C, centres, { ...F, ...o }).hash !== ref){ failures.push(`${label}: fliers on the composite (${name}) differ from the bake`); return; }
  };
  scenes.forEach((s, i) => checkScene(s, `scene ${i}`, i < (kn ? 3 : 0) + 4));
  // The whole set in one scene: overlapping children, union for collision (§10 Q5).
  checkScene(scenes.flat().slice(0, 40), 'all at once', true);
  if (failures.length) throw new Error('scene sketch: the oracle failed:\n  ' + failures.join('\n  '));
  say(`Every bake equals the dense stamp by root id (${bakes} scenes: ${kn ? 'the knight at scales −2, −1 and 0 off the grid, ' : ''}specimens and ornaments in all 24 turns at scales −2 to +2, some hanging off the world's edges, and one scene of ${Math.min(40, scenes.flat().length)} overlapping children). ` +
      `The composite's answers equal the bake's on ${fmt(boxes)} boxes, ${fmt(fills)} fills and ${fmt(rooms)} rooms (each empty in the bake and holding its box). ` +
      `Fliers on the composite, shuffled and with rooms off, move byte for byte as on the bake. ${fmt((now() - t0) / 1000, 1)} s.\n`);

  // The mutants moved to test/scene-core.test.js with the core: made from its
  // text there, since the core has no switches.
  say('The mutants are test/scene-core.test.js\'s now (made from scene-core.js\'s text, all caught).');
  say('');
}

/* ================================================================================
   b. the knight baked into the kit */
/* Flat ground at depth D, solid for y < 4: the kit's ground without the kit,
   so a row there counts the knight's nodes and the ground's contact only. */
function flatGround(D){
  const store = createStore();
  const { root } = store.fromField(D, (k, x, y, z) => (y + 1) * 2 ** k <= 4 ? 1 : y * 2 ** k >= 4 ? 0 : -1);
  return { store, root, D };
}
function sectionB(knight, kit){
  const D = kit.D, side = 2 ** D;
  say(`## b. Baking the ${knight.name} into the kit (D = ${D})\n`);
  const kb = contentBox(knight.store, knight.root, knight.D), kNodes = nodesOf(knight.store, knight.root);
  const grounds = [['flat ground', flatGround(D)], ['the kit', kit]];
  const baseNodes = grounds.map(([, g]) => nodesOf(g.store, g.root));
  say(`The kit (\`kitDesc({ D: ${D} })\`) has ${fmt(baseNodes[1])} nodes, and flat ground (solid for y < 4, the kit's own ground without the kit) ${fmt(baseNodes[0])}. ` +
      `The ${knight.name} is D = ${knight.D}, ${fmt(kNodes)} nodes, ${kb.hi[0] - kb.lo[0]} × ${kb.hi[1] - kb.lo[1]} × ${kb.hi[2] - kb.lo[2]} voxels, its feet at y = ${kb.lo[1]} of its cube, so standing on the ground puts the cube at y = ${4 - kb.lo[1]}. ` +
      `Every bake starts from a fresh copy of the ground; *new nodes* are the pruned scene's count less the ground's.\n`);
  const fresh = g => {
    const store = createStore();
    return { store, root: store.importKeys(prune(g.store.snapshot().keys, [g.root]).keys)[g.root] };
  };
  const bake = (g, gi, list) => {
    const { store, root } = fresh(g), t = now();
    const r = bakeScene(store, root, D, list);
    return { ms: now() - t, added: nodesOf(store, r) - baseNodes[gi] };
  };
  const both = list => grounds.map(([, g], gi) => bake(g, gi, list));
  const footOf = s => s >= 0 ? kb.lo[1] * 2 ** s : Math.floor(kb.lo[1] / 2 ** -s);
  const A0 = [side / 2 - 640, 4 - footOf(0), side / 2 - 640];

  // The first knight: the library's cost, paid once a scale.
  say(`**The first knight**, standing at x = z = ${A0[0]}, at each scale. *Own* is the child's node count at that scale, alone in its own store (lifting adds a solid node a level, coarsening merges).\n`);
  row(['scale', 'height', 'own nodes', 'new on flat ground', 'new in the kit', 'bake ms (flat, kit)']); row(['---:', '---:', '---:', '---:', '---:', '---:']);
  const firsts = new Map();
  for (const s of [-2, -1, 0, 1, 2]){
    const st = createStore(), c = prepared(st, { world: knight, scale: s }), own = nodesOf(st, c.id);
    const at = [A0[0], 4 - footOf(s), A0[2]], r = both([{ world: knight, at, scale: s }]);
    firsts.set(s, r);
    const h = s >= 0 ? (kb.hi[1] - kb.lo[1]) * 2 ** s : Math.ceil(kb.hi[1] / 2 ** -s) - footOf(s);
    row([s === 0 ? '1' : s > 0 ? `${2 ** s}` : `1/${2 ** -s}`, h, fmt(own), fmt(r[0].added), fmt(r[1].added), `${fmt(r[0].ms, 0)}, ${fmt(r[1].ms, 0)}`]);
  }
  say('');

  // A second knight beside the first: what §3.1 measured for specimens, here.
  say(`**A second knight** beside the first (scale 1), moved by Δ from it. *Cost* is its new nodes over the first's on the same ground. §3.1's rule: the copies share every level below the largest power of two dividing Δ, and nothing where either touches the ground's or the kit's nodes differently.\n`);
  row(['second knight', 'Δ (x, y, z)', 'turn', 'cost on flat ground', 'cost in the kit']); row(['---', '---', '---:', '---:', '---:']);
  const first = { world: knight, at: A0 };
  const second = (name, d, turn = 0) => {
    const r = both([first, { world: knight, at: A0.map((v, a) => v + d[a]), turn }]);
    const f = firsts.get(0);
    row([name, d.join(', '), turn, pct((r[0].added - f[0].added) / f[0].added), pct((r[1].added - f[1].added) / f[1].added)]);
  };
  // Δ of 256 at least: the cubes side by side, so the copies never overlap
  // (the knight is 134 wide). A smaller Δ is overlap, and the union of two
  // nearly equal shapes costs nearly nothing for that reason, not sharing.
  for (const d of [512, 256, 320, 272, 264, 260, 258, 257]) second(`x + ${d}`, [d, 0, 0]);
  second('x + 257, z + 1', [257, 0, 1]);
  second('turned about y', [512, 0, 0], Y_TURNS[1]);
  second('turned about y', [512, 0, 0], Y_TURNS[2]);
  second('lying down', [512, 0, 0], PROPER[5]);
  say('');

  // Many knights.
  const M = 64, r = rng(21);
  const spots = Array.from({ length: M }, () => [Math.floor(r() * (side - 512)), 0, Math.floor(r() * (side - 512))]);
  say(`**${M} knights** standing at random places, each scene baked from scratch. The grid is relative to the first knight's place, since sharing depends on the offset between copies. *A knight* is the scene's new nodes over ${M}, against the first knight's cost.\n`);
  row(['placed', 'new on flat ground', 'a knight', 'new in the kit', 'a knight', 'bake ms (flat, kit)']); row(['---', '---:', '---:', '---:', '---:', '---:']);
  const snap = (p, g) => [A0[0] + Math.floor((p[0] - A0[0]) / g) * g, A0[1], A0[2] + Math.floor((p[2] - A0[2]) / g) * g];
  for (const [name, f] of [
    ['on a 256 grid, upright', p => ({ at: snap(p, 256), turn: 0 })],
    ['on a 64 grid, upright', p => ({ at: snap(p, 64), turn: 0 })],
    ['on a 16 grid, upright', p => ({ at: snap(p, 16), turn: 0 })],
    ['anywhere, upright', p => ({ at: snap(p, 1), turn: 0 })],
    ['on a 256 grid, turned about y', (p, i) => ({ at: snap(p, 256), turn: Y_TURNS[i % 4] })],
    ['on a 256 grid, any of 24 turns', (p, i) => ({ at: snap(p, 256), turn: PROPER[i % 24] })],
  ]){
    const res = both(spots.map((p, i) => ({ world: knight, ...f(p, i) })));
    row([name, fmt(res[0].added), pct(res[0].added / M / firsts.get(0)[0].added), fmt(res[1].added), pct(res[1].added / M / firsts.get(0)[1].added), `${fmt(res[0].ms, 0)}, ${fmt(res[1].ms, 0)}`]);
  }
  say('');
}

/* ================================================================================
   c. colliding with overlays */
function scenePlacements(knight, D, K, seed, { ground = true } = {}){
  const r = rng(seed), out = [], kb = contentBox(knight.store, knight.root, knight.D);
  for (let i = 0; i < K; i++){
    const scale = [0, 0, -1, 1][i % 4], side = 2 ** (knight.D + scale);
    const at = [Math.floor(r() * (2 ** D - side)), 0, Math.floor(r() * (2 ** D - side))];
    // Standing on the ground (y = 4), upright or turned about y only: a statue, as a level designer would place it.
    at[1] = ground ? 4 - (scale >= 0 ? kb.lo[1] * 2 ** scale : Math.floor(kb.lo[1] / 2 ** -scale)) : Math.floor(r() * (2 ** D - side));
    out.push({ world: knight, at, turn: Y_TURNS[i % 4], scale });
  }
  return out;
}
function sectionC(knight, kit){
  const D = kit.D;
  say(`## c. Colliding with overlays (D = ${D})\n`);
  const K = 16, placements = scenePlacements(knight, D, K, 31);
  const store = createStore(), base = store.importKeys(prune(kit.store.snapshot().keys, [kit.root]).keys)[kit.root];
  const t0 = now(), baked = bakeScene(store, base, D, placements), bakeMs = now() - t0;
  const B = dagWorld(store, baked, D), touch = [0, 0, 0];
  const C = compositeWorld({ store, root: base, D }, placements, { stats: { touch } });
  const centres = C.kids.map(c => [(c.lo[0] + c.hi[0]) >> 1, c.lo[1] + 8, (c.lo[2] + c.hi[2]) >> 1]);
  const N = quick ? 100 : 400, T = quick ? 100 : 300;
  const run = (world, o = {}) => {
    const stats = { probes: 0, roomSaves: 0, roomFinds: 0 }, t = now();
    const f = flight(world, centres, { N, T, radius: 64, stats, ...o });
    return { ...f, stats, us: (now() - t) * 1000 / (N * T) };
  };
  // Warm both, then time.
  run(B); run(C);
  touch.fill(0);
  const rows = [['baked', run(B)], ['overlay', run(C, { shuffle: 5 })], ['baked, no rooms', run(B, { rooms: false })], ['overlay, no rooms', run(C, { rooms: false })]];
  for (const [, x] of rows) if (x.hash !== rows[0][1].hash) throw new Error('scene sketch: fliers on the overlay differ from the bake at D = 12');
  say(`${K} knights standing in the kit, at scales ½, 1 and 2 and turned about y, ${N} fliers spawned round them, ${T} ticks. Overlaid and baked give the same bytes (held, shuffled, rooms on and off). The bake took ${fmt(bakeMs, 0)} ms.\n`);
  row(['world', 'µs a flier a tick', 'probes a tick', 'room saves', 'room finds']); row(['---', '---:', '---:', '---:', '---:']);
  for (const [name, x] of rows) row([name, fmt(x.us), fmt(x.stats.probes / T, 0), fmt(x.stats.roomSaves / T, 0), fmt(x.stats.roomFinds / T, 0)]);
  const all = touch[0] + touch[1] + touch[2];
  say(`\nThe overlay's probes (both overlay runs): ${pct(touch[0] / all)} touch no knight's bounds, ${pct(touch[1] / all)} one, ${pct(touch[2] / all)} two or more.\n`);

  // Many children: a flat list's price.
  say('Children in a flat list, probe cost by how many there are (knights standing at random, fliers round the first 16, overlay only):\n');
  row(['children', 'µs a flier a tick', 'against 16']); row(['---:', '---:', '---:']);
  let ref = 0;
  for (const k of [16, 64, 256, 1024]){
    const W = compositeWorld({ store: kit.store, root: kit.root, D }, scenePlacements(knight, D, k, 31));
    const cs = W.kids.slice(0, 16).map(c => [(c.lo[0] + c.hi[0]) >> 1, c.lo[1] + 8, (c.lo[2] + c.hi[2]) >> 1]);
    flight(W, cs, { N: 50, T: 30, radius: 64 });
    const t = now(); flight(W, cs, { N, T: T / 2, radius: 64 });
    const us = (now() - t) * 1000 / (N * T / 2);
    if (k === 16) ref = us;
    row([k, fmt(us), `${fmt(us / ref)}×`]);
  }
  say('');
}

/* ================================================================================
   d. a moving overlay */
function sectionD(knight, kit){
  const D = kit.D;
  say(`## d. A moving overlay (D = ${D})\n`);
  const kb = contentBox(knight.store, knight.root, knight.D), c0 = 2 ** D / 2;
  const start = [c0 - 600, 4 - kb.lo[1], c0 - 128], step = 4, T = quick ? 240 : 600;
  const placeAt = t => [{ world: knight, at: [start[0] + Math.floor(t / step), start[1], start[2]] }];
  const N = quick ? 100 : 300;
  const centres = Array.from({ length: 8 }, (_, i) => [start[0] + 128 + 80 * i, start[1] + 140, start[2] + 128]);
  const run = shuffle => {
    let world = compositeWorld({ store: kit.store, root: kit.root, D }, placeAt(0)), moves = 0, rescued = 0, trappedAfter = 0;
    const stats = { probes: 0, roomSaves: 0, roomFinds: 0 }, t = now();
    const each = (A, tick) => {
      if (tick === 0 || tick % step) return;
      const was = world.kids[0];
      world = compositeWorld({ store: kit.store, root: kit.root, D }, placeAt(tick));
      const now_ = world.kids[0];
      moves++;
      // The knight moved: whoever its old or new bounds touch may be in it now (§4.1 case 2).
      const changed = { lo: was.lo.map((v, a) => Math.min(v, now_.lo[a])), hi: was.hi.map((v, a) => Math.max(v, now_.hi[a])) };
      rescued += rescue(world, A, { ...FLIER, seed: 7 }, { changed }).length;
      for (let i = 0; i < A.N; i++) if (A.alive[i] && restHits(world, A, i)) trappedAfter++;
      each.world = world;
    };
    each.world = world;
    const f = flight(world, centres, { N, T, radius: 72, shuffle, stats, each });
    return { ...f, moves, rescued, trappedAfter, stats, ms: now() - t };
  };
  const a = run(0), b = run(13);
  if (a.hash !== b.hash) throw new Error('scene sketch: the moving knight\'s flock depends on the update order');
  if (a.trappedAfter) throw new Error(`scene sketch: ${a.trappedAfter} fliers were left in the moving knight`);
  const still = (() => { const stats = { probes: 0, roomSaves: 0, roomFinds: 0 }; const W = compositeWorld({ store: kit.store, root: kit.root, D }, placeAt(0)); const t = now(); flight(W, centres, { N, T, radius: 72, stats }); return { stats, ms: now() - t }; })();
  say(`The ${knight.name} walks along x a voxel every ${step} ticks (${fmt(60 / step, 0)} voxels a second at 60 Hz), ${a.moves} steps, through ${N} fliers spawned in its path; each step is a new composite world, and \`rescue\` asks only the fliers its old and new bounds touch (\`changed\`). No world-to-world collision (§10 Q7): it walks through the kit's walls. The same bytes shuffled; nobody left inside it after a step.\n`);
  row(['', 'standing knight', 'walking knight']); row(['---', '---:', '---:']);
  row(['ms for the flight', fmt(still.ms, 0), fmt(a.ms, 0)]);
  row(['probes a tick', fmt(still.stats.probes / T, 0), fmt(a.stats.probes / T, 0)]);
  row(['room finds a tick', fmt(still.stats.roomFinds / T, 1), fmt(a.stats.roomFinds / T, 1)]);
  row(['rescued', '-', `${fmt(a.rescued)} (${fmt(a.rescued / a.moves)} a step)`]);
  say('');
}

/* ================================================================================ */
const t0 = now();
const knight = await knightWorld();
say(`# Scene sketch\n\n\`node experiments/scene-sketch.mjs${process.argv.slice(2).length ? ' ' + process.argv.slice(2).join(' ') : ''}\`. Child: ${knight.name}.\n`);
if (only.includes('a')) await sectionA(knight);
const kit = (only.includes('b') || only.includes('c') || only.includes('d')) ? buildKit(kitDesc({ D: 12 })) : null;
if (only.includes('b')) sectionB(knight, kit);
if (only.includes('c')) sectionC(knight, kit);
if (only.includes('d')) sectionD(knight, kit);
say(`(${fmt((now() - t0) / 1000, 1)} s)`);
