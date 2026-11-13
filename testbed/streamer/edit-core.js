/* ================== EDIT CORE (pure) =================================
   Block editing's decisions, with nothing on screen yet: step 2 of
   docs/realtimecsg.md §11.8. What a click is, in four pieces:

     pick      the first voxel a ray meets, and the face it came in by
     targets   which block that means: the one to break, the one to place
     place     that block in or out of the DAG, as one path of interns
     the log   every op in order, the undo stack, and the colour table
               each worker rebuilds from it

   Promoted from experiments/csg-sketch.mjs, whose numbers are §11's. What
   changed on the way is in docs/edit-log.md, chiefly pick's rule at exact
   ties, which the sketch dodged by adding 1e-4 to every ray it cast. A real
   crosshair looking straight down an axis would have divided by zero.

   Pure: imports only dag-core.js. It takes no colour field of its own: one
   is handed to editedField, as every other world's rgb8 is handed in. */
import { EMPTY, FIRST_NODE } from './dag-core.js';

/* `>>` on a coordinate needs it inside an int32, and the table keeps them in
   an Int32Array. Clay's descriptor stops at 28, so this is only a guard. */
export const MAX_D = 30;

/* ---- place ----------------------------------------------------------------
   A block snapped to its own grid is one node: solid(level) or EMPTY at cell
   (X, Y, Z) of its level, so an edit is D − level interns along one path, with
   no shape test and no walk off the path. About 3 µs (§11.2).

   Because the store is hash-consed, a block that changes nothing hands back
   the same root, and the same goes for an edit that puts a world back as it
   was: break what you just placed and the root's id is the one you started
   with. The first is how the log knows a click did nothing. The second is
   §5's trap for colour, which is why colour can't be read off the root.

   Children are interned before their parents, as dag-core requires, because
   the walk back up interns one level at a time. Nothing here allocates: intern
   copies its 8 ids, so one buffer serves every level. */
const PATH = new Uint32Array(MAX_D + 1), KIDS = new Uint32Array(8);
export function place(store, root, D, level, X, Y, Z, id){
  if (D > MAX_D) throw new RangeError(`place: D ${D} is past ${MAX_D}`);
  const side = 2 ** (D - level);
  if (!(level >= 0 && level <= D) || (X | 0) !== X || (Y | 0) !== Y || (Z | 0) !== Z || X < 0 || Y < 0 || Z < 0 || X >= side || Y >= side || Z >= side)
    throw new RangeError(`place: cell (${X}, ${Y}, ${Z}) of level ${level} is outside a world of depth ${D}`);
  let n = root;
  for (let k = D; k > level; k--){
    PATH[k] = n;
    if (n >= FIRST_NODE){
      const b = k - 1 - level;
      n = store.child(n, (X >> b & 1) | (Y >> b & 1) << 1 | (Z >> b & 1) << 2);
    }
  }
  if (n === id) return root;
  let out = id;
  for (let k = level + 1; k <= D; k++){
    const p = PATH[k], b = k - 1 - level;
    if (p >= FIRST_NODE) for (let o = 0; o < 8; o++) KIDS[o] = store.child(p, o);
    else KIDS.fill(EMPTY);
    KIDS[(X >> b & 1) | (Y >> b & 1) << 1 | (Z >> b & 1) << 2] = out;
    out = store.intern(k, KIDS);
  }
  return out;
}

/* ---- pick -----------------------------------------------------------------
   The first voxel a ray enters, walking the DAG front to back. Children in
   ascending (i ^ sign) order are front to back for any ray, so the first voxel
   reached is the nearest and the walk stops. About 5 µs (§11.2), so it can run
   every frame for the outline. It reads store.child only, so a storeView can
   run it on the page.

   **The rule at the edges.** A voxel [x, x + 1) is hit only if the ray spends
   a positive length inside it. So a ray exactly along a shared face belongs to
   the voxel on the high side, and a ray through an exact edge or corner doesn't
   touch the voxels that only meet it there. Two such voxels can't both claim
   the ray, because positive-length pieces of a line in disjoint boxes are
   disjoint: there's one answer, and the dense oracle can state it without any
   traversal order.

   **Division, not a stored 1/d.** The usual (X − o) * inverse rounds twice, so
   a ray through an exact corner comes out as a coin flip per axis. A division
   is correctly rounded, so equal rationals are equal floats and an exact tie is
   a tie. Six divisions a node don't show next to the walk.

   **A zero component has no slab to cross**, and 1/0 would give NaN at the
   boundary, so that axis is just a test of where the ray runs. A real crosshair
   can look straight down an axis, so this isn't a corner case.

   Returns { x, y, z, t, axis, normal } or null. axis is the face it came in by,
   −1 when the eye starts inside the voxel. Ties in axis go to the lowest, so an
   exact-corner entry reports x before y before z. `tMax` is the reach: a voxel
   entered past it isn't hit. */
