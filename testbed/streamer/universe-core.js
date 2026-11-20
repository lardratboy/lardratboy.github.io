/* =====================================================================
   UNIVERSE CORE: worlds drawn as instances (docs/universe-plan.md,
   docs/universe-log.md). Pure: imports scene-core.js's checks and boxes
   only, no DOM, no gl, so it runs in Node, a worker or the page.

   Asked for 2026-11-19: "demonstrating that we can move from world to world
   in a universe of worlds", starting with "simple world instancing with
   different transforms", exact turns first, the grounds lined up.

   An INSTANCE is scene-core's placement, never baked: a world { store,
   root, D } named by a key, drawn in its own frame with a transform.
     at      the world's cube corner, in whole universe voxels
     turn    one of dag-core's 48 Oh elements (e >> 3 the permutation,
             e & 7 the flips), about the world's cube centre
     scale   2^scale universe voxels a world voxel
   Turn about the centre, scale, move: childFrame's order. A whole-voxel
   offset, a signed permutation and a power of two keep every box a box in
   both frames, so the cut, collision and occlusion stay exact (§2).

   A UNIVERSE is { worlds, instances }, the worlds by key, each named by any
   number of instances. stream-core's selectForest cuts every instance at
   once with the eye mapped into each one's frame (toLocal), and its cache
   holds a world's chunks once, however many copies draw them.

   THE PLANE (§4): planeOf lays worlds out on a grid with every ground at
   one height, and fills the rest with flat ground: instances of a few flat
   worlds of side 2^k, never under a world that brings its own ground.

   THE DEMO (step 3, universe-plan question 1): demoUniverse(seed) is the
   page's `universe:<seed>`, the kit, the city and the scatter, some of them
   twice at other turns about y; tintOf and tintAt are the far view's tint a
   world (Q8). dirToLocal is toLocal's linear part, for rays (the orbit
   camera's pick).

   WALKING ACROSS (step 4): universeWorld is the walker's world, scene-core's
   compositeWorld with the instances as its children in an empty parent, so
   each world is asked in its own frame and a box on a border asks both
   sides; universeHoles turns each world's holes (the dungeon's secret
   doors) into the universe with every copy.
   ===================================================================== */
import { EMPTY } from './dag-core.js';
import { checkPlacement, contentBox, compositeWorld, Y_TURNS } from './scene-core.js';

const PERM = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/* ---- an instance's frame ---------------------------------------------------
   A world point v (world voxels, 0…R on each axis) lands at
     u[i] = at[i] + k · (fl[i] ? R − v[P[i]] : v[P[i]]),   k = 2^scale,
   which is rotateOcc's map on box coordinates (scatter-core), scaled and
   moved. Both directions are exact in float64 for any eye a page holds:
   the only division is by a power of two. */
export function frameOf(inst, D){
  const e = inst.turn ?? 0, s = inst.scale ?? 0;
  return { D, R: 2 ** D, s, k: 2 ** s, turn: e, P: PERM[e >> 3], fl: [e & 1, e >> 1 & 1, e >> 2 & 1], at: inst.at };
}
// A universe point to the world's voxels.
export function toLocal(f, u, out = [0, 0, 0]){
  for (let i = 0; i < 3; i++){
    const w = (u[i] - f.at[i]) / f.k;
    out[f.P[i]] = f.fl[i] ? f.R - w : w;
  }
  return out;
}
/* A universe direction (a ray's) to the world's frame: toLocal's linear part,
   so toLocal(f, o + t·d) = toLocal(f, o) + t·dirToLocal(f, d) and a ray's t
   is the same number in either frame (edit-core's pick takes d unnormalised). */
export function dirToLocal(f, d, out = [0, 0, 0]){
  for (let i = 0; i < 3; i++){
    const w = d[i] / f.k;
    out[f.P[i]] = f.fl[i] ? -w : w;
  }
  return out;
}
// A world point to the universe.
export function toUniverse(f, v, out = [0, 0, 0]){
  for (let i = 0; i < 3; i++){
    const a = v[f.P[i]];
    out[i] = f.at[i] + f.k * (f.fl[i] ? f.R - a : a);
  }
  return out;
}
/* A world box [lo, hi) to the universe's box [lo, hi). A turned box is still
   a box: each axis is one source axis, maybe flipped, so its ends swap. */
