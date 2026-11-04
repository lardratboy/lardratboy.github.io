/* sol-v4's contact-sheet rows as a corpus, for dag-core (docs/hashcons-plan.md,
   step 2b in docs/hashcons-log.md).

   The pure parts (rowsOf, automatonOf, the defaults) moved to
   ../testbed-rows.js in step 4, so stream-viewer.html can build rows too;
   they are re-exported here so the experiments and tests read as before.
   What stays is Node-only or oracle-only: loading the core from disk, the
   dense classifyCPU grid, and the core's own voxel counters. */
import { loadCore } from '../test/load-core.js';
export { TESTBED, AXIS_NAMES, rowsOf, automatonOf } from '../testbed-rows.js';

export function loadTestbed(){ return loadCore(); }

/* Dense occupancy from classifyCPU, in block-showroom's layout (x fastest). */
export function denseOf(core, cfg, L){
  const S = 4 ** L, occ = new Uint8Array(S ** 3), c = [0, 0, 0];
  for (let z = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++){
    c[0] = x; c[1] = y; c[2] = z;
    occ[x + S * (y + S * z)] = core.classifyCPU(c, S, cfg) === 0 ? 1 : 0;
  }
  return occ;
}

/* The core's own voxel counters, none of which go through classifyCPU or a
   DAG: product of popcounts, the transfer-matrix count, and the polyhedron
   z-interval count (O(S²), so only up to L = 5). null where none applies. */
export function independentCount(core, row, cfg, L){
  if (cfg.graph) return core.countGraphVoxels(cfg.graph, L);
  if (cfg.planes) return L <= 5 ? core.countPolyhedronVoxels(cfg.planes, L) : null;
  return core.voxelCount(cfg.rules, L);
}
