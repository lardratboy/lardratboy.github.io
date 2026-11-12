/* =====================================================================
   GIZMO CORE: a placement box with handles (docs/gizmo-plan.md, step 1;
   docs/gizmo-log.md). Pure: imports dag-core.js's MUL, INV and applyG
   only, no DOM, no gl, so it runs in Node.

   The world tool used to drop a world where the crosshair hit, and that
   was all the say you had (docs/vdagplacement.md §4: "where I click and
   where the instance goes seems finicky"). A gizmo edits one placement
   before it's baked: a click opens a box, handles and keys change it, and
   Enter hands scene-core's log the { at, turn, scale } it always took.
   Every decision about the box is here; the page draws lines and passes
   rays.

   **Every handle snaps, because the engine has nothing in between** (plan
   §2). A baked child is nodes in the parent's DAG: its corner is whole
   voxels, its turn one of dag-core's 48 Oh elements, its scale a power of
   two. So nothing here is Blender's free transform. It's a box that clicks
   into places, and it snaps while you drag, so what you see can always be
   baked.

   A state is { c2, turn, scale }:
     c2     the pivot, doubled: twice the point the box is centred on, three
            integers. Doubled so a half voxel is a whole number.
     turn   an Oh element, 0–47.
     scale  2^scale parent voxels a child voxel.
   The corner `at` follows from them (placementOf): the box's centre is the
   pivot, or half a voxel above it when the box's size is odd on that axis
   (the half goes up, as scene-core's dropAt sends it).

   **Why a pivot and not just the corner.** The first design kept `at` and
   re-centred the box on every turn. A box 3 by 4 can't keep its centre on
   a quarter turn (one side's centre is on a half, the other's isn't), so
   each turn rounds, and the rounding always goes the same way: four
   quarter turns moved the box two voxels. With the pivot kept, the corner
   is a function of (pivot, turn, scale), and four quarter turns are
   exactly where you started. Any extra fields a caller puts on a state
   (the page's world, its rest face) ride along untouched.

   A ctx says what the box is of and where it may go:
     boxOf(turn, scale)  the child's content box with its cube's corner at 0
                         ({ lo, hi }, scene-core's childFrame for at = 0).
                         A callback, since the page memoizes it per world.
     side                the parent's side, in voxels.
     scales              [least, most] scale the child may take.
     grid                1 or 16: what an arrow moves by.

   The rules each function keeps, which test/gizmo-core.test.js holds with
   arithmetic of its own:
     - **A drag is a function of where it started and where the pointer is
       now**, never a sum of small moves: out and back is the start, and a
       slow drag ends where a fast one does.
     - An arrow moves along its axis only, in whole steps of the grid from
       where it started.
     - A turn keeps the pivot; a mirror keeps the box itself.
     - A scale keeps the faces its anchor names, exactly.
     - **Every answer is a placement the log accepts**: whole voxels, one
       of the 48, a scale in range, and a box that still meets the world
       (a drop with no voxel in the world isn't an op). A drag that would
       leave stops at the edge.
   ===================================================================== */
import { MUL, INV, applyG } from './dag-core.js';

/* ---- the tables -------------------------------------------------------------
   dag-core's encoding: element e sends a point v (about the cube's centre)
   to applyG(v, e), and MUL[a * 48 + b] is "b, then a".

   QUARTER[a] is a quarter turn about axis a, counter-clockwise seen from
   the axis's positive end (right-handed): about x it sends y to z, about y
   it sends z to x, about z it sends x to y. docs/vdagplacement.md §5's
   sketch found the three, and that composing them reaches all 24.
   MIRROR[a] flips axis a. Any one of them times the 24 gives the other 24.
   The test holds both tables to applyG on probe points. */
export const QUARTER = [10, 44, 17];
export const MIRROR = [1, 2, 4];
const AXES = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

/* The turn that stands a child on a face: the rotation taking the child's
   up (+y) to the face's outward normal, so its underside is against the
   face. On a floor that's nothing; on a wall it's one quarter turn about
   the horizontal axis along the wall; under a ceiling it's half a turn
   about x. These are the "six downs" of vdagplacement §5: each, followed
   by the four spins about the normal, is one row of its table. */
