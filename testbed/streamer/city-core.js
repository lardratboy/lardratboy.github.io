/* CITY CORE: a city of districts, skyscrapers and buildings whose rooms can
   be walked into, with parks (docs/city-log.md). Pure: imports dag-core.js
   only, no DOM. Asked for 2026-11-17: "a city with different types of sky
   scrapers and buildings filled with rooms can be entered, maybe some parks
   and districts".

   THE GRID. A tile is 8 voxels a side (TILE, a level-3 node), and a storey
   is one tile tall: a floor slab one voxel thick at the bottom, seven of
   air over it, so a walker 4.5 tall (walk-core) has room. The world is
   NT × NT tile columns, NT = 2^(D − 3). Layer ty = 0 (y 0…7) is the ground,
   solid, with the road's asphalt as its top voxel; ty = 1 is the street
   level (a sidewalk, a park's grass, a building's storey 0, each with its
   slab at y = 8), and storey s of a building is ty = 1 + s. So the road is
   one voxel below everything else: the curb is a step the walker takes.

   BLOCKS. The city is NB × NB blocks of 32 tiles (256 voxels), NB =
   2^(D − 8). Each block is a road ring 2 tiles wide (two blocks' rings make
   a street 4 tiles, 32 voxels, wide, with its centre line on the block
   boundary), a sidewalk ring of 1, and a lot area of 26 × 26 tiles. Every
   block has a district: downtown (towers), midtown (offices and tall
   apartments), residential (perimeter blocks of apartments round a garden
   courtyard), suburb (rows of gabled houses round a shared garden),
   industrial (warehouses in yards) or park. Districts go by distance from
   the city's centre, with noise, and industry takes one sector of the
   outskirts. A central park joins 2 × 2 blocks (2 × 1 in a 4 × 4 city),
   and its inner streets are park too. Every lot touches its block's edge,
   so every building has a street front.

   BUILDINGS. A building is tiers of storeys, each tier a rectangle (with
   corner notches, for a cruciform tower) nested inside the one below: a
   podium, a shaft, setbacks. A stair core of 2 × 2 tiles stands in the
   middle of every tier, from the ground to a stair house on the roof (but a
   gabled house's, which stops at its top storey), so every storey and the
   roof can be reached on foot. Each storey's plan is spaces (the core, a
   corridor ring round it and a spine, rooms packed as rectangles) joined
   by a spanning tree of doors, the dungeon's join on a small scale, so
   every room is reachable; the ground storey has the street door, and a
   tier above a terrace has a door onto it. Walls stand between any two
   spaces, half on each side (two voxels thick inside, one outside), which
   is what keeps a wall junction free of pinholes without corner posts.
   Windows are open in the walls (glazed solid only on glass towers), their
   sills two voxels high and openings four tall: a walker can look out but
   not step out (the shops' fronts at street level excepted).

   THE STAIR. The core's two lanes run along z; storey s climbs one lane
   (s even: the −x lane, going +z; odd: the +x lane, going −z), one voxel up
   a voxel over 8, so the next storey's flight starts where this one ends.
   The slab is open over the flight below for headroom. The core has a door
   on its −x side at each end: one onto the landing a storey's flight leaves
   from, and one onto the far landing, which is under the next storey's and
   beside the top of this flight, so without a door of its own nothing could
   walk into it (the walk test found it, docs/city-log.md). Everything about
   a storey depends on its parity only, so a tower's middle storeys repeat
   with period 2 (the build memoizes on it: see buildCity).

   DECISIONS ARE INTEGERS. Hashes (mix), integer arithmetic and squared
   distances only, never Math.sqrt or trigonometry: a seed must make the
   same city in every engine. The world is its descriptor { kind: 'city',
   D, seed }; the colour field rebuilds the plan from it in each worker
   (~10–60 ms; the floor plans are made lazily, building by building).

   A TILE'S CODE is a 30-bit integer (a kind and its fields); a tile's
   voxels are a function of its code alone (tileMats), so every tile with
   the same code is the same level-3 node. */
import { createStore, EMPTY } from './dag-core.js';

export const TILE = 8, TILE_LEVEL = 3, BLOCK_TILES = 32, STOREY = 8;
export const CITY_LIMITS = { D: [9, 13] };
export const CITY_DEFAULTS = { D: 11 };

export function cityDesc({ D = CITY_DEFAULTS.D, seed = 1 } = {}){
  if (!Number.isInteger(D) || D < CITY_LIMITS.D[0] || D > CITY_LIMITS.D[1]) throw new Error(`city: D=${D} is outside ${CITY_LIMITS.D.join('…')}`);
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffff) throw new Error(`city: seed ${seed} is outside 1…65535`);
  return { kind: 'city', D, seed };
}

/* The tallest a tower may be: 70% of the world's height, 90 storeys at most
   (D = 9: 42, D = 10: 87). A spire, a stair house and its roof go above. */
export const maxStoreys = D => Math.min(90, Math.floor((0.7 * 2 ** D - 16) / 8));

/* ---- hashes ----------------------------------------------------------------
   Integer only (Math.imul and shifts), so every engine agrees: dungeon-core's. */
