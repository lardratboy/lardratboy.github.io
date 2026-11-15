/* WALK CORE: walking, Minecraft's way (docs/dungeon-log.md §11). Pure, no
   imports: the world comes in as a function `world(lo, hi)`, "is anything in this box of
   voxels?", actor-core's dagWorld's question. Asked for 2026-11-14: "add a
   FPS/Minecraft style movement controller (I want to keep the flying as the
   default) but for the dungeon flying is difficult to navigate".

   THE WALKER is a box, 1.5 voxels across and 4.5 tall, its feet at p (the
   middle of its bottom face), its eye 4 above them. The dungeon was made for
   a walker 4 tall and a voxel wide (its test walks one): corridors are 4
   wide and 8 tall, a stair has 8 of headroom, so this one fits everywhere
   that one does, with room to turn. The sizes are dyadic (0.75, 4.5) on
   purpose: a box clamped against a voxel face at L has p = L − 0.75, and
   (L − 0.75) + 0.75 is L again exactly, so a walker standing on a floor
   stands at an integer and the next frame's test of the layer under it
   asks the right layer. With 0.8 it could be 1.9999999, and every sideways
   move would have tested the floor and stopped.

   A FRAME (stepWalk): the wish (WASD, as a direction on the ground) eases
   the velocity toward it (quickly on the ground, slowly in the air), a jump
   leaves the ground only from the ground, gravity pulls, and the move goes
   in substeps of a quarter voxel, each axis on its own (y first, then x and
   z), so a wall stops one axis and the other slides along it. An axis's move
   tests each layer of voxels the box's leading face enters, and stops the
   box flush with the first solid one.

   STEPS. A sideways move that's stopped on the ground tries again a voxel
   higher (if the ceiling lets it) and settles back down onto what it finds:
   so a stair of one voxel a step (the dungeon's, 1 up per voxel across) is
   walked up without jumping, and anything taller isn't. Walking off an
   edge, a walker that was on the ground looks a voxel down for ground and
   stands on it if it's there (snapping down), so it walks down a stair
   rather than hopping down it. Both move the feet a voxel in one substep,
   and the eye would jerk: `lift` holds the eye where it was and eases it
   to the feet's new height (walkerEye).

   CLIMBING (asked for 2026-11-14: "when using the walk camera in kit worlds
   the inability to climb walls means you can't just navigate anywhere").
   With `climb` held (the page's Alt / Option, or the pad's RT), a walker
   pushing into a wall beside it goes up it at `climb` voxels a second
   (shift's multiple too), with no gravity; at the top the wall ends, the
   push carries the box over the lip, and it lands on top. Held beside a wall
   in the air without pushing into it, it hangs where it is. Let go and it
   falls. "Beside" is exact: the box's face lies on a voxel face (where a
   wall stops it, by the dyadic sizes) and the layer beyond is solid. So a
   walker is only ever moved by a wall it touches, and every move is still
   moveAxis's, flush and never inside. An overhang stops the climb flush
   under it, as a ceiling stops a jump.

   THE WORLD the viewer hands in is openWorld(withHoles(dag, holes), side):
   - outside the world is air beside and above it, and solid below y = 0,
     so a walker can stand outside a world as on a plain at its foot (the
     dagWorld rule, solid outside, would bury a walker anywhere off the
     world);
   - `holes` are boxes the walker passes though the DAG is solid there: the
     dungeon's secret doors (dungeon-core's secretDoors), solid voxels with
     the wall's shape and nearly its colour, which the walk counts as doors.

   Nothing here knows about the camera. The page keeps cam.eye at walkerEye,
   and when anything else moves the eye (a link, a new world, a selftest), it
   puts the walker where the eye now is. */

export const WALK = {
  half: 0.75, height: 4.5, eye: 4,       // the box, and the eye above the feet (voxels)
  step: 1,                               // the tallest step walked up without a jump
  speed: 12, sprint: 1.75,               // voxels a second; shift's multiple
  gravity: 80, jump: 3.25, maxFall: 120, // voxels a second²; the jump's height; the fastest fall
  accel: 20, airAccel: 4,                // how fast the velocity follows the wish (a second⁻¹)
  substep: 0.25, maxDt: 0.1,             // the longest move tested at once; the longest frame
  ease: 14,                              // how fast the eye catches up with a step (a second⁻¹)
  climb: 8,                              // up a wall, voxels a second (shift's multiple too)
};
const EPS = 1e-6;

