/* A glTF binary to world files, as experiments/mesh-vdag.mjs makes them, for
   a page (convert/index.html) and its worker. Pure: no DOM, no Worker; the
   one thing a platform has to hand in is a decoder for images glb-core can't
   read itself (JPEG, 16-bit or interlaced PNG), `platform(bytes, mimeType)`,
   which the worker makes from createImageBitmap and an OffscreenCanvas.

   What it shares with the script, so the files are the same bytes:
     - glb-core.mjs's reader, analysis and bakeDepth (the shape, the skin,
       the words, in the order the store grows), and assetView;
     - the PNG decode, glb-core's two halves with DecompressionStream's
       inflate between them where the script has zlib's. A PNG is the same
       pixels either way, so an asset whose textures are all 8-bit PNG gives
       the script's file byte for byte (test/convert-core.test.js, which runs
       the script itself, and test/browser/convert.test.js, the page);
     - the world: `${name} (D = ${D})`, baked colour at six bits a channel
       unless asked for eight, the view, no source.
   What it doesn't do: the script's checks (the dense oracles at D = 8, every
   shown voxel in the skin, the costs) and its previews. They measure the
   method, which the script still does; a page only needs the file. It does
   read each file back, and stops unless it holds the world it was written
   from (its voxels and, baked, its colour).

   Where the two can differ: a JPEG is decoded by the browser here and by
   sips or ffmpeg there, so its texels (and so its words) can differ by a
   step; a PNG the script can't decode is skipped there (the factor colours
   its materials) and handed to the browser here. And the script names a file
   with a hash for a name (Tripo's) after its folder, which a page can't see:
   here it's always the file's own name.

   PLY (2026-11-18, docs/convert.md §PLY): `convertPly` takes the file as a
   stream of chunks (ply-core.js's reader), since they run to 190 MB. A
   point cloud's points each fill their voxel, coloured by their mean; a
   mesh is glb-core's G from there on, so it shares bakeDepth with the .glb.
   Both end in `finishDepth`, the .glb's own writing, reading back and
   picture, so a world is the same file whichever way its voxels came;
   experiments/ply-vdag.mjs is the CLI over the same function. */
import { createStore, createCounts, prune } from '../dag-core.js';
import { writeVdag, readVdag } from '../vdag-core.js';
import { createBaked } from '../baked-core.js';
import { readPly, plyMesh, pointBox, pointsDepth } from './ply-core.js';
import { pngParts, pngPixels, concatBytes, parseGlb, glbImages, glbMesh, analyse, bakeDepth, assetView, firstAlong, VIEWS } from '../experiments/glb-core.mjs';

// The depths the page offers: D = 10 takes seconds to a minute an asset in
// the script, and D = 12 minutes and over a gigabyte, so the page stops at 10.
export const DEPTHS = [6, 7, 8, 9, 10];

// The script's names: the file's name without .glb (or .ply), and a slug of it for the file.
export const nameOf = fileName => fileName.replace(/^.*[\\/]/, '').replace(/\.(glb|ply)$/i, '');
export const slugOf = name => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'asset';

async function inflate(bytes){
  const out = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')));
  return new Uint8Array(await out.arrayBuffer());
}
// A PNG as the script decodes it: glb-core's parts, inflated, unfiltered.
export async function decodePng(bytes){
  const P = pngParts(bytes);
  return pngPixels(P, await inflate(concatBytes(P.idat)));
}
const noPlatform = async () => { throw new Error('no image decoder here'); };
/* One image, in the script's order: JPEG by its magic and anything not PNG
   by its type go to the platform; a PNG to decodePng, and to the platform
   only if decodePng refuses it (16 bits, interlaced), which the script
   would skip. Null, with a note, if nobody can: its materials use their
   factor, as in the script. */
async function decodeImage(im, i, bytes, platform, notes){
  const skip = e => { notes.push(`image ${i} (${im.name}) skipped: ${e.message ?? e}; its materials use their factor`); return null; };
  if (!bytes) return skip(new Error(`${im.uri} isn't in the .glb (drop it with the .glb to use it)`));
  try {
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return await platform(bytes, 'image/jpeg');
    if (im.mimeType && im.mimeType !== 'image/png') return await platform(bytes, im.mimeType);
    try { return await decodePng(bytes); }
    catch (e){
      try { return await platform(bytes, 'image/png'); } catch { throw e; }
    }
  } catch (e){ return skip(e); }
}

