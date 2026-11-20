/* A glTF asset read, prepared and baked: the pure half of mesh-asset.mjs, so a
   browser can run it too (convert/, the page that does what mesh-vdag.mjs does
   with a file dropped on it). No Node imports: bytes come in as Uint8Arrays,
   and a PNG's deflate stream is inflated by whoever calls (zlib in Node,
   DecompressionStream in a page), so `pngParts` / `pngPixels` are the decode
   either side of it.

   Moved out of mesh-asset.mjs unchanged but for the reader, which was one
   function over fs and Buffer and is three here: `parseGlb` (the container),
   `glbImages` (each image's bytes, undecoded) and `glbMesh` (the triangles,
   given the images decoded). mesh-vdag's files for the convert folder's
   assets at D = 6 and 7 are byte for byte what they were, and
   test/convert-core.test.js holds the page's core to the script's bytes.

   `bakeDepth` is the build one depth takes, in the order the store grows
   (shape, skin, the union check, words), shared by mesh-vdag.mjs and
   convert/convert-core.js, so the ids, and so the files, are the same. What
   each piece is for, and what a real asset taught it, is in mesh-vdag.mjs's
   header. Not the engine. */
import { EMPTY, createCounts } from '../dag-core.js';
import { rgb8 } from '../attr-core.js';
import { closestOnTri, triBox, voxelize } from './mesh-core.mjs';

/* ---- PNG, decoded either side of the inflate ----------------------------------------------
   8-bit greyscale, grey + alpha, RGB, RGBA or palette, not interlaced: what
   exporters write for a base-colour texture. Anything else throws (a page
   then hands the image to the platform's decoder; Node skips it). */
