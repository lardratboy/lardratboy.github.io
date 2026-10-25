/* ================== MOD FIELD CORE ==================================
   Generator #3 (`?g=field`, design in easyfields.md): a one-line formula,
   taken mod m, decides each voxel.

     voxel (x, y, z)
       ─► doubled centred integers  X = 2x − (R−1)        exact, symmetric
       ─► frame     X ↦ q   (cartesian, lathe, torus, polar k, screw, …)
       ─► snap q back onto the grid's integer parity      Q
       ─► formula   Q ↦ g   (rings, quadric, xor, pascal, gyroid, …)
       ─► v = fract(k·g), keep if v < duty                duty = recipe density
       ─► clipped by the archetype envelope, folded by the symmetry group

   then the shared instanceArrays(), so everything downstream is shared.

   `bands` sets the modulus relative to the formula's range over the cube:
   m = round(G / bands), G = max |g| in the cartesian frame. One band is a
   single smooth level set; many bands make m small, and then the field
   repeats with period m and its moiré shows (easyfields.md §4). A small
   range has few moduli, so steps that would repeat one take a phase
   instead, g + c (bandStep): every step is a different specimen.

   `k` is the frequency as a multiple of 1/m. The rational ones, 1/m and
   1/(m+½) = 2/(2m+1), are exact integer arithmetic and tile; the golden
   and silver ones, 1/(m+1/φ) and 1/(m+√2−1), are the irrationals worst
   approximated by fractions, so the field never repeats (§4).

   Most formulas are integers. Norm and the trig fields (gyroid, Schwarz P
   and D, quasicrystal) are real: m is G / bands unrounded. There k's
   shift s nudges phase and frequency instead, since rational and
   irrational only differ on integers: the bands start s of a band above
   the sheet, and the trig fields gain s periods across the cube, so the
   golden and silver ones are incommensurate with the grid. Pascal reads
   `bands` as a digit base and an apex instead (pascalStep).

   Pure like the other cores: no DOM, no THREE, runs in the worker.
   ================================================================ */
import { createBimoblockCore } from './bimoblock-core.js';

export const FRAME_NAMES = ['cartesian', 'lathe y', 'lathe diagonal', 'torus', 'polar 5', 'polar 7', 'screw', 'inversion',
                            'lathe edge', 'spherical', 'power 3', 'repeat'];
export const FORMULA_NAMES = ['rings', 'quadric', 'diamond', 'cube', 'product', 'xor', 'pascal',
                              'norm', 'checker', 'coprime', 'digits', 'gyroid', 'schwarz P', 'schwarz D', 'quasicrystal'];
export const FORMULA_PASCAL = 6, FORMULA_NORM = 7;
/* Formulas with real values: m is unrounded and k is a phase and frequency nudge. */
export const REAL_FORMULAS = [7, 11, 12, 13, 14];
/* Bands per step (the `bands` dial); pascal walks pascalStep() instead. */
export const BANDS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 24, 32, 48, 64, 96, 128];
/* The k dial: k = 1 / (m + shift). */
export const K_NAMES = ['1/m', '1/(m+½)', '1/(m+1/φ)', '1/(m+√2−1)'];
export const K_SHIFT = [0, 0.5, (Math.sqrt(5) - 1) / 2, Math.SQRT2 - 1];
/* Where Pascal's pyramid has its apex: the centre (eight mirrored copies),
   the eight corners (inside out), or one corner (the whole cube). */
export const PASCAL_APEX = ['centre', 'corners', 'corner'];
/* Seeded per-formula parameters, so pages differ: norm exponent, trig
   periods across the cube, checker cell size. */
export const NORM_P = [0.5, 0.75, 1.5, 2, 3, 4];
export const PERIODS = [1, 1.5, 2, 3];
export const CELLS = [2, 3, 4];
/* Hues the orbit colour cycles through: the band index, mod this. */
export const BAND_HUES = 8;

