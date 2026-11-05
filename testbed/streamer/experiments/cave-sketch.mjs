/* A sketch of the caves-and-mountains world (docs/caves-plan.md): a ridged
   mountain range with a cave network carved through it, water and lava
   pools in the chambers, and a sea in the valleys. Not the world itself:
   no viewer, no tests, no workers. It exists to answer "what does it cost,
   and what does it look like?" before the plan is decided, as
   kit-sketch.mjs did for the kit.

   Everything is in voxel units: voxel (x, y, z) has its centre at
   (x + ½, y + ½, z + ½), y up, in a world of side S = 2^D. The mountains
   scale with S (the same range, finer at higher D); the caves don't
   (a chamber is ~50–100 voxels across at every D, so a bigger D is more
   caves, not bigger ones).

   A voxel is solid when it is rock, sea or pool:
   - rock: y ≤ H(x, z), the heightfield, and not carved;
   - sea: y ≤ seaY, everywhere (it fills the valleys, flat);
   - pool: inside a chamber's box and y ≤ its level (flat, held in rock).

   The build is dag-core's fromField, top-down, but not through
   shapes.mjs's fieldOf: one Lipschitz bound for the whole field is
   hopeless here. The ridged heightfield's slope bound is ~19 voxels a
   voxel (its real slopes are mostly under 2), and a bound that loose
   leaves every cell within 19·side of the surface undecided, about 1.3G
   voxel tests at D = 12. So each term decides on its own and the terms
   are combined in Kleene's three-valued logic (0, 1, −1 = can't tell):
   - the heightfield is sampled once a column into H, and a min/max
     pyramid of H answers "is this cell all below / all above the
     surface?" exactly;
   - the sea and the pools are boxes and planes: exact integer tests;
   - only the caves use a Lipschitz bound, ~2.1 (distances, plus the
     walls' noise), on their own.

   The caves (cavePlan): a grid of side G = 192. A cell whose jittered
   centre is deep enough in rock (and well above the sea) holds a
   chamber, two overlapping ellipsoids; a cell whose centre is in open
   air is an "air node". Neighbouring chambers are joined by tunnels
   (capsules, bent once at a jittered midpoint), and a chamber next to an
   air node may open onto it: a cave mouth on a cliff or a skylight. The
   walls are pushed in and out by 3D value noise.

   Each grid cell holds a list of the primitives a point in it can be
   near. Every chamber's ellipsoids lie inside its own cell, and every
   tunnel inside its two cells, so anything not in the 27 cells around a
   point is at least G away: the cave distance is capped at G − 1, which
   keeps it exact up to the cap and keeps the bound honest. An
   ellipsoid's (|q/r| − 1)·r_min is Lipschitz 1 but underestimates far
   away (by r_min/r_max), so it is maxed with its bounding sphere's
   distance, which keeps the cap valid.

   A pool must not meet air except at its flat top. So a chamber gets one
   only if no tunnel leaves it downwards, its level is below every
   tunnel's lowest point inside its box, and every column of its box
   stands above the level (rock holds it in on every side).

   node experiments/cave-sketch.mjs            numbers and docs/images/cave-sketch-*.png
   node experiments/cave-sketch.mjs --print    numbers only
   node experiments/cave-sketch.mjs --D=11     one depth (renders at the largest built) */
import { writeFileSync } from 'node:fs';
import { createStore, createCounts, EMPTY, FULL } from '../dag-core.js';
import { hash32 } from '../specimen-core.js';
import { rgb8 } from '../attr-core.js';
import { render } from './kit-sketch.mjs';
import { png } from './dataprism.mjs';

const rng = (...k) => {
  let s = 0x9e3779b9;
  for (const v of k) s = hash32(s, v >>> 0) >>> 0;
  return () => (s = hash32(s, 0x85ebca6b) >>> 0) / 4294967296;
};

/* ---- noise: value noise, smoothstepped. Each partial is at most 1.5 a
   lattice unit (smoothstep's slope, times a difference of values in
   [0, 1]), so |∇| ≤ 1.5√2 in 2D and 1.5√3 in 3D. */
