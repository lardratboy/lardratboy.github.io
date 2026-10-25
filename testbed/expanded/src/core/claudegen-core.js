/* ================== CLAUDEGEN CORE ===================================
   Generator #6 (`?g=claudegen`, design in claudegen.md): a crystal with
   one flaw. A crystal is the most periodic thing there is, and the
   flaws a real one carries are what make two crystals worth telling
   apart: the screw dislocation that turns stacked plates into one
   helical ramp, the extra half-plane of an edge dislocation, a grain
   boundary, a stacking fault. So every specimen is a perfect lattice
   with exactly one flaw in it, and the flaw is the subtle variation.

     motif     what repeats: plates, rods, ball lattices (cubic, bcc,
               fcc, hcp, perovskite), cubic struts, double gyroid, double
               diamond, hexagonal rods and honeycomb, a woodpile, and the
               Kelvin and Weaire–Phelan foams
     flaw      what breaks it: a displacement field u, drawn the way
               physicists draw dislocations, by looking the perfect
               crystal up at q − u(q). A dislocation's u winds by a
               lattice vector b around its line, so the crystal closes
               up again everywhere except at the core
     strength  how much: the Burgers vector (½ is a partial, and leaves
               a stacking fault), a coincidence-site angle Σ, a shift,
               a wedge angle, a turn, a bend radius
     spacing   periods across the cube; the lattice constant a is a
               whole number of voxels, so a perfect crystal is exactly
               periodic on the voxel grid

   The density is the fill: the share of a perfect crystal's unit cell
   that is kept, by an exact quantile of the motif's distance function.
   The seed picks the flaw's sense, where its core sits (on a site or
   between sites) and its extent. Kept voxels are coloured by their site
   or layer in the perfect crystal, so the flaw shows as a seam in the
   colours wherever it is hidden in the shape.

   Then the shared instanceArrays(), so everything downstream is shared.
   Pure like the other cores: no DOM, no THREE, runs in the worker.
   ================================================================ */
import { createBimoblockCore } from './bimoblock-core.js';

/* Only ever appended, like every catalogue here: indices are in the
   goldens and permalinks. `hues` is how many colours the labels take. */
export const MOTIFS = [
  { name:'plates',    note:'stacked plates, one per period up y',   hues:4 },
  { name:'rods',      note:'a square array of rods along x',        hues:4 },
  { name:'rock salt', note:'simple cubic balls, two species',       hues:2 },
  { name:'bcc',       note:'body-centred cubic balls',              hues:2 },
  { name:'fcc',       note:'face-centred cubic balls, four sublattices', hues:4 },
  { name:'scaffold',  note:'cubic struts, a colour per direction',  hues:3 },
  { name:'gyroid',    note:'two interlaced gyroid labyrinths',      hues:2 },
  { name:'diamond',   note:'two interlaced diamond networks',       hues:2 },
  { name:'hex rods',  note:'rods along z on a triangular lattice',  hues:3, cell:'hex' },
  { name:'honeycomb', note:'hexagonal cell walls along z',          hues:3, cell:'hex' },
  { name:'hcp',       note:'hexagonal close-packed balls, layers A B along z', hues:2, cell:'hcp' },
  { name:'woodpile',  note:'log-pile rods, along x and z in turn up y', hues:4 },
  { name:'kelvin foam', note:'walls of truncated octahedra, the cells of bcc', hues:2 },
  { name:'weaire–phelan', note:'the A15 foam: dodecahedra and 14-hedra', hues:2 },
  { name:'perovskite', note:'three species of ball: corner, body, face centres', hues:3 },
];
export const MOTIF_NAMES = MOTIFS.map(m => m.name);

export const FLAWS = [
  { name:'perfect',      note:'no flaw: the reference crystal' },
  { name:'screw',        note:'dislocation line up y, b along it' },
  { name:'edge',         note:'dislocation line along z, an extra half-plane' },
  { name:'screw dipole', note:'two screws of opposite sense, up y' },
  { name:'loop',         note:'a square prismatic loop: an extra disc of crystal' },
  { name:'tilt',         note:'grain boundary at x = 0, the halves turned about z' },
  { name:'twist',        note:'grain boundary at z = 0, the halves turned about z' },
  { name:'fault',        note:'the x > 0 half slipped up y' },
  { name:'wedge',        note:'disclination about z: a wedge taken out or put in' },
  { name:'twisted',      note:'the whole crystal twisted about x' },
  { name:'bent',         note:'the whole crystal bent about z' },
];
export const FLAW_NAMES = FLAWS.map(f => f.name);