export function createWalker(eye, o = WALK){
  return { p: [eye[0], eye[1] - o.eye, eye[2]], v: [0, 0, 0], ground: false, climbing: false, lift: 0, o };
}
export const walkerEye = w => [w.p[0], w.p[1] + w.o.eye - w.lift, w.p[2]];

/* The box at feet p as voxel indices [lo, hi), the voxels it overlaps. A face
   exactly on a voxel boundary doesn't overlap the voxel beyond it; EPS keeps
   one a rounding error past it from doing so either. */
function extentOf(o, a){ return a === 1 ? [0, o.height] : [-o.half, o.half]; }
export function boxOf(o, p){
  const lo = [0, 0, 0], hi = [0, 0, 0];
  for (let a = 0; a < 3; a++){ const e = extentOf(o, a); lo[a] = Math.floor(p[a] + e[0] + EPS); hi[a] = Math.ceil(p[a] + e[1] - EPS); }
  return { lo, hi };
}
export function inside(world, o, p){ const { lo, hi } = boxOf(o, p); return world(lo, hi); }

/* One axis's move by d: each layer of voxels the leading face enters, in
   order; the first solid one stops the box flush against it. True if it
   was stopped. */
function moveAxis(w, world, a, d){
  const o = w.o, p = w.p, ext = extentOf(o, a), { lo, hi } = boxOf(o, p);
  if (d > 0){
    const edge = p[a] + ext[1], to = edge + d;
    for (let L = Math.ceil(edge - EPS); L < to - EPS; L++){
      lo[a] = L; hi[a] = L + 1;
      if (world(lo, hi)){ p[a] = L - ext[1]; return true; }
    }
  } else if (d < 0){
    const edge = p[a] + ext[0], to = edge + d;
    for (let L = Math.floor(edge + EPS) - 1; L + 1 > to + EPS; L--){
      lo[a] = L; hi[a] = L + 1;
      if (world(lo, hi)){ p[a] = L + 1 - ext[0]; return true; }
    }
  }
  p[a] += d;
  return false;
}

/* A wall beside the box on side s (±1) of axis a (0 or 2): its face lies
   exactly on a voxel face and the layer of voxels beyond it is solid. */
function besideWall(w, world, a, s){
  const ext = extentOf(w.o, a), edge = w.p[a] + ext[s > 0 ? 1 : 0], L = Math.round(edge);
  if (Math.abs(edge - L) > EPS) return false;
  const { lo, hi } = boxOf(w.o, w.p);
  lo[a] = s > 0 ? L : L - 1; hi[a] = lo[a] + 1;
  return world(lo, hi);
}
/* Climbing's two states for a substep: 'up' (pushing into a wall beside it),
   'hang' (beside one, in the air, not pushing, not rising: a jump beside a wall
   rises and hangs at the top), or null. `mv` is the wish. */
const PUSH = 0.1;   // a wish component below this doesn't push (a pad's drift, a near-parallel slide)
function climbOf(w, world, mv, noHang){
  for (const [a, m] of [[0, mv[0]], [2, mv[1]]]) if (Math.abs(m) > PUSH && besideWall(w, world, a, Math.sign(m))) return 'up';
  if (noHang) return null;
  for (const a of [0, 2]) for (const s of [-1, 1]) if (besideWall(w, world, a, s)) return 'hang';
  return null;
}

/* A sideways move that was stopped, tried a step higher. `from` is where the
   substep started. Taken if it gets further than the stopped one did. */
