/* PLY files to what the converter builds from (docs/convert.md §PLY, asked
   for 2026-11-18): a point cloud's points, or a mesh's triangles with their
   vertex colours. Pure: no DOM, no Worker, no Node; imports dag-core and
   attr-core only.

   Read as a stream. The files this is for run to 190 MB (an ASCII cloud of
   five million coloured points), so the reader never holds the file: it is
   handed the bytes a chunk at a time (`readPly(chunks)`, any async iterable
   of Uint8Arrays: a File's slices in the worker, an fs stream in Node) and
   writes each value straight into typed arrays sized from the header. A
   190 MB ASCII file as one JS string, split into lines, is tens of millions
   of strings; this is three arrays the size of the points.

   The PLY it reads (Greg Turk's format, as MeshLab, CloudCompare, VCGLIB,
   Open3D and the splat trainers write it):
     - `format ascii 1.0`, `binary_little_endian 1.0`, `binary_big_endian 1.0`;
     - any elements in any order, any properties, lists anywhere (skipped
       unless they're used), all eight scalar types under either name;
     - `vertex` with x, y and z (float or double; double stays double, since
       a scan in survey coordinates loses centimetres in float32);
     - colour from red/green/blue (or r/g/b, diffuse_red/…): uchar as is,
       ushort scaled to bytes, float or double as 0–1. A splat file has
       none, and its base colour comes from f_dc_0..2 (the spherical
       harmonics' DC term: 0.5 + C0·f), so a Gaussian splat reads as the
       cloud of its centres;
     - `face` with `vertex_indices` (or `vertex_index`), polygons cut into
       fans. No faces (or none listed) makes it a point cloud.
   Not read: textures (a mesh's texcoords and TextureFile; noted), normals,
   alpha, a face's own colour.

   The ASCII numbers are parsed off the bytes (`parseNum`): Clinger's fast
   path (a mantissa of at most 15 digits times an exact power of ten, one
   correctly rounded operation, so the same double as Number()), and
   Number() itself on anything else. Held to Number() in
   test/ply-core.test.js. A file is outside input: counts are checked
   against what can be allocated, every face index against the vertex
   count, and a file that ends early says where. */
import { EMPTY } from '../dag-core.js';
import { rgb8 } from '../attr-core.js';

// The scalar types under both their names, as codes, and their sizes in bytes.
const TYPES = { char: 0, int8: 0, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 3, uint16: 3, int: 4, int32: 4, uint: 5, uint32: 5, float: 6, float32: 6, double: 7, float64: 7 };
const SIZE = [1, 1, 2, 2, 4, 4, 4, 8];
// What a property is read into: nothing, x, y, z, red, green, blue, a face's corners.
const SKIP = 0, X = 1, R = 4, FACE = 7;
// At most 2^26 vertices or faces an element (800 MB of float32 points), and a polygon of 2^16 corners.
export const MAX_COUNT = 2 ** 26, MAX_POLY = 2 ** 16;
const C0 = 0.28209479177387814;
const COLOURS = [['red', 'green', 'blue'], ['r', 'g', 'b'], ['diffuse_red', 'diffuse_green', 'diffuse_blue']];

