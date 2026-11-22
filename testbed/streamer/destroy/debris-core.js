/* DEBRIS CORE: what a blast throws, how it flies, and how it becomes the
   world again (destroy/README.md). Pure: imports only arena-core.js.

   A BODY is a set of voxels moving as one: integer offsets from its corner
   `pos` (float, voxels), their cells' colours, a velocity. Rubble is a few
   voxels (a rocket's blast cut into clusters), a molten drop one voxel (the
   plasma's), a loose piece as many as it has (a tower's top cut off by a
   shot). Bodies don't hit each other, only the grid: they land on the
   world, and on each other once the first has baked into it.

   THE MOVE is walk-core's, for a set of unit boxes that share one fraction:
   each axis on its own (y first), in substeps under MAX_SUB voxels, and an
   axis's move tests the cells the leading voxels newly overlap (only the
   voxels with no body voxel ahead of them on that axis: what's behind a
   voxel was cleared by that voxel the substep before). A move that meets a
   solid cell stops the body flush against it, at an integer on that axis
   (every offset is an integer, so the flush place is the same for every
   voxel); if that is ever still inside (rounding), the axis keeps its old
   place. So a body is never inside the grid: the test holds it after every
   step.

   AT REST a body BAKES: its voxels are written into the grid, and the body
   is gone. Resting is "on the ground and slower than REST_SPEED for
   REST_TIME", or older than MAX_AGE whatever it's doing, or pushed out by
   the cap on bodies (the oldest bake first). Baking is where mass is kept:
   - whole, at the nearest integer place (four roundings of x and z, then
     one cell up) where every voxel's cell is air, so a piece keeps its
     shape;
   - else voxel by voxel, each to arena-core's nearestFree of its rounded
     cell and then settled down (settleDown): a piece that landed half in a
     crater's wall crumbles into it.
   Either way every voxel gets a cell, so world + debris is constant: the
   page shows it, and the test holds it over random barrages to the voxel.

   MOLTEN drops (`liquid`) flow before they bake: on the ground, with an
   open diagonal below one side, they're nudged that way, and when they
   bake they slide down diagonals (settleDown's slide), so the plasma's melt
   runs into pools. Their colour is the page's business (`hot` cools; the
   cell is darkened toward slag when it bakes).

   The spin (`q`, `w`) is for the eye only: collision and baking ignore it,
   and it eases to nothing on the ground, so what bakes is what was drawn,
   give or take the last few degrees. */
import { nearestFree, settleDown, hash4 } from './arena-core.js';

export const DEBRIS = {
  gravity: 60, maxFall: 160,       // voxels a second², the fastest fall
  bounce: 0.3, bounceMin: 6,       // restitution, and the slowest hit that bounces
  friction: 7,                     // on the ground, a second⁻¹
  restSpeed: 1.5, restTime: 0.12,  // at rest: slower than this, this long, on the ground
  maxAge: 9, liquidAge: 5,         // baked whatever it's doing past these (seconds)
  maxBodies: 4000,                 // the oldest bake first past this
  flow: 5,                         // a drop's nudge toward an open diagonal (voxels a second)
};
export const MAX_SUB = 0.45;
const EPS = 1e-7;

export function createDebris(){ return { bodies: [], voxels: 0, baked: 0, bakedWhole: 0, overtaken: 0, nextId: 1, epoch: 0 }; }

/* A body from offsets and colours. The six lists hold, for each direction
   (+x, −x, +y, −y, +z, −z), the voxels whose neighbour that way isn't the
   body's: the leading faces of a move that way. */
