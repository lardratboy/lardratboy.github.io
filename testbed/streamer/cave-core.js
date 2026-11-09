/* CAVE CORE: caves under mountains (docs/caves-plan.md). Pure: imports
   dag-core.js and specimen-core.js's hash, no DOM. The world is the
   sketch's (experiments/cave-sketch.mjs, plan §1–2), with the grid broken
   up and worms added (§6 Q1), built whole on one thread (buildCaves) or
   in column parts across workers (buildCavePart + assembleCaves, which
   give the same DAG).

   Everything is in voxel units: voxel (x, y, z) has its centre at
   (x + ½, y + ½, z + ½), y up, in a world of side S = 2^D. A voxel is
   solid when it is rock, sea or pool:
   - rock: y ≤ H(x, z), the column's top (ridged fbm, scaled with S), and
     not carved by a cave;
   - sea: y ≤ seaY, everywhere: flat, in the valleys and in any cave that
     reaches that low;
   - pool: in a chamber's box, at or below its level, carved, and under
     the surface (flat, and held in by rock: below, the rules for pools).

   The caves don't scale with S: a grid of side G (192 by default) holds
   at most one chamber a cell (two overlapping ellipsoids), joined to its
   neighbours (the six faces' and the four horizontal diagonals') by
   tunnels bent twice, opening onto the open air beside it as a mouth at
   the chamber's own height, or above it as a skylight. Worms (random-walk
   tunnels, a capsule a step) leave some chambers and wander, out of the
   mountain sometimes. 3D noise pushes every wall in and out by WOBBLE.

   The field is decided term by term in three-valued logic (0, 1, −1 =
   can't tell; caveCell): the heights exactly, by a min/max pyramid of
   the column tops; the sea and pools exactly, as planes and boxes; only
   the caves by a Lipschitz bound. One bound for the whole field would
   leave every cell within ~19 sides of the ridged surface undecided
   (plan §2, try 1).

   THE CAP. The cave distance is min(G − 1, nearest primitive), which is
   what keeps each grid cell's list short: a cell lists every primitive
   with a home cell among its 27 neighbours, and a primitive's home cells
   are every grid cell its bounding box touches. So a primitive a point
   doesn't list has all its home cells two or more cells away, and is at
   least G from the point: the cap never hides it, and the distance stays
   1-Lipschitz across grid cells. The sketch needed size rules to keep
   each chamber inside its own cell; registering by bounding box needs
   none, so the chambers and tunnels can wander. An ellipsoid's cheap
   distance, (|q/r| − 1)·r_min, underestimates far away, so it is maxed
   with its bounding sphere's distance, or the cap would lie.

   POOLS. A pool may meet air only at its flat top. Its box is the
   chamber's ellipsoids' bounding box grown by WOBBLE + 1, so the chamber's
   own carving never reaches the box's faces. Every other primitive that
   enters the box puts the level below its lowest point there (a tunnel
   down drains the pool, a worm through its side lowers it), and every
   column of the box must stand above the level. Then any pool voxel's
   sides and bottom are rock or pool (test/cave-core.test.js holds that).

   Draws are consumed in a fixed order a cell (rng(seed, purpose, cell…)),
   so a world is its descriptor { kind: 'caves', D, seed, G }. */
import { createStore, prune, EMPTY } from './dag-core.js';
import { hash32 } from './specimen-core.js';

export const CAVE_LIMITS = { D: [8, 12] };
const WOBBLE = 8, WAVE = 28, LIP_CAVE = 1 + 2 * WOBBLE * 1.5 * Math.sqrt(3) / WAVE;
const OCTAVES = 6, FEATURES = 2.5, ROOT3 = Math.sqrt(3);

export function caveDesc({ D = 12, seed = 1, G = 192 } = {}){
  if (!Number.isInteger(D) || D < CAVE_LIMITS.D[0] || D > CAVE_LIMITS.D[1]) throw new Error(`caves: D must be ${CAVE_LIMITS.D.join(' to ')}, not ${D}`);
  if (!Number.isInteger(seed) || seed < 1) throw new Error(`caves: the seed must be a positive integer, not ${seed}`);
  if (!Number.isInteger(G) || G < 32) throw new Error(`caves: G must be an integer ≥ 32, not ${G}`);
  return { kind: 'caves', D, seed, G };
}

const rng = (...k) => {
  let s = 0x9e3779b9;
  for (const v of k) s = hash32(s, v >>> 0) >>> 0;
  return () => (s = hash32(s, 0x85ebca6b) >>> 0) / 4294967296;
};

/* ---- noise: value noise, smoothstepped. Each partial is at most 1.5 a
   lattice unit (smoothstep's slope, times a difference of values in
   [0, 1]), so |∇| ≤ 1.5√3 in 3D: the wall noise's share of LIP_CAVE. */
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
function noise3(x, y, z, seed){
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z), sx = sm(x - i), sy = sm(y - j), sz = sm(z - k);
  const l = (a, b, t) => a + (b - a) * t, q = seed * 7919;
  return l(l(l(h3(i + q, j, k), h3(i + 1 + q, j, k), sx), l(h3(i + q, j + 1, k), h3(i + 1 + q, j + 1, k), sx), sy),
           l(l(h3(i + q, j, k + 1), h3(i + 1 + q, j, k + 1), sx), l(h3(i + q, j + 1, k + 1), h3(i + 1 + q, j + 1, k + 1), sx), sy), sz);
}

/* ---- the mountains: ridged fbm (1 − |2n − 1| an octave) under a broad
   mask, sunk in a few broad basins. The basins are the sea's: six ridged
   octaves average to ~0.5 or more almost everywhere, so without them the
   lowest ground stood at ~0.3·S and the sea (0.12·S) never appeared; a
   basin takes up to 80% off the height where a low-frequency noise is
   high, ~10% of the map, and leaves the mountain mass (and the caves'
   rock) elsewhere as it was. */
