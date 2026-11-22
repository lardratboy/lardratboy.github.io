/* debris-core.js against its promises (destroy/README.md), on arena-core's
   grid (held by arena-core.test.js):
     - a cluster dropped on flat ground falls, stops flush at an integer,
       rests within a second and bakes whole where it lay, its colours in
       its cells;
     - a body thrown at a wall one voxel thick at 150 voxels a second never
       passes it, nor is ever inside it;
     - barrages: random blasts (no scorch, so colours are only moved) on a
       world of blobs and floating bits, rubble and melt and loose pieces,
       run until every body has baked: after every step the mass is exact,
       no body is inside the grid, and the colours in world and debris are
       the same multiset as before the first shot; and everything bakes;
     - overtaken: two drops in one place, the second baked where it's free;
       the fallback bake when a body's cells are taken; the cap on bodies;
       a molten drop runs off a ledge; the push;
   then mutants of debris-core.js's text (the walk-core way), each run in a
   folder of its own with a copy of arena-core.js beside it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as AC from '../arena-core.js';
import * as REAL from '../debris-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));
function rng(seed){ let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const GROUND = 6;
function flat(X = 64, Y = 64, Z = 64){
  const A = AC.createArena(X, Y, Z);
  for (let y = 0; y < GROUND; y++) for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) A.cells[A.idx(x, y, z)] = AC.pack(90, 120 + y, 80);
  return A.recount();
}
function blobs(seed){
  const A = flat(), r = rng(seed);
  for (let b = 0; b < 8; b++){
    const c = [8 + r() * 48, 8 + r() * 30, 8 + r() * 48], R = 3 + r() * 6, col = AC.pack(r() * 255, r() * 255, r() * 255);
    for (let z = 0; z < 64; z++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++)
      if ((x + 0.5 - c[0]) ** 2 + (y + 0.5 - c[1]) ** 2 + (z + 0.5 - c[2]) ** 2 < R * R) A.cells[A.idx(x, y, z)] = col;
  }
  for (let y = GROUND; y < 40; y++) A.cells[A.idx(20, y, 20)] = AC.pack(250, 0, 250);   // a pole to cut
  return A.recount();
}
const histogram = (A, D) => {
  const h = new Map(), add = v => h.set(v, (h.get(v) || 0) + 1);
  for (const v of A.cells) if (v) add(v);
  for (const b of D.bodies) for (const v of b.cols) add(v);
  return h;
};
const sortedEntries = h => [...h.entries()].sort((a, b) => a[0] - b[0]);

async function suite(M, { quick = false } = {}){
  // A cluster dropped on flat ground.
  {
    const A = flat(), D = M.createDebris(), n0 = A.count, cols = [1, 2, 3, 4, 5, 6, 7, 8].map(k => AC.pack(k * 30, 0, 0));
    const offs = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1];
    M.addBody(D, M.makeBody(offs, cols, [20.3, 30.6, 31.8], [3, 0, -2]));
    let t = 0;
    while (D.bodies.length){
      M.stepDebris(D, A, 1 / 60); t += 1 / 60;
      for (const b of D.bodies){
        assert.ok(!M.bodyInside(A, b), 'never inside');
        if (b.ground) assert.equal(b.pos[1], GROUND, 'on the ground, flush at an integer');
      }
      assert.equal(A.count + D.voxels, n0 + 8, 'mass');
      assert.ok(t < 3, 'rests and bakes within 3 s');
    }
    assert.equal(D.bakedWhole, 1, 'baked whole');
    let found = 0;
    for (let y = GROUND; y < GROUND + 2; y++) for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++){
      const v = A.cells[A.idx(x, y, z)];
      if (v && cols.includes(v)) found++;
    }
    assert.equal(found, 8, 'all eight on the ground, in their colours');
    // Shape kept: the eight form a 2³ block.
    const at = [];
    for (let y = GROUND; y < GROUND + 2; y++) for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) if (cols.includes(A.cells[A.idx(x, y, z)])) at.push([x, y, z]);
    const lo = [0, 1, 2].map(a => Math.min(...at.map(p => p[a]))), hi = [0, 1, 2].map(a => Math.max(...at.map(p => p[a])));
    assert.deepEqual(hi.map((v, a) => v - lo[a]), [1, 1, 1], 'a 2³ block');
    for (const p of at) assert.equal(A.cells[A.idx(...p)], cols[(p[0] - lo[0]) + 2 * (p[1] - lo[1]) + 4 * (p[2] - lo[2])], 'each voxel where it was in the body');
  }

  // A thin wall at speed.
  {
    const A = flat(), D = M.createDebris();
    for (let y = GROUND; y < 60; y++) for (let z = 0; z < 64; z++) A.cells[A.idx(40, y, z)] = AC.pack(1, 1, 1);
    A.recount();
    const b = M.addBody(D, M.makeBody([0, 0, 0, 1, 0, 0, 0, 1, 0], [AC.pack(9, 9, 9), AC.pack(9, 9, 9), AC.pack(9, 9, 9)], [10.25, 20.5, 10.75], [150, 10, 3]));
    let bounced = false;
    for (let k = 0; k < 120 && D.bodies.length; k++){
      M.stepDebris(D, A, 1 / 60);
      if (D.bodies.length){ assert.ok(b.pos[0] + b.size[0] <= 40 + 1e-9, `through the wall at ${b.pos[0]}`); assert.ok(!M.bodyInside(A, b)); }
      if (D.bodies.length && b.vel[0] < 0) bounced = true;
    }
    assert.ok(bounced, 'a fast hit bounces back off the wall');
    for (let y = 0; y < 64; y++) for (let z = 0; z < 64; z++) for (let x = 41; x < 64; x++) assert.notEqual(A.cells[A.idx(x, y, z)], AC.pack(9, 9, 9), 'baked beyond the wall');
  }

  // Barrages.
  for (const seed of quick ? [2] : [2, 3, 4]){
    const A = blobs(seed), D = M.createDebris(), r = rng(seed * 7), total = A.count, before = sortedEntries(histogram(A, D));
    let steps = 0;
    const check = () => {
      assert.equal(A.count + D.voxels, total, `mass at step ${steps}`);
      for (const b of D.bodies) assert.ok(!M.bodyInside(A, b), `a body inside the grid at step ${steps}`);
    };
    for (let shot = 0; shot < (quick ? 6 : 12); shot++){
      const c = [8 + r() * 48, GROUND + r() * 30, 8 + r() * 48], R = 2 + r() * 7, molten = shot % 3 === 2;
      const carved = AC.blast(A, c, R, { seed: shot, scorch: 0 });
      M.burst(D, carved, c, R, molten ? { seed: shot, liquid: true, speed: 12, normal: [0, 1, 0] } : { seed: shot, cluster: 1 + (shot % 3), speed: 40, normal: [r() - 0.5, r(), r() - 0.5] });
      for (const piece of AC.looseAround(A, carved.box)){ const d = AC.detach(A, piece); M.addBody(D, M.makeBody(d.offs, d.cols, d.origin)); }
      if (shot % 2) M.pushBodies(D, c, R * 2.5, 40);
      check();
      for (let k = 0; k < 10; k++){ M.stepDebris(D, A, 1 / 60); steps++; check(); }
    }
    while (D.bodies.length && steps < 3000){ M.stepDebris(D, A, 1 / 60); steps++; check(); }
    assert.equal(D.bodies.length, 0, 'everything baked');
    assert.deepEqual(sortedEntries(histogram(A, D)), before, 'the same colours, moved');
    assert.ok(D.baked > 500, `only ${D.baked} baked`);
  }

  // Overtaken: two drops in one place.
  {
    const A = flat(), D = M.createDebris(), n0 = A.count;
    for (let k = 0; k < 2; k++) M.addBody(D, M.makeBody([0, 0, 0], [AC.pack(200, 0, 0)], [12, GROUND, 12]));
    for (let k = 0; k < 60 && D.bodies.length; k++){ M.stepDebris(D, A, 1 / 60); for (const b of D.bodies) assert.ok(!M.bodyInside(A, b)); }
    assert.equal(D.bodies.length, 0);
    assert.equal(A.count, n0 + 2, 'both in the grid');
    assert.ok(D.overtaken >= 1, 'the second was overtaken');
  }

  // The fallback bake: a body's cells taken.
  {
    const A = flat(), D = M.createDebris();
    const offs = [0, 0, 0, 1, 0, 0, 2, 0, 0, 2, 1, 0, 2, 2, 0], cols = offs.filter((_, i) => i % 3 === 0).map((_, k) => AC.pack(10 * k, 50, 50));
    const b = M.addBody(D, M.makeBody(offs, cols, [30, GROUND, 30]));
    for (let x = 28; x < 36; x++) for (let z = 29; z < 32; z++) A.set(x, GROUND, z, AC.pack(0, 0, 255));   // under it, every way it could round
    for (let x = 28; x < 36; x++) for (let z = 29; z < 32; z++) A.set(x, GROUND + 1, z, AC.pack(0, 0, 255));
    const n0 = A.count;
    M.bake(D, A, b);
    assert.equal(A.count, n0 + b.n, 'every voxel placed');
    assert.equal(D.voxels, 0);
    for (let y = 0; y < 64; y++) for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++){
      const v = A.cells[A.idx(x, y, z)];
      if (cols.includes(v)) assert.ok(y === 0 || A.cells[A.idx(x, y - 1, z)], 'each placed voxel rests on something');
    }
  }

  // A voxel baked inside a pillar's middle goes beside it, and down to the ground, not into the air.
  {
    const A = flat(), D = M.createDebris();
    for (let y = GROUND; y < 40; y++) A.set(45, y, 45, AC.pack(5, 5, 5));
    const b = M.addBody(D, M.makeBody([0, 0, 0], [AC.pack(240, 240, 0)], [45, 20, 45]));
    M.bake(D, A, b);
    let at = null;
    for (let y = 0; y < 64; y++) for (let z = 40; z < 50; z++) for (let x = 40; x < 50; x++) if (A.cells[A.idx(x, y, z)] === AC.pack(240, 240, 0)) at = [x, y, z];
    assert.ok(at && at[1] === GROUND, `beside the pillar on the ground, not at ${at}`);
  }

  // The cap.
  {
    const A = flat(), D = M.createDebris(), n0 = A.count;
    for (let k = 0; k < 30; k++) M.addBody(D, M.makeBody([0, 0, 0], [AC.pack(k, 0, 0)], [5 + k, 40, 5], [0, 5, 0]));
    M.stepDebris(D, A, 1 / 60, { o: { ...M.DEBRIS, maxBodies: 10 } });
    assert.ok(D.bodies.length <= 10, `${D.bodies.length} bodies past a cap of 10`);
    assert.equal(A.count + D.voxels, n0 + 30);
    const old = M.addBody(D, M.makeBody([0, 0, 0], [AC.pack(1, 1, 1)], [50, 40, 50]));
    old.age = 100;
    M.stepDebris(D, A, 1 / 60);
    assert.ok(!D.bodies.includes(old), 'baked past its age');
  }

  // A molten drop runs off a ledge.
  {
    const A = flat(), D = M.createDebris();
    for (let y = GROUND; y < GROUND + 6; y++) for (let z = 0; z < 64; z++) for (let x = 0; x < 30; x++) A.set(x, y, z, AC.pack(80, 80, 80));
    const b = M.addBody(D, M.makeBody([0, 0, 0], [AC.pack(255, 0, 0)], [29, GROUND + 6, 20], [0, 0, 0], { liquid: true }));
    // It runs as a body (the flow), not only slides in the grid when it bakes (the slide).
    let ranAsBody = false;
    for (let k = 0; k < 600 && D.bodies.length; k++){ M.stepDebris(D, A, 1 / 60); if (D.bodies.length && b.pos[1] < GROUND + 1) ranAsBody = true; }
    assert.ok(ranAsBody, 'the drop flowed off the ledge before it baked');
    let at = null;
    for (let y = 0; y < 64; y++) for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) if (A.cells[A.idx(x, y, z)] === AC.pack(255, 0, 0)) at = [x, y, z];
    assert.ok(at && at[1] === GROUND && at[0] >= 30, `the drop ran down to the ground beside the ledge, not ${at}`);
    void b;
  }

  // Rubble leaves the face that was hit: a blast on a wall facing +z throws every body out of it.
  for (const n of [[0, 0, 1], [1, 0, 0], [0, 0, -1]]){
    const A = flat(), D = M.createDebris();
    for (let y = GROUND; y < 40; y++) for (let z = 10; z < 50; z++) for (let x = 10; x < 50; x++) A.cells[A.idx(x, y, z)] = AC.pack(100, 100, 100);
    A.recount();
    const c = [30 + n[0] * 20, 22, 30 + n[2] * 20], carved = AC.blast(A, c, 6, { seed: 1 });
    const made = M.burst(D, carved, c, 6, { seed: 1, cluster: 2, speed: 40, normal: n });
    assert.ok(made.length > 20);
    for (const b of made) assert.ok(b.vel[0] * n[0] + b.vel[1] * n[1] + b.vel[2] * n[2] > 0, `a body thrown into the wall facing ${n}`);
  }

  // The push: away from the blast, nothing beyond its reach.
  {
    const D = M.createDebris();
    const near = M.addBody(D, M.makeBody([0, 0, 0], [AC.pack(1, 1, 1)], [12, 10, 10])), far = M.addBody(D, M.makeBody([0, 0, 0], [AC.pack(1, 1, 1)], [40, 10, 10]));
    M.pushBodies(D, [10, 10.5, 10.5], 10, 50);
    assert.ok(near.vel[0] > 0 && near.vel[1] > 0, 'away and up');
    assert.deepEqual(Array.from(far.vel), [0, 0, 0]);
  }
}

test('debris-core against its promises', async () => { await suite(REAL); });

const MUTANTS = [
  ['flush on the far side', 'p[a] = d > 0 ? Math.floor(p[a] + EPS) : Math.ceil(p[a] - EPS);', 'p[a] = d > 0 ? Math.ceil(p[a] + EPS) : Math.floor(p[a] - EPS);'],
  ['trailing faces lead', "if (!hitsAt(A, b, b.lists[2 * a + (d > 0 ? 0 : 1)], p)) return false;", "if (!hitsAt(A, b, b.lists[2 * a + (d > 0 ? 1 : 0)], p)) return false;"],
  ['one cell an axis', 'const nx = Math.ceil(p[0] + 1 - EPS) - bx,', 'const nx = 1 + 0 * Math.ceil(p[0] + 1 - EPS) - 0 * bx,'],
  ['leading list inside out', '      if (!at(p[0], p[1], p[2])) l.push(k);', '      if (at(p[0], p[1], p[2])) l.push(k);'],
  ['never grounded', 'if (dy < 0) b.ground = true;', ''],
  ['fits anything', 'for (let k = 0; k < n; k++) if (!A.free(X + o[3 * k], Y + o[3 * k + 1], Z + o[3 * k + 2])) return false;', ''],
  ['fallback on top', 'const q = settleDown(A, nearestFree(A, c), b.liquid || n === 1);', 'const q = c;'],
  ['fallback floats', 'const q = settleDown(A, nearestFree(A, c), b.liquid || n === 1);', 'const q = nearestFree(A, c);'],
  ['mass forgotten', 'D.voxels -= n; D.baked += n; D.epoch++;', 'D.baked += n; D.epoch++;'],
  ['no epoch', 'D.voxels -= n; D.baked += n; D.epoch++;', 'D.voxels -= n; D.baked += n;'],
  ['no second look', "      if (bodyInside(A, b)){ D.overtaken++; baked += bake(D, A, b, onBake); keep.splice(k--, 1); again = true; }", ''],
  ['last drop lost', '    for (let k = 0; k < n; k++){\n      const x = at[3 * k], y = at[3 * k + 1], z = at[3 * k + 2];\n      const u', '    for (let k = 0; k < n - 1; k++){\n      const x = at[3 * k], y = at[3 * k + 1], z = at[3 * k + 2];\n      const u'],
  ['cluster drops one', '    for (const k of g){ offs.push(', '    for (const k of g.slice(1)){ offs.push('],
  ['into the wall', 'const dir = [0.6 * mx / d + normal[0]', 'const dir = [0.6 * mx / d - 3 * normal[0]'],
  ['no cap', '  if (D.bodies.length > o.maxBodies){', '  if (false){'],
  ['ageless', 'if (b.rest > o.restTime || b.age > (b.liquid ? o.liquidAge : o.maxAge))', 'if (b.rest > o.restTime)'],
  ['no flow', 'if (b.liquid && b.ground && b.n === 1){', 'if (false){'],
  ['push toward', 'b.vel[0] += m[0] * k;', 'b.vel[0] -= m[0] * k;'],
  ['push forever', 'if (d >= reach) continue;', ''],
  ['bounces through', 'if (moveAxis(A, b, a, v[a] * h)) v[a] = Math.abs(v[a]) > o.bounceMin ? -v[a] * o.bounce : 0;', 'if (moveAxis(A, b, a, v[a] * h)) v[a] = Math.abs(v[a]) > o.bounceMin ? v[a] : 0;'],
];
test('every mutant of debris-core is caught', async t => {
  const src = readFileSync(join(HERE, '..', 'debris-core.js'), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'debris-mutants-'));
  try {
    writeFileSync(join(dir, 'arena-core.js'), readFileSync(join(HERE, '..', 'arena-core.js')));
    for (const [k, [name, from, to]] of MUTANTS.entries()){
      assert.equal(src.split(from).length, 2, `mutant ${name}: its text must occur exactly once in debris-core.js`);
      const file = join(dir, `debris-mutant-${k}.mjs`);
      writeFileSync(file, src.replace(from, to));
      const M = await import(pathToFileURL(file).href);
      let caught = null;
      try { await suite(M, { quick: true }); } catch (e){ caught = e; }
      assert.ok(caught, `mutant ${name} survived`);
      t.diagnostic(`mutant ${name}: ${caught.message.split('\n')[0]}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
