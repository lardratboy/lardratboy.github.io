/* Screen-space ambient occlusion on our worlds, measured on the CPU
   (docs/vdagssao.md §3–5). A sketch: prints numbers, writes pictures, no tests.

   What it asks: how close does SSAO, which sees only the depth buffer, come to
   the ambient occlusion the world really has? Here the world is a DAG we can
   ask directly, so the right answer is computable, which most SSAO write-ups
   never have. Per view:

   - The G-buffer: one ray a pixel through the DAG at lod 0 (kit-sketch's
     trace), giving the forward distance (the viewer's linear depth) and the
     face's axis normal, as the raster pass would.
   - The reference: 128 cosine-weighted rays a pixel from the hit point, each
     marched voxel by voxel through the DAG up to R voxels. AO is the share
     that escape. Binary visibility within R: the quantity SSAO approximates.
   - SSAO, the classic hemisphere kernel (Crytek's idea as LearnOpenGL
     writes it: samples in a normal-oriented hemisphere, a range check), at
     8, 16 and 32 samples.
   - GTAO (Jimenez et al. 2016, as Intel's XeGTAO writes it): horizons
     searched along screen slices, integrated against the cosine. 2 slices ×
     4 steps a side (16 depth reads), and 4 × 4 (32); with a step's sample
     at the nearest whole pixel (the page's), on the slice's line (XeGTAO's),
     or projected into the slice: the three agree to ±0.01.
   - Voxel corner AO, the object-space trick block games use: each face
     corner darkened by its three neighbours in the layer in front of it,
     interpolated across the face. Not screen space; here for comparison,
     because the DAG answers it exactly.
   Both screen-space kinds get a 4×4 rotation noise and a 4×4 blur that only
   mixes pixels of the same face: the same normal, on the same plane (a voxel
   world's bilateral filter, exact at any angle). GTAO is clamped after the
   blur, not before: it's 1 unoccluded only on average over its slices.

   The views: the D = 10 kit close, from a street and from the viewer's
   opening view; the caves' start chamber; hills; flat ground (nothing to
   occlude, so anything under 1 is artifact); the knight, if
   worlds/scene/knight-d8.vdag is there.

   Then the depth buffer the viewer really has: DEPTH_COMPONENT24, near plane
   at half the clearance (0.05 to 64 voxels), far at 4 sides. The depth is
   quantized as the GPU would, the normals are rebuilt from it (the
   prototype has no normal buffer) and snapped to the nearest axis, and GTAO
   runs again on that.

   node experiments/ssao-sketch.mjs                 numbers + docs/images/ssao-*.png
   node experiments/ssao-sketch.mjs --print         numbers only
   node experiments/ssao-sketch.mjs --only=kit,caves
   node experiments/ssao-sketch.mjs --size=400x250  (the default) */
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { EMPTY, FULL, createStore, storeView } from '../dag-core.js';
import { kitDesc, buildKit } from '../kit-core.js';
import { caveDesc, buildCaves } from '../cave-core.js';
import { clayDesc, buildClay } from '../clay-core.js';
import { readVdag } from '../vdag-core.js';
import { SHAPES, fieldOf, crustOf } from './shapes.mjs';
import { png } from './dataprism.mjs';

const arg = (name, d) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const PRINT = process.argv.includes('--print'), ONLY = arg('only', null)?.split(',');
const [W, H] = arg('size', '400x250').split('x').map(Number);
const TAN = Math.tan(0.45);        // the viewer's half field of view (viewProj)
const REF_RAYS = 128;

/* ---- small vector and random helpers ------------------------------------- */
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const hashU = (...k) => { let h = 0x811c9dc5; for (const v of k){ h = Math.imul(h ^ (v >>> 0), 0x01000193); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; } return (h >>> 0) / 4294967296; };
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ---- the world, asked directly ------------------------------------------- */
/* Is voxel (x, y, z) solid? A level-4 node per 16³ region, found once by
   descent, then a 16³ bitmap per distinct node id: hash-consing makes the
   bitmaps few. Outside the world is air, as the viewer draws it. */