function heightOf(x, z, S, seed){
  const u = FEATURES * x / S, v = FEATURES * z / S, s = 101 * seed;
  let r = 0, amp = 1, f = 1, norm = 0;
  for (let o = 0; o < OCTAVES; o++){
    r += amp * (1 - Math.abs(2 * noise2(u * f, v * f, s + 11 + o) - 1)); norm += amp; amp *= 0.5; f *= 2;
  }
  const mask = 0.25 + 0.75 * noise2(0.45 * u + 17, 0.45 * v + 3, s + 5);
  const w = Math.max(0, Math.min(1, (noise2(0.8 * u + 31, 0.8 * v + 7, s + 3) - 0.55) / 0.22)), basin = 1 - 0.8 * w * w * (3 - 2 * w);
  return S * (0.06 + 0.22 * mask + 0.62 * (r / norm) ** 1.4 * mask) * basin;
}
// A column's top rock voxel (−1: none); x, z integers in [0, S).
const topOf = (plan, x, z) => Math.max(-1, Math.min(plan.S - 1, Math.floor(heightOf(x + 0.5, z + 0.5, plan.S, plan.seed))));
const topAt = (plan, x, z) => topOf(plan, Math.max(0, Math.min(plan.S - 1, Math.floor(x))), Math.max(0, Math.min(plan.S - 1, Math.floor(z))));

