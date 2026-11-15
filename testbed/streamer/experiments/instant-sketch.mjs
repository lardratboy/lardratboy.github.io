/* Instant voxels: what it costs to voxelize an animated mesh every frame
   (docs/instantvoxels.md).

     node experiments/instant-sketch.mjs                 # ~45 s; prints markdown, writes nothing
     node experiments/instant-sketch.mjs --asset=<file.glb> --clip=Run --sizes=64,128

   The question behind the doc: a regular scene (skinned meshes, clips,
   physics) simulated as it always is, and shown as crisp voxels. The static
   part of such a scene is a world file already (convert/). This puts numbers
   on the part that moves: a skinned character, posed by its clip, voxelized
   into a box n voxels on a side, every frame.

   What runs, per frame, all plain JS on one thread:
     pose      the clip sampled, the joints' matrices
     skin      every vertex by its four joints (glTF's linear blend)
     voxelize  each triangle into the cells it touches (conservative: Schwarz
               & Seidler's triangle/box test, a plane and nine edge functions)
     flood     outside air from a corner, so what isn't reached is solid
     records   chunk-core's 4-byte records (Morton cell, face mask), straight
               from the grid: no DAG

   And, for comparison, the road through what's built: the same grid through
   `fromDense` into a DAG, then `expandChunk` a chunk. The two roads must
   give the same records (cells and masks; the pose bits are the DAG's), and
   the sketch stops if they don't.

   Then three things the doc argues from:
     - a flipbook: every frame of the clip at 15 Hz in one store, against
       each in a store of its own (what hash-consing shares between frames);
     - how many voxels change from one frame to the next;
     - how many change when the same pose moves a fraction of a voxel (the
       "swim" of a grid locked to the world).

   A sketch: no tests, no viewer. The voxelizer is held to a second
   triangle/box test (the triangle clipped by the box's six planes) on one
   frame at n = 32. It measures times, so run it on an idle machine.
   The glTF reader here does skins and clips, which glb-core's doesn't; it
   reads no textures (colour is a stand-in, the triangle's index).
   CUBICSPLINE samplers are read as linear between their values. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGlb } from './glb-core.mjs';
import { createStore } from '../dag-core.js';
import { expandChunk, mortonOf, packRecord, nodeAt } from '../chunk-core.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const a = process.argv.find(s => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const FILE = path.resolve(ROOT, arg('asset', 'test-3d-models/convert/goblin_animations.glb'));
const CLIP = arg('clip', 'Walk'), SIZES = arg('sizes', '64,128,256').split(',').map(Number);
const say = s => console.log(s);
if (!fs.existsSync(FILE)){ say(`no asset at ${FILE} (test-3d-models/ is gitignored): pass --asset=<file.glb> with a skin and a clip`); process.exit(0); }

/* ---- the glTF: nodes, a clip, skins ------------------------------------- */
const { J, BIN } = parseGlb(fs.readFileSync(FILE));
function accessor(i){
  const a = J.accessors[i], k = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type], v = J.bufferViews[a.bufferView];
  const size = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType];
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  const stride = v.byteStride || k * size, base = BIN.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const dv = new DataView(BIN.buffer), out = new Float64Array(a.count * k);
  for (let e = 0; e < a.count; e++) for (let c = 0; c < k; c++) out[e * k + c] = dv[get](base + e * stride + c * size, true);
  if (a.normalized){ const m = { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[a.componentType]; for (let j = 0; j < out.length; j++) out[j] /= m; }
  return out;
}
const NN = J.nodes.length, parent = new Int32Array(NN).fill(-1), order = [];
J.nodes.forEach((n, i) => (n.children ?? []).forEach(c => { parent[c] = i; }));
const visit = i => { order.push(i); (J.nodes[i].children ?? []).forEach(visit); };
for (let i = 0; i < NN; i++) if (parent[i] < 0) visit(i);
const rest = J.nodes.map(n => ({ t: n.translation ?? [0, 0, 0], r: n.rotation ?? [0, 0, 0, 1], s: n.scale ?? [1, 1, 1], m: n.matrix ?? null }));

