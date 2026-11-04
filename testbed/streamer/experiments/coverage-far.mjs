/* Far lods: do walls turn into sheets? (docs/coverage-findings.md §3)

     node experiments/coverage-far.mjs        # ~20 s, prints only

   coverage.mjs stops at lod 3. A clipmap's outer rings go further, and
   thinness is relative to the cell: a wall 13 voxels thick is thick at
   lod 3 (8-voxel cells) and thinner than a cell at lod 5 (32). This runs
   the sphere, the shell and the gyroid at R = 256 to lod 5 under every
   rule and prints slab coverage, measured as in coverage.mjs. At lod 5
   the whole world is a single 8³ brick, so it's thin evidence, but
   enough to see whether adaptive falls off as walls go sub-cell. */
import { createStore, createCounts } from '../dag-core.js';
import { expandWorld } from '../chunk-core.js';
import { SHAPES, denseShape } from './shapes.mjs';
const R = 256;
// Slab coverage as in coverage.mjs: brick-deep segments (8 coarse cells), compared at fine (u,v).
function cov(occ, kept, N, l){
  const S = 8 << l, n = R / S, f = [0,1,2].map(() => new Uint8Array(R*R*n)), c = [0,1,2].map(() => new Uint8Array(N*N*n));
  const sh = Math.log2(S);
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) if (occ[x + R*(y + R*z)]){
    f[0][(y + R*z)*n + (x>>sh)] = 1; f[1][(x + R*z)*n + (y>>sh)] = 1; f[2][(x + R*y)*n + (z>>sh)] = 1; }
  for (let Z = 0; Z < N; Z++) for (let Y = 0; Y < N; Y++) for (let X = 0; X < N; X++) if (kept[X + N*(Y + N*Z)]){
    c[0][(Y + N*Z)*n + (X>>3)] = 1; c[1][(X + N*Z)*n + (Y>>3)] = 1; c[2][(X + N*Y)*n + (Z>>3)] = 1; }
  let F = 0, C = 0;
  for (let a = 0; a < 3; a++) for (let v = 0; v < R; v++) for (let u = 0; u < R; u++) for (let s = 0; s < n; s++){
    F += f[a][(u + R*v)*n + s]; C += c[a][((u>>l) + N*(v>>l))*n + s]; }
  return C / F;
}
for (const name of ['sphere', 'shell', 'gyroid']){
  const occ = denseShape(SHAPES.find(s => s.name === name), R).occ;
  const st = createStore(), { root, D } = st.fromDense(occ, R), counts = createCounts(st);
  const out = [];
  for (const l of [3, 4, 5]){
    const N = R >> l, row = [];
    for (const rule of ['any', 'majority', 'volume', 'opacity', 'adaptive']){
      const ch = expandWorld(st, root, D, l, { lodRule: rule, counts, cells: true });
      const kept = new Uint8Array(N**3);
      for (const c of ch){ const o = c.origin.map(v => v / c.cellSize); for (const p of c.cells) kept[(o[0] + (p & 255)) + N*((o[1] + (p >> 8 & 255)) + N*(o[2] + (p >> 16)))] = 1; }
      row.push(rule + ' ' + cov(occ, kept, N, l).toFixed(2));
    }
    out.push(`lod ${l} (cell ${2**l}): ` + row.join('  '));
  }
  console.log(name + '\n  ' + out.join('\n  '));
}