function stepUp(w, world, a, d, from){
  const p = w.p, stopped = p.slice();
  p[0] = from[0]; p[1] = from[1]; p[2] = from[2];
  moveAxis(w, world, 1, w.o.step);
  const rise = p[1] - from[1];
  if (rise > EPS){
    moveAxis(w, world, a, d);
    if (Math.abs(p[a] - from[a]) > Math.abs(stopped[a] - from[a]) + EPS){
      moveAxis(w, world, 1, -rise);
      w.lift += p[1] - from[1];
      return true;
    }
  }
  p[0] = stopped[0]; p[1] = stopped[1]; p[2] = stopped[2];
  return false;
}

/* A walker inside something (an edit put a block on it, or it was put where
   the eye was): up, a voxel at a time, to the first place the box is free,
   within `reach`. False if there's none: it stays, and can still walk out. */
export function settle(w, world, reach = 64){
  const y0 = w.p[1], base = Math.ceil(y0 - EPS);
  for (let k = 0; k <= reach; k++){
    w.p[1] = base + k;
    if (!inside(world, w.o, w.p)){ w.v[0] = w.v[1] = w.v[2] = 0; w.lift = 0; return true; }
  }
  w.p[1] = y0;
  return false;
}

/* One frame of dt seconds. input: { move: [x, z], the wish on the ground,
   length at most 1 (wishOf); sprint; jump, held; climb, held }. */
export function stepWalk(w, world, input, dt){
  const o = w.o, v = w.v, p = w.p;
  dt = Math.min(Math.max(dt, 0), o.maxDt);
  if (inside(world, o, p)) settle(w, world);
  const speed = o.speed * (input.sprint ? o.sprint : 1), mv = input.move || [0, 0];
  // On a wall the push is as firm as on the ground, so a walker slides along a wall it
  // climbs as it walks, and over the lip lands well onto the top: at 60 Hz the feet end
  // 1.13 voxels past the wall's face, 0.32 in the air's ease (on its edge).
  const k = Math.min(1, dt * (w.ground || w.climbing ? o.accel : o.airAccel));
  v[0] += (mv[0] * speed - v[0]) * k;
  v[2] += (mv[1] * speed - v[2]) * k;
  if (input.jump && w.ground){ v[1] = Math.sqrt(2 * o.gravity * o.jump); w.ground = false; }
  const fastest = Math.max(Math.abs(v[0]), Math.abs(v[1]) + o.gravity * dt, Math.abs(v[2]), input.climb ? o.climb * o.sprint : 0);
  const n = Math.max(1, Math.ceil(fastest * dt / o.substep)), h = dt / n;
  for (let i = 0; i < n; i++){
    const wasGround = w.ground;
    w.ground = false;
    const climb = input.climb ? climbOf(w, world, mv, wasGround || v[1] > 0) : null;
    w.climbing = !!climb;
    let v1, dy;
    if (climb === 'up'){ v1 = o.climb * (input.sprint ? o.sprint : 1); dy = v1 * h; }
    else if (climb === 'hang'){ v1 = 0; dy = 0; }
    else {
      // Exact under constant gravity (the mean of the substep's velocity): Euler's v·h after
      // v −= g·h lost half a substep's rise, and a jump of 3.25 rose 3.10.
      v1 = Math.max(-o.maxFall, v[1] - o.gravity * h); dy = (v[1] + v1) / 2 * h;
    }
    v[1] = v1;
    if (moveAxis(w, world, 1, dy)){ if (dy < 0) w.ground = true; v[1] = 0; }
    for (const a of [0, 2]){
      const d = v[a] * h;
      if (!d) continue;
      const from = p.slice();
      if (!moveAxis(w, world, a, d)) continue;
      if ((wasGround || w.ground) && stepUp(w, world, a, d, from)) continue;
      v[a] = 0;
    }
    // Off an edge: ground a step down is stood on, not fallen to.
    if (wasGround && !w.ground && v[1] <= 0){
      const y = p[1];
      if (moveAxis(w, world, 1, -o.step)){ w.ground = true; v[1] = 0; w.lift += p[1] - y; }
      else p[1] = y;
    }
  }
  w.lift *= Math.exp(-o.ease * dt);
  if (Math.abs(w.lift) < 1e-3) w.lift = 0;
  return w;
}

