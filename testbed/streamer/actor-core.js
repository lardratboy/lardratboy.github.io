/* ================== ACTOR CORE (pure) ================================
   Several living things in a DAG world: step 1 of docs/actors.md §9.
   Promoted from experiments/actor-sketch.mjs, whose numbers are actors.md
   §5. What changed on the way is in docs/actors-log.md: the sketch's global
   switches (its mutants, the room cache, the contact test) are gone, so the
   oracle's mutants are now made from this file's text by the test; each
   actor has its own box, since bodies are specimens of R = 3 to 11 (§10, Q2,
   Q3); the wander eases toward a goal instead of jittering; and there's a
   leash to the eye (Q8).

   Four pieces:

     the world    one question, "is anything solid in this box?", asked of
                  the DAG (dagWorld) or of anything else that answers it
     motion       a box swept one axis at a time, the longest clear move by
                  bisection, exact in fixed point
     the grid     who is near whom, from last tick's positions
     the flier    wander, the leash, soft pushes: one tick for everyone

   **Order-free by construction**, which is what makes a GPU tick and a fast
   forward possible later. Anything about another actor comes from last tick
   (`A.old`). Every random choice is a hash of (seed, actor, what), never a
   draw from a stream. The world doesn't change during a tick. So the order
   actors are updated in can't change a byte, and the test shuffles it.

   Pure: imports only dag-core.js, and reads the store through `child` only,
   so a storeView (the page's worker-built worlds) can run it. */
import { EMPTY, FULL } from './dag-core.js';

/* ---- fixed point --------------------------------------------------------
   Positions and velocities are int32 in 1/256 of a voxel: smooth on screen
   (Q2), exact to test. A box's low corner is at p, and it covers voxels
   p >> 8 to (p + 256·s − 1) >> 8. At D = 22, 2²² · 256 = 2³⁰, which leaves
   room for a box and a move on top. D = 23 would not, the same wall as
   universekit.md §5.1. Clay goes to 20 in the viewer, the kit to 16. */
export const FR = 8, ONE = 1 << FR;
export const MAX_D = 22;

/* Every random choice is a hash of its reasons, not a draw from a stream: a
   stream would make the result depend on the order actors are updated in.
   Integer only (Math.imul), so a WGSL twin can match it word for word. */
