/* EXPLORE CORE — a world file's DAG, chunks and colour as things to look at
   (docs/explore.md, asked for 2026-11-21: "draw the graphs in 3D and show
   lines showing how things reference"). Pure: imports dag-core, chunk-core
   and stream-core's stamp, no DOM, no gl, so test/explore-core.test.js holds
   every number the page shows to a brute force of its own.

   The picture the page draws is one scene in one frame:

     - the world, a cube of side 2 centred on the origin (y up), drawn as its
       cells at one lod;
     - the graph above it: one layer a level, the root on top, every node a
       point and every reference (a parent's child slot) a line down to the
       child. A shared node is one point with many lines into it, which is
       hash-consing seen from the side;
     - lines from a node to the places it occurs in the world below, and from
       a chunk to the seven nodes its job reads.

   The words, used the same way everywhere here:
     refs     a node's parents' slots that name it (a parent naming it twice,
              two octants the same subtree, is two refs and one parent);
     parents  the distinct nodes that name it;
     places   how many times it occurs in the world: the paths from the root
              to it, Σ over its parents of their places × the slots. Float64,
              exact to 2^53 (FULL's places are the world's voxels, so past
              D = 17 a solid world's are rounded, as createCounts' are);
     first place  the corner, in voxels, of its place first in Morton order
              (the order every walk in this code goes in: octant
              x | y << 1 | z << 2, so a depth-first walk meets places in
              it). Each node's is the least over its parents' first places
              plus the slot's offset, which is right because a parent's
              places are disjoint aligned blocks of one size, and Morton
              order of aligned blocks is preserved by any offset inside them.

   Everything is computed over the ids in one sweep a pass, as dag-core's
   census is: ids are children-first, so walking them down from the top sees
   every parent before its children, and walking up sees every child before
   its parents. */
import { EMPTY, FULL, FIRST_NODE, storeView, createClasses, OH48, MUL, INV, OCT, applyG } from '../dag-core.js';
import { CHUNK_LEVELS, nodeAt } from '../chunk-core.js';
import { stampOf, SIDES } from '../stream-core.js';

/* Where the graph sits above the world: the world is y ∈ [−1, 1], the lowest
   level shown at GRAPH_BASE and the root GRAPH_HEIGHT above it. */
export const GRAPH_BASE = 1.4, GRAPH_HEIGHT = 2.4;
/* What the page draws at most. A node is a quad of 4 vertices, a reference a
   line of 2 reading positions from a texture; 1.5 million lines is ~12 MB of
   index pairs. Below that the graph's lowest levels are left out (they're
   the ones with the most nodes), and the level table says so. */
export const GRAPH_BUDGET = { nodes: 250000, edges: 1500000 };
/* Classes cost 48 keys a node (createClasses): ~3 s a million nodes. */
export const CLASS_LIMIT = 1 << 20;
/* The world's cells: a dense bitset of side³ for the surface test, so the
   side stops at 512 (16 MB), and the walk at 4 million cells. */
export const MAX_SIDE = 512, CELL_BUDGET = 4000000;
export const CHUNK_BUDGET = 32768;
// Occurrences listed for a node, and colours asked for at its places.
export const PLACE_LIST = 4096;

/* ---- Morton order on corners ---------------------------------------------------
   a < b in Morton order: the axis whose highest differing bit is highest
   decides, and at the same bit z outranks y outranks x (the octant is
   x | y << 1 | z << 2). Corners are below 2^30 (D ≤ 30). */
export function mortonLess(ax, ay, az, bx, by, bz){
  const hx = 31 - Math.clz32(ax ^ bx), hy = 31 - Math.clz32(ay ^ by), hz = 31 - Math.clz32(az ^ bz);
  if (hz >= hy && hz >= hx) return hz >= 0 && az < bz;
  if (hy >= hx) return ay < by;
  return ax < bx;
}

const childAt = (keys, id, o) => keys[(id - FIRST_NODE) * 9 + 1 + o];