export function makeBody(offs, cols, pos, vel = [0, 0, 0], opts = {}){
  const n = cols.length;
  let sx = 0, sy = 0, sz = 0;
  for (let k = 0; k < n; k++){ sx = Math.max(sx, offs[3 * k] + 1); sy = Math.max(sy, offs[3 * k + 1] + 1); sz = Math.max(sz, offs[3 * k + 2] + 1); }
  const own = new Uint8Array(sx * sy * sz), at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz && own[x + sx * (y + sy * z)];
  for (let k = 0; k < n; k++) own[offs[3 * k] + sx * (offs[3 * k + 1] + sy * offs[3 * k + 2])] = 1;
  const lists = [];
  for (let f = 0; f < 6; f++){
    const a = f >> 1, s = f & 1 ? -1 : 1, l = [];
    for (let k = 0; k < n; k++){
      const p = [offs[3 * k], offs[3 * k + 1], offs[3 * k + 2]]; p[a] += s;
      if (!at(p[0], p[1], p[2])) l.push(k);
    }
    lists.push(Int32Array.from(l));
  }
  return {
    offs: Int16Array.from(offs), cols: Uint16Array.from(cols), n, size: [sx, sy, sz], lists,
    pos: Float64Array.from(pos), vel: Float64Array.from(vel), ground: false, rest: 0, age: 0,
    liquid: !!opts.liquid, hot: opts.hot ?? 0, kind: opts.kind ?? 'rubble',
    q: [1, 0, 0, 0], w: Float64Array.from(opts.spin ?? [0, 0, 0]), id: 0, epoch: -1,
  };
}
export function addBody(D, b){ b.id = D.nextId++; D.bodies.push(b); D.voxels += b.n; return b; }

/* The cells the voxel k of body b would overlap at p, tested solid. A unit
   box at a fraction f overlaps one cell on that axis if f = 0, else two. */
function hitsAt(A, b, list, p){
  const o = b.offs;
  const bx = Math.floor(p[0] + EPS), by = Math.floor(p[1] + EPS), bz = Math.floor(p[2] + EPS);
  const nx = Math.ceil(p[0] + 1 - EPS) - bx, ny = Math.ceil(p[1] + 1 - EPS) - by, nz = Math.ceil(p[2] + 1 - EPS) - bz;
  for (let q = 0; q < list.length; q++){
    const k = list[q], x = bx + o[3 * k], y = by + o[3 * k + 1], z = bz + o[3 * k + 2];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nz; i++) for (let h = 0; h < nx; h++)
      if (A.solidAt(x + h, y + j, z + i)) return true;
  }
  return false;
}
// Is body b anywhere inside the grid at its place? (every voxel: the test's question)
export const bodyInside = (A, b) => hitsAt(A, b, allOf(b), b.pos);
const ALL = new WeakMap();
function allOf(b){ let l = ALL.get(b); if (!l){ l = Int32Array.from({ length: b.n }, (_, k) => k); ALL.set(b, l); } return l; }

/* One axis's move by d (|d| < 1): true if it was stopped. */
function moveAxis(A, b, a, d){
  if (!d) return false;
  const p = b.pos, old = p[a];
  p[a] = old + d;
  if (!hitsAt(A, b, b.lists[2 * a + (d > 0 ? 0 : 1)], p)) return false;
  p[a] = d > 0 ? Math.floor(p[a] + EPS) : Math.ceil(p[a] - EPS);
  if (hitsAt(A, b, b.lists[2 * a + (d > 0 ? 0 : 1)], p)) p[a] = old;
  return true;
}

/* One frame of dt seconds for every body; bakes those at rest. Returns how
   many voxels were baked. `onBake(b, cells)` hears each bake (the page
   cools a drop's colour there, and counts). */
