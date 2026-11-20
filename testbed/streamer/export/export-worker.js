/* Module worker: one world file's surfaces, off the page's thread
   (docs/export.md). The page posts the File itself (structured clone, nothing
   read on its side), the world to build and the settings; this reads the file
   (vdag-core's readVdag, colours.js's fields), says what it holds, then makes
   the chosen world's surface at every lod from the coarsest (64 cells across)
   down, posting each as it's done, so the page shows something at once and
   refines. It stops at the finest lod the format allows, or at the first lod
   over the page's limits, which it reports as over.

   Every decision is export-core's. A change of setting or world is a new
   worker: the page terminates this one, which is also how a build is
   cancelled (one lod is one call that can't yield). Quads come back as
   transferred buffers.

   The same file runs the save (docs/export.md §2): the page posts a lod's
   quads to a fresh worker as { write }, and this writes the .glb a slice at
   a time (export-core's glbParts), folding the slices into a Blob every
   256 MB, so a 16-million-quad file (2.4 GB) is never one buffer here or on
   the page; the Blob comes back by reference. */
import { readVdag } from '../vdag-core.js';
import { colourOf } from '../colours.js';
import { storeView, createCounts } from '../dag-core.js';
import { surfaceMesh, glbParts, coarsestLod, finestLod } from './export-core.js';

const post = (m, transfer) => self.postMessage(m, transfer);
let last = 0;
const throttled = m => { const now = performance.now(); if (now - last >= 100){ last = now; post(m); } };

const FOLD = 256e6;
function write({ mesh, name, voxel, normals, extras }){
  const t = performance.now(), { total, parts } = glbParts(mesh, { name, voxel, normals, extras });
  let blob = new Blob([]), batch = [], held = 0, done = 0;
  for (const p of parts){
    batch.push(p); held += p.length; done += p.length;
    if (held >= FOLD){ blob = new Blob([blob, ...batch]); batch = []; held = 0; throttled({ writing: { done, total } }); }
  }
  blob = new Blob([blob, ...batch], { type: 'model/gltf-binary' });
  if (blob.size !== total) throw new Error(`the .glb came out ${blob.size} bytes, not ${total}`);
  post({ glb: blob, ms: performance.now() - t });
}

self.onmessage = async ({ data }) => {
  try {
    if (data.write){ write(data.write); return; }
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    const { worlds } = await readVdag(bytes, { colourOf, onPhase: (text, fraction) => throttled({ phase: { text, fraction } }) });
    post({ worlds: worlds.map(w => ({ name: w.name, D: w.D, voxels: w.voxels, nodes: w.nodes, colourStatus: w.colourStatus,
                                      colourKind: w.colour?.kind ?? null, bits: w.colour?.bits ?? null, view: w.view, source: w.source })) });
    const w = worlds[data.world];
    if (!w) throw new Error(`the file has no world ${data.world + 1}`);
    const store = storeView({ keys: w.keys }), counts = createCounts(store);
    // 'unknown' and 'none' come back with no colour; 'changed' is drawn as this code colours it, and the page says so.
    // The world's colour where it has some, else gamut, as the viewer draws it (§7 question 6's answer).
    const colour = data.colour === 'world' && w.colour ? colourOf(w.colour, { store, counts, D: w.D }) : null;
    const gamut = !colour && data.colour !== 'none';
    const world = { store, root: w.root, D: w.D, counts };
    for (let lod = coarsestLod(w.D); lod >= finestLod(w.D); lod--){
      post({ building: { lod, done: 0, total: 0 } });
      const t = performance.now();
      const m = surfaceMesh(world, { lod, lodRule: data.rule, colour, bits: data.bits, gamut, merge: data.merge, maxQuads: data.maxQuads, maxChunks: data.maxChunks,
                                     onProgress: (done, total) => throttled({ building: { lod, done, total } }) });
      m.ms = performance.now() - t;
      if (m.over){ post({ over: m }); break; }
      post({ mesh: m }, [m.data.buffer, m.words.buffer]);
    }
    post({ done: true });
  } catch (e){
    post({ error: String(e?.message ?? e) });
  }
};