export function pick(store, root, D, o, d, { tMax = Infinity, stats = null } = {}){
  const ox = o[0], oy = o[1], oz = o[2], dx = d[0], dy = d[1], dz = d[2];
  if (!(Number.isFinite(ox) && Number.isFinite(oy) && Number.isFinite(oz) &&
        Number.isFinite(dx) && Number.isFinite(dy) && Number.isFinite(dz))) return null;
  if (dx === 0 && dy === 0 && dz === 0) return null;
  const sign = (dx < 0 ? 1 : 0) | (dy < 0 ? 2 : 0) | (dz < 0 ? 4 : 0);
  let visited = 0, hit = null;
  const rec = (id, k, x, y, z) => {
    const S = 2 ** k, X = x * S, Y = y * S, Z = z * S;
    let tin = -Infinity, tout = Infinity, axis = -1;
    if (dx === 0){ if (ox < X || ox >= X + S) return false; }
    else {
      const a = ((dx < 0 ? X + S : X) - ox) / dx, b = ((dx < 0 ? X : X + S) - ox) / dx;
      if (a > tin){ tin = a; axis = 0; }
      if (b < tout) tout = b;
    }
    if (dy === 0){ if (oy < Y || oy >= Y + S) return false; }
    else {
      const a = ((dy < 0 ? Y + S : Y) - oy) / dy, b = ((dy < 0 ? Y : Y + S) - oy) / dy;
      if (a > tin){ tin = a; axis = 1; }
      if (b < tout) tout = b;
    }
    if (dz === 0){ if (oz < Z || oz >= Z + S) return false; }
    else {
      const a = ((dz < 0 ? Z + S : Z) - oz) / dz, b = ((dz < 0 ? Z : Z + S) - oz) / dz;
      if (a > tin){ tin = a; axis = 2; }
      if (b < tout) tout = b;
    }
    if (!(tin < tout) || tout <= 0 || tin > tMax) return false;
    visited++;
    if (k === 0){
      if (tin < 0) axis = -1;
      hit = { x, y, z, t: Math.max(tin, 0), axis, normal: axis < 0 ? 0 : -Math.sign(d[axis]) };
      return true;
    }
    for (let i = 0; i < 8; i++){
      const c = i ^ sign, ch = store.child(id, c);
      if (ch !== EMPTY && rec(ch, k - 1, 2 * x + (c & 1), 2 * y + (c >> 1 & 1), 2 * z + (c >> 2))) return true;
    }
    return false;
  };
  if (root !== EMPTY) rec(root, D, 0, 0, 0);
  if (stats) stats.visited = visited;
  return hit;
}

/* ---- which block a hit means ----------------------------------------------
   A target is { level, X, Y, Z }: a cell of its own level's grid.

   To break is to take out the block holding the voxel you hit. To place is to
   fill the block holding the voxel just past the face, which is empty since the
   ray came through it. A block larger than a voxel can therefore swallow what's
   already in its cell, and on a bumpy surface it won't sit flush: that's what
   snapping means when sizes mix (§11.1).

   An exact-edge entry is the one way that voxel can be solid, since the ray then
   came through a neighbour across the edge: the place changes nothing, and the
   log leaves it out.

   There's no block to place when the eye starts inside the voxel, because no
   face was crossed, or when the voxel past the face is outside the world. */