function h3(i, j, k){
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
const sm = f => f * f * (3 - 2 * f);
function noise2(x, y, seed){
  const i = Math.floor(x), j = Math.floor(y), sx = sm(x - i), sy = sm(y - j);
  const a = h3(i, j, seed), b = h3(i + 1, j, seed), c = h3(i, j + 1, seed), d = h3(i + 1, j + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function noise3(x, y, z){
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), sx = sm(x - i), sy = sm(y - j), sz = sm(z - k);
  const l = (a, b, t) => a + (b - a) * t;
  return l(l(l(h3(i, j, k), h3(i + 1, j, k), sx), l(h3(i, j + 1, k), h3(i + 1, j + 1, k), sx), sy),
           l(l(h3(i, j, k + 1), h3(i + 1, j, k + 1), sx), l(h3(i, j + 1, k + 1), h3(i + 1, j + 1, k + 1), sx), sy), sz);
}

/* ---- the mountains: ridged fbm (1 − |2n − 1| an octave) under a broad
   mask, so there are lowlands for the sea as well as ranges. */
const OCTAVES = 6, FEATURES = 2.5;
function heightOf(x, z, S){
  const u = FEATURES * x / S, v = FEATURES * z / S;
  let r = 0, amp = 1, f = 1, norm = 0;
  for (let o = 0; o < OCTAVES; o++){
    r += amp * (1 - Math.abs(2 * noise2(u * f, v * f, 11 + o) - 1)); norm += amp; amp *= 0.5; f *= 2;
  }
  const mask = 0.25 + 0.75 * noise2(0.45 * u + 17, 0.45 * v + 3, 5);
  return S * (0.06 + 0.22 * mask + 0.62 * (r / norm) ** 1.4 * mask);
}

/* ---- the plan: heights, the grid, chambers, tunnels, pools. ---------- */
const G = 192;
const WOBBLE = 8, WAVE = 28, LIP_CAVE = 1 + 2 * WOBBLE * 1.5 * Math.sqrt(3) / WAVE;
export function cavePlan({ D, seed = 1 }){
  const S = 2 ** D, t0 = performance.now();
  // H: the top rock voxel of each column (−1: none).
  const H = new Int16Array(S * S);
  for (let z = 0; z < S; z++) for (let x = 0; x < S; x++)
    H[x + S * z] = Math.max(-1, Math.min(S - 1, Math.floor(heightOf(x + 0.5, z + 0.5, S))));
  const tHeights = performance.now();
  // The pyramid: level k's min and max over each 2^k × 2^k block of columns.
  const mins = [H], maxs = [H];
  for (let k = 1, n = S >> 1; k <= D; k++, n >>= 1){
    const pm = mins[k - 1], pM = maxs[k - 1], m = new Int16Array(n * n), M = new Int16Array(n * n), w = 2 * n;
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++){
      const a = 2 * x + w * 2 * z, b = a + w;
      m[x + n * z] = Math.min(pm[a], pm[a + 1], pm[b], pm[b + 1]);
      M[x + n * z] = Math.max(pM[a], pM[a + 1], pM[b], pM[b + 1]);
    }
    mins.push(m); maxs.push(M);
  }
  const tPyramid = performance.now();
  const seaY = Math.floor(0.12 * S), lavaY = seaY + Math.floor(0.08 * S);
  const Hat = (x, z) => H[Math.max(0, Math.min(S - 1, Math.floor(x))) + S * Math.max(0, Math.min(S - 1, Math.floor(z)))];

  // Nodes: a chamber, an air node or nothing, per grid cell.
  const N = Math.ceil(S / G), idx = (i, j, k) => i + N * (j + N * k);
  const node = new Array(N * N * N).fill(null);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const r = rng(seed, 1, i, j, k);
    const c = [(i + 0.3 + 0.4 * r()) * G, (j + 0.3 + 0.4 * r()) * G, (k + 0.3 + 0.4 * r()) * G];
    // sizes as fractions of G, so every ellipsoid's bounding sphere stays
    // inside its own cell (the cap's premise): centres are ≥ 0.3·G in
    const rx = G * (0.125 + 0.135 * r()), rz = G * (0.125 + 0.135 * r()), ry = G * (0.07 + 0.08 * r());
    const top = Hat(c[0], c[2]);
    if (c[1] + 0.5 * ry <= top && c[1] - ry - WOBBLE >= seaY + 12 && r() < 0.8){
      // a second, smaller ellipsoid off the first, so chambers aren't eggs
      const off = [0.08 * G * (2 * r() - 1), 0.03 * G * (2 * r() - 1), 0.08 * G * (2 * r() - 1)];
      const b = [0.4 + 0.3 * r(), 0.5 + 0.3 * r(), 0.4 + 0.3 * r()].map((s, a) => Math.min(0.19 * G, s * [rx, ry, rz][a] + 6));
      node[idx(i, j, k)] = { kind: 'chamber', i, j, k, c, blobs: [[...c, rx, ry, rz], [c[0] + off[0], c[1] + off[1], c[2] + off[2], ...b]], edges: [] };
    } else if (c[1] > top + 8 && c[1] > seaY + 8 && c[1] < S - 8){
      node[idx(i, j, k)] = { kind: 'air', i, j, k, c, edges: [] };
    }
  }
  // Tunnels: to the +x, +y, +z neighbour. Chamber–chamber more often
  // sideways than up; a chamber opens onto an air node sideways or up.
  const edges = [];
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const a = node[idx(i, j, k)];
    if (!a) continue;
    for (let ax = 0; ax < 3; ax++){
      const q = [i, j, k]; q[ax]++;
      if (q[ax] >= N) continue;
      const b = node[idx(...q)];
      if (!b || (a.kind === 'air' && b.kind === 'air')) continue;
      const r = rng(seed, 2, i, j, k, ax), p = r();
      const both = a.kind === 'chamber' && b.kind === 'chamber';
      // an air node below a chamber is never opened (a mouth looks out or up)
      if (!both && ax === 1 && a.kind === 'air') continue;
      if (p >= (both ? (ax === 1 ? 0.35 : 0.55) : 0.4)) continue;
      const mid = [0, 1, 2].map(d => (a.c[d] + b.c[d]) / 2 + 0.15 * G * (2 * r() - 1));
      const e = { a, b, ax, mid, rad: G * (0.02 + 0.03 * r()), mouth: !both };
      edges.push(e); a.edges.push(e); b.edges.push(e);
    }
  }
  // Pools. Downward chamber tunnels drain a chamber; otherwise its level
  // sits below every tunnel's lowest point inside its box.
  const chambers = node.filter(n => n && n.kind === 'chamber');
  for (const ch of chambers){
    const lo = [0, 1, 2].map(d => Math.floor(Math.min(...ch.blobs.map(b => b[d] - b[3 + d])) - WOBBLE - 1));
    const hi = [0, 1, 2].map(d => Math.ceil(Math.max(...ch.blobs.map(b => b[d] + b[3 + d])) + WOBBLE + 1));
    ch.box = [lo, hi];
    const r = rng(seed, 3, ch.i, ch.j, ch.k);
    if (r() < 0.45) continue;                                   // dry
    if (ch.edges.some(e => e.ax === 1 && e.b === ch)) continue; // drained from below
    let level = Math.floor(ch.c[1] - 0.3 * ch.blobs[0][4]);
    const inBox = p => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1] && p[2] >= lo[2] && p[2] <= hi[2];
    for (const e of ch.edges) for (const [p, q] of [[e.a.c, e.mid], [e.mid, e.b.c]]) for (let t = 0; t <= 64; t++){
      const s = [0, 1, 2].map(d => p[d] + (q[d] - p[d]) * t / 64);
      if (inBox(s)) level = Math.min(level, Math.floor(s[1] - e.rad - WOBBLE - 2));
    }
    if (level < lo[1] + 4) continue;
    let held = true;
    for (let z = Math.max(0, lo[2]); z <= Math.min(S - 1, hi[2]) && held; z++)
      for (let x = Math.max(0, lo[0]); x <= Math.min(S - 1, hi[0]); x++) if (H[x + S * z] < level + 2){ held = false; break; }
    if (!held) continue;
    ch.pool = { level, lava: ch.c[1] < lavaY };
  }
  // The primitives, 10 floats each in one table: a chamber's ellipsoids
  // (0, centre, radii, r_min, r_max) and a tunnel's two capsules (1, ends,
  // radius). Each grid cell lists the ones in the 27 cells around it.
  const table = [], ids = new Map(), add = (key, ...v) => {
    if (!ids.has(key)){ ids.set(key, table.length / 10); table.push(...v); }
    return ids.get(key);
  };
  const cellPrims = new Array(N * N * N), poolsNear = new Array(N * N * N);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const out = [], pools = [];
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){
      const a = i + di, b = j + dj, c = k + dk;
      if (a < 0 || b < 0 || c < 0 || a >= N || b >= N || c >= N) continue;
      const n = node[idx(a, b, c)];
      if (!n) continue;
      if (n.kind === 'chamber'){
        n.blobs.forEach((bl, q) => out.push(add(n.blobs[q], 0, ...bl, Math.min(bl[3], bl[4], bl[5]), Math.max(bl[3], bl[4], bl[5]), 0)));
        if (n.pool) pools.push(n);
      }
      for (const e of n.edges){
        const ia = add(e, 1, ...e.a.c, ...e.mid, e.rad, 0, 0), ib = add(e.mid, 1, ...e.mid, ...e.b.c, e.rad, 0, 0);
        if (!out.includes(ia)) out.push(ia, ib);
      }
    }
    cellPrims[idx(i, j, k)] = Int32Array.from(out);
    poolsNear[idx(i, j, k)] = pools;
  }
  const prim = Float64Array.from(table), maxList = Math.max(1, ...cellPrims.map(l => l.length));
  // The spawn: the best-connected chamber near the middle of the map.
  const comp = components(chambers);
  let spawn = null, best = -Infinity;
  for (const ch of chambers){
    const score = ch.edges.length * G - Math.hypot(ch.c[0] - S / 2, ch.c[2] - S / 2) + (comp.sizeOf.get(ch) || 0) * 4;
    if (score > best){ best = score; spawn = ch; }
  }
  return { D, S, seed, H, mins, maxs, seaY, lavaY, N, node, edges, chambers, prim, cellPrims, maxList, poolsNear, spawn, comp,
           ms: { heights: tHeights - t0, pyramid: tPyramid - tHeights, plan: performance.now() - tPyramid } };
}

