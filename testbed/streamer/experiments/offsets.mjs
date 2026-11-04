/* Repeat offsets: where a world repeats itself, read off its DAG
   (docs/nodesastuples.md §7, idea 1, which you picked).

     node experiments/offsets.mjs           # ~1 min; writes worlds/*.offsets.L<k>.i16 (gitignored), docs/images/offsets-*.png
                                            # (projections, and -slice: the planes through offset 0), docs/data/offsets.json
     node experiments/offsets.mjs --print   # the tables only

   A node's uses are the places it appears in the world: one a path from
   the root. Two uses of one node are two places holding the same 2^k-cube,
   and their offset (dx, dy, dz) is a point; every pair of uses, at every
   level, is the world's autocorrelation, as far as whole aligned cubes go.
   A voxel grid would have to compare every cube with every other; the
   DAG has already grouped them.

   One file a level k (k ≥ 1; level 0 is FULL, a single voxel), little-
   endian int16 triples for DataPrism's "3-Tuple, Int16, Little". Each
   pair is written both ways (d and −d), so the cloud is symmetric about
   its centre, as an autocorrelation is. Offsets are scaled by
   ⌊32767 / 2^D⌋ so the world's width fills int16's range (DataPrism maps
   the type's whole range to [−1, 1]); that keeps every offset's ratio.

   A level-k node sits on its level's grid, so every level-k offset is a
   multiple of 2^k: each file is a lattice of spacing 2^k, and what shows
   is how full it is, where.

   The pairs grow as uses squared (6.9 billion at level 1 in the default
   lattice), so past MAX_PAIRS a level is sampled: MAX_PAIRS pairs, each a
   node chosen in proportion to its pair count, then two different uses
   of it, uniformly. "top offsets" counts the pairs written, so on a
   sampled level they're a sample's shares.

   Worlds:
   - the default lattice (R = 32, 8³): every specimen different, so
     nothing above level 4 repeats;
   - R = 6 at 64³: the default pitch is 8 = B, so every specimen is one
     level-3 node, and 262,144 cells is past R = 6's unique supply, so
     whole specimens repeat;
   - the testbed's row 36, "··EV uniform" (shell subsets) at L = 4: every
     4×4×4 cell keeps its 32 edge and corner cells, at every level, an
     exact self-similar fractal (Menger's sponge in base 4). 1M voxels in
     36 nodes. It overlaps itself so densely that every offset occurs:
     its structure is in how often, which DataPrism's dedup drops;
   - row 56, "···V uniform": only the 8 corner cells, Cantor dust (4,096
     voxels), whose offsets are themselves a dust with gaps: the check
     that the picture shows the maps. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { createStore, FIRST_NODE } from '../dag-core.js';
import { buildLattice, latticeDesc } from '../lattice-core.js';
import { loadTestbed, rowsOf, automatonOf } from './testbed-corpus.mjs';
import { keep, preview, BITS } from './dataprism.mjs';

const PRINT = process.argv.includes('--print');
const started = performance.now();
const MAX_PAIRS = 2 ** 21, TOP = 6;

function rng(seed){
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

/* Every use of every node used more than once: uses counted down the ids
   (a node's uses are its parents' uses, once a child slot), then the tree
   walked from the root to list their places (cell low corners, voxels). */
function usesOf(keys, root, D){
  const n = keys.length / 9, uses = new Float64Array(n + FIRST_NODE);
  uses[root] = 1;
  for (let id = n + FIRST_NODE - 1; id >= FIRST_NODE; id--)
    for (let o = 1; o <= 8; o++){ const c = keys[(id - FIRST_NODE) * 9 + o]; if (c >= FIRST_NODE) uses[c] += uses[id]; }
  // Places, grouped by node: start[id] .. start[id] + uses[id] in `at`.
  const start = new Int32Array(n + FIRST_NODE + 1).fill(-1), fill = new Int32Array(n + FIRST_NODE);
  let total = 0;
  for (let id = FIRST_NODE; id < n + FIRST_NODE; id++) if (uses[id] > 1){ start[id] = total; total += uses[id]; }
  const at = new Int32Array(3 * total), stack = [[root, D, 0, 0, 0]];
  while (stack.length){
    const [id, lev, x, y, z] = stack.pop();
    if (start[id] >= 0){ at.set([x, y, z], 3 * (start[id] + fill[id]++)); }
    if (lev === 1) continue;                        // level 0 is FULL: a voxel, not a cube
    const h = 1 << (lev - 1), s = (id - FIRST_NODE) * 9;
    for (let o = 0; o < 8; o++){
      const c = keys[s + 1 + o];
      if (c >= FIRST_NODE) stack.push([c, lev - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h]);
    }
  }
  return { uses, start, at, levelOf: id => keys[(id - FIRST_NODE) * 9] };
}