export function upTo(axis, sign){
  if (axis === 1) return sign > 0 ? 0 : MUL[QUARTER[0] * 48 + QUARTER[0]];
  // +x: y to x is a quarter back about z; +z: y to z is a quarter on about x.
  if (axis === 0) return sign > 0 ? INV[QUARTER[2]] : QUARTER[2];
  return sign > 0 ? QUARTER[0] : INV[QUARTER[0]];
}
/* "Underside to the face" (the V toggle). The turn you hold, T, is in the
   floor's frame. With the toggle on, the box that opens on a face is
   upTo(face) after T, so on a wall it sticks out like a sconce. closeTurn
   takes a box's turn back to that frame, so the next box you open on the
   same face is turned as this one was. */
export const openTurn = (turn, face, under) => under && face && face.axis >= 0 ? MUL[upTo(face.axis, face.normal) * 48 + turn] : turn;
export const closeTurn = (turn, lift) => MUL[INV[lift] * 48 + turn];

/* Where a turn sends the child's own directions, each as [axis, sign]:
   its underside (−y), its up, its front (+z, a glTF asset's front) and its
   +x side. `mirrored` is whether it's one of the 24 that aren't rotations:
   up × front is then the other side. The page names a turn by these, and
   marksOf draws them. */
export function frameOf(turn){
  const dir = v => { const w = applyG(v, turn), a = w.findIndex(x => x !== 0); return [a, w[a] > 0 ? 1 : -1]; };
  const up = dir([0, 1, 0]), front = dir([0, 0, 1]), side = dir([1, 0, 0]);
  // The triple product of the three images: +1 for a rotation, −1 for a mirror.
  const X = applyG([1, 0, 0], turn), Y = applyG([0, 1, 0], turn), Z = applyG([0, 0, 1], turn);
  const det = X[0] * (Y[1] * Z[2] - Y[2] * Z[1]) - X[1] * (Y[0] * Z[2] - Y[2] * Z[0]) + X[2] * (Y[0] * Z[1] - Y[1] * Z[0]);
  return { down: [up[0], -up[1]], up, front, side, mirrored: det < 0 };
}

/* ---- a state and its placement --------------------------------------------- */
const sumOf = b => [b.lo[0] + b.hi[0], b.lo[1] + b.hi[1], b.lo[2] + b.hi[2]];
// The corner: the box centred on the pivot, a half rounded up.
export function placementOf(ctx, s){
  const sum = sumOf(ctx.boxOf(s.turn, s.scale));
  return { at: s.c2.map((c, i) => Math.floor((c - sum[i] + 1) / 2)), turn: s.turn, scale: s.scale };
}
// The box in the parent's voxels, { lo, hi }.
export function boxAt(ctx, s){
  const b = ctx.boxOf(s.turn, s.scale), { at } = placementOf(ctx, s);
  return { lo: at.map((v, i) => v + b.lo[i]), hi: at.map((v, i) => v + b.hi[i]) };
}
/* The state whose box sits exactly where a placement puts it: the pivot is
   that box's centre. What a click's dropAt, a body drag's landing and an
   undone drop come in by. Extra fields of `keep` are kept. */
export function fromPlacement(ctx, p, keep = {}){
  const turn = p.turn ?? 0, scale = p.scale ?? 0, sum = sumOf(ctx.boxOf(turn, scale));
  return settle(ctx, { ...keep, c2: p.at.map((v, i) => 2 * v + sum[i]), turn, scale });
}
/* Into the world. The log takes any box that still has a voxel's width
   inside the parent on every axis, so that's the edge: a box wholly outside
   is moved back until one voxel of it is in. Only then is the pivot moved,
   and by whole voxels. */
export function settle(ctx, s){
  const b = boxAt(ctx, s), c2 = s.c2.slice();
  let moved = false;
  for (let i = 0; i < 3; i++){
    const d = b.hi[i] < 1 ? 1 - b.hi[i] : b.lo[i] > ctx.side - 1 ? ctx.side - 1 - b.lo[i] : 0;
    if (d){ c2[i] += 2 * d; moved = true; }
  }
  return moved ? { ...s, c2 } : s;
}
export const sameState = (a, b) => a.turn === b.turn && a.scale === b.scale && a.c2.every((v, i) => v === b.c2[i]);

/* ---- what the keys do, and what the drags end in -------------------------------
   moveBy: n voxels along an axis, stopped at the world's edge.
   turnAbout: `quarters` quarter turns about a world axis (right-handed,
   any integer), the pivot kept. turned and mirrored are the same on a
   turn alone, for the turn the page holds while no box is open.
   mirrorAcross: the child flipped along a world axis. Its content box is
   the same size and the pivot is kept, so the box doesn't move: only
   what's in it does.
   scaleBy: k doublings (or halvings), stopped at the scale range's ends.
   `anchor` says what stays, an entry an axis: −1 the box's low face, +1
   its high face, 0 the pivot. A corner drag keeps the three faces of the
   opposite corner; the keys keep the face the box rests on and the pivot
   across it, so a knight on a floor grows up from the floor. */
