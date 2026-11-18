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
   the same code is the same level-3 node.

   THE SECOND ROUND (docs/city-log.md §10, asked for 2026-11-17: "yes on
   everything except the supertalls"). A city of 4 × 4 blocks or more
   (D ≥ 10) also has:
   - a COAST, the side of the world nearest the industry, and a RIVER
     across the city to it, through one row of blocks: a channel ten tiles
     wide sunk into the ground layer (water at y 2…3, the street's slab at
     8), its bends smoothstepped between the streets so every bridge is
     square to it. Every street over it is a BRIDGE (a deck two voxels
     thick, its footways railed), the banks are promenades with railings
     and gardens, and each bank has a flight of steps down to the water,
     since water is stood on and the walk must reach it;
   - a HARBOUR where the river meets the coast: the mouth block and its
     neighbours along the coast, water past a quay with railings, piers,
     tower cranes, container yards and ships moored to the piers (their
     decks flush with the pier, so you walk aboard), steps down;
   - an ELEVATED RAILWAY, two tracks on a viaduct over a street parallel
     to the coast, three storeys up (the deck's slab at y = 24), on pillars
     every fourth tile, over the river, from the world's edge to
   - a STATION, the terminus: two blocks across the line's street (which
     the station takes), a train hall under a glass barrel vault, the
     tracks into it between two platforms, buffers, a concourse, a grand
     stair up from the street and a clock tower;
   - a STADIUM, a bowl of 20 rows round a pitch, entered by four tunnels,
     under a canopy, with floodlights; and a CATHEDRAL, a nave, aisles, a
     transept, an apse, two west towers with spires and a crossing tower,
     pews, stained glass, three doors.
   Landmarks, ships and cranes are each one voxel function in their own
   frame (markMats), cut into tiles by a code holding the tile's place in
   it, so they cost a leaf a tile like everything else. A city of 2 × 2
   blocks (D = 9) is too small for any of it and is the city it was, to
   the voxel. */
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
/* An exact integer square root (Math.sqrt is correctly rounded everywhere, and
   the two loops make the floor exact regardless). */
export function isqrt(n){
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

/* ---- names ------------------------------------------------------------------ */
export const DOWNTOWN = 0, MIDTOWN = 1, RESIDENTIAL = 2, SUBURB = 3, INDUSTRIAL = 4, PARK = 5, RIVER = 6, HARBOUR = 7, LANDMARK = 8;
export const DISTRICT_NAMES = ['downtown', 'midtown', 'residential', 'suburb', 'industrial', 'park', 'river', 'harbour', 'landmark'];
export const TOWER = 0, OFFICE = 1, APARTMENT = 2, HOUSE = 3, WAREHOUSE = 4, LANDMARK_TYPE = 5;
export const TYPE_NAMES = ['tower', 'office', 'apartment', 'house', 'warehouse', 'landmark'];
// Things drawn by a voxel function of their own (markMats): three landmarks, and the harbour's ships and cranes.
export const STADIUM = 0, CATHEDRAL = 1, STATION = 2, SHIP = 3, CRANE = 4;
export const MARK_NAMES = ['stadium', 'cathedral', 'station', 'ship', 'crane'];
// Each one's size in tiles in its own frame: along (X, from its front) and across (Z).
export const MARK_SIZE = [[26, 26], [26, 26], [26, 10], [12, 3], [8, 1]];
// Tower shapes: a deco setback tower, a glass slab, a cruciform, a ziggurat, a slender spire.
export const SETBACK = 0, SLAB = 1, CROSS = 2, STEPPED = 3, SLENDER = 4;
export const TOWER_NAMES = ['setback', 'glass slab', 'cruciform', 'stepped', 'slender'];
// Crowns.
export const C_FLAT = 0, C_SPIRE = 1, C_TANK = 2, C_GABLE = 3, C_SKYLIGHT = 4;

/* The materials, which the colour field reads. */
export const MATERIALS = ['air', 'ground', 'asphalt', 'line', 'zebra', 'pave', 'grass', 'path', 'plaza', 'yard', 'water', 'bark', 'leaf',
  'facade', 'glass', 'floor', 'plaster', 'core', 'step', 'roof', 'parapet', 'metal', 'lamp', 'furniture', 'fabric', 'stone', 'jet', 'shingle', 'attic',
  'quay', 'railing', 'ballast', 'rail', 'platform', 'seat', 'pitch', 'ashlar', 'slate', 'stained', 'marble', 'hull', 'deck', 'container', 'crane', 'clock'];
export const AIR = 0, M_GROUND = 1, M_ASPHALT = 2, M_LINE = 3, M_ZEBRA = 4, M_PAVE = 5, M_GRASS = 6, M_PATH = 7, M_PLAZA = 8, M_YARD = 9,
  M_WATER = 10, M_BARK = 11, M_LEAF = 12, M_FACADE = 13, M_GLASS = 14, M_FLOOR = 15, M_PLASTER = 16, M_CORE = 17, M_STEP = 18,
  M_ROOF = 19, M_PARAPET = 20, M_METAL = 21, M_LAMP = 22, M_FURN = 23, M_FABRIC = 24, M_STONE = 25, M_JET = 26, M_SHINGLE = 27, M_ATTIC = 28,
  M_QUAY = 29, M_RAILING = 30, M_BALLAST = 31, M_RAIL = 32, M_PLATFORM = 33, M_SEAT = 34, M_PITCH = 35, M_ASHLAR = 36, M_SLATE = 37,
  M_STAINED = 38, M_MARBLE = 39, M_HULL = 40, M_DECK = 41, M_CONTAINER = 42, M_CRANE = 43, M_CLOCK = 44;

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
     GROUND type (0–2: plain, road, pond, river, a road bridge's deck, a
            footway's, steps), mark (3–5: the road's marking, or the side a
            flight of steps climbs to)
     SURF   surface (0–2), feature (3–6), orientation (7–8), railing (9–12:
            sides), opening (13–16: sides whose railing opens in the middle)
     TREE   variant (0: small, big), layer (1–2), shape (3–4)
     MARK   which (0–2: MARK_NAMES), tile i (3–8) and j (9–14) from the
            thing's corner along x and z, ty (15–19), its front side (20–21),
            variant (22–25: bit 3 flips it across)
     RAIL   axis (0: the line along x or z), side (1: the tile on the line's
            −/+ side), a pillar (2), layer (3–4), the line's end (5–6: at
            its −, + end)  */
const KS = 26;
export const K_ROOM = 1, K_CORE = 2, K_ROOF = 3, K_CAP = 4, K_SPIRE = 5, K_GABLE = 6, K_GROUND = 7, K_SURF = 8, K_TREE = 9, K_MARK = 10, K_RAIL = 11;
export const KIND_NAMES = ['air', 'room', 'core', 'roof', 'cap', 'spire', 'gable', 'ground', 'surface', 'tree', 'mark', 'rail'];
export const kindOfCode = code => code >>> KS;
// Facade styles: how a wall facing outside is opened.
export const S_BLANK = 0, S_GRID = 1, S_PAIR = 2, S_CURTAIN = 3, S_GLASS = 4, S_RIBBON = 5, S_SHOP = 6, S_CLERE = 7;
// Uses of a room tile, for its furniture and floor.
export const U_PLAIN = 0, U_OFFICE = 1, U_HOME = 2, U_LOBBY = 3;
export const CORE_GROUND = 0, CORE_STOREY = 1, CORE_HOUSE = 2, CORE_LAST = 3;
export const R_NONE = 0, R_AC = 1, R_TANK = 2, R_SKYLIGHT = 3, R_VENT = 4;
export const G_PLAIN = 0, G_ROAD = 1, G_POND = 2, G_RIVER = 3, G_DECK = 4, G_FOOT = 5, G_STAIR = 6;
export const MK_NONE = 0, MK_LINE_X = 1, MK_LINE_Z = 2, MK_ZEBRA_X = 3, MK_ZEBRA_Z = 4;
export const SF_PAVE = 0, SF_GRASS = 1, SF_PATH = 2, SF_PLAZA = 3, SF_YARD = 4, SF_QUAY = 5;
export const F_NONE = 0, F_LAMP = 1, F_TRUNK = 2, F_TRUNK_BIG = 3, F_BENCH = 4, F_PLANTER = 5, F_FOUNTAIN = 6, F_CRATE = 7, F_BUSH = 8,
  F_CRANE = 9, F_CONTAINER = 10;
// The water's surface is y = 3 in the ground layer (stood on at 4), the street's slab y = 8: steps down at the banks.
// The railway's deck is the slab of layer RAIL_TY (y = 24), three storeys over the road.
export const RAIL_TY = 3;
export const groundType = code => code & 7;

export const roomCode = ({ wall = 0, ext = 0, door = 0, blank = 0, style = 0, use = 0, furn = 0, vd = 0, finish = 0 }) =>
  (K_ROOM << KS | wall | ext << 4 | door << 8 | blank << 12 | style << 16 | use << 19 | furn << 21 | vd << 23 | finish << 24) >>> 0;
export const coreCode = (qx, qz, par, mode) => (K_CORE << KS | qx | qz << 1 | par << 2 | mode << 3) >>> 0;
const roofCode = (parapet, feature, finish) => (K_ROOF << KS | parapet | feature << 4 | finish << 7) >>> 0;
const capCode = q => (K_CAP << KS | q) >>> 0;
const spireCode = (q, seg) => (K_SPIRE << KS | q | seg << 2) >>> 0;
const gableCode = (i, Wa, j, axis) => (K_GABLE << KS | i | Wa << 4 | j << 8 | axis << 11) >>> 0;
const groundCode = (type, mark = 0) => (K_GROUND << KS | type | mark << 3) >>> 0;
const surfCode = (s, f = 0, o = 0) => (K_SURF << KS | s | f << 3 | o << 7) >>> 0;
const treeCode = (variant, layer, shape) => (K_TREE << KS | variant | layer << 1 | shape << 3) >>> 0;
export const markCode = (mk, i, j, ty, d, v) => (K_MARK << KS | mk | i << 3 | j << 9 | ty << 15 | d << 20 | v << 22) >>> 0;
const railCode = (axis, side, pillar, layer, end) => (K_RAIL << KS | axis | side << 1 | pillar << 2 | layer << 3 | end << 5) >>> 0;
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
  else if (k === K_MARK) markMats(p, out);
  else if (k === K_RAIL) railMats(p, out);
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
/* The ground layer. A river's tile (and the harbour's) is its bed at y 0…1,
   water at 2…3 and air over it; a bridge's deck is y 6…7 over that (two
   voxels of air under it, so nothing walks under a bridge: each stretch of
   river between two has its own steps); a footway's deck is the same under
   the sidewalk's slab. Steps (G_STAIR) climb from the water to the bank on
   the side `mark` names, a voxel a voxel, four wide in the middle of the
   tile, so the bank's railing opens there. */
function groundMats(p, out){
  const type = p & 7, mark = p >> 3 & 7, wet = type >= G_RIVER;
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++){
    for (let y = 0; y < 8; y++) out[I8(x, y, z)] = wet && y >= 2 ? (y <= 3 ? M_WATER : AIR) : M_GROUND;
    if (type === G_POND){ out[I8(x, 6, z)] = M_WATER; out[I8(x, 7, z)] = M_WATER; }
    else if (type === G_FOOT){ out[I8(x, 6, z)] = M_CORE; out[I8(x, 7, z)] = M_CORE; }
    else if (type === G_STAIR){
      // e: voxels from the bank's edge; the steps' tops are 7 − e (stood on at 8 − e), down to the water's 4.
      const e = mark === 0 ? x : mark === 1 ? 7 - x : mark === 2 ? z : 7 - z, along = mark < 2 ? z : x;
      if (along >= 2 && along <= 5 && e <= 3) for (let y = 2; y <= 7 - e; y++) out[I8(x, y, z)] = M_STEP;
    } else if (type === G_ROAD || type === G_DECK){
      if (type === G_DECK){ out[I8(x, 6, z)] = M_CORE; }
      let m = M_ASPHALT;
      if (mark === MK_LINE_X && x === 0) m = M_LINE;
      else if (mark === MK_LINE_Z && z === 0) m = M_LINE;
      else if (mark === MK_ZEBRA_X && (x & 3) < 2 && z >= 1 && z <= 6) m = M_ZEBRA;
      else if (mark === MK_ZEBRA_Z && (z & 3) < 2 && x >= 1 && x <= 6) m = M_ZEBRA;
      out[I8(x, 7, z)] = m;
    }
  }
}
const SURF_MAT = [M_PAVE, M_GRASS, M_PATH, M_PLAZA, M_YARD, M_QUAY];
function surfMats(p, out){
  const s = p & 7, f = p >> 3 & 15, o = p >> 7 & 3, rail = p >> 9 & 15, gap = p >> 13 & 15;
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
  // A tower crane's foot, under its mast (markMats' CRANE, from the layer above).
  else if (f === F_CRANE) put(2, 5, 2, 5, 1, 7, M_CRANE);
  // A stack of shipping containers, one or two high, long along x (o bit 0 clear) or z: 1…6 by 2…5,
  // so two side by side leave two voxels between them end to end and four side to side.
  else if (f === F_CONTAINER){ const h = o & 2 ? 6 : 3; if (o & 1) put(2, 5, 1, 6, 1, h, M_CONTAINER); else put(1, 6, 2, 5, 1, h, M_CONTAINER); }
  // A railing two voxels high (the walker's step is one) on the edge of each side over water, with an
  // opening four wide where steps go down.
  for (let d = 0; d < 4; d++){
    if (!(rail >> d & 1)) continue;
    for (let a = 0; a < 8; a++){
      if (gap >> d & 1 && a >= 2 && a <= 5) continue;
      const x = d === 0 ? 0 : d === 1 ? 7 : a, z = d === 2 ? 0 : d === 3 ? 7 : a;
      out[I8(x, 1, z)] = M_RAILING; out[I8(x, 2, z)] = M_RAILING;
    }
  }
}

