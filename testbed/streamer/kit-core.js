/* ================== KIT CORE (pure) ===================================
   The kit world (docs/kit-plan.md): nested 4³ assemblies of a small
   library of parts, built straight into one DAG. The sketch
   (experiments/kit-sketch.mjs) showed what it costs and what it looks
   like; this is the world itself, with a descriptor, a colour field, a
   ground and tests. Pure: imports dag-core.js, specimen-core.js (the
   hash), lattice-core.js (block-showroom's specimens at R = 16, the
   ornaments) and scatter-core.js (the 24 rotations and their inverse).

   A world is a descriptor, kitDesc({ seed, D, libs, ornaments, ground,
   colourLevel }), and everything follows from it:
   - LEVEL 0 is a library of 16³ parts: the eight structural ones of the
     sketch (block, slab, beam, post, frame, shell, window, step), then
     `ornaments` block-showroom specimens (0 to 16; plan decision 2);
   - each LEVEL l ≥ 1 is a library of libs[l − 1] assemblies (the top
     level has one, the world). An assembly is a 4³ grid of slots; a
     mask picks which are filled, and each filled slot holds an entry of
     the library below, turned. So an entry of level l is 16·4^l on a
     side, and the world is D = 4 + 2L for L levels: 4,096³ at L = 4,
     16,384³ at 5, 65,536³ at 6 (decision 7: 14 by default);
   - every choice (an entry's mask, each slot's child and turn) is a hash
     of (seed, level, entry), made in kitPlan. The plan is a few typed
     arrays and needs no DAG, so the colour field rebuilds it in each
     chunk worker from the descriptor (colours are named, not shipped);
   - the DAG (buildKit) is the plan composed bottom-up: a 4³ grid of
     level-k ids is two binary levels, 8 interns and then 1, and a turned
     entry is store.transform (memoized), so there is no graft and no
     union. Then pruned: entries no one picked are dropped.

   The masks by level (decision 3): level 1 picks among the detailed ones
   (frame, cross, arches, pillars, slabs), level 2 the tall ones (tower,
   pillars, frame, arches), higher levels the open ones (frame, pillars,
   cross), so there's room to fly in.

   The ground and gravity (decision 4; asked for 2026-11-03, on by
   default). Some entries of every level are GROUNDED: their mask has
   the whole bottom layer (y = 0) filled, and each bottom slot holds a
   grounded entry of the level below, turned only about y. Level 0's
   grounded parts are the block, the slab and the step, all solid for
   y < 4. So grounded entries nest down to a plate: a grounded world is
   solid for its bottom 4 voxels, edge to edge, and what stands on it
   stands on floors at every scale. The top level is grounded (pillars,
   a court or a skyline), half of each level's library below is, and
   the top two levels place their children upright (turns about y
   only), so the large structure stands up. Below that, slots other
   than floors keep all 24 turns: that is where the Oh classes fold the
   copies back (kit-plan.md §1: 326 classes for 6,273 nodes).

   The colour (decision 6): the gamut of a point's position in the frame
   of the level-`colourLevel` entry it lies in (default 2, the 256³
   assemblies), turned with it, so a turned copy shows the same colours
   turned, and a repeat shows as a repeated colour. kitColour walks the
   plan from the top: the slot the point is in, the point moved into
   that child's frame and turned back (scatter-core's unturn), and down.
   ===================================================================== */
import { createStore, pruneWorld, EMPTY } from './dag-core.js';
import { hash32 } from './specimen-core.js';
import { buildRecipe } from './lattice-core.js';
import { PROPER } from './scatter-core.js';

export const PART = 16, PART_LEVELS = 4;
/* libs to 1,024 an entry level: the node count is bounded by about 24 ×
   (the parts' nodes + 9 a library entry), since a turned entry shares
   all its turned descendants with every other turn of them (they're
   hash-consed), so even that is ~1M nodes. `nodes` is checked as the
   build goes, measured, not estimated. */
export const KIT_LIMITS = { D: [8, 16], lib: [1, 1024], ornaments: [0, 16], seed: [1, 0xffff], nodes: 4e6 };
export const KIT_DEFAULTS = { seed: 1, D: 14, libs: null, ornaments: 4, ground: true, colourLevel: 2 };
export const levelsOf = D => (D - PART_LEVELS) / 2;
export const sideOf = l => PART * 4 ** l;
// The sketch's library sizes, bottom up (struct16's were 8, 6, 4, 3, 2).
const DEFAULT_LIBS = [8, 6, 4, 3, 2];
export const defaultLibs = L => Array.from({ length: L - 1 }, (_, i) => DEFAULT_LIBS[i] ?? 2);
const int = (v, [lo, hi], what) => {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`kit: ${what} ${v} is not an integer in ${lo}…${hi}`);
  return v;
};