const clip = (J.animations ?? []).find(a => (a.name ?? '').includes(CLIP)) ?? (J.animations ?? [])[0];
if (!clip){ say('this asset has no animation'); process.exit(0); }
const chans = clip.channels.filter(c => c.target.node != null && c.target.path !== 'weights').map(c => {
  const s = clip.samplers[c.sampler];
  return { node: c.target.node, path: c.target.path, t: accessor(s.input), v: accessor(s.output), mode: s.interpolation ?? 'LINEAR' };
});
/* Exporters often lay several clips along one timeline (the goblin's idle is
   0–3 s, its walk 3–4.67, its run 4.67–5.67), so a clip is the span of its
   own keys, not 0 to its last one: before T0 it only holds its first pose. */
const DUR = Math.max(...chans.map(c => c.t[c.t.length - 1])), T0 = Math.min(...chans.map(c => c.t.length > 1 ? c.t[0] : Infinity));
const at = u => T0 + (DUR - T0) * u;

// Column-major 4×4s, 16 doubles a node, as glTF writes them.
const L = new Float64Array(16 * NN), G = new Float64Array(16 * NN), cur = rest.map(r => ({ t: [...r.t], r: [...r.r], s: [...r.s] }));
function mul(A, a, B, b, O, o){
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++)
    O[o + 4 * c + r] = A[a + r] * B[b + 4 * c] + A[a + 4 + r] * B[b + 4 * c + 1] + A[a + 8 + r] * B[b + 4 * c + 2] + A[a + 12 + r] * B[b + 4 * c + 3];
}
function pose(time){
  for (let i = 0; i < NN; i++){ const c = cur[i], r = rest[i]; for (let k = 0; k < 3; k++){ c.t[k] = r.t[k]; c.s[k] = r.s[k]; } for (let k = 0; k < 4; k++) c.r[k] = r.r[k]; }
  for (const ch of chans){
    const k = ch.path === 'rotation' ? 4 : 3, spline = ch.mode === 'CUBICSPLINE', w = spline ? 3 * k : k, off = spline ? k : 0, T = ch.t, n = T.length;
    let i = 0;
    if (time >= T[n - 1]) i = n - 1; else { let lo = 0, hi = n - 1; while (hi - lo > 1){ const m = (lo + hi) >> 1; if (T[m] <= time) lo = m; else hi = m; } i = lo; }
    const j = Math.min(i + 1, n - 1), u = ch.mode === 'STEP' || j === i || time <= T[0] ? 0 : (time - T[i]) / (T[j] - T[i]);
    const out = cur[ch.node][ch.path === 'rotation' ? 'r' : ch.path === 'scale' ? 's' : 't'], a = i * w + off, b = j * w + off;
    if (k === 4){
      let dot = 0; for (let c = 0; c < 4; c++) dot += ch.v[a + c] * ch.v[b + c];
      const sg = dot < 0 ? -1 : 1; let len = 0;
      for (let c = 0; c < 4; c++){ out[c] = ch.v[a + c] * (1 - u) + sg * ch.v[b + c] * u; len += out[c] * out[c]; }
      len = Math.sqrt(len) || 1; for (let c = 0; c < 4; c++) out[c] /= len;
    } else for (let c = 0; c < 3; c++) out[c] = ch.v[a + c] * (1 - u) + ch.v[b + c] * u;
  }
  for (const i of order){
    const o = 16 * i, m = rest[i].m;
    if (m) for (let k = 0; k < 16; k++) L[o + k] = m[k];
    else {
      const { t, r: [x, y, z, w], s } = cur[i];
      L[o] = (1 - 2 * (y * y + z * z)) * s[0]; L[o + 1] = 2 * (x * y + z * w) * s[0]; L[o + 2] = 2 * (x * z - y * w) * s[0]; L[o + 3] = 0;
      L[o + 4] = 2 * (x * y - z * w) * s[1]; L[o + 5] = (1 - 2 * (x * x + z * z)) * s[1]; L[o + 6] = 2 * (y * z + x * w) * s[1]; L[o + 7] = 0;
      L[o + 8] = 2 * (x * z + y * w) * s[2]; L[o + 9] = 2 * (y * z - x * w) * s[2]; L[o + 10] = (1 - 2 * (x * x + y * y)) * s[2]; L[o + 11] = 0;
      L[o + 12] = t[0]; L[o + 13] = t[1]; L[o + 14] = t[2]; L[o + 15] = 1;
    }
    if (parent[i] < 0) for (let k = 0; k < 16; k++) G[o + k] = L[o + k]; else mul(G, 16 * parent[i], L, o, G, o);
  }
}