/* ---- the railway ------------------------------------------------------------------
   Two tiles across, one track a tile: o is the voxels from the tile's outer
   edge (a parapet at 0, rails at 2 and 5, so the walker fits between them
   and between the tracks). Layer 3 is the deck (ballast at y = 24, rails a
   voxel over it); layer 2 the girder under it (y 22…23); a pillar 2 along
   and 2 across in each tile (4 across the line's middle) stands on the
   road every fourth tile; the end at the world's edge has a buffer. */
function railMats(p, out){
  const axis = p & 1, side = p >> 1 & 1, pillar = p >> 2 & 1, layer = p >> 3 & 3, end = p >> 5 & 3;
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++){
    const al = axis ? z : x, ac = axis ? x : z, o = side ? 7 - ac : ac;
    const post = pillar && o >= 6 && al >= 3 && al <= 4;
    for (let y = 0; y < 8; y++){
      let m = AIR;
      if (layer === RAIL_TY){
        if (y === 0) m = M_BALLAST;
        else if (o === 0 && y <= 2) m = M_PARAPET;
        else if (y === 1 && (o === 2 || o === 5)) m = M_RAIL;
        else if (end && y <= 3 && o >= 1 && (end === 1 ? al <= 1 : al >= 6)) m = M_METAL;
      } else if (layer === 2) m = y >= 6 ? M_CORE : post ? M_CORE : AIR;
      else if (layer === 1) m = post ? M_CORE : AIR;
      out[I8(x, y, z)] = m;
    }
  }
}

/* ---- things in their own frame ----------------------------------------------------
   A landmark, a ship or a crane is a voxel function over its own frame: X
   from its front (0) back, Z across, Y up from the street level's slab (Y =
   0 is y = 8; a ship's hull reaches down into the ground layer, Y < 0). A
   tile's code holds its place (i, j from the thing's corner, its layer)
   and the thing's front side, so the frame is undone here: X along the
   axis the front faces, from it; Z the other world axis, flipped by the
   variant's bit 3. Everything is integer arithmetic: squared distances,
   isqrt, no angles. */
const MARK_TOP = [68, 165, 116, 22, 54];   // each thing's highest Y, for the empty layers over it
export const markLayers = mk => 1 + Math.ceil((MARK_TOP[mk] + 1) / 8);   // the exclusive top layer (ty)
/* An upper bound on the highest Y anything stands at in a column of a
   landmark (test/city-core.test.js holds it against every voxel): most of a
   landmark's tiles are the air over its lot and its roofs (a cathedral's
   are 84% empty), and this skips them, which took D = 11's build from
   0.37 s to 0.25 s. Ships and cranes are small, and have none. */