export function stepDebris(D, A, dt, { onBake = null, o = DEBRIS } = {}){
  dt = Math.min(Math.max(dt, 0), 1 / 20);
  let baked = 0;
  const keep = [];
  // The cap: past it, the oldest go first.
  if (D.bodies.length > o.maxBodies){
    D.bodies.sort((p, q) => q.age - p.age);
    for (const b of D.bodies.splice(0, D.bodies.length - o.maxBodies)) baked += bake(D, A, b, onBake);
  }
  for (const b of D.bodies){
    const v = b.vel, p = b.pos;
    b.age += dt;
    // Overtaken by a bake (bodies pass through each other, and one that landed may have
    // written its voxels where this one flies): baked at once, voxel by voxel, to the
    // nearest free cells. Only asked after a bake this body hasn't seen.
    if (b.epoch !== D.epoch){ b.epoch = D.epoch; if (bodyInside(A, b)){ D.overtaken++; baked += bake(D, A, b, onBake); continue; } }
    const fastest = Math.max(Math.abs(v[0]), Math.abs(v[1]) + o.gravity * dt, Math.abs(v[2]));
    const n = Math.min(32, Math.max(1, Math.ceil(fastest * dt / MAX_SUB))), h = dt / n;
    for (let s = 0; s < n; s++){
      const v1 = Math.max(-o.maxFall, v[1] - o.gravity * h), dy = (v[1] + v1) / 2 * h;
      v[1] = v1;
      b.ground = false;
      if (moveAxis(A, b, 1, dy)){
        if (dy < 0) b.ground = true;
        v[1] = Math.abs(v[1]) > o.bounceMin ? -v[1] * o.bounce : 0;
      }
      for (const a of [0, 2]){
        if (moveAxis(A, b, a, v[a] * h)) v[a] = Math.abs(v[a]) > o.bounceMin ? -v[a] * o.bounce : 0;
      }
      if (b.ground){ const k = Math.exp(-o.friction * h); v[0] *= k; v[2] *= k; }
    }
    // A drop on the ground with an open diagonal below one side runs that way.
    if (b.liquid && b.ground && b.n === 1){
      const x = Math.floor(p[0] + 0.5), y = Math.round(p[1]), z = Math.floor(p[2] + 0.5), off = hash4(x, y, z, b.id) & 3;
      for (let k = 0; k < 4; k++){
        const dx = [1, -1, 0, 0][(off + k) & 3], dz = [0, 0, 1, -1][(off + k) & 3];
        if (A.free(x + dx, y, z + dz) && A.free(x + dx, y - 1, z + dz)){
          v[0] = dx * o.flow + (x + 0.5 - (p[0] + 0.5)) * 4; v[2] = dz * o.flow + (z + 0.5 - (p[2] + 0.5)) * 4;
          b.rest = 0;
          break;
        }
      }
    }
    // The spin, for the eye: damped hard on the ground, and the turn eased home.
    const wl = Math.hypot(b.w[0], b.w[1], b.w[2]);
    if (b.ground){ const k = Math.exp(-12 * dt); b.w[0] *= k; b.w[1] *= k; b.w[2] *= k; easeHome(b.q, 1 - Math.exp(-14 * dt)); }
    if (wl > 1e-4) spinBy(b.q, b.w, dt);
    const slow = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] < o.restSpeed * o.restSpeed;
    b.rest = b.ground && slow ? b.rest + dt : 0;
    if (b.rest > o.restTime || b.age > (b.liquid ? o.liquidAge : o.maxAge)) baked += bake(D, A, b, onBake);
    else keep.push(b);
  }
  // A bake late in the frame may have overtaken a body moved before it: once more round
  // those, until none is inside, so after a step no body is ever inside the grid.
  for (let again = true; again;){
    again = false;
    for (let k = 0; k < keep.length; k++){
      const b = keep[k];
      if (b.epoch === D.epoch) continue;
      b.epoch = D.epoch;
      if (bodyInside(A, b)){ D.overtaken++; baked += bake(D, A, b, onBake); keep.splice(k--, 1); again = true; }
    }
  }
  D.bodies = keep;
  return baked;
}

