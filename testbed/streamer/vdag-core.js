/* VDAG — one or more whole worlds as a file (docs/binaryoutput.md).
   Pure: imports dag-core.js, and attr-core.js's to6 for baked words at six
   bits (below); the colour fields are handed in, as createJobRunner's are. gzip is the platform's CompressionStream, which
   Node 18+ and every browser this runs in have.

   The file (little-endian; a reader skips the sections it doesn't know):

     'VDAG'  u32 version = 1
     DESC    JSON { worlds: [ { name, desc, view, source, voxels, nodes, print, tableWords, skin? } ] }
     ROOT    varint count, then a u8 D per world
     NODE    u8 encoding = 1, u8 compression (0 none, 1 gzip), the graph
     TBLE    one per world with a table: varint world, u8 compression, int32s
     ATTR    one per baked world (below): varint world;
             u8 skin encoding = 1, u8 compression, varint n, n bytes: the skin;
             u8 word encoding (1 eight bits, 2 six), u8 compression, the words

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

   Colour, named. A world's colour is usually a *name* (a descriptor, and a
   table for the scatter and the lattice), resolved by this code's
   colours.js. So the file carries a print of the field: the colour at 256
   solid voxels chosen by the graph. A reader compares it with what its own
   code gives, and says so when they differ, instead of drawing wrong
   colours with no error (§9's first trap).

   Colour, baked (docs/glb-colour-plan.md step 4). An imported asset's
   colours are data: a word per *skin* voxel (every voxel that can show;
   baked-core.js), in the skin's rank order, which is its Morton order. Its
   descriptor is { kind: 'baked', skin, words, bits }: `skin` the skin's
   root in the world's keys (the shape's own root when the world is hollow),
   `words` a Uint32Array of rgb8, `bits` 8 (the default) or 6, the depth the
   file keeps them at. In the file:
     - DESC says { kind: 'baked' } and `skin: { voxels, nodes }`, so a file
       cut before its ATTR, or an ATTR that lost its world, is refused;
     - the skin is one more payload, ref(D, skin), that *continues NODE's
       level tables*, so it pays only for the nodes the shape doesn't have.
       At D = 10 that took the pack's skin from 530 KB of graph on its own to
       about 230 KB (thin pieces: much of the skin is the shape); the
       characters' skins share little and gain 2% (glb-colour-log §4). A
       hollow world's skin is the shape: one back-reference. Each ATTR
       continues from where NODE ended and forgets its own nodes after, so
       the sections don't depend on each other or on their order;
     - the words, 4 bytes each, gzipped, at one of two depths:
         1  eight bits a channel, as baked;
         2  six bits a channel (`bits: 6` on the descriptor), the depth a
            word has on screen (attr-core.js): each channel byte is to6 of
            the baked one, 0–63, and the high byte (a material, E4) is kept
            whole. The reader widens a channel back to round(q · 255 / 63),
            which to6 maps to q again, so every lod-0 word the job draws is
            the one eight bits gives; only coarse means, which now average
            widened values, can land a step off. It made the words 40–67%
            smaller on three assets at D = 10 (the low two bits are mostly a
            texture's noise, which gzip can't squeeze), and it's what
            mesh-vdag writes by default (glb-colour-log §5).
       A predictor before the gzip (each channel's difference from the word
       before), planes, three bytes a word and a palette were all tried on
       eight-bit words: none won by more than 10%, and none won on every
       asset (the log, §4).
   The reader holds a baked world to: the skin inside the shape (by union),
   its voxels and nodes as DESC says, exactly a word a skin voxel, and the
   print, here of the file's own words (a word by rank at 256 skin voxels):
   nothing in this code can go stale for a baked world, so a mismatch means
   the skin and the words don't belong together, and the file is refused.
   An older reader skips ATTR, can't make { kind: 'baked' } and draws the
   shape with no colour, which is what "unknown" already means. */
import { createStore, createCounts, prune, storeView, EMPTY, FULL, FIRST_NODE } from './dag-core.js';
import { to6 } from './attr-core.js';

