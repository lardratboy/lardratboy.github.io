/* MagicaVoxel's .vox to world files (docs/convert.md §VOX, asked for
   2026-11-25: "add .vox file support to ./convert/, the model format is
   pretty straight forward"). Pure: no DOM, no Worker. Written from the
   format's own notes (ephtracy's MagicaVoxel-file-format-vox.txt and
   -vox-extension.txt); the one thing those leave out, where a model sits
   under its transform, is opengametools' ogt_vox.h's reading of it (only
   read, nothing taken): a model's pivot is floor(size / 2), and `_r`'s rows
   are the rows of R acting on column vectors. No outside code.

   A .vox is voxels already, so nothing here voxelizes: the reader gives
   each model's voxels (four bytes each, x, y, z and a palette index) and
   the scene graph that places copies of them (nTRN, nGRP, nSHP), and the
   scene is flattened into one set of voxels, a later copy's voxel over an
   earlier one's (the order the graph is walked, as MagicaVoxel lists them).

   What a depth means (§VOX, decided here and asked as a question there):
   the voxels stay cubes. Every depth D is the model scaled by a power of
   two, 2^e world voxels a .vox voxel, e = D − F, where F is the least depth
   whose cube holds the model one voxel a voxel. Past F (e > 0) each voxel
   is a 2^e cube; below it (e < 0) a world voxel is a cell of 2^−e voxels a
   side, solid if any voxel in it is (the any rule, which is the viewer's
   own coarse lods), coloured by the mean of the voxels in it that show (a
   face to air) or, if none shows, of all of them, as a coarse lod's colour
   is the mean of its skin. A fit like the other formats' (92% of the side,
   any factor) would cut pixel art's voxels into uneven runs. `native` adds
   e = 0 at max(6, F): one world voxel a .vox voxel, the model at its own
   size, for dropping into a world. It's written once if a depth asked for
   is the same world. Native goes past the page's depths when the model
   needs it, to D = 16 (MAX_NATIVE_D), on wide keys: a depth's cost follows
   its voxels, not its box (answered 2026-11-25, §VOX Q5).

   The answers (2026-11-25, §VOX): hidden objects and layers are left out
   unless `hidden` keeps them (Q3), and an animation is every frame, each a
   world in the depth's one file, built in one store so the frames share
   nodes (Q4; `framesOf`, `sceneOf`'s `frame`). Frames are sampled as
   ogt_vox.h samples them: a transform's rotation snaps to the keyframe at
   or before the frame, its position goes linearly to the next one,
   truncated toward zero (exactly, here: integers over an integer), a
   shape's model snaps, `_loop` wraps the frame into its first and last
   keyframes. Every frame shares one box, so the animation doesn't jump.

   Where it sits: z is up in MagicaVoxel and y here, turned as vdb/'s
   Blender caches are, (x, y, z) to (x, z, −y), a rotation, no mirror; the
   cells line up with the low corner of the model's voxels, so a model drawn
   from its grid's corner keeps its own cells when halved; centred in x and
   z, and 4% of the side off the floor if there's room (the other formats'
   floor), else as much as there is: a model F fills exactly sits at 0. So
   a 256³ model is native at D = 8, not 9.

   The rest is the other converters': each depth's skin is every voxel with
   a face to air (vdb/'s `skinOf`), its words one a skin voxel in rank order
   (palette colours, 8 bits a channel, written at six bits unless asked for
   eight), and convert-core's `finishWorlds` writes it, reads it back and
   draws its picture. */
import { createStore, createCounts, EMPTY } from '../dag-core.js';
import { rgb8 } from '../attr-core.js';
import { fromMorton, radixSort } from './ply-core.js';
import { DEPTHS, finishWorlds, stager, slugOf } from './convert-core.js';
import { skinOf, eachVoxel } from '../vdb/vdb-convert.js';

/* At most this many voxels placed (copies and frames counted), a 256³
   model solid to its core: the merge's table is a byte a place, or for a
   scene spread wide, twice this many slots of nine bytes (300 MB), and
   every frame's voxels are held until each depth is written. At most
   MAX_FRAMES frames; native at most D = 16, where a Morton key is 48 bits,
   still a whole number in a double. */
export const MAX_VOXELS = 2 ** 24, MAX_FRAMES = 1024, MAX_NATIVE_D = 16;

/* The palette a file without an RGBA chunk uses, the format notes' own
   table (0xAABBGGRR: red in the low byte), indexed by the voxel's index
   (0 is no voxel). Every MagicaVoxel since 0.99 writes its palette, so this
   is for older files. test/vox-core.test.js builds it again from what it is:
   a 6 × 6 × 6 cube in steps of 51 without black, blue fastest, then ramps of
   ten of red, green, blue and grey. */