/* What the page shows of an asset before the build: the script's first two lines. */
function summaryOf(G, A, notes){
  const textured = G.materials.filter(m => m.image), solid = A.comps.filter(c => c.solid);
  return { triangles: A.nt, vertices: A.nv, meshes: G.meshes, instances: G.instances, components: A.comps.length,
           solid: solid.length, solidTriangles: solid.reduce((a, c) => a + c.tris.length, 0),
           materials: G.materials.length, textured: textured.length, sizes: [...new Set(textured.map(m => `${m.image.w}×${m.image.h}`))],
           cutouts: G.materials.filter(m => m.mask).length, vertexColours: !!G.CO, generator: G.generator ?? null, notes };
}

/* A small picture of the world from the front (glb-core's walk, as the
   script's preview), coloured by its words where it has them: at most 256
   pixels a side, one a column of voxels (every 2^(D − 8)th past D = 8).
   RGBA, the background clear. */
export function thumbnail(store, root, D, wordAt, size = 256){
  const { ax, U, Vax, flipU, flipV } = VIEWS.front;
  const side = 2 ** D, R = Math.min(side, size), step = side / R, depth = new Float64Array(R * R), rgba = new Uint8ClampedArray(4 * R * R);
  const col = i => (flipU ? R - 1 - i : i) * step + (step >> 1), row = j => (flipV ? R - 1 - j : j) * step + (step >> 1);
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) depth[i + R * j] = firstAlong(store, root, D, ax, col(i), row(j), U, Vax);
  const p = [0, 0, 0];
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++){
    const d = depth[i + R * j], o = 4 * (i + R * j);
    if (d < 0) continue;
    const at = (a, b) => { const e = depth[Math.min(R - 1, Math.max(0, a)) + R * Math.min(R - 1, Math.max(0, b))]; return e < 0 ? d : e; };
    const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * step), gy = (at(i, j - 1) - at(i, j + 1)) / (2 * step);
    const l = Math.hypot(gx, gy, 1), lambert = Math.max(0, (0.35 * gx - 0.45 * gy + 0.82) / l), k = 0.45 + 0.6 * lambert;
    p[ax] = d; p[U] = col(i); p[Vax] = row(j);
    const w = wordAt ? wordAt(p[0], p[1], p[2]) : 0xb4b4b4;
    rgba[o] = (w & 255) * k; rgba[o + 1] = (w >> 8 & 255) * k; rgba[o + 2] = (w >> 16 & 255) * k; rgba[o + 3] = 255;
  }
  return { w: R, h: R, rgba };
}

/* The whole conversion. `bytes` is the .glb; `files` maps other file names
   to their bytes, for images a .glb names beside it (rare: a .glb holds its
   own). One file a depth, in the order asked, each handed to `onWorld` as
   it's made, so a page can offer it before the next depth starts.
   `bake: false` writes the shape alone, as the script's --bake=off. */
export async function convertGlb(bytes, { name = 'asset', depths = [8, 10], bits = 6, bake = true, files = new Map(),
                                          platform = noPlatform, onAsset = () => {}, onStage = () => {}, onWorld = () => {}, thumbs = true } = {}){
  if (bits !== 6 && bits !== 8) throw new Error('bits is 6 or 8');
  for (const D of depths) if (!DEPTHS.includes(D)) throw new Error(`D = ${D}: the page makes ${DEPTHS[0]} to ${DEPTHS.at(-1)}`);
  onStage(null, 'reading');
  const { J, BIN } = parseGlb(bytes), notes = [], images = [];
  const list = glbImages(J, BIN);
  for (const [i, im] of list.entries()){
    const own = im.bytes ?? (im.uri ? files.get(decodeURIComponent(im.uri).replace(/^.*[\\/]/, '')) ?? null : null);
    images.push(await decodeImage(im, i, own, platform, notes));
  }
  if (!BIN && J.meshes?.length) throw new Error('this .glb keeps its geometry in other files (a .gltf with .bin): not read here');
  onStage(null, 'analysing');
  const G = glbMesh(J, BIN, images);
  if (!G.MAT.length) throw new Error('no triangles in the default scene');
  const A = analyse(G), asset = summaryOf(G, A, notes), slug = slugOf(name), worlds = [];
  onAsset(asset);
  for (const D of depths){
    const ms = {}, stage = stager(D, ms, onStage);
    const { M, b, sk, W } = bakeDepth(G, A, D, { bake, stage });
    const world = await finishDepth({ store: b.store, root: b.root, D, M, skin: sk?.root, words: W?.words, bits, name, slug, thumbs, stage, ms });
    worlds.push(world);
    onWorld(world);
  }
  return { asset, worlds };
}

