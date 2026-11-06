/* ================== DAG CORE (pure) ==================================
   A hash-consed binary voxel DAG, and the census tools the step-2
   experiment needs (docs/hashcons-plan.md). No DOM, no gl, no imports:
   the browser and Node load the same file, the way block-showroom's
   createBimoblockCore() is shared with its worker.

   The claim being tested is ifsandwhats.md §1's: hash-consing a voxel
   tree gives the minimal DAG, and with Oh-labelled edges (SSVDAG) it
   gives something smaller still. Everything here exists to count those
   two things exactly, per binary level, on real content.

   Layout and conventions, shared with sol-v4 and block-showroom:
   - a node at level k covers 2^k voxels per side and has 8 children at
     level k-1, in Morton octant order: octant = bx | by<<1 | bz<<2;
   - dense occupancy is block-showroom's `occ`: x + R*y + R*R*z;
   - an Oh element e is `PERM[e >> 3]` plus sign bits `e & 7`, acting as
     w[i] = (s_i ? -1 : 1) * v[PERM[e>>3][i]]. Element 0 is the identity.
   ===================================================================== */

export const EMPTY = 0, FULL = 1, FIRST_NODE = 2;

/* ---- the Oh group, as data ----------------------------------------------
   Kept local rather than imported from the page: this module has to load
   in a worker with nothing else around it. The encoding is the page's and
   block-showroom's, so an `e` means the same thing in all three. */
const PERM = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];

export function applyG(v, e){
  const P = PERM[e >> 3], s = e & 7;
  return [((s & 1) ? -1 : 1) * v[P[0]],
          ((s & 2) ? -1 : 1) * v[P[1]],
          ((s & 4) ? -1 : 1) * v[P[2]]];
}

// An element is identified by where it sends (1,2,3): every signed
// permutation sends it somewhere different. MUL[a*48+b] is a∘b (b first).
const KEY_OF = new Map();
for (let e = 0; e < 48; e++) KEY_OF.set(applyG([1,2,3], e).join(), e);
export const MUL = new Uint8Array(48 * 48), INV = new Uint8Array(48);
for (let a = 0; a < 48; a++) for (let b = 0; b < 48; b++){
  MUL[a*48 + b] = KEY_OF.get(applyG(applyG([1,2,3], b), a).join());
  if (MUL[a*48 + b] === 0) INV[a] = b;
}

/* OCT[e*8+o]: the octant that octant o lands in under e. Octant centres
   are (±1,±1,±1) about the parent's centre, so this is just applyG on
   the sign pattern. It is all a subtree transform needs:
   (g·n).child[g(o)] = g·(n.child[o]). */
export const OCT = new Uint8Array(48 * 8);
for (let e = 0; e < 48; e++) for (let o = 0; o < 8; o++){
  const w = applyG([(o & 1) ? 1 : -1, (o & 2) ? 1 : -1, (o & 4) ? 1 : -1], e);
  OCT[e*8 + o] = (w[0] > 0 ? 1 : 0) | (w[1] > 0 ? 2 : 0) | (w[2] > 0 ? 4 : 0);
}

/* The two groups the experiment labels edges with. MIRROR8 is SSVDAG's
   (Villanueva et al. 2016): 3 reflection bits, no axis permutations.
   OH48 is the full cube group, which is what block-showroom folds by. */
export const IDENTITY = [0];
export const MIRROR8 = [0, 1, 2, 3, 4, 5, 6, 7];
export const OH48 = Array.from({ length: 48 }, (_, e) => e);

/* ---- fixed-width interning ----------------------------------------------
   One open-addressing table of K-word keys, used twice: for nodes (key =
   level + 8 child ids) and for classes (key = level + 8 packed
   class/pose words). A JS Map with string keys does the same job ~10x
   slower and ~5x larger; at R=256 the experiment interns ~2M keys per
   specimen, so this is where the time goes. Ids are handed out densely
   from `base`, in creation order, which the class pass relies on:
   a node's children always have smaller ids than the node. */
