/* VDAG — one or more whole worlds as a file (docs/binaryoutput.md).
   Pure: imports dag-core.js only, and the colour fields are handed in, as
   createJobRunner's are. gzip is the platform's CompressionStream, which
   Node 18+ and every browser this runs in have.

   The file (little-endian; a reader skips the sections it doesn't know):

     'VDAG'  u32 version = 1
     DESC    JSON { worlds: [ { name, desc, view, source, voxels, nodes, print, tableWords } ] }
     ROOT    varint count, then a u8 D per world
     NODE    u8 encoding = 1, u8 compression (0 none, 1 gzip), the graph
     TBLE    one per world with a table: varint world, u8 compression, int32s

   The graph (binaryoutput.md §4), written where each node is first used:

     payload   := ref(D, root) for each world, in order
     ref(l, n) := varint d; d = 0: body(l, n) follows; d > 0: the d-th most
                  recent node of level l
     body(l, n) := mask; then per present child, in octant order:
                   l = 2: the child's mask (level-1 nodes aren't referenced)
                   l > 2: ref(l − 1, child)

   No ids, levels or EMPTYs are written. Where nothing repeats it's a plain
   pointerless octree at one mask a node, and only a real repeat pays for an
   index. The level tables carry on from world to world, so worlds in a file
   share what they share: eight kits are four times smaller in one file than
   in eight (§8). Each world is still whole, with every node, its descriptor,
   its table and its view in the file, and comes back in a store of its own.

   Why the reader trusts nothing: this is the first thing in the viewer that
   reads bytes from outside. decodeGraph refuses a reference past its table,
   a mask of zero, a read past the end and bytes left over, and readVdag
   holds each world to the voxel, node and table sizes written beside it (a
   file cut at a section boundary otherwise lost its last table and still
   read as whole; the truncation test found that). Levels
   come from the walk, so a file can't make a node whose children are at the
   wrong level, and ids come from interning, so they're children-first. Only
   the root of an empty world may have a zero mask.

   What a file does not make whole is colour. A world's colour is a *name*
   (a descriptor, and a table for the scatter and the lattice), resolved by
   this code's colours.js. So the file carries a print of the field: the
   colour at 256 solid voxels chosen by the graph. A reader compares it with
   what its own code gives, and says so when they differ, instead of drawing
   wrong colours with no error (§9's first trap). Baking colour is §6's open
   question, and a later ATTR section would slot in beside these. */
import { createStore, createCounts, prune, storeView, EMPTY, FULL, FIRST_NODE } from './dag-core.js';

export const VDAG_VERSION = 1, MAX_D = 30, PRINT_SAMPLES = 256;
// A gzip bomb stops here instead of taking the tab down. The largest world
// measured, a billion coin flips, is 172 MB of payload.
const MAX_PAYLOAD = 2 ** 31;
const ENCODING_INLINE = 1, COMPRESS_NONE = 0, COMPRESS_GZIP = 1;
const enc = new TextEncoder(), dec = new TextDecoder();

class Writer {
  constructor(cap = 1 << 16){ this.a = new Uint8Array(cap); this.n = 0; }
  room(k){
    if (this.n + k <= this.a.length) return;
    let c = this.a.length * 2;
    while (c < this.n + k) c *= 2;
    const g = new Uint8Array(c);
    g.set(this.a.subarray(0, this.n));
    this.a = g;
  }
  u8(v){ this.room(1); this.a[this.n++] = v; }
  u32(v){ this.room(4); new DataView(this.a.buffer).setUint32(this.n, v, true); this.n += 4; }
  // LEB128, by division: a back-reference in a noise world passes 2^24.
  varint(v){ this.room(8); while (v >= 128){ this.a[this.n++] = v % 128 + 128; v = Math.floor(v / 128); } this.a[this.n++] = v; }
  bytes(b){ this.room(b.length); this.a.set(b, this.n); this.n += b.length; }
  done(){ return this.a.slice(0, this.n); }
}
const damaged = why => new Error(`the file is damaged: ${why}`);
function varintAt(b, r){
  let v = 0, m = 1, x;
  do {
    if (r.p >= b.length) throw damaged('it ends in the middle of a number');
    x = b[r.p++];
    v += (x & 127) * m;
    m *= 128;
    if (m > 2 ** 49) throw damaged('a number is too long');
  } while (x >= 128);
  return v;
}