/* ---- the plan --------------------------------------------------------- */
// The tunnels' neighbours: the six faces (three, each pair once) and the four
// horizontal diagonals (two), so the network isn't a lattice of right angles.
const STEPS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 0, -1]];
const plans = new Map();
export function cavePlan(desc){
  const key = `${desc.D},${desc.seed},${desc.G}`;
  if (!plans.has(key)){ plans.clear(); plans.set(key, makePlan(desc)); }
  return plans.get(key);
}
function makePlan(desc){
  const { D, seed, G } = desc, S = 2 ** D, N = Math.ceil(S / G), t0 = performance.now();
  const seaY = Math.floor(0.12 * S), lavaY = seaY + Math.floor(0.08 * S);
  const plan = { desc, D, S, seed, G, N, seaY, lavaY };
  const idx = (i, j, k) => i + N * (j + N * k), inWorld = (p, m) => p.every(v => v >= m && v <= S - 1 - m);

  // Nodes: a chamber, an air node or nothing, per grid cell.
  const node = new Array(N * N * N).fill(null);
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const r = rng(seed, 1, i, j, k);
    const c = [(i + 0.15 + 0.7 * r()) * G, (j + 0.15 + 0.7 * r()) * G, (k + 0.15 + 0.7 * r()) * G];
    const rx = G * (0.11 + 0.12 * r()), rz = G * (0.11 + 0.12 * r()), ry = G * (0.09 + 0.08 * r());
    const off = [0.08 * G * (2 * r() - 1), 0.03 * G * (2 * r() - 1), 0.08 * G * (2 * r() - 1)];
    const sb = [0.4 + 0.3 * r(), 0.5 + 0.3 * r(), 0.4 + 0.3 * r()], keep = r();
    if (!inWorld(c, 2)) continue;
    const top = topAt(plan, c[0], c[2]), rmax = Math.max(rx, ry, rz) + 0.12 * G;
    if (c[1] + 0.5 * ry <= top && c[1] - ry - WOBBLE >= seaY + 12 && keep < 0.8 && inWorld(c, rmax + WOBBLE + 2)){
      const b = sb.map((s, a) => Math.min(0.17 * G, s * [rx, ry, rz][a] + 6));
      // Tunnels and worms leave from `at`, a third of the chamber's height
      // above its centre: from the centre, every tunnel's floor pinned the
      // pool's level to the chamber's floor (D = 12 kept 56 pools of 341).
      node[idx(i, j, k)] = { kind: 'chamber', i, j, k, c, at: [c[0], c[1] + ry / 3, c[2]], blobs: [[...c, rx, ry, rz], [c[0] + off[0], c[1] + off[1], c[2] + off[2], ...b]], edges: [], worms: 0 };
    } else if (c[1] > top + 8 && c[1] > seaY + 8 && c[1] < S - 8){
      node[idx(i, j, k)] = { kind: 'air', i, j, k, c, at: c, edges: [] };
    }
  }

  // Tunnels, each a polyline of capsules.
  const edges = [];
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const a = node[idx(i, j, k)];
    if (!a) continue;
    STEPS.forEach((st, si) => {
      const q = [i + st[0], j + st[1], k + st[2]];
      if (q.some(v => v < 0 || v >= N)) return;
      const b = node[idx(...q)], r = rng(seed, 2, i, j, k, si), p = r(), rad = G * (0.02 + 0.03 * r());
      const jit = () => 0.12 * G * (2 * r() - 1), j1 = [jit(), jit(), jit()], j2 = [jit(), jit(), jit()];
      if (!b || (a.kind === 'air' && b.kind === 'air')) return;
      const diag = si >= 3, up = si === 1;
      const lerp = (u, jj) => [0, 1, 2].map(d => a.at[d] + (b.at[d] - a.at[d]) * u + jj[d]);
      if (a.kind === 'chamber' && b.kind === 'chamber'){
        if (p >= (up ? 0.3 : diag ? 0.2 : 0.5)) return;
        addEdge(a, b, [a.at, lerp(1 / 3, j1), lerp(2 / 3, j2), b.at], rad, false);
        return;
      }
      if (diag || p >= 0.4) return;
      const ch = a.kind === 'chamber' ? a : b, air = ch === a ? b : a;
      if (up){
        // a skylight: only up, from a chamber to the air above it
        if (ch !== a) return;
        addEdge(ch, air, [ch.at, lerp(0.5, [j1[0], 0, j1[2]]), air.c], rad, true);
        return;
      }
      // a mouth: level with the chamber, out to the open air beside it
      const end = [air.c[0], ch.at[1], air.c[2]];
      if (topAt(plan, end[0], end[2]) >= ch.at[1] - rad - WOBBLE - 4) return;
      const mid = [(ch.c[0] + end[0]) / 2 + j1[0], ch.at[1], (ch.c[2] + end[2]) / 2 + j1[2]];
      addEdge(ch, air, [ch.at, mid, end], rad, true);
    });
  }
  function addEdge(a, b, pts, rad, mouth){
    const e = { a, b, pts, rad, mouth };
    edges.push(e); a.edges.push(e); b.edges.push(e);
  }
  const chambers = node.filter(n => n && n.kind === 'chamber');

  // Worms: random walks from some chambers, a capsule a step. They turn
  // smoothly, stay level-ish, keep off the sea, and stop two steps after
  // leaving the mountain (so most that reach a slope end in a mouth).
  const worms = [], STEP = 14;
  for (const ch of chambers){
    const r = rng(seed, 4, ch.i, ch.j, ch.k), n = (r() < 0.45 ? 1 : 0) + (r() < 0.15 ? 1 : 0);
    for (let w = 0; w < n; w++){
      let pos = ch.at, yaw = 2 * Math.PI * r(), pitch = 0.4 * (r() - 0.5), rad = 3 + 4 * r(), outside = 0;
      const steps = 10 + Math.floor(30 * r()), segs = [];
      for (let s = 0; s < steps; s++){
        yaw += 0.9 * (r() - 0.5);
        pitch = Math.max(-0.55, Math.min(0.55, 0.75 * pitch + 0.5 * (r() - 0.5)));
        rad = Math.max(3, Math.min(8, rad + 1.6 * (r() - 0.5)));
        const dir = () => [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
        let next = pos.map((v, d) => v + STEP * dir()[d]);
        if (next[1] - rad - WOBBLE < seaY + 6){ pitch = 0.3; next = pos.map((v, d) => v + STEP * dir()[d]); }
        if (!inWorld(next, rad + WOBBLE + 2)) break;
        segs.push([pos, next, rad]);
        pos = next;
        if (next[1] - rad - WOBBLE > topAt(plan, next[0], next[2]) && ++outside >= 2) break;
      }
      if (segs.length){ worms.push({ from: ch, segs }); ch.worms++; }
    }
  }

  // The primitives, 10 floats each: an ellipsoid (0, centre, radii, r_min,
  // r_max) or a capsule (1, ends, radius). Each is registered in every grid
  // cell its bounding box touches (its home cells), and a cell lists every
  // primitive homed among its 27 neighbours (THE CAP, above).
  const table = [], homes = Array.from({ length: N * N * N }, () => []), boxes = [];
  const addPrim = (v, lo, hi) => {
    const id = table.length / 10;
    table.push(...v); boxes.push([lo, hi]);
    const a = lo.map(x => Math.max(0, Math.floor(x / G))), b = hi.map(x => Math.min(N - 1, Math.floor(x / G)));
    for (let k = a[2]; k <= b[2]; k++) for (let j = a[1]; j <= b[1]; j++) for (let i = a[0]; i <= b[0]; i++) homes[idx(i, j, k)].push(id);
    return id;
  };
  const capsule = (p, q, rad) => addPrim([1, ...p, ...q, rad, 0, 0], [0, 1, 2].map(d => Math.min(p[d], q[d]) - rad), [0, 1, 2].map(d => Math.max(p[d], q[d]) + rad));
  for (const ch of chambers){
    ch.prims = ch.blobs.map(b => {
      const rmax = Math.max(b[3], b[4], b[5]);
      return addPrim([0, ...b, Math.min(b[3], b[4], b[5]), rmax, 0], [b[0] - rmax, b[1] - rmax, b[2] - rmax], [b[0] + rmax, b[1] + rmax, b[2] + rmax]);
    });
  }
  for (const e of edges) for (let s = 0; s + 1 < e.pts.length; s++) capsule(e.pts[s], e.pts[s + 1], e.rad);
  for (const w of worms) for (const [p, q, rad] of w.segs) capsule(p, q, rad);
  const prim = Float64Array.from(table), stamp = new Int32Array(boxes.length).fill(-1);
  const cellPrims = new Array(N * N * N);
  let maxList = 1;
  for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
    const out = [], me = idx(i, j, k);
    for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++){
      const a = i + di, b = j + dj, c = k + dk;
      if (a < 0 || b < 0 || c < 0 || a >= N || b >= N || c >= N) continue;
      for (const id of homes[idx(a, b, c)]) if (stamp[id] !== me){ stamp[id] = me; out.push(id); }
    }
    cellPrims[me] = Int32Array.from(out);
    maxList = Math.max(maxList, out.length);
  }
  Object.assign(plan, { node, edges, worms, chambers, prim, cellPrims, maxList });

  // Pools (POOLS, above). Each pool is registered in the cells its box touches.
  const poolHomes = Array.from({ length: N * N * N }, () => []);
  for (const ch of chambers){
    const lo = [0, 1, 2].map(d => Math.floor(Math.min(...ch.blobs.map(b => b[d] - b[3 + d])) - WOBBLE - 1));
    const hi = [0, 1, 2].map(d => Math.ceil(Math.max(...ch.blobs.map(b => b[d] + b[3 + d])) + WOBBLE + 1));
    ch.box = [lo, hi];
    if (rng(seed, 3, ch.i, ch.j, ch.k)() < 0.45) continue;            // dry
    let level = Math.floor(ch.c[1] - 0.3 * ch.blobs[0][4]);
    for (const id of cellPrims[idx(ch.i, ch.j, ch.k)]){
      if (ch.prims.includes(id)) continue;
      const o = 10 * id, m = (prim[o] === 0 ? prim[o + 8] : prim[o + 7]) + WOBBLE;
      if (prim[o] === 0){
        if ([0, 1, 2].every(d => prim[o + 1 + d] - m <= hi[d] && prim[o + 1 + d] + m >= lo[d])) level = Math.min(level, Math.floor(prim[o + 2] - m - 2));
      } else {
        const y = lowestIn(prim, o, lo, hi, m);
        if (y !== null) level = Math.min(level, Math.floor(y - m - 2));
      }
    }
    // At least a quarter of the chamber deep: the box reaches WOBBLE + 1
    // below the floor, so "4 above the box" let a pool's level sit under
    // the carved floor and hold nothing (two of D = 9's lava pools did).
    if (level < ch.c[1] - 0.75 * ch.blobs[0][4] || !held(plan, lo, hi, level)) continue;
    ch.pool = { level, lava: ch.c[1] < lavaY };
    const a = lo.map(x => Math.max(0, Math.floor(x / G))), b = hi.map(x => Math.min(N - 1, Math.floor(x / G)));
    for (let k = a[2]; k <= b[2]; k++) for (let j = a[1]; j <= b[1]; j++) for (let i = a[0]; i <= b[0]; i++) poolHomes[idx(i, j, k)].push(ch);
  }
  plan.poolHomes = poolHomes;

  // The start: a big, well-connected chamber near the middle of the map,
  // in the largest network. Size counts: the first pick, by connections
  // alone, was a small chamber whose far wall filled the view.
  const comp = components(chambers);
  let spawn = null, best = -Infinity;
  for (const ch of chambers){
    const b = ch.blobs[0], score = ch.edges.length * G - Math.hypot(ch.c[0] - S / 2, ch.c[2] - S / 2) + comp.sizeOf.get(ch) * 4 + 6 * (b[3] + b[5]);
    if (score > best){ best = score; spawn = ch; }
  }
  plan.spawn = spawn;
  plan.comp = comp;
  plan.ms = performance.now() - t0;
  return plan;
}
// Every column of the box stands at least 2 above the level (a coarse
// pass first, so most failures are found in a few hundred columns).
function held(plan, lo, hi, level){
  const x0 = Math.max(0, lo[0]), x1 = Math.min(plan.S - 1, hi[0]), z0 = Math.max(0, lo[2]), z1 = Math.min(plan.S - 1, hi[2]);
  for (const st of [8, 1]) for (let z = z0; z <= z1; z += st) for (let x = x0; x <= x1; x += st) if (topOf(plan, x, z) < level + 2) return false;
  return true;
}
// A capsule's lowest axis point inside the box grown by m (Liang–Barsky), or null.
function lowestIn(prim, o, lo, hi, m){
  const p = [prim[o + 1], prim[o + 2], prim[o + 3]], d = [prim[o + 4] - p[0], prim[o + 5] - p[1], prim[o + 6] - p[2]];
  let t0 = 0, t1 = 1;
  for (let a = 0; a < 3; a++){
    const l = lo[a] - m, h = hi[a] + m;
    if (Math.abs(d[a]) < 1e-12){ if (p[a] < l || p[a] > h) return null; continue; }
    let u = (l - p[a]) / d[a], v = (h - p[a]) / d[a];
    if (u > v){ const s = u; u = v; v = s; }
    t0 = Math.max(t0, u); t1 = Math.min(t1, v);
    if (t0 > t1) return null;
  }
  return Math.min(p[1] + t0 * d[1], p[1] + t1 * d[1]);
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

/* What the viewer shows and opens on: down one of the start chamber's
   tunnels, from inside the chamber. The eye stands on the tunnel's own
   axis (its first segment, extended back into the chamber), so the line
   of sight runs down the tunnel: aimed at the first bend from off the
   axis, it met the wall beside a 4–10-voxel opening, twice. Of the
   chamber's tunnels and eye distances, the one whose centre ray runs
   furthest through air (marched by voxelKind) wins, discounted by its
   slope, so the view opens level rather than up a shaft. Mouths don't
   count: the longest sight is always out of one, onto the open slope. */
export function caveInfo(plan){
  const pools = plan.chambers.filter(c => c.pool), sp = plan.spawn;
  let view = null;
  if (sp){
    const free = (eye, u) => { let t = 0; while (t < 600 && voxelKind(plan, ...eye.map((v, a) => Math.floor(v + u[a] * t))) === 'air') t += 2; return t; };
    let best = -1;
    const inner = sp.edges.filter(e => !e.mouth);
    for (const e of inner.length ? inner : sp.edges){
      const s0 = e.a === sp ? e.pts[0] : e.pts[e.pts.length - 1], s1 = e.a === sp ? e.pts[1] : e.pts[e.pts.length - 2];
      const d = s1.map((v, a) => v - s0[a]), l = Math.hypot(...d), u = d.map(v => v / l);
      for (const back of [40, 30, 20, 10, 0]){
        const eye = s0.map((v, a) => v - back * u[a]);
        // room around the eye too: 6 voxels of air along each axis
        if (![[0, 0, 0], [6, 0, 0], [-6, 0, 0], [0, 6, 0], [0, -6, 0], [0, 0, 6], [0, 0, -6]]
              .every(o => voxelKind(plan, ...eye.map((v, a) => Math.floor(v + o[a]))) === 'air')) continue;
        const f = free(eye, u) * (1 - Math.abs(u[1]));
        if (f > best){ best = f; view = { eye, yaw: Math.atan2(u[0], u[2]), pitch: Math.asin(u[1]) }; }
      }
    }
    if (!view) view = { eye: [...sp.c], yaw: 0, pitch: 0 };
  }
  return { chambers: plan.chambers.length, pools: pools.length, lava: pools.filter(c => c.pool.lava).length,
           tunnels: plan.edges.length, mouths: plan.edges.filter(e => e.mouth).length, worms: plan.worms.length,
           network: plan.comp.sizes[0] || 0, primitives: plan.prim.length / 10, planMs: plan.ms, view };
}

/* ---- the field --------------------------------------------------------- */
// One primitive's distance at p (negative inside), 1-Lipschitz.
function primDist(a, o, x, y, z){
  if (a[o] === 0){
    const qx = x - a[o + 1], qy = y - a[o + 2], qz = z - a[o + 3];
    const l = Math.sqrt((qx / a[o + 4]) ** 2 + (qy / a[o + 5]) ** 2 + (qz / a[o + 6]) ** 2), sph = Math.sqrt(qx * qx + qy * qy + qz * qz) - a[o + 8];
    return Math.max((l - 1) * a[o + 7], sph);
  }
  const ax = a[o + 1], ay = a[o + 2], az = a[o + 3], bx = a[o + 4] - ax, by = a[o + 5] - ay, bz = a[o + 6] - az;
  const px = x - ax, py = y - ay, pz = z - az, bb = bx * bx + by * by + bz * bz;
  const t = bb > 0 ? Math.max(0, Math.min(1, (px * bx + py * by + pz * bz) / bb)) : 0;
  return Math.hypot(px - t * bx, py - t * by, pz - t * bz) - a[o + 7];
}
const NO_PRIMS = new Int32Array(0);
const listAt = (plan, x, y, z) => {
  const G = plan.G, N = plan.N, i = Math.floor(x / G), j = Math.floor(y / G), k = Math.floor(z / G);
  return i < 0 || j < 0 || k < 0 || i >= N || j >= N || k >= N ? NO_PRIMS : plan.cellPrims[i + N * (j + N * k)];
};
const wobble = (plan, x, y, z) => WOBBLE * (2 * noise3(x / WAVE, y / WAVE, z / WAVE, plan.seed) - 1);
// The cave field at p: ≤ 0 is carved. LIP_CAVE-Lipschitz.
function caveF(plan, x, y, z){
  const list = listAt(plan, x, y, z);
  let d = plan.G - 1;
  for (let q = 0; q < list.length; q++){ const v = primDist(plan.prim, 10 * list[q], x, y, z); if (v < d) d = v; }
  return d + wobble(plan, x, y, z);
}
// The cave field at a point, from the point's grid-cell list or (all:
// true, the tests' check of THE CAP) from every primitive in the world.
export function caveFieldAt(plan, x, y, z, { all = false } = {}){
  if (!all) return caveF(plan, x, y, z);
  let d = plan.G - 1;
  for (let o = 0; o < plan.prim.length; o += 10){ const v = primDist(plan.prim, o, x, y, z); if (v < d) d = v; }
  return d + wobble(plan, x, y, z);
}
// Does a pool hold the whole box of cell (k, X, Y, Z)? 1 all, 0 none, −1 part.
function poolTerm(plan, k, X, Y, Z){
  const s = 2 ** k, x0 = X * s, y0 = Y * s, z0 = Z * s, x1 = x0 + s - 1, y1 = y0 + s - 1, z1 = z0 + s - 1, G = plan.G, N = plan.N;
  const a = [x0, y0, z0].map(v => Math.max(0, Math.floor(v / G))), b = [x1, y1, z1].map(v => Math.min(N - 1, Math.floor(v / G)));
  let any = false;
  for (let k2 = a[2]; k2 <= b[2]; k2++) for (let j2 = a[1]; j2 <= b[1]; j2++) for (let i2 = a[0]; i2 <= b[0]; i2++){
    for (const ch of plan.poolHomes[i2 + N * (j2 + N * k2)]){
      const [bl, bh] = ch.box, L = Math.min(bh[1], ch.pool.level);
      if (x1 < bl[0] || x0 > bh[0] || z1 < bl[2] || z0 > bh[2] || y1 < bl[1] || y0 > L) continue;
      if (x0 >= bl[0] && x1 <= bh[0] && z0 >= bl[2] && z1 <= bh[2] && y0 >= bl[1] && y1 <= L) return 1;
      any = true;
    }
  }
  return any ? -1 : 0;
}
// The pool holding voxel (x, y, z), or null.
function poolAt(plan, x, y, z){
  const G = plan.G, N = plan.N, i = Math.floor(x / G), j = Math.floor(y / G), k = Math.floor(z / G);
  if (i < 0 || j < 0 || k < 0 || i >= N || j >= N || k >= N) return null;
  for (const ch of plan.poolHomes[i + N * (j + N * k)]){
    const [bl, bh] = ch.box;
    if (x >= bl[0] && x <= bh[0] && z >= bl[2] && z <= bh[2] && y >= bl[1] && y <= Math.min(bh[1], ch.pool.level)) return ch;
  }
  return null;
}

/* The column tops of a square of n × n columns from (x0, z0), and their
   min/max pyramid: level k's entry is over a 2^k × 2^k block. The whole
   world's (n = S) for buildCaves, a part's own columns for a worker. */
export function heightsOf(plan, x0, z0, n){
  const H = new Int16Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) H[x + n * z] = topOf(plan, x0 + x, z0 + z);
  const mins = [H], maxs = [H];
  for (let m = n >> 1; m >= 1; m >>= 1){
    const pm = mins[mins.length - 1], pM = maxs[maxs.length - 1], lo = new Int16Array(m * m), hi = new Int16Array(m * m), w = 2 * m;
    for (let z = 0; z < m; z++) for (let x = 0; x < m; x++){
      const a = 2 * x + w * 2 * z, b = a + w;
      lo[x + m * z] = Math.min(pm[a], pm[a + 1], pm[b], pm[b + 1]);
      hi[x + m * z] = Math.max(pM[a], pM[a + 1], pM[b], pM[b + 1]);
    }
    mins.push(lo); maxs.push(hi);
  }
  return { x0, z0, n, mins, maxs };
}

