/* A sketch of runtime CSG over the DAG (docs/realtimecsg.md). Not an engine
   change: no core file is touched, no viewer, no tests of its own beyond
   the oracle below. It exists to answer "what would an edit cost?" with
   numbers before anything is decided.

   Everything is built on a dag-core store's public surface (intern, child,
   solid, levelOf), so an edited world is an ordinary root in an ordinary
   store. The operations:

   - difference / intersect: union()'s two siblings, memoized per pair of
     nodes. Bryant's BDD apply (1986), on an octree. A solid is an ordinary
     node with eight solid children, so the walk is right without any special
     case and hash-consing makes the answer canonical, but a solid operand
     needs its shortcut anyway: the first version walked everything under the
     plane's solid half to come out empty, 1.3 s on the D = 12 caves for 7,731
     new nodes. dag-core's union comment warns of the same trap.
   - carve / add: a world and a *field*, fromField's three-valued cell test
     (0 outside, 1 inside, −1 can't tell). The brush has no DAG, so it can
     sit anywhere and at any angle. Only the cells the brush's surface
     passes through are walked.
   - halfSpace: the half-space automaton of ifsandwhats.md §10.2 as a DAG,
     memoized on (level, residual): an exact oblique cut at any depth.
   - shift: a world translated by any integer offset. A node of the result
     straddles 8 nodes of the source, so the memo is on 8 ids. Free below
     the offset's lowest set bit, where the grids line up again.
   - rewrite: swap one node for another everywhere, by one sweep up the
     ids. "Edit the part" rather than "edit the place".
   - diffChunks: which chunks a new root changed, read off the two graphs.
   - for sculpting (§10): ellipsoid and box brushes, place (a snapped block
     as one path), pick (ray to voxel and face), brickDirty (the sharper dirty
     test), patchChunk (redo a chunk's changed bricks and splice), and
     editedColour (§5's option B).

   - for block editing (§11): clicks (a session of real picks and snapped
     blocks), flatWorld, growOneSided and growCentred (what "expanding" could
     mean), and blockColour (a colour for each snapped block, by hash).

   The oracle runs first and throws on any disagreement: every operation
   against a dense byte grid at D = 7 and on a kit at D = 8.

   node experiments/csg-sketch.mjs            everything (~25 min)
   node experiments/csg-sketch.mjs --quick    caves at D = 10, fewer points
   node experiments/csg-sketch.mjs --only=de  only those sections (a to p)
   It measures job times, so run it on an idle machine: single-thread ms
   here run under whatever else the machine is doing. */
import { createStore, createCounts, createClasses, prune, EMPTY, FULL, FIRST_NODE, OH48 } from '../dag-core.js';
import { expandChunk, chunkNode, nodeAt, cellAttr, packRecord, mortonOf, boundaryBits, CELL_MASK } from '../chunk-core.js';
import { createWorld, selectChunks, chunkFootprint, DEFAULTS, SIDES } from '../stream-core.js';
import { kitDesc, buildKit, partOcc, PARTS, PART } from '../kit-core.js';
import { caveDesc, buildCaves } from '../cave-core.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { colourOf } from '../colours.js';
import { rgb8 } from '../attr-core.js';

const QUICK = process.argv.includes('--quick');
const now = () => performance.now();
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const fmt = n => n >= 100 ? Math.round(n).toLocaleString('en-US') : n >= 10 ? n.toFixed(1) : n.toFixed(2);
const int = n => Math.round(n).toLocaleString('en-US');
const NODE_BYTES = 36;                   // 9 words a node in the store
const TAIL_BYTES = 36 + 8 + 1;           // what a worker must receive: key, count, pose

/* ---- booleans ------------------------------------------------------------ */
const kidOf = (store, id, o) => id < FIRST_NODE ? EMPTY : store.child(id, o);

function difference(store, A, B, stats = {}){
  const memo = new Map(), ch = Array.from({ length: 64 }, () => new Uint32Array(8));
  const rec = (a, b) => {
    if (a === EMPTY || a === b) return EMPTY;
    if (b === EMPTY) return a;
    if (a === FULL) return a;                   // b is EMPTY or FULL, both taken above
    const k = store.levelOf(a);
    if (b === store.solid(k)) return EMPTY;
    const key = a * 67108864 + b, hit = memo.get(key);
    if (hit !== undefined) return hit;
    const c = ch[k];
    for (let o = 0; o < 8; o++) c[o] = rec(store.child(a, o), kidOf(store, b, o));
    const out = store.intern(k, c);
    memo.set(key, out);
    return out;
  };
  const r = rec(A, B);
  stats.pairs = memo.size;
  return r;
}
function intersect(store, A, B, stats = {}){
  const memo = new Map(), ch = Array.from({ length: 64 }, () => new Uint32Array(8));
  const rec = (a, b) => {
    if (a === EMPTY || b === EMPTY) return EMPTY;
    if (a === b) return a;
    const k = store.levelOf(a), full = store.solid(k);
    if (a === full) return b;
    if (b === full) return a;
    const key = a < b ? a * 67108864 + b : b * 67108864 + a, hit = memo.get(key);
    if (hit !== undefined) return hit;
    const c = ch[k];
    for (let o = 0; o < 8; o++) c[o] = rec(store.child(a, o), store.child(b, o));
    const out = store.intern(k, c);
    memo.set(key, out);
    return out;
  };
  const r = rec(A, B);
  stats.pairs = memo.size;
  return r;
}
function unionOf(store, A, B, stats = {}){
  // store.union keeps its memo for the store's life; a fresh one per op is
  // what a long session would want, so it's written again here.
  const memo = new Map(), ch = Array.from({ length: 64 }, () => new Uint32Array(8));
  const rec = (a, b) => {
    if (a === b || b === EMPTY) return a;
    if (a === EMPTY) return b;
    const k = store.levelOf(a), full = store.solid(k);
    if (a === full || b === full) return full;
    const key = a < b ? a * 67108864 + b : b * 67108864 + a, hit = memo.get(key);
    if (hit !== undefined) return hit;
    const c = ch[k];
    for (let o = 0; o < 8; o++) c[o] = rec(store.child(a, o), store.child(b, o));
    const out = store.intern(k, c);
    memo.set(key, out);
    return out;
  };
  const r = rec(A, B);
  stats.pairs = memo.size;
  return r;
}

/* ---- field brushes: a world and fromField's cell test --------------------
   cell(k, x, y, z) is the brush at the level-k cell (x, y, z): 0, 1 or −1. */
function carve(store, root, D, cell, stats = {}){
  const ch = Array.from({ length: D + 1 }, () => new Uint32Array(8));
  let visited = 0;
  const rec = (id, k, x, y, z) => {
    if (id === EMPTY) return EMPTY;
    const v = cell(k, x, y, z);
    if (v === 0) return id;
    if (v === 1) return EMPTY;
    visited++;
    const c = ch[k];
    for (let o = 0; o < 8; o++) c[o] = rec(store.child(id, o), k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
    return store.intern(k, c);
  };
  const r = rec(root, D, 0, 0, 0);
  stats.visited = visited;
  return r;
}
function add(store, root, D, cell, stats = {}){
  const ch = Array.from({ length: D + 1 }, () => new Uint32Array(8));
  let visited = 0;
  const rec = (id, k, x, y, z) => {
    const v = cell(k, x, y, z);
    if (v === 0) return id;
    if (v === 1) return store.solid(k);
    if (id !== EMPTY && id === store.solid(k)) return id;
    visited++;
    const c = ch[k];
    for (let o = 0; o < 8; o++) c[o] = rec(kidOf(store, id, o), k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
    return store.intern(k, c);
  };
  const r = rec(root, D, 0, 0, 0);
  stats.visited = visited;
  return r;
}
/* A ball, exact: voxel i is inside iff its centre i + ½ is within r of c.
   A cell's voxel centres fill a box, so the box's nearest and farthest
   points from c decide it. */
const ball = (cx, cy, cz, r) => (k, x, y, z) => {
  const s = 2 ** k, r2 = r * r;
  let near = 0, far = 0;
  for (const [i, c] of [[x, cx], [y, cy], [z, cz]]){
    const lo = i * s + 0.5, hi = (i + 1) * s - 0.5;
    const d = c < lo ? lo - c : c > hi ? c - hi : 0, f = Math.max(Math.abs(c - lo), Math.abs(hi - c));
    near += d * d; far += f * f;
  }
  return near > r2 ? 0 : far <= r2 ? 1 : k === 0 ? (near <= r2 ? 1 : 0) : -1;
};
/* A box of half-side h turned about an axis by an angle: any angle at all,
   since the brush is a field, not a DAG. Exact at voxels; above them, a
   Lipschitz test, as shapes.mjs's fieldOf does. */
function orientedBox(cx, cy, cz, h, angle = 0.6){
  const c = Math.cos(angle), s = Math.sin(angle), R3 = Math.sqrt(3);
  const f = (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    const u = c * px + s * pz, w = -s * px + c * pz;
    const v = c * py + s * w, t = -s * py + c * w;
    const dx = Math.abs(u) - h, dy = Math.abs(v) - h, dz = Math.abs(t) - h;
    const out = Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0));
    return out + Math.min(Math.max(dx, dy, dz), 0);
  };
  return (k, x, y, z) => {
    const S = 2 ** k;
    const v = f((x + 0.5) * S, (y + 0.5) * S, (z + 0.5) * S);
    if (k === 0) return v <= 0 ? 1 : 0;
    const r = R3 * (S - 1) / 2 + 1e-9;
    return v > r ? 0 : v < -r ? 1 : -1;
  };
}

/* The half-space a·i ≤ c over voxel indices i, a ≥ 0, as a DAG. A node is a
   function of its level and its residual r = c − a·corner, and that is the
   whole automaton. All in when even the far corner passes, none when the
   near one fails. */
function halfSpace(store, D, a, c){
  const sum = a[0] + a[1] + a[2], memo = new Map(), ch = Array.from({ length: D + 1 }, () => new Uint32Array(8));
  const rec = (k, r) => {
    if (r < 0) return EMPTY;
    if (r >= sum * (2 ** k - 1)) return store.solid(k);
    const key = r * 64 + k, hit = memo.get(key);
    if (hit !== undefined) return hit;
    const h = 2 ** (k - 1), out = new Uint32Array(8);
    for (let o = 0; o < 8; o++) out[o] = rec(k - 1, r - h * ((o & 1) * a[0] + (o >> 1 & 1) * a[1] + (o >> 2) * a[2]));
    const id = store.intern(k, out);
    memo.set(key, id);
    return id;
  };
  return { root: rec(D, c), states: memo.size };
}

/* ---- translation by any offset --------------------------------------------
   window(k, block, w): the level-k cube at low corner w inside a 2×2×2
   block of level-k nodes. Each result octant is a window one level down
   inside a 2×2×2 of the block's 4×4×4 grandchildren. w mod 2^(k−1) is the
   same for every call at a level, so the memo needs only the 8 ids. Once
   the low bits of w are all zero the grids line up and the answer is block
   element 0, unwalked, which is why a power-of-two offset costs little. */
function shift(store, root, D, d, stats = {}){
  const S = 2 ** D, w0 = d.map(v => v > 0 ? S - v : 0);
  const top = new Uint32Array(8);
  top[(d[0] > 0 ? 1 : 0) | (d[1] > 0 ? 2 : 0) | (d[2] > 0 ? 4 : 0)] = root;
  const memos = Array.from({ length: D + 1 }, () => new Map());
  const rec = (k, b, wx, wy, wz) => {
    if (k === 0 || (wx | wy | wz) === 0) return b[0];
    let any = 0; for (let i = 0; i < 8; i++) any |= b[i];
    if (!any) return EMPTY;
    const key = b.join(), memo = memos[k], hit = memo.get(key);
    if (hit !== undefined) return hit;
    const h = 2 ** (k - 1), g = new Uint32Array(64);
    for (let o = 0; o < 8; o++) for (let p = 0; p < 8; p++){
      const X = 2 * (o & 1) + (p & 1), Y = 2 * (o >> 1 & 1) + (p >> 1 & 1), Z = 2 * (o >> 2) + (p >> 2);
      g[X + 4 * Y + 16 * Z] = kidOf(store, b[o], p);
    }
    const out = new Uint32Array(8), sub = new Uint32Array(8);
    for (let O = 0; O < 8; O++){
      const X = wx + (O & 1) * h, Y = wy + (O >> 1 & 1) * h, Z = wz + (O >> 2) * h;
      const ix = Math.floor(X / h), iy = Math.floor(Y / h), iz = Math.floor(Z / h);
      for (let p = 0; p < 8; p++) sub[p] = g[(ix + (p & 1)) + 4 * (iy + (p >> 1 & 1)) + 16 * (iz + (p >> 2))];
      out[O] = rec(k - 1, sub.slice(), X % h, Y % h, Z % h);
    }
    const id = store.intern(k, out);
    memo.set(key, id);
    return id;
  };
  const r = rec(D, top, ...w0);
  stats.states = memos.reduce((a, m) => a + m.size, 0);
  return r;
}