export function mix(...v){
  let h = 0x9e3779b9;
  for (const x of v){ h = Math.imul(h ^ (x | 0), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; }
  return h >>> 0;
}
/* A choice of n from a hash. Hashes are uint32, so a shift of one is >>>, never >>:
   h >> 1 of a hash past 2^31 is negative, and pick gave −1, which put a park's
   pond on the road at the world's edge (docs/city-log.md). pick coerces anyway. */
const pick = (h, n) => (h >>> 0) % n;

/* ---- names ------------------------------------------------------------------ */
export const DOWNTOWN = 0, MIDTOWN = 1, RESIDENTIAL = 2, SUBURB = 3, INDUSTRIAL = 4, PARK = 5;
export const DISTRICT_NAMES = ['downtown', 'midtown', 'residential', 'suburb', 'industrial', 'park'];
export const TOWER = 0, OFFICE = 1, APARTMENT = 2, HOUSE = 3, WAREHOUSE = 4;
export const TYPE_NAMES = ['tower', 'office', 'apartment', 'house', 'warehouse'];
// Tower shapes: a deco setback tower, a glass slab, a cruciform, a ziggurat, a slender spire.
export const SETBACK = 0, SLAB = 1, CROSS = 2, STEPPED = 3, SLENDER = 4;
export const TOWER_NAMES = ['setback', 'glass slab', 'cruciform', 'stepped', 'slender'];
// Crowns.
export const C_FLAT = 0, C_SPIRE = 1, C_TANK = 2, C_GABLE = 3, C_SKYLIGHT = 4;

/* The materials, which the colour field reads. */
export const MATERIALS = ['air', 'ground', 'asphalt', 'line', 'zebra', 'pave', 'grass', 'path', 'plaza', 'yard', 'water', 'bark', 'leaf',
  'facade', 'glass', 'floor', 'plaster', 'core', 'step', 'roof', 'parapet', 'metal', 'lamp', 'furniture', 'fabric', 'stone', 'jet', 'shingle', 'attic'];
export const AIR = 0, M_GROUND = 1, M_ASPHALT = 2, M_LINE = 3, M_ZEBRA = 4, M_PAVE = 5, M_GRASS = 6, M_PATH = 7, M_PLAZA = 8, M_YARD = 9,
  M_WATER = 10, M_BARK = 11, M_LEAF = 12, M_FACADE = 13, M_GLASS = 14, M_FLOOR = 15, M_PLASTER = 16, M_CORE = 17, M_STEP = 18,
  M_ROOF = 19, M_PARAPET = 20, M_METAL = 21, M_LAMP = 22, M_FURN = 23, M_FABRIC = 24, M_STONE = 25, M_JET = 26, M_SHINGLE = 27, M_ATTIC = 28;

/* ---- codes -------------------------------------------------------------------
   kind << 26 | fields. 0 is air (no node). The fields, by kind:
     ROOM   a storey's tile: wall (bits 0–3, sides −x +x −z +z), ext (4–7, which
            walls face outside), door (8–11), blank (12–15, outside walls with
            no windows: against a neighbour), style (16–18), use (19–20),
            furniture (21–22), void (23: no slab, a warehouse's hall), finish (24–25)
     CORE   quarter qx (0), qz (1), the storey's parity (2), mode (3–4: 0 the
            ground storey, no hole below; 1 a storey; 2 the stair house; 3 a
            top storey with no flight up)
     ROOF   parapet sides (0–3), feature (4–6), finish (7–8)
     CAP    quarter (0–1)                    (the stair house's roof)
     SPIRE  quarter (0–1), segment (2–3: base, mast, beacon)
     GABLE  across tile i (0–3), across width Wa (4–7), layer (8–10), axis (11)
     GROUND type (0–1: plain, road, pond), mark (2–4)
     SURF   surface (0–2), feature (3–6), orientation (7–8)
     TREE   variant (0: small, big), layer (1–2), shape (3–4)  */
const KS = 26;
export const K_ROOM = 1, K_CORE = 2, K_ROOF = 3, K_CAP = 4, K_SPIRE = 5, K_GABLE = 6, K_GROUND = 7, K_SURF = 8, K_TREE = 9;
export const KIND_NAMES = ['air', 'room', 'core', 'roof', 'cap', 'spire', 'gable', 'ground', 'surface', 'tree'];
export const kindOfCode = code => code >>> KS;
// Facade styles: how a wall facing outside is opened.
export const S_BLANK = 0, S_GRID = 1, S_PAIR = 2, S_CURTAIN = 3, S_GLASS = 4, S_RIBBON = 5, S_SHOP = 6, S_CLERE = 7;
// Uses of a room tile, for its furniture and floor.
export const U_PLAIN = 0, U_OFFICE = 1, U_HOME = 2, U_LOBBY = 3;
export const CORE_GROUND = 0, CORE_STOREY = 1, CORE_HOUSE = 2, CORE_LAST = 3;
export const R_NONE = 0, R_AC = 1, R_TANK = 2, R_SKYLIGHT = 3, R_VENT = 4;
export const G_PLAIN = 0, G_ROAD = 1, G_POND = 2;
export const MK_NONE = 0, MK_LINE_X = 1, MK_LINE_Z = 2, MK_ZEBRA_X = 3, MK_ZEBRA_Z = 4;
export const SF_PAVE = 0, SF_GRASS = 1, SF_PATH = 2, SF_PLAZA = 3, SF_YARD = 4;
export const F_NONE = 0, F_LAMP = 1, F_TRUNK = 2, F_TRUNK_BIG = 3, F_BENCH = 4, F_PLANTER = 5, F_FOUNTAIN = 6, F_CRATE = 7, F_BUSH = 8;

export const roomCode = ({ wall = 0, ext = 0, door = 0, blank = 0, style = 0, use = 0, furn = 0, vd = 0, finish = 0 }) =>
  (K_ROOM << KS | wall | ext << 4 | door << 8 | blank << 12 | style << 16 | use << 19 | furn << 21 | vd << 23 | finish << 24) >>> 0;
export const coreCode = (qx, qz, par, mode) => (K_CORE << KS | qx | qz << 1 | par << 2 | mode << 3) >>> 0;
const roofCode = (parapet, feature, finish) => (K_ROOF << KS | parapet | feature << 4 | finish << 7) >>> 0;
const capCode = q => (K_CAP << KS | q) >>> 0;
const spireCode = (q, seg) => (K_SPIRE << KS | q | seg << 2) >>> 0;
const gableCode = (i, Wa, j, axis) => (K_GABLE << KS | i | Wa << 4 | j << 8 | axis << 11) >>> 0;
const groundCode = (type, mark = 0) => (K_GROUND << KS | type | mark << 2) >>> 0;
const surfCode = (s, f = 0, o = 0) => (K_SURF << KS | s | f << 3 | o << 7) >>> 0;
const treeCode = (variant, layer, shape) => (K_TREE << KS | variant | layer << 1 | shape << 3) >>> 0;
const popcount4 = v => (v & 1) + (v >> 1 & 1) + (v >> 2 & 1) + (v >> 3 & 1);
// Sides 0…3 are −x, +x, −z, +z; a step along side d is DX[d], DZ[d]; the side across is d ^ 1.
export const DX = [-1, 1, 0, 0], DZ = [0, 0, -1, 1];

/* ---- a tile's voxels -----------------------------------------------------------
   The 8³ block of a code, as a material a voxel, x + 8·(y + 8·z) (fromDense's
   order). Measures, in voxels of the tile: a slab at y = 0, so you stand at 1;
   walls on the tile's edge (x = 0 for −x, 7 for +x); a door 4 wide (2…5 along
   the wall) and 6 tall (1…6); windows by style (windowAt), never at a corner:
   a voxel two walls cover is always solid. Furniture keeps two voxels clear
   round it (it stands in 3…4, or is one voxel high and walked over), so a
   walker always gets past. */
export function windowAt(style, a, y){
  switch (style){
    case S_GRID: return a >= 2 && a <= 5 && y >= 3 && y <= 6 ? 1 : 0;
    case S_PAIR: return (a === 1 || a === 2 || a === 5 || a === 6) && y >= 3 && y <= 6 ? 1 : 0;
    case S_CURTAIN: return a >= 1 && a <= 6 && y >= 3 && y <= 6 ? 1 : 0;
    case S_GLASS: return a >= 1 && a <= 6 && y >= 2 && y <= 6 ? 2 : 0;   // 2: glazed, solid
    case S_RIBBON: return y >= 3 && y <= 5 ? 1 : 0;
    case S_SHOP: return a >= 1 && a <= 6 && y >= 2 && y <= 6 ? 1 : 0;   // a shop front: a sill of one, walked through
    case S_CLERE: return a >= 1 && a <= 6 && y >= 5 && y <= 6 ? 1 : 0;
  }
  return 0;
}
const I8 = (x, y, z) => x + 8 * (y + 8 * z);
const kindCache = new Map();
export function tileMats(code){
  let out = kindCache.get(code);
  if (out) return out;
  out = new Uint8Array(512);
  const k = code >>> KS, p = code & ((1 << KS) - 1);
  if (k === K_ROOM) roomMats(p, out);
  else if (k === K_CORE) coreMats(p, out);
  else if (k === K_ROOF) roofMats(p, out);
  // The stair house's roof: core concrete, not roof, as nothing climbs onto it.
  else if (k === K_CAP){ for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) out[I8(x, 0, z)] = M_CORE; }
  else if (k === K_SPIRE) spireMats(p, out);
  else if (k === K_GABLE) gableMats(p, out);
  else if (k === K_GROUND) groundMats(p, out);
  else if (k === K_SURF) surfMats(p, out);
  else if (k === K_TREE) treeMats(p, out);
  else if (k !== 0) throw new Error(`city: no tile kind ${k} (code ${code})`);
  kindCache.set(code, out);
  return out;
}
function roomMats(p, out){
  const wall = p & 15, ext = p >> 4 & 15, door = p >> 8 & 15, blank = p >> 12 & 15, style = p >> 16 & 7, use = p >> 19 & 3, furn = p >> 21 & 3, vd = p >> 23 & 1;
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++){
    const on = [x === 0, x === 7, z === 0, z === 7];
    let covered = 0;
    for (let d = 0; d < 4; d++) if (wall >> d & 1 && on[d]) covered |= 1 << d;
    for (let y = 0; y < 8; y++){
      let m;
      if (covered){
        // Solid unless every wall over this voxel is open here; a corner (two walls) never is.
        let open = popcount4(covered) === 1, glass = false, outside = false, doorway = false;
        for (let d = 0; d < 4; d++){
          if (!(covered >> d & 1)) continue;
          const a = d < 2 ? z : x;
          let o = 0;
          if (door >> d & 1 && a >= 2 && a <= 5){ doorway = true; o = y >= 1 && y <= 6 ? 1 : 0; }
          else if (ext >> d & 1 && !(blank >> d & 1)) o = windowAt(style, a, y);
          if (!o) open = false;
          if (o === 2) glass = true;
          if (ext >> d & 1) outside = true;
        }
        // A doorway's threshold is floor, as the rooms' on either side.
        m = open ? (glass ? M_GLASS : AIR) : doorway && y === 0 ? M_FLOOR : outside ? M_FACADE : M_PLASTER;
      } else m = y === 0 && !vd ? M_FLOOR : AIR;
      out[I8(x, y, z)] = m;
    }
  }
  if (!furn) return;
  const put = (x0, x1, z0, z1, y0, y1, m) => { for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out[I8(x, y, z)] = m; };
  if (use === U_HOME){
    // A bed and its pillow, walked over. Two wide: four (2…5) left a voxel each side in a room a tile
    // wide, and the pillow faced the door, so the walk test found the bed and the floor past it cut off.
    if (furn === 1){ put(3, 4, 2, 5, 1, 1, M_FABRIC); put(3, 4, 2, 2, 2, 2, M_FABRIC); }
    else if (furn === 2) put(3, 4, 3, 4, 1, 2, M_FURN);                                   // a table
    else put(2, 5, 3, 4, 1, 1, M_FABRIC);                                                  // a sofa's seat
  } else if (use === U_PLAIN){ put(3, 4, 3, 4, 1, 6, M_METAL); }                             // a warehouse's rack
  else if (furn === 2){ put(3, 4, 3, 4, 1, 1, M_FURN); put(3, 4, 3, 4, 2, 4, M_LEAF); }      // a potted plant
  else put(3, 4, 3, 4, 1, 2, M_FURN);                                                        // a desk, a counter
}
/* The core, a quarter of it a tile (core-local X = 8·qx + x, Z = 8·qz + z,
   0…15). Its own walls round its edge, a divider between the lanes (X 7, 8
   for Z 4…11), lane A at X 1…6 and B at X 9…14, landings at Z 1…3 and
   12…14. This storey's flight is in lane `par` (A climbs +z from Z = 4, B
   −z from Z = 11), step i solid to y = 1 + i, so its last step (i = 7,
   solid to y = 8) is the next storey's slab. The slab is open over the
   flight below, but for that flight's last step: A's below means Z 4…10 in
   lane A, B's Z 5…11 in lane B. The doors: on X = 0, Z 2…5 and 10…13,
   one onto each landing. */
function coreMats(p, out){
  const qx = p & 1, qz = p >> 1 & 1, par = p >> 2 & 1, mode = p >> 3 & 3;
  const flight = mode === CORE_GROUND || mode === CORE_STOREY, hole = mode !== CORE_GROUND, below = 1 - par;
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++){
    const X = 8 * qx + x, Z = 8 * qz + z;
    const wall = (qx === 0 && X === 0) || (qx === 1 && X === 15) || (qz === 0 && Z === 0) || (qz === 1 && Z === 15);
    const doorway = qx === 0 && X === 0 && z >= 2 && z <= 5;
    const lane = X >= 1 && X <= 6 ? 0 : X >= 9 && X <= 14 ? 1 : -1;
    const divider = (X === 7 || X === 8) && Z >= 4 && Z <= 11;
    for (let y = 0; y < 8; y++){
      let m;
      if (wall) m = doorway && y >= 1 && y <= 6 ? AIR : doorway && y === 0 ? M_FLOOR : M_CORE;
      else if (divider) m = M_CORE;
      else if (flight && lane === par && Z >= 4 && Z <= 11){ const i = par === 0 ? Z - 4 : 11 - Z; m = y <= 1 + i ? M_STEP : AIR; }
      else if (y === 0){
        const inHole = hole && lane === below && (below === 0 ? Z >= 4 && Z <= 10 : Z >= 5 && Z <= 11);
        m = inHole ? AIR : M_FLOOR;
      } else m = AIR;
      out[I8(x, y, z)] = m;
    }
  }
}
function roofMats(p, out){
  const parapet = p & 15, feature = p >> 4 & 7;
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++){
    const edge = (parapet & 1 && x === 0) || (parapet & 2 && x === 7) || (parapet & 4 && z === 0) || (parapet & 8 && z === 7);
    out[I8(x, 0, z)] = feature === R_SKYLIGHT && x >= 1 && x <= 6 && z >= 3 && z <= 4 ? M_GLASS : M_ROOF;
    // A parapet two voxels high: the walker's step is one.
    if (edge) for (let y = 0; y <= 2; y++) out[I8(x, y, z)] = M_PARAPET;
  }
  const put = (x0, x1, z0, z1, y0, y1, m) => { for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out[I8(x, y, z)] = m; };
  if (feature === R_AC) put(2, 5, 2, 5, 1, 3, M_METAL);
  else if (feature === R_VENT) put(3, 4, 3, 4, 1, 2, M_METAL);
  else if (feature === R_TANK){
    for (const [x, z] of [[2, 2], [5, 2], [2, 5], [5, 5]]) put(x, x, z, z, 1, 3, M_METAL);
    put(2, 5, 2, 5, 4, 7, M_FURN);
  }
}
// The mast stands on the core's middle, a voxel of it in each quarter's inner corner.
function spireMats(p, out){
  const qx = p & 1, qz = p >> 1 & 1, seg = p >> 2 & 3, cx = qx ? 0 : 7, cz = qz ? 0 : 7;
  for (let y = 0; y < 8; y++){
    out[I8(cx, y, cz)] = seg === 2 && y >= 5 ? (y <= 6 ? M_LAMP : AIR) : M_METAL;
    if (seg === 0) for (const [dx, dz] of [[1, 0], [0, 1], [1, 1]]) out[I8(qx ? cx + dx : cx - dx, y, qz ? cz + dz : cz - dz)] = M_METAL;
  }
}
/* A gable: the roof over a house, its ridge along the longer side. Across it
   (8·Wa voxels) the roof is min(a, 8·Wa − 1 − a) + 1 high, 45°, filled: its
   top two voxels shingle, attic under them. */
