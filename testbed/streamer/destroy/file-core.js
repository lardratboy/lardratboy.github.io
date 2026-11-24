/* FILE CORE: an arena as a .vdag world, and a .vdag world as an arena
   (destroy/README.md, "Saving an arena", asked for 2026-11-23: "a .vdag
   from a wrecked arena, good stuff"). Pure: dag-core for the DAG,
   vdag-core for the file, chunk-core's cellMean for a world's colours,
   arena-core for the grid. No DOM, so destroy/test/file-core.test.js holds
   both ways in Node, and file-worker.js runs them off the page's thread.

   SAVING. The grid goes back into the DAG it came from: one world of side
   2^D, D the least with every side of the arena inside it, the arena at
   its low corner (y up, the bedrock at y = 0), air round it. The shape is
   built top down by dag-core's fromField from a count pyramid of the grid
   (8³ bricks up; below a brick the cells are looked at), so a block of
   rock or a block of sky costs one answer, and only the surface is walked
   to the voxel. 384 × 192 × 384 is a D = 9 world.

   Its colours are a BAKED field (glb-colour-plan step 4, vdag-core's ATTR):
   a word a skin voxel in rank order, which is Morton order. THE SKIN IS
   EVERY SOLID VOXEL, not the voxels that can show (a mesh's skin), because
   an arena's inside is played: the stone and dirt under the grass, a
   specimen's core, the slag a plasma left are what the next rocket opens.
   So reopening a saved arena here gives back the grid cell for cell and
   colour for colour, mass included, which the tests hold. The cost is the
   stream viewer's coarse lods: a coarse cell's colour is the mean of the
   skin under it, so a grass cell two voxels tall is half dirt from afar.
   The words are kept at six bits (`bits: 6`): a cell's five bits widened
   to eight (arena-core's rgbOf), narrowed to six and widened back, come
   back to the same five bits for all 32 values of a channel (the test
   holds every one), and six is what the viewer draws anyway.

   The world's name says the arena's size, `arena 384 × 192 × 384`, which
   is how a reopened one gets its height back (the sky over the tallest
   thing isn't in the DAG), and its view is the player's eye, so the stream
   viewer opens the file where the player stood.

   OPENING. Any world can be opened as the arena (`arenaOfWorld`): at the
   finest lod at which what's in it fits the arena's largest box (512 ×
   256 × 512), every level-lod node that isn't EMPTY a cell (the any rule,
   as content-core's dagItem), coloured by the world's field (cellMean;
   a baked one answers exactly) or the gamut where it has none. A saved
   arena opens as itself: lod 0, at the origin, at the size its name
   gives. Anything else is centred across a square arena with its bottom on
   y = 0 (the bedrock), the arena the content rounded up to 32 a side with
   room above. Nothing in it is laid or added: the file is the arena. */
import { createStore, createCounts, isFull, EMPTY, FIRST_NODE } from '../dag-core.js';
import { writeVdag, readVdag } from '../vdag-core.js';
import { cellMean } from '../chunk-core.js';
import { createArena, rgbOf, pack, CHUNK } from './arena-core.js';
import { ARENA_LIMITS, gamut } from './content-core.js';

export const SAVE_BITS = 6;
const BRICK = 3, B = 1 << BRICK;

