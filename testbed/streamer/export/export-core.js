/* ================== EXPORT CORE (pure) ===============================
   A world file's world as a glTF binary (docs/export.md, asked for
   2026-11-20): the surface the stream viewer draws at one lod, as quads,
   in a .glb any 3D tool opens. Pure: no DOM, no Worker; imports dag-core,
   chunk-core, job-core and attr-core only, so export/export-worker.js, Node
   and the tests load it as is.

   What a lod's surface is. Not a new rule: the viewer's chunk job, run on
   every chunk the lod shows. job-core's fastChunk (expandChunk's bytes, held
   to it byte for byte by test/job-core.test.js) gives each shown cell a face
   mask with the apron border, so a face is hidden exactly when the cell
   across it, at the same lod, is kept by the same rule, even across chunks.
   With every chunk at one lod there are no seams to fill, and the faces are
   a closed surface of the kept cells: outside the world counts as empty
   (nodeAt), so the world's edge is closed too. The words are the job's
   (cellAttr, meanDepth 1 as the streamer's MEAN_DEPTH), six bits a channel,
   so the colours are the ones the viewer shows; or, asked (§7's answers,
   2026-11-20), the same mean rounded to eight bits (chunk-core's
   cellMean: a baked 8-bit file's lod 0 is its own words), or the gamut,
   each corner's place over the world's side, as the viewer draws a world
   with no colour.

   Which chunks. Walking every chunk of a lod (expandWorld) is 8^(D − lod − 6)
   calls, most of them on air. `chunksOf` walks the DAG instead: an empty
   node is skipped whole, and a full node lists only the chunks on its shell,
   since one inside it has six full neighbours. A full chunk with six full
   neighbours shows nothing under any rule (a full brick keeps every cell),
   so it's skipped too. The list stops at `maxChunks`: a solid D = 20 world
   at lod 0 is 6·2^28 shell chunks, and nothing past the list could stop it.

   Merging. A face mask is one quad a face: a flat 64² patch of one colour is
   4,096 quads. Within a chunk, faces of one direction, one slice and one
   word are merged into rectangles, greedily (each unclaimed face, in row
   order, takes the longest run along u, then as many rows along v as match
   the whole run). Colour bounds it: a baked asset's words differ voxel to
   voxel, and merging buys little there; the kit's, the city's and a
   colourless world's surfaces fall by 2–50×. But merged quads meet with
   T-junctions, so the mesh is no longer watertight by its edges: a tool
   that welds vertices and asks whether every edge is shared (a 3D print
   check, a boolean, a physics mesh, glb-core's own `analyse`) finds none
   closed. Through convert/ again, the D = 8 knight a quad a face comes back
   as one solid (1,625,127 voxels for its 1,552,629, at convert's own fit),
   merged as a surface only (224,301): docs/export.md §3. So `merge` is off
   unless asked for.

   A quad is six words: direction (the mask's bit, +X −X +Y −Y +Z −Z), the
   plane, and u0, v0, u1, v1, in cells of the lod (u the axis after the
   face's, v the one after that, cyclically), so they're integers below 2^24
   and exact in float32. The world's side in cells, 2^(D − lod), must be at
   most 2^24 (`MAX_CELL_LEVELS`).

   The file. One mesh, one primitive, one material, no extensions (glTF 2.0
   core only): POSITION in cells (float32), NORMAL (float32), COLOR_0 linear
   as unsigned short normalized VEC4 (the words are sRGB, and an 8-bit
   linear channel would merge the six-bit dark steps), indices uint16 when
   they fit, else uint32. The node's scale makes cells metres (`voxel`
   metres a voxel, 2^lod voxels a cell) and its translation centres the
   content's box in x and z and stands it on y = 0. Without a colour field
   there is no COLOR_0 and the material is a grey (`GREY`). The material is
   rough and not metallic: glTF's default material is fully metallic, which
   draws vertex colours nearly black. Four vertices a quad, since a cube's
   faces don't share normals: 32 bytes a vertex, 6 or 3 index words a quad.

   Size. 16 million coloured quads (the page's top limit, asked for
   2026-11-20) is 2.43 GB, and a .glb's lengths are uint32, so 4 GB (about
   28 million) is the ceiling, refused before a byte is made. Below it the
   trap was holding the file: whole vertex arrays and then one buffer of the
   file's size were 5 GB at 16 million. glbParts yields the file a slice of
   quads at a time instead, and the page's worker folds the slices into a
   Blob (docs/export.md §2, §8). */