/* ---- the header ------------------------------------------------------------------------ */
// Where the body starts: just past `end_header` and its line's end, or −1 if it isn't in yet.
export function headerEnd(b){
  const tag = [101, 110, 100, 95, 104, 101, 97, 100, 101, 114]; // end_header
  outer: for (let i = 0; i + tag.length <= b.length; i++){
    if (i && b[i - 1] !== 10) continue;
    for (let k = 0; k < tag.length; k++) if (b[i + k] !== tag[k]) continue outer;
    for (let j = i + tag.length; j < b.length; j++) if (b[j] === 10) return j + 1;
    return -1;
  }
  return -1;
}
export function parseHeader(text){
  const lines = text.split('\n').map(l => l.replace(/\r$/, '').trim());
  if (lines[0] !== 'ply') throw new Error('not a PLY file (no "ply" on its first line)');
  let format = null;
  const elements = [], comments = [];
  for (const line of lines.slice(1)){
    if (!line) continue;
    const w = line.split(/\s+/);
    if (w[0] === 'comment' || w[0] === 'obj_info'){ comments.push(line.slice(w[0].length).trim()); continue; }
    if (w[0] === 'end_header') break;
    if (w[0] === 'format'){
      format = { ascii: 'ascii', binary_little_endian: 'le', binary_big_endian: 'be' }[w[1]] ?? null;
      if (!format) throw new Error(`PLY: a format this doesn't read: ${w[1]}`);
      continue;
    }
    if (w[0] === 'element'){
      const count = Number(w[2]);
      if (w.length !== 3 || !Number.isSafeInteger(count) || count < 0) throw new Error(`PLY header: a bad element line: ${line.slice(0, 80)}`);
      if (count > MAX_COUNT) throw new Error(`PLY: ${count.toLocaleString('en-US')} ${w[1]}s is more than this reads (${MAX_COUNT.toLocaleString('en-US')})`);
      elements.push({ name: w[1], count, props: [] });
      continue;
    }
    if (w[0] === 'property'){
      const el = elements.at(-1);
      if (!el) throw new Error('PLY header: a property before any element');
      if (w[1] === 'list'){
        const ct = TYPES[w[2]], it = TYPES[w[3]];
        if (w.length !== 5 || ct == null || it == null) throw new Error(`PLY header: a bad list property: ${line.slice(0, 80)}`);
        el.props.push({ name: w[4], list: true, ct, it, t: it, dest: SKIP, scale: 1, bias: 0 });
      } else {
        const t = TYPES[w[1]];
        if (w.length !== 3 || t == null) throw new Error(`PLY header: a bad property: ${line.slice(0, 80)}`);
        el.props.push({ name: w[2], list: false, t, dest: SKIP, scale: 1, bias: 0 });
      }
      continue;
    }
    throw new Error(`PLY header: a line this doesn't know: ${line.slice(0, 80)}`);
  }
  if (!format) throw new Error('PLY header: no format line');
  return { format, elements, comments };
}

/* Which properties are read, and into what. Returns what the header says
   the file holds: vertices, whether they're coloured and how, faces. */
function plan(header, notes){
  const { elements } = header, vertex = elements.find(e => e.name === 'vertex');
  if (!vertex) throw new Error('PLY: no vertex element');
  if (!vertex.count) throw new Error('PLY: no vertices');
  const by = name => vertex.props.find(p => p.name === name && !p.list);
  const xyz = ['x', 'y', 'z'].map(by);
  if (xyz.some(p => !p)) throw new Error('PLY: the vertices have no x, y and z');
  xyz.forEach((p, k) => { p.dest = X + k; });
  let colour = null;
  const names = COLOURS.find(n => n.every(by));
  if (names){
    names.forEach((n, k) => {
      const p = by(n); p.dest = R + k;
      // uchar as is, ushort to bytes, a float as 0–1; signed types as their unsigned values' range.
      p.scale = p.t >= 6 ? 255 : SIZE[p.t] === 1 ? 1 : 255 / (2 ** (8 * SIZE[p.t]) - 1);
    });
    colour = 'vertex';
  } else if (['f_dc_0', 'f_dc_1', 'f_dc_2'].every(by)){
    ['f_dc_0', 'f_dc_1', 'f_dc_2'].forEach((n, k) => { const p = by(n); p.dest = R + k; p.scale = 255 * C0; p.bias = 127.5; });
    colour = 'splat';
    notes.push('colours from the splats\' base colour (f_dc), their centres as points');
  }
  const face = elements.find(e => e.name === 'face');
  let faces = 0;
  if (face?.count){
    const list = face.props.find(p => p.list && (p.name === 'vertex_indices' || p.name === 'vertex_index'));
    if (!list) throw new Error('PLY: faces with no vertex_indices list');
    list.dest = FACE;
    faces = face.count;
    if (face.props.some(p => p.list && p.name === 'texcoord') || header.comments.some(c => /^TextureFile\b/i.test(c)))
      notes.push('its texture isn\'t read: vertex colours only');
  }
  const double = xyz.some(p => p.t === 7);
  return { vertices: vertex.count, colour, faces, double };
}