/* What each step of the strength dial means, per flaw (four each, so it
   can be an axis role under any flaw). */
export const STRENGTHS = 4;
export const PERFECT_SHIFT = [[0, 0, 0], [0.25, 0.25, 0.25], [0.5, 0.5, 0.5], [0.5, 0.5, 0]];
export const BURGERS = [0.5, 1, 2, 3];
/* Coincidence-site rotations about [001]: tan(θ/2) = 1/7, 1/5, 1/4, 1/3,
   so one lattice site in Σ is shared by both grains. */
export const SIGMA = [{ sigma:25, t:1/7 }, { sigma:13, t:1/5 }, { sigma:17, t:1/4 }, { sigma:5, t:1/3 }]
  .map(s => ({ ...s, angle: 2 * Math.atan(s.t) }));
export const FAULT_SHIFT = [1/4, 1/3, 1/2, 2/3];
export const WEDGE = [-1/2, -1/4, 1/4, 1/2];
export const TWIST_TURNS = [1/8, 1/4, 1/2, 1];
export const BEND_RADIUS = [4, 2, 1, 1/2];        // in units of R
const deg = r => (r * 180 / Math.PI).toFixed(2).replace(/\.?0+$/, '') + '°';
const burgersText = BURGERS.map(b => b === 0.5 ? 'b ½ (partial)' : 'b ' + b);
export const STRENGTH_NAMES = [
  ['origin on a site', 'origin at ¼ ¼ ¼', 'origin at the body centre', 'origin at a face centre'],
  burgersText, burgersText, burgersText, burgersText,
  SIGMA.map(s => `Σ${s.sigma} · ${deg(s.angle)}`),
  SIGMA.map(s => `Σ${s.sigma} · ${deg(s.angle)}`),
  ['slip ¼', 'slip ⅓', 'slip ½', 'slip ⅔'],
  ['−180°', '−90°', '+90°', '+180°'],
  ['turn 45°', 'turn 90°', 'turn 180°', 'turn 360°'],
  ['radius 4 R', 'radius 2 R', 'radius R', 'radius R/2'],
];
/* Periods across the cube; a = round(R / periods), at least 5 voxels:
   below that some motifs cannot be drawn at all (fcc at a = 4 has every
   voxel the same distance from a site; a gyroid keeps three in four). */
export const PERIODS = [3, 4, 5, 6];
export const MIN_A = 5;
export const latticeConstant = (R, spacing) => Math.max(MIN_A, Math.round(R / (PERIODS[spacing | 0] ?? 4)));

/* A motif's unit cell in voxels: a cube of side a, or for the hexagonal
   crystals a centred rectangle round(a√3) by a across x, y (the
   triangular lattice, nearest neighbours a apart along y), and for hcp
   round(a√(8/3)) up z, two layers. Rounding √3 keeps a perfect crystal
   exactly periodic on the voxel grid; it is 1% off true hexagonal at
   a = 8 and 4% at a = 5. */
const SQRT3 = Math.sqrt(3), HCP_C = Math.sqrt(8 / 3);
export function cellOf(m, a){
  const cell = MOTIFS[m]?.cell;
  if (cell === 'hex') return [Math.round(SQRT3 * a), a, a];
  if (cell === 'hcp') return [Math.round(SQRT3 * a), a, Math.round(HCP_C * a)];
  return [a, a, a];
}

/* Which way the crystal is cut: the crystal direction `up` (in the cube's
   axes, lattice constant 1) is turned to point up the cube's y. Only ever
   appended. `Q` maps cube coordinates to crystal ones by the shortest
   turn taking ŷ to up (Rodrigues; square roots only, so it is the same
   in every engine). */