// Every triangle primitive, skinned or carried by its node, as one vertex list.
const parts = [];
let NV = 0, NT = 0;
J.nodes.forEach((n, ni) => {
  if (n.mesh == null) return;
  const skin = n.skin != null ? J.skins[n.skin] : null;
  const sk = skin ? { joints: skin.joints, ibm: accessor(skin.inverseBindMatrices), jm: new Float64Array(16 * skin.joints.length) } : null;
  for (const pr of J.meshes[n.mesh].primitives){
    if ((pr.mode ?? 4) !== 4) continue;
    const pos = accessor(pr.attributes.POSITION), nv = pos.length / 3;
    const idx = pr.indices != null ? Uint32Array.from(accessor(pr.indices)) : Uint32Array.from({ length: nv }, (_, i) => i);
    const skinned = sk && pr.attributes.JOINTS_0 != null;
    parts.push({ node: ni, pos, idx, base: NV, sk: skinned ? sk : null,
                 j4: skinned ? Uint16Array.from(accessor(pr.attributes.JOINTS_0)) : null, w4: skinned ? accessor(pr.attributes.WEIGHTS_0) : null });
    NV += nv; NT += idx.length / 3;
  }
});
const IDX = new Uint32Array(3 * NT);
{ let o = 0; for (const p of parts) for (const i of p.idx) IDX[o++] = p.base + i; }
const W = new Float64Array(3 * NV);          // posed vertices, in the asset's units
function skin(){
  for (const p of parts){
    const { pos, sk, j4, w4, base } = p, nv = pos.length / 3;
    if (sk){
      for (let j = 0; j < sk.joints.length; j++) mul(G, 16 * sk.joints[j], sk.ibm, 16 * j, sk.jm, 16 * j);
      const M = sk.jm;
      for (let v = 0; v < nv; v++){
        const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
        let X = 0, Y = 0, Z = 0;
        for (let k = 0; k < 4; k++){
          const w = w4[4 * v + k]; if (!w) continue;
          const m = 16 * j4[4 * v + k];
          X += w * (M[m] * x + M[m + 4] * y + M[m + 8] * z + M[m + 12]);
          Y += w * (M[m + 1] * x + M[m + 5] * y + M[m + 9] * z + M[m + 13]);
          Z += w * (M[m + 2] * x + M[m + 6] * y + M[m + 10] * z + M[m + 14]);
        }
        const o = 3 * (base + v); W[o] = X; W[o + 1] = Y; W[o + 2] = Z;
      }
    } else {
      const m = 16 * p.node;
      for (let v = 0; v < nv; v++){
        const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2], o = 3 * (base + v);
        W[o] = G[m] * x + G[m + 4] * y + G[m + 8] * z + G[m + 12]; W[o + 1] = G[m + 1] * x + G[m + 5] * y + G[m + 9] * z + G[m + 13]; W[o + 2] = G[m + 2] * x + G[m + 6] * y + G[m + 10] * z + G[m + 14];
      }
    }
  }
}

/* ---- the box: the whole clip's bounds, a voxel of air all round ----------
   Fitted once, so a frame's voxels are the character's in a grid that stays
   put (the grid is locked to the box, as it would be to a world). The 0.37
   keeps vertices off cell faces, as mesh-asset's fit does. */
const FRAMES15 = Math.max(2, Math.round((DUR - T0) * 15));
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (let f = 0; f < FRAMES15; f++){
  pose(at(f / FRAMES15)); skin();
  for (let v = 0; v < NV; v++) for (let a = 0; a < 3; a++){ const c = W[3 * v + a]; if (c < lo[a]) lo[a] = c; if (c > hi[a]) hi[a] = c; }
}
const EXT = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
const V = new Float64Array(3 * NV);          // the same, in voxels of the box
function toBox(n, shift = 0){
  const s = (n - 2.74) / EXT;
  for (let v = 0; v < NV; v++) for (let a = 0; a < 3; a++) V[3 * v + a] = (W[3 * v + a] - lo[a]) * s + 1.37 + (a === 0 ? shift : 0);
}

