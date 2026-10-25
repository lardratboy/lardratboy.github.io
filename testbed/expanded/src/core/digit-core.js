/* ================== NUMBER PICTURE CORE ==============================
   Generator #4 (`?g=digit`, design in newground.md and whatnext.md §2):
   the digits of a number sequence, drawn as voxels. Low digits of a sum
   or a product are periodic, high digits are carry noise, and a number's
   digit count is its size, so one specimen runs from crystal to
   turbulence and its growth rate draws its silhouette.

     shape   what x, y, z mean
       stack   x, z = two indices of a number a(x, z); y = digit position
       lathe   y = the index n of a(n); the distance from the y axis = digit
               position, units on the axis, spun round inside the
               inscribed cylinder
     number  a family, and the seed picks the member: Lucas sequences,
             powers, Pascal-like rules (integers: digits from the units
             up, so they run out at the number's size), or a product with
             an irrational, quadratic, cubic or transcendental (digits
             after the point, which never run out), or a Collatz-like
             map, whose "digits" are the units digits of the trajectory
             n, T(n), T²(n), …: one step per digit place
     base    2, 10, 3, balanced ternary, negabinary, Zeckendorf
     keep    digit ≥ t, t from the density (t = 1 is digit ≠ 0), clipped
             by the archetype, folded by the group

   then the shared instanceArrays(), so everything downstream is shared.

   Digits are exact: integers are BigInts, and an irrational α is the
   fixed-point BigInt floor(α·2^P), so fract(α·m) is (A·m) mod 2^P. Every
   engine draws the same picture, and a digit near the growth edge is
   never decided by float rounding.

   Pure like the other cores: no DOM, no THREE, runs in the worker.
   ================================================================ */
import { createBimoblockCore } from './bimoblock-core.js';

export const SHAPE_NAMES = ['stack', 'lathe'];
/* Only ever appended: indices are in the goldens and permalinks. Each
   number is a family; the seed picks the member (numberMember). */
export const NUMBER_NAMES = ['lucas', 'powers', 'pascal', 'quadratic × α', 'figurate × α', 'n·quadratic', 'n·cubic', 'n·transcendental', 'collatz'];
export const COLLATZ = NUMBER_NAMES.indexOf('collatz');
/* Numbers whose digits are taken after the point. */
export const FRACTIONAL = [3, 4, 5, 6, 7];
/* Only ever appended, likewise. `levels` is the count of nonzero digit
   values, the steps the density threshold has. */
export const BASE_NAMES = ['2', '10', '3', 'balanced 3', '−2', 'φ'];
const BASE_KIND = [
  { radix:2,  levels:1 }, { radix:10, levels:9 }, { radix:3, levels:2 },
  { balanced:true, levels:2 }, { nega:true, levels:1 }, { zeck:true, levels:1 }
];
/* A base with one nonzero digit colours by the digit position instead
   (stack: the plane, lathe: the ring), cycled through this many hues. */
export const POSITION_HUES = 8;

/* ---- the families ----------------------------------------------------
   Lucas sequences a(n) = P·a(n−1) + Q·a(n−2), Q > 0 so they stay
   positive, P² + 4Q never a square so the root λ is irrational. The lathe
   starts from U (1, P: Fibonacci) or V (2, P: the Lucas numbers); the
   stack is the generalised Wythoff array of (P, Q). */
export const LUCAS_PQ = [[1, 1], [2, 1], [1, 3], [3, 1], [2, 2], [3, 2], [3, 3]];
/* Powers: cⁿ on the lathe, (x + c)ᶻ on the stack. A c that is a power of
   the base would be one digit, so the next one is taken instead. */
export const POWER_C = [3, 5, 6, 7, 11, 12, 13, 14];
export const STACK_C = [2, 3, 5, 6, 7];
/* Pascal-like rules a(x, z) = p·a(x−1, z) + q·a(x, z−1) + r·a(x−1, z−1),
   ones along both edges. p, q odd and r even keep bit 0 Sierpinski's
   triangle (C(x+z, x) mod 2), so they differ in their carries; ones like
   Delannoy's (r = 1) are always odd and their low bits plainly periodic.
   p ≠ q is lopsided. The lathe reads the central column. */