export const DEFAULT_PALETTE = Uint32Array.of(
  0x00000000, 0xffffffff, 0xffccffff, 0xff99ffff, 0xff66ffff, 0xff33ffff, 0xff00ffff, 0xffffccff, 0xffccccff, 0xff99ccff, 0xff66ccff, 0xff33ccff, 0xff00ccff, 0xffff99ff, 0xffcc99ff, 0xff9999ff,
  0xff6699ff, 0xff3399ff, 0xff0099ff, 0xffff66ff, 0xffcc66ff, 0xff9966ff, 0xff6666ff, 0xff3366ff, 0xff0066ff, 0xffff33ff, 0xffcc33ff, 0xff9933ff, 0xff6633ff, 0xff3333ff, 0xff0033ff, 0xffff00ff,
  0xffcc00ff, 0xff9900ff, 0xff6600ff, 0xff3300ff, 0xff0000ff, 0xffffffcc, 0xffccffcc, 0xff99ffcc, 0xff66ffcc, 0xff33ffcc, 0xff00ffcc, 0xffffcccc, 0xffcccccc, 0xff99cccc, 0xff66cccc, 0xff33cccc,
  0xff00cccc, 0xffff99cc, 0xffcc99cc, 0xff9999cc, 0xff6699cc, 0xff3399cc, 0xff0099cc, 0xffff66cc, 0xffcc66cc, 0xff9966cc, 0xff6666cc, 0xff3366cc, 0xff0066cc, 0xffff33cc, 0xffcc33cc, 0xff9933cc,
  0xff6633cc, 0xff3333cc, 0xff0033cc, 0xffff00cc, 0xffcc00cc, 0xff9900cc, 0xff6600cc, 0xff3300cc, 0xff0000cc, 0xffffff99, 0xffccff99, 0xff99ff99, 0xff66ff99, 0xff33ff99, 0xff00ff99, 0xffffcc99,
  0xffcccc99, 0xff99cc99, 0xff66cc99, 0xff33cc99, 0xff00cc99, 0xffff9999, 0xffcc9999, 0xff999999, 0xff669999, 0xff339999, 0xff009999, 0xffff6699, 0xffcc6699, 0xff996699, 0xff666699, 0xff336699,
  0xff006699, 0xffff3399, 0xffcc3399, 0xff993399, 0xff663399, 0xff333399, 0xff003399, 0xffff0099, 0xffcc0099, 0xff990099, 0xff660099, 0xff330099, 0xff000099, 0xffffff66, 0xffccff66, 0xff99ff66,
  0xff66ff66, 0xff33ff66, 0xff00ff66, 0xffffcc66, 0xffcccc66, 0xff99cc66, 0xff66cc66, 0xff33cc66, 0xff00cc66, 0xffff9966, 0xffcc9966, 0xff999966, 0xff669966, 0xff339966, 0xff009966, 0xffff6666,
  0xffcc6666, 0xff996666, 0xff666666, 0xff336666, 0xff006666, 0xffff3366, 0xffcc3366, 0xff993366, 0xff663366, 0xff333366, 0xff003366, 0xffff0066, 0xffcc0066, 0xff990066, 0xff660066, 0xff330066,
  0xff000066, 0xffffff33, 0xffccff33, 0xff99ff33, 0xff66ff33, 0xff33ff33, 0xff00ff33, 0xffffcc33, 0xffcccc33, 0xff99cc33, 0xff66cc33, 0xff33cc33, 0xff00cc33, 0xffff9933, 0xffcc9933, 0xff999933,
  0xff669933, 0xff339933, 0xff009933, 0xffff6633, 0xffcc6633, 0xff996633, 0xff666633, 0xff336633, 0xff006633, 0xffff3333, 0xffcc3333, 0xff993333, 0xff663333, 0xff333333, 0xff003333, 0xffff0033,
  0xffcc0033, 0xff990033, 0xff660033, 0xff330033, 0xff000033, 0xffffff00, 0xffccff00, 0xff99ff00, 0xff66ff00, 0xff33ff00, 0xff00ff00, 0xffffcc00, 0xffcccc00, 0xff99cc00, 0xff66cc00, 0xff33cc00,
  0xff00cc00, 0xffff9900, 0xffcc9900, 0xff999900, 0xff669900, 0xff339900, 0xff009900, 0xffff6600, 0xffcc6600, 0xff996600, 0xff666600, 0xff336600, 0xff006600, 0xffff3300, 0xffcc3300, 0xff993300,
  0xff663300, 0xff333300, 0xff003300, 0xffff0000, 0xffcc0000, 0xff990000, 0xff660000, 0xff330000, 0xff0000ee, 0xff0000dd, 0xff0000bb, 0xff0000aa, 0xff000088, 0xff000077, 0xff000055, 0xff000044,
  0xff000022, 0xff000011, 0xff00ee00, 0xff00dd00, 0xff00bb00, 0xff00aa00, 0xff008800, 0xff007700, 0xff005500, 0xff004400, 0xff002200, 0xff001100, 0xffee0000, 0xffdd0000, 0xffbb0000, 0xffaa0000,
  0xff880000, 0xff770000, 0xff550000, 0xff440000, 0xff220000, 0xff110000, 0xffeeeeee, 0xffdddddd, 0xffbbbbbb, 0xffaaaaaa, 0xff888888, 0xff777777, 0xff555555, 0xff444444, 0xff222222, 0xff111111);

/* A file that can't be read as a .vox: the reader checks every count and
   length against what's left before it reads, so a damaged file says so
   rather than reading past its end (a file is outside input). */
export class VoxDamaged extends Error {
  constructor(m){ super(`not a readable .vox: ${m}`); this.name = 'VoxDamaged'; }
}
const damaged = m => { throw new VoxDamaged(m); };
const TEXT = new TextDecoder();

/* ---- the reader ------------------------------------------------------------------------
   'VOX ', a version (150, or 200 from MagicaVoxel 0.99.7), then the MAIN
   chunk, whose children are every other chunk. A chunk is its id, the
   length of its content and of its children, then both; only MAIN has
   children. Its children must fit MAIN, so a file cut short anywhere is
   damaged, and bytes after MAIN are only noted. Chunks it doesn't use
   (IMAP, NOTE, rOBJ, rCAM, MATT, anything newer) are skipped by length:
   IMAP only orders the palette window, and reorders the indices with it,
   so a voxel's colour is the RGBA chunk's either way.

   What it gives: `models`, each its size and its voxels as the file's
   bytes (x, y, z, index, four a voxel); `palette`, 256 × RGB by index (the
   RGBA chunk's entry i is index i + 1; the default table without one);
   the scene's `nodes` by id, `layers` and `materials`, their attributes as
   Maps (a key such as __proto__ is only a key); `meta`, the META chunk's
   (MagicaVoxel 0.99.7.2's animation range, `_anim_range`); and notes. */