/* The descriptor, filled and checked: the given fields, plus `kind` and
   L. libs has one size per level below the top; a list too short for D
   is padded with the defaults and one too long is cut, so changing D
   keeps the sizes that still apply. */
export function kitDesc(over = {}){
  const d = { ...KIT_DEFAULTS, ...over, kind: 'kit' };
  int(d.D, KIT_LIMITS.D, 'D');
  if (d.D % 2) throw new Error(`kit: D ${d.D} is odd (a kit is 16³ parts in 4³ levels, D = 4 + 2L)`);
  int(d.seed, KIT_LIMITS.seed, 'seed');
  const L = d.L = levelsOf(d.D), libs = Array.isArray(d.libs) ? d.libs.slice(0, L - 1) : [];
  for (let i = libs.length; i < L - 1; i++) libs.push(defaultLibs(L)[i]);
  libs.forEach((n, i) => int(n, KIT_LIMITS.lib, `library ${i + 1}`));
  d.libs = libs;
  int(d.ornaments, KIT_LIMITS.ornaments, 'ornaments');
  d.ground = !!d.ground;
  int(d.colourLevel, [0, L], 'colour level');
  return d;
}

const rng = (...k) => {
  let s = 0x9e3779b9;
  for (const v of k) s = hash32(s, v >>> 0) >>> 0;
  return () => (s = hash32(s, 0x85ebca6b) >>> 0) / 4294967296;
};
const pick = (r, n) => Math.min(n - 1, Math.floor(r() * n));

/* ---- the turns -------------------------------------------------------------
   PROPER, scatter-core's 24 rotations in dag-core's Oh encoding (the same
   turn as rotateOcc and store.transform), and the four of them that keep
   +y up: the turns about y, for floors and the upright levels. */
const PERM = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
export const Y_TURNS = PROPER.filter(e => PERM[e >> 3][1] === 1 && !(e & 2));

/* ---- the masks: which of an assembly's 4³ slots are filled --------------
   Slot x + 4y + 16z. The sketch's eight, and two grounded ones for the
   ground: a court (a floor, a low wall round it, a tower in the middle)
   and a skyline, a floor with a column of hashed height on each of its
   16 cells. The skyline is the only mask drawn from the entry's hash, so
   maskSlots takes the entry's rng. */
const ext = v => v === 0 || v === 3, mid = v => v === 1 || v === 2;
const cnt = (...b) => b.filter(Boolean).length;
const slotsOf = f => {
  const m = [];
  for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (f(x, y, z)) m.push(x + 4 * y + 16 * z);
  return m;
};
export const MASKS = {
  frame:   slotsOf((x, y, z) => cnt(ext(x), ext(y), ext(z)) >= 2),          // the 12 edges, 32 slots
  cross:   slotsOf((x, y, z) => cnt(mid(x), mid(y), mid(z)) >= 2),          // three bars through the middle
  pillars: slotsOf((x, y, z) => (ext(x) && ext(z)) || y === 0),             // four columns on a floor
  tower:   slotsOf((x, y, z) => (mid(x) && mid(z)) || (y === 3 && cnt(mid(x), mid(z)) >= 1)),
  slabs:   slotsOf((x, y, z) => y === 0 || (y === 3 && (ext(x) || ext(z)))),
  arches:  slotsOf((x, y, z) => y === 3 || (ext(x) && ext(z))),
  stair:   slotsOf((x, y, z) => y <= x && (!mid(z) || y === x)),
  corners: slotsOf((x, y, z) => cnt(ext(x), ext(y), ext(z)) === 3 || cnt(mid(x), mid(y), mid(z)) === 3),
  court:   slotsOf((x, y, z) => y === 0 || (y === 1 && (ext(x) || ext(z))) || (mid(x) && mid(z))),
  skyline: null,
};
// A skyline's column heights: none, none, 1, 2 or 3 slots over the floor.
function maskSlots(name, r){
  if (name !== 'skyline') return MASKS[name];
  const m = [];
  const h = Array.from({ length: 16 }, () => [0, 0, 1, 2, 3][pick(r, 5)]);
  for (let z = 0; z < 4; z++) for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (y <= h[x + 4 * z]) m.push(x + 4 * y + 16 * z);
  return m;
}
// Every grounded mask fills the whole bottom layer.
export const GROUNDED = ['pillars', 'slabs', 'court', 'skyline'];
export const FAMILIES = {
  detail: ['frame', 'cross', 'arches', 'pillars', 'slabs'],
  tall: ['tower', 'pillars', 'frame', 'arches'],
  open: ['frame', 'pillars', 'cross'],
  // Under the grounded top: nothing hangs from nothing at the top two
  // levels (no cross, no slabs' ring on air).
  standing: ['tower', 'pillars', 'arches', 'frame'],
  groundedTop: ['pillars', 'court', 'skyline'],
  floating: ['frame'],      // the sketch's top: the world a frame
};
function familyOf(l, L, ground, grounded){
  if (grounded) return l === L ? FAMILIES.groundedTop : GROUNDED;
  if (l === L) return FAMILIES.floating;
  if (ground && l === L - 1) return FAMILIES.standing;
  return l === 1 ? FAMILIES.detail : l === 2 ? FAMILIES.tall : FAMILIES.open;
}

