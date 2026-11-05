/* How a billion potential voxels sit in the graph, and what a file of it
   costs (docs/binaryoutput.md).

     node experiments/binaryoutput.mjs           # ~11 min; writes docs/binaryoutput-results.md, docs/data/binaryoutput.json, worlds/*.vdag (gitignored)
     node experiments/binaryoutput.mjs --print   # the same run, the tables only
     node experiments/binaryoutput.mjs --quick   # no noise, no 128³ lattice, no colour; prints only

   Every world here is D = 10: 1024³ = 1,073,741,824 cells, the billion
   you asked about. nodesastuples.md §4 sketched a file and *guessed* at
   its smaller encodings ("8–10 bytes a node"). This measures them, and
   nothing counts until it has come back: each encoding is written, read
   back into a fresh store, pruned and imported into the world's own store.
   The root must come back with the same id and the store must not grow.
   Equal voxel sets are equal ids in one store, so that's every node
   recovered, not a sample.

   The encodings, each as a payload (the container is §7 of the note):
     raw       the store: 9 u32 a node, level then 8 child ids
     mask      id order: level, a child mask, a u32 per present child
     distance  post-order: a mask, then a varint back-distance per child
               (nodesastuples §4's guess; FULL is distance 0)
     inline    first-use order, the node's body written where it's first
               used: a mask, then per child a varint, 0 = "new, its body
               follows" or d = "the d-th most recent node of that level".
               Level-1 nodes are never referenced, their mask is written in
               place. Unshared parts cost what a pointerless octree does,
               and only a real repeat pays for an index.
     labelled  inline over Oh classes (SSVDAG): one body per class, and each
               edge's varint carries a pose too (d·64 + pose).

   This compares the candidates. The file format as built is vdag-core.js
   (binaryoutput.md §11), which still opens the files this writes (one bare
   descriptor in DESC, one headerless table in TBLE). It measures job times,
   so run it on an idle machine. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createStore, createCounts, createClasses, prune, pruneWorld, OH48, INV, FIRST_NODE, EMPTY, FULL } from '../dag-core.js';
import { expandChunk } from '../chunk-core.js';
import { colourOf } from '../colours.js';
import { attrRGB } from '../attr-core.js';
import { kitDesc, buildKit } from '../kit-core.js';
import { caveDesc, buildCavesInParts } from '../cave-core.js';
import { scatterDesc, buildScatter } from '../scatter-core.js';
import { latticeDesc, buildLattice } from '../lattice-core.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { loadTestbed, rowsOf, automatonOf } from './testbed-corpus.mjs';

const PRINT = process.argv.includes('--print'), QUICK = process.argv.includes('--quick');
const started = performance.now(), D = 10, CELLS = 2 ** 30, BITMAP = CELLS / 8;
const fmt = n => Math.round(n).toLocaleString('en-US');
const mb = n => n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(2) + ' MB' : n >= 1e4 ? (n / 1e3).toFixed(1) + ' KB' : fmt(n) + ' B';
const sum = (a, f = x => x) => a.reduce((s, x) => s + f(x), 0);
const lines = [];
const say = s => { lines.push(s); console.log(s); };
const table = (head, rows) => { say('| ' + head.join(' | ') + ' |'); say('|' + head.map(() => '---|').join('')); for (const r of rows) say('| ' + r.join(' | ') + ' |'); say(''); };
const timed = f => { const t = performance.now(), v = f(); return [v, performance.now() - t]; };

/* ---- bytes ---------------------------------------------------------------- */
class Writer {
  constructor(cap = 1 << 16){ this.a = new Uint8Array(cap); this.n = 0; }
  room(k){ if (this.n + k > this.a.length){ let c = this.a.length * 2; while (c < this.n + k) c *= 2; const g = new Uint8Array(c); g.set(this.a.subarray(0, this.n)); this.a = g; } }
  u8(v){ this.room(1); this.a[this.n++] = v; }
  u32(v){ this.room(4); new DataView(this.a.buffer).setUint32(this.n, v, true); this.n += 4; }
  // LEB128. Division, not shifts: a labelled word can pass 2^31.
  varint(v){ this.room(8); while (v >= 128){ this.a[this.n++] = v % 128 + 128; v = Math.floor(v / 128); } this.a[this.n++] = v; }
  bytes(b){ this.room(b.length); this.a.set(b, this.n); this.n += b.length; }
  done(){ return this.a.slice(0, this.n); }
}
function varintAt(b, r){
  let v = 0, m = 1, x;
  do { x = b[r.p++]; v += (x & 127) * m; m *= 128; } while (x >= 128);
  return v;
}
const maskOf = (store, id) => { let m = 0; for (let o = 0; o < 8; o++) if (store.child(id, o) !== EMPTY) m |= 1 << o; return m; };