const AND = (a, b) => a === 0 || b === 0 ? 0 : a === 1 && b === 1 ? 1 : -1;
const OR = (a, b) => a === 1 || b === 1 ? 1 : a === 0 && b === 0 ? 0 : -1;
const NOT = a => a === -1 ? -1 : 1 - a;

/* The pool term split by kind, for the labels: out.p is poolTerm's answer
   (1 all in some pool, 0 none, −1 part), out.w and out.l the same for
   water pools and lava pools alone. A kind is "all" only when a box of
   that kind holds the whole cell and no box of the other kind touches it:
   where boxes of both kinds overlap, poolAt's order picks a voxel's pool,
   so the cell is split down to the voxels, which ask poolAt itself. */
function poolKinds(plan, k, X, Y, Z, out){
  if (k === 0){
    const ch = poolAt(plan, X, Y, Z);
    out.p = ch ? 1 : 0; out.w = ch && !ch.pool.lava ? 1 : 0; out.l = ch && ch.pool.lava ? 1 : 0;
    return;
  }
  const s = 2 ** k, x0 = X * s, y0 = Y * s, z0 = Z * s, x1 = x0 + s - 1, y1 = y0 + s - 1, z1 = z0 + s - 1, G = plan.G, N = plan.N;
  const a = [x0, y0, z0].map(v => Math.max(0, Math.floor(v / G))), b = [x1, y1, z1].map(v => Math.min(N - 1, Math.floor(v / G)));
  let all = 0, any = false;
  const touch = [false, false], hold = [false, false];
  for (let k2 = a[2]; k2 <= b[2]; k2++) for (let j2 = a[1]; j2 <= b[1]; j2++) for (let i2 = a[0]; i2 <= b[0]; i2++){
    for (const ch of plan.poolHomes[i2 + N * (j2 + N * k2)]){
      const [bl, bh] = ch.box, L = Math.min(bh[1], ch.pool.level), kind = ch.pool.lava ? 1 : 0;
      if (x1 < bl[0] || x0 > bh[0] || z1 < bl[2] || z0 > bh[2] || y1 < bl[1] || y0 > L) continue;
      touch[kind] = true; any = true;
      if (x0 >= bl[0] && x1 <= bh[0] && z0 >= bl[2] && z1 <= bh[2] && y0 >= bl[1] && y1 <= L){ hold[kind] = true; all = 1; }
    }
  }
  out.p = all ? 1 : any ? -1 : 0;
  out.w = !touch[0] ? 0 : hold[0] && !touch[1] ? 1 : -1;
  out.l = !touch[1] ? 0 : hold[1] && !touch[0] ? 1 : -1;
}

