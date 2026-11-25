/* An OpenVDB file reader, pure (no DOM, no Worker; imports only ./codecs.js).
   Written from the format as OpenVDB's own io (Archive, GridDescriptor,
   RootNode, InternalNode, LeafNode, Compression) writes it, and held to what
   the real library reads back from files it wrote (vdb/test/fixtures, made
   in Blender by vdb/test/make-fixtures.py) and to Houdini's. vdb/README.md
   walks the layout; the short of it:

     header      8-byte magic " BDV\0\0\0\0", file version (u32; read from
                 222, when compression went per grid), library major and
                 minor (u32), a has-grid-offsets byte, a 36-char UUID, the
                 file's metadata, a grid count (i32, written even without
                 offsets)
     a grid      its descriptor (unique name, type, instance parent: u32-
                 length strings; grid, block and end offsets: i64), then at
                 the grid offset its compression flags (u32), metadata,
                 transform (a map's name and its doubles), and its tree:
                 topology (the root's background, tiles and children, each
                 internal node's child and value masks and tile values) and
                 then buffers (each leaf's mask again and its 512 values)
     metadata    a count, then name, type name and a u32-sized value each
     values      readCompressedValues: a byte saying which inactive values
                 the writer left out (codes 0–6), up to two of them and a
                 mask choosing between, then the values themselves, only the
                 active ones when the grid has COMPRESS_ACTIVE_MASK, through
                 zlib or Blosc behind an i64 size (≤ 0: |size| raw bytes),
                 as halves when the grid's type ends _HalfFloat

   The reader is two calls, so a page never holds a file it doesn't need:
   `inspectVdb(src)` reads the header and, for each grid, its descriptor,
   metadata and transform (a few KB a grid, however big the file), and
   `readGrid(src, info, grid)` reads one grid's tree. `src` is
   `{ size, read(offset, length) → Promise<Uint8Array> }`: a File's slices
   in the worker, a file handle in Node, or bytes (`bytesSource`).

   A tree comes back as flat arrays (`tree.leaves` is n leaves' origins,
   masks and values; internal nodes keep their tile values and a child slot
   table), with `probe` to ask any voxel's value and whether it's active, as
   OpenVDB's ValueAccessor would. Values are float32 whatever the grid's
   type (half, float, double, int; bools are 0 or 1), since all a converter
   does with them is compare and interpolate.

   A file is outside input: every count is checked against the bytes left
   before it's believed, every string is bounded, every buffer must decode
   to exactly its size, and a grid must end where its descriptor says. */
import { inflate, lz4Block, bloscDecode, halfToFloat, Damaged } from './codecs.js';
export { Damaged };

export const MAGIC = 0x56444220;
export const MIN_VERSION = 222, MAX_VERSION = 224;
export const COMPRESS_ZIP = 1, COMPRESS_ACTIVE_MASK = 2, COMPRESS_BLOSC = 4;
// readCompressedValues' metadata byte (Compression.h).
export const NO_MASK_OR_INACTIVE_VALS = 0, NO_MASK_AND_MINUS_BG = 1, NO_MASK_AND_ONE_INACTIVE_VAL = 2,
             MASK_AND_NO_INACTIVE_VALS = 3, MASK_AND_ONE_INACTIVE_VAL = 4, MASK_AND_TWO_INACTIVE_VALS = 5, NO_MASK_AND_ALL_VALS = 6;

/* Value types by the name in a grid's type ("Tree_<value>_5_4_3"): bytes a
   component as written in full, components, whether it's real (so saved as
   half when asked), and how a component is read. bool and mask leaves are
   bit masks, read their own way. */