/* ---- raw and mask ---------------------------------------------------------- */
function encodeRaw(store){ const k = store.snapshot().keys; return new Uint8Array(k.buffer, k.byteOffset, k.byteLength); }
function decodeRaw(bytes){
  const s = createStore(), k = new Uint32Array(bytes.slice().buffer);
  return { store: s, map: s.importKeys(k) };
}
function encodeMask(store){
  const w = new Writer(store.size * 24);
  for (let id = FIRST_NODE; id <= store.maxId; id++){
    w.u8(store.levelOf(id)); w.u8(maskOf(store, id));
    for (let o = 0; o < 8; o++){ const c = store.child(id, o); if (c !== EMPTY) w.u32(c); }
  }
  return w.done();
}
function decodeMask(bytes){
  const s = createStore(), dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), map = [EMPTY, FULL], ch = new Uint32Array(8);
  for (let p = 0; p < bytes.length;){
    const lev = bytes[p++], m = bytes[p++];
    for (let o = 0; o < 8; o++) if (m >> o & 1){ ch[o] = map[dv.getUint32(p, true)]; p += 4; } else ch[o] = EMPTY;
    map.push(s.intern(lev, ch));
  }
  return { store: s, map };
}

/* ---- distance: nodesastuples §4's guess, post-order and back-distances ------
   A node's level is its first child's plus one, so it needs no field. Iterative
   walk: the noise world is no deeper, but this mirrors tuples.mjs's. */
function postOrder(store, roots){
  const seen = new Uint8Array(store.maxId + 1), order = [];
  const visit = id => {
    if (id < FIRST_NODE || seen[id]) return;
    seen[id] = 1;
    for (let o = 0; o < 8; o++) visit(store.child(id, o));
    order.push(id);
  };
  roots.forEach(visit);
  return order;
}
function encodeDistance(store, roots){
  const order = postOrder(store, roots), pos = new Uint32Array(store.maxId + 1), w = new Writer(store.size * 10);
  order.forEach((id, i) => { pos[id] = i; });
  order.forEach((id, i) => {
    w.u8(maskOf(store, id));
    for (let o = 0; o < 8; o++){
      const c = store.child(id, o);
      if (c === EMPTY) continue;
      w.varint(c === FULL ? 0 : i - pos[c]);
    }
  });
  return w.done();
}
function decodeDistance(bytes){
  const s = createStore(), ids = [], ch = new Uint32Array(8), r = { p: 0 };
  while (r.p < bytes.length){
    const m = bytes[r.p++]; let lev = 0;
    for (let o = 0; o < 8; o++){
      if (!(m >> o & 1)){ ch[o] = EMPTY; continue; }
      const d = varintAt(bytes, r);
      ch[o] = d === 0 ? FULL : ids[ids.length - d];
      lev = d === 0 ? 1 : s.levelOf(ch[o]) + 1;
    }
    ids.push(s.intern(lev, ch));
  }
  return { store: s, ids };
}

/* ---- inline: the node's body where it's first used --------------------------
   payload := ref(D, root) for each root
   ref(l, n) := varint d; d = 0: body(l, n) follows; d > 0: the d-th most
                recent node of level l
   body(l, n) := mask; then per present child, in octant order:
                 l = 2: the child's own mask (level-1 nodes aren't referenced)
                 l > 2: ref(l − 1, child)
   Levels come from the walk, so a node never names one. Ids don't appear
   at all: the reader hands them out as it goes, children first. */
function encodeInline(store, roots, DD){
  const w = new Writer(Math.max(1 << 16, store.size * 4)), where = new Int32Array(store.maxId + 1).fill(-1), offset = new Int32Array(store.maxId + 1).fill(-1);
  const counts = new Float64Array(DD + 1), sizes = new Float64Array(DD + 1), refs = new Float64Array(DD + 1), backs = new Float64Array(DD + 1);
  const body = (l, id) => {
    offset[id] = w.n;
    const m = maskOf(store, id);
    w.u8(m); sizes[l]++;
    if (l === 1) return;
    for (let o = 0; o < 8; o++){
      if (!(m >> o & 1)) continue;
      const c = store.child(id, o);
      if (l === 2){ w.u8(maskOf(store, c)); sizes[l]++; }
      else ref(l - 1, c, l);
    }
  };
  const ref = (l, id, by) => {
    const start = w.n;
    refs[l]++;
    if (where[id] >= 0){ backs[l]++; w.varint(counts[l] - where[id]); sizes[by] += w.n - start; return; }
    w.varint(0); sizes[by] += w.n - start;
    body(l, id);
    where[id] = counts[l]++;
  };
  for (const r of roots) ref(DD, r, DD);
  return { bytes: w.done(), sizes, refs, backs, offset };
}
function decodeInline(bytes, rootCount, DD, s = createStore()){
  const tables = Array.from({ length: DD + 1 }, () => []), buf = Array.from({ length: DD + 1 }, () => new Uint32Array(8)), leafs = new Uint32Array(256), r = { p: 0 };
  const bits = new Uint32Array(8);
  const leaf = m => {
    if (leafs[m]) return leafs[m];
    for (let o = 0; o < 8; o++) bits[o] = m >> o & 1 ? FULL : EMPTY;
    return leafs[m] = s.intern(1, bits);
  };
  const body = l => {
    const m = bytes[r.p++];
    if (l === 1) return leaf(m);
    const ch = buf[l];
    for (let o = 0; o < 8; o++)
      ch[o] = !(m >> o & 1) ? EMPTY : l === 2 ? leaf(bytes[r.p++]) : ref(l - 1);
    return s.intern(l, ch);
  };
  const ref = l => {
    const d = varintAt(bytes, r), t = tables[l];
    if (d) return t[t.length - d];
    const id = body(l);
    t.push(id);
    return id;
  };
  const roots = Array.from({ length: rootCount }, () => ref(DD));
  return { store: s, roots };
}

