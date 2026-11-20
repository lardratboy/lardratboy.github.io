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
   transferred buffers. */
import { readVdag } from '../vdag-core.js';
import { colourOf } from '../colours.js';
import { storeView, createCounts } from '../dag-core.js';
import { surfaceMesh, coarsestLod, finestLod } from './export-core.js';

const post = (m, transfer) => self.postMessage(m, transfer);
let last = 0;
const throttled = m => { const now = performance.now(); if (now - last >= 100){ last = now; post(m); } };

self.onmessage = async ({ data }) => {
  try {
    const bytes = new Uint8Array(await data.file.arrayBuffer());
    const { worlds } = await readVdag(bytes, { colourOf, onPhase: (text, fraction) => throttled({ phase: { text, fraction } }) });
    post({ worlds: worlds.map(w => ({ name: w.name, D: w.D, voxels: w.voxels, nodes: w.nodes, colourStatus: w.colourStatus,
                                      colourKind: w.colour?.kind ?? null, bits: w.colour?.bits ?? null, view: w.view, source: w.source })) });
    const w = worlds[data.world];
    if (!w) throw new Error(`the file has no world ${data.world + 1}`);
    const store = storeView({ keys: w.keys }), counts = createCounts(store);
    // 'unknown' and 'none' come back with no colour; 'changed' is drawn as this code colours it, and the page says so.
    const colour = data.colour && w.colour ? colourOf(w.colour, { store, counts, D: w.D }) : null;
    const world = { store, root: w.root, D: w.D, counts };
    for (let lod = coarsestLod(w.D); lod >= finestLod(w.D); lod--){
      post({ building: { lod, done: 0, total: 0 } });
      const t = performance.now();
      const m = surfaceMesh(world, { lod, lodRule: data.rule, colour, merge: data.merge, maxQuads: data.maxQuads, maxChunks: data.maxChunks,
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