/* ---- the graph ---------------------------------------------------------------
   `store` needs child and maxId only, so a storeView does. Both recursions
   are no deeper than D. */
export function encodeGraph(store, roots, Ds){
  const w = new Writer(Math.max(1 << 12, store.maxId * 4)), where = new Int32Array(store.maxId + 1).fill(-1);
  const counts = new Float64Array(MAX_D + 1);
  const maskOf = id => { let m = 0; for (let o = 0; o < 8; o++) if (store.child(id, o) !== EMPTY) m |= 1 << o; return m; };
  const body = (l, id) => {
    const m = maskOf(id);
    w.u8(m);
    if (l === 1) return;
    for (let o = 0; o < 8; o++){
      if (!(m >> o & 1)) continue;
      const c = store.child(id, o);
      if (l === 2) w.u8(maskOf(c)); else ref(l - 1, c);
    }
  };
  const ref = (l, id) => {
    if (where[id] >= 0){ w.varint(counts[l] - where[id]); return; }
    w.varint(0);
    body(l, id);
    where[id] = counts[l]++;
  };
  roots.forEach((r, i) => {
    // An empty world is "new, no children", and takes no table entry.
    if (r === EMPTY){ w.varint(0); w.u8(0); return; }
    ref(Ds[i], r);
  });
  return w.done();
}
export function decodeGraph(bytes, Ds, store = createStore()){
  const tables = Array.from({ length: MAX_D + 1 }, () => []), buf = Array.from({ length: MAX_D + 1 }, () => new Uint32Array(8));
  const leafs = new Uint32Array(256), bits = new Uint32Array(8), r = { p: 0 };
  const maskAt = () => {
    if (r.p >= bytes.length) throw damaged('the graph ends early');
    const m = bytes[r.p++];
    if (!m) throw damaged('a node has no children');
    return m;
  };
  const leaf = m => {
    if (leafs[m]) return leafs[m];
    for (let o = 0; o < 8; o++) bits[o] = m >> o & 1 ? FULL : EMPTY;
    return leafs[m] = store.intern(1, bits);
  };
  const body = (l, m) => {
    if (l === 1) return leaf(m);
    const ch = buf[l];
    for (let o = 0; o < 8; o++) ch[o] = !(m >> o & 1) ? EMPTY : l === 2 ? leaf(maskAt()) : ref(l - 1);
    return store.intern(l, ch);
  };
  const ref = l => {
    const d = varintAt(bytes, r), t = tables[l];
    if (d){
      if (d > t.length) throw damaged(`a reference points ${d} back at level ${l}, past the ${t.length} nodes before it`);
      return t[t.length - d];
    }
    const id = body(l, maskAt());
    t.push(id);
    return id;
  };
  const roots = Ds.map(D => {
    // The one place a mask may be zero: the root of an empty world.
    if (r.p + 1 < bytes.length && bytes[r.p] === 0 && bytes[r.p + 1] === 0){ r.p += 2; return EMPTY; }
    return ref(D);
  });
  if (r.p !== bytes.length) throw damaged(`${bytes.length - r.p} bytes follow the graph`);
  return { store, roots };
}

/* ---- the colour's print --------------------------------------------------------
   PRINT_SAMPLES walks from the root, each turning at every level into a
   present octant the hash picks, so every walk ends on a solid voxel and
   empty air (most of a lattice's cube) costs nothing. The walk reads the
   graph's shape and never an id, so a world gives the same voxels in any
   store. A change confined to a few places can slip between the samples: this
   catches a plan or a palette that moved, not a single altered voxel. */