import { EMPTY, isFull } from '../dag-core.js';
import { CHUNK_LEVELS, CELL_MASK, MASK_SHIFT, nodeAt, chunkNode, cellMean } from '../chunk-core.js';
import { fastChunk, createJobCache } from '../job-core.js';
import { ATTR_COLOUR, R_SHIFT, G_SHIFT, B_SHIFT, rgb8 } from '../attr-core.js';

export const MEAN_DEPTH = 1;                 // stream-core's MEAN_DEPTH, which pages draw with
export const MAX_CELL_LEVELS = 24;           // float32 holds every integer to 2^24
export const QUAD_WORDS = 6;
export const GREY = 0.5;                     // linear: sRGB ≈ 0.74
export const RULES = ['shadow', 'any', 'adaptive', 'majority'];
// A .glb's lengths are uint32: 4 GB at most, about 28 million coloured quads.
export const MAX_GLB = 2 ** 32 - 1;
// The writer's slice: 2^18 quads, 12.6 MB of positions at a time.
export const SLICE = 2 ** 18;
export const coarsestLod = D => Math.max(0, D - CHUNK_LEVELS);
export const finestLod = D => Math.max(0, D - MAX_CELL_LEVELS);
export const slugOf = name => String(name).toLowerCase().replace(/\(d = (\d+)\)/g, 'd$1').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'world';

/* ---- which chunks a lod shows --------------------------------------------------------
   Chunk coordinates [cx, cy, cz] in chunk raster order within each DAG node
   (octant order down the tree), so the list, and the file, is the same on
   every run. `over` is set when the list passed maxChunks. */
export function chunksOf(store, counts, root, D, lod, maxChunks = Infinity){
  const CL = lod + CHUNK_LEVELS, out = [];
  out.over = false;
  if (root === EMPTY) return out;
  if (D <= CL){ out.push([0, 0, 0]); return out; }
  const full = (id, k) => isFull(store, counts, id, k);
  const fullAt = (x, y, z) => full(nodeAt(store, root, D, CL, x, y, z), CL);
  const buried = (x, y, z) => fullAt(x + 1, y, z) && fullAt(x - 1, y, z) && fullAt(x, y + 1, z) && fullAt(x, y - 1, z) && fullAt(x, y, z + 1) && fullAt(x, y, z - 1);
  const add = (x, y, z) => { if (out.length >= maxChunks){ out.over = true; return false; } out.push([x, y, z]); return true; };
  const walk = (id, k, X, Y, Z) => {
    if (id === EMPTY || out.over) return;
    if (full(id, k)){
      // Every chunk inside is full with six full neighbours: only the shell can show.
      const n = 2 ** (k - CL);
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++){
        const edge = z === 0 || z === n - 1 || y === 0 || y === n - 1;
        for (let x = 0; x < n; x += edge || x === n - 1 ? 1 : n - 1){
          if (!buried(X + x, Y + y, Z + z) && !add(X + x, Y + y, Z + z)) return;
        }
      }
      return;
    }
    if (k === CL){ add(X, Y, Z); return; }
    const h = 2 ** (k - 1 - CL);
    for (let o = 0; o < 8; o++) walk(store.child(id, o), k - 1, X + (o & 1) * h, Y + (o >> 1 & 1) * h, Z + (o >> 2) * h);
  };
  walk(root, D, 0, 0, 0);
  return out;
}

/* ---- the faces of one chunk, merged ---------------------------------------------------
   A 64³ grid a direction (6 MB, made once), holding each shown face's key
   (its colour bits + 1, or 1 with no colour) at [direction][slice][v][u];
   each slice's bounding box is kept, and the greedy pass zeroes every face
   it takes, so the grid is clear again for the next chunk. */