export const PASCAL_RULES = [
  { p:1, q:1, r:0 }, { p:1, q:1, r:2 }, { p:1, q:1, r:4 }, { p:3, q:3, r:0 },
  { p:3, q:3, r:-2 }, { p:3, q:1, r:0 }, { p:1, q:3, r:2 }
];
/* Quadratic forms in the stack's two indices, u, v counted from the
   corner (from 1) or from the centre (doubled, so they stay integers). */
export const FORMS = [
  { name:'u·v',          f:(u, v) => u * v },
  { name:'u² + v²',      f:(u, v) => u * u + v * v },
  { name:'u² − v²',      f:(u, v) => u * u - v * v },
  { name:'u² + u·v + v²',f:(u, v) => u * u + u * v + v * v },
  { name:'u² + v',       f:(u, v) => u * u + v },
  { name:'u·v·(u + v)',  f:(u, v) => u * v * (u + v) }
];
/* The lathe's figurate numbers are s-gonal, s picked by the seed. The
   stack walks s along x. */
export const FIGURATE_S = [3, 5, 6, 7, 8];
/* Cubic irrationals: the real root of x³ = a·x² + b·x + c, each one
   irreducible (no integer root) and the only root above 1. */
export const CUBICS = [
  { a:0, b:0, c:2, name:'∛2' }, { a:0, b:0, c:3, name:'∛3' }, { a:0, b:0, c:5, name:'∛5' },
  { a:0, b:0, c:7, name:'∛7' }, { a:0, b:1, c:1, name:'ρ (x³ = x + 1)' },
  { a:1, b:0, c:1, name:'ψ (x³ = x² + 1)' }, { a:1, b:1, c:1, name:'tribonacci' },
  { a:0, b:1, c:3, name:'x³ = x + 3' }, { a:2, b:0, c:1, name:'x³ = 2x² + 1' }
];
export const TRANSCENDENTALS = ['π', 'e', 'ln 2', 'ln 3'];
/* Collatz-like maps: n ≡ r (mod m) ↦ (a_r·n + b_r) / m, each branch an
   integer for its residue and positive from n ≥ 1, and 1 on a cycle, so
   a trajectory that reaches 1 ends there. Only ever appended. The first
   is the Collatz map with its halving folded in, T(n) = (3n + 1)/2 on odd
   n: its first k parities are a bijection of n mod 2^k, so the floor of a
   stack is a binary counter and the chaos starts above it. 3n − 1 has
   other cycles (5, 7, 10 and one of 17); 5n + 1 escapes for most n;
   Conway's is the original Collatz permutation, 2n/3, (4n ∓ 1)/3, with
   8's orbit still open; the last contracts by 16/27 a round. */
export const COLLATZ_MAPS = [
  { name:'3n + 1',              m:2, a:[1, 3],    b:[0, 1] },
  { name:'3n − 1',              m:2, a:[1, 3],    b:[0, -1] },
  { name:'3n + 5',              m:2, a:[1, 3],    b:[0, 5] },
  { name:'5n + 1',              m:2, a:[1, 5],    b:[0, 1] },
  { name:'Conway 2n, 4n ∓ 1 / 3', m:3, a:[2, 4, 4], b:[0, -1, 1] },
  { name:'n, 4n + 2, 4n + 1 / 3', m:3, a:[1, 4, 4], b:[0, 2, 1] },
];
/* Morton (Z-order) index of (x, z): x on the even bits, z on the odd. */
export function morton(x, z){
  let n = 0;
  for (let b = 0; b < 8; b++) n |= ((x >> b) & 1) << (2 * b) | ((z >> b) & 1) << (2 * b + 1);
  return n;
}

