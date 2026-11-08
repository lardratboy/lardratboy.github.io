/* ================== BODY CORE (pure) =================================
   Actors' bodies: step 3 of docs/actors.md §9, built in docs/actors-log.md
   step 3. A body is a little block-showroom specimen, R = 3 to 11 (§10, Q2
   and Q3), turned by one of the 24 rotations, drawn as cubes from records
   expandChunk made once per body.

   What this file decides, so the page and the tests can't disagree:

     the library   body k is the first recipe of its own run that makes a
                   good body at R = 3 + k % 9 (bodyOf): one fixed set, built
                   lazily, for every world and seed
     a good body   fills its R on every axis and is one piece (goodBody).
                   Measured on 400 recipes at each R: only 8–26% pass. The
                   rest are scattered dust or a thin slab; at R = 3 the
                   median specimen is 3 voxels. So "R" means the body's size
                   on all three axes, and the actor's box is R³ in every turn
     the turn      PROPER from scatter-core: e < 48 with determinant +1, as
                   a map on points of the R³ box (turnMap): the same map
                   rotateOcc applies to voxels, so the test can hold one to
                   the other
     the draw      records and attribute words from expandChunk at lod 0, the
                   body padded into a 16³ world (bodyRecords). The shader
                   turns each cube about the box: one buffer for all 24 turns
                   (actors.md §6: the count of shown faces is the same in
                   every turn, because the faces turn with the body)
     the colour    the scatter world's gamut in the body's own frame,
                   lifted off black, so a body keeps its colours as it turns
     an actor      which body and which turn slot i gets: hashes of
                   (seed, i), like everything else about an actor (actorBody)

   Collision stays the box's (actors.md §6: the box moves the actor, the
   body answers questions that need voxels, and none is asked yet). Turns
   are fixed at spawn: an actor that turned in flight would change its box
   and need a check that the new one fits, which is a behaviour, step 4.

   Pure: imports the cores it composes, and holds a cache of the bodies
   it's built (one store for all of them). */
import { createStore } from './dag-core.js';
import { expandChunk } from './chunk-core.js';
import { createSpecimenCore, sampleRecipe } from './specimen-core.js';
import { stackOf } from './lattice-core.js';
import { PROPER } from './scatter-core.js';
import { attrOf8 } from './attr-core.js';
import { mix } from './actor-core.js';

export const BODY_R = Object.freeze([3, 11]);
export const BODY_TYPES = 64;              // the library's size: 7 bodies at each R, 8 at R = 3
export const BODY_SIDE = 16, BODY_D = 4;   // the padded world each body is expanded in
export const TURNS = PROPER;               // the 24 rotations, as Oh element ids
const RUN = 4096;                          // recipes tried per body, at most (the worst pass rate, 8%, needs ~12)
const BODY_BASE = 0x40000000;              // body k's run starts at BODY_BASE + k·RUN: clear of the lattice's and scatter's recipes

/* ---- a good body ------------------------------------------------------- */
// The tight box of occ (R³, x fastest), or null if it's empty.
export function tightBox(occ, R){
  const lo = [R, R, R], hi = [0, 0, 0];
  for (let z = 0, i = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++, i++){
    if (!occ[i]) continue;
    if (x < lo[0]) lo[0] = x; if (y < lo[1]) lo[1] = y; if (z < lo[2]) lo[2] = z;
    if (x >= hi[0]) hi[0] = x + 1; if (y >= hi[1]) hi[1] = y + 1; if (z >= hi[2]) hi[2] = z + 1;
  }
  return hi[0] ? { lo, hi } : null;
}
// How many pieces occ is in, counting voxels that share a face, an edge or a corner as one.
export function piecesOf(occ, R){
  const seen = new Uint8Array(R * R * R), stack = [];
  let n = 0;
  for (let s = 0; s < occ.length; s++){
    if (!occ[s] || seen[s]) continue;
    n++; seen[s] = 1; stack.push(s);
    while (stack.length){
      const c = stack.pop(), x = c % R, y = Math.floor(c / R) % R, z = Math.floor(c / (R * R));
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++){
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= R || Y >= R || Z >= R) continue;
        const j = X + R * (Y + R * Z);
        if (occ[j] && !seen[j]){ seen[j] = 1; stack.push(j); }
      }
    }
  }
  return n;
}
export function goodBody(occ, R){
  const b = tightBox(occ, R);
  return !!b && b.lo.every(v => v === 0) && b.hi.every(v => v === R) && piecesOf(occ, R) === 1;
}

/* ---- the library -------------------------------------------------------- */
let specimens = null;
const cache = new Map();
/* Body k: R = 3 + k % 9, so every R has its share, and the first recipe of
   the run BODY_BASE + k·RUN that makes a good body. Deterministic, and the
   same for every world and seed: the seed picks which bodies actors get,
   not what the bodies are (like the kit's ornament library). */
