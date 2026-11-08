/* Meshes as volumes: the pieces experiments/mesh-sketch.mjs (made-up meshes) and
   experiments/mesh-vdag.mjs (a real asset, to a world file) share. Not the
   engine: no tests of its own; the sketch and the asset script each hold the
   build to denseOracle at D = 8.

   A prepared mesh M (each script has its own prepare) is triangles in world
   voxel units, as flat arrays: V0, E1, E2 (a corner and two edges, 3 a
   triangle), n, and per triangle:
     closed   0 an open sheet (surface only), ±1 a closed shell's orientation
     cap      optional: 1 for a triangle that closes a hole (mesh-vdag.mjs). It
              counts toward inside like any closed triangle, but it is not the
              asset's surface, so conservative mode never draws it.
     keep     optional: keep(i, p), whether triangle i makes the surface voxel
              centred at p (mesh-vdag.mjs: an alpha-cutout card's texel alpha
              there against its cutoff). Absent, every touching triangle does. */
import { createStore } from "../dag-core.js";

/* Akenine-Möller's triangle-box overlap: the 13 separating axes. The box is
   grown by `eps` so the test errs toward "touches", which only costs a split. */
const tv = [new Float64Array(3), new Float64Array(3), new Float64Array(3)], te = [new Float64Array(3), new Float64Array(3), new Float64Array(3)];
export function triBox(M, i, c, h){
  for (let k = 0; k < 3; k++){
    const a = M.V0[3 * i + k] - c[k];
    tv[0][k] = a; tv[1][k] = a + M.E1[3 * i + k]; tv[2][k] = a + M.E2[3 * i + k];
  }
  for (let k = 0; k < 3; k++){
    const mn = Math.min(tv[0][k], tv[1][k], tv[2][k]), mx = Math.max(tv[0][k], tv[1][k], tv[2][k]);
    if (mn > h || mx < -h) return false;
  }
  for (let k = 0; k < 3; k++){ te[0][k] = tv[1][k] - tv[0][k]; te[1][k] = tv[2][k] - tv[1][k]; te[2][k] = tv[0][k] - tv[2][k]; }
  const nx = te[0][1] * te[1][2] - te[0][2] * te[1][1], ny = te[0][2] * te[1][0] - te[0][0] * te[1][2], nz = te[0][0] * te[1][1] - te[0][1] * te[1][0];
  const d = nx * tv[0][0] + ny * tv[0][1] + nz * tv[0][2], r = h * (Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
  if (d > r || d < -r) return false;
  for (let e = 0; e < 3; e++) for (let a = 0; a < 3; a++){
    // axis = unit(a) × edge e
    const ax = [0, 0, 0]; const E = te[e];
    if (a === 0){ ax[1] = -E[2]; ax[2] = E[1]; } else if (a === 1){ ax[0] = E[2]; ax[2] = -E[0]; } else { ax[0] = -E[1]; ax[1] = E[0]; }
    const p0 = ax[0] * tv[0][0] + ax[1] * tv[0][1] + ax[2] * tv[0][2], p1 = ax[0] * tv[1][0] + ax[1] * tv[1][1] + ax[2] * tv[1][2], p2 = ax[0] * tv[2][0] + ax[1] * tv[2][1] + ax[2] * tv[2][2];
    const rr = h * (Math.abs(ax[0]) + Math.abs(ax[1]) + Math.abs(ax[2]));
    if (Math.min(p0, p1, p2) > rr || Math.max(p0, p1, p2) < -rr) return false;
  }
  return true;
}
/* Signed crossings of the segment p → q with closed triangles in the list:
   Möller–Trumbore, t in (0, 1], sign by the triangle's facing. */
export function crossings(M, list, len, p, q){
  let w = 0;
  const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
  for (let j = 0; j < len; j++){
    const i = list[j];
    if (!M.closed[i]) continue;
    const o = 3 * i, e1x = M.E1[o], e1y = M.E1[o + 1], e1z = M.E1[o + 2], e2x = M.E2[o], e2y = M.E2[o + 1], e2z = M.E2[o + 2];
    const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
    if (det === 0) continue;
    const sx = p[0] - M.V0[o], sy = p[1] - M.V0[o + 1], sz = p[2] - M.V0[o + 2], inv = 1 / det;
    const u = (sx * px + sy * py + sz * pz) * inv; if (u < 0 || u > 1) continue;
    const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
    const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
    const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t <= 0 || t > 1) continue;
    // det = −d·n, so det > 0 is entering a face against its normal: +1 for an
    // outward shell, flipped for one modelled inside out.
    w += (det > 0 ? 1 : -1) * M.closed[i];
  }
  return w;
}

/* ---- a. the build ----------------------------------------------------------------- */
export function voxelize(M, D, mode, store = createStore()){
  const all = Int32Array.from({ length: M.n }, (_, i) => i);
  const L = Array.from({ length: D + 2 }, () => ({ list: null, len: 0, c: [0, 0, 0], w: 0 }));
  // The root's parent: a point outside the world, winding number 0, every triangle.
  L[D + 1].list = all; L[D + 1].len = M.n; L[D + 1].c = [-1.37, -2.11, -0.73]; L[D + 1].w = 0;
  const pool = Array.from({ length: D + 1 }, () => new Int32Array(M.n));
  let triTests = 0, cells = 0;
  const cell = (k, x, y, z) => {
    cells++;
    const P = L[k + 1], me = L[k], s = 2 ** k, h = s / 2;
    const c = me.c; c[0] = x * s + h; c[1] = y * s + h; c[2] = z * s + h;
    me.w = P.w + crossings(M, P.list, P.len, P.c, c);
    const out = pool[k]; let len = 0;
    const g = h * (1 + 1e-9) + 1e-9;
    for (let j = 0; j < P.len; j++){ triTests++; if (triBox(M, P.list[j], c, g)) out[len++] = P.list[j]; }
    me.list = out; me.len = len;
    const inside = me.w > 0;
    if (len === 0) return inside ? 1 : 0;
    if (k === 0){
      if (inside) return 1;
      // Open sheets are always conservative; closed shells only in that mode,
      // and a hole's cap never (it isn't the asset's surface).
      for (let j = 0; j < len; j++){ const i = out[j]; if ((!M.closed[i] || (mode === 'conservative' && !M.cap?.[i])) && (!M.keep || M.keep(i, c))) return 1; }
      return 0;
    }
    return 2;
  };
  const t0 = performance.now(), { root } = store.fromField(D, cell);
  return { store, root, ms: performance.now() - t0, triTests, cells };
}

