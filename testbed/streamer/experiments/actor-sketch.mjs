/* A sketch for docs/actors.md: what would several living things cost in
   these worlds, and what do the worlds look like to them? Not an engine
   change: no core file is touched, nothing imports this, nothing is drawn.
   It exists so the discussion starts from numbers, like compute-sketch.mjs
   (whose §d measured one actor's queries; this goes on to populations).

   Sections, all on one thread:
     a. the oracle: every move a flier or walker makes, at D = 8 on four
        worlds, against a dense grid: the swept box was clear, the move was
        the longest clear one, and the box at rest is clear. Shuffled update
        order gives the same bytes. The neighbour grid gives the brute force's
        pushes. Then five mutants, each of which must be caught.
     b. bodies: an actor shaped like a kit part or a specimen (a 16³ DAG of
        its own, any of 24 turns) against the world, voxel against voxel,
        by a walk down both. Against a dense oracle, then its cost against
        the bounding box's, and how often the box lies.
     c. fliers: N of them on the real worlds. µs a tick, how it grows with N,
        and how many fit in half a frame of one worker.
     d. walkers: gravity, step-up, a heading that changes now and then. Where
        they land, whether they get anywhere, how many are stuck, and what
        they're standing on (the caves' sea is solid to the DAG).
     e. sight and drawing: line of sight between actors by edit-core's pick,
        and the records an actor's body would draw.

   node experiments/actor-sketch.mjs               everything (~4 min)
   node experiments/actor-sketch.mjs --only=ab     only those sections
   node experiments/actor-sketch.mjs --quick       smaller worlds, fewer actors (~45 s)
   It measures times, so run it on an idle machine. */
import { createStore, EMPTY, FULL, FIRST_NODE, applyG } from '../dag-core.js';
import { expandChunk } from '../chunk-core.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { kitDesc, buildKit, PARTS, PART_NAMES, partOcc, ornamentOcc } from '../kit-core.js';
import { caveDesc, buildCaves, cavePlan, voxelKind } from '../cave-core.js';
import { clayDesc, buildClay } from '../clay-core.js';
import { PROPER } from '../scatter-core.js';
import { pick } from '../edit-core.js';

const arg = (name, d) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const only = arg('only', 'abcde'), quick = process.argv.includes('--quick');
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const fmt = (x, d = 2) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d }) : '-';
const say = s => console.log(s);
const row = cells => say('| ' + cells.join(' | ') + ' |');
const now = () => performance.now();

/* Every random choice an actor makes is a hash of (seed, actor, tick, what),
   not a draw from a stream. A stream would make the result depend on the
   order actors are updated in; a hash can't. */