function components(chambers){
  const sizeOf = new Map(), seen = new Set(), sizes = [];
  for (const ch of chambers){
    if (seen.has(ch)) continue;
    const list = [ch]; seen.add(ch);
    for (let i = 0; i < list.length; i++) for (const e of list[i].edges){
      const o = e.a === list[i] ? e.b : e.a;
      if (o.kind === 'chamber' && !seen.has(o)){ seen.add(o); list.push(o); }
    }
    for (const c of list) sizeOf.set(c, list.length);
    sizes.push(list.length);
  }
  return { sizeOf, sizes: sizes.sort((a, b) => b - a) };
}

/* ---- the field ------------------------------------------------------- */
// One primitive's distance at p (negative inside), Lipschitz 1.
function primDist(a, o, x, y, z){
  if (a[o] === 0){
    const qx = x - a[o + 1], qy = y - a[o + 2], qz = z - a[o + 3];
    const l = Math.sqrt((qx / a[o + 4]) ** 2 + (qy / a[o + 5]) ** 2 + (qz / a[o + 6]) ** 2), sph = Math.sqrt(qx * qx + qy * qy + qz * qz) - a[o + 8];
    return Math.max((l - 1) * a[o + 7], sph);
  }
  const ax = a[o + 1], ay = a[o + 2], az = a[o + 3], bx = a[o + 4] - ax, by = a[o + 5] - ay, bz = a[o + 6] - az;
  const px = x - ax, py = y - ay, pz = z - az, bb = bx * bx + by * by + bz * bz;
  const t = Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / bb));
  return Math.hypot(px - t * bx, py - t * by, pz - t * bz) - a[o + 7];
}
const EMPTY_LIST = new Int32Array(0);
const listAt = (P, x, y, z) => {
  const i = Math.floor(x / G), j = Math.floor(y / G), k = Math.floor(z / G), N = P.N;
  return i < 0 || j < 0 || k < 0 || i >= N || j >= N || k >= N ? EMPTY_LIST : P.cellPrims[i + N * (j + N * k)];
};
// The cave distance at p (negative in air), capped at G − 1, before the
// walls' noise; Lipschitz 1. `list`/`n`: the primitives to try (all near p).
function caveDist(P, x, y, z, list = listAt(P, x, y, z), n = list.length){
  let d = G - 1;
  for (let q = 0; q < n; q++){ const v = primDist(P.prim, 10 * list[q], x, y, z); if (v < d) d = v; }
  return d;
}
const wobble = (x, y, z) => WOBBLE * (2 * noise3(x / WAVE, y / WAVE, z / WAVE) - 1);
const caveF = (P, x, y, z) => caveDist(P, x, y, z) + wobble(x, y, z);

