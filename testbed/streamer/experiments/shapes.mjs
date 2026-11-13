/* Simple shapes: the smooth-content corpus for Q16 (docs/hashcons-findings.md,
   open question 1).

   block-showroom's specimens are porous: 54% of their voxels at R=256 are
   surface voxels. A brick-size decision also needs the other extreme,
   smooth solids whose surface is a thin sheet, where §10.3 predicted that a
   16³ brick sees only ~6% of its voxels. These are the cheapest fields
   that cover that range: two closed solids, a thin shell, a planar cut, a
   heightfield, a periodic porous sheet, a rotated box and an asymmetric
   blob. Each is a predicate on the voxel centre p ∈ (−1, 1)³,
   p = (2i + 1)/R − 1, so it is exact at any R and symmetric where the
   shape is.

   Each also has a bound for building big worlds top-down (fieldOf below,
   docs/stream-plan.md decision 13): a function f with f ≤ 0 exactly where
   `inside` holds, and a Lipschitz constant `lip`, |f(p) − f(q)| ≤ lip·|p − q|.
   Most are distances (lip 1). The two that aren't:
   - terrain: value noise with a smoothstep has slope ≤ 1.5 per unit, so
     the 5-octave fbm has ≤ Σ 0.5^(o+1)·2^o·1.5 = 3.75; times 1.5 (the
     input scale) and 0.6 (the height) that's 3.375 along x and along z,
     and |∇f| ≤ √(1 + 2·3.375²) = 4.88;
   - hills: the terrain's fbm at 0.24 of the height, so 0.24·1.5·3.75 =
     1.35 along x and z, and |∇f| ≤ √(1 + 2·1.35²) = 2.17;
   - gyroid: each partial is 2π·(cos a cos b − sin a sin c), at most 2π√2
     in size by Cauchy–Schwarz, so |∇f| ≤ 2π√6 = 15.39.
   A bound that is too small builds a wrong DAG, and dag-core.test.js
   compares every shape against fromDense voxel for voxel.

   Each also has a colour field (step 6, docs/attrs-plan.md decision 1):
   `colour(x, y, z)`, the same p ∈ (−1, 1)³, returning 8-bit RGB packed by
   attr-core's rgb8. It is defined everywhere, not only inside: the job
   only asks at occupied voxels, and a coarse mean samples sub-cell
   centres that may sit just outside. Smooth on purpose, except where a
   shape has a natural edge (the blob's balls, the gyroid's two sides),
   so the coarse mean has something to average without flickering. */
import { rgb8 } from '../attr-core.js';

const len = (x, y, z) => Math.sqrt(x*x + y*y + z*z);

