/* A real game asset (glTF binary) to world files: docs/colororgeneralfields.md
   §3, with an asset in place of the sketch's stand-ins. Not the engine.

     node experiments/mesh-vdag.mjs <asset.glb> [--D=8,10,12] [--mode=conservative|centres] [--out=dir] [--name=…]

   Writes <out>/<name>-d<D>.vdag for each D (one world each, shape only) and
   <out>/<name>-d<D>-front.png, -side.png: the voxels seen along −z and −x,
   each coloured from the asset's base-colour texture by the nearest triangle,
   which is what a baked word would hold. <out> defaults to the asset's folder
   (the folder above it if the .glb sits in one called source/).

   Why the files carry no colour: a world file's colour is a name resolved by
   colours.js (vdag-core.js's header), and baked words aren't in the format
   yet (binaryoutput §6; colororgeneralfields §4 and §7). The previews show
   what the bake gives, so the format question can be decided against a real
   asset.

   What a real asset brought that the stand-ins didn't (the first one tried:
   21,333 triangles from Blender's glTF exporter):
     1. Vertices split at UV seams. Welded by exact position first, or every
        seam is a boundary edge and the whole body is "open".
     2. Holes. The body had 25 small boundary loops (the largest 2% of its
        height) and 16 non-manifold edges, so the sketch's rule (a boundary
        edge makes a component surface only) made it a hollow shell. Here a
        component is capped instead: the edges whose signed uses don't cancel
        are its boundary as a chain, each connected group of them gets a cone
        from its centroid, and body + caps is then a cycle, whose crossing
        count is path independent, so the winding number is exact again. A cap
        decides what's inside but is never drawn as surface (M.cap in
        mesh-core.mjs). This is the flat patch a modeller would put over the
        hole; the generalized winding number would fill it more smoothly.
     3. Decals: small flat pieces (zero volume) laid on the body. A component
        is solid only if, capped, its volume is at least 1% of its own box's
        and its caps are under 5% of its area; anything else is surface only.
   The asset's up is +y and its front +z, as glTF and Blender export them. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createCounts, prune, EMPTY } from '../dag-core.js';
import { writeVdag, readVdag } from '../vdag-core.js';
import { voxelize, denseOracle, closestOnTri } from './mesh-core.mjs';

const args = process.argv.slice(2), opt = (k, d) => { const a = args.find(s => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const file = args.find(a => !a.startsWith('--'));
if (!file){ console.error('usage: node experiments/mesh-vdag.mjs <asset.glb> [--D=8,10,12] [--mode=conservative|centres] [--out=dir]'); process.exit(1); }
const DEPTHS = opt('D', '8,10,12').split(',').map(Number), MODE = opt('mode', 'conservative');
const dir = path.dirname(path.resolve(file)), OUT = path.resolve(opt('out', path.basename(dir) === 'source' ? path.dirname(dir) : dir));
// A generator's hash or UUID for a file name (Tripo's) says nothing: the
// asset's folder names it instead. --name= overrides both.
const BASE = path.basename(file).replace(/\.glb$/i, ''), HASHY = /^[0-9a-f-]{16,}$/i.test(BASE);
const NAME = opt('name', HASHY ? path.basename(OUT) : BASE);
const SLUG = NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fmt = (x, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const say = s => console.log(s);

/* ---- PNG, both ways (zlib is Node's) ----------------------------------------------
   Decode: 8-bit greyscale, grey + alpha, RGB, RGBA or palette, not interlaced:
   what exporters write for a base-colour texture. Anything else throws. */