/* Bake one body into the grid (see the top). Every voxel gets a cell. */
export function bake(D, A, b, onBake = null){
  const p = b.pos, o = b.offs, n = b.n, cells = new Int32Array(3 * n);
  const fits = (X, Y, Z) => {
    for (let k = 0; k < n; k++) if (!A.free(X + o[3 * k], Y + o[3 * k + 1], Z + o[3 * k + 2])) return false;
    return true;
  };
  let whole = null;
  if (n > 1){
    const y = Math.round(p[1]), rx = Math.round(p[0]), rz = Math.round(p[2]);
    const xs = [rx, p[0] - rx > 0 ? rx + 1 : rx - 1], zs = [rz, p[2] - rz > 0 ? rz + 1 : rz - 1];
    const tries = [];
    for (const X of xs) for (const Z of zs) tries.push([X, Z, (X - p[0]) ** 2 + (Z - p[2]) ** 2]);
    tries.sort((a, c) => a[2] - c[2]);
    for (const dy of [0, 1]){ for (const [X, Z] of tries) if (fits(X, y + dy, Z)){ whole = [X, y + dy, Z]; break; } if (whole) break; }
  }
  if (whole){
    for (let k = 0; k < n; k++){
      const x = whole[0] + o[3 * k], y = whole[1] + o[3 * k + 1], z = whole[2] + o[3 * k + 2];
      A.set(x, y, z, b.cols[k]); cells[3 * k] = x; cells[3 * k + 1] = y; cells[3 * k + 2] = z;
    }
    D.bakedWhole++;
  } else {
    // Bottom up, so the lower voxels take the lower cells and the upper settle on them.
    const order = Array.from({ length: n }, (_, k) => k).sort((a, c) => o[3 * a + 1] - o[3 * c + 1]);
    for (const k of order){
      const c = [Math.round(p[0] + o[3 * k]), Math.round(p[1] + o[3 * k + 1]), Math.round(p[2] + o[3 * k + 2])];
      const q = settleDown(A, nearestFree(A, c), b.liquid || n === 1);
      A.set(q[0], q[1], q[2], b.cols[k]); cells[3 * k] = q[0]; cells[3 * k + 1] = q[1]; cells[3 * k + 2] = q[2];
    }
  }
  D.voxels -= n; D.baked += n; D.epoch++;
  if (onBake) onBake(b, cells);
  return n;
}

/* A blast's push on every body within reach: away from c, strongest at c,
   nothing past `reach`; it wakes them (and lifts them off the ground). */
export function pushBodies(D, c, reach, strength){
  for (const b of D.bodies){
    const m = [b.pos[0] + b.size[0] / 2 - c[0], b.pos[1] + b.size[1] / 2 - c[1], b.pos[2] + b.size[2] / 2 - c[2]];
    const d = Math.hypot(m[0], m[1], m[2]);
    if (d >= reach) continue;
    const k = strength * (1 - d / reach) / Math.max(1, Math.cbrt(b.n)) / Math.max(d, 0.5);
    b.vel[0] += m[0] * k; b.vel[1] += m[1] * k + strength * 0.15 * (1 - d / reach); b.vel[2] += m[2] * k;
    b.rest = 0;
  }
}

/* ---- the burst -----------------------------------------------------------------
   A blast's carved voxels as bodies. Rubble: the voxels grouped by blocks
   of `cluster` (shifted by a hash of the seed, so craters don't share a
   grid), each block a body thrown out of the face that was hit (`normal`,
   the ray's way back) and away from c: faster nearer the middle,
   up-biased, a hashed scatter; the outer ring slower, so it drops round
   the crater as a rim. Molten (`liquid`): every voxel its own drop,
   thrown gently off the surface (`normal`). The voxels come from blast()
   as triples with colours; nothing is dropped. */