/* ---- rewrite: swap nodes everywhere ---------------------------------------
   One sweep up the ids (children first, so a node's children are already
   mapped). `swap` maps ids to ids; nothing else is walked. */
function rewrite(store, swap){
  const top = store.maxId, map = new Uint32Array(top + 1), ch = new Uint32Array(8);
  map[FULL] = FULL;
  for (let id = FIRST_NODE; id <= top; id++){
    if (swap.has(id)){ map[id] = swap.get(id); continue; }
    let same = true;
    for (let o = 0; o < 8; o++){ const c = store.child(id, o); ch[o] = map[c]; if (ch[o] !== c) same = false; }
    map[id] = same ? id : store.intern(store.levelOf(id), ch);
  }
  return map;
}

/* ---- which chunks a new root changed --------------------------------------
   Walk the two graphs together, stopping wherever the ids agree: equal id,
   equal voxels, so a change can't be below. That's every lod at once, and
   costs the changed nodes, not the world. */
function diffChunks(store, A, B, D){
  const dirty = new Map();
  const rec = (a, b, k, x, y, z) => {
    if (a === b || k < CHUNK_SIDE_LEVELS) return;
    const lod = k - CHUNK_SIDE_LEVELS, key = lod + ':' + x + ',' + y + ',' + z;
    dirty.set(key, { key, lod, x, y, z });
    for (let o = 0; o < 8; o++) rec(kidOf(store, a, o), kidOf(store, b, o), k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
  };
  rec(A, B, D, 0, 0, 0);
  return dirty;
}
const CHUNK_SIDE_LEVELS = 6;
// A chunk's job reads its own node and its six face neighbours (the apron and
// the seam tail's coarser cell), and nothing else.
function dilate(dirty){
  const out = new Map(dirty);
  for (const c of dirty.values()) for (const [dx, dy, dz] of SIDES){
    const x = c.x + dx, y = c.y + dy, z = c.z + dz;
    if (x < 0 || y < 0 || z < 0) continue;
    const key = c.lod + ':' + x + ',' + y + ',' + z;
    if (!out.has(key)) out.set(key, { key, lod: c.lod, x, y, z });
  }
  return out;
}
/* How many 8³ bricks of a lod-0 chunk an edit touches: the walk above, on down
   to level 3, then each changed brick's six neighbours (its cells' faces
   read them). A patch job would redo these and splice; nobody has written
   one, so this is the size of the opportunity, not a measured patch. */
function dirtyBricks(store, A, B, D){
  const set = new Set();
  const rec = (a, b, k, x, y, z) => {
    if (a === b) return;
    if (k === 3){ set.add(x + ',' + y + ',' + z); return; }
    for (let o = 0; o < 8; o++) rec(kidOf(store, a, o), kidOf(store, b, o), k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
  };
  rec(A, B, D, 0, 0, 0);
  const grown = new Set(set);
  for (const key of set){
    const [x, y, z] = key.split(',').map(Number);
    for (const [a, b, c] of SIDES) if (x + a >= 0 && y + b >= 0 && z + c >= 0) grown.add((x + a) + ',' + (y + b) + ',' + (z + c));
  }
  const chunks = new Set();
  for (const key of grown){ const [x, y, z] = key.split(',').map(Number); chunks.add((x >> 3) + ',' + (y >> 3) + ',' + (z >> 3)); }
  return { bricks: grown.size, chunks: chunks.size };
}
/* A chunk's stamp: its node and its six neighbours, everything its job reads.
   Equal stamps, equal job. Reading them all for one cut is the alternative
   to diffing two roots, and it works however wide the edit is. */
function stampOf(store, root, D, c){
  const out = [chunkNode(store, root, D, c.lod, c.x, c.y, c.z).id];
  for (const [a, b, e] of SIDES) out.push(chunkNode(store, root, D, c.lod, c.x + a, c.y + b, c.z + e).id);
  return out;
}
const sameStamp = (p, q) => p.every((v, i) => v === q[i]);

/* A job, as createJobRunner does it: the buried shortcut, then expandChunk
   with seams, adaptive above lod 0, and the world's colour. */
function job(store, root, D, counts, colour, c){
  const full = (x, y, z) => {
    const id = chunkNode(store, root, D, c.lod, x, y, z).id;
    return id !== EMPTY && counts.of(id) === 8 ** (c.lod + 6);
  };
  if (D >= c.lod + 6 && full(c.x, c.y, c.z) && SIDES.every(([a, b, e]) => full(c.x + a, c.y + b, c.z + e))) return { records: new Uint32Array(0) };
  return expandChunk(store, root, D, { lod: c.lod, cx: c.x, cy: c.y, cz: c.z },
                     { counts, lodRule: c.lod === 0 ? 'any' : 'adaptive', seams: true, colour, meanDepth: 1 });
}

/* ---- surface points -------------------------------------------------------
   Drop down a column from the sky: the topmost voxel of (x, z). Upper octants
   first, so it costs the nodes it passes, however tall the world. */
function drop(store, root, D, x, z){
  const rec = (id, k, y0) => {
    if (id === EMPTY) return -1;
    if (k === 0) return y0;
    const b = ((x >> (k - 1)) & 1) | (((z >> (k - 1)) & 1) << 2);
    let r = rec(store.child(id, b | 2), k - 1, y0 + 2 ** (k - 1));
    if (r < 0) r = rec(store.child(id, b), k - 1, y0);
    return r;
  };
  return rec(root, D, 0);
}
function mulberry(seed){ let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function surfacePoints(w, n, margin){
  const rand = mulberry(12345), S = 2 ** w.D, pts = [];
  for (let tries = 0; pts.length < n && tries < n * 200; tries++){
    const x = Math.floor(margin + rand() * (S - 2 * margin)), z = Math.floor(margin + rand() * (S - 2 * margin));
    const y = drop(w.store, w.root, w.D, x, z);
    if (y >= margin && y < S - margin) pts.push([x + 0.5, y + 0.5, z + 0.5]);
  }
  return pts;
}
function fresh(w){
  const store = createStore(), map = store.importKeys(w.store.snapshot().keys);
  return { ...w, store, root: map[w.root] };
}

/* ---- the oracle: every operation against dense bytes --------------------- */
function oracle(){
  const D = 7, R = 2 ** D, store = createStore();
  const idx = (x, y, z) => x + R * (y + R * z);
  const rand = mulberry(99);
  // Two lumpy bodies with real solid regions and real air, not white noise.
  const body = () => {
    const blobs = Array.from({ length: 12 }, () => [rand() * R, rand() * R, rand() * R, 6 + rand() * 24]);
    const occ = new Uint8Array(R * R * R);
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++)
      for (const [a, b, c, r] of blobs) if ((x + 0.5 - a) ** 2 + (y + 0.5 - b) ** 2 + (z + 0.5 - c) ** 2 <= r * r){ occ[idx(x, y, z)] = 1; break; }
    return occ;
  };
  const oa = body(), ob = body();
  const A = store.fromDense(oa, R).root, B = store.fromDense(ob, R).root;
  const same = (root, want, name) => {
    const got = store.expand(root, D);
    for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) throw new Error(`oracle: ${name} differs at ${i}`);
    if (store.fromDense(want, R).root !== root) throw new Error(`oracle: ${name} isn't canonical`);
  };
  const map2 = f => { const o = new Uint8Array(R ** 3); for (let i = 0; i < o.length; i++) o[i] = f(oa[i], ob[i]); return o; };
  same(difference(store, A, B), map2((a, b) => a && !b ? 1 : 0), 'difference');
  same(intersect(store, A, B), map2((a, b) => a && b ? 1 : 0), 'intersect');
  same(unionOf(store, A, B), map2((a, b) => a || b ? 1 : 0), 'union');
  same(difference(store, store.solid(D), A), oa.map(v => v ? 0 : 1), 'complement');
  for (const [name, cell, inside] of [
    ['ball', ball(40.5, 70.25, 55, 23.7), (x, y, z) => (x + 0.5 - 40.5) ** 2 + (y + 0.5 - 70.25) ** 2 + (z + 0.5 - 55) ** 2 <= 23.7 ** 2],
    ['turned box', orientedBox(64, 60, 70, 20), (x, y, z) => orientedBox(64, 60, 70, 20)(0, x, y, z) === 1],
  ]){
    const brush = new Uint8Array(R ** 3);
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) brush[idx(x, y, z)] = inside(x, y, z) ? 1 : 0;
    same(carve(store, A, D, cell), oa.map((v, i) => v && !brush[i] ? 1 : 0), 'carve ' + name);
    same(add(store, A, D, cell), oa.map((v, i) => v || brush[i] ? 1 : 0), 'add ' + name);
    // Canonical: the brush as a DAG, by fromField, gives the same answer.
    const asDag = store.fromField(D, cell).root;
    same(asDag, brush, 'fromField ' + name);
    if (difference(store, A, asDag) !== carve(store, A, D, cell)) throw new Error('oracle: field and DAG brushes disagree');
    // Undo by the inverse, and it's the same id: a stamp leaves no trace.
    const cut = carve(store, A, D, cell), taken = intersect(store, A, asDag);
    if (unionOf(store, cut, taken) !== A) throw new Error('oracle: (A − b) ∪ (A ∩ b) isn\'t A');
  }
  for (const [a, c] of [[[1, 2, 3], 300], [[37, 61, 101], 9000]]){
    const { root } = halfSpace(store, D, a, c), want = new Uint8Array(R ** 3);
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) want[idx(x, y, z)] = a[0] * x + a[1] * y + a[2] * z <= c ? 1 : 0;
    same(root, want, 'half-space');
  }
  for (const d of [[1, 0, 0], [5, 3, 7], [64, 0, 32], [0, 0, 0], [127, 1, 90]]){
    const want = new Uint8Array(R ** 3);
    for (let z = d[2]; z < R; z++) for (let y = d[1]; y < R; y++) for (let x = d[0]; x < R; x++) want[idx(x, y, z)] = oa[idx(x - d[0], y - d[1], z - d[2])];
    same(shift(store, A, D, d), want, 'shift ' + d);
  }
  // diffChunks + dilate against the job itself: outside the dilated set, no
  // chunk's job output may change. On a kit at D = 8, every chunk at every lod.
  // And on a gyroid at D = 9, where the seam tail and the adaptive rule have
  // porous content to disagree about, with a carve and an add.
  let checked = 0;
  const K = buildKit(kitDesc({ D: 8 })), G = shapeWorld('gyroid', 9);
  for (const [w, D, edits] of [[K, 8, [[carve, ball(130, 60, 100, 20)]]], [G, 9, [[carve, ball(260, 200, 300, 40)], [add, ball(100, 330, 140, 25)]]]]){
    const s = w.store, counts = createCounts(s);
    for (const [fn, brush] of edits){
      const before = w.root, after = fn(s, before, D, brush);
      counts.update();
      const dirty = dilate(diffChunks(s, before, after, D));
      for (let lod = 0; lod <= D - 6; lod++){
        const g = 2 ** (D - lod - 6);
        for (let z = 0; z < g; z++) for (let y = 0; y < g; y++) for (let x = 0; x < g; x++){
          if (dirty.has(lod + ':' + x + ',' + y + ',' + z)) continue;
          const c = { lod, x, y, z }, r0 = job(s, before, D, counts, null, c).records, r1 = job(s, after, D, counts, null, c).records;
          if (r0.length !== r1.length || r0.some((v, i) => v !== r1[i])) throw new Error(`oracle: chunk ${lod}:${x},${y},${z} changed outside the dirty set`);
          checked++;
        }
      }
    }
  }
  return { checked };
}