export function bodyOf(k){
  if (!(Number.isInteger(k) && k >= 0 && k < BODY_TYPES)) throw new RangeError(`body ${k} is outside 0…${BODY_TYPES - 1}`);
  if (cache.has(k)) return cache.get(k);
  specimens ||= createSpecimenCore();
  const R = BODY_R[0] + k % (BODY_R[1] - BODY_R[0] + 1), levels = stackOf(R);
  for (let j = 0; j < RUN; j++){
    const n = BODY_BASE + k * RUN + j, r = sampleRecipe(specimens, n, levels), b = specimens.buildBlock(r.P, r.levels);
    if (b.R !== R) throw new Error(`body ${k}: recipe ${n} built R = ${b.R}, not ${R}`);
    if (!goodBody(b.occ, R)) continue;
    const body = makeBody(b.occ, R, { k, recipe: n });
    cache.set(k, body);
    return body;
  }
  throw new Error(`body ${k}: no good body in ${RUN} recipes at R = ${R}`);
}
/* Any occupancy as a body: the library's, and the page's test bodies (a solid
   cube for the near plane's check, a lopsided one for the turns'). */
export function makeBody(occ, R, extra = {}){
  if (!(R >= 1 && R <= BODY_SIDE) || occ.length !== R * R * R) throw new RangeError(`a body is R³ with R in 1…${BODY_SIDE}`);
  let voxels = 0;
  for (let i = 0; i < occ.length; i++) voxels += occ[i] ? 1 : 0;
  return { R, occ, voxels, box: tightBox(occ, R), records: null, attrs: null, ...extra };
}

/* ---- turns ----------------------------------------------------------------
   Oh element e as a map on points of the box [0, R]³, w = M·x + o: axis i of
   the result is axis P[i] of the point, flipped (R − x) when bit i of e is
   set. That's rotateOcc's map on voxel corners (scatter-core), so voxel v
   lands where rotateOcc puts it; the test holds them together. M is row
   major here; the page hands GL its transpose. */
const PERM = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
export function turnMap(e, R){
  const P = PERM[e >> 3], M = new Array(9).fill(0), o = [0, 0, 0];
  for (let i = 0; i < 3; i++){
    const flip = e >> i & 1;
    M[3 * i + P[i]] = flip ? -1 : 1;
    o[i] = flip ? R : 0;
  }
  return { M, o };
}
export const applyTurn = ({ M, o }, x) => [0, 1, 2].map(i => M[3 * i] * x[0] + M[3 * i + 1] * x[1] + M[3 * i + 2] * x[2] + o[i]);
/* The body's tight box after turn e, as the actor's box: its low corner in
   the turned R³ box (where the actor's own low corner sits) and its size.
   A box maps to a box, so it's the turned corners' min and max. */
export function turnedBox(body, e){
  const T = turnMap(e, body.R), a = applyTurn(T, body.box.lo), b = applyTurn(T, body.box.hi);
  const lo = [0, 1, 2].map(i => Math.min(a[i], b[i])), hi = [0, 1, 2].map(i => Math.max(a[i], b[i]));
  return { lo, size: [0, 1, 2].map(i => hi[i] - lo[i]) };
}

/* ---- the draw --------------------------------------------------------------
   The body padded into a 16³ world at the origin, expanded at lod 0: a world
   smaller than a chunk, so every apron is EMPTY and a face shows wherever
   the body's own neighbour is empty. The records' cells are the voxels; the
   shader turns each cube about the box, so one buffer holds every turn.
   ~0.06 ms a body. */
// expandChunk asks at voxel centres (x + 0.5), so the field floors them.
export const bodyColour = R => (x, y, z) => {
  const c = v => Math.round(48 + 207 * Math.floor(v) / Math.max(1, R - 1));
  return c(x) | c(y) << 8 | c(z) << 16;
};
export function bodyRecords(body){
  if (body.records) return body;
  const { R, occ } = body, S = BODY_SIDE, pad = new Uint8Array(S * S * S);
  for (let z = 0, i = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++, i++) pad[x + S * (y + S * z)] = occ[i];
  const store = createStore(), { root } = store.fromDense(pad, S);
  const e = expandChunk(store, root, BODY_D, { lod: 0 }, { colour: bodyColour(R) });
  body.records = e.records.slice(0, e.count);
  body.attrs = e.attrs.slice(0, e.count);
  body.quads = e.quads;
  return body;
}
// The word a voxel's record carries: attr-core's packing of bodyColour.
export const bodyWord = (R, x, y, z) => { const c = bodyColour(R)(x + 0.5, y + 0.5, z + 0.5); return attrOf8(c & 255, c >> 8 & 255, c >> 16 & 255); };

/* ---- an actor's body ---------------------------------------------------------
   Slot i's body and turn, from hashes of (seed, i): order-free, and the page
   and its twin (actorSelftest) get the same ones. `size` is the actor's box,
   which the core moves; `off` is the turned box's low corner inside the
   turned R³ box, which the draw takes off the actor's position. */
export function actorBody(seed, i){
  const k = mix(seed, i, 79) % BODY_TYPES, e = TURNS[mix(seed, i, 80) % TURNS.length], body = bodyOf(k), t = turnedBox(body, e);
  return { k, e, body, size: t.size, off: t.lo };
}