/* ---- numbers off the bytes ------------------------------------------------------------- */
const POW10 = Float64Array.from({ length: 23 }, (_, k) => 10 ** k);
const ws = c => c === 32 || (c >= 9 && c <= 13);
function slowNum(b, i, j){
  let s = '';
  for (let k = i; k < j; k++) s += String.fromCharCode(b[k]);
  const l = s.toLowerCase().replace(/^\+/, '');
  if (l === 'inf' || l === 'infinity') return Infinity;
  if (l === '-inf' || l === '-infinity') return -Infinity;
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s) ? Number(s) : NaN;
}
/* The decimal in b[i, j) as Number() reads it, or NaN if it isn't one ("nan",
   "-nan(ind)": what C's printf writes for one). "inf" is ±Infinity. A
   mantissa past 15 digits (Python's repr writes 17) is still scanned here,
   so Number() gets only a token already known to be a decimal: the regex
   and the string built a character at a time were 230 ns a number, a third
   of reading a 165 MB cloud. */
export function parseNum(b, i, j){
  let k = i, neg = false, m = 0, nd = 0, e = 0, digits = false, c;
  if (b[k] === 45){ neg = true; k++; } else if (b[k] === 43) k++;
  while (k < j){
    c = b[k] - 48;
    if (c < 0 || c > 9) break;
    if (m || c){ nd++; m = m * 10 + c; }
    digits = true; k++;
  }
  if (k < j && b[k] === 46){
    k++;
    while (k < j){
      c = b[k] - 48;
      if (c < 0 || c > 9) break;
      if (m || c){ nd++; m = m * 10 + c; }
      e--; digits = true; k++;
    }
  }
  if (!digits) return slowNum(b, i, j);
  if (k < j && (b[k] === 101 || b[k] === 69)){
    k++;
    let es = 1, x = 0, any = false;
    if (b[k] === 45){ es = -1; k++; } else if (b[k] === 43) k++;
    while (k < j && (c = b[k] - 48) >= 0 && c <= 9){ if (x < 10000) x = x * 10 + c; any = true; k++; }
    if (!any) return slowNum(b, i, j);
    e += es * x;
  }
  if (k !== j) return slowNum(b, i, j);
  if (nd > 15) return Number(String.fromCharCode.apply(null, b.subarray(i, j)));
  if (m === 0) return neg ? -0 : 0;
  let v;
  if (e === 0) v = m;
  else if (e > 0 && e <= 22) v = m * POW10[e];
  else if (e < 0 && e >= -22) v = m / POW10[-e];
  else return slowNum(b, i, j);
  return neg ? -v : v;
}

/* ---- the body -------------------------------------------------------------------------
   One machine for both encodings: it's handed values in the file's order
   (`put`), keeps its place (element, row, property, how much of a list is
   left), and says what type comes next (`type`), which is all a binary
   reader needs to know how many bytes to take. */