export const VIEWS = [
  { name:'on the grid', note:'the crystal axes are the cube axes', up:null },
  { name:'[120] up',    note:'tilted 26.57° about z: shallow terraces', up:[1, 2, 0] },
  { name:'[110] up',    note:'tilted 45° about z', up:[1, 1, 0] },
  { name:'[111] up',    note:'the body diagonal up, tilted 54.74°', up:[1, 1, 1] },
].map(v => ({ ...v, Q: v.up && rotationUp(v.up) }));
export const VIEW_NAMES = VIEWS.map(v => v.name);
function rotationUp(d){
  const n = Math.hypot(d[0], d[1], d[2]), x = d[0] / n, y = d[1] / n, z = d[2] / n;
  const vx = z, vz = -x, k = 1 / (1 + y);            // v = ŷ × d, cos = ŷ·d = y
  // Q = I + [v]× + (v vᵀ − |v|² I) / (1 + cos), with v_y = 0.
  return [1 - k * vz * vz, -vz, k * vx * vz,
          vz, 1 - k * (vx * vx + vz * vz), -vx,
          k * vx * vz, vx, 1 - k * vx * vx];
}

const TAU = 2 * Math.PI;
const fr = u => u - Math.round(u);                 // offset from the nearest integer, in [−½, ½]
const imod = (a, n) => ((a % n) + n) % n;

/* A motif at coordinates s = q / a: a distance-like value, kept below
   the fill's quantile, and the site or layer label it is coloured by
   (written to `out.label`). The first eight, on a cubic cell. */
function cubicMotif(m, sx, sy, sz, out){
  switch (m){
    case 0: {                                        // plates ⟂ y
      out.label = Math.round(sy);
      return Math.abs(fr(sy));
    }
    case 1: {                                        // rods ∥ x
      const ny = Math.round(sy), nz = Math.round(sz);
      out.label = imod(ny, 2) + 2 * imod(nz, 2);
      return Math.hypot(sy - ny, sz - nz);
    }
    case 2: {                                        // simple cubic, two species
      const nx = Math.round(sx), ny = Math.round(sy), nz = Math.round(sz);
      out.label = nx + ny + nz;
      return Math.hypot(sx - nx, sy - ny, sz - nz);
    }
    case 3: {                                        // bcc: corners and body centres
      const d0 = Math.hypot(fr(sx), fr(sy), fr(sz));
      const d1 = Math.hypot(fr(sx - 0.5), fr(sy - 0.5), fr(sz - 0.5));
      out.label = d1 < d0 ? 1 : 0;
      return Math.min(d0, d1);
    }
    case 4: {                                        // fcc: the even points of the doubled lattice
      const t = [2 * sx, 2 * sy, 2 * sz], n = t.map(Math.round);
      if ((n[0] + n[1] + n[2]) & 1){
        // Odd: move the worst-rounded coordinate the other way (D₃ decoding).
        let k = 0, e = -1;
        for (let i = 0; i < 3; i++){ const ei = Math.abs(t[i] - n[i]); if (ei > e){ e = ei; k = i; } }
        n[k] += t[k] >= n[k] ? 1 : -1;
      }
      out.label = imod(n[0], 2) + 2 * imod(n[1], 2);
      return Math.hypot(t[0] - n[0], t[1] - n[1], t[2] - n[2]) / 2;
    }
    case 5: {                                        // cubic struts
      const fx = fr(sx), fy = fr(sy), fz = fr(sz);
      const dx = Math.hypot(fy, fz), dy = Math.hypot(fx, fz), dz = Math.hypot(fx, fy);
      out.label = dx <= dy && dx <= dz ? 0 : dy <= dz ? 1 : 2;
      return Math.min(dx, dy, dz);
    }
    case 6: {                                        // double gyroid: both labyrinths, the wall removed
      const X = TAU * sx, Y = TAU * sy, Z = TAU * sz;
      const g = Math.sin(X) * Math.cos(Y) + Math.sin(Y) * Math.cos(Z) + Math.sin(Z) * Math.cos(X);
      out.label = g >= 0 ? 0 : 1;
      return -Math.abs(g);
    }
    default: {                                       // double diamond: both labyrinths of Schwarz D
      const X = TAU * sx, Y = TAU * sy, Z = TAU * sz;
      const sX = Math.sin(X), cX = Math.cos(X), sY = Math.sin(Y), cY = Math.cos(Y), sZ = Math.sin(Z), cZ = Math.cos(Z);
      const D = sX * sY * sZ + sX * cY * cZ + cX * sY * cZ + cX * cY * sZ;
      out.label = D >= 0 ? 0 : 1;
      return -Math.abs(D);
    }
  }
}