/* ---- b. the dense oracle ----------------------------------------------------------- */
export function denseOracle(M, D, mode){
  const R = 2 ** D, occ = new Uint8Array(R ** 3);
  // Solid: signed crossings along +x from −∞, row by row, through voxel centres.
  const rows = Array.from({ length: R * R }, () => []);
  for (let i = 0; i < M.n; i++){
    if (!M.closed[i]) continue;
    const o = 3 * i, ys = [M.V0[o + 1], M.V0[o + 1] + M.E1[o + 1], M.V0[o + 1] + M.E2[o + 1]], zs = [M.V0[o + 2], M.V0[o + 2] + M.E1[o + 2], M.V0[o + 2] + M.E2[o + 2]];
    for (let z = Math.max(0, Math.floor(Math.min(...zs) - 0.5)); z <= Math.min(R - 1, Math.ceil(Math.max(...zs))); z++)
      for (let y = Math.max(0, Math.floor(Math.min(...ys) - 0.5)); y <= Math.min(R - 1, Math.ceil(Math.max(...ys))); y++) rows[y + R * z].push(i);
  }
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++){
    const hits = [];
    const p = [-1, y + 0.5, z + 0.5];
    for (const i of rows[y + R * z]){
      const o = 3 * i, w = crossings(M, [i], 1, p, [R + 1, y + 0.5, z + 0.5]);
      if (!w) continue;
      // where along x: solve with the plane.
      const e1 = [M.E1[o], M.E1[o + 1], M.E1[o + 2]], e2 = [M.E2[o], M.E2[o + 1], M.E2[o + 2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const xh = M.V0[o] - ((y + 0.5 - M.V0[o + 1]) * n[1] + (z + 0.5 - M.V0[o + 2]) * n[2]) / n[0];
      hits.push([xh, w]);
    }
    hits.sort((a, b) => a[0] - b[0]);
    let w = 0, j = 0;
    for (let x = 0; x < R; x++){
      while (j < hits.length && hits[j][0] < x + 0.5){ w += hits[j][1]; j++; }
      if (w > 0) occ[x + R * (y + R * z)] = 1;
    }
  }
  // Surface: each triangle's own box of voxels, open ones always, closed ones in conservative mode.
  const c = [0, 0, 0];
  for (let i = 0; i < M.n; i++){
    if (M.closed[i] && (mode !== 'conservative' || M.cap?.[i])) continue;
    const o = 3 * i, xs = [M.V0[o], M.V0[o] + M.E1[o], M.V0[o] + M.E2[o]], ys = [M.V0[o + 1], M.V0[o + 1] + M.E1[o + 1], M.V0[o + 1] + M.E2[o + 1]], zs = [M.V0[o + 2], M.V0[o + 2] + M.E1[o + 2], M.V0[o + 2] + M.E2[o + 2]];
    const b = v => [Math.max(0, Math.floor(Math.min(...v)) - 1), Math.min(R - 1, Math.floor(Math.max(...v)) + 1)];
    const [x0, x1] = b(xs), [y0, y1] = b(ys), [z0, z1] = b(zs);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){
      c[0] = x + 0.5; c[1] = y + 0.5; c[2] = z + 0.5;
      if (triBox(M, i, c, 0.5 * (1 + 1e-9) + 1e-9) && (!M.keep || M.keep(i, c))) occ[x + R * (y + R * z)] = 1;
    }
  }
  return occ;
}


export function closestOnTri(M, i, p, out){
  // Ericson, Real-Time Collision Detection §5.1.5, returning barycentrics.
  const o = 3 * i, a = [M.V0[o], M.V0[o + 1], M.V0[o + 2]], ab = [M.E1[o], M.E1[o + 1], M.E1[o + 2]], ac = [M.E2[o], M.E2[o + 1], M.E2[o + 2]];
  const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  let v = 0, w = 0;
  if (d1 <= 0 && d2 <= 0){ v = 0; w = 0; }
  else {
    const bp = [ap[0] - ab[0], ap[1] - ab[1], ap[2] - ab[2]], d3 = dot(ab, bp), d4 = dot(ac, bp);
    const cp = [ap[0] - ac[0], ap[1] - ac[1], ap[2] - ac[2]], d5 = dot(ab, cp), d6 = dot(ac, cp);
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3){ v = 1; w = 0; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0){ v = d1 / (d1 - d3); w = 0; }
    else if (d6 >= 0 && d5 <= d6){ v = 0; w = 1; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0){ v = 0; w = d2 / (d2 - d6); }
    else if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0){ w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); v = 1 - w; }
    else { const den = 1 / (va + vb + vc); v = vb * den; w = vc * den; }
  }
  const q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
  out[0] = 1 - v - w; out[1] = v; out[2] = w;
  return (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
}