function mix(a, b, c = 0, d = 0){
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x27d4eb2d) ^ Math.imul(c + 0x165667b1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 13), 0x85ebca6b) ^ Math.imul(d + 0x61c88647, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const rng = seed => () => (seed = mix(seed, 1)) / 2 ** 32;

/* ---- worlds ------------------------------------------------------------- */
const shape = n => SHAPES.find(s => s.name === n);
function shapeWorld(name, D){
  const store = createStore(), { root } = store.fromField(D, fieldOf(shape(name), D));
  return { name: `${name} D=${D}`, store, root, D };
}
const kitWorld = D => { const k = buildKit(kitDesc({ D })); return { name: `kit D=${D}`, store: k.store, root: k.root, D }; };
function caveWorld(D, G){
  const desc = caveDesc(G ? { D, G } : { D }), c = buildCaves(desc);
  return { name: `caves D=${D}`, store: c.store, root: c.root, D, plan: cavePlan(desc) };
}
function clayWorld(D, lump){
  const desc = clayDesc({ D, lump, ground: true }), c = buildClay(desc);
  return { name: `clay+ground D=${D}`, store: c.store, root: c.root, D };
}
const finish = w => Object.assign(w, { side: 2 ** w.D });

/* ---- the one question: is anything solid in this box? ----------------------
   compute-sketch.mjs's boxHits: EMPTY is the only id that holds nothing, so a
   non-empty node wholly inside the box answers yes at once. No counts, so no
   float64 trap. Outside the world counts as solid: an actor can't leave. */
function boxHits(store, id, k, x, y, z, lo, hi){
  if (id === EMPTY) return false;
  const s = 2 ** k;
  if (x >= hi[0] || y >= hi[1] || z >= hi[2] || x + s <= lo[0] || y + s <= lo[1] || z + s <= lo[2]) return false;
  if (x >= lo[0] && y >= lo[1] && z >= lo[2] && x + s <= hi[0] && y + s <= hi[1] && z + s <= hi[2]) return true;
  const h = s / 2;
  for (let o = 0; o < 8; o++)
    if (boxHits(store, store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h, lo, hi)) return true;
  return false;
}
let probes = 0;
function solidIn(W, lo, hi){
  probes++;
  if (W.dense) return denseHits(W, lo, hi);
  for (let a = 0; a < 3; a++) if (lo[a] < 0 || hi[a] > W.side) return true;
  return boxHits(W.store, W.root, W.D, 0, 0, 0, lo, hi);
}

/* ---- motion in fixed point --------------------------------------------------
   Positions and velocities are int32 in 1/256 voxel. A box's low corner is at
   p, and it covers voxels p >> 8 to (p + 256·s − 1) >> 8 on each axis. A move
   is one axis at a time, and it tests the box *swept* along the move, not the
   box where it ends, so nothing goes through a wall however fast. The swept box
   only grows with the move's length, so the longest clear move is a bisection:
   one probe when the move is clear, which is most of them, and at most about
   log₂(move) when it isn't. Exact, not a step-and-check approximation. */
const FR = 8, ONE = 1 << FR;
const LO = new Int32Array(3), HI = new Int32Array(3);
let MUT = '';                                      // the oracle's mutants
let CONTACT = true;

/* The room cache. An actor remembers the largest aligned EMPTY node around its
   box (its room); a swept box inside the room is clear without asking the
   world. A room is a fact about the world, not the actor, so it's right for any
   box, and it only has to be found again when the actor leaves it: one descent
   from the root, which compute-sketch measured at about 100 ns. It must change
   nothing: the oracle runs with it on and off and wants the same bytes. */
let ROOMS = null, USE_ROOMS = false, roomFinds = 0, roomSaves = 0;
function roomOf(W, i){
  roomFinds++;
  let id = W.root, x = 0, y = 0, z = 0, k = W.D;
  const r = ROOMS, o = 6 * i;
  for (;;){
    if (id === EMPTY){ const s = 2 ** k; r[o] = x; r[o + 1] = y; r[o + 2] = z; r[o + 3] = x + s; r[o + 4] = y + s; r[o + 5] = z + s; return; }
    if (id === FULL || k === 0) break;
    const h = 2 ** (k - 1), c = [x + h, y + h, z + h];
    let oct = 0;
    for (let a = 0; a < 3; a++){
      if (LO[a] >= c[a]) oct |= 1 << a;
      else if (HI[a] > c[a]) { k = -1; break; }     // straddles: no single child
    }
    if (k < 0) break;
    id = W.store.child(id, oct); x += (oct & 1) * h; y += (oct >> 1 & 1) * h; z += (oct >> 2) * h; k--;
  }
  r[o] = 1; r[o + 3] = 0;                          // no room
}
function inRoom(i, skip){
  const r = ROOMS, o = 6 * i;
  for (let a = 0; a < 3; a++){
    if (a === skip) continue;
    if (LO[a] < r[o + a] || HI[a] > r[o + 3 + a]) return false;
  }
  return true;
}

function sweptHits(W, pos, size, i, a, m){
  for (let b = 0; b < 3; b++){
    let p = pos[3 * i + b], q = p;
    if (b === a) { if (m < 0) p += m; else q += m; }
    LO[b] = p >> FR;
    HI[b] = ((q + size[b] * ONE - (MUT === 'hi' ? 0 : 1)) >> FR) + 1;
  }
  if (MUT === 'dest' && m !== 0){ const q = pos[3 * i + a] + m; LO[a] = q >> FR; HI[a] = ((q + size[a] * ONE - 1) >> FR) + 1; }
  if (ROOMS && inRoom(i, MUT === 'room' ? a : -1)){ roomSaves++; return false; }
  return solidIn(W, LO, HI);
}
function moveAxis(W, pos, size, i, a, dv, log){
  let m = dv;
  if (dv !== 0 && sweptHits(W, pos, size, i, a, dv)){
    const sg = Math.sign(dv);
    let got = 0, top = Math.abs(dv);
    /* Contact first: a walker standing on a floor asks to fall every tick, and
       the shortest move hitting means no move at all, one probe instead of a
       bisection's eight. Still the longest clear move, since the swept box only
       grows. CONTACT = false is the plain bisection, for the table. */
    if (CONTACT && top > 1){ if (sweptHits(W, pos, size, i, a, sg)) top = 1; else got = 1; }
    while (top - got > 1){
      const mid = (got + top) >> 1;
      if (sweptHits(W, pos, size, i, a, sg * mid)) top = mid; else got = mid;
    }
    m = sg * (MUT === 'top' ? top : got);
  }
  if (log) log.push(i, a, pos[3 * i + a], m, dv);
  pos[3 * i + a] += m;
  if (ROOMS && m !== 0){
    for (let b = 0; b < 3; b++){ LO[b] = pos[3 * i + b] >> FR; HI[b] = ((pos[3 * i + b] + size[b] * ONE - 1) >> FR) + 1; }
    if (!inRoom(i, -1)) roomOf(W, i);
  }
  return m;
}

/* ---- a population --------------------------------------------------------------
   Arrays per field, never an object per actor: faster in JS, and the same
   arrays are what a GPU buffer would hold (computedags.md §7, "One, two, N").
   A tick reads last tick's positions for anything about *other* actors and
   writes its own next state, so the order actors are updated in can't matter.
   The world doesn't change during a tick, so moving against it is per actor. */
function createPop(N, size){
  return { N, size, room: new Int32Array(6 * N).fill(0).map((_, j) => j % 6 === 0 ? 1 : 0), half: size.map(s => s * ONE >> 1), pos: new Int32Array(3 * N), vel: new Int32Array(3 * N), old: new Int32Array(3 * N),
           ground: new Uint8Array(N), head: new Int32Array(2 * N), home: new Int32Array(3 * N), seen: new Int32Array(3 * N) };
}
const hashState = P => { let h = 0; for (const a of [P.pos, P.vel, P.ground]) for (let i = 0; i < a.length; i++) h = mix(h, a[i]); return h >>> 0; };

/* Neighbours by a hash grid of 32-voxel cells, from last tick's positions.
   Each actor pushes away from any other whose centre is within SEP voxels on
   every axis: a soft rule, so it's a sum, and integer sums don't care about
   order. Hard actor-against-actor collision would (who moved first?), which
   is the first thing a type that blocks others would have to decide. */
const CELL = 5, SEP = 8, PUSH = 6;
function buildGrid(P){
  const g = new Map(), o = P.old, h = P.half;
  for (let i = 0; i < P.N; i++){
    const k = cellKey(((o[3 * i] + h[0]) >> FR) >> CELL, ((o[3 * i + 1] + h[1]) >> FR) >> CELL, ((o[3 * i + 2] + h[2]) >> FR) >> CELL);
    const l = g.get(k); if (l) l.push(i); else g.set(k, [i]);
  }
  return g;
}
// An exact key, not a hash: two cells sharing a key would visit one list twice
// and double a push (the oracle caught that). 2^16 cells a side is D = 21.
const cellKey = (x, y, z) => (x + 1) + (y + 1) * 65536 + (z + 1) * 4294967296;
function pushOf(P, g, i, out){
  const o = P.old, h = P.half;
  const cx = o[3 * i] + h[0], cy = o[3 * i + 1] + h[1], cz = o[3 * i + 2] + h[2], R = SEP * ONE;
  out[0] = out[1] = out[2] = 0;
  const visit = j => {
    if (j === i) return;
    const dx = cx - (o[3 * j] + h[0]), dy = cy - (o[3 * j + 1] + h[1]), dz = cz - (o[3 * j + 2] + h[2]);
    if (Math.abs(dx) >= R || Math.abs(dy) >= R || Math.abs(dz) >= R) return;
    out[0] += Math.sign(dx) * PUSH; out[1] += Math.sign(dy) * PUSH; out[2] += Math.sign(dz) * PUSH;
  };
  if (!g){ for (let j = 0; j < P.N; j++) visit(j); return; }        // the brute force
  const X = (cx >> FR) >> CELL, Y = (cy >> FR) >> CELL, Z = (cz >> FR) >> CELL, r = MUT === 'grid' ? 0 : 1;
  for (let a = -r; a <= r; a++) for (let b = -r; b <= r; b++) for (let c = -r; c <= r; c++){
    const l = g.get(cellKey(X + a, Y + b, Z + c));
    if (l) for (const j of l) visit(j);
  }
}

/* A flier: a random walk in velocity with drag, pushed by its neighbours,
   moved by sweeps. On a hit it bounces at half speed. */
const VMAX = 384, DRAG = 4, WANDER = 64;
function flierTick(W, P, t, order, log = null, grid = true){
  ROOMS = USE_ROOMS ? P.room : null;
  P.old.set(P.pos);
  const g = grid ? buildGrid(P) : null, push = [0, 0, 0];
  if (MUT === 'order') P.old = P.pos;              // reads this tick's positions
  for (const i of order){
    pushOf(P, g, i, push);
    for (let a = 0; a < 3; a++){
      let v = P.vel[3 * i + a];
      v += mix(W.seed, i, t, a) % (2 * WANDER + 1) - WANDER + push[a];
      v -= v >> DRAG;
      v = Math.max(-VMAX, Math.min(VMAX, v));
      const m = moveAxis(W, P.pos, P.size, i, a, v, log);
      P.vel[3 * i + a] = m === v ? v : -(v >> 1);
    }
  }
  if (MUT === 'order') P.old = new Int32Array(3 * P.N);
  ROOMS = null;
}

/* A walker: gravity, a heading it keeps for 64 to 191 ticks, and a step up of
   up to STEP voxels when walking into something, if the raised box is clear
   and the step forward from it is too. */
const GRAV = 24, VTERM = 1024, WALK = 96, STEP = 4;
function walkerTick(W, P, t, order, log = null){
  ROOMS = USE_ROOMS ? P.room : null;
  for (const i of order){
    const span = 64 + (mix(W.seed, i, 7) & 127), epoch = Math.floor((t + (mix(W.seed, i, 9) & 255)) / span);
    const ang = mix(W.seed, i, epoch, 3) / 2 ** 32 * 2 * Math.PI;
    const hx = Math.round(Math.cos(ang) * WALK), hz = Math.round(Math.sin(ang) * WALK);
    for (const [a, h] of [[0, hx], [2, hz]]){
      const m = moveAxis(W, P.pos, P.size, i, a, h, log);
      if (m === h || !P.ground[i]) continue;
      for (let s = 1; s <= STEP; s++){                      // step up?
        const y0 = P.pos[3 * i + 1];
        if (sweptHits(W, P.pos, P.size, i, 1, s * ONE)) break;
        P.pos[3 * i + 1] = y0 + s * ONE;
        if (!sweptHits(W, P.pos, P.size, i, a, h - m)){
          if (log) log.push(i, 1, y0, s * ONE, s * ONE);
          moveAxis(W, P.pos, P.size, i, a, h - m, log);
          break;
        }
        P.pos[3 * i + 1] = y0;
      }
    }
    let vy = Math.max(-VTERM, P.vel[3 * i + 1] - GRAV);
    const m = moveAxis(W, P.pos, P.size, i, 1, vy, log);
    P.ground[i] = vy < 0 && m !== vy ? 1 : 0;
    P.vel[3 * i + 1] = m === vy ? vy : 0;
  }
  ROOMS = null;
}

/* ---- spawning ----------------------------------------------------------------
   Fliers start near the surface, where there's something to fly around: down
   through non-empty children at random to a 64³ node, then a random clear spot
   inside it. Walkers drop from the top of a random column, one sweep, landing
   on whatever's first: a roof, a street, a mountain, the sea. */
function spawnFliers(W, P, seed){
  const r = rng(seed), lift = Math.min(6, W.D - 1);
  for (let i = 0, tries = 0; i < P.N; tries++){
    if (tries > 200 * P.N) throw new Error(`${W.name}: no room for fliers`);
    let id = W.root, x = 0, y = 0, z = 0, k = W.D;
    while (k > lift && id >= FIRST_NODE){
      const opts = [];
      for (let o = 0; o < 8; o++) if (W.store.child(id, o) !== EMPTY) opts.push(o);
      const o = opts.length ? opts[Math.floor(r() * opts.length)] : Math.floor(r() * 8);
      id = opts.length ? W.store.child(id, o) : EMPTY;
      x = 2 * x + (o & 1); y = 2 * y + (o >> 1 & 1); z = 2 * z + (o >> 2); k--;
      if (id === EMPTY || id === FULL) break;
    }
    const s = 2 ** k, at = [x * s, y * s, z * s].map(v => (v + Math.floor(r() * s)) * ONE + Math.floor(r() * ONE));
    for (let a = 0; a < 3; a++) P.pos[3 * i + a] = at[a];
    if (sweptHits(W, P.pos, P.size, i, 0, 0)) continue;
    P.home.set(at, 3 * i); i++;
  }
}
function spawnWalkers(W, P, seed, log = null){
  const r = rng(seed);
  for (let i = 0, tries = 0; i < P.N; tries++){
    if (tries > 200 * P.N) throw new Error(`${W.name}: no room for walkers`);
    P.pos[3 * i] = Math.floor(r() * (W.side - P.size[0]) * ONE);
    P.pos[3 * i + 2] = Math.floor(r() * (W.side - P.size[2]) * ONE);
    P.pos[3 * i + 1] = (W.side - P.size[1]) * ONE;
    if (sweptHits(W, P.pos, P.size, i, 0, 0)) continue;           // a solid top
    const want = -P.pos[3 * i + 1];
    moveAxis(W, P.pos, P.size, i, 1, want, log);
    P.ground[i] = 1;
    P.home.set(P.pos.subarray(3 * i, 3 * i + 3), 3 * i); i++;
  }
}

/* ---- the dense twin -------------------------------------------------------- */
function makeDense(W){
  const n = W.side, n1 = n + 1, S = new Int32Array(n1 * n1 * n1), at = (x, y, z) => (z * n1 + y) * n1 + x;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    S[at(x + 1, y + 1, z + 1)] = W.store.query(W.root, W.D, x, y, z)
      + S[at(x, y + 1, z + 1)] + S[at(x + 1, y, z + 1)] + S[at(x + 1, y + 1, z)]
      - S[at(x, y, z + 1)] - S[at(x, y + 1, z)] - S[at(x + 1, y, z)] + S[at(x, y, z)];
  return { ...W, dense: { S, at } };
}
function denseHits(W, lo, hi){
  const { S, at } = W.dense;
  for (let a = 0; a < 3; a++) if (lo[a] < 0 || hi[a] > W.side) return true;
  if (lo[0] >= hi[0] || lo[1] >= hi[1] || lo[2] >= hi[2]) return false;
  const [x0, y0, z0] = lo, [x1, y1, z1] = hi;
  return S[at(x1, y1, z1)] - S[at(x0, y1, z1)] - S[at(x1, y0, z1)] - S[at(x1, y1, z0)]
       + S[at(x0, y0, z1)] + S[at(x0, y1, z0)] + S[at(x1, y0, z0)] - S[at(x0, y0, z0)] > 0;
}
/* Every logged move, replayed against the dense twin: the swept box was clear,
   and when the move was cut short, one more 1/256 would have hit. */
function checkMoves(D, P, log, what){
  const pos = new Int32Array(3 * P.N);
  for (let r = 0; r < log.length; r += 5){
    const [i, a, from, m, want] = log.slice(r, r + 5);
    if (r === 0 || log[r - 5] !== i) for (let b = 0; b < 3; b++) pos[3 * i + b] = P.trace.get(i)?.[b] ?? pos[3 * i + b];
    pos[3 * i + a] = from;
    if (sweptHits(D, pos, P.size, i, a, m)) throw new Error(`${what}: actor ${i} moved through rock`);
    if (m !== want && !sweptHits(D, pos, P.size, i, a, m + Math.sign(want))) throw new Error(`${what}: actor ${i} stopped short`);
    pos[3 * i + a] = from + m;
    P.trace.set(i, [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]]);
  }
}