function solidOf(store, root, D){
  const side = 2 ** D, regions = new Map(), maps = new Map();
  const bitmap = id => {
    let m = maps.get(id);
    if (m) return m;
    m = new Uint8Array(4096);
    const fill = (n, l, x, y, z) => {
      if (n === EMPTY) return;
      const s = 1 << l;
      if (n === FULL){ for (let k = z; k < z + s; k++) for (let j = y; j < y + s; j++) for (let i = x; i < x + s; i++) m[i + 16 * j + 256 * k] = 1; return; }
      const h = s >> 1;
      for (let o = 0; o < 8; o++) fill(store.child(n, o), l - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
    };
    fill(id, 4, 0, 0, 0);
    maps.set(id, m);
    return m;
  };
  return (x, y, z) => {
    if (x < 0 || y < 0 || z < 0 || x >= side || y >= side || z >= side) return 0;
    const rx = x >> 4, ry = y >> 4, rz = z >> 4, key = rx + side / 16 * (ry + side / 16 * rz);
    let id = regions.get(key);
    if (id === undefined){
      id = root;
      for (let l = D; l > 4 && id !== EMPTY && id !== FULL; l--){
        const b = l - 1;
        id = store.child(id, (x >> b & 1) | (y >> b & 1) << 1 | (z >> b & 1) << 2);
      }
      regions.set(key, id);
    }
    if (id === EMPTY) return 0;
    if (id === FULL) return 1;
    return bitmap(id)[(x & 15) + 16 * (y & 15) + 256 * (z & 15)];
  };
}

/* The first voxel a ray o + t·d meets, kit-sketch's walk (front to back by
   octant order). With d = the viewer's unnormalized pixel ray (forward
   component 1), t is the forward distance: the linear depth. */
function trace(store, root, D, o, d){
  const inv = d.map(x => 1 / (Math.abs(x) < 1e-12 ? 1e-12 : x)), a = (d[0] < 0 ? 1 : 0) | (d[1] < 0 ? 2 : 0) | (d[2] < 0 ? 4 : 0);
  let hit = null;
  const box = (x0, y0, z0, s) => {
    let tn = -Infinity, tf = Infinity, ax = 0;
    const b = [x0, y0, z0];
    for (let i = 0; i < 3; i++){
      let t1 = (b[i] - o[i]) * inv[i], t2 = (b[i] + s - o[i]) * inv[i];
      if (t1 > t2){ const q = t1; t1 = t2; t2 = q; }
      if (t1 > tn){ tn = t1; ax = i; }
      if (t2 < tf) tf = t2;
    }
    return tf >= Math.max(tn, 0) ? [Math.max(tn, 0), ax] : null;
  };
  const walk = (id, lev, x0, y0, z0, at) => {
    if (id === FULL){ hit = { t: at[0], ax: at[1] }; return true; }
    const hs = 2 ** (lev - 1);
    for (let k = 0; k < 8; k++){
      const oc = k ^ a, c = store.child(id, oc);
      if (c === EMPTY) continue;
      const cx = x0 + (oc & 1) * hs, cy = y0 + (oc >> 1 & 1) * hs, cz = z0 + (oc >> 2) * hs, b = box(cx, cy, cz, hs);
      if (b && walk(c, lev - 1, cx, cy, cz, b)) return true;
    }
    return false;
  };
  const b = box(0, 0, 0, 2 ** D);
  if (b && root !== EMPTY) walk(root, D, 0, 0, 0, b);
  return hit;
}

/* Does a ray from o along unit u meet a solid voxel within len? A voxel DDA
   (Amanatides–Woo); the starting cell is air (o is just off a face). */
function blocked(solid, o, u, len){
  const c = o.map(Math.floor), step = u.map(v => v > 0 ? 1 : -1);
  const tD = u.map(v => Math.abs(1 / (v || 1e-12)));
  const tM = u.map((v, a) => v > 0 ? (c[a] + 1 - o[a]) / v : v < 0 ? (o[a] - c[a]) / -v : Infinity);
  for (;;){
    const a = tM[0] < tM[1] ? (tM[0] < tM[2] ? 0 : 2) : (tM[1] < tM[2] ? 1 : 2);
    if (tM[a] > len) return false;
    c[a] += step[a]; tM[a] += tD[a];
    if (solid(c[0], c[1], c[2])) return true;
  }
}

/* ---- the camera: the viewer's basis -------------------------------------- */
function cameraOf(view){
  const { eye, yaw, pitch } = view, fw = [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
  const z = fw.map(v => -v), x = norm(cross([0, 1, 0], z)), y = cross(z, x), aspect = W / H;
  const ray = (px, py) => { const nx = (2 * (px + 0.5) / W - 1) * TAN * aspect, ny = (1 - 2 * (py + 0.5) / H) * TAN; return [0, 1, 2].map(a => fw[a] + nx * x[a] + ny * y[a]); };
  // An eye-relative point to its pixel (fractional) and forward distance.
  const project = p => { const zf = dot(p, fw); return [((dot(p, x) / (zf * TAN * aspect)) + 1) / 2 * W - 0.5, (1 - dot(p, y) / (zf * TAN)) / 2 * H - 0.5, zf]; };
  return { eye, fw, x, y, ray, project, pxPerVoxelAt: zf => H / 2 / (zf * TAN) };
}

/* ---- the G-buffer --------------------------------------------------------- */
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
function gbuffer(world, cam){
  const Z = new Float64Array(W * H).fill(Infinity), N = new Int8Array(W * H).fill(-1);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++){
    const d = cam.ray(px, py), h = trace(world.store, world.root, world.D, cam.eye, d);
    if (!h) continue;
    const i = px + W * py;
    Z[i] = h.t; N[i] = 2 * h.ax + (d[h.ax] > 0 ? 1 : 0);
  }
  return { Z, N };
}
const relAt = (cam, Z, px, py) => { const d = cam.ray(px, py), z = Z[px + W * py]; return [d[0] * z, d[1] * z, d[2] * z]; };

/* ---- the reference: rays in the DAG -------------------------------------- */
// Cosine-weighted hemisphere directions about +z: Hammersley points on the
// disk, lifted (Malley's method). Each pixel turns the set by its own angle.
const HEMI = Array.from({ length: REF_RAYS }, (_, i) => {
  let b = i, r = 0, f = 0.5;
  while (b){ if (b & 1) r += f; b >>= 1; f /= 2; }
  const u = (i + 0.5) / REF_RAYS, rad = Math.sqrt(u), phi = 2 * Math.PI * r;
  return [rad * Math.cos(phi), rad * Math.sin(phi), Math.sqrt(Math.max(0, 1 - u))];
});
function frameOf(n, angle){
  const t0 = Math.abs(n[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0], b0 = norm(cross(n, t0)), t1 = cross(b0, n);
  const c = Math.cos(angle), s = Math.sin(angle);
  return [t1.map((v, a) => c * v + s * b0[a]), b0.map((v, a) => c * v - s * t1[a])];
}
function referenceAO(world, cam, G, R, solid){
  const ao = new Float32Array(W * H).fill(1);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++){
    const i = px + W * py;
    if (G.N[i] < 0) continue;
    const n = NORMALS[G.N[i]], rel = relAt(cam, G.Z, px, py), o = rel.map((v, a) => cam.eye[a] + v + n[a] * 1e-4);
    const [t, b] = frameOf(n, 2 * Math.PI * hashU(px, py, 7));
    let open = 0;
    for (const h of HEMI){
      const u = [0, 1, 2].map(a => h[0] * t[a] + h[1] * b[a] + h[2] * n[a]);
      if (!blocked(solid, o, u, R)) open++;
    }
    ao[i] = open / REF_RAYS;
  }
  return ao;
}

/* ---- voxel corner AO ------------------------------------------------------ */
// A corner's three neighbours in the layer in front of the face: two sides
// and the diagonal. Both sides solid is the darkest whatever the diagonal.
const CORNER_SHADE = [0.4, 0.6, 0.8, 1];
function cornerAO(world, cam, G, solid){
  const ao = new Float32Array(W * H).fill(1);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++){
    const i = px + W * py, k = G.N[i];
    if (k < 0) continue;
    const ax = k >> 1, n = NORMALS[k], rel = relAt(cam, G.Z, px, py), p = rel.map((v, a) => cam.eye[a] + v);
    const cell = p.map((v, a) => Math.floor(v - n[a] * 1e-6)), front = cell.map((v, a) => v + n[a]);
    const u = (ax + 1) % 3, v = (ax + 2) % 3, fu = p[u] - cell[u], fv = p[v] - cell[v];
    const at = (du, dv) => { const q = front.slice(); q[u] += du; q[v] += dv; return solid(q[0], q[1], q[2]); };
    const c = (su, sv) => { const s1 = at(su, 0), s2 = at(0, sv), cr = at(su, sv); return CORNER_SHADE[s1 && s2 ? 0 : 3 - s1 - s2 - cr]; };
    const c00 = c(-1, -1), c10 = c(1, -1), c01 = c(-1, 1), c11 = c(1, 1);
    ao[i] = (c00 * (1 - fu) + c10 * fu) * (1 - fv) + (c01 * (1 - fu) + c11 * fu) * fv;
  }
  return ao;
}