export function boxToUniverse(f, lo, hi){
  const ulo = [0, 0, 0], uhi = [0, 0, 0];
  for (let i = 0; i < 3; i++){
    const j = f.P[i], a = f.fl[i] ? f.R - hi[j] : lo[j], b = f.fl[i] ? f.R - lo[j] : hi[j];
    ulo[i] = f.at[i] + f.k * a; uhi[i] = f.at[i] + f.k * b;
  }
  return { lo: ulo, hi: uhi };
}
export const cubeOf = f => boxToUniverse(f, [0, 0, 0], [f.R, f.R, f.R]);
/* The linear part, for the vertex shader: a world vector (eye-relative, say)
   to a universe vector, as a column-major mat3 (GLSL's order). Row i has
   ±k in column P[i]. */
export function turnMatrix(f){
  const m = new Float32Array(9);
  for (let i = 0; i < 3; i++) m[f.P[i] * 3 + i] = f.fl[i] ? -f.k : f.k;
  return m;
}
// Does turn e keep up up? Its y comes from y, unflipped: the turns about y.
export const keepsUp = e => PERM[e >> 3][1] === 1 && !(e & 2);

/* ---- the universe ------------------------------------------------------------
   worlds     a Map (or an object) of key → { store, root, D, ground? }.
              ground is the datum (§4): the y a walker stands on at the
              world's edges, in its own voxels, or null for a world with
              none (a file, a shape), which stands on the plane instead.
   instances  [{ world: key, at, turn, scale }]
   Each instance gets its frame and its content's box in the universe
   (`content`, null for an empty world). **Overlaps are refused** until their
   rule is decided (universe-plan question 2): two instances whose content
   boxes meet. Boxes that only touch are fine, which is a gap of zero. */
const boxMemo = new WeakMap();
function worldBox(w){
  let b = boxMemo.get(w);
  if (b === undefined){ b = contentBox(w.store, w.root, w.D); boxMemo.set(w, b); }
  return b;
}
export function createUniverse(worlds, instances){
  const map = worlds instanceof Map ? worlds : new Map(Object.entries(worlds));
  const out = [];
  for (const [n, inst] of instances.entries()){
    const w = map.get(inst.world);
    if (!w) throw new Error(`universe: instance ${n} names a world '${inst.world}' it doesn't have`);
    checkPlacement({ world: w, at: inst.at, turn: inst.turn ?? 0, scale: inst.scale ?? 0 });
    const frame = frameOf(inst, w.D), box = worldBox(w);
    out.push({ world: inst.world, at: inst.at.slice(), turn: inst.turn ?? 0, scale: inst.scale ?? 0, frame,
               cube: cubeOf(frame), content: box ? boxToUniverse(frame, box.lo, box.hi) : null });
  }
  const meet = (a, b) => [0, 1, 2].every(i => a.lo[i] < b.hi[i] && b.lo[i] < a.hi[i]);
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++){
    const a = out[i].content, b = out[j].content;
    if (a && b && meet(a, b)) throw new RangeError(`universe: instances ${i} (${out[i].world}) and ${j} (${out[j].world}) overlap, and overlaps aren't decided yet`);
  }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const { cube } of out) for (let i = 0; i < 3; i++){ lo[i] = Math.min(lo[i], cube.lo[i]); hi[i] = Math.max(hi[i], cube.hi[i]); }
  return { universe: true, worlds: map, instances: out, box: out.length ? { lo, hi } : null };
}
/* The first instance whose cube holds universe point p, or −1: the HUD's
   "you are in". planeOf lists the tiles before the flat ground, so a tile
   wins over the filler whose cube a groundless world's cube shares. */
export function instanceAt(u, p){
  return u.instances.findIndex(({ cube }) => [0, 1, 2].every(i => p[i] >= cube.lo[i] && p[i] < cube.hi[i]));
}