function gableMats(p, out){
  const i = p & 15, Wa = p >> 4 & 15, j = p >> 8 & 7, axis = p >> 11 & 1;
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++){
    const a = 8 * i + (axis ? z : x), h = Math.min(a, 8 * Wa - 1 - a) + 1;
    for (let y = 0; y < 8; y++){ const hy = 8 * j + y; out[I8(x, y, z)] = hy < h ? (hy >= h - 2 ? M_SHINGLE : M_ATTIC) : AIR; }
  }
}
function groundMats(p, out){
  const type = p & 3, mark = p >> 2 & 7;
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++){
    for (let y = 0; y < 8; y++) out[I8(x, y, z)] = M_GROUND;
    if (type === G_POND){ out[I8(x, 6, z)] = M_WATER; out[I8(x, 7, z)] = M_WATER; }
    else if (type === G_ROAD){
      let m = M_ASPHALT;
      if (mark === MK_LINE_X && x === 0) m = M_LINE;
      else if (mark === MK_LINE_Z && z === 0) m = M_LINE;
      else if (mark === MK_ZEBRA_X && (x & 3) < 2 && z >= 1 && z <= 6) m = M_ZEBRA;
      else if (mark === MK_ZEBRA_Z && (z & 3) < 2 && x >= 1 && x <= 6) m = M_ZEBRA;
      out[I8(x, 7, z)] = m;
    }
  }
}
const SURF_MAT = [M_PAVE, M_GRASS, M_PATH, M_PLAZA, M_YARD];
function surfMats(p, out){
  const s = p & 7, f = p >> 3 & 15, o = p >> 7 & 3;
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++) out[I8(x, 0, z)] = SURF_MAT[s];
  const put = (x0, x1, z0, z1, y0, y1, m) => { for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out[I8(x, y, z)] = m; };
  if (f === F_LAMP){
    // A post a voxel in from the curb, its lamp over the road side.
    const px = o === 0 ? 1 : o === 1 ? 6 : 3, pz = o === 2 ? 1 : o === 3 ? 6 : 3;
    put(px, px, pz, pz, 1, 6, M_METAL);
    put(px, px, pz, pz, 7, 7, M_LAMP);
    put(px + DX[o], px + DX[o], pz + DZ[o], pz + DZ[o], 7, 7, M_LAMP);
  } else if (f === F_TRUNK) put(3, 3, 3, 3, 1, 7, M_BARK);
  else if (f === F_TRUNK_BIG) put(3, 4, 3, 4, 1, 7, M_BARK);
  else if (f === F_BENCH){ if (o < 2) put(o ? 6 : 1, o ? 6 : 1, 2, 5, 1, 1, M_FURN); else put(2, 5, o === 3 ? 6 : 1, o === 3 ? 6 : 1, 1, 1, M_FURN); }
  else if (f === F_PLANTER){ put(3, 4, 3, 4, 1, 2, M_STONE); put(3, 4, 3, 4, 3, 3, M_LEAF); }
  else if (f === F_FOUNTAIN){
    // A basin a voxel high (its rim and water stood on alike) and a jet in the middle.
    for (let z = 1; z <= 6; z++) for (let x = 1; x <= 6; x++) out[I8(x, 1, z)] = x === 1 || x === 6 || z === 1 || z === 6 ? M_STONE : M_WATER;
    put(3, 4, 3, 4, 2, 6, M_JET);
  } else if (f === F_CRATE) put(2, 5, 2, 5, 1, 2, M_FURN);
  else if (f === F_BUSH) put(2, 5, 2, 5, 1, 2, M_LEAF);
}
/* A tree's canopy over its trunk (SURF's F_TRUNK, ty = 1), in the tree's own
   frame: Y = 8·layer + y above the street level's slab. A small tree's crown
   is centred at Y = 12.5, a big one's at 18, both high enough to walk under
   (the walker is 4.5 tall and stands at Y = 1). The crown is a ball, its
   edge jittered by a hash of the voxel and the tree's shape. */
function treeMats(p, out){
  const big = p & 1, layer = p >> 1 & 3, shape = p >> 3 & 3;
  const cy = big ? 18 : 12.5, r2 = big ? 16 : 9.5, top = big ? 14 : 10;
  for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++){
    const Y = 8 * layer + y, dx = x - 3.5, dy = Y - cy, dz = z - 3.5;
    const trunk = big ? x >= 3 && x <= 4 && z >= 3 && z <= 4 : x === 3 && z === 3;
    if (trunk && Y <= top) out[I8(x, y, z)] = M_BARK;
    else if (dx * dx + 1.4 * dy * dy + dz * dz <= r2 + (mix(x, Y, z, shape, 0x7ee) % 5) - 2) out[I8(x, y, z)] = M_LEAF;
  }
}

/* ---- districts -------------------------------------------------------------------
   Every block gets a score, its squared distance from the centre scaled to
   the city plus noise, and the blocks are ranked by it: the first 8% (one
   at least) are downtown, the next 22% midtown, then residential and
   suburb, and the outer ones in one sector are industrial. The central
   park is placed first, a quarter of the city from the centre the opposite
   way from industry, and a few residential blocks are parks of their own.
   A city of 2 × 2 blocks has a park as its last block. */
const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
function districtsOf(NB, seed){
  const n = NB * NB, district = new Uint8Array(n).fill(255), groupOf = new Int32Array(n).fill(-1), groups = [];
  const jit = NB >= 4, cx2 = NB + (jit ? pick(mix(seed, 1), 3) - 1 : 0), cz2 = NB + (jit ? pick(mix(seed, 2), 3) - 1 : 0);
  const dir = pick(mix(seed, 3), 8), [pdx, pdz] = DIRS[dir], [idx, idz] = DIRS[(dir + 4) % 8];
  const addGroup = (bx, bz, w, d, kind) => {
    const g = groups.length;
    groups.push({ bx, bz, w, d, kind });
    for (let z = bz; z < bz + d; z++) for (let x = bx; x < bx + w; x++){ groupOf[x + NB * z] = g; district[x + NB * z] = kind; }
  };
  if (NB >= 4){
    const pw = 2, pd = NB >= 8 ? 2 : 1, off = NB >= 8 ? NB >> 2 : 1, cbx = cx2 >> 1, cbz = cz2 >> 1;
    const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
    addGroup(clamp(cbx + pdx * off - (pw >> 1), NB - pw), clamp(cbz + pdz * off - (pd >> 1), NB - pd), pw, pd, PARK);
  }
  const rest = [];
  for (let b = 0; b < n; b++){
    if (district[b] !== 255) continue;
    const ox = 2 * (b % NB) + 1 - cx2, oz = 2 * (b / NB | 0) + 1 - cz2;
    rest.push({ b, ox, oz, score: Math.floor((ox * ox + oz * oz) * 4096 / n) + pick(mix(seed, b, 7), 1024) - 512 });
  }
  rest.sort((p, q) => p.score - q.score || p.b - q.b);
  if (NB < 4){ const last = rest.pop(); addGroup(last.b % NB, last.b / NB | 0, 1, 1, PARK); }
  const m = rest.length, nDown = Math.max(1, Math.round(m * 0.08)), nMid = Math.max(m > 1 ? 1 : 0, Math.round(m * 0.22));
  const nRes = Math.round((m - nDown - nMid) * 0.55);
  rest.forEach(({ b, ox, oz }, r) => {
    let k = r < nDown ? DOWNTOWN : r < nDown + nMid ? MIDTOWN : r < nDown + nMid + nRes ? RESIDENTIAL : SUBURB;
    // Industry: the outer blocks within ~41° of its direction.
    const dot = ox * idx + oz * idz, dd = idx * idx + idz * idz;
    if (r >= nDown + nMid && NB >= 4 && dot > 0 && dot * dot * 16 > 9 * (ox * ox + oz * oz) * dd) k = INDUSTRIAL;
    if (k === RESIDENTIAL && NB >= 4 && pick(mix(seed, b, 11), 100) < 7) k = PARK;
    addGroup(b % NB, b / NB | 0, 1, 1, k);
  });
  return { district, groupOf, groups };
}

/* ---- lots ------------------------------------------------------------------------
   Rectangles in the block's lot area (26 × 26 tiles, [0, 26) both ways), each
   with the sides it fronts the street on. Downtown and midtown split the
   area into halves, quarters and strips; residential and the suburb ring it
   with lots round a courtyard and leave a passage through the ring to it. */