const SIDE = 64, AREA = SIDE * SIDE;
let FACES = null;
const BOX = new Int16Array(4 * 6 * SIDE), TOUCHED = new Uint8Array(6 * SIDE);
// Morton decode, 3 bits an axis per lookup: DEC[i & 511] is x | y << 3 | z << 6.
const DEC = new Uint16Array(512);
for (let i = 0; i < 512; i++){
  let x = 0, y = 0, z = 0;
  for (let b = 0; b < 3; b++){ x |= (i >> 3 * b & 1) << b; y |= (i >> 3 * b + 1 & 1) << b; z |= (i >> 3 * b + 2 & 1) << b; }
  DEC[i] = x | y << 3 | z << 6;
}

function quadSink(){
  let data = new Uint32Array(QUAD_WORDS * 4096), words = new Uint32Array(4096), n = 0;
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const push = (dir, plane, u0, v0, u1, v1, word) => {
    if (n === words.length){
      const d2 = new Uint32Array(data.length * 2); d2.set(data); data = d2;
      const w2 = new Uint32Array(words.length * 2); w2.set(words); words = w2;
    }
    const o = QUAD_WORDS * n, a = dir >> 1, ua = (a + 1) % 3, va = (a + 2) % 3;
    data[o] = dir; data[o + 1] = plane; data[o + 2] = u0; data[o + 3] = v0; data[o + 4] = u1; data[o + 5] = v1;
    words[n++] = word;
    if (plane < box[a]) box[a] = plane;
    if (plane > box[a + 3]) box[a + 3] = plane;
    if (u0 < box[ua]) box[ua] = u0;
    if (u1 > box[ua + 3]) box[ua + 3] = u1;
    if (v0 < box[va]) box[va] = v0;
    if (v1 > box[va + 3]) box[va + 3] = v1;
  };
  return { push, get n(){ return n; }, done: () => ({ data: data.slice(0, QUAD_WORDS * n), words: words.slice(0, n), box: n ? box : null }) };
}

/* wordAt(i, x, y, z) is record i's word (its cell at x, y, z in the
   chunk), or wordAt is null for a mesh with no words (grey, or gamut). */
function chunkQuads(sink, r, wordAt, merge, C){
  if (!FACES) FACES = new Uint32Array(6 * SIDE * AREA);
  const { records, count } = r, coloured = !!wordAt;
  for (let i = 0; i < count; i++){
    const rec = records[i], m = rec >>> MASK_SHIFT & 63;
    if (!m) continue;
    const cell = rec & CELL_MASK, lo = DEC[cell & 511], hi = DEC[cell >>> 9];
    const x = (lo & 7) | (hi & 7) << 3, y = (lo >> 3 & 7) | (hi >> 3 & 7) << 3, z = (lo >> 6) | (hi >> 6) << 3;
    const key = coloured ? wordAt(i, x, y, z) + 1 : 1;
    for (let b = 0; b < 6; b++){
      if (!(m >> b & 1)) continue;
      const a = b >> 1, s = a === 0 ? x : a === 1 ? y : z, u = a === 0 ? y : a === 1 ? z : x, v = a === 0 ? z : a === 1 ? x : y;
      const sl = b * SIDE + s, bo = 4 * sl;
      FACES[sl * AREA + v * SIDE + u] = key;
      if (!TOUCHED[sl]){ TOUCHED[sl] = 1; BOX[bo] = u; BOX[bo + 1] = u; BOX[bo + 2] = v; BOX[bo + 3] = v; }
      else {
        if (u < BOX[bo]) BOX[bo] = u; else if (u > BOX[bo + 1]) BOX[bo + 1] = u;
        if (v < BOX[bo + 2]) BOX[bo + 2] = v; else if (v > BOX[bo + 3]) BOX[bo + 3] = v;
      }
    }
  }
  // Slices in direction then slice order, rows v then u: the order is the file's.
  for (let sl = 0; sl < 6 * SIDE; sl++){
    if (!TOUCHED[sl]) continue;
    TOUCHED[sl] = 0;
    const b = sl >> 6, s = sl & 63, a = b >> 1, base = sl * AREA, bo = 4 * sl;
    const u0 = BOX[bo], u1 = BOX[bo + 1], v0 = BOX[bo + 2], v1 = BOX[bo + 3];
    const plane = C[a] + s + (b & 1 ? 0 : 1), cu = C[(a + 1) % 3], cv = C[(a + 2) % 3];
    for (let v = v0; v <= v1; v++){
      for (let u = u0; u <= u1; u++){
        const k = FACES[base + v * SIDE + u];
        if (!k) continue;
        let w = 1, h = 1;
        if (merge){
          while (u + w <= u1 && FACES[base + v * SIDE + u + w] === k) w++;
          rows: while (v + h <= v1){
            const row = base + (v + h) * SIDE + u;
            for (let i = 0; i < w; i++) if (FACES[row + i] !== k) break rows;
            h++;
          }
        }
        for (let j = 0; j < h; j++) FACES.fill(0, base + (v + j) * SIDE + u, base + (v + j) * SIDE + u + w);
        sink.push(b, plane, cu + u, cv + v, cu + u + w, cv + v + h, coloured ? k - 1 : 0);
      }
    }
  }
}