/* ---- voxelize: Schwarz & Seidler 2010, conservative ------------------------
   A cell is marked when the triangle touches its closed box. Per triangle:
   the plane against the box's two critical corners, then in each of the three
   axis planes the triangle's three edge functions pushed out by the box. A
   triangle inside one cell (most of them, once voxels are bigger than
   triangles) is one write. `list` gets each newly marked cell. */
function triBox(V, i0, i1, i2){
  const ax = V[i0], ay = V[i0 + 1], az = V[i0 + 2], bx = V[i1], by = V[i1 + 1], bz = V[i1 + 2], cx = V[i2], cy = V[i2 + 1], cz = V[i2 + 2];
  const e0x = bx - ax, e0y = by - ay, e0z = bz - az, e1x = cx - bx, e1y = cy - by, e1z = cz - bz, e2x = ax - cx, e2y = ay - cy, e2z = az - cz;
  const nx = e0y * e1z - e0z * e1y, ny = e0z * e1x - e0x * e1z, nz = e0x * e1y - e0y * e1x;
  const kx = nx > 0 ? 1 : 0, ky = ny > 0 ? 1 : 0, kz = nz > 0 ? 1 : 0;
  const d1 = nx * (kx - ax) + ny * (ky - ay) + nz * (kz - az), d2 = nx * (1 - kx - ax) + ny * (1 - ky - ay) + nz * (1 - kz - az);
  // An edge function in the plane of axes (u, v), seen along w: n = s·(−e_v, e_u).
  const edge = (s, eu, ev, pu, pv) => { const mu = -ev * s, mv = eu * s; return [mu, mv, -(mu * pu + mv * pv) + Math.max(0, mu) + Math.max(0, mv)]; };
  const sz = nz >= 0 ? 1 : -1, sx = nx >= 0 ? 1 : -1, sy = ny >= 0 ? 1 : -1;
  const E = [edge(sz, e0x, e0y, ax, ay), edge(sz, e1x, e1y, bx, by), edge(sz, e2x, e2y, cx, cy),      // xy
             edge(sx, e0y, e0z, ay, az), edge(sx, e1y, e1z, by, bz), edge(sx, e2y, e2z, cy, cz),      // yz
             edge(sy, e0z, e0x, az, ax), edge(sy, e1z, e1x, bz, bx), edge(sy, e2z, e2x, cz, cx)];     // zx
  return (x, y, z) => {
    const np = nx * x + ny * y + nz * z;
    if ((np + d1) * (np + d2) > 0) return false;
    for (let k = 0; k < 3; k++) if (E[k][0] * x + E[k][1] * y + E[k][2] < 0) return false;
    for (let k = 3; k < 6; k++) if (E[k][0] * y + E[k][1] * z + E[k][2] < 0) return false;
    for (let k = 6; k < 9; k++) if (E[k][0] * z + E[k][1] * x + E[k][2] < 0) return false;
    return true;
  };
}
function voxelize(V, IDX, n, occ, list, owner){
  let count = 0, one = 0;
  const fl = v => { const f = Math.floor(v); return f < 0 ? 0 : f > n - 1 ? n - 1 : f; };
  for (let t = 0; t < IDX.length; t += 3){
    const i0 = 3 * IDX[t], i1 = 3 * IDX[t + 1], i2 = 3 * IDX[t + 2];
    const x0 = fl(Math.min(V[i0], V[i1], V[i2])), x1 = fl(Math.max(V[i0], V[i1], V[i2]));
    const y0 = fl(Math.min(V[i0 + 1], V[i1 + 1], V[i2 + 1])), y1 = fl(Math.max(V[i0 + 1], V[i1 + 1], V[i2 + 1]));
    const z0 = fl(Math.min(V[i0 + 2], V[i1 + 2], V[i2 + 2])), z1 = fl(Math.max(V[i0 + 2], V[i1 + 2], V[i2 + 2]));
    if (x0 === x1 && y0 === y1 && z0 === z1){
      const i = x0 + n * (y0 + n * z0); one++;
      if (!occ[i]){ occ[i] = 1; list[count++] = i; if (owner) owner[i] = t / 3; }
      continue;
    }
    const hit = triBox(V, i0, i1, i2);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){
      const i = x + n * (y + n * z);
      if (!occ[i] && hit(x, y, z)){ occ[i] = 1; list[count++] = i; if (owner) owner[i] = t / 3; }
    }
  }
  return { count, one };
}
/* The second opinion: the triangle clipped by the cell's six closed
   half-spaces (Sutherland and Hodgman). Anything left is a touch. */