const A = 26;
function lotsOf(district, h){
  const L = [];
  const lot = (x, z, w, d, use = 'building') => L.push({ x, z, w, d, use });
  const strip = (along, at, depth, from, to, minW, maxW, k) => {
    // Lots along one side, widths minW…maxW, the last taking what's left.
    let p = from, i = 0;
    while (p < to){
      let w = minW + pick(mix(h, k, i++), maxW - minW + 1);
      if (to - p - w < minW) w = to - p;
      along ? lot(p, at, w, depth) : lot(at, p, depth, w);
      p += w;
    }
  };
  if (district === DOWNTOWN){
    const c = pick(h, 4), ax = h >>> 4 & 1;
    if (c === 0) lot(0, 0, A, A);
    else if (c === 1) ax ? (lot(0, 0, 13, A), lot(13, 0, 13, A)) : (lot(0, 0, A, 13), lot(0, 13, A, 13));
    else if (c === 2) { lot(0, 0, 13, 13); lot(13, 0, 13, 13); lot(0, 13, 13, 13); lot(13, 13, 13, 13); }
    else { lot(0, 0, A, 13); lot(0, 13, 13, 13); lot(13, 13, 13, 13); }
  } else if (district === MIDTOWN){
    const c = pick(h, 3), ax = h >>> 4 & 1;
    if (c === 0){ lot(0, 0, 13, 13); lot(13, 0, 13, 13); lot(0, 13, 13, 13); lot(13, 13, 13, 13); }
    else if (c === 1){ for (const [p, w] of [[0, 9], [9, 8], [17, 9]]) ax ? (lot(p, 0, w, 13), lot(p, 13, w, 13)) : (lot(0, p, 13, w), lot(13, p, 13, w)); }
    else { lot(0, 0, 13, 10); lot(0, 10, 13, 16); lot(13, 0, 13, 16); lot(13, 16, 13, 10); }
  } else if (district === RESIDENTIAL || district === SUBURB){
    // A ring of depth R round a courtyard, and a passage of width 3 through the −z side to it.
    const R = district === RESIDENTIAL ? 9 : 7, minW = district === RESIDENTIAL ? 6 : 4, maxW = district === RESIDENTIAL ? 10 : 6;
    const pass = R + pick(mix(h, 5), A - 2 * R - 3 + 1);
    lot(pass, 0, 3, R, 'passage');
    strip(true, 0, R, 0, pass, minW, maxW, 1);
    strip(true, 0, R, pass + 3, A, minW, maxW, 2);
    strip(true, A - R, R, 0, A, minW, maxW, 3);
    strip(false, 0, R, R, A - R, minW, maxW, 4);
    strip(false, A - R, R, R, A - R, minW, maxW, 5);
    lot(R, R, A - 2 * R, A - 2 * R, 'court');
  } else if (district === INDUSTRIAL){
    const c = pick(h, 3);
    if (c === 0) { lot(0, 0, 13, A); lot(13, 0, 13, A); }
    else if (c === 1) { lot(0, 0, 13, 13); lot(13, 0, 13, 13); lot(0, 13, 13, 13); lot(13, 13, 13, 13); }
    else lot(0, 0, A, A);
  }
  for (const l of L) l.fronts = [l.x === 0, l.x + l.w === A, l.z === 0, l.z + l.d === A].map((v, d) => v ? 1 << d : 0).reduce((a, b) => a | b, 0);
  return L;
}

/* ---- buildings -----------------------------------------------------------------
   From a lot: the footprint (the lot less its setbacks), the type, storeys,
   tiers, the core, styles and the crown. Every count is an integer from a
   hash. The footprint is 4 × 4 tiles at least (the core and the ring round
   it); a lot too small for one is a garden. */
const SETBACK_OF = { [TOWER]: [2, 1], [OFFICE]: [1, 0], [APARTMENT]: [1, 0], [HOUSE]: [1, 0], [WAREHOUSE]: [2, 1] };   // front, other sides
function inTier(T, i, j){
  // i, j in world tiles.
  if (i < T.x0 || j < T.z0 || i >= T.x0 + T.w || j >= T.z0 + T.d) return false;
  const n = T.notch;
  if (!n) return true;
  const a = i - T.x0, b = j - T.z0;
  return !((a < n || a >= T.w - n) && (b < n || b >= T.d - n));
}
function makeBuilding(id, type, x0, z0, W, L, front, h, D, opts = {}){
  const maxS = maxStoreys(D), B = { id, type, x0, z0, W, L, front, hash: h, tiers: [], spire: 0, crown: C_FLAT, shape: -1 };
  // The core: 2 × 2 tiles in the middle, the ring round it inside every tier.
  B.cx = x0 + ((W - 2) >> 1); B.cz = z0 + ((L - 2) >> 1);
  const ring = [B.cx - 1, B.cz - 1, B.cx + 3, B.cz + 3];
  // A tier inset by k (by side: −x, +x, −z, +z) from the footprint, clamped to hold the ring.
  const tier = (k, s0, s1, notch = 0) => {
    const ks = Array.isArray(k) ? k : [k, k, k, k];
    const tx0 = Math.min(ring[0], x0 + ks[0]), tz0 = Math.min(ring[1], z0 + ks[2]);
    const tx1 = Math.max(ring[2], x0 + W - ks[1]), tz1 = Math.max(ring[3], z0 + L - ks[3]);
    const w = tx1 - tx0, d = tz1 - tz0, n = Math.min(notch, Math.min(ring[0] - tx0, tx1 - ring[2], ring[1] - tz0, tz1 - ring[3]));
    return { x0: tx0, z0: tz0, w, d, notch: Math.max(0, n), s0, s1 };
  };
  const u = (k, n) => pick(mix(h, k), n);
  if (type === TOWER){
    const shape = opts.shape ?? u(1, 5);
    let F = opts.F ?? Math.min(maxS, 20 + Math.floor((maxS - 20) * u(2, 1001) * Math.max(250, u(3, 1001)) / 1e6));
    B.shape = shape;
    const P = 2 + u(4, 4);
    if (shape === SETBACK){
      const a = P + Math.floor((F - P) * 6 / 10), b = P + Math.floor((F - P) * 82 / 100);
      B.tiers = [tier(0, 0, P), tier(1, P, a), tier(2, a, b), tier(3, b, F)];
      B.styles = [S_GRID, S_GRID, S_GRID, S_GRID]; B.crown = C_SPIRE; B.spire = 3 + u(5, 4);
    } else if (shape === SLAB){
      B.tiers = [tier(0, 0, P), tier(1, P, F)];
      B.styles = [S_GRID, S_GLASS]; B.crown = C_FLAT;
    } else if (shape === CROSS){
      B.tiers = [tier(0, 0, P), tier(1, P, F, Math.max(1, (Math.min(W, L) - 6) >> 2))];
      B.styles = [S_GRID, u(6, 2) ? S_GLASS : S_CURTAIN]; B.crown = C_SPIRE; B.spire = 2 + u(5, 3);
    } else if (shape === STEPPED){
      const a = Math.floor(F / 3), b = Math.floor(2 * F / 3);
      B.tiers = [tier(0, 0, a), tier(1, a, b), tier(2, b, F)];
      B.styles = [S_RIBBON, S_RIBBON, S_RIBBON]; B.crown = C_FLAT;
    } else {
      B.tiers = [tier(0, 0, P), tier(2, P, F)];
      B.styles = [S_GRID, S_CURTAIN]; B.crown = C_SPIRE; B.spire = 5 + u(5, 4);
    }
    B.groundStyle = S_SHOP; B.glass = B.styles.includes(S_GLASS);
  } else if (type === OFFICE){
    const F = Math.min(maxS, 6 + u(2, 17)), a = Math.floor(F * 7 / 10);
    B.tiers = u(4, 2) && F >= 10 ? [tier(0, 0, a), tier(1, a, F)] : [tier(0, 0, F)];
    const st = u(5, 2) ? S_RIBBON : S_GRID;
    B.styles = B.tiers.map(() => st); B.groundStyle = S_SHOP;
  } else if (type === APARTMENT){
    const F = Math.min(maxS, opts.mid ? 6 + u(2, 9) : 4 + u(2, 6));
    B.tiers = [tier(0, 0, F)]; B.styles = [S_PAIR]; B.groundStyle = opts.mid ? S_SHOP : S_PAIR; B.crown = C_TANK;
  } else if (type === HOUSE){
    const F = 2 + u(2, 3);
    B.tiers = [tier(0, 0, F)]; B.styles = [S_PAIR]; B.groundStyle = S_PAIR; B.crown = C_GABLE;
    // The ridge along the longer side; the gable across the shorter, Wa tiles.
    B.gable = W <= L ? { axis: 0, Wa: W, o: x0 } : { axis: 1, Wa: L, o: z0 };
    B.gableLayers = Math.ceil(4 * B.gable.Wa / 8);
  } else {
    const F = 2 + u(2, 2);
    B.tiers = [tier(0, 0, F)]; B.styles = [S_CLERE]; B.groundStyle = S_CLERE; B.crown = C_SKYLIGHT;
  }
  const last = B.tiers.length - 1;
  B.F = B.tiers[last].s1;
  B.tierOf = new Uint8Array(B.F);
  B.tiers.forEach((T, t) => { for (let s = T.s0; s < T.s1; s++) B.tierOf[s] = t; });
  // Each column's top tier (-1 outside the footprint).
  B.topTier = new Int8Array(W * L).fill(-1);
  for (let j = 0; j < L; j++) for (let i = 0; i < W; i++)
    for (let t = last; t >= 0; t--) if (inTier(B.tiers[t], x0 + i, z0 + j)){ B.topTier[i + W * j] = t; break; }
  B.pal = u(9, 6); B.tint = u(10, 6); B.shingle = u(11, 4);
  B.plans = new Array(4 * B.tiers.length).fill(null); B.roof = null;
  return B;
}
const isCoreCol = (B, i, j) => i >= B.cx && i < B.cx + 2 && j >= B.cz && j < B.cz + 2;
/* The plan a storey uses: 0 a tier's first storey (the street door, or the
   doors onto the terrace below), 1 and 2 the rest by parity, 3 a gabled
   house's top storey (no flight up). Storeys of a tier past its first are
   the same code for code by parity: the build's memo rests on it. */
const planKind = (B, t, s) => s === B.tiers[t].s0 ? 0 : B.crown === C_GABLE && s === B.F - 1 ? 3 : 1 + (s & 1);

/* ---- a storey's plan --------------------------------------------------------------
   The spaces: the core (0); the corridor (1), the ring of tiles round the
   core and, on a long tier, a spine through it to a tile from each end; the
   rest packed into rectangular rooms (2, 3, …). An open storey (a lobby, an
   open office floor, a warehouse's hall) is the core and one space. Then a
   spanning tree of doors from the corridor, breadth first over the spaces,
   each tree edge a door on one tile edge they share (a hash picks which),
   and a few more for loops: every space is reachable. The core's doors are
   the corridor's two tiles on its −x side. */