/* ---- level 0: structural parts, 16³ -------------------------------------- */
const rim = v => v < 2 || v >= 14;
export const PARTS = {
  block:  () => true,
  slab:   (x, y) => y < 4,
  beam:   (x, y, z) => y < 4 && z >= 6 && z < 10,
  post:   (x, y, z) => x >= 5 && x < 11 && z >= 5 && z < 11,
  frame:  (x, y, z) => cnt(rim(x), rim(y), rim(z)) >= 2,
  shell:  (x, y, z) => cnt(rim(x), rim(y), rim(z)) >= 1,
  window: (x, y, z) => z < 3 && !(x % 8 >= 2 && x % 8 < 6 && y % 8 >= 2 && y % 8 < 6),
  step:   (x, y) => y < 4 * (1 + Math.floor(x / 4)),
};
export const PART_NAMES = Object.keys(PARTS);
// The parts that can be a floor: solid for y < 4 however they're turned about y.
export const GROUND_PARTS = ['block', 'slab', 'step'].map(n => PART_NAMES.indexOf(n));
export function partOcc(f){
  const o = new Uint8Array(PART ** 3);
  let i = 0;
  for (let z = 0; z < PART; z++) for (let y = 0; y < PART; y++) for (let x = 0; x < PART; x++) o[i++] = f(x, y, z) ? 1 : 0;
  return o;
}
// Ornament n: the n-th specimen of a 16³ lattice with the kit's seed.
export const ornamentOcc = (desc, n) => buildRecipe({ R: PART, seed: desc.seed, axes: 'random', n: [1, 1, 1] }, n);

/* ---- the plan --------------------------------------------------------------
   Every choice, as typed arrays, level by level. levels[l] (l ≥ 1) has
   one row of 64 slots an entry: child[64·j + s] the child's index in
   level l − 1 (−1: empty), turn[64·j + s] its Oh element; mask[j] the
   mask's name and grounded[j]. floors[l] lists the grounded entries
   (level 0: GROUND_PARTS), the children a floor slot draws from.

   The draws, in order, from rng(seed, l, j): the mask; the skyline's
   heights, if it is one; then for each filled slot in slot order, the
   child and the turn. kit-core.test.js stamps the world from this plan
   with its own placement arithmetic, so the plan is what's tested. */
export function kitPlan(desc){
  const { L, seed, ground } = desc, sizes = [PART_NAMES.length + desc.ornaments, ...desc.libs, 1];
  const floors = [GROUND_PARTS], levels = [null];
  for (let l = 1; l <= L; l++){
    const n = sizes[l], g = !ground ? 0 : l === L ? 1 : Math.ceil(n / 2);
    const child = new Int32Array(64 * n).fill(-1), turn = new Uint8Array(64 * n), mask = [], grounded = [];
    for (let j = 0; j < n; j++){
      const r = rng(seed, l, j), isG = j < g, fam = familyOf(l, L, ground, isG), name = fam[pick(r, fam.length)];
      const upright = ground && l >= L - 1;
      mask.push(name); grounded.push(isG);
      for (const s of maskSlots(name, r)){
        // The bottom layer is y = 0 at every x and z (the first version
        // also asked s < 16, the z = 0 row only, and the ground had holes).
        const floor = isG && (s >> 2 & 3) === 0;
        child[64 * j + s] = floor ? floors[l - 1][pick(r, floors[l - 1].length)] : pick(r, sizes[l - 1]);
        turn[64 * j + s] = floor || upright ? Y_TURNS[pick(r, 4)] : PROPER[pick(r, 24)];
      }
    }
    floors.push(Array.from({ length: g }, (_, j) => j));
    levels.push({ n, child, turn, mask, grounded });
  }
  return { L, sizes, floors, levels };
}