class Interner {
  constructor(K, base, cap = 1 << 16){
    this.K = K; this.base = base; this.n = 0;
    this.keys = new Uint32Array(cap * K);
    this.table = new Int32Array(cap * 2).fill(-1);
  }
  static hash(a, off, K){
    let h = 0x811c9dc5;
    for (let i = 0; i < K; i++){ h = Math.imul(h ^ a[off + i], 0x01000193); h ^= h >>> 15; }
    return h >>> 0;
  }
  // Returns the id for key (a[off..off+K)), creating it if new.
  intern(a, off = 0){
    const K = this.K, mask = this.table.length - 1;
    let i = Interner.hash(a, off, K) & mask;
    for (;;){
      const slot = this.table[i];
      if (slot < 0) break;
      let same = true;
      for (let k = 0, p = slot * K; k < K; k++) if (this.keys[p + k] !== a[off + k]){ same = false; break; }
      if (same) return slot + this.base;
      i = (i + 1) & mask;
    }
    if (this.n * K >= this.keys.length){
      const grown = new Uint32Array(this.keys.length * 2); grown.set(this.keys); this.keys = grown;
    }
    this.keys.set(a.subarray(off, off + K), this.n * K);
    this.table[i] = this.n;
    const id = this.n++;
    if (this.n * 2 > this.table.length) this.rehash();
    return id + this.base;
  }
  rehash(){
    const K = this.K, t = new Int32Array(this.table.length * 2).fill(-1), mask = t.length - 1;
    for (let s = 0; s < this.n; s++){
      let i = Interner.hash(this.keys, s * K, K) & mask;
      while (t[i] >= 0) i = (i + 1) & mask;
      t[i] = s;
    }
    this.table = t;
  }
  get size(){ return this.n; }
}

/* ---- the store ----------------------------------------------------------
   One store can hold many roots: the experiment interns a whole corpus of
   specimens into one store to measure cross-specimen sharing. A node's
   record is its key: keys[(id-2)*9] is the level, then 8 child ids. EMPTY
   is shared by every level (an empty subtree is never stored). FULL is a
   level-0 voxel only: a solid 16³ is an ordinary node, one per level, and
   collapsing it would save one node per level in exchange for a special
   case in every walk. */