/* Squarefree d up to 200, for (a + √d) / c. */
export const QUAD_D = [];
for (let d = 2; d < 200; d++){
  let sq = false;
  for (let k = 2; k * k <= d; k++) if (d % (k * k) === 0) sq = true;
  if (!sq) QUAD_D.push(d);
}

/* What each number is, per shape, for the inspector; the member is in
   `meta.detail`. */
export const NUMBER_TEXT = [
  { lathe: 'a(n) = P·a(n−1) + Q·a(n−2)', stack: 'Wythoff array of (P, Q)' },
  { lathe: 'cⁿ',                         stack: '(x+c)ᶻ' },
  { lathe: 'the rule\'s central column', stack: 'a(x, z) = p·a(x−1, z) + q·a(x, z−1) + r·a(x−1, z−1)' },
  { lathe: 'fract(α·nᵏ)',                stack: 'fract(α·q(u, v))' },
  { lathe: 'fract(α·P(s, n))',           stack: 'fract(α·P(x+3, z))' },
  { lathe: 'fract(n·α), α quadratic',    stack: 'fract(α·id), α quadratic' },
  { lathe: 'fract(n·α), α cubic',        stack: 'fract(α·id), α cubic' },
  { lathe: 'fract(n·α), α transcendental', stack: 'fract(α·id), α transcendental' },
  { lathe: 'units digit of Tᵏ(n) at ring k', stack: 'units digit of Tʸ(n), n over x, z' },
];

/* ---- fixed point ---------------------------------------------------
   P bits after the point. Base 10 at R = 64 reads 64 digits (213 bits) of
   fract(α·m) with m < 2^18, so 320 leaves ~90 bits of margin. */
const P = 320n, ONE = 1n << P, MASK = ONE - 1n;

function isqrt(n){
  if (n < 2n) return n;
  let x = 1n << BigInt((n.toString(2).length >> 1) + 1);   // ≥ √n, so Newton descends
  for (;;){ const y = (x + n / x) >> 1n; if (y >= x) return x; x = y; }
}
/* floor((a + √d)/c · 2^P), exactly: floor((m + floor(y))/c) = floor((m + y)/c). */
const quadFixed = (a, d, c) => (BigInt(a) * ONE + isqrt(BigInt(d) << (2n * P))) / BigInt(c);
/* The root of x³ = a·x² + b·x + c above 1, by bisection on [1, 4]. */
function cubicFixed({ a, b, c }){
  let lo = ONE, hi = 4n * ONE;
  const A = BigInt(a), B = BigInt(b), C = BigInt(c), ONE2 = ONE * ONE, ONE3 = ONE2 * ONE;
  while (hi - lo > 1n){
    const mid = (lo + hi) >> 1n;
    if (mid * mid * mid - A * mid * mid * ONE - B * mid * ONE2 - C * ONE3 > 0n) hi = mid; else lo = mid;
  }
  return lo;
}
/* Transcendentals by series at 64 guard bits, then truncated. */
const G = 64n, W = P + G, ONEW = 1n << W;
function atanInv(k, hyperbolic){          // atan(1/k) or atanh(1/k)
  const K = BigInt(k), K2 = K * K;
  let term = ONEW / K, sum = 0n;
  for (let i = 0n; term; i++){
    const t = term / (2n * i + 1n);
    sum += hyperbolic || i % 2n === 0n ? t : -t;
    term /= K2;
  }
  return sum;
}
function transcendentalFixed(i){
  let v;
  if (i === 0) v = 16n * atanInv(5) - 4n * atanInv(239);          // Machin
  else if (i === 1){ v = 0n; for (let t = ONEW, k = 1n; t; k++){ v += t; t /= k; } }
  else if (i === 2) v = 2n * atanInv(3, true);                      // ln 2 = 2·atanh(1/3)
  else v = 2n * atanInv(2, true);                                   // ln 3 = 2·atanh(1/2)
  return v >> G;
}
const ALPHA_CACHE = new Map();
const fixedOf = (key, make) => {
  let v = ALPHA_CACHE.get(key);
  if (v === undefined){ v = make(); ALPHA_CACHE.set(key, v); }
  return v;
};