function clipHit(V, i0, i1, i2, x, y, z){
  let poly = [[V[i0], V[i0 + 1], V[i0 + 2]], [V[i1], V[i1 + 1], V[i1 + 2]], [V[i2], V[i2 + 1], V[i2 + 2]]];
  const c = [x, y, z];
  for (let a = 0; a < 3 && poly.length; a++) for (const side of [1, -1]){
    const d = p => side > 0 ? p[a] - c[a] : c[a] + 1 - p[a], out = [];
    for (let k = 0; k < poly.length; k++){
      const p = poly[k], q = poly[(k + 1) % poly.length], dp = d(p), dq = d(q);
      if (dp >= 0) out.push(p);
      if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)){ const u = dp / (dp - dq); out.push([p[0] + u * (q[0] - p[0]), p[1] + u * (q[1] - p[1]), p[2] + u * (q[2] - p[2])]); }
    }
    poly = out;
  }
  return poly.length > 0;
}

/* ---- solid: flood the outside air from a corner (the fit leaves a voxel) -- */
function flood(occ, n, ext, stack){
  ext.fill(0);
  const m = n - 1, sh = Math.log2(n), nn = n * n;
  let top = 0; stack[top++] = 0; ext[0] = 1;
  while (top){
    const i = stack[--top], x = i & m, y = i >> sh & m, z = i >> 2 * sh;
    if (x < m && !ext[i + 1] && !occ[i + 1]){ ext[i + 1] = 1; stack[top++] = i + 1; }
    if (x > 0 && !ext[i - 1] && !occ[i - 1]){ ext[i - 1] = 1; stack[top++] = i - 1; }
    if (y < m && !ext[i + n] && !occ[i + n]){ ext[i + n] = 1; stack[top++] = i + n; }
    if (y > 0 && !ext[i - n] && !occ[i - n]){ ext[i - n] = 1; stack[top++] = i - n; }
    if (z < m && !ext[i + nn] && !occ[i + nn]){ ext[i + nn] = 1; stack[top++] = i + nn; }
    if (z > 0 && !ext[i - nn] && !occ[i - nn]){ ext[i - nn] = 1; stack[top++] = i - nn; }
  }
}

/* ---- records, straight from the grid ----------------------------------------
   Only a marked cell can show a face (inside the shell everything is solid),
   so this walks the voxelizer's list. `air(i)` says whether a neighbour is
   open: with the flood it's the outside, without it any unmarked cell, which
   also shows the shell's inner faces. chunk-core's mask order: +x −x +y −y
   +z −z, and the box's edge is open. */