/* ---- the build ----------------------------------------------------------------
   The plan composed bottom-up into one store, then pruned. A grid of 64
   level-k ids (slot x + 4y + 16z) is one level-(k + 2) node: octant O of
   it is the 2³ slots at 2·(O's bits), and octant o of that is one slot.
   Throws past KIT_LIMITS.nodes, checked after each entry. */
export function buildKit(desc, plan = kitPlan(desc)){
  const t = {}, t0 = performance.now(), store = createStore(), { L } = plan;
  const parts = PART_NAMES.map(n => store.fromDense(partOcc(PARTS[n]), PART).root);
  for (let n = 0; n < desc.ornaments; n++) parts.push(store.fromDense(ornamentOcc(desc, n), PART).root);
  t.parts = performance.now() - t0;
  const lib = [parts], g = new Uint32Array(64), ch = new Uint32Array(8), top = new Uint32Array(8);
  const compose = k => {
    for (let O = 0; O < 8; O++){
      for (let o = 0; o < 8; o++) ch[o] = g[(2 * (O & 1) + (o & 1)) + 4 * (2 * (O >> 1 & 1) + (o >> 1 & 1)) + 16 * (2 * (O >> 2) + (o >> 2))];
      top[O] = store.intern(k + 1, ch);
    }
    return store.intern(k + 2, top);
  };
  const t1 = performance.now();
  for (let l = 1; l <= L; l++){
    const { n, child, turn } = plan.levels[l], below = lib[l - 1], out = [];
    for (let j = 0; j < n; j++){
      for (let s = 0; s < 64; s++){
        const c = child[64 * j + s];
        g[s] = c < 0 ? EMPTY : store.transform(below[c], turn[64 * j + s]);
      }
      out.push(compose(PART_LEVELS + 2 * (l - 1)));
      if (store.size > KIT_LIMITS.nodes) throw new Error(`kit: over ${KIT_LIMITS.nodes / 1e6}M nodes at level ${l} (libraries ${desc.libs.join(', ')})`);
    }
    lib.push(out);
  }
  t.compose = performance.now() - t1;
  const t2 = performance.now(), raw = store.size, { store: world, root, dropped } = pruneWorld(store, lib[L][0]);
  t.prune = performance.now() - t2;
  return { store: world, root, D: desc.D, plan, nodes: world.size, raw, dropped, ms: t, totalMs: performance.now() - t0 };
}

/* ---- colour -------------------------------------------------------------------
   The gamut of the point's position in its level-c entry's own frame,
   over that entry's side, as RGB, lifted off black (40 + 215·u: the
   sketch's previews were 50 + 205·u, and a corner at pure black reads as
   a hole under the viewer's shading). Grey where the point is in an
   empty slot: there are no voxels there, but a coarse mean can sample
   one (its weight is zero).

   The walk (frameOf) is L − c steps: the slot the point is in, the point
   moved into that child's frame and turned back (unturn's inverse,
   inlined: u[P[i]] = flip ? s − w[i] : w[i]), and down. Walked for every
   point it made colour most of a kit job: 30 ms a chunk at the D = 14
   street against 6.4 without colour (sphere: 1.4×), because the kit's
   chunks hold ~16,000 records and a coarse one's mean asks 8 points.

   So the field caches frames. Level-c entries sit on a world-aligned grid
   of their side (every slot of every level is aligned, and a turn about
   a child's centre maps its aligned cells to aligned cells), so each
   world cell of that side is one entry under one map u = uq + M·(p − q):
   q the cell's centre, uq where the walk takes it, M a signed
   permutation, read off the walks of q + x, q + y and q + z. A miss walks
   4 points; a hit is 9 multiply-adds. The cache is direct-mapped, 4,096
   cells. Every value is an integer or a half, so the map gives exactly
   the walk's answer (kit-core.test.js compares colours exactly). */