export function readVox(bytes){
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), end = u8.length;
  const dv = new DataView(u8.buffer, u8.byteOffset, end), notes = [];
  const id = o => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  if (end < 8 || id(0) !== 'VOX ') damaged('it doesn\'t start with VOX');
  const version = dv.getInt32(4, true);
  if (version !== 150 && version !== 200) notes.push(`version ${version} (150 and 200 are known): read as 200`);
  if (end < 20 || id(8) !== 'MAIN') damaged('no MAIN chunk');
  const mainN = dv.getInt32(12, true), mainM = dv.getInt32(16, true);
  if (mainN < 0 || mainM < 0 || 20 + mainN + mainM > end) damaged('the MAIN chunk runs past the end of the file');
  if (20 + mainN + mainM < end) notes.push(`${end - 20 - mainN - mainM} bytes after the MAIN chunk ignored`);

  // A chunk's content, read with every length checked against what's left of it.
  const cursor = (at, lim, what) => {
    const c = {
      int(){ if (at + 4 > lim) damaged(`${what} is cut short`); const v = dv.getInt32(at, true); at += 4; return v; },
      count(least){ const v = c.int(); if (v < 0 || v * least > lim - at) damaged(`${what}: a count of ${v} with ${lim - at} bytes left`); return v; },
      str(){ const n = c.count(1), s = TEXT.decode(u8.subarray(at, at + n)); at += n; return s; },
      dict(){ const n = c.count(8), d = new Map(); for (let i = 0; i < n; i++){ const k = c.str(); d.set(k, c.str()); } return d; },
      skip(n){ at += n; },
      get at(){ return at; },
      get left(){ return lim - at; },
    };
    return c;
  };
  const models = [], nodes = new Map(), layers = new Map(), materials = new Map(), chunks = new Map();
  let rgba = null, pack = null, size = null, meta = new Map();
  const node = (nid, nd) => { if (nodes.has(nid)) damaged(`node ${nid} twice`); nodes.set(nid, nd); };
  for (let o = 20 + mainN, stop = 20 + mainN + mainM; o < stop;){
    if (o + 12 > stop) damaged(`a chunk at byte ${o} runs past MAIN`);
    const name = id(o), n = dv.getInt32(o + 4, true), m = dv.getInt32(o + 8, true), p = o + 12;
    if (n < 0 || m < 0 || p + n + m > stop) damaged(`the ${JSON.stringify(name)} chunk at byte ${o} runs past MAIN`);
    const c = cursor(p, p + n, `the ${name} chunk at byte ${o}`);
    chunks.set(name, (chunks.get(name) ?? 0) + 1);
    switch (name){
      case 'PACK': pack = c.int(); break;
      case 'SIZE': {
        if (size) damaged(`a SIZE chunk at byte ${o} after a SIZE with no XYZI`);
        size = [c.int(), c.int(), c.int()];
        if (!size.every(s => s >= 1 && s <= 256)) damaged(`a model of ${size.join(' × ')} (a side is 1 to 256)`);
        break;
      }
      case 'XYZI': {
        if (!size) damaged(`an XYZI chunk at byte ${o} with no SIZE before it`);
        const N = c.count(4);
        if (c.left !== 4 * N) damaged(`an XYZI chunk of ${N} voxels in ${n} bytes`);
        models.push({ size, n: N, xyzi: u8.slice(c.at, c.at + 4 * N) });
        size = null;
        break;
      }
      case 'RGBA': {
        if (n !== 1024) damaged(`an RGBA chunk of ${n} bytes, not 1024`);
        rgba = u8.subarray(p, p + 1024);
        break;
      }
      case 'nTRN': {
        const nid = c.int(), attrs = c.dict(), child = c.int(), reserved = c.int(), layer = c.int(), nf = c.count(4), frames = [];
        for (let i = 0; i < nf; i++) frames.push(c.dict());
        node(nid, { kind: 'T', attrs, child, reserved, layer, frames });
        break;
      }
      case 'nGRP': {
        const nid = c.int(), attrs = c.dict(), nc = c.count(4), children = [];
        for (let i = 0; i < nc; i++) children.push(c.int());
        node(nid, { kind: 'G', attrs, children });
        break;
      }
      case 'nSHP': {
        const nid = c.int(), attrs = c.dict(), nm = c.count(8), list = [];
        for (let i = 0; i < nm; i++) list.push({ model: c.int(), attrs: c.dict() });
        node(nid, { kind: 'S', attrs, models: list });
        break;
      }
      case 'LAYR': { const lid = c.int(); layers.set(lid, c.dict()); break; }
      case 'MATL': { const mid = c.int(); materials.set(mid, c.dict()); break; }
      case 'META': meta = c.dict(); break;
      default: break;
    }
    o = p + n + m;
  }
  if (size) damaged('a SIZE chunk with no XYZI after it');
  if (!models.length) damaged('no models');
  if (pack !== null && pack !== models.length) notes.push(`PACK says ${pack} models, the file holds ${models.length}`);
  const palette = new Uint8Array(768);
  if (rgba) for (let i = 0; i < 255; i++){ const q = 3 * (i + 1); palette[q] = rgba[4 * i]; palette[q + 1] = rgba[4 * i + 1]; palette[q + 2] = rgba[4 * i + 2]; }
  else for (let i = 1; i < 256; i++){ const v = DEFAULT_PALETTE[i]; palette[3 * i] = v & 255; palette[3 * i + 1] = v >>> 8 & 255; palette[3 * i + 2] = v >>> 16 & 255; }
  return { version, models, palette, paletteFrom: rgba ? 'file' : 'default', nodes, layers, materials, meta, chunks, notes };
}

/* ---- the scene -------------------------------------------------------------------------
   `_r` is one byte (format notes (c)): bits 0–1 the column of row 0's one
   non-zero entry, bits 2–3 row 1's, row 2's the column left, and bits 4, 5
   and 6 the rows' signs, so any of the 48 signed permutations, mirrors
   among them. Row-major, acting on columns: a point goes to R·v. Bit 7 is
   unused and ignored. Two rows on one column (or a column of 3) is no
   rotation, and the file is damaged. */
