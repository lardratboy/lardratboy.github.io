/* ================== CARRY CORE =======================================
   Generator #5 (`?g=carry`, design in whatnext.md §3–§7): a digit
   picture is a row of cells that each overflow into the next one. Send
   the carry somewhere else and the same idea makes whole 3D objects,
   computed exactly from integers:

     rule      where the carry goes
       powers    into a stencil, mod p, step after step: the voxels where
                 the coefficient of f(X, Y, Z)ᵀ is nonzero mod p. By
                 Lucas's theorem fᵀ = Π f(X^(pⁱ))^(tᵢ) over the base-p
                 digits tᵢ of T, so T's digits are the specimen's recipe
       sandpile  to the neighbours: N grains on the centre, and any voxel
                 holding as many grains as it has neighbours topples, one
                 to each. Base-k counting in space; the stable pile is
                 unique (abelian), whatever the toppling order

   Dials (each a small integer, so any of them can be an axis role):
     stencil  the rule's neighbourhood (STENCIL_NAMES[rule])
     step     powers: T counts down from the largest that fits;
              sandpile: the grain count, in steps of √2
     level    powers: the prime p; sandpile: which stable values are kept
   The seed picks the rest: the stencil's coefficients mod p, the
   sandpile's sources. Kept voxels are coloured by value.

   then the shared instanceArrays(), so everything downstream is shared.
   Pure like the other cores: no DOM, no THREE, runs in the worker.
   ================================================================ */
import { createBimoblockCore } from './bimoblock-core.js';

/* Only ever appended, like every catalogue here: indices are in the
   goldens and permalinks. */
export const RULE_NAMES = ['powers', 'sandpile'];
export const STEPS = 8;
export const PRIMES = [2, 3, 5, 7];
export const KEEP_NAMES = ['top value', 'top two', 'top half', 'nonzero'];
export const LEVEL_NAMES = [PRIMES.map(p => 'p ' + p), KEEP_NAMES];

/* ---- stencils --------------------------------------------------------
   The 3×3×3 neighbourhood splits into four Oh orbits: the centre, the six
   faces, the twelve edges and the eight corners. A symmetric stencil is a
   set of orbits, so the specimen keeps all 48 symmetries of the cube. */
const ORBITS = { C: [], F: [], E: [], K: [] };
for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++){
  const n = Math.abs(x) + Math.abs(y) + Math.abs(z);
  ORBITS['CFEK'[n]].push([x, y, z]);
}
const ORBIT_NAMES = { C:'centre', F:'faces', E:'edges', K:'corners' };
/* Powers. `classes` stencils are centred; `tetra` is 1 + X + Y + Z, from a
   corner, whose powers fill the corner tetrahedron (mod 2: Sierpinski's);
   `time` is a 2D stencil in x, z with y as time, apex at the top. */
export const POWER_STENCILS = [
  { name:'faces + centre',   classes:'CF' },
  { name:'faces',            classes:'F' },
  { name:'corners + centre', classes:'CK' },
  { name:'faces + corners',  classes:'FK' },
  { name:'edges + centre',   classes:'CE' },
  { name:'all 27',           classes:'CFEK' },
  { name:'tetra 1 + X + Y + Z', tetra:true },
  { name:'time: plus in x, z',  time:true },
];
/* Sandpile neighbourhoods; the threshold is their size. `far` adds the
   six cells two steps out along the axes. */
export const PILE_STENCILS = [
  { name:'faces',             classes:'F' },
  { name:'faces + corners',   classes:'FK' },
  { name:'edges',             classes:'E' },
  { name:'corners',           classes:'K' },
  { name:'faces + edges',     classes:'FE' },
  { name:'all 26',            classes:'FEK' },
  { name:'faces + far faces', classes:'F', far:true },
  { name:'edges + corners',   classes:'EK' },
];
export const STENCIL_NAMES = [POWER_STENCILS.map(s => s.name), PILE_STENCILS.map(s => s.name)];
export const STENCILS = 8;
/* Where the sandpile's grains start, in units of R/4 from the centre: the
   centre, the six face points, the eight corner points, or both. */
export const SOURCES = [
  { name:'centre',             pts:[[0, 0, 0]] },
  { name:'six faces',          pts:ORBITS.F },
  { name:'eight corners',      pts:ORBITS.K },
  { name:'centre + six faces', pts:[[0, 0, 0], ...ORBITS.F] },
];
/* Grains per step, as a multiple of a pile that just fits the cube. */
export const GRAIN_SCALE = [0.18, 0.25, 0.35, 0.5, 0.7, 1, 1.4, 2];
/* Mean grains per voxel of a large stable pile, as a share of
   threshold − 1 (measured; it only sets the scale of N). */