export const breakTarget = (hit, level) => ({ level, X: hit.x >> level, Y: hit.y >> level, Z: hit.z >> level });
export function placeTarget(hit, level, D){
  if (hit.axis < 0) return null;
  const v = [hit.x, hit.y, hit.z];
  v[hit.axis] += hit.normal;
  if (v[hit.axis] < 0 || v[hit.axis] >= 2 ** D) return null;
  return { level, X: v[0] >> level, Y: v[1] >> level, Z: v[2] >> level };
}
export function boxOf({ level, X, Y, Z }){
  const S = 2 ** level;
  return { lo: [X * S, Y * S, Z * S], hi: [(X + 1) * S, (Y + 1) * S, (Z + 1) * S] };
}
/* The box is closed: an eye exactly on a face is refused too, since the near
   plane would cut the new block anyway. */
export function enclosesEye(target, eye){
  const { lo, hi } = boxOf(target);
  for (let a = 0; a < 3; a++) if (eye[a] < lo[a] || eye[a] > hi[a]) return false;
  return true;
}

/* A reach of 128 × the block's side (§11.2): closer than 256 voxels a voxel lies
   in a chunk drawn at lod 0, so what you click is what's drawn, and a block of
   side s can hide a cell of side s, whose chunk is s times as far away. Only
   side 1 was measured; the scaling is an argument. */
export const REACH_PER_SIDE = 128;
export const reachOf = level => REACH_PER_SIDE * 2 ** level;

/* All of a frame's aim in one call: what a click would do, for the outline and
   for the click itself, so the two can't disagree. A place that would enclose
   the eye is refused, as Minecraft refuses a block on the player. */
export function aimAt(store, root, D, eye, dir, level){
  const hit = pick(store, root, D, eye, dir, { tMax: reachOf(level) });
  if (!hit) return null;
  const at = placeTarget(hit, level, D);
  return { hit, breakAt: breakTarget(hit, level), placeAt: at && !enclosesEye(at, eye) ? at : null };
}

/* What a click means when the pick misses (docs/edit-mode-log.md §3). Nothing, on
   a world with anything in it: a stray click at the sky shouldn't litter it. But
   an empty world has no face to place against, so its first block goes in the air,
   AIR_PER_SIDE block sides along the ray. §11.4 suggested a grid plane as well,
   which is a question of feel; this much lets you start.

   That's further than the block's diagonal, so the block can't hold the eye.
   Outside the world there's nothing to place. */
export const AIR_PER_SIDE = 16;
export function aimInAir(root, D, eye, dir, level){
  if (root !== EMPTY) return null;
  const l = Math.hypot(dir[0], dir[1], dir[2]);
  if (!(l > 0)) return null;
  const S = 2 ** level, t = AIR_PER_SIDE * S / l, cell = [0, 0, 0], side = 2 ** (D - level);
  for (let a = 0; a < 3; a++){
    cell[a] = Math.floor((eye[a] + dir[a] * t) / S);
    if (!(cell[a] >= 0 && cell[a] < side)) return null;
  }
  return { hit: null, breakAt: null, placeAt: { level, X: cell[0], Y: cell[1], Z: cell[2] } };
}

/* ---- what the page draws and when it repeats -------------------------------
   Blocks run from one voxel to side 64, a chunk (§11.7): past that the wheel would
   be choosing between things too big to aim. The palette is r | g << 8 | b << 16,
   the log's colours. */
export const MAX_BLOCK_LEVEL = 6;
export const PALETTE = [0xb5784f, 0x8c8c94, 0xd9c28f, 0x5f8f4e, 0x4f7fb5, 0xb54f4f, 0xe0b040, 0xe8e8e8]
  .map(rgb => (rgb >> 16 & 255) | (rgb & 0xff00) | (rgb & 255) << 16);

/* The edges of a box as an eye sees it, eye-relative, six floats an edge, for
   line drawing without a depth test: the ray pass writes no depth, so there's
   none to test against. So this does what a solid box would: an edge shows if a
   face next to it looks at the eye. 4 edges facing one face, 7 facing two, 9 facing
   three. An eye inside the box (you can break the voxel you're in) sees all 12.

   Each end is clipped to `near` along `fwd`, because an end behind the eye would
   divide by a negative w and throw its line across the screen. `lo` and `hi` are
   in doubles and the difference with the eye is taken here, so the float32 the GPU
   gets holds a small number at any depth. */
