/* DUNGEON CORE: a sprawling dungeon of many floors (docs/dungeon-log.md).
   Pure: imports dag-core.js only, no DOM. Asked for 2026-11-14: "a sprawling
   dungeon generator, multiple floors, the rooms should be all connected; fine
   to use the wave collapse algorithm".

   THE GRID. The world is a grid of cells 16 voxels a side (CELL), one floor
   (storey) a row of cells: N × N cells a floor, N = 2^(D − 4), and F floors
   from y = 0 up, so the dungeon is a slab 16·F voxels thick with air above.
   A cell is a tile, and a tile is a 16³ block: one level-4 node of the DAG.
   Every cell holding the same tile is the same node, which is what makes a
   D = 12 dungeon of 400,000 cells a few thousand nodes.

   THE TILES. Each tile says what each of its six faces is (a socket):
     sides (−x, +x, −z, +z): 0 closed, 1 narrow (a doorway or a corridor's end,
       4 wide, 8 tall), 2 wide (one room going on into the next cell), 3 a
       stair's mouth (narrow, but it may meet a 1 only: no stair opens into
       another, so every stair has a cell that isn't a stair at its mouth);
     down and up: 0 closed, 1 a hall (a room two floors tall), 2 + d a stair
       climbing away from side d.
       Since 2026-11-14's second round (docs/dungeon-log.md §10): 6 a tall
       room (a floor and a half: the room below, a cap of its air above),
       and 7 + d a spiral stair with its mouth on side d, the same side on
       both floors.
   Two cells side by side must agree on the face they share, and a tile above
   another must agree with it on theirs. The kinds: rock (all closed),
   corridors (any non-empty set of arms), rooms (any side 0, 1 or 2, and the
   hall or tall bits), stairs, a pair of cells one above the other (the lower
   one's mouth on side d, the upper one's on the side across), caps (the top
   of a tall room: its sides wide or closed as the room's are) and spiral
   stairs (a pair again, climbing a full turn round a pillar).

   THE COLLAPSE (wave function collapse, on sockets). Every cell starts with
   the set of tiles it may be, a bitset of NT bits. Propagation keeps each
   neighbour's set to the tiles whose shared face fits some tile still in the
   cell's set: for each face, the cell's possible sockets are a mask, and the
   neighbour keeps the tiles whose face is compatible with one of them
   (SIDE_MASK, precomputed for every mask). Then the cell with the fewest tiles
   left (ties by a hash) is collapsed to one, picked by weight, and it
   propagates again, until every cell holds one. Weights and the order are
   integers and hashes, never floats, so the dungeon is the same in every
   engine (a seed must make the same world in Safari as in Node's pins).

   SEEDS before the collapse: rectangular rooms (2 to 5 cells a side, a cell
   apart), some of them halls two floors tall, and stairs between every pair
   of floors. A seed only narrows a cell's set (a room's inside faces wide,
   its edge faces closed or a door, the collapse picks), so the collapse
   still decides the doors. The tile set is complete where it matters: a free
   cell may be a room with any socket 0, 1 or 2 on any side, so whatever its
   neighbours say, some room fits, and the seeds are placed so a stair's
   mouth never faces another stair. So the collapse never contradicts, and
   it throws if it ever does (the test runs many seeds).

   CONNECTED. The collapse makes corridors and rooms that may not meet. On
   each floor the pieces (cells joined by open faces) grow through rock at
   once, a breadth-first wave from every piece (stairs neither grow nor are
   crossed), and where two pieces' waves meet is a candidate tunnel. The
   cheapest candidates joining all the pieces (Kruskal's tree) are carved, a
   corridor through the rock and a door at each end, plus a few short ones
   more for loops. Then each floor is one piece, every stair's mouth is on
   its floor's piece, and every pair of floors has a stair: the dungeon is
   connected, on foot (test/dungeon-core.test.js walks it voxel by voxel).

   LESS CORRIDOR (the user's answer to §8 Q1: "too much corridor"). The free
   weights favour rock and rooms more, and after the join every dead end is
   pruned back to rock, one cell at a time, until what's left ends in a room,
   a stair or a junction (but one dead end in eight, which stays as a stub).
   Pruning a leaf never disconnects anything, so the walk still holds.

   DRESSING the collapse doesn't see (a variant, the code's low 8 bits): a
   room's pillar, basin, brazier and torches, a **pit** through its floor to
   the room below, a **secret door** in a wall between two rooms (solid, the
   wall's shape and nearly its colour, but the walk passes it: secretDoors
   lists the boxes for the viewer's walker), a **bridge** across a hall's
   upper floor, and **water** in a corridor network's floor.

   The world is its descriptor { kind: 'dungeon', D, seed, floors }, plus the
   table of tile codes the plan makes (one int32 a cell), which travels with
   the colour so the chunk workers don't collapse it again. */
import { createStore, EMPTY } from './dag-core.js';

export const CELL = 16, CELL_LEVEL = 4;
export const DUNGEON_LIMITS = { D: [8, 12], floors: [1, 12] };
export const DUNGEON_DEFAULTS = { D: 10, floors: 4 };

export function dungeonDesc({ D = DUNGEON_DEFAULTS.D, seed = 1, floors = DUNGEON_DEFAULTS.floors } = {}){
  if (!Number.isInteger(D) || D < DUNGEON_LIMITS.D[0] || D > DUNGEON_LIMITS.D[1]) throw new Error(`dungeon: D=${D} is outside ${DUNGEON_LIMITS.D.join('…')}`);
  if (!Number.isInteger(floors) || floors < DUNGEON_LIMITS.floors[0] || floors > DUNGEON_LIMITS.floors[1]) throw new Error(`dungeon: ${floors} floors is outside ${DUNGEON_LIMITS.floors.join('…')}`);
  if (floors * CELL > 2 ** D) throw new Error(`dungeon: ${floors} floors don't fit in D=${D}`);
  if (!Number.isInteger(seed) || seed < 1 || seed > 0xffff) throw new Error(`dungeon: seed ${seed} is outside 1…65535`);
  return { kind: 'dungeon', D, seed, floors };
}
/* The ground's datum for a universe (docs/universe-plan.md §4, step 5): the slab's
   top. Every cell on the world's edge closes its outer side, and a closed side is
   wall to the top of its floor, so a walker at the edge stands on the top floor's
   walls, y = 16·F, and the roofless top floor opens below the plane like a ruin.
   test/universe-core.test.js holds it against every edge column. */
export const dungeonGround = desc => CELL * desc.floors;
export const dungeonParam = d => [d.D, d.floors].join(',');
export function dungeonFromParam(s, seed = 1){
  const p = String(s).split(',').map(Number);
  if (p.length !== 2 || p.some(v => !Number.isInteger(v))) throw new Error(`dungeon: '${s}' isn't D,floors`);
  return dungeonDesc({ D: p[0], floors: p[1], seed });
}

/* ---- hashes ---------------------------------------------------------------
   Integer only (Math.imul and shifts), so every engine agrees. `mix` is a
   stateless hash of its arguments; `rngOf` a sequential generator (mulberry32)
   for the seeds' placement, whose order is fixed. */