export function markCeil(mk, X, Z){
  if (mk === STADIUM){
    const cx = X < 104 ? X : 207 - X, cz = Z < 104 ? Z : 207 - Z;
    if (cx <= 9 && cz <= 9) return 67;
    const { d } = stadiumAt(X, Z);
    return d === 0 ? 6 : d < ST.TRACK || d >= ST.WALL ? 0 : ST.R + 14;
  }
  if (mk === CATHEDRAL){
    const q = Math.abs(2 * Z - CA.c2);
    if (X >= 24 && X < 56 && q >= 32 && q < 96) return 164;
    if (X >= 168) return (2 * X - 335) ** 2 + q * q < 64 * 64 ? 88 : 0;
    if (X >= 120 && X < 152) return q < 32 ? 124 : q < 128 ? 76 : 0;
    if (X >= 24 && X < 168) return q < 64 ? 76 : q < 72 ? 30 : 0;
    return 0;
  }
  if (mk === STATION) return X < 64 ? (X >= 2 && X < 18 && Z >= 32 && Z < 48 ? 115 : 51) : 79;
  return MARK_TOP[mk];
}
function markMats(p, out){
  const mk = p & 7, i = p >> 3 & 63, j = p >> 9 & 63, ty = p >> 15 & 31, d = p >> 20 & 3, v = p >> 22 & 15;
  const [na, nc] = MARK_SIZE[mk], f = MARK_VOXEL[mk], Y0 = 8 * (ty - 1);
  if (Y0 > MARK_TOP[mk]) return;
  // The tile's columns in the thing's frame: X = ax + sx·x + tx·z, Z = az + ux·x + uz·z.
  const flip = v & 8 ? -1 : 1, Zof = Z => v & 8 ? 8 * nc - 1 - Z : Z;
  let ax, sx, tx, az, ux, uz;
  if (d === 0){ ax = 8 * i; sx = 1; tx = 0; az = 8 * j; ux = 0; uz = 1; }
  else if (d === 1){ ax = 8 * na - 1 - 8 * i; sx = -1; tx = 0; az = 8 * j; ux = 0; uz = 1; }
  else if (d === 2){ ax = 8 * j; sx = 0; tx = 1; az = 8 * i; ux = 1; uz = 0; }
  else { ax = 8 * na - 1 - 8 * j; sx = 0; tx = -1; az = 8 * i; ux = 1; uz = 0; }
  az = Zof(az); ux *= flip; uz *= flip;
  if (Y0 > 0 && mk <= STATION){
    let ceil = -1;
    for (let z = 0; z < 8 && ceil < Y0; z++) for (let x = 0; x < 8; x++) ceil = Math.max(ceil, markCeil(mk, ax + sx * x + tx * z, az + ux * x + uz * z));
    if (Y0 > ceil) return;
  }
  for (let z = 0; z < 8; z++) for (let x = 0; x < 8; x++){
    const X = ax + sx * x + tx * z, Z = az + ux * x + uz * z;
    for (let y = 0; y < 8; y++) out[I8(x, y, z)] = f(X, Y0 + y, Z, v & 7);
  }
}
// The frame of a mark's voxel, for the colour: [X, Y, Z, variant].
function markFrame(code, xi, yi, zi){
  const p = code & ((1 << KS) - 1), mk = p & 7, i = p >> 3 & 63, j = p >> 9 & 63, ty = p >> 15 & 31, d = p >> 20 & 3, v = p >> 22 & 15;
  const [na, nc] = MARK_SIZE[mk], wx = 8 * i + (xi & 7), wz = 8 * j + (zi & 7);
  let X, Z;
  if (d === 0){ X = wx; Z = wz; } else if (d === 1){ X = 8 * na - 1 - wx; Z = wz; }
  else if (d === 2){ X = wz; Z = wx; } else { X = 8 * na - 1 - wz; Z = wx; }
  if (v & 8) Z = 8 * nc - 1 - Z;
  return [X, 8 * (ty - 1) + (yi & 7), Z, v & 7, mk];
}

/* THE STADIUM, 208 × 208: a pitch 88 × 48 at street level; round it a
   running track 4 voxels wide, then 20 rows of seats, each 2 deep and a
   voxel higher than the last (so every row is a step from the one below,
   and walking up the bowl is walking up stairs), a walkway at the top and
   an outer wall 2 over it. d is the distance from the pitch's rectangle in
   half voxels, by isqrt, so the corners are round and a step to a
   neighbour moves d by 2 at most: no row is ever two above its neighbour.
   Four tunnels, 8 wide and 6 tall, go through the stands on the axes from
   the plaza to the track. A canopy covers the upper rows, on posts at the
   wall; floodlights stand in the plaza's corners; goals at the pitch's ends
   (the crossbar 6 up, walked under). */
const ST = { R: 20, hx: 44, hz: 24, C: 104, TRACK: 8 };
ST.ROWS = ST.TRACK + 4 * ST.R; ST.WALK = ST.ROWS + 12; ST.WALL = ST.WALK + 4;
export function stadiumAt(X, Z){
  const ax = Math.abs(2 * X + 1 - 2 * ST.C), az = Math.abs(2 * Z + 1 - 2 * ST.C);
  const dx = Math.max(0, ax - 2 * ST.hx), dz = Math.max(0, az - 2 * ST.hz);
  return { ax, az, d: isqrt(dx * dx + dz * dz) };
}
function stadiumVoxel(X, Y, Z){
  if (Y < 0) return AIR;
  const { R, TRACK, ROWS, WALK, WALL } = ST, { ax, az, d } = stadiumAt(X, Z);
  // The floodlights: masts in the plaza's corners, their lamps at the top.
  const cx = X < 104 ? X : 207 - X, cz = Z < 104 ? Z : 207 - Z;
  if (cx >= 6 && cx <= 7 && cz >= 6 && cz <= 7 && Y <= 63) return M_METAL;
  if (cx >= 4 && cx <= 9 && cz >= 4 && cz <= 9 && Y >= 64 && Y <= 67) return M_LAMP;
  if (d === 0){
    if (Y === 0) return M_PITCH;
    // The goals: posts 1 × 1 at the ends, 18 apart, a crossbar at 6.
    const end = X === ST.C - ST.hx || X === ST.C + ST.hx - 1, post = Z === ST.C - 9 || Z === ST.C + 8;
    if (end && Y <= 6 && (post || (Y === 6 && Z > ST.C - 9 && Z < ST.C + 8))) return M_METAL;
    return AIR;
  }
  if (d < TRACK) return Y === 0 ? M_PATH : AIR;
  if (d >= WALL) return Y === 0 ? M_PLAZA : AIR;
  const tunnel = ax < 8 || az < 8;
  if (tunnel && Y >= 1 && Y <= 6) return AIR;
  if (tunnel && Y === 0) return M_PATH;
  if (d < ROWS){
    const s = 1 + ((d - TRACK) >> 2);
    if (Y < s) return M_ASHLAR;
    if (Y === s) return M_SEAT;
  } else if (d < WALK){
    if (Y < R) return M_ASHLAR;
    if (Y === R) return M_PLAZA;
  } else {
    if (Y <= R + 2) return M_ASHLAR;
    // Posts up to the canopy, where the wall meets a diagonal band every 32.
    if (Y < R + 14 && (X + Z) % 32 < 2) return M_METAL;
  }
  if (Y === R + 14 && d >= TRACK + 40) return M_METAL;
  return AIR;
}

/* THE CATHEDRAL, 208 × 208, its front at X = 0 and its axis on Z = 103.5.
   q is twice the distance from the axis (|2Z − 207|, odd), so every width
   is exact. From the front: a plaza, two west towers (solid, with spires to
   Y = 164) and between them the narthex behind the portal; the nave (28
   wide, 56 tall inside) between arcades of piers, an aisle each side under
   a lean-to roof, buttresses; the transept across it (X 120…152, 128 wide),
   a door in each end under a rose window, a crossing tower over it; the
   apse, a half circle of radius 32, with the altar. Pews in the nave are a
   voxel high, two deep with two between, round a middle aisle. Windows are
   stained glass (solid), their sills 6 up. The roofs are slate. */