export function boxEdges(lo, hi, eye, fwd, near = 0){
  const rel = [[lo[0] - eye[0], lo[1] - eye[1], lo[2] - eye[2]], [hi[0] - eye[0], hi[1] - eye[1], hi[2] - eye[2]]];
  // faces[s][a]: does the low (s = 0) or high (s = 1) face of axis a look at the eye?
  const faces = [[0, 1, 2].map(a => rel[0][a] > 0), [0, 1, 2].map(a => rel[1][a] < 0)];
  const inside = ![0, 1, 2].some(a => faces[0][a] || faces[1][a]);
  const out = [], f = a => a[0] * fwd[0] + a[1] * fwd[1] + a[2] * fwd[2];
  for (let a = 0; a < 3; a++){
    const b = (a + 1) % 3, c = (a + 2) % 3;
    for (let sb = 0; sb < 2; sb++) for (let sc = 0; sc < 2; sc++){
      if (!inside && !faces[sb][b] && !faces[sc][c]) continue;
      let p = [0, 0, 0], q = [0, 0, 0];
      p[a] = rel[0][a]; q[a] = rel[1][a]; p[b] = q[b] = rel[sb][b]; p[c] = q[c] = rel[sc][c];
      const dp = f(p), dq = f(q);
      if (dp < near && dq < near) continue;
      if (dp < near || dq < near){
        const t = (near - dp) / (dq - dp), m = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
        if (dp < near) p = m; else q = m;
      }
      out.push(p[0], p[1], p[2], q[0], q[1], q[2]);
    }
  }
  return new Float32Array(out);
}

/* Holding a button repeats, at Minecraft's rate as I remember it (§11.1). A press
   acts at once, in its own event, and this only says when the next one is due. A
   long frame gets one repeat, not a burst of them: a stall shouldn't dig a hole. */
export const REPEAT_MS = 200;
export function createRepeat(interval = REPEAT_MS){
  const next = new Map();
  return {
    press(button, now){ next.set(button, now + interval); },
    release(button){ next.delete(button); },
    clear(){ next.clear(); },
    get held(){ return [...next.keys()]; },
    due(now){
      const out = [];
      for (const [button, at] of next) if (now >= at){
        out.push(button);
        next.set(button, now - at < interval ? at + interval : now + interval);
      }
      return out;
    },
  };
}

/* ---- the colour table -----------------------------------------------------
   Whose colour is this voxel? The latest block covering it, or else the world's
   field. A block's colour wins over whatever it swallows (§11.5).

   A grid of lists collapsed on packed single voxels: 714 µs a lookup with
   100,000 of them in 64³, because a miss scans its whole cell. A block needs no
   overlap test, being on its own grid, so a lookup is one hash probe per block
   size in use: 77 ns on that same case. An entry keeps its op's sequence number,
   so the latest wins across sizes. Open addressing over typed arrays, since this
   runs in every worker for every shown voxel.

   **Breaks don't enter it.** A voxel is solid after a break only if a later
   place filled it, and that place is the later op. So the table answers for
   every solid voxel without knowing about breaks, and they stay in the log only
   so the log can replay the root.

   **It only ever grows.** An entry overwrites the one before it on the same
   cell, so undo can't be done in place: the log is the truth, and an undo
   rebuilds this from the log (see `sync`). A rebuild of 100,000 ops is a few
   milliseconds, in a worker, and undo is rare (docs/edit-log.md). */