/* ---- screen space ----------------------------------------------------------
   Both kinds read only Z (and a normal: the true one, or one rebuilt from Z)
   and sample the depth at whole pixels, as texelFetch would. */
const NOISE = Array.from({ length: 16 }, (_, i) => [hashU(i, 1), hashU(i, 2)]);
// The hemisphere kernel: LearnOpenGL's, fixed per run.
const kernelOf = n => Array.from({ length: n }, (_, i) => {
  const v = norm([hashU(i, 11) * 2 - 1, hashU(i, 12) * 2 - 1, hashU(i, 13)]), s = 0.1 + 0.9 * (i / n) ** 2, r = hashU(i, 14);
  return v.map(c => c * r * s);
});

function hemiSSAO(cam, Z, normalAt, { samples, R, bias }){
  const K = kernelOf(samples), ao = new Float32Array(W * H).fill(1);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++){
    const i = px + W * py, n = normalAt(px, py);
    if (!n) continue;
    if (R * cam.pxPerVoxelAt(Z[i]) < 1) continue;     // smaller than a pixel: no AO
    const p = relAt(cam, Z, px, py), [t, b] = frameOf(n, 2 * Math.PI * NOISE[(px & 3) + 4 * (py & 3)][0]);
    let occ = 0;
    for (const k of K){
      const s = [0, 1, 2].map(a => p[a] + R * (k[0] * t[a] + k[1] * b[a] + k[2] * n[a]));
      const [sx, sy, sz] = cam.project(s), qx = Math.round(sx), qy = Math.round(sy);
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
      const scene = Z[qx + W * qy];
      if (scene <= sz - bias) occ += smooth(0, 1, R / Math.abs(Z[i] - scene));
    }
    ao[i] = 1 - occ / samples;
  }
  return ao;
}

