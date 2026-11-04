/* The node graph as tuples, for DataPrism (docs/nodesastuples.md).

     node experiments/tuples.mjs           # ~30 s; writes worlds/*.u32 (gitignored), docs/images/tuples-*.png, docs/data/tuples.json
     node experiments/tuples.mjs --print   # the table only

   You picked views A, B and D, and the labelled DAG too (§5 there). Each
   is written for two lattices (the default, R = 32 at 8³, and R = 5 at
   32³), in two orders: build order (the store's ids) and depth-first
   (post-order from the root, children just before their parents). Every
   file is bare little-endian uint32 triples, ready for DataPrism's
   "3-Tuple (XYZ), Uint32, Little".

     A  raw    the store's records, 9 words = 3 tuples a node:
               (level, c0, c1), (c2, c3, c4), (c5, c6, c7)
     B  edges  (parent, child, octant), one a non-empty child
     D  place  (x, y, z): the centre of the node's cell where the walk
               first meets it, in voxels
     L  labels (class, pose, level): createClasses over Oh (SSVDAG)

   Scaled, not changed. DataPrism maps a uint32 over its whole range to
   [−1, 1], and our ids are below 2^17, so unscaled every point would land
   in DataPrism's first bin and the file would draw as one dot. Each axis
   is multiplied by ⌊(2^32 − 1) / its largest value⌋ (A's three positions
   share one factor, because they hold the same kind of number), which
   keeps every value's order and spacing.

   The previews are what DataPrism would keep, not its picture: each
   value normalised as DataPrism does, binned at its default 8 bits an
   axis, duplicates dropped, then drawn straight down each axis (XY, XZ,
   YZ; the nearest point wins, coloured by its position as DataPrism's
   XYZ colour is). The count of points left is the answer to "does it
   all collapse?". DataPrism's chunk grid (1 MB chunks in a 3³ grid) is
   left out: order shows there, and only there for view D. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createStore, createClasses, createCounts, OH48, FIRST_NODE, FULL } from '../dag-core.js';
import { buildLattice, latticeDesc } from '../lattice-core.js';
import { keep, preview, BITS as Q } from './dataprism.mjs';

const PRINT = process.argv.includes('--print');
const started = performance.now();
const U32 = 4294967295;

/* Post-order from the root, octants in order: `order` lists the old ids
   as the walk finishes them (the new ids are their positions + 2), and
   `first` is where the walk first met each node (its cell's low corner). */
function walk(keys, root, D){
  const n = keys.length / 9, order = [], first = new Int32Array(3 * (n + FIRST_NODE)).fill(-1), seen = new Uint8Array(n + FIRST_NODE);
  const stack = [[root, D, 0, 0, 0, 0]];
  seen[root] = 1; first.set([0, 0, 0], 3 * root);
  while (stack.length){
    const top = stack[stack.length - 1], [id, lev, x, y, z, o] = top;
    if (o === 8){ order.push(id); stack.pop(); continue; }
    top[5]++;
    const c = keys[(id - FIRST_NODE) * 9 + 1 + o], h = 1 << (lev - 1);
    if (c < FIRST_NODE || seen[c]) continue;
    seen[c] = 1;
    const cx = x + (o & 1) * h, cy = y + (o >> 1 & 1) * h, cz = z + (o >> 2) * h;
    first.set([cx, cy, cz], 3 * c);
    stack.push([c, lev - 1, cx, cy, cz, 0]);
  }
  return { order, first };
}
// The keys renumbered in walk order: still children-first.
function renumber(keys, order){
  const map = new Uint32Array(keys.length / 9 + FIRST_NODE), out = new Uint32Array(keys.length);
  map[FULL] = FULL;
  order.forEach((id, i) => { map[id] = FIRST_NODE + i; });
  order.forEach((id, i) => {
    const s = (id - FIRST_NODE) * 9;
    out[9 * i] = keys[s];
    for (let o = 1; o <= 8; o++) out[9 * i + o] = map[keys[s + o]];
  });
  return { keys: out, map };
}