export function createBlockTable(){
  let cap = 1 << 12, keys = new Int32Array(cap * 4).fill(-1), vals = new Int32Array(cap * 2);
  let used = 0, seen = 0, epoch = 0, hit = -1;
  const sizes = [];
  const slot = (l, X, Y, Z) => {
    let h = Math.imul(X, 73856093) ^ Math.imul(Y, 19349663) ^ Math.imul(Z, 83492791) ^ Math.imul(l, 2654435761);
    h = (h ^ (h >>> 15)) & (cap - 1);
    for (;; h = (h + 1) & (cap - 1)){
      const i = h * 4;
      if (keys[i] === -1 || (keys[i] === l && keys[i + 1] === X && keys[i + 2] === Y && keys[i + 3] === Z)) return h;
    }
  };
  const put = (l, X, Y, Z, colour, seq) => {
    const h = slot(l, X, Y, Z);
    if (keys[h * 4] === -1){ keys[h * 4] = l; keys[h * 4 + 1] = X; keys[h * 4 + 2] = Y; keys[h * 4 + 3] = Z; used++; }
    vals[h * 2] = seq; vals[h * 2 + 1] = colour;
  };
  const add = (l, X, Y, Z, colour, seq) => {
    if (!sizes.includes(l)) sizes.push(l);
    if ((used + 1) * 2 > cap){
      const k0 = keys, v0 = vals, c0 = cap;
      cap *= 2; keys = new Int32Array(cap * 4).fill(-1); vals = new Int32Array(cap * 2); used = 0;
      for (let h = 0; h < c0; h++) if (k0[h * 4] !== -1) put(k0[h * 4], k0[h * 4 + 1], k0[h * 4 + 2], k0[h * 4 + 3], v0[h * 2 + 1], v0[h * 2]);
    }
    put(l, X, Y, Z, colour, seq);
  };
  return {
    add,
    /* The colour at a point, or −1 if no block covers it. Points are floats
       because that's what a field gets: a voxel's centre, or a coarse cell's.
       `seq` is then the answer's op number (−1 with none), which the one log's
       field (log-core.js) weighs against the drops' (docs/onelog-plan.md §3). */
    lookup(x, y, z){
      hit = -1;
      if (!sizes.length) return -1;
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      let best = -1, colour = -1;
      for (let n = 0; n < sizes.length; n++){
        const l = sizes[n], h = slot(l, xi >> l, yi >> l, zi >> l);
        if (keys[h * 4] !== -1 && vals[h * 2] > best){ best = vals[h * 2]; colour = vals[h * 2 + 1]; }
      }
      hit = best;
      return colour;
    },
    get seq(){ return hit; },
    /* Take a log's delta (createEditLog's `delta`). A new epoch means ops were
       undone: start over. The delta has to start where this table stopped, or
       ops have been lost, and a table quietly missing an op draws the wrong
       colour until something else repaints that chunk. So it throws. */
    sync({ epoch: e, from, count, ops }){
      if (e !== epoch){
        if (from !== 0) throw new Error(`table.sync: a new epoch has to start at op 0, not ${from}`);
        cap = 1 << 12; keys = new Int32Array(cap * 4).fill(-1); vals = new Int32Array(cap * 2);
        used = 0; sizes.length = 0; epoch = e;
      } else if (from !== seen) throw new Error(`table.sync: this table has ${seen} ops, the delta starts at ${from}`);
      for (let i = 0, s = from; s < count; s++, i += OP_WORDS)
        if (ops[i + 4] !== BREAK) add(ops[i], ops[i + 1], ops[i + 2], ops[i + 3], ops[i + 4], s);
      seen = count;
    },
    get seen(){ return seen; }, get epoch(){ return epoch; },
    get used(){ return used; }, get sizes(){ return sizes.slice(); },
    bytes: () => keys.byteLength + vals.byteLength,
  };
}

/* A world's colour field with the blocks over it. */
// The sample's level (chunk-core's cellAttr) goes through to the base untouched.
export const editedField = (base, table) => (x, y, z, level) => {
  const c = table.lookup(x, y, z);
  return c >= 0 ? c : base(x, y, z, level);
};