const CA = { c2: 207 };
function cathedralVoxel(X, Y, Z){
  if (Y < 0) return AIR;
  const q = Math.abs(2 * Z - CA.c2), inX = (a, b) => X >= a && X < b;
  const gable = (base, half2) => base + ((half2) >> 1);   // a 45° roof: up as far as it is in
  // A door's pointed arch, w (twice the distance from its middle) under 12: 14 to the springing, 20 at the point.
  const arch = (w, Y) => Y >= 1 && (Y <= 14 || 2 * (Y - 14) <= 12 - w);
  // West towers and their spires (solid): X 24…56, |Z − 103.5| in [16, 48), each centred at 32 out.
  if (inX(24, 56) && q >= 32 && q < 96){
    if (Y < 100) return M_ASHLAR;
    const hw = (164 - Y) >> 2;
    return hw > 0 && Math.abs(2 * X - 79) < 2 * hw && Math.abs(q - 64) < 2 * hw ? M_SLATE : AIR;
  }
  // The apse.
  if (X >= 168){
    const r2 = (2 * X - 335) ** 2 + q * q;
    if (r2 >= 64 * 64) return Y === 0 ? M_GRASS : AIR;
    if (Y === 0) return r2 < 60 * 60 ? M_MARBLE : M_ASHLAR;
    if (r2 < 60 * 60 && Y < 56){
      if (inX(176, 184) && q < 8 && Y <= 3) return M_ASHLAR;   // the altar
      return AIR;
    }
    if (Y < 56) return Y >= 8 && Y < 40 && (X + Z) % 10 < 3 ? M_STAINED : M_ASHLAR;
    const s2 = r2 + (2 * Y - 112) ** 2;
    return s2 < 64 * 64 ? (s2 >= 60 * 60 ? M_SLATE : M_ASHLAR) : AIR;
  }
  const crossing = inX(120, 152);
  // The transept's arms, beyond the aisles.
  if (crossing && q >= 64 && q < 128){
    const end = q >= 124, side = inX(120, 122) || inX(150, 152);
    const dx = Math.abs(2 * X - 271);
    // The floor runs through the door: a wall's foot two thick that isn't stood on would cut the walk.
    if (Y === 0) return side || (end && dx >= 12) ? M_ASHLAR : M_MARBLE;
    if (end){
      if (dx < 12 && arch(dx, Y)) return AIR;   // the door
      if (Y < 56) return dx * dx + (2 * Y - 72) ** 2 < 400 ? M_STAINED : M_ASHLAR;
      if (Y < gable(58, 32 - dx)) return Y >= gable(58, 32 - dx) - 2 ? M_SLATE : M_ASHLAR;
      return AIR;
    }
    if (side) return Y < 56 ? (Y >= 8 && Y < 24 && q >= 80 && q < 112 ? M_STAINED : M_ASHLAR) : Y < 58 ? M_ASHLAR : AIR;
    if (Y < 56) return AIR;
    const top = gable(58, 32 - dx);
    return Y < top ? (Y >= top - 2 ? M_SLATE : M_ASHLAR) : AIR;
  }
  // In front of the building, and round it: the plaza and the close.
  const body = inX(24, 168) && q < 64, buttress = inX(56, 168) && !crossing && q >= 64 && q < 72 && (X - 56) % 16 < 4;
  if (!body){
    if (buttress) return Y <= 30 - (q - 64) ? M_ASHLAR : AIR;
    return Y === 0 ? (X < 24 || q < 12 ? M_PLAZA : M_GRASS) : AIR;
  }
  // The narthex between the towers (q < 32 there: the towers take the rest).
  if (X < 56 && q >= 32) return AIR;
  if (inX(24, 26)){
    // The west front: the portal, a rose window, a gable.
    if (q < 12 && arch(q, Y)) return AIR;
    if (Y === 0) return M_MARBLE;
    if (q * q + (2 * Y - 80) ** 2 < 400) return M_STAINED;
    return Y < gable(56, 32 - q) + 2 ? M_ASHLAR : AIR;
  }
  if (Y === 0) return q < 60 || crossing ? M_MARBLE : M_ASHLAR;
  if (q < 28 || (crossing && !(q >= 28 && q < 36 && (inX(120, 124) || inX(148, 152))))){
    // The nave and the crossing, clear to the vault, then the roof.
    if (Y < 56){
      if (Y === 1 && inX(64, 116) && q >= 6 && q < 24 && (X - 64) % 4 < 2) return M_FURN;   // pews
      return AIR;
    }
    if (crossing && q < 32){
      if (Y < 92) return M_ASHLAR;                                   // the crossing tower
      const hw = 124 - Y;
      return hw > 0 && Math.abs(2 * X - 271) < hw && q < hw ? M_SLATE : AIR;
    }
    if (Y < 58) return M_ASHLAR;
    // Over the crossing's aisles, the higher of the nave's roof and the transept's.
    const top = Math.max(gable(58, 36 - q), crossing ? gable(58, 32 - Math.abs(2 * X - 271)) : 0);
    return Y < top ? (Y >= top - 2 ? M_SLATE : M_ASHLAR) : AIR;
  }
  if (q < 36){
    // The arcade: piers every 16, pointed arches between them up to 21; the clerestory over the aisle's roof.
    const k = (X - 56) % 16;
    if (k >= 4 && Y <= 16 + Math.min(k - 4, 15 - k)) return AIR;
    if (Y < 56) return Y >= 36 && Y < 50 && k >= 6 && k < 10 ? M_STAINED : M_ASHLAR;
    if (Y < 58) return M_ASHLAR;
    const top = gable(58, 36 - q);
    return Y < top ? (Y >= top - 2 ? M_SLATE : M_ASHLAR) : AIR;
  }
  if (q < 60){
    // An aisle: clear to 26, its vault, the lean-to roof.
    if (Y < 26) return AIR;
    const top = 30 + ((60 - q) >> 2);
    return Y < top ? (Y >= top - 2 ? M_SLATE : M_ASHLAR) : AIR;
  }
  // The outer wall, its windows between the buttresses.
  const k = (X - 56) % 16;
  if (Y < 28) return X >= 56 && Y >= 6 && Y < 22 && k >= 6 && k < 10 ? M_STAINED : M_ASHLAR;
  return Y < 30 ? M_SLATE : AIR;
}

/* THE STATION, a terminus 208 along and 80 across, its front (X = 0) on a
   street and the line coming in at X = 206 on the axis, Z 32…48, at the
   viaduct's height (ballast at Y = 16, the deck's y = 24). The headhouse
   (X < 64): a lobby behind three doors, a grand stair 32 wide climbing a
   voxel every two from X = 14 to the concourse at Y = 17 (X 48…64), ticket
   halls each side, a clock tower over the front. The hall (X 64…206): the
   two tracks between two platforms (their tops at Y = 17, a step over the
   ballast), buffers at the tracks' ends with a gap between them, side walls
   with windows 7 over the platforms, a glass barrel vault on iron ribs
   springing at Y = 40, closed at both ends by glass. */
function stationVoxel(X, Y, Z){
  if (Y < 0) return AIR;
  const side = Z < 2 || Z >= 78, zc = Math.abs(2 * Z - 79);
  if (X < 64){
    if (X < 2){
      // The front: three doors, a lunette over the middle one.
      const door = (zc < 12 && Y <= 12 + ((12 - zc) >> 1)) || ((Math.abs(2 * Z - 27) < 8 || Math.abs(2 * Z - 131) < 8) && Y <= 10);
      if (Y >= 1 && door) return AIR;
      if (Y === 0) return M_MARBLE;
      if (Y >= 24 && Y < 48 && zc * zc + (2 * Y - 60) ** 2 < 24 * 24) return M_GLASS;
    }
    if (X < 2 || side){
      if (Y < 48) return side && Y >= 24 && Y < 40 && X >= 4 && X < 60 && X % 12 >= 4 && X % 12 < 8 ? M_GLASS : M_ASHLAR;
    }
    if (Y >= 48){
      if (Y < 50) return M_ASHLAR;
      if (Y < 52) return M_SLATE;
      // The clock tower and its cap.
      if (X >= 2 && X < 18 && Z >= 32 && Z < 48){
        if (Y < 100){
          const face = (X === 2 || Z === 32 || Z === 47) && (X === 2 ? zc * zc : (2 * X - 19) ** 2) + (2 * Y - 171) ** 2 < 144;
          return face ? M_CLOCK : M_ASHLAR;
        }
        const hw = 116 - Y;
        return hw > 0 && Math.abs(2 * X - 19) < hw && zc < hw ? M_SLATE : AIR;
      }
      return AIR;
    }
    if (Y === 0) return M_MARBLE;
    if (X >= 48) return Y < 17 ? M_ASHLAR : Y === 17 ? M_MARBLE : AIR;   // the concourse
    if (zc < 32 && X >= 14){
      const s = 1 + ((X - 14) >> 1);
      return Y < s ? M_ASHLAR : Y === s ? M_MARBLE : AIR;               // the grand stair
    }
    return AIR;
  }
  // The hall.
  const rv = zc * zc + (2 * Y - 80) ** 2;
  if (Y >= 40){
    if (rv >= 76 * 76 && rv < 80 * 80) return X % 12 < 2 ? M_METAL : M_GLASS;     // the vault, its ribs
    if (rv < 76 * 76 && (X >= 206 || (X < 66 && Y >= 52))) return M_GLASS;       // its ends
    return AIR;
  }
  if (side) return Y >= 24 && Y < 36 && (X - 64) % 16 >= 4 && (X - 64) % 16 < 12 ? M_GLASS : M_ASHLAR;
  const track = Z >= 32 && Z < 48;
  // The end wall, open for the line: the ballast runs through it onto the viaduct's.
  if (X >= 206 && !(track && Y >= 16 && Y < 32)) return M_ASHLAR;
  if (track){
    if (Y < 16) return M_ASHLAR;
    if (Y === 16) return M_BALLAST;
    if (Y === 17 && (Z === 34 || Z === 37 || Z === 42 || Z === 45)) return M_RAIL;
    if (X < 66 && Y <= 18 && ((Z >= 33 && Z < 39) || (Z >= 41 && Z < 47))) return M_METAL;   // buffers
    return AIR;
  }
  return Y < 17 ? M_ASHLAR : Y === 17 ? M_PLATFORM : AIR;
}