export function printVoxels(store, root, D, n = PRINT_SAMPLES){
  const out = [];
  if (root === EMPTY) return out;
  let h = 0x9e3779b9;
  const present = new Uint8Array(8);
  for (let i = 0; i < n; i++){
    let id = root, x = 0, y = 0, z = 0;
    for (let k = D - 1; k >= 0; k--){
      let m = 0;
      for (let o = 0; o < 8; o++) if (store.child(id, o) !== EMPTY) present[m++] = o;
      h = Math.imul(h ^ h >>> 15, 0x2c1b3c6d) + 0x6d2b79f5 | 0;
      h ^= h >>> 13;
      const o = present[(h >>> 0) % m];
      x |= (o & 1) << k; y |= (o >> 1 & 1) << k; z |= (o >> 2) << k;
      id = store.child(id, o);
    }
    out.push([x, y, z]);
  }
  return out;
}
export function colourPrint(store, root, D, field){
  let h = 0x811c9dc5;
  for (const [x, y, z] of printVoxels(store, root, D)){
    h = Math.imul(h ^ field(x + 0.5, y + 0.5, z + 0.5), 0x01000193);
    h ^= h >>> 15;
  }
  return h >>> 0;
}
/* What the reader's code makes of a file's colour:
     'same'       its print matches: the colours are the ones written
     'changed'    the field exists, and gives other colours than the writer's
     'unknown'    this code can't make the field at all, so no colour
     'unchecked'  no print to compare (the experiment's first files), or no
                  colourOf was handed in
     'none'       the file names no colour */
export function resolveColour(store, root, D, colour, print, colourOf){
  if (!colour) return { colour: null, status: 'none' };
  if (!colourOf) return { colour, status: 'unchecked' };
  let now;
  try { now = colourPrint(store, root, D, colourOf(colour)); }
  catch { return { colour: null, status: 'unknown' }; }
  return { colour, status: print == null ? 'unchecked' : print === now ? 'same' : 'changed' };
}

/* ---- gzip ---------------------------------------------------------------------- */
async function pump(bytes, transform, limit = Infinity){
  const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader(), chunks = [];
  let total = 0;
  for (;;){
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit){ await reader.cancel(); throw damaged(`it unpacks to more than ${limit / 2 ** 30} GB`); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks){ out.set(c, p); p += c.length; }
  return out;
}
const gzip = bytes => pump(bytes, new CompressionStream('gzip'));
const gunzip = async bytes => {
  try { return await pump(bytes, new DecompressionStream('gzip'), MAX_PAYLOAD); }
  catch (e){ throw e.message.startsWith('the file is damaged') ? e : damaged('a compressed section doesn\'t unpack'); }
};
// gzip only where it wins: a tiny world's gzip header outweighs it.
async function packed(bytes){
  const z = await gzip(bytes);
  return z.length < bytes.length ? { code: COMPRESS_GZIP, bytes: z } : { code: COMPRESS_NONE, bytes };
}
function unpacked(code, bytes){
  if (code === COMPRESS_GZIP) return gunzip(bytes);
  if (code === COMPRESS_NONE) return bytes;
  throw new Error(`unknown compression ${code}: the file is from a newer version`);
}

/* ---- the file ---------------------------------------------------------------------
   writeVdag(worlds): each world is { keys, root, D, name, colour, view, source }.
   keys are a snapshot's (9 words a node, children first), and may hold nodes
   the root doesn't reach, since the file is written by walking from the
   roots. colour is the descriptor the world's snapshot carries, table
   included; it's split apart here so the table isn't JSON.

   The bytes are the same for the same worlds in the same order, whatever
   built them: ids don't reach the file, and the walk is in octant order. */