export const VDAG_VERSION = 1, MAX_D = 30, PRINT_SAMPLES = 256;
// A gzip bomb stops here instead of taking the tab down. The largest world
// measured, a billion coin flips, is 172 MB of payload.
const MAX_PAYLOAD = 2 ** 31;
const ENCODING_INLINE = 1, COMPRESS_NONE = 0, COMPRESS_GZIP = 1;
// ATTR's encodings: the skin goes on from NODE's level tables; the words are as baked.
const SKIN_CONTINUES = 1, WORDS_RAW = 1, WORDS_SIX = 2;
/* Six bits a channel: the stored word holds to6 of each channel in its
   byte, the high byte as it was; widening maps q back to the 8-bit value
   nearest q's centre, round(q · 255 / 63), and to6 of that is q (the error
   is at most 0.5 · 63/255 = 0.12 of a step). */
const WIDEN6 = Uint8Array.from({ length: 64 }, (_, q) => Math.round(q * 255 / 63));
const narrow6 = w => (to6(w & 255) | to6(w >> 8 & 255) << 8 | to6(w >> 16 & 255) << 16 | (w & 0xff000000)) >>> 0;
const widen6 = w => (WIDEN6[w & 63] | WIDEN6[w >> 8 & 63] << 8 | WIDEN6[w >> 16 & 63] << 16 | (w & 0xff000000)) >>> 0;
// What a six-bit file gives back for these words: the job draws these.
export const sixBitWords = words => words.map(w => widen6(narrow6(w)));
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
   are no deeper than D.

   A coder keeps its level tables from payload to payload: NODE's payload is
   every world's root, and a baked world's skin is a payload of its own that
   goes on from NODE's tables (ATTR). `aside` codes one such payload and then
   forgets the nodes it added, so each ATTR goes on from NODE alone. */
export function graphEncoder(store){
  const where = new Int32Array(store.maxId + 1).fill(-1), counts = new Float64Array(MAX_D + 1);
  const maskOf = id => { let m = 0; for (let o = 0; o < 8; o++) if (store.child(id, o) !== EMPTY) m |= 1 << o; return m; };
  let w = null, added = null;
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
    if (added) added.push(id);
  };
  const code = (roots, Ds, cap) => {
    w = new Writer(cap);
    roots.forEach((r, i) => {
      // An empty world is "new, no children", and takes no table entry.
      if (r === EMPTY){ w.varint(0); w.u8(0); return; }
      ref(Ds[i], r);
    });
    const out = w.done();
    w = null;
    return out;
  };
  return {
    encode: (roots, Ds) => code(roots, Ds, Math.max(1 << 12, store.maxId * 4)),
    aside(roots, Ds){
      const saved = counts.slice();
      added = [];
      const out = code(roots, Ds, 1 << 12);
      for (const id of added) where[id] = -1;
      counts.set(saved);
      added = null;
      return out;
    },
  };
}
export const encodeGraph = (store, roots, Ds) => graphEncoder(store).encode(roots, Ds);