export function moveBy(ctx, s, axis, n){
  const b = boxAt(ctx, s), c2 = s.c2.slice();
  n = Math.max(1 - b.hi[axis], Math.min(ctx.side - 1 - b.lo[axis], n));
  c2[axis] += 2 * n;
  return { ...s, c2 };
}
export function turned(turn, axis, quarters){
  for (let q = ((quarters % 4) + 4) % 4; q > 0; q--) turn = MUL[QUARTER[axis] * 48 + turn];
  return turn;
}
export const mirrored = (turn, axis) => MUL[MIRROR[axis] * 48 + turn];
export const turnAbout = (ctx, s, axis, quarters) => settle(ctx, { ...s, turn: turned(s.turn, axis, quarters) });
export const mirrorAcross = (ctx, s, axis) => settle(ctx, { ...s, turn: mirrored(s.turn, axis) });
export function scaleBy(ctx, s, k, anchor = [0, 0, 0]){
  const scale = Math.max(ctx.scales[0], Math.min(ctx.scales[1], s.scale + k));
  if (scale === s.scale) return s;
  const was = boxAt(ctx, s), b = ctx.boxOf(s.turn, scale), c2 = s.c2.slice();
  for (let i = 0; i < 3; i++){
    // The new corner along this axis puts the kept face where it was; the pivot is then that box's centre.
    if (anchor[i] < 0) c2[i] = 2 * (was.lo[i] - b.lo[i]) + b.lo[i] + b.hi[i];
    else if (anchor[i] > 0) c2[i] = 2 * (was.hi[i] - b.hi[i]) + b.lo[i] + b.hi[i];
  }
  return settle(ctx, { ...s, c2, scale });
}

/* ---- the view-relative keys (vdagplacement §5) ---------------------------------
   The camera's heading is rounded to the nearest of the four horizontal
   directions, and a key means what it looks like from there. The page's
   camera: yaw 0 looks along +z, and the screen's right is forward × up, so
   at yaw 0 it's −x (the world is right-handed and drawn unmirrored).

   viewAxes(yaw): forward and right, each [axis, sign].
   viewTurn(yaw, name): [axis, quarters] for turnAbout.
     spinRight  the near side goes right: counter-clockwise from above, +y.
     tipAway    the top goes away from you: a quarter back about your right.
     rollRight  the top goes to your right: a quarter on about your forward.
   and spinLeft, tipToward, rollLeft the other way. */
export function viewAxes(yaw){
  const q = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
  const forward = [[2, 1], [0, 1], [2, -1], [0, -1]][q];
  // forward × up: +z gives −x, +x gives +z.
  const right = forward[0] === 2 ? [0, -forward[1]] : [2, forward[1]];
  return { forward, right };
}
export function viewTurn(yaw, name){
  const { forward, right } = viewAxes(yaw);
  switch (name){
    case 'spinRight': return [1, 1];
    case 'spinLeft': return [1, -1];
    case 'tipAway': return [right[0], -right[1]];
    case 'tipToward': return [right[0], right[1]];
    case 'rollRight': return [forward[0], forward[1]];
    case 'rollLeft': return [forward[0], -forward[1]];
  }
  throw new Error(`gizmo: no turn called ${name}`);
}