/* `sampling`: where a step's sample is. 'round' (the page's first try): the
   whole pixel nearest the slice's line, its own centre. 'exact' (XeGTAO's):
   the point on the line, at the nearest pixel's depth. 'project': the whole
   pixel, its offset projected into the slice's plane. */
function gtao(cam, Z, normalAt, { slices, steps, R, falloff = 0.25, sampling = 'round' }){
  // Full weight within R − fRange, none past R (XeGTAO's falloff, narrowed
  // toward the reference's hard edge at R).
  const ao = new Float32Array(W * H).fill(1), fRange = falloff * R;
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++){
    const i = px + W * py, n = normalAt(px, py);
    if (!n) continue;
    const rPix = R * cam.pxPerVoxelAt(Z[i]);
    if (rPix < 1) continue;
    const p = relAt(cam, Z, px, py), V = norm(p.map(v => -v)), [nz0, nz1] = NOISE[(px & 3) + 4 * (py & 3)];
    let vis = 0;
    for (let s = 0; s < slices; s++){
      const phi = Math.PI * (s + nz0) / slices, sc = [Math.cos(phi), Math.sin(phi)];
      const dir = [0, 1, 2].map(a => sc[0] * cam.x[a] + sc[1] * cam.y[a]);
      const ortho = norm(dir.map((v, a) => v - dot(dir, V) * V[a])), axis = norm(cross(ortho, V));
      const pn = n.map((v, a) => v - axis[a] * dot(n, axis)), pl = Math.hypot(...pn);
      if (pl < 1e-6){ vis += 1; continue; }
      const cosN = Math.max(-1, Math.min(1, dot(pn, V) / pl)), nAng = Math.sign(dot(ortho, pn)) * Math.acos(cosN);
      let h0c = Math.cos(nAng + Math.PI / 2), h1c = Math.cos(nAng - Math.PI / 2);
      const low0 = h0c, low1 = h1c;
      for (let k = 0; k < steps; k++){
        const u = (k + nz1) / steps, dist = Math.max(1, u * u * rPix);
        for (const side of [1, -1]){
          const qx = Math.round(px + side * sc[0] * dist), qy = Math.round(py - side * sc[1] * dist);
          if (qx < 0 || qy < 0 || qx >= W || qy >= H || !Number.isFinite(Z[qx + W * qy])) continue;
          let q;
          if (sampling === 'exact'){ const r = cam.ray(px + side * sc[0] * dist, py - side * sc[1] * dist), z = Z[qx + W * qy]; q = r.map(v => v * z); }
          else q = relAt(cam, Z, qx, qy);
          let d = q.map((v, a) => v - p[a]);
          if (sampling === 'project'){ const k2 = dot(d, axis); d = d.map((v, a) => v - k2 * axis[a]); }
          const len = Math.hypot(...d);
          if (len < 1e-6) continue;
          const w = Math.max(0, Math.min(1, (R - len) / fRange));
          const c = dot(d, V) / len;
          if (side === 1) h0c = Math.max(h0c, low0 + (c - low0) * w);
          else h1c = Math.max(h1c, low1 + (c - low1) * w);
        }
      }
      // h0 on the +dir side, h1 on the −dir side, each clamped to the
      // hemisphere about the projected normal, integrated against cos.
      let h1 = -Math.acos(Math.max(-1, Math.min(1, h1c))), h0 = Math.acos(Math.max(-1, Math.min(1, h0c)));
      h0 = nAng + Math.max(-Math.PI / 2, Math.min(Math.PI / 2, h0 - nAng));
      h1 = nAng + Math.max(-Math.PI / 2, Math.min(Math.PI / 2, h1 - nAng));
      const arc = h => (cosN + 2 * h * Math.sin(nAng) - Math.cos(2 * h - nAng)) / 4;
      vis += pl * (arc(h0) + arc(h1));
    }
    // Unclamped: unoccluded GTAO is 1 only on average over slice directions,
    // so a pixel is clamped after the blur (blur, below), not here.
    ao[i] = Math.max(0, vis / slices);
  }
  return ao;
}