function recordsOf(n, list, count, air, words, owner){
  const m = n - 1, sh = Math.log2(n), nn = n * n, C = n >> 6, per = new Map();
  let quads = 0, shown = 0;
  for (let k = 0; k < count; k++){
    const i = list[k], x = i & m, y = i >> sh & m, z = i >> 2 * sh;
    const mask = (x === m || air(i + 1) ? 1 : 0) | (x === 0 || air(i - 1) ? 2 : 0) | (y === m || air(i + n) ? 4 : 0) | (y === 0 || air(i - n) ? 8 : 0)
               | (z === m || air(i + nn) ? 16 : 0) | (z === 0 || air(i - nn) ? 32 : 0);
    if (!mask) continue;
    const c = (x >> 6) + C * ((y >> 6) + C * (z >> 6));
    let b = per.get(c);
    if (!b){ b = { r: new Uint32Array(1024), w: words ? new Uint32Array(1024) : null, n: 0 }; per.set(c, b); }
    if (b.n === b.r.length){ const r = new Uint32Array(2 * b.n); r.set(b.r); b.r = r; if (b.w){ const w = new Uint32Array(2 * b.n); w.set(b.w); b.w = w; } }
    if (b.w) b.w[b.n] = owner[i] * 2654435761 >>> 8 << 8;      // a stand-in word: the triangle's, hashed
    b.r[b.n++] = packRecord(mortonOf(x & 63, y & 63, z & 63), mask, 0);
    shown++; quads += (mask & 1) + (mask >> 1 & 1) + (mask >> 2 & 1) + (mask >> 3 & 1) + (mask >> 4 & 1) + (mask >> 5 & 1);
  }
  return { per, shown, quads };
}

/* ---- run ------------------------------------------------------------------ */
const med = a => [...a].sort((x, y) => x - y)[a.length >> 1];
const ms = v => v < 10 ? v.toFixed(2) : v.toFixed(1);
const now = () => performance.now();

say(`# instant-sketch: ${path.basename(FILE)}, clip "${clip.name}" (${T0.toFixed(2)}–${DUR.toFixed(2)} s)\n`);
say(`${NT.toLocaleString()} triangles, ${NV.toLocaleString()} vertices, ${(J.skins ?? []).map(s => s.joints.length).join(' + ') || 0} joints, ${chans.length} channels; the clip's bounds ${[0, 1, 2].map(a => (hi[a] - lo[a]).toFixed(2)).join(' × ')} in the asset's units.\n`);

// The voxelizer against the clip test, one frame at n = 32.
{
  const n = 32; pose(at(0.37)); skin(); toBox(n);
  let both = 0, onlyFast = 0, onlyClip = 0;
  const fl = v => Math.max(0, Math.min(n - 1, Math.floor(v)));
  for (let t = 0; t < IDX.length; t += 3){
    const i0 = 3 * IDX[t], i1 = 3 * IDX[t + 1], i2 = 3 * IDX[t + 2], hit = triBox(V, i0, i1, i2);
    // The nine edge functions and the plane are ten of the thirteen axes; the
    // other three are the triangle's own bounds, which voxelize's loops are.
    // So the fast test is "in the bounds and hit", and the clip is asked a
    // cell further out on every side to hold the bounds too.
    const lo3 = a => Math.min(V[i0 + a], V[i1 + a], V[i2 + a]), hi3 = a => Math.max(V[i0 + a], V[i1 + a], V[i2 + a]);
    const b = a => [fl(lo3(a) - 1), fl(hi3(a) + 1)], inB = (a, v) => v >= fl(lo3(a)) && v <= fl(hi3(a));
    const [x0, x1] = b(0), [y0, y1] = b(1), [z0, z1] = b(2);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){
      const f = inB(0, x) && inB(1, y) && inB(2, z) && hit(x, y, z), c = clipHit(V, i0, i1, i2, x, y, z);
      if (f && c) both++; else if (f) onlyFast++; else if (c) onlyClip++;
    }
  }
  say(`Voxelizer against the clipped triangle, n = 32, one frame: ${both.toLocaleString()} (triangle, cell) touches agree; ${onlyFast} only the fast test's, ${onlyClip} only the clip's.\n`);
  if (onlyFast + onlyClip > both * 1e-4) throw new Error('the two triangle/box tests disagree');
}

