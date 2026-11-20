/* A real asset's pieces, shared by experiments/mesh-vdag.mjs (an asset to
   world files) and experiments/label-mesh.mjs (its swatches as a label DAG,
   E1b of docs/labels-log.md §8). Moved out of mesh-vdag.mjs unchanged when the
   label sketch needed them: mesh-vdag's files and previews for the Halloween
   pack at D = 8 and 10 are byte for byte what they were.

   The pure half (the reader, the analysis, the bake, the preview's walk)
   moved again, to glb-core.mjs, so convert/ can run it in a browser; it's
   re-exported here, so the scripts import what they did. What's left is
   Node's: the file system, zlib, the JPEG converters, PNG out, and the costs.

   Not the engine. What each piece is for, and what a real asset taught it, is
   in mesh-vdag.mjs's header. */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { EMPTY, createCounts } from '../dag-core.js';
import { chunkNode, cellOf, mortonXYZ, CHUNK_LEVELS } from '../chunk-core.js';
import { fastChunk, createJobCache } from '../job-core.js';
import { attrOf8, attrRGB } from '../attr-core.js';
import { rowColour } from '../colours.js';
import { pngParts, pngPixels, parseGlb, glbImages, glbMesh, firstAlong, VIEWS } from './glb-core.mjs';
export { analyse, place, texelsPerVoxel, triangleGrid, sampler, cutouts, baker, skinOf, skinOracle, bakeSkin, firstAlong, VIEWS,
         bakeDepth, assetView } from './glb-core.mjs';

const say = s => console.log(s);
/* ---- PNG, both ways (zlib is Node's) ----------------------------------------------
   Decode: glb-core's, with zlib's inflate between its two halves. */
export function decodePng(buf){
  const P = pngParts(buf);
  return pngPixels(P, zlib.inflateSync(Buffer.concat(P.idat)));
}
/* JPEG: no decoder here. The platform converts it to PNG: sips on macOS,
   ffmpeg wherever it's installed. Neither present, the image is skipped and
   its materials use their factor. (The third asset, from Tripo, was JPEG.) */