// Pools: does chamber ch's pool hold the voxel box [x0, x1] × …?
function poolTerm(P, k, X, Y, Z){
  const s = 2 ** k, x0 = X * s, y0 = Y * s, z0 = Z * s, x1 = x0 + s - 1, y1 = y0 + s - 1, z1 = z0 + s - 1;
  // the cells this box can touch: pools live in their chamber's cell ± a little
  const N = P.N, lo = [x0, y0, z0].map(v => Math.max(0, Math.floor(v / G))), hi = [x1, y1, z1].map(v => Math.min(N - 1, Math.floor(v / G)));
  let any = false;
  for (let k2 = lo[2]; k2 <= hi[2]; k2++) for (let j2 = lo[1]; j2 <= hi[1]; j2++) for (let i2 = lo[0]; i2 <= hi[0]; i2++){
    for (const ch of P.poolsNear[i2 + N * (j2 + N * k2)]){
      const [bl, bh] = ch.box, L = ch.pool.level;
      if (x1 < bl[0] || x0 > bh[0] || z1 < bl[2] || z0 > bh[2] || y1 < bl[1] || y0 > Math.min(bh[1], L)) continue;
      if (x0 >= bl[0] && x1 <= bh[0] && z0 >= bl[2] && z1 <= bh[2] && y0 >= bl[1] && y1 <= Math.min(bh[1], L)) return 1;
      any = true;
    }
  }
  return any ? -1 : 0;
}