/* The cave and pool terms of a cell, shared by caveCell (occupancy) and
   caveLabelCell (labels), in world node coordinates:
   - fromField asks a cell's children right after the cell itself (depth
     first), so the last answer at level k + 1 is the parent's while its
     children are asked. A term the parent decided (no cave here, all
     pool) holds for every child, which inherits it;
   - the parent also passes down the primitives that can be nearest
     anywhere in it: each is 1-Lipschitz, so one whose distance at the
     centre is more than the nearest's plus 2ρ (ρ the half-diagonal of the
     voxel centres) is never the nearest inside the cell. Valid only while
     the nearest plus 2ρ is under the cap: a primitive the centre doesn't
     list is only known to be ≥ G.
   The values don't change, only which primitives are tried, so the DAG is
   the one `fast: false` gives (the tests build both). In the sketch the
   shortcuts took D = 12 from 504 s to 38.5 s.
   Returns { c, p, w, l }: carved, in a pool, and (kinds: true) in a water
   or a lava pool, each 1 / 0 / −1. p, w and l are −1 where c is 0 (not
   asked: nothing uncarved is pool). The object is reused. A caller that
   answers without asking for the terms (caveCell's sea and sky) leaves
   the level's memory as it was, which only costs its children the
   inheritance: the memory is keyed by the cell's coordinates. */