export function burst(D, carved, c, r, { seed = 1, cluster = 2, speed = 40, liquid = false, normal = [0, 1, 0], hot = 0, kind = liquid ? 'molten' : 'rubble' } = {}){
  const { at, cols } = carved, n = cols.length;
  if (!n) return [];
  const made = [];
  const rnd = (k, s) => hash4(k, s, seed, 0x51ed) / 4294967296;
  if (liquid){
    for (let k = 0; k < n; k++){
      const x = at[3 * k], y = at[3 * k + 1], z = at[3 * k + 2];
      const u = rnd(k, 1) * 2 - 1, w = rnd(k, 2) * 2 - 1, up = rnd(k, 3);
      const vel = [normal[0] * speed * (0.3 + 0.7 * up) + u * speed * 0.35, normal[1] * speed * (0.3 + 0.7 * up) + speed * 0.25 * up, normal[2] * speed * (0.3 + 0.7 * up) + w * speed * 0.35];
      made.push(addBody(D, makeBody([0, 0, 0], [cols[k]], [x, y, z], vel, { liquid: true, hot, kind })));
    }
    return made;
  }
  const B = Math.max(1, cluster | 0), sh = [hash4(seed, 1, 2, 3) % B, hash4(seed, 4, 5, 6) % B, hash4(seed, 7, 8, 9) % B];
  const groups = new Map();
  for (let k = 0; k < n; k++){
    const x = at[3 * k], y = at[3 * k + 1], z = at[3 * k + 2];
    const key = `${Math.floor((x + sh[0]) / B)},${Math.floor((y + sh[1]) / B)},${Math.floor((z + sh[2]) / B)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, g = []);
    g.push(k);
  }
  let gi = 0;
  for (const g of groups.values()){
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, mx = 0, my = 0, mz = 0;
    for (const k of g){ x0 = Math.min(x0, at[3 * k]); y0 = Math.min(y0, at[3 * k + 1]); z0 = Math.min(z0, at[3 * k + 2]); mx += at[3 * k]; my += at[3 * k + 1]; mz += at[3 * k + 2]; }
    mx = mx / g.length + 0.5 - c[0]; my = my / g.length + 0.5 - c[1]; mz = mz / g.length + 0.5 - c[2];
    // Out of the face it was blasted from: the way from c, plus the face's normal, plus up and a scatter.
    // Thrown only from c, half the rubble went into the wall behind the crater, stopped at once and baked
    // back where it was: the crater filled itself in (the first screenshots).
    const d = Math.hypot(mx, my, mz) || 1, near = Math.max(0, 1 - d / Math.max(r, 1));
    const dir = [0.6 * mx / d + normal[0] + (rnd(gi, 2) - 0.5) * 0.6, 0.6 * my / d + normal[1] + 0.35 + rnd(gi, 3) * 0.3, 0.6 * mz / d + normal[2] + (rnd(gi, 4) - 0.5) * 0.6];
    const l = Math.hypot(dir[0], dir[1], dir[2]) || 1, s = speed * (0.3 + 0.7 * near) * (0.6 + 0.8 * rnd(gi, 1)) / l;
    const vel = [dir[0] * s, dir[1] * s, dir[2] * s];
    const offs = [], cs = [];
    for (const k of g){ offs.push(at[3 * k] - x0, at[3 * k + 1] - y0, at[3 * k + 2] - z0); cs.push(cols[k]); }
    const spin = [(rnd(gi, 5) - 0.5) * 20, (rnd(gi, 6) - 0.5) * 20, (rnd(gi, 7) - 0.5) * 20];
    made.push(addBody(D, makeBody(offs, cs, [x0, y0, z0], vel, { spin, hot, kind })));
    gi++;
  }
  return made;
}

/* ---- the spin, a quaternion [w, x, y, z] ----------------------------------- */
function spinBy(q, w, dt){
  const [a, b, c, d] = q, x = w[0] * dt / 2, y = w[1] * dt / 2, z = w[2] * dt / 2;
  q[0] = a - b * x - c * y - d * z; q[1] = b + a * x + c * z - d * y; q[2] = c + a * y + d * x - b * z; q[3] = d + a * z + b * y - c * x;
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
}
function easeHome(q, t){
  if (q[0] < 0){ q[0] = -q[0]; q[1] = -q[1]; q[2] = -q[2]; q[3] = -q[3]; }
  q[0] += (1 - q[0]) * t; q[1] -= q[1] * t; q[2] -= q[2] * t; q[3] -= q[3] * t;
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
}