// 4×4 (−2…+1, the noise tile), only pixels of the same face: the same
// normal, and on the same plane (within 0.05 voxel + 0.2% of the depth, for
// 24-bit depth). The first blur asked for a depth within 2%, and at a grazing
// angle that keeps one row of the tile, 4 of its 16 slice directions: flat
// ground came out darker than 1 where it was seen most obliquely.
function blur(ao, Z, N, cam){
  const out = new Float32Array(ao.length).fill(1);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++){
    const i = px + W * py;
    if (N[i] < 0){ out[i] = 1; continue; }
    const n = NORMALS[N[i]], P = relAt(cam, Z, px, py), tol = 0.05 + 0.002 * Z[i];
    let s = 0, c = 0;
    for (let dy = -2; dy < 2; dy++) for (let dx = -2; dx < 2; dx++){
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const j = x + W * y;
      if (N[j] !== N[i] || !Number.isFinite(Z[j]) || Math.abs(dot(relAt(cam, Z, x, y).map((v, a) => v - P[a]), n)) > tol) continue;
      s += ao[j]; c++;
    }
    out[i] = Math.min(1, s / c);
  }
  return out;
}

/* ---- the depth the viewer has ----------------------------------------------
   viewProj's projection, window depth in DEPTH_COMPONENT24, read back by
   GLSL_RASTER_TMAX's formula. */
function quantize(Z, near, far){
  const q = new Float64Array(Z.length), M = 2 ** 24 - 1;
  for (let i = 0; i < Z.length; i++){
    const z = Z[i];
    if (!Number.isFinite(z)){ q[i] = Infinity; continue; }
    const ndc = ((far + near) * z - 2 * far * near) / ((far - near) * z), win = Math.round((0.5 * ndc + 0.5) * M) / M;
    q[i] = win >= 1 ? Infinity : near * far / (far * (1 - win) + win * near);
  }
  return q;
}
// The normal from depth alone: of the left and right neighbours the one on
// the same plane (the smaller depth step), the same up and down, crossed;
// then snapped to the nearest axis, since every face here is axis-aligned.
function normalsFromDepth(cam, Z, snap){
  const out = new Array(W * H).fill(null);
  for (let py = 0; py < H; py++) for (let px = 0; px < W; px++){
    const i = px + W * py;
    if (!Number.isFinite(Z[i])) continue;
    const p = relAt(cam, Z, px, py);
    const pick = (a, b) => {
      const za = a && Number.isFinite(Z[a[0] + W * a[1]]) ? Z[a[0] + W * a[1]] : null, zb = b && Number.isFinite(Z[b[0] + W * b[1]]) ? Z[b[0] + W * b[1]] : null;
      if (za === null && zb === null) return null;
      const useA = zb === null || (za !== null && Math.abs(za - Z[i]) <= Math.abs(zb - Z[i]));
      const q = useA ? relAt(cam, Z, ...a) : relAt(cam, Z, ...b);
      return useA ? p.map((v, k) => v - q[k]) : q.map((v, k) => v - p[k]);
    };
    const dx = pick(px > 0 ? [px - 1, py] : null, px < W - 1 ? [px + 1, py] : null);
    const dy = pick(py > 0 ? [px, py - 1] : null, py < H - 1 ? [px, py + 1] : null);
    if (!dx || !dy) continue;
    let n = norm(cross(dy, dx));
    if (dot(n, p) > 0) n = n.map(v => -v);
    if (snap){ const a = [0, 1, 2].reduce((m, k) => Math.abs(n[k]) > Math.abs(n[m]) ? k : m, 0), s = Math.sign(n[a]); n = [0, 0, 0]; n[a] = s; }
    out[i] = n;
  }
  return out;
}