const LOOP_SHARE = 20, ROOM_MAX = { [TOWER]: [3, 3], [OFFICE]: [3, 3], [APARTMENT]: [3, 2], [HOUSE]: [2, 2], [WAREHOUSE]: [1, 1] };
export function storeyPlan(plan, B, t, kind){
  const slot = 4 * t + kind;
  if (B.plans[slot]) return B.plans[slot];
  const T = B.tiers[t], { W, L } = B, s = kind === 0 ? T.s0 : kind === 3 ? B.F - 1 : -1;
  const par = kind === 0 ? T.s0 & 1 : kind === 3 ? (B.F - 1) & 1 : kind - 1;
  const ground = kind === 0 && t === 0, h = mix(B.hash, t, kind, 0x5107);
  const NTw = plan.NT, sp = new Int32Array(W * L).fill(-1), ci = B.cx - B.x0, cj = B.cz - B.z0;
  const inT = (i, j) => i >= 0 && j >= 0 && i < W && j < L && inTier(T, B.x0 + i, B.z0 + j);
  for (let j = 0; j < L; j++) for (let i = 0; i < W; i++) if (inT(i, j)) sp[i + W * j] = isCoreCol(B, B.x0 + i, B.z0 + j) ? 0 : -2;
  const open = B.type === WAREHOUSE || (ground && B.type !== HOUSE) || ((B.type === TOWER || B.type === OFFICE) && !ground && h % 4 === 0);
  let n = 2;
  if (open){ for (let k = 0; k < W * L; k++) if (sp[k] === -2) sp[k] = 1; }
  else {
    for (let j = cj - 1; j <= cj + 2; j++) for (let i = ci - 1; i <= ci + 2; i++) if (inT(i, j) && sp[i + W * j] === -2) sp[i + W * j] = 1;
    const ti0 = T.x0 - B.x0, tj0 = T.z0 - B.z0;
    if (T.w >= 8 && T.w >= T.d){ for (let i = ti0 + 1; i < ti0 + T.w - 1; i++) if (inT(i, cj - 1) && sp[i + W * (cj - 1)] === -2) sp[i + W * (cj - 1)] = 1; }
    else if (T.d >= 8){ for (let j = tj0 + 1; j < tj0 + T.d - 1; j++) if (inT(ci - 1, j) && sp[ci - 1 + W * j] === -2) sp[ci - 1 + W * j] = 1; }
    const [mw, md] = ROOM_MAX[B.type];
    for (let j = 0; j < L; j++) for (let i = 0; i < W; i++){
      if (sp[i + W * j] !== -2) continue;
      let w = 1 + pick(mix(h, i, j, 1), mw), d = 1 + pick(mix(h, i, j, 2), md), run = 0;
      while (run < w && i + run < W && sp[i + run + W * j] === -2) run++;
      w = run;
      let e = 1;
      for (; e < d && j + e < L; e++){ let ok = true; for (let a = 0; a < w; a++) if (sp[i + a + W * (j + e)] !== -2){ ok = false; break; } if (!ok) break; }
      d = e;
      for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) sp[i + a + W * (j + b)] = n;
      n++;
    }
  }
  // Doors: door[k] holds the sides of tile k with one.
  const door = new Uint8Array(W * L);
  const pairs = new Map(), adj = Array.from({ length: n }, () => []);
  for (let j = 0; j < L; j++) for (let i = 0; i < W; i++){
    const k = i + W * j, a = sp[k];
    if (a < 1) continue;
    for (const d of [1, 3]){
      const ni = i + DX[d], nj = j + DZ[d];
      if (ni >= W || nj >= L) continue;
      const b = sp[ni + W * nj];
      if (b < 1 || b === a) continue;
      const key = Math.min(a, b) * n + Math.max(a, b);
      let e = pairs.get(key);
      if (!e){ e = { a: Math.min(a, b), b: Math.max(a, b), edges: [], key }; pairs.set(key, e); adj[e.a].push(e); adj[e.b].push(e); }
      e.edges.push(k * 4 + d);
    }
  }
  const openDoor = e => {
    const k = e >> 2, d = e & 3, i = k % W, j = k / W | 0;
    door[k] |= 1 << d; door[i + DX[d] + W * (j + DZ[d])] |= 1 << (d ^ 1);
  };
  const seen = new Uint8Array(n), used = new Set(), q = [1];
  seen[1] = 1;
  while (q.length){
    const a = q.shift();
    for (const e of adj[a]){
      const b = e.a === a ? e.b : e.a;
      if (seen[b]) continue;
      seen[b] = 1; q.push(b); used.add(e.key);
      openDoor(e.edges[pick(mix(h, e.key, 0xd00), e.edges.length)]);
    }
  }
  for (let a = 1; a < n; a++) if (!seen[a]) throw new Error(`city: building ${B.id} tier ${t} has a room no door reaches`);
  for (const e of pairs.values()) if (!used.has(e.key) && pick(mix(h, e.key, 0x100b), 100) < LOOP_SHARE) openDoor(e.edges[pick(mix(h, e.key, 0xd01), e.edges.length)]);
  // The core's doors, one onto each landing.
  door[ci - 1 + W * cj] |= 2; door[ci - 1 + W * (cj + 1)] |= 2;
  // The street door (ground) on the front's middle tile; a warehouse's is two wide.
  const sideTile = (Tr, d, off = 0) => {
    const mi = Tr.x0 - B.x0 + (Tr.w >> 1) + (d >= 2 ? off : 0), mj = Tr.z0 - B.z0 + (Tr.d >> 1) + (d < 2 ? off : 0);
    return d === 0 ? Tr.x0 - B.x0 + W * mj : d === 1 ? Tr.x0 - B.x0 + Tr.w - 1 + W * mj : d === 2 ? mi + W * (Tr.z0 - B.z0) : mi + W * (Tr.z0 - B.z0 + Tr.d - 1);
  };
  if (ground){ door[sideTile(T, B.front)] |= 1 << B.front; if (B.type === WAREHOUSE) door[sideTile(T, B.front, -1)] |= 1 << B.front; }
  // Onto the terrace: each side this tier is set back from the one below.
  if (kind === 0 && t > 0){
    const U = B.tiers[t - 1], back = [T.x0 > U.x0, T.x0 + T.w < U.x0 + U.w, T.z0 > U.z0, T.z0 + T.d < U.z0 + U.d];
    for (let d = 0; d < 4; d++) if (back[d]) door[sideTile(T, d)] |= 1 << d;
  }
  // The codes.
  const codes = new Int32Array(W * L), voidHall = B.type === WAREHOUSE && s !== 0 && kind !== 0;
  const mode = ground ? CORE_GROUND : kind === 3 ? CORE_LAST : CORE_STOREY;
  const style = ground ? B.groundStyle : B.styles[t];
  let rooms = 0;
  for (let a = 2; a < n; a++) rooms++;
  for (let j = 0; j < L; j++) for (let i = 0; i < W; i++){
    const k = i + W * j, a = sp[k];
    if (a < 0) continue;
    if (a === 0){ codes[k] = coreCode(i - ci, j - cj, par, mode); continue; }
    let wall = 0, ext = 0, blank = 0;
    for (let d = 0; d < 4; d++){
      const ni = i + DX[d], nj = j + DZ[d];
      if (!inT(ni, nj)){
        wall |= 1 << d; ext |= 1 << d;
        // Against another building (abutting, a party wall): no windows.
        const wx = B.x0 + ni, wz = B.z0 + nj;
        if (wx >= 0 && wz >= 0 && wx < NTw && wz < NTw){ const o = plan.colB[wx + NTw * wz]; if (o >= 0 && o !== B.id) blank |= 1 << d; }
      } else if (sp[ni + W * nj] !== a) wall |= 1 << d;
    }
    const corridor = a === 1 && !open, nearCore = Math.max(Math.abs(2 * i + 1 - 2 * ci - 2), Math.abs(2 * j + 1 - 2 * cj - 2)) <= 3;
    const use = voidHall || B.type === WAREHOUSE ? U_PLAIN : corridor ? U_PLAIN : open && ground ? U_LOBBY
      : B.type === APARTMENT || B.type === HOUSE ? U_HOME : U_OFFICE;
    // A third of a room's tiles have something in them; a lobby the odd plant (it was two in three
    // everywhere at first, and a lobby read as a warehouse of desks).
    let furn = 0;
    if (!door[k] && !corridor && !voidHall && !nearCore){
      if (use === U_LOBBY) furn = pick(mix(h, k, 3), 6) ? 0 : 2;
      else if (!pick(mix(h, k, 3), 3)) furn = 1 + pick(mix(h, k, 4), 3);
    }
    // A hall's upper storeys are void but for a mezzanine, the ring round the core: the core's
    // far landing opens onto it (without it, that landing's door opened onto air).
    codes[k] = roomCode({ wall, ext, door: door[k] & wall, blank, style, use, furn, vd: voidHall && !nearCore ? 1 : 0, finish: corridor ? 0 : pick(mix(h, a, 5), 4) });
  }
  return (B.plans[slot] = { codes, rooms, spaces: sp });
}
/* The roof codes, one a column: the roof storey of each column is its top
   tier's s1. A terrace or a roof: slab, a parapet on the tier's own edge,
   and on the top roof a crown's features away from the stair house. The
   core's columns of the top tier are the stair house; a gabled house's top
   is the gable's first layer instead. */
