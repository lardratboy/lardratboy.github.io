/* =====================================================================
   SCENE CORE: worlds placed in a world (docs/scenegraph.md §11,
   docs/scene-plan.md). Pure: imports dag-core.js, actor-core.js and
   attr-core.js's rgb8 only, no DOM, no gl, so it runs in Node, a worker or
   the page.

   Promoted from experiments/scene-sketch.mjs (round 3, 2026-11-10: "place
   a knight, or any .vdag, in the kit world"). The sketch's code, minus its
   mutant switches; test/scene-core.test.js is its oracle, and breaks this
   file's text for the mutants instead.

   A *placement* puts a child world ({ store, root, D }) into a parent:
     at      the child's cube corner, in whole parent voxels. Any integer,
             so it may hang off the parent's edge. Whole voxels because a
             baked child is part of a DAG, which has no fraction of a
             voxel; 1/256 is for overlays that move (scenegraph §11.4).
     turn    one of dag-core's Oh elements (e >> 3 the permutation, e & 7
             the flips), the turn store.transform and rotateOcc make. The
             viewer offers the 24 proper ones.
     scale   2^scale parent voxels a child voxel. Up lifts every node;
             down is the *any* rule (a parent voxel is solid if any child
             voxel under it is), which is the lod rule 'any'.
   Order: turn the child's cube about its centre, scale it, then move it.
   Turns and scales commute, so those two can go either way.

   Two ways to put a placement in a world, which must agree:
     bakeScene       the child merged into the parent's DAG (§11.0 Q2:
                     static children are baked). What the viewer's drop is.
     compositeWorld  the parent's DAG untouched, actor-core's three
                     questions (solid, room, fill) answered by the parent
                     and every child whose bounds meet the box, each in its
                     own frame. What an overlay that moves will be.
   They share nothing but boxHits and the store's child(), so each holds the
   other: fliers on the composite must move byte for byte as on the bake,
   and the bake must be a dense stamp's root id.

   And one way to colour a baked scene, sceneField (step 2, at the end):
   each voxel takes the latest placement solid there, asked in its own
   frame, else the parent's field.

   And the road a drop takes to the workers (step 3): createSceneLog holds
   the drops as an edit log holds blocks (root, undo, redo, a paint for
   setRoot, an epoch, a delta), and createSceneTable is a worker's copy of
   it, which builds the scene field. stream-core's tailer and runner carry
   one to the other.

   And where a drop lands (step 4, at the very end): dropAt puts a child's
   box against the face the crosshair hits, snapRef says which copy a snap
   to 16 is relative to, and Y_TURNS are the four turns the viewer offers.
   The page only aims and draws.

   What this costs (§11.1, the knight at D = 8 in the D = 12 kit, one JS
   thread): a knight off the grid bakes in about 0.1 s, a ×4 giant in 0.5 s,
   and an aligned repeat almost nothing, because of the place memo below.
   Collision through the composite is 1.3× the baked world (§11.2).
   ===================================================================== */
import { prune, EMPTY, FULL, FIRST_NODE } from './dag-core.js';
import { dagWorld, boxHits, fillBox } from './actor-core.js';
import { rgb8 } from './attr-core.js';

/* ---- the Oh encoding, read for boxes --------------------------------------
   dag-core's: a turned child's axis i is its source's axis P[i], flipped
   about the cube's centre if bit i of e is set (rotateOcc's map). */
const PERM = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

/* ---- solid nodes ----------------------------------------------------------
   A solid node has eight equal children, each solid, down to FULL. A store
   that interns can be asked directly. **The trap:** store.solid(level)
   interns the solid node if there isn't one yet, so asking a real store
   can grow it. That's harmless, since a tail ships it like any new node, but
   it means nothing here is read-only on a real store. A storeView (a file's
   world, a shelf world) can't intern, so it's walked, memoized: dag-core's
   isFull, minus the count. */
const solidMemo = new WeakMap();
export function isSolidId(store, id){
  if (id === FULL) return true;
  if (id === EMPTY) return false;
  if (store.solid) return store.solid(store.levelOf(id)) === id;
  let m = solidMemo.get(store);
  if (!m) solidMemo.set(store, m = new Map());
  let r = m.get(id);
  if (r !== undefined) return r;
  const c = store.child(id, 0);
  r = true;
  for (let o = 1; o < 8 && r; o++) if (store.child(id, o) !== c) r = false;
  r = r && isSolidId(store, c);
  m.set(id, r);
  return r;
}

/* The box [lo, hi) holding every solid voxel of a world, or null if it's
   empty. A node already inside the box found so far is skipped, so this
   reads the content's outer layer, not all of it. */