/* ---- the analysis ------------------------------------------------------------
   analyse(keys, root, D): every per-node number the page shows, over a
   snapshot's keys (readVdag's, children first). Nodes the root doesn't reach
   (a baked world's skin, which shares the keys) have no places and are left
   out of everything but `level`.
     level, refs, parents, places, voxels, px/py/pz (first place)  per id
     order        the reached ids, level 0 first, Morton by first place in a level
     levelStart   where level k starts in order; levelNodes its count
     levelCells   Σ places over level k: the world's occupied cells at lod k
     levelEdges   distinct (parent, child) pairs whose parent is at level k
     levelRefs    Σ refs into level k
     cls, levelClasses  Oh classes (createClasses, OH48), when asked and the
                  world has at most CLASS_LIMIT nodes; null otherwise
     pose         per id, the element that turns its class's representative
                  into it (createClasses' pose: n = pose · rep)
     classCount, stab, ckids, cpose  per class: its stabilizer's order, and
                  the SSVDAG node, the representative's eight children as
                  (class, pose) in the rep's own octants (ckids −1 for EMPTY),
                  the pose normalized to the least of its coset, so it's the
                  same whichever member it was read from (docs/explore.md
                  §8 Q2). Read off a class's first member m, with t = pose(m):
                  rep = t⁻¹·m, so rep's child at octant t⁻¹(o) is
                  t⁻¹·pose(c)·rep(class c), c = m's child at o. */
export function analyse(keys, root, D, { classes = true, classLimit = CLASS_LIMIT } = {}){
  const n = keys.length / 9, top = n + FIRST_NODE;
  const level = new Uint8Array(top), refs = new Uint32Array(top), parents = new Uint32Array(top);
  const places = new Float64Array(top), voxels = new Float64Array(top);
  const px = new Uint32Array(top), py = new Uint32Array(top), pz = new Uint32Array(top);
  for (let id = FIRST_NODE; id < top; id++) level[id] = keys[(id - FIRST_NODE) * 9];
  if (root !== EMPTY) places[root] = 1;
  const levelEdges = new Float64Array(D + 1);
  // Down the ids: a node's places and first place are whole before it hands them on.
  for (let id = top - 1; id >= FIRST_NODE; id--){
    if (!places[id]) continue;
    const at = (id - FIRST_NODE) * 9, h = 2 ** (keys[at] - 1);
    for (let o = 0; o < 8; o++){
      const c = keys[at + 1 + o];
      if (c === EMPTY) continue;
      refs[c]++;
      let again = false;
      for (let j = 0; j < o; j++) if (keys[at + 1 + j] === c){ again = true; break; }
      if (!again){ parents[c]++; levelEdges[keys[at]]++; }
      const x = px[id] + (o & 1) * h, y = py[id] + (o >> 1 & 1) * h, z = pz[id] + (o >> 2) * h;
      if (!places[c] || mortonLess(x, y, z, px[c], py[c], pz[c])){ px[c] = x; py[c] = y; pz[c] = z; }
      places[c] += places[id];
    }
  }
  // Up the ids: voxels, as createCounts makes them.
  voxels[FULL] = 1;
  for (let id = FIRST_NODE; id < top; id++){
    const at = (id - FIRST_NODE) * 9;
    let v = 0;
    for (let o = 1; o <= 8; o++) v += voxels[keys[at + o]];
    voxels[id] = v;
  }
  // The reached ids by level, then Morton by first place.
  const levelNodes = new Uint32Array(D + 1), levelCells = new Float64Array(D + 1), levelRefs = new Float64Array(D + 1);
  let reached = 0;
  for (let id = FULL; id < top; id++){
    if (!places[id]) continue;
    const k = level[id];
    levelNodes[k]++; levelCells[k] += places[id]; levelRefs[k] += refs[id]; reached++;
  }
  const levelStart = new Uint32Array(D + 2);
  for (let k = 0; k <= D; k++) levelStart[k + 1] = levelStart[k] + levelNodes[k];
  const order = new Uint32Array(reached), fill = levelStart.slice(0, D + 1);
  for (let id = FULL; id < top; id++) if (places[id]) order[fill[level[id]]++] = id;
  const byPlace = (a, b) => mortonLess(px[a], py[a], pz[a], px[b], py[b], pz[b]) ? -1 : 1;
  for (let k = 0; k <= D; k++) order.subarray(levelStart[k], levelStart[k + 1]).sort(byPlace);

  let cls = null, levelClasses = null, pose = null, classCount = 0, stab = null, ckids = null, cpose = null;
  if (classes && n <= classLimit){
    const C = createClasses(storeView({ keys }), OH48);
    classCount = C.size;
    cls = new Int32Array(top); pose = new Uint8Array(top);
    levelClasses = new Uint32Array(D + 1);
    stab = new Uint8Array(classCount); ckids = new Int32Array(8 * classCount).fill(-1); cpose = new Uint8Array(8 * classCount);
    const seen = new Uint8Array(classCount);
    for (let i = 0; i < order.length; i++){
      const id = order[i], c = cls[id] = C.cls(id);
      pose[id] = C.pose(id);
      if (seen[c]) continue;
      seen[c] = 1; levelClasses[level[id]]++; stab[c] = C.stabOrder(c);
      if (id < FIRST_NODE) continue;
      const ti = INV[pose[id]], at = (id - FIRST_NODE) * 9 + 1;
      for (let o = 0; o < 8; o++){
        const ch = keys[at + o];
        if (ch === EMPTY) continue;
        const cc = C.cls(ch), o2 = OCT[ti * 8 + o];
        ckids[8 * c + o2] = cc;
        cpose[8 * c + o2] = C.normPose(cc, MUL[ti * 48 + C.pose(ch)]);
      }
    }
  }
  return { D, root, top, nodes: reached, level, refs, parents, places, voxels, px, py, pz,
           order, levelStart, levelNodes, levelCells, levelEdges, levelRefs, cls, levelClasses,
           pose, classCount, stab, ckids, cpose };
}