const VALUE_TYPES = {
  float:  { bytes: 4, comps: 1, real: true,  get: (v, o) => v.getFloat32(o, true) },
  double: { bytes: 8, comps: 1, real: true,  get: (v, o) => v.getFloat64(o, true) },
  int32:  { bytes: 4, comps: 1, real: false, get: (v, o) => v.getInt32(o, true) },
  int64:  { bytes: 8, comps: 1, real: false, get: (v, o) => Number(v.getBigInt64(o, true)) },
  uint32: { bytes: 4, comps: 1, real: false, get: (v, o) => v.getUint32(o, true) },
  bool:   { bytes: 1, comps: 1, real: false, get: (v, o) => v.getUint8(o) ? 1 : 0, bits: true },
  mask:   { bytes: 1, comps: 1, real: false, get: (v, o) => v.getUint8(o) ? 1 : 0, bits: true, mask: true },
  vec3s:  { bytes: 4, comps: 3, real: true,  get: (v, o) => v.getFloat32(o, true) },
  vec3d:  { bytes: 8, comps: 3, real: true,  get: (v, o) => v.getFloat64(o, true) },
  vec3i:  { bytes: 4, comps: 3, real: false, get: (v, o) => v.getInt32(o, true) },
};
// Grids whose leaves aren't values: told apart so the page can say why.
const NOT_VOLUMES = { ptdataidx32: 'a point data grid (OpenVDB points)', ptdataidx64: 'a point data grid (OpenVDB points)',
                      ptidx32: 'a point index grid', ptidx64: 'a point index grid', string: 'a string grid' };

export class Truncated extends Damaged {}

/* ---- sources ---------------------------------------------------------------- */
export const bytesSource = bytes => ({ size: bytes.length, read: async (o, n) => bytes.subarray(o, Math.min(bytes.length, o + n)) });
export const fileSource = file => ({ size: file.size, read: async (o, n) => new Uint8Array(await file.slice(o, o + n).arrayBuffer()) });

/* ---- a cursor over bytes ------------------------------------------------------
   `base` is where `bytes` sits in the file, so positions are the file's. */
class Cursor {
  constructor(bytes, base = 0){ this.b = bytes; this.v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.p = 0; this.base = base; }
  get at(){ return this.base + this.p; }
  get left(){ return this.b.length - this.p; }
  need(n, what){ if (n > this.left) throw new Truncated(`the file ends inside ${what}`); }
  u8(){ this.need(1, 'a byte'); return this.b[this.p++]; }
  i8(){ const v = this.u8(); return v > 127 ? v - 256 : v; }
  u32(){ this.need(4, 'a number'); const v = this.v.getUint32(this.p, true); this.p += 4; return v; }
  i32(){ this.need(4, 'a number'); const v = this.v.getInt32(this.p, true); this.p += 4; return v; }
  i64(){
    this.need(8, 'a number'); const v = this.v.getBigInt64(this.p, true); this.p += 8;
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < -BigInt(Number.MAX_SAFE_INTEGER)) throw new Damaged('a 64-bit size out of range');
    return Number(v);
  }
  f64(){ this.need(8, 'a number'); const v = this.v.getFloat64(this.p, true); this.p += 8; return v; }
  bytes(n, what = 'a block'){ this.need(n, what); const out = this.b.subarray(this.p, this.p + n); this.p += n; return out; }
  str(what = 'a name'){
    const n = this.u32();
    if (n > 1 << 20) throw new Damaged(`${what} of ${n} bytes`);
    return new TextDecoder().decode(this.bytes(n, what));
  }
  // A node mask of n bits: n / 64 little-endian uint64 words, as n / 32 uint32s.
  mask(n){
    this.need(n / 8, 'a node mask');
    const out = new Uint32Array(n / 32);
    for (let i = 0; i < out.length; i++) out[i] = this.v.getUint32(this.p + 4 * i, true);
    this.p += n / 8;
    return out;
  }
}

const popcount = m => { let c = 0; for (let w of m){ w -= (w >>> 1) & 0x55555555; w = (w & 0x33333333) + ((w >>> 2) & 0x33333333); c += ((w + (w >>> 4) & 0x0f0f0f0f) * 0x01010101) >>> 24; } return c; };
const isOn = (m, i) => (m[i >>> 5] >>> (i & 31)) & 1;

/* ---- the header and metadata --------------------------------------------------- */
function readHeader(c){
  c.need(8, 'the header');
  const lo = c.u32(), hi = c.u32();
  if (lo !== MAGIC || hi !== 0) throw new Damaged('not an OpenVDB file (no " BDV" magic number)');
  const version = c.u32();
  if (version < MIN_VERSION) throw new Damaged(`file format ${version}: this reader starts at ${MIN_VERSION}, where compression went per grid (OpenVDB 3); resave it with a newer OpenVDB`);
  const library = [c.u32(), c.u32()];
  const hasOffsets = c.u8() !== 0;
  const uuid = new TextDecoder().decode(c.bytes(36, 'the UUID'));
  return { version, library, hasOffsets, uuid };
}
/* Metadata values by their type name. Anything else (a type a plugin
   registered) keeps its size and is skipped, as OpenVDB's UnknownMetadata. */