export function rotationOf(r){
  if (!(Number.isInteger(r) && r >= 0 && r <= 255)) damaged(`a rotation of ${r}`);
  const a = r & 3, b = r >> 2 & 3;
  if (a === 3 || b === 3 || a === b) damaged(`rotation ${r} has two rows on one axis`);
  const R = new Int8Array(9);
  R[a] = r & 16 ? -1 : 1; R[3 + b] = r & 32 ? -1 : 1; R[6 + (3 - a - b)] = r & 64 ? -1 : 1;
  return R;
}
const IDENTITY = Int8Array.of(1, 0, 0, 0, 1, 0, 0, 0, 1);
const mul3 = (A, B) => { const C = new Int8Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]; return C; };
const apply3 = (A, v) => [0, 1, 2].map(i => A[3 * i] * v[0] + A[3 * i + 1] * v[1] + A[3 * i + 2] * v[2]);
const intOf = (s, what) => { if (!/^[+-]?\d+$/.test(s.trim())) damaged(`${what} ${JSON.stringify(s)} isn't an integer`); return Number(s.trim()); };
/* A pose from a dictionary: rotation `rk` and translation `tk` ("x y z"),
   either left out meaning none. */
function poseOf(d, rk, tk){
  const R = d.has(rk) ? rotationOf(intOf(d.get(rk), 'a rotation')) : IDENTITY;
  let t = [0, 0, 0];
  if (d.has(tk)){
    const parts = d.get(tk).trim().split(/\s+/);
    if (parts.length !== 3) damaged(`a translation ${JSON.stringify(d.get(tk))}`);
    t = parts.map(s => intOf(s, 'a translation'));
  }
  return { R, t };
}
/* A still transform's pose: the base pose MagicaVoxel stores apart from
   the frames (`_frm_r`, `_frm_t` on the node) if there is one, else its
   first frame. */
function frameOf(nd){
  if (nd.attrs.has('_frm_r') || nd.attrs.has('_frm_t')) return poseOf(nd.attrs, '_frm_r', '_frm_t');
  return poseOf(nd.frames[0] ?? new Map(), '_r', '_t');
}

/* ---- frames ------------------------------------------------------------------------------
   A keyframe's frame is its `_f` (0 if it hasn't one); a node's keyframes
   are taken in frame order (the order written breaking ties). At frame f,
   as ogt_vox.h samples: `_loop` first wraps f into the first and last
   keyframes' frames; before the first it's the first, after the last the
   last; between two, the earlier's rotation and the position a straight
   line to the later's, truncated toward zero. Here that's integers over an
   integer, (t₀·(f₁ − f) + t₁·(f − f₀)) / (f₁ − f₀), so exact where ogt's
   float32 could round across a whole number. A shape's model snaps to the
   earlier keyframe. */
const frameNo = d => d.has('_f') ? intOf(d.get('_f'), 'a frame') : 0;
const keysOf = (list, fOf) => list.map((k, i) => ({ k, f: fOf(k), i })).sort((a, b) => a.f - b.f || a.i - b.i);
export function loopFrame(first, last, f){
  const len = 1 + last - first;
  return f >= first ? first + (f - first) % len : last - (first - f - 1) % len;
}
function keyAt(keys, f, loop){
  if (loop) f = loopFrame(keys[0].f, keys[keys.length - 1].f, f);
  if (f <= keys[0].f) return [keys[0], null, f];
  if (f >= keys[keys.length - 1].f) return [keys[keys.length - 1], null, f];
  let i = keys.length - 2;
  while (f < keys[i].f) i--;
  return [keys[i], keys[i + 1], f];
}
export function transformAt(nd, f){
  if (!nd.frames.length) return { R: IDENTITY, t: [0, 0, 0] };
  const [a, b, g] = keyAt(keysOf(nd.frames, frameNo), f, nd.attrs.get('_loop') === '1'), A = poseOf(a.k, '_r', '_t');
  if (!b) return A;
  const B = poseOf(b.k, '_r', '_t');
  return { R: A.R, t: A.t.map((v, i) => Math.trunc((v * (b.f - g) + B.t[i] * (g - a.f)) / (b.f - a.f))) };
}
export const modelAt = (nd, f) => keyAt(keysOf(nd.models, m => frameNo(m.attrs)), f, nd.attrs.get('_loop') === '1')[0].k.model;

/* Which frames a file has: [null] (still, one world) unless something in
   it moves, a transform with more than one keyframe or a shape with more
   than one model. Then every frame of the META chunk's `_anim_range` if it
   has a good one, else from the first keyframe to the last, at most
   MAX_FRAMES. A file from before the scene graph with several models
   (0.98's animation under PACK) is a frame a model. */
export function framesOf(V){
  const notes = [], upTo = n => Array.from({ length: Math.min(n, MAX_FRAMES) }, (_, i) => i);
  if (!V.nodes.size){
    if (V.models.length < 2) return { frames: [null], notes };
    notes.push(`${V.models.length} models and no scene: older files kept animation frames as models, so a frame a model`);
    if (V.models.length > MAX_FRAMES) notes.push(`the first ${MAX_FRAMES} frames`);
    return { frames: upTo(V.models.length), notes };
  }
  let lo = Infinity, hi = -Infinity, moving = 0;
  for (const nd of V.nodes.values()){
    const fs = nd.kind === 'T' ? nd.frames.map(frameNo) : nd.kind === 'S' ? nd.models.map(m => frameNo(m.attrs)) : [];
    if (fs.length < 2) continue;
    moving++;
    for (const f of fs){ lo = Math.min(lo, f); hi = Math.max(hi, f); }
  }
  if (!moving) return { frames: [null], notes };
  if (V.meta.has('_anim_range')){
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(V.meta.get('_anim_range'));
    if (m && +m[1] <= +m[2]){ lo = +m[1]; hi = +m[2]; }
    else notes.push(`an animation range of ${JSON.stringify(V.meta.get('_anim_range'))} ignored`);
  }
  const n = hi - lo + 1;
  if (n > MAX_FRAMES) notes.push(`${n} frames: the first ${MAX_FRAMES}`);
  const frames = upTo(n).map(i => lo + i);
  notes.push(`${moving} ${moving === 1 ? 'thing moves' : 'things move'}: ${frames.length} ${frames.length === 1 ? 'frame' : 'frames'} (${lo} to ${frames[frames.length - 1]}), a world a frame`);
  return { frames, notes };
}