/** The s-gonal number P(s, n) = ((s−2)n² − (s−4)n) / 2.
 *  @param {number} s @param {number} n */
export function figurate(s, n){
  const S = BigInt(s), N = BigInt(n);
  return ((S - 2n) * N * N - (S - 4n) * N) / 2n;
}

/* ---- writing a number in a base -------------------------------------
   Each writes `room` digit levels into out[at…], 0 for a zero digit and
   1…levels for the nonzero ones (balanced ternary: −1 is 1, +1 is 2).
   Integers go units first and return their digit count. A fraction f/2^P
   goes most significant first: its first `room` digits are the room-digit
   expansion of its rank ⌊f·C⌋ among the C strings of that length, which
   for an ordinary base is just the digits after the point. */
function maskOdd(bits){                    // 1s at the odd places below `bits`
  const k = BigInt((bits + 1) >> 1);
  return ((1n << (2n * k)) - 1n) / 3n * 2n & ((1n << BigInt(bits)) - 1n);
}
const FIB = [1n, 2n];                      // FIB[i] = F(i + 2): place i of a Zeckendorf string
const fibAt = i => { while (FIB.length <= i) FIB.push(FIB[FIB.length - 1] + FIB[FIB.length - 2]); return FIB[i]; };

/* A non-negative BigInt's balanced-ternary digits, units first, as levels. */
function balancedLevels(a){
  const s = a.toString(3), out = [];
  let carry = 0;
  for (let i = s.length - 1; i >= 0; i--){
    const t = s.charCodeAt(i) - 48 + carry;
    carry = t >= 2 ? 1 : 0;
    out.push(t === 1 ? 2 : t === 2 ? 1 : 0);
  }
  if (carry) out.push(2);
  return out;
}
/* Zeckendorf places of a non-negative BigInt, greedy from the top. */
function zeckBits(a){
  let i = 0;
  while (fibAt(i + 1) <= a) i++;
  const out = new Uint8Array(a > 0n ? i + 1 : 0);
  for (; i >= 0 && a > 0n; i--) if (fibAt(i) <= a){ out[i] = 1; a -= fibAt(i); }
  return out;
}

function intDigits(a, kind, room, out, at){
  if (kind.balanced){
    const l = balancedLevels(a);
    for (let d = 0; d < room; d++) out[at + d] = l[d] ?? 0;
    return l.length;
  }
  if (kind.zeck){
    const z = zeckBits(a);
    for (let d = 0; d < room; d++) out[at + d] = z[d] ?? 0;
    return z.length;
  }
  if (kind.nega){
    const bits = a.toString(2).length + 3, M = maskOdd(bits);
    a = (a + M) ^ M;
  }
  const s = a.toString(kind.radix ?? 2), L = a ? s.length : 0;
  for (let d = 0; d < room; d++) out[at + d] = d < L ? s.charCodeAt(L - 1 - d) - 48 : 0;
  return L;
}
function fracDigits(A, m, kind, room, out, at){
  const f = (A * m) & MASK;
  if (kind.zeck){
    let r = (f * fibAt(room)) >> P;                       // rank among F(room + 2) strings
    for (let d = 0; d < room; d++){
      const i = room - 1 - d, F = fibAt(i);
      out[at + d] = r >= F ? 1 : 0;
      if (r >= F) r -= F;
    }
    return;
  }
  if (kind.balanced){
    const C = 3n ** BigInt(room), v = ((f * C) >> P) - (C - 1n) / 2n;
    const l = balancedLevels(v < 0n ? -v : v);
    for (let d = 0; d < room; d++){
      const x = l[room - 1 - d] ?? 0;
      out[at + d] = v < 0n && x ? 3 - x : x;              // negate: −1 ↔ +1
    }
    return;
  }
  const b = kind.radix ?? 2;
  let r = (f * BigInt(b) ** BigInt(room)) >> P;
  if (kind.nega) r ^= maskOdd(room);
  const s = r.toString(b).padStart(room, '0');
  for (let d = 0; d < room; d++) out[at + d] = s.charCodeAt(d) - 48;
}