/* ---- walking across worlds (step 4) ------------------------------------------------
   The walker asks one question, walk-core's world(lo, hi): is anything in this
   box of voxels? A universe answers it as scene-core's compositeWorld answers it
   for an overlay, which is what an instance is: the instances are the children,
   each box mapped into the world's own voxels (turned, scaled down with the
   *any* rule's outward rounding) and asked there by boxHits. A box straddling
   two cubes asks both, so walking off one world onto the next needs nothing at
   the border; the grounds meet flush because planeOf put them at one height.
   compositeWorld is held to bakeScene, by root id, solid, fill and room, in
   scene-core.test.js; universe-core.test.js holds this one to the same
   instances baked, and a walker to the same steps on both.

   The parent is EMPTY: it holds nothing and its store is never asked (boxHits,
   room and fill all stop at EMPTY before they look), so it needs only its side.
   Outside the side is solid (actor-core's rule); the page's openWorld cuts a box
   to [0, side) before asking, which makes outside air beside and above. So
   `side` must be a power of two of at most 2^22 (actor-core's MAX_D, which
   compositeWorld's dagWorld refuses past; universekit §6 is where positions
   become relative), and every instance's cube must lie in [0, side)³, or a
   world drawn outside it would be walked through.

   Each probe tests every instance's content box (compositeWorld's `near`): 21
   for the demo, a few microseconds. A lattice of thousands (step 5) needs a
   grid over them first. */
const NO_STORE = { child(){ throw new Error('universeWorld: the empty parent has no children'); } };
export function universeWorld(u, side, opts){
  const D = Math.log2(side);
  if (!Number.isInteger(D)) throw new RangeError(`universeWorld: a side of ${side} isn't a power of two`);
  if (u.box) for (let i = 0; i < 3; i++)
    if (u.box.lo[i] < 0 || u.box.hi[i] > side) throw new RangeError(`universeWorld: the universe's box [${u.box.lo}, ${u.box.hi}) isn't inside [0, ${side})³`);
  const placements = u.instances.map(x => ({ world: u.worlds.get(x.world), at: x.at, turn: x.turn, scale: x.scale }));
  return compositeWorld({ store: NO_STORE, root: EMPTY, D }, placements, opts);
}
/* Holes, walk-core's withHoles's: boxes [x0, y0, z0, x1, y1, z1) a walker passes
   though the world is solid there (the dungeon's secret doors). A world's are in
   its own voxels, `holesOf(key, world)` gives them (or null), asked once a world;
   every instance of it gets them turned into the universe by boxToUniverse, since
   a box stays a box. A copy at ×2 has doors twice the size, as it has walls. */
export function universeHoles(u, holesOf){
  const out = [], memo = new Map();
  for (const inst of u.instances){
    if (!memo.has(inst.world)) memo.set(inst.world, holesOf(inst.world, u.worlds.get(inst.world)) ?? []);
    for (const h of memo.get(inst.world)){
      const b = boxToUniverse(inst.frame, [h[0], h[1], h[2]], [h[3], h[4], h[5]]);
      out.push([b.lo[0], b.lo[1], b.lo[2], b.hi[0], b.hi[1], b.hi[2]]);
    }
  }
  return out;
}

/* ---- the plane (§4) ------------------------------------------------------------
   Flat ground is clay's (clay-core: clayDesc({ D: k, lump: 0, ground: true })),
   a slab GROUND_DEPTH deep under its cube's centre plane, so its datum is
   2^(k − 1). Clay's smallest world is D = 8, so the smallest flat tile is 256,
   and every world on the plane sits on a 256 grid (`unit`). The test holds
   flatGround to clayVoxel. */
export const FLAT_MIN_D = 8, FLAT_UNIT = 2 ** FLAT_MIN_D;
export const flatGround = k => 2 ** (k - 1);
export const flatKey = k => 'flat:' + k;

/* worlds  as createUniverse's (a groundless world needs its store and root,
           for its content box; a grounded one only D and ground)
   tiles   [{ world: key, turn, scale }], laid out row by row, `cols` a row,
           x across and z down, each centred in its cell (rounded down to
           the unit)
   opts    cols; cell, the cell's side (default the largest world's); gap
           between cells (default 0, worlds touching when they fill their
           cell); unit (FLAT_UNIT); flat (true: fill the plane); Y, a
           plane's height given (it throws if a ground stands higher); flatMax,
           the largest flat tile's k (the endless lattice's 8, step 5)
   Returns { instances (the tiles', then the flat ones), flats (the flat
   worlds' k, sorted), Y (the plane's height), size: [x, z] }. A grounded
   world must keep up up (keepsUp) and fill whole units; the cell and the gap
   must be whole units, so the fill comes out in tiles of 2^k ≥ unit with
   nothing left over. Each flat tile is the largest aligned square that
   meets no grounded world's footprint, a quadtree over the plane. */