export const GAMUT_LIFT = 40, GAMUT_SPAN = 215;
const FRAME_CACHE = 4096;
export function kitColour(desc, rgb8){
  const plan = kitPlan(desc), { L } = plan, c = desc.colourLevel, grey = rgb8(128, 128, 128), world = sideOf(L);
  const PX = new Uint8Array(48 * 3), FL = new Uint8Array(48 * 3), w = [0, 0, 0], u = [0, 0, 0];
  for (let e = 0; e < 48; e++) for (let i = 0; i < 3; i++){ PX[3 * e + i] = PERM[e >> 3][i]; FL[3 * e + i] = e >> i & 1; }
  // Hoisted: plan.levels[l].child inside the walk was 141 ns a point on a
  // 64³ run of voxel centres, against the sphere field's 100; hoisted, 44.
  const CH = plan.levels.map(v => v && v.child), TU = plan.levels.map(v => v && v.turn), SIDE = plan.levels.map((_, l) => sideOf(l));
  // The point's coordinates in its level-c frame, into u; false in an empty slot.
  const frameOf = (x, y, z) => {
    let j = 0;
    for (let l = L; l > c; l--){
      // min(3, …): unturn sends a point on a face to the opposite face, s.
      const s = SIDE[l - 1], i = Math.min(3, Math.floor(x / s)), k = Math.min(3, Math.floor(y / s)), m = Math.min(3, Math.floor(z / s));
      const at = 64 * j + i + 4 * k + 16 * m, next = CH[l][at];
      if (next < 0) return false;
      w[0] = x - i * s; w[1] = y - k * s; w[2] = z - m * s;
      const e = TU[l][at];
      for (let a = 0; a < 3; a++) u[PX[3 * e + a]] = FL[3 * e + a] ? s - w[a] : w[a];
      x = u[0]; y = u[1]; z = u[2]; j = next;
    }
    u[0] = x; u[1] = y; u[2] = z;
    return true;
  };
  const S = sideOf(c), K = GAMUT_SPAN / S, cells = world / S;
  // Per cache line: the cell's key (−1 none), then uq (3) and M (9, by
  // column), or NaN in uq[0] for an empty cell.
  const KEY = new Float64Array(FRAME_CACHE).fill(-1), MAP = new Float64Array(12 * FRAME_CACHE);
  return (x, y, z) => {
    if (!(x >= 0 && y >= 0 && z >= 0 && x < world && y < world && z < world)) return grey;
    const ix = Math.floor(x / S), iy = Math.floor(y / S), iz = Math.floor(z / S), key = ix + cells * (iy + cells * iz);
    const line = (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & (FRAME_CACHE - 1), o = 12 * line;
    const qx = (ix + 0.5) * S, qy = (iy + 0.5) * S, qz = (iz + 0.5) * S;
    if (KEY[line] !== key){
      KEY[line] = key;
      if (!frameOf(qx, qy, qz)) MAP[o] = NaN;
      else {
        const u0 = u[0], u1 = u[1], u2 = u[2];
        MAP[o] = u0; MAP[o + 1] = u1; MAP[o + 2] = u2;
        for (let a = 0; a < 3; a++){
          frameOf(a === 0 ? qx + 1 : qx, a === 1 ? qy + 1 : qy, a === 2 ? qz + 1 : qz);
          MAP[o + 3 + 3 * a] = u[0] - u0; MAP[o + 4 + 3 * a] = u[1] - u1; MAP[o + 5 + 3 * a] = u[2] - u2;
        }
      }
    }
    if (MAP[o] !== MAP[o]) return grey;
    const dx = x - qx, dy = y - qy, dz = z - qz;
    const ux = MAP[o] + MAP[o + 3] * dx + MAP[o + 6] * dy + MAP[o + 9] * dz;
    const uy = MAP[o + 1] + MAP[o + 4] * dx + MAP[o + 7] * dy + MAP[o + 10] * dz;
    const uz = MAP[o + 2] + MAP[o + 5] * dx + MAP[o + 8] * dy + MAP[o + 11] * dz;
    return rgb8(GAMUT_LIFT + K * ux, GAMUT_LIFT + K * uy, GAMUT_LIFT + K * uz);
  };
}

/* ---- the permalink ------------------------------------------------------------
   ?kit=D,libs,ornaments,ground,colourLevel, libs joined by dots, bottom
   up (the seed is the world id's, kit:<seed>): ?kit=14,8.6.4.3,4,1,2 is
   the default. */
export const kitParam = d => [d.D, d.libs.join('.'), d.ornaments, d.ground ? 1 : 0, d.colourLevel].join(',');
export function kitFromParam(s, seed = 1){
  const [D, libs, orn, ground, cl] = String(s).split(',');
  return kitDesc({ seed, D: +D, libs: libs ? libs.split('.').map(Number) : null, ornaments: orn === undefined || orn === '' ? KIT_DEFAULTS.ornaments : +orn,
                   ground: ground === undefined ? KIT_DEFAULTS.ground : ground === '1', colourLevel: cl === undefined || cl === '' ? KIT_DEFAULTS.colourLevel : +cl });
}
