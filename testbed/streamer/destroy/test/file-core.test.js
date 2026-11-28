/* file-core.js against oracles of its own (destroy/README.md, "Saving an
   arena"):
     - the colour: every 5:5:5 cell made a word, kept at six bits as the file
       keeps it (vdag-core's sixBitWords) and packed again, is the cell;
     - the shape: arenaShape's root is, by id in one store, fromDense of the
       arena padded with air to the cube by hand, on random arenas (blobs,
       solid blocks, a bedrock floor, X, Y and Z unequal) and a built one;
     - the words: every solid voxel's, ordered by a Morton key made here bit
       by bit (no walk);
     - the file: writeArena, readVdag and arenaOfWorld give back the grid
       cell for cell, the count, the size (from the name), the view, at
       lod 0 at the origin; for a built arena, for one wrecked by rockets
       and plasma with the debris run until it baked, and at 256 across
       (D = 8; 384 is D = 9);
     - any other world opened as the arena: boundsOf against a dense scan,
       placementOf's promises (the finest lod whose box fits 512 × 256 ×
       512, square, centred, the bottom on y = 0, 64 or more over it, a
       multiple of 32), every cell where its place says against dagItem's
       cells at the same lod (the any rule and the colour, which
       content-core's test holds to a dense oracle), a gamut world and a
       named field at lod 1, a world too big for lod 0, a name that lies,
       an arena saved again by the stream viewer (`, edited` on its name),
       a saved arena built over its top grown to hold it (64 over, at most
       OPEN_HEIGHT) cell for cell, one taller than a build reopened, one
       past the cap laid out as any world;
     - the view: viewInArena by arithmetic (p / 2^lod + at, kept only
       inside the arena), with the viewer's camera of 2026-11-27 outside;
   then mutants of file-core.js's text, written beside it and removed after. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as REAL from '../file-core.js';
import * as AC from '../arena-core.js';
import { buildArena, dagItem } from '../content-core.js';
import { createDebris, stepDebris, burst } from '../debris-core.js';
import { createStore, createCounts, storeView } from '../../dag-core.js';
import { readVdag, sixBitWords } from '../../vdag-core.js';
import { colourOf } from '../../colours.js';

const HERE = dirname(fileURLToPath(import.meta.url));
function rng(seed){ let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// A random arena: a bedrock floor, blobs, and a solid block or two (full nodes at every level).
function randomArena(X, Y, Z, seed){
  const r = rng(seed), A = AC.createArena(X, Y, Z);
  const col = () => AC.pack(r() * 256, r() * 256, r() * 256);
  for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) A.cells[A.idx(x, 0, z)] = col();
  for (let b = 0; b < 12; b++){
    const c = [r() * X, r() * Y, r() * Z], rad = 2 + r() * 9;
    for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++)
      if ((x + 0.5 - c[0]) ** 2 + (y + 0.5 - c[1]) ** 2 + (z + 0.5 - c[2]) ** 2 < rad * rad) A.cells[A.idx(x, y, z)] = r() < 0.9 ? col() : 0;
  }
  const s = 16, o = [Math.floor(r() * (X / s)) * s, Math.floor(r() * (Y / s)) * s, Math.floor(r() * (Z / s)) * s];
  for (let y = o[1]; y < o[1] + s; y++) for (let z = o[2]; z < o[2] + s; z++) for (let x = o[0]; x < o[0] + s; x++) A.cells[A.idx(x, y, z)] = col();
  A.recount();
  return A;
}
// The arena padded with air to a 2^D cube, x fastest (fromDense's order).
function padded(A, D){
  const R = 2 ** D, occ = new Uint8Array(R ** 3);
  for (let y = 0; y < A.Y; y++) for (let z = 0; z < A.Z; z++) for (let x = 0; x < A.X; x++) if (A.cells[A.idx(x, y, z)]) occ[x + R * (y + R * z)] = 1;
  return { occ, R };
}
// A Morton key made bit by bit: x is bit 3b, y 3b + 1, z 3b + 2.
const mortonKey = (x, y, z, D) => { let k = 0; for (let b = 0; b < D; b++) k += (((x >> b) & 1) + 2 * ((y >> b) & 1) + 4 * ((z >> b) & 1)) * 8 ** b; return k; };
const wordHere = v => { const [r, g, b] = AC.rgbOf(v); return (r | g << 8 | b << 16) >>> 0; };
function sameCells(a, b, what){
  assert.equal(a.length, b.length, `${what}: sizes`);
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) assert.fail(`${what}: cell ${i} is ${b[i]}, not ${a[i]}`);
}
async function reopen(M, bytes){
  const { worlds } = await readVdag(bytes, { colourOf });
  assert.equal(worlds.length, 1);
  const w = worlds[0], store = storeView({ keys: w.keys }), counts = createCounts(store);
  assert.equal(w.colourStatus, 'baked');
  return { w, r: M.arenaOfWorld({ store, counts, root: w.root, D: w.D, name: w.name }, colourOf(w.colour, { store, counts, D: w.D })) };
}
async function roundTrip(M, A, what){
  const view = { eye: [A.X / 2 + 0.25, 40.5, A.Z - 3], yaw: 2.5, pitch: -0.25 };
  const { w, r } = await reopen(M, await M.writeArena(A, { view }));
  assert.equal(w.name, `arena ${A.X} × ${A.Y} × ${A.Z}`, `${what}: the name`);
  assert.equal(w.D, Math.ceil(Math.log2(Math.max(A.X, A.Y, A.Z))), `${what}: D`);
  assert.deepEqual(w.view, view, `${what}: the view`);
  assert.equal(w.voxels, A.count, `${what}: voxels`);
  assert.ok(r.saved, `${what}: opens as a saved arena`);
  assert.equal(r.lod, 0); assert.deepEqual(r.at, [0, 0, 0]);
  assert.deepEqual([r.A.X, r.A.Y, r.A.Z], [A.X, A.Y, A.Z], `${what}: the size`);
  sameCells(A.cells, r.A.cells, what);
  assert.equal(r.A.count, A.count);
}

async function suite(M, { quick = false } = {}){
  // The colour: every cell through a six-bit word and back.
  {
    const cells = Array.from({ length: 32768 }, (_, i) => AC.SOLID_BIT | i), words = Uint32Array.from(cells, M.wordOf);
    for (let i = 0; i < cells.length; i++) assert.equal(words[i], wordHere(cells[i]), `the word of ${cells[i]}`);
    const six = sixBitWords(words);
    for (let i = 0; i < cells.length; i++){ const w = six[i]; assert.equal(AC.pack(w & 255, w >> 8 & 255, w >> 16 & 255), cells[i], `cell ${cells[i]} at six bits`); }
  }

  // The shape and the words, on random arenas and a built one.
  const arenas = [[32, 64, 96, 1], [96, 32, 32, 2], [64, 64, 64, 3]].slice(0, quick ? 2 : 3).map(([X, Y, Z, s]) => [`random ${X} × ${Y} × ${Z}`, randomArena(X, Y, Z, s)]);
  arenas.push(['built 128', buildArena({ size: 128, height: 96, plane: 16, seed: 3, specimens: 4, maths: 1 }).A]);
  for (const [what, A] of arenas){
    const store = createStore(), { root, D } = M.arenaShape(A, store);
    assert.equal(D, Math.ceil(Math.log2(Math.max(A.X, A.Y, A.Z))), `${what}: D`);
    const { occ, R } = padded(A, D);
    assert.equal(root, store.fromDense(occ, R).root, `${what}: the shape is fromDense's, by id`);
    const list = [];
    for (let y = 0; y < A.Y; y++) for (let z = 0; z < A.Z; z++) for (let x = 0; x < A.X; x++){ const v = A.cells[A.idx(x, y, z)]; if (v) list.push([mortonKey(x, y, z, D), v]); }
    list.sort((a, b) => a[0] - b[0]);
    const words = M.arenaWords(A, store, root, D);
    assert.equal(words.length, A.count, `${what}: a word a voxel`);
    for (let i = 0; i < list.length; i++) if (words[i] !== wordHere(list[i][1])) assert.fail(`${what}: word ${i} out of Morton order`);
    await roundTrip(M, A, what);
  }

  // Wrecked: rockets and plasma, the debris run until every body baked, then saved and opened.
  {
    const { A } = buildArena({ size: 128, height: 96, plane: 16, seed: 5, specimens: 4, maths: 1 }), Db = createDebris(), r = rng(9), total = A.count;
    for (let shot = 0; shot < (quick ? 4 : 10); shot++){
      const c = [20 + r() * 88, 14 + r() * 30, 20 + r() * 88], R = shot % 3 ? 7 : 3, molten = shot % 3 === 0;
      const carved = AC.blast(A, c, R, { seed: shot });
      burst(Db, carved, c, R, molten ? { seed: shot, liquid: true, speed: 12, normal: [0, 1, 0] } : { seed: shot, cluster: 2, speed: 40, normal: [r() - 0.5, r(), r() - 0.5] });
      for (let k = 0; k < 20; k++) stepDebris(Db, A, 1 / 60);
    }
    for (let k = 0; k < 4000 && Db.bodies.length; k++) stepDebris(Db, A, 1 / 60);
    assert.equal(Db.bodies.length, 0, 'the debris baked');
    assert.equal(A.count, total, 'the mass');
    await roundTrip(M, A, 'wrecked');
  }
  if (!quick) await roundTrip(M, buildArena({ size: 256, height: 128, plane: 12, seed: 2, specimens: 3, maths: 1 }).A, 'built 256');

  // Any other world as the arena.
  const box = (D, lo, hi, holes = 0) => {
    const store = createStore(), h = rng(D);
    const root = store.fromField(D, (k, x, y, z) => {
      const s = 2 ** k, a = [x * s, y * s, z * s];
      if (a.some((v, i) => v + s <= lo[i] || v >= hi[i])) return 0;
      if (k === 0) return holes && h() < holes ? 0 : 1;
      return !holes && a.every((v, i) => v >= lo[i] && v + s <= hi[i]) ? 1 : -1;
    }).root;
    return { store, counts: createCounts(store), root, D };
  };
  const cases = [
    ['a ragged box at D = 7, gamut', box(7, [9, 5, 30], [70, 41, 101], 0.3), null, 0],
    ['a box at D = 10, too wide for lod 0', box(10, [100, 3, 40], [900, 120, 300]), null, 1],
    ['a box at D = 10, too tall for lods 0 to 1', box(10, [10, 0, 10], [200, 900, 140]), null, 2],
  ];
  { const w = box(9, [3, 2, 7], [130, 302, 100], 0.2);
    cases.push(['a named field at lod 1 (a name that lies)', { ...w, name: 'arena 32 × 32 × 32' }, colourOf({ kind: 'shape', name: 'sphere', D: 9 }), 1]); }
  for (const [what, w, colour, lodWant] of cases){
    // boundsOf against a scan of the voxels.
    const S = 2 ** w.D, lo = [S, S, S], hi = [0, 0, 0];
    const scan = (id, level, x, y, z) => {
      if (id === 0) return;
      if (level === 0){ const p = [x, y, z]; for (let a = 0; a < 3; a++){ lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a] + 1); } return; }
      for (let o = 0; o < 8; o++) scan(w.store.child(id, o), level - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
    };
    if (w.D <= 8) scan(w.root, w.D, 0, 0, 0);
    const b = M.boundsOf(w.store, w.root, w.D, w.counts);
    if (w.D <= 8) assert.deepEqual(b, { lo, hi }, `${what}: bounds`);
    const r = M.arenaOfWorld(w, colour);
    assert.equal(r.saved, false, `${what}: not a saved arena`);
    assert.equal(r.lod, lodWant, `${what}: lod`);
    const ext = l => [0, 1, 2].map(a => Math.ceil(b.hi[a] / 2 ** l) - Math.floor(b.lo[a] / 2 ** l)), e = ext(r.lod);
    if (r.lod > 0){ const f = ext(r.lod - 1); assert.ok(f[0] > 512 || f[2] > 512 || f[1] > 256, `${what}: lod ${r.lod - 1} would have fitted`); }
    const { X, Y, Z } = r.A;
    assert.equal(X, Z, `${what}: square`);
    assert.ok([X, Y].every(v => v % 32 === 0) && X >= 128 && X <= 512 && Y >= 96 && Y <= 256, `${what}: ${X} × ${Y}`);
    assert.ok(X >= Math.max(e[0], e[2]) && X - Math.max(e[0], e[2]) < 32 || X === 128, `${what}: the least square`);
    assert.ok(Y >= Math.min(256, e[1] + 64), `${what}: room over it`);
    const bl = b.lo.map(v => Math.floor(v / 2 ** r.lod));
    assert.deepEqual([r.at[0] + bl[0], r.at[1] + bl[1], r.at[2] + bl[2]], [Math.floor((X - e[0]) / 2), 0, Math.floor((Z - e[2]) / 2)], `${what}: centred, on y = 0`);
    // Every cell against dagItem's, at the same lod, placed where the box's corner goes.
    if (2 ** (w.D - r.lod) <= 256){
      const it = dagItem(what, w, colour, r.lod), o = [r.at[0] + bl[0], r.at[1] + bl[1], r.at[2] + bl[2]];
      assert.deepEqual([it.sx, it.sy, it.sz], e, `${what}: dagItem's box`);
      let n = 0;
      for (let z = 0, i = 0; z < it.sz; z++) for (let y = 0; y < it.sy; y++) for (let x = 0; x < it.sx; x++, i++){
        const v = it.cells[i]; if (v) n++;
        if (r.A.get(o[0] + x, o[1] + y, o[2] + z) !== v) assert.fail(`${what}: cell (${x}, ${y}, ${z}) is ${r.A.get(o[0] + x, o[1] + y, o[2] + z)}, not dagItem's ${v}`);
      }
      assert.equal(r.A.count, n, `${what}: nothing else in the arena`);
    }
  }
  assert.equal(M.arenaOfWorld({ ...box(5, [0, 0, 0], [0, 0, 0]), name: '' }, null), null, 'an empty world');
  assert.deepEqual(M.sizeOfName('arena 384 × 192 × 384'), [384, 192, 384]);
  assert.equal(M.sizeOfName('arena 384 × 192'), null);
  // The stream viewer's save of an edited arena: its name and `, edited`, once a save.
  assert.deepEqual(M.sizeOfName('arena 512 × 256 × 512, edited'), [512, 256, 512]);
  assert.deepEqual(M.sizeOfName('arena 512 × 256 × 512, edited, edited'), [512, 256, 512]);
  assert.equal(M.sizeOfName('arena 512 × 256 × 512, edited by hand'), null);
  {
    const A = randomArena(32, 64, 96, 7), store = createStore(), { root, D } = M.arenaShape(A, store), counts = createCounts(store);
    assert.deepEqual(M.placementOf(store, root, D, 'arena 32 × 64 × 96, edited', counts), { lod: 0, X: 32, Y: 64, Z: 96, at: [0, 0, 0], grown: null }, 'an edited arena that fits is itself');
  }

  /* Built over the top (in the stream viewer): a saved arena grows to hold
     it, at lod 0 at the origin, its height what's in it and 64 over rounded
     up to 32, at most OPEN_HEIGHT (512); every cell where it was. */
  assert.equal(M.OPEN_HEIGHT, 512);
  await roundTrip(M, randomArena(32, 320, 32, 11), 'a saved arena taller than a build');
  for (const [top, said, want] of [[150, 96, 224], [500, 256, 512], [96, 96, null]]){
    const what = `an arena ${said} tall, built to ${top}`, H = Math.max(top, said) + (-Math.max(top, said) & 31);
    const A = randomArena(64, H, 64, top);
    for (let y = 0; y < H; y++) for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++){
      const i = A.idx(x, y, z);
      if (y >= said) A.cells[i] = 0;                                                     // the arena as saved,
      if (x >= 20 && x < 23 && z >= 30 && z < 34 && y < top) A.cells[i] = AC.SOLID_BIT | 0x1234 | y;   // and a tower to `top`
    }
    A.recount();
    const store = createStore(), { root, D } = M.arenaShape(A, store), counts = createCounts(store);
    const r = M.arenaOfWorld({ store, counts, root, D, name: `arena 64 × ${said} × 64, edited` }, null);
    const Y = want ?? said;
    assert.deepEqual([r.lod, r.at, r.A.X, r.A.Y, r.A.Z, r.saved, r.grown], [0, [0, 0, 0], 64, Y, 64, true, want === null ? null : said], `${what}: grown to ${Y}`);
    for (let y = 0; y < Y; y++) for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++){
      const a = A.get(x, y, z), b = r.A.get(x, y, z);
      if (!!a !== !!b) assert.fail(`${what}: cell (${x}, ${y}, ${z}) is ${b ? 'solid' : 'air'}`);
    }
    assert.equal(r.A.count, A.count, `${what}: every voxel`);
  }
  {
    const w = box(10, [0, 0, 0], [100, 600, 100]);
    const p = M.placementOf(w.store, w.root, w.D, 'arena 128 × 96 × 128', w.counts);
    assert.ok(p.lod > 0 && !p.grown, `taller than OPEN_HEIGHT: laid out as any world (lod ${p.lod})`);
  }

  /* The view (viewInArena), by arithmetic of its own: a world point p is the
     arena point p / 2^lod + at, kept only inside [0, X) × [0, Y) × [0, Z). */
  {
    const P = { lod: 0, at: [0, 0, 0], X: 512, Y: 256, Z: 512 }, at = (eye, p = P) => M.viewInArena({ eye, yaw: 1.5, pitch: -0.25 }, p);
    assert.deepEqual(at([10.5, 20.25, 500]), { eye: [10.5, 20.25, 500], yaw: 1.5, pitch: -0.25 }, 'a saved arena\'s view is itself');
    assert.deepEqual(at([0, 0, 0]).eye, [0, 0, 0], 'the low corner is inside');
    for (let a = 0; a < 3; a++){
      const lo = [10, 20, 30], hi = [10, 20, 30];
      lo[a] = -0.001; hi[a] = [512, 256, 512][a];
      assert.equal(at(lo), null, `below 0 on axis ${a}`);
      assert.equal(at(hi), null, `at the far side on axis ${a}`);
    }
    // The file of 2026-11-27: an arena edited in the stream viewer, its view the viewer's camera out over the edge.
    assert.equal(at([697.1834577116257, 267.4630839456872, -154.71807014752017]), null, 'the viewer\'s camera outside the arena');
    const L = { lod: 2, at: [10, 0, 20], X: 256, Y: 128, Z: 256 };
    assert.deepEqual(at([100, 50, 60], L).eye, [35, 12.5, 35], 'lod 2, moved by at');
    assert.equal(at([0, 0, -81], L), null, 'past the near side once moved');
    assert.equal(M.viewInArena(null, P), null, 'no view');
  }
}