export function planeOf(worlds, tiles, { cols, cell = null, gap = 0, unit = FLAT_UNIT, flat = true, Y: fixedY = null, flatMax = Infinity } = {}){
  const map = worlds instanceof Map ? worlds : new Map(Object.entries(worlds));
  if (!Number.isInteger(cols) || cols < 1) throw new RangeError(`planeOf: cols ${cols}`);
  if (flat && unit < FLAT_UNIT) throw new RangeError(`planeOf: flat ground comes in tiles of ${FLAT_UNIT} or more (clay's smallest world), so the unit can't be ${unit}`);
  if (flat && 2 ** flatMax < unit) throw new RangeError(`planeOf: flat tiles of at most 2^${flatMax} can't fill units of ${unit}`);
  const placed = tiles.map((t, n) => {
    const w = map.get(t.world);
    if (!w) throw new Error(`planeOf: tile ${n} names a world '${t.world}' it doesn't have`);
    const turn = t.turn ?? 0, scale = t.scale ?? 0, side = 2 ** (w.D + scale), grounded = w.ground != null;
    let lift;    // how far above its cube's bottom the world meets the plane, in universe voxels
    if (grounded){
      if (!keepsUp(turn)) throw new RangeError(`planeOf: tile ${n} (${t.world}) has a ground, so it turns about y only; turn ${turn} doesn't`);
      if (side % unit) throw new RangeError(`planeOf: tile ${n} (${t.world}) is ${side} a side, not whole units of ${unit}`);
      lift = w.ground * 2 ** scale;
      if (!Number.isInteger(lift)) throw new RangeError(`planeOf: tile ${n} (${t.world}) at scale ${scale} puts its ground between voxels`);
    } else {
      // Scaled down, the content's bottom can fall inside a voxel: rounded
      // down, it stands a fraction above the plane rather than in it.
      const box = worldBox(w);
      lift = box ? Math.floor(boxToUniverse(frameOf({ at: [0, 0, 0], turn, scale }, w.D), box.lo, box.hi).lo[1]) : 0;
    }
    return { n, t, w, turn, scale, side, grounded, lift };
  });
  const big = Math.max(unit, ...placed.map(p => p.side));
  cell ??= Math.ceil(big / unit) * unit;
  if (cell % unit || gap % unit || gap < 0) throw new RangeError(`planeOf: the cell (${cell}) and the gap (${gap}) must be whole units of ${unit}`);
  if (big > cell) throw new RangeError(`planeOf: a world of side ${big} doesn't fit a cell of ${cell}`);
  const pitch = cell + gap, rows = Math.ceil(tiles.length / cols), size = [cols * pitch - gap, rows * pitch - gap];
  const feet = [];
  for (const p of placed){
    const off = Math.floor((cell - p.side) / 2 / unit) * unit;
    p.x = (p.n % cols) * pitch + off; p.z = Math.floor(p.n / cols) * pitch + off;
    if (p.grounded) feet.push([p.x, p.z, p.x + p.side, p.z + p.side]);
  }
  const squares = [];
  if (flat){
    let S = unit;
    while (S < size[0] || S < size[1]) S *= 2;
    const meets = (x, z, s) => feet.some(f => x < f[2] && f[0] < x + s && z < f[3] && f[1] < z + s);
    const inside = (x, z, s) => x + s <= size[0] && z + s <= size[1];
    const fill = (x, z, s) => {
      if (x >= size[0] || z >= size[1]) return;
      if (inside(x, z, s) && !meets(x, z, s) && Math.log2(s) <= flatMax){ squares.push([x, z, Math.log2(s)]); return; }
      if (s === unit) return;         // under a grounded world: whole units, so never half
      const h = s / 2;
      fill(x, z, h); fill(x + h, z, h); fill(x, z + h, h); fill(x + h, z + h, h);
    };
    fill(0, 0, S);
  }
  /* The plane's height: as low as every world's ground and every flat tile's
     centre plane allow, so nothing sits below y = 0. Or a height given
     (`Y`, the endless lattice's, step 5), which must allow them: a cell laid
     out alone must meet its neighbours, whatever's in them. */
  let Y = 0;
  for (const p of placed) Y = Math.max(Y, p.lift);
  for (const [, , k] of squares) Y = Math.max(Y, flatGround(k));
  if (fixedY != null){
    if (Y > fixedY) throw new RangeError(`planeOf: a ground at ${Y} above its cube's bottom won't stand on a plane at ${fixedY}`);
    Y = fixedY;
  }
  const instances = placed.map(p => ({ world: p.t.world, at: [p.x, Y - p.lift, p.z], turn: p.turn, scale: p.scale }));
  for (const [x, z, k] of squares) instances.push({ world: flatKey(k), at: [x, Y - flatGround(k), z], turn: 0, scale: 0 });
  return { instances, flats: [...new Set(squares.map(q => q[2]))].sort((a, b) => a - b), Y, size };
}

