/* content-core.js against oracles of its own (destroy/README.md):
     - the plane: every cell of the slab, bedrock at y = 0, nothing above;
     - itemOfOcc: every voxel of a random occupancy at scales 1 to 3, by a
       dense stamp written here; trimItem tight;
     - dagItem against the occupancy it was built from (fromDense of random
       blobs, D = 5 and 6): at lod 0 voxel for voxel, at lods 1 to 3 the
       any rule (a cell solid if any voxel under it is), and its colour at
       lod 1 the exact mean of the field over the voxels under each cell;
       fitLod's promise;
     - the layout: footprints apart by the gap, inside the arena, out of the
       spawn's clearing, a loaded world first and in the middle, things too
       tall left out and said so;
     - buildArena: the count is the plane plus every placed thing's voxels
       (nothing overlaps), each placed item stamped where it says, and the
       same seed gives the same cells; streamed (no grid, the page's own
       arena stamped and refreshed at each placement heard) the same grid,
       count and per-chunk counts; every made thing within its plan's box;
       a loaded world first and in the middle;
   then mutants of content-core.js's text, written beside it (it imports the
   repo's cores by relative path) and removed after. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as REAL from '../content-core.js';
import * as AC from '../arena-core.js';
import { createStore, createCounts } from '../../dag-core.js';
import { colourOf } from '../../colours.js';
import { solidBaked } from '../../test/baked-worlds.js';

const HERE = dirname(fileURLToPath(import.meta.url));
function rng(seed){ let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

async function suite(M, { quick = false } = {}){
  // The plane.
  {
    const A = AC.createArena(64, 64, 64);
    M.fillPlane(A, 9);
    for (let y = 0; y < 64; y++) for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++){
      const v = A.cells[A.idx(x, y, z)];
      if (y < 9) assert.equal(v, M.planeCell(x, y, z, 9)), assert.ok(v);
      else assert.equal(v, 0);
    }
    assert.equal(M.planeCell(5, 0, 5, 9), M.BEDROCK);
  }

  // itemOfOcc and trimItem.
  for (const scale of [1, 2, 3]){
    const r = rng(scale), R = 7, occ = new Uint8Array(R ** 3);
    for (let i = 0; i < occ.length; i++) occ[i] = r() < 0.3 ? 1 : 0;
    occ[0] = 0; occ[occ.length - 1] = 0; occ[3 + R * (3 + R * 3)] = 1;
    const it = M.itemOfOcc('t', occ, R, scale, (x, y, z) => AC.pack(x * 30, y * 30, z * 30));
    let lo = [R, R, R], hi = [-1, -1, -1];
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) if (occ[x + R * (y + R * z)]){
      lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)]; hi = [Math.max(hi[0], x), Math.max(hi[1], y), Math.max(hi[2], z)];
    }
    assert.deepEqual([it.sx, it.sy, it.sz], [0, 1, 2].map(a => (hi[a] - lo[a] + 1) * scale), 'tight');
    for (let z = 0; z < it.sz; z++) for (let y = 0; y < it.sy; y++) for (let x = 0; x < it.sx; x++){
      const ox = lo[0] + Math.floor(x / scale), oy = lo[1] + Math.floor(y / scale), oz = lo[2] + Math.floor(z / scale);
      const want = occ[ox + R * (oy + R * oz)] ? AC.pack(ox * 30, oy * 30, oz * 30) : 0;
      assert.equal(it.cells[x + it.sx * (y + it.sy * z)], want, `scale ${scale} at ${x}, ${y}, ${z}`);
    }
    assert.equal(M.itemVoxels(it), occ.reduce((a, b) => a + b, 0) * scale ** 3);
  }
  assert.equal(M.trimItem({ sx: 2, sy: 2, sz: 2, cells: new Uint16Array(8) }), null, 'empty');

  // dagItem against the occupancy.
  for (const D of quick ? [5] : [5, 6]){
    const R = 2 ** D, r = rng(D), occ = new Uint8Array(R ** 3);
    for (let b = 0; b < 6; b++){
      const c = [r() * R, r() * R, r() * R], rad = 2 + r() * R / 5;
      for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++)
        if ((x + 0.5 - c[0]) ** 2 + (y + 0.5 - c[1]) ** 2 + (z + 0.5 - c[2]) ** 2 < rad * rad) occ[x + R * (y + R * z)] = 1;
    }
    const store = createStore(), { root } = store.fromDense(occ, R), counts = createCounts(store), world = { store, counts, root, D };
    const field = (x, y, z) => (Math.floor(x) * 7 & 255) | (Math.floor(y) * 5 & 255) << 8 | (Math.floor(z) * 3 & 255) << 16;
    for (let lod = 0; lod <= 3; lod++){
      const S = R >> lod, full = new Uint8Array(S ** 3), sum = new Float64Array(3 * S ** 3), n = new Uint32Array(S ** 3);
      for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
        if (!occ[x + R * (y + R * z)]) continue;
        const i = (x >> lod) + S * ((y >> lod) + S * (z >> lod)), c = field(x + 0.5, y + 0.5, z + 0.5);
        full[i] = 1; n[i]++; sum[3 * i] += c & 255; sum[3 * i + 1] += c >> 8 & 255; sum[3 * i + 2] += c >> 16 & 255;
      }
      const it = M.dagItem('w', world, lod <= 1 ? field : null, lod);
      let lo = [S, S, S];
      for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (full[x + S * (y + S * z)]) lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
      let cells = 0;
      for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
        const i = x + S * (y + S * z);
        if (!full[i]) continue;
        cells++;
        const v = it.cells[(x - lo[0]) + it.sx * ((y - lo[1]) + it.sy * (z - lo[2]))];
        assert.ok(v, `D = ${D} lod ${lod}: cell ${x}, ${y}, ${z} is solid`);
        if (lod <= 1) assert.equal(v, AC.pack(sum[3 * i] / n[i], sum[3 * i + 1] / n[i], sum[3 * i + 2] / n[i]), `lod ${lod}'s colour is the mean under the cell`);
      }
      assert.equal(M.itemVoxels(it), cells, `D = ${D} lod ${lod}: the any rule, cell for cell`);
    }
  }
  // A baked world (an imported asset's words for its skin, the knight's kind of file): at
  // lod 0 a skin voxel is its own word, at lod 1 a cell holding skin is the mean of the skin's
  // words under it (baked-core's exact mean), by the test file's own sums over the dense words.
  {
    const B = solidBaked(5, 3), counts = createCounts(B.store), R = B.R;
    const field = colourOf({ kind: 'baked', skin: B.skin, words: B.words }, { store: B.store, counts, D: B.D });
    for (const lod of [0, 1]){
      const S = R >> lod, sum = new Float64Array(3 * S ** 3), n = new Uint32Array(S ** 3), full = new Uint8Array(S ** 3);
      for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
        const v = x + R * (y + R * z), i = (x >> lod) + S * ((y >> lod) + S * (z >> lod));
        if (B.shape[v]) full[i] = 1;
        if (!B.skinOcc[v]) continue;
        const w = B.at[v]; n[i]++; sum[3 * i] += w & 255; sum[3 * i + 1] += w >> 8 & 255; sum[3 * i + 2] += w >> 16 & 255;
      }
      const it = M.dagItem('baked', { store: B.store, counts, root: B.root, D: B.D }, field, lod);
      let lo = [S, S, S], checked = 0;
      for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (full[x + S * (y + S * z)]) lo = [Math.min(lo[0], x), Math.min(lo[1], y), Math.min(lo[2], z)];
      for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
        const i = x + S * (y + S * z);
        if (!n[i]) continue;
        const got = it.cells[(x - lo[0]) + it.sx * ((y - lo[1]) + it.sy * (z - lo[2]))];
        assert.equal(got, AC.pack(sum[3 * i] / n[i], sum[3 * i + 1] / n[i], sum[3 * i + 2] / n[i]), `baked lod ${lod} at ${x}, ${y}, ${z}`);
        checked++;
      }
      assert.ok(checked > 100, `${checked} skin cells checked`);
    }
  }
  for (const [D, side, lod] of [[10, 152, 3], [8, 152, 1], [5, 152, 0], [12, 64, 6], [10, 1024, 0], [10, 1023, 1]]) assert.equal(M.fitLod(D, side), lod, `fitLod(${D}, ${side})`);

  // The layout.
  {
    const desc = M.arenaDesc({ size: 256, height: 128, plane: 16, seed: 4 }), spawn = [128, 16, 242], r = rng(9), items = [];
    const box = (sx, sy, sz, name) => ({ name, sx, sy, sz, cells: new Uint16Array(sx * sy * sz).fill(AC.pack(1, 1, 1)) });
    for (let k = 0; k < 30; k++) items.push(box(4 + Math.floor(r() * 40), 4 + Math.floor(r() * 60), 4 + Math.floor(r() * 40), `b${k}`));
    items.push(box(10, 200, 10, 'too tall'));
    // A wider thing than the loaded world, so going first is the rule's doing, not the size's.
    items.push(box(70, 20, 70, 'wide'));
    const loaded = box(30, 30, 30, 'loaded'); loaded.first = true;
    items.push(loaded);
    const { placed, left } = M.layoutItems(items, desc, spawn);
    assert.equal(placed[0].item.name, 'loaded', 'a loaded world goes first');
    assert.deepEqual([placed[0].x0, placed[0].z0], [113, 113], 'in the middle');
    assert.ok(left.some(l => l.name === 'too tall' && /too big/.test(l.why)));
    assert.ok(placed.length >= 15, `only ${placed.length} placed`);
    for (const [i, p] of placed.entries()){
      assert.ok(p.x0 >= 4 && p.z0 >= 4 && p.x0 + p.item.sx <= 252 && p.z0 + p.item.sz <= 252, 'inside');
      assert.equal(p.y0, 16, 'on the plane');
      const dx = Math.max(p.x0 - spawn[0], 0, spawn[0] - (p.x0 + p.item.sx)), dz = Math.max(p.z0 - spawn[2], 0, spawn[2] - (p.z0 + p.item.sz));
      assert.ok(Math.hypot(dx, dz) >= 22, 'out of the clearing');
      for (const q of placed.slice(i + 1)){
        const apart = p.x0 + p.item.sx + 6 <= q.x0 || q.x0 + q.item.sx + 6 <= p.x0 || p.z0 + p.item.sz + 6 <= q.z0 || q.z0 + q.item.sz + 6 <= p.z0;
        assert.ok(apart, `${p.item.name} and ${q.item.name} closer than the gap`);
      }
    }
  }

  // The whole arena.
  {
    const desc = { size: 192, height: 128, plane: 12, seed: 2, specimens: quick ? 4 : 8, maths: quick ? 1 : 2 };
    const a = M.buildArena(desc), b = quick ? null : M.buildArena(desc);
    const d = a.desc;
    let want = d.size * d.size * d.plane;
    for (const p of a.placed) want += p.voxels;
    assert.equal(a.A.count, want, 'the plane plus every placed thing');
    for (const p of a.placed){
      let n = 0;
      for (let y = p.at[1]; y < p.at[1] + p.size[1]; y++) for (let z = p.at[2]; z < p.at[2] + p.size[2]; z++) for (let x = p.at[0]; x < p.at[0] + p.size[0]; x++) if (a.A.cells[a.A.idx(x, y, z)]) n++;
      assert.equal(n, p.voxels, `${p.name} where it says`);
      let bottom = 0;
      for (let z = p.at[2]; z < p.at[2] + p.size[2]; z++) for (let x = p.at[0]; x < p.at[0] + p.size[0]; x++) if (a.A.cells[a.A.idx(x, p.at[1], z)]) bottom++;
      assert.ok(bottom > 0, `${p.name} stands on the plane`);
    }
    if (b) assert.equal(createHash('sha1').update(a.A.cells).digest('hex'), createHash('sha1').update(b.A.cells).digest('hex'), 'the same seed, the same arena');
    assert.ok(a.placed.some(p => /specimen/.test(p.name)) && a.placed.some(p => /\(R \d+\)$/.test(p.name) && !/specimen/.test(p.name)), 'specimens and math shapes');
    // Streamed (the page's road): no grid in the builder, the page's own arena with the
    // plane laid first and each placement stamped and refreshed as it's heard, must be
    // the built grid cell for cell, with its count and per-chunk counts.
    {
      const P = AC.createArena(d.size, d.height, d.size);
      M.fillPlane(P, d.plane); P.refreshBox([0, 0, 0], [d.size, d.plane, d.size]);
      const heard = [];
      const s = M.buildArena(desc, [], { grid: false, onPlace: (p, voxels) => {
        M.stampItem(P, p.item, p.x0, p.y0, p.z0);
        P.refreshBox([p.x0, p.y0, p.z0], [p.x0 + p.item.sx, p.y0 + p.item.sy, p.z0 + p.item.sz]);
        heard.push([p.item.name, voxels]);
      } });
      assert.equal(s.A, null, 'no grid');
      assert.equal(s.count, a.A.count, 'the count without a grid');
      assert.deepEqual(heard, a.placed.map(p => [p.name, p.voxels]), 'every placement heard, in order');
      assert.equal(P.count, a.A.count, 'the streamed count');
      assert.equal(createHash('sha1').update(P.cells).digest('hex'), createHash('sha1').update(a.A.cells).digest('hex'), 'the streamed grid is the built one');
      assert.deepEqual(Array.from(P.chunkSolid), Array.from(a.A.chunkSolid), 'the streamed per-chunk counts');
    }
    // The order is decided before a thing is made: each made thing fits the box its plan
    // promised (so ordering by the plan is ordering by what each can be at most).
    {
      const rMax = Math.min(128, d.height - d.plane - 24, Math.floor(d.size / 3));
      for (let k = 0; k < d.maths; k++){ const { R } = M.mathPlan(d.seed, k, rMax), it = M.mathItem(d.seed, k, rMax);
        assert.ok(it.sx <= R && it.sy <= R && it.sz <= R, `math shape ${k} within R ${R}`); }
      for (let k = 0; k < d.specimens; k++){ const { R, scale } = M.specimenPlan(d.seed, k), it = M.specimenItem(d.seed, k);
        assert.ok(Math.max(it.sx, it.sy, it.sz) <= R * scale, `specimen ${k} within ${R * scale}`); }
      // Placed biggest planned box first (the box read back from the name: R, ×2 if doubled).
      const boxes = a.placed.map(p => { const m = p.name.match(/\(R (\d+)(, ×2)?\)$/); return Number(m[1]) * (m[2] ? 2 : 1); });
      for (let k = 1; k < boxes.length; k++) assert.ok(boxes[k] <= boxes[k - 1], `placed biggest first: ${boxes.join(' ')}`);
    }
    // A loaded world goes first, in the middle, ahead of bigger things.
    {
      const big = { name: 'loaded', sx: 30, sy: 20, sz: 30, cells: new Uint16Array(30 * 20 * 30).fill(AC.pack(1, 1, 1)), first: true };
      const w = M.buildArena(desc, [big], { grid: false });
      assert.equal(w.placed[0].name, 'loaded', 'loaded first');
      assert.deepEqual([w.placed[0].at[0], w.placed[0].at[2]], [81, 81], 'in the middle');
    }
    const c = M.buildArena({ ...desc, seed: 3 });
    assert.notEqual(createHash('sha1').update(c.A.cells).digest('hex'), createHash('sha1').update(a.A.cells).digest('hex'), 'another seed, another arena');
  }
  assert.deepEqual(M.arenaDesc({ size: 300, height: 70, plane: 100, seed: 0 }), { ...M.ARENA_DEFAULTS, size: 288, height: 96, plane: 64, seed: 1 }, 'clamped to the limits');
}

test('content-core against its oracles', async () => { await suite(REAL); });

const MUTANTS = [
  ['no bedrock', '  if (y === 0) return BEDROCK;\n', ''],
  ['plane one short', 'for (let y = 0; y < T; y++) for (let z = 0; z < Z; z++){ const row', 'for (let y = 0; y < T - 1; y++) for (let z = 0; z < Z; z++){ const row'],
  ['loose trim', 'if (x < x0) x0 = x; if (x > x1) x1 = x;', 'if (x < x0) x0 = x; if (x + 1 > x1) x1 = x + 1;'],
  ['scale skipped', 'for (let a = 0; a < scale; a++) cells[row + a] = v;', 'cells[row] = v;'],
  ['majority, not any', 'if (id === EMPTY) return;\n    if (level === lod){', 'if (id === EMPTY || (level === lod && counts.of(id) * 2 < 8 ** lod)) return;\n    if (level === lod){'],
  ['octants swapped', 'walk(store.child(id, o), level - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));', 'walk(store.child(id, o), level - 1, 2 * x + (o >> 2), 2 * y + (o >> 1 & 1), 2 * z + (o & 1));'],
  ['a point, not a mean', 'if (colour){ cellMean(store, counts, colour, id, lod, Math.min(lod, 2), x * cell, y * cell, z * cell, out); v = pack(out[0], out[1], out[2]); }',
    'if (colour){ const c = colour(x * cell + 0.5, y * cell + 0.5, z * cell + 0.5); v = pack(c & 255, c >> 8 & 255, c >> 16 & 255); }'],
  ['fit one coarser', 'export const fitLod = (D, maxSide) => Math.max(0, D - Math.max(0, Math.floor(Math.log2(Math.max(1, maxSide)))));', 'export const fitLod = (D, maxSide) => Math.max(0, D + 1 - Math.max(0, Math.floor(Math.log2(Math.max(1, maxSide)))));'],
  ['no gap', 'if (x0 < p.x0 + p.item.sx + gap && p.x0 < x0 + it.sx + gap', 'if (x0 < p.x0 + p.item.sx && p.x0 < x0 + it.sx'],
  ['spawn crowded', ') < 22) return true;', ') < 2) return true;'],
  ['loaded anywhere', "(items[b].first ? 1 : 0) - (items[a].first ? 1 : 0) || ", ''],
  ['too tall kept', 'if (it.sy > Y - T - 4 || ', 'if ('],
  ['the count forgets things', '    count += voxels;\n', ''],
  ['a placement unheard', '    if (onPlace) onPlace(p, voxels);\n', ''],
  ['ordered by index', 'order = layoutOrder(plans, i => plans[i].area)', 'order = plans.map((_, i) => i)'],
  ['stamped a row high', 'const p = { item: it, x0: at[0], y0: T, z0: at[1] };', 'const p = { item: it, x0: at[0], y0: T + 1, z0: at[1] };'],
];
test('every mutant of content-core is caught', async t => {
  const src = readFileSync(join(HERE, '..', 'content-core.js'), 'utf8');
  for (const [k, [name, from, to]] of MUTANTS.entries()){
    assert.equal(src.split(from).length, 2, `mutant ${name}: its text must occur exactly once in content-core.js`);
    const file = join(HERE, '..', `mutant-content-${k}.js`);
    try {
      writeFileSync(file, src.replace(from, to));
      const M = await import(pathToFileURL(file).href);
      let caught = null;
      try { await suite(M, { quick: true }); } catch (e){ caught = e; }
      assert.ok(caught, `mutant ${name} survived`);
      t.diagnostic(`mutant ${name}: ${caught.message.split('\n')[0]}`);
    } finally { rmSync(file, { force: true }); }
  }
});