// Value noise on an integer lattice, smoothstepped, a few octaves: just
// enough for an asymmetric heightfield with no repeating structure.
function hash3(i, j, k){
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13;
  return ((h >>> 0) / 4294967296);
}
function noise2(x, y){
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash3(i, j, 7), b = hash3(i + 1, j, 7), c = hash3(i, j + 1, 7), d = hash3(i + 1, j + 1, 7);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
const fbm = (x, y) => { let v = 0, amp = 0.5, f = 1; for (let o = 0; o < 5; o++){ v += amp * noise2(x * f, y * f); amp *= 0.5; f *= 2; } return v; };

// A fixed rotation (about the axis (1,2,3), 0.6 rad), for the box.
const ROT = (() => {
  const n = len(1, 2, 3), [x, y, z] = [1 / n, 2 / n, 3 / n], c = Math.cos(0.6), s = Math.sin(0.6), t = 1 - c;
  return [[t*x*x + c, t*x*y - s*z, t*x*z + s*y], [t*x*y + s*z, t*y*y + c, t*y*z - s*x], [t*x*z - s*y, t*y*z + s*x, t*z*z + c]];
})();

/* Colour helpers: a cosine palette (Quílez's a + b·cos(2π(c·t + d))) and
   a piecewise-linear ramp over [t, r, g, b] stops, both in 0–255. */
const TAU = 2 * Math.PI;
const cosPal = (t, a, b, c, d) => rgb8(
  255 * (a[0] + b[0] * Math.cos(TAU * (c[0] * t + d[0]))),
  255 * (a[1] + b[1] * Math.cos(TAU * (c[1] * t + d[1]))),
  255 * (a[2] + b[2] * Math.cos(TAU * (c[2] * t + d[2]))));
const RAINBOW = [[0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [1, 1, 1], [0, 0.33, 0.67]];
const rainbow = t => cosPal(t, ...RAINBOW);
function ramp(t, stops){
  if (t <= stops[0][0]) return rgb8(stops[0][1], stops[0][2], stops[0][3]);
  for (let i = 1; i < stops.length; i++){
    const [t1, r1, g1, b1] = stops[i];
    if (t <= t1){
      const [t0, r0, g0, b0] = stops[i - 1], u = (t - t0) / (t1 - t0);
      return rgb8(r0 + (r1 - r0) * u, g0 + (g1 - g0) * u, b0 + (b1 - b0) * u);
    }
  }
  const e = stops[stops.length - 1];
  return rgb8(e[1], e[2], e[3]);
}
const STRATA = [[0, 120, 86, 62], [0.2, 176, 132, 88], [0.35, 214, 186, 140], [0.5, 150, 96, 70],
                [0.7, 196, 160, 118], [0.85, 110, 84, 70], [1, 120, 86, 62]];
const BIOMES = [[-0.32, 196, 182, 132], [-0.2, 92, 140, 66], [0.0, 64, 112, 52], [0.08, 120, 108, 92],
                [0.16, 150, 142, 134], [0.2, 236, 238, 242]];
const HILLS = [[-0.25, 196, 182, 132], [-0.22, 104, 150, 70], [-0.17, 72, 124, 56], [-0.13, 62, 104, 50],
               [-0.11, 128, 118, 102], [-0.09, 150, 142, 134]];
const BALLS = [[0.3, 0.1, -0.2, 0.45, [222, 96, 72]], [-0.35, -0.25, 0.1, 0.35, [72, 156, 222]],
               [-0.1, 0.45, 0.3, 0.3, [242, 196, 72]], [0.05, -0.5, -0.45, 0.25, [128, 200, 110]]];

export const SHAPES = [
  { name: 'sphere',    note: 'solid ball, r = 0.8',
    inside: (x, y, z) => len(x, y, z) <= 0.8,
    f: (x, y, z) => len(x, y, z) - 0.8, lip: 1,
    // latitude bands, wavy with longitude
    colour: (x, y, z) => rainbow(0.9 * y + 0.08 * Math.sin(5 * Math.atan2(z, x))) },
  { name: 'shell',     note: 'hollow ball, wall 0.8 → 0.7',
    inside: (x, y, z) => { const r = len(x, y, z); return r <= 0.8 && r >= 0.7; },
    f: (x, y, z) => { const r = len(x, y, z); return Math.max(r - 0.8, 0.7 - r); }, lip: 1,
    // hue by longitude, darker towards the inner wall
    colour: (x, y, z) => { const c = rainbow(Math.atan2(z, x) / TAU), k = 0.55 + 0.45 * Math.min(1, Math.max(0, (len(x, y, z) - 0.7) / 0.1));
      return rgb8(k * (c & 255), k * (c >> 8 & 255), k * (c >> 16 & 255)); } },
  { name: 'torus',     note: 'R = 0.55, r = 0.2, about y',
    inside: (x, y, z) => (Math.hypot(x, z) - 0.55) ** 2 + y * y <= 0.04,
    f: (x, y, z) => Math.hypot(Math.hypot(x, z) - 0.55, y) - 0.2, lip: 1,
    // hue around the ring, two turns, shifted by the angle round the tube
    colour: (x, y, z) => rainbow(2 * Math.atan2(z, x) / TAU + 0.15 * Math.atan2(y, Math.hypot(x, z) - 0.55) / Math.PI) },
  { name: 'half-space', note: 'x + 2y + 3z ≤ 0.3·√14, a tilted planar cut',
    inside: (x, y, z) => x + 2*y + 3*z <= 0.3 * Math.sqrt(14),
    f: (x, y, z) => (x + 2*y + 3*z) / Math.sqrt(14) - 0.3, lip: 1,
    // rock strata parallel to the cut, gently warped
    colour: (x, y, z) => ramp(((((x + 2*y + 3*z) / Math.sqrt(14)) * 3 + 0.15 * Math.sin(4 * x + 3 * z)) % 1 + 1) % 1, STRATA) },
  { name: 'terrain',   note: 'y ≤ heightfield, 5-octave value noise',
    height: (x, z) => 0.6 * fbm(1.5 * x + 4, 1.5 * z + 4) - 0.3,
    inside: (x, y, z) => y <= 0.6 * fbm(1.5 * x + 4, 1.5 * z + 4) - 0.3,
    f: (x, y, z) => y - (0.6 * fbm(1.5 * x + 4, 1.5 * z + 4) - 0.3), lip: 4.9,
    // sand, grass, forest, rock, snow by height, the boundaries broken by noise
    colour: (x, y, z) => ramp(y + 0.06 * (noise2(9 * x + 1, 9 * z + 2) - 0.5), BIOMES) },
  { name: 'gyroid',    note: '|gyroid| ≤ 0.25, 2 periods: porous, smooth',
    inside: (x, y, z) => { const k = 2 * Math.PI; const [a, b, c] = [k*x, k*y, k*z];
      return Math.abs(Math.sin(a)*Math.cos(b) + Math.sin(b)*Math.cos(c) + Math.sin(c)*Math.cos(a)) <= 0.25; },
    f: (x, y, z) => { const k = 2 * Math.PI; const [a, b, c] = [k*x, k*y, k*z];
      return Math.abs(Math.sin(a)*Math.cos(b) + Math.sin(b)*Math.cos(c) + Math.sin(c)*Math.cos(a)) - 0.25; }, lip: 15.4,
    // the sheet's two sides: warm where the gyroid is positive, cool where negative
    colour: (x, y, z) => { const k = 2 * Math.PI, [a, b, c] = [k*x, k*y, k*z];
      const g = Math.sin(a)*Math.cos(b) + Math.sin(b)*Math.cos(c) + Math.sin(c)*Math.cos(a), u = Math.min(1, Math.abs(g) / 0.25);
      return g >= 0 ? rgb8(200 + 40 * u, 140 - 40 * u, 70) : rgb8(70, 150 - 30 * u, 200 + 40 * u); } },
  { name: 'box',       note: 'cube of half-side 0.5, rotated 0.6 rad about (1,2,3)',
    inside: (x, y, z) => { const p = ROT.map(r => r[0]*x + r[1]*y + r[2]*z);
      return Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) <= 0.5; },
    f: (x, y, z) => { const p = ROT.map(r => r[0]*x + r[1]*y + r[2]*z);
      return Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2])) - 0.5; }, lip: 1,
    // the box's own frame as RGB, so each face shows a different gradient
    colour: (x, y, z) => { const p = ROT.map(r => r[0]*x + r[1]*y + r[2]*z);
      return rgb8(255 * (p[0] + 0.5), 255 * (p[1] + 0.5), 255 * (p[2] + 0.5)); } },
  { name: 'blob',      note: 'union of 4 off-centre balls',
    inside: (x, y, z) => len(x - 0.3, y - 0.1, z + 0.2) <= 0.45 || len(x + 0.35, y + 0.25, z - 0.1) <= 0.35
                      || len(x + 0.1, y - 0.45, z - 0.3) <= 0.3 || len(x - 0.05, y + 0.5, z + 0.45) <= 0.25,
    f: (x, y, z) => Math.min(len(x - 0.3, y - 0.1, z + 0.2) - 0.45, len(x + 0.35, y + 0.25, z - 0.1) - 0.35,
                             len(x + 0.1, y - 0.45, z - 0.3) - 0.3, len(x - 0.05, y + 0.5, z + 0.45) - 0.25), lip: 1,
    // each ball its own colour: the one whose surface is nearest wins
    colour: (x, y, z) => { let best = Infinity, c = BALLS[0][4];
      for (const [bx, by, bz, r, col] of BALLS){ const d = len(x - bx, y - by, z - bz) - r; if (d < best){ best = d; c = col; } }
      return rgb8(c[0], c[1], c[2]); } },
  /* The scatter world's ground (docs/scatter-plan.md, decision 6): the
     terrain's noise at 0.4 of its height, low in the world. The terrain's
     median slope is 0.46 voxels a voxel; this one's is ~0.18, so a
     64-voxel specimen resting on it overhangs its downhill edge by ~12
     voxels, not ~30. Last in the list, so the experiments' tables keep
     their order. */
  { name: 'hills',     note: 'y ≤ heightfield, the terrain\'s noise at 0.4 of its height',
    height: (x, z) => 0.24 * fbm(1.5 * x + 4, 1.5 * z + 4) - 0.3,
    inside: (x, y, z) => y <= 0.24 * fbm(1.5 * x + 4, 1.5 * z + 4) - 0.3,
    f: (x, y, z) => y - (0.24 * fbm(1.5 * x + 4, 1.5 * z + 4) - 0.3), lip: 2.2,
    // meadow greens over sand, rock on the highest ground
    colour: (x, y, z) => ramp(y + 0.02 * (noise2(9 * x + 1, 9 * z + 2) - 0.5), HILLS) },
];

