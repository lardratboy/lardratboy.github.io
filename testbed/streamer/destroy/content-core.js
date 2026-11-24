/* CONTENT CORE: what stands in the arena (destroy/README.md). Pure: the
   repo's cores make the shapes, this lays them out on a thick flat plane
   and stamps them into an arena-core grid.

   Three kinds of thing, as asked (2026-11-21: "loadable .vdag worlds,
   specimen, math shapes on a thick flat plane"):
   - SPECIMENS, block-showroom's, by lattice-core's recipe sampler (the
     same recipes the lattice and kit draw), R from 12 to 32, a third of
     them at twice the size (each voxel a 2³ block) so some read as
     buildings to a walker 4.5 voxels tall; coloured by a hashed material
     with light bands by height, so a specimen looks built of something;
   - MATH SHAPES, math-core's voxelize of the 45 surfaces and solids, R
     within the shape's own size range and the arena's room, a hashed yaw,
     coloured by the gamut of the object's own frame (the math world's
     colour, repeat 1);
   - .VDAG WORLDS, any file the viewer opens, walked from the DAG to the
     lod at which its side fits (`fitLod`: the any rule, a cell solid if
     anything under it is), coloured by its own field (cellMean, as export/
     does, so a baked file shows its words) or the gamut where it has none,
     and trimmed to what's in it.

   An ITEM is a dense box of cells: { name, sx, sy, sz, cells: Uint16Array }
   with x fastest, then y, then z (fromDense's order), 0 air, else an
   arena-core cell. Items stand on the plane: the box's lowest layer
   (after trim, never empty) sits on the plane's top.

   THE PLANE is `plane` voxels deep across the whole arena: bedrock at y =
   0, stone, dirt, and a grass top in 16-voxel tiles of two greens (a scale
   to read speed and distance by). */
import { pack, fromRgb8, hash4, createArena } from './arena-core.js';
import { buildRecipe } from '../lattice-core.js';
import { MATH_SHAPES, voxelize, sizeRange } from '../math-core.js';
import { cellMean } from '../chunk-core.js';
import { EMPTY, FIRST_NODE } from '../dag-core.js';

export const ARENA_DEFAULTS = { size: 384, height: 192, plane: 24, seed: 1, specimens: 14, maths: 6 };
export const ARENA_LIMITS = { size: [128, 512], height: [96, 256], plane: [4, 64], seed: [1, 0xffff], specimens: [0, 64], maths: [0, 24] };
const round32 = v => Math.max(32, Math.round(v / 32) * 32);
export function arenaDesc(over = {}){
  const d = { ...ARENA_DEFAULTS, ...over };
  for (const [k, [lo, hi]] of Object.entries(ARENA_LIMITS)) d[k] = Math.min(hi, Math.max(lo, Math.round(Number(d[k]) || ARENA_DEFAULTS[k])));
  d.size = round32(d.size); d.height = round32(d.height);
  d.plane = Math.min(d.plane, d.height - 32);
  return d;
}

/* ---- the plane --------------------------------------------------------------- */
const C = (r, g, b) => pack(r, g, b);
export const BEDROCK = C(40, 40, 46);
export function planeCell(x, y, z, T){
  if (y === 0) return BEDROCK;
  const h = hash4(x, y, z, 11) / 4294967296;
  if (y === T - 1){
    const tile = ((x >> 4) + (z >> 4)) & 1, k = 0.92 + 0.08 * h;
    return tile ? C(92 * k, 134 * k, 66 * k) : C(80 * k, 120 * k, 58 * k);
  }
  if (y >= T - 4){ const k = 0.9 + 0.1 * h; return C(122 * k, 88 * k, 60 * k); }
  const k = 0.88 + 0.12 * h, band = (y >> 2) & 1 ? 1 : 0.94;
  return C(118 * k * band, 116 * k * band, 112 * k * band);
}
export function fillPlane(A, T){
  const { X, Z, cells } = A;
  for (let y = 0; y < T; y++) for (let z = 0; z < Z; z++){ const row = X * (z + Z * y);
    for (let x = 0; x < X; x++) cells[row + x] = planeCell(x, y, z, T); }
}