/* The lowest level the graph can show within a budget, every level above it
   included: the edges of a range [lo, hi] are those whose parent is in
   (lo, hi]. The root's level alone always fits. */
export function graphRange(A, budget = GRAPH_BUDGET){
  let lo = A.D, nodes = A.levelNodes[A.D], edges = 0;
  while (lo > 0){
    const n2 = nodes + A.levelNodes[lo - 1], e2 = edges + A.levelEdges[lo];
    if (n2 > budget.nodes || e2 > budget.edges) break;
    lo--; nodes = n2; edges = e2;
  }
  return { lo, hi: A.D, nodes, edges };
}
export const graphY = (k, lo, hi) => GRAPH_BASE + (hi === lo ? 0.5 : (k - lo) / (hi - lo)) * GRAPH_HEIGHT;

/* ---- layouts -------------------------------------------------------------------
   A node's place in the scene, four floats an id (x, y, z, and 1 where it's
   laid out, 0 outside [lo, hi] or unreached), for a position texture.
     'place'  over its first place: x and z the centre of the node's box in
              the world below, so a layer is a map of where its nodes first
              occur, and a node's lines down to its places are short where it
              stays local and long where it's reused far away;
     'grid'   a level's nodes on a square grid, row by row (back and forth,
              so neighbours in Morton order stay neighbours), every level the
              same width: the top levels sparse, the bottom dense.
   `only` (a flag an id) lays out those ids alone, in the same order: the
   class graph's representatives, one dot a class. */
export function layoutOf(A, { mode = 'place', lo = 0, hi = A.D, only = null } = {}){
  const pos = new Float32Array(4 * A.top), S = 2 ** A.D;
  for (let k = lo; k <= hi; k++){
    let ids = A.order.subarray(A.levelStart[k], A.levelStart[k + 1]);
    if (only) ids = ids.filter(id => only[id]);
    const m = ids.length, y = graphY(k, lo, hi);
    const half = k === 0 ? 0.5 : 2 ** (k - 1), s = Math.ceil(Math.sqrt(m)), rows = Math.ceil(m / s);
    for (let i = 0; i < m; i++){
      const id = ids[i], p = 4 * id;
      if (mode === 'grid'){
        const row = Math.floor(i / s), c = i % s, col = row & 1 ? s - 1 - c : c;
        pos[p] = 2 * (col + 0.5 - s / 2) / s;
        pos[p + 2] = 2 * (row + 0.5 - rows / 2) / s;
      } else {
        pos[p] = 2 * (A.px[id] + half) / S - 1;
        pos[p + 2] = 2 * (A.pz[id] + half) / S - 1;
      }
      pos[p + 1] = y; pos[p + 3] = 1;
    }
  }
  return pos;
}

/* ---- references ------------------------------------------------------------------
   edgesOf(A, keys, lo, hi): every distinct (parent, child) pair with the
   parent's level in (lo, hi], parents in `order`, children in octant order:
   `pairs` two ids an edge, `slots` how many of the parent's octants name the
   child (1 to 8). FULL is a child only when lo = 0. Over `max` it says so
   and makes nothing. */