/* Every copy of a model the scene shows at `frame` (null: still, each
   transform's base pose or first frame, each shape's first model), in the
   order the graph is walked from node 0: each `{ model, R, t }`, the
   transforms down to it composed. A transform that's hidden, or on a
   hidden layer, hides what's under it (MagicaVoxel doesn't draw it either)
   unless `hidden` keeps it. A file with no scene graph is its model at
   `frame` (the first if still). The walk refuses a node that's its own
   ancestor and stops at 2^20 steps, so a damaged graph can neither loop
   nor blow up as shared subtrees multiply. */
export const MAX_STEPS = 2 ** 20;
export function sceneOf(V, { frame = null, hidden: keep = false } = {}){
  const notes = [], instances = [];
  if (!V.nodes.size) return { instances: [{ model: frame ?? 0, R: IDENTITY, t: [0, 0, 0] }], notes };
  if (!V.nodes.has(0)) damaged('a scene with no node 0');
  const path = new Set();
  let steps = 0, hidden = 0;
  const walk = (nid, R, t) => {
    const nd = V.nodes.get(nid);
    if (!nd) damaged(`node ${nid} isn't in the file`);
    if (path.has(nid)) damaged(`node ${nid} is under itself`);
    if (++steps > MAX_STEPS) damaged(`a scene of more than ${MAX_STEPS} steps`);
    path.add(nid);
    if (nd.kind === 'T'){
      const off = nd.attrs.get('_hidden') === '1' || V.layers.get(nd.layer)?.get('_hidden') === '1';
      if (off) hidden++;
      if (!off || keep){
        const f = frame === null ? frameOf(nd) : transformAt(nd, frame), Rt = apply3(R, f.t);
        walk(nd.child, mul3(R, f.R), [Rt[0] + t[0], Rt[1] + t[1], Rt[2] + t[2]]);
      }
    } else if (nd.kind === 'G') for (const c of nd.children) walk(c, R, t);
    else {
      if (!nd.models.length) damaged(`shape ${nid} has no model`);
      const m = frame === null ? nd.models[0].model : modelAt(nd, frame);
      if (!(m >= 0 && m < V.models.length)) damaged(`shape ${nid} names model ${m} of ${V.models.length}`);
      instances.push({ model: m, R, t });
    }
    path.delete(nid);
  };
  walk(0, IDENTITY, [0, 0, 0]);
  if (hidden) notes.push(`${hidden} hidden ${hidden === 1 ? 'object' : 'objects'} ${keep ? 'kept' : 'left out'}`);
  return { instances, notes };
}

/* Where model voxel v lands (ogt_vox.h's reading): its centre v + ½, less
   the pivot floor(size / 2), turned by R and moved by t, is a voxel's
   centre, so the voxel is R·(v + ½ − p) + t − ½. Doubled, every term is an
   integer: (R·(2v + 1 − 2p) + 2t − 1) / 2, the numerator even. */
export const placeOf = (inst, size) => {
  const { R, t } = inst, p = size.map(s => s >> 1);
  return (x, y, z, out) => {
    const a = 2 * x + 1 - 2 * p[0], b = 2 * y + 1 - 2 * p[1], c = 2 * z + 1 - 2 * p[2];
    out[0] = (R[0] * a + R[1] * b + R[2] * c + 2 * t[0] - 1) / 2;
    out[1] = (R[3] * a + R[4] * b + R[5] * c + 2 * t[1] - 1) / 2;
    out[2] = (R[6] * a + R[7] * b + R[8] * c + 2 * t[2] - 1) / 2;
  };
};

/* ---- the voxels, merged -----------------------------------------------------------------
   Every copy's voxels into one table keyed by place (its number in the
   copies' box, a whole number below 2^53), a later one over an earlier:
   the scene's voxels, each its palette index. Then the list: places
   relative to the voxels' low corner (`at`, in the scene's places), the
   index, and whether it shows (a face to a place with no voxel, or the
   scene's edge). A voxel past its
   model's size, or of index 0 (no voxel), is dropped and noted.

   The table is a byte a place when the copies' box is at most `denseMax`
   places (2^27, 128 MB), which is nearly every .vox: a 256³ model is 16 MB.
   Past it (a scene of copies far apart) it's open addressing on the place's
   number, twice as many slots as voxels, nine bytes each. A 256³ ball solid
   to its core (8.8 million voxels) took 7.7 s and half a GB through the hash
   alone, seven probes a voxel; DENSE_MAX = 2^27 below. Either way `put`
   says whether a voxel was there and keeps the later one, `has` asks, and
   `each` visits every voxel in its own order (`table` says which it was): the cells are sorted later
   and their colours are integer sums, so the order never reaches a file.
   The test holds the two tables to each other. */