/* A SHIP, 96 long and 24 across, moored with its side Z = 0 against a pier
   and its stern (X = 0) toward the land. The hull is from the water's
   y = 2 to the deck, which is flush with the pier (y = 8, so you walk
   aboard through the gangway in the gunwale); the bow narrows over its last
   24. A wheelhouse at the stern (X 3…13, Z 5…19: every tile of the deck
   keeps somewhere to stand), its funnel; containers on deck between aisles;
   a mast at the bow. */
function shipVoxel(X, Y, Z){
  const hw2 = X < 72 ? 24 : 24 - (X - 72), zc = Math.abs(2 * Z - 23), inHull = zc < hw2;
  if (Y < -6) return M_GROUND;
  if (!inHull) return Y <= -5 ? M_WATER : AIR;
  if (Y < 0) return M_HULL;
  if (Y === 0) return M_DECK;
  const edge = zc >= hw2 - 2 || X === 0;
  if (edge && Y <= 2 && !(Z < 2 && X >= 24 && X < 56)) return M_HULL;               // the gunwale, and its gangway
  if (X >= 3 && X < 13 && Z >= 5 && Z < 19 && Y <= 14) return Y >= 9 && Y <= 10 && (X === 12 || Z === 5 || Z === 18) ? M_GLASS : M_HULL;
  if (X >= 5 && X < 9 && Z >= 10 && Z < 14 && Y >= 15 && Y <= 22) return M_HULL;     // the funnel
  if (((X >= 30 && X < 38) || (X >= 46 && X < 54)) && Z >= 6 && Z < 18 && Y <= 6) return M_CONTAINER;
  if (X >= 80 && X <= 81 && Z >= 11 && Z <= 12 && Y <= 20) return M_METAL;
  return AIR;
}

/* A TOWER CRANE on the quay, 64 long and 8 across, its counter-jib toward
   the land (X = 0) and its jib out over the water. It starts in the layer
   over the street (its foot is the surface's F_CRANE): a mast 4 × 4 to Y =
   48, the jib and the counter-jib at 44…47, a counterweight, the cab, a
   trolley and a hook on its cable. */