const SQRT3 = Math.sqrt(3), PHI = (1 + Math.sqrt(5)) / 2;
const REAL = new Set(REAL_FORMULAS);

/* The six 5-fold axes of an icosahedron, (0, ±1, ±φ) and cyclic shifts, unit length. */
const ICOSA = [[0, 1, PHI], [0, 1, -PHI], [1, PHI, 0], [1, -PHI, 0], [PHI, 0, 1], [-PHI, 0, 1]]
  .map(v => v.map(c => c / Math.hypot(1, PHI)));

/** Pascal's (base, apex) for a bands step at resolution R. The 16 steps
 *  walk the bases that carry into a second digit (2 … the largest distance
 *  index) at each apex in turn, so every step is a different pyramid; a
 *  larger base would only cut a diamond. Wraps if R is too small for 16.
 *  @param {number} step @param {number} R */
export function pascalStep(step, R){
  const h = R - 1, A = h >> 1;
  const counts = [A, A, h].map(top => Math.max(0, top - 1));
  const total = counts[0] + counts[1] + counts[2];
  if (!total) return { base: 2, apex: 0 };
  let s = Math.max(0, step | 0) % total;
  for (let apex = 0; apex < 2; apex++){
    if (s < counts[apex]) return { base: s + 2, apex };
    s -= counts[apex];
  }
  return { base: s + 2, apex: 2 };
}

/** The (modulus, phase) each bands step takes for an integer formula of
 *  range G. Step s asks for m = round(G / BANDS[s]); once a modulus is
 *  taken, a later step that rounds to it takes its next phase c, keeping
 *  the band count, and once its phases run out, the nearest modulus with
 *  one left. A range with fewer (m, c) pairs than steps wraps.
 *  @param {number} step @param {number} G */
export function bandStep(step, G){
  const top = Math.max(2, G), used = new Map(), walk = [];
  let pairs = 0;
  for (let m = 2; m <= top && pairs < BANDS.length; m++) pairs += m;
  const s = Math.max(0, Math.min(BANDS.length - 1, step | 0));
  for (let t = 0; t <= s % pairs; t++){
    const want = Math.max(2, Math.round(G / BANDS[t]));
    let m = want;
    for (let d = 1; (used.get(m) ?? 0) >= m; d++){   // full: nearest below, then above
      if (want - d >= 2 && (used.get(want - d) ?? 0) < want - d) m = want - d;
      else if (want + d <= top) m = want + d;
    }
    const c = used.get(m) ?? 0;
    used.set(m, c + 1);
    walk.push({ m, phase: c });
  }
  return walk[s % pairs];
}

/* Sums and products that a permutation or a sign flip of the terms can't
   move by an ulp, so a symmetry the formula has survives at the band
   edges. The sum averages the ascending and descending orders, which is
   exactly odd: negating every term negates it. The product multiplies in
   order of |x|, so its magnitude ignores signs. */
const symSum = xs => {
  xs.sort((a, b) => a - b);
  let up = 0, down = 0;
  for (let i = 0, n = xs.length; i < n; i++){ up += xs[i]; down += xs[n - 1 - i]; }
  return (up + down) / 2;
};
const absProd = (...xs) => { xs.sort((a, b) => Math.abs(a) - Math.abs(b)); return xs.reduce((p, x) => p * x, 1); };
const gcd = (a, b) => { while (b){ const t = a % b; a = b; b = t; } return a; };
const imod = (a, n) => ((a % n) + n) % n;
const kIndex = F => Math.max(0, Math.min(K_NAMES.length - 1, F.k | 0));