export async function writeVdag(worlds, { colourOf = null, onPhase = () => {} } = {}){
  if (!worlds.length) throw new Error('no worlds to write');
  const entries = [], Ds = [], tables = [];
  // One world needs no merging; several go in one store, where hash-consing
  // finds what they share.
  const shared = worlds.length > 1 ? createStore() : null;
  let store = shared;
  const roots = worlds.map((w, i) => {
    if (!Number.isInteger(w.D) || w.D < 1 || w.D > MAX_D) throw new Error(`D must be 1 to ${MAX_D}, not ${w.D}`);
    onPhase(`preparing world ${i + 1} of ${worlds.length}`, i / worlds.length);
    const { keys, map } = prune(w.keys, [w.root]), view = storeView({ keys }), root = map[w.root];
    const { table = null, ...desc } = w.colour ?? {};
    let print = null;
    if (w.colour && colourOf){
      try { print = colourPrint(view, root, w.D, colourOf(w.colour)); }
      catch { print = null; }   // a field this code can't make: the reader will say so
    }
    entries.push({ name: String(w.name ?? ''), desc: w.colour ? desc : null, view: w.view ?? null, source: w.source ?? null,
                   voxels: createCounts(view).of(root), nodes: keys.length / 9, print, tableWords: table ? table.length : 0 });
    Ds.push(w.D);
    tables.push(table);
    if (!shared){ store = view; return root; }
    return root === EMPTY ? EMPTY : shared.importKeys(keys)[root];
  });
  onPhase('writing the graph', 0.5);
  const graph = await packed(encodeGraph(store, roots, Ds));
  const out = new Writer(graph.bytes.length + 4096);
  const section = (tag, b) => { out.bytes(enc.encode(tag)); out.u32(b.length); out.bytes(b); };
  out.bytes(enc.encode('VDAG')); out.u32(VDAG_VERSION);
  section('DESC', enc.encode(JSON.stringify({ worlds: entries })));
  const rootsOut = new Writer(16);
  rootsOut.varint(Ds.length);
  for (const d of Ds) rootsOut.u8(d);
  section('ROOT', rootsOut.done());
  const node = new Uint8Array(2 + graph.bytes.length);
  node[0] = ENCODING_INLINE; node[1] = graph.code; node.set(graph.bytes, 2);
  section('NODE', node);
  for (let i = 0; i < tables.length; i++){
    if (!tables[i]) continue;
    onPhase(`writing table ${i + 1}`, 0.8);
    const t = tables[i], z = await packed(new Uint8Array(t.buffer, t.byteOffset, t.byteLength)), head = new Writer(16);
    head.varint(i); head.u8(z.code);
    const b = head.done(), body = new Uint8Array(b.length + z.bytes.length);
    body.set(b); body.set(z.bytes, b.length);
    section('TBLE', body);
  }
  return out.done();
}

function sectionsOf(file){
  if (file.length < 8 || dec.decode(file.subarray(0, 4)) !== 'VDAG') throw new Error('not a world file (no VDAG header)');
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength), version = dv.getUint32(4, true);
  if (version !== VDAG_VERSION) throw new Error(`this is a version ${version} world file, and this page reads version ${VDAG_VERSION}`);
  const parts = {}, tables = [];
  for (let p = 8; p < file.length;){
    if (p + 8 > file.length) throw damaged('it ends inside a section header');
    const tag = dec.decode(file.subarray(p, p + 4)), n = dv.getUint32(p + 4, true);
    if (p + 8 + n > file.length) throw damaged(`section ${tag} runs past the end`);
    const b = file.subarray(p + 8, p + 8 + n);
    if (tag === 'TBLE') tables.push(b); else parts[tag] = b;
    p += 8 + n;
  }
  for (const tag of ['DESC', 'ROOT', 'NODE']) if (!parts[tag]) throw damaged(`it has no ${tag} section`);
  return { parts, tables };
}
const asInt32 = bytes => {
  if (bytes.length % 4) throw damaged('a table isn\'t whole 32-bit words');
  return new Int32Array(bytes.slice().buffer);
};
const finite = v => typeof v === 'number' && Number.isFinite(v);
const goodView = v => v && Array.isArray(v.eye) && v.eye.length === 3 && v.eye.every(finite) && finite(v.yaw) && finite(v.pitch)
  ? { eye: v.eye.slice(), yaw: v.yaw, pitch: v.pitch } : null;