function craneVoxel(X, Y, Z){
  if (Y < 8) return AIR;
  const mast = X >= 18 && X < 22 && Z >= 2 && Z < 6;
  if (mast && Y < 48) return (X === 18 || X === 21) && (Z === 2 || Z === 5) || Y % 4 === 0 ? M_CRANE : AIR;
  if (X >= 19 && X < 21 && Z >= 3 && Z < 5 && Y >= 48 && Y < 54) return M_CRANE;
  if (X >= 22 && Z >= 3 && Z < 5 && Y >= 44 && Y <= 47) return Y === 44 || Y === 47 || (X + Y) % 4 === 0 ? M_CRANE : AIR;
  if (X < 18 && Z >= 2 && Z < 6 && Y >= 44 && Y <= 45) return M_CRANE;
  if (X >= 2 && X < 8 && Z >= 2 && Z < 6 && Y >= 40 && Y < 44) return M_ASHLAR;
  if (X >= 14 && X < 18 && Z >= 2 && Z < 6 && Y >= 40 && Y < 44) return Y === 42 ? M_GLASS : M_CRANE;
  if (X >= 50 && X < 52 && Z >= 3 && Z < 5 && Y >= 42 && Y < 44) return M_METAL;
  if (X === 50 && Z === 3 && Y >= 20 && Y < 42) return M_METAL;
  if (X >= 49 && X < 52 && Z >= 2 && Z < 5 && Y >= 17 && Y < 20) return M_METAL;
  return AIR;
}
const MARK_VOXEL = [stadiumVoxel, cathedralVoxel, stationVoxel, shipVoxel, craneVoxel];
// A mark's voxel in its own frame, for the tests (markCeil is held to it).
export const markVoxel = (mk, X, Y, Z, v = 0) => MARK_VOXEL[mk](X, Y, Z, v);
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
  const addGroup = (bx, bz, w, d, kind, extra = null) => {
    const g = groups.length;
    groups.push({ bx, bz, w, d, kind, ...extra });
    for (let z = bz; z < bz + d; z++) for (let x = bx; x < bx + w; x++){ groupOf[x + NB * z] = g; district[x + NB * z] = kind; }
  };
  const free = (bx, bz, w, d) => {
    if (bx < 0 || bz < 0 || bx + w > NB || bz + d > NB) return false;
    for (let z = bz; z < bz + d; z++) for (let x = bx; x < bx + w; x++) if (district[x + NB * z] !== 255) return false;
    return true;
  };
  /* The second round (D ≥ 10): the coast is the side of the world nearest
     the industry's direction (a diagonal picks by hash), and ca is the axis
     across it (0: x, 1: z), sgn the way to the sea along it. The river runs
     along ca through the row of blocks r (an index along the other axis,
     la), its last block at the coast the harbour's mouth, with one
     neighbour along the coast (two from 8 × 8 blocks) a harbour too. The
     railway runs along la on the street between ca-blocks k − 1 and k,
     inland of the harbour, from the station (those two blocks at la-index
     s, two from the river) to the world's edge across the river. */
  let ways = null;
  if (NB >= 4){
    const ax = Math.abs(idx) > Math.abs(idz) || (Math.abs(idx) === Math.abs(idz) && pick(mix(seed, 21), 2) === 0);
    const ca = ax ? 0 : 1, sgn = (ax ? idx : idz) > 0 ? 1 : -1, mouth = sgn > 0 ? NB - 1 : 0;
    const r = (NB >> 1) - 1 + pick(mix(seed, 22), 2);
    const at = (c, l) => ca === 0 ? [c, l] : [l, c];   // (ca-index, la-index) → (bx, bz)
    for (let K = 0; K < NB; K++){ const [bx, bz] = at(sgn > 0 ? K : NB - 1 - K, r); addGroup(bx, bz, 1, 1, K === NB - 1 ? HARBOUR : RIVER); }
    const nbrs = NB >= 8 ? [r - 1, r + 1] : [pick(mix(seed, 23), 2) ? r + 1 : r - 1];
    for (const l of nbrs){ const [bx, bz] = at(mouth, l); addGroup(bx, bz, 1, 1, HARBOUR); }
    let k = NB >> 1;
    if (k === mouth || k - 1 === mouth) k -= sgn;
    const s = r < NB >> 1 ? r + 2 : r - 2, toLow = s > r;
    const [sbx, sbz] = at(k - 1, s);
    addGroup(sbx, sbz, ca === 0 ? 2 : 1, ca === 0 ? 1 : 2, LANDMARK, { mark: STATION });
    ways = { ca, sgn, mouth, r, nbrs, k, s, toLow, lineBlocks: toLow ? [0, s - 1] : [s + 1, NB - 1] };
  }
  if (NB >= 4){
    const pw = 2, pd = NB >= 8 ? 2 : 1, off = NB >= 8 ? NB >> 2 : 1, cbx = cx2 >> 1, cbz = cz2 >> 1;
    const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
    const px = clamp(cbx + pdx * off - (pw >> 1), NB - pw), pz = clamp(cbz + pdz * off - (pd >> 1), NB - pd);
    // The nearest free place to where the park wants to be, that doesn't hold the line's street inside it.
    const straddles = (bx, bz) => {
      const { ca, k, lineBlocks: [l0, l1] } = ways;
      const c0 = ca === 0 ? bx : bz, cw = ca === 0 ? pw : pd, la0 = ca === 0 ? bz : bx, lw = ca === 0 ? pd : pw;
      return c0 <= k - 1 && c0 + cw - 1 >= k && la0 <= l1 && la0 + lw - 1 >= l0;
    };
    let best = null;
    for (let bz = 0; bz <= NB - pd; bz++) for (let bx = 0; bx <= NB - pw; bx++){
      if (!free(bx, bz, pw, pd) || straddles(bx, bz)) continue;
      const cost = Math.abs(bx - px) + Math.abs(bz - pz);
      if (!best || cost < best.cost) best = { bx, bz, cost };
    }
    if (best) addGroup(best.bx, best.bz, pw, pd, PARK);
  }
  const rest = [];
  for (let b = 0; b < n; b++){
    if (district[b] !== 255) continue;
    const ox = 2 * (b % NB) + 1 - cx2, oz = 2 * (b / NB | 0) + 1 - cz2;
    rest.push({ b, ox, oz, score: Math.floor((ox * ox + oz * oz) * 4096 / n) + pick(mix(seed, b, 7), 1024) - 512 });
  }
  rest.sort((p, q) => p.score - q.score || p.b - q.b);
  if (NB < 4){ const last = rest.pop(); addGroup(last.b % NB, last.b / NB | 0, 1, 1, PARK); }
  // The cathedral just outside downtown (the old town), the stadium out in the residential ring.
  if (ways){
    const m0 = rest.length, ic = Math.min(m0 - 1, Math.max(1, Math.round(m0 * 0.08))), is = Math.round(m0 * 0.6);
    for (const [i, mark] of [[is, STADIUM], [ic, CATHEDRAL]]){ const { b } = rest[i]; rest.splice(i, 1); addGroup(b % NB, b / NB | 0, 1, 1, LANDMARK, { mark }); }
  }
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
  return { district, groupOf, groups, ways };
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
  if (B.type === LANDMARK_TYPE) return s + 1 < B.ty1 ? markCode(B.mk, tx - B.x0, tz - B.z0, s + 1, B.front, B.v) : 0;
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
  const { district, groups, ways } = districtsOf(NB, seed);
  const g0 = new Int32Array(C).fill(groundCode(G_PLAIN)), g1 = new Int32Array(C), tree = new Uint8Array(C), colB = new Int32Array(C).fill(-1), top = new Uint16Array(C).fill(2);
  // The second round's: a column's railway (its K_RAIL code, layer 0), and the ship or crane in it (index + 1).
  const rail = new Int32Array(C), obj = new Int32Array(C), objects = [];
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
  /* ---- the second round (docs/city-log.md §10) ----------------------------------
     In a river or harbour block, a is the tile along ca toward the sea (0
     its landward edge) and b along la; gA is a along the whole river, from
     the world's inland edge. The channel is HW either side of its middle,
     which moves by up to 3 tiles from street to street (a hash a street)
     and is smoothstepped between them (3n² − 2n³, in integers), so at
     every bridge the river runs square to the street. */
  const Q = 13, HW = 5, PIERS = [6, 7, 14, 15, 22, 23], CRANE_B = [11, 19];
  const W = ways;
  const sideSea = W ? (W.ca === 0 ? (W.sgn > 0 ? 1 : 0) : (W.sgn > 0 ? 3 : 2)) : 0, sideLand = sideSea ^ 1;
  const sideB = W && W.ca === 0 ? 3 : 1, sideB0 = sideB ^ 1;
  const toTile = (gA, l) => { const t = W.sgn > 0 ? gA : NT - 1 - gA; return W.ca === 0 ? [t, l] : [l, t]; };
  const offAt = K => pick(mix(seed, K, 0x51b), 7) - 3;
  function cenAt(gA){
    const K = gA >> 5, p = gA & 31;
    if (p < 3) return 16 + offAt(K);
    if (p >= 29) return 16 + offAt(K + 1);
    const n = p - 3, N = 25, o0 = offAt(K), o1 = offAt(K + 1);
    return 16 + o0 + Math.floor((o1 - o0) * (3 * n * n * N - 2 * n * n * n) / (N * N * N));
  }
  const inChannel = (gA, b) => { const m = cenAt(gA); return b >= m - HW && b < m + HW; };
  const harbourLa = W ? [W.r, ...W.nbrs] : [];
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
        else if (along % 4 === 3 && G.kind !== DOWNTOWN && G.kind !== INDUSTRIAL && G.kind !== HARBOUR) setTree(tx, tz, SF_PAVE, false, mix(h, tx, tz));
      }
    }
    // The inside: a park, or lots.
    const ix0 = gx0 + 3, iz0 = gz0 + 3, iw = gw - 6, id = gd - 6;
    if (G.kind === PARK){ parkLayout(ix0, iz0, iw, id, h); parks.push({ x0: ix0, z0: iz0, w: iw, d: id, blocks: G.w * G.d }); continue; }
    if (G.kind === RIVER || G.kind === HARBOUR){ waterBlock(G, h); continue; }
    if (G.kind === LANDMARK){ landmarkBlock(G, ix0, iz0, iw, id, h); continue; }
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
  if (ways){ railings(); railway(); }
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
  function addObject(mk, gA0, a0, b0, la0, d, v, ty0){
    const [na, nc] = MARK_SIZE[mk], idx = objects.length, ty1 = markLayers(mk);
    let x0 = NT, z0 = NT, x1 = 0, z1 = 0;
    for (let a = a0; a < a0 + na; a++) for (let b = b0; b < b0 + nc; b++){
      const [tx, tz] = toTile(gA0 + a, la0 + b);
      x0 = Math.min(x0, tx); z0 = Math.min(z0, tz); x1 = Math.max(x1, tx + 1); z1 = Math.max(z1, tz + 1);
      const c = at(tx, tz);
      obj[c] = idx + 1; top[c] = Math.max(top[c], ty1); tree[c] = 0;
    }
    objects.push({ mk, x0, z0, W: x1 - x0, L: z1 - z0, d, v, ty0, ty1 });
  }
  /* A river block: bridges where its cross streets meet the channel (the
     road on a deck, the sidewalks on footways), water, a promenade along
     each bank, gardens behind, and a flight of steps down from each bank
     halfway along. A harbour block: past the quay (a = Q − 1) the water,
     piers two tiles wide, and at an open flank (no harbour beyond it) a
     breakwater; inland of it a yard of containers in rows with aisles every
     fourth tile, two tower cranes by the quay with their jibs over the
     water, ships moored to the first and the last pier, steps down. The
     mouth is a river block to the quay and the harbour's water after. */
  function waterBlock(G, h){
    const caIdx = W.ca === 0 ? G.bx : G.bz, Lb = W.ca === 0 ? G.bz : G.bx, la0 = 32 * Lb;
    const mouth = G.kind === HARBOUR && Lb === W.r, river = G.kind === RIVER || mouth, harbour = G.kind === HARBOUR;
    const gA0 = 32 * (W.sgn > 0 ? caIdx : NB - 1 - caIdx), landEnd = harbour ? Q - 1 : 29;
    const flank0 = !harbourLa.includes(Lb - 1), flank1 = !harbourLa.includes(Lb + 1);
    const tileOf = (a, b) => { const [tx, tz] = toTile(gA0 + a, la0 + b); return at(tx, tz); };
    for (let b = 0; b < 32; b++) for (let a = 0; a < 32; a++){
      const c = tileOf(a, b), chan = river && inChannel(gA0 + a, b);
      const water = () => { g0[c] = groundCode(G_RIVER); g1[c] = 0; tree[c] = 0; top[c] = 1; };
      const land = () => { g0[c] = groundCode(G_PLAIN); g1[c] = surfCode(SF_QUAY); tree[c] = 0; top[c] = 2; };
      if (harbour && a >= Q - 1){
        const breakwater = (b < 2 && flank0) || (b >= 30 && flank1);
        if (breakwater || (a === Q - 1 && !chan) || (!mouth && a < 29 && PIERS.includes(b))) land(); else water();
        continue;
      }
      const ring = a < 2 || a >= 30, walk = a === 2 || a === 29;
      if (chan){
        if (ring) g0[c] = groundCode(G_DECK, g0[c] >> 3 & 7);            // the road on its deck, its marking kept
        else if (walk){ g0[c] = groundCode(G_FOOT); tree[c] = 0; if ((g1[c] >> 3 & 15) === F_TRUNK) g1[c] = surfCode(SF_PAVE); top[c] = 2; }
        else water();
        continue;
      }
      if (b < 3 || b >= 29 || a < 3 || a >= landEnd) continue;            // the ring's roads and sidewalks, as made
      clear(c);
      if (river){
        const by = inChannel(gA0 + a, b - 1) || inChannel(gA0 + a, b + 1);
        if (by) g1[c] = surfCode(SF_PATH, pick(mix(h, a, b, 0xbe), 100) < 14 ? F_BENCH : F_NONE, pick(mix(h, a, b, 0xbf), 4));
        else {
          const r = pick(mix(h, a, b, 0x9a), 100), [tx, tz] = toTile(gA0 + a, la0 + b);
          g1[c] = surfCode(SF_GRASS);
          if (r < 22) setTree(tx, tz, SF_GRASS, pick(mix(h, a, b, 9), 100) < 35, mix(h, a, b, 10));
          else if (r < 28) g1[c] = surfCode(SF_GRASS, F_BUSH);
        }
      } else if (a === Q - 2 && CRANE_B.includes(b)) g1[c] = surfCode(SF_YARD, F_CRANE);
      else if (a >= 4 && a < Q - 3 && b >= 4 && b < 28 && (b & 3) && pick(mix(h, a, b, 0xc0), 100) < 75)
        g1[c] = surfCode(SF_YARD, F_CONTAINER, (W.ca === 0 ? 1 : 0) | (pick(mix(h, a, b, 0xc1), 3) ? 2 : 0));
      else g1[c] = surfCode(SF_YARD);
    }
    if (river){
      const aS = mouth ? 7 : 16, m = cenAt(gA0 + aS);
      g0[tileOf(aS, m - HW)] = groundCode(G_STAIR, sideB0);
      g0[tileOf(aS, m + HW - 1)] = groundCode(G_STAIR, sideB);
    }
    if (harbour && !mouth){
      g0[tileOf(Q, 4)] = groundCode(G_STAIR, sideLand);
      for (const b of CRANE_B) addObject(CRANE, gA0, Q - 4, b, la0, sideLand, 0, 2);
      if (pick(mix(h, 0x5a), 4)) addObject(SHIP, gA0, Q + 4, 8, la0, sideLand, pick(mix(h, 0x5b), 4), 0);
      if (pick(mix(h, 0x5c), 2)) addObject(SHIP, gA0, Q + 4, 19, la0, sideLand, pick(mix(h, 0x5d), 4) | 8, 0);
    }
  }
  /* Railings: every surface in a river or harbour block gets one on each
     side over open water (not a bridge, not a ship), opening where steps go
     down from it. */
  function railings(){
    const open = (tx, tz) => {
      if (tx < 0 || tz < 0 || tx >= NT || tz >= NT) return 0;
      const c = at(tx, tz), k = g0[c];
      if ((obj[c] && objects[obj[c] - 1].ty0 === 0) || k >>> KS !== K_GROUND) return 0;
      return (k & 7) === G_RIVER ? 1 : (k & 7) === G_STAIR ? 2 : 0;
    };
    for (const G of groups){
      if (G.kind !== RIVER && G.kind !== HARBOUR) continue;
      for (let tz = 32 * G.bz; tz < 32 * G.bz + 32; tz++) for (let tx = 32 * G.bx; tx < 32 * G.bx + 32; tx++){
        const c = at(tx, tz);
        if (g1[c] >>> KS !== K_SURF) continue;
        let r = 0, o = 0;
        for (let d = 0; d < 4; d++){
          const w = open(tx + DX[d], tz + DZ[d]);
          if (!w) continue;
          r |= 1 << d;
          if (w === 2 && (g0[at(tx + DX[d], tz + DZ[d])] >> 3 & 7) === (d ^ 1)) o |= 1 << d;
        }
        g1[c] = (g1[c] | r << 9 | o << 13) >>> 0;
      }
    }
  }
  /* The railway: two tiles across the line's street, from the station to
     the world's edge; a pillar every fourth tile where the street is road
     (or a bridge's deck); a buffer at the edge. A street tree under it
     loses its crown. */
  function railway(){
    const { ca, k, toLow, s } = W, C0 = 32 * k, l0 = toLow ? 0 : 32 * s + 29, l1 = toLow ? 32 * s + 3 : NT;
    for (let l = l0; l < l1; l++) for (let side = 0; side < 2; side++){
      const t = C0 - 1 + side, c = ca === 0 ? at(t, l) : at(l, t), gt = g0[c] & 7;
      const pillar = (l & 3) === 0 && (gt === G_ROAD || gt === G_DECK) ? 1 : 0;
      const base = railCode(ca === 0 ? 1 : 0, side, pillar, 0, l === 0 ? 1 : l === NT - 1 ? 2 : 0);
      rail[c] = base; top[c] = Math.max(top[c], RAIL_TY + 1);
      if (tree[c]){ tree[c] = 0; g1[c] = surfCode(SF_PAVE); }
      if (pillar) g1[c] = (base | 1 << 3) >>> 0;
    }
    W.line = { from: l0, to: l1, tiles: l1 - l0 };
  }
  /* A landmark's block. The stadium and the cathedral fill the lot (the
     cathedral's front on a side by hash). The station stands across the
     line's old street, its front away from the line; the rest of its two
     blocks is forecourt, with gardens at the far sides. */
  function landmarkBlock(G, ix0, iz0, iw, id, h){
    if (G.mark === STATION){
      paved(ix0, iz0, iw, id, SF_PLAZA, h, 5);
      const C0 = 32 * W.k, front = W.toLow ? sideB : sideB0;
      if (W.ca === 0){ garden(ix0, iz0, C0 - 14 - ix0, id, 25, 30, h); garden(C0 + 14, iz0, ix0 + iw - C0 - 14, id, 25, 30, h); placeMark(STATION, C0 - 5, iz0, 10, 26, front, 0, h); }
      else { garden(ix0, iz0, iw, C0 - 14 - iz0, 25, 30, h); garden(ix0, C0 + 14, iw, iz0 + id - C0 - 14, 25, 30, h); placeMark(STATION, ix0, C0 - 5, 26, 10, front, 0, h); }
    } else placeMark(G.mark, ix0, iz0, iw, id, G.mark === CATHEDRAL ? pick(h, 4) : 2 * pick(h, 2), 0, h);
  }
  function placeMark(mk, x0, z0, W_, L, front, v, h){
    const id = buildings.length, ty1 = markLayers(mk);
    buildings.push({ id, type: LANDMARK_TYPE, mk, x0, z0, W: W_, L, front, v, hash: h, F: 0, tiers: [], shape: mk, crown: C_FLAT, spire: 0,
                     ty1, topTier: new Int8Array(W_ * L), district: LANDMARK, pal: pick(h, 4), tint: pick(mix(h, 1), 6) });
    for (let j = 0; j < L; j++) for (let i = 0; i < W_; i++){ const c = at(x0 + i, z0 + j); colB[c] = id; g1[c] = 0; tree[c] = 0; top[c] = ty1; }
  }

  const features = W ? { coast: sideSea, river: { axis: W.ca, row: W.r, blocks: NB, bridges: NB }, harbour: { blocks: harbourLa.length,
      ships: objects.filter(o => o.mk === SHIP).length, cranes: objects.filter(o => o.mk === CRANE).length },
    railway: { axis: W.ca === 0 ? 1 : 0, street: 32 * W.k, ...W.line }, landmarks: buildings.filter(B => B.type === LANDMARK_TYPE).map(B => B.mk) } : null;
  const plan = { desc, D, NB, NT, district, groups, buildings, parks, g0, g1, tree, colB, top, rail, obj, objects, features, planMs: Date.now() - t0 };
  plan.info = cityInfo(plan);
  planCache.set(key, plan);
  if (planCache.size > 3) planCache.delete(planCache.keys().next().value);
  return plan;
}