class Body {
  constructor(header, p){
    this.els = header.elements; this.mode = header.format; this.le = header.format === 'le';
    this.nv = p.vertices;
    this.xyz = p.double ? new Float64Array(3 * p.vertices) : new Float32Array(3 * p.vertices);
    this.rgb = p.colour ? new Uint8Array(3 * p.vertices) : null;
    this.tris = p.faces ? new Uint32Array(3 * p.faces) : null;
    this.nt = 0; this.polys = 0; this.short = 0;
    this.poly = new Float64Array(16); this.left = -1; this.got = 0;
    this.e = -1; this.done = false; this.carry = null; this.extra = 0;
    this.nextElement();
  }
  nextElement(){
    do this.e++; while (this.e < this.els.length && (!this.els[this.e].count || !this.els[this.e].props.length));
    if (this.e === this.els.length){ this.done = true; return; }
    this.el = this.els[this.e]; this.props = this.el.props; this.np = this.props.length; this.count = this.el.count;
    this.row = 0; this.p = 0; this.prop = this.props[0];
  }
  next(){
    if (++this.p < this.np){ this.prop = this.props[this.p]; return; }
    this.p = 0; this.prop = this.props[0];
    if (++this.row === this.count) this.nextElement();
  }
  type(){ const pr = this.prop; return pr.list && this.left < 0 ? pr.ct : pr.t; }
  put(v){
    const pr = this.prop;
    if (pr.list){
      if (this.left < 0){
        if (!(Number.isInteger(v) && v >= 0 && v <= MAX_POLY)) throw new Error(`PLY: a list of ${v} items in ${this.el.name} ${this.row}`);
        this.got = 0;
        if (v === 0) this.endList(); else this.left = v;
        return;
      }
      if (pr.dest === FACE){
        if (this.got === this.poly.length){ const g = new Float64Array(2 * this.got); g.set(this.poly); this.poly = g; }
        this.poly[this.got] = v;
      }
      this.got++;
      if (--this.left === 0) this.endList();
      return;
    }
    const d = pr.dest;
    if (d !== SKIP){
      if (d < R) this.xyz[3 * this.row + d - X] = v;
      else { const c = v * pr.scale + pr.bias; this.rgb[3 * this.row + d - R] = c >= 255 ? 255 : c > 0 ? Math.round(c) : 0; }
    }
    this.next();
  }
  endList(){
    if (this.prop.dest === FACE) this.face(this.got);
    this.left = -1;
    this.next();
  }
  // A polygon's corners, checked, cut into a fan (0, i, i + 1).
  face(n){
    const P = this.poly, nv = this.nv;
    for (let i = 0; i < n; i++){
      const v = P[i];
      if (!(v >= 0 && v < nv && v === Math.floor(v))) throw new Error(`PLY: face ${this.row} names vertex ${v} of ${nv.toLocaleString('en-US')}`);
    }
    this.polys++;
    if (n < 3){ this.short++; return; }
    if (this.tris.length < 3 * (this.nt + n - 2)){
      const g = new Uint32Array(Math.max(3 * (this.nt + n - 2), Math.ceil(this.tris.length * 1.5)));
      g.set(this.tris); this.tris = g;
    }
    const T = this.tris;
    for (let i = 1; i + 1 < n; i++){ const o = 3 * this.nt++; T[o] = P[0]; T[o + 1] = P[i]; T[o + 2] = P[i + 1]; }
  }
  feed(chunk, last = false){
    let b = chunk;
    if (this.carry?.length){ b = new Uint8Array(this.carry.length + chunk.length); b.set(this.carry); b.set(chunk, this.carry.length); }
    this.carry = null;
    if (this.mode === 'ascii') this.ascii(b, last);
    else this.binary(b);
  }
  // Whitespace-separated tokens, up to the last whitespace; the rest waits for the next chunk.
  ascii(b, last){
    let end = b.length;
    if (!last){ while (end > 0 && !ws(b[end - 1])) end--; this.carry = b.slice(end); }
    let i = 0;
    while (i < end){
      while (i < end && ws(b[i])) i++;
      if (i === end) break;
      let j = i + 1;
      while (j < end && !ws(b[j])) j++;
      if (this.done) this.extra += j - i;
      else this.put(parseNum(b, i, j));
      i = j;
    }
  }
  binary(b){
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), le = this.le, n = b.length;
    let o = 0;
    while (!this.done){
      const t = this.type(), s = SIZE[t];
      if (o + s > n) break;
      let v;
      switch (t){
        case 0: v = dv.getInt8(o); break;
        case 1: v = b[o]; break;
        case 2: v = dv.getInt16(o, le); break;
        case 3: v = dv.getUint16(o, le); break;
        case 4: v = dv.getInt32(o, le); break;
        case 5: v = dv.getUint32(o, le); break;
        case 6: v = dv.getFloat32(o, le); break;
        default: v = dv.getFloat64(o, le);
      }
      o += s;
      this.put(v);
    }
    if (this.done) this.extra += n - o;
    else this.carry = b.slice(o);
  }
  finish(){
    if (this.mode === 'ascii') this.feed(new Uint8Array(0), true);
    if (!this.done){
      const lost = this.carry?.length ? ` (${this.carry.length} bytes left over)` : '';
      throw new Error(`PLY: the file ends early, at ${this.el.name} ${this.row.toLocaleString('en-US')} of ${this.count.toLocaleString('en-US')}${lost}`);
    }
  }
}

/* The whole file, from an async iterable of byte chunks. `onProgress(bytes)`
   after each chunk. Returns the points (xyz, and rgb if coloured), the
   triangles if it has faces, and notes for the page. */
