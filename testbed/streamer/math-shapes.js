/* ================== MATH SHAPES (pure, no imports) =====================
   The catalogue of the math world (docs/math-world.md, asked for
   2026-11-20): famous surfaces and interesting solids, each written once
   in its own frame and voxelized by math-core.js at any R from 32 to 128.

   THE FRAME. Every object lives in (−1, 1)³ with y up. One that is turned
   by any yaw (most of them) must also lie inside the unit cylinder,
   x² + z² ≤ 1, so a turn about y never carries it out of its box; one
   marked `axial` is turned by quarter turns only (its faces are the
   point: the sponge, the cubic surfaces, the Hilbert curve) and may fill
   the cube. math-core.test.js holds every object inside its box at every
   size and at random yaws, with a padded box to catch what would spill.

   FOUR KINDS, by how they are voxelized (math-core.js's voxelize):
   - 'solid': `inside(x, y, z, d)`, asked at each voxel centre. `d` is what
     the object needs to know of R (`detail(R)`: the sponge's levels, the
     Sierpinski's R), so a sponge never has holes thinner than a voxel and a
     half. It must say no outside the cube (the test's padded box asks);
   - 'sheet': an implicit surface f = 0 thickened to a slab, a voxel kept
     where |f| / |∇f| (the distance to the surface, to first order) is
     within the shell's half thickness, inside `clip`. f is sampled once a
     voxel and the gradient read off the grid, so it costs one evaluation
     a voxel, not seven;
   - 'surface': a parametric surface `at(u, v, out)` on [0, 1]², sampled
     on a grid (`grid`), each grid quad then cut finely enough in the
     box's voxels to leave no gap, every sample a small ball;
   - 'curve': `paths(d)`, polylines, each segment cut the same way, every
     sample a ball of the tube's radius (`tube`, in the fitted frame).
   A surface's or a curve's raw coordinates are fitted into the frame by
   math-core (centred, scaled into the cylinder or the cube, `up` naming
   the raw axis that becomes y), so their formulas are the textbook ones.

   SIZE (asked for 2026-11-20: "size should follow shape"). Each object has
   `size: [lo, hi]`, the range of R it reads best at, within 32–128: the
   Platonic and round solids are plain at any size and small is fine
   (32–72); fractals, knots with thin tubes and surfaces with fine folds
   need room (96–128: the Mandelbulb's tendrils, the Lorenz orbit's 0.03
   tube, Costa's three ends, the Calabi–Yau's 25 patches, the horned
   sphere's levels); the rest sit between. math-core's layout draws R
   from this range within the world's own (its rMin, rMax), or the nearer
   end of the world's when the two don't meet.

   PIECES. Every object is one 26-connected piece but those with `pieces`
   (the Borromean rings, 3): the test holds each to its count.

   Everything here is a pure function of its arguments: workers and the
   main thread build the same voxels. No randomness; the Lorenz attractor
   is a fixed RK4 run. */

const PHI = (1 + Math.sqrt(5)) / 2, TAU = 2 * Math.PI;
const len = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const clamp01 = v => v < 0 ? 0 : v >= 1 ? 0.9999999999 : v;

/* ---- helpers for the polyhedra ------------------------------------------ */
// Unit normals and a support distance: inside when |n·p| ≤ d for every n.
const unit = v => { const l = len(...v); return v.map(c => c / l); };
const cyclic = vs => vs.flatMap(([a, b, c]) => [[a, b, c], [c, a, b], [b, c, a]]);
const DODECA = cyclic([[0, 1, PHI], [0, 1, -PHI]]).map(unit);                    // 6 face pairs
const ICOSA = [[1, 1, 1], [1, 1, -1], [1, -1, 1], [-1, 1, 1], ...cyclic([[0, 1 / PHI, PHI], [0, 1 / PHI, -PHI]])].map(unit); // 10 face pairs
// Circumradius over inradius, √3·√(3 − φ)/φ = 1.2584, the same for the dodecahedron and the icosahedron.
const PLATO = Math.sqrt(3) * Math.sqrt(3 - PHI) / PHI;
const slabs = (N, d) => (x, y, z) => { for (const n of N) if (Math.abs(n[0] * x + n[1] * y + n[2] * z) > d) return false; return true; };

// A rotation matrix (row-major) by `a` about the unit axis `n`.
function axisAngle(n, a){
  const [x, y, z] = n, c = Math.cos(a), s = Math.sin(a), t = 1 - c;
  return [t*x*x + c, t*x*y - s*z, t*x*z + s*y, t*x*y + s*z, t*y*y + c, t*y*z - s*x, t*x*z - s*y, t*y*z + s*x, t*z*z + c];
}
const mul3 = (A, B) => Array.from({ length: 9 }, (_, k) => { const i = k / 3 | 0, j = k % 3; return A[3*i] * B[j] + A[3*i + 1] * B[3 + j] + A[3*i + 2] * B[6 + j]; });

/* The compound of five cubes: the cube (±h)³ and its four turns by 72° about
   a five-fold axis of the dodecahedron round it, (0, 1, φ)/|·| here (each
   cube's eight corners are eight of the dodecahedron's twenty). The whole
   is turned first so that axis is y: the compound stands on its five-fold
   axis, and any yaw suits it. */
const FIVE = (() => {
  const a = unit([0, 1, PHI]), up = [0, 1, 0];
  // Turn y onto a: about y × a by the angle between them.
  const ax = unit([up[1] * a[2] - up[2] * a[1], up[2] * a[0] - up[0] * a[2], up[0] * a[1] - up[1] * a[0]]);
  const M = axisAngle(ax, Math.acos(a[1]));
  return [0, 1, 2, 3, 4].map(k => mul3(axisAngle(a, -TAU * k / 5), M));
})();

/* The regular tetrahedron for the Sierpinski fractal: base down, apex up,
   the base's corners on a circle of 0.95 (an edge of 0.95√3, a height of
   0.95√2), centred in y, scaled by R for the slack below (which carried the
   corners out of the cylinder at R = 32 and 48). Barycentric coordinates by
   a precomputed inverse. */
const TETRA_R = 0.95;
const TETRA = (() => {
  const r = TETRA_R, h = r * Math.SQRT2 / 2, V = [[0, h, 0]];
  for (const t of [90, 210, 330]) V.push([r * Math.cos(t * Math.PI / 180), -h, r * Math.sin(t * Math.PI / 180)]);
  // λ1..3 from p − V0 = Σ λi (Vi − V0); λ0 = 1 − Σ.
  const E = [1, 2, 3].map(i => V[i].map((c, k) => c - V[0][k]));
  const m = [[E[0][0], E[1][0], E[2][0]], [E[0][1], E[1][1], E[2][1]], [E[0][2], E[1][2], E[2][2]]];
  const det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const inv = [
    [(m[1][1] * m[2][2] - m[1][2] * m[2][1]) / det, (m[0][2] * m[2][1] - m[0][1] * m[2][2]) / det, (m[0][1] * m[1][2] - m[0][2] * m[1][1]) / det],
    [(m[1][2] * m[2][0] - m[1][0] * m[2][2]) / det, (m[0][0] * m[2][2] - m[0][2] * m[2][0]) / det, (m[0][2] * m[1][0] - m[0][0] * m[1][2]) / det],
    [(m[1][0] * m[2][1] - m[1][1] * m[2][0]) / det, (m[0][1] * m[2][0] - m[0][0] * m[2][1]) / det, (m[0][0] * m[1][1] - m[0][1] * m[1][0]) / det]];
  return { V, inv };
})();
// The Reuleaux tetrahedron's corners: a tetrahedron of circumradius 0.95, apex up.
const REULEAUX = (() => {
  const r = 0.95, V = [[0, r, 0]];
  for (const t of [90, 210, 330]) V.push([r * 2 * Math.SQRT2 / 3 * Math.cos(t * Math.PI / 180), -r / 3, r * 2 * Math.SQRT2 / 3 * Math.sin(t * Math.PI / 180)]);
  return { V, a: r * 4 / Math.sqrt(6) };
})();