const scale = max => Math.floor(U32 / Math.max(1, max));
// Each view: the triples as a Uint32Array, scaled.
function viewA(keys){
  const s = scale(keys.length / 9 + FIRST_NODE - 1), out = new Uint32Array(keys.length);
  for (let i = 0; i < keys.length; i++) out[i] = keys[i] * s;
  return out;
}
function viewB(keys){
  const n = keys.length / 9, s = scale(n + FIRST_NODE - 1), so = scale(7), out = [];
  for (let i = 0; i < n; i++) for (let o = 0; o < 8; o++){
    const c = keys[9 * i + 1 + o];
    if (c) out.push((i + FIRST_NODE) * s, c * s, o * so);
  }
  return Uint32Array.from(out);
}
function viewD(keys, ids, first, D){
  const s = scale(2 ** D), out = new Uint32Array(3 * ids.length);
  ids.forEach((id, i) => {
    const h = 1 << (keys[(id - FIRST_NODE) * 9] - 1);   // half the node's side: its cell's centre
    for (let a = 0; a < 3; a++) out[3 * i + a] = (first[3 * id + a] + h) * s;
  });
  return out;
}
function viewL(classes, ids, levelOf, D){
  let top = 0;
  for (const id of ids) top = Math.max(top, classes.cls(id));
  const sc = scale(top), sp = scale(47), sl = scale(D), out = new Uint32Array(3 * ids.length);
  ids.forEach((id, i) => out.set([classes.cls(id) * sc, classes.pose(id) * sp, levelOf(id) * sl], 3 * i));
  return out;
}

const WORLDS = [['lattice-r32-8', { R: 32, n: 8 }], ['lattice-r5-32', { R: 5, n: 32 }]];
const rows = [];
if (!PRINT){ mkdirSync('worlds', { recursive: true }); mkdirSync('docs/images', { recursive: true }); mkdirSync('docs/data', { recursive: true }); }
for (const [name, over] of WORLDS){
  const b = buildLattice(latticeDesc(over)), keys = b.store.snapshot().keys, D = b.D, n = keys.length / 9;
  const { order, first } = walk(keys, b.root, D);
  if (order.length !== n) throw new Error(`${name}: the walk reached ${order.length} of ${n} nodes (not pruned?)`);
  const dfs = renumber(keys, order);
  // The renumbered store is the same world: same voxels under the root.
  const check = createStore(), m = check.importKeys(dfs.keys);
  if (createCounts(check).of(m[dfs.map[b.root]]) !== createCounts(b.store).of(b.root)) throw new Error(`${name}: renumbering changed the world`);
  const classes = createClasses(b.store, OH48), levelOf = id => b.store.levelOf(id);
  const ids = Array.from({ length: n }, (_, i) => FIRST_NODE + i);
  const files = {
    'A.id': viewA(keys), 'A.dfs': viewA(dfs.keys),
    'B.id': viewB(keys), 'B.dfs': viewB(dfs.keys),
    'D.id': viewD(keys, ids, first, D), 'D.dfs': viewD(keys, order, first, D),
    'L.id': viewL(classes, ids, levelOf, D), 'L.dfs': viewL(classes, order, levelOf, D),
  };
  for (const [key, t] of Object.entries(files)){
    const pts = keep(t, 'uint32'), file = `${name}.${key}.u32`;
    rows.push({ world: name, view: key, file, tuples: t.length / 3, bytes: t.byteLength, kept: pts.length, classes: classes.size, nodes: n });
    if (!PRINT){
      writeFileSync(`worlds/${file}`, Buffer.from(t.buffer, t.byteOffset, t.byteLength));
      writeFileSync(`docs/images/tuples-${name}-${key.replace('.', '-')}.png`, preview(pts));
    }
    console.log(`${file}: ${(t.length / 3).toLocaleString()} tuples, ${pts.length.toLocaleString()} kept at ${Q} bits`);
  }
}
if (!PRINT) writeFileSync('docs/data/tuples.json', JSON.stringify({ q: Q, rows }, null, 1));
console.log(`${((performance.now() - started) / 1000).toFixed(0)} s`);