/* Each stage's time, and the page told: stage(s) closes the one before. */
function stager(D, ms, onStage){
  const t = { at: performance.now(), stage: null };
  return s => { const now = performance.now(); if (t.stage) ms[t.stage] = now - t.at; Object.assign(t, { at: now, stage: s }); onStage(D, s); };
}
/* One depth's file from its store: written, read back (it must hold the
   world it was written from: its voxels and, baked, its colour), and a
   picture. Shared by the .glb and the .ply, so a world is the same file
   whichever way its voxels came. */
async function finishDepth({ store, root, D, M, skin, words, bits, name, slug, thumbs, stage, ms }){
  const colour = words ? { kind: 'baked', skin, words, bits } : null;
  stage('writing');
  const keys = store.snapshot().keys;
  const file = await writeVdag([{ keys, root, D, name: `${name} (D = ${D})`, colour, view: assetView(M), source: null }]);
  stage('checking');
  const counts = createCounts(store), voxels = counts.of(root), { worlds: [back] } = await readVdag(file);
  if (back.voxels !== voxels || (colour ? back.colourStatus !== 'baked' : back.colour !== null))
    throw new Error(`D = ${D}: the file doesn't read back as the world written`);
  let thumb = null;
  if (thumbs){
    stage('picture');
    const field = words ? createBaked(store, skin, D, words, { counts }) : null;
    thumb = thumbnail(store, root, D, field);
  }
  stage(null);
  return { D, side: M.side, file: `${slug}-d${D}.vdag`, bytes: file, voxels, nodes: prune(keys, [root]).keys.length / 9,
           skin: words ? words.length : 0, bits: colour ? bits : 0, ms, thumb };
}

/* A PLY file (ply-core.js): a point cloud, each point the voxel it falls in
   coloured by the mean of its points, or a mesh, which goes the .glb's way
   from glb-core's analyse on (its vertex colours as COLOR_0). `chunks` is
   any async iterable of byte chunks, so a 190 MB file is never held whole:
   the worker hands in a File's slices, Node an fs stream. `size` is the
   file's length, for `onProgress(fraction)` while it's read. A file with no
   colour is written as the shape alone, whatever `bake` says (the viewer
   then draws it in gamut, as a .glb with no colour would). */
export async function convertPly(chunks, { name = 'asset', depths = [8, 10], bits = 6, bake = true, size = 0,
                                          onAsset = () => {}, onStage = () => {}, onProgress = () => {}, onWorld = () => {}, thumbs = true } = {}){
  if (bits !== 6 && bits !== 8) throw new Error('bits is 6 or 8');
  for (const D of depths) if (!DEPTHS.includes(D)) throw new Error(`D = ${D}: the page makes ${DEPTHS[0]} to ${DEPTHS.at(-1)}`);
  onStage(null, 'reading');
  const P = await readPly(chunks, { onProgress: read => onProgress(size ? Math.min(1, read / size) : 0) });
  const notes = P.notes, slug = slugOf(name), worlds = [];
  const coloured = !!P.rgb;
  if (bake && !coloured) notes.push(`no colour in the file: the shape alone`);
  bake = bake && coloured;
  if (P.nt){
    onStage(null, 'analysing');
    const G = plyMesh(P), A = analyse(G), asset = { ...summaryOf(G, A, notes), kind: 'mesh', format: P.format };
    onAsset(asset);
    for (const D of depths){
      const ms = {}, stage = stager(D, ms, onStage);
      const { M, b, sk, W } = bakeDepth(G, A, D, { bake, stage });
      const world = await finishDepth({ store: b.store, root: b.root, D, M, skin: sk?.root, words: W?.words, bits, name, slug, thumbs, stage, ms });
      worlds.push(world); onWorld(world);
    }
    return { asset, worlds };
  }
  const box = pointBox(P);
  if (!box.kept) throw new Error('no point with finite coordinates');
  if (box.kept < P.n) notes.push(`${(P.n - box.kept).toLocaleString('en-US')} points with no finite place dropped`);
  const asset = { kind: 'points', format: P.format, points: P.n, kept: box.kept, colour: P.colour, notes };
  onAsset(asset);
  for (const D of depths){
    const ms = {}, stage = stager(D, ms, onStage);
    stage('points');
    const store = createStore(), r = pointsDepth(P, box, D, store, { bake });
    const world = await finishDepth({ store, root: r.root, D, M: r.M, skin: r.root, words: r.words, bits, name, slug, thumbs, stage, ms });
    worlds.push(world); onWorld(world);
  }
  return { asset, worlds };
}