/* ---- worlds ---------------------------------------------------------------- */
function shapeWorld(name, D){
  const store = createStore(), shape = SHAPES.find(s => s.name === name);
  const { root } = store.fromField(D, fieldOf(shape, D));
  return { name: `${name} D=${D}`, store, root, D, colour: { kind: 'shape', name, D } };
}
function worlds(){
  const out = [];
  const kit = D => { const d = kitDesc({ D }), k = buildKit(d); return { name: `kit D=${D}`, store: k.store, root: k.root, D, colour: d, desc: d }; };
  out.push(kit(14), kit(16));
  out.push(shapeWorld('terrain', 12));
  out.push(shapeWorld('gyroid', 11));
  const t0 = now(), cd = caveDesc({ D: QUICK ? 10 : 12 }), c = buildCaves(cd);
  console.log(`caves built in ${(now() - t0).toFixed(0)} ms`);
  const pruned = prune(c.store.snapshot().keys, [c.root]), s = createStore(), map = s.importKeys(pruned.keys);
  out.push({ name: `caves D=${cd.D}`, store: s, root: map[pruned.map[c.root]], D: cd.D, colour: cd, desc: cd });
  return out;
}

/* ---- A. one stamp --------------------------------------------------------- */
function stamps(ws){
  console.log('\n## A. One stamp: a ball at a surface point (median over the points)\n');
  console.log('| world | nodes | op | r | ms | new nodes | new KB | visited | voxels changed | chunks dirty (+neighbours) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const w0 of ws){
    for (const r of [4, 16, 64, 256]){
      const n = r === 256 ? 5 : QUICK ? 7 : 15, w = fresh(w0), pts = surfacePoints(w, n, Math.min(r + 2, 2 ** (w.D - 2)));
      if (!pts.length) continue;
      for (const [op, fn] of [['carve', carve], ['add', add]]){
        const counts = createCounts(w.store), ms = [], made = [], visited = [], changed = [], dirtyN = [], dirtyD = [];
        for (const [x, y, z] of pts){
          const before = w.store.size, st = {}, t0 = now();
          const out = fn(w.store, w.root, w.D, ball(x, y, z, r), st);
          ms.push(now() - t0); made.push(w.store.size - before); visited.push(st.visited);
          counts.update();
          changed.push(Math.abs(counts.of(out) - counts.of(w.root)));
          const d = diffChunks(w.store, w.root, out, w.D);
          dirtyN.push(d.size); dirtyD.push(dilate(d).size);
        }
        console.log(`| ${w0.name} | ${int(w0.store.size)} | ${op} | ${r} | ${fmt(median(ms))} | ${int(median(made))} | ${fmt(median(made) * NODE_BYTES / 1024)} | ${int(median(visited))} | ${int(median(changed))} | ${int(median(dirtyN))} (${int(median(dirtyD))}) |`);
      }
    }
  }
}

/* ---- B. what the view must redo ------------------------------------------- */
function views(ws){
  console.log('\n## B. What a carve costs the view: the cut near it, a worker\'s jobs\n');
  console.log('The eye is 3r + 32 above the stamp. Jobs: chunks of the cut (leaves and split ones) in the dilated dirty set. Changed: the job\'s records or words differ from before; records: its records do. Bricks: dirty 8³ bricks, neighbours included, over the lod-0 chunks holding them (of 512 a chunk). Diff and stamps: ms to find the jobs either way.\n');
  console.log('| world | r | cut | jobs | by lod (0,1,2,…) | changed | records | job ms median | max | worker ms total | at 4 workers | bricks / chunk | diff ms | stamps ms |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const w0 of ws){
    const colour = colourOf(w0.colour);
    for (const r of [4, 16, 64]){
      const w = fresh(w0), pts = surfacePoints(w, QUICK ? 2 : 5, Math.min(r + 2, 2 ** (w.D - 2))), counts = createCounts(w.store);
      if (!pts.length) continue;
      const cuts = [], jobs = [], totals = [], changes = [], recChanges = [], all = [], lods = [], brickRate = [], diffMs = [], stampMs = [];
      for (const [x, y, z] of pts){
        const out = carve(w.store, w.root, w.D, ball(x, y, z, r));
        counts.update();
        let t1 = now();
        const d = dilate(diffChunks(w.store, w.root, out, w.D));
        diffMs.push(now() - t1);
        const b = dirtyBricks(w.store, w.root, out, w.D);
        brickRate.push(b.bricks / b.chunks);
        const eye = [x, Math.min(y + 3 * r + 32, 2 ** w.D - 2), z];
        const sel = selectChunks(createWorld(w.store, out, w.D), eye);
        t1 = now();
        const viaStamps = new Set();
        for (const c of sel.nodes.values()) if (!sameStamp(stampOf(w.store, w.root, w.D, c), stampOf(w.store, out, w.D, c))) viaStamps.add(c.key);
        stampMs.push(now() - t1);
        let total = 0, n = 0, ch = 0, rc = 0; const byLod = [];
        const differ = (p, q) => (p || q) && (!p || !q || p.length !== q.length || p.some((v, i) => v !== q[i]));
        for (const c of sel.nodes.values()){
          if (d.has(c.key) !== viaStamps.has(c.key)) throw new Error(`stamps and the diff disagree on ${c.key}`);
          if (!d.has(c.key)) continue;
          const t0 = now(), j1 = job(w.store, out, w.D, counts, colour, c), ms = now() - t0;
          const j0 = job(w.store, w.root, w.D, counts, colour, c);
          total += ms; n++; all.push(ms); byLod[c.lod] = (byLod[c.lod] || 0) + 1;
          const dr = differ(j0.records, j1.records);
          if (dr) rc++;
          if (dr || differ(j0.attrs, j1.attrs)) ch++;
        }
        cuts.push(sel.nodes.size); jobs.push(n); totals.push(total); changes.push(ch); recChanges.push(rc); lods.push(byLod);
      }
      const mid = jobs.indexOf(median(jobs)), lodText = Array.from(lods[mid], v => v || 0).join(',');
      console.log(`| ${w0.name} | ${r} | ${int(median(cuts))} | ${int(median(jobs))} | ${lodText} | ${int(median(changes))} | ${int(median(recChanges))} | ${fmt(median(all))} | ${fmt(Math.max(...all))} | ${fmt(median(totals))} | ${fmt(median(totals) / 4)} | ${fmt(median(brickRate))} | ${fmt(median(diffMs))} | ${fmt(median(stampMs))} |`);
    }
  }
}

/* ---- C. a stroke: one stamp a frame --------------------------------------- */
function strokes(ws){
  console.log('\n## C. A stroke: 600 carves of r = 16, one a frame, 2 voxels apart (10 s at 60 Hz)\n');
  console.log('Dirty is the dilated set at every lod. Summed over stamps, it\'s what re-expanding after every stamp would ask; distinct, what the whole stroke touches; per 100 ms, the mean of six stamps\' union, what a job queue that coalesces would ask.\n');
  console.log('| world | stamp ms median | p99 | max | counts ms | diff ms | new nodes a stamp | store growth, MB/s (key only) | tail, MB/s | live after prune | dead | prune ms | dirty summed | distinct | per 100 ms |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const w0 of ws){
    const w = fresh(w0), S = 2 ** w.D, counts = createCounts(w.store), base = w.store.size;
    const [start] = surfacePoints(w, 1, 700 < S / 2 ? 700 : Math.floor(S / 4));
    if (!start) continue;
    let root = w.root, x = start[0]; const z = start[2], ms = [], cms = [], made = [], dms = [];
    let summed = 0, windows = 0, windowSum = 0, win = new Set(); const distinct = new Set();
    for (let i = 0; i < 600; i++, x += 2){
      const y = drop(w.store, w.root, w.D, Math.floor(x) % S, Math.floor(z));
      const before = w.store.size, t0 = now();
      const prev = root;
      root = carve(w.store, root, w.D, ball(x % S, Math.max(y, 0) + 0.5, z, 16));
      const t1 = now();
      counts.update();
      const t2 = now();
      const dirty = dilate(diffChunks(w.store, prev, root, w.D));
      dms.push(now() - t2);
      cms.push(t2 - t1); ms.push(t1 - t0); made.push(w.store.size - before);
      summed += dirty.size;
      for (const k of dirty.keys()){ distinct.add(k); win.add(k); }
      if (i % 6 === 5){ windowSum += win.size; windows++; win = new Set(); }
    }
    const sorted = [...ms].sort((a, b) => a - b), total = w.store.size - base;
    const t0 = now(), p = prune(w.store.snapshot().keys, [root]), pruneMs = now() - t0, live = p.keys.length / 9;
    const pb = prune(w.store.snapshot().keys, [w.root]).keys.length / 9;
    console.log(`| ${w0.name} | ${fmt(median(ms))} | ${fmt(sorted[594])} | ${fmt(sorted[599])} | ${fmt(median(cms))} | ${fmt(median(dms))} | ${int(median(made))} | ${fmt(total * NODE_BYTES / 1e6 / 10)} | ${fmt(total * TAIL_BYTES / 1e6 / 10)} | +${int(live - pb)} of ${int(total)} made | ${(100 * (1 - (live - pb) / total)).toFixed(0)}% | ${fmt(pruneMs)} | ${int(summed)} | ${int(distinct.size)} | ${int(windowSum / windows)} |`);
  }
}

/* ---- D. world against world ----------------------------------------------- */
function worldOps(){
  console.log('\n## D. World against world (one store, memoized per pair)\n');
  console.log('The counts identities |A∪B| + |A∩B| = |A| + |B| and |A−B| + |A∩B| = |A| are checked on every pair.\n');
  console.log('| A | B | op | nodes A | nodes B | ms | pairs | new nodes | result reaches | voxels |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  const pairs = [
    ['kit D=14 seed 1', () => buildKit(kitDesc({ D: 14 })), 'kit D=14 seed 2', () => buildKit(kitDesc({ D: 14, seed: 2 }))],
    ['kit D=12', () => buildKit(kitDesc({ D: 12 })), 'sphere D=12', () => shapeWorld('sphere', 12)],
    ['kit D=12', () => buildKit(kitDesc({ D: 12 })), 'hills D=12', () => shapeWorld('hills', 12)],
    ['kit D=12', () => buildKit(kitDesc({ D: 12 })), 'gyroid D=12', () => shapeWorld('gyroid', 12)],
    ['terrain D=12', () => shapeWorld('terrain', 12), 'gyroid D=12', () => shapeWorld('gyroid', 12)],
  ];
  if (!QUICK) pairs.push(['caves D=12', () => { const c = buildCaves(caveDesc({ D: 12 })); return { store: c.store, root: c.root }; }, 'kit D=12', () => buildKit(kitDesc({ D: 12 }))]);
  for (const [na, fa, nb, fb] of pairs){
    const a = fa(), b = fb(), store = createStore();
    const ka = store.importKeys(a.store.snapshot().keys), kb = store.importKeys(b.store.snapshot().keys);
    const A = ka[a.root], B = kb[b.root], reach = id => prune(store.snapshot().keys, [id]).keys.length / 9;
    const nA = reach(A), nB = reach(B), counts = createCounts(store);
    const res = {};
    for (const [op, fn] of [['A ∪ B', unionOf], ['A ∩ B', intersect], ['A − B', difference]]){
      const st = {}, before = store.size, t0 = now(), id = fn(store, A, B, st), ms = now() - t0;
      counts.update();
      res[op] = counts.of(id);
      console.log(`| ${na} | ${nb} | ${op} | ${int(nA)} | ${int(nB)} | ${fmt(ms)} | ${int(st.pairs)} | ${int(store.size - before)} | ${int(reach(id))} | ${int(counts.of(id))} |`);
    }
    const ca = counts.of(A), cb = counts.of(B);
    if (res['A ∪ B'] + res['A ∩ B'] !== ca + cb || res['A − B'] + res['A ∩ B'] !== ca) throw new Error(`counts identity fails on ${na}, ${nb}`);
  }
}

/* ---- E. an exact oblique cut ---------------------------------------------- */
function planes(ws){
  console.log('\n## E. An exact oblique cut across the whole world: A − half-space through the centre\n');
  console.log('| world | normal | plane nodes | plane ms | cut ms | pairs | new nodes | voxels left | identity |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const w0 of ws) for (const a of [[1, 2, 3], [37, 61, 101]]){
    const w = fresh(w0), S = 2 ** w.D, c = Math.floor((a[0] + a[1] + a[2]) * (S - 1) / 2), t0 = now();
    const before = w.store.size, { root: P } = halfSpace(w.store, w.D, a, c), t1 = now(), planeNodes = w.store.size - before;
    const st = {}, b2 = w.store.size, out = difference(w.store, w.root, P, st), t2 = now(), made = w.store.size - b2;
    const inter = intersect(w.store, w.root, P), counts = createCounts(w.store);
    const ok = counts.of(out) + counts.of(inter) === counts.of(w.root);
    if (!ok) throw new Error('half-space identity fails');
    console.log(`| ${w0.name} | ${a.join(',')} | ${int(planeNodes)} | ${fmt(t1 - t0)} | ${fmt(t2 - t1)} | ${int(st.pairs)} | ${int(made)} | ${int(counts.of(out))} | ok |`);
  }
}