/* Crystals given as sites in the unit cell (fractions of it). `lab` is a
   site's colour; `ly` adds the cell's row up y, which three-colours the
   triangular lattice ((row + 2ε) mod 3 differs between any two
   neighbours). `r` scales a ball. */
const TRI_SITES   = [{ f:[0, 0, 0], lab:0, ly:1 }, { f:[0.5, 0.5, 0], lab:2, ly:1 }];
export const HCP_SITES = [{ f:[0, 0, 0], lab:0 }, { f:[0.5, 0.5, 0], lab:0 },     // layer A
                          { f:[1/6, 0.5, 0.5], lab:1 }, { f:[2/3, 0, 0.5], lab:1 }]; // layer B, over the hollows
const BCC_SITES   = [{ f:[0, 0, 0], lab:0 }, { f:[0.5, 0.5, 0.5], lab:1 }];
/* A15 (Cr₃Si): the Voronoi cells of its two bcc sites are pentagonal
   dodecahedra and those of the six on the cube faces 14-hedra, the
   Weaire–Phelan foam. */
export const A15_SITES = [{ f:[0, 0, 0], lab:0 }, { f:[0.5, 0.5, 0.5], lab:0 },
  { f:[0.25, 0, 0.5], lab:1 }, { f:[0.75, 0, 0.5], lab:1 }, { f:[0.5, 0.25, 0], lab:1 },
  { f:[0.5, 0.75, 0], lab:1 }, { f:[0, 0.5, 0.25], lab:1 }, { f:[0, 0.5, 0.75], lab:1 }];
/* ABO₃: a large A on the corners, a small B at the body centre, O on the faces. */
const PEROVSKITE_SITES = [{ f:[0, 0, 0], lab:0, r:1 }, { f:[0.5, 0.5, 0.5], lab:1, r:0.6 },
  { f:[0.5, 0.5, 0], lab:2, r:0.8 }, { f:[0.5, 0, 0.5], lab:2, r:0.8 }, { f:[0, 0.5, 0.5], lab:2, r:0.8 }];

/* A site crystal as a motif: every site's images in the 3 × 3 × 3 cells
   around the point's own (3 × 3, and z ignored, when `flat`). Balls are
   the distance to the nearest site over its r; walls are the distance to
   the nearest wall of its Voronoi cell, which, the cell being convex, is
   the nearest of the bisector planes with the other sites. */