/* ---- handles -------------------------------------------------------------------
   One gizmo with every handle on it (plan §8 Q5): six arrows, one a face,
   pointing out; three rings about the pivot, one an axis; eight corners.

   **Handles keep one size on screen.** `view` is { eye, fwd, pixel }, with
   `pixel` the voxels one screen pixel covers at depth 1, so a length of p
   pixels at a point is p · pixel · the point's depth along fwd. The arrows
   and corners sit on the box, so they spread as you come closer; the rings
   are a fixed size about the pivot, so there's always one to grab.

   What's hidden:
     - anything behind the eye;
     - an arrow on a face that looks away from the eye, when the face
       across from it looks at the eye, and a corner none of whose three
       faces looks at it (there's no depth test, and they'd show through
       the box). **With the eye level with the box, between two faces'
       planes, both of those arrows show**, sticking out to either side.
       The first try hid every arrow on a face that looked away, and the
       commonest view of all (standing in front of a knight, eye inside its
       width and height) had one arrow, pointing at you;
     - an arrow seen nearly end on: the point on its axis nearest the
       pointer's ray runs away as the two line up.
   A ring is never hidden for its angle: seen edge on it's a line across
   the box, and it's still taken and dragged along that line (see the drags).
   And the handle being dragged (`held`, its id) is hidden for nothing but
   being behind the eye: pull an arrow until the eye is past the box's far
   face and the arrow in your hand was gone, with the drag still going on.

   A handle is { id, kind, axis | sign | bits, shape: [segments], r, segs }:
   `shape` is what a ray has to come within r of (a capsule for an arrow, a
   polyline for a ring, a point for a corner), `segs` the lines to draw,
   both in the parent's voxels. They come sorted far to near, for a page
   that draws without depth. */
export const HANDLE = { arrow: 46, head: 9, ring: 64, ringSegs: 48, corner: 4.5, hit: 7, cornerHit: 9, endOn: 0.97 };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export function handlesOf(ctx, s, view, held = null){
  const box = boxAt(ctx, s), mid = [0, 1, 2].map(i => (box.lo[i] + box.hi[i]) / 2), pivot = s.c2.map(c => c / 2);
  const depth = p => dot(sub(p, view.eye), view.fwd), px = (p, n) => n * view.pixel * depth(p);
  // Does the low (0) or high (1) face of axis a look at the eye?
  const faces = [[0, 1, 2].map(a => view.eye[a] < box.lo[a]), [0, 1, 2].map(a => view.eye[a] > box.hi[a])];
  const out = [];
  for (let a = 0; a < 3; a++) for (const sign of [-1, 1]){
    const base = mid.slice();
    base[a] = sign > 0 ? box.hi[a] : box.lo[a];
    const id = `arrow:${'xyz'[a]}${sign > 0 ? '+' : '-'}`;
    if (depth(base) <= 0 || (id !== held && (faces[sign > 0 ? 0 : 1][a] || Math.abs(unit(sub(base, view.eye))[a]) > HANDLE.endOn))) continue;
    const len = px(base, HANDLE.arrow), head = px(base, HANDLE.head), tip = base.slice(), neck = base.slice();
    tip[a] += sign * len; neck[a] += sign * (len - head);
    const segs = [...base, ...tip];
    for (const b of [(a + 1) % 3, (a + 2) % 3]) for (const side of [-1, 1]){
      const barb = neck.slice();
      barb[b] += side * head / 2;
      segs.push(...tip, ...barb);
    }
    out.push({ id, kind: 'arrow', axis: a, sign, base, shape: [[base, tip]], r: px(base, HANDLE.hit), segs, depth: depth(base) });
  }
  if (depth(pivot) > 0) for (let a = 0; a < 3; a++){
    const R = px(pivot, HANDLE.ring), b = (a + 1) % 3, c = (a + 2) % 3, shape = [], segs = [];
    const at = k => { const th = 2 * Math.PI * k / HANDLE.ringSegs, p = pivot.slice(); p[b] += R * Math.cos(th); p[c] += R * Math.sin(th); return p; };
    for (let k = 0; k < HANDLE.ringSegs; k++){ const p = at(k), q = at((k + 1) % HANDLE.ringSegs); shape.push([p, q]); segs.push(...p, ...q); }
    out.push({ id: `ring:${'xyz'[a]}`, kind: 'ring', axis: a, centre: pivot, R, shape, r: px(pivot, HANDLE.hit), segs, depth: depth(pivot) });
  }
  for (let bits = 0; bits < 8; bits++){
    const hi = [bits & 1, bits >> 1 & 1, bits >> 2 & 1], p = hi.map((h, i) => h ? box.hi[i] : box.lo[i]);
    if (depth(p) <= 0 || (`corner:${bits}` !== held && !hi.some((h, i) => faces[h][i]))) continue;
    // A segment of no length: the page's line shader draws it as a square of its width.
    out.push({ id: `corner:${bits}`, kind: 'corner', bits, at: p, shape: [[p, p]], r: px(p, HANDLE.cornerHit), segs: [...p, ...p], width: 2 * HANDLE.corner, depth: depth(p) });
  }
  return out.sort((x, y) => y.depth - x.depth);
}

