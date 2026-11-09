/* The label DAG sketches' shared pieces (docs/labels-log.md): a label store,
   the checks that hold shape A and shape B to each other, histograms,
   occurrences and the two coarse rules. Moved out of label-sketch.mjs
   (the caves, E1 + E3) when label-kit.mjs (the kit, E1b) needed them too;
   the caves' numbers didn't move (label-sketch --quick, byte for byte).

   A sketch's code, not the engine's: the label store is a stand-in for
   dag-core's typed leaves (multidag-attributes.md §3 B, not built).

   The shapes, as in label-sketch.mjs:
     A          one DAG whose leaves are labels, 0 meaning empty. It holds the
                shape too: occupancy is "label ≠ 0".
     B, masked  the bit DAG for shape, and beside it a label DAG with air as
                "don't care": a cell whose occupied voxels share one label is
                that label, whatever its air looks like (labels-log §8,
                decision 1).

   Every function takes the label store L and reads its label count L.NL
   (air included): 5 for the caves, 1 + materials for the kit. */
import { createStore, EMPTY, FULL, FIRST_NODE, OCT } from '../dag-core.js';

export const AIR = 0;

/* ---- a label store ---------------------------------------------------------
   dag-core's store, unchanged, with the labels as level-0 nodes interned
   first: label L's leaf is the node (level 0, children [L, 0, …]), id
   FIRST_NODE + L − 1. Air is EMPTY, as empty is in the bit DAG, and a region
   of one label is a chain, one node a level, as solid(k) is. Ids stay
   children first, so the sweeps below walk them in order.

   The store's own transform would turn a leaf's [L, 0, …] into another
   node, so turns go through `transform` here, which leaves every chain (and
   so every leaf) alone: one label throughout is the same after any turn. */