/* ---- F. shifts ------------------------------------------------------------- */
function shifts(ws){
  console.log('\n## F. A whole world moved by an integer offset (cropped at the walls)\n');
  console.log('| world | nodes | offset | ms | states | new nodes | new / nodes |');
  console.log('|---|---|---|---|---|---|---|');
  for (const w0 of ws){
    if (w0.D > 14 || w0.store.size > 200000) continue;
    for (const d of [[1, 0, 0], [5, 3, 7], [64, 0, 0], [1024, 0, 0]]){
      const w = fresh(w0), before = w.store.size, st = {}, t0 = now();
      shift(w.store, w.root, w.D, d, st);
      const ms = now() - t0, made = w.store.size - before;
      console.log(`| ${w0.name} | ${int(before)} | ${d.join(',')} | ${fmt(ms)} | ${int(st.states)} | ${int(made)} | ${(made / before).toFixed(2)} |`);
    }
  }
}

/* ---- G. edit the part ------------------------------------------------------
   One part of the kit, in every turn, swapped for itself with a hole. */
function partEdit(){
  console.log('\n## G. Edit the part, not the place: every copy of a kit part, in one sweep\n');
  console.log('The hole is a ball at the part\'s corner. The check: the voxels lost are exactly copies × what one copy lost, from path multiplicities, and it must lose some. Cut: of a view\'s cut (5 voxels up from a roof, at the default detail), how many chunks\' stamps changed.\n');
  console.log('| world | nodes | part | copies | ms | new nodes | voxels before | after | check | cut | jobs |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|');
  const PROPER = OH48;
  for (const [D, part] of [[12, 'frame'], [14, 'frame'], [16, 'frame'], [16, 'window'], [16, 'block']]){
    const w = fresh({ ...buildKit(kitDesc({ D })) }), store = w.store;
    const old = store.fromDense(partOcc(PARTS[part]), PART).root;
    const hole = ball(2, 2, 2, 4);
    const next = carve(store, old, 4, hole), swap = new Map();
    if (next === old) throw new Error(`part ${part}: the hole cut nothing`);
    for (const e of PROPER){ const a = store.transform(old, e); if (!swap.has(a)) swap.set(a, store.transform(next, e)); }
    // Places holding each turned copy: path multiplicity from the root.
    const mult = new Float64Array(store.maxId + 1); mult[w.root] = 1;
    for (let id = w.root; id >= FIRST_NODE; id--) if (mult[id]) for (let o = 0; o < 8; o++) mult[store.child(id, o)] += mult[id];
    let copies = 0, want = 0; const counts0 = createCounts(store);
    for (const [a, b] of swap){ copies += mult[a]; want += mult[a] * (counts0.of(b) - counts0.of(a)); }
    const before = store.size, t0 = now(), map = rewrite(store, swap), ms = now() - t0, made = store.size - before;
    const counts = createCounts(store), v0 = counts.of(w.root), v1 = counts.of(map[w.root]);
    const [p] = surfacePoints(w, 1, 64), eye = [p[0], p[1] + 5, p[2]];
    const sel = selectChunks(createWorld(store, map[w.root], D), eye);
    let jobs = 0;
    for (const c of sel.nodes.values()) if (!sameStamp(stampOf(store, w.root, D, c), stampOf(store, map[w.root], D, c))) jobs++;
    console.log(`| kit D=${D} | ${int(w.store.size - made)} | ${part} | ${int(copies)} | ${fmt(ms)} | ${int(made)} | ${int(v0)} | ${int(v1)} | ${v1 - v0 === want && v1 !== v0 ? 'ok' : 'FAIL ' + (v1 - v0) + ' vs ' + want} | ${int(sel.nodes.size)} | ${int(jobs)} |`);
  }
}

/* ---- H. the plumbing ------------------------------------------------------- */
function plumbing(ws){
  console.log('\n## H. What the plumbing costs at each world\'s size\n');
  console.log('Worst intern: the slowest single intern() while re-interning the store, which is the interner doubling its table and rehashing, a pause the stroke would feel.\n');
  console.log('| world | nodes | store MB | snapshot MB (keys, counts, poses) | structuredClone ms | importKeys ms (a view becoming a store) | worst intern ms | prune ms | counts from scratch ms | classes ns/new node |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const w of ws){
    const n = w.store.size, keys = w.store.snapshot().keys;
    let t0 = now();
    const copy = structuredClone({ keys, counts: new Float64Array(n + 2), poses: new Uint8Array(n + 2) }), cloneMs = now() - t0;
    if (!copy) throw new Error('unreachable');
    t0 = now(); const reimported = createStore(); reimported.importKeys(keys); const imp = now() - t0;
    const again = createStore(), remap = new Uint32Array(n + FIRST_NODE), ch = new Uint32Array(8);
    remap[FULL] = FULL;
    let worst = 0;
    for (let i = 0; i < n; i++){
      for (let o = 0; o < 8; o++) ch[o] = remap[keys[9 * i + 1 + o]];
      const t1 = now(); remap[i + FIRST_NODE] = again.intern(keys[9 * i], ch); const dt = now() - t1;
      if (dt > worst) worst = dt;
    }
    t0 = now(); prune(keys, [w.root]); const pr = now() - t0;
    t0 = now(); createCounts(w.store); const cn = now() - t0;
    let cl = '—';
    if (n <= 300000){
      const f = fresh(w), classes = createClasses(f.store, OH48), pts = surfacePoints(f, 1, 40), b = f.store.size;
      let root = f.root, xx = pts[0][0];
      for (let i = 0; i < 60; i++, xx += 2) root = carve(f.store, root, f.D, ball(xx, pts[0][1], pts[0][2], 16));
      const t1 = now(); classes.update(); cl = fmt(1e6 * (now() - t1) / Math.max(1, f.store.size - b));
    }
    console.log(`| ${w.name} | ${int(n)} | ${fmt(n * NODE_BYTES / 1e6)} | ${fmt(n * TAIL_BYTES / 1e6)} | ${fmt(cloneMs)} | ${fmt(imp)} | ${fmt(worst)} | ${fmt(pr)} | ${fmt(cn)} | ${cl} |`);
  }
}

/* ---- I to L: sculpting with simple brushes (realtimecsg.md §10) -----------
   Your answer to §9 Q1: a person with a sphere, an ellipsoid or a cube,
   subtracting brush-shaped holes and adding or extending blocks. */

/* An axis-aligned ellipsoid is ball() with each axis scaled. The squared terms
   separate by axis, so the box's nearest and farthest points still decide it
   exactly: no "can't tell" a cell that the brush can't actually split. */
const ellipsoid = (cx, cy, cz, a, b, c) => (k, x, y, z) => {
  const s = 2 ** k;
  let near = 0, far = 0;
  for (const [i, m, q] of [[x, cx, a], [y, cy, b], [z, cz, c]]){
    const lo = i * s + 0.5, hi = (i + 1) * s - 0.5;
    const d = m < lo ? lo - m : m > hi ? m - hi : 0, f = Math.max(Math.abs(m - lo), Math.abs(hi - m));
    near += (d / q) ** 2; far += (f / q) ** 2;
  }
  return near > 1 ? 0 : far <= 1 ? 1 : k === 0 ? (near <= 1 ? 1 : 0) : -1;
};
/* A turned ellipsoid has no such shortcut. |M(p − c)| − 1 is Lipschitz with
   constant 1 / (shortest axis), so a long thin one says "can't tell" far more
   often than it needs to: the table's visited column is that price. */
function turnedEllipsoid(cx, cy, cz, a, b, e, angle = 0.6){
  const c = Math.cos(angle), s = Math.sin(angle), R3 = Math.sqrt(3), L = 1 / Math.min(a, b, e);
  const f = (x, y, z) => {
    const px = x - cx, py = y - cy, pz = z - cz;
    const u = c * px + s * pz, w = -s * px + c * pz;
    const v = c * py + s * w, t = -s * py + c * w;
    return Math.hypot(u / a, v / b, t / e) - 1;
  };
  return (k, x, y, z) => {
    const S = 2 ** k, v = f((x + 0.5) * S, (y + 0.5) * S, (z + 0.5) * S);
    if (k === 0) return v <= 0 ? 1 : 0;
    const r = L * R3 * (S - 1) / 2 + 1e-9;
    return v > r ? 0 : v < -r ? 1 : -1;
  };
}
/* A box on the voxel grid, half-open, any size at any position. Exact at
   every level: a cell is outside, inside, or truly split. */
const box = (x0, y0, z0, x1, y1, z1) => (k, x, y, z) => {
  const S = 2 ** k, X = x * S, Y = y * S, Z = z * S;
  if (X >= x1 || Y >= y1 || Z >= z1 || X + S <= x0 || Y + S <= y0 || Z + S <= z0) return 0;
  return X >= x0 && Y >= y0 && Z >= z0 && X + S <= x1 && Y + S <= y1 && Z + S <= z1 ? 1 : -1;
};
/* A block snapped to its own grid is one node: put solid(b) or EMPTY at
   (X, Y, Z) of level b. D − b interns, no test, no walk off the path. It's
   the same answer as add(box) and carve(box), and the oracle holds it there. */
function place(store, root, D, level, X, Y, Z, id){
  const rec = (n, k) => {
    if (k === level) return id;
    const b = k - 1 - level, o = (X >> b & 1) | (Y >> b & 1) << 1 | (Z >> b & 1) << 2;
    const c = new Uint32Array(8);
    for (let i = 0; i < 8; i++) c[i] = kidOf(store, n, i);
    c[o] = rec(c[o], k - 1);
    return store.intern(k, c);
  };
  return rec(root, D);
}

/* Picking: the first voxel a ray meets, and which face it came in by. The face
   is what "extend" needs. Children in ascending (i ^ sign) order is front to
   back for any ray, so the first voxel reached is the nearest and the walk
   stops. It reads store.child only, so a storeView can run it on the page. */
function pick(store, root, D, o, d, stats = {}){
  const sign = (d[0] < 0 ? 1 : 0) | (d[1] < 0 ? 2 : 0) | (d[2] < 0 ? 4 : 0);
  const ix = 1 / d[0], iy = 1 / d[1], iz = 1 / d[2];
  let visited = 0, hit = null;
  const rec = (id, k, x, y, z) => {
    if (id === EMPTY) return false;
    const S = 2 ** k, X = x * S, Y = y * S, Z = z * S;
    const ax = ((d[0] < 0 ? X + S : X) - o[0]) * ix, bx = ((d[0] < 0 ? X : X + S) - o[0]) * ix;
    const ay = ((d[1] < 0 ? Y + S : Y) - o[1]) * iy, by = ((d[1] < 0 ? Y : Y + S) - o[1]) * iy;
    const az = ((d[2] < 0 ? Z + S : Z) - o[2]) * iz, bz = ((d[2] < 0 ? Z : Z + S) - o[2]) * iz;
    const tin = Math.max(ax, ay, az), tout = Math.min(bx, by, bz);
    if (tin > tout || tout < 0) return false;
    visited++;
    if (k === 0){
      const axis = tin <= 0 ? -1 : ax === tin ? 0 : ay === tin ? 1 : 2;
      hit = { x, y, z, t: Math.max(tin, 0), axis, normal: axis < 0 ? 0 : -Math.sign(d[axis]) };
      return true;
    }
    for (let i = 0; i < 8; i++){
      const c = i ^ sign;
      if (rec(store.child(id, c), k - 1, 2 * x + (c & 1), 2 * y + (c >> 1 & 1), 2 * z + (c >> 2))) return true;
    }
    return false;
  };
  rec(root, D, 0, 0, 0);
  stats.visited = visited;
  return hit;
}
/* The plain answer to hold pick to: step voxel by voxel from the world's box. */
function pickDDA(store, root, D, o, d){
  const S = 2 ** D, I = [d[0], d[1], d[2]].map(v => 1 / v);
  let t = 0, axis = -1;
  for (let a = 0; a < 3; a++){
    const near = (d[a] < 0 ? S : 0) - o[a], far = (d[a] < 0 ? 0 : S) - o[a];
    if (near * I[a] > t){ t = near * I[a]; axis = a; }
    if (far * I[a] < 0) return null;
  }
  const tEnd = Math.min(...[0, 1, 2].map(a => ((d[a] < 0 ? 0 : S) - o[a]) * I[a]));
  if (t > tEnd) return null;
  const p = [0, 1, 2].map(a => { const v = o[a] + d[a] * t; const f = Math.floor(v); return a === axis && d[a] < 0 ? Math.ceil(v) - 1 : Math.min(S - 1, Math.max(0, f)); });
  const step = d.map(v => v < 0 ? -1 : 1);
  const next = [0, 1, 2].map(a => ((d[a] < 0 ? p[a] : p[a] + 1) - o[a]) * I[a]);
  const dt = I.map(Math.abs);
  for (;;){
    if (nodeAt(store, root, D, 0, p[0], p[1], p[2]) !== EMPTY) return { x: p[0], y: p[1], z: p[2], axis };
    axis = next[0] <= next[1] && next[0] <= next[2] ? 0 : next[1] <= next[2] ? 1 : 2;
    p[axis] += step[axis];
    if (p[axis] < 0 || p[axis] >= S) return null;
    next[axis] += dt[axis];
  }
}