/* ---- items -------------------------------------------------------------------- */
// The box tight round what's in it (a copy), or null when empty.
export function trimItem(item){
  const { sx, sy, sz, cells } = item;
  let x0 = sx, y0 = sy, z0 = sz, x1 = -1, y1 = -1, z1 = -1;
  for (let z = 0, i = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++, i++){
    if (!cells[i]) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  if (x1 < 0) return null;
  const nx = x1 - x0 + 1, ny = y1 - y0 + 1, nz = z1 - z0 + 1, out = new Uint16Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++){
    const from = (x0) + sx * ((y + y0) + sy * (z + z0));
    out.set(cells.subarray(from, from + nx), nx * (y + ny * z));
  }
  return { ...item, sx: nx, sy: ny, sz: nz, cells: out };
}
export const itemVoxels = item => { let n = 0; for (const v of item.cells) if (v) n++; return n; };

/* An occupancy (x fastest, R³) as an item, each voxel `scale`³, coloured by
   colour(x, y, z) in the occupancy's own voxels. */
export function itemOfOcc(name, occ, R, scale, colour){
  const S = R * scale, cells = new Uint16Array(S * S * S);
  for (let z = 0, i = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++, i++){
    if (!occ[i]) continue;
    const v = colour(x, y, z);
    for (let c = 0; c < scale; c++) for (let b = 0; b < scale; b++){
      const row = S * ((y * scale + b) + S * (z * scale + c)) + x * scale;
      for (let a = 0; a < scale; a++) cells[row + a] = v;
    }
  }
  return trimItem({ name, sx: S, sy: S, sz: S, cells });
}

/* Specimen k of the arena's seed. Materials: brick, sandstone, slate,
   verdigris, ochre, chalk, rust, basalt; a band every 3 voxels a shade
   darker, and a hashed speckle. */
export const MATERIALS = [[170, 82, 62], [214, 186, 130], [92, 102, 118], [86, 158, 140], [204, 150, 60], [226, 222, 210], [150, 78, 46], [66, 64, 70]];
export const SPECIMEN_R = [12, 16, 20, 24, 28, 32];
// What specimen k will be, before it's built: its R, scale and hash. Its box is (R·scale)³ at most.
export function specimenPlan(seed, k){
  const h = hash4(seed, k, 3, 0x5bec);
  return { h, R: SPECIMEN_R[h % SPECIMEN_R.length], scale: (h >>> 8) % 3 === 0 ? 2 : 1 };
}
export function specimenItem(seed, k){
  const { h, R, scale } = specimenPlan(seed, k);
  const occ = buildRecipe({ R, seed, axes: 'random', n: [1, 1, 1] }, k + 1);
  const m = MATERIALS[(h >>> 12) % MATERIALS.length];
  return itemOfOcc(`specimen ${k + 1} (R ${R}${scale > 1 ? ', ×2' : ''})`, occ, R, scale, (x, y, z) => {
    const band = y % 3 === 0 ? 0.86 : 1, sp = 0.92 + 0.1 * hash4(x, y, z, h) / 4294967296;
    return pack(Math.min(255, m[0] * band * sp), Math.min(255, m[1] * band * sp), Math.min(255, m[2] * band * sp));
  });
}

/* Math shape k: the deck is the 45 shapes shuffled by the seed. */
export const GAMUT_LIFT = 40, GAMUT_SPAN = 215;
export const gamut = (u, v, w) => pack(GAMUT_LIFT + GAMUT_SPAN * u, GAMUT_LIFT + GAMUT_SPAN * v, GAMUT_LIFT + GAMUT_SPAN * w);
export function mathDeck(seed){
  const a = MATH_SHAPES.map((_, i) => i);
  for (let k = a.length - 1; k > 0; k--){ const r = hash4(seed, k, 9, 0x3a7) % (k + 1), t = a[k]; a[k] = a[r]; a[r] = t; }
  return a;
}
// What math shape k will be, before it's voxelized (the slow part): its shape, R and yaw. Its box is R³ at most.
export function mathPlan(seed, k, rMax){
  const deck = mathDeck(seed), shape = MATH_SHAPES[deck[k % deck.length]], h = hash4(seed, k, 5, 0x77);
  const [lo, hi] = sizeRange(shape, 32, Math.max(32, Math.min(128, rMax)));
  return { shape, R: lo + (h % (hi - lo + 1)), yaw: (h >>> 10) % 4096 };
}
export function mathItem(seed, k, rMax){
  const { shape, R, yaw } = mathPlan(seed, k, rMax);
  const { occ } = voxelize(shape, R, yaw);
  return itemOfOcc(`${shape.name} (R ${R})`, occ, R, 1, (x, y, z) => gamut((x + 0.5) / R, (y + 0.5) / R, (z + 0.5) / R));
}