export function contentBox(store, root, D){
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const walk = (id, k, x, y, z) => {
    if (id === EMPTY) return;
    const s = 2 ** k;
    if (x >= lo[0] && y >= lo[1] && z >= lo[2] && x + s <= hi[0] && y + s <= hi[1] && z + s <= hi[2]) return;
    if (isSolidId(store, id)){
      lo[0] = Math.min(lo[0], x); lo[1] = Math.min(lo[1], y); lo[2] = Math.min(lo[2], z);
      hi[0] = Math.max(hi[0], x + s); hi[1] = Math.max(hi[1], y + s); hi[2] = Math.max(hi[2], z + s);
      return;
    }
    const h = s / 2;
    for (let o = 0; o < 8; o++) walk(store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
  };
  walk(root, D, 0, 0, 0);
  return lo[0] <= hi[0] ? { lo, hi } : null;
}

/* ---- checks ---------------------------------------------------------------- */
function checkPlacement(p, D, needAt = true){
  const w = p.world;
  if (!w || !Number.isInteger(w.D) || w.D < 0) throw new Error('scene: a placement needs a world { store, root, D }');
  const s = p.scale ?? 0, e = p.turn ?? 0;
  if (!Number.isInteger(s) || -s > w.D) throw new RangeError(`scene: scale ${s} for a world of D = ${w.D} (at least −${w.D})`);
  if (D !== undefined && w.D + s > D) throw new RangeError(`scene: a child of D = ${w.D} at scale ${s} is larger than its parent (D = ${D})`);
  if (!Number.isInteger(e) || e < 0 || e > 47) throw new RangeError(`scene: turn ${e} isn't one of the 48 (dag-core's Oh encoding)`);
  if (needAt && !(Array.isArray(p.at) && p.at.length === 3 && p.at.every(Number.isInteger))) throw new RangeError(`scene: at ${p.at} isn't three whole voxels`);
}

/* ---- bake -------------------------------------------------------------------
   The child's nodes in the parent's store: its own keys, pruned to what its
   root (and its skin's root, if it has baked colour) reaches, then imported.
   Memoized per (parent store, child store, root). The sketch pruned and
   imported on every bake, which was O(the child's nodes) each time a knight
   was dropped; now the tenth knight costs nothing to import. Returns
   { root, skin }, both as the parent's ids (skin EMPTY when there's none). */
const importMemo = new WeakMap();
export function importWorld(store, world){
  let byStore = importMemo.get(store);
  if (!byStore) importMemo.set(store, byStore = new WeakMap());
  let m = byStore.get(world.store);
  if (!m) byStore.set(world.store, m = new Map());
  const skin = world.skin ?? EMPTY, key = world.root * 67108864 + skin;
  const hit = m.get(key);
  if (hit) return hit;
  const { keys, map } = prune(world.store.snapshot().keys, skin === EMPTY ? [world.root] : [world.root, skin]);
  const ids = store.importKeys(keys), out = { root: ids[map[world.root]], skin: skin === EMPTY ? EMPTY : ids[map[skin]] };
  m.set(key, out);
  return out;
}

/* Scaled up by 2^s: every node s levels higher, every voxel a solid level-s
   node. Memoized per node, so it costs the child's node count. The result
   is hash-consed like anything else: a lifted solid is solid(k + s), which
   is why a knight four times taller costs one node more than the knight
   (§11.1). */
function lift(store, id, s, memo){
  if (id === EMPTY) return EMPTY;
  if (id === FULL) return store.solid(s);
  let r = memo.get(id);
  if (r !== undefined) return r;
  const ch = new Uint32Array(8);
  for (let o = 0; o < 8; o++) ch[o] = lift(store, store.child(id, o), s, memo);
  r = store.intern(store.levelOf(id) + s, ch);
  memo.set(id, r);
  return r;
}
/* Scaled down by 2^t, by the *any* rule: a node t levels above the voxels
   becomes one voxel, solid if anything is under it. chunk-core's 'any' at
   lod t, as a DAG. ½ keeps 29% of the knight's nodes, ¼ keeps 8%. */
function coarsen(store, id, l, t, memo){
  if (id === EMPTY) return EMPTY;
  if (l === t) return FULL;
  let r = memo.get(id);
  if (r !== undefined) return r;
  const ch = new Uint32Array(8);
  for (let o = 0; o < 8; o++) ch[o] = coarsen(store, store.child(id, o), l - 1, t, memo);
  r = store.intern(l - t, ch);
  memo.set(id, r);
  return r;
}
// Every voxel of node ∩ box solid (the box's part outside the node doesn't count).
function boxFull(store, id, k, x, y, z, lo, hi){
  const s = 2 ** k;
  if (x >= hi[0] || y >= hi[1] || z >= hi[2] || x + s <= lo[0] || y + s <= lo[1] || z + s <= lo[2]) return true;
  if (id === EMPTY) return false;
  if (isSolidId(store, id)) return true;
  const h = s / 2;
  for (let o = 0; o < 8; o++)
    if (!boxFull(store, store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h, lo, hi)) return false;
  return true;
}
// The level-k node of T (level Dc) whose corner is P.
function nodeAt(store, T, Dc, P, k){
  let id = T;
  for (let l = Dc; l > k && id >= FIRST_NODE; l--){
    const b = l - 1;
    id = store.child(id, (P[0] >> b & 1) | (P[1] >> b & 1) << 1 | (P[2] >> b & 1) << 2);
  }
  return id;
}
// The smallest node of T holding the box [lo, hi) (inside T's cube), and its corner.
const ENC = { id: 0, k: 0, x: 0, y: 0, z: 0 };
function enclosing(store, T, Dc, lo, hi){
  let id = T, k = Dc, x = 0, y = 0, z = 0;
  while (k > 0 && id >= FIRST_NODE && !isSolidId(store, id)){
    const h = 2 ** (k - 1), c0 = x + h, c1 = y + h, c2 = z + h;
    const o0 = lo[0] >= c0 ? 1 : hi[0] <= c0 ? 0 : -1, o1 = lo[1] >= c1 ? 1 : hi[1] <= c1 ? 0 : -1, o2 = lo[2] >= c2 ? 1 : hi[2] <= c2 ? 0 : -1;
    if (o0 < 0 || o1 < 0 || o2 < 0) break;
    id = store.child(id, o0 | o1 << 1 | o2 << 2);
    x += o0 * h; y += o1 * h; z += o2 * h; k--;
  }
  ENC.id = id; ENC.k = k; ENC.x = x; ENC.y = y; ENC.z = z;
  return ENC;
}

/* T (level Dc, already turned and scaled, in `store`) with its corner at
   `at`, as a level-Dp root. Top down over the parent's nodes:
     - a node the child's cube doesn't reach is EMPTY;
     - one that lands exactly on a child node (inside the cube, its corner a
       multiple of its side from `at`) *is* that node, which is the whole of
       §3.1's sharing;
     - one the child has nothing in is EMPTY, one it fills is solid;
     - anything else is split.
   At level 0 every voxel is the second case, so nothing is left undecided.

   No "not clipped" test on the aligned case: a node aligned to its side
   from `at`, at a level no higher than the child's, can't be cut by the
   cube's edge, since the cube's side is a multiple of its side. The sketch
   had the test, and its mutant was the one nothing caught.

   **The place memo.** A node's answer depends only on (T, its level, its
   corner relative to the child), never on the parent, so it's memoized on
   that, per store: 64 knights 256 apart cut the same nodes, and the second
   one reads them all. Without it, 64 aligned knights took 4.5 s to bake,
   70 ms each, all of it rebuilding what the first had made; with it, 0.2 s.
   It grows with every distinct cut. That's harmless to correctness, since an
   id never changes meaning, but step 5 counted it (docs/scene-log.md §5.3):
   one knight (D = 8) off the grid in the D = 14 kit was 341,513 entries, 67%
   of them level 0 and 24% level 1, and the D = 10 knight 5.6 million. A Map
   holds 2^24, so the fiftieth knight, or the third large one, would have
   thrown. Two limits, in PLACE_MEMO:
   - **floor**: levels below it aren't memoized. A level-0 node is always
     aligned, so its entry only ever repeated nodeAt. A level-1 entry serves
     a copy whose offset from an earlier one is 2 mod 4 and nothing coarser,
     which then rebuilds its level-1 nodes as an unaligned copy does. With
     the floor at 2 the knight is 30,617 entries.
   - **max**: at that size the memo is emptied, mid-bake if need be: every
     entry is only an id that can be found again. */
const placeMemo = new WeakMap();
export const PLACE_MEMO = { floor: 2, max: 2 ** 22 };
// How many cuts the place memo holds for this store (the HUD's edit line).
export const placeMemoSize = store => placeMemo.get(store)?.size ?? 0;
function placeRoot(store, T, Dc, at, Dp){
  const side = 2 ** Dc, lo = [0, 0, 0], hi = [0, 0, 0], P = [0, 0, 0];
  let memo = placeMemo.get(store);
  if (!memo) placeMemo.set(store, memo = new Map());
  const rec = (k, x, y, z) => {
    const s = 2 ** k;
    P[0] = x - at[0]; P[1] = y - at[1]; P[2] = z - at[2];
    if (k < PLACE_MEMO.floor) return recNode(k, x, y, z, s);
    const key = `${T}|${k}|${P[0]}|${P[1]}|${P[2]}`, hit = memo.get(key);
    if (hit !== undefined) return hit;
    const r = recNode(k, x, y, z, s);
    if (memo.size >= PLACE_MEMO.max) memo.clear();
    memo.set(key, r);
    return r;
  };
  const recNode = (k, x, y, z, s) => {
    let clipped = false;
    for (let a = 0; a < 3; a++){
      lo[a] = Math.max(0, P[a]); hi[a] = Math.min(side, P[a] + s);
      if (lo[a] >= hi[a]) return EMPTY;
      if (lo[a] !== P[a] || hi[a] !== P[a] + s) clipped = true;
    }
    if (k <= Dc && P[0] % s === 0 && P[1] % s === 0 && P[2] % s === 0) return nodeAt(store, T, Dc, P, k);
    // Both probes start at the smallest child node holding the box, not at
    // the root: that cut the 64 unaligned knights' bake from 26 s to 16 s
    // (the memo above took it to 6).
    const e = enclosing(store, T, Dc, lo, hi);
    if (!boxHits(store, e.id, e.k, e.x, e.y, e.z, lo, hi)) return EMPTY;
    if (!clipped && boxFull(store, e.id, e.k, e.x, e.y, e.z, lo, hi)) return store.solid(k);
    const h = s / 2, ch = new Uint32Array(8);
    for (let o = 0; o < 8; o++) ch[o] = rec(k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
    return store.intern(k, ch);
  };
  return rec(Dp, 0, 0, 0);
}

/* The child, scaled and turned, in the parent's store: what placeRoot takes.
   Memoized per (store, imported root, scale, turn), so a repeat drop of the
   same world the same way lifts or coarsens nothing. */
const preparedMemo = new WeakMap();
export function prepared(store, p){
  checkPlacement(p, undefined, false);      // no `at`: the prepared child doesn't depend on it
  const { root } = importWorld(store, p.world), D = p.world.D, s = p.scale ?? 0, e = p.turn ?? 0;
  let m = preparedMemo.get(store);
  if (!m) preparedMemo.set(store, m = new Map());
  const key = `${root}|${s}|${e}`, hit = m.get(key);
  if (hit) return hit;
  let id = root;
  if (s > 0) id = lift(store, id, s, new Map());
  if (s < 0) id = coarsen(store, id, D, -s, new Map());
  const out = { id: store.transform(id, e), D: D + s };
  m.set(key, out);
  return out;
}

/* The scene as one world: `root` (level D, in `store`, which must intern)
   with every placement unioned in, in order. Returns the new root. A
   placement that adds nothing (inside solid rock) gives the root back. */
export function bakeScene(store, root, D, placements){
  if (typeof store.intern !== 'function') throw new Error('bakeScene: the parent\'s store must intern (a storeView can\'t: import its keys into a createStore first)');
  for (const p of placements){
    checkPlacement(p, D);
    const c = prepared(store, p);
    root = store.union(root, placeRoot(store, c.id, c.D, p.at, D));
  }
  return root;
}

/* ---- overlay: the composite world ---------------------------------------------
   actor-core's world, { D, side, solid, room, fill }, made of a parent and
   children asked in their own frames. A box of parent voxels maps to the
   child's voxels exactly:
     1. minus `at`;
     2. divided by 2^scale (floor the low corner, ceil the high one, since a
        child voxel covers 2^scale parent voxels and the box touches every
        one it overlaps), or multiplied by 2^−scale;
     3. clipped to the child's cube;
     4. back through the turn (axis i of the turned box is the source's axis
        P[i], flipped about the centre if bit i is set).
   Every step is integer, so nothing is approximated, and a turn costs
   nothing: only the box is turned, never the child.

   **Outside a child is the parent's space**: only the parent's edge is
   solid (scenegraph §2's trap; its mutant is in the test). Each child is
   tested by its content's bounds in the parent's frame first, a flat list:
   fine to a few hundred children, 3× at 1,024 (§11.2), where a grid of
   bounds (actor-core's buildGrid is one) would be the fix. */
export function childFrame(p){
  checkPlacement(p);
  const { store, root, D } = p.world, s = p.scale ?? 0, e = p.turn ?? 0, R = 2 ** D;
  const P = PERM[e >> 3], fl = [e & 1, e >> 1 & 1, e >> 2 & 1];
  const box = contentBox(store, root, D);
  const lo = [0, 0, 0], hi = [0, 0, 0];
  if (box) for (let i = 0; i < 3; i++){
    // The content's box, turned, scaled, moved: the bounds every probe tests first.
    const a = fl[i] ? R - box.hi[P[i]] : box.lo[P[i]], b = fl[i] ? R - box.lo[P[i]] : box.hi[P[i]];
    lo[i] = p.at[i] + (s >= 0 ? a * 2 ** s : Math.floor(a / 2 ** -s));
    hi[i] = p.at[i] + (s >= 0 ? b * 2 ** s : Math.ceil(b / 2 ** -s));
  }
  const cube = [0, 1, 2].map(i => [p.at[i], p.at[i] + 2 ** (D + s)]);
  return { store, root, D, R, s, P, fl, at: p.at, lo, hi, cube, empty: !box, world: dagWorld(store, root, D) };
}
const meets = (c, lo, hi) => !c.empty && lo[0] < c.hi[0] && hi[0] > c.lo[0] && lo[1] < c.hi[1] && hi[1] > c.lo[1] && lo[2] < c.hi[2] && hi[2] > c.lo[2];
// The parent box [lo, hi) in child c's own voxels, into clo/chi; false if it misses the cube.
const TLO = [0, 0, 0], THI = [0, 0, 0];
function toChild(c, lo, hi, clo, chi){
  for (let i = 0; i < 3; i++){
    const a = lo[i] - c.at[i], b = hi[i] - c.at[i];
    let p = c.s >= 0 ? Math.floor(a / 2 ** c.s) : a * 2 ** -c.s;
    let q = c.s >= 0 ? Math.ceil(b / 2 ** c.s) : b * 2 ** -c.s;
    p = Math.max(0, p); q = Math.min(c.R, q);
    if (p >= q) return false;
    TLO[i] = p; THI[i] = q;
  }
  for (let i = 0; i < 3; i++){
    const j = c.P[i], k = i;
    if (c.fl[k]){ clo[j] = c.R - THI[k]; chi[j] = c.R - TLO[k]; } else { clo[j] = TLO[k]; chi[j] = THI[k]; }
  }
  return true;
}
/* parent   { store, root, D }, the world the children are placed in
   stats    { touch: [none, one, more] }, counted per solid() probe */
export function compositeWorld(parent, placements, { stats = null } = {}){
  const base = dagWorld(parent.store, parent.root, parent.D), side = base.side;
  const kids = placements.map(childFrame);
  const clo = [0, 0, 0], chi = [0, 0, 0];
  const hitsChild = (c, lo, hi) => toChild(c, lo, hi, clo, chi) && boxHits(c.store, c.root, c.D, 0, 0, 0, clo, chi);
  const near = (lo, hi) => {
    const out = [];
    for (const c of kids) if (meets(c, lo, hi)) out.push(c);
    return out;
  };
  function solid(lo, hi){
    for (let a = 0; a < 3; a++) if (lo[a] < 0 || hi[a] > side) return true;
    const touch = near(lo, hi);
    if (stats) stats.touch[Math.min(2, touch.length)]++;
    if (boxHits(parent.store, parent.root, parent.D, 0, 0, 0, lo, hi)) return true;
    for (const c of touch) if (hitsChild(c, lo, hi)) return true;
    return false;
  }
  /* The parent's room, cut by the children it meets. A room needn't be an
     aligned node, only an empty box holding the actor's (actor-core's inRoom
     tests containment and nothing else), so:
       - a child whose bounds the actor's box is in gives its own room round
         the box, mapped into the parent's frame (child-frame rooms are where
         a flier among the knights lives), and the room is the intersection;
       - a child whose bounds miss the box is cut off at the face of its
         bounds that keeps the most of the room.
     The room only ever shrinks, so a child passed over early never meets it
     later. The first version only halved the parent's room away from the
     children's bounds: fliers round the knights saved 11 probes a tick of
     298 that way, against 97 of 213 baked (§11.2). */
  const rl = [0, 0, 0], rh = [0, 0, 0], ml = [0, 0, 0], mh = [0, 0, 0];
  const none = (out, o) => { out[o] = 1; out[o + 3] = 0; };
  function room(lo, hi, out, o){
    base.room(lo, hi, out, o);
    if (out[o] > out[o + 3]) return;
    for (let a = 0; a < 3; a++){ rl[a] = out[o + a]; rh[a] = out[o + 3 + a]; }
    for (const c of kids){
      if (!meets(c, rl, rh)) continue;
      if (meets(c, lo, hi)){
        if (!childRoom(c, lo, hi, ml, mh)) return none(out, o);
        for (let a = 0; a < 3; a++){ rl[a] = Math.max(rl[a], ml[a]); rh[a] = Math.min(rh[a], mh[a]); }
        continue;
      }
      let best = -1, ax = 0, up = 0;
      for (let a = 0; a < 3; a++){
        const keep = (rh[0] - rl[0]) * (rh[1] - rl[1]) * (rh[2] - rl[2]) / (rh[a] - rl[a]);
        if (hi[a] <= c.lo[a] && keep * (c.lo[a] - rl[a]) > best){ best = keep * (c.lo[a] - rl[a]); ax = a; up = 0; }
        if (lo[a] >= c.hi[a] && keep * (rh[a] - c.hi[a]) > best){ best = keep * (rh[a] - c.hi[a]); ax = a; up = 1; }
      }
      if (up) rl[ax] = c.hi[ax]; else rh[ax] = c.lo[ax];
    }
    for (let a = 0; a < 3; a++){ out[o + a] = rl[a]; out[o + 3 + a] = rh[a]; }
  }
  /* Child c's room round the parent box [lo, hi), in parent voxels, into
     ml/mh; false if there's none (the box sticks out of the child's cube, or
     the child has no empty node round it). The child's room is an empty node
     of its own; forward through the turn, then scaled. Down, it's rounded
     *in*, since a parent voxel is solid if any child voxel under it is, but
     the rounding never moves anything: the room holds the box, which is a
     whole number of parent voxels, 2^t child voxels each, so the room, an
     aligned node, is at least 2^t on a side and its corners divide exactly.
     (Its mutant, rounding out, was the second one nothing caught in the
     sketch: it's equivalent, so it isn't in the test.) */
  const CR = new Int32Array(6);
  function childRoom(c, lo, hi, ml, mh){
    for (let i = 0; i < 3; i++) if (lo[i] < c.cube[i][0] || hi[i] > c.cube[i][1]) return false;
    if (!toChild(c, lo, hi, clo, chi)) return false;
    c.world.room(clo, chi, CR, 0);
    if (CR[0] > CR[3]) return false;
    for (let i = 0; i < 3; i++){
      const j = c.P[i];
      let a = c.fl[i] ? c.R - CR[3 + j] : CR[j], b = c.fl[i] ? c.R - CR[j] : CR[3 + j];
      if (c.s >= 0){ a *= 2 ** c.s; b *= 2 ** c.s; }
      else { a = Math.ceil(a / 2 ** -c.s); b = Math.floor(b / 2 ** -c.s); }
      ml[i] = a + c.at[i]; mh[i] = b + c.at[i];
    }
    return true;
  }
  /* The parent's fill, then each child's solid nodes inside the box, walked
     in the child's own frame and mapped forward (turned, scaled with the
     *any* rule's outward rounding, moved) into the grid. The first version
     asked the child one voxel at a time, and the walking knight's trap
     floods took 12 s of a --quick flight that takes 0.3 s standing (§11.3). */
  function fill(lo, hi){
    const out = base.fill(lo, hi), a = [0, 0, 0], b = [0, 0, 0];
    for (const c of near(lo, hi)){
      if (!toChild(c, lo, hi, clo, chi)) continue;
      const cl = clo.slice(), ch = chi.slice();
      const walk = (id, k, x, y, z) => {
        if (id === EMPTY) return;
        const s = 2 ** k;
        if (x >= ch[0] || y >= ch[1] || z >= ch[2] || x + s <= cl[0] || y + s <= cl[1] || z + s <= cl[2]) return;
        if (isSolidId(c.store, id)){
          const v0 = [x, y, z];
          for (let i = 0; i < 3; i++){
            const src = v0[c.P[i]];
            let p = c.fl[i] ? c.R - (src + s) : src, q = c.fl[i] ? c.R - src : src + s;
            if (c.s >= 0){ p *= 2 ** c.s; q *= 2 ** c.s; } else { p = Math.floor(p / 2 ** -c.s); q = Math.ceil(q / 2 ** -c.s); }
            a[i] = p + c.at[i]; b[i] = q + c.at[i];
          }
          fillBox(out, lo, hi, a, b);
          return;
        }
        const h = s / 2;
        for (let o = 0; o < 8; o++) walk(c.store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
      };
      walk(c.root, c.D, 0, 0, 0);
    }
    return out;
  }
  return { D: parent.D, side, root: parent.root, solid, room, fill, kids };
}


/* ---- colour: the scene field (docs/scene-plan.md §1.6, step 2) ---------------
   Ids can't see colour: a knight dropped where the kit was already solid
   leaves the kit's node as it was, and the voxel is the knight's now. So a
   baked scene's colour is a field over its placements:

     sceneField(store, base, list)   list: [{ T, D, at, turn, scale, colour }]
       T       the prepared child (prepared(store, p).id): the child turned
               and scaled, level D + scale, in `store`, the parent's store
       D       the child's own depth; at, turn, scale as in a placement
       colour  the child's field in its own frame, or null for a child with
               no colour (a shape-only file), which draws in the base's
               colours. A baked child's field is createBaked over `store`
               with its imported skin (importWorld's `skin`), so its words
               are read through the parent's ids
       base    the parent's field

   Asked for the centre (x, y, z) of a level-l parent cell (chunk-core's
   cellAttr passes the level; a field asked without one takes 0, a voxel):
     1. **The owner** is the latest placement whose placed shape has a solid
        voxel in the cell: content bounds first, then boxHits on T at `at`.
        Bounds alone would be wrong, since a kit voxel inside the knight's
        box but outside the knight would take the knight's colour. At l = 0
        it's "solid at this voxel"; for a coarse sub-cell half kit and half
        knight, the knight wins, as the latest op wins.
     2. **The child's cell.** A level-l parent cell is a level l − scale child
        cell, at least a voxel and at most the whole child (lc). At an `at`
        the cell's side doesn't divide, the parent cell straddles child
        cells; it takes the one holding its centre, on the placed child's own
        grid (clamped into the cube: a coarse cell can hang over the cube's
        edge with its centre outside). Then back through the turn: the
        placed axis i is the source's axis P[i], flipped if bit i is set.
        Cells map to cells under every Oh element, so this is exact.
     3. **Ask the child** for that cell: a baked child for its exact skin mean
        (`mean`, with its own fallback), a named one at the cell's centre,
        with lc as the level, so a scene can be a child of a scene.
   No owner: the base, at the point, with the level.

   What's exact. A placed baked child at scale 0 and lod 0 gives its own
   words (a skin voxel's mean is its word). Coarse and scaled-down cells get
   the exact skin mean of the child cell, rounded to 8 bits here (a field
   returns rgb8): half an 8-bit step at most before cellAttr's mean and its
   one 6-bit quantization, where the child drawn alone quantizes its mean
   once. Measured by the test against the dense oracle, which rounds the same.

   **The scene field has no `mean`.** A field with one is asked it at every
   lod, and a named parent has none to give. So a parent with `mean` (a baked
   parent) is refused: forwarding a rounded mean would draw its unplaced
   cells unlike the world alone, and no baked world can be placed into yet
   (files are views, CLAUDE.md's editedField note). An empty list hands the
   base back, so undoing every drop draws the parent's own bytes.

   **The stamp rule** (stream-core §2c: a word reads only inside its own
   chunk's box) holds in the sense it exists for: the owner test reads T
   inside the cell, and the child's data and T never change, so a word
   depends only on the chunk's stamp, its colour revision and the list. The
   list changes only inside a placement's bounds, which its drop and undo
   paint (scene-plan §1.4). The baked child's fallback climbs out of the
   parent's chunk box in the child's frame, but only into the same immutable
   child. Step 3's "same stamp, same bytes" is what settles it.

   **Cost.** The first version tested every placement's bounds for every
   sample, and on the whole D = 10 kit that made 16 placements cost 1.5–2×
   a job's colour, nearly all of it in chunks no placement touches. Now the
   placements whose bounds meet the 64-voxel block a sample lies in (the
   chunk's side at lod 0) are kept, latest first, and rebuilt only when a
   sample lands in another block, which a job's samples rarely do. A cell up
   to level 6 lies in one block, so the list is exact for it; a coarser cell
   takes the whole list. Numbers in scene-log §2.2. */
const boundsMemo = new WeakMap();
function placedBounds(store, T, Dt){
  let m = boundsMemo.get(store);
  if (!m) boundsMemo.set(store, m = new Map());
  const key = T * 64 + Dt;
  if (!m.has(key)) m.set(key, contentBox(store, T, Dt));
  return m.get(key);
}
export function sceneField(store, base, list){
  if (typeof base !== 'function') throw new Error('sceneField: needs the parent\'s field (a colourless parent has nothing to fall back on)');
  if (base.mean) throw new Error('sceneField: a parent with `mean` (a baked parent) can\'t be placed into yet; see the note above sceneField');
  if (!list.length) return base;
  const kids = list.map(e => {
    checkPlacement({ world: { D: e.D }, at: e.at, turn: e.turn, scale: e.scale });
    const s = e.scale ?? 0, t = e.turn ?? 0, Dt = e.D + s;
    if (e.T >= FIRST_NODE && store.levelOf(e.T) !== Dt) throw new Error(`sceneField: T is level ${store.levelOf(e.T)}, not D + scale = ${Dt}`);
    const box = placedBounds(store, e.T, Dt);
    return { T: e.T, Dt, D: e.D, s, at: e.at, P: PERM[t >> 3], fl: [t & 1, t >> 1 & 1, t >> 2 & 1], colour: e.colour ?? null,
             empty: !box, lo: box ? box.lo.map((v, i) => v + e.at[i]) : null, hi: box ? box.hi.map((v, i) => v + e.at[i]) : null };
  });
  const lo = [0, 0, 0], hi = [0, 0, 0], pt = [0, 0, 0], src = [0, 0, 0], mean = new Float64Array(3);
  // The placements meeting the last block asked about, latest first.
  const near = [];
  let bx = NaN, by = NaN, bz = NaN;
  const meetsBox = (c, a, b) => !c.empty && a[0] < c.hi[0] && a[1] < c.hi[1] && a[2] < c.hi[2] && b[0] > c.lo[0] && b[1] > c.lo[1] && b[2] > c.lo[2];
  const all = kids.slice().reverse(), blo = [0, 0, 0], bhi = [0, 0, 0];
  function nearOf(l){
    if (l > 6) return all;
    const X = Math.floor(lo[0] / 64), Y = Math.floor(lo[1] / 64), Z = Math.floor(lo[2] / 64);
    if (X === bx && Y === by && Z === bz) return near;
    bx = X; by = Y; bz = Z; near.length = 0;
    blo[0] = 64 * X; blo[1] = 64 * Y; blo[2] = 64 * Z;
    for (let i = 0; i < 3; i++) bhi[i] = blo[i] + 64;
    for (const c of all) if (meetsBox(c, blo, bhi)) near.push(c);
    return near;
  }
  function childColour(c, l){
    const lc = Math.min(c.D, Math.max(0, l - c.s)), cs = 2 ** lc, n = 2 ** (c.D - lc);
    for (let i = 0; i < 3; i++){
      // The centre on the placed child's own grid: parent voxels less `at`, in child voxels.
      const K = Math.min(n - 1, Math.max(0, Math.floor((pt[i] - c.at[i]) / 2 ** c.s / cs)));
      src[c.P[i]] = c.fl[i] ? n - 1 - K : K;
    }
    if (c.colour.mean){
      c.colour.mean(lc, src[0] * cs, src[1] * cs, src[2] * cs, mean);
      return rgb8(mean[0], mean[1], mean[2]);
    }
    return c.colour((src[0] + 0.5) * cs, (src[1] + 0.5) * cs, (src[2] + 0.5) * cs, lc);
  }
  return function scene(x, y, z, l = 0){
    const side = 2 ** l, h = side / 2;
    pt[0] = x; pt[1] = y; pt[2] = z;
    for (let i = 0; i < 3; i++){ lo[i] = pt[i] - h; hi[i] = lo[i] + side; }
    const list = nearOf(l);
    for (let k = 0; k < list.length; k++){
      const c = list[k];
      if (c.empty || lo[0] >= c.hi[0] || lo[1] >= c.hi[1] || lo[2] >= c.hi[2] || hi[0] <= c.lo[0] || hi[1] <= c.lo[1] || hi[2] <= c.lo[2]) continue;
      if (!boxHits(store, c.T, c.Dt, c.at[0], c.at[1], c.at[2], lo, hi)) continue;
      return c.colour ? childColour(c, l) : base(x, y, z, l);
    }
    return base(x, y, z, l);
  };
}


/* ---- the scene log (docs/scene-plan.md §1.4, step 3) --------------------------
   Every drop in order, the truth, the way edit-core's createEditLog holds
   blocks: an undo step is (root, drop count), with the root after drop n in
   `roots[n]`, and the root is what the drops made (bakeScene of the live
   placements gives it back, by hash-consing). A drop is seven int32 words,
   so a worker can take them as a buffer and a SCNE section can write them:

     world  the index of the dropped world in this log's `worlds`
     at     x, y, z, the child's cube corner in parent voxels
     turn   dag-core's Oh element
     scale  2^scale parent voxels a child voxel
     T      the prepared child's id in the parent's store (prepared(store, p).id),
            which a worker can't compute (a storeView can't intern), and
            whose nodes travel in the same tail, ahead of it

   **A drop is an op even when the root doesn't move.** A child dropped into
   solid rock leaves the parent's nodes as they were, and the voxels under it
   are the child's colour now. So unlike a block, "changes no voxel" isn't
   "changes nothing". What isn't an op is a drop with no voxel inside the
   world (an empty child, or one dropped wholly off the edge): nothing to
   colour, nothing to undo. It keeps the redo steps, as a click that changes
   nothing does.

   **Paint is the placed content's bounds, in level-6 blocks** (the chunk's
   side at lod 0; createPaint's `touch` marks each block's path up the tree,
   so a coarse chunk holding one sees it). Ids can't see colour, and the
   scene field (above) only ever gives a cell a child's colour inside that
   child's bounds, so a chunk outside them has the same bytes. The bounds are
   the whole child's, clipped to the world: wider than the shape, which costs
   jobs, never correctness (§3's trap: under-painting would leave a kit colour
   on a knight). A knight is about 4 × 5 × 5 blocks, a ×4 giant 16³. Undo and
   redo paint the same cover.

   **Worlds are registered once, on their first drop, and never removed**:
   undo takes the drop out, not the world. The delta carries the worlds a
   follower hasn't seen (`worldsFrom` onwards), so a baked child's words cross
   to a worker once a world, not once a drop (§1.5). A world here is
     { store, root, D, skin?, colour? }
   with `colour` its descriptor in its own store's terms (colours.js): named,
   or { kind: 'baked', skin, words, bits } with `skin` the world's own skin
   root. The log rewrites a baked skin to its id in the parent's store
   (importWorld imported it beside the shape), since that's the store a
   worker's field reads.

   **One parent store a log.** T and the skin are ids in it, so a drop into
   another store would name nodes that aren't there; refused.

   **The epoch**, as createEditLog's: undo, then a different drop, leaves the
   same count with a different drop on the end, so every undo starts a new
   epoch and a follower seeing one rebuilds from drop 0. Redo appends what
   was there and needs none. */
export const SCENE_WORDS = 7;
const PAINT_LEVEL = 6;                     // chunk-core's CHUNK_LEVELS; not imported, this file has no chunk-core
function paintOf(store, T, Dt, at, D){
  const box = placedBounds(store, T, Dt);
  if (!box) return [];
  const side = 2 ** PAINT_LEVEL, n = Math.ceil(2 ** D / side), lo = [0, 0, 0], hi = [0, 0, 0];
  for (let i = 0; i < 3; i++){
    lo[i] = Math.max(0, Math.floor((box.lo[i] + at[i]) / side));
    hi[i] = Math.min(n, Math.ceil((box.hi[i] + at[i]) / side));
    if (lo[i] >= hi[i]) return [];
  }
  const out = [];
  for (let Z = lo[2]; Z < hi[2]; Z++) for (let Y = lo[1]; Y < hi[1]; Y++) for (let X = lo[0]; X < hi[0]; X++)
    out.push({ level: PAINT_LEVEL, X, Y, Z });
  return out;
}
export function createSceneLog(base){
  let cap = 64, ops = new Int32Array(cap * SCENE_WORDS), roots = new Uint32Array(cap + 1);
  let n = 0, top = 0, epoch = 0, parent = null;
  roots[0] = base;
  const worlds = [], indexOf = new Map(), paints = [];
  // A world's index, registering it on its first drop: { world, D, colour },
  // colour the descriptor a follower gets (a baked skin as the parent's id).
  function register(store, world){
    let i = indexOf.get(world);
    if (i !== undefined) return i;
    let colour = world.colour ?? null;
    if (colour && colour.kind === 'baked'){
      if (world.skin === undefined || colour.skin !== world.skin) throw new Error(`scene log: a baked world's colour names skin ${colour.skin}, and the world's skin is ${world.skin}`);
      colour = { ...colour, skin: importWorld(store, world).skin };
    }
    worlds.push({ world, D: world.D, colour });
    indexOf.set(world, i = worlds.length - 1);
    return i;
  }
  function push(root, w, p, T, paint){
    if (n === cap){
      const o2 = new Int32Array(cap * 2 * SCENE_WORDS), r2 = new Uint32Array(cap * 2 + 1);
      o2.set(ops); r2.set(roots); ops = o2; roots = r2; cap *= 2;
    }
    const j = n * SCENE_WORDS;
    ops[j] = w; ops[j + 1] = p.at[0]; ops[j + 2] = p.at[1]; ops[j + 3] = p.at[2];
    ops[j + 4] = p.turn ?? 0; ops[j + 5] = p.scale ?? 0; ops[j + 6] = T;
    paints[n] = paint;
    roots[++n] = root;
    top = n;     // a new drop ends the redo branch
  }
  const entryOf = i => {
    const j = i * SCENE_WORDS;
    return { world: worlds[ops[j]].world, at: [ops[j + 1], ops[j + 2], ops[j + 3]], turn: ops[j + 4], scale: ops[j + 5] };
  };
  return {
    /* Drop `p` ({ world, at, turn, scale }) on the current root. Returns null
       if it has no voxel in the world, or { paint } for setRoot. */
    drop(store, D, p){
      // Before prepared(), which imports into the store and would fail less clearly.
      if (typeof store.intern !== 'function') throw new Error('scene log: the parent\'s store must intern (a storeView can\'t: import its keys into a createStore first)');
      if (parent && store !== parent) throw new Error('scene log: one parent store a log (its drops name ids in it)');
      checkPlacement(p, D);
      const c = prepared(store, p), paint = paintOf(store, c.id, c.D, p.at, D);
      if (!paint.length) return null;
      const root = bakeScene(store, roots[n], D, [p]);
      parent = store;
      push(root, register(store, p.world), p, c.id, paint);
      return { paint };
    },
    undo(){ if (!n) return null; n--; epoch++; return { paint: paints[n] }; },
    redo(){ if (n === top) return null; n++; return { paint: paints[n - 1] }; },
    get root(){ return roots[n]; }, get count(){ return n; }, get epoch(){ return epoch; },
    get canUndo(){ return n > 0; }, get canRedo(){ return n < top; },
    get worldCount(){ return worlds.length; },
    rootAt: i => roots[i],
    // The live drops, as placements: what a twin or a file bakes from scratch.
    placements: () => Array.from({ length: n }, (_, i) => entryOf(i)),
    /* What a follower that has seen `seen` drops at `seenEpoch`, and the
       first `seenWorlds` worlds, still needs, as a copy it can be posted.
       All the drops if the epoch has moved on; worlds never start over. */
    delta(seenEpoch = -1, seen = 0, seenWorlds = 0){
      const from = seenEpoch === epoch ? seen : 0;
      return { epoch, from, count: n, ops: ops.slice(from * SCENE_WORDS, n * SCENE_WORDS),
               worldsFrom: seenWorlds, worlds: worlds.slice(seenWorlds).map(w => ({ D: w.D, colour: w.colour })) };
    },
    ops: () => ops.subarray(0, n * SCENE_WORDS),
  };
}

/* ---- the follower: a scene log's deltas on the other side ----------------------
   What a chunk worker (stream-core's createJobRunner) keeps of a scene: the
   worlds with their fields, built once a world by `fieldOf(desc, D)` (the
   runner's colourOf over its own view, so a baked child reads its skin
   through the parent's ids), and the live drops as sceneField's list. The
   rules are createBlockTable's: a new epoch starts at drop 0, a delta has to
   start where this one stopped, and so does its world list. A follower
   quietly missing a drop would draw the parent's colour on a child until
   something else repainted the chunk, so a gap throws, and the pool restarts
   the worker with every tail. One field object a world, shared by its
   placements: a baked field's path memo is correct in any order of asks
   (baked-core.test holds it so), only slower when they jump about. */
export function createSceneTable(store, fieldOf){
  const worlds = [];
  let epoch = 0, seen = 0, list = [];
  return {
    sync({ epoch: e, from, count, ops, worldsFrom, worlds: ws }){
      if (worldsFrom !== worlds.length) throw new Error(`scene table: this table has ${worlds.length} worlds, the delta starts at ${worldsFrom}`);
      if (e !== epoch){
        if (from !== 0) throw new Error(`scene table: a new epoch has to start at drop 0, not ${from}`);
        list = []; epoch = e;
      } else if (from !== seen) throw new Error(`scene table: this table has ${seen} drops, the delta starts at ${from}`);
      for (const w of ws) worlds.push({ D: w.D, colour: w.colour ? fieldOf(w.colour, w.D) : null });
      for (let s = from, j = 0; s < count; s++, j += SCENE_WORDS){
        const w = worlds[ops[j]];
        if (!w) throw new Error(`scene table: drop ${s} names world ${ops[j]}, and there are ${worlds.length}`);
        list.push({ T: ops[j + 6], D: w.D, at: [ops[j + 1], ops[j + 2], ops[j + 3]], turn: ops[j + 4], scale: ops[j + 5], colour: w.colour });
      }
      seen = count;
    },
    // The parent's field with the drops over it; the base itself when there are none.
    field: base => sceneField(store, base, list),
    get list(){ return list.slice(); },
    get seen(){ return seen; }, get epoch(){ return epoch; }, get worldCount(){ return worlds.length; },
  };
}

/* ---- where a drop lands (docs/scene-plan.md §1.3, step 4) ---------------------
   The viewer's aim, as edit-core's aimAt is a block's: the decisions, with
   nothing drawn. The page picks a voxel (edit-core's pick) and hands the
   hit here with the child's box.

   `box` is the placed child's content box with its corner at 0 ({ lo, hi },
   childFrame's bounds for at = [0, 0, 0]): turned and scaled, so it's the
   box that will sit in the world. **Against the face, centred on the hit**
   (§4 Q2, answered 2026-11-10): along the hit face's axis the box's near
   side touches the face from the open side, so on a floor it stands on the
   floor and on a wall it hangs off the wall; along the other two its centre
   is the hit voxel's centre, rounded to a whole voxel (a half is rounded up,
   Math.round's way, so the same hit gives the same corner every time).

   **Snap to 16 is relative** (§1.3): `ref` is the corner of the first copy
   of the same (world, turn, scale) still placed, and the two axes along the
   face move to ref plus a multiple of `grid`, the nearest one. Along the
   face's axis it stays exact, so it still stands on the surface. Relative,
   because §11.1 measured that alignment *between* copies is what's shared:
   1.9% a copy at Δ = 16, 85% at Δ = 2. With no ref (the first copy), or
   grid 1, it's the voxel snap.

   Returns the corner `at`, or null when the eye is inside the voxel it hit
   (no face was crossed, so no side is open: aimAt's rule). */
export function dropAt(hit, box, { grid = 1, ref = null } = {}){
  if (!hit || hit.axis < 0) return null;
  const v = [hit.x, hit.y, hit.z], at = [0, 0, 0];
  for (let i = 0; i < 3; i++){
    if (i === hit.axis){ at[i] = hit.normal > 0 ? v[i] + 1 - box.lo[i] : v[i] - box.hi[i]; continue; }
    const c = Math.round(v[i] + 0.5 - (box.lo[i] + box.hi[i]) / 2);
    at[i] = grid > 1 && ref ? ref[i] + grid * Math.round((c - ref[i]) / grid) : c;
  }
  return at;
}
/* The corner a snap to 16 is relative to: the first live copy of this world
   at this turn and scale, or null. "Live" is what makes undo right: undoing
   the first copy hands the grid to the next one, which sits on it already,
   so no other copy moves (§3's trap). `placements` is the log's live list
   (createSceneLog's placements()), in drop order. */
export function snapRef(placements, world, turn, scale){
  for (const p of placements) if (p.world === world && (p.turn ?? 0) === turn && (p.scale ?? 0) === scale) return p.at;
  return null;
}
/* The four turns about y (§4 Q1: "the four about the y axes is fine at
   first"), a quarter turn apart, in dag-core's Oh encoding: 0, then x and z
   swapped with one flip (41 sends x to z and z to −x), then both flipped (5),
   then the other quarter (44). Each fixes y, so a statue stays upright, and
   each is proper; Q and E step through them. */
export const Y_TURNS = [0, 41, 5, 44];