export function decodeJpeg(bytes){
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
export function encodePng(w, h, rgb){
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
   glb-core's reader over a file: an image beside it is read from its folder,
   and each image is decoded here (PNG by zlib, JPEG by the platform). One
   that can't be is skipped, and its materials use their factor. */
export function readGlb(fileName){
  const { J, BIN } = parseGlb(fs.readFileSync(fileName));
  const images = glbImages(J, BIN).map((im, i) => {
    try {
      const bytes = im.bytes ? Buffer.from(im.bytes) : fs.readFileSync(path.join(path.dirname(fileName), decodeURIComponent(im.uri)));
      if (bytes[0] === 0xff && bytes[1] === 0xd8) return decodeJpeg(bytes);
      if (im.mimeType && im.mimeType !== 'image/png') throw new Error(`${im.mimeType} isn't decoded here`);
      return decodePng(bytes);
    } catch (e){ say(`- image ${i} (${im.name}) skipped: ${e.message}; its materials use their factor`); return null; }
  });
  return glbMesh(J, BIN, images);
}

/* What the viewer would draw at lod 0: every chunk's records (job-core's
   fastChunk, held to expandChunk byte for byte by its tests), so "shown" is
   the renderer's own notion, faces against neighbouring chunks included.
   Returns the records and quads, and how many records `inside` rejects
   (the skin's claim: none). Empty chunks are skipped before the job, which
   clears a 66³ grid each time. */
export function shownOutside(store, root, D, inside){
  const counts = createCounts(store), cache = createJobCache(), side = 2 ** Math.max(0, D - CHUNK_LEVELS);
  let shown = 0, quads = 0, outside = 0;
  for (let cz = 0; cz < side; cz++) for (let cy = 0; cy < side; cy++) for (let cx = 0; cx < side; cx++){
    if (chunkNode(store, root, D, 0, cx, cy, cz).id === EMPTY) continue;
    const c = fastChunk(store, root, D, { lod: 0, cx, cy, cz }, { counts, cache });
    shown += c.count; quads += c.quads;
    if (inside) for (let i = 0; i < c.count; i++){
      const [x, y, z] = mortonXYZ(cellOf(c.records[i]));
      if (!inside(64 * cx + x, 64 * cy + y, 64 * cz + z)) outside++;
    }
  }
  return { shown, quads, outside };
}

/* What the baked field costs the job (glb-colour-plan steps 2 and 3): every
   chunk at each lod the streamer draws ('any' at lod 0, 'adaptive' above, its
   lodRuleOf), run three times, each with a cache of its own so none warms
   another's masks:
     - without colour;
     - with a named field for scale (the testbed rows' colour, about the
       cheapest there is: the walk at meanDepth 1 asks it up to 8 times a
       coarse cell);
     - with the baked field, which cellAttr now asks for `mean` (step 3).
   Then a `mean` for each record of the baked job, main records and the seam
   tail apart (only the tail and the adaptive rule can ask a cell with no
   skin), and it must equal the job's word: the hook, on a real asset. `field`
   is baked-core's createBaked; its stats count the scans and the fallbacks.
   Returns a row a lod: records, tail, the three jobs' ms, means a second,
   words scanned a mean (mean and max), and the cells that climbed or took
   the world's mean, main and tail. */
export function bakedCost(store, root, D, field, lods){
  const counts = createCounts(store), caches = [createJobCache(), createJobCache(), createJobCache()], named = rowColour(D);
  const out = new Float64Array(3), S = field.stats, rows = [];
  for (const lod of lods){
    if (lod > D) continue;
    const side = 2 ** Math.max(0, D - lod - CHUNK_LEVELS), cs = 2 ** lod, lodRule = lod === 0 ? 'any' : 'adaptive';
    const row = { lod, main: 0, tail: 0, ms: 0, jobMs: [0, 0, 0], scanned: 0, maxScan: 0, climbed: [0, 0], world: [0, 0] };
    for (let cz = 0; cz < side; cz++) for (let cy = 0; cy < side; cy++) for (let cx = 0; cx < side; cx++){
      if (chunkNode(store, root, D, lod, cx, cy, cz).id === EMPTY) continue;
      const chunk = { lod, cx, cy, cz };
      let c;
      for (const [j, colour] of [null, named, field].entries()){
        const t = performance.now();
        c = fastChunk(store, root, D, chunk, { counts, cache: caches[j], lodRule, colour });
        row.jobMs[j] += performance.now() - t;
      }
      row.main += c.count; row.tail += c.records.length - c.count;
      const t0 = performance.now();
      for (let i = 0; i < c.records.length; i++){
        const k = i < c.count ? 0 : 1, cl = S.climbed, wo = S.world, sc = S.scanned;
        const [x, y, z] = mortonXYZ(cellOf(c.records[i]));
        S.maxScan = 0;
        field.mean(lod, (64 * cx + x) * cs, (64 * cy + y) * cs, (64 * cz + z) * cs, out);
        if (c.attrs[i] !== attrOf8(out[0], out[1], out[2])) throw new Error(`bakedCost: lod ${lod} chunk ${cx},${cy},${cz} record ${i}: the job's word isn't the mean's`);
        row.climbed[k] += S.climbed - cl; row.world[k] += S.world - wo; row.scanned += S.scanned - sc;
        if (S.maxScan > row.maxScan) row.maxScan = S.maxScan;
      }
      row.ms += performance.now() - t0;
    }
    rows.push(row);
  }
  return rows;
}

/* What six bits a channel in the file (vdag-core's word encoding 2) does to
   the job's words: every chunk at each lod, fastChunk with the baked words
   and with the words a six-bit file gives back, over the same skin. At lod 0
   every shown voxel's word must be the same (to6 of a widened channel is the
   channel's 6-bit value); above it a mean of widened channels lies within
   half a step of the 8-bit mean, so a channel may move by one step and no
   more. Throws if either fails; returns a row a lod: records, how many
   words moved, and how many moved in 1, 2 or 3 channels. */
export function bitsCost(store, root, D, field8, field6, lods){
  const counts = createCounts(store), c8 = createJobCache(), c6 = createJobCache(), rows = [];
  for (const lod of lods){
    if (lod > D) continue;
    const side = 2 ** Math.max(0, D - lod - CHUNK_LEVELS), lodRule = lod === 0 ? 'any' : 'adaptive';
    const row = { lod, records: 0, main: 0, moved: 0, movedMain: 0, channels: [0, 0, 0] };
    for (let cz = 0; cz < side; cz++) for (let cy = 0; cy < side; cy++) for (let cx = 0; cx < side; cx++){
      if (chunkNode(store, root, D, lod, cx, cy, cz).id === EMPTY) continue;
      const chunk = { lod, cx, cy, cz };
      const a = fastChunk(store, root, D, chunk, { counts, cache: c8, lodRule, colour: field8 }), b = fastChunk(store, root, D, chunk, { counts, cache: c6, lodRule, colour: field6 });
      row.records += a.records.length; row.main += a.count;
      for (let i = 0; i < a.attrs.length; i++){
        if (a.attrs[i] === b.attrs[i]) continue;
        if (lod === 0 && i < a.count) throw new Error(`bitsCost: lod 0 chunk ${cx},${cy},${cz} record ${i}: six bits changed a shown voxel's word`);
        const p = attrRGB(a.attrs[i]), q = attrRGB(b.attrs[i]);
        let n = 0;
        for (let ch = 0; ch < 3; ch++){
          const d = Math.abs(p[ch] - q[ch]);
          if (d > 1) throw new Error(`bitsCost: lod ${lod} chunk ${cx},${cy},${cz} record ${i}: a channel moved ${d} steps`);
          n += d;
        }
        row.moved++; if (i < a.count) row.movedMain++; row.channels[n - 1]++;
      }
    }
    rows.push(row);
  }
  return rows;
}

export function preview(store, root, D, bake, view){
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