say('## 1. A frame, live (median ms of 24 frames across the clip, one thread)\n');
say('| box | tall | marked cells | one-cell triangles | shown, solid | quads, solid | quads, shell only | pose | skin | voxelize | flood | records | **total** | **shell only, no flood** | records + words |');
say('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
const live = {};
for (const n of SIZES){
  const occ = new Uint8Array(n ** 3), ext = new Uint8Array(n ** 3), list = new Uint32Array(n ** 3 >> 1), stack = new Int32Array(n ** 3), owner = new Uint32Array(n ** 3);
  const T = { pose: [], skin: [], vox: [], flood: [], rec: [] };
  let last = null;
  for (let f = -3; f < 24; f++){
    const time = at((Math.max(f, 0) * 0.6180339887) % 1);
    let t0 = now(); pose(time); let t1 = now(); skin(); toBox(n); let t2 = now();
    occ.fill(0); const vx = voxelize(V, IDX, n, occ, list, owner); let t3 = now();
    flood(occ, n, ext, stack); let t4 = now();
    const R = recordsOf(n, list, vx.count, i => ext[i] === 1, true, owner); let t5 = now();
    if (f >= 0){ T.pose.push(t1 - t0); T.skin.push(t2 - t1); T.vox.push(t3 - t2); T.flood.push(t4 - t3); T.rec.push(t5 - t4); }
    last = { vx, R, shell: recordsOf(n, list, vx.count, i => occ[i] === 0, false, owner) };
  }
  const tot = med(T.pose) + med(T.skin) + med(T.vox) + med(T.flood) + med(T.rec);
  live[n] = { tot, shown: last.R.shown };
  say(`| ${n}³ | ${Math.round((hi[1] - lo[1]) * (n - 2.74) / EXT)} | ${last.vx.count.toLocaleString()} | ${(100 * last.vx.one / NT).toFixed(0)}% | ${last.R.shown.toLocaleString()} | ${last.R.quads.toLocaleString()} | ${last.shell.quads.toLocaleString()} | ${ms(med(T.pose))} | ${ms(med(T.skin))} | ${ms(med(T.vox))} | ${ms(med(T.flood))} | ${ms(med(T.rec))} | **${ms(tot)}** | **${ms(tot - med(T.flood))}** | ${(last.R.shown * 8 / 1024).toFixed(0)} KB |`);
}

say('\n## 2. The same frame through the DAG (fromDense, then expandChunk a chunk, lod 0)\n');
say('| box | nodes | chunks with content | fromDense ms | expandChunk ms, all chunks | records | same as the direct road |');
say('|---|---:|---:|---:|---:|---:|---|');
for (const n of SIZES){
  const occ = new Uint8Array(n ** 3), ext = new Uint8Array(n ** 3), list = new Uint32Array(n ** 3 >> 1), stack = new Int32Array(n ** 3), solid = new Uint8Array(n ** 3);
  pose(at(0.37)); skin(); toBox(n);
  const vx = voxelize(V, IDX, n, occ, list, null); flood(occ, n, ext, stack);
  for (let i = 0; i < solid.length; i++) solid[i] = ext[i] ^ 1;
  const direct = recordsOf(n, list, vx.count, i => ext[i] === 1, false, null);
  const tD = [], tE = []; let nodes = 0, recs = 0, chunks = 0, same = true;
  for (let rep = 0; rep < (n > 128 ? 3 : 9); rep++){
    const store = createStore(); let t0 = now(); const { root, D } = store.fromDense(solid, n); tD.push(now() - t0); nodes = store.size;
    const C = n >> 6; recs = 0; chunks = 0; t0 = now(); const outs = [];
    for (let cz = 0; cz < C; cz++) for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++){
      const e = expandChunk(store, root, D, { lod: 0, cx, cy, cz }); outs.push([cx + C * (cy + C * cz), e]);
    }
    tE.push(now() - t0);
    for (const [c, e] of outs){
      if (!e.count){ if (direct.per.has(c)) same = false; continue; }
      chunks++; recs += e.count;
      const a = Array.from(e.records.subarray(0, e.count), r => r & 0xffffff).sort((x, y) => x - y), b = direct.per.get(c);
      const d = b ? Array.from(b.r.subarray(0, b.n)).sort((x, y) => x - y) : [];
      if (a.length !== d.length || a.some((r, k) => r !== d[k])) same = false;
    }
  }
  say(`| ${n}³ | ${nodes.toLocaleString()} | ${chunks} | ${ms(med(tD))} | ${ms(med(tE))} | ${recs.toLocaleString()} | ${same ? 'yes, every chunk' : '**NO**'} |`);
  if (!same) throw new Error(`n = ${n}: the direct records aren't expandChunk's`);
}