const AND = (a, b) => a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : -1;
const OR = (a, b) => a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : -1;

/* fromField asks a cell's children right after the cell itself (depth
   first), so the last answer at level k + 1 is the parent's while its
   children are asked. Two things pass down that way:
   - a term the parent decided (no cave here, all pool) holds for every
     child, so the child inherits it instead of evaluating;
   - the primitives that can be nearest anywhere in the parent. Each is
     Lipschitz 1, so one whose distance at the centre is more than the
     nearest's plus twice the half-diagonal ρ is never the nearest inside
     the cell (it's at least d_min + ρ everywhere there, and the nearest
     at most that). Children try only those: one or two by level 2,
     against ~100 a grid cell. Valid only while d_min + 2ρ is under the
     cap, since primitives outside the 27 cells are only known to be ≥ G.
   The values don't change, only which primitives are tried, so the DAG is
   the one the full lists give (the --check run compares it with
   voxelKind, which always uses the full list).
   Without either the D = 12 build took 504 s: the cave walls' cells are
   evaluated at every level (the bound leaves a shell 2·2.48·ρ thick
   undecided), each against every primitive nearby. */
export function caveCell(P, stats){
  const { S, D, seaY, mins, maxs } = P, root3 = Math.sqrt(3);
  const mx_ = new Int32Array(D + 2).fill(-1), my_ = new Int32Array(D + 2), mz_ = new Int32Array(D + 2);
  const mc = new Int8Array(D + 2), mp = new Int8Array(D + 2);
  const ml = Array.from({ length: D + 2 }, () => new Int32Array(P.maxList)), mn_ = new Int32Array(D + 2), mok = new Uint8Array(D + 2);
  const vals = new Float64Array(P.maxList);
  return (k, X, Y, Z) => {
    if (stats) stats.calls[k]++;
    const s = 2 ** k, y0 = Y * s, y1 = y0 + s - 1;
    if (y1 <= seaY) return 1;
    const sea = y0 <= seaY ? -1 : 0, n = S >> k;
    const mn = mins[k][X + n * Z], mx = maxs[k][X + n * Z];
    const t = y1 <= mn ? 1 : y0 > mx ? 0 : -1;
    if (t === 0) return sea;
    const up = k + 1, inherit = mx_[up] === X >> 1 && my_[up] === Y >> 1 && mz_[up] === Z >> 1;
    // the caves, by their own bound
    let c;
    mok[k] = 0;
    if (inherit && mc[up] !== -1) c = mc[up];
    else {
      const rg = root3 * (s - 1) / 2, rho = LIP_CAVE * rg + 1e-9;
      if (rho >= G - 1 - WOBBLE) c = -1;
      else {
        if (stats) stats.caveEvals[k]++;
        const cx = (X + 0.5) * s, cy = (Y + 0.5) * s, cz = (Z + 0.5) * s;
        const passed = inherit && mok[up], list = passed ? ml[up] : listAt(P, cx, cy, cz), len = passed ? mn_[up] : list.length;
        let dmin = Infinity;
        for (let q = 0; q < len; q++){ const v = primDist(P.prim, 10 * list[q], cx, cy, cz); vals[q] = v; if (v < dmin) dmin = v; }
        const v = Math.min(G - 1, dmin) + wobble(cx, cy, cz);
        if (k === 0) c = v <= 0 ? 1 : 0;
        else {
          c = v > rho ? 0 : v < -rho ? 1 : -1;
          if (c === -1 && dmin + 2 * rg < G - 1){
            const out = ml[k]; let m = 0;
            for (let q = 0; q < len; q++) if (vals[q] <= dmin + 2 * rg) out[m++] = list[q];
            mn_[k] = m; mok[k] = 1;
          }
        }
      }
    }
    const notC = c === -1 ? -1 : 1 - c;
    let p = -1;
    if (notC !== 1) p = inherit && mp[up] !== -1 ? mp[up] : poolTerm(P, k, X, Y, Z);
    mx_[k] = X; my_[k] = Y; mz_[k] = Z; mc[k] = c; mp[k] = p;
    const v = OR(sea, AND(t, notC === 1 ? 1 : OR(notC, p)));
    if (stats && v === -1) stats.split[k]++;
    return v;
  };
}