export function edgesOf(A, keys, lo, hi, max = Infinity){
  let E = 0;
  for (let k = lo + 1; k <= hi; k++) E += A.levelEdges[k];
  if (E > max) return { over: E, pairs: new Uint32Array(0), slots: new Uint8Array(0), count: 0 };
  const pairs = new Uint32Array(2 * E), slots = new Uint8Array(E);
  let e = 0;
  for (let k = hi; k > lo; k--){
    for (let i = A.levelStart[k]; i < A.levelStart[k + 1]; i++){
      const id = A.order[i], at = (id - FIRST_NODE) * 9 + 1;
      for (let o = 0; o < 8; o++){
        const c = keys[at + o];
        if (c === EMPTY) continue;
        let first = -1;
        for (let j = 0; j < o; j++) if (keys[at + j] === c){ first = j; break; }
        if (first >= 0) continue;
        let s = 1;
        for (let j = o + 1; j < 8; j++) if (keys[at + j] === c) s++;
        pairs[2 * e] = id; pairs[2 * e + 1] = c; slots[e] = s; e++;
      }
    }
  }
  return { over: 0, pairs, slots, count: e };
}

/* A node's neighbours in the graph: its distinct children (octant order, and
   which octants), its distinct parents (by id), and every ancestor and
   descendant it reaches, as flags an id: 1 the node, 2 a parent, 4 a child,
   8 an ancestor, 16 a descendant. Ancestors by a sweep up the ids (a node
   is one if a child is the node or one), descendants by a sweep down. */
export function relativesOf(A, keys, target){
  const flags = new Uint8Array(A.top), L = A.level[target];
  flags[target] = 1;
  const children = [], parents = [];
  if (target >= FIRST_NODE){
    const at = (target - FIRST_NODE) * 9 + 1;
    for (let o = 0; o < 8; o++){
      const c = keys[at + o];
      if (c === EMPTY) continue;
      const known = children.find(x => x.id === c);
      if (known) known.octants.push(o); else children.push({ id: c, octants: [o] });
      flags[c] |= 4 | 16;
    }
    for (let id = target - 1; id >= FIRST_NODE; id--){
      if (!(flags[id] & 16)) continue;
      const a = (id - FIRST_NODE) * 9 + 1;
      for (let o = 0; o < 8; o++){ const c = keys[a + o]; if (c !== EMPTY) flags[c] |= 16; }
    }
  }
  for (let id = Math.max(FIRST_NODE, target + 1); id < A.top; id++){
    if (!A.places[id] || A.level[id] <= L) continue;
    const a = (id - FIRST_NODE) * 9 + 1;
    let parent = false, anc = false;
    for (let o = 0; o < 8; o++){
      const c = keys[a + o];
      if (c === target) parent = true;
      else if (c !== EMPTY && flags[c] & 8) anc = true;
    }
    if (parent){ flags[id] |= 2 | 8; parents.push(id); }
    else if (anc) flags[id] |= 8;
  }
  return { flags, children, parents };
}

/* ---- the class graph (SSVDAG's) ---------------------------------------------------
   One dot a class: the 48 turned and mirrored copies of a node are one node
   of the labelled DAG, and each of its references carries the pose that
   turns the child class's representative into the child (docs/explore.md
   §8 Q2, asked for 2026-11-21). A class's dot is its first member's (first
   in `order`: the member whose first place is the class's first place), so
   the layouts and the textures stay indexed by node id.
     rep[c]        the class's first member's id; isRep a flag an id
     members[c]    how many of its members the world holds (at most 48);
                   memberIds from memberStart[c], in order
     places[c]     Σ its members' places
     refs[c]       the class reps' slots that name it; parents[c] the distinct
                   classes that do
     reps          the class numbers in order (by level, then Morton by first
                   place), levelStart into it a level
     levelEdges[k] distinct (child class, pose) pairs of level-k classes:
                   the class graph's references
     poseCount[e]  slots labelled e, over every class */