/* ---- a. the oracle -------------------------------------------------------- */
function oracleRun(Wd, kind, N, T, order, mut = '', rooms = false){
  MUT = mut; USE_ROOMS = rooms;
  const P = createPop(N, kind === 'fly' ? [4, 4, 4] : [4, 8, 4]), log = [];
  try {
    P.trace = new Map();
    if (kind === 'fly') spawnFliers(Wd, P, 99);
    else {
      // The drop from the top is a move too: one sweep the height of the world.
      spawnWalkers(Wd, P, 99, log);
      MUT = '';
      for (let i = 0; i < N; i++) P.trace.set(i, [P.pos[3 * i], (Wd.side - P.size[1]) * ONE, P.pos[3 * i + 2]]);
      checkMoves(Wd, P, log, `${Wd.name} spawn`);
      MUT = mut;
    }
    const tick = kind === 'fly' ? flierTick : walkerTick;
    for (let t = 0; t < T; t++){
      log.length = 0;
      for (let i = 0; i < N; i++) P.trace.set(i, [P.pos[3 * i], P.pos[3 * i + 1], P.pos[3 * i + 2]]);
      tick(Wd, P, t, order(t), log);
      MUT = '';
      checkMoves(Wd, P, log, `${Wd.name} ${kind} t=${t}`);
      for (let i = 0; i < N; i++){
        for (let b = 0; b < 3; b++) if (P.trace.get(i)[b] !== P.pos[3 * i + b]) throw new Error(`${Wd.name}: actor ${i}'s log doesn't add up`);
        if (sweptHits(Wd, P.pos, P.size, i, 0, 0)) throw new Error(`${Wd.name}: actor ${i} at rest in rock`);
      }
      MUT = mut;
    }
  } finally { MUT = ''; USE_ROOMS = false; }
  return P;
}
function sectionA(){
  say('\n## a. The oracle (D = 8, against a dense grid)\n');
  const worlds = [kitWorld(8), caveWorld(8, 48), shapeWorld('hills', 8), clayWorld(8, 64)].map(finish).map(w => ({ ...w, seed: 7 }));
  const N = quick ? 40 : 120, T = quick ? 60 : 200;
  const ident = n => () => Array.from({ length: n }, (_, i) => i);
  const shuffled = n => t => { const a = ident(n)(), r = rng(1000 + t); for (let i = n - 1; i > 0; i--){ const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (const W of worlds){
    const Wd = makeDense(W);
    for (const kind of ['fly', 'walk']){
      const P1 = oracleRun(Wd, kind, N, T, ident(N)), P2 = oracleRun(Wd, kind, N, T, shuffled(N));
      if (hashState(P1) !== hashState(P2)) throw new Error(`${W.name} ${kind}: shuffled order changed the bytes`);
      const R1 = oracleRun(Wd, kind, N, T, ident(N), '', true), R2 = oracleRun(Wd, kind, N, T, shuffled(N), '', true);
      if (hashState(R1) !== hashState(P1) || hashState(R2) !== hashState(P1)) throw new Error(`${W.name} ${kind}: the room cache changed the bytes`);
      // The DAG's walk gives the same bytes as the dense twin's.
      const P3 = createPop(N, P1.size);
      (kind === 'fly' ? spawnFliers : spawnWalkers)(W, P3, 99);
      for (let t = 0; t < T; t++) (kind === 'fly' ? flierTick : walkerTick)(W, P3, t, ident(N)());
      if (hashState(P3) !== hashState(P1)) throw new Error(`${W.name} ${kind}: the DAG and the dense grid disagree`);
    }
    // The grid's pushes against the brute force's.
    const P = createPop(2000, [4, 4, 4]);           // crowded, so pairs straddle cells
    spawnFliers(W, P, 5); P.old.set(P.pos);
    const g = buildGrid(P), a = [0, 0, 0], b = [0, 0, 0];
    let pushed = 0;
    for (let i = 0; i < P.N; i++){
      pushOf(P, g, i, a); pushOf(P, null, i, b);
      if (a.join() !== b.join()) throw new Error(`${W.name}: grid push ≠ brute force at ${i}`);
      if (a[0] || a[1] || a[2]) pushed++;
    }
    say(`- ${W.name}: ${N} fliers and ${N} walkers, ${T} ticks, every move held to the dense grid; shuffled = in order = rooms on = the DAG's bytes; grid pushes = brute force (${pushed} of ${P.N} pushed)`);
  }
  // The mutants. Each must be caught by something above.
  const W = makeDense(worlds[0]), Wc = makeDense(worlds[1]);
  const caught = (name, f) => { try { f(); } catch (e) { say(`- mutant ${name}: caught (${e.message.split(':').slice(-1)[0].trim()})`); return; } throw new Error(`mutant ${name} survived`); };
  caught('hi (cover one voxel too many)', () => oracleRun(W, 'fly', N, T, ident(N), 'hi'));
  caught('top (bisection keeps the hit)', () => oracleRun(W, 'walk', N, T, ident(N), 'top'));
  caught('dest (test only where it ends)', () => { for (const w of [W, Wc]) oracleRun(w, 'walk', N, T, ident(N), 'dest'); });
  caught('order (read this tick\'s positions)', () => {
    MUT = 'order'; const n = 4 * N, P1 = createPop(n, [4, 4, 4]), P2 = createPop(n, [4, 4, 4]);
    spawnFliers(W, P1, 3); spawnFliers(W, P2, 3);
    for (let t = 0; t < T; t++){ flierTick(W, P1, t, ident(n)()); flierTick(W, P2, t, shuffled(n)(t)); }
    MUT = '';
    if (hashState(P1) !== hashState(P2)) throw new Error('shuffled order changed the bytes');
  });
  caught('room (skip the moving axis)', () => oracleRun(W, 'fly', N, T, ident(N), 'room', true));
  caught('grid (own cell only)', () => {
    const P = createPop(2000, [4, 4, 4]); spawnFliers(worlds[0], P, 5); P.old.set(P.pos);
    MUT = 'grid'; const g = buildGrid(P), a = [0, 0, 0], b = [0, 0, 0];
    try { for (let i = 0; i < P.N; i++){ pushOf(P, g, i, a); pushOf(P, null, i, b); if (a.join() !== b.join()) throw new Error('grid push ≠ brute force'); } }
    finally { MUT = ''; }
  });
}

/* ---- b. bodies ---------------------------------------------------------------
   An actor's body as its own small DAG, in its own store: the world isn't
   touched. Turned by the store's transform (memoized, so 24 turns of a part
   cost 24 small walks once). Overlap is a walk down the body, asking the
   world about each body node's box: an empty box ends that branch, a full body
   node in a box with anything in it is a hit. Exact, voxel against voxel. */
function bodyHits(bs, id, k, x, y, z, W){
  if (id === EMPTY) return false;
  const s = 2 ** k;
  LO[0] = x; LO[1] = y; LO[2] = z; HI[0] = x + s; HI[1] = y + s; HI[2] = z + s;
  if (!solidIn(W, LO, HI)) return false;
  if (id === FULL) return true;
  const h = s / 2;
  for (let o = 0; o < 8; o++)
    if (bodyHits(bs, bs.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h, W)) return true;
  return false;
}
// A body's voxels, turned by e about the 16³ cube's centre, as dag-core turns it.
function turnedVoxels(occ, R, e){
  const out = [];
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
    if (!occ[x + R * (y + R * z)]) continue;
    const w = applyG([2 * x + 1 - R, 2 * y + 1 - R, 2 * z + 1 - R], e);
    out.push([(w[0] + R - 1) / 2, (w[1] + R - 1) / 2, (w[2] + R - 1) / 2]);
  }
  return out;
}
function bodies(){
  const R = 16, out = [], bs = createStore();
  for (const n of PART_NAMES) out.push({ name: n, occ: partOcc(PARTS[n]) });
  for (let n = 0; n < 8; n++) out.push({ name: `ornament ${n}`, occ: ornamentOcc(n) });
  for (const b of out){
    b.voxels = b.occ.reduce((s, v) => s + v, 0);
    b.id = bs.fromDense(b.occ, R).root;
    b.turns = PROPER.map(e => bs.transform(b.id, e));
  }
  return { bs, list: out, R };
}
function boundsOf(vox){
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const v of vox) for (let a = 0; a < 3; a++){ lo[a] = Math.min(lo[a], v[a]); hi[a] = Math.max(hi[a], v[a] + 1); }
  return { lo, hi };
}
function sectionB(){
  say('\n## b. Bodies: a 16³ DAG against the world, voxel against voxel\n');
  const { bs, list, R } = bodies();
  // The oracle: every body, every turn, at offsets near the surface of a D = 8 kit and caves.
  for (const W of [kitWorld(8), caveWorld(8, 48)].map(finish)){
    const Wd = makeDense(W), r = rng(17);
    let n = 0, hits = 0;
    for (const b of list) for (let t = 0; t < 24; t++){
      const vox = turnedVoxels(b.occ, R, PROPER[t]);
      for (let s = 0; s < 6; s++){
        const x = Math.floor(r() * (W.side - R)), y = Math.floor(r() * (W.side - R)), z = Math.floor(r() * (W.side - R));
        let want = false;
        for (const v of vox){ LO[0] = x + v[0]; LO[1] = y + v[1]; LO[2] = z + v[2]; HI[0] = LO[0] + 1; HI[1] = LO[1] + 1; HI[2] = LO[2] + 1; if (denseHits(Wd, LO, HI)){ want = true; break; } }
        const got = bodyHits(bs, b.turns[t], 4, x, y, z, W);
        if (got !== want) throw new Error(`bodyHits wrong: ${b.name} turn ${t} at ${x},${y},${z} on ${W.name}`);
        n++; if (want) hits++;
      }
    }
    say(`- ${W.name}: bodyHits = a dense voxel-by-voxel test on ${n} placements (${list.length} bodies × 24 turns, ${hits} touching)`);
  }
  // Cost and how often the bounding box lies, on the real worlds.
  const worlds = realWorlds().filter(w => !w.name.startsWith('hills'));
  say('\n| world | body | voxels | box says hit | body says hit | box lies | box µs | body µs | per voxel µs |');
  say('|---|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const W0 of worlds){
    const W = W0;
    const places = nearSurface(W, quick ? 2000 : 6000, 23, R);
    for (const b of list.filter(b => ['frame', 'shell', 'post', 'window', 'ornament 0', 'ornament 3'].includes(b.name))){
      let boxHit = 0, bodyHit = 0, tb = 0, tB = 0, tv = 0;
      const turns = b.turns.map((id, t) => ({ id, vox: turnedVoxels(b.occ, R, PROPER[t]) })).map(o => ({ ...o, ...boundsOf(o.vox) }));
      for (let p = 0; p < places.length; p += 3){
        const T = turns[p / 3 % 24], x = places[p], y = places[p + 1], z = places[p + 2];
        let t0 = now();
        for (let a = 0; a < 3; a++){ LO[a] = [x, y, z][a] + T.lo[a]; HI[a] = [x, y, z][a] + T.hi[a]; }
        const bh = solidIn(W, LO, HI); tb += now() - t0;
        t0 = now(); const bd = bodyHits(bs, T.id, 4, x, y, z, W); tB += now() - t0;
        if (p < 600){
          t0 = now();
          let vv = false;
          for (const v of T.vox){ if (W.store.query(W.root, W.D, x + v[0], y + v[1], z + v[2])){ vv = true; break; } }
          tv += now() - t0;
          if (vv !== bd) throw new Error('per-voxel ≠ bodyHits');
        }
        boxHit += bh; bodyHit += bd;
      }
      const n = places.length / 3, nv = Math.min(200, n);
      row([W.name, b.name, b.voxels, boxHit, bodyHit, `${fmt(100 * (boxHit - bodyHit) / Math.max(1, boxHit), 0)}%`,
           fmt(1000 * tb / n), fmt(1000 * tB / n), fmt(1000 * tv / nv)]);
    }
  }
}
// Places where a 16³ body's box straddles the surface: a random descent to a
// non-empty 32³ node, then a random corner within it.
function nearSurface(W, n, seed, R){
  const r = rng(seed), out = [];
  while (out.length < 3 * n){
    let id = W.root, x = 0, y = 0, z = 0, k = W.D;
    while (k > 5 && id >= FIRST_NODE){
      const opts = [];
      for (let o = 0; o < 8; o++) if (W.store.child(id, o) !== EMPTY) opts.push(o);
      const o = opts[Math.floor(r() * opts.length)];
      id = W.store.child(id, o); x = 2 * x + (o & 1); y = 2 * y + (o >> 1 & 1); z = 2 * z + (o >> 2); k--;
    }
    const s = 2 ** k, c = v => Math.max(0, Math.min(W.side - R, v));
    if (id === FULL) continue;                                   // buried: not a surface
    out.push(c(x * s + Math.floor(r() * s) - R / 2), c(y * s + Math.floor(r() * s) - R / 2), c(z * s + Math.floor(r() * s) - R / 2));
  }
  return out;
}