// One voxel, the same logic at level 0 (for slices and the colour field).
function voxelKind(P, x, y, z){
  if (y <= P.seaY && !(y <= P.H[x + P.S * z] && caveF(P, x + 0.5, y + 0.5, z + 0.5) > 0)) return 'sea';
  if (y > P.H[x + P.S * z]) return 'air';
  if (caveF(P, x + 0.5, y + 0.5, z + 0.5) > 0) return 'rock';
  return poolTerm(P, 0, x, y, z) === 1 ? 'pool' : 'air';
}

/* ---- colour (in voxel units, a voxel's centre) ------------------------ */
const ramp = (t, stops) => {
  if (t <= stops[0][0]) return stops[0].slice(1);
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]){
    const a = stops[i - 1], b = stops[i], u = (t - a[0]) / (b[0] - a[0]);
    return [1, 2, 3].map(c => a[c] + (b[c] - a[c]) * u);
  }
  return stops[stops.length - 1].slice(1);
};
const STRATA = [[0, 112, 92, 78], [0.25, 150, 128, 104], [0.4, 128, 104, 86], [0.55, 168, 150, 126], [0.75, 120, 100, 88], [1, 112, 92, 78]];
const SURFACE = [[0.10, 200, 188, 140], [0.13, 96, 142, 64], [0.30, 70, 116, 54], [0.42, 112, 104, 90], [0.55, 140, 136, 132], [0.60, 236, 240, 246]];
export function caveColour(P){
  const { S, H } = P;
  return (x, y, z) => {
    const xi = Math.max(0, Math.min(S - 1, Math.floor(x))), yi = Math.floor(y), zi = Math.max(0, Math.min(S - 1, Math.floor(z)));
    const kind = voxelKind(P, xi, yi, zi);
    if (kind === 'sea') return rgb8(36, 84, 140);
    if (kind === 'pool'){
      const ch = P.chambers.find(c => c.pool && xi >= c.box[0][0] && xi <= c.box[1][0] && zi >= c.box[0][2] && zi <= c.box[1][2] && yi >= c.box[0][1] && yi <= c.pool.level);
      const n = noise2(x / 9, z / 9, 3);
      return ch && ch.pool.lava ? rgb8(235, 80 + 110 * n, 20 + 30 * n) : rgb8(40, 110 + 30 * n, 170);
    }
    const depth = H[xi + S * zi] - yi;
    if (depth < 3){ const c = ramp(y / S + 0.04 * (noise2(x / 40, z / 40, 9) - 0.5), SURFACE); return rgb8(c[0], c[1], c[2]); }
    const c = ramp((((y / 41 + 0.6 * noise2(x / 160, z / 160, 4)) % 1) + 1) % 1, STRATA);
    return rgb8(c[0], c[1], c[2]);
  };
}

/* ---- run ------------------------------------------------------------- */
const fmt = n => n.toLocaleString('en-US');
export function buildCaves(D, seed = 1){
  const P = cavePlan({ D, seed }), stats = { calls: new Array(D + 1).fill(0), split: new Array(D + 1).fill(0), caveEvals: new Array(D + 1).fill(0) };
  const store = createStore(), t0 = performance.now();
  const { root } = store.fromField(D, caveCell(P, stats));
  const ms = performance.now() - t0;
  return { P, store, root, stats, ms };
}