export function graphDecoder(store = createStore()){
  const tables = Array.from({ length: MAX_D + 1 }, () => []), buf = Array.from({ length: MAX_D + 1 }, () => new Uint32Array(8));
  const leafs = new Uint32Array(256), bits = new Uint32Array(8);
  let bytes = null, r = null;
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
  const decode = (b, Ds) => {
    bytes = b; r = { p: 0 };
    const roots = Ds.map(D => {
      // The one place a mask may be zero: the root of an empty world.
      if (r.p + 1 < bytes.length && bytes[r.p] === 0 && bytes[r.p + 1] === 0){ r.p += 2; return EMPTY; }
      return ref(D);
    });
    if (r.p !== bytes.length) throw damaged(`${bytes.length - r.p} bytes follow the graph`);
    bytes = r = null;
    return roots;
  };
  return {
    store,
    decode,
    // The nodes an aside payload made stay in the store; only the tables
    // forget them, as the encoder's did.
    aside(b, Ds){
      const lengths = tables.map(t => t.length);
      try { return decode(b, Ds); }
      finally { tables.forEach((t, l) => { t.length = lengths[l]; }); }
    },
  };
}
export function decodeGraph(bytes, Ds, store = createStore()){
  const d = graphDecoder(store);
  return { store, roots: d.decode(bytes, Ds) };
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
/* A baked world's field as the file holds it: a voxel's word by its rank in
   the skin (the octants before it summed level by level, store.child's
   order), 0 off the skin. Only the print asks it, so it walks plainly;
   baked-core.js is the field the job draws. The whole word goes into the
   print, the high byte (a material, E4) included: it's the file's data. */
export function bakedWord(store, skin, D, words, counts = createCounts(store), as = w => w){
  return (x, y, z) => {
    x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
    let id = skin, r = 0;
    for (let k = D - 1; k >= 0 && id !== EMPTY; k--){
      const o = (x >> k & 1) | (y >> k & 1) << 1 | (z >> k & 1) << 2;
      for (let j = 0; j < o; j++){ const c = store.child(id, j); if (c !== EMPTY) r += counts.of(c); }
      id = store.child(id, o);
    }
    return id === EMPTY ? 0 : as(words[r]);
  };
}
// Over the skin's own voxels: on a thick body most of the shape's are inside.
// `as` maps a word to what the reader will hold (a six-bit file's widened word).
export const bakedPrint = (store, skin, D, words, as) => colourPrint(store, skin, D, bakedWord(store, skin, D, words, undefined, as));
/* What the reader's code makes of a file's colour:
     'same'       its print matches: the colours are the ones written
     'changed'    the field exists, and gives other colours than the writer's
     'unknown'    this code can't make the field at all, so no colour
     'unchecked'  no print to compare (the experiment's first files), or no
                  colourOf was handed in
     'none'       the file names no colour
   (readVdag gives a baked world 'baked', without coming here: its colours
   are the file's own, and a print that doesn't match them is damage.) */
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
   included; it's split apart here so the table isn't JSON. A baked colour,
   { kind: 'baked', skin, words }, has its skin's nodes in the same keys.

   The bytes are the same for the same worlds in the same order, whatever
   built them: ids don't reach the file, and the walk is in octant order. */
const reach = (keys, roots) => prune(keys, roots).keys.length / 9;
export async function writeVdag(worlds, { colourOf = null, onPhase = () => {} } = {}){
  if (!worlds.length) throw new Error('no worlds to write');
  const entries = [], Ds = [], tables = [], bakes = [];
  // One world needs no merging; several go in one store, where hash-consing
  // finds what they share.
  const shared = worlds.length > 1 ? createStore() : null;
  let store = shared;
  const roots = worlds.map((w, i) => {
    if (!Number.isInteger(w.D) || w.D < 1 || w.D > MAX_D) throw new Error(`D must be 1 to ${MAX_D}, not ${w.D}`);
    onPhase(`preparing world ${i + 1} of ${worlds.length}`, i / worlds.length);
    const { table = null, skin = null, words = null, bits = 8, ...desc } = w.colour ?? {}, baked = desc.kind === 'baked';
    const { keys, map } = prune(w.keys, baked ? [w.root, skin] : [w.root]), view = storeView({ keys }), root = map[w.root];
    const counts = createCounts(view);
    let print = null, bake = null;
    if (baked){
      if (!(words instanceof Uint32Array)) throw new Error('a baked colour\'s words must be a Uint32Array');
      const s = map[skin];
      if (skin !== EMPTY && !s) throw new Error('a baked colour\'s skin isn\'t in the world\'s keys');
      if (s !== EMPTY && view.levelOf(s) !== w.D) throw new Error(`a baked colour's skin is level ${view.levelOf(s)}, not ${w.D}`);
      const voxels = s === EMPTY ? 0 : counts.of(s);
      if (voxels !== words.length) throw new Error(`a baked colour has ${words.length} words for ${voxels} skin voxels`);
      if (bits !== 6 && bits !== 8) throw new Error(`a baked colour is 6 or 8 bits a channel, not ${bits}`);
      bake = { skin: s, words, bits, entry: { voxels, nodes: reach(keys, [s]) } };
      // The print is of the words the reader will hold.
      print = bakedPrint(view, s, w.D, words, bits === 6 ? x => widen6(narrow6(x)) : undefined);
    } else if (w.colour && colourOf){
      try { print = colourPrint(view, root, w.D, colourOf(w.colour)); }
      catch { print = null; }   // a field this code can't make: the reader will say so
    }
    entries.push({ name: String(w.name ?? ''), desc: w.colour ? desc : null, view: w.view ?? null, source: w.source ?? null,
                   voxels: counts.of(root), nodes: baked ? reach(keys, [root]) : keys.length / 9, print,
                   tableWords: table ? table.length : 0, ...(bake ? { skin: bake.entry } : {}) });
    Ds.push(w.D);
    tables.push(table);
    bakes.push(bake);
    if (!shared){ store = view; return root; }
    const m = shared.importKeys(keys);
    if (bake) bake.skin = bake.skin === EMPTY ? EMPTY : m[bake.skin];
    return root === EMPTY ? EMPTY : m[root];
  });
  onPhase('writing the graph', 0.5);
  const coder = graphEncoder(store), graph = await packed(coder.encode(roots, Ds));
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
  for (let i = 0; i < bakes.length; i++){
    if (!bakes[i]) continue;
    onPhase(`writing world ${i + 1}'s colours`, 0.9);
    const { skin, bits } = bakes[i], words = bits === 6 ? bakes[i].words.map(narrow6) : bakes[i].words;
    const sk = await packed(coder.aside([skin], [Ds[i]])), wd = await packed(new Uint8Array(words.buffer, words.byteOffset, words.byteLength));
    const a = new Writer(16 + sk.bytes.length + wd.bytes.length);
    a.varint(i); a.u8(SKIN_CONTINUES); a.u8(sk.code); a.varint(sk.bytes.length); a.bytes(sk.bytes);
    a.u8(bits === 6 ? WORDS_SIX : WORDS_RAW); a.u8(wd.code); a.bytes(wd.bytes);
    section('ATTR', a.done());
  }
  return out.done();
}

function sectionsOf(file){
  if (file.length < 8 || dec.decode(file.subarray(0, 4)) !== 'VDAG') throw new Error('not a world file (no VDAG header)');
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength), version = dv.getUint32(4, true);
  if (version !== VDAG_VERSION) throw new Error(`this is a version ${version} world file, and this page reads version ${VDAG_VERSION}`);
  const parts = {}, tables = [], attrs = [];
  for (let p = 8; p < file.length;){
    if (p + 8 > file.length) throw damaged('it ends inside a section header');
    const tag = dec.decode(file.subarray(p, p + 4)), n = dv.getUint32(p + 4, true);
    if (p + 8 + n > file.length) throw damaged(`section ${tag} runs past the end`);
    const b = file.subarray(p + 8, p + 8 + n);
    if (tag === 'TBLE') tables.push(b); else if (tag === 'ATTR') attrs.push(b); else parts[tag] = b;
    p += 8 + n;
  }
  for (const tag of ['DESC', 'ROOT', 'NODE']) if (!parts[tag]) throw damaged(`it has no ${tag} section`);
  return { parts, tables, attrs };
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

   A baked world's colour is { kind: 'baked', skin, words, bits }, its keys hold
   the skin's nodes as well as the shape's (skin is an id in them), and its
   status is 'baked': the skin and words passed every check in the header,
   print included. A six-bit file's words come back widened (bits: 6), and
   writing them again at six bits gives the same bytes. `nodes` and `voxels` are still the shape's, as DESC says.

   The experiment's files (binaryoutput.mjs, worlds/*.vdag) are version 1 as
   well, from before there was a list: DESC is one world's bare descriptor,
   with no name, view or counts, and TBLE is that world's gzipped table with
   no header. They still open. */
export async function readVdag(input, { colourOf = null, onPhase = () => {} } = {}){
  const file = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { parts, tables, attrs } = sectionsOf(file);
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
  const coder = graphDecoder(), store = coder.store, roots = coder.decode(payload, Ds);

  const tableOf = new Array(count).fill(null);
  for (const t of tables){
    if (bare){ tableOf[0] = asInt32(await gunzip(t)); continue; }
    const q = { p: 0 }, i = varintAt(t, q);
    if (i >= count || q.p >= t.length) throw damaged('a table names a world that isn\'t there');
    const code = t[q.p++];
    tableOf[i] = asInt32(await unpacked(code, t.subarray(q.p)));
  }

  // Baked colours: each skin goes on from NODE's tables, then they forget it.
  const bakedOf = new Array(count).fill(null);
  for (const a of attrs){
    if (bare) throw damaged('a file from before world lists has an ATTR section');
    const q = { p: 0 }, i = varintAt(a, q);
    if (i >= count) throw damaged('an ATTR section names a world that isn\'t there');
    if (bakedOf[i]) throw damaged(`world ${i + 1} has two ATTR sections`);
    onPhase(`reading world ${i + 1}'s colours`, 0.4);
    if (q.p + 2 > a.length) throw damaged('an ATTR section ends early');
    if (a[q.p] !== SKIN_CONTINUES) throw new Error(`unknown skin encoding ${a[q.p]}: the file is from a newer version`);
    const skinCode = a[q.p + 1];
    q.p += 2;
    const n = varintAt(a, q);
    if (q.p + n + 2 > a.length) throw damaged('an ATTR section ends early');
    const [skin] = coder.aside(await unpacked(skinCode, a.subarray(q.p, q.p + n)), [Ds[i]]);
    q.p += n;
    const wordEnc = a[q.p];
    if (wordEnc !== WORDS_RAW && wordEnc !== WORDS_SIX) throw new Error(`unknown word encoding ${wordEnc}: the file is from a newer version`);
    const wordCode = a[q.p + 1], bytes = await unpacked(wordCode, a.subarray(q.p + 2));
    if (bytes.length % 4) throw damaged('a baked colour isn\'t whole 32-bit words');
    // gunzip's bytes are ours to keep; stored ones are a view into the file, and may sit at any offset.
    const words = new Uint32Array(wordCode === COMPRESS_GZIP ? bytes.buffer : bytes.slice().buffer);
    if (wordEnc === WORDS_SIX){
      for (let j = 0; j < words.length; j++){
        const w = words[j];
        if (w & 0xc0c0c0) throw damaged('a six-bit baked colour has a channel past 63');
        words[j] = widen6(w);
      }
    }
    bakedOf[i] = { skin, words, bits: wordEnc === WORDS_SIX ? 6 : 8 };
  }
  for (let i = 0; i < count; i++){
    const e = entries[i] ?? {}, says = !bare && (e.skin != null || e.desc?.kind === 'baked');
    if (says !== !!bakedOf[i] || (says && !(e.skin && e.desc?.kind === 'baked')))
      throw damaged(bakedOf[i] ? `world ${i + 1} has baked colours its description doesn't mention` : `world ${i + 1}'s baked colours are missing`);
    // Before the snapshot: a union that finds voxels outside the shape makes nodes.
    if (bakedOf[i] && store.union(roots[i], bakedOf[i].skin) !== roots[i]) throw damaged(`world ${i + 1}'s skin isn't inside its shape`);
  }

  const all = store.snapshot().keys, worlds = [];
  for (let i = 0; i < count; i++){
    onPhase(`checking world ${i + 1} of ${count}`, 0.6 + 0.4 * i / count);
    const e = entries[i] ?? {}, b = bakedOf[i], D = Ds[i];
    let { keys, map } = prune(all, [roots[i]]);
    const nodes = keys.length / 9;
    if (b) ({ keys, map } = prune(all, [roots[i], b.skin]));
    const root = map[roots[i]], view = storeView({ keys }), counts = createCounts(view), voxels = counts.of(root);
    if (!bare && (e.nodes !== nodes || e.voxels !== voxels))
      throw damaged(`world ${i + 1} has ${voxels} voxels in ${nodes} nodes, not the ${e.voxels} in ${e.nodes} it says`);
    if (!bare && (e.tableWords ?? 0) !== (tableOf[i] ? tableOf[i].length : 0))
      throw damaged(`world ${i + 1}'s table has ${tableOf[i] ? tableOf[i].length : 0} words, not the ${e.tableWords} it says`);
    let colour, status;
    if (b){
      const skin = map[b.skin], sv = skin === EMPTY ? 0 : counts.of(skin), sn = reach(all, [b.skin]);
      if (e.skin.voxels !== sv || e.skin.nodes !== sn)
        throw damaged(`world ${i + 1}'s skin has ${sv} voxels in ${sn} nodes, not the ${e.skin.voxels} in ${e.skin.nodes} it says`);
      if (b.words.length !== sv) throw damaged(`world ${i + 1} has ${b.words.length} baked words for ${sv} skin voxels`);
      if (e.print !== bakedPrint(view, skin, D, b.words)) throw damaged(`world ${i + 1}'s baked colours don't match their print`);
      colour = { kind: 'baked', skin, words: b.words, bits: b.bits }; status = 'baked';
    } else {
      const desc = e.desc && typeof e.desc === 'object' ? e.desc : null;
      const named = desc && tableOf[i] ? { ...desc, table: tableOf[i] } : desc;
      ({ colour, status } = resolveColour(view, root, D, named, typeof e.print === 'number' ? e.print : null, colourOf));
    }
    worlds.push({ name: typeof e.name === 'string' ? e.name.slice(0, 200) : '', D, root, keys, colour, colourStatus: status,
                  view: goodView(e.view), source: goodSource(e.source), voxels, nodes });
  }
  return { worlds, bytes: file.length };
}