function metaValue(type, b){
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength), n = b.length;
  const need = k => { if (n !== k) throw new Damaged(`a ${type} of ${n} bytes`); };
  switch (type){
    case 'string': return new TextDecoder().decode(b);
    case 'bool': need(1); return b[0] !== 0;
    case 'int32': need(4); return v.getInt32(0, true);
    case 'int64': need(8); return Number(v.getBigInt64(0, true));
    case 'float': need(4); return v.getFloat32(0, true);
    case 'double': need(8); return v.getFloat64(0, true);
    case 'vec2i': need(8); return [0, 1].map(i => v.getInt32(4 * i, true));
    case 'vec2s': need(8); return [0, 1].map(i => v.getFloat32(4 * i, true));
    case 'vec2d': need(16); return [0, 1].map(i => v.getFloat64(8 * i, true));
    case 'vec3i': need(12); return [0, 1, 2].map(i => v.getInt32(4 * i, true));
    case 'vec3s': need(12); return [0, 1, 2].map(i => v.getFloat32(4 * i, true));
    case 'vec3d': need(24); return [0, 1, 2].map(i => v.getFloat64(8 * i, true));
    case 'mat4s': need(64); return Array.from({ length: 16 }, (_, i) => v.getFloat32(4 * i, true));
    case 'mat4d': need(128); return Array.from({ length: 16 }, (_, i) => v.getFloat64(8 * i, true));
    default: return { unknown: type, bytes: n };
  }
}
function readMeta(c){
  const n = c.u32(), out = {};
  if (n > c.left / 12) throw new Damaged(`${n} metadata entries in ${c.left} bytes`);
  for (let i = 0; i < n; i++){
    const name = c.str('a metadata name'), type = c.str('a metadata type'), size = c.u32();
    out[name] = metaValue(type, c.bytes(size, `metadata ${name}`));
  }
  return out;
}

/* ---- the transform ---------------------------------------------------------------
   A map's name, then its doubles (math/Maps.h, each map's read()). Kept as
   index → world, a 4 × 4 row-major matrix acting on row vectors [i j k 1]
   (OpenVDB's convention: the translation is the last row), or null for a
   frustum, which isn't affine; its parameters are kept for the page to name. */
function vec3(c){ return [c.f64(), c.f64(), c.f64()]; }
function scaleTranslate(s, t){ return [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, t[0], t[1], t[2], 1]; }
function readMap(c, version, name = c.str('a map name')){
  switch (name){
    case 'ScaleMap': case 'UniformScaleMap': {
      const s = vec3(c); for (let i = 0; i < 4; i++) vec3(c);     // voxel size, inverse, inverse², inverse·½
      return { name, matrix: scaleTranslate(s, [0, 0, 0]) };
    }
    case 'ScaleTranslateMap': case 'UniformScaleTranslateMap': {
      const t = vec3(c), s = vec3(c); for (let i = 0; i < 4; i++) vec3(c);
      return { name, matrix: scaleTranslate(s, t) };
    }
    case 'TranslationMap': return { name, matrix: scaleTranslate([1, 1, 1], vec3(c)) };
    case 'AffineMap': case 'UnitaryMap': return { name, matrix: Array.from({ length: 16 }, () => c.f64()) };
    case 'NonlinearFrustumMap': {
      const box = version < 221 ? [c.i32(), c.i32(), c.i32(), c.i32(), c.i32(), c.i32()] : [vec3(c), vec3(c)].flat();
      const taper = c.f64(), depth = c.f64(), second = readMap(c, version);
      return { name, matrix: null, frustum: { box, taper, depth, second } };
    }
    default: throw new Damaged(`a transform OpenVDB doesn't have: ${name}`);
  }
}