// The least D with 2^D ≥ every side.
export const depthOf = (X, Y, Z) => Math.max(BRICK, Math.ceil(Math.log2(Math.max(X, Y, Z))));
export const arenaName = (X, Y, Z) => `arena ${X} × ${Y} × ${Z}`;
// [X, Y, Z] from a saved arena's name, or null.
export function sizeOfName(name){
  const m = /^arena (\d+) × (\d+) × (\d+)$/.exec(String(name ?? ''));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
// A cell's colour as an rgb8 word (r | g << 8 | b << 16, colours.js's packing).
export const wordOf = v => { const [r, g, b] = rgbOf(v); return (r | g << 8 | b << 16) >>> 0; };

/* ---- saving --------------------------------------------------------------------
   The shape: fromField over a count pyramid. counts[k] (k ≥ BRICK) is a
   level-k cell's solid cells, over the cells that meet the arena (nx[k] ×
   ny[k] × nz[k]); a cell past the arena is empty, and a cell is full only
   when its count is 8^k, which it can only be if it lies inside. At D ≤ 9
   a count is below 2^27: exact in a Uint32Array. */
export function arenaShape(A, store = createStore()){
  const { X, Y, Z, cells } = A, D = depthOf(X, Y, Z);
  const dims = k => [Math.ceil(X / 2 ** k), Math.ceil(Y / 2 ** k), Math.ceil(Z / 2 ** k)];
  const counts = [], size = [];
  for (let k = BRICK; k <= D; k++){ const [nx, ny, nz] = dims(k); size[k] = [nx, ny, nz]; counts[k] = new Uint32Array(nx * ny * nz); }
  { const [nx, ny] = size[BRICK], c3 = counts[BRICK];
    for (let y = 0; y < Y; y++) for (let z = 0; z < Z; z++){ const row = X * (z + Z * y), o = nx * ((y >> BRICK) + ny * (z >> BRICK));
      for (let x = 0; x < X; x++) if (cells[row + x]) c3[o + (x >> BRICK)]++; } }
  for (let k = BRICK + 1; k <= D; k++){
    const [nx, ny, nz] = size[k], [px, py, pz] = size[k - 1], c = counts[k], p = counts[k - 1];
    for (let z = 0; z < pz; z++) for (let y = 0; y < py; y++) for (let x = 0; x < px; x++)
      c[(x >> 1) + nx * ((y >> 1) + ny * (z >> 1))] += p[x + px * (y + py * z)];
  }
  const root = store.fromField(D, (k, x, y, z) => {
    const s = 2 ** k, x0 = x * s, y0 = y * s, z0 = z * s;
    if (x0 >= X || y0 >= Y || z0 >= Z) return 0;
    if (k >= BRICK){
      const [nx, ny] = size[k], n = counts[k][x + nx * (y + ny * z)];
      return n === 0 ? 0 : n === s * s * s ? 1 : -1;
    }
    // Below a brick (inside the arena, since X, Y and Z are multiples of 32): look.
    let solid = 0;
    for (let c = 0; c < s; c++) for (let b = 0; b < s; b++){ const row = X * ((z0 + c) + Z * (y0 + b)) + x0;
      for (let a = 0; a < s; a++) if (cells[row + a]) solid++; }
    return solid === 0 ? 0 : solid === s * s * s ? 1 : -1;
  }).root;
  return { store, root, D };
}
/* The words: every solid voxel's in rank order, by a walk in octant order
   (x the low bit of the octant, then y, then z: Morton, the skin's order). */
export function arenaWords(A, store, root, D, n = createCounts(store).of(root)){
  const { X, Z, cells } = A, words = new Uint32Array(n);
  let r = 0;
  const walk = (id, level, x, y, z) => {
    if (id === EMPTY) return;
    if (level === 0){ words[r++] = wordOf(cells[x + X * (z + Z * y)]); return; }
    for (let o = 0; o < 8; o++) walk(store.child(id, o), level - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
  };
  walk(root, D, 0, 0, 0);
  if (r !== n) throw new Error(`arenaWords: ${r} words for ${n} voxels`);
  return words;
}
/* The arena as writeVdag's world: { keys, root, D, name, colour, view }.
   `view` is { eye, yaw, pitch } (the player's), or null. */
export function arenaWorld(A, { view = null } = {}){
  const { store, root, D } = arenaShape(A);
  const words = arenaWords(A, store, root, D);
  return { keys: store.snapshot().keys, root, D, name: arenaName(A.X, A.Y, A.Z), view,
           colour: { kind: 'baked', skin: root, words, bits: SAVE_BITS } };
}
export const writeArena = (A, opts = {}) => writeVdag([arenaWorld(A, opts)], { onPhase: opts.onPhase });

/* ---- opening -------------------------------------------------------------------
   The box round what's in a world at level 0, [lo, hi) a side, or null when
   it's empty. A walk that skips a node whose box can't move any bound, and
   takes a full node's box whole (isFull: a count can't tell past level 17). */
export function boundsOf(store, root, D, counts = createCounts(store)){
  if (root === EMPTY) return null;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const walk = (id, level, x, y, z) => {
    if (id === EMPTY) return;
    const s = 2 ** level, b0 = [x * s, y * s, z * s];
    let moves = false;
    for (let a = 0; a < 3 && !moves; a++) if (b0[a] < lo[a] || b0[a] + s > hi[a]) moves = true;
    if (!moves) return;
    if (level === 0 || isFull(store, counts, id, level)){
      for (let a = 0; a < 3; a++){ lo[a] = Math.min(lo[a], b0[a]); hi[a] = Math.max(hi[a], b0[a] + s); }
      return;
    }
    for (let o = 0; o < 8; o++) walk(store.child(id, o), level - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
  };
  walk(root, D, 0, 0, 0);
  return { lo, hi };
}
const up32 = v => Math.ceil(v / CHUNK) * CHUNK;
/* Where a world goes in an arena: { lod, X, Y, Z, at } (at: the arena cell
   of the world's cell (0, 0, 0) at that lod), or null for an empty world.
   A saved arena (its name gives a size it fits at lod 0 from the origin)
   is that size at the origin. Anything else: the finest lod at which its
   box fits ARENA_LIMITS' largest arena, a square of the larger side
   rounded up to 32, at least 128, centred; Y the box's height and 64 over
   it, rounded up to 32, 96 to 256; its bottom on y = 0. */
export function placementOf(store, root, D, name, counts = createCounts(store)){
  const b = boundsOf(store, root, D, counts);
  if (!b) return null;
  const size = sizeOfName(name), [maxXZ, maxY] = [ARENA_LIMITS.size[1], ARENA_LIMITS.height[1]];
  if (size && size.every(v => v > 0 && v % CHUNK === 0) && size[0] <= maxXZ && size[2] <= maxXZ && size[1] <= maxY && b.hi.every((v, a) => v <= size[a]))
    return { lod: 0, X: size[0], Y: size[1], Z: size[2], at: [0, 0, 0] };
  let lod = 0;
  const ext = l => [0, 1, 2].map(a => Math.ceil(b.hi[a] / 2 ** l) - Math.floor(b.lo[a] / 2 ** l));
  while (lod < D && (ext(lod)[0] > maxXZ || ext(lod)[2] > maxXZ || ext(lod)[1] > maxY)) lod++;
  const e = ext(lod), lo = b.lo.map(v => Math.floor(v / 2 ** lod));
  const XZ = Math.max(ARENA_LIMITS.size[0], up32(Math.max(e[0], e[2]))), Y = Math.min(maxY, Math.max(ARENA_LIMITS.height[0], up32(e[1] + 64)));
  return { lod, X: XZ, Y, Z: XZ, at: [Math.floor((XZ - e[0]) / 2) - lo[0], -lo[1], Math.floor((XZ - e[2]) / 2) - lo[2]] };
}
/* A world { store, counts, root, D, name } as an arena: { A, lod, at } (A
   recounted, every chunk dirty), or null when it's empty. colour is its
   field or null (the gamut of each cell's place in the world). */
export function arenaOfWorld(world, colour){
  const { store, root, D, name } = world, counts = world.counts ?? createCounts(store);
  const p = placementOf(store, root, D, name, counts);
  if (!p) return null;
  const { lod, X, Y, Z, at } = p, A = createArena(X, Y, Z), { cells } = A, out = new Float64Array(3), cell = 2 ** lod, S = 2 ** (D - lod);
  const walk = (id, level, x, y, z) => {
    if (id === EMPTY) return;
    if (level === lod){
      let v;
      if (colour){ cellMean(store, counts, colour, id, lod, Math.min(lod, 2), x * cell, y * cell, z * cell, out); v = pack(out[0], out[1], out[2]); }
      else v = gamut((x + 0.5) / S, (y + 0.5) / S, (z + 0.5) / S);
      const ax = x + at[0], ay = y + at[1], az = z + at[2];
      cells[ax + X * (az + Z * ay)] = v;
      return;
    }
    if (id < FIRST_NODE) throw new Error(`arenaOfWorld: a level-${level} node is ${id}`);
    for (let o = 0; o < 8; o++) walk(store.child(id, o), level - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
  };
  walk(root, D, 0, 0, 0);
  A.recount();
  return { A, lod, at, saved: lod === 0 && !!sizeOfName(name) && at.every(v => v === 0) };
}
