/* What a second copy of a thing costs a DAG, by where it's put
   (docs/scenegraph.md §3.1).

     node experiments/copy-offset.mjs     # ~5 s; prints a markdown table, writes nothing

   Hash-consing is instancing, but only on the grid: a copy moved by a
   multiple of 2^j lands its level-j nodes on level-j nodes, so it shares
   them, and only the levels above j are new. A copy moved off the grid by
   one voxel cuts every node differently, so it's a new copy all the way
   down. This puts a number on that, the question behind "bake a child
   world into its parent, or keep it separate and place it".

   Six block-showroom specimens of R = 48 (the lattice's recipes 0-5, seed 1:
   stack [3, 2, 2, 2, 2]), each alone in a D = 8 world at the origin, then
   with a second copy at x = 128 + s. The cost is the second copy's new
   nodes over the first's, after a prune. Then a copy turned by one of the
   24 rotations (scatter-core's PROPER[5]) at x = 128, which shares only
   what the specimen's own symmetry shares.

   One thing to know when reading it: at +1 and +2 the second copy can cost
   more than the first (over 100%), because the shifted copy's cut through
   the grid happens to break into more distinct nodes than the original's. */
import { createStore, prune } from '../dag-core.js';
import { buildRecipe } from '../lattice-core.js';
import { rotateOcc, PROPER } from '../scatter-core.js';

const D = 8, N = 1 << D, R = 48, SHIFTS = [64, 32, 16, 8, 4, 2, 1];

/* A dense world holding each (occ, offset), as one DAG; its node count
   after a prune (fromDense leaves nothing unreachable, but prune counts
   exactly what the root reaches, which is what a file or a worker holds). */
function nodesOf(objs){
  const occ = new Uint8Array(N * N * N);
  for (const [o, [ox, oy, oz]] of objs)
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++)
      if (o[x + R * (y + R * z)]) occ[(x + ox) + N * ((y + oy) + N * (z + oz))] = 1;
  const s = createStore(), { root } = s.fromDense(occ, N);
  return prune(s.snapshot().keys, [root]).keys.length / 9;
}

const pct = v => `${(v * 100).toFixed(0)}%`;
console.log(`| specimen | voxels | nodes | ${SHIFTS.map(s => `+${s}`).join(' | ')} | turned |`);
console.log(`|---:|---:|---:|${SHIFTS.map(() => '---:').join('|')}|---:|`);
for (let n = 0; n < 6; n++){
  const o = buildRecipe({ R, seed: 1, axes: 'random' }, n);
  const one = nodesOf([[o, [0, 0, 0]]]);
  const cost = s => (nodesOf([[o, [0, 0, 0]], [o, [128 + s, 0, 0]]]) - one) / one;
  const turned = (nodesOf([[o, [0, 0, 0]], [rotateOcc(o, R, PROPER[5]), [128, 0, 0]]]) - one) / one;
  const voxels = o.reduce((a, b) => a + b, 0);
  console.log(`| ${n} | ${voxels.toLocaleString('en-US')} | ${one.toLocaleString('en-US')} | ${SHIFTS.map(s => pct(cost(s))).join(' | ')} | ${pct(turned)} |`);
}