/* ---- a grid's type --------------------------------------------------------------- */
export function parseGridType(type){
  const half = type.endsWith('_HalfFloat'), t = half ? type.slice(0, -'_HalfFloat'.length) : type;
  const m = /^Tree_([A-Za-z0-9]+)((?:_\d+)+)$/.exec(t);
  if (!m) return { type, half, value: null, dims: null, why: `a grid type this reader doesn't know: ${type}` };
  const value = m[1] === 'ValueMask' ? 'mask' : m[1], dims = m[2].slice(1).split('_').map(Number);
  if (NOT_VOLUMES[value]) return { type, half, value, dims, why: `${NOT_VOLUMES[value]}: only volumes are read so far` };
  if (!VALUE_TYPES[value]) return { type, half, value, dims, why: `${value} values aren't read here` };
  if (dims.length < 2 || dims.some(d => !(d >= 1 && d <= 7))) return { type, half, value, dims, why: `node sizes ${dims.join(', ')} aren't read here` };
  if (dims.reduce((a, b) => a + b, 0) > 30) return { type, half, value, dims, why: `node sizes ${dims.join(', ')} cover more than 2^30 voxels` };
  return { type, half: half && VALUE_TYPES[value].real, value, dims, why: null };
}

/* ---- inspect: header, and every grid's descriptor, metadata and transform -------- */
async function readAt(src, at, what, parse, first = 1 << 16){
  for (let n = first; ; n *= 4){
    const len = Math.min(n, src.size - at);
    if (len <= 0) throw new Truncated(`the file ends before ${what}`);
    const c = new Cursor(await src.read(at, len), at);
    try { return parse(c); }
    catch (e){ if (!(e instanceof Truncated) || len === src.size - at) throw e; }
  }
}
export async function inspectVdb(src){
  const { head, at } = await readAt(src, 0, 'the header', c => {
    const head = readHeader(c);
    head.meta = readMeta(c);
    head.count = c.i32();                  // written with or without offsets (Archive::write)
    return { head, at: c.at };
  });
  if (head.count < 0 || head.count > 1e6) throw new Damaged(`${head.count} grids`);
  const grids = [];
  let pos = at;
  for (let g = 0; g < head.count; g++){
    const info = await readAt(src, pos, `grid ${g}`, c => {
      const d = { uniqueName: c.str('a grid name'), typeName: c.str('a grid type') };
      d.name = d.uniqueName.split('\x1e')[0];
      d.parent = c.str('an instance parent');
      d.gridPos = c.i64(); d.blockPos = c.i64(); d.endPos = c.i64();
      d.descriptorAt = pos;
      // Without offsets (a stream), the grid starts here and its end is found by reading it.
      if (!head.hasOffsets) d.gridPos = c.at;
      if (d.gridPos !== c.at) throw new Damaged(`grid ${d.uniqueName} starts at ${d.gridPos}, not right after its descriptor (${c.at})`);
      d.compression = c.u32();
      d.meta = readMeta(c);
      d.transform = readMap(c, head.version);
      d.topologyPos = c.at;
      return d;
    });
    Object.assign(info, parseGridType(info.typeName));
    info.class = typeof info.meta.class === 'string' ? info.meta.class : 'unknown';
    // An instance (Archive::writeGridInstance) ends with its transform: no tree.
    const known = head.hasOffsets && (info.parent ? info.endPos === info.topologyPos : info.endPos > info.topologyPos) && info.endPos <= src.size;
    if (head.hasOffsets && !known) throw new Damaged(`grid ${info.uniqueName}: its end (${info.endPos}) is out of place`);
    if (!head.hasOffsets && info.parent) info.endPos = info.topologyPos;
    else if (!known){
      // A stream: read the tree to find where the next grid starts.
      if (info.why || info.parent) throw new Damaged(`grid ${info.uniqueName}: can't be skipped in a file without grid offsets (${info.why ?? 'an instance'})`);
      info.endPos = (await readTree(src, head, info, { size: src.size - info.topologyPos })).end;
    }
    grids.push(info);
    pos = info.endPos;
  }
  for (const g of grids) if (g.parent && !grids.some(p => p.uniqueName === g.parent)) g.why = `an instance of ${g.parent}, which isn't in the file`;
  return { ...head, grids };
}