export async function readPly(chunks, { onProgress = () => {} } = {}){
  let head = new Uint8Array(0), body = null, header = null, read = 0;
  const notes = [];
  let p = null;
  for await (const chunk of chunks){
    const c = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    read += c.length;
    if (!body){
      const h = new Uint8Array(head.length + c.length); h.set(head); h.set(c, head.length); head = h;
      if (head.length >= 4 && !(head[0] === 112 && head[1] === 108 && head[2] === 121 && (head[3] === 10 || head[3] === 13)))
        throw new Error('not a PLY file (no "ply" on its first line)');
      const at = headerEnd(head);
      if (at < 0){
        if (head.length > 1 << 20) throw new Error('PLY: no end_header in the first megabyte');
        continue;
      }
      let text = '';
      for (let i = 0; i < at; i++) text += String.fromCharCode(head[i]);
      header = parseHeader(text);
      p = plan(header, notes);
      body = new Body(header, p);
      body.feed(head.subarray(at));
      head = null;
    } else body.feed(c);
    onProgress(read);
  }
  if (!body) throw new Error(head.length ? 'PLY: the header has no end_header' : 'an empty file');
  body.finish();
  if (body.extra) notes.push(`${body.extra.toLocaleString('en-US')} bytes after the last element ignored`);
  if (body.short) notes.push(`${body.short.toLocaleString('en-US')} faces with fewer than three corners skipped`);
  const tris = p.faces && body.nt ? body.tris.subarray(0, 3 * body.nt) : null;
  if (p.faces && !body.nt) notes.push('its faces make no triangles: read as points');
  return { format: header.format, comments: header.comments, n: p.vertices, xyz: body.xyz, rgb: body.rgb, colour: p.colour,
           tris, nt: tris ? body.nt : 0, polygons: body.polys, notes };
}

/* ---- a mesh, as glb-core's G ------------------------------------------------------------
   The triangles corner by corner, with no material (the bake then takes the
   vertex colour alone) and the colours as glTF's COLOR_0 is: linear, which
   glb-core's sampler takes back to sRGB. PLY's bytes are sRGB, so they go
   in as (c / 255)^2.2 and come out as c at a corner. A glb holding the same
   float32 colours and triangles is the same G, so the same file
   (test/ply-core.test.js). */
const LINEAR = Float32Array.from({ length: 256 }, (_, c) => Math.pow(c / 255, 2.2));
export function plyMesh(P){
  const { nt, tris, xyz, rgb } = P, pos = new Float64Array(9 * nt), CO = rgb ? new Float32Array(12 * nt) : null;
  for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++){
    const v = tris[3 * t + e], o = 9 * t + 3 * e;
    pos[o] = xyz[3 * v]; pos[o + 1] = xyz[3 * v + 1]; pos[o + 2] = xyz[3 * v + 2];
    if (CO){ const c = 12 * t + 4 * e; CO[c] = LINEAR[rgb[3 * v]]; CO[c + 1] = LINEAR[rgb[3 * v + 1]]; CO[c + 2] = LINEAR[rgb[3 * v + 2]]; CO[c + 3] = 1; }
  }
  return { P: pos, UV: new Float64Array(0), MAT: new Int32Array(nt).fill(-1), CO, materials: [], images: [], generator: null, instances: 1, meshes: 1 };
}

/* ---- a point cloud, voxelized ------------------------------------------------------------
   A point fills the voxel it falls in, and the voxel's colour is the mean of
   its points' bytes. Every voxel is its own skin (a cloud has no inside),
   so the words go one a voxel in Morton order.

   The fit is glb-core's `place`: 92% of the side across the longest
   extent, centred in x and z, on the floor plus 4%, nudged off the grid by
   the same small amounts. Points with a coordinate that isn't finite are
   dropped (a NaN is what some exporters write for no return). */