function siteMotif(sites, asp, flat, walls){
  const X = [], Y = [], Z = [], W = [], LAB = [], LY = [], J = [];
  for (const k of flat ? [0] : [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const i of [-1, 0, 1])
    for (const s of sites){
      X.push((s.f[0] + i) * asp[0]); Y.push((s.f[1] + j) * asp[1]); Z.push(flat ? 0 : (s.f[2] + k) * asp[2]);
      W.push(1 / (s.r ?? 1) ** 2); LAB.push(s.lab); LY.push(s.ly ?? 0); J.push(j);
    }
  const n = X.length;
  return (sx, sy, sz, out) => {
    const cy = Math.floor(sy / asp[1]);
    const lx = sx - Math.floor(sx / asp[0]) * asp[0], ly = sy - cy * asp[1];
    const lz = flat ? 0 : sz - Math.floor(sz / asp[2]) * asp[2];
    let best = 0, bd = Infinity;
    for (let c = 0; c < n; c++){
      const dx = lx - X[c], dy = ly - Y[c], dz = lz - Z[c], d = (dx * dx + dy * dy + dz * dz) * W[c];
      if (d < bd){ bd = d; best = c; }
    }
    out.label = LAB[best] + LY[best] * (cy + J[best]);
    if (!walls) return Math.sqrt(bd);
    const bx = X[best], by = Y[best], bz = Z[best];
    let wall = Infinity;
    for (let c = 0; c < n; c++){
      if (c === best) continue;
      const dx = lx - X[c], dy = ly - Y[c], dz = lz - Z[c];
      const ex = X[c] - bx, ey = Y[c] - by, ez = Z[c] - bz;
      const w = (dx * dx + dy * dy + dz * dz - bd) / (2 * Math.sqrt(ex * ex + ey * ey + ez * ez));
      if (w < wall) wall = w;
    }
    return wall;
  };
}

/* Woodpile: four layers a period up y, rods ∥ x at z ≡ 0, ∥ z at x ≡ 0,
   ∥ x at z ≡ ½, ∥ z at x ≡ ½, each layer coloured. */
function woodpile(sx, sy, sz, out){
  const d0 = Math.hypot(fr(sy), fr(sz)), d1 = Math.hypot(fr(sy - 0.25), fr(sx));
  const d2 = Math.hypot(fr(sy - 0.5), fr(sz - 0.5)), d3 = Math.hypot(fr(sy - 0.75), fr(sx - 0.5));
  let d = d0, k = 0;
  if (d1 < d){ d = d1; k = 1; }
  if (d2 < d){ d = d2; k = 2; }
  if (d3 < d){ d = d3; k = 3; }
  out.label = k;
  return d;
}

/* The motif as a function of s = q / a, for lattice constant a (the
   hexagonal cells depend on it through the rounded √3). Cached. */
const motifs = new Map();
export function motifFn(m, a){
  const key = m + '|' + a;
  let f = motifs.get(key);
  if (f) return f;
  const asp = cellOf(m, a).map(c => c / a);
  switch (m){
    case 8:  f = siteMotif(TRI_SITES, asp, true, false); break;
    case 9:  f = siteMotif(TRI_SITES, asp, true, true); break;
    case 10: f = siteMotif(HCP_SITES, asp, false, false); break;
    case 11: f = woodpile; break;
    case 12: f = siteMotif(BCC_SITES, asp, false, true); break;
    case 13: f = siteMotif(A15_SITES, asp, false, true); break;
    case 14: f = siteMotif(PEROVSKITE_SITES, asp, false, false); break;
    default: f = (sx, sy, sz, out) => cubicMotif(m, sx, sy, sz, out);
  }
  motifs.set(key, f);
  return f;
}
/** For tests and old callers: one lookup. a only matters for hexagonal cells. */
export const motifAt = (m, sx, sy, sz, out, a = 8) => motifFn(m, a)(sx, sy, sz, out);

/* The fill's threshold: the `density` quantile of the motif's value over
   the voxels of one unit cell of the perfect crystal (cellOf, at the
   phases `off` the grid actually samples), so the density is exactly the
   share of a perfect crystal's voxels that is kept, whatever the motif.
   Voxels tie (symmetric positions, and the same phase a period away,
   which a float computes an ulp apart): values within 1e-9 are one
   class, a class is kept or dropped whole, and the threshold sits midway
   between two classes so rounding never flips a voxel. It never drops
   below the smallest class, so something is always kept. Cached per cell. */
const same = (u, v) => Math.abs(u - v) <= 1e-9 * Math.max(1, Math.abs(u), Math.abs(v));
const tables = new Map();
function quantile(t, density){
  // k: the first value dropped, moved back to the start of its class.
  let k = Math.min(t.length - 1, Math.max(0, Math.floor(density * t.length)));
  while (k > 0 && same(t[k - 1], t[k])) k--;
  if (k === 0) while (k < t.length && same(t[k], t[0])) k++;
  return k < t.length ? (t[k - 1] + t[k]) / 2 : Infinity;
}
export function fillThreshold(m, density, a, off){
  const key = `${m}|${a}|${off.join(',')}`;
  let t = tables.get(key);
  if (!t){
    const scratch = { label:0 }, f = motifFn(m, a), [cx, cy, cz] = cellOf(m, a);
    t = new Float64Array(cx * cy * cz);
    let c = 0;
    for (let z = 0; z < cz; z++) for (let y = 0; y < cy; y++) for (let x = 0; x < cx; x++)
      t[c++] = f((x + off[0]) / a, (y + off[1]) / a, (z + off[2]) / a, scratch);
    t.sort();
    tables.set(key, t);
  }
  return quantile(t, density);
}
/* Off the grid no unit cell repeats on the voxels, so the quantile is
   taken over the cube's own voxels of the perfect crystal, turned by Q
   and shifted by t (voxels, crystal frame). Cached likewise. */
export function viewThreshold(m, density, a, R, view, Q, t){
  const key = `${m}|${a}|${R}|v${view}|${t.join(',')}`;
  let tab = tables.get(key);
  if (!tab){
    const scratch = { label:0 }, f = motifFn(m, a), h = R - 1, ia = 1 / a;
    tab = new Float64Array(R * R * R);
    let c = 0;
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
      const qx = x - h / 2, qy = y - h / 2, qz = z - h / 2;
      tab[c++] = f((Q[0] * qx + Q[1] * qy + Q[2] * qz + t[0]) * ia, (Q[3] * qx + Q[4] * qy + Q[5] * qz + t[1]) * ia,
                   (Q[6] * qx + Q[7] * qy + Q[8] * qz + t[2]) * ia, scratch);
    }
    tab.sort();
    tables.set(key, tab);
  }
  return quantile(tab, density);
}

