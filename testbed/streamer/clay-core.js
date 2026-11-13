/* CLAY — a lump to carve (docs/clay-log.md; the plan is realtimecsg.md §11).

   Three worlds with one descriptor, since each is what the others leave out:

     lump > 0, no ground     clay: a lump floating at the world's centre
     lump > 0, ground        the lump pressed onto flat ground
     lump = 0, ground        flat ground: a slab GROUND_DEPTH voxels deep under the centre plane
     lump = 0, no ground     empty: root EMPTY, nothing to draw

   You asked for "some volume to play with and sculpt down from, think clay".
   So the default is a ball, which reads as a lump where a cube reads as a
   block, in a deep world. (`shape: 'block'` is there too, and is the cheaper
   of the two by a long way.)

   **Why deep and centred, from the start.** Empty space costs nothing, since
   the cut never enters EMPTY: a D = 28 world is 16 more nodes a click than a
   D = 12 one, and the world never needs to grow (realtimecsg.md §11.4). The
   lump sits at the centre so you can build out from it in every direction.
   What stops D at 20 in the viewer's menu is the ray pass, which holds the eye
   as float32 voxels. The descriptor goes further so that limit can be measured.

   **Why the page builds it on the main thread.** It keeps a real store there,
   with an interner, which is what edit mode is going to add to. Every world
   built in workers arrives as a read-only view (realtimecsg.md §4.1). A build
   is cheap enough: see the numbers above buildClay.

   Pure: imports only dag-core.js. The colour's rgb8 is handed in, as the kit's
   and the caves' are. */
import { createStore, EMPTY } from './dag-core.js';

export const CLAY_LIMITS = { D: [8, 28], lumps: [0, 64, 128, 256, 512, 1024], shapes: ['ball', 'block'] };
export const CLAY_DEFAULTS = { D: 20, lump: 256, shape: 'ball', ground: false };

/* The ground is a slab this deep under the centre plane, with air below it
   (asked 2026-11-13: it was the whole lower half of the world, 2^19 voxels deep
   at D = 20). Every lump in CLAY_LIMITS fits in it pressed: a ball sinks r/8,
   at most 1,024/16 = 64, so its bottom cap is never below the slab. The
   smallest world (D = 8) has 128 under the plane, so the slab always fits. */
export const GROUND_DEPTH = 64;

export function clayDesc(over = {}){
  const d = { ...CLAY_DEFAULTS, ...over, kind: 'clay' };
  if (!Number.isInteger(d.D) || d.D < CLAY_LIMITS.D[0] || d.D > CLAY_LIMITS.D[1]) throw new Error(`clay: D ${d.D} is outside ${CLAY_LIMITS.D.join('…')}`);
  if (!CLAY_LIMITS.lumps.includes(d.lump)) throw new Error(`clay: lump ${d.lump} isn't one of ${CLAY_LIMITS.lumps.join(', ')}`);
  if (!CLAY_LIMITS.shapes.includes(d.shape)) throw new Error(`clay: shape '${d.shape}' isn't one of ${CLAY_LIMITS.shapes.join(', ')}`);
  // Half the world is the most that stays inside it on the ground, where
  // the lump stands on the centre plane rather than straddling it.
  if (d.lump > 2 ** (d.D - 1)) throw new Error(`clay: a lump of ${d.lump} doesn't fit a world of side ${2 ** d.D}`);
  d.ground = !!d.ground;
  return d;
}
export const clayParam = d => [d.D, d.lump, d.shape, d.ground ? 1 : 0].join(',');
export function clayFromParam(s){
  const [D, lump, shape, ground] = String(s).split(',');
  return clayDesc({ D: +D, lump: lump === undefined || lump === '' ? CLAY_DEFAULTS.lump : +lump, shape: shape || CLAY_DEFAULTS.shape,
                    ground: ground === undefined ? CLAY_DEFAULTS.ground : ground === '1' });
}

/* Where things are. The centre plane is y = c, the top of the ground, whose
   bottom is c − GROUND_DEPTH. A ball
   on the ground is pressed in by an eighth of its radius, as a lump dropped on
   a table would be: resting on one point it'd stand on a single voxel. A block
   stands on the plane exactly. Off the ground, the lump straddles the centre,
   so it has a corner of the voxel grid at its middle. */
export function clayPlace(desc){
  const c = 2 ** (desc.D - 1), s = desc.lump, r = s / 2;
  const cy = !desc.ground ? c : desc.shape === 'ball' ? c + r - r / 8 : c + r;
  return { c, r, centre: [c, cy, c], lo: [c - r, cy - r, c - r], hi: [c + r, cy + r, c + r] };
}

/* THE RULE: what's at voxel (x, y, z). 0 air, 1 clay, 2 ground. Every shortcut
   below is held to this (test/clay-core.test.js), and it's slow on purpose. A
   ball's voxel is inside when its centre i + ½ is within r of the ball's centre.
   The ground wins in its slab, so a pressed ball's bottom cap is ground. */
export function clayVoxel(desc, x, y, z){
  const { c, r, centre, lo, hi } = clayPlace(desc);
  if (desc.ground && y < c && y >= c - GROUND_DEPTH) return 2;
  if (!desc.lump) return 0;
  if (desc.shape === 'block') return x >= lo[0] && y >= lo[1] && z >= lo[2] && x < hi[0] && y < hi[1] && z < hi[2] ? 1 : 0;
  const dx = x + 0.5 - centre[0], dy = y + 0.5 - centre[1], dz = z + 0.5 - centre[2];
  return dx * dx + dy * dy + dz * dz <= r * r ? 1 : 0;
}