/* ---- values: readData and readCompressedValues ---------------------------------- */
function readData(c, count, esize, compression, what){
  const nbytes = count * esize;
  if (compression & (COMPRESS_BLOSC | COMPRESS_ZIP)){
    const n = c.i64();
    if (n <= 0){
      if (-n !== nbytes) throw new Damaged(`${what}: ${-n} raw bytes, ${nbytes} expected`);
      return c.bytes(nbytes, what);
    }
    const out = new Uint8Array(nbytes), start = c.p;
    c.need(n, what);
    (compression & COMPRESS_BLOSC ? bloscDecode : inflate)(c.b, start, start + n, out, 0, nbytes);
    c.p += n;
    return out;
  }
  return c.bytes(nbytes, what);
}
/* `count` values into dst[at …] (dst a Float32Array, comps a value), each
   as the grid's type (half if `half`), restoring the ones mask compression
   left out. `background` is the root's (OpenVDB tags the stream with it as
   the root's topology is read). */
function readValues(c, g, count, valueMask, dst, at, what){
  const vt = g.vt, comps = vt.comps, half = g.half, compression = g.compression;
  const meta = c.i8();
  if (meta < 0 || meta > 6) throw new Damaged(`${what}: compression metadata ${meta}`);
  const raw = () => { const v = new Float64Array(comps); c.need(vt.bytes * comps, what); for (let k = 0; k < comps; k++) v[k] = vt.get(c.v, c.p + k * vt.bytes); c.p += vt.bytes * comps; return v; };
  let in0 = g.background, in1 = g.background;
  if (meta !== NO_MASK_OR_INACTIVE_VALS) in0 = g.negBackground;
  if (meta === NO_MASK_AND_ONE_INACTIVE_VAL || meta === MASK_AND_ONE_INACTIVE_VAL || meta === MASK_AND_TWO_INACTIVE_VALS){
    in0 = raw();
    if (meta === MASK_AND_TWO_INACTIVE_VALS) in1 = raw();
  }
  const select = meta === MASK_AND_NO_INACTIVE_VALS || meta === MASK_AND_ONE_INACTIVE_VAL || meta === MASK_AND_TWO_INACTIVE_VALS ? c.mask(count) : null;
  const packed = (compression & COMPRESS_ACTIVE_MASK) && meta !== NO_MASK_AND_ALL_VALS;
  const n = packed ? popcount(valueMask) : count;
  if (n > count) throw new Damaged(`${what}: more active values than slots`);
  const esize = (half ? 2 : vt.bytes) * comps;
  // HalfReader reads nothing at all for no values; a full-precision readData still writes its size.
  const bytes = half && n < 1 ? new Uint8Array(0) : readData(c, n, esize, compression, what);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const put = (slot, i) => {
    const o = i * esize, d = at + slot * comps;
    if (half) for (let k = 0; k < comps; k++) dst[d + k] = halfToFloat(v.getUint16(o + 2 * k, true));
    else for (let k = 0; k < comps; k++) dst[d + k] = vt.get(v, o + k * vt.bytes);
  };
  if (n === count){ for (let i = 0; i < count; i++) put(i, i); return; }
  for (let slot = 0, i = 0; slot < count; slot++){
    if (isOn(valueMask, slot)){ put(slot, i++); continue; }
    const fill = select && isOn(select, slot) ? in1 : in0, d = at + slot * comps;
    for (let k = 0; k < comps; k++) dst[d + k] = fill[k];
  }
}

/* ---- the tree ------------------------------------------------------------------------
   OpenVDB's node order: a node's slot i is (x << 2n) | (y << n) | z for
   its local coordinates (x major, z minor), and children are written in
   slot order, depth first, the root's tiles then its children in the order
   of their origins. Leaves land in `leaves` in that order, which is the
   order their buffers follow in. */
const negate = (vt, v) => vt.bits ? v.map(x => x ? 0 : 1) : v.map(x => -x);

