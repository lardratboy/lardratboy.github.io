/* The math world's catalogue, measured and drawn (docs/math-world.md §2).

   Every shape of math-shapes.js voxelized by math-core's voxelize at R = 32,
   64 and 128: voxels, the share of the box, what it took. Then a contact
   sheet, each shape at R = 96 drawn by a CPU ray cast of its voxels (a DDA,
   the face it entered shaded), coloured as the world colours it (the gamut
   in the object's frame, `repeat` 2), to docs/images/math-shapes.png.

   node experiments/math-sketch.mjs [--print] [--R=96] [--only=name,name] [--tile=200] [--out=file.png]
   --print: the table only, no picture. A sketch: prints, no tests. */
import { writeFileSync } from 'node:fs';
import { MATH_SHAPES, MATH_FAMILIES, voxelize, yawOf, GAMUT_LIFT, GAMUT_SPAN } from '../math-core.js';
import { png } from './dataprism.mjs';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const print = process.argv.includes('--print'), only = arg('only')?.split(','), RP = +(arg('R') || 96), TILE = +(arg('tile') || 200);
const shapes = MATH_SHAPES.filter(s => !only || only.includes(s.name));

console.log('shape                    family                 kind     R=32 voxels  ms   R=64 voxels  ms   R=128 voxels   ms  fill');
for (const s of shapes){
  const row = [];
  let fill = 0;
  for (const R of [32, 64, 128]){
    const t0 = performance.now(), v = voxelize(s, R, 300);
    row.push(`${v.voxels.toLocaleString().padStart(11)} ${String(Math.round(performance.now() - t0)).padStart(4)}`);
    fill = v.voxels / R ** 3;
  }
  console.log(`${s.name.padEnd(24)} ${MATH_FAMILIES[s.family].padEnd(22)} ${s.kind.padEnd(8)} ${row.join('  ')}  ${(100 * fill).toFixed(1)}%`);
}
if (print) process.exit(0);

/* The picture: a camera on a circle round the box, looking down a little. */
const COLS = Math.min(6, shapes.length), rows = Math.ceil(shapes.length / COLS), W = COLS * TILE, H = rows * TILE, img = new Uint8Array(3 * W * H).fill(24);
shapes.forEach((s, n) => {
  const yaw = s.axial ? 0 : 300, R = RP, { occ } = voxelize(s, R, yaw), [c, sn] = yawOf(yaw);
  const at = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < R && y < R && z < R && occ[x + R * (y + R * z)];
  const az = 0.65, el = 0.42, f = [-Math.cos(el) * Math.sin(az), -Math.sin(el), -Math.cos(el) * Math.cos(az)];
  const rt = [Math.cos(az), 0, -Math.sin(az)], upv = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];   // rt × f: up (f × rt put y down, and every picture upside down until 2026-11-20)
  const ctr = R / 2, dist = 2 * R, eye = [ctr - f[0] * dist, ctr - f[1] * dist, ctr - f[2] * dist], half = 0.95 * R;
  const ox = (n % COLS) * TILE, oy = Math.floor(n / COLS) * TILE, light = [0.5, 0.8, 0.3];
  for (let py = 0; py < TILE; py++) for (let px = 0; px < TILE; px++){
    const u = (2 * (px + 0.5) / TILE - 1) * half, v = (1 - 2 * (py + 0.5) / TILE) * half;
    const o = [0, 1, 2].map(a => eye[a] + u * rt[a] + v * upv[a]);
    // Enter the box, then a DDA.
    let t0 = 0, t1 = Infinity;
    for (let a = 0; a < 3; a++){ const ta = (0 - o[a]) / f[a], tb = (R - o[a]) / f[a]; t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb)); }
    if (t0 >= t1) continue;
    const p = o.map((x, a) => x + f[a] * (t0 + 1e-6)), cell = p.map(x => Math.min(R - 1, Math.max(0, Math.floor(x))));
    const step = f.map(d => d > 0 ? 1 : -1), tMax = [0, 1, 2].map(a => ((cell[a] + (step[a] > 0 ? 1 : 0)) - p[a]) / f[a] + t0), tD = f.map(d => Math.abs(1 / d));
    let face = -1;
    for (let k = 0; k < 4 * R; k++){
      if (at(...cell)){
        const nrm = [0, 0, 0]; nrm[face < 0 ? 1 : face] = face < 0 ? 1 : -step[face];
        const lam = 0.35 + 0.65 * Math.max(0, nrm[0] * light[0] + nrm[1] * light[1] + nrm[2] * light[2]);
        const b = cell.map(x => 2 * (x + 0.5) / R - 1), q = [(c * b[0] - sn * b[2] + 1) / 2, (b[1] + 1) / 2, (sn * b[0] + c * b[2] + 1) / 2];
        const g = t => { const w = 2 * Math.min(Math.max(t, 0), 0.9999999); return GAMUT_LIFT + GAMUT_SPAN * (w - Math.floor(w)); };
        img.set(q.map(t => Math.round(lam * g(t))), 3 * ((oy + py) * W + ox + px));
        break;
      }
      const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : (tMax[1] < tMax[2] ? 1 : 2);
      if (tMax[a] > t1) break;
      cell[a] += step[a]; tMax[a] += tD[a]; face = a;
    }
  }
});
const out = arg('out') || 'docs/images/math-shapes.png';
writeFileSync(out, png(W, H, img));
console.log(`\n${out}: ${shapes.length} shapes at R = ${RP}, ${COLS} a row in catalogue order`);