/* fromField's three-valued cell test: 0 no voxel of the cell is solid, 1 all of
   them are, −1 can't tell. Each half is exact on its own: the ball's squared
   distance separates by axis, so the box of voxel centres has a true nearest
   and farthest point, and a block is a box. Together they can say −1 for a cell
   that's solid only by their union. That's harmless: the walk goes down and
   hash-consing hands back solid(k)'s own id. */
export function clayCell(desc, ground = desc.ground){
  const { c, r, centre, lo, hi } = clayPlace(desc), r2 = r * r, lump = desc.lump, ball = desc.shape === 'ball', g0 = c - GROUND_DEPTH;
  const lumpCell = (s, x, y, z) => {
    if (!lump) return 0;
    if (!ball){
      const X = x * s, Y = y * s, Z = z * s;
      if (X + s <= lo[0] || Y + s <= lo[1] || Z + s <= lo[2] || X >= hi[0] || Y >= hi[1] || Z >= hi[2]) return 0;
      return X >= lo[0] && Y >= lo[1] && Z >= lo[2] && X + s <= hi[0] && Y + s <= hi[1] && Z + s <= hi[2] ? 1 : -1;
    }
    let near = 0, far = 0;
    for (let a = 0; a < 3; a++){
      const i = a === 0 ? x : a === 1 ? y : z, m = centre[a], l = i * s + 0.5, h = (i + 1) * s - 0.5;
      const d = m < l ? l - m : m > h ? m - h : 0, f = Math.max(Math.abs(m - l), Math.abs(h - m));
      near += d * d; far += f * f;
    }
    return near > r2 ? 0 : far <= r2 ? 1 : -1;
  };
  return (k, x, y, z) => {
    const s = 2 ** k;
    if (ground && y * s >= g0 && (y + 1) * s <= c) return 1;
    const m = lumpCell(s, x, y, z);
    if (ground && y * s < c && (y + 1) * s > g0) return m === 1 ? 1 : -1;   // it straddles the slab's top or bottom
    return m;
  };
}

/* The build, on the M2 Max at load average about 17, at D = 20 (a ball of side
   256 is 16 ms and 12,985 nodes; side 1,024 is 265 ms and 107,041; a block of
   any side is under 0.3 ms and about 100, because its faces lie on the grid and
   the walk stops before it reaches a voxel). At k = 0 a cell is one voxel, whose
   box of centres is a single point, so near and far agree and the test never
   says −1 there: fromField's "undecided voxel" can't fire. */
export function buildClay(desc, store = createStore()){
  if (!desc.ground) return { store, root: store.fromField(desc.D, clayCell(desc)).root, D: desc.D };
  // The ground isn't built by fromField, though clayCell can say it. The slab's
  // bottom lies on the grid only up to level 6, so above that every cell along
  // it straddles it, and fromField (no memo) walks all 4^(D−7) of them: D = 20
  // took most of a minute, D = 24 didn't finish. The slab is the same in every
  // column, so a cell is a function of its level and y alone: memoized on
  // those, it's one or two nodes a level. The lump, built by fromField with the
  // ground left out but placed as on it, joins by union; equal sets are equal
  // ids, so the root is the one fromField would give (clay-core.test.js holds
  // it to the dense stamp). The lump's nodes the ground covers stay in the store.
  const c = 2 ** (desc.D - 1), g0 = c - GROUND_DEPTH, memo = new Map();
  const slab = (k, y) => {
    const s = 2 ** k;
    if (y * s >= g0 && (y + 1) * s <= c) return store.solid(k);
    if ((y + 1) * s <= g0 || y * s >= c) return EMPTY;
    const key = k * 2 ** 30 + y, hit = memo.get(key);
    if (hit !== undefined) return hit;
    const lo = slab(k - 1, 2 * y), hi = slab(k - 1, 2 * y + 1);
    // Morton, octant-major: child o has y bit (o >> 1) & 1.
    const id = store.intern(k, Uint32Array.from({ length: 8 }, (_, o) => o >> 1 & 1 ? hi : lo));
    memo.set(key, id);
    return id;
  };
  const ground = slab(desc.D, 0);
  const root = desc.lump ? store.union(store.fromField(desc.D, clayCell(desc, false)).root, ground) : ground;
  return { store, root, D: desc.D };
}

/* The colour field, from the descriptor alone: a world file has nothing else
   (vdag-core's colourPrint and resolveColour). Clay above the plane, ground
   below it (nothing is solid under the slab but placed blocks, whose colour is
   the edit table's, so the field needn't know where the slab ends), so when edit mode digs, what's inside is the right material with
   no shape test. Off the ground it's clay everywhere it's asked, and nothing
   asks about air.

   A small jitter per voxel shows you how big a voxel is. Without it a face of
   the block is one flat colour, and a one-voxel edit is hard to find. The
   ground adds a 16-voxel checker, because a plain plane gives you no sense of
   speed or scale when you fly over it. Hash like colours.js's hash3: three
   multiplies, about the cost of the rows' jitter. */
const hash = (i, j, k) => {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};
const CLAY = [188, 138, 104], GROUND = [116, 124, 104], CHECK = 0.92;
export function clayColour(desc, rgb8){
  const c = 2 ** (desc.D - 1), ground = desc.ground;
  return (x, y, z) => {
    const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), n = 0.95 + 0.1 * hash(i, j, k);
    if (ground && y < c){
      const m = n * (((i >> 4) ^ (k >> 4)) & 1 ? 1 : CHECK);
      return rgb8(GROUND[0] * m, GROUND[1] * m, GROUND[2] * m);
    }
    return rgb8(CLAY[0] * n, CLAY[1] * n, CLAY[2] * n);
  };
}