/* The nearest a ray (o + s·d, s ≥ 0) comes to a segment, and where along
   the ray: closest points of two segments (Ericson, Real-Time Collision
   Detection §5.1.9), the ray's far end left open. */
function raySegment(o, d, p, q){
  const e = sub(q, p), r = sub(o, p), ee = dot(e, e), c = dot(d, r);
  let s, u;
  if (ee < 1e-12){ u = 0; s = Math.max(0, -c); }
  else {
    const b = dot(d, e), f = dot(e, r), den = ee - b * b;
    s = den > 1e-12 * ee ? Math.max(0, (b * f - c * ee) / den) : 0;
    u = (b * s + f) / ee;
    if (u < 0){ u = 0; s = Math.max(0, -c); }
    else if (u > 1){ u = 1; s = Math.max(0, b - c); }
  }
  return { dist: Math.hypot(o[0] + s * d[0] - p[0] - u * e[0], o[1] + s * d[1] - p[1] - u * e[1], o[2] + s * d[2] - p[2] - u * e[2]), s, u };
}
/* What a ray is on: the handle it comes within reach of nearest the eye,
   else the box itself ({ kind: 'body' }), else null. A handle wins over
   the body wherever both are under the pointer, or a box that fills the
   view would leave nothing else to grab. `box` may be left out. */
export function hitHandle(handles, ray, box = null){
  const d = unit(ray.d);
  let best = null;
  for (const h of handles){
    let near = null;
    for (const [p, q] of h.shape){
      const m = raySegment(ray.o, d, p, q);
      if (m.dist <= h.r && (!near || m.s < near.s)) near = m;
    }
    if (near && (!best || near.s < best.t)) best = { ...h, t: near.s };
  }
  if (best || !box) return best;
  // The slab test, with a zero component a test of where the ray runs.
  let t0 = 0, t1 = Infinity;
  for (let i = 0; i < 3; i++){
    if (d[i] === 0){ if (ray.o[i] < box.lo[i] || ray.o[i] > box.hi[i]) return null; continue; }
    const a = (box.lo[i] - ray.o[i]) / d[i], b = (box.hi[i] - ray.o[i]) / d[i];
    t0 = Math.max(t0, Math.min(a, b)); t1 = Math.min(t1, Math.max(a, b));
  }
  return t0 <= t1 ? { id: 'body', kind: 'body', t: t0 } : null;
}

/* ---- drags -----------------------------------------------------------------------
   startDrag keeps the state the drag began from and where on the handle it
   was taken; dragTo answers from those and the pointer's ray now, and from
   nothing else.

   An arrow: the point on the arrow's axis nearest the ray, less the same
   for the ray it was taken by, snapped to the grid. The steps are counted
   from where the box started, so on the 16 snap a box that dropAt put on
   its first copy's grid stays on it, and a box that stood on a floor comes
   back to the floor.

   A ring: how far the pointer has gone along the ring's tangent where it
   was taken, as an arc of the ring: a quarter of the way round is a quarter
   turn, to the nearest. The tangent is the way that point of the ring goes
   when the box turns counter-clockwise about the axis, so the box turns
   the way you pull it. **The first try measured the angle of where the ray
   met the ring's plane**, which is the obvious rule and is useless for the
   ring you want most: standing on the ground, the ring about y is nearly
   edge on, its plane runs along your line of sight, and a pixel of the
   pointer was metres across it. A line across the view has no such angle.

   A corner: how far along the box's diagonal the ray is, from the opposite
   corner, as a ratio of the diagonal: twice as far is ×2, half is ½, to the
   nearest power of two (so the steps are at √2 and 1/√2).

   The body: the page picks the world under the pointer and hands in the
   corner dropAt made of it (`landed`), so the box slides over the world by
   the click's own rule. It's the one drag that isn't out-and-back exact:
   it's a new landing each time. With no landing (the pointer's on the sky)
   the box is where it started.

   **A ray that can't say** gives the start back: one parallel to the
   arrow's axis or the ring's tangent, or whose nearest point is behind the
   eye (the first try let those through, and a pointer past an axis's
   vanishing point threw the box to the world's edge). */