/* ---- the worlds and views ----------------------------------------------- */
function clearanceOf(solid, eye, max = 64){
  const c = eye.map(Math.floor);
  let best = max;
  for (let r = 0; r <= max && r < best + 1; r++)
    for (let z = -r; z <= r; z++) for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++){
      if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r) continue;
      if (!solid(c[0] + x, c[1] + y, c[2] + z)) continue;
      const d = Math.hypot(...[x, y, z].map((v, a) => Math.max(0, Math.abs(c[a] + v + 0.5 - eye[a]) - 0.5)));
      if (d < best) best = d;
    }
  return best;
}
const WORLDS = {
  kit: () => {
    const desc = kitDesc({ D: 10 }), w = buildKit(desc);
    // kit.mjs's street (0.02, 0.12, 0.02 of the side) is inside a building at
    // D = 10; this eye is 10 voxels over the ground with 158 voxels of sight.
    return { name: 'kit, D = 10, a street', store: w.store, root: w.root, D: desc.D,
             view: { eye: [100, 26, 20], yaw: 0.78, pitch: -0.08 } };
  },
  kitfar: () => {
    const desc = kitDesc({ D: 10 }), w = buildKit(desc), s = 1024;
    return { name: 'kit, D = 10, the viewer\'s opening view', store: w.store, root: w.root, D: desc.D,
             view: { eye: [-0.35 * s, 0.9 * s, -0.45 * s], yaw: 0.68, pitch: -0.5 } };
  },
  kitnear: () => {
    const desc = kitDesc({ D: 10 }), w = buildKit(desc);
    return { name: 'kit, D = 10, close', store: w.store, root: w.root, D: desc.D,
             view: { eye: [70, 46, 40], yaw: 0.9, pitch: -0.3 } };
  },
  caves: () => {
    const w = buildCaves(caveDesc({ D: 10 }));
    return { name: 'caves, D = 10, the start chamber', store: w.store, root: w.root, D: w.D, view: w.info.view };
  },
  terrain: () => {
    const D = 10, shape = SHAPES.find(x => x.name === 'terrain'), store = createStore(), { root } = store.fromField(D, fieldOf(crustOf(shape, D, 64), D));
    return { name: 'terrain, D = 10 (hills)', store, root, D, view: { eye: [0.5 * 1024, 0.62 * 1024, 0.08 * 1024], yaw: 0, pitch: -0.35 } };
  },
  // Flat ground, nothing to occlude: AO below 1 here is artifact. The eye
  // 2 voxels up, looking out across it.
  flat: () => {
    const desc = clayDesc({ D: 12, lump: 0, ground: true }), w = buildClay(desc), c = 2 ** 11;
    return { name: 'flat ground, D = 12, the eye 2 voxels up', store: w.store, root: w.root, D: 12, view: { eye: [c + 0.5, c + 2, c + 0.5], yaw: 0.6, pitch: -0.02 } };
  },
  knight: async () => {
    const file = 'worlds/scene/knight-d8.vdag';
    if (!existsSync(file)) return null;
    const { worlds } = await readVdag(readFileSync(file)), w = worlds[0];
    return { name: 'the knight, D = 8', store: storeView({ keys: w.keys }), root: w.root, D: w.D, view: { eye: [-60, 175, 128], yaw: Math.PI / 2, pitch: -0.12 } };
  },
};

/* ---- one view: everything ----------------------------------------------- */
const stats = (ao, ref, N) => {
  let n = 0, mae = 0, sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, halo = 0, miss = 0, dark = 0;
  for (let i = 0; i < ao.length; i++){
    if (N[i] < 0) continue;
    const a = ao[i], b = ref[i];
    n++; mae += Math.abs(a - b); sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b;
    if (a < b - 0.2) halo++;
    if (a > b + 0.2) miss++;
    if (a < 0.8) dark++;
  }
  const cov = sab / n - sa / n * sb / n, r = cov / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2));
  return { mae: mae / n, r, halo: halo / n, miss: miss / n, mean: sa / n, dark: dark / n };
};
const fmt = (x, d = 3) => x.toFixed(d), pc = x => (100 * x).toFixed(1) + '%';

function shadeImage(cam, Z, N, ao, base = [0.72, 0.7, 0.66]){
  const L1 = norm([0.5, 0.8, 0.35]), L2 = norm([-0.6, -0.2, -0.7]), sky = [0.027, 0.027, 0.039], img = new Float32Array(3 * W * H);
  for (let i = 0; i < W * H; i++){
    if (N[i] < 0){ img.set(sky, 3 * i); continue; }
    const n = NORMALS[N[i]], shade = 0.55 + 0.45 * Math.max(dot(n, L1), 0) + 0.12 * Math.max(dot(n, L2), 0);
    const px = i % W, py = (i / W) | 0, rel = relAt(cam, Z, px, py), fog = (1 - Math.exp(-Math.hypot(...rel) / 1536)) * 0.85, k = ao ? ao[i] : 1;
    for (let c = 0; c < 3; c++) img[3 * i + c] = (base[c] * shade * k) * (1 - fog) + sky[c] * fog;
  }
  return img;
}
const greyImage = (ao, N) => { const img = new Float32Array(3 * W * H); for (let i = 0; i < W * H; i++){ const v = N[i] < 0 ? 0.08 : ao[i]; img[3 * i] = img[3 * i + 1] = img[3 * i + 2] = v; } return img; };
function montage(rows){
  const cols = rows[0].length, out = new Uint8Array(3 * cols * W * rows.length * H), OW = cols * W;
  rows.forEach((row, r) => row.forEach((img, c) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let k = 0; k < 3; k++)
      out[3 * ((r * H + y) * OW + c * W + x) + k] = Math.max(0, Math.min(255, Math.round(255 * Math.pow(img[3 * (x + W * y) + k], 1 / 1.0))));
  }));
  return png(OW, rows.length * H, out);
}