export function mix(a, b, c = 0, d = 0){
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2d) ^ Math.imul(c + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b) ^ Math.imul(d + 0x61c88647, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/* ---- the world, as an actor asks it ---------------------------------------
   compute-sketch's boxHits: EMPTY is the only id that holds nothing, so a
   non-empty node wholly inside the box answers yes at once. No counts, so no
   float64 trap (CLAUDE.md's isFull rule never comes up). FULL is answered
   before asking for its children, which it hasn't got: the sketch asked
   anyway, got `undefined` back, and was right only because undefined isn't
   EMPTY either. 3–6 µs on the real worlds (actors.md §5), the whole cost of
   a tick. Not tried yet: starting at the box's enclosing node. */
export function boxHits(store, id, k, x, y, z, lo, hi){
  if (id === EMPTY) return false;
  const s = 2 ** k;
  if (x >= hi[0] || y >= hi[1] || z >= hi[2] || x + s <= lo[0] || y + s <= lo[1] || z + s <= lo[2]) return false;
  if (id === FULL) return true;
  if (x >= lo[0] && y >= lo[1] && z >= lo[2] && x + s <= hi[0] && y + s <= hi[1] && z + s <= hi[2]) return true;
  const h = s / 2;
  for (let o = 0; o < 8; o++)
    if (boxHits(store, store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h, lo, hi)) return true;
  return false;
}

/* A world is { D, side, solid(lo, hi) }, and optionally room(lo, hi, out, o).
   `solid` takes a box of voxels [lo, hi) and says whether anything in it is
   solid. Outside the world counts as solid: an actor can't leave. The test
   hands the same tick a dense grid instead, which is how it knows the DAG's
   answers are the grid's.

   `room` is the room cache's question. An actor remembers the largest aligned
   EMPTY node around its box; a swept box inside that is clear without asking
   the world. A room is a fact about the world, not about the actor, so it's
   right for any box, and it's only looked for again when the actor leaves
   it: one descent from the root. It cut fliers' cost by 20–70% (§5) and must
   change nothing: the test runs with it on and off and wants the same bytes.

   A world is one root. After an edit, make a new one: the population keeps
   the world its rooms came from and drops them when it's handed another. */
export function dagWorld(store, root, D){
  if (!(Number.isInteger(D) && D >= 1 && D <= MAX_D)) throw new RangeError(`actors: D ${D} is outside 1…${MAX_D}`);
  const side = 2 ** D;
  return {
    D, side, root,
    solid(lo, hi){
      for (let a = 0; a < 3; a++) if (lo[a] < 0 || hi[a] > side) return true;
      return boxHits(store, root, D, 0, 0, 0, lo, hi);
    },
    room(lo, hi, out, o){
      let id = root, x = 0, y = 0, z = 0, k = D;
      for (;;){
        if (id === EMPTY){
          const s = 2 ** k;
          out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = x + s; out[o + 4] = y + s; out[o + 5] = z + s;
          return;
        }
        if (id === FULL || k === 0) break;
        const h = 2 ** (k - 1), c0 = x + h, c1 = y + h, c2 = z + h;
        // The child that holds the whole box, or none if the box straddles one
        // of this node's mid-planes: then no node below holds it either.
        const o0 = lo[0] >= c0 ? 1 : hi[0] <= c0 ? 0 : -1;
        const o1 = lo[1] >= c1 ? 1 : hi[1] <= c1 ? 0 : -1;
        const o2 = lo[2] >= c2 ? 1 : hi[2] <= c2 ? 0 : -1;
        if (o0 < 0 || o1 < 0 || o2 < 0) break;
        id = store.child(id, o0 | o1 << 1 | o2 << 2);
        x += o0 * h; y += o1 * h; z += o2 * h; k--;
      }
      noRoom(out, o);
    },
    /* The box [lo, hi) as a dense grid, x fastest, 1 where solid: the trap
       test's flood (sealedAt) reads it. Outside the world is solid, as in
       `solid`. One walk over the nodes the box touches. */
    fill(lo, hi){
      const out = solidOutside(side, lo, hi);
      const walk = (id, k, x, y, z) => {
        if (id === EMPTY) return;
        const s = 2 ** k;
        if (x >= hi[0] || y >= hi[1] || z >= hi[2] || x + s <= lo[0] || y + s <= lo[1] || z + s <= lo[2]) return;
        if (id === FULL){ fillBox(out, lo, hi, [x, y, z], [x + s, y + s, z + s]); return; }
        const h = s / 2;
        for (let o = 0; o < 8; o++) walk(store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
      };
      walk(root, D, 0, 0, 0);
      return out;
    },
    store,
  };
}
// A dense grid of the box [lo, hi), with the voxels outside [0, side)³ set.
function solidOutside(side, lo, hi){
  const n0 = hi[0] - lo[0], n1 = hi[1] - lo[1], n2 = hi[2] - lo[2], out = new Uint8Array(n0 * n1 * n2);
  if (lo.every(v => v >= 0) && hi.every(v => v <= side)) return out;
  for (let z = 0; z < n2; z++) for (let y = 0; y < n1; y++){
    const row = n0 * (y + n1 * z), Y = lo[1] + y, Z = lo[2] + z;
    if (Y < 0 || Y >= side || Z < 0 || Z >= side){ out.fill(1, row, row + n0); continue; }
    if (lo[0] < 0) out.fill(1, row, row + Math.min(n0, -lo[0]));
    if (hi[0] > side) out.fill(1, row + Math.max(0, side - lo[0]), row + n0);
  }
  return out;
}
// Set the part of [a, b) inside the grid's box [lo, hi). scene-core fills children with it.
export function fillBox(out, lo, hi, a, b){
  const n0 = hi[0] - lo[0], n1 = hi[1] - lo[1];
  const x0 = Math.max(a[0], lo[0]) - lo[0], x1 = Math.min(b[0], hi[0]) - lo[0];
  for (let z = Math.max(a[2], lo[2]); z < Math.min(b[2], hi[2]); z++)
    for (let y = Math.max(a[1], lo[1]); y < Math.min(b[1], hi[1]); y++){
      const row = n0 * (y - lo[1] + n1 * (z - lo[2]));
      out.fill(1, row + x0, row + x1);
    }
}
// Any world as a dense grid: its own fill if it has one, else a voxel at a time.
export function fillOf(world, lo, hi){
  if (typeof world.fill === 'function') return world.fill(lo, hi);
  const n0 = hi[0] - lo[0], n1 = hi[1] - lo[1], n2 = hi[2] - lo[2], out = new Uint8Array(n0 * n1 * n2), a = [0, 0, 0], b = [0, 0, 0];
  for (let z = 0, i = 0; z < n2; z++) for (let y = 0; y < n1; y++) for (let x = 0; x < n0; x++, i++){
    a[0] = lo[0] + x; a[1] = lo[1] + y; a[2] = lo[2] + z; b[0] = a[0] + 1; b[1] = a[1] + 1; b[2] = a[2] + 1;
    out[i] = world.solid(a, b) ? 1 : 0;
  }
  return out;
}
const noRoom = (out, o) => { out[o] = 1; out[o + 3] = 0; };     // lo > hi: holds nothing

/* ---- a population ----------------------------------------------------------
   Arrays per field, never an object per actor: faster in JS, and they are
   what a GPU buffer would hold (computedags.md §7, "One, two, N").

     alive   0 or 1: a dead slot doesn't tick, push or get pushed
     size    the box in voxels, per actor and per axis (a specimen's R³, Q3)
     pos     the box's low corner, 1/256 voxel; vel likewise, per tick
     epoch   which wander goal it's on; until, the tick that goal ends
     old     last tick's positions: all that other actors ever read
     room    the room cache, [lo, hi) in voxels; a cache, not state

   `t` is the population's clock. A tick reads it and adds one, so a fast
   forward (Q6) is ticks in a loop, and gives the bytes watching would.

   **Kinds** (actors-log step 4, asked for 2026-11-19: "explorers that follow
   the edges of the world they are in, and vehicles"): `kind` per slot, 0 a
   flier, 1 an explorer, 2 a vehicle, set by whoever makes the population and
   fixed for its life. A body is a body whatever its kind (the same specimens);
   only the behaviour changes. The kinds' own state:

     hold     explorer: HOLD on a surface, ROUND just over an edge, FALL;
              vehicle: 1 on the ground, 0 in the air
     heading  explorer: the way it crawls, one of DIR6 (2·axis + 1 if minus);
              vehicle: one of the 16 HEADINGS
     down     explorer: the face it holds, one of DIR6 (−y on a floor)
     goal     vehicle: the heading it's turning toward
     speed    vehicle: along its heading, 1/256 voxel a tick (minus reversing)
     calm     vehicle: the tick until which it ignores the eye, after backing
              off a wall it couldn't drive up

   A flier reads none of them, so a population of fliers ticks to the bytes
   it always did. */
export const KIND = Object.freeze({ flier: 0, explorer: 1, vehicle: 2 });
export const KINDS = Object.freeze(['flier', 'explorer', 'vehicle']);
export function createActors(N){
  const A = {
    N, t: 0,
    alive: new Uint8Array(N), size: new Int32Array(3 * N),
    pos: new Int32Array(3 * N), vel: new Int32Array(3 * N),
    epoch: new Int32Array(N), until: new Int32Array(N),
    old: new Int32Array(3 * N),
    room: new Int32Array(6 * N), roomWorld: null,
    kind: new Uint8Array(N), hold: new Uint8Array(N),
    heading: new Int32Array(N), down: new Int32Array(N), goal: new Int32Array(N), speed: new Int32Array(N), calm: new Int32Array(N),
  };
  for (let i = 0; i < N; i++) noRoom(A.room, 6 * i);
  return A;
}

/* ---- motion ------------------------------------------------------------------
   One axis at a time, testing the box *swept* along the move rather than the
   box where it ends, so nothing goes through a wall however fast it moves.
   The swept box only grows with the move's length, so the longest clear move
   is a bisection: one probe when the move is clear, which is most of them,
   and about log₂(move) when it isn't. Exact, not step-and-check. */
const LO = new Int32Array(3), HI = new Int32Array(3);

// The voxels of actor i's box, swept by m along axis a (m = 0: at rest).
function sweptBox(A, i, a, m, lo, hi){
  for (let b = 0; b < 3; b++){
    let p = A.pos[3 * i + b], q = p;
    if (b === a){ if (m < 0) p += m; else q += m; }
    lo[b] = p >> FR;
    hi[b] = ((q + A.size[3 * i + b] * ONE - 1) >> FR) + 1;
  }
}
function inRoom(A, i, lo, hi){
  const r = A.room, o = 6 * i;
  for (let b = 0; b < 3; b++) if (lo[b] < r[o + b] || hi[b] > r[o + 3 + b]) return false;
  return true;
}
function sweptHits(world, A, i, a, m, rooms, stats){
  sweptBox(A, i, a, m, LO, HI);
  if (rooms && inRoom(A, i, LO, HI)){ if (stats) stats.roomSaves++; return false; }
  if (stats) stats.probes++;
  return world.solid(LO, HI);
}

/* Move actor i by up to dv along axis a; returns how far it went. `log`, if
   given, gets (i, a, from, moved, wanted) per move, for the test's replay. */
function moveAxis(world, A, i, a, dv, rooms, log, stats){
  let m = dv;
  if (dv !== 0 && sweptHits(world, A, i, a, dv, rooms, stats)){
    const sg = dv < 0 ? -1 : 1;
    let got = 0, top = sg * dv;
    /* Contact first: an actor against a wall asks to go into it tick after
       tick, and the shortest move hitting means no move at all, one probe
       instead of a bisection's eight. Still the longest clear move, since
       the swept box only grows. It cut walkers' cost by a fifth to a half. */
    if (top > 1){ if (sweptHits(world, A, i, a, sg, rooms, stats)) top = 1; else got = 1; }
    while (top - got > 1){
      const mid = (got + top) >> 1;
      if (sweptHits(world, A, i, a, sg * mid, rooms, stats)) top = mid; else got = mid;
    }
    m = sg * got;
  }
  if (log) log.push(i, a, A.pos[3 * i + a], m, dv);
  A.pos[3 * i + a] += m;
  if (rooms && m !== 0){
    sweptBox(A, i, a, 0, LO, HI);
    if (!inRoom(A, i, LO, HI)){ world.room(LO, HI, A.room, 6 * i); if (stats) stats.roomFinds++; }
  }
  return m;
}

/* Is actor i's box at rest in something solid? Never, after a spawn or a
   tick in one world. An edit can put it there (a block placed over it), and
   then every sweep hits and it can't move: `rescue` moves it out. */
export function restHits(world, A, i){
  sweptBox(A, i, 0, 0, LO, HI);
  return world.solid(LO, HI);
}
// The voxels actor i's box covers at rest, as new arrays.
export function restBox(A, i){
  const lo = [0, 0, 0], hi = [0, 0, 0];
  sweptBox(A, i, 0, 0, lo, hi);
  return [lo, hi];
}

/* ---- the grid ------------------------------------------------------------------
   Who is near whom, from last tick's positions. Two actors push apart when
   their boxes, each grown by sep/2 voxels, overlap: on every axis
   |centre_i − centre_j| < (size_i + size_j)/2 + sep. A soft rule, so a push is
   a sum, and integer sums don't care about order. Hard blocking would (who
   moved first?), which is actors.md §8's claim-then-resolve, not built.

   The cells are a power of two no smaller than the widest reach, maxSize +
   sep, so a neighbour is never more than one cell away. The key is exact,
   not a hash: **the trap the sketch hit** was an XOR key under which two of
   the 27 neighbouring cells could share a key, so a list was visited twice
   and a push doubled. Exact keys need base³ < 2⁵³, so past D = 17 the cells
   grow: bigger cells only hand pushOf more candidates to reject. */
export function buildGrid(A, D, sep){
  let reach = 1;
  for (let i = 0; i < A.N; i++) if (A.alive[i]) for (let a = 0; a < 3; a++) reach = Math.max(reach, A.size[3 * i + a] + sep);
  let shift = Math.max(0, D - 17);
  while (2 ** shift < reach) shift++;
  const base = 2 ** (D - shift) + 3, cells = new Map(), o = A.old;
  for (let i = 0; i < A.N; i++){
    if (!A.alive[i]) continue;
    const k = cellKey(base, cellOf(o, A.size, i, 0, shift), cellOf(o, A.size, i, 1, shift), cellOf(o, A.size, i, 2, shift));
    const l = cells.get(k);
    if (l) l.push(i); else cells.set(k, [i]);
  }
  return { cells, shift, base };
}
// Centres are p + size·128 in fixed point, so twice the centre is an integer
// in 1/256 even for an odd size; the cell is the centre's voxel >> shift. A
// division, not >>: at D = 22 twice a centre passes 2³¹, and >> would wrap.
const centre2 = (o, size, i, a) => 2 * o[3 * i + a] + size[3 * i + a] * ONE;
const cellOf = (o, size, i, a, shift) => Math.floor(centre2(o, size, i, a) / 2 ** (FR + 1 + shift));
const cellKey = (base, x, y, z) => (x + 1) + base * ((y + 1) + base * (z + 1));

/* The push on actor i, into out[0..2], in 1/256 voxel per tick: `push` per
   axis from each neighbour, away from it (none on an axis where the centres
   are level). With grid null it's the brute force over everyone, which is
   what the test holds the grid to. */
export function pushOf(A, grid, i, sep, push, out){
  const o = A.old, sz = A.size;
  const cx = centre2(o, sz, i, 0), cy = centre2(o, sz, i, 1), cz = centre2(o, sz, i, 2);
  out[0] = out[1] = out[2] = 0;
  const visit = j => {
    if (j === i || !A.alive[j]) return;
    // Doubled, like the centres: (size_i + size_j) + 2·sep, in 1/256.
    const dx = cx - centre2(o, sz, j, 0), dy = cy - centre2(o, sz, j, 1), dz = cz - centre2(o, sz, j, 2);
    if (Math.abs(dx) >= (sz[3 * i] + sz[3 * j] + 2 * sep) * ONE) return;
    if (Math.abs(dy) >= (sz[3 * i + 1] + sz[3 * j + 1] + 2 * sep) * ONE) return;
    if (Math.abs(dz) >= (sz[3 * i + 2] + sz[3 * j + 2] + 2 * sep) * ONE) return;
    out[0] += Math.sign(dx) * push; out[1] += Math.sign(dy) * push; out[2] += Math.sign(dz) * push;
  };
  if (!grid){ for (let j = 0; j < A.N; j++) visit(j); return; }
  const { cells, shift, base } = grid, r = 1;
  const X = cellOf(o, sz, i, 0, shift), Y = cellOf(o, sz, i, 1, shift), Z = cellOf(o, sz, i, 2, shift);
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++){
    const l = cells.get(cellKey(base, X + a, Y + b, Z + c));
    if (l) for (const j of l) visit(j);
  }
}

/* ---- spawning ---------------------------------------------------------------------
   Actor i, with a box of `size` voxels, somewhere clear within `radius` voxels
   of `centre` (in voxels) on every axis and inside the world: up to `tries`
   places, each a hash of (seed, i, try), so one actor's spawn doesn't depend
   on another's. Returns whether it found one; if not, the slot stays dead.
   Actors may spawn overlapping each other: the pushes part them.

   A centre outside the world counts from the world's nearest voxel to it
   (`inside`). The viewer opens rows, the lattice and the kit with the eye
   outside, and the first version spawned nothing there: every place it drew
   was off the world's edge. Now they start at the edge facing the eye, and
   the leash brings them along when it comes in.

   `away` (the leash, when it has an `inner`): the first half of the tries
   also turn down places inside the eye's personal space (spaceOf), so a
   flier isn't born in the camera. Only the first half: in a tunnel narrower
   than the space every place is inside it, and a slot left dead would be
   worse than one pushed out in a fifth of a second.

   **Ground kinds** (step 4): an explorer or a vehicle (A.kind[i] set before
   the spawn) wants something under it, or it falls for as long as the world
   is tall: 2,000 voxels in the clay block's world, half a minute. So the
   first three quarters of the tries also turn down a place with nothing
   within `drop` voxels below (one probe, the box swept down). The last
   quarter take anywhere clear, so a world with no floor near still gets its
   actors, falling. A flier never asks. */
export const inside = (world, centre) => centre.map(v => Math.max(0, Math.min(world.side - 1, Math.floor(v))));
export const SPAWN_DROP = 64;
export function spawnNear(world, A, i, size, seed, centre, radius, tries = 64, trap = 0, away = null, drop = SPAWN_DROP){
  for (let a = 0; a < 3; a++) A.size[3 * i + a] = size[a];
  A.alive[i] = 0;
  const c = inside(world, centre);
  for (let k = 0; k < tries; k++){
    let ok = true;
    for (let a = 0; a < 3; a++){
      const lo = Math.max(0, c[a] - radius), hi = Math.min(world.side - size[a], c[a] + radius);
      if (hi < lo){ ok = false; break; }
      A.pos[3 * i + a] = lo * ONE + mix(seed, i, k, a) % ((hi - lo) * ONE + 1);
    }
    if (!ok) break;
    if (restHits(world, A, i)) continue;
    if (away && away.inner > 0 && 2 * k < tries && gapTo(A, i, away.at) < away.inner * ONE) continue;
    if (A.kind[i] && drop > 0 && 4 * k < 3 * tries && !sweptHits(world, A, i, 1, -drop * ONE, false, null)) continue;
    // Not into a sealed pocket either (the kit has millions): it would live
    // there pressed against the wall nearest the eye.
    if (trap > 0){ const [lo, hi] = restBox(A, i); if (sealedAt(world, lo, hi, trap)) continue; }
    A.alive[i] = 1;
    A.old.set(A.pos.subarray(3 * i, 3 * i + 3), 3 * i);
    A.vel.fill(0, 3 * i, 3 * i + 3);
    A.epoch[i] = 0; A.until[i] = 0;                  // a goal at its first tick
    noRoom(A.room, 6 * i);
    // The kinds' state: an explorer falls until it lands on something, a vehicle
    // drops to the ground facing a heading from the same hash as its place.
    A.hold[i] = 0; A.down[i] = DOWN; A.speed[i] = 0; A.calm[i] = 0;
    A.heading[i] = A.goal[i] = mix(seed, i, k, 9) & 15;
    return true;
  }
  return false;
}

/* ---- the flier ---------------------------------------------------------------------
   Q4's "wander, keeping outside the geometry". It has a goal velocity, a
   hash of (seed, actor, epoch, axis), for 64 to 191 ticks (1–3 s), and eases
   toward it by 1/2^ease of the difference a tick, so it flies in curves
   rather than the sketch's buzz (a random kick every tick). The sweeps keep
   it out of the rock; when one cuts a move short it bounces at half speed,
   and if the goal was what drove it into the wall it picks a new goal next
   tick, so it turns away instead of pressing on. That's its own state,
   decided from its own move, so it's still order-free.

   The leash (Q8): a pull toward `leash.at` (fixed point, the eye's position
   last frame, the same for everyone in a tick) on each axis where the
   actor's centre is farther than `radius` voxels from it, growing by one
   unit a tick per 2^shift of overshoot up to `max`. A box, not a ball, so it
   stays integer. Inside the box there's no pull at all, only the wander.

   All speeds are in 1/256 voxel a tick: vmax 384 is 1.5 voxels a tick, 90 a
   second at 60 Hz, and wander 128 is a goal of up to half a voxel a tick on
   each axis. These are the sketch's speeds; the viewer will tune them.

   **Personal space** (asked for 2026-11-07: "they want to be near the
   player but not overlap"): with `leash.inner` > 0, a flier whose box comes
   within `inner` voxels of the eye is pushed away from it, so the leash's
   box is a shell: pulled in past `radius`, pushed out inside `inner`, free
   in between. See spaceOf for why it's a force and not a goal. */
export const FLIER = Object.freeze({ seed: 1, vmax: 384, wander: 128, ease: 3, spanMin: 64, spanMask: 127, push: 6, sep: 2, leash: null, trap: 32 });

/* The push away from the eye on actor i, into out[0..2], in 1/256 voxel per
   tick per tick. The distance is from the eye (`leash.at`, a point) to the
   actor's box, the largest gap on any axis (so a box, integer, like the
   leash), and the push grows by one unit per 2^innerShift of depth inside
   `inner`, up to `innerMax`. Its direction is the eye-to-centre offset scaled
   so its longest axis gets the whole push: a flier dead ahead backs straight
   off instead of sliding off diagonally, as a per-axis sign would make it.
   An eye exactly on the centre pushes up.

   A force (added to the velocity, like the neighbours' pushes), not a goal:
   the velocity eases toward its goal by an eighth a tick, so a goal reacts in
   about eight ticks and a flier the eye flies at is reached first. A force
   held for a tick moves the equilibrium by 2^ease times itself, so innerMax
   48 is already vmax. Read from the eye and the actor's own position only:
   order-free. */
export function spaceOf(L, A, i, out){
  out[0] = out[1] = out[2] = 0;
  if (!L || !(L.inner > 0)) return;
  const deep = L.inner * ONE - gapTo(A, i, L.at);
  if (deep <= 0) return;
  let far = 0;
  for (let a = 0; a < 3; a++){
    out[a] = A.pos[3 * i + a] + A.size[3 * i + a] * (ONE >> 1) - L.at[a];
    far = Math.max(far, Math.abs(out[a]));
  }
  const s = Math.min(L.innerMax, 1 + Math.floor(deep / 2 ** L.innerShift));
  if (far === 0){ out[0] = 0; out[1] = s; out[2] = 0; return; }
  for (let a = 0; a < 3; a++) out[a] = Math.trunc(out[a] * s / far);
}

// The gap from a point (fixed point) to actor i's box, in 1/256 voxel: the
// largest on any axis, negative with the point inside the box.
export function gapTo(A, i, at){
  let gap = -Infinity;
  for (let a = 0; a < 3; a++) gap = Math.max(gap, Math.abs(2 * (A.pos[3 * i + a] - at[a]) + A.size[3 * i + a] * ONE) - A.size[3 * i + a] * ONE);
  return gap / 2;
}

/* One tick for everyone, every kind (tickFliers is the same function, from
   before there were kinds). The preamble is the population's: rooms dropped
   for a new world, last tick's positions kept for the pushes, the grid. Then
   each actor moves by its kind's rule, reading only its own state, `old`, the
   world and the eye, so the order still can't change a byte. */
const PUSH_OUT = new Int32Array(3), SPACE_OUT = new Int32Array(3);
export function tickActors(world, A, params = FLIER, { order = null, log = null, stats = null, rooms = true, grid = true } = {}){
  const P = params, t = A.t, L = P.leash;
  const useRooms = rooms && typeof world.room === 'function';
  if (useRooms && A.roomWorld !== world){
    for (let i = 0; i < A.N; i++) noRoom(A.room, 6 * i);
    A.roomWorld = world;
  }
  A.old.set(A.pos);
  const g = grid ? buildGrid(A, world.D, P.sep) : null, push = PUSH_OUT, space = SPACE_OUT;
  const X = P.explorer ?? EXPLORER, V = P.vehicle ?? VEHICLE;
  const n = order ? order.length : A.N;
  for (let k = 0; k < n; k++){
    const i = order ? order[k] : k;
    if (!A.alive[i]) continue;
    const kind = A.kind[i];
    if (kind !== KIND.flier){
      pushOf(A, g, i, P.sep, P.push, push);
      if (kind === KIND.explorer) explorerStep(world, A, i, P, X, t, push, useRooms, log, stats);
      else vehicleStep(world, A, i, P, V, t, push, useRooms, log, stats);
      continue;
    }
    if (t >= A.until[i]){
      A.epoch[i]++;
      A.until[i] = t + P.spanMin + (mix(P.seed, i, A.epoch[i], 1) & P.spanMask);
    }
    pushOf(A, g, i, P.sep, P.push, push);
    spaceOf(L, A, i, space);                       // before any axis moves: one offset for all three
    for (let a = 0; a < 3; a++){
      let goal = mix(P.seed, i, A.epoch[i], 2 + a) % (2 * P.wander + 1) - P.wander;
      if (L){
        const d = L.at[a] - (A.pos[3 * i + a] + A.size[3 * i + a] * (ONE >> 1)), over = Math.abs(d) - L.radius * ONE;
        if (over > 0) goal += Math.sign(d) * Math.min(L.max, Math.floor(over / 2 ** L.shift));
      }
      let v = A.vel[3 * i + a];
      v += (goal - v) >> P.ease;
      v += push[a] + space[a];
      v = Math.max(-P.vmax, Math.min(P.vmax, v));
      const m = moveAxis(world, A, i, a, v, useRooms, log, stats);
      if (m !== v){
        if (goal !== 0 && (goal > 0) === (v > 0)) A.until[i] = t + 1;
        v = -(v >> 1);
      }
      A.vel[3 * i + a] = v;
    }
  }
  A.t = t + 1;
}
export const tickFliers = tickActors;

/* ---- the explorer ------------------------------------------------------------------
   Asked for 2026-11-19: "explorers that follow the edges of the world they are
   in", read (by the user's pick) as surfaces: it crawls along any solid face,
   floor, wall or ceiling, holding it, the way an ant follows edges. In a voxel
   world every face is axis-aligned (actors.md §2's climber, "unusually well
   suited"), so the face it holds is one of six directions, `down`, and the way
   it crawls is another, `heading`, at right angles to it. A tick:

     crawl    `crawl` along the heading, swept like any move;
     a wall   cut short: something is ahead, so that's a surface too. It
              climbs it (3 ticks in 4, by hash), down becoming the heading and
              the heading away from the old face, or turns to run along its
              foot (the third axis, either way);
     press    otherwise it presses `press` (a voxel) toward its face. A press
              cut short is contact: it HOLDs. A press that goes the whole way
              found nothing: it went over an edge, so it ROUNDs it, the face
              it was crawling away from becoming its face (down = heading's
              opposite) and its old face's direction the way on (heading =
              down). Next tick it crawls round and presses back onto the far
              side. A ROUND whose press finds nothing again is lost: it FALLs,
              `fall` a tick straight down, until it lands on its feet.

   So it goes up walls, over roofs, along ceilings and down the far side,
   exploring everything a flier can't see from the air. In a universe the
   surface carries on into the next world wherever two worlds meet (the
   plane's grounds are flush), so an explorer crosses on foot like the walker.

   HOLD means contact, exactly: the last move toward its face was cut short,
   so 1/256 more would hit. The test holds every HOLD to it on a dense twin.
   Pushes from neighbours act before the crawl, on the two axes along the
   face, never into it or off it, for the same reason.

   **The eye**: on the leash's terms (the same box, `radius`), an explorer
   past it crawls toward the eye on whichever axis along its face is farthest
   over, so it climbs whatever's between, and inside the personal space it
   crawls away on the axis it's most off. It can't fly, so when you outrun
   it the page's regather fetches it, as it does a flier. Its new heading at
   each epoch (2–6 s) is a hash, as a flier's goal is. */
export const DIR6 = Object.freeze([[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]);
export const DOWN = 3;                               // −y: a floor
export const HOLD = 2, ROUND = 1, FALL = 0;
export const EXPLORER = Object.freeze({ crawl: 64, press: 256, fall: 384, spanMin: 120, spanMask: 255 });
const sgn6 = d => d & 1 ? -1 : 1;
// The k-th (0–3) of the four directions along a face held in direction `down`.
export const along = (down, k) => 2 * (((down >> 1) + 1 + (k >> 1)) % 3) + (k & 1);
const CENTRE = new Int32Array(3);
function centreOf(A, i, out){ for (let a = 0; a < 3; a++) out[a] = A.pos[3 * i + a] + A.size[3 * i + a] * (ONE >> 1); return out; }
/* The eye's say in an explorer's heading, or −1 for none: away inside the
   personal space, toward it past the leash, on an axis along its face. */
export function steerAlong(L, A, i, down){
  if (!L) return -1;
  const c = centreOf(A, i, CENTRE), dax = down >> 1;
  let best = 0, dir = -1;
  if (L.inner > 0 && gapTo(A, i, L.at) < L.inner * ONE){
    for (let a = 0; a < 3; a++){
      if (a === dax) continue;
      const d = c[a] - L.at[a];
      if (Math.abs(d) > best){ best = Math.abs(d); dir = 2 * a + (d < 0 ? 1 : 0); }
    }
    return dir;
  }
  for (let a = 0; a < 3; a++){
    if (a === dax) continue;
    const d = L.at[a] - c[a], over = Math.abs(d) - L.radius * ONE;
    if (over > best){ best = over; dir = 2 * a + (d < 0 ? 1 : 0); }
  }
  return dir;
}
function explorerStep(world, A, i, P, X, t, push, rooms, log, stats){
  const s = A.hold[i], p3 = 3 * i;
  const from0 = A.pos[p3], from1 = A.pos[p3 + 1], from2 = A.pos[p3 + 2];
  if (t >= A.until[i]){
    A.epoch[i]++;
    A.until[i] = t + X.spanMin + (mix(P.seed, i, A.epoch[i], 1) & X.spanMask);
    A.heading[i] = along(A.down[i], mix(P.seed, i, A.epoch[i], 7) & 3);
  }
  if (s === FALL){
    // Lost: straight down until it lands, then a way along the floor.
    if (A.down[i] !== DOWN){ A.down[i] = DOWN; A.heading[i] = along(DOWN, mix(P.seed, i, A.epoch[i], 7) & 3); }
    const m = moveAxis(world, A, i, 1, -X.fall, rooms, log, stats);
    if (m !== -X.fall) A.hold[i] = HOLD;
  } else {
    let down = A.down[i], head = A.heading[i];
    if (s === HOLD){
      const e = steerAlong(P.leash, A, i, down);
      if (e >= 0) head = e;
      // Pushes along the face only: never into it or off it.
      for (let a = 0; a < 3; a++) if (a !== down >> 1 && push[a]) moveAxis(world, A, i, a, push[a], rooms, log, stats);
    }
    const want = sgn6(head) * X.crawl, m = moveAxis(world, A, i, head >> 1, want, rooms, log, stats);
    let pressed = true;
    if (m !== want){
      // Something ahead: climb it, or turn along its foot.
      if (mix(P.seed, i, t, 11) & 3){ const was = down; down = head; head = was ^ 1; pressed = false; }
      else head = 2 * (3 - (down >> 1) - (head >> 1)) + (mix(P.seed, i, t, 12) & 1);
      A.hold[i] = HOLD;
    }
    if (pressed){
      const pw = sgn6(down) * X.press, q = moveAxis(world, A, i, down >> 1, pw, rooms, log, stats);
      if (q !== pw) A.hold[i] = HOLD;
      else if (s === HOLD && m === want){ const was = down; down = head ^ 1; head = was; A.hold[i] = ROUND; }
      else A.hold[i] = FALL;
    }
    A.down[i] = down; A.heading[i] = head;
  }
  A.vel[p3] = A.pos[p3] - from0; A.vel[p3 + 1] = A.pos[p3 + 1] - from1; A.vel[p3 + 2] = A.pos[p3 + 2] - from2;
}

/* ---- the vehicle -------------------------------------------------------------------
   Asked for 2026-11-19, on the ground (the user's pick): it drives under
   gravity on whatever floor it lands on, steering by a heading, one of 16
   (HEADINGS: cos and sin × 256, rounded, written out so every engine has the
   same integers; never Math.cos in a tick). A tick:

     steer    a new goal heading each epoch (1.5–5 s), within three steps of
              the one it has (a hash), so it drives in long gentle curves; the
              eye, past the leash on x or z, makes the goal the heading toward
              it, and inside the personal space the one away. It turns one
              step toward its goal every `turnEvery` ticks (22.5° a 15th of a
              second at 4), the short way round;
     speed    eases toward `cruise` by `accel` a tick, half that in a sharp turn
              (more than two steps off its goal);
     gravity  `gravity` a tick, swept; a fall cut short lands it (hold = 1);
     drive    the heading times the speed, x then z, swept. A move cut short
              on the ground tries a step: `step` voxels up, if that's clear
              and it can then go on at all, as the walker steps a stair; else
              it's blocked. After driving on the ground it snaps down up to
              `step` voxels, so it rolls down stairs instead of hopping;
     blocked  it backs off: its speed reversed at half, a goal about the
              opposite way, and `backoff` ticks of ignoring the eye (`calm`),
              or the leash would drive it straight back into the wall.

   On the ground means contact, exactly, as an explorer's HOLD: the test holds
   every grounded tick to 1/256 more down hitting. Pushes act on x and z only,
   in the drive. In a universe it drives off one world onto the next across
   the plane: every ground is at one height, so the border is flat. */
export const HEADINGS = Object.freeze([256, 0, 237, 98, 181, 181, 98, 237, 0, 256, -98, 237, -181, 181, -237, 98,
                                       -256, 0, -237, -98, -181, -181, -98, -237, 0, -256, 98, -237, 181, -181, 237, -98]);
export const VEHICLE = Object.freeze({ cruise: 128, accel: 4, gravity: 12, fall: 1024, step: 1, turnEvery: 4, spanMin: 90, spanMask: 255, backoff: 90 });
// The heading nearest the direction (x, z), in any units: the largest dot product, the first on a tie.
export function headingTo(x, z){
  let best = -Infinity, h = 0;
  for (let k = 0; k < 16; k++){ const d = HEADINGS[2 * k] * x + HEADINGS[2 * k + 1] * z; if (d > best){ best = d; h = k; } }
  return h;
}
// The eye's say in a vehicle's goal, or −1: away inside the space, toward it past the leash.
export function steerTo(L, A, i){
  if (!L) return -1;
  const c = centreOf(A, i, CENTRE), dx = L.at[0] - c[0], dz = L.at[2] - c[2];
  if (L.inner > 0 && gapTo(A, i, L.at) < L.inner * ONE) return dx || dz ? headingTo(-dx, -dz) : -1;
  return Math.max(Math.abs(dx), Math.abs(dz)) > L.radius * ONE ? headingTo(dx, dz) : -1;
}
function vehicleStep(world, A, i, P, V, t, push, rooms, log, stats){
  const p3 = 3 * i, from0 = A.pos[p3], from2 = A.pos[p3 + 2];
  if (t >= A.until[i]){
    A.epoch[i]++;
    A.until[i] = t + V.spanMin + (mix(P.seed, i, A.epoch[i], 1) & V.spanMask);
    A.goal[i] = (A.heading[i] + mix(P.seed, i, A.epoch[i], 7) % 7 - 3) & 15;
  }
  if (t >= A.calm[i]){ const g = steerTo(P.leash, A, i); if (g >= 0) A.goal[i] = g; }
  const off = ((A.goal[i] - A.heading[i] + 8) & 15) - 8;
  if (off && (t + i) % V.turnEvery === 0) A.heading[i] = (A.heading[i] + Math.sign(off)) & 15;
  const target = Math.abs(off) > 2 ? V.cruise >> 1 : V.cruise;
  A.speed[i] += Math.max(-V.accel, Math.min(V.accel, target - A.speed[i]));
  // Gravity.
  let vy = Math.max(-V.fall, A.vel[p3 + 1] - V.gravity), ground = 0;
  const my = moveAxis(world, A, i, 1, vy, rooms, log, stats);
  if (my !== vy){ if (vy < 0) ground = 1; vy = 0; }
  // The drive, x then z.
  const h = A.heading[i], sp = A.speed[i], up = V.step * ONE;
  let blocked = false, drove = false;
  for (let a = 0; a < 3; a += 2){
    const d = Math.trunc(HEADINGS[2 * h + (a >> 1)] * sp / ONE) + push[a];
    if (!d) continue;
    const m = moveAxis(world, A, i, a, d, rooms, log, stats);
    if (m !== 0) drove = true;
    if (m === d) continue;
    // A step: clear above, and from up there, room to go on at all.
    let stepped = false;
    if (ground && !sweptHits(world, A, i, 1, up, rooms, stats)){
      A.pos[p3 + 1] += up;
      const ahead = !sweptHits(world, A, i, a, Math.sign(d), rooms, stats);
      A.pos[p3 + 1] -= up;
      if (ahead){
        moveAxis(world, A, i, 1, up, rooms, log, stats);
        moveAxis(world, A, i, a, d - m, rooms, log, stats);
        stepped = drove = true;
      }
    }
    if (!stepped) blocked = true;
  }
  if (ground && drove){
    const s = moveAxis(world, A, i, 1, -up, rooms, log, stats);
    if (s === -up) ground = 0;                       // nothing within a step: off an edge, falling
  }
  if (blocked){
    A.speed[i] = -(A.speed[i] >> 1);
    A.goal[i] = (A.heading[i] + 8 + mix(P.seed, i, t, 13) % 5 - 2) & 15;
    A.calm[i] = t + V.backoff;
  }
  A.hold[i] = ground;
  A.vel[p3] = A.pos[p3] - from0; A.vel[p3 + 1] = vy; A.vel[p3 + 2] = A.pos[p3 + 2] - from2;
}

/* ---- the rolling origin -------------------------------------------------------------
   The endless lattice moves its coordinates by whole cells when it re-centres
   (universe-log step 5), and everything the page holds moves with them: d in
   whole voxels, onto the positions, last tick's and the rooms. Nothing an
   actor decides depends on where it is, only on what's round it, so a
   population shifted with its world ticks to the shifted bytes (the test). */
export function shiftActors(A, d){
  for (let i = 0; i < A.N; i++){
    for (let a = 0; a < 3; a++){ A.pos[3 * i + a] += d[a] * ONE; A.old[3 * i + a] += d[a] * ONE; }
    const o = 6 * i;
    if (A.room[o] <= A.room[o + 3]) for (let a = 0; a < 3; a++){ A.room[o + a] += d[a]; A.room[o + 3 + a] += d[a]; }
  }
}

/* Regathering: the leash's backstop. The leash pulls at vmax at most, 90
   voxels a second, and the eye can go faster (shift is ×8), jump (a link
   with ?eye, a world switch), or start outside the world, where nothing can
   spawn. So every so often the page asks for the far ones back: an actor
   whose centre is more than `far` voxels from `centre` on any axis is
   spawned again within `radius` of it, and a dead slot is tried again. Set
   far well beyond the leash's radius (the page uses 16×), so it only acts
   after a jump, and fliers otherwise live where they've flown to (Q6).
   Distances are from the world's nearest voxel to `centre`, as spawns are,
   or with the eye far outside every flier would be far, and respawned at
   the edge every time it's asked.
   Per actor, from the eye and its own state: order-free like a tick. The
   seed takes the clock in, so a slot that failed tries new places next
   time. Returns how many it spawned. */
export function regather(world, A, seed, centre, radius, far, tries = 8, trap = 0, away = null){
  let n = 0;
  centre = inside(world, centre);
  for (let i = 0; i < A.N; i++){
    if (A.alive[i]){
      let out = false;
      for (let a = 0; a < 3 && !out; a++)
        out = Math.abs(A.pos[3 * i + a] + A.size[3 * i + a] * (ONE >> 1) - centre[a] * ONE) > far * ONE;
      if (!out) continue;
    }
    const size = [A.size[3 * i], A.size[3 * i + 1], A.size[3 * i + 2]];
    if (spawnNear(world, A, i, size, mix(seed, A.t, 0x5eed), centre, radius, tries, trap, away)) n++;
  }
  return n;
}

/* Q6's fast forward: n ticks with the same leash. The same bytes as n calls,
   because it is n calls. */
export function advanceFliers(world, A, n, params = FLIER, opts = {}){
  for (let k = 0; k < n; k++) tickFliers(world, A, params, opts);
}

/* ---- trapped ----------------------------------------------------------------------
   Asked for 2026-11-07: "if a block is placed over a flier (or a flier is
   somehow completely surrounded or inside the boundary) it should respawn
   nearby". Two ways to be trapped, and both only an edit can cause, since a
   tick never moves a box into rock and a spawn checks both:

     rock     the box at rest is in something solid (a block placed over it)
     sealed   the air it's in is closed: a flood of air from its box, through
              voxels that share a face, never reaches the outer layer of the
              box grown by `reach` voxels. So a hollow room up to about 2·reach
              across, built round a flier, traps it, and a room with a hole of
              one voxel doesn't, even if the flier can't fit through it: that
              is "completely surrounded", read literally. A larger sealed room
              isn't a trap, it's somewhere to live.

   The flood is the slow part, so two shortcuts come first, each exact:
   the whole grown box is empty (one probe), or one of the six slabs from the
   box's faces straight out to the grown box's edge is (one probe each).
   Only a flier in a corner with walls on every side pays for the flood: a
   dense grid of the grown box and a breadth-first search over its air. */
export function sealedAt(world, lo, hi, reach){
  const RL = lo.map(v => v - reach), RH = hi.map(v => v + reach);
  if (!world.solid(RL, RH)) return false;
  const a = [0, 0, 0], b = [0, 0, 0];
  for (let ax = 0; ax < 3; ax++) for (const up of [0, 1]){
    for (let c = 0; c < 3; c++){ a[c] = lo[c]; b[c] = hi[c]; }
    if (up){ a[ax] = hi[ax]; b[ax] = RH[ax]; } else { a[ax] = RL[ax]; b[ax] = lo[ax]; }
    if (a[ax] < b[ax] && !world.solid(a, b)) return false;
  }
  const n0 = RH[0] - RL[0], n1 = RH[1] - RL[1], n2 = RH[2] - RL[2], grid = fillOf(world, RL, RH);
  const queue = new Int32Array(n0 * n1 * n2);
  let head = 0, tail = 0;
  for (let z = reach; z < n2 - reach; z++) for (let y = reach; y < n1 - reach; y++) for (let x = reach; x < n0 - reach; x++){
    const i = x + n0 * (y + n1 * z);
    if (grid[i]) continue;                // the caller's box should be air; any rock in it is just rock
    grid[i] = 2; queue[tail++] = i;
  }
  const step = [1, -1, n0, -n0, n0 * n1, -n0 * n1];
  while (head < tail){
    const i = queue[head++], x = i % n0, y = Math.floor(i / n0) % n1, z = Math.floor(i / (n0 * n1));
    if (x === 0 || y === 0 || z === 0 || x === n0 - 1 || y === n1 - 1 || z === n2 - 1) return false;
    for (let k = 0; k < 6; k++){
      const j = i + step[k];
      if (grid[j]) continue;
      grid[j] = 2; queue[tail++] = j;
    }
  }
  return true;
}
// 'rock', 'sealed' or null.
export function trapped(world, A, i, reach){
  const [lo, hi] = restBox(A, i);
  if (world.solid(lo, hi)) return 'rock';
  return reach > 0 && sealedAt(world, lo, hi, reach) ? 'sealed' : null;
}

/* What two roots of one store disagree on: the bounding box of every voxel
   that differs, or null. Hash-consing makes it cheap: equal subtrees are
   equal ids, so the walk only goes down where the ids differ, which after an
   edit is the path to the block and the block itself. Undo and redo are the
   same question. A node already inside the box found so far isn't entered. */
export function diffBox(store, a, b, D){
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const kid = (id, o) => id === EMPTY ? EMPTY : store.child(id, o);
  const walk = (p, q, k, x, y, z) => {
    if (p === q) return;
    const s = 2 ** k;
    if (x >= lo[0] && y >= lo[1] && z >= lo[2] && x + s <= hi[0] && y + s <= hi[1] && z + s <= hi[2]) return;
    if (k === 0 || p === FULL || q === FULL){
      lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], y); lo[2] = Math.min(lo[2], z);
      hi[0] = Math.max(hi[0], x + s); hi[1] = Math.max(hi[1], y + s); hi[2] = Math.max(hi[2], z + s);
      return;
    }
    const h = s / 2;
    for (let o = 0; o < 8; o++) walk(kid(p, o), kid(q, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
  };
  walk(a, b, D, 0, 0, 0);
  return lo[0] <= hi[0] ? { lo, hi } : null;
}

/* Every trapped actor respawned nearby: within reach + its size of where it
   was, then twice and four times that, never into rock or a sealed pocket.
   If there's nowhere, the slot dies, and the regather tries again near the
   eye. Call it with the new world after an edit; `changed` (diffBox) skips
   every actor whose grown box the edit didn't touch, since nothing it
   could be trapped by changed. Per actor, from its own state and the world,
   and the seed takes the clock in: order-free like a tick. Returns the
   slots it moved, with why. */
export function rescue(world, A, params = FLIER, { changed = null } = {}){
  const reach = params.trap ?? 0, out = [];
  for (let i = 0; i < A.N; i++){
    if (!A.alive[i]) continue;
    if (changed){
      const [lo, hi] = restBox(A, i);
      let touches = true;
      for (let a = 0; a < 3; a++) if (lo[a] - reach >= changed.hi[a] || hi[a] + reach <= changed.lo[a]) touches = false;
      if (!touches) continue;
    }
    const why = trapped(world, A, i, reach);
    if (!why) continue;
    const size = [A.size[3 * i], A.size[3 * i + 1], A.size[3 * i + 2]];
    const centre = [0, 1, 2].map(a => Math.floor((A.pos[3 * i + a] + size[a] * (ONE >> 1)) / ONE));
    let r = reach + Math.max(...size);
    for (let k = 0; k < 3; k++, r *= 2)
      if (spawnNear(world, A, i, size, mix(params.seed, A.t, i, 0x7e5c0e + k), centre, r, 16, reach, params.leash)) break;
    out.push({ i, why, alive: !!A.alive[i] });
  }
  return out;
}