/* ---- .vdag worlds ------------------------------------------------------------
   The finest lod at which the world's side, 2^(D − lod) cells, is at most
   maxSide. */
export const fitLod = (D, maxSide) => Math.max(0, D - Math.max(0, Math.floor(Math.log2(Math.max(1, maxSide)))));
/* A DAG world { store, counts, root, D } at lod as an item: every level-lod
   node that isn't EMPTY is a cell (the any rule), its colour the field's
   mean under it (chunk-core's cellMean, descending at most two levels for a
   named field; a baked field answers exactly), or the gamut of its place in
   the world when colour is null. Ids are children-first and a level-0 node
   is EMPTY or FULL, so a node above level 0 is always a real node. */
export function dagItem(name, world, colour, lod){
  const { store, counts, root, D } = world, L = D - lod, S = 2 ** L;
  if (S > 512) throw new RangeError(`dagItem: ${S} cells a side is too many (lod ${lod} of D = ${D})`);
  const cells = new Uint16Array(S * S * S), out = new Float64Array(3), cell = 2 ** lod;
  const walk = (id, level, x, y, z) => {
    if (id === EMPTY) return;
    if (level === lod){
      let v;
      if (colour){ cellMean(store, counts, colour, id, lod, Math.min(lod, 2), x * cell, y * cell, z * cell, out); v = pack(out[0], out[1], out[2]); }
      else v = gamut((x + 0.5) / S, (y + 0.5) / S, (z + 0.5) / S);
      cells[x + S * (y + S * z)] = v;
      return;
    }
    if (id < FIRST_NODE) throw new Error(`dagItem: a level-${level} node is ${id}`);
    for (let o = 0; o < 8; o++) walk(store.child(id, o), level - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
  };
  walk(root, D, 0, 0, 0);
  return trimItem({ name, sx: S, sy: S, sz: S, cells });
}

/* ---- the layout ------------------------------------------------------------------
   Items biggest footprint first, each at the first of 600 hashed places
   where its footprint (with `gap` round it) meets no item placed and no
   part of the spawn's clearing, inside the arena less a margin. The first
   loaded world is tried at the middle first (loaded worlds, `first`,
   go before everything else). An item taller than
   the room over the plane, or with no place, is left out and listed.

   The layout places one item at a time (`createLayout`), so the arena can
   be stamped, and shown, as each thing is made (2026-11-23: the build took
   5 to 10 s on some machines with nothing to look at). For that the order
   can't wait for the things: buildArena orders them by the footprint they
   will have at most, their box before the trim (R², known from the plan
   before the slow voxelize), not the trimmed one, which is why a seed's
   arena moved a little that day. `layoutItems` orders made items by their
   own footprint. Either way an item's places are hashed from its index in
   the list, never from its turn in the order. */
export const layoutOrder = (items, area) => items.map((_, i) => i).sort((a, b) => (items[b].first ? 1 : 0) - (items[a].first ? 1 : 0) || area(b) - area(a));
export function createLayout(desc, spawn){
  const { size: X, height: Y, plane: T, seed } = desc, Z = X, gap = 6, margin = 4, placed = [], left = [];
  const meets = (x0, z0, it) => {
    if (Math.hypot(Math.max(x0 - spawn[0], 0, spawn[0] - (x0 + it.sx)), Math.max(z0 - spawn[2], 0, spawn[2] - (z0 + it.sz))) < 22) return true;
    for (const p of placed) if (x0 < p.x0 + p.item.sx + gap && p.x0 < x0 + it.sx + gap && z0 < p.z0 + p.item.sz + gap && p.z0 < z0 + it.sz + gap) return true;
    return false;
  };
  // Item `it`, number i in the list: its placement (also kept in `placed`), or null (in `left`).
  const place = (it, i) => {
    if (it.sy > Y - T - 4 || it.sx > X - 2 * margin || it.sz > Z - 2 * margin){ left.push({ name: it.name, why: 'too big for the arena' }); return null; }
    const spanX = X - 2 * margin - it.sx, spanZ = Z - 2 * margin - it.sz;
    let at = null;
    if (it.first && !placed.length){ const x0 = Math.floor((X - it.sx) / 2), z0 = Math.floor((Z - it.sz) / 2); if (!meets(x0, z0, it)) at = [x0, z0]; }
    for (let t = 0; t < 600 && !at; t++){
      const x0 = margin + hash4(seed, i, t, 0xa1) % (spanX + 1), z0 = margin + hash4(seed, i, t, 0xb2) % (spanZ + 1);
      if (!meets(x0, z0, it)) at = [x0, z0];
    }
    if (!at){ left.push({ name: it.name, why: 'no room left' }); return null; }
    const p = { item: it, x0: at[0], y0: T, z0: at[1] };
    placed.push(p);
    return p;
  };
  return { placed, left, place };
}
export function layoutItems(items, desc, spawn){
  const L = createLayout(desc, spawn);
  for (const i of layoutOrder(items, i => items[i].sx * items[i].sz)) L.place(items[i], i);
  return { placed: L.placed, left: L.left };
}

export function stampItem(A, it, x0, y0, z0){
  const { sx, sy, sz, cells } = it;
  for (let z = 0, i = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++, i++){
    const v = cells[i];
    if (v && A.inBounds(x0 + x, y0 + y, z0 + z)) A.cells[A.idx(x0 + x, y0 + y, z0 + z)] = v;
  }
}

/* The whole arena: plane, then items (loaded worlds first, then the rest
   biggest first by the box each will have at most), each made, laid out
   and stamped in turn. The walker spawns at the middle of the near edge
   looking in (yaw π is −z, walk-core's wishOf convention). `extra` are
   items made already (the loaded worlds, by the worker that read the
   files). `onPlace(p, voxels)` hears each placement as it's made, before
   the next thing is: the worker posts it, so the page stamps the arena as
   it grows (the plane it lays itself, `fillPlane`). `grid: false` builds
   no grid (the worker's case: the page holds the only one): `A` is null,
   and `count` is the plane plus every placed thing's voxels either way,
   which holds since nothing placed overlaps the plane or another thing. */
export const spawnOf = d => [d.size / 2, d.plane, d.size - 14];
export const SPAWN_YAW = Math.PI;
export function buildArena(desc, extra = [], { onPhase = () => {}, onPlace = null, grid = true } = {}){
  const d = arenaDesc(desc), A = grid ? createArena(d.size, d.height, d.size) : null;
  onPhase('the plane', 0);
  if (A) fillPlane(A, d.plane);
  const rMax = Math.min(128, d.height - d.plane - 24, Math.floor(d.size / 3));
  const plans = [
    ...extra.map(it => ({ first: !!it.first, area: it.sx * it.sz, make: () => it })),
    ...Array.from({ length: d.maths }, (_, k) => { const { shape, R } = mathPlan(d.seed, k, rMax);
      return { area: R * R, what: `${shape.name} (R ${R})`, make: () => mathItem(d.seed, k, rMax) }; }),
    ...Array.from({ length: d.specimens }, (_, k) => { const { R, scale } = specimenPlan(d.seed, k);
      return { area: (R * scale) ** 2, what: `specimen ${k + 1}`, make: () => specimenItem(d.seed, k) }; }),
  ];
  const spawn = spawnOf(d), L = createLayout(d, spawn), order = layoutOrder(plans, i => plans[i].area), placed = [];
  let count = d.size * d.size * d.plane;
  for (const [n, i] of order.entries()){
    const plan = plans[i];
    if (plan.what) onPhase(`thing ${n + 1} of ${order.length}: ${plan.what}`, 0.05 + 0.9 * n / order.length);
    const it = plan.make();
    if (!it) continue;
    const p = L.place(it, i);
    if (!p) continue;
    const voxels = itemVoxels(it);
    count += voxels;
    placed.push({ name: it.name, at: [p.x0, p.y0, p.z0], size: [it.sx, it.sy, it.sz], voxels });
    if (A) stampItem(A, it, p.x0, p.y0, p.z0);
    if (onPlace) onPlace(p, voxels);
  }
  if (A) A.recount();
  return { A, count, desc: d, spawn, yaw: SPAWN_YAW, placed, left: L.left };
}