function cellTerms(plan, { fast = true, stats = null, kinds = false } = {}){
  const { D, G } = plan;
  const mx_ = new Int32Array(D + 2).fill(-1), my_ = new Int32Array(D + 2), mz_ = new Int32Array(D + 2);
  const mc = new Int8Array(D + 2), mp = new Int8Array(D + 2), mw = new Int8Array(D + 2), mlv = new Int8Array(D + 2);
  const mok = new Uint8Array(D + 2), mn_ = new Int32Array(D + 2);
  const ml = Array.from({ length: D + 2 }, () => new Int32Array(plan.maxList)), vals = new Float64Array(plan.maxList);
  const out = { c: 0, p: -1, w: -1, l: -1 };
  return (k, X, Y, Z) => {
    const s = 2 ** k, up = k + 1, inherit = fast && mx_[up] === X >> 1 && my_[up] === Y >> 1 && mz_[up] === Z >> 1;
    // the caves, by their own bound
    let c;
    mok[k] = 0;
    if (inherit && mc[up] !== -1) c = mc[up];
    else {
      const rg = ROOT3 * (s - 1) / 2, rho = LIP_CAVE * rg + 1e-9;
      if (rho >= G - 1 - WOBBLE) c = -1;
      else {
        if (stats) stats.caveEvals[k]++;
        const cx = (X + 0.5) * s, cy = (Y + 0.5) * s, cz = (Z + 0.5) * s;
        const passed = inherit && mok[up], list = passed ? ml[up] : listAt(plan, cx, cy, cz), len = passed ? mn_[up] : list.length;
        let dmin = Infinity;
        for (let q = 0; q < len; q++){ const v = primDist(plan.prim, 10 * list[q], cx, cy, cz); vals[q] = v; if (v < dmin) dmin = v; }
        const v = Math.min(G - 1, dmin) + wobble(plan, cx, cy, cz);
        if (k === 0) c = v <= 0 ? 1 : 0;
        else {
          c = v > rho ? 0 : v < -rho ? 1 : -1;
          if (fast && c === -1 && dmin + 2 * rg < G - 1){
            const keep = ml[k]; let m = 0;
            for (let q = 0; q < len; q++) if (vals[q] <= dmin + 2 * rg) keep[m++] = list[q];
            mn_[k] = m; mok[k] = 1;
          }
        }
      }
    }
    let p = -1, w = -1, l = -1;
    if (c !== 0){
      if (inherit && mp[up] !== -1 && (!kinds || (mw[up] !== -1 && mlv[up] !== -1))){ p = mp[up]; w = mw[up]; l = mlv[up]; }
      else if (kinds){ poolKinds(plan, k, X, Y, Z, out); p = out.p; w = out.w; l = out.l; }
      else p = poolTerm(plan, k, X, Y, Z);
    }
    mx_[k] = X; my_[k] = Y; mz_[k] = Z; mc[k] = c; mp[k] = p; mw[k] = w; mlv[k] = l;
    out.c = c; out.p = p; out.w = w; out.l = l;
    return out;
  };
}

