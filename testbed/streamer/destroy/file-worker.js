/* Module worker: an arena to a .vdag and a .vdag to an arena, off the page's
   thread (destroy/README.md, "Saving an arena"). Every decision is
   file-core's; this moves bytes. A message is one of:
     { save: { X, Y, Z, cells, view } }  the grid (a copy, transferred) and
                                         the player's view → { saved: { bytes, voxels, ms } }
     { open: { file, world } }           a File and which of its worlds →
                                         { opened: { X, Y, Z, cells, count, lod, at, saved, view, name, D, worlds, ms } }
   or { error }. Writing the default arena takes about a second, mostly
   the words' six-bit pass and the gzip (the README's Measured table). */
import { readVdag } from '../vdag-core.js';
import { colourOf } from '../colours.js';
import { storeView, createCounts } from '../dag-core.js';
import { createArena } from './arena-core.js';
import { writeArena, arenaOfWorld } from './file-core.js';

const post = (m, t) => self.postMessage(m, t);
let last = 0;
const phase = (text, fraction) => { const now = performance.now(); if (now - last > 80){ last = now; post({ phase: { text, fraction } }); } };

self.onmessage = async ({ data }) => {
  const t0 = performance.now();
  try {
    if (data.save){
      const { X, Y, Z, cells, view } = data.save, A = createArena(X, Y, Z, cells);
      const bytes = await writeArena(A, { view, onPhase: phase });
      post({ saved: { bytes, voxels: A.count, ms: performance.now() - t0 } }, [bytes.buffer]);
    } else if (data.open){
      const { file, world = 0 } = data.open;
      phase(`reading ${file.name}`, 0.05);
      const { worlds } = await readVdag(new Uint8Array(await file.arrayBuffer()), { colourOf });
      const w = worlds[world] ?? worlds[0], store = storeView({ keys: w.keys }), counts = createCounts(store);
      let colour = null;
      try { colour = w.colour ? colourOf(w.colour, { store, counts, D: w.D }) : null; } catch { colour = null; }
      phase(`${file.name}: laying it out`, 0.5);
      const r = arenaOfWorld({ store, counts, root: w.root, D: w.D, name: w.name }, colour);
      if (!r) throw new Error(`${file.name} is empty`);
      const { X, Y, Z, cells, count } = r.A;
      post({ opened: { X, Y, Z, cells, count, lod: r.lod, at: r.at, saved: r.saved, view: w.view, name: w.name, D: w.D,
                       worlds: worlds.length, ms: performance.now() - t0 } }, [cells.buffer]);
    }
  } catch (e){
    post({ error: String(e?.message ?? e) });
  }
};