// The pairs at level k, both ways, as int16 triples, and the most common offsets.
function pairsAt(k, { uses, start, at, levelOf }, D, seed){
  const nodes = [];
  for (let id = FIRST_NODE; id < uses.length; id++) if (start[id] >= 0 && levelOf(id) === k) nodes.push(id);
  const weight = nodes.map(id => uses[id] * (uses[id] - 1) / 2), all = weight.reduce((a, b) => a + b, 0);
  if (!all) return null;
  const sampled = all > MAX_PAIRS, count = sampled ? MAX_PAIRS : all, out = new Int16Array(6 * count), s = Math.floor(32767 / 2 ** D);
  const tally = new Map(), put = (j, a, b) => {
    const d = [0, 1, 2].map(i => at[3 * b + i] - at[3 * a + i]), key = d.join(',');
    tally.set(key, (tally.get(key) || 0) + 1);
    for (let i = 0; i < 3; i++){ out[6 * j + i] = d[i] * s; out[6 * j + 3 + i] = -d[i] * s; }
  };
  let j = 0;
  if (!sampled){
    for (const id of nodes) for (let a = 0; a < uses[id]; a++) for (let b = a + 1; b < uses[id]; b++) put(j++, start[id] + a, start[id] + b);
  } else {
    const r = rng(seed), cum = [];
    let acc = 0;
    for (const w of weight) cum.push(acc += w);
    for (; j < count; j++){
      const t = r() * all;
      let lo = 0, hi = cum.length - 1;
      while (lo < hi){ const mid = (lo + hi) >> 1; if (cum[mid] > t) hi = mid; else lo = mid + 1; }
      const id = nodes[lo], u = uses[id], a = Math.floor(r() * u);
      let b = Math.floor(r() * (u - 1));
      if (b >= a) b++;
      put(j, start[id] + a, start[id] + b);
    }
  }
  // The most common offsets, one sign (the larger of d and −d, read as a string, so each pair counts once).
  const merged = new Map();
  for (const [key, c] of tally){
    const d = key.split(',').map(Number), neg = d.map(v => -v).join(','), canon = key > neg ? key : neg;
    merged.set(canon, (merged.get(canon) || 0) + c);
  }
  const top = [...merged].sort((x, y) => y[1] - x[1]).slice(0, TOP).map(([key, c]) => ({ d: key, share: c / count }));
  return { nodes: nodes.length, pairs: all, written: count, sampled, out, top, distinct: merged.size };
}

const tb = loadTestbed(), ROWS = rowsOf(tb);
function rowWorld(index, L){
  const row = ROWS[index], s = createStore(), a = automatonOf(tb, row.cfgFor(L));
  const { root, D } = s.fromRadix4(L, a.start, a.step, a.accept, a.keyOf);
  return { store: s, root, D };
}
const WORLDS = [
  ['lattice-r32-8', () => { const b = buildLattice(latticeDesc({ R: 32, n: 8 })); return { store: b.store, root: b.root, D: b.D }; }],
  ['lattice-r6-64', () => { const b = buildLattice(latticeDesc({ R: 6, n: 64 })); return { store: b.store, root: b.root, D: b.D }; }],
  ['row36-EV-L4', () => rowWorld(36, 4)],
  ['row56-V-L4', () => rowWorld(56, 4)],
];
const rows = [];
if (!PRINT){ mkdirSync('worlds', { recursive: true }); mkdirSync('docs/images', { recursive: true }); mkdirSync('docs/data', { recursive: true }); }
for (const [name, make] of WORLDS){
  const w = make(), keys = w.store.snapshot().keys, u = usesOf(keys, w.root, w.D);
  for (let k = 1; k < w.D; k++){
    const p = pairsAt(k, u, w.D, 1000 * k + 7);
    if (!p) continue;
    const pts = keep(p.out, 'int16'), file = `${name}.offsets.L${k}.i16`;
    rows.push({ world: name, D: w.D, level: k, nodes: p.nodes, pairs: p.pairs, written: p.written, sampled: p.sampled, distinct: p.distinct, kept: pts.length, top: p.top, file });
    if (!PRINT){
      writeFileSync(`worlds/${file}`, Buffer.from(p.out.buffer, p.out.byteOffset, p.out.byteLength));
      writeFileSync(`docs/images/offsets-${name}-L${k}.png`, preview(pts));
      writeFileSync(`docs/images/offsets-${name}-L${k}-slice.png`, preview(pts, { slice: true }));
    }
    console.log(`${name} level ${k}: ${p.nodes} repeated nodes, ${p.pairs.toExponential(2)} pairs${p.sampled ? `, ${p.written.toLocaleString()} sampled` : ''}, ` +
                `${p.distinct.toLocaleString()} distinct offsets, ${pts.length.toLocaleString()} kept at ${BITS} bits; top ${p.top.map(t => `(${t.d}) ${(100 * t.share).toFixed(1)}%`).join(' ')}`);
  }
}
if (!PRINT) writeFileSync('docs/data/offsets.json', JSON.stringify({ maxPairs: MAX_PAIRS, rows }, null, 1));
console.log(`${((performance.now() - started) / 1000).toFixed(0)} s`);