/* ---- c. fliers on the real worlds --------------------------------------- */
let bigWorlds = null;
function realWorlds(){
  if (bigWorlds) return bigWorlds;
  const t0 = now();
  bigWorlds = (quick ? [kitWorld(12), caveWorld(10), shapeWorld('hills', 10), clayWorld(16, 256)]
                     : [kitWorld(14), caveWorld(12), shapeWorld('hills', 12), clayWorld(20, 256)]).map(finish).map(w => ({ ...w, seed: 11 }));
  say(`\n(worlds built in ${fmt((now() - t0) / 1000, 1)} s)`);
  return bigWorlds;
}
function sectionC(){
  say('\n## c. Fliers (4³ voxels, up to 1.5 voxels a tick on each axis)\n');
  const Ns = quick ? [1, 100, 1000] : [1, 10, 100, 1000, 10000];
  say('| world | N | ticks | µs an actor | probes an actor | with rooms: µs | probes | room finds | grid share | hits a tick | in 8 ms |');
  say('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const W of realWorlds()){
    for (const N of Ns){
      const order = Array.from({ length: N }, (_, i) => i), T = Math.max(20, Math.min(400, Math.floor(200000 / N)));
      const run = rooms => {
        const P = createPop(N, [4, 4, 4]); spawnFliers(W, P, 31);
        USE_ROOMS = rooms;
        for (let t = 0; t < 10; t++) flierTick(W, P, t, order);      // warm
        const log = [];
        probes = roomFinds = 0;
        const t0 = now();
        for (let t = 10; t < 10 + T; t++){ log.length = 0; flierTick(W, P, t, order, log); }
        const ms = (now() - t0) / T;
        USE_ROOMS = false;
        let hits = 0;
        for (let r = 0; r < log.length; r += 5) if (log[r + 3] !== log[r + 4]) hits++;
        return { P, ms, pr: probes / T / N, finds: roomFinds / T / N, hits: hits / T };
      };
      const off = run(false), on = run(true);
      if (hashState(off.P) !== hashState(on.P)) throw new Error(`${W.name}: rooms changed the bytes`);
      let t0 = now(); for (let t = 0; t < 20; t++){ on.P.old.set(on.P.pos); buildGrid(on.P); }
      const gms = (now() - t0) / 20;
      row([W.name, N, T, fmt(1000 * off.ms / N, 2), fmt(off.pr, 1), fmt(1000 * on.ms / N, 2), fmt(on.pr, 2), fmt(on.finds, 2),
           `${fmt(100 * gms / on.ms, 0)}%`, fmt(on.hits, 1), fmt(N * 8 / on.ms, 0)]);
    }
  }
  // Order doesn't matter on the real worlds either.
  const W = realWorlds()[0], N = 1000, a = createPop(N, [4, 4, 4]), b = createPop(N, [4, 4, 4]);
  spawnFliers(W, a, 2); spawnFliers(W, b, 2);
  const fwd = Array.from({ length: N }, (_, i) => i), rev = [...fwd].reverse();
  for (let t = 0; t < 100; t++){ flierTick(W, a, t, fwd); flierTick(W, b, t, rev); }
  if (hashState(a) !== hashState(b)) throw new Error('order matters on the real kit');
  say(`\n- ${W.name}: 1,000 fliers for 100 ticks, forwards and backwards: the same bytes (${hashState(a).toString(16)})`);
}