/* ---- the demo (step 3) ---------------------------------------------------------
   universe-plan question 1: "kit, city and scatter worlds at first". Nine tiles
   on a 3 × 3 plane, cells of 512 (the city's and the scatter's side): the D = 8
   kit at seeds s, s + 1, s + 2, the D = 9 city at s and s + 1, the D = 9
   scatter at s, and three repeats: the first kit at ×2, and the first kit and
   the first city again at another turn about y (never the first copy's), the
   turns a hash of the seed. Then `files`, the
   shelf's worlds added to the universe (keys the page names), each a tile
   upright on the plane after them. The worlds are named by the page's own ids
   (`kit:2`), so the HUD's "you are in" reads as the world menu does. Every
   world here has a ground, so planeOf needs only D and ground to lay it out:
   universe-core.test.js does that without building one. */
export const DEMO = { kitD: 8, cityD: 9, scatterD: 9, cols: 3 };
const hash = (a, b) => {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d); h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
};
export function demoUniverse(seed = 1, files = []){
  if (!Number.isInteger(seed) || seed < 1) throw new RangeError(`demoUniverse: seed ${seed}`);
  const s = seed, kit = n => 'kit:' + n, city = n => 'city:' + n, scatter = 'scatter:' + s;
  const worlds = [
    ...[s, s + 1, s + 2].map(n => ({ key: kit(n), kind: 'kit', seed: n, D: DEMO.kitD })),
    ...[s, s + 1].map(n => ({ key: city(n), kind: 'city', seed: n, D: DEMO.cityD })),
    { key: scatter, kind: 'scatter', seed: s, D: DEMO.scatterD },
  ];
  // A repeat's turn: one of the three quarter turns about y, so never the first copy's.
  const turn = i => Y_TURNS[1 + hash(s, i) % 3];
  const tiles = [
    { world: kit(s) },     { world: city(s) },                  { world: kit(s + 1) },
    { world: scatter },    { world: kit(s), scale: 1 },         { world: city(s + 1) },
    { world: kit(s + 2) }, { world: city(s), turn: turn(0) },   { world: kit(s), turn: turn(1) },
  ].map(t => ({ world: t.world, turn: t.turn ?? 0, scale: t.scale ?? 0 }));
  for (const key of files){ worlds.push({ key, kind: 'file' }); tiles.push({ world: key, turn: 0, scale: 0 }); }
  return { worlds, tiles, cols: DEMO.cols };
}

/* ---- the tint (Q8) ----------------------------------------------------------------
   "A tint a world in the far view", so a view from far off shows where one
   world ends and the next begins. A hue a kind (the kit warm, the city blue,
   the scatter green, flat ground grey, a file violet), moved a little by the
   world's key so two kits differ, mixed in from lod TINT_FROM up: none at lod
   0 and 1, where a world is seen close and its own colours are what matter,
   then 0.15 a lod to 0.45. */
export const TINT_FROM = 2, TINT_MAX = 0.45;
const TINT_KIND = { kit: [0.95, 0.55, 0.25], city: [0.3, 0.55, 0.95], scatter: [0.35, 0.85, 0.4], flat: [0.6, 0.6, 0.6], file: [0.75, 0.45, 0.9], dungeon: [0.85, 0.3, 0.3] };
export function tintOf(key){
  const kind = key.slice(0, key.indexOf(':')), base = TINT_KIND[kind] ?? TINT_KIND.file;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = hash(h, key.charCodeAt(i));
  const j = ((h & 255) / 255 - 0.5) * 0.2;
  return base.map(v => Math.min(1, Math.max(0, v + j)));
}
export const tintAt = lod => lod < TINT_FROM ? 0 : Math.min(TINT_MAX, 0.15 * (lod - TINT_FROM + 1));