export function classGraph(A){
  if (!A.cls) return null;
  const K = A.classCount, D = A.D;
  const rep = new Int32Array(K).fill(-1), members = new Uint8Array(K), places = new Float64Array(K);
  const isRep = new Uint8Array(A.top), reps = [];
  for (let i = 0; i < A.order.length; i++){
    const id = A.order[i], c = A.cls[id];
    members[c]++; places[c] += A.places[id];
    if (rep[c] < 0){ rep[c] = id; isRep[id] = 1; reps.push(c); }
  }
  const memberStart = new Uint32Array(K + 1);
  for (let c = 0; c < K; c++) memberStart[c + 1] = memberStart[c] + members[c];
  const memberIds = new Uint32Array(A.order.length), fill = memberStart.slice(0, K);
  for (let i = 0; i < A.order.length; i++){ const id = A.order[i]; memberIds[fill[A.cls[id]]++] = id; }
  const levelStart = new Uint32Array(D + 2);
  for (const c of reps) levelStart[A.level[rep[c]] + 1]++;
  for (let k = 0; k <= D; k++) levelStart[k + 1] += levelStart[k];
  const refs = new Uint32Array(K), parents = new Uint32Array(K), levelEdges = new Float64Array(D + 1), poseCount = new Float64Array(48);
  for (const c of reps){
    const k = A.level[rep[c]];
    for (let o = 0; o < 8; o++){
      const cc = A.ckids[8 * c + o];
      if (cc < 0) continue;
      const e = A.cpose[8 * c + o];
      refs[cc]++; poseCount[e]++;
      let pair = false, parent = false;
      for (let j = 0; j < o; j++) if (A.ckids[8 * c + j] === cc){ parent = true; if (A.cpose[8 * c + j] === e) pair = true; }
      if (!pair) levelEdges[k]++;
      if (!parent) parents[cc]++;
    }
  }
  return { K, rep, isRep, members, memberStart, memberIds, places, refs, parents, reps: Uint32Array.from(reps), levelStart, levelEdges, poseCount };
}
/* The class graph's references with the parent's level in (lo, hi]: one a
   distinct (parent class, child class, pose), as two rep ids, how many of
   the parent's octants it stands for, and the pose. */
export function classEdgesOf(A, G, lo, hi){
  let E = 0;
  for (let k = lo + 1; k <= hi; k++) E += G.levelEdges[k];
  const pairs = new Uint32Array(2 * E), slots = new Uint8Array(E), poses = new Uint8Array(E);
  let e = 0;
  for (let i = G.levelStart[lo + 1]; i < G.levelStart[hi + 1]; i++){
    const c = G.reps[i];
    for (let o = 0; o < 8; o++){
      const cc = A.ckids[8 * c + o], p = A.cpose[8 * c + o];
      if (cc < 0) continue;
      let seen = false, s = 1;
      for (let j = 0; j < o; j++) if (A.ckids[8 * c + j] === cc && A.cpose[8 * c + j] === p){ seen = true; break; }
      if (seen) continue;
      for (let j = o + 1; j < 8; j++) if (A.ckids[8 * c + j] === cc && A.cpose[8 * c + j] === p) s++;
      pairs[2 * e] = G.rep[c]; pairs[2 * e + 1] = G.rep[cc]; slots[e] = s; poses[e] = p; e++;
    }
  }
  return { pairs, slots, poses, count: e };
}
/* A class's neighbours in the class graph, as relativesOf's flags on the
   rep ids (1 it, 2 a parent, 4 a child, 8 an ancestor, 16 a descendant),
   its children octant by octant in its rep's frame ({ octant, cls, id, pose }),
   and its parents' rep ids in order. A reference goes down one level, so
   descendants come by a sweep down the levels and ancestors by one up. */
export function classRelativesOf(A, G, target){
  const flags = new Uint8Array(A.top), mark = new Uint8Array(G.K), children = [], parents = [];
  flags[G.rep[target]] = 1;
  for (let o = 0; o < 8; o++){
    const cc = A.ckids[8 * target + o];
    if (cc >= 0){ children.push({ octant: o, cls: cc, id: G.rep[cc], pose: A.cpose[8 * target + o] }); mark[cc] |= 4 | 16; }
  }
  for (let i = G.reps.length - 1; i >= 0; i--){
    const c = G.reps[i];
    if (!(mark[c] & 16)) continue;
    for (let o = 0; o < 8; o++){ const cc = A.ckids[8 * c + o]; if (cc >= 0) mark[cc] |= 16; }
  }
  for (let i = 0; i < G.reps.length; i++){
    const c = G.reps[i];
    if (c === target) continue;
    let parent = false, anc = false;
    for (let o = 0; o < 8; o++){
      const cc = A.ckids[8 * c + o];
      if (cc === target) parent = true;
      else if (cc >= 0 && mark[cc] & 8) anc = true;
    }
    if (parent){ mark[c] |= 2 | 8; parents.push(G.rep[c]); }
    else if (anc) mark[c] |= 8;
  }
  for (const c of G.reps) if (mark[c]) flags[G.rep[c]] |= mark[c];
  return { flags, children, parents };
}
/* A class's places: each member's (placesOf, so Morton order within a
   member), members in order, `max` in all; `who` the member each place is. */