export function pngParts(bytes){
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 8 || dv.getUint32(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, type = 0, inter = 0, pal = null, trns = null; const idat = [];
  while (p + 8 <= bytes.length){
    const n = dv.getUint32(p), t = String.fromCharCode(bytes[p + 4], bytes[p + 5], bytes[p + 6], bytes[p + 7]), d = bytes.subarray(p + 8, p + 8 + n);
    if (t === 'IHDR'){ const v = new DataView(d.buffer, d.byteOffset, d.byteLength); w = v.getUint32(0); h = v.getUint32(4); depth = d[8]; type = d[9]; inter = d[12]; }
    else if (t === 'PLTE') pal = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    p += 12 + n;
  }
  if (depth !== 8 || inter) throw new Error(`PNG: only 8-bit, non-interlaced (this is ${depth}-bit, interlace ${inter})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (!ch) throw new Error(`PNG: colour type ${type}`);
  return { w, h, type, ch, pal, trns, idat };
}
// The IDAT chunks as one deflate stream, for the inflate.
export function concatBytes(list){
  const out = new Uint8Array(list.reduce((a, d) => a + d.length, 0));
  let o = 0; for (const d of list){ out.set(d, o); o += d.length; }
  return out;
}
// The inflated scanlines unfiltered, as RGBA.
export function pngPixels({ w, h, type, ch, pal, trns }, raw){
  const stride = w * ch;
  if (raw.length < (stride + 1) * h) throw new Error('PNG: image data ends early');
  const px = new Uint8Array(stride * h), out = new Uint8Array(4 * w * h);
  for (let y = 0; y < h; y++){
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let i = 0; i < stride; i++){
      const a = i >= ch ? px[o + i - ch] : 0, b = y ? px[o - stride + i] : 0, c = i >= ch && y ? px[o - stride + i - ch] : 0;
      let v = src[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4){ const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[o + i] = v;
    }
  }
  for (let i = 0; i < w * h; i++){
    const s = i * ch, o = 4 * i;
    if (type === 3){ const k = px[s]; out[o] = pal[3 * k]; out[o + 1] = pal[3 * k + 1]; out[o + 2] = pal[3 * k + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
    else if (ch <= 2){ out[o] = out[o + 1] = out[o + 2] = px[s]; out[o + 3] = ch === 2 ? px[s + 1] : 255; }
    else { out[o] = px[s]; out[o + 1] = px[s + 1]; out[o + 2] = px[s + 2]; out[o + 3] = ch === 4 ? px[s + 3] : 255; }
  }
  return { w, h, rgba: out };
}

/* ---- glTF binary ---------------------------------------------------------------------
   Every triangle primitive of every mesh the default scene reaches, through the
   nodes' matrices or TRS, with TEXCOORD_0 and its material's base colour (the
   texture times the factor). Images embedded, in a data: URI, or beside the
   file (the caller finds those: `uri` is set and `bytes` null). */
const mat4 = n => {
  if (n.matrix) return n.matrix.slice();
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
          2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
          2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0, tx, ty, tz, 1];
};
const mul = (A, B) => { const C = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) C[4 * c + r] += A[4 * k + r] * B[4 * c + k]; return C; };
// The container: its JSON chunk, parsed, and its binary chunk.
export function parseGlb(bytes){
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 12 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('not a glTF binary (.glb)');
  let o = 12, J = null, BIN = null;
  while (o + 8 <= b.length){ const n = dv.getUint32(o, true), t = dv.getUint32(o + 4, true), d = b.subarray(o + 8, o + 8 + n); if (t === 0x4e4f534a) J = JSON.parse(new TextDecoder().decode(d)); else if (t === 0x004e4942) BIN = d; o += 8 + n; }
  if (!J) throw new Error('a .glb with no JSON chunk');
  return { J, BIN };
}
const viewBytes = (J, BIN, i) => { const v = J.bufferViews[i]; return BIN.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength); };
function dataUri(uri){
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri ?? '');
  if (!m) return null;
  if (!m[2]) return new TextEncoder().encode(decodeURIComponent(m[3]));
  const s = atob(m[3]), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
// Each image's bytes, not decoded: decoding is the platform's (PNG and JPEG).
export const glbImages = (J, BIN) => (J.images ?? []).map(im => {
  const bytes = im.bufferView != null ? viewBytes(J, BIN, im.bufferView) : dataUri(im.uri);
  return { name: im.name ?? im.uri ?? '', mimeType: im.mimeType ?? null, uri: bytes ? null : im.uri ?? null, bytes };
});
// The triangles, given each image decoded ({ w, h, rgba }, or null for one skipped).
export function glbMesh(J, BIN, images){
  const accessor = i => {
    const a = J.accessors[i], k = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[a.type], v = J.bufferViews[a.bufferView];
    const T = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
    const stride = v.byteStride || k * T.BYTES_PER_ELEMENT, base = BIN.byteOffset + (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    const dv = new DataView(BIN.buffer), out = new Float64Array(a.count * k);
    const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
    for (let e = 0; e < a.count; e++) for (let c = 0; c < k; c++) out[e * k + c] = dv[get](base + e * stride + c * T.BYTES_PER_ELEMENT, true);
    if (a.normalized){ const m = { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[a.componentType]; for (let i = 0; i < out.length; i++) out[i] /= m; }
    return out;
  };
  const materials = (J.materials ?? []).map(m => {
    const p = m.pbrMetallicRoughness ?? {}, t = p.baseColorTexture;
    return { name: m.name, factor: p.baseColorFactor ?? [1, 1, 1, 1], image: t ? images[J.textures[t.index].source] ?? null : null,
             mask: m.alphaMode === 'MASK', cutoff: m.alphaCutoff ?? 0.5 };
  });
  const P = [], UV = [], MAT = [], CO = [];
  let coloured = false;
  const visit = (ni, M) => {
    const n = J.nodes[ni], W = mul(M, mat4(n));
    if (n.mesh != null) for (const pr of J.meshes[n.mesh].primitives){
      if ((pr.mode ?? 4) !== 4) continue;
      const pos = accessor(pr.attributes.POSITION), uv = pr.attributes.TEXCOORD_0 != null ? accessor(pr.attributes.TEXCOORD_0) : null;
      const idx = pr.indices != null ? accessor(pr.indices) : Float64Array.from({ length: pos.length / 3 }, (_, i) => i);
      // COLOR_0 multiplies the base colour (glTF 2.0 §3.9.2), RGB or RGBA.
      const col = pr.attributes.COLOR_0 != null ? accessor(pr.attributes.COLOR_0) : null, cw = col ? (J.accessors[pr.attributes.COLOR_0].type === 'VEC4' ? 4 : 3) : 0;
      if (col) coloured = true;
      for (const i of idx){
        const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2];
        P.push(W[0] * x + W[4] * y + W[8] * z + W[12], W[1] * x + W[5] * y + W[9] * z + W[13], W[2] * x + W[6] * y + W[10] * z + W[14]);
        UV.push(uv ? uv[2 * i] : 0, uv ? uv[2 * i + 1] : 0);
        CO.push(col ? col[cw * i] : 1, col ? col[cw * i + 1] : 1, col ? col[cw * i + 2] : 1, col && cw === 4 ? col[cw * i + 3] : 1);
      }
      for (let t = 0; t < idx.length / 3; t++) MAT.push(pr.material ?? -1);
    }
    for (const c of n.children ?? []) visit(c, W);
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const ni of J.scenes[J.scene ?? 0].nodes) visit(ni, I);
  return { P: Float64Array.from(P), UV: Float64Array.from(UV), MAT: Int32Array.from(MAT), CO: coloured ? Float32Array.from(CO) : null,
           materials, images, generator: J.asset?.generator, instances: J.nodes.filter(n => n.mesh != null).length, meshes: J.meshes.length };
}

/* ---- the asset, prepared ---------------------------------------------------------------
   Welded vertices, components, each one's chain boundary and caps, solid or
   surface, and the fit into a world of side 2^D (the sketch's: centred in x and
   z, on the floor plus 4%, 92% of the side, nudged off the grid). */
export function analyse(G){
  const nt = G.MAT.length, key = new Map(), V = [], tv = new Int32Array(3 * nt);
  for (let i = 0; i < 3 * nt; i++){
    const k = `${G.P[3 * i]},${G.P[3 * i + 1]},${G.P[3 * i + 2]}`;
    let v = key.get(k); if (v === undefined){ v = V.length / 3; key.set(k, v); V.push(G.P[3 * i], G.P[3 * i + 1], G.P[3 * i + 2]); }
    tv[i] = v;
  }
  const nv = V.length / 3, par = Int32Array.from({ length: nv }, (_, i) => i);
  const find = i => { while (par[i] !== i) i = par[i] = par[par[i]]; return i; };
  for (let t = 0; t < nt; t++){ par[find(tv[3 * t])] = find(tv[3 * t + 1]); par[find(tv[3 * t + 1])] = find(tv[3 * t + 2]); }
  // Signed uses of each edge: +1 along (lo → hi), −1 against.
  const net = new Map(), uses = new Map();
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++){
    const a = tv[3 * t + e], b = tv[3 * t + (e + 1) % 3], k = Math.min(a, b) * nv + Math.max(a, b);
    net.set(k, (net.get(k) ?? 0) + (a < b ? 1 : -1)); uses.set(k, (uses.get(k) ?? 0) + 1);
  }
  const comps = new Map(), C = r => { if (!comps.has(r)) comps.set(r, { tris: [], area: 0, lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], bnd: [], open: 0, nonManifold: 0 }); return comps.get(r); };
  const pt = v => [V[3 * v], V[3 * v + 1], V[3 * v + 2]], sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let t = 0; t < nt; t++){
    const c = C(find(tv[3 * t])), a = pt(tv[3 * t]), b = pt(tv[3 * t + 1]), d = pt(tv[3 * t + 2]);
    c.tris.push(t); c.area += Math.hypot(...crs(sub(b, a), sub(d, a))) / 2;
    for (const p of [a, b, d]) for (let k = 0; k < 3; k++){ c.lo[k] = Math.min(c.lo[k], p[k]); c.hi[k] = Math.max(c.hi[k], p[k]); }
  }
  for (const [k, s] of net){
    const lo = Math.floor(k / nv), hi = k % nv, c = C(find(lo)), u = uses.get(k);
    if (u === 1) c.open++; else if (u > 2) c.nonManifold++;
    // The chain's boundary: |s| copies of the edge, in the direction it's used more.
    for (let j = 0; j < Math.abs(s); j++) c.bnd.push(s > 0 ? [lo, hi] : [hi, lo]);
  }
  // Caps: per connected group of boundary edges, a cone from its centroid,
  // each triangle (apex, b, a) for a boundary edge a → b, so the edges cancel.
  for (const c of comps.values()){
    const at = new Map(); for (const [a, b] of c.bnd){ for (const v of [a, b]){ if (!at.has(v)) at.set(v, []); } at.get(a).push(b); at.get(b).push(a); }
    const seen = new Set(); c.caps = []; c.loops = 0; c.capArea = 0;
    for (const s of at.keys()){
      if (seen.has(s)) continue;
      const group = new Set([s]), st = [s]; seen.add(s);
      while (st.length){ const u = st.pop(); for (const w of at.get(u)) if (!seen.has(w)){ seen.add(w); group.add(w); st.push(w); } }
      const apex = [0, 0, 0]; for (const v of group){ const p = pt(v); for (let k = 0; k < 3; k++) apex[k] += p[k] / group.size; }
      c.loops++;
      for (const [a, b] of c.bnd) if (group.has(a)){ const T = [apex, pt(b), pt(a)]; c.caps.push(T); c.capArea += Math.hypot(...crs(sub(T[1], T[0]), sub(T[2], T[0]))) / 2; }
    }
    // Capped, the component is a cycle: its signed volume no longer depends on the origin.
    let vol = 0;
    const tet = (a, b, d) => (a[0] * (b[1] * d[2] - b[2] * d[1]) - a[1] * (b[0] * d[2] - b[2] * d[0]) + a[2] * (b[0] * d[1] - b[1] * d[0])) / 6;
    for (const t of c.tris) vol += tet(pt(tv[3 * t]), pt(tv[3 * t + 1]), pt(tv[3 * t + 2]));
    for (const T of c.caps) vol += tet(...T);
    const box = c.hi.reduce((p, h, k) => p * Math.max(h - c.lo[k], 1e-12), 1);
    c.vol = vol; c.solid = Math.abs(vol) >= 0.01 * box && c.capArea < 0.05 * c.area;
    c.sign = vol < 0 ? -1 : 1;
  }
  return { nt, nv, tv, V, comps: [...comps.values()].sort((a, b) => b.tris.length - a.tris.length) };
}
export function place(G, A, D){
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < A.nv; i++) for (let k = 0; k < 3; k++){ lo[k] = Math.min(lo[k], A.V[3 * i + k]); hi[k] = Math.max(hi[k], A.V[3 * i + k]); }
  const side = 2 ** D, s = 0.92 * side / Math.max(...hi.map((h, k) => h - lo[k]));
  const off = [0, 1, 2].map(a => (a === 1 ? 0.04 * side : (side - (hi[a] - lo[a]) * s) / 2) - lo[a] * s + 0.0137 * Math.SQRT2 * (a + 1));
  const X = p => p.map((c, a) => c * s + off[a]);
  const tris = [], caps = [];
  for (const c of A.comps){
    for (const t of c.tris) tris.push({ t, closed: c.solid ? c.sign : 0 });
    if (c.solid) for (const T of c.caps) caps.push({ T, closed: c.sign });
  }
  const n = tris.length + caps.length, V0 = new Float64Array(3 * n), E1 = new Float64Array(3 * n), E2 = new Float64Array(3 * n);
  const closed = new Int8Array(n), cap = new Uint8Array(n), src = new Int32Array(n).fill(-1);
  const put = (i, a, b, d) => { for (let k = 0; k < 3; k++){ V0[3 * i + k] = a[k]; E1[3 * i + k] = b[k] - a[k]; E2[3 * i + k] = d[k] - a[k]; } };
  tris.forEach(({ t, closed: cl }, i) => { put(i, ...[0, 1, 2].map(e => X([A.V[3 * A.tv[3 * t + e]], A.V[3 * A.tv[3 * t + e] + 1], A.V[3 * A.tv[3 * t + e] + 2]]))); closed[i] = cl; src[i] = t; });
  caps.forEach(({ T, closed: cl }, j) => { const i = tris.length + j; put(i, ...T.map(X)); closed[i] = cl; cap[i] = 1; });
  const at = [lo.map((v, a) => v * s + off[a]), hi.map((v, a) => v * s + off[a])];
  return { n, V0, E1, E2, closed, cap, src, side, scale: s, off, lo: at[0], hi: at[1] };
}

/* ---- the bake: colour, and alpha for cutouts ---------------------------------------------
   A voxel's colour: the nearest asset triangle (caps have no texture) to its
   centre, the UV there, and the texture averaged over the voxel's footprint
   in texels (a box filter: one texel per voxel would alias at D = 8, where a
   voxel covers ~16 texels of a 4K map), times the vertex colour and the
   material's factor. Nearest is found in a grid of triangles, searched in
   growing shells.

   Alpha cutouts (colororgeneralfields §5): a MASK material's triangle makes a
   surface voxel only where that same filtered alpha reaches its cutoff, so a
   foliage card voxelizes as its leaves, not its quad. That's M.keep, which
   mesh-core's build and its dense oracle both ask. Without it the level's
   treeline cards came out as black rectangles. */
export function texelsPerVoxel(G, M){
  const out = new Float64Array(M.n);
  for (let i = 0; i < M.n; i++){
    const t = M.src[i]; if (t < 0) continue;
    const m = G.materials[G.MAT[t]]; if (!m?.image) continue;
    const u = [0, 1, 2].map(e => G.UV[6 * t + 2 * e]), v = [0, 1, 2].map(e => G.UV[6 * t + 2 * e + 1]);
    const uvA = Math.abs((u[1] - u[0]) * (v[2] - v[0]) - (u[2] - u[0]) * (v[1] - v[0])) / 2 * m.image.w * m.image.h;
    const o = 3 * i, e1 = [M.E1[o], M.E1[o + 1], M.E1[o + 2]], e2 = [M.E2[o], M.E2[o + 1], M.E2[o + 2]];
    const wA = Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]) / 2;
    out[i] = wA > 0 ? Math.sqrt(uvA / wA) : 1;
  }
  return out;
}
export function triangleGrid(M, cell){
  const g = Math.ceil(M.side / cell), bins = new Map();
  for (let i = 0; i < M.n; i++){
    if (M.src[i] < 0) continue;
    const o = 3 * i, lo = [], hi = [];
    for (let k = 0; k < 3; k++){ const a = M.V0[o + k], b = a + M.E1[o + k], c = a + M.E2[o + k]; lo.push(Math.max(0, Math.floor(Math.min(a, b, c) / cell))); hi.push(Math.min(g - 1, Math.floor(Math.max(a, b, c) / cell))); }
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++){ const k = x + g * (y + g * z); if (!bins.has(k)) bins.set(k, []); bins.get(k).push(i); }
  }
  return { g, cell, bins };
}
// [r, g, b] in 0–255 (sRGB) and alpha in 0–1, for triangle i at barycentrics b.
export function sampler(G, M){
  const tpv = texelsPerVoxel(G, M), toSrgb = v => Math.pow(Math.max(0, v), 1 / 2.2);
  return (i, b) => {
    const t = M.src[i], m = G.materials[G.MAT[t]], f = m?.factor ?? [1, 1, 1, 1];
    const vc = [1, 1, 1, 1];
    if (G.CO) for (let k = 0; k < 4; k++) vc[k] = b[0] * G.CO[12 * t + k] + b[1] * G.CO[12 * t + 4 + k] + b[2] * G.CO[12 * t + 8 + k];
    // Factors and vertex colours are linear, texels sRGB: the product is taken in sRGB, near enough here.
    const mulRGB = [0, 1, 2].map(k => toSrgb(f[k] * vc[k])), mulA = f[3] * vc[3];
    if (!m?.image) return [255 * mulRGB[0], 255 * mulRGB[1], 255 * mulRGB[2], mulA];
    const u = b[0] * G.UV[6 * t] + b[1] * G.UV[6 * t + 2] + b[2] * G.UV[6 * t + 4];
    const v = b[0] * G.UV[6 * t + 1] + b[1] * G.UV[6 * t + 3] + b[2] * G.UV[6 * t + 5];
    const { w, h, rgba } = m.image, n = Math.max(1, Math.min(32, Math.round(tpv[i])));
    // At most 6 × 6 texels, spread evenly over the footprint: all n² of them
    // (up to 1,024) made the level's previews 10× slower for no visible gain.
    const cx = Math.floor((u - Math.floor(u)) * w), cy = Math.floor((v - Math.floor(v)) * h), sum = [0, 0, 0, 0];
    const ns = Math.min(n, 6), st = n / ns;
    for (let j = 0; j < ns; j++) for (let q = 0; q < ns; q++){
      const X = ((cx + Math.floor((q + 0.5) * st) - (n >> 1)) % w + w) % w, Y = ((cy + Math.floor((j + 0.5) * st) - (n >> 1)) % h + h) % h, o = 4 * (X + w * Y);
      sum[0] += rgba[o]; sum[1] += rgba[o + 1]; sum[2] += rgba[o + 2]; sum[3] += rgba[o + 3];
    }
    const nn = ns * ns;
    return [sum[0] / nn * mulRGB[0], sum[1] / nn * mulRGB[1], sum[2] / nn * mulRGB[2], sum[3] / nn / 255 * mulA];
  };
}
export function cutouts(G, M, sample){
  if (!G.materials.some(m => m.mask)) return null;
  const bary = [0, 0, 0];
  return (i, p) => {
    const t = M.src[i]; if (t < 0) return true;
    const m = G.materials[G.MAT[t]]; if (!m?.mask) return true;
    closestOnTri(M, i, p, bary);
    return sample(i, bary)[3] >= m.cutoff;
  };
}
export function baker(G, M, sample){
  const grid = triangleGrid(M, Math.max(8, M.side / 64)), bary = [0, 0, 0], best = [0, 0, 0];
  return (x, y, z) => {
    const p = [x + 0.5, y + 0.5, z + 0.5], c = p.map(v => Math.floor(v / grid.cell));
    let bi = -1, bd = Infinity;
    for (let r = 0; r <= 3 && (bi < 0 || r <= 1); r++){
      for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++){
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const X = c[0] + dx, Y = c[1] + dy, Z = c[2] + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= grid.g || Y >= grid.g || Z >= grid.g) continue;
        for (const i of grid.bins.get(X + grid.g * (Y + grid.g * Z)) ?? []){
          // A cutout card's clear texels made no voxel, so they don't colour one either.
          if (M.keep && !M.keep(i, p)) continue;
          // Ties to the lowest triangle index, so the rule needs no search
          // order: bakeSkin's walk is held to this, word for word.
          const d = closestOnTri(M, i, p, bary);
          if (d < bd || (d === bd && i < bi)){ bd = d; bi = i; best[0] = bary[0]; best[1] = bary[1]; best[2] = bary[2]; }
        }
      }
    }
    return bi < 0 ? [255, 0, 255] : sample(bi, best);
  };
}

/* ---- the skin and its words (docs/glb-colour-plan.md step 1) ----------------------------
   The skin is the voxels that get a baked word. It must hold every voxel
   that can show, and it is a bit DAG in the shape's store, so a voxel's
   word is words[rank], its rank being its place in the skin's Morton order
   (children 0–7, bit 0 x, bit 1 y, bit 2 z: what store.child and fromField
   mean by an octant).

   It is the union of two sets:
     touched  every voxel an asset triangle touches (triBox over the voxel),
              cutouts kept (M.keep). label-mesh.mjs's skin, plus keep. In
              conservative mode every shape voxel that isn't inside is
              touched, and an inside voxel beside an empty one has the
              surface between their centres, which touches one of the two;
              if it's an asset triangle touching the empty one, that one
              would be filled. So an asset triangle touches the inside one.
     near     the shape's voxels within half a voxel of a hole's cap (their
              box grown to half-side 1). The argument above fails at a cap,
              which decides inside but never makes a voxel: the crossing
              can sit in the empty voxel's half of the segment. That half
              lies in the inside voxel's box grown by 0.5. Found on the
              Halloween pack, where the touched set alone missed 3 shown
              voxels of 105,812 at D = 8 (glb-colour-log §1).
   One gap is left: a closed shell with an alpha cutout material, whose
   clear texels make no voxel yet still bound the inside. No asset here has
   one. mesh-vdag.mjs checks the claim on every lod-0 record at every
   depth (shownOutside), so a gap shows up as a count, not a wrong word. */
const assetCount = M => {
  let nA = 0; while (nA < M.n && M.src[nA] >= 0) nA++;
  for (let i = nA; i < M.n; i++) if (M.src[i] >= 0) throw new Error('place() no longer puts caps last');
  return nA;
};
export function skinOf(M, D, store, shapeRoot){
  const t0 = performance.now(), nA = assetCount(M), nc = M.n - nA;
  const touched = voxelize({ n: nA, V0: M.V0, E1: M.E1, E2: M.E2, closed: new Int8Array(nA), side: M.side, keep: M.keep }, D, 'conservative', store).root;
  let near = EMPTY;
  if (nc){
    // voxelize's narrowing, over the caps alone, with every box grown by 0.5.
    const lists = Array.from({ length: D + 2 }, () => new Int32Array(nc)), lens = new Int32Array(D + 2), c = [0, 0, 0];
    for (let j = 0; j < nc; j++) lists[D + 1][j] = nA + j;
    lens[D + 1] = nc;
    near = store.fromField(D, (k, x, y, z) => {
      const P = lists[k + 1], np = lens[k + 1], out = lists[k], s = 2 ** k, h = s / 2, g = (h + 0.5) * (1 + 1e-9) + 1e-9;
      c[0] = x * s + h; c[1] = y * s + h; c[2] = z * s + h;
      let n = 0;
      for (let j = 0; j < np; j++) if (triBox(M, P[j], c, g)) out[n++] = P[j];
      lens[k] = n;
      if (!n) return 0;
      return k === 0 ? store.query(shapeRoot, D, x, y, z) : 2;
    }).root;
  }
  return { root: store.union(touched, near), touched, near, ms: performance.now() - t0 };
}
// The same set on a dense grid, with nothing shared but triBox and keep.
export function skinOracle(M, D, shape){
  const R = 2 ** D, occ = new Uint8Array(R ** 3), c = [0, 0, 0];
  for (let i = 0; i < M.n; i++){
    const cap = M.src[i] < 0, h = cap ? 1 : 0.5, o = 3 * i;
    const b = a => { const v = [M.V0[o + a], M.V0[o + a] + M.E1[o + a], M.V0[o + a] + M.E2[o + a]]; return [Math.max(0, Math.floor(Math.min(...v)) - 2), Math.min(R - 1, Math.floor(Math.max(...v)) + 2)]; };
    const [x0, x1] = b(0), [y0, y1] = b(1), [z0, z1] = b(2);
    for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++){
      const v = x + R * (y + R * z);
      if (occ[v]) continue;
      c[0] = x + 0.5; c[1] = y + 0.5; c[2] = z + 0.5;
      if (!triBox(M, i, c, h * (1 + 1e-9) + 1e-9)) continue;
      if (cap ? shape[v] : !M.keep || M.keep(i, c)) occ[v] = 1;
    }
  }
  return occ;
}

/* The words: one per skin voxel, in rank order, each the baker's colour as
   rgb8 (8 bits a channel, r | g << 8 | b << 16, the high byte 0 and kept for
   a material, E4). baker's search per voxel was 24–72 µs on the three assets
   at D = 8: 45 minutes for the pack's 36M skin voxels at D = 12. So this
   walks the skin top down carrying the asset triangles that can be nearest
   to some point of the cell: those within best + 2h√3 of its centre, best
   being the nearest's distance there (label-mesh.mjs's narrowing). At a
   voxel the list's first strict minimum is the nearest, and the list keeps
   index order, so ties go to the lowest index, as baker's do.
   With cutouts, the nearest kept triangle can lie outside the list (keep is
   a test at a point, so it can't narrow a cell). When the list's nearest
   isn't kept there, the voxel asks baker itself: `fellBack` counts those.

   Where the walk starts (docs/convert.md §PLY, question 2, 2026-11-18). From
   the root, every triangle is tested at the root, then at each of its
   children, and so on until the cells are small enough to narrow: 8^k
   cells a level times nearly every triangle, which is nothing at a game
   asset's 20–100K triangles and was 82 s of a 1.8M-triangle scan's bake
   at D = 8 and 10. So by default (`start: 'grid'`) the walk only descends
   above level g = max(3, D − 6) (cells of side/64, at least 8, baker's
   grid), and each skin cell at level g takes its list from a triangle grid
   of that side: the triangles within best + 2h√3 of its centre, rings of
   bins outward until no farther bin can hold one (a bin r rings out is at
   least (r − ½)·side from the centre). That is the list the walk would
   have handed it, by the same bound: the walk's list at a cell is every
   triangle within its own bound, kept because the parent's bound is
   looser. Same list, same index order, so the same words, bit for bit;
   test/convert-core.test.js holds the two starts to each other.
   `start: 'root'` is the walk as it was. */
export function bakeSkin(G, M, sample, store, skin, D, slow, { start = 'grid' } = {}){
  const t0 = performance.now(), nA = assetCount(M), R3 = Math.sqrt(3);
  const total = createCounts(store).of(skin), words = new Uint32Array(total);
  const lists = Array.from({ length: D + 2 }, () => new Int32Array(nA)), lens = new Int32Array(D + 2);
  for (let i = 0; i < nA; i++) lists[D + 1][i] = i;
  lens[D + 1] = nA;
  const dist = new Float64Array(nA), bary = [0, 0, 0], p = [0, 0, 0];
  let r = 0, tests = 0, fellBack = 0;
  const g = start === 'grid' ? Math.min(D, Math.max(3, D - 6)) : D + 1, inset = start === 'grid' ? 0.5 : 0;
  const near = g <= D ? cellLists(M, nA, g, lists[g + 1], lens, dist, bary, p) : null;
  const rec = (k, x, y, z, id) => {
    if (id === EMPTY) return;
    if (k > g){
      for (let o = 0; o < 8; o++) rec(k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2), store.child(id, o));
      return;
    }
    if (k === g) tests += near(x, y, z);
    const P = lists[k + 1], np = lens[k + 1], s = 2 ** k, h = s / 2;
    p[0] = x * s + h; p[1] = y * s + h; p[2] = z * s + h;
    let best = Infinity, bi = -1;
    for (let j = 0; j < np; j++){
      const d = closestOnTri(M, P[j], p, bary);
      dist[j] = d; tests++;
      if (d < best){ best = d; bi = P[j]; }
    }
    if (k === 0){
      let c;
      if (M.keep && !M.keep(bi, p)){ c = slow(x, y, z); fellBack++; }
      else { closestOnTri(M, bi, p, bary); c = sample(bi, bary); }
      words[r++] = rgb8(c[0], c[1], c[2]);
      return;
    }
    const lim = Math.sqrt(best) + 2 * (h - inset) * R3 + 1e-9 * s, out = lists[k];
    let n = 0;
    for (let j = 0; j < np; j++) if (Math.sqrt(dist[j]) <= lim) out[n++] = P[j];
    lens[k] = n;
    for (let o = 0; o < 8; o++) rec(k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2), store.child(id, o));
  };
  rec(D, 0, 0, 0, skin);
  if (r !== total) throw new Error(`bakeSkin: ${r} words for ${total} skin voxels`);
  return { words, tests, fellBack, ms: performance.now() - t0 };
}
/* The list a level-g cell starts with, written into `out` (lens[g + 1] its
   length), in index order: every asset triangle within best + 2h√3 of the
   cell's centre. Bins of the cell's own side, so a cell is one bin; a
   triangle is in every bin its box meets, so a bin r rings out holds
   nothing nearer the centre than (r − ½)·side. Returns the tests made. */
function cellLists(M, nA, g, out, lens, dist, bary, p){
  const side = 2 ** g, h = side / 2, n = Math.ceil(M.side / side), bins = new Map(), R3 = Math.sqrt(3);
  for (let i = 0; i < nA; i++){
    const o = 3 * i, lo = [], hi = [];
    for (let k = 0; k < 3; k++){ const a = M.V0[o + k], b = a + M.E1[o + k], c = a + M.E2[o + k]; lo.push(Math.max(0, Math.floor(Math.min(a, b, c) / side))); hi.push(Math.min(n - 1, Math.floor(Math.max(a, b, c) / side))); }
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++){ const k = x + n * (y + n * z); let b = bins.get(k); if (!b) bins.set(k, b = []); b.push(i); }
  }
  const seen = new Int32Array(nA).fill(-1), got = [];
  let cell = 0;
  return (x, y, z) => {
    cell++;
    got.length = 0;
    p[0] = x * side + h; p[1] = y * side + h; p[2] = z * side + h;
    let best = Infinity, tests = 0;
    // Rings outward: until one holds a triangle, then until no farther ring can hold one within the bound.
    for (let r = 0; r < n; r++){
      if (best < Infinity && (r - 0.5) * side > Math.sqrt(best) + 2 * (h - 0.5) * R3 + 1e-9 * side) break;
      for (let dz = -r; dz <= r; dz++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++){
        if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= n || Y >= n || Z >= n) continue;
        const b = bins.get(X + n * (Y + n * Z));
        if (b) for (const i of b){
          if (seen[i] === cell) continue;
          seen[i] = cell;
          const d = closestOnTri(M, i, p, bary);
          tests++;
          dist[i] = d; got.push(i);
          if (d < best) best = d;
        }
      }
    }
    const lim = Math.sqrt(best) + 2 * (h - 0.5) * R3 + 1e-9 * side;
    let m = 0;
    for (const i of got) if (Math.sqrt(dist[i]) <= lim) out[m++] = i;
    out.subarray(0, m).sort();
    lens[g + 1] = m;
    return tests;
  };
}

/* ---- previews ----------------------------------------------------------------------------
   Orthographic, one pixel a column of voxels (every 2^(D−10)th past D = 10):
   the first solid voxel along the view axis, by a walk down the DAG that keeps
   to the column and tries the near child first. Shaded by the depth image's
   slope, coloured by the bake. */
export function firstAlong(store, root, D, ax, u, v, U, Vax){
  // Coordinates on the two other axes are fixed; walk the view axis from the high end.
  const walk = (id, k, w0) => {
    if (id === EMPTY) return -1;
    if (k === 0) return w0;
    const h = k - 1, bu = (u >> h) & 1, bv = (v >> h) & 1;
    for (const bw of [1, 0]){
      const o = (bu << U) | (bv << Vax) | (bw << ax);
      const r = walk(store.child(id, o), h, 2 * w0 + bw);
      if (r >= 0) return r;
    }
    return -1;
  };
  return walk(root, D, 0);
}
// Each view: the axis looked down (from its high end), the image's right and
// down axes, and whether they run against the world's. front: from +z, right
// +x, up +y. side: from +x, right −z, up +y. top: from +y, right +x, down +z.
export const VIEWS = { front: { ax: 2, U: 0, Vax: 1, flipU: false, flipV: true }, side: { ax: 0, U: 2, Vax: 1, flipU: true, flipV: true },
                top: { ax: 1, U: 0, Vax: 2, flipU: false, flipV: false } };

/* ---- one depth, built -------------------------------------------------------------------
   The asset placed in a world of side 2^D, its shape, and (conservative mode,
   unless `bake` is false) its skin and the skin's words. The store grows in
   this order and no other: shape, skin, the union that says the skin lies in
   the shape, then nothing (the words are an array). mesh-vdag.mjs runs its
   checks after this; anything that interned between these steps would move
   the ids, and with them the file's bytes. `stage(name)` is called before
   each step, for a page's progress. */
export function bakeDepth(G, A, D, { mode = 'conservative', bake = true, stage = () => {}, colour = null } = {}){
  stage('shape');
  const M = place(G, A, D), sample = sampler(G, M);
  M.keep = cutouts(G, M, sample);
  const b = voxelize(M, D, mode);
  if (mode !== 'conservative' || !bake) return { M, sample, b, sk: null, slow: null, W: null };
  stage('skin');
  const st = b.store, sk = skinOf(M, D, st, b.root);
  if (st.union(b.root, sk.root) !== b.root) throw new Error(`D = ${D}: the skin isn't inside the shape`);
  stage('words');
  // `colour(M, store, skin, D, slow)` makes the words some other way (a PLY scan's vertices, convert.md §PLY), after the same three steps.
  const slow = baker(G, M, sample), W = colour ? colour(M, st, sk.root, D, slow) : bakeSkin(G, M, sample, st, sk.root, D, slow);
  return { M, sample, b, sk, slow, W };
}
/* The view a file opens on. In front of the asset (+z), looking back along −z
   at the middle of its box, far enough to see all of it: level with a tall
   asset, from above (0.45 rad) a flat one such as a level. (A level at the
   tall asset's distance was a speck on screen, all coarse lods.) */
export function assetView(M){
  const e = M.hi.map((v, a) => v - M.lo[a]), c = M.lo.map((v, a) => v + e[a] / 2);
  const tall = e[1] >= 0.5 * Math.max(e[0], e[2]), elev = tall ? 0.05 : 0.5, dist = tall ? 1.55 * Math.max(e[0], e[1]) + e[2] / 2 : 0.8 * Math.max(e[0], e[2]);
  return { eye: [c[0], c[1] + dist * Math.sin(elev), c[2] + dist * Math.cos(elev)], yaw: Math.PI, pitch: -elev };
}