/* The fromField classifier, in world node coordinates, for the cells over
   `hts`'s columns (plan §2): the sea and the column tops first, which
   decide most cells with no cave term at all, then the terms above. */
export function caveCell(plan, hts, { fast = true, stats = null } = {}){
  const { seaY } = plan, { mins, maxs } = hts, terms = cellTerms(plan, { fast, stats });
  return (k, X, Y, Z) => {
    if (stats) stats.calls[k]++;
    const s = 2 ** k, y0 = Y * s, y1 = y0 + s - 1;
    if (y1 <= seaY) return 1;
    const sea = y0 <= seaY ? -1 : 0, n = hts.n >> k, h = (X - (hts.x0 >> k)) + n * (Z - (hts.z0 >> k));
    const t = y1 <= mins[k][h] ? 1 : y0 > maxs[k][h] ? 0 : -1;
    if (t === 0) return sea;
    const { c, p } = terms(k, X, Y, Z), notC = NOT(c);
    const v = OR(sea, AND(t, notC === 1 ? 1 : OR(notC, p)));
    if (stats && v === -1) stats.split[k]++;
    return v;
  };
}

/* ---- labels (docs/multidag-attributes.md §3 shape B, §8 E1) ------------
   What fills a voxel, as a label: the caves' first label DAG. Sea and pool
   water are two labels (the colour field tells them apart), so a reader
   that only wants "wet" merges them. 0 is air. */
export const AIR = 0, ROCK = 1, SEA = 2, WATER = 3, LAVA = 4;
export const CAVE_LABELS = ['air', 'rock', 'sea', 'water', 'lava'];

/* The label classifier: cell(k, X, Y, Z) is the label every voxel of the
   cell holds, or −1 (split it). Each label is a three-valued term of the
   same four facts caveCell uses (under the sea line, under the column
   top, carved, in a pool of a kind), "1" meaning every voxel of the cell:
     rock  = top ∧ ¬carved                    (either side of the sea line)
     sea   = below ∧ ¬rock
     water = above ∧ top ∧ carved ∧ waterPool, lava the same
     air   = above ∧ (¬top ∨ (carved ∧ ¬pool))
   which is voxelKind, rule for rule. Terms are conservative (an AND of
   two "some"s is "some" even when they're disjoint), so a cell may be
   split that didn't need it; every voxel is decided, since at level 0
   every term is.

   masked: true answers for the label DAG of shape B with air as "don't
   care": the label the cell's occupied voxels share, AIR when it has none,
   −1 when two labels meet. That DAG needs the shape DAG beside it to say
   which voxels are there, and in return never splits on the surface. */
export function caveLabelCell(plan, hts, { fast = true, masked = false } = {}){
  const { seaY } = plan, { mins, maxs } = hts, terms = cellTerms(plan, { fast, kinds: true });
  const ind = new Int8Array(5);
  return (k, X, Y, Z) => {
    const s = 2 ** k, y0 = Y * s, y1 = y0 + s - 1, n = hts.n >> k, h = (X - (hts.x0 >> k)) + n * (Z - (hts.z0 >> k));
    const below = y1 <= seaY ? 1 : y0 > seaY ? 0 : -1, above = NOT(below);
    const t = y1 <= mins[k][h] ? 1 : y0 > maxs[k][h] ? 0 : -1;
    let c = 0, p = 0, w = 0, l = 0;
    if (t !== 0) ({ c, p, w, l } = terms(k, X, Y, Z));
    const rock = AND(t, NOT(c)), wet = AND(above, AND(t, c));
    ind[ROCK] = rock;
    ind[SEA] = AND(below, NOT(rock));
    ind[WATER] = AND(wet, w);
    ind[LAVA] = AND(wet, l);
    ind[AIR] = AND(above, OR(NOT(t), AND(c, NOT(p))));
    if (!masked){
      for (let L = 0; L < 5; L++) if (ind[L] === 1) return L;
      return -1;
    }
    let only = AIR;
    for (let L = 1; L < 5; L++) if (ind[L] !== 0){ if (only !== AIR) return -1; only = L; }
    return only;
  };
}

/* One voxel by the rules, with no pyramid and no shortcuts: the tests'
   oracle and the colour field's classifier. 'rock', 'sea', 'pool' or 'air'. */