/* ---- Weierstrass's ζ and ℘ for Costa's surface ----------------------------
   The lattice of periods 1 and i (g2 = 189.07272, g3 = 0), by Jacobi's θ1 with
   nome q = e^{−π}: ζ(z) = πz + π θ1'(πz)/θ1(πz) (η1 = π/2 by Legendre's
   relation and the square's symmetry), ℘ = −ζ'. Eight terms of θ1: the
   eighth is q^56 ≈ 1e-77, and with v's imaginary part under π a term n is
   at most e^{π(2n + 1 − (n + ½)²)}, gone by n = 5. Checked on the way:
   e1 = ℘(½) = 6.8751858 and g2 from the Laurent series, 189.07273, both
   the values every account of the surface gives. */
const TQ = Math.exp(-Math.PI), TA = Array.from({ length: 8 }, (_, n) => 2 * (n % 2 ? -1 : 1) * TQ ** ((n + 0.5) ** 2));
function theta1(vr, vi, out){
  let a = 0, b = 0, c = 0, d = 0, e = 0, f = 0;
  for (let n = 0; n < 8; n++){
    const m = 2 * n + 1, ar = m * vr, ai = m * vi, ch = Math.cosh(ai), sh = Math.sinh(ai), w = TA[n];
    const sr = Math.sin(ar) * ch, si = Math.cos(ar) * sh, cr = Math.cos(ar) * ch, ci = -Math.sin(ar) * sh;
    a += w * sr; b += w * si; c += w * m * cr; d += w * m * ci; e -= w * m * m * sr; f -= w * m * m * si;
  }
  out[0] = a; out[1] = b; out[2] = c; out[3] = d; out[4] = e; out[5] = f;
}
const TH = new Float64Array(6);
function zetaW(zr, zi, o){
  theta1(Math.PI * zr, Math.PI * zi, TH);
  const [a, b, c, d] = TH, q = a * a + b * b;
  o[0] = Math.PI * (zr + (c * a + d * b) / q); o[1] = Math.PI * (zi + (d * a - c * b) / q);
}
function wpW(zr, zi, o){
  theta1(Math.PI * zr, Math.PI * zi, TH);
  const [a, b, c, d, e, f] = TH, nr = (e * a - f * b) - (c * c - d * d), ni = (e * b + f * a) - 2 * c * d, tr = a * a - b * b, ti = 2 * a * b, q = tr * tr + ti * ti;
  o[0] = -Math.PI - Math.PI * Math.PI * (nr * tr + ni * ti) / q; o[1] = -Math.PI * Math.PI * (ni * tr - nr * ti) / q;
}
const COSTA_E1 = (() => { const o = [0, 0]; wpW(0.5, 0, o); return o[0]; })();

/* ---- the Apollonian packing --------------------------------------------------
   Spheres in the unit sphere, every one tangent to its neighbours, by the
   Soddy–Gosset theorem: in a quintuple of mutually tangent spheres, sphere i
   can be traded for the other sphere tangent to the four others, k' = Σ_{j≠i}
   k_j − k_i, and the same for k·centre (checked on the way: each new sphere
   tangent to the other four to 1e-16). From the unit sphere (k = −1) and four
   equal spheres at a tetrahedron's corners, every quintuple trades each
   sphere but the one it was made by, down to a radius of `rMin`. A sphere is
   drawn grown by `grow`, so tangent spheres overlap and are one piece (they
   touch at points, which voxel centres miss: undrawn, they fell apart into
   balls the dust rule ate). A grid of 16³ cells lists the spheres meeting
   each, for inside(). Cached by R (one build ~20 ms at R = 128). */