async function readTree(src, head, info, { size } = {}){
  const end = size != null ? info.topologyPos + size : info.endPos;
  const c = new Cursor(await src.read(info.topologyPos, end - info.topologyPos), info.topologyPos);
  const vt = VALUE_TYPES[info.value], comps = vt.comps, dims = info.dims, depth = dims.length;
  // total[l]: log2 of the voxels a level-l node spans (0 = the top internal node).
  const total = dims.map((_, l) => dims.slice(l).reduce((a, b) => a + b, 0));
  const g = { vt, half: info.half, compression: info.compression, background: null, negBackground: null };
  const bufferCount = c.i32();
  if (bufferCount !== 1) throw new Damaged(`${bufferCount} buffers a leaf (OpenVDB writes 1)`);
  const bgv = new Float64Array(comps);
  c.need(vt.bytes * comps, 'the background');
  for (let k = 0; k < comps; k++) bgv[k] = vt.get(c.v, c.p + k * vt.bytes);
  c.p += vt.bytes * comps;
  g.background = bgv; g.negBackground = negate(vt, bgv);
  const numTiles = c.u32(), numChildren = c.u32();
  if (numTiles > c.left / (12 + vt.bytes * comps + 1) || numChildren > c.left / 12) throw new Damaged(`${numTiles} root tiles and ${numChildren} children in ${c.left} bytes`);
  const rootTiles = [];
  for (let i = 0; i < numTiles; i++){
    const origin = [c.i32(), c.i32(), c.i32()], value = new Float64Array(comps);
    c.need(vt.bytes * comps + 1, 'a root tile');
    for (let k = 0; k < comps; k++) value[k] = vt.get(c.v, c.p + k * vt.bytes);
    c.p += vt.bytes * comps;
    rootTiles.push({ origin, value, active: c.u8() !== 0 });
  }
  const nodes = [], leafList = [];
  const readNode = (origin, l) => {
    const n = dims[l], slots = 1 << 3 * n, childTotal = l + 1 < depth ? total[l + 1] : 0;
    const node = { origin, level: l, log2: n, childMask: c.mask(slots), valueMask: c.mask(slots), values: new Float32Array(slots * comps), child: new Int32Array(slots).fill(-1) };
    readValues(c, g, slots, node.valueMask, node.values, 0, `a level-${l} node's tiles`);
    const id = nodes.length;
    nodes.push(node);
    for (let w = 0; w < node.childMask.length; w++) for (let word = node.childMask[w]; word; word &= word - 1){
      const i = 32 * w + (31 - Math.clz32(word & -word));
      const o = [origin[0] + ((i >> 2 * n) << childTotal), origin[1] + (((i >> n) & ((1 << n) - 1)) << childTotal), origin[2] + ((i & ((1 << n) - 1)) << childTotal)];
      if (l + 2 < depth) node.child[i] = readNode(o, l + 1);
      else {
        // A leaf's topology is its mask (a bool or mask leaf's too).
        node.child[i] = leafList.length;
        leafList.push({ origin: o, mask: c.mask(1 << 3 * dims[depth - 1]) });
      }
    }
    return id;
  };
  const rootChildren = [];
  for (let i = 0; i < numChildren; i++){
    const origin = [c.i32(), c.i32(), c.i32()];
    if (origin.some(v => v & ((1 << total[0]) - 1))) throw new Damaged(`a root child at ${origin}, not on its grid`);
    rootChildren.push({ origin, node: readNode(origin, 0) });
  }
  const topologyEnd = c.at;
  // Buffers: every leaf in the order read, its mask again then its values.
  const L = dims[depth - 1], leafSlots = 1 << 3 * L, nl = leafList.length;
  const leafOrigin = new Int32Array(3 * nl), leafMask = new Uint32Array(nl * leafSlots / 32), leafValues = new Float32Array(nl * leafSlots * comps);
  for (let j = 0; j < nl; j++){
    const lf = leafList[j];
    leafOrigin.set(lf.origin, 3 * j);
    const again = c.mask(leafSlots);
    if (vt.bits){
      if (vt.mask){
        // LeafNode<ValueMask>: its mask is its values; then its origin.
        c.need(12, 'a mask leaf'); c.p += 12;
        for (let i = 0; i < leafSlots; i++) leafValues[j * leafSlots + i] = isOn(again, i);
        leafMask.set(again, j * leafSlots / 32);
      } else {
        // LeafNode<bool>: the value mask, the origin, then the values as a mask.
        c.need(12, 'a bool leaf'); c.p += 12;
        const data = c.mask(leafSlots);
        for (let i = 0; i < leafSlots; i++) leafValues[j * leafSlots + i] = isOn(data, i);
        leafMask.set(again, j * leafSlots / 32);
      }
    } else {
      leafMask.set(again, j * leafSlots / 32);
      readValues(c, g, leafSlots, again, leafValues, j * leafSlots * comps, 'a leaf\'s values');
    }
    if (!vt.mask) for (let w = 0; w < again.length; w++) if (again[w] !== lf.mask[w]) throw new Damaged('a leaf\'s mask in its buffer isn\'t its mask in the topology');
  }
  if (size == null && c.at !== info.endPos) throw new Damaged(`grid ${info.uniqueName} ends at ${c.at}, its descriptor says ${info.endPos}`);
  return { end: c.at, topologyEnd, vt, comps, dims, total, background: bgv, rootTiles, rootChildren, nodes, leafOrigin, leafMask, leafValues, leafCount: nl, leafLog2: L };
}