/* ---- labelled: inline over Oh classes -----------------------------------------
   n = pose[n] · rep(cls[n]) (dag-core's createClasses), so a class's
   representative is pose⁻¹ · any member, and it's materialized in a work
   store to read its children. An edge is one varint, d·64 + pose. Level 1
   stays literal: a mask byte beats a class and a pose. */
function encodeLabelled(store, root, DD){
  const work = createStore(), map = work.importKeys(store.snapshot().keys), cl = createClasses(work, OH48);
  const reps = new Map(), where = new Map(), counts = new Float64Array(DD + 1), w = new Writer(1 << 16);
  const repOf = id => {
    const c = cl.cls(id);
    let r = reps.get(c);
    if (r === undefined){ r = work.transform(id, INV[cl.pose(id)]); cl.update(); reps.set(c, r); }
    return r;
  };
  const body = (l, rep) => {
    const m = maskOf(work, rep);
    w.u8(m);
    if (l === 1) return;
    for (let o = 0; o < 8; o++){
      if (!(m >> o & 1)) continue;
      const c = work.child(rep, o);
      if (l === 2) w.u8(maskOf(work, c)); else ref(l - 1, c);
    }
  };
  const ref = (l, id) => {
    const c = cl.cls(id), p = cl.pose(id), at = where.get(c);
    if (at !== undefined){ w.varint((counts[l] - at) * 64 + p); return; }
    w.varint(p);
    body(l, repOf(id));
    where.set(c, counts[l]++);
  };
  ref(DD, map[root]);
  return { bytes: w.done(), classes: cl.size };
}
function decodeLabelled(bytes, DD){
  const s = createStore(), tables = Array.from({ length: DD + 1 }, () => []), buf = Array.from({ length: DD + 1 }, () => new Uint32Array(8)), r = { p: 0 };
  const bits = new Uint32Array(8);
  const leaf = m => { for (let o = 0; o < 8; o++) bits[o] = m >> o & 1 ? FULL : EMPTY; return s.intern(1, bits); };
  const body = l => {
    const m = bytes[r.p++];
    if (l === 1) return leaf(m);
    const ch = buf[l];
    for (let o = 0; o < 8; o++)
      ch[o] = !(m >> o & 1) ? EMPTY : l === 2 ? leaf(bytes[r.p++]) : ref(l - 1);
    return s.intern(l, ch);
  };
  const ref = l => {
    const v = varintAt(bytes, r), p = v % 64, d = Math.floor(v / 64), t = tables[l];
    if (d) return s.transform(t[t.length - d], p);
    const rep = body(l);
    t.push(rep);
    return s.transform(rep, p);
  };
  return { store: s, root: ref(DD) };
}

/* ---- the check every encoding has to pass -------------------------------------
   Decoded nodes pruned to the root and imported into the world's own store:
   the same root, and not one new node. */
function assertSame(world, decodedStore, decodedRoot, label){
  const { keys, map } = prune(decodedStore.snapshot().keys, [decodedRoot]);
  const before = world.store.size, m = world.store.importKeys(keys);
  if (m[map[decodedRoot]] !== world.root || world.store.size !== before || keys.length / 9 !== world.nodes)
    throw new Error(`${world.name}/${label}: round trip failed: root ${m[map[decodedRoot]]} vs ${world.root}, store ${before} → ${world.store.size}, ${keys.length / 9} nodes vs ${world.nodes}`);
}

/* ---- the container ------------------------------------------------------------
   'VDAG', u32 version, then tagged sections: tag, u32 length, bytes. A reader
   skips what it doesn't know, the way a PNG reader does. */
const enc = new TextEncoder(), dec = new TextDecoder();
const tagOf = s => enc.encode(s);
function writeVdag({ desc, Ds, payload, extra = [] }){
  const w = new Writer(payload.length + 4096), gz = gzipSync(payload), z = gz.length < payload.length ? gz : payload;
  const section = (tag, b) => { w.bytes(tagOf(tag)); w.u32(b.length); w.bytes(b); };
  w.bytes(tagOf('VDAG')); w.u32(1);
  section('DESC', enc.encode(JSON.stringify(desc)));
  const roots = new Writer(16); roots.varint(Ds.length); for (const d of Ds) roots.u8(d);
  section('ROOT', roots.done());
  const node = new Uint8Array(2 + z.length); node[0] = 1; node[1] = z === gz ? 1 : 0; node.set(z, 2);   // inline; gzip only where it wins (a tiny world's gzip header outweighs it)
  section('NODE', node);
  for (const [tag, b] of extra) section(tag, b);
  return w.done();
}
function readVdag(file){
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  if (dec.decode(file.subarray(0, 4)) !== 'VDAG' || dv.getUint32(4, true) !== 1) throw new Error('not a version 1 vdag');
  const parts = {};
  for (let p = 8; p < file.length;){
    const tag = dec.decode(file.subarray(p, p + 4)), n = dv.getUint32(p + 4, true);
    parts[tag] = file.subarray(p + 8, p + 8 + n);
    p += 8 + n;
  }
  const r = { p: 0 }, count = varintAt(parts.ROOT, r), Ds = Array.from({ length: count }, () => parts.ROOT[r.p++]);
  if (parts.NODE[0] !== 1 || parts.NODE[1] > 1) throw new Error('unknown node encoding');
  const payload = parts.NODE[1] ? gunzipSync(parts.NODE.subarray(2)) : parts.NODE.subarray(2);
  return { desc: JSON.parse(dec.decode(parts.DESC)), Ds, payload, parts };
}