say(`\n## 3. A flipbook: the clip at 15 Hz (${FRAMES15} frames), every frame a world\n`);
say('| box | nodes, each frame alone (sum) | nodes, one store | shared | a frame, median nodes | chunks (sum) | distinct chunks | records (sum) | as record buffers |');
say('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
const change = {};
for (const n of SIZES){
  const occ = new Uint8Array(n ** 3), ext = new Uint8Array(n ** 3), list = new Uint32Array(n ** 3 >> 1), stack = new Int32Array(n ** 3), solid = new Uint8Array(n ** 3), prev = new Uint8Array(n ** 3);
  const shared = createStore(), alone = [], C = Math.max(1, n >> 6), seen = new Set();
  let chunks = 0, recs = 0; const diffs = [];
  for (let f = 0; f < FRAMES15; f++){
    pose(at(f / FRAMES15)); skin(); toBox(n);
    occ.fill(0); const vx = voxelize(V, IDX, n, occ, list, null); flood(occ, n, ext, stack);
    let d = 0;
    for (let i = 0; i < solid.length; i++){ const s = ext[i] ^ 1; if (s !== prev[i]) d++; prev[i] = solid[i] = s; }
    const R = recordsOf(n, list, vx.count, i => ext[i] === 1, false, null); recs += R.shown;
    if (f) diffs.push(d / R.shown);
    const one = createStore(); one.fromDense(solid, n); alone.push(one.size);
    const { root, D } = shared.fromDense(solid, n);
    for (let cz = 0; cz < C; cz++) for (let cy = 0; cy < C; cy++) for (let cx = 0; cx < C; cx++){
      const id = D <= 6 ? root : nodeAt(shared, root, D, 6, cx, cy, cz);
      if (id){ chunks++; seen.add(id); }
    }
  }
  change[n] = med(diffs);
  const sum = alone.reduce((a, b) => a + b, 0);
  say(`| ${n}³ | ${sum.toLocaleString()} | ${shared.size.toLocaleString()} | ${(100 * (1 - shared.size / sum)).toFixed(1)}% | ${med(alone).toLocaleString()} | ${chunks} | ${seen.size} | ${recs.toLocaleString()} | ${(recs * 8 / 2 ** 20).toFixed(1)} MB |`);
}

say('\n## 4. How much of the character changes\n');
say('Voxels that differ (solid in one, air in the other), as a share of the shown voxels.\n');
say('| box | 15 Hz frame to the next | 60 Hz frame to the next | the same pose moved ¼ voxel | ½ voxel | 1 voxel (a pure shift: every cell is its neighbour) |');
say('|---|---:|---:|---:|---:|---:|');
for (const n of SIZES){
  const occ = new Uint8Array(n ** 3), ext = new Uint8Array(n ** 3), list = new Uint32Array(n ** 3 >> 1), stack = new Int32Array(n ** 3);
  const grab = () => { occ.fill(0); const vx = voxelize(V, IDX, n, occ, list, null); flood(occ, n, ext, stack); const s = new Uint8Array(n ** 3); let shown = 0; for (let i = 0; i < s.length; i++) s[i] = ext[i] ^ 1; shown = recordsOf(n, list, vx.count, i => ext[i] === 1, false, null).shown; return { s, shown }; };
  const diff = (a, b) => { let d = 0; for (let i = 0; i < a.s.length; i++) if (a.s[i] !== b.s[i]) d++; return d / a.shown; };
  const d60 = [];
  for (let f = 0; f < 12; f++){ pose(at(f / 12)); skin(); toBox(n); const a = grab(); pose(at(f / 12) + 1 / 60); skin(); toBox(n); d60.push(diff(a, grab())); }
  pose(at(0.37)); skin(); toBox(n); const base = grab();
  const moved = sh => { toBox(n, sh); return diff(base, grab()); };
  say(`| ${n}³ | ${(100 * change[n]).toFixed(0)}% | ${(100 * med(d60)).toFixed(0)}% | ${(100 * moved(0.25)).toFixed(0)}% | ${(100 * moved(0.5)).toFixed(0)}% | ${(100 * moved(1)).toFixed(0)}% |`);
}
say('');