async function runView(key){
  const t0 = performance.now(), world = await WORLDS[key]();
  if (!world) return console.log(`\n### ${key}: no file (see the header)`);
  const cam = cameraOf(world.view), solid = solidOf(world.store, world.root, world.D);
  const G = gbuffer(world, cam), tG = performance.now();
  let hits = 0, zs = [];
  for (let i = 0; i < W * H; i++) if (G.N[i] >= 0){ hits++; zs.push(G.Z[i]); }
  zs.sort((a, b) => a - b);
  const clear = clearanceOf(solid, world.view.eye), near = Math.max(0.05, Math.min(64, 0.5 * clear)), far = 4 * 2 ** world.D + Math.hypot(...world.view.eye);
  console.log(`\n### ${world.name}\n`);
  console.log(`${W}×${H}, ${pc(hits / (W * H))} of pixels hit; depth median ${fmt(zs[zs.length >> 1], 0)}, 90th percentile ${fmt(zs[Math.floor(0.9 * zs.length)], 0)} voxels; ` +
              `a voxel is ${fmt(cam.pxPerVoxelAt(zs[zs.length >> 1]), 1)} px at the median. Clearance ${fmt(clear, 1)} → near ${fmt(near, 2)}, far ${fmt(far, 0)}. G-buffer ${fmt((tG - t0) / 1000, 1)} s.\n`);
  const trueNormal = (px, py) => { const k = G.N[px + W * py]; return k < 0 ? null : NORMALS[k]; };
  const rows = [], pics = {};
  for (const R of [2, 8]){
    const tr = performance.now(), ref = referenceAO(world, cam, G, R, solid), refMs = performance.now() - tr;
    const variants = [
      ['hemisphere SSAO, 8 samples', () => blur(hemiSSAO(cam, G.Z, trueNormal, { samples: 8, R, bias: 0.05 }), G.Z, G.N, cam)],
      ['hemisphere SSAO, 16 samples', () => blur(hemiSSAO(cam, G.Z, trueNormal, { samples: 16, R, bias: 0.05 }), G.Z, G.N, cam)],
      ['hemisphere SSAO, 32 samples', () => blur(hemiSSAO(cam, G.Z, trueNormal, { samples: 32, R, bias: 0.05 }), G.Z, G.N, cam)],
      ['GTAO, 2 slices × 4 steps (16 reads)', () => blur(gtao(cam, G.Z, trueNormal, { slices: 2, steps: 4, R }), G.Z, G.N, cam)],
      ['GTAO, 4 slices × 4 steps (32 reads)', () => blur(gtao(cam, G.Z, trueNormal, { slices: 4, steps: 4, R }), G.Z, G.N, cam)],
      ['GTAO 16, unblurred', () => gtao(cam, G.Z, trueNormal, { slices: 2, steps: 4, R }).map(v => Math.min(1, v))],
      ['GTAO 16, samples on the line (XeGTAO)', () => blur(gtao(cam, G.Z, trueNormal, { slices: 2, steps: 4, R, sampling: 'exact' }), G.Z, G.N, cam)],
      ['GTAO 16, samples projected into the slice', () => blur(gtao(cam, G.Z, trueNormal, { slices: 2, steps: 4, R, sampling: 'project' }), G.Z, G.N, cam)],
    ];
    if (R === 2) variants.push(['voxel corner AO (object space)', () => cornerAO(world, cam, G, solid)]);
    // The viewer's depth: 24 bits at this view's near plane, and at the
    // smallest near (the eye against a wall), normals from depth, snapped.
    const Zq = quantize(G.Z, near, far), Zw = quantize(G.Z, 0.05, far);
    const fromDepth = (Zx, snap) => { const nn = normalsFromDepth(cam, Zx, snap); return (px, py) => nn[px + W * py]; };
    variants.push([`GTAO 16, 24-bit depth (near ${fmt(near, 2)}), normals from depth`, () => blur(gtao(cam, Zq, fromDepth(Zq, true), { slices: 2, steps: 4, R }), Zq, G.N, cam)]);
    variants.push(['GTAO 16, 24-bit depth (near 0.05), normals from depth', () => blur(gtao(cam, Zw, fromDepth(Zw, true), { slices: 2, steps: 4, R }), Zw, G.N, cam)]);
    variants.push(['hemisphere 16, 24-bit depth (near 0.05), normals from depth', () => blur(hemiSSAO(cam, Zw, fromDepth(Zw, true), { samples: 16, R, bias: 0.05 }), Zw, G.N, cam)]);
    console.log(`R = ${R} voxels. Reference: ${REF_RAYS} rays a pixel in ${fmt(refMs / 1000, 1)} s, mean AO ${fmt(stats(ref, ref, G.N).mean)}, ${pc(stats(ref, ref, G.N).dark)} of hit pixels below 0.8.\n`);
    console.log('| AO | mean | error (mean abs) | correlation | too dark by > 0.2 | too light by > 0.2 |');
    console.log('|---|---:|---:|---:|---:|---:|');
    for (const [name, f] of variants){
      const ao = f(), s = stats(ao, ref, G.N);
      console.log(`| ${name} | ${fmt(s.mean)} | ${fmt(s.mae)} | ${fmt(s.r, 2)} | ${pc(s.halo)} | ${pc(s.miss)} |`);
      pics[`${R}:${name}`] = ao;
    }
    pics[`${R}:ref`] = ref;
    console.log('');
  }
  // How often a normal rebuilt from depth isn't the face's.
  for (const [label, Zx] of [['float depth', G.Z], [`24-bit, near ${fmt(near, 2)}`, quantize(G.Z, near, far)], ['24-bit, near 0.05', quantize(G.Z, 0.05, far)]]){
    const nn = normalsFromDepth(cam, Zx, true);
    let wrong = 0, none = 0;
    for (let i = 0; i < W * H; i++){
      if (G.N[i] < 0) continue;
      if (!nn[i]) { none++; continue; }
      const t = NORMALS[G.N[i]];
      if (dot(nn[i], t) < 0.5) wrong++;
    }
    console.log(`Normals from depth (${label}), snapped to an axis: ${pc(wrong / hits)} wrong, ${pc(none / hits)} none.`);
  }
  if (!PRINT){
    const g = k => greyImage(pics[k], G.N), sh = k => shadeImage(cam, G.Z, G.N, k ? pics[k] : null);
    const file = `docs/images/ssao-${key}.png`;
    writeFileSync(file, montage([
      [sh(null), sh('8:ref'), sh('8:GTAO, 2 slices × 4 steps (16 reads)'), sh('8:hemisphere SSAO, 16 samples'), sh('2:voxel corner AO (object space)')],
      [g('8:ref'), g('8:GTAO, 2 slices × 4 steps (16 reads)'), g('8:hemisphere SSAO, 16 samples'), g('2:voxel corner AO (object space)'), g('8:GTAO 16, 24-bit depth (near 0.05), normals from depth')],
    ]));
    console.log(`\n${file}: top, shaded: none, reference R = 8, GTAO 16, hemisphere 16, corner AO; bottom, AO alone: reference, GTAO 16, hemisphere 16, corner AO, GTAO 16 on 24-bit depth at near 0.05.`);
  }
  console.log(`(${fmt((performance.now() - t0) / 1000, 0)} s)`);
}