/** @param {ReturnType<typeof createBimoblockCore>} [bimo] reuse an existing bimoblock core */
export function createClaudegenCore(bimo = createBimoblockCore()){
  const { GROUPS, applyG, envelope, levelResolution, seedWords } = bimo;

  const seedPick = (seed, salt, n) => {
    const { lo, hi } = seedWords(seed);
    let h = Math.imul(lo ^ Math.imul(salt + 1, 0x7feb352d), 0x846ca68b) >>> 0;
    h = Math.imul(h ^ hi ^ (h >>> 15), 0xcaf649a9) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x2c1b3c6d) >>> 0;
    return ((h ^ (h >>> 13)) >>> 0) % n;
  };

  /* The flaw as an inverse map: voxel-unit coordinates q (centred on the
     cube) → where to look the perfect crystal up, written to w. Also the
     seeded sense, core and extent, for the inspector. `cell` is the
     motif's unit cell (cellOf); a perfect crystal's origin moves in it. */
  function flawMap(C, R, a, cell = [a, a, a]){
    const f = C.flaw | 0, k = C.strength | 0;
    const sense = seedPick(C.seed, 1, 2) ? -1 : 1;
    const between = seedPick(C.seed, 2, 2) === 1;
    const ext = seedPick(C.seed, 3, 3);
    const o = between ? a / 2 : 0;                     // the core: on a site, or between sites
    const B = sense * BURGERS[k] * a / TAU;            // b / 2π, for the dislocations
    const coreText = between ? 'core between sites' : 'core on a site';
    const senseText = sense > 0 ? 'sense +' : 'sense −';
    let map, detail = '';
    switch (f){
      case 0: {
        const t = PERFECT_SHIFT[k].map((v, i) => v * cell[i]);
        map = (x, y, z, w) => { w[0] = x + t[0]; w[1] = y + t[1]; w[2] = z + t[2]; };
        break;
      }
      case 1:                                        // screw ∥ y: u_y = b θ / 2π
        map = (x, y, z, w) => { w[0] = x; w[1] = y - B * Math.atan2(z - o, x - o); w[2] = z; };
        detail = `${sense > 0 ? 'right' : 'left'}-handed · ${coreText}`;
        break;
      case 2: {
        /* Edge ∥ z with b ∥ y: the isotropic solution (ν = ⅓) in a frame
           turned so its x′ runs along b: x′ = y, y′ = −x. The log term is
           taken relative to r = R/2, so the cube's rim barely moves. */
        const ln0 = Math.log((R / 2) ** 2);
        map = (x, y, z, w) => {
          const dx = x - o, dy = y - o, r2 = Math.max(dx * dx + dy * dy, 0.25);
          const th = Math.atan2(-dx, dy);
          w[0] = x - B * (0.125 * (Math.log(r2) - ln0) + 0.375 * Math.cos(2 * th));
          w[1] = y - B * (th + 0.375 * Math.sin(2 * th));
          w[2] = z;
        };
        detail = `${senseText} · ${coreText}`;
        break;
      }
      case 3: {                                      // two screws ∥ y, opposite senses
        const d = Math.round(R * [0.25, 0.375, 0.5][ext] / 2);
        map = (x, y, z, w) => {
          w[0] = x; w[1] = y - B * (Math.atan2(z - o, x - o + d) - Math.atan2(z - o, x - o - d)); w[2] = z;
        };
        detail = `cores ${2 * d} apart · ${senseText} · ${coreText}`;
        break;
      }
      case 4: {
        /* A square prismatic loop in the plane y = y0, b ∥ y: u = b Ω / 4π
           with Ω the solid angle the square subtends (exact, four atans),
           which jumps by 4π through the square and so by b. */
        const L = Math.round(R * [0.25, 0.3, 0.35][ext]), y0 = o + a / 2, B2 = B / 2;
        const F = (p, q, h) => Math.atan(p * q / (h * Math.sqrt(p * p + q * q + h * h)));
        map = (x, y, z, w) => {
          let h = y - y0;
          if (Math.abs(h) < 1e-9) h = 1e-9;
          const x1 = o - L - x, x2 = o + L - x, z1 = o - L - z, z2 = o + L - z;
          const omega = F(x2, z2, h) - F(x1, z2, h) - F(x2, z1, h) + F(x1, z1, h);
          w[0] = x; w[1] = y - B2 * omega; w[2] = z;
        };
        detail = `loop ${2 * L} × ${2 * L} · ${senseText} · ${coreText}`;
        break;
      }
      case 5: case 6: {
        /* Grain boundaries: the two halves turned ±θ/2 about z. Tilt puts
           the boundary at x = 0 (it contains the axis), twist at z = 0
           (the axis crosses it). */
        const half = sense * SIGMA[k].angle / 2, c = Math.cos(half), s = Math.sin(half), tilt = f === 5;
        map = (x, y, z, w) => {
          const side = (tilt ? x : z) < o ? 1 : -1, dx = x - o, dy = y - o;
          w[0] = o + c * dx + side * s * dy; w[1] = o - side * s * dx + c * dy; w[2] = z;
        };
        detail = `${senseText} · boundary ${between ? 'between sites' : 'through sites'}`;
        break;
      }
      case 7: {                                      // the x ≥ 0 half slipped up y
        const t = sense * FAULT_SHIFT[k] * a;
        map = (x, y, z, w) => { w[0] = x; w[1] = x >= o ? y - t : y; w[2] = z; };
        detail = `${senseText} · fault ${between ? 'between sites' : 'through sites'}`;
        break;
      }
      case 8: {
        /* Wedge disclination about z: polar angle θ → θ(1 + s), so the
           crystal fills 2π(1 + s) of turn. It closes up seamlessly when
           2πs is a symmetry of the motif about the line, and otherwise
           leaves a grain boundary along the cut. */
        const g = 1 + WEDGE[k];
        map = (x, y, z, w) => {
          const dx = sense * (x - o), dy = y - o, r = Math.hypot(dx, dy), th = Math.atan2(dy, dx) * g;
          w[0] = o + sense * r * Math.cos(th); w[1] = o + r * Math.sin(th); w[2] = z;
        };
        detail = `cut on the ${sense > 0 ? '−x' : '+x'} side · ${coreText}`;
        break;
      }
      case 9: {                                      // twisted about x, untwisted at the centre
        const rate = sense * TWIST_TURNS[k] * TAU / R;
        map = (x, y, z, w) => {
          const t = rate * x, c = Math.cos(t), s = Math.sin(t), dy = y - o, dz = z - o;
          w[0] = x; w[1] = o + c * dy + s * dz; w[2] = o - s * dy + c * dz;
        };
        detail = `${sense > 0 ? 'right' : 'left'}-handed · axis ${between ? 'between sites' : 'through sites'}`;
        break;
      }
      default: {                                     // bent about an axis ∥ z, ρ below (or above) the centre
        const rho = BEND_RADIUS[k] * R;
        map = (x, y, z, w) => {
          const dy = sense * y + rho, r = Math.hypot(x, dy);
          w[0] = rho * Math.atan2(x, dy); w[1] = sense * (r - rho); w[2] = z;
        };
        detail = sense > 0 ? 'bowed up' : 'bowed down';
      }
    }
    return { map, detail, sense, between };
  }

  /** @param {import('../types.js').ClaudegenRecipe} C @param {import('../types.js').Level[]} levels
   *  @returns {import('../types.js').OccResult & {meta:Object}} */
  function claudegenOcc(C, levels){
    const started = performance.now();
    const R = levelResolution(levels), h = R - 1, N = R * R * R, inv = 1 / (h || 1);
    const m = C.motif | 0, motif = MOTIFS[m] ?? MOTIFS[0];
    const a = latticeConstant(R, C.spacing), ia = 1 / a, unit = cellOf(m, a), look = motifFn(m, a);
    const view = C.view | 0, Q = VIEWS[view]?.Q;
    // The grid samples the perfect crystal at q = x − h/2 (shifted, on a
    // perfect page, by the origin): those phases, mod the cell, set the
    // fill. Off the grid, the cube's own voxels do.
    const shift = (C.flaw | 0) === 0 ? PERFECT_SHIFT[C.strength | 0] : [0, 0, 0];
    const thr = Q ? viewThreshold(m, C.density, a, R, view, Q, shift.map((t, i) => t * unit[i]))
                  : fillThreshold(m, C.density, a, shift.map((t, i) => imod(t * unit[i] - h / 2, unit[i])));
    const { map, detail } = flawMap(C, R, a, unit);
    const els = GROUPS[C.sym].els, nE = els.length;
    /* One orbit at a time, as the other cores do: the crystal and the clip
       are read at the orbit's first cell in scan order, so a fold is exact. */
    const occ = new Uint8Array(N), orbit = new Uint8Array(N), visited = new Uint8Array(N);
    const idx = t => (t + h) / 2, v = [0, 0, 0], w = new Float64Array(3), out = { label:0 };
    let filled = 0, envelopeCells = 0;
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
      const here = x + R * y + R * R * z;
      if (visited[here]) continue;
      const X = 2*x - h, Y = 2*y - h, Z = 2*z - h;
      const inside = envelope(X * inv, Y * inv, Z * inv, C.arch);
      let kept = false, hue = 0;
      if (inside){
        // Off the grid the crystal and its flaw are turned together, so
        // the flaw is still a true one in the crystal's own axes.
        if (Q){
          const qx = X / 2, qy = Y / 2, qz = Z / 2;
          map(Q[0] * qx + Q[1] * qy + Q[2] * qz, Q[3] * qx + Q[4] * qy + Q[5] * qz, Q[6] * qx + Q[7] * qy + Q[8] * qz, w);
        } else map(X / 2, Y / 2, Z / 2, w);
        kept = look(w[0] * ia, w[1] * ia, w[2] * ia, out) < thr;
        hue = imod(out.label, motif.hues);
      }
      v[0] = X; v[1] = Y; v[2] = Z;
      for (let e = 0; e < nE; e++){
        const u = nE > 1 ? applyG(v, els[e]) : v;
        const cell = idx(u[0]) + R * idx(u[1]) + R * R * idx(u[2]);
        if (visited[cell]) continue;
        visited[cell] = 1;
        if (inside) envelopeCells++;
        if (kept){ occ[cell] = 1; orbit[cell] = hue; filled++; }
      }
    }
    return { occ, R, filled, envelopeCells, orbit, orbitOrder: motif.hues,
      meta: { a, cell: unit, periods: R / a, detail },
      timings: { evaluate: performance.now() - started, select: 0 } };
  }

  /** @param {import('../types.js').ClaudegenRecipe} C @param {import('../types.js').Level[]} levels
   *  @returns {import('../types.js').BuildResult} */
  function buildClaudegen(C, levels){
    const started = performance.now();
    const src = claudegenOcc(C, levels);
    const instances = bimo.instanceArrays(src.occ, 0, src.filled, levels, src.R, src.orbit, src.orbitOrder);
    return { occ: src.occ, R: src.R, filled: src.filled, envelopeCells: src.envelopeCells, instances,
      meta: src.meta,
      timings: { evaluate: src.timings.evaluate, select: 0,
        mesh: instances.timings.mesh, bounds: instances.timings.bounds,
        total: performance.now() - started } };
  }

  /* For tests: the motif lookup and the flaw maps on their own. */
  return { buildClaudegen, claudegenOcc, flawMap, motifAt, motifFn, seedPick };
}