export function voxelKind(plan, x, y, z){
  const top = topOf(plan, x, z), rock = () => caveF(plan, x + 0.5, y + 0.5, z + 0.5) > 0;
  if (y <= plan.seaY) return y <= top && rock() ? 'rock' : 'sea';
  if (y > top) return 'air';
  if (rock()) return 'rock';
  return poolAt(plan, x, y, z) ? 'pool' : 'air';
}
// voxelKind as a label, the pool's kind read off the pool poolAt picks.
const LABEL_OF = { air: AIR, rock: ROCK, sea: SEA };
export function voxelLabel(plan, x, y, z){
  const kind = voxelKind(plan, x, y, z);
  return kind === 'pool' ? (poolAt(plan, x, y, z).pool.lava ? LAVA : WATER) : LABEL_OF[kind];
}

/* ---- building ---------------------------------------------------------- */
// The whole world on one thread (the page's fallback, Node's experiments).
export function buildCaves(desc, { fast = true, store = createStore() } = {}){
  const t0 = performance.now(), plan = cavePlan(desc), t1 = performance.now();
  const hts = heightsOf(plan, 0, 0, plan.S), t2 = performance.now();
  const { root } = store.fromField(plan.D, caveCell(plan, hts, { fast }));
  return { store, root, D: plan.D, plan, info: caveInfo(plan), ms: { plan: t1 - t0, heights: t2 - t1, field: performance.now() - t2, total: performance.now() - t0 } };
}

/* The parts: columns of side 2^L, L = D − 3, so 64 of them, each built
   from its own heights (2^L × 2^L columns) as a stack of level-L blocks.
   A part's blocks graft into an empty world; parts are disjoint and
   aligned, so graft's unions are trivial and the result is the DAG
   buildCaves makes (the tests check it, root id for root id). */
export const partLevel = desc => desc.D - 3;
export function cavePartsOf(desc){
  const L = partLevel(desc), n = 2 ** (desc.D - L), jobs = [];
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) jobs.push({ px: x, pz: z });
  return { L, jobs };
}
export function buildCavePart(desc, job, store = createStore()){
  const plan = cavePlan(desc), L = partLevel(desc), side = 2 ** L, x0 = job.px * side, z0 = job.pz * side;
  const cell = caveCell(plan, heightsOf(plan, x0, z0, side)), blocks = [];
  for (let py = 0; py < 2 ** (desc.D - L); py++){
    const { root } = store.fromField(L, (k, x, y, z) => cell(k, x + (job.px << (L - k)), y + (py << (L - k)), z + (job.pz << (L - k))));
    if (root !== EMPTY) blocks.push({ x: job.px, y: py, z: job.pz, node: root });
  }
  return { store, blocks };
}
// A part from another store (its snapshot's keys) into the assembler's.
export function mergeCavePart(store, blocks, part){
  const map = store.importKeys(part.keys);
  for (const b of part.blocks) blocks.push({ x: b.x, y: b.y, z: b.z, node: map[b.node] });
}
export function assembleCaves(store, desc, blocks){
  return store.graft(EMPTY, desc.D, partLevel(desc), blocks);
}
// The parts' way in one thread, for the tests: build, merge in order, graft, prune.
export function buildCavesInParts(desc){
  const store = createStore(), blocks = [];
  for (const job of cavePartsOf(desc).jobs){
    const part = buildCavePart(desc, job);
    mergeCavePart(store, blocks, { keys: part.store.snapshot().keys, blocks: part.blocks });
  }
  const root = assembleCaves(store, desc, blocks), { keys, map } = prune(store.snapshot().keys, [root]);
  return { keys, root: map[root] };
}

/* ---- colour (colours.js's 'caves') ------------------------------------
   Rebuilt from the descriptor in every chunk worker (plan §6 Q3). Only
   voxels that may be pool or sea pay for the cave test: everything else
   occupied is rock, so a shown voxel costs a column top and a ramp. */
const STRATA = [[0, 112, 92, 78], [0.25, 150, 128, 104], [0.4, 128, 104, 86], [0.55, 168, 150, 126], [0.75, 120, 100, 88], [1, 112, 92, 78]];
const SURFACE = [[0.10, 200, 188, 140], [0.13, 96, 142, 64], [0.28, 70, 116, 54], [0.36, 112, 104, 90], [0.46, 140, 136, 132], [0.50, 236, 240, 246]];
function ramp(t, stops){
  if (t <= stops[0][0]) return stops[0];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]){
    const a = stops[i - 1], b = stops[i], u = (t - a[0]) / (b[0] - a[0]);
    return [t, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u];
  }
  return stops[stops.length - 1];
}
export function caveColour(desc, rgb8){
  const plan = cavePlan(desc), S = plan.S;
  return (x, y, z) => {
    const xi = Math.max(0, Math.min(S - 1, Math.floor(x))), yi = Math.floor(y), zi = Math.max(0, Math.min(S - 1, Math.floor(z)));
    const top = topOf(plan, xi, zi), carved = () => caveF(plan, xi + 0.5, yi + 0.5, zi + 0.5) <= 0;
    if (yi <= plan.seaY && (yi > top || carved())) return rgb8(36, 84, 140);
    if (yi > plan.seaY && yi <= top){
      const ch = poolAt(plan, xi, yi, zi);
      if (ch && carved()){
        const n = noise2(x / 9, z / 9, 3);
        return ch.pool.lava ? rgb8(235, 80 + 110 * n, 20 + 30 * n) : rgb8(40, 110 + 30 * n, 170);
      }
    }
    // The surface's colours on the top three voxels of a column. (Green
    // seen from inside a chamber is the slope outside, through the
    // chamber's breach of the surface, not a roof: no cave test here.)
    if (top - yi < 3){ const c = ramp(y / S + 0.04 * (noise2(x / 40, z / 40, 9) - 0.5), SURFACE); return rgb8(c[1], c[2], c[3]); }
    const c = ramp((((y / 41 + 0.6 * noise2(x / 160, z / 160, 4)) % 1) + 1) % 1, STRATA);
    return rgb8(c[1], c[2], c[3]);
  };
}