/* ---- a lod's surface -------------------------------------------------------------------
   world: { store, root, D, counts } (counts: createCounts(store)).
   opts:  lod, lodRule ('shadow', the viewer's default), colour (a field, or
          null), bits (6: the job's words, the colours the viewer shows; 8:
          the same mean before it's made six bits, rounded to eight, so a
          baked 8-bit file's lod 0 is its own words), gamut (with no colour
          field: colour by position, as the viewer draws a world with none),
          merge (false: a quad a face, watertight), maxQuads and maxChunks
          (stop past them: the result has `over` set to 'quads' or 'chunks'
          and no quads), onProgress(done, total) after each chunk.
   Returns { lod, lodRule, D, coloured, bits, gamut, merged, chunks, faces,
   quads, data, words, box }: `coloured` whether the file has COLOR_0,
   `bits` 6 or 8 for words (null without), `faces` the shown faces (the
   job's quads), `quads` what they merged into, `data` QUAD_WORDS a quad,
   `words` a quad's word (an attribute word at six bits, rgb8 at eight, 0
   without), `box` the content's [x0, y0, z0, x1, y1, z1] in cells, or null
   for no quads.

   Eight bits: the job runs without colour (its masks don't depend on it)
   and each shown cell's word is chunk-core's cellMean, the mean cellAttr
   rounds to six bits, rounded to eight instead. The cell's node is the
   chunk's walked six levels down, as the job found it. */
export function surfaceMesh(world, opts = {}){
  const { store, root, D, counts } = world;
  const { lod = 0, lodRule = 'shadow', colour = null, bits = 6, gamut = false, merge = false, maxQuads = Infinity, maxChunks = Infinity, meanDepth = MEAN_DEPTH, onProgress = null } = opts;
  if (!Number.isInteger(lod) || lod < finestLod(D) || lod > Math.max(coarsestLod(D), 0))
    throw new Error(`surfaceMesh: lod ${lod} is outside ${finestLod(D)}–${coarsestLod(D)} for D = ${D}`);
  if (bits !== 6 && bits !== 8) throw new Error(`surfaceMesh: bits is 6 or 8, not ${bits}`);
  const head = { lod, lodRule, D, coloured: !!colour || !!gamut, bits: colour ? bits : null, gamut: !colour && !!gamut, merged: merge };
  const list = chunksOf(store, counts, root, D, lod, maxChunks);
  if (list.over) return { ...head, over: 'chunks', chunks: list.length };
  const cache = createJobCache(), sink = quadSink(), C = [0, 0, 0], cs = 2 ** lod, MEAN = new Float64Array(3);
  let faces = 0, r = null, chunk = null;
  const six = (i) => r.attrs[i] & ATTR_COLOUR;
  const eight = (i, x, y, z) => {
    const id = nodeAt(store, chunk.id, chunk.level, lod, x, y, z);
    cellMean(store, counts, colour, id, lod, meanDepth, (C[0] + x) * cs, (C[1] + y) * cs, (C[2] + z) * cs, MEAN);
    return rgb8(MEAN[0], MEAN[1], MEAN[2]);
  };
  const wordAt = !colour ? null : bits === 8 ? eight : six;
  for (let i = 0; i < list.length; i++){
    const [cx, cy, cz] = list[i];
    r = fastChunk(store, root, D, { lod, cx, cy, cz }, { counts, lodRule, colour: bits === 6 ? colour : null, meanDepth, cache });
    faces += r.quads;
    C[0] = cx * SIDE; C[1] = cy * SIDE; C[2] = cz * SIDE;
    if (bits === 8) chunk = chunkNode(store, root, D, lod, cx, cy, cz);
    chunkQuads(sink, r, wordAt, merge, C);
    if (sink.n > maxQuads) return { ...head, over: 'quads', chunks: list.length, faces, quads: sink.n };
    onProgress?.(i + 1, list.length);
  }
  const { data, words, box } = sink.done();
  return { ...head, chunks: list.length, faces, quads: words.length, data, words, box };
}