/* ---- per-node sweeps ---------------------------------------------------------- */
// How many places each node stands in: one sweep down the ids (children-first).
function multiplicity(store, root){
  const mult = new Float64Array(store.maxId + 1);
  mult[root] = 1;
  for (let id = store.maxId; id >= FIRST_NODE; id--){
    if (!mult[id]) continue;
    for (let o = 0; o < 8; o++) mult[store.child(id, o)] += mult[id];
  }
  return mult;
}
function levelTable(store, root, DD){
  const mult = multiplicity(store, root), tree = new Float64Array(DD + 1), dag = new Float64Array(DD + 1);
  let once = 0;
  for (let id = FIRST_NODE; id <= store.maxId; id++){
    const lev = store.levelOf(id);
    tree[lev] += mult[id]; dag[lev]++;
    if (mult[id] === 1) once++;
  }
  tree[0] = mult[FULL];
  return { mult, tree, dag, once };
}

/* ---- the worlds ------------------------------------------------------------------ */
const tb = loadTestbed(), ROWS = rowsOf(tb);
function fromKeys({ keys, root }){ const s = createStore(), m = s.importKeys(keys); return { store: s, root: m[root] }; }
function shape(name){
  return { name, make: () => { const s = createStore(), { root } = s.fromField(D, fieldOf(SHAPES.find(x => x.name === name), D)); return { store: s, root }; }, desc: { kind: 'shape', name, D } };
}
function row(label, L = 5){
  const r = ROWS.find(x => x.label === label) ?? (() => { throw new Error(`no row '${label}'`); })();
  return { name: `row: ${r.label}${r.depth === '-' ? '' : ' ' + r.depth}`, make: () => {
    const s = createStore(), a = automatonOf(tb, r.cfgFor(L)), { root } = s.fromRadix4(L, a.start, a.step, a.accept, a.keyOf);
    return { store: s, root };
  }, desc: { kind: 'row', D } };
}
const WORLDS = [
  { name: 'one voxel', teach: true, make: () => { const s = createStore(); return { store: s, root: s.fromField(D, (k, x, y, z) => x || y || z ? 0 : k === 0 ? 1 : -1).root }; }, desc: { kind: 'one' } },
  { name: 'all solid', teach: true, make: () => { const s = createStore(); return { store: s, root: s.solid(D) }; }, desc: { kind: 'solid' } },
  // One node a level: every 2³ cell of a checkerboard holds the same pattern.
  { name: 'checkerboard', teach: true, make: () => {
    const s = createStore(), ch = new Uint32Array(8);
    for (let o = 0; o < 8; o++) ch[o] = (o & 1) ^ (o >> 1 & 1) ^ (o >> 2) ? FULL : EMPTY;
    let id = s.intern(1, ch);
    for (let k = 2; k <= D; k++){ ch.fill(id); id = s.intern(k, ch); }
    return { store: s, root: id };
  }, desc: { kind: 'checker' } },
  row(ROWS.find(r => r.axis === 3).label),
  shape('sphere'), shape('gyroid'), shape('terrain'),
  { name: 'kit', make: () => { const k = buildKit(kitDesc({ D })); return { store: k.store, root: k.root }; }, desc: kitDesc({ D }) },
  { name: 'caves', make: () => fromKeys(buildCavesInParts(caveDesc({ D }))), desc: caveDesc({ D }) },
  { name: 'scatter', tabled: true, make: () => { const d = scatterDesc({ D }), b = buildScatter(d); return { store: b.store, root: b.root, table: b.table, colourDesc: { kind: 'scatter', ...d, table: b.table } }; }, desc: { kind: 'scatter', ...scatterDesc({ D }) } },
  { name: 'lattice R=32, 16³', tabled: true, make: () => { const d = latticeDesc({ R: 32, n: [16, 16, 16] }), b = buildLattice(d); return { store: b.store, root: b.root, table: b.table, colourDesc: { ...d, table: b.table } }; }, desc: latticeDesc({ R: 32, n: [16, 16, 16] }) },
  ...(QUICK ? [] : [
    { name: 'lattice R=5, 128³', tabled: true, slow: true, noLabel: true, make: () => { const d = latticeDesc({ R: 5, n: [128, 128, 128] }), b = buildLattice(d); return { store: b.store, root: b.root, table: b.table, colourDesc: { ...d, table: b.table } }; }, desc: latticeDesc({ R: 5, n: [128, 128, 128] }) },
    // Coin flips: nothing to share above the 4³ patterns. fromField's walk is
    // in a fixed order, so a running generator is deterministic.
    { name: 'noise, 50%', slow: true, noise: true, make: () => {
      const s = createStore(); let a = 0x12345678;
      const coin = () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return (t ^ t >>> 14) >>> 31; };
      return { store: s, root: s.fromField(D, k => k === 0 ? coin() : -1).root };
    }, desc: { kind: 'noise' } },
  ]),
];