export function classPlacesOf(A, keys, G, c, max = PLACE_LIST){
  const n = Math.min(max, G.places[c]), list = new Uint32Array(3 * n), who = new Uint32Array(n);
  let got = 0;
  for (let i = G.memberStart[c]; i < G.memberStart[c + 1] && got < n; i++){
    const m = G.memberIds[i], P = placesOf(A, keys, m, n - got);
    list.set(P.list, 3 * got); who.fill(m, got, got + P.list.length / 3);
    got += P.list.length / 3;
  }
  return { total: G.places[c], level: A.level[G.rep[c]], list, who };
}

/* ---- the 48 poses, for labels -----------------------------------------------------
   A pose e sends (x, y, z) to applyG's signed permutation: poseName says
   where, as the turned frame's axes ("x,−z,y"); poseDet is +1 for a
   rotation and −1 for a mirror. poseColour: the identity white, the rest
   a hue each, mirrors darker, so a class graph's lines read by pose. */
const AXIS = ['x', 'y', 'z'];
export function poseName(e){
  return applyG([1, 2, 3], e).map(v => (v < 0 ? '−' : '') + AXIS[Math.abs(v) - 1]).join(',');
}
export function poseDet(e){
  const m = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => applyG(v, e));
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}
export function poseColour(e){
  if (e === 0) return [235, 235, 235];
  return hsl(((e >> 3) * 8 + (e & 7)) / 48, 0.78, poseDet(e) > 0 ? 0.62 : 0.4);
}

/* ---- places ----------------------------------------------------------------------
   The first `max` places of a node, in Morton order, as corners in voxels
   (three words a place), and how many it has. The walk goes down only
   through the node's ancestors (a sweep up the ids marks them), so it costs
   the places listed, not the world. */