/* ---- the endless lattice (step 5) -----------------------------------------------------
   universe-plan step 5: "a lattice of worlds could support what seems like endless".
   `endless:<seed>` has no list of worlds. The plane is cut into square CELLS of 512
   (the city's, the scatter's and the dungeon's side, two D = 8 kits' or one at ×2),
   numbered (i, j) over all the integers, and a cell's world is a function of
   (seed, i, j) alone (cellOf), so the same seed makes the same universe whichever
   way you fly in, for as long as you fly.

   DISTRICTS, from a slow field: a jittered grid of district centres, one every
   DISTRICT cells each way, each cell in the district of the nearest centre (integer
   squared distances, ties by hash, so every engine agrees). A district has a kind
   (kits, cities, dungeons, the scatter, a park, the shelf's files) and a base seed;
   its cells draw their worlds from a POOL of a few seeds around the base, so a
   district repeats its worlds, turned about y, and instancing earns its keep: a
   world built once is drawn by every cell that names it. One cell in ten is a park.
   The scatter, the costly one (0.9 s to build in Node, 35,000 nodes), has three
   seeds in the whole universe.

   THE PLANE'S HEIGHT is fixed for the whole lattice (endlessOf's Y): the highest
   ground any cell could bring (each kind's datum, the kit's at ×2, a file's content
   bottom, the flat tiles' centre plane), so a cell laid out alone always meets its
   neighbours, and a world arriving never moves the others. Flat ground is one world,
   flat:8, in tiles of 256 (planeOf's flatMax): a park is four of them.

   THE WINDOW (endlessWindow) is what the page installs: the cells within `radius` of a
   centre cell (a disc), laid out by planeOf one cell at a time, in coordinates whose
   origin is the window's low corner cell, `radius` cells below the centre on x and z.
   So every coordinate the page holds is under (2·radius + 1)·512 across, whatever
   cell you're in: the eye's origin rolls with it (universe-plan §7 step 5), and the
   walker's universeWorld, whose side stops at 2^22, always holds it. A cell whose
   world isn't built yet is laid out as a park, and gets its world when it lands. The
   window also lists the worlds it wants, nearest first: what to build next.

   RE-CENTRING (recentre) waits until the eye is `margin` voxels past the centre
   cell's edge, so an eye hovering on a border doesn't re-centre every frame. A new
   centre moves the origin by whole cells, and the page shifts the eye, the walker and
   everything else that holds a position by the same whole number of voxels: exact in
   float64, so nothing on screen moves. `offset` is the origin in absolute voxels,
   for the link (the eye a link holds is absolute).

   THE WORLDS HELD (worldsToDrop): built worlds stay on the main thread under a byte
   budget, every one the window wants kept, the rest dropped least recently wanted
   first, so flying back finds them still built. The chunk workers hold only the
   window's (stream-pool's updateUniverse). */
export const ENDLESS = { cell: 512, radius: 4, district: 4, margin: 64, flatK: FLAT_MIN_D, park: 10 };
/* What a district can be: its weight (out of the weights' sum), the world's depth,
   and its pool (the seeds its cells draw from). A file district exists only when
   the lattice has files (endlessOf). */
export const ENDLESS_KINDS = [
  { kind: 'kit', weight: 7, D: 8, pool: 3 },
  { kind: 'city', weight: 6, D: 9, pool: 2 },
  { kind: 'dungeon', weight: 3, D: 9, pool: 2, floors: 3 },
  { kind: 'scatter', weight: 2, D: 9, pool: 1 },
  { kind: 'park', weight: 1 },
  { kind: 'file', weight: 4 },
];
const SEEDS = 0xffff, SCATTER_SEEDS = 3;
const wrapSeed = s => (s - 1) % SEEDS + 1;
const hash3 = (a, b, c) => hash(hash(a, b), c);