/* ---- measure ---------------------------------------------------------------------- */
const results = [];
mkdirSync(new URL('../worlds/', import.meta.url), { recursive: true });
for (const def of WORLDS){
  const [built, buildMs] = timed(def.make);
  const { store, root } = pruneWorld(built.store, built.root);
  const world = { name: def.name, store, root, nodes: store.size };
  const [counts, countMs] = timed(() => createCounts(store));
  const voxels = root >= FIRST_NODE ? counts.of(root) : 0, lv = levelTable(store, root, D);
  if (lv.tree[0] !== voxels) throw new Error(`${def.name}: path counts ${lv.tree[0]} vs ${voxels}`);
  const r = { name: def.name, voxels, nodes: store.size, buildMs, countMs, tree: [...lv.tree], dag: [...lv.dag], once: lv.once };

  const raw = encodeRaw(store), mask = encodeMask(store), dist = encodeDistance(store, [root]), inl = encodeInline(store, [root], D);
  r.sizes = {}; r.gz = {};
  for (const [k, b] of [['raw', raw], ['mask', mask], ['distance', dist], ['inline', inl.bytes]]){ r.sizes[k] = b.length; r.gz[k] = gzipSync(b).length; }
  r.levelBytes = [...inl.sizes]; r.refs = [...inl.refs]; r.backs = [...inl.backs];
  { const d = decodeRaw(raw); assertSame(world, d.store, d.map[root], 'raw'); }
  { const d = decodeMask(mask); assertSame(world, d.store, d.map[root], 'mask'); }
  { const d = decodeDistance(dist); assertSame(world, d.store, d.ids[d.ids.length - 1], 'distance'); }

  // The file, through the disk's bytes: the whole path a loader would take.
  const extra = built.table ? [['TBLE', gzipSync(new Uint8Array(built.table.buffer))]] : [];
  r.tableBytes = built.table ? built.table.byteLength : 0;
  r.tableGz = extra.length ? extra[0][1].length : 0;
  const descJson = JSON.stringify(def.desc);
  r.descBytes = enc.encode(descJson).length;
  const file = writeVdag({ desc: def.desc, Ds: [D], payload: inl.bytes, extra });
  r.fileBytes = file.length;
  const [loaded, loadMs] = timed(() => { const f = readVdag(file); return decodeInline(f.payload, f.Ds.length, f.Ds[0]); });
  r.loadMs = loadMs;
  assertSame(world, loaded.store, loaded.roots[0], 'file');
  // A reader skips what it doesn't know: the same file with a section it has never seen.
  { const f = readVdag(writeVdag({ desc: def.desc, Ds: [D], payload: inl.bytes, extra: [['XTRA', new Uint8Array(3)], ...extra] })), d = decodeInline(f.payload, 1, D); assertSame(world, d.store, d.roots[0], 'skip'); }
  if (!def.noise && !QUICK && !PRINT) writeFileSync(new URL(`../worlds/${def.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-d${D}.vdag`, import.meta.url), file);

  // Oh classes. Not for the noise world: 48 tries of 19M nodes, for a label
  // nothing shares. And no labelled file for the 128³ lattice: materializing
  // its representatives overflows store.transform's memo, a JS Map, which
  // stops at 2^24 entries (RangeError, hit 2026-11-05). A loader going through
  // transform would hit the same wall, so that's a finding, not a detail.
  if (!def.noise){
    if (!def.noLabel){
      const [lab, labMs] = timed(() => encodeLabelled(store, root, D));
      r.labelledMs = labMs;
      r.sizes.labelled = lab.bytes.length; r.gz.labelled = gzipSync(lab.bytes).length;
      const [d, labDecodeMs] = timed(() => decodeLabelled(lab.bytes, D));
      r.labelledDecodeMs = labDecodeMs;
      assertSame(world, d.store, d.root, 'labelled');
    }
    const [cl, classMs] = timed(() => createClasses(store, OH48));
    r.classMs = classMs; r.classes = cl.size;
  }

  // What colour would cost, baked: one word per shown voxel at lod 0, in expandChunk's order.
  if (!QUICK && !def.noise){
    const colourDesc = built.colourDesc ?? (['shape', 'row', 'kit', 'caves'].includes(def.desc.kind) ? def.desc : null);
    const field = colourDesc ? colourOf(colourDesc) : null;
    let shown = 0, cap = 1 << 22, words = field ? new Uint32Array(cap) : null;
    const palette = new Uint8Array(1 << 18);
    const [, shownMs] = timed(() => {
      for (let cz = 0; cz < 16; cz++) for (let cy = 0; cy < 16; cy++) for (let cx = 0; cx < 16; cx++){
        const c = expandChunk(store, root, D, { lod: 0, cx, cy, cz }, field ? { colour: field } : {});
        if (!c.occupied) continue;
        if (field){
          if (shown + c.count > cap){ while (shown + c.count > cap) cap *= 2; const g = new Uint32Array(cap); g.set(words.subarray(0, shown)); words = g; }
          words.set(c.attrs.subarray(0, c.count), shown);
        }
        shown += c.count;
      }
    });
    r.shown = shown; r.shownMs = shownMs;
    if (field){
      let distinct = 0;
      for (let i = 0; i < shown; i++){
        const [R, G, B] = attrRGB(words[i]), k = R << 12 | G << 6 | B;
        if (!palette[k]){ palette[k] = 1; distinct++; }
      }
      r.palette = distinct;
      r.attrGz = gzipSync(new Uint8Array(words.buffer, 0, 4 * shown)).length;
    }
  }

  // The rank: a solid voxel's position in Morton order, read off counts on the way down.
  if (def.name === 'kit' || def.name === 'caves') r.rankChecked = checkRank(store, counts, root);

  if (def.name === 'kit'){
    r.walk = walkVoxel(store, counts, root, lv.mult, inl.offset);
    r.hex = hexOf(inl.bytes.subarray(0, 96));
    r.trace = trace(inl.bytes, D, 40);
  }
  if (def.teach) { r.hex = hexOf(inl.bytes.subarray(0, 96)); r.trace = trace(inl.bytes, D, 40); }
  results.push(r);
  console.error(`${def.name}: ${fmt(voxels)} voxels, ${fmt(store.size)} nodes, inline ${mb(inl.bytes.length)}, ${(performance.now() - started) / 1000 | 0} s`);
  // The noise world is 700 MB of keys. Let it go before the next.
  built.store = null;
}