export const DENSE_MAX = 2 ** 27;
function denseTable(cells){
  const v = new Uint8Array(cells);
  return {
    kind: 'dense',
    put(k, c){ const was = v[k] !== 0; v[k] = c; return was; },
    has: k => v[k] !== 0,
    each(f){ for (let k = 0; k < cells; k++) if (v[k]) f(k, v[k]); },
  };
}
function hashTable(total){
  let cap = 16; while (cap < 2 * total) cap *= 2;
  const keys = new Float64Array(cap).fill(-1), vals = new Uint8Array(cap), mask = cap - 1;
  const slot = k => {
    let h = Math.imul((k >>> 0) ^ Math.imul(Math.floor(k / 4294967296), 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 15; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 13;
    let i = h & mask;
    while (keys[i] !== -1 && keys[i] !== k) i = i + 1 & mask;
    return i;
  };
  return {
    kind: 'hash',
    put(k, c){ const i = slot(k), was = keys[i] === k; keys[i] = k; vals[i] = c; return was; },
    has: k => keys[slot(k)] === k,
    each(f){ for (let i = 0; i < cap; i++) if (keys[i] >= 0) f(keys[i], vals[i]); },
  };
}
// What a merge dropped or covered, for the page (`over`: in every frame, added up).
export function mergeNotes({ outside, zero, over }, frames = 1){
  const all = frames > 1 ? ` (${frames} frames added up)` : '', out = [];
  if (outside) out.push(`${outside.toLocaleString('en-US')} voxels past their model's size dropped${all}`);
  if (zero) out.push(`${zero.toLocaleString('en-US')} voxels of colour 0 (none) dropped${all}`);
  if (over) out.push(`${over.toLocaleString('en-US')} voxels under a later one${all}`);
  return out;
}
export function mergeVoxels(V, S, { denseMax = DENSE_MAX } = {}){
  const notes = [], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], q = [0, 0, 0];
  let total = 0;
  for (const inst of S.instances){
    const M = V.models[inst.model], at = placeOf(inst, M.size), s = M.size;
    for (const c of [[0, 0, 0], [s[0] - 1, s[1] - 1, s[2] - 1]]){
      at(c[0], c[1], c[2], q);
      for (let a = 0; a < 3; a++){ lo[a] = Math.min(lo[a], q[a]); hi[a] = Math.max(hi[a], q[a]); }
    }
    total += M.n;
  }
  if (total > MAX_VOXELS) throw new Error(`${total.toLocaleString('en-US')} voxels placed, past the page's ${MAX_VOXELS.toLocaleString('en-US')}`);
  const NX = hi[0] - lo[0] + 1, NY = hi[1] - lo[1] + 1, NZ = hi[2] - lo[2] + 1, cells = NX * NY * NZ;
  if (cells > 2 ** 52) throw new Error(`the scene spans ${NX} × ${NY} × ${NZ}: too far to hold`);
  const T = cells <= denseMax ? denseTable(cells) : hashTable(total);
  let outside = 0, zero = 0, over = 0, n = 0;
  for (const inst of S.instances){
    const M = V.models[inst.model], at = placeOf(inst, M.size), [sx, sy, sz] = M.size, b = M.xyzi;
    for (let j = 0; j < 4 * M.n; j += 4){
      const x = b[j], y = b[j + 1], z = b[j + 2], c = b[j + 3];
      if (x >= sx || y >= sy || z >= sz){ outside++; continue; }
      if (!c){ zero++; continue; }
      at(x, y, z, q);
      if (T.put(((q[0] - lo[0]) * NY + (q[1] - lo[1])) * NZ + (q[2] - lo[2]), c)) over++; else n++;
    }
  }
  notes.push(...mergeNotes({ outside, zero, over }));
  if (!n) throw new Error('no voxels');
  const X = new Int32Array(n), Y = new Int32Array(n), Z = new Int32Array(n), C = new Uint8Array(n), shown = new Uint8Array(n);
  const Lo = [Infinity, Infinity, Infinity], Hi = [-Infinity, -Infinity, -Infinity];
  let m = 0;
  T.each((k, c) => {
    const z = k % NZ, r = (k - z) / NZ, y = r % NY, x = (r - y) / NY;
    X[m] = x; Y[m] = y; Z[m] = z; C[m] = c;
    shown[m] = x === 0 || x === NX - 1 || y === 0 || y === NY - 1 || z === 0 || z === NZ - 1 ||
               !T.has(k - NY * NZ) || !T.has(k + NY * NZ) || !T.has(k - NZ) || !T.has(k + NZ) || !T.has(k - 1) || !T.has(k + 1) ? 1 : 0;
    if (x < Lo[0]) Lo[0] = x; if (x > Hi[0]) Hi[0] = x;
    if (y < Lo[1]) Lo[1] = y; if (y > Hi[1]) Hi[1] = y;
    if (z < Lo[2]) Lo[2] = z; if (z > Hi[2]) Hi[2] = z;
    m++;
  });
  for (let i = 0; i < n; i++){ X[i] -= Lo[0]; Y[i] -= Lo[1]; Z[i] -= Lo[2]; }
  return { n, X, Y, Z, C, shown, size: [0, 1, 2].map(a => Hi[a] - Lo[a] + 1), at: [0, 1, 2].map(a => lo[a] + Lo[a]), table: T.kind,
           counts: { outside, zero, over }, notes };
}

/* ---- a depth ----------------------------------------------------------------------------- */
// The least depth whose cube holds a model of this size one voxel a voxel.
export const fitDepth = size => { let D = 0; while (2 ** D < Math.max(...size)) D++; return D; };
// Bits spread three apart (x bit 0, y bit 1, z bit 2, store.child's octants), D ≤ 10.
const SPREAD = Uint32Array.from({ length: 1024 }, (_, v) => { let m = 0; for (let b = 0; b < 10; b++) m |= (v >> b & 1) << 3 * b; return m; });
const morton = (x, y, z) => (SPREAD[x] | SPREAD[y] << 1 | SPREAD[z] << 2) >>> 0;
/* Past D = 10 (native, for a scene more than 1,024 across) a key is wider
   than 32 bits: the low ten bits of each axis as above, the rest 2^30 times
   over, a whole number in a double to D = 17. Sorted by the same LSD radix,
   its digits taken by division. Equal to `morton` where both apply. */
const mortonWide = (x, y, z) => morton(x & 1023, y & 1023, z & 1023) + morton(x >> 10, y >> 10, z >> 10) * 2 ** 30;
export function radixSortWide(keys, vals, bits){
  const n = keys.length, count = new Uint32Array(2048);
  let k = keys, v = vals, k2 = new Float64Array(n), v2 = new Uint32Array(n);
  for (let shift = 0; shift < bits; shift += 11){
    const P = 2 ** shift;
    count.fill(0);
    for (let i = 0; i < n; i++) count[Math.floor(k[i] / P) % 2048]++;
    let sum = 0;
    for (let d = 0; d < 2048; d++){ const c = count[d]; count[d] = sum; sum += c; }
    for (let i = 0; i < n; i++){ const d = Math.floor(k[i] / P) % 2048, at = count[d]++; k2[at] = k[i]; v2[at] = v[i]; }
    [k, k2] = [k2, k]; [v, v2] = [v2, v];
  }
  return { keys: k, vals: v };
}

/* The world at depth D in cells of 2^s voxels (s ≥ 0): each cell's Morton
   key, sorted, and (bake) its word, the mean of its voxels that show, or of
   all of them if none does. Turned to y up: world (x, y, z) is the cell's
   (x, z, flipped y). Centred in x and z, off the floor by 4% if there's
   room; `M` the world's box, as assetView wants it. Keys are wide past
   D = 10 (`wide`, which the test also asks for at small D). */
export function cellsOf(P, D, s, palette, { bake = true, wide = D > 10 } = {}){
  if (D > MAX_NATIVE_D) throw new Error(`a .vox depth is at most ${MAX_NATIVE_D}`);
  const side = 2 ** D, mq = P.size.map(m => (m - 1 >> s) + 1), mw = [mq[0], mq[2], mq[1]];
  if (mw.some(m => m > side)) throw new Error(`${mw.join(' × ')} cells don't fit D = ${D}`);
  const off = [side - mw[0] >> 1, Math.min(Math.round(0.04 * side), side - mw[1]), side - mw[2] >> 1];
  const { n, X, Y, Z, C, shown } = P, keys = wide ? new Float64Array(n) : new Uint32Array(n), idx = new Uint32Array(n), key = wide ? mortonWide : morton;
  for (let i = 0; i < n; i++){
    keys[i] = key((X[i] >> s) + off[0], (Z[i] >> s) + off[1], mq[1] - 1 - (Y[i] >> s) + off[2]);
    idx[i] = i;
  }
  const S = (wide ? radixSortWide : radixSort)(keys, idx, 3 * D), K = S.keys, I = S.vals, words = bake ? new Uint32Array(n) : null;
  let u = 0;
  for (let i = 0; i < n;){
    const key = K[i];
    let j = i, r = 0, g = 0, b = 0, c = 0, ra = 0, ga = 0, ba = 0;
    while (j < n && K[j] === key){
      if (words){
        const v = I[j], p = 3 * C[v];
        if (shown[v]){ r += palette[p]; g += palette[p + 1]; b += palette[p + 2]; c++; }
        ra += palette[p]; ga += palette[p + 1]; ba += palette[p + 2];
      }
      j++;
    }
    if (words) words[u] = c ? rgb8(r / c, g / c, b / c) : rgb8(ra / (j - i), ga / (j - i), ba / (j - i));
    K[u++] = key;
    i = j;
  }
  return { keys: K.subarray(0, u), words: words ? words.subarray(0, u) : null, u, D, M: { side, lo: off, hi: off.map((o, a) => o + mw[a]) } };
}
/* A world at depth D0 in `from`, each voxel made a 2^e cube, into `to` at
   D0 + e: the same tree, every node e levels up and a solid leaf solid(e).
   Children first, so ids stay children-first in `to`. */
export function scaleUp(from, to, root, D0, e){
  const memo = new Map(), bufs = Array.from({ length: D0 + 1 }, () => new Uint32Array(8));
  const rec = (id, l) => {
    if (id === EMPTY) return EMPTY;
    if (id === from.solid(l)) return to.solid(l + e);
    let out = memo.get(id);
    if (out !== undefined) return out;
    const ch = bufs[l];
    for (let o = 0; o < 8; o++){ const c = rec(from.child(id, o), l - 1); ch[o] = c; }
    out = to.intern(l + e, ch);
    memo.set(id, out);
    return out;
  };
  return rec(root, D0);
}
/* One depth's shape in `store`: e ≤ 0 is cells of 2^−e voxels at D; e > 0
   is the model at D − e, one voxel a voxel (in a store of its own), scaled
   up. The cells come back too, for the words. */
export function voxDepth(P, D, e, store, palette, { bake = true } = {}){
  if (e <= 0){
    const cells = cellsOf(P, D, -e, palette, { bake });
    return { root: fromMorton(store, cells.keys, cells.u, D), cells, shift: 0, M: cells.M };
  }
  const cells = cellsOf(P, D - e, 0, palette, { bake }), tmp = createStore(), k = 2 ** e;
  const root = scaleUp(tmp, store, fromMorton(tmp, cells.keys, cells.u, D - e), D - e, e);
  return { root, cells, shift: e, M: { side: 2 ** D, lo: cells.M.lo.map(v => v * k), hi: cells.M.hi.map(v => v * k) } };
}
/* The skin's words in rank order: each skin voxel's cell (its place shifted
   down by `shift`, a cell's key a voxel's key shifted 3·shift) is found by
   one walk along the sorted cells, since both go in Morton order. */
export function wordsOf(store, skin, D, cells, shift){
  const total = createCounts(store).of(skin), words = new Uint32Array(total), K = cells.keys, W = cells.words;
  let i = 0, p = 0;
  eachVoxel(store, skin, D, (x, y, z) => {
    const key = mortonWide(x >> shift, y >> shift, z >> shift);
    while (p < cells.u && K[p] < key) p++;
    if (K[p] !== key) throw new Error(`a skin voxel (${x}, ${y}, ${z}) in no cell`);
    words[i++] = W[p];
  });
  if (i !== total) throw new Error(`${i} skin voxels walked of ${total}`);
  return words;
}

/* ---- the conversion ---------------------------------------------------------------------
   `depths` from convert-core's DEPTHS (each the model at 2^(D − F) world
   voxels a voxel), and `native` for one voxel a voxel at max(6, F) (to
   MAX_NATIVE_D), named `<name> (native, D = …)` and
   `<slug>-native-d<D>.vdag` as vdb/'s native worlds are; a depth asked for
   that is the native world is written once, as native. `hidden` keeps
   hidden objects and layers. A file that moves is a world a frame in each
   depth's file, `<name> (frame f, D = …)`, every frame in the box of all
   of them; a still one is one world, as before. Each file goes to
   `onWorld` as it's made. `bake: false` writes the shape alone. */
export async function convertVox(bytes, { name = 'asset', depths = [8, 10], native = true, hidden = false, bits = 6, bake = true,
                                          onAsset = () => {}, onStage = () => {}, onWorld = () => {}, thumbs = true } = {}){
  if (bits !== 6 && bits !== 8) throw new Error('bits is 6 or 8');
  for (const D of depths) if (!DEPTHS.includes(D)) throw new Error(`D = ${D}: the page makes ${DEPTHS[0]} to ${DEPTHS.at(-1)}`);
  if (!depths.length && !native) throw new Error('no depth asked for');
  onStage(null, 'reading');
  const V = readVox(bytes), A = framesOf(V), scenes = A.frames.map(frame => sceneOf(V, { frame, hidden })), nf = scenes.length;
  const placed = scenes.reduce((a, S) => a + S.instances.reduce((b, i) => b + V.models[i.model].n, 0), 0);
  if (nf > 1 && placed > MAX_VOXELS) throw new Error(`${placed.toLocaleString('en-US')} voxels placed in ${nf} frames, past the page's ${MAX_VOXELS.toLocaleString('en-US')}`);
  onStage(null, 'placing');
  const Ps = scenes.map(S => mergeVoxels(V, S));
  // Every frame in one box, so the animation doesn't jump.
  const lo = [0, 1, 2].map(a => Ps.reduce((m, P) => Math.min(m, P.at[a]), Infinity)), hi = [0, 1, 2].map(a => Ps.reduce((m, P) => Math.max(m, P.at[a] + P.size[a]), -Infinity));
  const size = hi.map((h, a) => h - lo[a]);
  for (const P of Ps){
    const d = P.at.map((v, a) => v - lo[a]);
    if (d.some(Boolean)) for (let i = 0; i < P.n; i++){ P.X[i] += d[0]; P.Y[i] += d[1]; P.Z[i] += d[2]; }
    P.size = size;
  }
  const F = fitDepth(size), Dn = Math.max(DEPTHS[0], F), sum = k => Ps.reduce((a, P) => a + P.counts[k], 0);
  const notes = [...V.notes, ...A.notes, ...scenes[0].notes, ...(nf > 1 ? mergeNotes({ outside: sum('outside'), zero: sum('zero'), over: sum('over') }, nf) : Ps[0].notes)];
  const plan = depths.map(D => ({ D, e: D - F, native: false }));
  if (native){
    if (Dn > MAX_NATIVE_D) notes.push(`its native depth is D = ${Dn}, past ${MAX_NATIVE_D}: not written`);
    else {
      const same = plan.findIndex(p => p.D === Dn && p.e === 0);
      if (same >= 0){ plan.splice(same, 1); notes.push(`D = ${Dn} is its native depth: written once, as native`); }
      plan.push({ D: Dn, e: 0, native: true });
    }
  }
  if (!plan.length) throw new Error('nothing to write: its native depth is past the page\'s');
  // Colours MagicaVoxel renders as more than a colour (MATL chunks, a material an index).
  const used = new Set(Ps.flatMap(P => [...new Set(P.C)])), special = [...V.materials].filter(([i, m]) => used.has(i) && (m.get('_type') ?? '_diffuse') !== '_diffuse');
  if (special.length) notes.push(`${special.length} ${special.length === 1 ? 'colour is' : 'colours are'} ${[...new Set(special.map(([, m]) => m.get('_type').replace(/^_/, '')))].join(', ')} in MagicaVoxel: the colour alone kept`);
  const asset = { kind: 'vox', version: V.version, models: V.models.length, instances: scenes[0].instances.length, voxels: Ps[0].n, size,
                  fit: F, native: Dn <= MAX_NATIVE_D ? Dn : null, frames: nf, palette: V.paletteFrom, notes };
  onAsset(asset);
  const slug = slugOf(name), worlds = [];
  for (const { D, e, native: nat } of plan){
    const ms = {}, stage = stager(D, ms, onStage), store = createStore(), list = [];
    const at = nat ? 'native, ' : '', titleOf = f => f === null ? `${name} (${at}D = ${D})` : `${name} (frame ${f}, ${at}D = ${D})`;
    for (const [k, P] of Ps.entries()){
      stage('voxels');
      const d = voxDepth(P, D, e, store, V.palette, { bake });
      let skin = null, words = null;
      if (bake){
        stage('skin'); skin = skinOf(store, d.root, D);
        stage('words'); words = wordsOf(store, skin, D, d.cells, d.shift);
      }
      list.push({ root: d.root, M: d.M, skin, words, title: titleOf(A.frames[k]) });
    }
    const world = await finishWorlds({ store, D, worlds: list, bits, thumbs, stage, ms, file: nat ? `${slug}-native-d${D}.vdag` : `${slug}-d${D}.vdag` });
    Object.assign(world, { native: nat, scale: e });
    worlds.push(world); onWorld(world);
  }
  return { asset, worlds };
}