const PILE_FILL = 0.4;
/* Powers mod 2 have one nonzero value; they colour by the step a voxel
   was first reached (its distance in the stencil), cycled through this. */
export const DISTANCE_HUES = 8;

const offsetsOf = st => {
  const offs = [];
  for (const c of st.classes) offs.push(...ORBITS[c]);
  if (st.far) offs.push([2, 0, 0], [-2, 0, 0], [0, 2, 0], [0, -2, 0], [0, 0, 2], [0, 0, -2]);
  return offs;
};

/** @param {ReturnType<typeof createBimoblockCore>} [bimo] reuse an existing bimoblock core */
export function createCarryCore(bimo = createBimoblockCore()){
  const { GROUPS, applyG, envelope, levelResolution, seedWords } = bimo;

  const seedPick = (seed, salt, n) => {
    const { lo, hi } = seedWords(seed);
    let h = Math.imul(lo ^ Math.imul(salt + 1, 0x632be5ab), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ hi ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x27d4eb2d) >>> 0;
    return ((h ^ (h >>> 15)) >>> 0) % n;
  };

  /* T for a step: the largest that fits, counting down, wrapping on a
     small grid. */
  const stepT = (step, Tmax) => 1 + (((Tmax - 1 - step) % Tmax) + Tmax) % Tmax;

  /* ---- powers ------------------------------------------------------- */
  /* Coefficients mod p, one per orbit class so the stencil stays
     symmetric, seeded in 1 … p−1. */
  function powerCoefs(C, st, p){
    const classes = st.tetra ? 'CF' : st.time ? 'CF' : st.classes, coef = {};
    [...classes].forEach((c, k) => { coef[c] = 1 + seedPick(C.seed, 20 + k, p - 1); });
    return coef;
  }

  /* fᵀ mod p over an R³ grid (one cell of margin), from `start` cells
     holding 1. Returns the residues and, per cell, the first step it was
     nonzero (255 never). */
  function powerRun(R, taps, start, T, p){
    const S = R + 2, S2 = S * S, size = S2 * S;
    let cur = new Uint8Array(size), nxt = new Uint8Array(size);
    const first = new Uint8Array(size).fill(255);
    const at = (x, y, z) => (x + 1) + S * (y + 1) + S2 * (z + 1);
    for (const [x, y, z] of start){ cur[at(x, y, z)] = 1; first[at(x, y, z)] = 0; }
    const offs = taps.map(([[dx, dy, dz]]) => dx + S * dy + S2 * dz), ws = taps.map(t => t[1]);
    let lo = [R, R, R], hi = [-1, -1, -1];
    for (const s of start) for (let a = 0; a < 3; a++){ lo[a] = Math.min(lo[a], s[a]); hi[a] = Math.max(hi[a], s[a]); }
    // next[c] = Σ w · cur[c − o], so the support's box grows by the taps'
    // reach each step; T never takes it past the grid.
    const reachPos = [0, 1, 2].map(a => Math.max(0, ...taps.map(t => t[0][a]))),
          reachNeg = [0, 1, 2].map(a => Math.max(0, ...taps.map(t => -t[0][a])));
    for (let t = 1; t <= T; t++){
      for (let a = 0; a < 3; a++){ lo[a] = Math.max(0, lo[a] - reachNeg[a]); hi[a] = Math.min(R - 1, hi[a] + reachPos[a]); }
      for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++){
        let c = at(lo[0], y, z);
        for (let x = lo[0]; x <= hi[0]; x++, c++){
          let s = 0;
          for (let k = 0; k < offs.length; k++) s += ws[k] * cur[c - offs[k]];
          s %= p;
          nxt[c] = s;
          if (s && first[c] === 255) first[c] = t;
        }
      }
      [cur, nxt] = [nxt, cur];
    }
    return { cur, first, at };
  }

  function powersField(C, R){
    const st = POWER_STENCILS[C.stencil | 0], p = PRIMES[C.level | 0] ?? 2;
    const coef = powerCoefs(C, st, p);
    const val = new Uint8Array(R * R * R), dist = new Uint8Array(R * R * R);
    const idx = (x, y, z) => x + R * y + R * R * z;
    const lo = (R - 1) >> 1, hi = R >> 1;            // the centre cell, or the central pair
    let T, digits;
    if (st.time){
      // A 2D plus in x, z; layer y holds f^(R−1−y), so the apex is on top.
      // The history runs on a grid padded by T on every side, so what
      // leaves the cube and comes back is still counted: exact coefficients.
      const taps = [[[0, 0], coef.C], ...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(o => [o, coef.F])];
      T = R - 1;
      const o = T + 1, Wd = R + 2 * o;
      let cur = new Uint8Array(Wd * Wd), nxt = new Uint8Array(Wd * Wd);
      const at = (x, z) => (x + o) + Wd * (z + o);
      for (const x of new Set([lo, hi])) for (const z of new Set([lo, hi])) cur[at(x, z)] = 1;
      for (let t = 0; t <= T; t++){
        const y = R - 1 - t;
        for (let z = 0; z < R; z++) for (let x = 0; x < R; x++){
          val[idx(x, y, z)] = cur[at(x, z)]; dist[idx(x, y, z)] = t;
        }
        if (t === T) break;
        for (let c = Wd + 1; c < Wd * Wd - Wd - 1; c++){
          let s = 0;
          for (const [[dx, dz], w] of taps) s += w * cur[c - dx - Wd * dz];
          nxt[c] = s % p;
        }
        [cur, nxt] = [nxt, cur];
      }
      digits = null;
    } else {
      const taps = st.tetra
        ? [[[0, 0, 0], coef.C], [[1, 0, 0], coef.F], [[0, 1, 0], coef.F], [[0, 0, 1], coef.F]]
        : [...st.classes].flatMap(c => ORBITS[c].map(o => [o, coef[c]]));
      const start = [];
      if (st.tetra) start.push([0, 0, 0]);
      else for (const x of new Set([lo, hi])) for (const y of new Set([lo, hi])) for (const z of new Set([lo, hi])) start.push([x, y, z]);
      T = stepT(C.step | 0, st.tetra ? R - 1 : lo);
      const run = powerRun(R, taps, start, T, p);
      for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
        const c = run.at(x, y, z);
        val[idx(x, y, z)] = run.cur[c]; dist[idx(x, y, z)] = run.first[c];
      }
      digits = T.toString(p);
    }
    const coefText = Object.entries(coef).filter(([c]) => st.tetra || st.time || st.classes.includes(c))
      .map(([c, w]) => `${w}·${st.tetra ? (c === 'C' ? '1' : 'X, Y, Z') : st.time ? (c === 'C' ? 'centre' : 'plus') : ORBIT_NAMES[c]}`).join(' + ');
    return {
      val, dist, p, coef, hues: p === 2 ? DISTANCE_HUES : p - 1, keep: 1,
      hue: (v, d) => p === 2 ? d % DISTANCE_HUES : v - 1,
      meta: { T: st.time ? null : T, Tdigits: digits, p, detail: p === 2 ? '' : 'coefficients ' + coefText }
    };
  }

  /* ---- sandpile ----------------------------------------------------- */
  /* The cells a source point stands on: a point in doubled centred
     coordinates sits on a cell where its parity matches the grid's, and
     between the two neighbours where it does not. */
  function sourceCells(pt, R, D){
    const h = R - 1, axes = pt.map(u => {
      const X = u * D;
      return (X - h) % 2 === 0 ? [X] : [X - 1, X + 1];
    });
    const out = [];
    for (const X of axes[0]) for (const Y of axes[1]) for (const Z of axes[2]) out.push([(X + h) / 2, (Y + h) / 2, (Z + h) / 2]);
    return out;
  }

  function sandpileField(C, R){
    const st = PILE_STENCILS[C.stencil | 0], offs3 = offsetsOf(st), thr = offs3.length;
    const src = SOURCES[seedPick(C.seed, 30, SOURCES.length)];
    // The off-centre sources sit R/4 out: R/2 in doubled coordinates.
    const D = 2 * Math.max(1, Math.round(R / 4));
    const cells = src.pts.flatMap(pt => sourceCells(pt, R, D));
    const fit = (4 / 3) * Math.PI * (R / 2) ** 3 * PILE_FILL * (thr - 1);
    const per = Math.max(1, Math.round(fit * GRAIN_SCALE[C.step | 0] / cells.length));
    const N = per * cells.length;

    const M = st.far ? 2 : 1, S = R + 2 * M, S2 = S * S;
    const g = new Uint32Array(S2 * S);
    const at = (x, y, z) => (x + M) + S * (y + M) + S2 * (z + M);
    for (const [x, y, z] of cells) g[at(x, y, z)] += per;
    const offs = offs3.map(([dx, dy, dz]) => dx + S * dy + S2 * dz);
    // Bulk toppling, in place: a cell with v grains sends ⌊v/thr⌋ to each
    // neighbour at once. The margin is a sink, so grains that leave the
    // cube are lost. Any order of topplings ends in the same pile.
    let lo = [R, R, R], hi = [-1, -1, -1];
    for (const c of cells) for (let a = 0; a < 3; a++){ lo[a] = Math.min(lo[a], c[a]); hi[a] = Math.max(hi[a], c[a]); }
    let sweeps = 0;
    for (let busy = true; busy; sweeps++){
      busy = false;
      let nlo0 = lo[0], nlo1 = lo[1], nlo2 = lo[2], nhi0 = hi[0], nhi1 = hi[1], nhi2 = hi[2];
      for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++){
        let c = at(lo[0], y, z);
        for (let x = lo[0]; x <= hi[0]; x++, c++){
          const v = g[c];
          if (v < thr) continue;
          const q = (v / thr) >>> 0;
          g[c] = v - q * thr;
          for (let k = 0; k < offs.length; k++) g[c + offs[k]] += q;
          busy = true;
          if (x - M < nlo0) nlo0 = Math.max(0, x - M); if (x + M > nhi0) nhi0 = Math.min(R - 1, x + M);
          if (y - M < nlo1) nlo1 = Math.max(0, y - M); if (y + M > nhi1) nhi1 = Math.min(R - 1, y + M);
          if (z - M < nlo2) nlo2 = Math.max(0, z - M); if (z + M > nhi2) nhi2 = Math.min(R - 1, z + M);
        }
      }
      lo = [nlo0, nlo1, nlo2]; hi = [nhi0, nhi1, nhi2];
    }
    const val = new Uint8Array(R * R * R);
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) val[x + R * y + R * R * z] = g[at(x, y, z)];
    // A small pile may never reach the top values; then the kept levels
    // count down from the largest value it holds.
    let top = 1;
    for (let c = 0; c < val.length; c++) if (val[c] > top) top = val[c];
    const keepK = C.level | 0;
    const keep = Math.min(top, keepK === 0 ? thr - 1 : keepK === 1 ? thr - 2 : keepK === 2 ? Math.ceil(thr / 2) : 1);
    return {
      val, dist: null, cells, hues: top + 1 - keep, keep,
      hue: v => v - keep,
      meta: { N, threshold: thr, keepFrom: keep, sweeps, detail: `sources ${src.name}` }
    };
  }

  /** @param {import('../types.js').CarryRecipe} C @param {import('../types.js').Level[]} levels
   *  @returns {import('../types.js').OccResult & {meta:Object}} */
  function carryOcc(C, levels){
    const started = performance.now();
    const R = levelResolution(levels), h = R - 1, N = R * R * R, inv = 1 / (h || 1);
    const F = (C.rule | 0) === 1 ? sandpileField(C, R) : powersField(C, R);
    const els = GROUPS[C.sym].els, nE = els.length;
    /* One orbit at a time, as the other cores do: the value and the clip
       are read at the orbit's first cell in scan order, so a fold is exact. */
    const occ = new Uint8Array(N), orbit = new Uint8Array(N), visited = new Uint8Array(N);
    const idx = t => (t + h) / 2, v = [0, 0, 0];
    let filled = 0, envelopeCells = 0;
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
      const here = x + R * y + R * R * z;
      if (visited[here]) continue;
      const X = 2*x - h, Y = 2*y - h, Z = 2*z - h;
      const inside = envelope(X * inv, Y * inv, Z * inv, C.arch);
      const value = inside ? F.val[here] : 0, kept = value >= F.keep;
      const hue = kept ? F.hue(value, F.dist ? F.dist[here] : 0) : 0;
      v[0] = X; v[1] = Y; v[2] = Z;
      for (let e = 0; e < nE; e++){
        const w = nE > 1 ? applyG(v, els[e]) : v;
        const cell = idx(w[0]) + R * idx(w[1]) + R * R * idx(w[2]);
        if (visited[cell]) continue;
        visited[cell] = 1;
        if (inside) envelopeCells++;
        if (kept){ occ[cell] = 1; orbit[cell] = hue; filled++; }
      }
    }
    return { occ, R, filled, envelopeCells, orbit, orbitOrder: F.hues, meta: F.meta,
      timings: { evaluate: performance.now() - started, select: 0 } };
  }

  /** @param {import('../types.js').CarryRecipe} C @param {import('../types.js').Level[]} levels
   *  @returns {import('../types.js').BuildResult} */
  function buildCarry(C, levels){
    const started = performance.now();
    const src = carryOcc(C, levels);
    const instances = bimo.instanceArrays(src.occ, 0, src.filled, levels, src.R, src.orbit, src.orbitOrder);
    return { occ: src.occ, R: src.R, filled: src.filled, envelopeCells: src.envelopeCells, instances,
      meta: src.meta,
      timings: { evaluate: src.timings.evaluate, select: 0,
        mesh: instances.timings.mesh, bounds: instances.timings.bounds,
        total: performance.now() - started } };
  }

  /* The raw value fields, for tests: residues mod p or grain counts, x fastest. */
  const fields = { powers: powersField, sandpile: sandpileField };
  return { RULE_NAMES, buildCarry, carryOcc, fields, seedPick, stepT };
}