const APOLLO = new Map();
function apollonian(R){
  if (APOLLO.has(R)) return APOLLO.get(R);
  const rMin = 1.5 / R * 1.03, grow = 0.75 * 2 / R, rho = 1 / (1 + Math.sqrt(1.5)), d = (1 - rho) / Math.sqrt(3);
  const out = [], first = [{ k: -1, c: [0, 0, 0] }, ...[[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map(v => ({ k: 1 / rho, c: v.map(x => x * d) }))];
  for (const q of first.slice(1)) out.push(q);
  const trade = (Q, i) => { let k = -Q[i].k, x = -Q[i].k * Q[i].c[0], y = -Q[i].k * Q[i].c[1], z = -Q[i].k * Q[i].c[2];
    for (let j = 0; j < 5; j++) if (j !== i){ k += Q[j].k; x += Q[j].k * Q[j].c[0]; y += Q[j].k * Q[j].c[1]; z += Q[j].k * Q[j].c[2]; }
    return { k, c: [x / k, y / k, z / k] }; };
  /* Each quintuple once, keyed by its five spheres: in 3D a sphere is reached
     along many paths (the rule "trade every sphere but the one you were made
     by", which enumerates a 2D gasket once, ran out of memory here), and a
     sphere is named by its rounded centre and curvature. */
  const ids = new Map(), idOf = b => { const key = `${Math.round(b.k * 1e4)},${b.c.map(v => Math.round(v * 1e7)).join(',')}`;
    if (!ids.has(key)) ids.set(key, ids.size); return ids.get(key); };
  const seen = new Set(), drawn = new Set(), keyOf = Q => Q.map(idOf).sort((a, b) => a - b).join(' '), stack = [first];
  for (const q of first) drawn.add(idOf(q));
  seen.add(keyOf(first));
  while (stack.length){
    const Q = stack.pop();
    for (let i = 0; i < 5; i++){
      const t = trade(Q, i);
      if (!(t.k > 0) || 1 / t.k < rMin) continue;
      const next = Q.slice(); next[i] = t;
      const key = keyOf(next);
      if (seen.has(key)) continue;
      seen.add(key);
      const id = idOf(t);
      if (!drawn.has(id)){ drawn.add(id); out.push(t); }
      stack.push(next);
    }
  }
  const G = 16, cells = Array.from({ length: G ** 3 }, () => []), cellOf = v => Math.max(0, Math.min(G - 1, Math.floor((v + 1) / 2 * G)));
  /* A quarter cut away (every sphere whose centre has x > 0 and z > 0), so
     the packing inside shows: whole, it was a ball, its surface the four
     big spheres and the small ones between them, and nothing of the rest. */
  const shown = out.filter(b => !(b.c[0] > 0 && b.c[2] > 0)), balls = new Float64Array(4 * shown.length);
  shown.forEach((b, n) => {
    const r = 1 / b.k + grow;
    balls.set([b.c[0], b.c[1], b.c[2], r * r], 4 * n);
    for (let z = cellOf(b.c[2] - r); z <= cellOf(b.c[2] + r); z++) for (let y = cellOf(b.c[1] - r); y <= cellOf(b.c[1] + r); y++)
      for (let x = cellOf(b.c[0] - r); x <= cellOf(b.c[0] + r); x++) cells[x + G * (y + G * z)].push(n);
  });
  const P = { G, cells: cells.map(l => Int32Array.from(l)), balls, count: shown.length, cellOf };
  APOLLO.set(R, P);
  return P;
}

/* ---- Alexander's horned sphere --------------------------------------------------
   As rings: a fat ring with a gap at the top, and at every gap two rings
   that hang from its tips and hold each other, each with a gap of its own,
   where the next two hang. A ring is a circle in the plane of (g, u) about
   c, of radius r, a tube of radius t, open where the direction from c is
   within GAP of u: its tips are c + r(±sin GAP g + cos GAP u), facing each
   other along g. At a gap of chord L the two rings have radius L/3, centres
   m ∓ (L/6) g (m the chord's middle), planes (g, u ± n)/√2 (n = g × u),
   each through the other's centre, so they are linked; each hangs from its
   tip (its far point is the tip exactly) and opens toward its own u. A
   level is half the size and more of the last (2/3 sin GAP = 0.51), so
   levels stop where a tube would be under 1.2 voxels, `detail(R)`. */
const HORN_GAP = 82 * Math.PI / 180, HORN_TUBE = 0.24;
const HORNS = new Map();
function horned(levels){
  if (HORNS.has(levels)) return HORNS.get(levels);
  const unitv = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const rings = [], cg = Math.cos(HORN_GAP), sg = Math.sin(HORN_GAP);
  const ring = (c, g, u, r, t, level) => {
    const node = { c, g, u, n: cross(g, u), r, t, kids: [] };
    if (level + 1 < levels){
      const m = c.map((v, a) => v + r * cg * u[a]), L = 2 * r * sg, r2 = L / 3, n = node.n;
      for (const [sg2, su] of [[-1, 1], [1, -1]]){
        const u2 = unitv(u.map((v, a) => 2 * v + su * n[a])), c2 = m.map((v, a) => v + sg2 * r2 / 2 * g[a]);
        // The second ring hangs from the far tip: its g is the first's, turned.
        node.kids.push(ring(c2, sg2 < 0 ? g : g.map(v => -v), u2, r2, r2 * HORN_TUBE, level + 1));
      }
    }
    // A sphere round the ring and everything hanging from it, for the cull.
    let br = r + t;
    for (const k of node.kids) br = Math.max(br, Math.hypot(...k.c.map((v, a) => v - c[a])) + k.bound);
    node.bound = br;
    rings.push(node);
    return node;
  };
  const root = ring([0, 0, 0], [1, 0, 0], [0, 1, 0], 0.44, 0.1, 0);
  /* Fitted into the frame as a surface is: centred on its box (every ring's
     centre ± its radius and tube, a box that holds it), scaled so its
     height and its reach from the axis are 0.97 at most. */
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const q of rings) for (let a = 0; a < 3; a++){ lo[a] = Math.min(lo[a], q.c[a] - q.r - q.t); hi[a] = Math.max(hi[a], q.c[a] + q.r + q.t); }
  const m = lo.map((v, a) => (v + hi[a]) / 2);
  let ext = (hi[1] - lo[1]) / 2;
  for (const q of rings) ext = Math.max(ext, Math.hypot(q.c[0] - m[0], q.c[2] - m[2]) + q.r + q.t);
  const out = { root, rings: rings.length, m, k: 0.97 / ext, tMin: Math.min(...rings.map(q => q.t)) };
  HORNS.set(levels, out);
  return out;
}
// Inside a ring's tube, or anything hanging from it.
function inHorn(node, x, y, z){
  const dx = x - node.c[0], dy = y - node.c[1], dz = z - node.c[2];
  if (dx * dx + dy * dy + dz * dz > node.bound * node.bound) return false;
  const { g, u, n, r, t } = node, a = dx * g[0] + dy * g[1] + dz * g[2], b = dx * u[0] + dy * u[1] + dz * u[2], h = dx * n[0] + dy * n[1] + dz * n[2], q = Math.hypot(a, b);
  if (b > q * Math.cos(HORN_GAP)){
    // In the gap's wedge: the nearer tip, a round end.
    const s = Math.sin(HORN_GAP) * r, c = Math.cos(HORN_GAP) * r, ta = Math.abs(a) - s, tb = b - c;
    if (ta * ta + tb * tb + h * h <= t * t) return true;
  } else if ((q - r) * (q - r) + h * h <= t * t) return true;
  for (const k of node.kids) if (inHorn(k, x, y, z)) return true;
  return false;
}

/* ---- the oloid -----------------------------------------------------------------
   The convex hull of two unit circles in perpendicular planes, each through
   the other's centre: C1 about (−½, 0, 0) in the xy plane, C2 about (½, 0, 0)
   in the xz plane. The hull of two discs is the union of λD1 + (1 − λ)D2, and
   p is in that for one λ when |y| ≤ λ, |z| ≤ 1 − λ and |x − ½ + λ| ≤
   √(λ² − y²) + √((1 − λ)² − z²): a concave function of λ less a convex one,
   so its largest value is found by golden section, and p is inside when it
   is ≥ 0 (stopping as soon as a λ says yes). */
function inOloid(x, y, z){
  const Y = Math.abs(y), Z = Math.abs(z);
  let lo = Y, hi = 1 - Z;
  if (lo > hi) return false;
  const g = l => Math.sqrt(Math.max(0, l * l - Y * Y)) + Math.sqrt(Math.max(0, (1 - l) * (1 - l) - Z * Z)) - Math.abs(x - 0.5 + l);
  const k = (Math.sqrt(5) - 1) / 2;
  let a = hi - k * (hi - lo), b = lo + k * (hi - lo), ga = g(a), gb = g(b);
  for (let i = 0; i < 48 && hi - lo > 1e-9; i++){
    if (ga >= 0 || gb >= 0) return true;
    if (ga < gb){ lo = a; a = b; ga = gb; b = lo + k * (hi - lo); gb = g(b); }
    else { hi = b; b = a; gb = ga; a = hi - k * (hi - lo); ga = g(a); }
  }
  return Math.max(ga, gb, g(lo), g(hi)) >= 0;
}

/* ---- the catalogue ---------------------------------------------------------
   Families, for the panel: polyhedra and solids, fractals, algebraic,
   minimal and periodic surfaces, parametric surfaces, knots and curves. */
export const MATH_FAMILIES = ['polyhedra and solids', 'fractals', 'algebraic', 'minimal and periodic', 'parametric surfaces', 'knots and curves'];

export const MATH_SHAPES = [
  /* ---- polyhedra and solids ---- */
  { name: 'dodecahedron', size: [32, 72], family: 0, kind: 'solid', note: 'the Platonic solid of twelve pentagons',
    inside: slabs(DODECA, 0.97 / PLATO) },
  { name: 'icosahedron', size: [32, 72], family: 0, kind: 'solid', note: 'the Platonic solid of twenty triangles',
    inside: slabs(ICOSA, 0.97 / PLATO) },
  { name: 'five cubes', size: [64, 112], family: 0, kind: 'solid', note: 'the compound of five cubes, on its five-fold axis',
    inside: (x, y, z) => {
      const h = 0.97 / Math.sqrt(3);
      for (const M of FIVE){
        if (Math.abs(M[0] * x + M[1] * y + M[2] * z) <= h && Math.abs(M[3] * x + M[4] * y + M[5] * z) <= h && Math.abs(M[6] * x + M[7] * y + M[8] * z) <= h) return true;
      }
      return false;
    } },
  { name: 'stella octangula', size: [40, 88], family: 0, kind: 'solid', axial: true, note: 'two tetrahedra through each other, Kepler\'s star',
    inside: (x, y, z) => {
      const s = 0.97, a = x / s, b = y / s, c = z / s;
      return (-a - b - c <= 1 && -a + b + c <= 1 && a - b + c <= 1 && a + b - c <= 1) || (a + b + c <= 1 && a - b - c <= 1 && -a + b - c <= 1 && -a - b + c <= 1);
    } },
  { name: 'steinmetz', size: [32, 72], family: 0, kind: 'solid', note: 'the tricylinder: three cylinders\' common part',
    inside: (x, y, z) => { const r = 0.96 * 0.96; return x * x + y * y <= r && y * y + z * z <= r && x * x + z * z <= r; } },
  { name: 'reuleaux tetrahedron', size: [32, 72], family: 0, kind: 'solid', note: 'four balls, each centred on a corner of a tetrahedron',
    inside: (x, y, z) => { const { V, a } = REULEAUX; for (const v of V) if (len(x - v[0], y - v[1], z - v[2]) > a) return false; return true; } },
  { name: 'sphericon', size: [32, 80], family: 0, kind: 'solid', note: 'a double cone cut on its axis, one half turned a quarter: it rolls with one face',
    inside: (x, y, z) => { const s = 1 / 0.97, a = x * s, b = y * s, c = z * s;
      return c >= 0 ? Math.abs(a) + Math.hypot(b, c) <= 1 : Math.abs(b) + Math.hypot(a, c) <= 1; } },

  { name: 'oloid', size: [40, 88], family: 0, kind: 'solid', note: 'the hull of two circles, each through the other\'s centre: it rolls on its whole surface',
    inside: (x, y, z) => { const s = 1.5 / 0.97; return inOloid(x * s, y * s, z * s); } },

  /* ---- fractals ---- */
  /* The Menger sponge: base-3 digits of the cube's coordinates, a point gone
     where two of a level's three digits are 1. Levels so the smallest hole is
     at least a voxel and a half: 2 below R = 41, 3 to 121, 4 from there. */
  { name: 'menger sponge', size: [64, 128], family: 1, kind: 'solid', axial: true, note: 'the cube with every middle third bored out, levels by size',
    detail: R => Math.max(2, Math.min(4, Math.floor(Math.log(R / 1.5) / Math.log(3)))),
    inside: (x, y, z, d) => {
      if (Math.abs(x) > 1 || Math.abs(y) > 1 || Math.abs(z) > 1) return false;
      let a = clamp01((x + 1) / 2), b = clamp01((y + 1) / 2), c = clamp01((z + 1) / 2);
      for (let k = 0; k < d; k++){
        a *= 3; b *= 3; c *= 3;
        const i = Math.floor(a), j = Math.floor(b), m = Math.floor(c);
        a -= i; b -= j; c -= m;
        if ((i === 1) + (j === 1) + (m === 1) >= 2) return false;
      }
      return true;
    } },
  /* The Sierpinski tetrahedron by barycentric coordinates: a point is in corner
     i's half-size copy when λi ≥ ½, and λ' = 2λ − e_i is where it is in it.
     Levels so the smallest copy is at least eight voxels across: at five levels
     the fractal is 1/32 of the tetrahedron's volume, a copy 2.6 voxels on an
     edge at R = 96, and voxel centres caught it as dust (0.2% of the box).
     The copies touch only at their corners, which voxel centres miss: at R = 64
     it fell into 39 pieces. So each test has a slack of three quarters of a
     voxel (δ in λ, which grows by two a level as λ does), and the copies join.
     `detail` is R itself: the levels and the slack both follow from it. */
  { name: 'sierpinski tetrahedron', size: [72, 128], family: 1, kind: 'solid', note: 'four half-size copies of itself, levels by size',
    detail: R => R,
    inside: (x, y, z, R) => {
      // The slack grows the tetrahedron about its centre by 1 + 4δ, its corners
      // 6/(R√2) = 4.24/R further out, so it's drawn at a base radius of
      // 0.985 − 4.25/R: TETRA scaled by k.
      const k = TETRA_R / (0.985 - 4.25 / R), { V, inv } = TETRA, levels = Math.max(2, Math.min(4, Math.floor(Math.log2(R / 8))));
      const p = [x * k - V[0][0], y * k - V[0][1], z * k - V[0][2]];
      const l = [0, inv[0][0] * p[0] + inv[0][1] * p[1] + inv[0][2] * p[2], inv[1][0] * p[0] + inv[1][1] * p[1] + inv[1][2] * p[2], inv[2][0] * p[0] + inv[2][1] * p[1] + inv[2][2] * p[2]];
      l[0] = 1 - l[1] - l[2] - l[3];
      // λ changes by 1/height a unit, the height 0.95√2; a voxel is 2k/R units.
      let slack = 0.75 * 2 * k / R / (TETRA_R * Math.SQRT2);
      if (l[0] < -slack || l[1] < -slack || l[2] < -slack || l[3] < -slack) return false;
      for (let k = 0; k < levels; k++){
        let i = 0;
        for (let j = 1; j < 4; j++) if (l[j] > l[i]) i = j;
        if (l[i] < 0.5 - slack) return false;
        for (let j = 0; j < 4; j++) l[j] = j === i ? 2 * l[j] - 1 : 2 * l[j];
        slack *= 2;
      }
      return true;
    } },
  /* The power-8 Mandelbulb (White and Nylander), its z axis up. Ten
     iterations, escape at 2; a ball of 1.2 holds it. */
  { name: 'mandelbulb', size: [96, 128], family: 1, kind: 'solid', note: 'the power-8 Mandelbulb, ten iterations',
    inside: (X, Y, Z) => {
      const s = 1.18, cx = X * s, cy = Z * s, cz = Y * s;
      if (cx * cx + cy * cy + cz * cz > 1.44) return false;
      let x = cx, y = cy, z = cz;
      for (let i = 0; i < 10; i++){
        const r = Math.sqrt(x * x + y * y + z * z);
        if (r > 2) return false;
        const th = 8 * Math.acos(r > 0 ? z / r : 1), ph = 8 * Math.atan2(y, x), r8 = r ** 8;
        x = r8 * Math.sin(th) * Math.cos(ph) + cx; y = r8 * Math.sin(th) * Math.sin(ph) + cy; z = r8 * Math.cos(th) + cz;
      }
      return true;
    } },

  /* A quaternion Julia set, q ← q² + c with c = (−1, 0.2, 0, 0), cut by the
     hyperplane of the fourth coordinate 0: near the basilica (c = −1, the
     Julia set of beads on beads) turned about the real axis, which lies
     along x. Twelve iterations, escape at 4; a ball of 1.75 holds it. Two
     other well-known constants, (−0.2, 0.8, 0, 0) and (−0.125, −0.256,
     0.847, 0.0895), were dust at twelve iterations and R = 128. q² = (a² −
     |v|², 2av) for q = (a, v). */
  { name: 'quaternion julia', size: [80, 128], family: 1, kind: 'solid', note: 'a Julia set of q² + c in the quaternions, a 3D slice',
    inside: (X, Y, Z) => {
      const s = 1.75 / 0.97, x0 = X * s, y0 = Y * s, z0 = Z * s;
      if (x0 * x0 + y0 * y0 + z0 * z0 > 1.75 * 1.75) return false;
      let a = x0, b = y0, c = z0, d = 0;
      for (let i = 0; i < 12; i++){
        const na = a * a - b * b - c * c - d * d - 1, t = 2 * a;
        b = t * b + 0.2; c = t * c; d = t * d; a = na;
        if (a * a + b * b + c * c + d * d > 16) return false;
      }
      return true;
    } },
  { name: 'apollonian packing', size: [96, 128], family: 1, kind: 'solid', note: 'spheres in a sphere, each tangent to its neighbours, down to a voxel and a half, a quarter cut away',
    detail: R => R,
    inside: (x, y, z, R) => {
      const P = apollonian(R), s = 1 / 0.97, X = x * s, Y = y * s, Z = z * s, G = P.G;
      if (X * X + Y * Y + Z * Z > 1.02) return false;
      const list = P.cells[P.cellOf(X) + G * (P.cellOf(Y) + G * P.cellOf(Z))], B = P.balls;
      for (let i = 0; i < list.length; i++){ const o = 4 * list[i], dx = X - B[o], dy = Y - B[o + 1], dz = Z - B[o + 2];
        if (dx * dx + dy * dy + dz * dz <= B[o + 3]) return true; }
      return false;
    } },
  { name: 'horned sphere', size: [96, 128], family: 1, kind: 'solid', note: 'Alexander\'s horned sphere, as rings: at every gap two rings holding each other',
    // Levels while the finest tube is a voxel across or more (at most 5).
    detail: R => { let n = 1; while (n < 5 && horned(n + 1).tMin * horned(n + 1).k * R / 2 >= 1) n++; return n; },
    inside: (x, y, z, d) => { const H = horned(d); return inHorn(H.root, x / H.k + H.m[0], y / H.k + H.m[1], z / H.k + H.m[2]); } },

  /* ---- algebraic ---- */
  /* Taubin's heart, (x² + 9/4 y² + z² − 1)³ − x² z³ − 9/80 y² z³ ≤ 0, its z up:
     x within ±1.14, z from −1 to 1.25, so scaled by 1.16 and lifted by 0.12. */
  { name: 'heart', size: [40, 88], family: 2, kind: 'solid', note: 'Taubin\'s heart surface, a sextic',
    inside: (X, Y, Z) => {
      const s = 1.2, x = X * s, y = Z * s, z = Y * s + 0.13, q = x * x + 2.25 * y * y + z * z - 1, z3 = z * z * z;
      return q * q * q - x * x * z3 - 0.1125 * y * y * z3 <= 0;
    } },
  /* The tanglecube, x⁴ − 5x² + y⁴ − 5y² + z⁴ − 5z² + 11.8 ≤ 0: it reaches
     x² = (5 + √27.8)/2 = 5.136 at most, so |x| ≤ 2.266, scaled by 2.34. */
  { name: 'tanglecube', size: [48, 96], family: 2, kind: 'solid', axial: true, note: 'x⁴ − 5x² + y⁴ − 5y² + z⁴ − 5z² + 11.8 ≤ 0',
    inside: (X, Y, Z) => { const x = X * 2.34, y = Y * 2.34, z = Z * 2.34, a = x * x, b = y * y, c = z * z;
      return a * a - 5 * a + b * b - 5 * b + c * c - 5 * c + 11.8 <= 0; } },
  /* Barth's sextic, the surface with 65 double points (the most a sextic can
     have): 4(φ²x² − y²)(φ²y² − z²)(φ²z² − x²) − (1 + 2φ)(x² + y² + z² − 1)² = 0,
     inside a ball of radius 1.6 (in the formula's units). A sheet, not the
     solid f ≥ 0: the solid's twenty cones meet only at the nodes, points
     voxel centres miss, and at R = 64 it was five pieces; the surface
     thickened passes through every node. */
  { name: 'barth sextic', size: [96, 128], family: 2, kind: 'sheet', note: 'Barth\'s sextic: 65 double points, the surface in a ball',
    f: (X, Y, Z) => {
      const s = 1.6, x = X * s, y = Y * s, z = Z * s, a = x * x, b = y * y, c = z * z, p = PHI * PHI, r = a + b + c;
      return 4 * (p * a - b) * (p * b - c) * (p * c - a) - (1 + 2 * PHI) * (r - 1) * (r - 1);
    },
    clip: (x, y, z) => x * x + y * y + z * z <= 0.88 },

  /* Kummer's quartic with 16 double points, (x² + y² + z² − μ²)² − λpqrs = 0,
     μ² = 1.69, λ = (3μ² − 1)/(3 − μ²), p, q, r, s the faces of a tetrahedron
     (1 − z ∓ √2 x, 1 + z ± √2 y), in a ball of radius 2.4. */
  { name: 'kummer surface', size: [80, 128], family: 2, kind: 'sheet', note: 'Kummer\'s quartic: sixteen double points',
    f: (X, Y, Z) => {
      const s = 2.4, x = X * s, y = Z * s, z = Y * s, m = 1.69, l = (3 * m - 1) / (3 - m), r = x * x + y * y + z * z - m;
      return r * r - l * (1 - z - Math.SQRT2 * x) * (1 - z + Math.SQRT2 * x) * (1 + z + Math.SQRT2 * y) * (1 + z - Math.SQRT2 * y);
    },
    clip: (x, y, z) => x * x + y * y + z * z <= 0.88 },
  /* Clebsch's diagonal cubic, the cubic with its 27 lines all real, in
     affine coordinates: 81(x³ + y³ + z³) − 189(x²y + x²z + y²x + y²z + z²x
     + z²y) + 54xyz + 126(xy + yz + zx) − 9(x² + y² + z²) − 9(x + y + z) + 1
     = 0, in the unit ball, with its axis of symmetry x = y = z turned up. */
  { name: 'clebsch cubic', size: [80, 128], family: 2, kind: 'sheet', note: 'Clebsch\'s diagonal cubic: all 27 of its lines real',
    f: (X, Y, Z) => {
      // y up onto the axis (1, 1, 1)/√3: an orthonormal frame round it.
      const s = 1.0, a = [1 / Math.SQRT2, -1 / Math.SQRT2, 0], b = [1 / Math.sqrt(6), 1 / Math.sqrt(6), -2 / Math.sqrt(6)], c = 1 / Math.sqrt(3);
      const x = s * (X * a[0] + Z * b[0] + Y * c), y = s * (X * a[1] + Z * b[1] + Y * c), z = s * (X * a[2] + Z * b[2] + Y * c);
      return 81 * (x * x * x + y * y * y + z * z * z) - 189 * (x * x * (y + z) + y * y * (x + z) + z * z * (x + y)) + 54 * x * y * z
        + 126 * (x * y + y * z + z * x) - 9 * (x * x + y * y + z * z) - 9 * (x + y + z) + 1;
    },
    clip: (x, y, z) => x * x + y * y + z * z <= 0.88 },

  /* ---- minimal and periodic surfaces, as sheets ---- */
  { name: 'gyroid', size: [80, 128], family: 3, kind: 'sheet', note: 'Schoen\'s gyroid, two and a half periods, in a ball',
    f: (x, y, z) => { const k = TAU * 1.25, a = k * x, b = k * y, c = k * z;
      return Math.sin(a) * Math.cos(b) + Math.sin(b) * Math.cos(c) + Math.sin(c) * Math.cos(a); },
    clip: (x, y, z) => x * x + y * y + z * z <= 0.94 },
  { name: 'schwarz p', size: [64, 128], family: 3, kind: 'sheet', axial: true, note: 'Schwarz\'s primitive surface, cos x + cos y + cos z = 0, two periods',
    f: (x, y, z) => Math.cos(TAU * x) + Math.cos(TAU * y) + Math.cos(TAU * z), clip: (x, y, z) => Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) <= 1 },
  { name: 'schwarz d', size: [80, 128], family: 3, kind: 'sheet', note: 'Schwarz\'s diamond surface, in a ball',
    f: (x, y, z) => { const k = TAU * 0.9, a = k * x, b = k * y, c = k * z, sa = Math.sin(a), sb = Math.sin(b), sc = Math.sin(c), ca = Math.cos(a), cb = Math.cos(b), cc = Math.cos(c);
      return sa * sb * sc + sa * cb * cc + ca * sb * cc + ca * cb * sc; },
    clip: (x, y, z) => x * x + y * y + z * z <= 0.94 },
  { name: 'monkey saddle', size: [48, 96], family: 3, kind: 'sheet', note: 'y = x³ − 3xz², a saddle with three valleys, over a disc',
    f: (x, y, z) => y - 0.7 * (x * x * x - 3 * x * z * z), clip: (x, y, z) => x * x + z * z <= 0.94 },
  { name: 'saddle', size: [40, 80], family: 3, kind: 'sheet', note: 'the hyperbolic paraboloid y = x² − z², over a disc',
    f: (x, y, z) => y - 0.8 * (x * x - z * z), clip: (x, y, z) => x * x + z * z <= 0.94 },

  /* Scherk's second surface, the singly periodic tower, sin y = sinh x sinh z
     (y up, the period along it): two periods, in a cylinder. */
  { name: 'scherk tower', size: [64, 112], family: 3, kind: 'sheet', note: 'Scherk\'s second surface, sin y = sinh x sinh z: a tower of saddles',
    f: (x, y, z) => Math.sin(TAU * y) - Math.sinh(1.5 * x) * Math.sinh(1.5 * z), clip: (x, y, z) => x * x + z * z <= 0.94 && Math.abs(y) <= 0.95 },

  /* ---- parametric surfaces ---- */
  /* The Klein bottle in its bottle shape (the parametrisation MathWorld
     gives), u ∈ [0, π], v ∈ [0, 2π]: the neck passes through the side. */
  { name: 'klein bottle', size: [80, 128], family: 4, kind: 'surface', up: 1, grid: [240, 120], note: 'the Klein bottle, its neck through its side',
    at: (s, t, o) => {
      const u = Math.PI * s, v = TAU * t, cu = Math.cos(u), su = Math.sin(u), cv = Math.cos(v), sv = Math.sin(v);
      const c2 = cu * cu, c3 = c2 * cu, c4 = c2 * c2, c5 = c4 * cu, c6 = c3 * c3, c7 = c6 * cu;
      o[0] = -2 / 15 * cu * (3 * cv - 30 * su + 90 * c4 * su - 60 * c6 * su + 5 * cu * cv * su);
      o[1] = -1 / 15 * su * (3 * cv - 3 * c2 * cv - 48 * c4 * cv + 48 * c6 * cv - 60 * su + 5 * cu * cv * su - 5 * c3 * cv * su - 80 * c5 * cv * su + 80 * c7 * cv * su);
      o[2] = 2 / 15 * (3 + 5 * cu * su) * sv;
    } },
  { name: 'möbius strip', size: [64, 112], family: 4, kind: 'surface', up: 1, grid: [240, 24], note: 'the one-sided band, standing',
    at: (s, t, o) => { const u = TAU * s, v = 0.8 * (t - 0.5), r = 1 + v * Math.cos(u / 2);
      o[0] = r * Math.cos(u); o[1] = r * Math.sin(u); o[2] = v * Math.sin(u / 2); } },
  /* Boy's surface by Bryant and Kusner's parametrisation over the unit disc
     (w = r e^{iθ}): the real projective plane immersed, three-fold about z. */
  { name: 'boy surface', size: [80, 128], family: 4, kind: 'surface', up: 2, grid: [96, 288], note: 'Boy\'s surface: the projective plane in space (Bryant–Kusner)',
    at: (s, t, o) => {
      const r = s, th = TAU * t, wr = r * Math.cos(th), wi = r * Math.sin(th);
      // w², w³, w⁴, w⁶ by complex products.
      const w2r = wr * wr - wi * wi, w2i = 2 * wr * wi, w3r = w2r * wr - w2i * wi, w3i = w2r * wi + w2i * wr;
      const w4r = w2r * w2r - w2i * w2i, w4i = 2 * w2r * w2i, w6r = w3r * w3r - w3i * w3i, w6i = 2 * w3r * w3i;
      const dr = w6r + Math.sqrt(5) * w3r - 1, di = w6i + Math.sqrt(5) * w3i, dd = dr * dr + di * di;
      const div = (ar, ai) => [(ar * dr + ai * di) / dd, (ai * dr - ar * di) / dd];
      // w(1 − w⁴), w(1 + w⁴), 1 + w⁶
      const a = div(wr * (1 - w4r) + wi * w4i, wi * (1 - w4r) - wr * w4i), b = div(wr * (1 + w4r) - wi * w4i, wi * (1 + w4r) + wr * w4i), c = div(1 + w6r, w6i);
      const g1 = -1.5 * a[1], g2 = -1.5 * b[0], g3 = c[1] - 0.5, g = g1 * g1 + g2 * g2 + g3 * g3;
      o[0] = g1 / g; o[1] = g2 / g; o[2] = g3 / g;
    } },
  { name: 'enneper surface', size: [64, 112], family: 4, kind: 'surface', up: 2, grid: [64, 256], note: 'Enneper\'s minimal surface, folding over itself',
    at: (s, t, o) => { const r = 1.45 * s, th = TAU * t, u = r * Math.cos(th), v = r * Math.sin(th);
      o[0] = u - u * u * u / 3 + u * v * v; o[1] = v - v * v * v / 3 + v * u * u; o[2] = u * u - v * v; } },
  { name: 'dini surface', size: [72, 128], family: 4, kind: 'surface', up: 2, grid: [320, 64], note: 'Dini\'s twisted pseudosphere',
    at: (s, t, o) => { const u = 4 * Math.PI * s, v = 0.25 + 1.5 * t, a = 1, b = 0.12;
      o[0] = a * Math.cos(u) * Math.sin(v); o[1] = a * Math.sin(u) * Math.sin(v); o[2] = a * (Math.cos(v) + Math.log(Math.tan(v / 2))) + b * u; } },
  { name: 'seashell', size: [72, 128], family: 4, kind: 'surface', up: 2, grid: [360, 64], note: 'a conical spiral shell (von Seggern)',
    at: (s, t, o) => { const u = 6 * Math.PI * s, v = TAU * t, e = Math.exp(u / (6 * Math.PI)), c = Math.cos(v / 2) ** 2;
      o[0] = 2 * (1 - e) * Math.cos(u) * c; o[1] = 2 * (-1 + e) * Math.sin(u) * c; o[2] = 1 - e * e - Math.sin(v) + e * Math.sin(v); } },
  /* Steiner's Roman surface: the sphere through (x, y, z) → (yz, zx, xy). */
  { name: 'roman surface', size: [64, 112], family: 4, kind: 'surface', up: 1, grid: [192, 96], note: 'Steiner\'s Roman surface: the sphere by (yz, zx, xy)',
    at: (s, t, o) => { const th = TAU * s, ph = Math.PI * t, x = Math.sin(ph) * Math.cos(th), y = Math.sin(ph) * Math.sin(th), z = Math.cos(ph);
      o[0] = y * z; o[1] = z * x; o[2] = x * y; } },
  { name: 'helicoid', size: [56, 104], family: 4, kind: 'surface', up: 1, grid: [240, 40], note: 'the helicoid, a minimal surface: a spiral ramp, two turns',
    at: (s, t, o) => { const u = 4 * Math.PI * s, v = 2 * t - 1; o[0] = v * Math.cos(u); o[1] = 0.18 * u; o[2] = v * Math.sin(u); } },
  { name: 'catenoid', size: [48, 96], family: 4, kind: 'surface', up: 1, grid: [192, 64], note: 'the catenoid: a soap film between two rings',
    at: (s, t, o) => { const u = TAU * s, v = 2.6 * (t - 0.5), c = Math.cosh(v); o[0] = c * Math.cos(u); o[1] = v; o[2] = c * Math.sin(u); } },

  /* Costa's minimal surface (1982): genus one, three ends, two catenoids and
     a plane between, by Weierstrass's functions (Gray's form, the lattice of
     periods 1 and i): x = ½ Re{−ζ(w) + πu + π²/4e1 + π/2e1 [ζ(w − ½) − ζ(w − i/2)]},
     y = ½ Re{−iζ(w) + πv + π²/4e1 − π/2e1 [iζ(w − ½) − iζ(w − i/2)]},
     z = √(2π)/4 ln|(℘(w) − e1)/(℘(w) + e1)|, w = u + iv on the unit square.
     The ends are at w = 0, ½ and i/2 (and their translates), where the
     surface leaves for infinity: it's clipped at a radius of 3.2 and a
     height of 1.6 (the point NaN past it, so the voxelizer leaves the quad
     out), and the grid is crowded toward u, v ∈ {0, ½, 1} (s − 0.9 sin 4πs /
     4π), ten times finer there, so the clip's edge is fine too. Its fit is
     given (the clip's cylinder, about 0), not read off its points: see
     math-core's fitted. */
  { name: 'costa surface', size: [96, 128], family: 4, kind: 'surface', up: 2, grid: [360, 360], fit: { c: [0, 0, 0], ext: 3.2 }, note: 'Costa\'s minimal surface: a torus with three ends',
    at: (s, t, o) => {
      const warp = a => a - 0.9 * Math.sin(4 * Math.PI * a) / (4 * Math.PI), u = warp(s), v = warp(t), e = COSTA_E1, P = Math.PI, z0 = [0, 0], z1 = [0, 0], z2 = [0, 0], w = [0, 0];
      zetaW(u, v, z0); zetaW(u - 0.5, v, z1); zetaW(u, v - 0.5, z2); wpW(u, v, w);
      const x = 0.5 * (-z0[0] + P * u + P * P / (4 * e) + P / (2 * e) * (z1[0] - z2[0]));
      // Re(−iζ) = Im ζ; Re(i(ζ1 − ζ2)) = −Im(ζ1 − ζ2).
      const y = 0.5 * (z0[1] + P * v + P * P / (4 * e) + P / (2 * e) * (z1[1] - z2[1]));
      const z = Math.sqrt(2 * P) / 4 * Math.log(Math.hypot(w[0] - e, w[1]) / Math.hypot(w[0] + e, w[1]));
      if (!(Math.hypot(x, y) <= 3.2 && Math.abs(z) <= 1.6)){ o[0] = o[1] = o[2] = NaN; return; }
      o[0] = x; o[1] = y; o[2] = z;
    } },
  /* A Calabi–Yau section: z1⁵ + z2⁵ = 1 in C², Hanson's picture of it (1994).
     25 patches, z1 = e^{2πik1/5} cos(ξ)^{2/5}, z2 = e^{2πik2/5} sin(ξ)^{2/5},
     ξ = x + iy over [0, π/2] × [−1.2, 1.2], seen as (Re z1, Re z2, cos α
     Im z1 + sin α Im z2), α = π/4. */
  { name: 'calabi-yau', size: [96, 128], family: 4, kind: 'surface', up: 1, grid: [40, 48], patches: 25, note: 'a Calabi–Yau section: z1⁵ + z2⁵ = 1, its 25 patches',
    at: (s, t, o, q) => {
      const x = Math.PI / 2 * s, y = 1.6 * (t - 0.5), k1 = q % 5, k2 = (q - k1) / 5;
      // cos ξ and sin ξ, to the power 2/5 by modulus and argument, then the phases.
      const cr = Math.cos(x) * Math.cosh(y), ci = -Math.sin(x) * Math.sinh(y), sr = Math.sin(x) * Math.cosh(y), si = Math.cos(x) * Math.sinh(y);
      const pw = (re, im, k) => { const m = Math.hypot(re, im) ** 0.4, a = 0.4 * Math.atan2(im, re) + TAU * k / 5; return [m * Math.cos(a), m * Math.sin(a)]; };
      const [ar, ai] = pw(cr, ci, k1), [br, bi] = pw(sr, si, k2), al = Math.PI / 4;
      o[0] = ar; o[1] = br; o[2] = Math.cos(al) * ai + Math.sin(al) * bi;
    } },

  /* ---- knots and curves, as tubes ---- */
  { name: 'trefoil knot', size: [64, 112], family: 5, kind: 'curve', up: 1, tube: 0.11, note: 'the simplest knot',
    paths: () => [closed(4096, t => [Math.sin(t) + 2 * Math.sin(2 * t), Math.cos(t) - 2 * Math.cos(2 * t), -Math.sin(3 * t)])] },
  { name: 'figure-eight knot', size: [72, 128], family: 5, kind: 'curve', up: 1, tube: 0.09, note: 'the knot of four crossings',
    paths: () => [closed(4096, t => [(2 + Math.cos(2 * t)) * Math.cos(3 * t), (2 + Math.cos(2 * t)) * Math.sin(3 * t), Math.sin(4 * t)])] },
  { name: 'torus knot 3,7', size: [96, 128], family: 5, kind: 'curve', up: 1, tube: 0.065, note: 'three times round, seven times through',
    paths: () => [closed(8192, t => { const r = 2 + Math.cos(7 * t); return [r * Math.cos(3 * t), r * Math.sin(3 * t), -Math.sin(7 * t)]; })] },
  { name: 'lissajous knot', size: [96, 128], family: 5, kind: 'curve', up: 1, tube: 0.06, note: 'cos 3t, cos 2t, cos 7t, phases apart',
    paths: () => [closed(8192, t => [Math.cos(3 * t + 0.7), Math.cos(2 * t + 0.2), Math.cos(7 * t)])] },
  { name: 'borromean rings', size: [64, 112], pieces: 3, family: 5, kind: 'curve', up: 1, tube: 0.1, note: 'three rings, no two linked, all three held',
    paths: () => [closed(2048, t => [Math.cos(t), 0.5 * Math.sin(t), 0]), closed(2048, t => [0, Math.cos(t), 0.5 * Math.sin(t)]), closed(2048, t => [0.5 * Math.sin(t), 0, Math.cos(t)])] },
  /* Lorenz's attractor, σ = 10, ρ = 28, β = 8/3, from (0.1, 0, 0): RK4 at
     dt = 0.005, the first 2,000 steps dropped, the next 8,000 kept. */
  { name: 'lorenz attractor', size: [104, 128], family: 5, kind: 'curve', up: 2, tube: 0.03, note: 'one orbit of Lorenz\'s butterfly',
    paths: () => {
      const F = (p, k) => { k[0] = 10 * (p[1] - p[0]); k[1] = p[0] * (28 - p[2]) - p[1]; k[2] = p[0] * p[1] - 8 / 3 * p[2]; };
      const p = [0.1, 0, 0], q = [0, 0, 0], k1 = [0, 0, 0], k2 = [0, 0, 0], k3 = [0, 0, 0], k4 = [0, 0, 0], h = 0.005, keep = 8000, out = new Float64Array(3 * keep);
      for (let n = 0; n < 2000 + keep; n++){
        F(p, k1); for (let i = 0; i < 3; i++) q[i] = p[i] + h / 2 * k1[i];
        F(q, k2); for (let i = 0; i < 3; i++) q[i] = p[i] + h / 2 * k2[i];
        F(q, k3); for (let i = 0; i < 3; i++) q[i] = p[i] + h * k3[i];
        F(q, k4); for (let i = 0; i < 3; i++) p[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
        if (n >= 2000){ const j = 3 * (n - 2000); out[j] = p[0]; out[j + 1] = p[1]; out[j + 2] = p[2]; }
      }
      return [out];
    } },
  /* The Hilbert curve in 3D (Skilling's transpose form), order 2 below
     R = 64 and 3 from it, so a step of the curve is 8 voxels or more. */
  { name: 'hilbert curve', size: [64, 128], family: 5, kind: 'curve', axial: true, up: 1, note: 'the space-filling curve, order 2 or 3 by size',
    detail: R => R < 64 ? 2 : 3, tube: d => 0.6 / 2 ** d,
    paths: d => { const n = 2 ** d, out = new Float64Array(3 * n ** 3);
      for (let i = 0; i < n ** 3; i++){ const p = hilbertPoint(i, d); for (let a = 0; a < 3; a++) out[3 * i + a] = (2 * p[a] + 1) / n - 1; }
      return [out]; } },
  { name: 'double helix', size: [64, 112], family: 5, kind: 'curve', up: 1, tube: 0.075, note: 'two strands and their rungs',
    paths: () => {
      const turns = 2.5, T = TAU * turns, strand = ph => open(2048, s => { const t = T * s; return [0.7 * Math.cos(t + ph), 0.2 * t, 0.7 * Math.sin(t + ph)]; });
      const out = [strand(0), strand(Math.PI)];
      for (let k = 0; k <= 10 * turns; k++){ const t = T * k / (10 * turns);
        out.push(Float64Array.of(0.7 * Math.cos(t), 0.2 * t, 0.7 * Math.sin(t), -0.7 * Math.cos(t), 0.2 * t, -0.7 * Math.sin(t))); }
      return out;
    } },
  /* The hyperboloid of one sheet as its two families of straight lines:
     each rod joins the bottom circle at θ to the top circle at θ ± 108°. */
  { name: 'ruled hyperboloid', size: [80, 128], family: 5, kind: 'curve', up: 1, tube: 0.032, note: 'a curved surface made of straight rods, both families',
    paths: () => {
      const out = [], a = TAU * 0.3, n = 20;
      for (const sgn of [1, -1]) for (let k = 0; k < n; k++){ const t = TAU * k / n;
        out.push(Float64Array.of(Math.cos(t), -1, Math.sin(t), Math.cos(t + sgn * a), 1, Math.sin(t + sgn * a))); }
      out.push(closed(256, t => [Math.cos(t), -1, Math.sin(t)]), closed(256, t => [Math.cos(t), 1, Math.sin(t)]));
      return out;
    } },
];

// A closed curve as a polyline of n + 1 points (the last is the first again), t over [0, 2π].
function closed(n, P){ const out = new Float64Array(3 * (n + 1)); for (let i = 0; i <= n; i++){ const p = P(TAU * (i % n) / n); out[3 * i] = p[0]; out[3 * i + 1] = p[1]; out[3 * i + 2] = p[2]; } return out; }
// An open one, s over [0, 1].
function open(n, P){ const out = new Float64Array(3 * (n + 1)); for (let i = 0; i <= n; i++){ const p = P(i / n); out[3 * i] = p[0]; out[3 * i + 1] = p[1]; out[3 * i + 2] = p[2]; } return out; }

/* The i-th point of the order-b Hilbert curve in 3D, by Skilling's
   "Programming the Hilbert curve" (2004): the index's bits dealt into the
   transpose form, most significant first, then TransposetoAxes. Successive
   points differ by one along exactly one axis (math-core.test.js holds it). */
export function hilbertPoint(h, b){
  const n = 3, X = [0, 0, 0];
  for (let k = 0; k < n * b; k++){
    const bit = Math.floor(h / 2 ** (n * b - 1 - k)) & 1;
    X[k % n] |= bit << (b - 1 - Math.floor(k / n));
  }
  const N = 2 << (b - 1);
  let t = X[n - 1] >> 1;
  for (let i = n - 1; i > 0; i--) X[i] ^= X[i - 1];
  X[0] ^= t;
  for (let Q = 2; Q !== N; Q <<= 1){
    const P = Q - 1;
    for (let i = n - 1; i >= 0; i--){
      if (X[i] & Q) X[0] ^= P;
      else { t = (X[0] ^ X[i]) & P; X[0] ^= t; X[i] ^= t; }
    }
  }
  return X;
}

export const mathShape = name => MATH_SHAPES.find(s => s.name === name);