// t of the point on the line B + t·a (a a unit vector) nearest the ray's line, or null.
function lineParam(B, a, ray){
  const d = ray.d, w = sub(B, ray.o), ad = dot(a, d), dd = dot(d, d), aw = dot(a, w), dw = dot(d, w), den = dd - ad * ad;
  if (den < 1e-9 * dd) return null;
  const t = (ad * dw - dd * aw) / den;
  return dw + t * ad > 0 ? t : null;
}
export function startDrag(ctx, s, handle, ray){
  const drag = { kind: handle.kind, id: handle.id, from: s };
  if (handle.kind === 'arrow'){
    drag.axis = handle.axis; drag.base = handle.base.slice();
    drag.t0 = lineParam(drag.base, AXES[drag.axis], ray);
  } else if (handle.kind === 'ring'){
    // Where on the ring it was taken: the point of it nearest the ray.
    const d = unit(ray.d), O = handle.centre;
    let best = null;
    for (const [p, q] of handle.shape){
      const m = raySegment(ray.o, d, p, q);
      if (!best || m.dist < best.dist) best = { dist: m.dist, at: [p[0] + m.u * (q[0] - p[0]), p[1] + m.u * (q[1] - p[1]), p[2] + m.u * (q[2] - p[2])] };
    }
    // axis × (at − centre): the way that point goes on a counter-clockwise turn.
    const r = sub(best.at, O), a = AXES[handle.axis];
    drag.axis = handle.axis; drag.at = best.at; drag.arc = handle.R * Math.PI / 2;
    drag.dir = unit([a[1] * r[2] - a[2] * r[1], a[2] * r[0] - a[0] * r[2], a[0] * r[1] - a[1] * r[0]]);
    drag.t0 = lineParam(drag.at, drag.dir, ray);
  } else if (handle.kind === 'corner'){
    const box = boxAt(ctx, s), hi = [handle.bits & 1, handle.bits >> 1 & 1, handle.bits >> 2 & 1];
    // The opposite corner stays: where this one is high, the low faces are kept.
    drag.anchor = hi.map(h => h ? -1 : 1);
    drag.far = hi.map((h, i) => h ? box.lo[i] : box.hi[i]);
    const here = hi.map((h, i) => h ? box.hi[i] : box.lo[i]), v = sub(here, drag.far);
    drag.len = Math.hypot(v[0], v[1], v[2]); drag.dir = unit(v);
    drag.t0 = lineParam(drag.far, drag.dir, ray);
  }
  return drag;
}
export function dragTo(ctx, drag, ray, landed = null){
  const s = drag.from;
  if (drag.kind === 'arrow'){
    const t = drag.t0 === null ? null : lineParam(drag.base, AXES[drag.axis], ray);
    if (t === null) return s;
    // Whole steps of the grid, and no further than the last step still in the world.
    const g = ctx.grid || 1, b = boxAt(ctx, s);
    const n = Math.max(Math.ceil((1 - b.hi[drag.axis]) / g), Math.min(Math.floor((ctx.side - 1 - b.lo[drag.axis]) / g), Math.round((t - drag.t0) / g)));
    return moveBy(ctx, s, drag.axis, g * n);
  }
  if (drag.kind === 'ring'){
    const t = drag.t0 === null ? null : lineParam(drag.at, drag.dir, ray);
    return t === null ? s : turnAbout(ctx, s, drag.axis, Math.round((t - drag.t0) / drag.arc));
  }
  if (drag.kind === 'corner'){
    const t = drag.t0 === null || !(drag.len > 0) ? null : lineParam(drag.far, drag.dir, ray);
    if (t === null) return s;
    const ratio = (drag.len + t - drag.t0) / drag.len;
    return scaleBy(ctx, s, ratio > 0 ? Math.round(Math.log2(ratio)) : -64, drag.anchor);
  }
  // The body.
  return landed ? fromPlacement(ctx, { at: landed, turn: s.turn, scale: s.scale }, s) : s;
}

/* ---- what the box shows of the child ---------------------------------------------
   Until the child itself is drawn in the box (plan step 3), a wire box says
   nothing of which way a knight faces, and with 48 turns that's most of
   what's being chosen. So two marks, as segments in the parent's voxels:
     under   the two diagonals of the face the child's underside is on;
     front   on the face its front (+z) is on, an arrow up the middle
             pointing the child's up, with a flag at half height toward the
             child's +x. A mirror puts the flag on the other side, which is
             the only thing about a mirror a box can show.
   Returns { under, front }, each a flat list of segments (6 numbers each). */