/* ---- d. walkers ------------------------------------------------------------ */
function sectionD(){
  say('\n## d. Walkers (4×8×4 voxels, gravity, step up to 4, 1.5 voxels a tick)\n');
  const N = quick ? 300 : 1000, T = quick ? 300 : 600;
  say('| world | N | spawn µs | µs an actor | with rooms | probes an actor | on ground | moved < 8 in last 120 | median from home | max | low (y < 1/8 side) | on sea | on pool |');
  say('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const W of realWorlds()){
    const order = Array.from({ length: N }, (_, i) => i);
    let sp = 0;
    const run = rooms => {
      const P = createPop(N, [4, 8, 4]);
      let t0 = now(); spawnWalkers(W, P, 41); sp = (now() - t0) / N;
      USE_ROOMS = rooms; probes = 0;
      let ms = 0;
      for (let t = 0; t < T; t++){
        if (t === T - 120) P.seen.set(P.pos);
        t0 = now(); walkerTick(W, P, t, order); ms += now() - t0;
      }
      USE_ROOMS = false;
      return { P, ms: ms / T, pr: probes / T / N };
    };
    const off = run(false), on = run(true), P = on.P, ms = off.ms;
    if (hashState(off.P) !== hashState(on.P)) throw new Error(`${W.name}: rooms changed the walkers' bytes`);
    let ground = 0, stuck = 0, low = 0, sea = 0, pool = 0;
    const far = [];
    for (let i = 0; i < N; i++){
      ground += P.ground[i];
      const d = (a, b) => Math.hypot((a[3 * i] - b[3 * i]) / ONE, (a[3 * i + 2] - b[3 * i + 2]) / ONE);
      if (d(P.pos, P.seen) < 8) stuck++;
      far.push(d(P.pos, P.home));
      if (P.pos[3 * i + 1] / ONE < W.side / 8) low++;
      if (W.plan && P.ground[i]){
        const x = (P.pos[3 * i] >> FR) + 2, y = (P.pos[3 * i + 1] >> FR) - 1, z = (P.pos[3 * i + 2] >> FR) + 2;
        const k = voxelKind(W.plan, x, y, z);
        if (k === 'sea') sea++; else if (k === 'pool') pool++;
      }
    }
    const pc = v => `${fmt(100 * v / N, 0)}%`;
    row([W.name, N, fmt(1000 * sp, 0), fmt(1000 * ms / N, 2), fmt(1000 * on.ms / N, 2), fmt(on.pr, 2), pc(ground), pc(stuck), fmt(median(far), 0),
         fmt(far.reduce((a, b) => Math.max(a, b), 0), 0), pc(low), W.plan ? pc(sea) : '-', W.plan ? pc(pool) : '-']);
  }
}