function roofOf(B){
  if (B.roof) return B.roof;
  const { W, L } = B, last = B.tiers.length - 1, out = new Int32Array(W * L), h = mix(B.hash, 0x2007);
  const far = (i, j) => Math.max(Math.abs(2 * (B.x0 + i) + 1 - 2 * B.cx - 2), Math.abs(2 * (B.z0 + j) + 1 - 2 * B.cz - 2)) >= 5;
  let tank = B.crown === C_TANK;
  for (let j = 0; j < L; j++) for (let i = 0; i < W; i++){
    const k = i + W * j, ts = B.topTier[k];
    if (ts < 0) continue;
    const wx = B.x0 + i, wz = B.z0 + j;
    if (ts === last && B.crown === C_GABLE){ const a = B.gable.axis ? wz - B.gable.o : wx - B.gable.o; out[k] = gableCode(a, B.gable.Wa, 0, B.gable.axis); continue; }
    if (ts === last && isCoreCol(B, wx, wz)){ out[k] = coreCode(wx - B.cx, wz - B.cz, B.F & 1, CORE_HOUSE); continue; }
    const T = B.tiers[ts];
    let parapet = 0;
    for (let d = 0; d < 4; d++) if (!inTier(T, wx + DX[d], wz + DZ[d])) parapet |= 1 << d;
    let feature = R_NONE;
    if (ts === last && !parapet && far(i, j)){
      if (tank){ feature = R_TANK; tank = false; }
      else if (B.crown === C_SKYLIGHT) feature = (i + j) & 1 ? R_NONE : R_SKYLIGHT;
      else { const r = pick(mix(h, k), 10); feature = r < 2 ? R_AC : r < 3 ? R_VENT : R_NONE; }
    }
    out[k] = roofCode(parapet, feature, ts < last ? 1 + pick(mix(h, ts), 2) : 0);
  }
  return (B.roof = out);
}
/* The code of tile (tx, storey s, tz) of building B: a storey's plan below
   the column's roof storey, the roof code at it, and above: a gable's
   layers, the stair house's roof and the spire's segments. */
export function buildingCode(plan, B, tx, s, tz){
  const i = tx - B.x0, j = tz - B.z0;
  if (i < 0 || j < 0 || i >= B.W || j >= B.L || s < 0) return 0;
  const k = i + B.W * j, ts = B.topTier[k];
  if (ts < 0) return 0;
  const sTop = B.tiers[ts].s1;
  if (s < sTop){ const t = B.tierOf[s]; return storeyPlan(plan, B, t, planKind(B, t, s)).codes[k]; }
  if (s === sTop) return roofOf(B)[k];
  if (ts !== B.tiers.length - 1) return 0;
  if (B.crown === C_GABLE){
    const l = s - B.F;
    if (l >= B.gableLayers) return 0;
    const a = B.gable.axis ? tz - B.gable.o : tx - B.gable.o;
    return gableCode(a, B.gable.Wa, l, B.gable.axis);
  }
  if (!isCoreCol(B, tx, tz)) return 0;
  const q = (tx - B.cx) | (tz - B.cz) << 1;
  if (s === B.F + 1) return capCode(q);
  const g = s - B.F - 2;
  return g < B.spire ? spireCode(q, g === 0 ? 0 : g === B.spire - 1 ? 2 : 1) : 0;
}
// The storeys a building's column holds (its roof, its crown), as the exclusive top storey.
function columnTop(B, i, j){
  const ts = B.topTier[i + B.W * j];
  if (ts < 0) return 0;
  if (ts !== B.tiers.length - 1) return B.tiers[ts].s1 + 1;
  if (B.crown === C_GABLE) return B.F + B.gableLayers;
  return isCoreCol(B, B.x0 + i, B.z0 + j) ? B.F + 2 + B.spire : B.F + 1;
}

/* ---- the plan -------------------------------------------------------------------
   Every column: its ground code (ty = 0), its street-level code if no
   building stands on it (ty = 1), its tree, its building, its top (the first
   ty with nothing above) and its periodic band (buildCity). */
const planCache = new Map();
export function cityPlan(desc){
  const key = `${desc.D},${desc.seed}`, hit = planCache.get(key);
  if (hit) return hit;
  const t0 = Date.now(), D = desc.D, seed = desc.seed, NB = 2 ** (D - 8), NT = 2 ** (D - 3), C = NT * NT;
  const { district, groups } = districtsOf(NB, seed);
  const g0 = new Int32Array(C).fill(groundCode(G_PLAIN)), g1 = new Int32Array(C), tree = new Uint8Array(C), colB = new Int32Array(C).fill(-1), top = new Uint16Array(C).fill(2);
  const buildings = [], parks = [];
  const at = (tx, tz) => tx + NT * tz;
  // A tree: its trunk on the street level's tile (surface sf), its crown in the tree layers above.
  const setTree = (tx, tz, sf, big, h) => { const c = at(tx, tz); g1[c] = surfCode(sf, big ? F_TRUNK_BIG : F_TRUNK); tree[c] = 1 + (big ? 1 : 0) + 2 * (h & 3); top[c] = big ? 4 : 3; };
  // Whatever an earlier pass left on a column (a tree's crown above all).
  const clear = c => { tree[c] = 0; top[c] = 2; };
  // A garden: grass, trees and bushes by hash (share in percent).
  const garden = (x0, z0, w, d, share, bigShare, h) => {
    for (let tz = z0; tz < z0 + d; tz++) for (let tx = x0; tx < x0 + w; tx++){
      const c = at(tx, tz), r = pick(mix(h, tx, tz), 100);
      clear(c); g1[c] = surfCode(SF_GRASS);
      if (r < share) setTree(tx, tz, SF_GRASS, pick(mix(h, tx, tz, 9), 100) < bigShare, mix(h, tx, tz, 10));
      else if (r < share + 6) g1[c] = surfCode(SF_GRASS, F_BUSH);
    }
  };
  const paved = (x0, z0, w, d, s, h, planters = 0) => {
    for (let tz = z0; tz < z0 + d; tz++) for (let tx = x0; tx < x0 + w; tx++){
      clear(at(tx, tz));
      g1[at(tx, tz)] = surfCode(s, pick(mix(h, tx, tz, 3), 100) < planters ? (s === SF_YARD ? F_CRATE : F_PLANTER) : F_NONE);
    }
  };
  for (let g = 0; g < groups.length; g++){
    const G = groups[g], gx0 = G.bx * BLOCK_TILES, gz0 = G.bz * BLOCK_TILES, gw = G.w * BLOCK_TILES, gd = G.d * BLOCK_TILES, h = mix(seed, g, 0x6e0);
    // Roads and sidewalks round the group.
    for (let v = 0; v < gd; v++) for (let u = 0; u < gw; u++){
      const tx = gx0 + u, tz = gz0 + v, c = at(tx, tz);
      const inX = u < 2 || u >= gw - 2, inZ = v < 2 || v >= gd - 2;
      if (inX || inZ){
        let mark = MK_NONE;
        if (inX && !inZ){
          if (v === 2 || v === gd - 3) mark = MK_ZEBRA_X;
          else if (u === 0 && tx > 0 && !(tz & 1)) mark = MK_LINE_X;
        } else if (inZ && !inX){
          if (u === 2 || u === gw - 3) mark = MK_ZEBRA_Z;
          else if (v === 0 && tz > 0 && !(tx & 1)) mark = MK_LINE_Z;
        }
        g0[c] = groundCode(G_ROAD, mark); top[c] = 1;
        continue;
      }
      const sx = u === 2 || u === gw - 3, sz = v === 2 || v === gd - 3;
      if (sx || sz){
        // The sidewalk: a lamp every fourth tile, a street tree between (not downtown or in industry).
        const curb = u === 2 ? 0 : u === gw - 3 ? 1 : v === 2 ? 2 : 3, along = curb < 2 ? v : u;
        g1[c] = surfCode(SF_PAVE);
        if (sx && sz) continue;
        if (along % 4 === 1) g1[c] = surfCode(SF_PAVE, F_LAMP, curb);
        else if (along % 4 === 3 && G.kind !== DOWNTOWN && G.kind !== INDUSTRIAL) setTree(tx, tz, SF_PAVE, false, mix(h, tx, tz));
      }
    }
    // The inside: a park, or lots.
    const ix0 = gx0 + 3, iz0 = gz0 + 3, iw = gw - 6, id = gd - 6;
    if (G.kind === PARK){ parkLayout(ix0, iz0, iw, id, h); parks.push({ x0: ix0, z0: iz0, w: iw, d: id, blocks: G.w * G.d }); continue; }
    const lots = lotsOf(G.kind, mix(seed, g, 0x107));
    // The default under everything: a courtyard garden, or paving.
    if (G.kind === RESIDENTIAL || G.kind === SUBURB) garden(ix0, iz0, iw, id, 16, 15, h); else paved(ix0, iz0, iw, id, G.kind === INDUSTRIAL ? SF_YARD : SF_PLAZA, h);
    let li = 0;
    for (const l of lots){
      const x0 = ix0 + l.x, z0 = iz0 + l.z, lh = mix(seed, g, li++, 0x10);
      if (l.use === 'court') continue;
      if (l.use === 'passage'){ paved(x0, z0, l.w, l.d, SF_PATH, lh); continue; }
      // The front: a side on the street, by hash among those the lot touches.
      const sides = [0, 1, 2, 3].filter(d => l.fronts >> d & 1);
      const front = sides[pick(lh, sides.length)];
      let type = G.kind === DOWNTOWN ? TOWER : G.kind === MIDTOWN ? (pick(lh >>> 3, 10) < 6 ? OFFICE : APARTMENT) : G.kind === RESIDENTIAL ? APARTMENT : G.kind === SUBURB ? HOUSE : WAREHOUSE;
      if (type === TOWER && (l.w < 10 || l.d < 10)) type = OFFICE;
      // Twin towers on a whole downtown block, one time in four.
      if (type === TOWER && l.w === A && l.d === A && pick(lh >>> 5, 4) === 1){
        const F = Math.min(maxStoreys(D), 30 + pick(lh, Math.max(1, maxStoreys(D) - 30))), shape = pick(lh >>> 7, 2) ? SLAB : CROSS;
        paved(x0, z0, l.w, l.d, SF_PLAZA, lh, 6);
        const ax = front < 2;   // side by side along the front
        for (let n = 0; n < 2; n++){
          const bx = ax ? x0 + 7 : x0 + 3 + 11 * n, bz = ax ? z0 + 3 + 11 * n : z0 + 7;
          place(TOWER, bx, bz, ax ? 12 : 9, ax ? 9 : 12, front, mix(lh, n), { F, shape, district: G.kind });
        }
        g1[at(x0 + (l.w >> 1), z0 + (l.d >> 1))] = surfCode(SF_PLAZA, F_FOUNTAIN);
        continue;
      }
      const [sf, ss] = SETBACK_OF[type], big = type === TOWER && l.w >= 20 && l.d >= 20;
      const set = [0, 1, 2, 3].map(d => d === front ? (big ? 4 : sf) : (big ? 3 : ss));
      // A side on the street gets the front's setback too, when it isn't the front (a corner lot).
      for (let d = 0; d < 4; d++) if (d !== front && l.fronts >> d & 1 && type !== HOUSE && type !== APARTMENT) set[d] = Math.max(set[d], 1);
      const bx = x0 + set[0], bz = z0 + set[2], bw = l.w - set[0] - set[1], bd = l.d - set[2] - set[3];
      const yard = type === WAREHOUSE ? SF_YARD : type === APARTMENT || type === HOUSE ? -1 : SF_PLAZA;
      if (yard < 0) garden(x0, z0, l.w, l.d, 12, 0, lh); else paved(x0, z0, l.w, l.d, yard, lh, yard === SF_YARD ? 12 : 8);
      if (bw < 4 || bd < 4){ garden(x0, z0, l.w, l.d, 30, 30, lh); continue; }
      place(type, bx, bz, bw, bd, front, lh, { district: G.kind, mid: G.kind === MIDTOWN });
      // A fountain in a big tower's plaza, on the front's middle.
      if (big){ const fx = front < 2 ? (front ? x0 + l.w - 2 : x0 + 1) : x0 + (l.w >> 1), fz = front < 2 ? z0 + (l.d >> 1) : (front === 3 ? z0 + l.d - 2 : z0 + 1); g1[at(fx, fz)] = surfCode(SF_PLAZA, F_FOUNTAIN); }
    }
  }
  function place(type, x0, z0, W, L, front, h, opts){
    const id = buildings.length, B = makeBuilding(id, type, x0, z0, W, L, front, h, D, opts);
    B.district = opts.district;
    buildings.push(B);
    for (let j = 0; j < L; j++) for (let i = 0; i < W; i++){
      if (B.topTier[i + W * j] < 0) continue;
      const c = at(x0 + i, z0 + j);
      colB[c] = id; g1[c] = 0; tree[c] = 0; top[c] = columnTop(B, i, j) + 1;
    }
  }
  /* A park: grass; a path ring a tile in and a cross through the middle
     (two wide in a big park); a plaza with a fountain where they cross; a
     pond in one quarter, if there's room; trees and benches. */
  function parkLayout(x0, z0, w, d, h){
    garden(x0, z0, w, d, 20, 45, h);
    const mx = x0 + (w >> 1), mz = z0 + (d >> 1), wide = w >= 40 ? 1 : 0;
    const path = (tx, tz) => { const c = at(tx, tz); clear(c); g1[c] = surfCode(SF_PATH, pick(mix(h, tx, tz, 0xbe), 100) < 12 ? F_BENCH : F_NONE, pick(mix(h, tx, tz, 0xbf), 4)); };
    for (let tz = z0; tz < z0 + d; tz++) for (let tx = x0; tx < x0 + w; tx++){
      const ring = (tx === x0 + 1 || tx === x0 + w - 2) && tz >= z0 + 1 && tz <= z0 + d - 2 || (tz === z0 + 1 || tz === z0 + d - 2) && tx >= x0 + 1 && tx <= x0 + w - 2;
      const cross = Math.abs(2 * tx + 1 - 2 * mx) <= 1 + 2 * wide || Math.abs(2 * tz + 1 - 2 * mz) <= 1 + 2 * wide;
      if (ring || cross) path(tx, tz);
    }
    for (let tz = mz - 2; tz <= mz + 1; tz++) for (let tx = mx - 2; tx <= mx + 1; tx++){ const c = at(tx, tz); clear(c); g1[c] = surfCode(SF_PLAZA); }
    g1[at(mx - 1, mz - 1)] = surfCode(SF_PLAZA, F_FOUNTAIN);
    if (w >= 20 && d >= 20){
      // The pond: an ellipse in a quarter, by integer test, grass round it.
      const qx = pick(h, 2), qz = pick(h >>> 1, 2), qw = (w >> 1) - 3, qd = (d >> 1) - 3;
      const ox = x0 + 2 + qx * ((w >> 1) - 1), oz = z0 + 2 + qz * ((d >> 1) - 1), rx = qw - 2, rz = qd - 2;
      for (let tz = oz + 1; tz < oz + qd - 1; tz++) for (let tx = ox + 1; tx < ox + qw - 1; tx++){
        const ex = 2 * (tx - ox) + 1 - qw, ez = 2 * (tz - oz) + 1 - qd;
        if (ex * ex * rz * rz + ez * ez * rx * rx > rx * rx * rz * rz) continue;
        const c = at(tx, tz);
        g0[c] = groundCode(G_POND); g1[c] = 0; tree[c] = 0; top[c] = 1;
      }
    }
  }
  const plan = { desc, D, NB, NT, district, groups, buildings, parks, g0, g1, tree, colB, top, planMs: Date.now() - t0 };
  plan.info = cityInfo(plan);
  planCache.set(key, plan);
  if (planCache.size > 3) planCache.delete(planCache.keys().next().value);
  return plan;
}