/* A tile's code anywhere in the world (0: air). */
export function codeAt(plan, tx, ty, tz){
  const NT = plan.NT;
  if (tx < 0 || tz < 0 || ty < 0 || tx >= NT || tz >= NT) return 0;
  const c = tx + NT * tz, o = plan.obj ? plan.obj[c] : 0;
  if (o){ const O = plan.objects[o - 1]; if (ty >= O.ty0 && ty < O.ty1) return markCode(O.mk, tx - O.x0, tz - O.z0, ty, O.d, O.v); }
  if (ty === 0) return plan.g0[c];
  if (ty >= plan.top[c]) return 0;
  const b = plan.colB[c];
  if (b >= 0) return buildingCode(plan, plan.buildings[b], tx, ty - 1, tz);
  if (ty === 1) return plan.g1[c];
  const r = plan.rail ? plan.rail[c] : 0;
  if (r) return ty <= RAIL_TY ? (r | ty << 3) >>> 0 : 0;
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
  return { blocks: NB * NB, byDistrict, byType, towers, buildings: buildings.length, parks: parks.length, storeys, features: plan.features,
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
    if (plan.buildings[b].type === LANDMARK_TYPE) continue;     // no band: a landmark doesn't repeat
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
      let any = 0;
      for (let i = 0; i < 512; i++) any |= occ[i] = m[i] ? 1 : 0;
      // A landmark's air over its roofs is most of its tiles: EMPTY, without interning anything.
      id = any ? store.fromDense(occ, TILE).root : EMPTY;
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
      const O = plan.obj[c] ? plan.objects[plan.obj[c] - 1] : null;
      if (O && ty >= O.ty0 && ty < O.ty1) m = MARK_FILL[O.mk];
      else if (B && ty >= 1 && ty < plan.top[c]) m = B.type === LANDMARK_TYPE ? MARK_FILL[B.mk] : M_FACADE;
      else if (plan.rail[c] && ty >= 2 && ty <= RAIL_TY) m = M_CORE;
      else if (ty >= 2 && plan.tree[c]) m = M_LEAF;
      else {
        const g = ty >= 1 && plan.g1[c] ? plan.g1[c] : plan.g0[c];
        // The river's and the harbour's water is three voxels down.
        m = tileMats(g)[(xi & 7) + 8 * ((ty >= 1 && plan.g1[c] ? 0 : 7) + 8 * (zi & 7))] || tileMats(g)[(xi & 7) + 8 * (3 + 8 * (zi & 7))] || M_GROUND;
      }
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
        // A landmark's or a ship's glass is clear and pale (the station's vault was a building's tint, and read as brown).
        else if (kind === K_MARK){ col = [172, 206, 222]; k = j * (0.94 + 0.12 * pane); }
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
      default: col = m >= M_QUAY ? undefined : BASE[m] || BASE[M_GROUND];
    }
    if (col === undefined){
      const r = secondColour(m, code, kind, xi, yi, zi, tx, ty, tz, B, plan);
      col = r[0]; k = j * r[1];
    }
    if (m === M_LAMP) return rgb8(255, 240, 182);
    return rgb8(col[0] * k, col[1] * k, col[2] * k);
  };
}
/* The second round's materials (docs/city-log.md §10): [colour, shade]. A
   mark's voxel is read in its own frame (markFrame), for the pitch's lines,
   the seats' sections, the platforms' edges and the ship's paint. */