/* The units digit of a positive integer in a base, as a level. Balanced
   ternary's is n mod 3 (2 is −1), negabinary's the parity, Zeckendorf's
   whether the greedy sum uses the last 1. */
function unitLevel(t, kind){
  if (kind.balanced){ const r = Number(t % 3n); return r === 1 ? 2 : r === 2 ? 1 : 0; }
  if (kind.zeck) return zeckBits(t)[0] ?? 0;
  return Number(t % BigInt(kind.radix ?? 2));
}

/* The threshold the density sets: keep a digit at level ≥ t. Density
   1 − 1/(levels + 1) and above keeps every nonzero digit. */
export function keepFrom(levels, density){
  return Math.min(levels, Math.max(1, Math.ceil((levels + 1) * (1 - density) - 1e-9)));
}

/** @param {ReturnType<typeof createBimoblockCore>} [bimo] reuse an existing bimoblock core */
export function createDigitCore(bimo = createBimoblockCore()){
  const { GROUPS, applyG, envelope, levelResolution, seedWords } = bimo;

  /* A seeded choice among n, salted per use so the picks are independent. */
  const seedPick = (seed, salt, n) => {
    const { lo, hi } = seedWords(seed);
    let h = Math.imul(lo ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ hi ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x27d4eb2d) >>> 0;
    return ((h ^ (h >>> 15)) >>> 0) % n;
  };

  /* An irrational from one pool, as {A, name}. */
  const quadratic = seed => {
    const d = QUAD_D[seedPick(seed, 11, QUAD_D.length)], c = 1 + seedPick(seed, 12, 3), a = seedPick(seed, 13, c);
    return { A: fixedOf(`q${a},${d},${c}`, () => quadFixed(a, d, c)), quad: { a, d, c },
             name: c === 1 ? `√${d}` : `(${a ? a + ' + ' : ''}√${d}) / ${c}` };
  };
  const cubic = seed => {
    const k = seedPick(seed, 14, CUBICS.length);
    return { A: fixedOf('c' + k, () => cubicFixed(CUBICS[k])), cubic: CUBICS[k], name: CUBICS[k].name };
  };
  const transcendental = seed => {
    const k = seedPick(seed, 15, TRANSCENDENTALS.length);
    return { A: fixedOf('t' + k, () => transcendentalFixed(k)), name: TRANSCENDENTALS[k] };
  };
  const anyAlpha = seed => [quadratic, cubic, transcendental][seedPick(seed, 16, 3)](seed);

  const isPowerOf = (c, b) => { if (!b) return false; while (c % b === 0) c /= b; return c === 1; };

  /** The seeded member of a recipe's number family: its parameters and a
   *  short text for the inspector. @param {import('../types.js').DigitRecipe} D */
  function numberMember(D){
    const kind = D.number | 0, lathe = (D.shape | 0) === 1, seed = D.seed, radix = BASE_KIND[D.base | 0]?.radix;
    if (kind === 0){
      const [p, q] = LUCAS_PQ[seedPick(seed, 1, LUCAS_PQ.length)], v = lathe && seedPick(seed, 2, 2) === 1;
      const lam = fixedOf(`l${p},${q}`, () => quadFixed(p, p * p + 4 * q, 2));
      return { p, q, v, lam, detail: `P ${p} · Q ${q}` + (lathe ? (v ? ' · from 2, P (V)' : ' · from 1, P (U)') : '') };
    }
    if (kind === 1){
      const list = lathe ? POWER_C : STACK_C;
      let k = seedPick(seed, 3, list.length);
      while (lathe && isPowerOf(list[k], radix)) k = (k + 1) % list.length;
      return { c: list[k], detail: `c ${list[k]}` };
    }
    if (kind === 2){
      const rule = PASCAL_RULES[seedPick(seed, 4, PASCAL_RULES.length)];
      return { rule, detail: rule.r === 0 && rule.p === 1 && rule.q === 1 ? 'binomial C(x+z, x)' : `p ${rule.p} · q ${rule.q} · r ${rule.r}` };
    }
    const alpha = kind === 5 ? quadratic(seed) : kind === 6 ? cubic(seed) : kind === 7 ? transcendental(seed) : anyAlpha(seed);
    if (kind === 3){
      if (lathe){ const e = 2 + seedPick(seed, 5, 2); return { alpha, e, detail: `α ${alpha.name} · n${e === 2 ? '²' : '³'}` }; }
      const form = FORMS[seedPick(seed, 6, FORMS.length)], centred = seedPick(seed, 7, 2) === 1;
      return { alpha, form, centred, detail: `α ${alpha.name} · q ${form.name}${centred ? ' · centred' : ''}` };
    }
    if (kind === 4){
      const s = FIGURATE_S[seedPick(seed, 8, FIGURATE_S.length)];
      return { alpha, s, detail: `α ${alpha.name}` + (lathe ? ` · s ${s}` : ' · s 3 … along x') };
    }
    if (kind === COLLATZ){
      /* The map; where the numbers start (from 1 in about one seed in four,
         so trajectories land on 1 inside the cube and the top is a skyline;
         otherwise anywhere up to 2^37); and, on a stack, raster or Morton
         order over x, z (Morton spreads the low bits over both, so the
         floor's counter is a checkerboard rather than stripes). */
      const map = COLLATZ_MAPS[seedPick(seed, 20, COLLATZ_MAPS.length)];
      const e = seedPick(seed, 21, 37);
      let n0 = 1n;
      if (e >= 10){
        const r = (BigInt(seedPick(seed, 22, 0x40000000)) << 7n | BigInt(seedPick(seed, 23, 128))) & ((1n << BigInt(e)) - 1n);
        n0 = (1n << BigInt(e)) + r;
      }
      const z = !lathe && seedPick(seed, 24, 2) === 1;
      return { map, n0, morton: z, detail: `${map.name} · n from ${n0}${lathe ? '' : z ? ' · Morton order' : ' · raster order'}` };
    }
    return { alpha, detail: `α ${alpha.name}` };
  }

  /* The lathe's ring index at doubled centred coordinates (X, Z): the
     voxel's distance from the axis in voxels, floored, or -1 outside the
     inscribed cylinder. floor(√(q/4)) = floor(√⌊q/4⌋), an exact integer root. */
  const ringOf = (X, Z, R) => {
    const q = X * X + Z * Z;
    return q < R * R ? Math.floor(Math.sqrt(q >> 2)) : -1;
  };

  /* A Pascal-like rule over an n × n grid, row-major a[x][z]. */
  function pascalGrid({ p, q, r }, n){
    const P_ = BigInt(p), Q_ = BigInt(q), R_ = BigInt(r), rows = [];
    for (let x = 0; x < n; x++){
      const cur = new Array(n);
      for (let z = 0; z < n; z++)
        cur[z] = x === 0 || z === 0 ? 1n : P_ * rows[x - 1][z] + Q_ * cur[z - 1] + R_ * rows[x - 1][z - 1];
      rows.push(cur);
    }
    return rows;
  }

  /* The digit table: one row of `room` digit levels per number. Stack: R²
     numbers, a(x, z) at row x + R·z, room R. Lathe: R numbers, a(n) at
     row n = y, room = the rings that fit. Returns the table and the
     largest digit count an integer number has (null after the point). */
  function digitTable(D, R, M){
    const kind = D.number | 0, base = BASE_KIND[D.base | 0] ?? BASE_KIND[0], lathe = (D.shape | 0) === 1;
    const room = lathe ? Math.floor(Math.sqrt((R * R - 1) >> 2)) + 1 : R;
    const rows = lathe ? R : R * R;
    const table = new Uint8Array(rows * room);
    let top = 0, reached = 0;
    const int = (row, a) => { top = Math.max(top, intDigits(a, base, room, table, row * room)); };
    const frac = (row, A, m) => fracDigits(A, m, base, room, table, row * room);

    if (kind === 0){
      const P_ = BigInt(M.p), Q_ = BigInt(M.q);
      if (lathe){
        let a0 = M.v ? 2n : 1n, a1 = P_;
        for (let n = 0; n < R; n++){ int(n, a0); [a0, a1] = [a1, P_ * a1 + Q_ * a0]; }
      } else {
        // Row x starts ⌊aλ⌋, ⌊aλ²⌋ = P·⌊aλ⌋ + Q·a with a = ⌊(x+1)λ⌋ (λ² = Pλ + Q).
        // At (1, 1) this is the Wythoff array, every positive integer once.
        for (let x = 0; x < R; x++){
          const a = (BigInt(x + 1) * M.lam) >> P;
          let w0 = (a * M.lam) >> P, w1 = P_ * w0 + Q_ * a;
          for (let z = 0; z < R; z++){ int(x + R * z, w0); [w0, w1] = [w1, P_ * w1 + Q_ * w0]; }
        }
      }
    } else if (kind === 1){
      if (lathe){
        const c = BigInt(M.c);
        let p = 1n;
        for (let n = 0; n < R; n++){ int(n, p); p *= c; }
      } else for (let x = 0; x < R; x++){
        const c = BigInt(x + M.c);
        let p = 1n;
        for (let z = 0; z < R; z++){ int(x + R * z, p); p *= c; }
      }
    } else if (kind === 2){
      if (lathe){
        const g = pascalGrid(M.rule, (R >> 1) + 1);
        for (let n = 0; n < R; n++) int(n, g[(n + 1) >> 1][n >> 1]);
      } else {
        const g = pascalGrid(M.rule, R);
        for (let x = 0; x < R; x++) for (let z = 0; z < R; z++) int(x + R * z, g[x][z]);
      }
    } else if (kind === COLLATZ){
      // One step per digit place; a trajectory that reaches 1 ends there.
      const Mm = BigInt(M.map.m), A = M.map.a.map(BigInt), B = M.map.b.map(BigInt);
      const walk = (row, t) => {
        for (let s = 0; s < room; s++){
          table[row * room + s] = unitLevel(t, base);
          if (t === 1n){ reached++; return; }
          const r = Number(t % Mm);
          t = (A[r] * t + B[r]) / Mm;
        }
      };
      if (lathe) for (let n = 0; n < R; n++) walk(n, M.n0 + BigInt(n));
      else for (let z = 0; z < R; z++) for (let x = 0; x < R; x++)
        walk(x + R * z, M.n0 + BigInt(M.morton ? morton(x, z) : x + R * z));
    } else if (lathe){
      for (let n = 0; n < R; n++){
        const m = BigInt(n + 1);
        frac(n, M.alpha.A, kind === 3 ? m ** BigInt(M.e) : kind === 4 ? figurate(M.s, n + 1) : m);
      }
    } else {
      const h = R - 1;
      for (let z = 0; z < R; z++) for (let x = 0; x < R; x++){
        let m;
        if (kind === 3){
          const u = M.centred ? 2 * x - h : x + 1, v = M.centred ? 2 * z - h : z + 1;
          m = BigInt(M.form.f(u, v));
        } else m = kind === 4 ? figurate(x + 3, z + 1) : BigInt(1 + x + R * z);   // the grid id, raster order
        frac(x + R * z, M.alpha.A, m);
      }
    }
    return { table, room, top: FRACTIONAL.includes(kind) || kind === COLLATZ ? null : top, base, lathe,
             reached: kind === COLLATZ ? reached : null, count: rows };
  }

  /** @param {import('../types.js').DigitRecipe} D @param {import('../types.js').Level[]} levels
   *  @returns {import('../types.js').OccResult & {detail:string, digits:number|null, room:number, base:string, keep:number, levels:number, reached:number|null, count:number}} */
  function digitOcc(D, levels){
    const started = performance.now();
    const R = levelResolution(levels), h = R - 1, N = R * R * R, inv = 1 / (h || 1);
    const member = numberMember(D);
    const { table, room, top, base, lathe, reached, count } = digitTable(D, R, member);
    const L = base.levels, t = keepFrom(L, D.density ?? 1);
    const els = GROUPS[D.sym].els, nE = els.length;

    /* The digit level at a voxel and its position, or a position of -1
       outside the lathe's cylinder. */
    let pos = 0;
    const digitAt = (X, Y, Z) => {
      const x = (X + h) / 2, y = (Y + h) / 2, z = (Z + h) / 2;
      if (lathe){
        pos = ringOf(X, Z, R);
        return pos < 0 ? 0 : table[y * room + pos];
      }
      pos = y;
      return table[(x + R * z) * room + y];
    };

    /* One orbit at a time, as mod fields do: the digit and the clip are
       read once, at the orbit's first cell in scan order, and the whole
       orbit takes that answer, so the fold is exact. */
    const occ = new Uint8Array(N), orbit = new Uint8Array(N), visited = new Uint8Array(N);
    const idx = t => (t + h) / 2, v = [0, 0, 0];
    const hues = L === 1 ? POSITION_HUES : L;
    let filled = 0, envelopeCells = 0;
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
      if (visited[x + R * y + R * R * z]) continue;
      const X = 2*x - h, Y = 2*y - h, Z = 2*z - h;
      const inside = envelope(X * inv, Y * inv, Z * inv, D.arch);
      const level = inside ? digitAt(X, Y, Z) : 0;
      const counted = inside && pos >= 0, kept = level >= t;
      const hue = L === 1 ? pos % POSITION_HUES : level - 1;
      v[0] = X; v[1] = Y; v[2] = Z;
      for (let e = 0; e < nE; e++){
        const w = nE > 1 ? applyG(v, els[e]) : v;
        const cell = idx(w[0]) + R * idx(w[1]) + R * R * idx(w[2]);
        if (visited[cell]) continue;
        visited[cell] = 1;
        if (counted) envelopeCells++;
        if (kept){ occ[cell] = 1; orbit[cell] = hue; filled++; }
      }
    }
    return { occ, R, filled, envelopeCells, orbit, orbitOrder: hues,
      detail: member.detail, digits: top, room, base: BASE_NAMES[D.base | 0], keep: t, levels: L, reached, count,
      timings: { evaluate: performance.now() - started, select: 0 } };
  }

  /** @param {import('../types.js').DigitRecipe} D @param {import('../types.js').Level[]} levels
   *  @returns {import('../types.js').BuildResult} */
  function buildDigit(D, levels){
    const started = performance.now();
    const src = digitOcc(D, levels);
    const instances = bimo.instanceArrays(src.occ, 0, src.filled, levels, src.R, src.orbit, src.orbitOrder);
    return { occ: src.occ, R: src.R, filled: src.filled, envelopeCells: src.envelopeCells, instances,
      meta: { detail: src.detail, digits: src.digits, room: src.room, base: src.base, keep: src.keep, levels: src.levels,
              ...(src.reached === null ? {} : { reached: src.reached, count: src.count }) },
      timings: { evaluate: src.timings.evaluate, select: 0,
        mesh: instances.timings.mesh, bounds: instances.timings.bounds,
        total: performance.now() - started } };
  }

  return { SHAPE_NAMES, NUMBER_NAMES, BASE_NAMES, buildDigit, digitOcc, numberMember, seedPick };
}