/* A tile's code anywhere in the world (0: air). */
export function codeAt(plan, tx, ty, tz){
  const NT = plan.NT;
  if (tx < 0 || tz < 0 || ty < 0 || tx >= NT || tz >= NT) return 0;
  const c = tx + NT * tz;
  if (ty === 0) return plan.g0[c];
  if (ty >= plan.top[c]) return 0;
  const b = plan.colB[c];
  if (b >= 0) return buildingCode(plan, plan.buildings[b], tx, ty - 1, tz);
  if (ty === 1) return plan.g1[c];
  const t = plan.tree[c];
  return t ? treeCode((t - 1) & 1, ty - 1, (t - 1) >> 1) : 0;
}
// A voxel's material, by the plan alone (the tests' oracle reads it too).
export function cityVoxel(plan, x, y, z){
  const code = codeAt(plan, x >> 3, y >> 3, z >> 3);
  return code ? tileMats(code)[(x & 7) + 8 * ((y & 7) + 8 * (z & 7))] : AIR;
}

/* What the viewer shows and opens on: counts by district and type, the
   tallest tower, and a view from outside the city's corner nearest the
   tallest tower, above the skyline's middle, looking at it. */
export function cityInfo(plan){
  const { NB, NT, district, buildings, parks } = plan, side = NT * TILE;
  const byDistrict = DISTRICT_NAMES.map((_, k) => district.reduce((a, v) => a + (v === k ? 1 : 0), 0));
  const byType = TYPE_NAMES.map((_, k) => buildings.reduce((a, B) => a + (B.type === k ? 1 : 0), 0));
  const towers = TOWER_NAMES.map((_, k) => buildings.reduce((a, B) => a + (B.type === TOWER && B.shape === k ? 1 : 0), 0));
  let tallest = null, height = 0;
  for (const B of buildings) if (!tallest || B.F > tallest.F) tallest = B;
  if (tallest) for (let j = 0; j < tallest.L; j++) for (let i = 0; i < tallest.W; i++) height = Math.max(height, TILE * (1 + columnTop(tallest, i, j)));
  const storeys = buildings.reduce((a, B) => a + B.F, 0);
  let view = { eye: [-0.1 * side, 0.4 * side, -0.1 * side], yaw: Math.PI / 4, pitch: -0.45 };
  if (tallest){
    const tx = (tallest.x0 + tallest.W / 2) * TILE, tz = (tallest.z0 + tallest.L / 2) * TILE, H = TILE * (1 + tallest.F);
    const sx = tx < side / 2 ? -1 : 1, sz = tz < side / 2 ? -1 : 1, r = Math.max(260, 0.45 * side);
    const eye = [tx + sx * r * 0.72, Math.min(0.9 * side, H * 0.55 + 0.12 * side), tz + sz * r * 0.72], ty = H * 0.45;
    view = { eye, yaw: Math.atan2(tx - eye[0], tz - eye[2]), pitch: -Math.atan2(eye[1] - ty, Math.hypot(tx - eye[0], tz - eye[2])) };
  }
  return { blocks: NB * NB, byDistrict, byType, towers, buildings: buildings.length, parks: parks.length, storeys,
           tallest: tallest ? { storeys: tallest.F, height, shape: tallest.shape } : null,
           planMs: plan.planMs, view };
}

/* ---- the DAG ----------------------------------------------------------------------
   Top down from the root in tile units: a box at level m + 3 covers 2^m
   tiles a side. Three things keep it from visiting every tile:
   - above everything in its columns (the top pyramid's max): EMPTY;
   - inside every column's periodic band (a tier's storeys past its first,
     where codes repeat with period 2, or the air over a street): a box of
     two storeys or more, whose bottom is even, is the same box at any height
     in the band, so it's memoized on (m, x, z) alone. A 90-storey tower's
     shaft costs about what two of its storeys do;
   - each tile's block once (fromDense on tileMats, memoized on the code).
   Children are interned before parents, as dag-core wants. */