/* The wish from the keys: forward and strafe in −1…1, by the camera's yaw,
   as the page's fly keys read them (fwd() and its right, cross(fwd, up)). */
export function wishOf(yaw, forward, strafe){
  const s = Math.sin(yaw), c = Math.cos(yaw);
  let x = forward * s - strafe * c, z = forward * c + strafe * s;
  const l = Math.hypot(x, z);
  if (l > 1){ x /= l; z /= l; }
  return [x, z];
}

/* First-person look: a drag (or a locked pointer's movement) of dx, dy CSS
   pixels in a window `height` tall turns the eye where it stands, right
   for right and up for up, 2.4 radians a window's height. */
export const LOOK_RATE = 2.4;
export function lookBy(cam, dx, dy, height){
  const k = LOOK_RATE / Math.max(1, height);
  return { yaw: cam.yaw - dx * k, pitch: Math.max(-1.55, Math.min(1.55, cam.pitch - dy * k)) };
}

/* ---- the world, as the walker asks it ------------------------------------- */
/* Outside a world of `side` voxels is air, but for below it (y < 0), which
   is solid: the box is cut to the world before `solid` is asked. */
export function openWorld(solid, side){
  return (lo, hi) => {
    if (lo[1] < 0) return true;
    const L = [Math.max(0, lo[0]), Math.max(0, lo[1]), Math.max(0, lo[2])], H = [Math.min(side, hi[0]), Math.min(side, hi[1]), Math.min(side, hi[2])];
    if (L[0] >= H[0] || L[1] >= H[1] || L[2] >= H[2]) return false;
    return solid(L, H);
  };
}

/* `solid` with holes: boxes [x0, y0, z0, x1, y1, z1) the walker passes
   whatever is in them. A box that meets a hole is cut into the slabs around
   it (at most six), each asked on, so only what's outside every hole counts.
   The holes are bucketed by GRID³ cells, since a dungeon has hundreds. */
const GRID = 16;
export function withHoles(solid, holes){
  if (!holes || !holes.length) return solid;
  const buckets = new Map(), key = (x, y, z) => `${x},${y},${z}`;
  for (const h of holes){
    for (let z = Math.floor(h[2] / GRID); z <= Math.floor((h[5] - 1) / GRID); z++)
      for (let y = Math.floor(h[1] / GRID); y <= Math.floor((h[4] - 1) / GRID); y++)
        for (let x = Math.floor(h[0] / GRID); x <= Math.floor((h[3] - 1) / GRID); x++){
          const k = key(x, y, z);
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(h);
        }
  }
  const minus = (lo, hi, list, i) => {
    for (; i < list.length; i++){
      const h = list[i];
      if (h[0] >= hi[0] || h[3] <= lo[0] || h[1] >= hi[1] || h[4] <= lo[1] || h[2] >= hi[2] || h[5] <= lo[2]) continue;
      // Carve off the slabs outside this hole, one side at a time; what's left is inside it.
      const L = lo.slice(), H = hi.slice();
      for (let a = 0; a < 3; a++){
        if (L[a] < h[a]){ const top = H.slice(); top[a] = h[a]; if (minus(L.slice(), top, list, i + 1)) return true; L[a] = h[a]; }
        if (H[a] > h[a + 3]){ const bot = L.slice(); bot[a] = h[a + 3]; if (minus(bot, H.slice(), list, i + 1)) return true; H[a] = h[a + 3]; }
      }
      return false;
    }
    return solid(lo, hi);
  };
  return (lo, hi) => {
    const seen = new Set(), list = [];
    for (let z = Math.floor(lo[2] / GRID); z <= Math.floor((hi[2] - 1) / GRID); z++)
      for (let y = Math.floor(lo[1] / GRID); y <= Math.floor((hi[1] - 1) / GRID); y++)
        for (let x = Math.floor(lo[0] / GRID); x <= Math.floor((hi[0] - 1) / GRID); x++){
          const b = buckets.get(key(x, y, z));
          if (b) for (const h of b) if (!seen.has(h)){ seen.add(h); list.push(h); }
        }
    return list.length ? minus(lo, hi, list, 0) : solid(lo, hi);
  };
}