test('file-core against its oracles', { timeout: 240000 }, async () => { await suite(REAL); });

const MUTANTS = [
  ['a cube too small', 'Math.max(BRICK, Math.ceil(Math.log2(Math.max(X, Y, Z))))', 'Math.max(BRICK, Math.floor(Math.log2(Math.max(X, Y, Z))))'],
  ['air counted', 'for (let x = 0; x < X; x++) if (cells[row + x]) c3[o + (x >> BRICK)]++; } }', 'for (let x = 0; x < X; x++) c3[o + (x >> BRICK)]++; } }'],
  ['the pyramid overwrites', 'c[(x >> 1) + nx * ((y >> 1) + ny * (z >> 1))] += p[x + px * (y + py * z)];', 'c[(x >> 1) + nx * ((y >> 1) + ny * (z >> 1))] = p[x + px * (y + py * z)];'],
  ['a lone voxel lost', 'return n === 0 ? 0 : n === s * s * s ? 1 : -1;', 'return n <= 1 ? 0 : n === s * s * s ? 1 : -1;'],
  ['a part counts as full', 'return solid === 0 ? 0 : solid === s * s * s ? 1 : -1;', 'return solid === 0 ? 0 : solid > 1 ? 1 : -1;'],
  ['some words zeroed', "if (id === EMPTY) return;\n    if (level === 0){ words[r++]", "if (id === EMPTY) return;\n    if (level === 0 && (x + y) % 7 === 3){ words[r++] = 0; return; }\n    if (level === 0){ words[r++]"],
  ['words walked z first', 'for (let o = 0; o < 8; o++) walk(store.child(id, o), level - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));\n  };\n  walk(root, D, 0, 0, 0);\n  if (r',
    'for (let o = 0; o < 8; o++) walk(store.child(id, o), level - 1, 2 * x + (o >> 2), 2 * y + (o >> 1 & 1), 2 * z + (o & 1));\n  };\n  walk(root, D, 0, 0, 0);\n  if (r'],
  ['channels swapped', 'return (r | g << 8 | b << 16) >>> 0; };', 'return (b | g << 8 | r << 16) >>> 0; };'],
  ['no view', "name: arenaName(A.X, A.Y, A.Z), view,", "name: arenaName(A.X, A.Y, A.Z), view: null,"],
  ['an edited arena a stranger', '(\\d+) × (\\d+)(?:, edited)*$/', '(\\d+) × (\\d+)$/'],
  ['any view believed', "if (!eye.every((v, a) => Number.isFinite(v) && v >= 0 && v < size[a])) return null;", ''],
  ['the far side inside', '&& v >= 0 && v < size[a])) return null;', '&& v >= 0 && v <= size[a])) return null;'],
  ['the view not scaled', 'eye = e.map((v, a) => v / s + at[a])', 'eye = e.map((v, a) => v + at[a])'],
  ['the view not moved', 'eye = e.map((v, a) => v / s + at[a])', 'eye = e.map((v, a) => v / s)'],
  ['a name believed', '&& b.hi[0] <= size[0] && b.hi[2] <= size[2]){', '){'],
  ['a tall arena a stranger', 'size[1] <= OPEN_HEIGHT && b.hi[0]', 'size[1] <= maxY && b.hi[0]'],
  ['never grown', ': Math.min(OPEN_HEIGHT, up32(b.hi[1] + 64));', ': size[1];'],
  ['no room over the grown', 'up32(b.hi[1] + 64)', 'up32(b.hi[1])'],
  ['grown past the cap', 'Math.min(OPEN_HEIGHT, up32(b.hi[1] + 64))', 'up32(b.hi[1] + 64)'],
  ['grown, not said', 'grown: Y > size[1] ? size[1] : null', 'grown: null'],
  ['a full node a voxel', 'if (level === 0 || isFull(store, counts, id, level)){', 'if (level <= 1 || isFull(store, counts, id, level)){'],
  ['too tall kept', "ext(lod)[2] > maxXZ || ext(lod)[1] > maxY)) lod++;", "ext(lod)[2] > maxXZ)) lod++;"],
  ['no room over it', 'up32(e[1] + 64)', 'up32(e[1])'],
  ['off centre', 'at: [Math.floor((XZ - e[0]) / 2) - lo[0], -lo[1],', 'at: [Math.floor((XZ - e[0]) / 2), -lo[1],'],
  ['afloat', 'at: [Math.floor((XZ - e[0]) / 2) - lo[0], -lo[1],', 'at: [Math.floor((XZ - e[0]) / 2) - lo[0], 0,'],
  ['a voxel, not a mean', 'cellMean(store, counts, colour, id, lod, Math.min(lod, 2), x * cell, y * cell, z * cell, out);', 'cellMean(store, counts, colour, id, lod, 0, x * cell, y * cell, z * cell, out);'],
  ['gamut of the arena', 'else v = gamut((x + 0.5) / S, (y + 0.5) / S, (z + 0.5) / S);', 'else v = gamut((x + 0.5) / X, (y + 0.5) / Y, (z + 0.5) / Z);'],
];
test('every mutant of file-core is caught', { timeout: 600000 }, async t => {
  const src = readFileSync(join(HERE, '..', 'file-core.js'), 'utf8');
  for (const [k, [name, from, to]] of MUTANTS.entries()){
    assert.equal(src.split(from).length, 2, `mutant ${name}: its text must occur exactly once in file-core.js`);
    const file = join(HERE, '..', `mutant-file-${k}.js`);
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