export function createStore(){
  const nodes = new Interner(9, FIRST_NODE);
  const scratch = new Uint32Array(9);

  function intern(level, ch){
    let any = 0;
    for (let o = 0; o < 8; o++) any |= ch[o];
    if (!any) return EMPTY;
    scratch[0] = level;
    for (let o = 0; o < 8; o++) scratch[1 + o] = ch[o];
    return nodes.intern(scratch);
  }
  const levelOf = id => id < FIRST_NODE ? 0 : nodes.keys[(id - FIRST_NODE) * 9];
  const child = (id, o) => nodes.keys[(id - FIRST_NODE) * 9 + 1 + o];

  /* Bottom-up from dense occupancy. Each level is a grid of ids half the
     side of the one below; R must be a power of two (block-showroom's
     binary presets are: tower4 = 2·2·2·2, n4 = 4·4). */
  function fromDense(occ, R){
    const D = Math.log2(R);
    if (!Number.isInteger(D)) throw new Error(`fromDense: R=${R} is not a power of two`);
    let grid = occ, side = R;
    const ch = new Uint32Array(8);
    for (let k = 1; k <= D; k++){
      const s = side >> 1, next = new Uint32Array(s * s * s);
      for (let z = 0; z < s; z++) for (let y = 0; y < s; y++) for (let x = 0; x < s; x++){
        for (let o = 0; o < 8; o++)
          ch[o] = grid[(2*x + (o & 1)) + side * ((2*y + ((o >> 1) & 1)) + side * (2*z + (o >> 2)))];
        next[x + s * (y + s * z)] = intern(k, ch);
      }
      grid = next; side = s;
    }
    return { root: grid[0], D };
  }

  /* Straight from a radix-4 automaton, with no dense grid: ifsandwhats.md
     §8.5 step 1. The automaton is three callbacks: step(l, state, d)
     returns the child state for digit d at radix-4 level l, or null if
     the digit is rejected; accept(state) decides a voxel after L levels;
     keyOf(state) names a state for the memo. One radix-4 level is two
     binary levels, and the Morton digit order makes the split free:
     d = 8·k + j puts the child in octant k of the coarse level and octant
     j of the fine one (byte k of a 64-bit rule is octant k's octree mask,
     docs/radix4-addressing.md). The memo is the point: a uniform rule
     stack has one state per level, so even L = 8 (side 65,536) costs a
     few hundred calls. `states` is the memo's size, i.e. how many
     (level, state) pairs the automaton reached, which is the bound
     hash-consing should meet or beat. */
  function fromRadix4(L, start, step, accept, keyOf){
    const memo = new Map();
    const build = (l, st) => {
      if (l === L) return accept(st) ? FULL : EMPTY;
      const key = l + '|' + keyOf(st);
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      const sub = new Uint32Array(64);
      for (let d = 0; d < 64; d++){
        const next = step(l, st, d);
        sub[d] = next === null ? EMPTY : build(l + 1, next);
      }
      const lev = 2 * (L - l), outer = new Uint32Array(8);
      for (let k = 0; k < 8; k++) outer[k] = intern(lev - 1, sub.subarray(8 * k, 8 * k + 8));
      const id = intern(lev, outer);
      memo.set(key, id);
      return id;
    };
    const root = build(0, start);
    return { root, D: 2 * L, states: memo.size };
  }

  /* Top-down, from a classifier of node boxes: ifsandwhats.md §8.5 step 4
     (docs/stream-plan.md, decision 13). cell(k, x, y, z) looks at the
     level-k node at node coordinates (x, y, z), i.e. voxels
     [x·2^k, (x+1)·2^k) on each axis, and answers 0 (empty), 1 (full) or
     -1 (can't tell, split it). At level 0 it must answer 0 or 1.
     Only undecided nodes are split, so a smooth solid costs its surface:
     a D = 12 sphere visits ~10^8 fewer voxels than fromDense would.

     A full level-k node is interned as eight full level-(k−1) nodes,
     which is exactly what fromDense makes of a solid block, so the two
     builders give the same id for the same voxels in one store. The tests
     use that: equal sets are equal ids. Each level has its own child
     buffer, because intern() copies the 8 ids only once all 8 exist. */
  const solids = [FULL];
  function solid(k){
    while (solids.length <= k) solids.push(intern(solids.length, new Uint32Array(8).fill(solids[solids.length - 1])));
    return solids[k];
  }
  function fromField(D, cell){
    const buf = Array.from({ length: D + 1 }, () => new Uint32Array(8));
    const build = (k, x, y, z) => {
      const v = cell(k, x, y, z);
      if (v === 0) return EMPTY;
      if (v === 1) return solid(k);
      if (k === 0) throw new Error(`fromField: undecided voxel (${x}, ${y}, ${z})`);
      const ch = buf[k];
      for (let o = 0; o < 8; o++) ch[o] = build(k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
      return intern(k, ch);
    };
    return { root: build(D, 0, 0, 0), D };
  }

  /* What a worker needs to walk the DAG, as one transferable array: the
     node keys (level + 8 child ids, 9 words a node) in id order. storeView
     reads it back. Copied, so the store can keep growing. */
  const snapshot = () => ({ keys: nodes.keys.slice(0, nodes.size * 9) });
  /* The keys of every node from id `from` on: what an edit adds. Ids only ever
     append, so this is all a worker's view needs to catch up (storeView's grow,
     docs/realtimecsg.md §4.2). */
  const keysFrom = from => nodes.keys.slice((from - FIRST_NODE) * 9, nodes.size * 9);

  // The §8.5 oracle query: walk D levels, one octant per level.
  function query(root, D, x, y, z){
    let id = root;
    for (let k = D - 1; k >= 0 && id >= FIRST_NODE; k--)
      id = child(id, ((x >> k) & 1) | (((y >> k) & 1) << 1) | (((z >> k) & 1) << 2));
    return id === FULL ? 1 : 0;
  }

  function expand(root, D){
    const R = 1 << D, occ = new Uint8Array(R * R * R);
    const fill = (id, k, x, y, z) => {
      if (id === EMPTY) return;
      if (k === 0){ occ[x + R * (y + R * z)] = 1; return; }
      const h = 1 << (k - 1);
      for (let o = 0; o < 8; o++)
        fill(child(id, o), k - 1, x + (o & 1) * h, y + ((o >> 1) & 1) * h, z + (o >> 2) * h);
    };
    fill(root, D, 0, 0, 0);
    return occ;
  }

  /* g·n by materializing it: the slow, obviously-right definition. The
     experiment never calls this (at R=256 it would create up to 48x the
     store); the tests use it as the independent check on classes(). */
  const tmemo = new Map();
  function transform(id, e){
    if (id < FIRST_NODE || e === 0) return id;
    const key = id * 48 + e;
    const hit = tmemo.get(key);
    if (hit !== undefined) return hit;
    const ch = new Uint32Array(8);
    for (let o = 0; o < 8; o++) ch[OCT[e*8 + o]] = transform(child(id, o), e);
    const out = intern(levelOf(id), ch);
    tmemo.set(key, out);
    return out;
  }

  /* ---- composing DAGs (docs/scatter-plan.md, decision 7) -----------------
     The scatter world is a terrain with a thousand specimens grafted in,
     each at an offset of its own. These three build it in one store.

     union(a, b): the voxels of either, two nodes of the same level.
     Memoized per pair and hash-consed, so a union with nothing new in it
     costs nothing: EMPTY ∪ x = x, x ∪ x = x, and a solid node absorbs the
     other side without walking it (without that shortcut, a specimen
     block unioned into buried terrain would be walked to its voxels just
     to come out solid). */
  // solid(k) rather than solids[k]: a full block from fromDense has
  // solid(k)'s id, but only if solid(k) exists to compare with. Making it
  // costs at most one node a level.
  const isSolid = id => id === FULL || (id >= FIRST_NODE && solid(levelOf(id)) === id);
  const umemo = new Map();
  function union(a, b){
    if (a === b || b === EMPTY) return a;
    if (a === EMPTY) return b;
    if (isSolid(a)) return a;
    if (isSolid(b)) return b;
    const key = a < b ? a * 67108864 + b : b * 67108864 + a;   // ids < 2^26
    const hit = umemo.get(key);
    if (hit !== undefined) return hit;
    const ch = new Uint32Array(8);
    for (let o = 0; o < 8; o++) ch[o] = union(child(a, o), child(b, o));
    const out = intern(levelOf(a), ch);
    umemo.set(key, out);
    return out;
  }

  /* graft(root, D, k, blocks): `root` (level D) with each block's node
     (level k, at node coordinates x, y, z) unioned in. Only the paths
     down to the blocks are rebuilt; everything beside them keeps its id.
     Several blocks at one position are all unioned in. An EMPTY or solid
     node on the way down is split into its (implicit) children, so a
     block can land in empty air or inside the ground. */
  function graft(root, D, k, blocks){
    const kid = (id, lev, o) => id === EMPTY ? EMPTY : isSolid(id) ? solid(lev - 1) : child(id, o);
    const rec = (id, lev, list) => {
      if (!list.length) return id;
      if (lev === k){ let r = id; for (const b of list) r = union(r, b.node); return r; }
      const s = lev - 1 - k, parts = [[], [], [], [], [], [], [], []];
      for (const b of list) parts[((b.x >> s) & 1) | ((b.y >> s) & 1) << 1 | ((b.z >> s) & 1) << 2].push(b);
      const ch = new Uint32Array(8);
      for (let o = 0; o < 8; o++) ch[o] = rec(kid(id, lev, o), lev - 1, parts[o]);
      return intern(lev, ch);
    };
    return rec(root, D, blocks);
  }

  /* importKeys(keys): another store's nodes (a snapshot's `keys`, 9 words
     a node in id order) interned here, children first, so this store's
     ids stay children-first too. Returns the map from the other store's
     ids to this one's. The scatter world's workers each build their
     specimens' blocks in a store of their own; the main thread imports
     them, and hash-consing merges whatever they share. */
  function importKeys(keys){
    const n = keys.length / 9, map = new Uint32Array(n + FIRST_NODE), ch = new Uint32Array(8);
    map[EMPTY] = EMPTY; map[FULL] = FULL;
    for (let i = 0; i < n; i++){
      for (let o = 0; o < 8; o++) ch[o] = map[keys[9 * i + 1 + o]];
      map[i + FIRST_NODE] = intern(keys[9 * i], ch);
    }
    return map;
  }

  return { intern, levelOf, child, fromDense, fromRadix4, fromField, solid, snapshot, keysFrom, query, expand, transform, union, graft, importKeys,
           get size(){ return nodes.size; }, get maxId(){ return nodes.size + FIRST_NODE - 1; } };
}

/* ---- pruning ----------------------------------------------------------------
   A store keeps every node ever interned, and some builds intern a lot no
   root reaches: graft() unions the blocks that share a position, and the
   pieces it unioned stay behind. In the lattice at R = 5 (pitch 7, blocks
   of 8, so up to 8 specimens' pieces share a block) that was 54% of the
   store at gap 2 and 75% at gap 0; with a power-of-two pitch, none
   (docs/lattice3d-log.md §6). Every chunk worker gets a copy of the store,
   so they cost memory 5 times over.
   prune(keys, roots) keeps the nodes the roots reach, in the same order,
   renumbered from FIRST_NODE: the keys of a store holding only those, and
   `map` from old ids to new (0 for dropped ones). Ids being children-first
   makes it one sweep down the ids, no stack: by the time a node is
   reached, everything above it that could keep it has been seen. The
   result is still children-first, so importKeys takes it as it is. */
export function prune(keys, roots){
  const n = keys.length / 9, keep = new Uint8Array(n + FIRST_NODE);
  for (const r of roots) keep[r] = 1;
  for (let id = n + FIRST_NODE - 1; id >= FIRST_NODE; id--){
    if (!keep[id]) continue;
    for (let o = 1; o <= 8; o++) keep[keys[(id - FIRST_NODE) * 9 + o]] = 1;
  }
  const map = new Uint32Array(n + FIRST_NODE);
  map[FULL] = FULL;
  let m = 0;
  for (let id = FIRST_NODE; id < n + FIRST_NODE; id++) if (keep[id]) map[id] = FIRST_NODE + m++;
  const out = new Uint32Array(9 * m);
  for (let id = FIRST_NODE, j = 0; id < n + FIRST_NODE; id++){
    if (!keep[id]) continue;
    const i = (id - FIRST_NODE) * 9;
    out[j++] = keys[i];
    for (let o = 1; o <= 8; o++) out[j++] = map[keys[i + o]];
  }
  return { keys: out, map };
}
/* The world without the nodes its root doesn't reach, as a store: at
   R = 5 that's half to three quarters of a lattice's store, the pieces
   graft() unioned (docs/lattice3d-log.md §6), and 3–4% of the scatter
   world's (docs/lattice3d-log.md §8). A fresh store takes the pruned keys
   in order, so the root's new id is prune's map of the old. (The page's
   build worker skips the fresh store: it sends prune's keys, and the main
   thread reads them through storeView.) */
export function pruneWorld(store, root){
  const { keys, map } = prune(store.snapshot().keys, [root]), kept = keys.length / 9;
  if (kept === store.size) return { store, root, dropped: 0 };
  const fresh = createStore();
  fresh.importKeys(keys);
  return { store: fresh, root: map[root], dropped: store.size - kept };
}

/* ---- a read-only store ----------------------------------------------------
   The store as a chunk worker sees it (docs/stream-plan.md, decision 9):
   child, levelOf and query over a snapshot's keys, and nothing that
   interns. expandChunk, createCounts and createClasses only ever call
   child, levelOf and maxId, so they run on a view unchanged. The page
   holds a worker-built world as a view too (scatter-build.js): the
   streamer reads child, maxId and snapshot, so a view has snapshot.

   `grow` appends an edit's new nodes (the store's keysFrom), which is how a
   worker's view follows an edited world without being sent it again. The ids
   line up because a view and its store both hold every node ever interned, in
   order, so a tail that doesn't start where the view stopped has lost nodes, and
   it throws rather than read a wrong child later. size and maxId are getters
   because createCounts and createClasses read maxId to find what's new. */
export function storeView({ keys }){
  let n = keys.length / 9;
  const child = (id, o) => keys[(id - FIRST_NODE) * 9 + 1 + o];
  const levelOf = id => id < FIRST_NODE ? 0 : keys[(id - FIRST_NODE) * 9];
  function query(root, D, x, y, z){
    let id = root;
    for (let k = D - 1; k >= 0 && id >= FIRST_NODE; k--)
      id = child(id, ((x >> k) & 1) | (((y >> k) & 1) << 1) | (((z >> k) & 1) << 2));
    return id === FULL ? 1 : 0;
  }
  function grow(from, tail){
    if (from !== n + FIRST_NODE) throw new Error(`storeView.grow: this view stops at id ${n + FIRST_NODE - 1}, the tail starts at ${from}`);
    const want = (n * 9) + tail.length;
    if (want > keys.length){
      const k2 = new Uint32Array(Math.max(want, keys.length * 2));
      k2.set(keys.subarray(0, n * 9)); keys = k2;
    }
    keys.set(tail, n * 9);
    n += tail.length / 9;
  }
  return { child, levelOf, query, grow,
           snapshot: () => ({ keys: n * 9 === keys.length ? keys : keys.slice(0, n * 9) }),
           keysFrom: from => keys.slice((from - FIRST_NODE) * 9, n * 9),
           get size(){ return n; }, get maxId(){ return n + FIRST_NODE - 1; } };
}

/* ---- labelled classes (SSVDAG) without materializing anything -----------
   Two nodes are in the same H-class iff one is g·(the other) for some g
   in H. The labelled DAG stores one node per class, and every edge carries
   the g that turns the class representative into the actual child.

   Computed bottom-up over ids (children first). Each node n gets
   cls[n] and pose[n] with  n = pose[n] · rep(cls[n]).  For a candidate g,
   g·n has, at octant g(o), the child  g·pose(c)·rep(cls(c)),  c = n.child[o].
   That pose is only defined up to the representative's stabilizer
   (g·t·s for any s in Stab(rep) gives the same subtree), so it is
   normalized to the smallest element of its coset t·Stab. With that, the
   key of g·n (8 × (class, normalized pose)) is equal for two nodes iff the
   nodes are equal as voxel sets, so the class is the minimum key over g in
   H, and the g that reaches it says how n sits relative to the class rep.

   The stabilizer needs a conjugation. If g*·n = rep, then
   Stab(rep) = g*·Stab(n)·g*⁻¹ = {a·g*⁻¹ : a ∈ A}, where A is the set of
   g that reach the minimum key. I expected storing A itself to be a bug,
   but the mutation run (docs/hashcons-log.md) showed it is an equivalent
   mutant: A is the coset Stab(rep)·g*, so min(x·A) is still one-to-one on
   the cosets x·Stab(rep), and every class comes out the same. The
   conjugated form is kept because it makes each stored pose the
   *smallest* element of its coset, which is the label an SSVDAG edge
   would actually carry.

   The result is incremental: call update() again after interning more
   roots and only the new ids are processed. */
export function createClasses(store, H){
  const inH = new Uint8Array(48);
  for (const e of H) inH[e] = 1;
  for (const a of H) for (const b of H)
    if (!inH[MUL[a*48 + b]]) throw new Error('createClasses: H is not closed under composition');

  const classes = new Interner(9, 0);
  let cls = new Int32Array(1024), pose = new Uint8Array(1024);
  // Per class: its stabilizer as the coset-normalizing table NORM[c*48+x]
  // = min over s in Stab of x∘s. Empty and full voxels are fixed by
  // everything, so their poses all normalize to the identity.
  let norm = new Uint8Array(48 * 64), stabOrder = new Uint8Array(64), levelOfClass = new Uint8Array(64);
  const key = new Uint32Array(9), best = new Uint32Array(9);
  let done = FIRST_NODE;

  function setStab(c, stab){
    if ((c + 1) * 48 > norm.length){
      const n2 = new Uint8Array(norm.length * 2); n2.set(norm); norm = n2;
      const s2 = new Uint8Array(stabOrder.length * 2); s2.set(stabOrder); stabOrder = s2;
      const l2 = new Uint8Array(levelOfClass.length * 2); l2.set(levelOfClass); levelOfClass = l2;
    }
    stabOrder[c] = stab.length;
    for (const x of H){
      let m = 255;
      for (const s of stab){ const v = MUL[x*48 + s]; if (v < m) m = v; }
      norm[c*48 + x] = m;
    }
  }
  // Classes 0 and 1: EMPTY and FULL, at "level 0" for both.
  key.fill(0); key[0] = 0xffffffff; key[1] = 0; classes.intern(key);
  key[1] = 1; classes.intern(key);
  setStab(0, H); setStab(1, H);
  const C = id => id < FIRST_NODE ? id : cls[id];
  const P = id => id < FIRST_NODE ? 0 : pose[id];

  function update(){
    const top = store.maxId;
    if (top >= cls.length){
      let n = cls.length; while (n <= top) n *= 2;
      const c2 = new Int32Array(n); c2.set(cls); cls = c2;
      const p2 = new Uint8Array(n); p2.set(pose); pose = p2;
    }
    const A = [];
    for (let id = done; id <= top; id++){
      const lev = store.levelOf(id);
      best[0] = 0xffffffff; A.length = 0;
      for (const g of H){
        key[0] = lev;
        for (let o = 0; o < 8; o++){
          const c = store.child(id, o), cc = C(c);
          key[1 + OCT[g*8 + o]] = cc * 64 + norm[cc*48 + MUL[g*48 + P(c)]];
        }
        let cmp = 0;
        for (let k = 0; k < 9 && !cmp; k++) cmp = key[k] < best[k] ? -1 : key[k] > best[k] ? 1 : 0;
        if (cmp < 0){ best.set(key); A.length = 0; A.push(g); }
        else if (cmp === 0) A.push(g);
      }
      const before = classes.size;
      const c = classes.intern(best);
      const gStar = A[0];
      if (c === before){
        // New class: its representative is gStar·n, so Stab(rep) = A·gStar⁻¹.
        const stab = A.map(a => MUL[a*48 + INV[gStar]]);
        setStab(c, stab);
        levelOfClass[c] = lev;
      }
      cls[id] = c;
      pose[id] = INV[gStar];      // n = gStar⁻¹ · rep
    }
    done = top + 1;
  }

  update();
  return {
    update,
    // Ids interned after the last update() have no class yet; reading one
    // is a caller bug (the tests hit it once), so it throws, not returns 0.
    cls: id => { if (id >= done) throw new Error(`classes: id ${id} not classified, call update()`); return C(id); },
    pose: id => { if (id >= done) throw new Error(`classes: id ${id} not classified, call update()`); return P(id); },
    stabOrder: c => stabOrder[c],
    // |Stab(n)| = |Stab(rep)|, since the two are conjugate.
    stabOfNode: id => stabOrder[C(id)],
    get size(){ return classes.size; }
  };
}

/* ---- voxel counts -------------------------------------------------------
   How many voxels each node holds: the "one word per node" that coverage-
   preserving LOD needs (docs/coverage-plan.md). A coarse cell at lod l is
   a level-l node, and its count says how full it is, which "any" throws
   away.

   Float64, not Uint32: a rule row at L = 8 holds 8^16 = 2^48 voxels under
   its root. A double is exact to 2^53, so the sum is exact up to D = 17,
   and counts are only ever summed, never multiplied. Like createClasses
   it walks ids in order (children first) and is incremental. */
export function createCounts(store){
  let n = new Float64Array(1024);
  n[FULL] = 1;
  let done = FIRST_NODE;
  function update(){
    const top = store.maxId;
    if (top >= n.length){
      let len = n.length; while (len <= top) len *= 2;
      const n2 = new Float64Array(len); n2.set(n); n = n2;
    }
    for (let id = done; id <= top; id++){
      let c = 0;
      for (let o = 0; o < 8; o++) c += n[store.child(id, o)];
      n[id] = c;
    }
    done = top + 1;
  }
  update();
  return {
    update,
    of: id => { if (id >= done) throw new Error(`counts: id ${id} not counted, call update()`); return n[id]; },
  };
}

/* Is this node completely full? Asking `count === 8^level` is exact only up to
   level 17: past 2^53 a count can't feel a voxel, so a level-18 node with a
   one-voxel hole has 8^18 − 1 → 8^18 and passes (docs/edit-log.md §2, where this
   made a job differ from expandChunk). Hash-consing gives an exact test instead:
   the solid node of a level has eight identical children, each the solid node
   below it, and nothing else does. So above level 17 walk down those; the count
   has already turned away nearly everything, and a read-only storeView can do it,
   having no solid() to ask. At most 8 reads a level, on the few nodes that pass
   the count. Below level 18 this is the count test, at the count test's price. */
export const COUNT_EXACT_LEVEL = 17;
const POW8 = Float64Array.from({ length: 64 }, (_, k) => 8 ** k);
export function isFull(store, counts, id, level){
  if (counts.of(id) !== POW8[level]) return false;
  for (let k = level; k > COUNT_EXACT_LEVEL; k--){
    const c = store.child(id, 0);
    for (let o = 1; o < 8; o++) if (store.child(id, o) !== c) return false;
    id = c;
  }
  return level <= COUNT_EXACT_LEVEL || counts.of(id) === POW8[COUNT_EXACT_LEVEL];
}

/* ---- census -------------------------------------------------------------
   For a set of roots in one store: per level, the tree (SVO) count, the
   unique (DAG) count and, for each labelled view given, the class count.
   SVO counts use path multiplicity rather than walking the tree, so they
   stay cheap when the tree is huge and the DAG is small. Level 0 of `svo`
   is the voxel count.

   Only nodes reachable from `roots` are visited: the experiment interns a
   whole corpus into one store, and scanning every id per specimen made
   the R=256 run quadratic in the corpus size. Reachable ids are processed
   in descending order, which visits parents before children because a
   child is always interned before its parent.

   The byte models need child counts as well as node counts:
   - kids[k]: non-empty children summed over unique level-k nodes (SVDAG);
   - grandkids[k]: non-empty grandchildren summed over unique level-k
     nodes, i.e. how many 4³ children a 64-tree node has;
   - classKids[i][k]: non-empty children summed over view i's classes, one
     member standing in for each class (all members have the same count).
   `depth` sizes the per-level arrays; by default it is the deepest root's
   level, which is 0 when every root is EMPTY. */
export function census(store, roots, views = [], depth = 0){
  const live = [], mark = new Set();
  for (const r of roots) if (r >= FIRST_NODE && !mark.has(r)){ mark.add(r); live.push(r); }
  for (let i = 0; i < live.length; i++){
    const id = live[i];
    for (let o = 0; o < 8; o++){
      const c = store.child(id, o);
      if (c >= FIRST_NODE && !mark.has(c)){ mark.add(c); live.push(c); }
    }
  }
  const ids = Int32Array.from(live).sort().reverse();
  const mult = new Map();
  let D = depth;
  for (const r of roots) if (r >= FIRST_NODE){ mult.set(r, (mult.get(r) || 0) + 1); D = Math.max(D, store.levelOf(r)); }
  const Z = () => new Float64Array(D + 1);
  const svo = Z(), dag = Z(), kids = Z(), grandkids = Z();
  const seen = views.map(() => Array.from({ length: D + 1 }, () => new Set()));
  const classKids = views.map(Z);
  for (const id of ids){
    const m = mult.get(id), lev = store.levelOf(id);
    svo[lev] += m; dag[lev] += 1;
    let nk = 0;
    for (let o = 0; o < 8; o++){
      const c = store.child(id, o);
      if (c === EMPTY) continue;
      nk++;
      if (c === FULL){ svo[0] += m; continue; }
      mult.set(c, (mult.get(c) || 0) + m);
      for (let p = 0; p < 8; p++) if (store.child(c, p) !== EMPTY) grandkids[lev]++;
    }
    kids[lev] += nk;
    views.forEach((v, i) => {
      const set = seen[i][lev], k = v.cls(id);
      if (!set.has(k)){ set.add(k); classKids[i][lev] += nk; }
    });
  }
  return { D, svo, dag, kids, grandkids, classKids,
           classes: seen.map(levels => levels.map(s => s.size)) };
}