/** @param {ReturnType<typeof createBimoblockCore>} [bimo] reuse an existing bimoblock core */
export function createFieldCore(bimo = createBimoblockCore()){
  const { GROUPS, applyG, envelope, levelResolution, seedWords } = bimo;

  /* The quadric's sign pattern (a, b, c) ∈ {−1, 0, 1}³, all but (0, 0, 0),
     picked by the seed so pages differ. (1, −1, 0) is the saddle. */
  const SIGNS = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++)
    if (a || b || c) SIGNS.push([a, b, c]);
  const quadricSigns = seed => SIGNS[seedWords(seed).mix % SIGNS.length];

  /* Everything a recipe's formula and frame need besides the voxel. R0 is
     the grid; R the resolution the formula sees, which is the same except
     in the repeat frame: there each outer-tier block is a whole specimen
     at R = the block size, so the formula's range, modulus, digits and
     Pascal bases are that smaller specimen's. */
  function fieldParams(F, levels){
    const R0 = levelResolution(levels), mix = seedWords(F.seed).mix;
    const block = levels.length > 1 ? R0 / levels[0].radix : R0;
    const tile = (F.frame | 0) === 11 && block >= 2 ? block : R0;
    const R = tile, h = R - 1;
    const { base, apex } = pascalStep(F.bands, R);
    const ki = kIndex(F);
    return { R0, h0: R0 - 1, R, h, par: h & 1, A: h >> 1, tile, ki,
      signs: quadricSigns(F.seed),
      p: NORM_P[(mix >>> 8) % NORM_P.length],
      // k's frequency nudge: s more periods across the cube
      periods: PERIODS[(mix >>> 16) % PERIODS.length] + K_SHIFT[ki],
      // at least two cells per half-axis, or the checker is one block
      cell: Math.min(CELLS[(mix >>> 24) % CELLS.length], Math.max(1, ((h >> 1) + 1) >> 1)),
      radices: (tile < R0 ? levels.slice(1) : levels).map(l => l.radix),
      base, apex };
  }

  /* Base-b digit sum, for Kummer's carry count. */
  function digitSum(n, b){ let s = 0; while (n){ s += n % b; n = (n / b) | 0; } return s; }

  /* Pascal's distance index for one coordinate, by apex. */
  function pascalIndex(Q, c){
    const a = Math.abs(Q) >> 1;
    return c.apex === 0 ? a : c.apex === 1 ? Math.abs(c.A - a) : Math.abs((Q + c.h) / 2);
  }

  /* The voxel index's digits in the tier layout's own mixed radix, each
     centred and reduced (|2d − (r−1)| >> 1) so a tier and its mirror image
     agree: a rule per tier, as the tier gaps are. */
  function tierDigits(Q, c){
    let x = imod((Q + c.h) / 2, c.R), s = 0;
    for (let t = c.radices.length - 1; t >= 0; t--){
      const r = c.radices[t], d = x % r;
      x = (x - d) / r;
      s += Math.abs(2 * d - (r - 1)) >> 1;
    }
    return s;
  }

  /* The trig fields at angles t = π · periods · Q / R: about `periods`
     periods across the cube (R, not h, so a small grid's samples miss the
     multiples of π/2, where every sine and cosine is 0 or ±1). Sheets are |f| small, so g = |f| (quasicrystal: the
     distance below its peak, 6 − f). */
  function trig(kind, Q0, Q1, Q2, c){
    const w = Math.PI * c.periods / c.R;
    if (kind === 14){
      const terms = ICOSA.map(n => Math.cos(2 * w * (n[0] * Q0 + n[1] * Q1 + n[2] * Q2)));
      return 6 - symSum(terms);
    }
    const t0 = w * Q0, t1 = w * Q1, t2 = w * Q2;
    const s0 = Math.sin(t0), s1 = Math.sin(t1), s2 = Math.sin(t2);
    const c0 = Math.cos(t0), c1 = Math.cos(t1), c2 = Math.cos(t2);
    if (kind === 11) return Math.abs(symSum([s0 * c1, s1 * c2, s2 * c0]));      // gyroid
    if (kind === 12) return Math.abs(symSum([c0, c1, c2]));                     // Schwarz P
    return Math.abs(symSum([absProd(s0, s1, s2), absProd(s0, c1, c2), absProd(c0, s1, c2), absProd(c0, c1, s2)])); // Schwarz D
  }

  /* The formula at grid-parity integers Q. `c.par` is that parity: 1 when
     R is even (Q odd), 0 when R is odd (Q even). `sq` is the reduced
     square, (Q² − 1)/8 or Q²/4: an integer that takes every residue, where
     Q² of an odd Q is always 1 mod 8 and would leave most moduli with one
     value. `a` is the distance index |Q| >> 1, from 0 at the centre out. */
  function formula(kind, Q0, Q1, Q2, c){
    if (kind === 4) return Q0 * Q1 * Q2;
    if (kind >= 11) return trig(kind, Q0, Q1, Q2, c);
    if (kind === 7){                       // ‖P‖_p over the centred coordinates |Q|/2
      const p = c.p;
      return Math.pow(symSum([Math.pow(Math.abs(Q0) / 2, p), Math.pow(Math.abs(Q1) / 2, p), Math.pow(Math.abs(Q2) / 2, p)]), 1 / p);
    }
    if (kind === 9){
      // Depth behind the visible points, over the distance indices: with
      // d = gcd, d − 1 points hide this one from the octant's corner. The
      // visible (coprime) points, 83% of them, come out at −1 ≡ m − 1 and
      // are the background; the specimen is the sparse hidden lattice.
      // Indices, not Q: odd Q would make every gcd odd, and a profile
      // frame's central ±1 would make every point visible.
      const d = gcd(gcd(Math.abs(Q0) >> 1, Math.abs(Q1) >> 1), Math.abs(Q2) >> 1);
      return d - 2;
    }
    if (kind === 10) return tierDigits(Q0, c) + tierDigits(Q1, c) + tierDigits(Q2, c);
    if (kind === FORMULA_PASCAL){          // carries adding the three indices in base b
      const a0 = pascalIndex(Q0, c), a1 = pascalIndex(Q1, c), a2 = pascalIndex(Q2, c), b = c.base;
      return (digitSum(a0, b) + digitSum(a1, b) + digitSum(a2, b) - digitSum(a0 + a1 + a2, b)) / (b - 1);
    }
    const a0 = Math.abs(Q0) >> 1, a1 = Math.abs(Q1) >> 1, a2 = Math.abs(Q2) >> 1;
    if (kind === 2) return a0 + a1 + a2;
    if (kind === 3) return Math.max(a0, a1, a2);
    if (kind === 5) return a0 ^ a1 ^ a2;
    if (kind === 8) return ((a0 / c.cell) | 0) + ((a1 / c.cell) | 0) + ((a2 / c.cell) | 0);
    const par = c.par;
    const s0 = par ? (Q0 * Q0 - 1) / 8 : Q0 * Q0 / 4;
    const s1 = par ? (Q1 * Q1 - 1) / 8 : Q1 * Q1 / 4;
    const s2 = par ? (Q2 * Q2 - 1) / 8 : Q2 * Q2 / 4;
    if (kind === 1) return c.signs[0] * s0 + c.signs[1] * s1 + c.signs[2] * s2;
    return s0 + s1 + s2;                 // rings
  }

  /* Frame: doubled coordinates in, real coordinates in the same units out.
     A frame with two profile coordinates puts the grid's central value in
     the third (`zc`), so the profile is the formula's slice through the
     axis, spun. */
  function frame(kind, X, Y, Z, c, out){
    const h = c.h, zc = c.par;
    if (kind === 0){ out[0] = X; out[1] = Y; out[2] = Z; return; }
    if (kind === 1){ out[0] = Math.hypot(X, Z); out[1] = Y; out[2] = zc; return; }
    if (kind === 2){
      const t = (X + Y + Z) / SQRT3;
      out[0] = Math.sqrt(Math.max(0, X*X + Y*Y + Z*Z - t*t)); out[1] = t; out[2] = zc; return;
    }
    if (kind === 3){ out[0] = Math.hypot(X, Z) - h / 2; out[1] = Y; out[2] = zc; return; }
    if (kind === 4 || kind === 5){          // k-fold dihedral wedge about y
      const k = kind === 4 ? 5 : 7, w = 2 * Math.PI / k;
      let t = Math.atan2(Z, X) % w; if (t < 0) t += w;
      if (t > w / 2) t = w - t;
      const r = Math.hypot(X, Z);
      out[0] = r * Math.cos(t); out[1] = Y; out[2] = r * Math.sin(t); return;
    }
    if (kind === 6){                         // half a turn about y, top to bottom
      const f = Math.PI / 2 * Y / (h || 1), co = Math.cos(f), si = Math.sin(f);
      out[0] = X * co - Z * si; out[1] = Y; out[2] = X * si + Z * co; return;
    }
    if (kind === 7){                         // inversion in the sphere |P| = h/√2
      const r2 = X*X + Y*Y + Z*Z;
      const f = r2 ? h * h / (2 * r2) : 1;
      out[0] = X * f; out[1] = Y * f; out[2] = Z * f; return;
    }
    if (kind === 8){                         // lathe about the edge axis (1, 1, 0)
      const t = (X + Y) / Math.SQRT2;
      out[0] = Math.sqrt(Math.max(0, X*X + Y*Y + Z*Z - t*t)); out[1] = t; out[2] = zc; return;
    }
    if (kind === 9){                         // (radius, latitude), latitude ±h at the poles
      const r = Math.sqrt(X*X + Y*Y + Z*Z);
      out[0] = r; out[1] = r ? h * Math.asin(Y / r) * 2 / Math.PI : 0; out[2] = zc; return;
    }
    if (kind === 10){                        // (x + iz)³ in the cross-section, scaled so |w| = h at r = h
      const s = h * h || 1;
      out[0] = (X*X*X - 3*X*Z*Z) / s; out[1] = Y; out[2] = (3*X*X*Z - Z*Z*Z) / s; return;
    }
    // repeat: the doubled coordinates within the voxel's outer-tier block
    const s = c.tile, h0 = c.h0;
    out[0] = 2 * imod((X + h0) / 2, s) - h;
    out[1] = 2 * imod((Y + h0) / 2, s) - h;
    out[2] = 2 * imod((Z + h0) / 2, s) - h;
  }

  /* G: max |g| over the cube in the cartesian frame, per formula, R and
     whichever seeded parameter that formula reads. Memoised; the scan is
     one pass over R³ the first time. Integer formulas only: a real one is
     banded across its own sampled range instead (fieldOcc). */
  const ranges = new Map();
  function rangeOf(kind, c){
    const extra = kind === 1 ? c.signs.join(',') : kind === 8 ? c.cell : kind === 10 ? c.radices.join('x') : '';
    const key = kind + '/' + c.R + '/' + extra;
    let G = ranges.get(key);
    if (G !== undefined) return G;
    const h = c.h;
    G = 0;
    for (let z = 0; z < c.R; z++) for (let y = 0; y < c.R; y++) for (let x = 0; x < c.R; x++)
      G = Math.max(G, Math.abs(formula(kind, 2*x - h, 2*y - h, 2*z - h, c)));
    ranges.set(key, G);
    return G;
  }
  /** @param {import('../types.js').FieldRecipe} F @param {import('../types.js').Level[]} levels */
  const formulaRange = (F, levels) => rangeOf(F.formula | 0, fieldParams(F, levels));

  /* The modulus and phase of an integer formula (pascal: its base). A
     real formula's modulus comes out of its build, as meta.modulus. */
  function bandsOf(F, c){
    const kind = F.formula | 0;
    if (kind === FORMULA_PASCAL) return { m: c.base, phase: 0 };
    if (REAL.has(kind)) return { m: NaN, phase: 0 };
    return bandStep(F.bands, rangeOf(kind, c));
  }
  /** @param {import('../types.js').FieldRecipe} F @param {import('../types.js').Level[]} levels */
  const modulus = (F, levels) => bandsOf(F, fieldParams(F, levels)).m;

  /* The inspector's note on the seeded or layout-derived parameters
     (pascal's base and apex travel separately, as meta.base / meta.apex). */
  function detailOf(F, c){
    const kind = F.formula | 0, out = [];
    if (kind === 1) out.push('signs ' + c.signs.map(s => s > 0 ? '+' : s < 0 ? '−' : '0').join(''));
    if (kind === 7) out.push('p ' + c.p);
    if (kind === 8) out.push('cell ' + c.cell);
    if (kind === 10) out.push('radices ' + c.radices.join('·'));
    if (kind >= 11) out.push(+c.periods.toFixed(3) + (c.periods === 1 ? ' period' : ' periods'));
    if ((F.frame | 0) === 11) out.push(c.tile < c.R0 ? 'tile ' + c.tile : 'one tier: nothing to repeat');
    return out.join(' · ');
  }

  /** @param {import('../types.js').FieldRecipe} F @param {import('../types.js').Level[]} levels
   *  @returns {import('../types.js').OccResult & {modulus:number, phase:number, detail:string, base:number, apex:number}} */
  function fieldOcc(F, levels){
    const started = performance.now();
    const c = fieldParams(F, levels);
    // The grid is R0; `par` is the parity the formula wants (repeat: the tile's).
    const R = c.R0, h = c.h0, par = c.par, N = R * R * R;
    const els = GROUPS[F.sym].els, nE = els.length;
    const kind = F.formula | 0, fk = F.frame | 0, real = REAL.has(kind);
    const duty = F.density, inv = 1 / (h || 1);

    const q = [0, 0, 0], v = [0, 0, 0];
    // Nearest grid-parity integer, mirrored about 0 so a tie can't snap a
    // voxel and its mirror image differently.
    const up = t => 2 * Math.round((t - par) / 2) + par;
    const snap = t => t >= 0 ? up(t) : -up(-t);
    const idx = t => (t + h) / 2;
    const evaluate = (X, Y, Z) => { frame(fk, X, Y, Z, c, q); return formula(kind, snap(q[0]), snap(q[1]), snap(q[2]), c); };

    /* One orbit at a time, as bimoblocks do: the formula and the clip are
       evaluated once, at the orbit's first cell in scan order, and the
       whole orbit takes that answer, so the fold is exact. `visit` gets
       the representative and whether it is inside the clip; `mark` each
       cell of its orbit. */
    function orbits(visit, mark){
      const visited = new Uint8Array(N);
      for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
        if (visited[x + R * y + R * R * z]) continue;
        const X = 2*x - h, Y = 2*y - h, Z = 2*z - h;
        const inside = envelope(X * inv, Y * inv, Z * inv, F.arch);
        visit(X, Y, Z, inside);
        v[0] = X; v[1] = Y; v[2] = Z;
        for (let e = 0; e < nE; e++){
          const w = nE > 1 ? applyG(v, els[e]) : v;
          const cell = idx(w[0]) + R * idx(w[1]) + R * R * idx(w[2]);
          if (visited[cell]) continue;
          visited[cell] = 1;
          if (inside && mark) mark(cell);
        }
      }
    }

    /* A real formula is banded across the values it actually takes in this
       specimen: a coarse grid can step right over a thin sheet, and a range
       measured elsewhere would then leave every cell above the duty. So the
       cells nearest the sheet are always band 0, and the specimen is never
       empty. k's phase nudge starts the bands s of a band higher, at the
       first value a cell here takes, so a window still starts on a cell.
       Pascal likewise counts carries from the fewest any cell here has: a
       clip can cut away every no-carry cell of a corner apex. Integers
       keep the exact cartesian modulus. */
    const ki = c.ki;
    let lo = 0, { m, phase } = bandsOf(F, c);
    if (real || kind === FORMULA_PASCAL){
      let mn = Infinity, mx = -Infinity;
      const seen = real && ki ? [] : null;
      orbits((X, Y, Z, inside) => {
        if (!inside) return;
        const g = evaluate(X, Y, Z);
        if (g < mn) mn = g;
        if (g > mx) mx = g;
        if (seen) seen.push(g);
      });
      lo = mn < Infinity ? mn : 0;
      if (real) m = mx > mn ? (mx - mn) / BANDS[Math.max(0, Math.min(BANDS.length - 1, F.bands | 0))] : 1;
      if (seen && mx > mn){
        const want = mn + K_SHIFT[ki] * m;
        let next = Infinity;
        for (const g of seen) if (g >= want && g < next) next = g;
        lo = next;
      }
    }
    // Integers at a rational k stay exact: (a·g mod n)/n with k = a/n.
    const exact = !real && ki < 2, kNum = ki === 1 ? 2 : 1, kDen = ki === 1 ? 2 * m + 1 : m;
    const kReal = 1 / (m + (real ? 0 : K_SHIFT[ki]));
    if (kind === FORMULA_PASCAL || real) phase = 0;

    const occ = new Uint8Array(N), orbit = new Uint8Array(N);
    let filled = 0, envelopeCells = 0, keep = false, band = 0;
    const select = () => orbits((X, Y, Z, inside) => {
      keep = false; band = 0;
      if (!inside) return;
      const g = evaluate(X, Y, Z) + phase;
      if (kind === FORMULA_PASCAL){
        // Carries counted in quarters: duty < ¼ keeps Pascal mod b, more
        // duty also keeps the cells b divides once, twice…
        keep = Math.min(g - lo, 3.996) / 4 < duty; band = g;
      } else if (exact){
        const a = kNum * g;
        keep = imod(a, kDen) / kDen < duty; band = Math.floor(a / kDen);
      } else {
        const t = (g - lo) * kReal;
        band = Math.floor(t); keep = t - band < duty;
      }
      band = ((band % BAND_HUES) + BAND_HUES) % BAND_HUES;
    }, cell => {
      envelopeCells++;
      if (keep){ occ[cell] = 1; orbit[cell] = band; filled++; }
    });
    select();
    // A phase moves the window off g = 0; where a clip or a collapsed
    // frame leaves no cell in it, the step keeps phase 0 rather than empty.
    if (!filled && phase){ phase = 0; envelopeCells = 0; select(); }
    return { occ, R, filled, envelopeCells, orbit, orbitOrder: BAND_HUES,
      modulus: m, phase, detail: detailOf(F, c), base: c.base, apex: c.apex,
      timings: { evaluate: performance.now() - started, select: 0 } };
  }

  /** @param {import('../types.js').FieldRecipe} F @param {import('../types.js').Level[]} levels
   *  @returns {import('../types.js').BuildResult} */
  function buildField(F, levels){
    const started = performance.now();
    const src = fieldOcc(F, levels);
    const instances = bimo.instanceArrays(src.occ, 0, src.filled, levels, src.R, src.orbit, src.orbitOrder);
    return { occ: src.occ, R: src.R, filled: src.filled, envelopeCells: src.envelopeCells, instances,
      meta: { modulus: src.modulus, phase: src.phase, detail: src.detail, base: src.base, apex: src.apex },
      timings: { evaluate: src.timings.evaluate, select: 0,
        mesh: instances.timings.mesh, bounds: instances.timings.bounds,
        total: performance.now() - started } };
  }

  return { FRAME_NAMES, FORMULA_NAMES, BANDS, BAND_HUES, K_NAMES, buildField, fieldOcc, modulus, formulaRange, quadricSigns, pascalStep, bandStep };
}