/* Which chunks an edit really reaches. stamps ask "did any of my seven nodes
   change?", which marks all six neighbours of every changed chunk. But a
   neighbour reads only the slab facing it, and a brick's kept cells are a
   function of its node (CLAUDE.md's lod-rule rule), so: find the changed
   bricks at each lod, grow them by a face, and see which chunks that lands
   in. views() found most jobs change nothing, and guessed neighbours. The
   section checks this test is sound: a job whose output changed and which
   this test didn't ask for throws. */
function brickDirty(store, A, B, D){
  const changed = new Map();
  const rec = (a, b, k, x, y, z) => {
    if (a === b || k < 3) return;
    const lod = k - 3;
    if (!changed.has(lod)) changed.set(lod, new Set());
    changed.get(lod).add(x + ',' + y + ',' + z);
    if (k === 3) return;
    for (let o = 0; o < 8; o++) rec(kidOf(store, a, o), kidOf(store, b, o), k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
  };
  rec(A, B, D, 0, 0, 0);
  const out = new Map();
  for (const [lod, set] of changed) for (const key of set){
    const [x, y, z] = key.split(',').map(Number);
    for (const [a, b, c] of [[0, 0, 0], ...SIDES]){
      const X = x + a, Y = y + b, Z = z + c;
      if (X < 0 || Y < 0 || Z < 0) continue;
      const ck = lod + ':' + (X >> 3) + ',' + (Y >> 3) + ',' + (Z >> 3);
      if (!out.has(ck)) out.set(ck, []);
      out.get(ck).push([X & 7, Y & 7, Z & 7]);
    }
  }
  return out;
}

/* A brick patch: what §3.2 said nobody had written. Redo only the changed
   bricks of a lod-0 chunk, and splice their records into the old ones. Records
   are in Morton order, and a cell's top 9 Morton bits are its brick, so a
   brick is one contiguous range, once in the main list and once in the tail.
   The section throws unless the result equals expandChunk byte for byte.
   Lod 0 only: a coarse brick needs keepCount and the mean, and it can wait. */
const PGRID = new Uint8Array(1000), pIndex = (x, y, z) => (x + 1) + 10 * ((y + 1) + 10 * (z + 1));
function patchChunk(store, root, D, counts, colour, c, old, bricks){
  const X0 = c.x * 64, Y0 = c.y * 64, Z0 = c.z * 64;
  const seen = new Set(), list = [];
  for (const [x, y, z] of bricks){
    const m = mortonOf(x, y, z);
    if (!seen.has(m)){ seen.add(m); list.push({ m, x, y, z, recs: [], tail: [], attrs: [], tailAttrs: [] }); }
  }
  list.sort((p, q) => p.m - q.m);
  for (const b of list){
    const wx = c.x * 8 + b.x, wy = c.y * 8 + b.y, wz = c.z * 8 + b.z, ox = b.x * 8, oy = b.y * 8, oz = b.z * 8;
    PGRID.fill(0);
    const cells = [];
    const gather = (id, k, x, y, z, index) => {
      if (id === EMPTY) return;
      if (k === 0){ PGRID[pIndex(x, y, z)] = 1; cells.push(x, y, z, index); return; }
      const h = 2 ** (k - 1);
      for (let o = 0; o < 8; o++) gather(store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h, index << 3 | o);
    };
    gather(nodeAt(store, root, D, 3, wx, wy, wz), 3, 0, 0, 0, b.m);
    const slab = (id, k, x, y, z, a, v) => {   // only the layer of the neighbour that faces us
      if (id === EMPTY) return;
      const P = a === 0 ? x : a === 1 ? y : z, h = 2 ** k;
      if (v < P || v >= P + h) return;
      if (k === 0){
        PGRID[pIndex(a === 0 ? (x === 0 ? 8 : -1) : x, a === 1 ? (y === 0 ? 8 : -1) : y, a === 2 ? (z === 0 ? 8 : -1) : z)] = 1;
        return;
      }
      const s = h / 2;
      for (let o = 0; o < 8; o++) slab(store.child(id, o), k - 1, x + (o & 1) * s, y + (o >> 1 & 1) * s, z + (o >> 2) * s, a, v);
    };
    for (const [dx, dy, dz] of SIDES){
      const a = dx ? 0 : dy ? 1 : 2, v = (dx || dy || dz) > 0 ? 0 : 7;
      slab(nodeAt(store, root, D, 3, wx + dx, wy + dy, wz + dz), 3, 0, 0, 0, a, v);
    }
    const coarseFull = (x, y, z) => {
      const id = nodeAt(store, root, D, 1, (X0 + x) >> 1, (Y0 + y) >> 1, (Z0 + z) >> 1);
      return id !== EMPTY && counts.of(id) === 8;
    };
    for (let i = 0; i < cells.length; i += 4){
      const lx = cells[i], ly = cells[i + 1], lz = cells[i + 2], index = cells[i + 3], g = pIndex(lx, ly, lz);
      const m = (PGRID[g + 1] ? 0 : 1) | (PGRID[g - 1] ? 0 : 2) | (PGRID[g + 10] ? 0 : 4) | (PGRID[g - 10] ? 0 : 8) | (PGRID[g + 100] ? 0 : 16) | (PGRID[g - 100] ? 0 : 32);
      const x = ox + lx, y = oy + ly, z = oz + lz;
      const word = () => colour ? cellAttr(store, counts, colour, 0, 0, 1, X0 + x, Y0 + y, Z0 + z) : 0;
      if (m){ b.recs.push(packRecord(index, m, 0)); b.attrs.push(word()); continue; }
      const e = boundaryBits(x, y, z);
      if (e && ((e & 1 && !coarseFull(x + 1, y, z)) || (e & 2 && !coarseFull(x - 1, y, z)) || (e & 4 && !coarseFull(x, y + 1, z))
             || (e & 8 && !coarseFull(x, y - 1, z)) || (e & 16 && !coarseFull(x, y, z + 1)) || (e & 32 && !coarseFull(x, y, z - 1)))){
        b.tail.push(packRecord(index, 0, 0)); b.tailAttrs.push(word());
      }
    }
  }
  // Splice. lower(): the first record at or after a cell, within [from, to).
  const oldRecs = old.records, oldWords = old.attrs || new Uint32Array(0), split = old.borderStart ?? oldRecs.length;
  const lower = (from, to, cell) => { let a = from, e = to; while (a < e){ const h = (a + e) >> 1; if ((oldRecs[h] & CELL_MASK) < cell) a = h + 1; else e = h; } return a; };
  const ranges = (from, to, recKey, attrKey) => {
    const parts = []; let pos = from, size = 0;
    for (const b of list){
      const s = lower(pos, to, b.m << 9), e = lower(s, to, (b.m + 1) << 9);
      parts.push([pos, s, b[recKey], b[attrKey]]); size += s - pos + b[recKey].length; pos = e;
    }
    parts.push([pos, to, [], []]); size += to - pos;
    return { parts, size };
  };
  const A = ranges(0, split, 'recs', 'attrs'), T = ranges(split, oldRecs.length, 'tail', 'tailAttrs');
  const records = new Uint32Array(A.size + T.size), attrs = new Uint32Array(A.size + T.size);
  let w = 0;
  for (const { parts } of [A, T]) for (const [s, e, rs, as] of parts){
    records.set(oldRecs.subarray(s, e), w);
    if (oldWords.length) attrs.set(oldWords.subarray(s, e), w);
    w += e - s;
    for (let i = 0; i < rs.length; i++){ records[w] = rs[i]; attrs[w] = as[i]; w++; }
  }
  return { records, attrs, borderStart: A.size, bricks: list.length };
}

function sculptOracle(){
  const D = 7, R = 2 ** D, store = createStore(), rand = mulberry(7);
  const idx = (x, y, z) => x + R * (y + R * z);
  const occ = new Uint8Array(R ** 3);
  const blobs = Array.from({ length: 12 }, () => [rand() * R, rand() * R, rand() * R, 6 + rand() * 24]);
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++)
    for (const [a, b, c, r] of blobs) if ((x + 0.5 - a) ** 2 + (y + 0.5 - b) ** 2 + (z + 0.5 - c) ** 2 <= r * r){ occ[idx(x, y, z)] = 1; break; }
  const A = store.fromDense(occ, R).root;
  const same = (root, want, name) => {
    const got = store.expand(root, D);
    for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) throw new Error(`sculpt oracle: ${name} differs at ${i}`);
    if (store.fromDense(want, R).root !== root) throw new Error(`sculpt oracle: ${name} isn't canonical`);
  };
  const te = turnedEllipsoid(66, 58, 71, 30, 9, 18);
  for (const [name, cell, inside] of [
    ['ellipsoid', ellipsoid(40.5, 70.25, 55, 23.7, 9.5, 31), (x, y, z) => ((x + 0.5 - 40.5) / 23.7) ** 2 + ((y + 0.5 - 70.25) / 9.5) ** 2 + ((z + 0.5 - 55) / 31) ** 2 <= 1],
    ['turned ellipsoid', te, (x, y, z) => te(0, x, y, z) === 1],
    ['box', box(19, 33, 7, 83, 40, 61), (x, y, z) => x >= 19 && x < 83 && y >= 33 && y < 40 && z >= 7 && z < 61],
  ]){
    const brush = new Uint8Array(R ** 3);
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) brush[idx(x, y, z)] = inside(x, y, z) ? 1 : 0;
    same(carve(store, A, D, cell), occ.map((v, i) => v && !brush[i] ? 1 : 0), 'carve ' + name);
    same(add(store, A, D, cell), occ.map((v, i) => v || brush[i] ? 1 : 0), 'add ' + name);
  }
  for (const [lev, X, Y, Z] of [[0, 77, 3, 121], [2, 9, 14, 30], [4, 1, 6, 3], [6, 1, 0, 1]]){
    const S = 2 ** lev, b = box(X * S, Y * S, Z * S, (X + 1) * S, (Y + 1) * S, (Z + 1) * S);
    if (place(store, A, D, lev, X, Y, Z, store.solid(lev)) !== add(store, A, D, b)) throw new Error('sculpt oracle: place solid isn\'t add(box)');
    if (place(store, A, D, lev, X, Y, Z, EMPTY) !== carve(store, A, D, b)) throw new Error('sculpt oracle: place EMPTY isn\'t carve(box)');
  }
  // Pick against stepping voxel by voxel: a gyroid and a kit at D = 8.
  let rays = 0, hits = 0;
  const K = buildKit(kitDesc({ D: 8 })), G = shapeWorld('gyroid', 8);
  for (const w of [K, G]) for (let i = 0; i < 2000; i++, rays++){
    const S = 256, o = [rand() * S * 1.6 - S * 0.3, rand() * S * 1.6 - S * 0.3, rand() * S * 1.6 - S * 0.3];
    const aim = [rand() * S, rand() * S, rand() * S];
    const d = [aim[0] - o[0] + 1e-4, aim[1] - o[1] + 1e-4, aim[2] - o[2] + 1e-4];
    const p = pick(w.store, w.root, 8, o, d), q = pickDDA(w.store, w.root, 8, o, d);
    if (!p !== !q || (p && (p.x !== q.x || p.y !== q.y || p.z !== q.z || (p.axis !== q.axis && p.t > 0)))) throw new Error(`sculpt oracle: pick ${JSON.stringify(p)} against ${JSON.stringify(q)}, ray ${o} ${d}`);
    if (p) hits++;
  }
  return { rays, hits };
}