const MARK_FILL = [M_SEAT, M_ASHLAR, M_ASHLAR, M_HULL, M_CRANE];
const ASHLARS = [[204, 190, 160], [182, 176, 168], [168, 98, 74], [214, 204, 186]];   // sandstone, granite, brick, limestone
const STAINED = [[176, 36, 44], [40, 66, 168], [222, 172, 48], [44, 132, 76], [124, 48, 150]];
const HULLS = [[156, 40, 38], [38, 50, 82], [36, 90, 72], [42, 42, 46]];
const BOXES = [[178, 58, 44], [46, 96, 152], [60, 132, 80], [214, 150, 52], [120, 120, 124], [150, 74, 120]];
function secondColour(m, code, kind, xi, yi, zi, tx, ty, tz, B, plan){
  const F = kind === K_MARK ? markFrame(code, xi, yi, zi) : null, h = hash3(xi, yi, zi);
  switch (m){
    case M_QUAY: return [[170, 166, 158], (xi & 3) === 0 || (zi & 3) === 0 ? 0.88 : 1];
    case M_RAILING: return [[64, 70, 78], 1];
    case M_BALLAST: {
      // Sleepers across the track every other voxel: along x on a line along x (the rail's axis bit), or the station's X.
      const alongX = kind === K_RAIL ? !(code & 1) : F ? (F[4] === STATION && (B.front < 2)) : true;
      return ((alongX ? xi : zi) & 1) === 0 ? [[98, 74, 54], 1] : [[128, 120, 108], 0.9 + 0.2 * h];
    }
    case M_RAIL: return [[156, 160, 168], 1];
    case M_PLATFORM: {
      const edge = F && (F[2] === 31 || F[2] === 48);
      return edge ? [[226, 196, 60], 1] : [[196, 190, 180], ((xi >> 2) + (zi >> 2)) & 1 ? 0.96 : 1.02];
    }
    case M_SEAT: {
      // Two colours by quarter, a pale band every fifth row.
      if (!F) return [[160, 40, 46], 1];
      const { d } = stadiumAt(F[0], F[2]), row = (d - ST.TRACK) >> 2;
      return row % 5 === 4 ? [[226, 222, 212], 1] : (F[0] < ST.C) !== (F[2] < ST.C) ? [[176, 38, 46], 1] : [[38, 70, 162], 1];
    }
    case M_PITCH: {
      if (!F) return [[72, 146, 60], 1];
      const X = F[0], Z = F[2], x0 = ST.C - ST.hx, x1 = ST.C + ST.hx - 1, z0 = ST.C - ST.hz, z1 = ST.C + ST.hz - 1;
      const r2 = (2 * X + 1 - 2 * ST.C) ** 2 + (2 * Z + 1 - 2 * ST.C) ** 2;
      const box = (X - x0 < 14 || x1 - X < 14) && Math.abs(2 * Z + 1 - 2 * ST.C) <= 28;
      const line = X === x0 + 1 || X === x1 - 1 || Z === z0 + 1 || Z === z1 - 1 || X === ST.C || (r2 >= 22 * 22 && r2 < 26 * 26)
        || (box && (X === x0 + 14 || X === x1 - 14 || Math.abs(2 * Z + 1 - 2 * ST.C) === 27));
      return line ? [[236, 236, 228], 1] : [[70, 146, 58], (X >> 3) & 1 ? 1.07 : 0.93];
    }
    case M_ASHLAR: {
      const course = yi >> 1, a = (xi + zi + (course & 1) * 3);
      return [ASHLARS[B ? (B.mk === STATION ? 2 : B.pal & 1 ? 3 : 0) : kind === K_MARK ? 1 : 1], (yi & 1) === 0 || a % 6 === 0 ? 0.86 : 1];
    }
    case M_SLATE: return [[70, 78, 92], yi & 1 ? 0.9 : 1.04];
    case M_STAINED: {
      const lead = (xi + yi) % 4 === 0 || (zi + yi) % 4 === 0;
      return lead ? [[40, 36, 34], 1] : [STAINED[mix(xi >> 1, yi >> 1, zi >> 1) % 5], 1.1];
    }
    case M_MARBLE: return ((xi >> 2) + (zi >> 2)) & 1 ? [[226, 222, 212], 1] : [[86, 84, 92], 1];
    case M_HULL: {
      if (!F) return [[156, 40, 38], 1];
      const Y = F[1];
      if (Y < 0) return Y === -4 ? [[232, 230, 222], 1] : [HULLS[F[3] & 3], 1];   // a white line at the waterline's top
      if (Y >= 15) return Y >= 21 ? [[30, 30, 32], 1] : [[200, 64, 40], 1];        // the funnel
      return [[236, 234, 226], 1];
    }
    case M_DECK: return [[170, 132, 90], ((F ? F[2] : zi) & 1) ? 0.92 : 1.04];
    case M_CONTAINER: {
      const key = F ? mix(F[0] >> 3, tx, tz) : mix(tx, ty, tz, 0xb0c);
      return [BOXES[key % 6], (xi + zi) & 1 ? 0.88 : 1];
    }
    case M_CRANE: return [[226, 176, 40], (yi & 7) === 0 ? 0.8 : 1];
    case M_CLOCK: return [[238, 230, 200], 1];
  }
  return [BASE[m] || BASE[M_GROUND], 1];
}