export function pointBox(P){
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], { xyz, n } = P;
  let kept = 0;
  for (let i = 0; i < n; i++){
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
    kept++;
    if (x < lo[0]) lo[0] = x; if (x > hi[0]) hi[0] = x;
    if (y < lo[1]) lo[1] = y; if (y > hi[1]) hi[1] = y;
    if (z < lo[2]) lo[2] = z; if (z > hi[2]) hi[2] = z;
  }
  return { lo, hi, kept };
}
export function fitPoints(box, D){
  const { lo, hi } = box, side = 2 ** D, ext = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
  const s = ext > 0 ? 0.92 * side / ext : 1;
  const off = [0, 1, 2].map(a => (a === 1 ? 0.04 * side : (side - (hi[a] - lo[a]) * s) / 2) - lo[a] * s + 0.0137 * Math.SQRT2 * (a + 1));
  return { side, s, off, lo: lo.map((v, a) => v * s + off[a]), hi: hi.map((v, a) => v * s + off[a]) };
}
// Bits spread three apart: x in bit 0, y in bit 1, z in bit 2 (store.child's octant), D ≤ 10.
const SPREAD = Uint32Array.from({ length: 1024 }, (_, v) => { let m = 0; for (let b = 0; b < 10; b++) m |= (v >> b & 1) << 3 * b; return m; });
/* LSD radix sort of uint32 keys, carrying a payload, 11 bits a pass. */
function radixSort(keys, vals, bits){
  const n = keys.length, count = new Uint32Array(2048);
  let k = keys, v = vals, k2 = new Uint32Array(n), v2 = new Uint32Array(n);
  for (let shift = 0; shift < bits; shift += 11){
    count.fill(0);
    for (let i = 0; i < n; i++) count[k[i] >>> shift & 2047]++;
    let sum = 0;
    for (let d = 0; d < 2048; d++){ const c = count[d]; count[d] = sum; sum += c; }
    for (let i = 0; i < n; i++){ const d = k[i] >>> shift & 2047, at = count[d]++; k2[at] = k[i]; v2[at] = v[i]; }
    [k, k2] = [k2, k]; [v, v2] = [v2, v];
  }
  return { keys: k, vals: v };
}
/* A DAG from sorted, distinct Morton keys of the voxels at depth D: each
   node's keys are one run, split eight ways by its children's ranges. A run
   as long as the node is solid(k), as fromField and fromDense make it, so
   the same voxels are the same id in one store. */
export function fromMorton(store, keys, n, D){
  const buf = Array.from({ length: D + 1 }, () => new Uint32Array(8));
  const build = (k, lo, hi, base) => {
    if (lo === hi) return EMPTY;
    if (hi - lo === 8 ** k) return store.solid(k);
    const ch = buf[k], step = 8 ** (k - 1);
    let a = lo;
    for (let o = 0; o < 8; o++){
      const lim = base + (o + 1) * step;
      let b = a;
      while (b < hi && keys[b] < lim) b++;
      ch[o] = build(k - 1, a, b, base + o * step);
      a = b;
    }
    return store.intern(k, ch);
  };
  return build(D, 0, n, 0);
}
/* One depth: the voxels' DAG in `store`, and (if the cloud is coloured and
   `bake`) a word a voxel in rank order. */
export function pointsDepth(P, box, D, store, { bake = true } = {}){
  if (D > 10) throw new Error('points: D ≤ 10 (the keys are 30 bits)');
  const F = fitPoints(box, D), { s, off, side } = F, { xyz, rgb, n } = P, top = side - 1;
  const keys = new Uint32Array(box.kept), idx = new Uint32Array(box.kept);
  let m = 0;
  for (let i = 0; i < n; i++){
    const x = xyz[3 * i], y = xyz[3 * i + 1], z = xyz[3 * i + 2];
    if (!(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z))) continue;
    const vx = Math.min(top, Math.max(0, Math.floor(x * s + off[0]))), vy = Math.min(top, Math.max(0, Math.floor(y * s + off[1]))), vz = Math.min(top, Math.max(0, Math.floor(z * s + off[2])));
    keys[m] = SPREAD[vx] | SPREAD[vy] << 1 | SPREAD[vz] << 2; idx[m] = i; m++;
  }
  const S = radixSort(keys, idx, 3 * D), K = S.keys, I = S.vals;
  const words = bake && rgb ? new Uint32Array(m) : null;
  let u = 0;
  for (let i = 0; i < m;){
    const key = K[i];
    let j = i, r = 0, g = 0, b = 0;
    while (j < m && K[j] === key){
      if (words){ const q = 3 * I[j]; r += rgb[q]; g += rgb[q + 1]; b += rgb[q + 2]; }
      j++;
    }
    if (words){ const c = j - i; words[u] = rgb8(r / c, g / c, b / c); }
    K[u++] = key;
    i = j;
  }
  const root = fromMorton(store, K, u, D);
  return { root, voxels: u, words: words ? words.slice(0, u) : null, M: { side, lo: F.lo, hi: F.hi } };
}