function rankOf(store, counts, root, x, y, z){
  let id = root, rank = 0;
  for (let k = D - 1; k >= 0 && id >= FIRST_NODE; k--){
    const o = ((x >> k) & 1) | (((y >> k) & 1) << 1) | (((z >> k) & 1) << 2);
    for (let e = 0; e < o; e++){ const c = store.child(id, e); if (c !== EMPTY) rank += c === FULL ? 1 : counts.of(c); }
    id = store.child(id, o);
  }
  return id === FULL ? rank : -1;
}
function unrank(store, counts, root, rank){
  let id = root, x = 0, y = 0, z = 0;
  for (let k = D - 1; k >= 0; k--){
    for (let o = 0; o < 8; o++){
      const c = store.child(id, o), n = c === EMPTY ? 0 : c === FULL ? 1 : counts.of(c);
      if (rank >= n){ rank -= n; continue; }
      x |= (o & 1) << k; y |= (o >> 1 & 1) << k; z |= (o >> 2) << k; id = c;
      break;
    }
  }
  return [x, y, z];
}
function checkRank(store, counts, root){
  let h = 7, ok = 0;
  const total = counts.of(root);
  for (let i = 0; i < 100000; i++){
    h = Math.imul(h ^ h >>> 13, 0x5bd1e995) >>> 0;
    const want = Math.floor(h / 2 ** 32 * total), [x, y, z] = unrank(store, counts, root, want);
    if (rankOf(store, counts, root, x, y, z) !== want) throw new Error(`rank ${want} came back wrong at ${x},${y},${z}`);
    ok++;
  }
  return ok;
}
function walkVoxel(store, counts, root, mult, offset){
  // A voxel high up in the world's middle, so the path isn't all first octants.
  let x = 0, y = 0, z = 0, h = 11;
  for (;;){
    h = Math.imul(h ^ h >>> 13, 0x5bd1e995) >>> 0; x = h % 1024;
    h = Math.imul(h ^ h >>> 13, 0x5bd1e995) >>> 0; y = 64 + h % 512;
    h = Math.imul(h ^ h >>> 13, 0x5bd1e995) >>> 0; z = h % 1024;
    if (store.query(root, D, x, y, z)) break;
  }
  const steps = [];
  let id = root, rank = 0;
  for (let k = D; k >= 1; k--){
    const b = k - 1, o = ((x >> b) & 1) | (((y >> b) & 1) << 1) | (((z >> b) & 1) << 2);
    steps.push({ level: k, id, octant: o, voxels: counts.of(id), places: mult[id], offset: offset[id], rankSoFar: rank });
    for (let e = 0; e < o; e++){ const c = store.child(id, e); if (c !== EMPTY) rank += c === FULL ? 1 : counts.of(c); }
    id = store.child(id, o);
  }
  return { x, y, z, rank, places: mult[FULL], steps };
}
function hexOf(b){ return [...b].map(v => v.toString(16).padStart(2, '0')).join(' '); }
function trace(bytes, DD, limit){
  const out = [], r = { p: 0 }, tables = new Float64Array(DD + 1);
  const mask = m => m.toString(2).padStart(8, '0');
  const body = l => {
    if (out.length >= limit) throw 0;
    const at = r.p, m = bytes[r.p++];
    out.push(`${at}: level ${l} mask ${mask(m)}`);
    if (l === 1) return;
    for (let o = 0; o < 8; o++){
      if (!(m >> o & 1)) continue;
      if (l === 2){ out.push(`${r.p}:   octant ${o}: level-1 mask ${mask(bytes[r.p])}`); r.p++; }
      else ref(l - 1, o);
      if (out.length >= limit) throw 0;
    }
  };
  const ref = (l, o) => {
    const at = r.p, d = varintAt(bytes, r);
    if (d){ out.push(`${at}:   octant ${o}: back ${d} (level ${l})`); return; }
    out.push(`${at}:   octant ${o}: new (level ${l})`);
    body(l);
    tables[l]++;
  };
  try { ref(DD, 0); } catch (e) { if (e !== 0) throw e; }
  return out;
}