const logInt = n => Math.round(Math.log2(n));
/* ---- I. every brush, carving and adding ------------------------------------ */
function brushes(ws){
  console.log('\n## I. Every brush at a surface point (medians). Size s: ball radius s, ellipsoid semi-axes s, s/2, s; cube side 2s, block side 2s snapped to its own grid\n');
  console.log('| world | s | brush | carve ms | new nodes | visited | add ms | new nodes | visited |');
  console.log('|---|---|---|---|---|---|---|---|---|');
  for (const w0 of ws) for (const s of [4, 16, 64]){
    const w = fresh(w0), pts = surfacePoints(w, QUICK ? 5 : 11, Math.min(2 * s + 2, 2 ** (w.D - 2)));
    if (!pts.length) continue;
    const S = 2 ** w.D, b = logInt(2 * s), side = 2 * s;
    const kinds = [
      ['ball', ([x, y, z]) => ball(x, y, z, s)],
      ['ellipsoid', ([x, y, z]) => ellipsoid(x, y, z, s, s / 2, s)],
      ['turned ellipsoid', ([x, y, z]) => turnedEllipsoid(x, y, z, s, s / 2, s)],
      ['cube, free', ([x, y, z]) => { const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); return box(X - s, Y - s, Z - s, X + s, Y + s, Z + s); }],
      ['cube, turned', ([x, y, z]) => orientedBox(x, y, z, s)],
    ];
    for (const [name, make] of kinds){
      const row = [];
      for (const fn of [carve, add]){
        const ms = [], made = [], vis = [];
        for (const p of pts){
          const before = w.store.size, st = {}, t0 = now();
          fn(w.store, w.root, w.D, make(p), st);
          ms.push(now() - t0); made.push(w.store.size - before); vis.push(st.visited);
        }
        row.push(`${fmt(median(ms))} | ${int(median(made))} | ${int(median(vis))}`);
      }
      console.log(`| ${w0.name} | ${s} | ${name} | ${row.join(' | ')} |`);
    }
    const row = [];
    for (const dig of [true, false]){
      const ms = [], made = [];
      for (const [x, y, z] of pts){
        const X = Math.floor(x) >> b, Z = Math.floor(z) >> b; let Y = Math.floor(y) >> b;
        if (!dig && ((Y + 1) << b) < S) Y++;                     // extend: the block above the surface
        const before = w.store.size, t0 = now();
        place(w.store, w.root, w.D, b, X, Y, Z, dig ? EMPTY : w.store.solid(b));
        ms.push(now() - t0); made.push(w.store.size - before);
      }
      row.push(`${fmt(median(ms))} | ${int(median(made))} | ${w.D - b}`);
    }
    console.log(`| ${w0.name} | ${s} | block, snapped (side ${side}) | ${row.join(' | ')} |`);
  }
}

/* ---- J. what an edit costs the view, three ways ----------------------------- */
function sculptViews(ws, only = null, title = 'J', byLod = false){
  console.log(`\n## ${title}. The view: stamps against the brick test, and brick patches at lod 0 (medians over the points)\n`);
  console.log('The eye is 3s + 32 above the edit. Stamp: jobs a stamp comparison asks for. Bricks: jobs the brick test asks for. Changed: output really differs. Lod-0 full and patch: worker ms to redo the changed-brick chunks at lod 0, each way; every patch is held to expandChunk byte for byte. KB: their records and words, what an upload would send.\n');
  console.log('| world | edit | cut | stamp jobs | brick-test jobs | changed | stamp worker ms | brick-test worker ms | lod-0 jobs | lod-0 changed | lod-0 full ms | lod-0 patch ms | slowest patch | bricks patched | KB |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  let patched = 0, unsound = 0;
  for (const w0 of ws){
    const colour = w0.field || colourOf(w0.colour);
    const edits = [
      ['place voxel', 1, (s, r, D, [x, y, z]) => place(s, r, D, 0, Math.floor(x), Math.floor(y) + 1, Math.floor(z), FULL)],
      ['break voxel', 1, (s, r, D, [x, y, z]) => place(s, r, D, 0, Math.floor(x), Math.floor(y), Math.floor(z), EMPTY)],
      ['carve ball 4', 4, (s, r, D, [x, y, z]) => carve(s, r, D, ball(x, y, z, 4))],
      ['carve ball 16', 16, (s, r, D, [x, y, z]) => carve(s, r, D, ball(x, y, z, 16))],
      ['add ball 4', 4, (s, r, D, [x, y, z]) => add(s, r, D, ball(x, y, z, 4))],
      ['add ball 16', 16, (s, r, D, [x, y, z]) => add(s, r, D, ball(x, y, z, 16))],
      ['add ellipsoid 16', 16, (s, r, D, [x, y, z]) => add(s, r, D, ellipsoid(x, y, z, 16, 8, 16))],
      ['carve cube 16', 16, (s, r, D, [x, y, z]) => { const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z); return carve(s, r, D, box(X - 16, Y - 16, Z - 16, X + 16, Y + 16, Z + 16)); }],
      ['extend block 8', 4, (s, r, D, [x, y, z]) => place(s, r, D, 3, Math.floor(x) >> 3, (Math.floor(y) >> 3) + 1, Math.floor(z) >> 3, s.solid(3))],
      ['extend block 32', 16, (s, r, D, [x, y, z]) => place(s, r, D, 5, Math.floor(x) >> 5, (Math.floor(y) >> 5) + 1, Math.floor(z) >> 5, s.solid(5))],
      ['dig block 8', 4, (s, r, D, [x, y, z]) => place(s, r, D, 3, Math.floor(x) >> 3, Math.floor(y) >> 3, Math.floor(z) >> 3, EMPTY)],
    ].filter(e => only ? only.includes(e[0]) : !/voxel/.test(e[0]));
    for (const [name, size, edit] of edits){
      const lods = new Map();
      const w = fresh(w0), pts = surfacePoints(w, QUICK ? 2 : 4, 80), counts = createCounts(w.store), rows = [];
      for (const p of pts){
        const out = edit(w.store, w.root, w.D, p);
        if (out === w.root) continue;
        counts.update();
        const d = dilate(diffChunks(w.store, w.root, out, w.D)), bd = brickDirty(w.store, w.root, out, w.D);
        const eye = [p[0], Math.min(p[1] + 3 * size + 32, 2 ** w.D - 2), p[2]];
        const sel = selectChunks(createWorld(w.store, out, w.D), eye);
        const r = { cut: sel.nodes.size, stamp: 0, brick: 0, changed: 0, stampMs: 0, brickMs: 0, l0: 0, l0changed: 0, l0full: 0, l0patch: 0, slowest: 0, bricks: 0, bytes: 0 };
        const differ = (a, b) => (a || b) && (!a || !b || a.length !== b.length || a.some((v, i) => v !== b[i]));
        for (const c of sel.nodes.values()){
          if (!d.has(c.key)) continue;
          const t0 = now(), j1 = job(w.store, out, w.D, counts, colour, c), ms = now() - t0;
          const j0 = job(w.store, w.root, w.D, counts, colour, c);
          const ch = differ(j0.records, j1.records) || (j1.records.length && differ(j0.attrs, j1.attrs));
          const asked = bd.has(c.key) || w.D < c.lod + 6;
          if (ch && !asked){ unsound++; throw new Error(`the brick test missed ${c.key} after ${name} in ${w0.name}`); }
          r.stamp++; r.stampMs += ms;
          if (ch) r.changed++;
          if (asked){ r.brick++; r.brickMs += ms; }
          if (asked){ if (!lods.has(c.lod)) lods.set(c.lod, [0, 0, 0]); const e = lods.get(c.lod); e[0]++; if (ch) e[1]++; e[2] += ms; }
          if (c.lod === 0 && bd.has(c.key)){
            const t1 = now(), pj = patchChunk(w.store, out, w.D, counts, colour, c, j0, bd.get(c.key)), pm = now() - t1;
            if (differ(pj.records, j1.records) || pj.borderStart !== (j1.borderStart ?? j1.records.length) || (j1.attrs && differ(pj.attrs, j1.attrs))) throw new Error(`the patch of ${c.key} isn't expandChunk's (${name}, ${w0.name})`);
            patched++;
            r.l0++; r.l0full += ms; r.l0patch += pm; r.slowest = Math.max(r.slowest, pm); r.bricks += pj.bricks;
            if (ch){ r.l0changed++; r.bytes += pj.records.byteLength + pj.attrs.byteLength; }
          }
        }
        rows.push(r);
      }
      if (!rows.length) continue;
      const m = f => median(rows.map(f));
      console.log(`| ${w0.name} | ${name} | ${int(m(r => r.cut))} | ${int(m(r => r.stamp))} | ${int(m(r => r.brick))} | ${int(m(r => r.changed))} | ${fmt(m(r => r.stampMs))} | ${fmt(m(r => r.brickMs))} | ${int(m(r => r.l0))} | ${int(m(r => r.l0changed))} | ${fmt(m(r => r.l0full))} | ${fmt(m(r => r.l0patch))} | ${fmt(m(r => r.slowest))} | ${int(m(r => r.bricks))} | ${int(m(r => r.bytes / 1024))} |`);
      if (byLod) console.log(`|  | lod: asked/changed/ms, summed over ${rows.length} points: ${[...lods].sort((a, b) => a[0] - b[0]).map(([l, e]) => `${l}: ${e[0]}/${e[1]}/${Math.round(e[2])}`).join(', ')} |`);
    }
  }
  console.log(`\n${patched} patches equal to expandChunk byte for byte; the brick test missed none.`);
}

/* ---- K. picking --------------------------------------------------------------- */
function picking(ws){
  const o = sculptOracle();
  console.log(`\n## K. Picking: one ray from 64 voxels off, at a surface point (held to a voxel-by-voxel march on ${o.rays} rays, ${o.hits} hits)\n`);
  console.log('| world | µs median | p99 | max | nodes visited, median | hits |');
  console.log('|---|---|---|---|---|---|');
  for (const w of ws){
    const pts = surfacePoints(w, 400, 80), rand = mulberry(5), us = [], vis = []; let hits = 0;
    for (let round = 0; round < 5; round++) for (const p of pts){
      const a = rand() * 6.283, e = 0.1 + rand() * 1.3, o2 = [p[0] + 64 * Math.cos(e) * Math.cos(a), p[1] + 64 * Math.sin(e), p[2] + 64 * Math.cos(e) * Math.sin(a)];
      const d = [p[0] - o2[0] + 1e-4, p[1] - o2[1] + 1e-4, p[2] - o2[2] + 1e-4], st = {}, t0 = now();
      if (pick(w.store, w.root, w.D, o2, d, st)) hits++;
      us.push((now() - t0) * 1000); vis.push(st.visited);
    }
    const s = [...us].sort((a, b) => a - b);
    console.log(`| ${w.name} | ${fmt(median(us))} | ${fmt(s[Math.floor(s.length * 0.99)])} | ${fmt(s[s.length - 1])} | ${int(median(vis))} | ${hits} of ${us.length} |`);
  }
}

/* ---- L. colour for adds: §5's option B, measured ------------------------------
   A field that wraps the world's own: the latest added box covering p, else
   the base. Boxes register in a coarse grid of 64³ cells, so a lookup scans
   that cell's list and not all of them. Geometry doesn't change here, so the
   difference in job time is the colour's alone. */