/* ---- vertices ---------------------------------------------------------------------------
   An sRGB channel to linear, as unsigned short normalized: six-bit words
   (c / 63, GLSL_ATTR's attrColour), eight-bit ones (c / 255), and the gamut
   (a corner's place over the world's side, as the viewer's colour mode 3:
   vGamut is the position over W.side, read as the colour shown). */
export const srgbToLinear = s => s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
const linear16 = s => Math.round(65535 * srgbToLinear(s));
export const LINEAR16 = Uint16Array.from({ length: 64 }, (_, c) => Math.round(65535 * srgbToLinear(c / 63)));
export const LINEAR16_8 = Uint16Array.from({ length: 256 }, (_, c) => linear16(c / 255));
const GAMUT_TABLES = new Map();
function gamutOf(mesh){
  const N = 2 ** (mesh.D - mesh.lod);
  if (N > 65536) return p => linear16(Math.min(1, p / N));
  let t = GAMUT_TABLES.get(N);
  if (!t){ t = Uint16Array.from({ length: N + 1 }, (_, p) => linear16(p / N)); GAMUT_TABLES.set(N, t); }
  return p => t[p];
}

/* Four vertices a quad, wound counter-clockwise seen from the side its
   normal points to (u × v is the face's axis, so (u0,v0) (u1,v0) (u1,v1)
   (u0,v1) faces +axis, and the reverse −axis), triangles 0 1 2 and 0 2 3.
   Each array is made for quads q0 to q1 alone, so the writer goes a slice
   at a time; indices count from the first vertex of the whole mesh.
   (export/index.html draws the same corners in its vertex shader.) */