/* ---- several roots in one file: 8 kit seeds, sharing what they share ---------------- */
function shelf(){
  const seeds = [1, 2, 3, 4, 5, 6, 7, 8], s = createStore(), roots = [];
  let alone = 0, aloneGz = 0, nodesAlone = 0;
  for (const seed of seeds){
    const k = buildKit(kitDesc({ D, seed })), m = s.importKeys(k.store.snapshot().keys);
    roots.push(m[k.root]);
    const b = encodeInline(k.store, [k.root], D).bytes;
    alone += b.length; aloneGz += gzipSync(b).length; nodesAlone += k.store.size;
  }
  const { keys, map } = prune(s.snapshot().keys, roots), b = encodeInline(fromKeysRaw(keys), roots.map(r => map[r]), D).bytes;
  const f = writeVdag({ desc: { kind: 'shelf', seeds }, Ds: seeds.map(() => D), payload: b });
  const back = readVdag(f), d = decodeInline(back.payload, back.Ds.length, D);
  const base = fromKeysRaw(keys);
  const again = prune(d.store.snapshot().keys, d.roots), m2 = base.importKeys(again.keys);
  d.roots.forEach((r, i) => { if (m2[again.map[r]] !== map[roots[i]]) throw new Error(`shelf: root ${i} came back wrong`); });
  if (base.size !== keys.length / 9 || again.keys.length !== keys.length) throw new Error('shelf: nodes came back wrong');
  return { seeds: seeds.length, nodesAlone, nodes: keys.length / 9, alone, aloneGz, one: b.length, oneGz: gzipSync(b).length, file: f.length };
}
function fromKeysRaw(keys){ const s = createStore(); s.importKeys(keys); return s; }
const shelved = shelf();

/* ---- what the store grows by above the billion: the kit from D = 10 to 16 --------- */
const deeper = [10, 12, 14, 16].map(d => {
  const k = buildKit(kitDesc({ D: d })), c = createCounts(k.store), b = encodeInline(k.store, [k.root], d).bytes;
  const dd = decodeInline(b, 1, d);
  assertSame({ name: `kit D=${d}`, store: k.store, root: k.root, nodes: k.store.size }, dd.store, dd.roots[0], 'inline');
  return { D: d, voxels: c.of(k.root), nodes: k.store.size, inline: b.length, gz: gzipSync(b).length };
});

/* ---- report --------------------------------------------------------------------- */
say('# How a billion potential voxels sit in the graph: results');
say('');
say(`Generated by \`node experiments/binaryoutput.mjs\` (${Math.round((performance.now() - started) / 1000)} s). Readings in [binaryoutput.md](binaryoutput.md).`);
say('');
say(`Every world is D = ${D}: 1024³ = ${fmt(CELLS)} potential voxels. A one-bit-per-cell bitmap of any of them is ${mb(BITMAP)}. Every encoding below was read back and held to the world's own store: same root id, no new node.`);
say('');
say('## 1. The worlds');
say('');
say('*tree nodes* is what the same voxels cost as a plain octree (every interior node on every path). *places per node* is tree nodes over DAG nodes. *file* is the whole `.vdag`: header, descriptor, the inline graph gzipped, and for scatter and lattice the colour table.');
say('');
table(['world', 'solid voxels', 'fill', 'tree nodes', 'DAG nodes', 'places per node', 'used once', 'Oh classes', 'file', 'bytes per solid voxel', 'bitmap ÷ file'],
  results.map(r => {
    const tree = sum(r.tree.slice(1));
    return [r.name, fmt(r.voxels), (100 * r.voxels / CELLS).toFixed(2) + '%', fmt(tree), fmt(r.nodes), (tree / Math.max(1, r.nodes)).toFixed(1), (100 * r.once / Math.max(1, r.nodes)).toFixed(0) + '%', r.classes === undefined ? '-' : fmt(r.classes), mb(r.fileBytes), r.voxels ? (r.fileBytes / r.voxels).toPrecision(2) : '-', (BITMAP / r.fileBytes).toFixed(BITMAP / r.fileBytes < 10 ? 2 : 0)];
  }));
say('## 2. The encodings');
say('');
say('Bytes of the graph alone, then bytes a node. Under each, gzip (level 6, what `CompressionStream` does).');
say('');
const KINDS = ['raw', 'mask', 'distance', 'inline', 'labelled'];
table(['world', ...KINDS, ...KINDS.map(k => k + ' gz'), 'inline gz, B/node'],
  results.map(r => [r.name, ...KINDS.map(k => r.sizes[k] === undefined ? '-' : mb(r.sizes[k])), ...KINDS.map(k => r.gz[k] === undefined ? '-' : mb(r.gz[k])), (r.gz.inline / Math.max(1, r.nodes)).toFixed(2)]));
table(['world', ...KINDS.map(k => k + ' B/node')],
  results.map(r => [r.name, ...KINDS.map(k => r.sizes[k] === undefined ? '-' : (r.sizes[k] / Math.max(1, r.nodes)).toFixed(2))]));