const NO_LO = 0x7fffffff;
export function buildCity(desc, { store = createStore(), plan = cityPlan(desc) } = {}){
  const t0 = Date.now(), { NT, D } = plan, levels = D - TILE_LEVEL;
  // Each column's band [lo, hi) in ty: a building's tallest tier's periodic storeys, or the air over a street.
  const lo0 = new Int32Array(NT * NT).fill(NO_LO), hi0 = new Int32Array(NT * NT);
  for (let c = 0; c < NT * NT; c++){
    const b = plan.colB[c];
    if (b < 0){ lo0[c] = plan.top[c]; hi0[c] = NO_LO; continue; }
    const B = plan.buildings[b], k = (c % NT - B.x0) + B.W * ((c / NT | 0) - B.z0), ts = B.topTier[k];
    let best = 0;
    for (let t = 0; t <= ts; t++){
      const T = B.tiers[t], s1 = T.s1 - (B.crown === C_GABLE && t === B.tiers.length - 1 ? 1 : 0), len = s1 - T.s0 - 1;
      if (len >= 2 && len > best){ best = len; lo0[c] = 1 + T.s0 + 1; hi0[c] = 1 + s1; }
    }
  }
  const topP = [Int32Array.from(plan.top)], loP = [lo0], hiP = [hi0], memo = [null];
  for (let m = 1; m <= levels; m++){
    const n = NT >> m, pn = n * 2, t = new Int32Array(n * n), l = new Int32Array(n * n), h = new Int32Array(n * n);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++){
      let mt = 0, ml = 0, mh = NO_LO;
      for (let o = 0; o < 4; o++){
        const c = (2 * x + (o & 1)) + pn * (2 * z + (o >> 1));
        mt = Math.max(mt, topP[m - 1][c]); ml = Math.max(ml, loP[m - 1][c]); mh = Math.min(mh, hiP[m - 1][c]);
      }
      t[x + n * z] = mt; l[x + n * z] = ml; h[x + n * z] = mh;
    }
    topP.push(t); loP.push(l); hiP.push(h); memo.push(new Int32Array(n * n).fill(-1));
  }
  const leaves = new Map(), occ = new Uint8Array(512);
  const leaf = code => {
    if (!code) return EMPTY;
    let id = leaves.get(code);
    if (id === undefined){
      const m = tileMats(code);
      for (let i = 0; i < 512; i++) occ[i] = m[i] ? 1 : 0;
      id = store.fromDense(occ, TILE).root;
      leaves.set(code, id);
    }
    return id;
  };
  let visits = 0, hits = 0;
  const build = (m, bx, by, bz) => {
    visits++;
    if (m === 0) return leaf(codeAt(plan, bx, by, bz));
    const n = NT >> m, c = bx + n * bz, y0 = by << m, y1 = y0 + (1 << m);
    if (y0 >= topP[m][c]) return EMPTY;
    const periodic = y0 >= loP[m][c] && y1 <= hiP[m][c];
    if (periodic){ const id = memo[m][c]; if (id >= 0){ hits++; return id; } }
    const kids = new Uint32Array(8);
    for (let o = 0; o < 8; o++) kids[o] = build(m - 1, 2 * bx + (o & 1), 2 * by + (o >> 1 & 1), 2 * bz + (o >> 2));
    const id = store.intern(m + TILE_LEVEL, kids);
    if (periodic) memo[m][c] = id;
    return id;
  };
  const root = build(levels, 0, 0, 0);
  let rooms = 0;
  for (const B of plan.buildings) for (let s = 0; s < B.F; s++){ const t = B.tierOf[s]; rooms += storeyPlan(plan, B, t, planKind(B, t, s)).rooms; }
  return { store, root, D, plan, tiles: leaves.size, visits, hits, rooms, ms: Date.now() - t0 };
}

/* ---- the colour ---------------------------------------------------------------------
   From the descriptor alone: the plan is rebuilt here (cityPlan, cached),
   and a voxel's material is read off its tile. Each building has a
   palette by its type (stone, brick, render, siding, steel) and a glass
   tint; a room's floor and walls go by the finish its code carries; the
   ground has asphalt with its markings, paving with joints, grass in
   clumps. A coarse cell's centre may be air: inside a building's columns it
   takes the facade, under a tree the leaves, else the ground's top. */
const hash3 = (i, j, k) => mix(i, j, k) / 4294967296;
const PAL = {
  [TOWER]: [[214, 204, 180], [200, 172, 124], [154, 82, 62], [150, 150, 154], [226, 226, 216], [74, 78, 88]],
  [OFFICE]: [[176, 176, 170], [194, 184, 162], [124, 126, 136], [166, 114, 84], [210, 200, 180], [150, 160, 170]],
  [APARTMENT]: [[164, 84, 62], [146, 74, 54], [222, 206, 172], [204, 164, 96], [154, 172, 192], [212, 144, 124]],
  [HOUSE]: [[232, 222, 192], [192, 212, 202], [204, 194, 222], [232, 202, 172], [212, 182, 152], [240, 236, 228]],
  [WAREHOUSE]: [[150, 152, 154], [112, 132, 152], [162, 104, 72], [172, 162, 142], [130, 140, 120], [96, 104, 112]],
};
// Which palettes are brick (coursed), by type.
const BRICK = { [TOWER]: [2], [OFFICE]: [3], [APARTMENT]: [0, 1], [HOUSE]: [], [WAREHOUSE]: [2] };
const TINT = [[78, 118, 158], [62, 128, 132], [128, 104, 76], [96, 108, 122], [48, 70, 104], [110, 140, 150]];
const SHINGLES = [[112, 62, 52], [72, 72, 82], [92, 72, 52], [62, 82, 72]];
const FLOORS = [[118, 122, 138], [150, 110, 72], [204, 202, 196], [164, 160, 152]];   // carpet, wood, tile, concrete
const WALLS = [[236, 232, 222], [222, 226, 232], [232, 222, 206], [214, 222, 212]];
const FABRICS = [[176, 64, 62], [62, 92, 158], [204, 184, 142], [84, 132, 92]];
const BASE = {
  [M_GROUND]: [112, 92, 72], [M_ASPHALT]: [58, 58, 62], [M_LINE]: [232, 192, 64], [M_ZEBRA]: [232, 232, 226], [M_PAVE]: [178, 174, 166],
  [M_GRASS]: [82, 140, 62], [M_PATH]: [192, 172, 132], [M_PLAZA]: [194, 188, 178], [M_YARD]: [142, 140, 134], [M_WATER]: [52, 112, 170],
  [M_BARK]: [92, 66, 46], [M_LEAF]: [62, 122, 52], [M_CORE]: [150, 150, 148], [M_STEP]: [172, 166, 160], [M_ROOF]: [124, 124, 120],
  [M_METAL]: [94, 98, 104], [M_LAMP]: [255, 240, 182], [M_FURN]: [142, 98, 62], [M_STONE]: [204, 198, 188], [M_JET]: [150, 196, 232],
};
export function cityColour(desc, rgb8){
  const plan = cityPlan(desc), { NT } = plan, side = NT * TILE;
  return (x, y, z) => {
    const xi = Math.min(side - 1, Math.max(0, Math.floor(x))), yi = Math.max(0, Math.floor(y)), zi = Math.min(side - 1, Math.max(0, Math.floor(z)));
    const tx = xi >> 3, ty = yi >> 3, tz = zi >> 3, c = tx + NT * tz, code = codeAt(plan, tx, ty, tz);
    let m = code ? tileMats(code)[(xi & 7) + 8 * ((yi & 7) + 8 * (zi & 7))] : AIR;
    const b = plan.colB[c], B = b >= 0 ? plan.buildings[b] : null;
    if (m === AIR){
      if (B && ty >= 1 && ty < plan.top[c]) m = M_FACADE;
      else if (ty >= 2 && plan.tree[c]) m = M_LEAF;
      else { const g = ty >= 1 && plan.g1[c] ? plan.g1[c] : plan.g0[c]; m = tileMats(g)[(xi & 7) + 8 * ((ty >= 1 && plan.g1[c] ? 0 : 7) + 8 * (zi & 7))] || M_GROUND; }
    }
    const j = 0.92 + 0.16 * hash3(xi, yi, zi), kind = code >>> KS, fin = kind === K_ROOM ? code >> 24 & 3 : 0;
    let col, k = j;
    switch (m){
      case M_FACADE: case M_PARAPET: {
        const p = B ? PAL[B.type][B.pal] : PAL[OFFICE][0], brick = B && BRICK[B.type].includes(B.pal);
        col = p;
        if (brick){ const course = yi >> 1, a = xi + zi + (course & 1) * 2; k *= (0.9 + 0.16 * hash3(a >> 2, course, b)) * ((yi & 1) === 0 || (a & 3) === 0 ? 0.8 : 1); }
        else { const sy = yi & 7; k *= sy === 0 || sy === 7 ? 0.86 : 1; }
        if (m === M_PARAPET) k *= 0.9;
        break;
      }
      case M_GLASS: {
        // Sky in the glass: lighter toward the top of the world, a pane a tile, a streak in it.
        const t = TINT[B ? B.tint : 0], pane = hash3(tx, ty, tz);
        col = t; k = (0.8 + 0.35 * yi / side + 0.14 * pane) * ((xi + zi + (yi << 1)) % 11 === 0 ? 1.25 : 1);
        if (kind === K_ROOF) { col = [150, 190, 210]; k = j; }
        break;
      }
      case M_FLOOR: {
        col = kind === K_CORE ? BASE[M_CORE] : FLOORS[fin];
        if (fin === 1 && kind === K_ROOM) k *= (zi + (xi >> 3)) & 1 ? 0.9 : 1.04;      // planks
        else if (fin === 2 && kind === K_ROOM) k *= ((xi >> 1) + (zi >> 1)) & 1 ? 0.94 : 1.03;   // tiles
        break;
      }
      case M_PLASTER: col = WALLS[fin]; break;
      case M_FABRIC: col = FABRICS[mix(tx, ty, tz) & 3]; break;
      case M_ROOF: {
        const f = kind === K_ROOF ? code >> 7 & 3 : 0;
        col = f === 1 ? [146, 108, 72] : f === 2 ? [86, 132, 66] : BASE[M_ROOF];
        if (f === 1) k *= (xi + zi) & 1 ? 0.92 : 1.04;
        break;
      }
      case M_SHINGLE: case M_ATTIC: col = SHINGLES[B ? B.shingle : 0]; k *= (yi & 1 ? 0.88 : 1.02) * (m === M_ATTIC ? 0.8 : 1); break;
      case M_PAVE: col = BASE[M_PAVE]; k *= (xi & 3) === 0 || (zi & 3) === 0 ? 0.88 : 1; break;
      case M_PLAZA: col = BASE[M_PLAZA]; k *= ((xi >> 1) + (zi >> 1)) & 1 ? 0.95 : 1.03; break;
      case M_GRASS: col = BASE[M_GRASS]; k *= 0.86 + 0.26 * hash3(xi >> 1, 3, zi >> 1); break;
      case M_ASPHALT: col = BASE[M_ASPHALT]; k *= 0.9 + 0.2 * hash3(xi >> 2, 5, zi >> 2); break;
      case M_LEAF: {
        const t = plan.tree[c], autumn = t && mix(tx, tz, 0xa07) % 9 === 0;
        col = autumn ? [196, 112, 46] : BASE[M_LEAF]; k *= 0.82 + 0.3 * hash3(xi, yi, zi);
        break;
      }
      case M_WATER: col = BASE[M_WATER]; k *= 0.9 + 0.2 * hash3(xi >> 1, yi, zi >> 1); break;
      default: col = BASE[m] || BASE[M_GROUND];
    }
    if (m === M_LAMP) return rgb8(255, 240, 182);
    return rgb8(col[0] * k, col[1] * k, col[2] * k);
  };
}