if (process.argv[1].endsWith('cave-sketch.mjs')){
  const args = process.argv.slice(2), print = args.includes('--print');
  const only = args.find(a => a.startsWith('--D='));
  const Ds = only ? [Number(only.slice(4))] : [10, 11, 12];
  console.log('| D | side | chambers | pools (lava) | tunnels (mouths) | largest network | nodes | voxels | heights | plan | build |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  let last = null;
  for (const D of Ds){
    const w = buildCaves(D), { P } = w, voxels = createCounts(w.store).of(w.root);
    const pools = P.chambers.filter(c => c.pool), mouths = P.edges.filter(e => e.mouth).length;
    console.log(`| ${D} | ${fmt(P.S)}³ | ${fmt(P.chambers.length)} | ${pools.length} (${pools.filter(c => c.pool.lava).length}) | ${fmt(P.edges.length)} (${mouths}) | ` +
      `${P.comp.sizes[0] || 0} | ${fmt(w.store.size)} | ${fmt(voxels)} | ${(P.ms.heights / 1000).toFixed(1)} s | ${(P.ms.pyramid + P.ms.plan).toFixed(0)} ms | ${(w.ms / 1000).toFixed(1)} s |`);
    console.error(`  D=${D} calls per level ${w.stats.calls.join(' ')}\n        split          ${w.stats.split.join(' ')}\n        cave evals     ${w.stats.caveEvals.join(' ')}`);
    last = w;
  }
  if (args.includes('--check') && last){
    // The DAG against the voxel rule: uniform samples, and samples on the
    // cave walls (near each chamber's and tunnel's surface), where a bound
    // too tight or a wrong inheritance would show first.
    const { P, store, root } = last, S = P.S, r = rng(7), pts = [];
    for (let i = 0; i < 200000; i++) pts.push([r() * S, r() * S, r() * S].map(Math.floor));
    for (const ch of P.chambers) for (let i = 0; i < 400; i++){
      const b = ch.blobs[i & 1], u = 2 * r() - 1, th = 2 * Math.PI * r(), w = Math.sqrt(1 - u * u), f = 0.85 + 0.3 * r();
      pts.push([b[0] + f * b[3] * w * Math.cos(th), b[1] + f * b[4] * u, b[2] + f * b[5] * w * Math.sin(th)].map(Math.floor));
    }
    for (const e of P.edges) for (let i = 0; i < 200; i++){
      const t = r(), [p, q] = t < 0.5 ? [e.a.c, e.mid] : [e.mid, e.b.c], u = (t % 0.5) * 2;
      pts.push([0, 1, 2].map(d => Math.floor(p[d] + (q[d] - p[d]) * u + (e.rad + 4) * (2 * r() - 1))));
    }
    let bad = 0, n = 0;
    for (const [x, y, z] of pts){
      if (x < 0 || y < 0 || z < 0 || x >= S || y >= S || z >= S) continue;
      n++;
      if (store.query(root, P.D, x, y, z) !== (voxelKind(P, x, y, z) === 'air' ? 0 : 1)) bad++;
    }
    console.log(`check: ${bad} of ${fmt(n)} sampled voxels disagree`);
  }
  if (!print && last){
    const { P, store, root } = last, S = P.S, D = P.D, colour = caveColour(P), sp = P.spawn;
    const shots = [];
    shots.push(['far', { eye: [-0.12 * S, 0.95 * S, -0.12 * S], yaw: 0.78, pitch: -0.42 }]);
    if (sp){
      // from the chamber's far side, looking down one of its tunnels
      const e = sp.edges.find(e => !e.mouth && e.ax !== 1) || sp.edges[0], o = e ? e.mid : [sp.c[0] + 1, sp.c[1], sp.c[2]];
      const dx = o[0] - sp.c[0], dz = o[2] - sp.c[2], l = Math.hypot(dx, dz) || 1, b = sp.blobs[0];
      shots.push(['inside', { eye: [sp.c[0] - 0.6 * b[3] * dx / l, sp.c[1] + 4, sp.c[2] - 0.6 * b[5] * dz / l], yaw: Math.atan2(dx, dz), pitch: -0.08, fog: 400 }]);
    }
    const pool = P.chambers.find(c => c.pool && c.pool.lava && c.edges.length) || P.chambers.find(c => c.pool);
    if (pool){
      const b = pool.blobs[0];
      shots.push(['pool', { eye: [pool.c[0] - 0.6 * b[3], pool.pool.level + 0.55 * (b[1] + b[4] - pool.pool.level), pool.c[2] - 0.6 * b[5]], yaw: 0.78, pitch: -0.35, fog: 400 }]);
    }
    const mouth = P.edges.find(e => e.mouth && e.ax !== 1);
    if (mouth){
      const air = mouth.a.kind === 'air' ? mouth.a : mouth.b, ch = air === mouth.a ? mouth.b : mouth.a;
      const d = [ch.c[0] - air.c[0], ch.c[2] - air.c[2]], l = Math.hypot(...d);
      shots.push(['mouth', { eye: [air.c[0] - 0.3 * d[0], air.c[1] + 30, air.c[2] - 0.3 * d[1]], yaw: Math.atan2(d[0], d[1]), pitch: -0.12, fog: 1500 }]);
    }
    for (const [name, v] of shots){
      const t = performance.now();
      writeFileSync(`docs/images/cave-sketch-${name}.png`, render(store, root, D, { ...v, colour, w: 640, h: 400 }));
      console.error(`  ${name}: ${((performance.now() - t) / 1000).toFixed(1)} s`);
    }
    // A vertical section through the spawn, every voxel 1 pixel (downsampled to ≤ 1024).
    const step = Math.max(1, S / 1024), W = Math.floor(S / step), zc = sp ? Math.floor(sp.c[2]) : S >> 1, img = new Uint8Array(W * W * 3);
    for (let py = 0; py < W; py++) for (let px = 0; px < W; px++){
      const x = Math.floor(px * step), y = S - 1 - Math.floor(py * step), kind = voxelKind(P, x, y, zc);
      const c = kind === 'air' ? [18, 18, 26] : (v => [v & 255, v >> 8 & 255, v >> 16 & 255])(colour(x + 0.5, y + 0.5, zc + 0.5));
      img.set(c, 3 * (px + W * py));
    }
    writeFileSync('docs/images/cave-sketch-section.png', png(W, W, img));
    // A map of the network from above: the heightfield in grey, then every
    // chamber and tunnel painted lowest first, coloured by height (blue low,
    // red high), pools in their own colour, mouths white.
    const map = new Uint8Array(W * W * 3), hue = y => { const u = Math.max(0, Math.min(1, (y - P.seaY) / (0.5 * S))); return [60 + 195 * u, 120 + 60 * Math.sin(Math.PI * u), 255 - 195 * u]; };
    for (let py = 0; py < W; py++) for (let px = 0; px < W; px++){
      const h = P.H[Math.floor(px * step) + S * Math.floor(py * step)], g = h <= P.seaY ? null : 30 + 90 * h / S;
      map.set(g === null ? [26, 46, 74] : [g, g, g], 3 * (px + W * py));
    }
    const paint = (x, z, r, c) => {
      const cx = x / step, cz = z / step, rr = Math.max(0.7, r / step);
      for (let v = Math.floor(cz - rr); v <= cz + rr; v++) for (let u = Math.floor(cx - rr); u <= cx + rr; u++)
        if (u >= 0 && v >= 0 && u < W && v < W && (u - cx) ** 2 + (v - cz) ** 2 <= rr * rr) map.set(c, 3 * (u + W * v));
    };
    const items = [];
    for (const e of P.edges) for (const [p, q] of [[e.a.c, e.mid], [e.mid, e.b.c]]) for (let t = 0; t <= 1; t += 0.02){
      const s3 = [0, 1, 2].map(d => p[d] + (q[d] - p[d]) * t);
      items.push([s3[1], s3[0], s3[2], e.rad, e.mouth ? [235, 235, 235] : null]);
    }
    for (const ch of P.chambers) for (const b of ch.blobs)
      items.push([b[1], b[0], b[2], Math.max(b[3], b[5]), ch.pool ? (ch.pool.lava ? [255, 96, 16] : [40, 255, 190]) : null]);
    items.sort((a, b) => a[0] - b[0]);
    for (const [y, x, z, r, c] of items) paint(x, z, r, c || hue(y));
    writeFileSync('docs/images/cave-sketch-map.png', png(W, W, map));
  }
}