/* A heightfield as a crust (asked for 2026-11-13: the terrain and the hills
   were solid all the way down: 35–65% of the world's height for the terrain,
   whose surface is y = h ∈ [−0.3, 0.3], and 35–47% for the hills).
   The surface is the shape's own; below it, only `depth` voxels of each column
   are solid, so the crust follows the ground and the world under it is air.
   A shape with a `height` (terrain, hills) can be one.

   In voxel units a column is solid for H − depth < j + ½ ≤ H, a half-open
   interval of length `depth`, so it holds exactly `depth` voxel centres (up to
   the rounding of H). The bound is max(f, (h − T) − y): the second term's
   gradient is the first's with y's sign flipped, so it has the same size, and
   the max of two functions with one Lipschitz constant keeps it. `lip` stands.
   The colour is the shape's: it's a function of position, and the surface
   hasn't moved.

   The experiments' corpus (SHAPES) stays solid to the floor, as do the
   scatter's hills (stream.test.js pins its voxels): only the stream viewer's
   terrain and hills worlds are crusts. */
export function crustOf(shape, D, depth){
  if (!shape.height) throw new Error(`crustOf: ${shape.name} isn't a heightfield`);
  // A shape with a `height` is y ≤ height(x, z), the same expression as its
  // `inside` (so the same floats), and f = y − h. Reading h once, not through
  // inside and f, halves the noise: the D = 11 terrain built in 22 s that way.
  const T = 2 * depth / 2 ** D, { height } = shape;
  return { ...shape, note: `${shape.note}, ${depth} voxels deep`,
    inside: (x, y, z) => { const h = height(x, z); return y <= h && y > h - T; },
    f: (x, y, z) => { const h = height(x, z); return Math.max(y - h, h - T - y); } };
}