/* The lattice: seed, the plane's Y, and what its cells draw from.
     grounds  each kind's datum, from its own core (kitGround, cityGround,
              dungeonGround, scatterGround at D = 9, which is the same for
              every seed: the hills are a fixed shape)
     files    the shelf's worlds it may draw too: [{ key, world: { store,
              root, D } }]; one wider than a cell is left out */
export function endlessOf(seed, { grounds, files = [] } = {}){
  if (ENDLESS.district > 5) throw new RangeError('endless: districtOf searches the squares round a cell\'s own, which is enough only for districts of 5 cells or fewer');
  if (!Number.isInteger(seed) || seed < 1 || seed > SEEDS) throw new RangeError(`endless: seed ${seed} is outside 1…${SEEDS}`);
  const C = ENDLESS.cell, fit = files.filter(f => 2 ** f.world.D <= C);
  for (const k of ['kit', 'city', 'dungeon', 'scatter'])
    if (!Number.isInteger(grounds?.[k]) || grounds[k] < 0) throw new RangeError(`endless: no datum for the ${k}`);
  // The highest any cell's ground could stand: the kit's at ×2 too, and each file's content bottom.
  let Y = flatGround(ENDLESS.flatK);
  for (const k of ['kit', 'city', 'dungeon', 'scatter']) Y = Math.max(Y, grounds[k]);
  Y = Math.max(Y, 2 * grounds.kit);
  for (const f of fit){ const b = worldBox(f.world); if (b) Y = Math.max(Y, Math.floor(b.lo[1])); }
  const kinds = ENDLESS_KINDS.filter(k => k.kind !== 'file' || fit.length);
  return { endless: true, seed, Y, grounds: { ...grounds }, files: fit.map(f => ({ key: f.key, D: f.world.D })), left: files.length - fit.length,
           kinds, weight: kinds.reduce((a, k) => a + k.weight, 0), ...ENDLESS };
}
/* The district a cell is in: the nearest jittered centre, in doubled coordinates (a
   centre and a cell's middle are both odd), ties to the smaller hash. The squares
   round its own are enough while G ≤ 5: a centre sits at I·G + 0…G − 1 (+ ½), so its
   own square's is at most (G − 1)·√2 away (√18 at G = 4) and one two squares off at
   least G + 1 (5). The test's oracle searches three squares round. */
export function districtOf(L, i, j){
  const G = L.district, I0 = Math.floor(i / G), J0 = Math.floor(j / G);
  let best = null;
  for (let dJ = -1; dJ <= 1; dJ++) for (let dI = -1; dI <= 1; dI++){
    const I = I0 + dI, J = J0 + dJ, h = hash3(L.seed, I, J);
    const cx = 2 * (I * G + h % G) + 1, cz = 2 * (J * G + (h >>> 8) % G) + 1;
    const d = (2 * i + 1 - cx) ** 2 + (2 * j + 1 - cz) ** 2;
    if (!best || d < best.d || (d === best.d && h < best.h)) best = { I, J, h, d };
  }
  let pick = hash3(L.seed ^ 0x2545f491, best.I, best.J) % L.weight, K = L.kinds[0];
  for (const k of L.kinds){ if (pick < k.weight){ K = k; break; } pick -= k.weight; }
  return { I: best.I, J: best.J, kind: K, base: hash3(L.seed ^ 0x6a09e667, best.I, best.J) % SEEDS + 1 };
}
/* A cell's tile: { world (its key, as the page names the world), kind, seed, D,
   turn, scale } for planeOf, or null for a park. Keys name everything that makes the
   world (each kind has one depth here), so two cells naming one key draw one world. */
export function cellOf(L, i, j){
  const d = districtOf(L, i, j), K = d.kind, h = hash3(L.seed ^ 0x3c6ef372, i, j);
  if (K.kind === 'park' || h % L.park === 0) return null;
  const turn = Y_TURNS[(h >>> 4) & 3], pick = (h >>> 8) % (K.pool ?? 1);
  if (K.kind === 'file'){
    const f = L.files[(d.base + (h >>> 8)) % L.files.length];
    return { world: f.key, kind: 'file', seed: null, D: f.D, turn, scale: 0 };
  }
  const seed = K.kind === 'scatter' ? wrapSeed(L.seed + (d.base + pick) % SCATTER_SEEDS) : wrapSeed(d.base + pick);
  const scale = K.kind === 'kit' && ((h >>> 16) & 3) === 0 ? 1 : 0;
  return { world: `${K.kind}:${seed}`, kind: K.kind, seed, D: K.D, turn, scale, ...(K.floors ? { floors: K.floors } : {}) };
}
// The datum of a tile's world, from the lattice (a file's is null: it stands on its content).
export const groundOfTile = (L, t) => t.kind === 'file' ? null : L.grounds[t.kind];
/* The cells within r of a centre, a disc (di² + dj² ≤ r² + r, so the axes reach r),
   nearest first, then by j and i: a fixed order. */