const cornersOf = (neg, u0, v0, u1, v1) => neg ? [u0, v0, u0, v1, u1, v1, u1, v0] : [u0, v0, u1, v0, u1, v1, u0, v1];
const wideOf = quads => 4 * quads > 65536;
function positionsOf(mesh, q0, q1, gamut = null){
  const d = mesh.data, out = gamut ? new Uint16Array(16 * (q1 - q0)) : new Float32Array(12 * (q1 - q0)), P = [0, 0, 0];
  for (let q = q0; q < q1; q++){
    const o = QUAD_WORDS * q, b = d[o], a = b >> 1, ua = (a + 1) % 3, va = (a + 2) % 3;
    P[a] = d[o + 1];
    const corners = cornersOf(b & 1, d[o + 2], d[o + 3], d[o + 4], d[o + 5]);
    for (let k = 0; k < 4; k++){
      P[ua] = corners[2 * k]; P[va] = corners[2 * k + 1];
      if (gamut){ const c = 16 * (q - q0) + 4 * k; out[c] = gamut(P[0]); out[c + 1] = gamut(P[1]); out[c + 2] = gamut(P[2]); out[c + 3] = 65535; }
      else { const p = 12 * (q - q0) + 3 * k; out[p] = P[0]; out[p + 1] = P[1]; out[p + 2] = P[2]; }
    }
  }
  return out;
}
function normalsOf(mesh, q0, q1){
  const d = mesh.data, out = new Float32Array(12 * (q1 - q0));
  for (let q = q0; q < q1; q++){
    const b = d[QUAD_WORDS * q], a = b >> 1, neg = b & 1;
    for (let k = 0; k < 4; k++) out[12 * (q - q0) + 3 * k + a] = neg ? -1 : 1;
  }
  return out;
}
function coloursOf(mesh, q0, q1){
  if (mesh.gamut) return positionsOf(mesh, q0, q1, gamutOf(mesh));
  const out = new Uint16Array(16 * (q1 - q0)), eight = mesh.bits === 8;
  for (let q = q0; q < q1; q++){
    const w = mesh.words[q];
    const r = eight ? LINEAR16_8[w & 255] : LINEAR16[w >>> R_SHIFT & 63];
    const g = eight ? LINEAR16_8[w >> 8 & 255] : LINEAR16[w >>> G_SHIFT & 63];
    const bl = eight ? LINEAR16_8[w >> 16 & 255] : LINEAR16[w >>> B_SHIFT & 63];
    for (let k = 0; k < 4; k++){ const c = 16 * (q - q0) + 4 * k; out[c] = r; out[c + 1] = g; out[c + 2] = bl; out[c + 3] = 65535; }
  }
  return out;
}
function indicesOf(mesh, q0, q1){
  const out = wideOf(mesh.quads) ? new Uint32Array(6 * (q1 - q0)) : new Uint16Array(6 * (q1 - q0));
  for (let q = q0; q < q1; q++){
    const i = 6 * (q - q0), v = 4 * q;
    out[i] = v; out[i + 1] = v + 1; out[i + 2] = v + 2; out[i + 3] = v; out[i + 4] = v + 2; out[i + 5] = v + 3;
  }
  return out;
}
export function vertexArrays(mesh){
  const n = mesh.quads;
  return { positions: positionsOf(mesh, 0, n), normals: normalsOf(mesh, 0, n), colours: mesh.coloured ? coloursOf(mesh, 0, n) : null, indices: indicesOf(mesh, 0, n) };
}

/* ---- the .glb ---------------------------------------------------------------------------
   Its size, before it's written (the page's table): the binary chunk exactly,
   plus ~1.5 KB of JSON. */
export const binBytesOf = (quads, coloured, normals = true) => quads * (4 * ((coloured ? 32 : 24) - (normals ? 0 : 12)) + (wideOf(quads) ? 24 : 12));

/* Where the node puts the cells: `voxel` metres a voxel. */
export function placementOf(mesh, voxel = 0.01){
  const s = voxel * 2 ** mesh.lod, b = mesh.box;
  return { scale: s, translation: [-(b[0] + b[3]) / 2 * s, -b[1] * s, -(b[2] + b[5]) / 2 * s],
           size: [(b[3] - b[0]) * s, (b[4] - b[1]) * s, (b[5] - b[2]) * s] };
}

/* The file as parts: { total, parts }, parts an iterator of Uint8Arrays
   whose concatenation is the .glb (the header and JSON, then each
   attribute's view `slice` quads at a time). A 16-million-quad file is
   2.4 GB, so the page's worker folds the parts into a Blob as they come and
   never holds the file in one buffer (docs/export.md §2); writeGlb joins
   them, for Node and the tests. The bytes don't depend on `slice`.

   `normals: false` leaves NORMAL out (asked for 2026-11-20, docs/export.md
   §8): glTF says a primitive without it gets flat normals from its reader,
   and with four vertices a quad flat is the only kind there is, so the
   file means the same, 12 bytes a vertex smaller (2.4 GB to 1.66 GB at 16
   million coloured quads). Whether a reader does as the spec says is the
   reader's; Blender 4.0.1 does (§8). */