/* ---- e. sight and drawing --------------------------------------------------- */
function sectionE(){
  say('\n## e. Sight (pick between fliers) and drawing (a body\'s records)\n');
  say('| world | rays | reach | visible | µs a ray | nodes visited |');
  say('|---|---:|---:|---:|---:|---:|');
  for (const W of realWorlds()){
    const N = 2000, P = createPop(N, [4, 4, 4]); spawnFliers(W, P, 51);
    const r = rng(53), stats = {};
    for (const within of [64, 512]){
      let vis = 0, n = 0, ms = 0, visited = 0;
      // From a flier's centre to a random point of air within reach: "can I see that?"
      for (let tries = 0; n < 2000 && tries < 400000; tries++){
        const i = Math.floor(r() * N), o = [0, 1, 2].map(a => P.pos[3 * i + a] / ONE + 2);
        let d = [r() - 0.5, r() - 0.5, r() - 0.5];
        const len = Math.hypot(...d), want = within * Math.cbrt(r());
        d = d.map(v => v / len * want);
        const q = o.map((v, a) => Math.floor(v + d[a]));
        if (len === 0 || q.some(v => v < 0 || v >= W.side) || W.store.query(W.root, W.D, ...q)) continue;
        const t0 = now(); const hit = pick(W.store, W.root, W.D, o, d, { tMax: 1, stats }); ms += now() - t0;
        n++; visited += stats.visited; if (!hit) vis++;
      }
      row([W.name, n, within, `${fmt(100 * vis / Math.max(1, n), 0)}%`, fmt(1000 * ms / Math.max(1, n), 2), fmt(visited / Math.max(1, n), 0)]);
    }
  }
  // A body drawn: its records, made once for all actors of its type, whatever the turn.
  const { bs, list } = bodies();
  say('\n| body | voxels | records | bytes | records over 24 turns |');
  say('|---|---:|---:|---:|---|');
  for (const b of list){
    const counts = new Set();
    let first = 0;
    for (const id of b.turns){
      const z = new Uint32Array(8);
      z[7] = id; const l5 = bs.intern(5, z); z[7] = 0; z[0] = l5; const l6 = bs.intern(6, z);   // at 16, off the chunk's edge
      const c = expandChunk(bs, l6, 6, { lod: 0 }).count;
      counts.add(c); first ||= c;
    }
    row([b.name, b.voxels, first, 4 * first, counts.size === 1 ? 'all equal' : [...counts].join(', ')]);
  }
}

if (only.includes('a')) sectionA();
if (only.includes('b')) sectionB();
if (only.includes('c')) sectionC();
if (only.includes('d')) sectionD();
if (only.includes('e')) sectionE();