export function cellsAround(c, r){
  const out = [];
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++){
    const d = di * di + dj * dj;
    if (d <= r * r + r) out.push([c[0] + di, c[1] + dj, d]);
  }
  return out.sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
}
/* The window round `centre` (a cell, absolute). `worlds`: the built worlds, key →
   { D, ground, store, root } as planeOf takes them (a world not in it is laid out
   as a park, and wanted). Returns { centre, origin (the low corner's cell),
   offset (the origin in absolute voxels), side (the power of two round the window,
   for universeWorld, the far plane and the fog), instances (createUniverse's),
   cells ([{ i, j, tile, built }], nearest first), want (the tiles of the worlds it
   names, a world once, nearest first) }. */
export function endlessWindow(L, centre, worlds){
  const map = worlds instanceof Map ? worlds : new Map(Object.entries(worlds));
  const r = L.radius, C = L.cell, origin = [centre[0] - r, centre[1] - r], F = 2 ** L.flatK, fk = flatKey(L.flatK);
  const instances = [], cells = [], want = [], named = new Set();
  for (const [i, j] of cellsAround(centre, r)){
    const tile = cellOf(L, i, j), x0 = (i - origin[0]) * C, z0 = (j - origin[1]) * C, built = !!tile && map.has(tile.world);
    if (tile && !named.has(tile.world)){ named.add(tile.world); want.push(tile); }
    if (built){
      const p = planeOf(map, [tile], { cols: 1, cell: C, Y: L.Y, flatMax: L.flatK });
      for (const x of p.instances) instances.push({ world: x.world, at: [x.at[0] + x0, x.at[1], x.at[2] + z0], turn: x.turn, scale: x.scale });
    } else {
      for (let b = 0; b < C; b += F) for (let a = 0; a < C; a += F)
        instances.push({ world: fk, at: [x0 + a, L.Y - flatGround(L.flatK), z0 + b], turn: 0, scale: 0 });
    }
    cells.push({ i, j, tile, built });
  }
  let side = 1;
  while (side < (2 * r + 1) * C) side *= 2;
  return { centre: centre.slice(), origin, offset: [origin[0] * C, 0, origin[1] * C], side, instances, cells, want };
}
// The cell an absolute point is in.
export const cellAt = (L, p) => [Math.floor(p[0] / L.cell), Math.floor(p[2] / L.cell)];
/* The window's centre for an eye at `eye` (the window's coordinates): the centre it
   has, until the eye is more than `margin` past that cell's edge on x or z; then the
   cell the eye is in. */
export function recentre(L, win, eye){
  const C = L.cell, m = L.margin;
  const x0 = (win.centre[0] - win.origin[0]) * C, z0 = (win.centre[1] - win.origin[1]) * C;
  if (eye[0] >= x0 - m && eye[0] < x0 + C + m && eye[2] >= z0 - m && eye[2] < z0 + C + m) return win.centre;
  return [win.origin[0] + Math.floor(eye[0] / C), win.origin[1] + Math.floor(eye[2] / C)];
}
/* Which held worlds go: `held` [{ key, bytes, seen }] (seen: when a window last
   wanted it), `want` the keys the window wants. Every wanted world stays; the
   others go least recently seen first (ties by key) until the rest fit `budget`
   bytes. */
export function worldsToDrop(held, want, budget){
  let total = 0;
  for (const h of held) total += h.bytes;
  const cold = held.filter(h => !want.has(h.key)).sort((a, b) => a.seen - b.seen || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const out = [];
  for (const h of cold){ if (total <= budget) break; out.push(h.key); total -= h.bytes; }
  return out;
}