export function placesOf(A, keys, target, max = PLACE_LIST){
  const total = A.places[target], L = A.level[target];
  if (!total) return { total: 0, level: L, list: new Uint32Array(0) };
  const anc = new Uint8Array(A.top);
  for (let id = FIRST_NODE; id < A.top; id++){
    if (A.level[id] <= L || !A.places[id]) continue;
    const at = (id - FIRST_NODE) * 9 + 1;
    for (let o = 0; o < 8; o++){ const c = keys[at + o]; if (c === target || anc[c]){ anc[id] = 1; break; } }
  }
  const out = new Uint32Array(3 * Math.min(max, total));
  let n = 0;
  const go = (id, k, x, y, z) => {
    if (id === target){ out[3 * n] = x; out[3 * n + 1] = y; out[3 * n + 2] = z; n++; return; }
    const h = 2 ** (k - 1), at = (id - FIRST_NODE) * 9 + 1;
    for (let o = 0; o < 8 && n < max; o++){
      const c = keys[at + o];
      if (c === target || anc[c]) go(c, k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
    }
  };
  go(A.root, A.D, 0, 0, 0);
  return { total, level: L, list: out.subarray(0, 3 * n) };
}

/* The nodes from the root down to the level-`level` cell (X, Y, Z) (cell
   coordinates at that level), stopping early at EMPTY or at FULL. */
export function pathTo(keys, root, D, level, X, Y, Z){
  const path = [root];
  let id = root;
  for (let k = D - 1; k >= level && id >= FIRST_NODE; k--){
    const b = k - level;
    id = childAt(keys, id, (X >> b & 1) | (Y >> b & 1) << 1 | (Z >> b & 1) << 2);
    path.push(id);
  }
  return path;
}

/* ---- the world's cells ---------------------------------------------------------------
   Every occupied cell at a lod in Morton order (the walk's), with its node,
   and of those the ones with a face on air (outside the world is air): what
   the page draws as cubes. A cell's coordinates pack as x | y << 10 | z << 20.
   `morton` keeps every cell (the walk's order, for the order line); the
   surface ones are `xyz` and `ids`, still in that order. */
export function cellsAt(A, keys, lod){
  const D = A.D, s = 2 ** (D - lod);
  if (s > MAX_SIDE) throw new Error(`the world is ${s} cells across at lod ${lod}; the explorer draws ${MAX_SIDE} at most`);
  const total = A.levelCells[lod];
  if (total > CELL_BUDGET) throw new Error(`lod ${lod} has ${total} cells; the explorer walks ${CELL_BUDGET} at most`);
  const all = new Uint32Array(total), allIds = new Uint32Array(total);
  let n = 0;
  const go = (id, k, x, y, z) => {
    if (k === lod){ all[n] = x | y << 10 | z << 20; allIds[n++] = id; return; }
    const at = (id - FIRST_NODE) * 9 + 1, h = 2 ** (k - lod - 1);
    for (let o = 0; o < 8; o++){
      const c = keys[at + o];
      if (c !== EMPTY) go(c, k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
    }
  };
  if (A.root !== EMPTY) go(A.root, D, 0, 0, 0);
  const bits = new Uint32Array(Math.ceil(s * s * s / 32));
  const at = (x, y, z) => x + s * (y + s * z);
  for (let i = 0; i < n; i++){ const p = all[i], j = at(p & 1023, p >> 10 & 1023, p >> 20); bits[j >>> 5] |= 1 << (j & 31); }
  const has = (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= s || y >= s || z >= s) return false;
    const j = at(x, y, z);
    return (bits[j >>> 5] >>> (j & 31) & 1) === 1;
  };
  const xyz = new Uint32Array(n), ids = new Uint32Array(n);
  let m = 0;
  for (let i = 0; i < n; i++){
    const p = all[i], x = p & 1023, y = p >> 10 & 1023, z = p >> 20;
    if (has(x + 1, y, z) && has(x - 1, y, z) && has(x, y + 1, z) && has(x, y - 1, z) && has(x, y, z + 1) && has(x, y, z - 1)) continue;
    xyz[m] = p; ids[m++] = allIds[i];
  }
  return { lod, side: s, total: n, shown: m, xyz: xyz.slice(0, m), ids: ids.slice(0, m), morton: all };
}
/* The finest lod whose cells the page can walk and draw. */
export function viewLod(A){
  for (let lod = Math.max(0, A.D - Math.log2(MAX_SIDE)); lod <= A.D; lod++) if (A.levelCells[lod] <= CELL_BUDGET) return lod;
  return A.D;
}

/* Where a cell (x, y, z) is in cellsAt's surface list, or −1: the list is in
   Morton order, so a binary search by mortonLess (the Ctrl-held tooltip's
   colour word). */
export function cellIndex(c, x, y, z){
  let lo = 0, hi = c.shown - 1;
  while (lo <= hi){
    const mid = (lo + hi) >> 1, p = c.xyz[mid], a = p & 1023, b = p >> 10 & 1023, d = p >> 20;
    if (a === x && b === y && d === z) return mid;
    if (mortonLess(a, b, d, x, y, z)) lo = mid + 1; else hi = mid - 1;
  }
  return -1;
}

/* ---- the colour pyramid (docs/explore.md §8 Q4) ------------------------------------------
   The world at each lod of the graph's range, in the field's words (what a
   coarse lod draws), each squashed into a slab under its level's layer of
   dots, so level k's nodes sit over lod k's cells. pyramidLods: the lods in
   [lo, D] the page can walk and draw, a layer at most PYRAMID_LAYER cells.
   layerOf: the slab's map from the world's y ∈ [−1, 1], y' = y·scale + offset,
   with its top a little under the layer's dots and its bottom above the
   layer below's (and above the world's top). */
export const PYRAMID_LAYER = 1000000;
export function pyramidLods(A, lo, layer = PYRAMID_LAYER){
  const out = [];
  for (let k = lo; k <= A.D; k++) if (2 ** (A.D - k) <= MAX_SIDE && A.levelCells[k] <= layer) out.push(k);
  return out;
}
export function layerOf(k, lo, hi){
  const gap = Math.min(hi === lo ? GRAPH_HEIGHT : GRAPH_HEIGHT / (hi - lo), 0.5), h = 0.55 * gap, top = graphY(k, lo, hi) - 0.12 * gap;
  return [h / 2, top - h / 2];
}

/* The first occupied cell at a lod along a ray, in cell coordinates
   (origin o, direction d, cell side 1, the world [0, s)³): Amanatides and
   Woo's walk from where the ray enters the world. null if it leaves empty.
   `t` is the entry into the cell, in units of d. */
export function rayCell(store, root, D, lod, o, d){
  const s = 2 ** (D - lod);
  let t0 = 0, t1 = Infinity;
  for (let a = 0; a < 3; a++){
    if (d[a] === 0){ if (o[a] < 0 || o[a] >= s) return null; continue; }
    let ta = (0 - o[a]) / d[a], tb = (s - o[a]) / d[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
  }
  if (t0 >= t1) return null;
  const c = [0, 1, 2].map(a => Math.min(s - 1, Math.max(0, Math.floor(o[a] + d[a] * t0))));
  const step = d.map(v => v > 0 ? 1 : v < 0 ? -1 : 0);
  const next = [0, 1, 2].map(a => d[a] === 0 ? Infinity : ((c[a] + (d[a] > 0 ? 1 : 0)) - o[a]) / d[a]);
  const delta = d.map(v => v === 0 ? Infinity : Math.abs(1 / v));
  let t = t0;
  for (;;){
    const id = nodeAt(store, root, D, lod, c[0], c[1], c[2]);
    if (id !== EMPTY) return { x: c[0], y: c[1], z: c[2], id, t };
    const a = next[0] < next[1] ? (next[0] < next[2] ? 0 : 2) : (next[1] < next[2] ? 1 : 2);
    t = next[a]; c[a] += step[a]; next[a] += delta[a];
    if (c[a] < 0 || c[a] >= s || t > t1) return null;
  }
}

/* ---- chunks ----------------------------------------------------------------------------
   The streamer's chunks at a lod: every occupied level-(lod + 6) node (the
   root alone when the world is smaller than a chunk), with its chunk
   coordinates, in Morton order. Chunks holding one node are copies of one
   job's output (stream-core's cache keys a world chunk by place, but the
   bytes are the node's and its neighbours': the stamp). `first[i]` is the
   index of the first chunk holding i's node, i itself for the first;
   `distinct` counts nodes. Four words a chunk: cx, cy, cz, id. */
export function chunksAt(A, keys, lod, max = CHUNK_BUDGET){
  const D = A.D, L = Math.min(D, lod + CHUNK_LEVELS), total = A.levelCells[L];
  if (total > max) return { lod, level: L, total, over: true, list: new Uint32Array(0), first: new Int32Array(0), distinct: 0 };
  const list = new Uint32Array(4 * total);
  let n = 0;
  const go = (id, k, x, y, z) => {
    if (k === L){ list.set([x, y, z, id], 4 * n++); return; }
    const at = (id - FIRST_NODE) * 9 + 1, h = 2 ** (k - L - 1);
    for (let o = 0; o < 8; o++){
      const c = keys[at + o];
      if (c !== EMPTY) go(c, k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
    }
  };
  if (A.root !== EMPTY) go(A.root, D, 0, 0, 0);
  const first = new Int32Array(n), seen = new Map();
  for (let i = 0; i < n; i++){
    const id = list[4 * i + 3], f = seen.get(id);
    if (f === undefined){ seen.set(id, i); first[i] = i; } else first[i] = f;
  }
  return { lod, level: L, total: n, over: false, list, first, distinct: seen.size, side: 2 ** (L - lod) };
}
/* The seven nodes a chunk's job reads (stream-core's stampOf: its own, then
   +x −x +y −y +z −z), with each neighbour's chunk coordinates. */
export function stampWith(store, root, D, lod, cx, cy, cz){
  const ids = stampOf(store, root, D, lod, cx, cy, cz);
  return [{ id: ids[0], at: [cx, cy, cz] }, ...SIDES.map((s, f) => ({ id: ids[f + 1], at: [cx + s[0], cy + s[1], cz + s[2]] }))];
}

/* ---- colours for the picture (not the world's colour field) -----------------------------
   rgb as three bytes. `identity` is a node's own hue, the same in the graph,
   on the world's cells and on the chunks' boxes, so one node reads as one
   colour wherever it is. `heat` runs dark blue → orange → pale yellow for a
   count on a log scale. */
export function identity(id){
  let h = Math.imul(id ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return hsl((h >>> 0) / 4294967296, 0.62 + 0.3 * ((h >>> 8 & 255) / 255), 0.52 + 0.14 * ((h & 255) / 255));
}
export function hsl(hue, s, l){
  const f = n => { const k = (n + hue * 12) % 12, a = s * Math.min(l, 1 - l); return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}
const HEAT = [[18, 24, 70], [60, 40, 140], [170, 50, 120], [235, 110, 50], [250, 200, 80], [255, 250, 210]];
export function heat(t){
  const u = Math.min(1, Math.max(0, t)) * (HEAT.length - 1), i = Math.min(HEAT.length - 2, Math.floor(u)), f = u - i;
  return [0, 1, 2].map(c => Math.round(HEAT[i][c] + f * (HEAT[i + 1][c] - HEAT[i][c])));
}
// A count on a log scale against the largest: 1 → 0, max → 1.
export const logScale = (v, max) => max <= 1 ? (v >= 1 ? 1 : 0) : Math.log(Math.max(1, v)) / Math.log(max);
// Levels down the rainbow, the root's end warm.
export const levelColour = (k, D) => hsl(0.72 * (1 - k / Math.max(1, D)), 0.7, 0.58);