function decodePng(buf){
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth = 0, type = 0, inter = 0, pal = null, trns = null; const idat = [];
  while (p < buf.length){
    const n = buf.readUInt32BE(p), t = buf.toString('latin1', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + n);
    if (t === 'IHDR'){ w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; type = d[9]; inter = d[12]; }
    else if (t === 'PLTE') pal = d;
    else if (t === 'tRNS') trns = d;
    else if (t === 'IDAT') idat.push(d);
    else if (t === 'IEND') break;
    p += 12 + n;
  }
  if (depth !== 8 || inter) throw new Error(`PNG: only 8-bit, non-interlaced (this is ${depth}-bit, interlace ${inter})`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type], raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch;
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
/* JPEG: no decoder here. The platform converts it to PNG: sips on macOS,
   ffmpeg wherever it's installed. Neither present, the image is skipped and
   its materials use their factor. (The third asset, from Tripo, was JPEG.) */
function decodeJpeg(bytes){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-vdag-')), jpg = path.join(dir, 'in.jpg'), png = path.join(dir, 'out.png');
  try {
    fs.writeFileSync(jpg, bytes);
    const tries = [['sips', ['-s', 'format', 'png', jpg, '--out', png]], ['ffmpeg', ['-loglevel', 'error', '-y', '-i', jpg, '-pix_fmt', 'rgb24', png]]];
    for (const [cmd, a] of tries){
      try { execFileSync(cmd, a, { stdio: 'ignore' }); if (fs.existsSync(png)) return decodePng(fs.readFileSync(png)); } catch {}
    }
    throw new Error('no JPEG converter (sips or ffmpeg) found');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function encodePng(w, h, rgb){
  const chunk = (t, d) => {
    const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length, 0); b.write(t, 4, 'latin1'); d.copy(b, 8);
    let c = -1; for (let i = 4; i < 8 + d.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8);
    b.writeUInt32BE((c ^ -1) >>> 0, 8 + d.length); return b;
  };
  const raw = Buffer.alloc((3 * w + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + 3 * w * y, 3 * w).copy(raw, y * (3 * w + 1) + 1);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* ---- glTF binary ---------------------------------------------------------------------
   Every triangle primitive of every mesh the default scene reaches, through the
   nodes' matrices or TRS, with TEXCOORD_0 and its material's base colour (the
   texture times the factor). Embedded or neighbouring PNGs. */
const mat4 = n => {
  if (n.matrix) return n.matrix.slice();
  const [qx, qy, qz, qw] = n.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = n.scale ?? [1, 1, 1], [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2 * (qy * qy + qz * qz)) * sx, 2 * (qx * qy + qz * qw) * sx, 2 * (qx * qz - qy * qw) * sx, 0,
          2 * (qx * qy - qz * qw) * sy, (1 - 2 * (qx * qx + qz * qz)) * sy, 2 * (qy * qz + qx * qw) * sy, 0,
          2 * (qx * qz + qy * qw) * sz, 2 * (qy * qz - qx * qw) * sz, (1 - 2 * (qx * qx + qy * qy)) * sz, 0, tx, ty, tz, 1];
};
const mul = (A, B) => { const C = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) C[4 * c + r] += A[4 * k + r] * B[4 * c + k]; return C; };
function readGlb(fileName){
  const b = fs.readFileSync(fileName);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error('not a glTF binary (.glb)');
  let o = 12, J = null, BIN = null;
  while (o < b.length){ const n = b.readUInt32LE(o), t = b.readUInt32LE(o + 4), d = b.subarray(o + 8, o + 8 + n); if (t === 0x4e4f534a) J = JSON.parse(d.toString()); else if (t === 0x004e4942) BIN = d; o += 8 + n; }
  const viewBytes = i => { const v = J.bufferViews[i]; return BIN.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength); };
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
  const images = (J.images ?? []).map((im, i) => {
    try {
      const bytes = im.bufferView != null ? Buffer.from(viewBytes(im.bufferView)) : fs.readFileSync(path.join(path.dirname(fileName), decodeURIComponent(im.uri)));
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return decodeJpeg(bytes);
      if (im.mimeType && im.mimeType !== 'image/png') throw new Error(`${im.mimeType} isn't decoded here`);
      return decodePng(bytes);
    } catch (e){ say(`- image ${i} (${im.name ?? im.uri ?? ''}) skipped: ${e.message}; its materials use their factor`); return null; }
  });
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
function analyse(G){
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
function place(G, A, D){
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
  return { n, V0, E1, E2, closed, cap, src, side, scale: s, lo: at[0], hi: at[1] };
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
function texelsPerVoxel(G, M){
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
function triangleGrid(M, cell){
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
function sampler(G, M){
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
function cutouts(G, M, sample){
  if (!G.materials.some(m => m.mask)) return null;
  const bary = [0, 0, 0];
  return (i, p) => {
    const t = M.src[i]; if (t < 0) return true;
    const m = G.materials[G.MAT[t]]; if (!m?.mask) return true;
    closestOnTri(M, i, p, bary);
    return sample(i, bary)[3] >= m.cutoff;
  };
}
function baker(G, M, sample){
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
          const d = closestOnTri(M, i, p, bary);
          if (d < bd){ bd = d; bi = i; best[0] = bary[0]; best[1] = bary[1]; best[2] = bary[2]; }
        }
      }
    }
    return bi < 0 ? [255, 0, 255] : sample(bi, best);
  };
}

/* ---- previews ----------------------------------------------------------------------------
   Orthographic, one pixel a column of voxels (every 2^(D−10)th past D = 10):
   the first solid voxel along the view axis, by a walk down the DAG that keeps
   to the column and tries the near child first. Shaded by the depth image's
   slope, coloured by the bake. */
function firstAlong(store, root, D, ax, u, v, U, Vax){
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
const VIEWS = { front: { ax: 2, U: 0, Vax: 1, flipU: false, flipV: true }, side: { ax: 0, U: 2, Vax: 1, flipU: true, flipV: true },
                top: { ax: 1, U: 0, Vax: 2, flipU: false, flipV: false } };
function preview(store, root, D, bake, view){
  const { ax, U, Vax, flipU, flipV } = VIEWS[view];
  const side = 2 ** D, step = Math.max(1, 2 ** (D - 10)), R = side / step, depth = new Float64Array(R * R).fill(-1), rgb = new Uint8Array(3 * R * R);
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++){
    const u = (flipU ? R - 1 - i : i) * step + (step >> 1), v = (flipV ? R - 1 - j : j) * step + (step >> 1);
    depth[i + R * j] = firstAlong(store, root, D, ax, u, v, U, Vax);
  }
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++){
    const d = depth[i + R * j], o = 3 * (i + R * j);
    if (d < 0){ rgb[o] = 238; rgb[o + 1] = 236; rgb[o + 2] = 232; continue; }
    const at = (a, b) => { const e = depth[Math.min(R - 1, Math.max(0, a)) + R * Math.min(R - 1, Math.max(0, b))]; return e < 0 ? d : e; };
    const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * step), gy = (at(i, j - 1) - at(i, j + 1)) / (2 * step);
    const n = [-gx, -gy, 1], l = Math.hypot(...n), lambert = Math.max(0, (-0.35 * n[0] + 0.45 * n[1] + 0.82 * n[2]) / l);
    const u = (flipU ? R - 1 - i : i) * step + (step >> 1), v = (flipV ? R - 1 - j : j) * step + (step >> 1);
    const p = [0, 0, 0]; p[ax] = d; p[U] = u; p[Vax] = v;
    const c = bake(p[0], p[1], p[2]), k = 0.45 + 0.6 * lambert;
    for (let q = 0; q < 3; q++) rgb[o + q] = Math.max(0, Math.min(255, Math.round(c[q] * k)));
  }
  return encodePng(R, R, rgb);
}

/* ---- run ------------------------------------------------------------------------------------ */
const t0 = performance.now(), G = readGlb(file), A = analyse(G);
say(`# ${NAME}\n`);
say(`${fmt(A.nt)} triangles (${G.meshes} meshes, ${G.instances} placed), ${fmt(A.nv)} vertices after welding, ${fmt(A.comps.length)} components${G.generator ? ` (${G.generator})` : ''}${G.CO ? ', vertex colours' : ''}.`);
say(`${G.materials.length} materials, ${G.materials.filter(m => m.image).length} textured (${[...new Set(G.materials.filter(m => m.image).map(m => `${m.image.w}²`))].join(', ')}), ${G.materials.filter(m => m.mask).length} alpha cutouts${G.materials.some(m => m.mask) ? ` (${G.materials.filter(m => m.mask).map(m => m.name).join(', ')})` : ''}.\n`);
say('| component | triangles | open edges | non-manifold | boundary loops | caps | cap area / area | volume / box | kind |');
say('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
// The largest dozen, then the rest in a line: a level has thousands.
A.comps.slice(0, 12).forEach((c, i) => {
  const box = c.hi.reduce((p, h, k) => p * Math.max(h - c.lo[k], 1e-12), 1);
  say(`| ${i + 1} | ${fmt(c.tris.length)} | ${c.open} | ${c.nonManifold} | ${c.loops} | ${c.caps.length} | ${fmt(100 * c.capArea / c.area, 2)}% | ${fmt(Math.abs(c.vol) / box, 3)} | ${c.solid ? (c.sign < 0 ? 'solid (inside out)' : 'solid') : 'surface'} |`);
});
if (A.comps.length > 12){
  const rest = A.comps.slice(12), solid = rest.filter(c => c.solid);
  say(`| ${fmt(rest.length)} more | ${fmt(rest.reduce((a, c) => a + c.tris.length, 0))} | ${fmt(rest.reduce((a, c) => a + c.open, 0))} | ${fmt(rest.reduce((a, c) => a + c.nonManifold, 0))} | | | | | ${fmt(solid.length)} solid, ${fmt(rest.length - solid.length)} surface |`);
}
say(`\nIn all: ${fmt(A.comps.filter(c => c.solid).length)} solid components (${fmt(A.comps.filter(c => c.solid).reduce((a, c) => a + c.tris.length, 0))} triangles), ${fmt(A.comps.filter(c => !c.solid).length)} surface only.`);
say(`\nMode: ${MODE}. Out: ${OUT}\n`);
say('| D | side | build s | nodes (pruned) | solid voxels | file | written s | read back | previews s |');
say('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const D of DEPTHS){
  const M = place(G, A, D), sample = sampler(G, M);
  M.keep = cutouts(G, M, sample);
  const b = voxelize(M, D, MODE);
  if (D === 8){
    const want = denseOracle(M, 8, MODE), got = b.store.expand(b.root, 8);
    let diff = 0; for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) diff++;
    if (diff) throw new Error(`D = 8: ${diff} voxels differ from the dense oracle`);
  }
  const { keys, map } = prune(b.store.snapshot().keys, [b.root]), root = map[b.root];
  // In front of the asset (+z), looking back along −z at the middle of its
  // box, far enough to see all of it: level with a tall asset, from above
  // (0.45 rad) a flat one such as a level.
  const side = M.side, e = M.hi.map((v, a) => v - M.lo[a]), c = M.lo.map((v, a) => v + e[a] / 2);
  // (A level at the tall asset's distance was a speck on screen, all coarse lods.)
  const tall = e[1] >= 0.5 * Math.max(e[0], e[2]), elev = tall ? 0.05 : 0.5, dist = tall ? 1.55 * Math.max(e[0], e[1]) + e[2] / 2 : 0.8 * Math.max(e[0], e[2]);
  const view = { eye: [c[0], c[1] + dist * Math.sin(elev), c[2] + dist * Math.cos(elev)], yaw: Math.PI, pitch: -elev };
  const t1 = performance.now();
  const bytes = await writeVdag([{ keys, root, D, name: `${NAME} (D = ${D})`, colour: null, view, source: null }]);
  const out = path.join(OUT, `${SLUG}-d${D}.vdag`);
  fs.writeFileSync(out, bytes);
  // Read back and written again: the writer's bytes depend only on the world,
  // so the same bytes mean the file holds this world, node for node.
  const t2 = performance.now(), { worlds: [back] } = await readVdag(bytes);
  const again = await writeVdag([{ keys: back.keys, root: back.root, D, name: back.name, colour: null, view: back.view, source: null }]);
  const voxels = createCounts(b.store).of(b.root), same = back.voxels === voxels && Buffer.compare(Buffer.from(again), Buffer.from(bytes)) === 0;
  const bake = baker(G, M, sample), store = b.store;
  for (const v of Object.keys(VIEWS)) fs.writeFileSync(path.join(OUT, `${SLUG}-d${D}-${v}.png`), preview(store, b.root, D, bake, v));
  const t3 = performance.now();
  say(`| ${D} | ${side} | ${fmt(b.ms / 1000, 1)} | ${fmt(keys.length / 9)} | ${fmt(voxels)} | ${fmt(bytes.length / 1024, 0)} KB | ${fmt((t2 - t1) / 1000, 1)} | ${same ? 'same' : '**differs**'} | ${fmt((t3 - t2) / 1000, 1)} |`);
}
if (DEPTHS.includes(8)) say(`\nD = 8 equals the dense oracle voxel for voxel (${MODE}).`);
say(`\n${fmt((performance.now() - t0) / 1000, 0)} s in all.`);
