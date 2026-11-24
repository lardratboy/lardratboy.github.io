/* Module worker: one arena build off the page's thread (destroy/README.md).
   The page posts { desc, files: [{ file, world }] } (Files by structured
   clone, nothing read on the page's side). This reads each .vdag with
   vdag-core's readVdag, turns the chosen world into an item at the lod that
   fits the arena (content-core's fitLod and dagItem, coloured by colours.js's
   field, or the gamut where the file has none), builds the arena around
   them (buildArena) and posts each thing as it's placed (its cells
   transferred: the page stamps them into its own arena, over the plane it
   laid when the build began), then what was placed and left out and the
   count the page's arena must come to. The worker holds no grid. Every decision is content-core's; a new
   build is a new worker (the page terminates a superseded one). */
import { readVdag } from '../vdag-core.js';
import { colourOf } from '../colours.js';
import { storeView, createCounts } from '../dag-core.js';
import { buildArena, arenaDesc, dagItem, fitLod } from './content-core.js';

const post = (m, t) => self.postMessage(m, t);
let last = 0;
const phase = (text, fraction) => { const now = performance.now(); if (now - last > 80){ last = now; post({ phase: { text, fraction } }); } };

self.onmessage = async ({ data }) => {
  const t0 = performance.now();
  try {
    const d = arenaDesc(data.desc), extra = [], notes = [];
    // A loaded world's side: at most the room over the plane, and half the arena across.
    const maxSide = Math.min(d.height - d.plane - 8, Math.floor(d.size * 0.6));
    for (const [n, { file, world = 0, name }] of (data.files || []).entries()){
      phase(`reading ${name}`, 0.02);
      const { worlds } = await readVdag(new Uint8Array(await file.arrayBuffer()), { colourOf });
      const w = worlds[world] ?? worlds[0];
      const store = storeView({ keys: w.keys }), counts = createCounts(store);
      let colour = null;
      try { colour = w.colour ? colourOf(w.colour, { store, counts, D: w.D }) : null; } catch { colour = null; }
      const lod = fitLod(w.D, maxSide);
      phase(`${name}: ${w.name || 'world'} at lod ${lod}`, 0.05);
      const item = dagItem(`${name}${worlds.length > 1 ? ` · ${w.name || `world ${world + 1}`}` : ''}`, { store, counts, root: w.root, D: w.D }, colour, lod);
      if (!item){ notes.push(`${name} is empty`); continue; }
      item.first = true;
      item.source = { file: name, D: w.D, lod, coloured: !!colour, worlds: worlds.map(x => x.name || ''), world: worlds.indexOf(w) };
      extra.push(item);
      if (n === 0) post({ worlds: { name, list: worlds.map(x => ({ name: x.name, D: x.D, voxels: x.voxels })) } });
    }
    // No grid here: the page lays the plane itself and stamps each thing as it's
    // posted, so the arena fills in on screen while the rest are still being made.
    const r = buildArena(d, extra, { onPhase: phase, grid: false, onPlace: ({ item, x0, y0, z0 }, voxels) => {
      const { name, sx, sy, sz, cells } = item;
      post({ place: { name, sx, sy, sz, cells, at: [x0, y0, z0], voxels } }, [cells.buffer]);
    } });
    post({ built: { desc: r.desc, spawn: r.spawn, yaw: r.yaw, placed: r.placed, left: r.left, notes, count: r.count, ms: performance.now() - t0,
                    sources: extra.map(e => ({ name: e.name, ...e.source })) } });
  } catch (e){
    post({ error: String(e?.message ?? e) });
  }
};