const pad4 = n => (n + 3) & ~3;
const COLOUR_NAME = m => m.gamut ? 'gamut' : m.bits ? `${m.bits} bits` : 'none';
export function glbParts(mesh, { name = 'world', voxel = 0.01, extras = {}, slice = SLICE, normals = true } = {}){
  if (!mesh.quads) throw new Error('writeGlb: the mesh has no quads');
  if (!(voxel > 0 && Number.isFinite(voxel))) throw new Error(`writeGlb: a voxel must be a positive size in metres, not ${voxel}`);
  const n = 4 * mesh.quads, Q = mesh.quads, wide = wideOf(Q);
  // Each view: its byte length and the function making a slice of it.
  const views = [[12 * n, positionsOf], ...(normals ? [[12 * n, normalsOf]] : []), ...(mesh.coloured ? [[8 * n, coloursOf]] : []), [(wide ? 4 : 2) * 6 * Q, indicesOf]];
  const bufferViews = [];
  let length = 0;
  for (const [i, [bytes]] of views.entries()){
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes, target: i === views.length - 1 ? 34963 : 34962 });
    length += pad4(bytes);
  }
  const b = mesh.box, accessors = [{ bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]] }];
  const attributes = { POSITION: 0 };
  if (normals){ attributes.NORMAL = accessors.length; accessors.push({ bufferView: accessors.length, componentType: 5126, count: n, type: 'VEC3' }); }
  if (mesh.coloured){ attributes.COLOR_0 = accessors.length; accessors.push({ bufferView: accessors.length, componentType: 5123, normalized: true, count: n, type: 'VEC4' }); }
  const indexAccessor = accessors.length;
  accessors.push({ bufferView: views.length - 1, componentType: wide ? 5125 : 5123, count: 6 * Q, type: 'SCALAR' });
  const at = placementOf(mesh, voxel), title = String(name);
  const json = {
    asset: { version: '2.0', generator: 'ifs-testbed export/ (vdag to glb)' },
    scene: 0,
    scenes: [{ name: title, nodes: [0] }],
    nodes: [{ name: title, mesh: 0, translation: at.translation, scale: [at.scale, at.scale, at.scale],
              extras: { D: mesh.D, lod: mesh.lod, lodRule: mesh.lodRule, voxel, merged: mesh.merged, colour: COLOUR_NAME(mesh), normals, ...extras } }],
    meshes: [{ name: title, primitives: [{ attributes, indices: indexAccessor, material: 0, mode: 4 }] }],
    materials: [{ name: mesh.coloured ? 'voxels' : 'voxels (no colour)',
                  pbrMetallicRoughness: { baseColorFactor: mesh.coloured ? [1, 1, 1, 1] : [GREY, GREY, GREY, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: length }],
    bufferViews, accessors,
  };
  const text = new TextEncoder().encode(JSON.stringify(json)), jl = pad4(text.length), total = 12 + 8 + jl + 8 + length;
  if (total > MAX_GLB) throw new Error(`writeGlb: ${(total / 2 ** 30).toFixed(2)} GB is over a .glb's 4 GB (its lengths are uint32)`);
  const headOf = () => {
    const out = new Uint8Array(28 + jl), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true);
    out.set(text, 20); out.fill(0x20, 20 + text.length, 20 + jl);
    dv.setUint32(20 + jl, length, true); dv.setUint32(24 + jl, 0x004e4942, true);
    return out;
  };
  const step = Math.max(1, Math.floor(slice));
  function* parts(){
    yield headOf();
    for (const [bytes, make] of views){
      for (let q = 0; q < Q; q += step){
        const a = make(mesh, q, Math.min(Q, q + step));
        yield new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
      }
      if (pad4(bytes) > bytes) yield new Uint8Array(pad4(bytes) - bytes);
    }
  }
  return { total, parts: parts() };
}
export function writeGlb(mesh, opts = {}){
  const { total, parts } = glbParts(mesh, opts), out = new Uint8Array(total);
  let at = 0;
  for (const p of parts){ out.set(p, at); at += p.length; }
  if (at !== total) throw new Error(`writeGlb: wrote ${at} bytes of ${total}`);
  return out;
}
