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
   so the colours are the ones the viewer shows.

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
   faces don't share normals: 32 bytes a vertex, 6 or 3 index words a quad. */
import { EMPTY, isFull } from '../dag-core.js';
import { CHUNK_LEVELS, CELL_MASK, MASK_SHIFT, nodeAt } from '../chunk-core.js';
import { fastChunk, createJobCache } from '../job-core.js';
import { ATTR_COLOUR, R_SHIFT, G_SHIFT, B_SHIFT } from '../attr-core.js';

export const MEAN_DEPTH = 1;                 // stream-core's MEAN_DEPTH, which pages draw with
export const MAX_CELL_LEVELS = 24;           // float32 holds every integer to 2^24
export const QUAD_WORDS = 6;
export const GREY = 0.5;                     // linear: sRGB ≈ 0.74
export const RULES = ['shadow', 'any', 'adaptive', 'majority'];
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

function chunkQuads(sink, r, coloured, merge, C){
  if (!FACES) FACES = new Uint32Array(6 * SIDE * AREA);
  const { records, attrs, count } = r;
  for (let i = 0; i < count; i++){
    const rec = records[i], m = rec >>> MASK_SHIFT & 63;
    if (!m) continue;
    const cell = rec & CELL_MASK, lo = DEC[cell & 511], hi = DEC[cell >>> 9];
    const x = (lo & 7) | (hi & 7) << 3, y = (lo >> 3 & 7) | (hi >> 3 & 7) << 3, z = (lo >> 6) | (hi >> 6) << 3;
    const key = coloured ? (attrs[i] & ATTR_COLOUR) + 1 : 1;
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
          null), merge (false: a quad a face, watertight), maxQuads and maxChunks (stop past them: the
          result has `over` set to 'quads' or 'chunks' and no quads),
          onProgress(done, total) after each chunk.
   Returns { lod, lodRule, D, coloured, merged, chunks, faces, quads, data,
   words, box }: `faces` the shown faces (the job's quads), `quads` what
   they merged into, `data` QUAD_WORDS a quad, `words` a quad's attribute
   word (0 without colour), `box` the content's [x0, y0, z0, x1, y1, z1] in
   cells, or null for no quads. */
export function surfaceMesh(world, opts = {}){
  const { store, root, D, counts } = world;
  const { lod = 0, lodRule = 'shadow', colour = null, merge = false, maxQuads = Infinity, maxChunks = Infinity, meanDepth = MEAN_DEPTH, onProgress = null } = opts;
  if (!Number.isInteger(lod) || lod < finestLod(D) || lod > Math.max(coarsestLod(D), 0))
    throw new Error(`surfaceMesh: lod ${lod} is outside ${finestLod(D)}–${coarsestLod(D)} for D = ${D}`);
  const head = { lod, lodRule, D, coloured: !!colour, merged: merge };
  const list = chunksOf(store, counts, root, D, lod, maxChunks);
  if (list.over) return { ...head, over: 'chunks', chunks: list.length };
  const cache = createJobCache(), sink = quadSink(), C = [0, 0, 0];
  let faces = 0;
  for (let i = 0; i < list.length; i++){
    const [cx, cy, cz] = list[i];
    const r = fastChunk(store, root, D, { lod, cx, cy, cz }, { counts, lodRule, colour, meanDepth, cache });
    faces += r.quads;
    C[0] = cx * SIDE; C[1] = cy * SIDE; C[2] = cz * SIDE;
    chunkQuads(sink, r, !!colour, merge, C);
    if (sink.n > maxQuads) return { ...head, over: 'quads', chunks: list.length, faces, quads: sink.n };
    onProgress?.(i + 1, list.length);
  }
  const { data, words, box } = sink.done();
  return { ...head, chunks: list.length, faces, quads: words.length, data, words, box };
}

/* ---- vertices ---------------------------------------------------------------------------
   A six-bit sRGB channel, c / 63 (GLSL_ATTR's attrColour), to linear, as
   unsigned short normalized. */
export const srgbToLinear = s => s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
export const LINEAR16 = Uint16Array.from({ length: 64 }, (_, c) => Math.round(65535 * srgbToLinear(c / 63)));

/* Four vertices a quad, wound counter-clockwise seen from the side its
   normal points to (u × v is the face's axis, so (u0,v0) (u1,v0) (u1,v1)
   (u0,v1) faces +axis, and the reverse −axis), triangles 0 1 2 and 0 2 3. */
export function vertexArrays(mesh){
  const n = mesh.quads, d = mesh.data, coloured = mesh.coloured;
  const positions = new Float32Array(12 * n), normals = new Float32Array(12 * n);
  const colours = coloured ? new Uint16Array(16 * n) : null;
  const wide = 4 * n > 65536, indices = wide ? new Uint32Array(6 * n) : new Uint16Array(6 * n);
  const P = [0, 0, 0];
  for (let q = 0; q < n; q++){
    const o = QUAD_WORDS * q, b = d[o], a = b >> 1, ua = (a + 1) % 3, va = (a + 2) % 3, neg = b & 1;
    const u0 = d[o + 2], v0 = d[o + 3], u1 = d[o + 4], v1 = d[o + 5];
    P[a] = d[o + 1];
    const corners = neg ? [u0, v0, u0, v1, u1, v1, u1, v0] : [u0, v0, u1, v0, u1, v1, u0, v1];
    for (let k = 0; k < 4; k++){
      P[ua] = corners[2 * k]; P[va] = corners[2 * k + 1];
      const p = 12 * q + 3 * k;
      positions[p] = P[0]; positions[p + 1] = P[1]; positions[p + 2] = P[2];
      normals[p + a] = neg ? -1 : 1;
    }
    if (colours){
      const w = mesh.words[q], r = LINEAR16[w >>> R_SHIFT & 63], g = LINEAR16[w >>> G_SHIFT & 63], bl = LINEAR16[w >>> B_SHIFT & 63];
      for (let k = 0; k < 4; k++){ const c = 16 * q + 4 * k; colours[c] = r; colours[c + 1] = g; colours[c + 2] = bl; colours[c + 3] = 65535; }
    }
    const i = 6 * q, v = 4 * q;
    indices[i] = v; indices[i + 1] = v + 1; indices[i + 2] = v + 2; indices[i + 3] = v; indices[i + 4] = v + 2; indices[i + 5] = v + 3;
  }
  return { positions, normals, colours, indices };
}

/* ---- the .glb ---------------------------------------------------------------------------
   Its size, before it's written (the page's table): the binary chunk exactly,
   plus ~1.5 KB of JSON. */
export const binBytesOf = (quads, coloured) => quads * (4 * (coloured ? 32 : 24) + (4 * quads > 65536 ? 24 : 12));

/* Where the node puts the cells: `voxel` metres a voxel. */
export function placementOf(mesh, voxel = 0.01){
  const s = voxel * 2 ** mesh.lod, b = mesh.box;
  return { scale: s, translation: [-(b[0] + b[3]) / 2 * s, -b[1] * s, -(b[2] + b[5]) / 2 * s],
           size: [(b[3] - b[0]) * s, (b[4] - b[1]) * s, (b[5] - b[2]) * s] };
}

const pad4 = n => (n + 3) & ~3;
export function writeGlb(mesh, { name = 'world', voxel = 0.01, extras = {} } = {}){
  if (!mesh.quads) throw new Error('writeGlb: the mesh has no quads');
  if (!(voxel > 0 && Number.isFinite(voxel))) throw new Error(`writeGlb: a voxel must be a positive size in metres, not ${voxel}`);
  const { positions, normals, colours, indices } = vertexArrays(mesh), n = 4 * mesh.quads;
  const parts = [positions, normals, ...(colours ? [colours] : []), indices];
  const bufferViews = [], offsets = [];
  let length = 0;
  for (const [i, p] of parts.entries()){
    offsets.push(length);
    bufferViews.push({ buffer: 0, byteOffset: length, byteLength: p.byteLength, target: i === parts.length - 1 ? 34963 : 34962 });
    length += pad4(p.byteLength);
  }
  const b = mesh.box, accessors = [
    { bufferView: 0, componentType: 5126, count: n, type: 'VEC3', min: [b[0], b[1], b[2]], max: [b[3], b[4], b[5]] },
    { bufferView: 1, componentType: 5126, count: n, type: 'VEC3' },
  ];
  const attributes = { POSITION: 0, NORMAL: 1 };
  if (colours){ attributes.COLOR_0 = accessors.length; accessors.push({ bufferView: 2, componentType: 5123, normalized: true, count: n, type: 'VEC4' }); }
  const indexAccessor = accessors.length;
  accessors.push({ bufferView: parts.length - 1, componentType: indices instanceof Uint32Array ? 5125 : 5123, count: indices.length, type: 'SCALAR' });
  const at = placementOf(mesh, voxel), title = String(name);
  const json = {
    asset: { version: '2.0', generator: 'ifs-testbed export/ (vdag to glb)' },
    scene: 0,
    scenes: [{ name: title, nodes: [0] }],
    nodes: [{ name: title, mesh: 0, translation: at.translation, scale: [at.scale, at.scale, at.scale],
              extras: { D: mesh.D, lod: mesh.lod, lodRule: mesh.lodRule, voxel, merged: mesh.merged, ...extras } }],
    meshes: [{ name: title, primitives: [{ attributes, indices: indexAccessor, material: 0, mode: 4 }] }],
    materials: [{ name: colours ? 'voxels' : 'voxels (no colour)',
                  pbrMetallicRoughness: { baseColorFactor: colours ? [1, 1, 1, 1] : [GREY, GREY, GREY, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: length }],
    bufferViews, accessors,
  };
  const text = new TextEncoder().encode(JSON.stringify(json)), jl = pad4(text.length);
  const total = 12 + 8 + jl + 8 + length, out = new Uint8Array(total), dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jl, true); dv.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20); out.fill(0x20, 20 + text.length, 20 + jl);
  const bin = 20 + jl;
  dv.setUint32(bin, length, true); dv.setUint32(bin + 4, 0x004e4942, true);
  for (const [i, p] of parts.entries()) out.set(new Uint8Array(p.buffer, p.byteOffset, p.byteLength), bin + 8 + offsets[i]);
  return out;
}