export function createLabelStore(NL){
  const store = createStore(), leaf = [EMPTY], uni = [[EMPTY]], labelOf = new Map();
  for (let L = 1; L < NL; L++){
    const ch = new Uint32Array(8); ch[0] = L;
    leaf.push(store.intern(0, ch)); uni.push([leaf[L]]); labelOf.set(leaf[L], L);
  }
  const NLEAF = NL - 1;
  // The level-k chain of label L (EMPTY for air).
  const uniform = (L, k) => {
    if (L === AIR) return EMPTY;
    const u = uni[L];
    while (u.length <= k){ const id = store.intern(u.length, new Uint32Array(8).fill(u[u.length - 1])); u.push(id); labelOf.set(id, L); }
    return u[k];
  };
  const isLeaf = id => id >= FIRST_NODE && id < FIRST_NODE + NLEAF;
  /* A masked intern: children that are all one label's chains or EMPTY
     (don't care) make that label's chain, whatever else they say. This is
     the collapse that makes the masked DAG canonical: without it, the DAG
     would depend on how conservative the builder was about splitting. */
  const internMasked = (k, ch) => {
    let only = AIR;
    for (let o = 0; o < 8; o++){
      if (ch[o] === EMPTY) continue;
      const L = labelOf.get(ch[o]);
      if (L === undefined || (only !== AIR && L !== only)) return store.intern(k, ch);
      only = L;
    }
    return uniform(only, k);
  };
  /* Top down from a label classifier (cell(k, x, y, z): a label, or −1). With
     `masked`, every node goes through internMasked. */
  function fromField(D, cell, { masked = false } = {}){
    const buf = Array.from({ length: D + 1 }, () => new Uint32Array(8));
    const build = (k, x, y, z) => {
      const v = cell(k, x, y, z);
      if (v >= 0) return uniform(v, k);
      if (k === 0) throw new Error(`label fromField: undecided voxel (${x}, ${y}, ${z})`);
      const ch = buf[k];
      for (let o = 0; o < 8; o++) ch[o] = build(k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
      return masked ? internMasked(k, ch) : store.intern(k, ch);
    };
    return build(D, 0, 0, 0);
  }
  // Oh element e applied to a subtree, chains left as they are (memoized).
  const tmemo = new Map();
  function transform(id, e){
    if (id === EMPTY || e === 0 || labelOf.has(id)) return id;
    const key = id * 48 + e;
    let r = tmemo.get(key);
    if (r !== undefined) return r;
    const ch = new Uint32Array(8);
    for (let o = 0; o < 8; o++) ch[OCT[e * 8 + o]] = transform(store.child(id, o), e);
    r = store.intern(store.levelOf(id), ch);
    tmemo.set(key, r);
    return r;
  }
  return { store, NL, leaf, uniform, isLeaf, labelOf, internMasked, fromField, transform, NLEAF };
}

/* A bit-DAG subtree s (in `shape`) as labels in L's store, every voxel `lab`:
   shape A's copy of a shape painted one label. One memo per call site, keyed
   by (s, lab), so a part painted twice in one label is one subtree. */
export function painter(L, shape){
  const memo = new Map();
  const fill = (s, lab) => {
    if (s === EMPTY) return EMPTY;
    if (s === FULL) return L.leaf[lab];
    const key = s * L.NL + lab;
    let r = memo.get(key);
    if (r !== undefined) return r;
    const ch = new Uint32Array(8);
    for (let o = 0; o < 8; o++) ch[o] = fill(shape.child(s, o), lab);
    r = L.store.intern(shape.levelOf(s), ch);
    memo.set(key, r);
    return r;
  };
  return fill;
}

/* ---- checks ----------------------------------------------------------------- */
// A's occupancy, interned into the shape's store: label ≠ 0 is a 1.
export function occupancyOf(L, A, shape){
  const memo = new Map(), ch = new Uint32Array(8);
  const rec = id => {
    if (id === EMPTY) return EMPTY;
    if (L.isLeaf(id)) return FULL;
    let r = memo.get(id);
    if (r !== undefined) return r;
    const kids = [];
    for (let o = 0; o < 8; o++) kids.push(rec(L.store.child(id, o)));
    ch.set(kids);
    r = shape.intern(L.store.levelOf(id), ch);
    memo.set(id, r);
    return r;
  };
  return { root: rec(A), memo };
}
/* Shape + masked label DAG (in M's store) → A, interned into L's (A's) store.
   `pairs` is how many (shape, mixed label) pairs the walk met: the ones that
   need a histogram of their own (labels-log §4). */
export function recombine(L, shape, s, M, m){
  const memo = new Map(), fill = painter(L, shape);
  const rec = (s, m) => {
    if (s === EMPTY) return EMPTY;
    if (m === EMPTY) throw new Error('recombine: occupied voxels with no label');
    const lab = M.labelOf.get(m);
    if (lab !== undefined) return fill(s, lab);
    const key = s * 67108864 + m;
    let r = memo.get(key);
    if (r !== undefined) return r;
    const ch = new Uint32Array(8);
    for (let o = 0; o < 8; o++) ch[o] = rec(s === FULL ? FULL : shape.child(s, o), M.store.child(m, o));
    r = L.store.intern(M.store.levelOf(m), ch);
    memo.set(key, r);
    return r;
  };
  return { root: rec(s, m), pairs: memo.size };
}
// A's voxels as labels, dense (small D only).
export function expandLabels(L, root, D){
  const S = 2 ** D, out = new Uint8Array(S * S * S);
  const rec = (id, k, x, y, z) => {
    if (id === EMPTY) return;
    const lab = L.labelOf.get(id);
    if (lab !== undefined){
      const s = 2 ** k;
      for (let zz = z; zz < z + s; zz++) for (let yy = y; yy < y + s; yy++) out.fill(lab, x + S * (yy + S * zz), x + s + S * (yy + S * zz));
      return;
    }
    const h = 2 ** (k - 1);
    for (let o = 0; o < 8; o++) rec(L.store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
  };
  rec(root, D, 0, 0, 0);
  return out;
}
// The label of one voxel of A, by a walk down (0 for air).
export function labelAt(L, root, D, x, y, z){
  let id = root;
  for (let k = D - 1; k >= 0 && id !== EMPTY && !L.labelOf.has(id); k--)
    id = L.store.child(id, ((x >> k) & 1) | ((y >> k) & 1) << 1 | ((z >> k) & 1) << 2);
  return id === EMPTY ? AIR : L.labelOf.get(id);
}

/* ---- histograms, occurrences, the coarse rules ----------------------------- */
// Voxels of each label under every node (air left out: it's 8^level − the rest).
export function histograms(L){
  const st = L.store, NL = L.NL, top = st.maxId, H = new Float64Array((top + 1) * NL);
  for (let id = FIRST_NODE; id <= top; id++){
    if (L.isLeaf(id)){ H[id * NL + L.labelOf.get(id)] = 1; continue; }
    for (let o = 0; o < 8; o++){ const c = st.child(id, o); if (c !== EMPTY) for (let j = 1; j < NL; j++) H[id * NL + j] += H[c * NL + j]; }
  }
  return H;
}
// How often each node occurs in the world under root (top down, ids descending).
export function occurrences(st, root){
  const occ = new Float64Array(st.maxId + 1);
  occ[root] = 1;
  for (let id = root; id >= FIRST_NODE; id--){
    if (!occ[id] || st.levelOf(id) === 0) continue;
    for (let o = 0; o < 8; o++){ const c = st.child(id, o); if (c !== EMPTY) occ[c] += occ[id]; }
  }
  return occ;
}
// The plurality of NL counts from v[off]; ties go to the lower label; 0: nothing to vote for.
export const plurality = (v, NL, off = 0) => {
  let best = 0, bv = 0;
  for (let j = 1; j < NL; j++) if (v[off + j] > bv){ bv = v[off + j]; best = j; }
  return best;
};
// The label at a level-f node's centre voxel (corner + 2^(f−1)): child 7, then 0s.
export function centreLabel(L, id, f){
  for (let k = f; k > 0 && id !== EMPTY; k--){
    const lab = L.labelOf.get(id);
    if (lab !== undefined) return lab;
    id = L.store.child(id, k === f ? 7 : 0);
  }
  return id === EMPTY ? AIR : L.labelOf.get(id);
}
/* The label of a node's first occupied voxel in Morton order: what a baked
   word stream gives a sub-cell (labels-log §8, decision 2: its first word in
   rank order, occupied by construction, since air has no word). A stand-in:
   words are kept per *shown* voxel, and the first occupied voxel of a
   sub-cell isn't always shown. */
export function firstLabel(L, id){
  for (;;){
    if (id === EMPTY) return AIR;
    const lab = L.labelOf.get(id);
    if (lab !== undefined) return lab;
    let o = 0;
    while (L.store.child(id, o) === EMPTY) o++;
    id = L.store.child(id, o);
  }
}
/* A sampled rule: the sub-cells meanDepth below a level-lod node, each voting
   with its voxel count for the label `sample(L, id, level)` gives it.
   sample = centreLabel is the rule decided for the word (attributes-q13 §3,
   chunk-core's meanUnder), whose air points vote for nothing; firstLabel is
   the baked one. */
export function sampledRule(L, H, sample){
  const NL = L.NL, VOTES = new Float64Array(NL);
  return (id, lod, meanDepth) => {
    const floor = Math.max(0, lod - meanDepth);
    VOTES.fill(0);
    const rec = (id, k) => {
      if (id === EMPTY) return;
      if (k === floor){
        let w = 0; for (let j = 1; j < NL; j++) w += H[id * NL + j];
        VOTES[sample(L, id, k)] += w;
        return;
      }
      for (let o = 0; o < 8; o++) rec(L.store.child(id, o), k - 1);
    };
    rec(id, lod);
    return plurality(VOTES, NL);
  };
}