console.log(`# SSAO against the DAG's own ambient occlusion (experiments/ssao-sketch.mjs, ${W}×${H})`);
/* Where 24-bit depth stops being good enough, analytically. Window depth
   steps by 2^−24; at forward distance z that is a step of about
   z²(f − n) / (n·f·2^24) voxels. SSAO's own reach ends where a radius of R
   voxels is under a pixel: z = R·(H/2)/tan(0.45), for the screen's H. */
{
  const far = 4 * 2 ** 20, step = (z, n) => z * z * (far - n) / (n * far * 2 ** 24);
  const at = (n, e) => Math.sqrt(e * n * far * 2 ** 24 / (far - n));
  console.log('\n## 24-bit depth against SSAO\'s reach\n');
  console.log('| near (voxels) | depth step at 100 | at 1,000 | at 10,000 | step = 0.1 voxel at | step = 1 voxel at |');
  console.log('|---:|---:|---:|---:|---:|---:|');
  for (const n of [0.05, 0.5, 4, 32, 64])
    console.log(`| ${n} | ${step(100, n).toPrecision(2)} | ${step(1e3, n).toPrecision(2)} | ${step(1e4, n).toPrecision(2)} | ${Math.round(at(n, 0.1)).toLocaleString()} | ${Math.round(at(n, 1)).toLocaleString()} |`);
  console.log('\n| screen height (px) | R = 2 under a pixel past | R = 8 | R = 32 |\n|---:|---:|---:|---:|');
  for (const h of [250, 1000, 1600, 2160]) console.log(`| ${h} | ${[2, 8, 32].map(R => Math.round(R * h / 2 / TAN).toLocaleString()).join(' | ')} |`);
}
for (const key of Object.keys(WORLDS)) if (!ONLY || ONLY.includes(key)) await runView(key);