export function denseShape(shape, R){
  const occ = new Uint8Array(R ** 3);
  let filled = 0;
  for (let k = 0; k < R; k++){
    const z = (2 * k + 1) / R - 1;
    for (let j = 0; j < R; j++){
      const y = (2 * j + 1) / R - 1;
      for (let i = 0; i < R; i++){
        if (shape.inside((2 * i + 1) / R - 1, y, z)){ occ[i + R * (j + R * k)] = 1; filled++; }
      }
    }
  }
  return { occ, filled };
}

/* A shape as a dag-core fromField classifier for a world of side 2^D.
   A level-k node's voxel centres span a box of half-side (2^k − 1)/R
   around its centre, so if |f(centre)| is more than lip times that box's
   half-diagonal, every voxel in it agrees with the centre. A voxel itself
   is decided by `inside`, the same expression denseShape uses, so the two
   builders agree bit for bit (the margin of 1e-12 absorbs rounding between
   f and inside at the box corners). */
export function fieldOf(shape, D){
  const R = 2 ** D, root3 = Math.sqrt(3);
  return (k, x, y, z) => {
    if (k === 0) return shape.inside((2 * x + 1) / R - 1, (2 * y + 1) / R - 1, (2 * z + 1) / R - 1) ? 1 : 0;
    const s = 2 ** k, r = shape.lip * root3 * (s - 1) / R + 1e-12;
    const v = shape.f((2 * x + 1) * s / R - 1, (2 * y + 1) * s / R - 1, (2 * z + 1) * s / R - 1);
    return v > r ? 0 : v < -r ? 1 : -1;
  };
}

/* A shape's colour field in voxel units, for a world of side 2^D: voxel i
   has its centre at i + 0.5, which maps to (2i + 1)/R − 1 exactly as in
   denseShape, and a coarse mean's sample at a sub-cell centre maps the
   same way. */
export function colourFieldOf(shape, D){
  const s = 2 / 2 ** D;
  return (x, y, z) => shape.colour(x * s - 1, y * s - 1, z * s - 1);
}