export function marksOf(ctx, s){
  const box = boxAt(ctx, s), f = frameOf(s.turn), mid = [0, 1, 2].map(i => (box.lo[i] + box.hi[i]) / 2), half = [0, 1, 2].map(i => (box.hi[i] - box.lo[i]) / 2);
  const on = ([a, sign]) => { const p = mid.slice(); p[a] += sign * half[a]; return p; };
  const along = (p, [a, sign], k) => { const q = p.slice(); q[a] += sign * k * half[a]; return q; };
  const under = [], c = on(f.down), [u, v] = [0, 1, 2].filter(a => a !== f.down[0]);
  for (const k of [1, -1]) under.push(...along(along(c, [u, -1], 1), [v, -k], 1), ...along(along(c, [u, 1], 1), [v, k], 1));
  const o = on(f.front), foot = along(o, f.up, -0.6), top = along(o, f.up, 0.6), neck = along(o, f.up, 0.3);
  const front = [...foot, ...top, ...top, ...along(neck, f.side, 0.25), ...top, ...along(neck, f.side, -0.25), ...o, ...along(o, f.side, 0.5)];
  return { under, front };
}

/* Segments in the parent's voxels to segments about the eye, cut at a near
   plane (a segment wholly nearer is dropped), as a Float32Array the page's
   line shader takes: edit-core's boxEdges does this for a box's edges. */
export function clipSegments(segs, eye, fwd, near = 0){
  const out = [];
  for (let i = 0; i + 5 < segs.length; i += 6){
    let p = [segs[i] - eye[0], segs[i + 1] - eye[1], segs[i + 2] - eye[2]], q = [segs[i + 3] - eye[0], segs[i + 4] - eye[1], segs[i + 5] - eye[2]];
    const dp = dot(p, fwd), dq = dot(q, fwd);
    if (dp < near && dq < near) continue;
    if (dp < near || dq < near){
      const t = (near - dp) / (dq - dp), m = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
      if (dp < near) p = m; else q = m;
    }
    out.push(p[0], p[1], p[2], q[0], q[1], q[2]);
  }
  return new Float32Array(out);
}

/* ---- the preview: the child drawn in the box (plan step 3) --------------------
   A wire box says nothing of which way a knight faces, and with 48 turns
   that's most of what's chosen. So the child is drawn in the box: one chunk
   of records (chunk-core's expandChunk, the *any* rule), made once a world
   and lod, and turned, scaled and moved by the vertex shader, as an actor's
   body is.

   previewLod: the lod whose cells the preview draws. At most PREVIEW_CELLS
   across, so a knight is one chunk (the D = 8 knight at 64 across is 7,800
   cubes, 3 ms; plan §5.2), and never a cell smaller than a parent voxel.
   **When the second rule is the one that binds (lod = −scale) the cells are
   exactly what the bake makes**: a child at ½ is baked by the *any* rule
   one level down, which is the *any* lod 1 of the child, cell for voxel.
   Above that the preview is coarser than the bake, and holds all of it.

   previewMap: where a cell lands. A point v of the child, in cell units of
   lod, goes to M·(v·cell − half) + shift: about the child cube's centre,
   through the turn (dag-core's applyG as a matrix, row-major), scaled, then
   to the cube's place. That's scene-core's order (turn about the centre,
   scale, move), so the cells sit where the bake puts voxels. The page hands
   the same numbers to the shader (with the eye taken off the shift);
   test/gizmo-core.test.js holds this map to the bake by root id, and the
   browser test holds the shader's pixels to a ray cast of it.
   `mirrored`: the turn isn't a rotation, so every triangle's winding flips
   and the page culls the other face. */
export const PREVIEW_CELLS = 64;
export const previewLod = (D, scale, cells = PREVIEW_CELLS) => Math.max(0, D - Math.log2(cells), -(scale ?? 0));
export function previewMap(p, D, lod){
  const e = p.turn ?? 0, s = 2 ** (p.scale ?? 0), M = new Array(9);
  for (let c = 0; c < 3; c++){ const col = applyG(AXES[c], e); for (let r = 0; r < 3; r++) M[3 * r + c] = col[r] + 0; }
  const half = 2 ** D * s / 2, cell = 2 ** lod * s;
  const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
  return { M, cell, half, shift: p.at.map(v => v + half), mirrored: det < 0 };
}
// The parent box a cell (x, y, z) of the preview covers: { lo, hi }.
export function cellBoxOf(map, x, y, z){
  const lo = [0, 0, 0], hi = [0, 0, 0], v = [x, y, z], { M, cell, half, shift } = map;
  for (let r = 0; r < 3; r++){
    let a = shift[r], b = shift[r];
    for (let c = 0; c < 3; c++){
      const m = M[3 * r + c];
      if (!m) continue;
      const p0 = m * (v[c] * cell - half), p1 = m * ((v[c] + 1) * cell - half);
      a += Math.min(p0, p1); b += Math.max(p0, p1);
    }
    lo[r] = a; hi[r] = b;
  }
  return { lo, hi };
}