say('## 3. Level by level');
say('');
say('*tree* is how many places hold a node of that level; *DAG* how many different nodes there are. *refs* is how many times a level was referenced in the file and *back* how many of those were repeats. *bytes* is what the inline encoding spends in that level\'s bodies.');
say('');
for (const name of ['kit', 'caves', 'lattice R=32, 16³', 'lattice R=5, 128³']){
  const r = results.find(x => x.name === name);
  if (!r) continue;
  say(`### ${name}`);
  say('');
  table(['level', 'side', 'tree', 'DAG', 'places per node', 'refs', 'back', 'bytes'],
    Array.from({ length: D + 1 }, (_, k) => D - k).map(k => [k, 2 ** k, fmt(r.tree[k]), k === 0 ? '(the voxels)' : fmt(r.dag[k]), k === 0 ? '-' : (r.tree[k] / Math.max(1, r.dag[k])).toFixed(1), k < 3 && k !== 2 ? '-' : fmt(r.refs[k]), k < 3 && k !== 2 ? '-' : fmt(r.backs[k]), k === 0 ? '-' : fmt(r.levelBytes[k])]));
}
say('## 4. One voxel, walked');
say('');
const kitR = results.find(r => r.name === 'kit'), W = kitR.walk;
say(`In the kit at (${W.x}, ${W.y}, ${W.z}). *voxels* is what the node holds, *places* how many places in the world hold it, *offset* where its body starts in the inline payload, *rank* how many solid voxels come before this one in Morton order, read off the counts on the way down. Its final rank is ${fmt(W.rank)} of ${fmt(W.places)}.`);
say('');
table(['level', 'side', 'node id', 'octant taken', 'voxels', 'places', 'offset', 'rank so far'], W.steps.map(s => [s.level, 2 ** s.level, s.id, s.octant, fmt(s.voxels), fmt(s.places), s.offset, fmt(s.rankSoFar)]));
say(`Rank and unrank held for ${fmt(kitR.rankChecked)} random voxels in each of the kit and the caves.`);
say('');
say('## 5. Bytes, for reading');
say('');
for (const r of results) if (r.hex){
  say(`### ${r.name} (first ${Math.min(96, r.sizes.inline)} of ${fmt(r.sizes.inline)} inline bytes)`);
  say('');
  say('```');
  say(r.hex);
  say('');
  for (const t of r.trace) say(t);
  say('```');
  say('');
}
say('## 6. Colour, baked');
say('');
say('The graph holds occupancy. One word per **shown** voxel at lod 0, in `expandChunk`\'s record order, gzipped, against the graph\'s file. *colours* is how many of the 2^18 possible 6:6:6 values appear. A named field costs its descriptor instead.');
say('');
table(['world', 'shown voxels', 'shown ÷ solid', 'words raw', 'words gz', 'B/shown gz', 'colours', 'descriptor', 'graph file', 'words gz ÷ graph file'],
  results.filter(r => r.shown !== undefined).map(r => [r.name, fmt(r.shown), r.voxels ? (r.shown / r.voxels).toFixed(3) : '-', r.palette === undefined ? '-' : mb(4 * r.shown), r.attrGz === undefined ? '-' : mb(r.attrGz), r.attrGz === undefined || !r.shown ? '-' : (r.attrGz / r.shown).toFixed(2), r.palette === undefined ? '-' : fmt(r.palette), mb(r.descBytes), mb(r.fileBytes), r.attrGz === undefined ? '-' : (r.attrGz / r.fileBytes).toFixed(0) + '×']));
table(['world', 'colour table raw', 'table gz'], results.filter(r => r.tableBytes).map(r => [r.name, mb(r.tableBytes), mb(r.tableGz)]));
say('## 7. Loading');
say('');
say('*load* is the file\'s bytes to a store: section walk, gunzip, inline decode. *counts* and *classes* are what a loaded store still has to compute (`createCounts`, `createClasses`). *build* is making the world from its descriptor on one thread here. *RAM* is the store\'s keys, a count and a pose a node, per worker: 45 bytes a node, whatever the file was.');
say('');
table(['world', 'build ms', 'load ms', 'counts ms', 'classes ms', 'labelled decode ms', 'RAM per worker'],
  results.map(r => [r.name, fmt(r.buildMs), fmt(r.loadMs), r.countMs.toFixed(1), r.classMs === undefined ? '-' : fmt(r.classMs), r.labelledDecodeMs === undefined ? '-' : fmt(r.labelledDecodeMs), mb(45 * r.nodes)]));
say('## 8. Several roots in one file');
say('');
say(`${shelved.seeds} kits, seeds 1–${shelved.seeds}, D = ${D}, as separate payloads against one payload with one root each. The file was read back and every root held to its id.`);
say('');
table(['', 'nodes', 'inline', 'inline gz'], [['separately', fmt(shelved.nodesAlone), mb(shelved.alone), mb(shelved.aloneGz)], ['one file', fmt(shelved.nodes), mb(shelved.one), mb(shelved.oneGz)]]);
say('## 9. Deeper');
say('');
say('The default kit above the billion. Each level of side costs almost nothing.');
say('');
table(['D', 'side', 'potential voxels', 'solid voxels', 'nodes', 'inline', 'inline gz'],
  deeper.map(d => [d.D, fmt(2 ** d.D), fmt(8 ** d.D), fmt(d.voxels), fmt(d.nodes), mb(d.inline), mb(d.gz)]));

if (!PRINT && !QUICK){
  const results2 = results.map(({ hex, trace, ...r }) => r);
  writeFileSync(new URL('../docs/binaryoutput-results.md', import.meta.url), lines.join('\n') + '\n');
  writeFileSync(new URL('../docs/data/binaryoutput.json', import.meta.url), JSON.stringify({ D, results: results2, shelved, deeper }, null, 1) + '\n');
}