/* ---- the log --------------------------------------------------------------
   Every op in order: the truth. The root is what the ops made, so replay gets it
   back, and the colour table is an index over the same ops. An undo step is
   (root, op count), with the root at op n in `roots[n]`.

   Five int32 words an op: level, X, Y, Z, colour (r | g << 8 | b << 16, attr-core's
   rgb8, or BREAK). They're plain words so a worker can take them as a buffer, and
   so step 9 can write them to a file.

   **A click that changes no voxel isn't an op.** It has nothing to undo, and it
   would leave a step that looks like nothing happened. It keeps the redo steps
   too. So a block placed over solid ground can't recolour it, by decision: use a
   brush for that when they exist. (Confirmed 2026-11-05. A paint tool was
   considered and isn't wanted for now, so nothing here anticipates one.)

   **Each step hands back what the view needs**: null if nothing changed, or
   { paint }, the blocks whose colour may now read differently, for the streamer's
   setRoot (stream-core.js). A place paints its block. A break paints nothing,
   because breaks aren't in the colour table, so no solid voxel's colour moves. Undo
   and redo of a place paint its block, since the table loses or regains it. Why
   this can't be read off the root is the colour trap above: place red, break, place
   blue gives back the same id with a different colour.

   A held root keeps its nodes reachable only for as long as nobody prunes the
   store. Nothing here prunes, and whoever does has to carry `roots` through it.

   **The epoch is there because a count isn't enough.** Undo, then a different
   place, leaves the same count with a different op on the end. A worker comparing
   counts would keep the old colour, and only for that one block. Every undo starts
   a new epoch, and a table seeing a new epoch rebuilds. Redo needs no epoch: it
   appends what was there. */
export const OP_WORDS = 5, BREAK = -1;
export function createEditLog(base){
  let cap = 256, ops = new Int32Array(cap * OP_WORDS), roots = new Uint32Array(cap + 1);
  let n = 0, top = 0, epoch = 0;
  roots[0] = base;
  const push = (root, level, X, Y, Z, colour) => {
    if (n === cap){
      const o2 = new Int32Array(cap * 2 * OP_WORDS), r2 = new Uint32Array(cap * 2 + 1);
      o2.set(ops); r2.set(roots); ops = o2; roots = r2; cap *= 2;
    }
    const i = n * OP_WORDS;
    ops[i] = level; ops[i + 1] = X; ops[i + 2] = Y; ops[i + 3] = Z; ops[i + 4] = colour;
    roots[++n] = root;
    top = n;     // a new op ends the redo branch
  };
  const apply = (store, D, { level, X, Y, Z }, colour) => {
    const root = roots[n], out = place(store, root, D, level, X, Y, Z, colour === BREAK ? EMPTY : store.solid(level));
    if (out === root) return null;
    push(out, level, X, Y, Z, colour);
    return paintOf(n - 1);
  };
  const paintOf = i => {
    const j = i * OP_WORDS;
    return { paint: ops[j + 4] === BREAK ? [] : [{ level: ops[j], X: ops[j + 1], Y: ops[j + 2], Z: ops[j + 3] }] };
  };
  return {
    /* Each returns null if the click changed nothing, or what setRoot needs. */
    place(store, D, target, colour){
      if (!Number.isInteger(colour) || colour < 0 || colour > 0xffffff) throw new RangeError(`log.place: colour ${colour} isn't r | g << 8 | b << 16`);
      return apply(store, D, target, colour);
    },
    erase: (store, D, target) => apply(store, D, target, BREAK),
    undo(){ if (!n) return null; n--; epoch++; return paintOf(n); },
    redo(){ if (n === top) return null; n++; return paintOf(n - 1); },
    get root(){ return roots[n]; }, get count(){ return n; }, get epoch(){ return epoch; },
    get canUndo(){ return n > 0; }, get canRedo(){ return n < top; },
    rootAt: i => roots[i],
    /* What a table that has seen `seen` ops at `seenEpoch` still needs, as a
       copy it can be posted. The whole log if the epoch has moved on. */
    delta(seenEpoch = -1, seen = 0){
      const from = seenEpoch === epoch ? seen : 0;
      return { epoch, from, count: n, ops: ops.slice(from * OP_WORDS, n * OP_WORDS) };
    },
    /* All the ops so far, not a copy: for replay and for files. */
    ops: () => ops.subarray(0, n * OP_WORDS),
  };
}

/* The root that `count` ops make from `base`. Equal to the log's root by
   hash-consing, in any store: the log really does hold everything. */
export function replay(store, D, base, ops, count = ops.length / OP_WORDS){
  let root = base;
  for (let i = 0; i < count; i++){
    const j = i * OP_WORDS, l = ops[j];
    root = place(store, root, D, l, ops[j + 1], ops[j + 2], ops[j + 3], ops[j + 4] === BREAK ? EMPTY : store.solid(l));
  }
  return root;
}