function editedColour(base, adds){
  const grid = new Map();
  adds.forEach((a, i) => {
    for (let z = a[2] >> 6; z <= (a[5] - 1) >> 6; z++) for (let y = a[1] >> 6; y <= (a[4] - 1) >> 6; y++) for (let x = a[0] >> 6; x <= (a[3] - 1) >> 6; x++){
      const k = x + 65536 * (y + 65536 * z);
      let l = grid.get(k); if (!l){ l = []; grid.set(k, l); }
      l.push(i);
    }
  });
  return (x, y, z) => {
    const l = grid.get((x >> 6) + 65536 * ((y >> 6) + 65536 * (z >> 6)));
    if (l) for (let i = l.length - 1; i >= 0; i--){
      const a = adds[l[i]];
      if (x >= a[0] && y >= a[1] && z >= a[2] && x < a[3] && y < a[4] && z < a[5]) return a[6];
    }
    return base(x, y, z);
  };
}
function addColour(ws){
  console.log('\n## L. Colour for adds: job ms with N added boxes (side 8) inside a 256³ region (medians over the 6 fullest lod-0 and lod-2 chunks in the region, 3 runs each)\n');
  console.log('| world | N | per grid cell, mean | lod-0 job ms | lod-2 job ms |');
  console.log('|---|---|---|---|---|');
  for (const w of ws){
    const base = colourOf(w.colour), counts = createCounts(w.store), rand = mulberry(31);
    const pts = surfacePoints(w, 40, 200), P = pts[0];
    if (!P) continue;
    // The chunks inside the region that hold the most records: the ones a lookup
    // really lands in. (A first version took them from sparse surface points, so
    // some missed the region altogether and flattered the answer.)
    const chunks = l => {
      const cs = 64 * 2 ** l, out = [], lo = P.map(v => Math.floor((v - 128) / cs)), hi = P.map(v => Math.floor((v + 127) / cs));
      for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++){
        const c = { lod: l, x, y, z }, n = job(w.store, w.root, w.D, counts, null, c).records.length;
        if (n) out.push([n, c]);
      }
      return out.sort((p, q) => q[0] - p[0]).slice(0, 6).map(e => e[1]);
    };
    const c0 = chunks(0), c2 = chunks(2);
    for (const N of [0, 100, 1000, 10000]){
      const adds = [];
      for (let i = 0; i < N; i++){
        const x = Math.floor(P[0] - 128 + rand() * 248), y = Math.floor(P[1] - 128 + rand() * 248), z = Math.floor(P[2] - 128 + rand() * 248);
        adds.push([x, y, z, x + 8, y + 8, z + 8, 0x3050a0]);
      }
      const f = N ? editedColour(base, adds) : base, cells = new Map();
      for (const a of adds) for (let z = a[2] >> 6; z <= (a[5] - 1) >> 6; z++) for (let y = a[1] >> 6; y <= (a[4] - 1) >> 6; y++) for (let x = a[0] >> 6; x <= (a[3] - 1) >> 6; x++){ const k = x + ',' + y + ',' + z; cells.set(k, (cells.get(k) || 0) + 1); }
      let entries = 0; for (const v of cells.values()) entries += v;
      const time = cs => { const ms = []; for (const c of cs) for (let i = 0; i < 3; i++){ const t0 = now(); job(w.store, w.root, w.D, counts, f, c); ms.push(now() - t0); } return median(ms); };
      console.log(`| ${w.name} | ${int(N)} | ${cells.size ? fmt(entries / cells.size) : '—'} | ${fmt(time(c0))} | ${fmt(time(c2))} |`);
    }
  }
}

/* ---- M. clicks: a session of block editing -----------------------------------
   Minecraft's loop, on the real pick: from an eye near the last hit, cast one
   ray, then either place a block against the face it came in by or break the
   block it hit. A placed block is the one holding the voxel just past that
   face, on its own grid, so it can swallow what's already in its cell; a block
   larger than a voxel still always changes something, since that voxel was
   empty. What's measured is the graph's side of a click: the pick, the edit, the nodes,
   and how many of them are still reachable at the end. */
function flatWorld(D){
  const store = createStore(), c = new Uint32Array(8);
  for (const o of [0, 1, 4, 5]) c[o] = store.solid(D - 1);
  return { name: `flat D=${D}`, store, root: store.intern(D, c), D, field: flatField, colour: null };
}
const flatField = (x, y, z) => { const j = ((x >> 4) ^ (z >> 4)) & 1; return rgb8(86 + 12 * j, 140 + 12 * j, 62); };
function clicks(w0, side, n){
  const w = fresh(w0), rand = mulberry(77), level = Math.log2(side), block = level ? w.store.solid(level) : FULL;
  const pts = surfacePoints(w, 64, Math.max(80, 4 * side)), pickUs = [], editUs = [], made = [];
  let at = pts[0], root = w.root, misses = 0, places = 0, breaks = 0, unchanged = 0, far = 0;
  const startSize = w.store.size;
  for (let i = 0; i < n; i++){
    const a = rand() * 6.283, e = 0.25 + rand() * 1.1, r = (4 + rand() * 12) * Math.max(1, side / 2);
    const o = [at[0] + r * Math.cos(e) * Math.cos(a), at[1] + r * Math.sin(e), at[2] + r * Math.cos(e) * Math.sin(a)];
    const d = [at[0] - o[0] + 1e-4, at[1] - o[1] + 1e-4, at[2] - o[2] + 1e-4];
    let t0 = now();
    const h = pick(w.store, root, w.D, o, d);
    pickUs.push((now() - t0) * 1000);
    if (!h || h.axis < 0){ misses++; at = pts[(i >> 3) % pts.length]; continue; }
    const v = [h.x, h.y, h.z], placing = rand() < 0.6;
    if (placing) v[h.axis] += h.normal;
    const before = w.store.size;
    t0 = now();
    const out = place(w.store, root, w.D, level, v[0] >> level, v[1] >> level, v[2] >> level, placing ? block : EMPTY);
    editUs.push((now() - t0) * 1000);
    made.push(w.store.size - before);
    if (placing) places++; else breaks++;
    if (out === root) unchanged++;
    root = out;
    at = [h.x + 0.5, h.y + 0.5, h.z + 0.5];
    if (at[0] < 64 || at[1] < 64 || at[2] < 64 || Math.max(...at) > 2 ** w.D - 64) { at = pts[(i >> 3) % pts.length]; far++; }
  }
  const grown = w.store.size - startSize;
  const p99 = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length * 0.99)]; };
  return { name: w0.name, side, n: made.length, pick: median(pickUs), pickP99: p99(pickUs), edit: median(editUs), editP99: p99(editUs),
           nodes: median(made), grown, misses, unchanged, places, breaks };
}
/* The promise a reach limit would rest on: a voxel within `reach` of the eye
   lies in a lod-0 leaf, so what you click is what's drawn. A lod-1 box holding
   a voxel closer than detail × 128 is itself closer than that, so it splits,
   unless the chunk cap refuses. Checked on real picks, with the cap reported. */
function reachCheck(w){
  const rand = mulberry(9), pts = surfacePoints(w, 40, 600), world = createWorld(w.store, w.root, w.D);
  const rows = [[64, 0, 0], [128, 0, 0], [255, 0, 0], [384, 0, 0], [512, 0, 0], [1024, 0, 0]];
  let capped = 0, eyes = 0;
  for (const p of pts){
    const eye = [p[0] + 4, p[1] + 12, p[2] + 4], sel = selectChunks(world, eye);
    eyes++; if (sel.capped) capped++;
    for (let i = 0; i < 400; i++){
      const a = rand() * 6.283, e = -0.05 - rand() * 0.8, d = [Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)];
      const h = pick(w.store, w.root, w.D, eye, d);
      if (!h || !h.t) continue;
      for (const r of rows) if (h.t < r[0]){
        r[1]++;
        if (sel.leafKeys.has('0:' + (h.x >> 6) + ',' + (h.y >> 6) + ',' + (h.z >> 6))) r[2]++;
      }
    }
  }
  return { rows, capped, eyes };
}
function clickSession(ws){
  const n = QUICK ? 400 : 4000;
  console.log(`\n## M. Clicks: ${int(n)} picks, each placing (60%) or breaking (40%) a snapped block near the last hit\n`);
  console.log('Store growth counts every node ever made. A click at 5 a second is 18,000 an hour.\n');
  console.log('| world | block side | pick µs median / p99 | edit µs median / p99 | new nodes a click | store MB, per hour at 5 clicks/s | misses | no change |');
  console.log('|---|---:|---|---|---:|---:|---:|---:|');
  for (const w of ws) for (const side of [1, 8]){
    const r = clicks(w, side, n), mbh = r.grown / r.n * 18000 * NODE_BYTES / 1048576;
    console.log(`| ${r.name} | ${side} | ${fmt(r.pick)} / ${fmt(r.pickP99)} | ${fmt(r.edit)} / ${fmt(r.editP99)} | ${fmt(r.nodes)} | ${fmt(mbh)} | ${r.misses} | ${r.unchanged} |`);
  }
  console.log('\n### Reach: how many picks closer than r land in a chunk drawn at lod 0 (default detail, 40 eyes, 400 rays each)\n');
  console.log('| world | r < 64 | < 128 | < 255 | < 384 | < 512 | < 1024 | eyes with the chunk cap binding |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const w of ws){
    const { rows, capped, eyes } = reachCheck(w);
    console.log(`| ${w.name} | ${rows.map(r => r[1] ? `${(100 * r[2] / r[1]).toFixed(1)}%` : '—').join(' | ')} | ${capped} of ${eyes} |`);
  }
}

/* ---- O. flat and empty worlds, by depth -----------------------------------------
   Space costs nothing, so "expanding" may have nothing to do: a deep world is
   the same few nodes, and the cut never enters EMPTY. The two kinds of growth
   are here to compare against that. growOneSided: the old root becomes child 0,
   one intern, and every key stays. growCentred: each old child goes in the
   inner corner of a new one, 9 interns, and every coordinate moves by half a
   side, so every key changes. Its coarse cells land in different parents too. */
function growOneSided(store, root, D){ const c = new Uint32Array(8); c[0] = root; return store.intern(D + 1, c); }
function growCentred(store, root, D){
  const top = new Uint32Array(8);
  for (let o = 0; o < 8; o++){ const c = new Uint32Array(8); c[7 - o] = kidOf(store, root, o); top[o] = store.intern(D, c); }
  return store.intern(D + 1, top);
}
// The walls, floor and roof of a 16 × 8 × 16 box of voxels, as single clicks.
function house(store, root, D, x0, y0, z0){
  let r = root, n = 0;
  const made = [];
  for (let y = 0; y < 8; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++){
    if (y && y < 7 && x && x < 15 && z && z < 15) continue;
    const before = store.size;
    r = place(store, r, D, 0, x0 + x, y0 + y, z0 + z, FULL);
    made.push(store.size - before); n++;
  }
  return { root: r, n, made };
}
const VIEW_DENSITY = [0.27, 0.025];   // the viewer's default ?density
function cutCost(store, root, D, eye, field, counts){
  const sel = selectChunks(createWorld(store, root, D), eye);
  let ms = 0, recs = 0, nonempty = 0, ray = 0;
  for (const c of sel.nodes.values()){
    const t0 = now(), j = job(store, root, D, counts, field, c);
    ms += now() - t0;
    const n = j.count ?? 0;
    recs += n; if (n) nonempty++;
    const occ = (j.occupied ?? 0) / 262144, thr = VIEW_DENSITY[0] + (VIEW_DENSITY[1] - VIEW_DENSITY[0]) * occ;
    if (n / chunkFootprint(c, { pxPerRadian: DEFAULTS.pxPerRadian, screenPixels: DEFAULTS.screenPixels }) > thr * DEFAULTS.densityBand) ray++;
  }
  return { sel, ms, recs, nonempty, ray, nodes: sel.nodes.size, leaves: sel.leaves.length, capped: sel.capped };
}
function depthTable(){
  const Ds = QUICK ? [12, 16, 26] : [12, 16, 20, 24, 26, 28];
  console.log('\n## O. Flat and empty worlds, by depth\n');
  console.log('### Flat: half the world solid (no floor to dig to), the eye 64 above the ground. One voxel placed under it.\n');
  console.log('| D | side | nodes | build ms | cut, nodes / leaves | lods in the cut | chunks with records | records | first load, worker ms | ray-side chunks by density | new nodes, one voxel | stamp jobs | brick-test jobs | changed | brick-test worker ms |');
  console.log('|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const D of Ds){
    const t0 = now(), w = flatWorld(D), build = now() - t0, c = 2 ** (D - 1), counts = createCounts(w.store);
    const eye = [c + 32.5, c + 64, c + 32.5], first = cutCost(w.store, w.root, D, eye, flatField, counts);
    const nodes0 = w.store.size, out = place(w.store, w.root, D, 0, c + 32, c, c + 32, FULL), made = w.store.size - nodes0;
    counts.update();
    const d = dilate(diffChunks(w.store, w.root, out, D)), bd = brickDirty(w.store, w.root, out, D), sel = selectChunks(createWorld(w.store, out, D), eye);
    let stamp = 0, brick = 0, changed = 0, ms = 0;
    const differ = (a, b) => (a || b) && (!a || !b || a.length !== b.length || a.some((v, i) => v !== b[i]));
    for (const ch of sel.nodes.values()){
      if (!d.has(ch.key)) continue;
      const t1 = now(), j1 = job(w.store, out, D, counts, flatField, ch), jm = now() - t1, j0 = job(w.store, w.root, D, counts, flatField, ch);
      const diff = differ(j0.records, j1.records) || (j1.records.length && differ(j0.attrs, j1.attrs));
      const asked = bd.has(ch.key) || D < ch.lod + 6;
      if (diff && !asked) throw new Error(`the brick test missed ${ch.key} in flat D=${D}`);
      stamp++; if (asked){ brick++; ms += jm; } if (diff) changed++;
    }
    const lods = new Set([...first.sel.nodes.values()].map(n => n.lod)).size;
    console.log(`| ${D} | ${int(2 ** D)} | ${w.store.size - made} | ${fmt(build)} | ${int(first.nodes)} / ${int(first.leaves)}${first.capped ? ' (capped)' : ''} | ${lods} | ${int(first.nonempty)} | ${int(first.recs)} | ${int(first.ms)} | ${first.ray} | ${made} | ${stamp} | ${brick} | ${changed} | ${fmt(ms)} |`);
  }
  console.log('\n### Empty: nothing but a hollow 16 × 8 × 16 box placed voxel by voxel at the world\'s centre, the eye 64 off.\n');
  console.log('| D | clicks | new nodes a click, median | live nodes | store nodes | ms for all clicks | cut, nodes / leaves | chunks with records | records | jobs a click, brick test | their worker ms |');
  console.log('|---:|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|');
  for (const D of Ds){
    const store = createStore(), c = 2 ** (D - 1), t0 = now(), h = house(store, EMPTY, D, c, c, c), ms = now() - t0, counts = createCounts(store);
    const live = prune(store.snapshot().keys, [h.root]).keys.length;
    const eye = [c + 80.5, c + 40, c + 8.5], cut = cutCost(store, h.root, D, eye, flatField, counts);
    const out = place(store, h.root, D, 0, c + 8, c + 8, c + 8, FULL); counts.update();
    const bd = brickDirty(store, h.root, out, D), sel = selectChunks(createWorld(store, out, D), eye);
    let jobs = 0, jm = 0;
    for (const ch of sel.nodes.values()) if (bd.has(ch.key)){ const t1 = now(); job(store, out, D, counts, flatField, ch); jm += now() - t1; jobs++; }
    console.log(`| ${D} | ${h.n} | ${median(h.made)} | ${int(live)} | ${int(store.size)} | ${fmt(ms)} | ${int(cut.nodes)} / ${int(cut.leaves)} | ${int(cut.nonempty)} | ${int(cut.recs)} | ${jobs} | ${fmt(jm)} |`);
  }
  console.log('\n### Growing that box\'s D = 16 world to D = 17: what stays\n');
  console.log('| how | new nodes | voxels kept | keys of the old cut still in the new cut, eye moved with the content |');
  console.log('|---|---:|---:|---:|');
  {
    const D = 16, store = createStore(), c = 2 ** (D - 1), h = house(store, EMPTY, D, c, c, c), eye = [c + 80.5, c + 40, c + 8.5];
    const old = selectChunks(createWorld(store, h.root, D), eye), counts = createCounts(store), voxels = counts.of(h.root);
    for (const [name, grow, off] of [['one-sided: the old root is child 0', growOneSided, 0], ['centred: each old child in an inner corner', growCentred, c]]){
      const before = store.size, r = grow(store, h.root, D); counts.update();
      const sel = selectChunks(createWorld(store, r, D + 1), eye.map(v => v + off));
      let kept = 0; for (const k of old.nodes.keys()) if (sel.nodes.has(k)) kept++;
      if (counts.of(r) !== voxels) throw new Error(`${name} lost voxels`);
      console.log(`| ${name} | ${store.size - before} | ${int(counts.of(r))} of ${int(voxels)} | ${kept} of ${old.nodes.size} |`);
    }
  }
}