export function mix(...v){
  let h = 0x9e3779b9;
  for (const x of v){ h = Math.imul(h ^ (x | 0), 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; }
  return h >>> 0;
}
function rngOf(seed){
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---- the tiles -------------------------------------------------------------
   Sides 0..3 are −x, +x, −z, +z (the side across is d ^ 1); 4 is down, 5 up.
   A step along side d is DX[d], DZ[d]. */
export const DX = [-1, 1, 0, 0], DZ = [0, 0, -1, 1];
export const ROCK = 0, CORR = 1, ROOM = 2, STAIR_LO = 3, STAIR_HI = 4, CAP = 5, SPIRAL_LO = 6, SPIRAL_HI = 7;
export const KIND_NAMES = ['rock', 'corridor', 'room', 'stair (low)', 'stair (high)', 'cap', 'spiral (low)', 'spiral (high)'];
// The vertical sockets past the stairs' 2..5: a tall room's, and a spiral's 7 + d.
export const TALL = 6, SPIRAL = 7;
const NS = [4, 4, 4, 4, 11, 11];   // sockets a face may hold, by side
const isStairKind = k => k === STAIR_LO || k === STAIR_HI || k === SPIRAL_LO || k === SPIRAL_HI;
// Kinds with nothing to walk on and nothing to carve: never a piece, never in the wave.
const isShut = k => k === ROCK || k === CAP;
const T = [];   // { kind, s: [4], down, up }
const tileKey = (kind, s, down, up) => `${kind}:${s.join('')}:${down}:${up}`;
const TILE_INDEX = new Map();
function addTile(kind, s, down, up){ TILE_INDEX.set(tileKey(kind, s, down, up), T.length); T.push({ kind, s, down, up }); }
addTile(ROCK, [0, 0, 0, 0], 0, 0);
for (let m = 1; m < 16; m++) addTile(CORR, [0, 1, 2, 3].map(d => m >> d & 1), 0, 0);
// A room's (down, up): plain, a hall's upper cell, a hall's lower cell, a tall room's.
for (const [down, up] of [[0, 0], [1, 0], [0, 1], [0, TALL]]) for (let q = 0; q < 81; q++) addTile(ROOM, [q % 3, (q / 3 | 0) % 3, (q / 9 | 0) % 3, q / 27 | 0], down, up);
for (let d = 0; d < 4; d++) addTile(STAIR_LO, [0, 1, 2, 3].map(e => e === d ? 3 : 0), 0, 2 + d);
for (let d = 0; d < 4; d++) addTile(STAIR_HI, [0, 1, 2, 3].map(e => e === (d ^ 1) ? 3 : 0), 2 + d, 0);
// A tall room's cap: wide where the room goes on, closed at its edge, so its air joins its neighbours'.
for (let m = 0; m < 16; m++) addTile(CAP, [0, 1, 2, 3].map(d => (m >> d & 1) * 2), TALL, 0);
for (let d = 0; d < 4; d++) addTile(SPIRAL_LO, [0, 1, 2, 3].map(e => e === d ? 3 : 0), 0, SPIRAL + d);
for (let d = 0; d < 4; d++) addTile(SPIRAL_HI, [0, 1, 2, 3].map(e => e === d ? 3 : 0), SPIRAL + d, 0);
export const NT = T.length, NW = Math.ceil(NT / 32);
export const TILES = T;
export function tileOf(kind, s, down = 0, up = 0){
  const i = TILE_INDEX.get(tileKey(kind, s, down, up));
  if (i === undefined) throw new Error(`dungeon: no tile ${tileKey(kind, s, down, up)}`);
  return i;
}
const sockOf = (t, side) => side < 4 ? T[t].s[side] : side === 4 ? T[t].down : T[t].up;
const opp = side => side ^ 1;   // 0↔1, 2↔3, 4↔5
// Horizontal: equal, but a stair's mouth (3) meets a narrow face (1) only.
const COMPAT_H = [1 << 0, 1 << 1 | 1 << 3, 1 << 2, 1 << 1];
const compatMask = (side, mask) => {
  if (side >= 4) return mask;
  let m = 0;
  for (let s = 0; s < 4; s++) if (mask >> s & 1) m |= COMPAT_H[s];
  return m;
};
/* SOCK_BITS[side][s]: the tiles whose face on `side` is s. SIDE_MASK[side][m]:
   the tiles whose face on `side` is in mask m (4 sockets a side, so 16 masks;
   11 up and down, so 2,048). */
const bits = () => new Uint32Array(NW);
const SOCK_BITS = NS.map(n => Array.from({ length: n }, bits));
for (let t = 0; t < NT; t++) for (let side = 0; side < 6; side++) SOCK_BITS[side][sockOf(t, side)][t >> 5] |= 1 << (t & 31);
const SIDE_MASK = NS.map((n, side) => Array.from({ length: 1 << n }, (_, m) => {
  const b = bits();
  for (let s = 0; s < n; s++) if (m >> s & 1) for (let w = 0; w < NW; w++) b[w] |= SOCK_BITS[side][s][w];
  return b;
}));
const popcount = v => { v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return Math.imul((v + (v >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24; };

/* The weights, integers. A free cell (one no seed narrowed): rock most
   often; corridors favouring straight runs (so they reach somewhere) over
   turns, junctions and dead ends; rooms rarely from nothing, but a room's
   side, once a room has started, goes on wide as often as it closes, so
   rooms grow as blobs. A seeded room's edge side is a door one time in
   five. Halls, tall rooms, caps and stairs come from seeds only: a free
   cell can't be one.
   Less corridor (§8 Q1): rock was 60 against straight runs 24, turns 7,
   junctions 4 and the rest 2, and corridors were 54% of the open cells at
   D = 10. Rock is 100 now against 10, 3, 1 and 1 (dungeon-log §10 has the
   share at each step). */
const K = 1e8;
const CORR_W = m => { const n = popcount(m); return K * (n === 1 ? 1 : n === 2 ? ((m === 3 || m === 12) ? 10 : 3) : 1); };
const ROOM_F = [45, 10, 45], SEED_F = [4, 1];
const W_FREE = new Float64Array(NT), W_SEED = new Float64Array(NT);
const FREE_SET = bits();
for (let t = 0; t < NT; t++){
  const { kind, s, down, up } = T[t];
  if (kind === ROCK) W_FREE[t] = 100 * K;
  else if (kind === CORR) W_FREE[t] = CORR_W(s[0] | s[1] << 1 | s[2] << 2 | s[3] << 3);
  else if (kind === ROOM && !down && !up) W_FREE[t] = 15 * s.reduce((p, v) => p * ROOM_F[v], 1);
  if (W_FREE[t]) FREE_SET[t >> 5] |= 1 << (t & 31);
  // A seeded room's sides: wide inside the rectangle (weight 1), closed or a door at its edge.
  if (kind === ROOM) W_SEED[t] = s.reduce((p, v) => p * (v === 2 ? 1 : SEED_F[v] ?? 0), 1);
  if (isStairKind(kind) || kind === CAP) W_SEED[t] = 1;
}

/* ---- seeds ----------------------------------------------------------------
   Rectangular rooms a floor, a fifth of them halls on two floors and a
   seventh tall (a floor and a half, capped on the floor above), then stairs
   between every pair of floors, a third of them spirals. `vert` is a seeded
   room cell's (down, up) as down | up << 4; `cap` marks a tall room's top. */
const ROOM_SIZE = [2, 5], HALL_SHARE = 0.2, TALL_SHARE = 0.15, ROOM_DENSITY = 40, STAIR_DENSITY = 400, SPIRAL_SHARE = 0.35;
export function placeSeeds(N, F, seed){
  const rnd = rngOf(mix(seed, 0x5eed)), C = N * N * F, at = (x, z, f) => x + N * (z + N * f);
  const room = new Int32Array(C).fill(-1), stair = new Int8Array(C).fill(-1), mouth = new Uint8Array(C);
  const vert = new Uint8Array(C), cap = new Uint8Array(C);
  const rooms = [], stairs = [];
  const clear = (f, x0, z0, w, h, gap) => {
    for (let z = z0 - gap; z < z0 + h + gap; z++) for (let x = x0 - gap; x < x0 + w + gap; x++){
      if (x < 0 || z < 0 || x >= N || z >= N) continue;
      const c = at(x, z, f);
      if (room[c] >= 0 || stair[c] >= 0 || cap[c]) return false;
    }
    return true;
  };
  for (let f = 0; f < F; f++){
    const want = Math.max(1, Math.round(N * N / ROOM_DENSITY));
    for (let tries = 0, made = 0; made < want && tries < 8 * want; tries++){
      const span = ROOM_SIZE[1] - ROOM_SIZE[0] + 1;
      const w = Math.min(N, ROOM_SIZE[0] + Math.floor(rnd() * span)), h = Math.min(N, ROOM_SIZE[0] + Math.floor(rnd() * span));
      const x0 = Math.floor(rnd() * (N - w + 1)), z0 = Math.floor(rnd() * (N - h + 1));
      const r = rnd(), two = f + 1 < F, hall = two && r < HALL_SHARE, tall = two && !hall && r < HALL_SHARE + TALL_SHARE;
      if (!clear(f, x0, z0, w, h, 1) || ((hall || tall) && !clear(f + 1, x0, z0, w, h, 1))) continue;
      const mark = (g, v, kind) => {
        const id = rooms.length;
        rooms.push({ f: g, x: x0, z: z0, w, h, hall: kind === 'hall' ? (v ? (v & 15 ? 1 : 2) : 0) : 0, tall: kind === 'tall' });
        for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++){ room[at(x, z, g)] = id; vert[at(x, z, g)] = v; }
      };
      if (hall){ mark(f, 1 << 4, 'hall'); mark(f + 1, 1, 'hall'); }
      else if (tall){
        mark(f, TALL << 4, 'tall');
        for (let z = z0; z < z0 + h; z++) for (let x = x0; x < x0 + w; x++) cap[at(x, z, f + 1)] = 1;
      } else mark(f, 0, 'room');
      made++;
    }
  }
  /* Stairs: a lower cell on floor f with its mouth on side d, the upper cell
     above it with its mouth on the side across (a straight stair) or on the
     same side (a spiral, which climbs a full turn). Neither may be a seed,
     and a mouth must land in the grid on a cell that isn't a stair or a cap
     (a stair's mouth needs a door, and a cap has none), while no stair may
     stand where another's mouth lands: then no two stairs face.
     stair[c]: 0..3 a straight stair's lower cell (d), 4..7 its upper cell,
     8..11 a spiral's lower cell, 12..15 its upper cell. */
  for (let f = 0; f + 1 < F; f++){
    const want = Math.max(1, Math.round(N * N / STAIR_DENSITY));
    for (let tries = 0, made = 0; made < want && tries < 60 * want; tries++){
      const x = Math.floor(rnd() * N), z = Math.floor(rnd() * N), d = Math.floor(rnd() * 4), spiral = rnd() < SPIRAL_SHARE;
      const lo = at(x, z, f), hi = at(x, z, f + 1);
      const mx = x + DX[d], mz = z + DZ[d], ux = spiral ? mx : x - DX[d], uz = spiral ? mz : z - DZ[d];
      if (mx < 0 || mz < 0 || mx >= N || mz >= N || ux < 0 || uz < 0 || ux >= N || uz >= N) continue;
      const mLo = at(mx, mz, f), mHi = at(ux, uz, f + 1);
      if (room[lo] >= 0 || room[hi] >= 0 || stair[lo] >= 0 || stair[hi] >= 0 || mouth[lo] || mouth[hi] || cap[lo] || cap[hi]) continue;
      if (stair[mLo] >= 0 || stair[mHi] >= 0 || cap[mLo] || cap[mHi]) continue;
      stair[lo] = (spiral ? 8 : 0) + d; stair[hi] = (spiral ? 12 : 4) + d; mouth[mLo] = 1; mouth[mHi] = 1;
      stairs.push({ f, x, z, d, spiral });
      made++;
    }
  }
  return { room, stair, vert, cap, rooms, stairs };
}
// The tile a stair seed's cell is, from stair[c].
function stairTile(v){
  const d = v & 3, k = v >> 2, side = [0, 1, 2, 3].map(e => e === (k === 1 ? d ^ 1 : d) ? 3 : 0);
  return k === 0 ? tileOf(STAIR_LO, side, 0, 2 + d) : k === 1 ? tileOf(STAIR_HI, side, 2 + d, 0)
       : k === 2 ? tileOf(SPIRAL_LO, side, 0, SPIRAL + d) : tileOf(SPIRAL_HI, side, SPIRAL + d, 0);
}

/* ---- the collapse ---------------------------------------------------------- */
export function collapse(N, F, seed, seeds, stats = null){
  const C = N * N * F, at = (x, z, f) => x + N * (z + N * f);
  const dom = new Uint32Array(C * NW), weight = new Float64Array(C);
  const { room, stair, vert, cap, rooms } = seeds;
  // A cap's sides: wide where the tall room below goes on, closed at its edge.
  const capTile = (x, z, f) => tileOf(CAP, [0, 1, 2, 3].map(d => {
    const nx = x + DX[d], nz = z + DZ[d];
    return nx >= 0 && nz >= 0 && nx < N && nz < N && cap[at(nx, nz, f)] ? 2 : 0;
  }), TALL, 0);
  // The starting sets.
  for (let f = 0; f < F; f++) for (let z = 0; z < N; z++) for (let x = 0; x < N; x++){
    const c = at(x, z, f), o = c * NW;
    if (stair[c] >= 0 || cap[c]){
      const t = cap[c] ? capTile(x, z, f) : stairTile(stair[c]);
      dom[o + (t >> 5)] = 1 << (t & 31);
    } else if (room[c] >= 0){
      const r = rooms[room[c]], vb = vert[c];
      const inside = [x > r.x, x < r.x + r.w - 1, z > r.z, z < r.z + r.h - 1];
      for (let t = 0; t < NT; t++){
        const q = T[t];
        if (q.kind !== ROOM || q.down !== (vb & 15) || q.up !== (vb >> 4)) continue;
        if (q.s.every((v, d) => inside[d] ? v === 2 : v < 2)) dom[o + (t >> 5)] |= 1 << (t & 31);
      }
    } else for (let w = 0; w < NW; w++) dom[o + w] = FREE_SET[w];
    // The world's edge and the dungeon's top and bottom are closed.
    const edge = [x === 0, x === N - 1, z === 0, z === N - 1, f === 0, f === F - 1];
    for (let side = 0; side < 6; side++) if (edge[side]) for (let w = 0; w < NW; w++) dom[o + w] &= SIDE_MASK[side][1][w];
  }
  const count = c => { let n = 0; for (let w = 0; w < NW; w++) n += popcount(dom[c * NW + w]); return n; };
  const sockets = (c, side) => {
    let m = 0;
    for (let s = 0; s < NS[side]; s++){
      const b = SOCK_BITS[side][s];
      for (let w = 0; w < NW; w++) if (dom[c * NW + w] & b[w]){ m |= 1 << s; break; }
    }
    return m;
  };
  const neighbour = (c, side) => {
    const x = c % N, z = (c / N | 0) % N, f = c / (N * N) | 0;
    if (side < 4){ const nx = x + DX[side], nz = z + DZ[side]; return nx < 0 || nz < 0 || nx >= N || nz >= N ? -1 : at(nx, nz, f); }
    const g = f + (side === 4 ? -1 : 1);
    return g < 0 || g >= F ? -1 : at(x, z, g);
  };
  // Propagation: a stack of cells whose sets shrank.
  const stack = new Int32Array(C), queued = new Uint8Array(C);
  let sp = 0, steps = 0;
  const push = c => { if (!queued[c]){ queued[c] = 1; stack[sp++] = c; } };
  const propagate = () => {
    while (sp){
      const c = stack[--sp]; queued[c] = 0; steps++;
      for (let side = 0; side < 6; side++){
        const n = neighbour(c, side);
        if (n < 0) continue;
        const keep = SIDE_MASK[opp(side)][compatMask(side, sockets(c, side))];
        let changed = false, any = 0;
        for (let w = 0; w < NW; w++){
          const v = dom[n * NW + w], k = (v & keep[w]) >>> 0;
          if (k !== v){ dom[n * NW + w] = k; changed = true; }
          any |= k;
        }
        if (!any){ const x = n % N, z = (n / N | 0) % N, f = n / (N * N) | 0; throw new Error(`dungeon: the collapse contradicted at cell (${x}, ${z}) of floor ${f} (seed ${seed})`); }
        if (changed){ push(n); heapPush(n); }
      }
    }
  };
  /* The order: fewest tiles left, ties by a hash of the cell. A binary heap
     of (key, cell), with stale entries skipped when popped. */
  let hk = new Float64Array(1024), hc = new Int32Array(1024), hn = 0;
  const keyOf = c => count(c) * 4294967296 + mix(seed, c, 0xe7);
  function heapPush(c){
    const n = count(c);
    if (n <= 1) return;
    if (hn === hk.length){ const k2 = new Float64Array(2 * hn), c2 = new Int32Array(2 * hn); k2.set(hk); c2.set(hc); hk = k2; hc = c2; }
    const key = n * 4294967296 + mix(seed, c, 0xe7);
    let i = hn++;
    while (i > 0){ const p = (i - 1) >> 1; if (hk[p] <= key) break; hk[i] = hk[p]; hc[i] = hc[p]; i = p; }
    hk[i] = key; hc[i] = c;
  }
  function heapPop(){
    const c = hc[0], k = hk[--hn], d = hc[hn];
    let i = 0;
    for (;;){
      let m = 2 * i + 1;
      if (m >= hn) break;
      if (m + 1 < hn && hk[m + 1] < hk[m]) m++;
      if (hk[m] >= k) break;
      hk[i] = hk[m]; hc[i] = hc[m]; i = m;
    }
    hk[i] = k; hc[i] = d;
    return c;
  }
  for (let c = 0; c < C; c++) push(c);
  propagate();
  for (let c = 0; c < C; c++) heapPush(c);
  let picks = 0;
  while (hn){
    const key = hk[0], c = heapPop();
    if (key !== keyOf(c) || count(c) <= 1) continue;
    // Pick by weight: seeded cells by the seeds' weights, free ones by theirs.
    const Wt = room[c] >= 0 || stair[c] >= 0 || cap[c] ? W_SEED : W_FREE;
    let total = 0;
    for (let t = 0; t < NT; t++) if (dom[c * NW + (t >> 5)] >> (t & 31) & 1) total += Wt[t];
    let r = (mix(seed, c, 0x91c4) / 4294967296) * total, pick = -1;
    for (let t = 0; t < NT; t++) if (dom[c * NW + (t >> 5)] >> (t & 31) & 1){ pick = t; if ((r -= Wt[t]) < 0) break; }
    for (let w = 0; w < NW; w++) dom[c * NW + w] = 0;
    dom[c * NW + (pick >> 5)] = 1 << (pick & 31);
    picks++;
    push(c); propagate();
  }
  const tile = new Int32Array(C);
  for (let c = 0; c < C; c++){
    let t = -1;
    for (let w = 0; w < NW && t < 0; w++) if (dom[c * NW + w]) t = 32 * w + 31 - Math.clz32(dom[c * NW + w] & -dom[c * NW + w]);
    tile[c] = t;
  }
  if (stats){ stats.picks = picks; stats.steps = steps; }
  return tile;
}
/* About the weighted pick's arithmetic: `total` is a sum of integers below
   2^53 (the largest, all free tiles, is under 2·10^10), and r is a hash over
   2^32 times it, so every engine rounds it the same (IEEE double, no
   transcendental functions): the pick is the same everywhere. */

/* ---- connected ------------------------------------------------------------- */
const LOOP_COST = 4, LOOP_SHARE = 0.3;
/* Per floor: label the pieces, grow them through rock, carve Kruskal's tree
   of the meetings and a few short loops. `kind` and `sock` (4 a cell) are
   rewritten in place; a carved rock cell becomes a corridor. */
export function connect(N, F, seed, kind, sock, down, up, stats){
  const NN = N * N;
  let carvedCells = 0, tunnels = 0, loops = 0, pieces = 0;
  for (let f = 0; f < F; f++){
    const base = f * NN;
    const comp = new Int32Array(NN).fill(-1);
    let nc = 0;
    const q = new Int32Array(NN);
    // The pieces: cells joined by open faces, stairs included.
    for (let i = 0; i < NN; i++){
      if (isShut(kind[base + i]) || comp[i] >= 0) continue;
      let h = 0, t = 0; q[t++] = i; comp[i] = nc;
      while (h < t){
        const c = q[h++], x = c % N, z = c / N | 0;
        for (let d = 0; d < 4; d++){
          if (!sock[4 * (base + c) + d]) continue;
          const n = (x + DX[d]) + N * (z + DZ[d]);
          if (comp[n] < 0){ comp[n] = nc; q[t++] = n; }
        }
      }
      nc++;
    }
    pieces += nc;
    if (nc <= 1) continue;
    // The wave: from every piece's cells (not stairs) through rock.
    const owner = new Int32Array(NN).fill(-1), dist = new Int32Array(NN), from = new Int32Array(NN).fill(-1);
    let h = 0, t = 0;
    const isStair = c => isStairKind(kind[base + c]);
    for (let i = 0; i < NN; i++) if (comp[i] >= 0 && !isStair(i)){ owner[i] = comp[i]; q[t++] = i; }
    while (h < t){
      const c = q[h++], x = c % N, z = c / N | 0;
      for (let d = 0; d < 4; d++){
        const nx = x + DX[d], nz = z + DZ[d];
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const n = nx + N * nz;
        if (owner[n] >= 0 || kind[base + n] !== ROCK) continue;
        owner[n] = owner[c]; dist[n] = dist[c] + 1; from[n] = c; q[t++] = n;
      }
    }
    // Where two waves meet, the cheapest meeting of each pair of pieces.
    const best = new Map();
    for (let c = 0; c < NN; c++){
      if (owner[c] < 0) continue;
      const x = c % N, z = c / N | 0;
      for (const d of [1, 3]){
        const nx = x + DX[d], nz = z + DZ[d];
        if (nx >= N || nz >= N) continue;
        const n = nx + N * nz, a = owner[c], b = owner[n];
        if (b < 0 || a === b) continue;
        const key = Math.min(a, b) * nc + Math.max(a, b), cost = dist[c] + dist[n] + 1, e = best.get(key);
        if (!e || cost < e.cost) best.set(key, { cost, c, n, d, a, b, key });
      }
    }
    const edges = [...best.values()].sort((p, r) => p.cost - r.cost || p.c - r.c || p.d - r.d);
    const parent = Int32Array.from({ length: nc }, (_, i) => i);
    const root = i => { while (parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const open = (c, d) => {
      // Open the face of cell c (on this floor) on side d, and its neighbour's.
      const x = c % N, z = c / N | 0, n = (x + DX[d]) + N * (z + DZ[d]);
      for (const [u, e] of [[c, d], [n, d ^ 1]]){
        const g = base + u;
        if (kind[g] === ROCK){ kind[g] = CORR; carvedCells++; }
        if (!sock[4 * g + e]) sock[4 * g + e] = 1;
      }
    };
    const carve = e => {
      open(e.c, e.d);
      for (const end of [e.c, e.n]){
        for (let u = end; from[u] >= 0; u = from[u]){
          const p = from[u], ux = u % N, uz = u / N | 0, px = p % N, pz = p / N | 0;
          open(u, px < ux ? 0 : px > ux ? 1 : pz < uz ? 2 : 3);
        }
      }
    };
    for (const e of edges){
      const ra = root(e.a), rb = root(e.b);
      if (ra !== rb){ parent[ra] = rb; carve(e); tunnels++; }
      else if (e.cost <= LOOP_COST && mix(seed, f, e.key, 0x100b) / 4294967296 < LOOP_SHARE){ carve(e); loops++; }
    }
    const r0 = root(0);
    for (let i = 1; i < nc; i++) if (root(i) !== r0) throw new Error(`dungeon: floor ${f} couldn't be joined (seed ${seed})`);
  }
  if (stats) Object.assign(stats, { pieces, tunnels, loops, carvedCells });
}

/* ---- less corridor: dead ends pruned ----------------------------------------
   After the join, a corridor cell with one arm is a dead end. It goes back to
   rock, and the face it opened onto closes (a room's door becomes wall, a
   corridor loses an arm), which may leave a new dead end behind it, so this
   runs until none is left, a cell at a time. Except: a dead end at a stair's
   mouth stays (the mouth must meet a narrow face), and one dead end in
   DEAD_KEEP stays as a stub, by a hash of its cell, so the dungeon still has
   a few corridors that go nowhere. A leaf's removal never disconnects the
   rest, so every floor is still one piece. `kind` and `sock` change in place. */
const DEAD_KEEP = 8;
export function pruneDeadEnds(N, F, seed, kind, sock, stats){
  const NN = N * N, C = NN * F, q = new Int32Array(C);
  let t = 0, pruned = 0;
  const arms = c => (sock[4 * c] ? 1 : 0) + (sock[4 * c + 1] ? 1 : 0) + (sock[4 * c + 2] ? 1 : 0) + (sock[4 * c + 3] ? 1 : 0);
  for (let c = 0; c < C; c++) if (kind[c] === CORR && arms(c) === 1) q[t++] = c;
  while (t){
    const c = q[--t];
    if (kind[c] !== CORR || arms(c) !== 1 || mix(seed, c, 0xdead) % DEAD_KEEP === 0) continue;
    let d = 0;
    while (!sock[4 * c + d]) d++;
    const f = c / NN | 0, x = c % N, z = (c / N | 0) % N, n = (x + DX[d]) + N * (z + DZ[d]) + NN * f;
    if (isStairKind(kind[n])) continue;
    kind[c] = ROCK; sock[4 * c + d] = 0; sock[4 * n + (d ^ 1)] = 0; pruned++;
    if (kind[n] === CORR){
      if (!arms(n)) throw new Error(`dungeon: pruning left a corridor with no arms at cell ${n} (seed ${seed})`);
      if (arms(n) === 1) q[t++] = n;
    }
  }
  if (stats) stats.pruned = pruned;
}

/* ---- the plan ------------------------------------------------------------
   Every choice, as a table of tile codes: code = tile << CODE_SHIFT | variant,
   one per cell, x + N·(z + N·f). The variant is dressing the collapse doesn't
   see, from hashes of the cell: it never closes a way through
   (test/dungeon-core.test.js walks it). Its bits, by the cell's kind:
     a room on a floor (down 0): bits 0–1 a pillar, a basin or a brazier in
       the middle, bit 2 torches, bit 3 a pit, bits 4–7 a secret door on
       side 0–3;
     a hall's upper cell (down 1): bits 0–1 a bridge along x or z;
     a corridor: bit 0 water in its floor.
   CODE_SHIFT was 4 until the second round's dressing needed 8 bits. */
export const CODE_SHIFT = 8;
export const V_PILLAR = 1, V_BASIN = 2, V_BRAZIER = 3, V_TORCHES = 4, V_PIT = 8, V_SECRET = 16;
export const V_BRIDGE_X = 1, V_BRIDGE_Z = 2, V_CHANNEL = 1;
const PIT_SHARE = 25, BRIDGE_SHARE = 60, SECRET_SHARE = 30, CHANNEL_SHARE = 30;   // percent of the cells (or halls, pairs, networks) that may
const planCache = new Map();
export function dungeonPlan(desc){
  const key = `${desc.D},${desc.seed},${desc.floors}`;
  const hit = planCache.get(key);
  if (hit) return hit;
  const t0 = Date.now(), N = 2 ** (desc.D - CELL_LEVEL), F = desc.floors, NN = N * N, C = NN * F, seed = desc.seed;
  const seeds = placeSeeds(N, F, seed), stats = {};
  const tile = collapse(N, F, seed, seeds, stats);
  const kind = new Uint8Array(C), sock = new Uint8Array(4 * C), down = new Uint8Array(C), up = new Uint8Array(C);
  for (let c = 0; c < C; c++){ const q = T[tile[c]]; kind[c] = q.kind; down[c] = q.down; up[c] = q.up; for (let d = 0; d < 4; d++) sock[4 * c + d] = q.s[d]; }
  const tWfc = Date.now();
  connect(N, F, seed, kind, sock, down, up, stats);
  pruneDeadEnds(N, F, seed, kind, sock, stats);
  const v = new Uint8Array(C), sides = c => [0, 1, 2, 3].map(d => sock[4 * c + d]), allWide = c => sides(c).every(x => x === 2);
  let roomCells = 0, corrCells = 0;
  for (let c = 0; c < C; c++){
    if (kind[c] === ROOM){
      roomCells++;
      const h = mix(seed, c, 0xdec0), s = sides(c);
      if (!down[c] && s.every(x => x === 2)){
        const r = h % 100;
        v[c] = r < 55 ? 0 : r < 75 ? (up[c] ? 0 : V_PILLAR) : r < 87 ? V_BASIN : V_BRAZIER;
      }
      if (!down[c] && s.some(x => x === 0) && (h >>> 8) % 2) v[c] |= V_TORCHES;
    } else if (kind[c] === CORR) corrCells++;
  }
  /* Bridges: across a hall's upper floor, along its middle row of cells, so
     both ends meet the gallery. The row must be inside the hall (its side
     across at least 3 cells); the longer way across is taken where both are. */
  let bridges = 0;
  for (const r of seeds.rooms){
    if (r.hall !== 1 || mix(seed, r.f, r.x, r.z, 0xb41d) % 100 >= BRIDGE_SHARE) continue;
    const alongX = r.h >= 3 && (r.w >= r.h || r.w < 3), alongZ = !alongX && r.w >= 3;
    if (!alongX && !alongZ) continue;
    for (let i = 0; i < (alongX ? r.w : r.h); i++){
      const x = alongX ? r.x + i : r.x + (r.w >> 1), z = alongX ? r.z + (r.h >> 1) : r.z + i;
      v[x + N * (z + N * r.f)] |= alongX ? V_BRIDGE_X : V_BRIDGE_Z;
    }
    bridges++;
  }
  /* Pits: a hole in a room's floor, over a room on the floor below. The cell
     is inside its room (all sides wide), on a floor of its own (not a hall's
     upper cell) with nothing in the middle; the room below has a floor of
     its own too, and nothing under the hole but a basin (a pillar would
     stand in it, and a brazier is no place to land: both are odd). */
  let pits = 0;
  for (let c = NN; c < C; c++){
    const b = c - NN;
    if (kind[c] !== ROOM || down[c] || !allWide(c) || (v[c] & 3) || kind[b] !== ROOM || up[b] || down[b] || (v[b] & 1)) continue;
    if (mix(seed, c, 0x917) % 100 < PIT_SHARE){ v[c] |= V_PIT; pits++; }
  }
  /* Secret doors: in the wall between two rooms on a floor, where both sides
     are closed. Solid, so the DAG and the frame don't change; the walk passes
     it (secretDoors). The torch that side would have had isn't lit. */
  let secrets = 0;
  for (let c = 0; c < C; c++){
    if (kind[c] !== ROOM || down[c]) continue;
    const x = c % N, z = (c / N | 0) % N;
    for (const d of [1, 3]){
      if (x + DX[d] >= N || z + DZ[d] >= N) continue;
      const n = c + DX[d] + N * DZ[d];
      if (kind[n] !== ROOM || down[n] || sock[4 * c + d] || sock[4 * n + (d ^ 1)]) continue;
      if (mix(seed, c, d, 0x5ec) % 100 < SECRET_SHARE){ v[c] |= V_SECRET << d; v[n] |= V_SECRET << (d ^ 1); secrets++; }
    }
  }
  /* Water: whole corridor networks (corridor cells joined by corridor faces)
     with a channel sunk one voxel in their floor, so it runs on from cell to
     cell. On the bottom floor of three or more it's lava, as the basins are. */
  let channels = 0;
  { const net = new Int32Array(C).fill(-1), q = new Int32Array(C);
    for (let c0 = 0; c0 < C; c0++){
      if (kind[c0] !== CORR || net[c0] >= 0) continue;
      let h = 0, t = 0; q[t++] = c0; net[c0] = c0;
      while (h < t){
        const c = q[h++], x = c % N, z = (c / N | 0) % N;
        for (let d = 0; d < 4; d++){
          if (!sock[4 * c + d]) continue;
          const n = (x + DX[d]) + N * (z + DZ[d]) + NN * (c / NN | 0);
          if (kind[n] === CORR && net[n] < 0){ net[n] = c0; q[t++] = n; }
        }
      }
      if (mix(seed, c0, 0xc4a7) % 100 < CHANNEL_SHARE){ for (let i = 0; i < t; i++) v[q[i]] |= V_CHANNEL; channels++; }
    } }
  const codes = new Int32Array(C);
  for (let c = 0; c < C; c++) codes[c] = tileOf(kind[c], sides(c), down[c], up[c]) << CODE_SHIFT | v[c];
  const plan = { desc, N, F, codes, seeds, stats: { ...stats, roomCells, corrCells, bridges, pits, secrets, channels, wfcMs: tWfc - t0, ms: Date.now() - t0 } };
  plan.info = dungeonInfo(plan);
  planCache.set(key, plan);
  if (planCache.size > 4) planCache.delete(planCache.keys().next().value);
  return plan;
}

/* The plan from a table (a world file's, or the snapshot's): the codes are
   checked to be tiles, and their faces to agree, since a file is outside
   input. Nothing else of the plan is needed to draw or colour it. */
export function planFromTable(desc, table){
  const N = 2 ** (desc.D - CELL_LEVEL), F = desc.floors, C = N * N * F;
  if (!table || table.length !== C) throw new Error(`dungeon: the table has ${table ? table.length : 0} cells, not ${C}`);
  for (let c = 0; c < C; c++) if (!(table[c] >= 0 && (table[c] >> CODE_SHIFT) < NT)) throw new Error(`dungeon: cell ${c} holds no tile (${table[c]})`);
  return { desc, N, F, codes: table };
}

/* What the viewer shows and opens on: the seeded room on the top floor
   nearest the middle, seen from above its corner, looking across it. */
export function dungeonInfo(plan){
  const { N, F, seeds, stats } = plan, top = seeds.rooms.filter(r => r.f === F - 1);
  let entry = null, bestD = Infinity;
  for (const r of top){ const d = Math.hypot(r.x + r.w / 2 - N / 2, r.z + r.h / 2 - N / 2); if (d < bestD){ bestD = d; entry = r; } }
  const yTop = F * CELL;
  const view = entry
    ? (() => { const ex = (entry.x - 0.6) * CELL, ez = (entry.z - 0.6) * CELL, cx = (entry.x + entry.w / 2) * CELL, cz = (entry.z + entry.h / 2) * CELL, y = yTop + 56;
               return { eye: [ex, y, ez], yaw: Math.atan2(cx - ex, cz - ez), pitch: -Math.atan2(y - CELL * (F - 1) - 2, Math.hypot(cx - ex, cz - ez)) }; })()
    : { eye: [N * CELL / 2, yTop + 120, -32], yaw: 0, pitch: -0.4 };
  return { rooms: seeds.rooms.length, halls: seeds.rooms.filter(r => r.hall === 2).length, tall: seeds.rooms.filter(r => r.tall).length,
           stairs: seeds.stairs.length, spirals: seeds.stairs.filter(s => s.spiral).length,
           roomCells: stats.roomCells, corrCells: stats.corrCells, tunnels: stats.tunnels, loops: stats.loops, pieces: stats.pieces, pruned: stats.pruned,
           bridges: stats.bridges, pits: stats.pits, secrets: stats.secrets, channels: stats.channels,
           cells: N * N * F, planMs: stats.ms, view };
}

/* ---- a tile's voxels --------------------------------------------------------
   The materials, which the colour field reads: */
export const AIR = 0, M_ROCK = 1, M_WALL = 2, M_FLOOR = 3, M_COBBLE = 4, M_STEP = 5, M_PILLAR = 6,
             M_LIQUID = 7, M_IRON = 8, M_FLAME = 9, M_RIM = 10, M_LEDGE = 11, M_SECRET = 12, M_BRIDGE = 13;
export const MATERIALS = ['air', 'rock', 'wall', 'floor', 'cobble', 'step', 'pillar', 'liquid', 'iron', 'flame', 'rim', 'ledge', 'secret', 'bridge'];
/* The 16³ block of tile code `code`, as a material a voxel (x + 16·(y + 16·z),
   fromDense's order). `top`: the top floor, which has no roof, so its
   corridors are open trenches and its stairs open to the sky.
   Measures, in voxels of the cell: floors are two thick (y 0, 1: you stand
   at y = 2); walls two thick on a closed or door side; doorways and
   corridors 4 wide (6…9 across) and 8 tall (y 2…9); a stair climbs one a
   voxel over the cell, 16 in all, so its top step is the floor above, with
   8 of headroom; a hall's upper cell keeps a gallery 4 wide along its
   walls and is open in the middle. The second round's (dungeon-log §10):
   a cap is a room's air for y 0…7 and rock above, walled as the room below
   is; a pit is the floor cut away for x, z 5…10, with a rim round it; a
   bridge is 6 wide (5…10 across), two thick, railed where it isn't over the
   gallery; a channel is 2 wide (7, 8) down the middle of each arm, liquid
   at y 0 under air; a secret door is a doorway's voxels left solid, in
   M_SECRET; a spiral stair is below. */
const kindCache = new Map();
export function tileKinds(code, top){
  const k = code * 2 + (top ? 1 : 0), hit = kindCache.get(k);
  if (hit) return hit;
  const { kind, s, down, up } = T[code >> CODE_SHIFT], v = code & 255, out = new Uint8Array(4096).fill(M_ROCK);
  const put = (x, y, z, m) => { out[x + 16 * (y + 16 * z)] = m; };
  const dist = (x, z) => [x, 15 - x, z, 15 - z];
  const along = (d, x, z) => d < 2 ? z : x;
  const mid = a => a >= 6 && a <= 9;
  if (kind === ROOM){
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++){
      const ds = dist(x, z);
      let wall = false, door = false, secret = false;
      for (let d = 0; d < 4; d++) if (s[d] !== 2 && ds[d] <= 1){
        wall = true;
        if (s[d] === 1 && mid(along(d, x, z))) door = true;
        if (!down && v >> 4 & 1 << d && mid(along(d, x, z))) secret = true;
      }
      // A door through a wall's end can't happen: doors are mid-side, two from no corner.
      // A gallery's band, along each side that isn't open: a hall's upper cell, and its bridge's rails.
      const band = [0, 1, 2, 3].some(d => s[d] !== 2 && ds[d] <= 5);
      for (let y = 0; y < 16; y++){
        // A doorway's threshold is floor, as the rooms' and corridors' are on either side.
        // A secret door is a doorway left solid: the same floor under it, its own stone above.
        if (wall && secret && !door){ put(x, y, z, y >= 2 && y <= 9 ? M_SECRET : y === 1 ? M_FLOOR : M_WALL); continue; }
        if (wall){ put(x, y, z, door && y >= 2 && y <= 9 ? AIR : door && y === 1 ? M_FLOOR : M_WALL); continue; }
        if (y >= 2){ put(x, y, z, AIR); continue; }
        if (!down) put(x, y, z, y === 1 ? M_FLOOR : M_ROCK);
        else {
          // A hall's upper cell: the gallery along each side that isn't open, and its bridge.
          const b = v & 3, across = b === V_BRIDGE_X ? z : x, onBridge = b && across >= 5 && across <= 10;
          put(x, y, z, onBridge ? M_BRIDGE : band ? (y === 1 ? M_LEDGE : M_ROCK) : AIR);
        }
      }
      if (down && (v & 3) && !band){
        const across = (v & 3) === V_BRIDGE_X ? z : x;
        if (across === 5 || across === 10) put(x, 2, z, M_IRON);
      }
    }
    if (!down){
      const c = v & 3;
      if (c === V_PILLAR) for (let z = 6; z <= 9; z++) for (let x = 6; x <= 9; x++) for (let y = 2; y < 16; y++) put(x, y, z, M_PILLAR);
      if (c === V_BASIN) for (let z = 4; z <= 11; z++) for (let x = 4; x <= 11; x++) put(x, 2, z, x === 4 || x === 11 || z === 4 || z === 11 ? M_RIM : M_LIQUID);
      if (c === V_BRAZIER) for (let z = 7; z <= 8; z++) for (let x = 7; x <= 8; x++){ put(x, 2, z, M_IRON); put(x, 3, z, M_IRON); put(x, 4, z, M_FLAME); }
      if (v & V_PIT) for (let z = 4; z <= 11; z++) for (let x = 4; x <= 11; x++){
        const edge = x === 4 || x === 11 || z === 4 || z === 11;
        put(x, 1, z, edge ? M_RIM : AIR);
        if (!edge) put(x, 0, z, AIR);
      }
      if (v & V_TORCHES) for (let d = 0; d < 4; d++){
        if (s[d] !== 0 || v >> 4 & 1 << d) continue;
        // One voxel out of the wall's face, at the side's middle, 8 up.
        const x = d === 0 ? 2 : d === 1 ? 13 : 7, z = d === 2 ? 2 : d === 3 ? 13 : 7;
        put(x, 8, z, M_IRON); put(x, 9, z, M_FLAME);
      }
    }
  } else if (kind === CAP){
    // A tall room's top half: its air for y 0…7, walled where the room is.
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++){
      const ds = dist(x, z), wall = [0, 1, 2, 3].some(d => s[d] !== 2 && ds[d] <= 1);
      for (let y = 0; y < 8; y++) put(x, y, z, wall ? M_WALL : AIR);
    }
  } else if (kind === CORR){
    const h = top ? 15 : 9;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++){
      const centre = mid(x) && mid(z);
      const arm = (s[0] && mid(z) && x < 6) || (s[1] && mid(z) && x > 9) || (s[2] && mid(x) && z < 6) || (s[3] && mid(x) && z > 9);
      if (!centre && !arm) continue;
      // The channel: 2 wide down the middle of each arm, to the centre.
      const ch = (v & V_CHANNEL) && (((s[0] && x <= 8) || (s[1] && x >= 7)) && (z === 7 || z === 8) ||
                                     ((s[2] && z <= 8) || (s[3] && z >= 7)) && (x === 7 || x === 8));
      if (ch){ put(x, 0, z, M_LIQUID); put(x, 1, z, AIR); }
      else put(x, 1, z, M_COBBLE);
      for (let y = 2; y <= h; y++) put(x, y, z, AIR);
    }
  } else if (kind === STAIR_LO || kind === STAIR_HI){
    // t: how far from the low mouth's side; the stair is 4 wide across it.
    const d = kind === STAIR_LO ? up - 2 : down - 2, hi = kind === STAIR_HI, oy = hi ? 16 : 0;
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++){
      if (!mid(along(d, x, z))) continue;
      const t = dist(x, z)[d];
      for (let y = 0; y < 16; y++){
        const g = y + oy;
        if (g <= 2 + t){ if (g >= 2 || (!hi && g === 1)) put(x, y, z, M_STEP); }
        else if (g <= 10 + t || (hi && top && t >= 6)) put(x, y, z, AIR);
      }
    }
  } else if (kind === SPIRAL_LO || kind === SPIRAL_HI) spiralKinds(put, kind === SPIRAL_HI ? down - SPIRAL : up - SPIRAL, kind === SPIRAL_HI);
  kindCache.set(k, out);
  return out;
}
/* A spiral stair: a pair of cells, a square shaft with a pillar in the
   middle, the stair a full turn of solid ramp round it, from a landing at
   the lower floor's doorway (side d) up to a landing at the upper floor's,
   on the same side, 16 above. g is the height in the pair, 0…31.
   THE ANGLE IS RATIONAL. The ramp's height at a column is its angle from the
   doorway, and Math.atan2 isn't the same function in every engine. So the
   angle is the "diamond angle" (p, q) → [0, 4), monotone in the true one
   and made of division alone, which IEEE fixes to the bit: the stair is the
   same voxels in Safari as in Node's pins. (p, q) are the column's centre
   from the shaft's, doubled so they're odd integers (never 0), p toward the
   doorway. Landings for α < 0.3 or α > 3.7; the ramp climbs 17 heights
   (2…18) over the rest, so at the 18 it meets the upper landing. Outside
   |a| or |b| 13 (x or z 0 or 15) is the shaft's wall; inside a² + b² ≤ 26
   the pillar. A column's neighbour along the ring is at most one higher
   past the pillar's own (the walk test holds it: it climbs every spiral). */
const SPIRAL_A0 = 0.3;
const diamond = (p, q) => q >= 0 ? (p >= 0 ? q / (p + q) : 1 + -p / (q - p)) : (p < 0 ? 2 + -q / (-p - q) : 3 + p / (p - q));
export function spiralHeight(p, q){
  const a = diamond(p, q);
  if (a < SPIRAL_A0 || a > 4 - SPIRAL_A0) return -1;
  return Math.min(18, 2 + Math.floor(17 * (a - SPIRAL_A0) / (4 - 2 * SPIRAL_A0)));
}
function spiralKinds(put, d, hi){
  const oy = hi ? 16 : 0, mid = a => a >= 6 && a <= 9;
  for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++){
    const a = 2 * x - 15, b = 2 * z - 15;
    if (Math.abs(a) > 13 || Math.abs(b) > 13){
      // The shaft's wall, a voxel thick, and the doorway through it on side d.
      const ds = [x, 15 - x, z, 15 - z][d], al = d < 2 ? z : x;
      if (ds === 0 && mid(al)) for (let y = 1; y <= 9; y++) put(x, y, z, y === 1 ? M_FLOOR : AIR);
      continue;
    }
    if (a * a + b * b <= 26){ for (let y = 0; y < 16; y++) put(x, y, z, M_PILLAR); continue; }
    const p = a * DX[d] + b * DZ[d], q = -a * DZ[d] + b * DX[d], H = spiralHeight(p, q);
    for (let y = 0; y < 16; y++){
      const g = y + oy;
      // A landing: floor at 1 below and 17 above (the upper floor's own), air over each.
      if (H < 0) put(x, y, z, g === 1 || g === 17 ? M_FLOOR : g === 0 || g === 16 ? M_ROCK : AIR);
      else put(x, y, z, g < H - 1 ? M_ROCK : g === H - 1 ? M_STEP : AIR);
    }
  }
}

/* ---- the DAG --------------------------------------------------------------
   Each tile's block once (fromDense, a level-4 node; memoized on code and
   top), then the levels above by intern, top down from the root, skipping
   whatever lies above the dungeon. Children are interned before parents
   (the recursion returns them first), as dag-core wants. */
export function buildDungeon(desc, { store = createStore(), plan = dungeonPlan(desc) } = {}){
  const t0 = Date.now(), { N, F, codes } = plan, D = desc.D;
  const tileNode = new Map(), occ = new Uint8Array(4096);
  const nodeOf = (code, top) => {
    const k = code * 2 + (top ? 1 : 0);
    let id = tileNode.get(k);
    if (id === undefined){
      const m = tileKinds(code, top);
      for (let i = 0; i < 4096; i++) occ[i] = m[i] ? 1 : 0;
      id = store.fromDense(occ, CELL).root;
      tileNode.set(k, id);
    }
    return id;
  };
  const ch = new Uint32Array(8);
  const build = (k, x, y, z) => {
    if (k === CELL_LEVEL) return y < F ? nodeOf(codes[x + N * (z + N * y)], y === F - 1) : EMPTY;
    if ((y << (k - CELL_LEVEL)) >= F) return EMPTY;
    const kids = new Uint32Array(8);
    for (let o = 0; o < 8; o++) kids[o] = build(k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
    ch.set(kids);
    return store.intern(k, ch);
  };
  const root = build(D, 0, 0, 0);
  return { store, root, D, plan, tiles: tileNode.size, ms: Date.now() - t0 };
}
/* The secret doors as boxes of voxels [x0, y0, z0, x1, y1, z1), half open,
   one a cell's half of the wall (so a door is two, side by side): what the
   viewer's walker passes through (walk-core's withHoles). From the table
   alone, so a world file's dungeon has them too. */
export function secretDoors(plan){
  const { N, F, codes } = plan, out = [];
  for (let c = 0; c < N * N * F; c++){
    const q = T[codes[c] >> CODE_SHIFT], v = codes[c] & 255;
    if (q.kind !== ROOM || q.down || !(v >> 4)) continue;
    const x0 = (c % N) * CELL, z0 = ((c / N | 0) % N) * CELL, y0 = (c / (N * N) | 0) * CELL;
    for (let d = 0; d < 4; d++){
      if (!(v >> 4 & 1 << d)) continue;
      const lx = d === 0 ? 0 : d === 1 ? 14 : 6, lz = d === 2 ? 0 : d === 3 ? 14 : 6, wx = d < 2 ? 2 : 4, wz = d < 2 ? 4 : 2;
      out.push([x0 + lx, y0 + 2, z0 + lz, x0 + lx + wx, y0 + 10, z0 + lz + wz]);
    }
  }
  return out;
}
// A voxel's material, by the plan alone (the tests' oracle reads it too).
export function dungeonVoxel(plan, x, y, z){
  const { N, F, codes } = plan, cx = x >> 4, cz = z >> 4, f = y >> 4;   // cells are 16: >> 4 is CELL
  if (x < 0 || z < 0 || y < 0 || cx >= N || cz >= N || f >= F) return AIR;
  return tileKinds(codes[cx + N * (cz + N * f)], f === F - 1)[(x & 15) + 16 * ((y & 15) + 16 * (z & 15))];
}

/* ---- the colour --------------------------------------------------------------
   By material, from the table alone (planFromTable), so a chunk worker and a
   world file need nothing more. Each floor has its own stone, warm sandstone
   at the top going to dark cold stone below, and the bottom floor's basins
   hold lava rather than water (with three floors or more). Flagstones are 4
   voxels with joints, walls are courses of bricks 4 long and 2 high, a
   jitter a voxel shows how big a voxel is. A coarse cell's centre may be air:
   it takes the wall's or the rock's colour, as the cell's tile says. */
const hash3 = (i, j, k) => mix(i, j, k) / 4294967296;
const FLOOR_TINT = [[1.18, 1.05, 0.86], [1.0, 0.98, 0.94], [0.84, 0.88, 0.98], [0.78, 0.72, 0.74]];
function tintOf(f, F){
  if (F === 1) return FLOOR_TINT[0];
  const u = (F - 1 - f) / (F - 1) * (FLOOR_TINT.length - 1), i = Math.min(FLOOR_TINT.length - 2, Math.floor(u)), w = u - i;
  return FLOOR_TINT[i].map((v, a) => v + (FLOOR_TINT[i + 1][a] - v) * w);
}
const BASE = {
  [M_ROCK]: [88, 80, 72], [M_WALL]: [134, 122, 108], [M_FLOOR]: [150, 138, 118], [M_COBBLE]: [108, 100, 90], [M_STEP]: [152, 142, 124],
  [M_PILLAR]: [182, 172, 152], [M_IRON]: [52, 48, 48], [M_FLAME]: [255, 176, 52], [M_RIM]: [160, 150, 130], [M_LEDGE]: [128, 86, 50],
  [M_SECRET]: [134, 122, 108], [M_BRIDGE]: [104, 70, 42],
};
export function dungeonColour(desc, rgb8){
  const plan = planFromTable(desc, desc.table), { N, F, codes } = plan;
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const cx = Math.min(N - 1, Math.max(0, xi >> 4)), cz = Math.min(N - 1, Math.max(0, zi >> 4)), f = Math.min(F - 1, Math.max(0, yi >> 4));
    const code = codes[cx + N * (cz + N * f)], lx = xi & 15, ly = yi & 15, lz = zi & 15;
    let m = yi >= F * CELL ? M_ROCK : tileKinds(code, f === F - 1)[lx + 16 * (ly + 16 * lz)];
    if (m === AIR){ const kd = T[code >> CODE_SHIFT].kind; m = kd === ROOM || kd === CAP ? M_WALL : M_ROCK; }
    const j = 0.9 + 0.2 * hash3(xi, yi, zi);
    if (m === M_LIQUID){
      const lava = f === 0 && F >= 3, n = hash3(xi >> 1, f, zi >> 1);
      return lava ? rgb8(235 * j, (70 + 100 * n) * j, 24) : rgb8(40 * j, (100 + 40 * n) * j, 170 * j);
    }
    if (m === M_FLAME) return rgb8(255, 150 + 60 * hash3(xi, yi, zi), 40);
    let c = BASE[m], k = j;
    if (m === M_FLOOR){
      const sx = xi >> 2, sz = zi >> 2, joint = (xi & 3) === 0 || (zi & 3) === 0;
      k *= (0.86 + 0.24 * hash3(sx, f, sz)) * (joint ? 0.8 : 1);
    } else if (m === M_WALL || m === M_SECRET){
      // A secret door is the wall's bricks, a shade darker: there to be found by a careful eye.
      const course = yi >> 1, a = (lx <= 1 || lx >= 14 ? zi : xi) + (course & 1) * 2;
      const mortar = (yi & 1) === 0 || (a & 3) === 0;
      k *= (0.9 + 0.18 * hash3(a >> 2, course, f)) * (mortar ? 0.78 : 1) * (m === M_SECRET ? 0.93 : 1);
    } else if (m === M_LEDGE) k *= (xi + zi) & 1 ? 0.92 : 1.04;
    else if (m === M_BRIDGE) k *= ((xi ^ zi) >> 1 & 1) ? 0.9 : 1.05;   // planks two wide
    const tint = m === M_IRON ? [1, 1, 1] : tintOf(f, F);
    // Turf on the rock over the top floor (the walls' tops stay stone, so the
    // rooms read from above), and moss on its stone, where the sky gets in.
    if (yi === F * CELL - 1 && m === M_ROCK) return rgb8((74 + 20 * hash3(xi >> 1, 7, zi >> 1)) * j, 118 * j, 50 * j);
    // Moss on the top floor's stone, where the sky gets in.
    if (f === F - 1 && (m === M_FLOOR || m === M_ROCK || m === M_COBBLE) && hash3(xi >> 1, yi, zi >> 1) < 0.14) return rgb8(70 * j, 112 * j, 54 * j);
    return rgb8(c[0] * k * tint[0], c[1] * k * tint[1], c[2] * k * tint[2]);
  };
}