const goodSource = s => s && typeof s.world === 'string'
  ? { world: s.world, depth: Number.isInteger(s.depth) ? s.depth : null,
      lattice: typeof s.lattice === 'string' ? s.lattice : null, kit: typeof s.kit === 'string' ? s.kit : null } : null;

/* readVdag(bytes): the file's worlds, each pruned to a store of its own:
   { name, D, root, keys, colour, colourStatus, view, source, voxels, nodes }.
   keys are children-first, ready for storeView or importKeys.

   The experiment's files (binaryoutput.mjs, worlds/*.vdag) are version 1 as
   well, from before there was a list: DESC is one world's bare descriptor,
   with no name, view or counts, and TBLE is that world's gzipped table with
   no header. They still open. */
export async function readVdag(input, { colourOf = null, onPhase = () => {} } = {}){
  const file = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { parts, tables } = sectionsOf(file);
  let manifest;
  try { manifest = JSON.parse(dec.decode(parts.DESC)); } catch { throw damaged('its DESC section isn\'t JSON'); }
  if (manifest === null || typeof manifest !== 'object') throw damaged('its DESC section isn\'t a world list');
  const bare = !Array.isArray(manifest.worlds), entries = bare ? [{ desc: manifest }] : manifest.worlds;

  const r = { p: 0 }, count = varintAt(parts.ROOT, r);
  if (count !== entries.length) throw damaged(`it lists ${entries.length} worlds and has ${count} roots`);
  if (r.p + count !== parts.ROOT.length) throw damaged('its ROOT section is the wrong length');
  const Ds = Array.from({ length: count }, () => parts.ROOT[r.p++]);
  for (const D of Ds) if (D < 1 || D > MAX_D) throw damaged(`a world has D = ${D}`);

  if (parts.NODE.length < 2) throw damaged('its NODE section is empty');
  if (parts.NODE[0] !== ENCODING_INLINE) throw new Error(`unknown node encoding ${parts.NODE[0]}: the file is from a newer version`);
  onPhase('unpacking', 0.1);
  const payload = await unpacked(parts.NODE[1], parts.NODE.subarray(2));
  onPhase('reading the graph', 0.3);
  const { store, roots } = decodeGraph(payload, Ds);

  const tableOf = new Array(count).fill(null);
  for (const t of tables){
    if (bare){ tableOf[0] = asInt32(await gunzip(t)); continue; }
    const q = { p: 0 }, i = varintAt(t, q);
    if (i >= count || q.p >= t.length) throw damaged('a table names a world that isn\'t there');
    const code = t[q.p++];
    tableOf[i] = asInt32(await unpacked(code, t.subarray(q.p)));
  }

  const all = store.snapshot().keys, worlds = [];
  for (let i = 0; i < count; i++){
    onPhase(`checking world ${i + 1} of ${count}`, 0.6 + 0.4 * i / count);
    const e = entries[i] ?? {}, { keys, map } = prune(all, [roots[i]]), root = map[roots[i]], view = storeView({ keys }), D = Ds[i];
    const nodes = keys.length / 9, voxels = createCounts(view).of(root);
    if (!bare && (e.nodes !== nodes || e.voxels !== voxels))
      throw damaged(`world ${i + 1} has ${voxels} voxels in ${nodes} nodes, not the ${e.voxels} in ${e.nodes} it says`);
    if (!bare && (e.tableWords ?? 0) !== (tableOf[i] ? tableOf[i].length : 0))
      throw damaged(`world ${i + 1}'s table has ${tableOf[i] ? tableOf[i].length : 0} words, not the ${e.tableWords} it says`);
    const desc = e.desc && typeof e.desc === 'object' ? e.desc : null;
    const named = desc && tableOf[i] ? { ...desc, table: tableOf[i] } : desc;
    const { colour, status } = resolveColour(view, root, D, named, typeof e.print === 'number' ? e.print : null, colourOf);
    worlds.push({ name: typeof e.name === 'string' ? e.name.slice(0, 200) : '', D, root, keys, colour, colourStatus: status,
                  view: goodView(e.view), source: goodSource(e.source), voxels, nodes });
  }
  return { worlds, bytes: file.length };
}