/* ---- P. a colour for each snapped block ------------------------------------------
   L's grid of lists is fine for side-8 boxes, 111 to a grid cell. Single voxels
   can pile up 262,144 to a 64³ cell, and every lookup that misses scans them
   all. But a snapped block lives on its own grid, so it needs no overlap test:
   one hash probe per block size in use. The latest op wins across sizes, so an
   entry holds its op's sequence number. Open addressing over typed arrays, since
   this is what would have to reach every worker. */
function blockColour(base){
  let cap = 1 << 12, keys = new Int32Array(cap * 4).fill(-1), vals = new Int32Array(cap * 2), used = 0, seq = 0;
  const sizes = [];
  const slot = (l, X, Y, Z) => {
    let h = Math.imul(X, 73856093) ^ Math.imul(Y, 19349663) ^ Math.imul(Z, 83492791) ^ Math.imul(l, 2654435761);
    h = (h ^ (h >>> 15)) & (cap - 1);
    for (;; h = (h + 1) & (cap - 1)){
      const i = h * 4;
      if (keys[i] === -1 || (keys[i] === l && keys[i + 1] === X && keys[i + 2] === Y && keys[i + 3] === Z)) return h;
    }
  };
  const put = (l, X, Y, Z, colour, s) => {
    const h = slot(l, X, Y, Z);
    if (keys[h * 4] === -1){ keys[h * 4] = l; keys[h * 4 + 1] = X; keys[h * 4 + 2] = Y; keys[h * 4 + 3] = Z; used++; }
    vals[h * 2] = s; vals[h * 2 + 1] = colour;
  };
  const field = (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let best = -1, colour = 0;
    for (let n = 0; n < sizes.length; n++){
      const l = sizes[n], h = slot(l, xi >> l, yi >> l, zi >> l);
      if (keys[h * 4] !== -1 && vals[h * 2] > best){ best = vals[h * 2]; colour = vals[h * 2 + 1]; }
    }
    return best >= 0 ? colour : base(x, y, z);
  };
  field.add = (l, X, Y, Z, colour) => {
    if (!sizes.includes(l)) sizes.push(l);
    if ((used + 1) * 2 > cap){
      const k0 = keys, v0 = vals, c0 = cap;
      cap *= 2; keys = new Int32Array(cap * 4).fill(-1); vals = new Int32Array(cap * 2); used = 0;
      for (let h = 0; h < c0; h++) if (k0[h * 4] !== -1) put(k0[h * 4], k0[h * 4 + 1], k0[h * 4 + 2], k0[h * 4 + 3], v0[h * 2 + 1], v0[h * 2]);
    }
    put(l, X, Y, Z, colour, seq++);
  };
  field.bytes = () => keys.byteLength + vals.byteLength;
  field.used = () => used;
  return field;
}
function blockColourOracle(){
  const rand = mulberry(101), ops = [], f = blockColour(() => -1);
  for (let i = 0; i < 4000; i++){
    const l = [0, 0, 0, 3, 5][Math.floor(rand() * 5)], X = Math.floor(rand() * 256) >> l, Y = Math.floor(rand() * 256) >> l, Z = Math.floor(rand() * 256) >> l;
    ops.push([l, X, Y, Z, i]); f.add(l, X, Y, Z, i);
  }
  for (let i = 0; i < 40000; i++){
    const x = rand() * 256, y = rand() * 256, z = rand() * 256;
    let want = -1;
    for (let j = ops.length - 1; j >= 0; j--){ const [l, X, Y, Z, c] = ops[j]; if ((Math.floor(x) >> l) === X && (Math.floor(y) >> l) === Y && (Math.floor(z) >> l) === Z){ want = c; break; } }
    if (f(x, y, z) !== want) throw new Error(`blockColour disagrees with a scan at ${x},${y},${z}`);
  }
  return ops.length;
}
function blockColours(ws){
  const n = blockColourOracle();
  console.log(`\n## P. A colour for each snapped block (held to a backward scan of ${int(n)} ops of mixed sizes on 40,000 points)\n`);
  console.log('Time a lookup: a million points inside the region (2,000 for the slowest list), the blocks packed into a box of the side given. Job ms: L\'s lod-0 and lod-2 chunks, with single voxels spread through 256³.\n');
  console.log('| N single voxels | packed in | per 64³ cell, up to | grid of lists: ns a lookup | blockColour: ns a lookup | table MB |');
  console.log('|---:|---:|---:|---:|---:|---:|');
  const base = () => 0x808080, rand = mulberry(55);
  for (const [N, side] of [[1000, 256], [10000, 256], [100000, 256], [10000, 64], [100000, 64], [100000, 128]]){
    const adds = [], f = blockColour(base), seen = new Set();
    while (adds.length < N){
      const x = Math.floor(rand() * side), y = Math.floor(rand() * side), z = Math.floor(rand() * side), k = x + 1024 * (y + 1024 * z);
      if (seen.has(k)) continue; seen.add(k);
      adds.push([x, y, z, x + 1, y + 1, z + 1, 0x3050a0]); f.add(0, x, y, z, 0x3050a0);
    }
    const g = editedColour(base, adds), probes = 1000000, list = Math.min(probes, N >= 100000 && side <= 64 ? 2000 : probes), time = (fn, m) => { let s = 0; const r2 = mulberry(3), t0 = now(); for (let i = 0; i < m; i++) s += fn(r2() * side, r2() * side, r2() * side); return (now() - t0) / m * 1e6; };
    const perCell = new Map(); for (const a of adds){ const k = (a[0] >> 6) + 1024 * ((a[1] >> 6) + 1024 * (a[2] >> 6)); perCell.set(k, (perCell.get(k) || 0) + 1); }
    let most = 0; for (const v of perCell.values()) most = Math.max(most, v);
    console.log(`| ${int(N)} | ${side} | ${int(most)} | ${int(time(g, list))} | ${int(time(f, probes))} | ${fmt(f.bytes() / 1048576)} |`);
  }
  console.log('\n| world | N single voxels in 256³ | lod-0 job ms | lod-2 job ms |');
  console.log('|---|---:|---:|---:|');
  for (const w of ws){
    const b = w.field || colourOf(w.colour), counts = createCounts(w.store), P = surfacePoints(w, 40, 200)[0], rand2 = mulberry(31);
    if (!P) continue;
    const chunks = l => {
      const cs = 64 * 2 ** l, out = [], lo = P.map(v => Math.floor((v - 128) / cs)), hi = P.map(v => Math.floor((v + 127) / cs));
      for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++){
        const c = { lod: l, x, y, z }, m = job(w.store, w.root, w.D, counts, null, c).records.length;
        if (m) out.push([m, c]);
      }
      return out.sort((p, q) => q[0] - p[0]).slice(0, 6).map(e => e[1]);
    };
    const c0 = chunks(0), c2 = chunks(2);
    for (const N of [0, 10000, 100000]){
      const f = blockColour(b);
      for (let i = 0; i < N; i++) f.add(0, Math.floor(P[0] - 128 + rand2() * 256), Math.floor(P[1] - 128 + rand2() * 256), Math.floor(P[2] - 128 + rand2() * 256), 0x3050a0);
      const fn = N ? f : b, time = cs => { const ms = []; for (const c of cs) for (let i = 0; i < 3; i++){ const t0 = now(); job(w.store, w.root, w.D, counts, fn, c); ms.push(now() - t0); } return median(ms); };
      console.log(`| ${w.name} | ${int(N)} | ${fmt(time(c0))} | ${fmt(time(c2))} |`);
    }
  }
}

/* ---- run ------------------------------------------------------------------- */
const t0 = now(), o = oracle();
console.log(`oracle passed: difference, intersect, union, complement, carve, add, half-space, shift, canonical ids; ${o.checked} chunks outside the dirty set unchanged (${(now() - t0).toFixed(0)} ms)`);
const ws = worlds();
console.log(ws.map(w => `${w.name}: ${w.store.size.toLocaleString('en-US')} nodes`).join('; '));
const only = (process.argv.find(a => a.startsWith('--only=')) || '--only=abcdefghijklmnop').slice(7);
if (only.includes('a')) stamps(ws);
if (only.includes('b')) views(ws);
if (only.includes('c')) strokes(ws);
if (only.includes('d')) worldOps();
if (only.includes('e')) planes(ws);
if (only.includes('f')) shifts(ws);
if (only.includes('g')) partEdit();
if (only.includes('h')) plumbing(ws);
const sculptWorlds = ws.filter(w => /kit D=16|terrain|caves/.test(w.name));
if (only.includes('i')) brushes(sculptWorlds);
if (only.includes('j')) sculptViews(sculptWorlds);
if (only.includes('k')) picking(sculptWorlds);
if (only.includes('l')) addColour(ws.filter(w => /terrain|caves/.test(w.name)));
const blockWorlds = [...sculptWorlds, flatWorld(16), flatWorld(26)];
if (only.includes('m')) clickSession(blockWorlds);
if (only.includes('n')) sculptViews(blockWorlds, ['place voxel', 'break voxel', 'extend block 8', 'dig block 8'], 'N', true);
if (only.includes('o')) depthTable();
if (only.includes('p')) blockColours(sculptWorlds);
console.log(`\ntotal ${((now() - t0) / 1000).toFixed(0)} s`);