/* ---- the preview's detail (2026-11-11, gizmo-log §9.5 Q1 and §11) --------------
   Asked for after the first try: "when moving it can be low, when stopped it
   should show the actual size that will be placed", with keys to choose. 64
   cells across is a knight you can aim; it isn't the knight you get.

   previewFine: the lod whose cells are the bake's own voxels. At ×1 and up
   that's lod 0 (a child voxel is a 2^scale cube of parent voxels, and the
   cube is drawn whole); at ½ and ¼ it's −scale, the *any* rule's lod, which
   is what the bake makes (previewLod's note). Nothing finer can be shown,
   since nothing finer is placed.

   previewPlan: what to draw this frame, and what to make next. A lod is made
   once a world, a few ms a frame, and kept, so the plan only reads which
   lods are complete (`have(lod)`: its cubes, or undefined).
     - The coarse lod (previewLod's, one chunk) comes first, whole, at once:
       there's always something to draw.
     - At rest it draws the finest complete lod down to `rest`, and asks for
       the next finer one: each step is about four times the cubes of the
       last, so the steps before the last cost a third of it, and the
       picture sharpens as they land.
     - `rest` is the bake's lod, or `detail` lods finer than the coarse one
       if that's less (the keys; Infinity: all the way).
     - It stops short of `rest` where the next lod would pass `restCubes` by
       the estimate (four times the last): `held`. The D = 10 knight's lod 0
       is 2.2 million cubes and 5 s of jobs (plan §5.2), which the default
       2^22 lets through; a D = 12 child's would be ten times that.
     - Moving, nothing is made, and it draws the finest complete lod of at
       most `moveCubes` (2^18: the D = 8 knight's lod 0 is 134,000, so a
       small child never changes while it moves), or the coarse one. The
       turn and the place are uniforms either way; what's saved is the draw.
     - No lod is more than 2^`span` cells across (16): the page packs a
       chunk's place in the lod's grid as 10 bits an axis, and a chunk is 64
       cells. Only a child of D > 16 meets it (flat ground from a file). */
export const PREVIEW_REST_CUBES = 2 ** 22, PREVIEW_MOVE_CUBES = 2 ** 18, PREVIEW_SPAN = 16;
const restFloor = (D, scale, coarse, span) => Math.min(coarse, Math.max(previewFine(scale), D - span));
export const previewFine = scale => Math.max(0, -(scale ?? 0));
export function previewPlan(D, scale, { detail = Infinity, moving = false, have = () => undefined, cells = PREVIEW_CELLS,
                                        restCubes = PREVIEW_REST_CUBES, moveCubes = PREVIEW_MOVE_CUBES, span = PREVIEW_SPAN } = {}){
  const coarse = previewLod(D, scale, cells), fine = Math.min(coarse, previewFine(scale)), rest = Math.max(restFloor(D, scale, coarse, span), coarse - Math.max(0, detail));
  const out = { coarse, fine, rest, draw: null, make: null, held: false };
  if (have(coarse) === undefined){ out.make = coarse; return out; }
  let finest = coarse;
  for (let l = coarse - 1; l >= rest; l--) if (have(l) !== undefined) finest = l;
  if (moving){
    out.draw = coarse;
    for (let l = coarse - 1; l >= rest; l--) if (have(l) <= moveCubes) out.draw = l;
    return out;
  }
  out.draw = finest;
  if (finest > rest){ if (4 * have(finest) <= restCubes) out.make = finest - 1; else out.held = true; }
  return out;
}
/* The keys: one lod coarser or finer at rest. `detail` is counted from the
   coarse lod, so 0 is the 64 across of step 3; at the bake's own lod it's
   Infinity again, which is "all the way" for whatever child and scale come
   next. */
export function detailStep(D, scale, detail, k, cells = PREVIEW_CELLS, span = PREVIEW_SPAN){
  const coarse = previewLod(D, scale, cells), most = coarse - restFloor(D, scale, coarse, span);
  const next = Math.max(0, Math.min(most, Math.min(detail, most) + k));
  return next >= most ? Infinity : next;
}