/* One grid's tree, with an accessor. An instance reads its parent's tree. */
export async function readGrid(src, file, info){
  if (info.why) throw new Damaged(`${info.uniqueName}: ${info.why}`);
  const from = info.parent ? file.grids.find(p => p.uniqueName === info.parent) : info;
  if (info.parent && from.why) throw new Damaged(`${info.uniqueName}: its parent ${from.uniqueName}: ${from.why}`);
  const tree = await readTree(src, file, from);
  return withAccess(tree);
}

/* ---- asking the tree ---------------------------------------------------------------
   probe(x, y, z, out) writes the voxel's value (comps numbers) into out and
   returns 1 if it's active, 0 if not, the way OpenVDB's accessor answers:
   a leaf's voxel, else the tile of the deepest node holding it, else the
   root's tile, else the background (inactive). The last leaf is cached. */
export function withAccess(tree){
  const { dims, total, comps, nodes, leafOrigin, leafMask, leafValues, leafLog2: L, background } = tree;
  const top = total[0], depth = dims.length;
  const roots = new Map();
  const key = (x, y, z) => `${x},${y},${z}`;
  for (const t of tree.rootTiles) roots.set(key(...t.origin), { tile: t });
  for (const ch of tree.rootChildren) roots.set(key(...ch.origin), { node: ch.node });
  const LS = 1 << 3 * L, LM = (1 << L) - 1, words = LS / 32;
  let cx = 1, cy = 1, cz = 1, cl = -1;          // the cached leaf (an origin no leaf has: odd)
  let rx = 1, ry = 1, rz = 1, re;               // the cached root entry, the same way
  const fromLeaf = (j, x, y, z, out) => {
    const i = ((x & LM) << 2 * L) | ((y & LM) << L) | (z & LM), b = j * LS * comps + i * comps;
    for (let k = 0; k < comps; k++) out[k] = leafValues[b + k];
    return (leafMask[j * words + (i >>> 5)] >>> (i & 31)) & 1;
  };
  function probe(x, y, z, out){
    if ((x & ~LM) === cx && (y & ~LM) === cy && (z & ~LM) === cz) return fromLeaf(cl, x, y, z, out);
    const m = ~((1 << top) - 1);
    if ((x & m) !== rx || (y & m) !== ry || (z & m) !== rz){ rx = x & m; ry = y & m; rz = z & m; re = roots.get(key(rx, ry, rz)); }
    const e = re;
    if (!e){ for (let k = 0; k < comps; k++) out[k] = background[k]; return 0; }
    if (e.tile){ for (let k = 0; k < comps; k++) out[k] = e.tile.value[k]; return e.tile.active ? 1 : 0; }
    let node = nodes[e.node];
    for (let l = 0; ; l++){
      const n = dims[l], below = l + 1 < depth ? total[l + 1] : 0, M = (1 << n) - 1;
      const i = (((x >> below) & M) << 2 * n) | (((y >> below) & M) << n) | ((z >> below) & M), ch = node.child[i];
      if (ch < 0){
        for (let k = 0; k < comps; k++) out[k] = node.values[i * comps + k];
        return (node.valueMask[i >>> 5] >>> (i & 31)) & 1;
      }
      if (l + 2 >= depth){ cx = x & ~LM; cy = y & ~LM; cz = z & ~LM; cl = ch; return fromLeaf(ch, x, y, z, out); }
      node = nodes[ch];
    }
  }
  return { ...tree, probe };
}
