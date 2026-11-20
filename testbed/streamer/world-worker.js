/* Module worker: builds the endless lattice's worlds off the main thread
   (docs/universe-plan.md step 5). One message, one world:
     { id, tile }  →  { id, keys, root, D, ground, colour, label, ms }
   Every decision is tile-worlds.js's (which Node tests); this file only moves
   messages. The keys go back as a transferable buffer, and the page reads them as
   a storeView. Unlike scatter-worker.js it lives for the page's life: the lattice
   asks for worlds as the eye moves, a few a second at most. */
import { buildTile } from './tile-worlds.js';

self.onmessage = ({ data }) => {
  try {
    const w = buildTile(data.tile), { keys } = w.store.snapshot();
    self.postMessage({ id: data.id, keys, root: w.root, D: w.D, ground: w.ground, colour: w.colour, label: w.label, ms: w.ms, nodes: w.store.size }, [keys.buffer]);
  } catch (error){
    self.postMessage({ id: data.id, error: String(error.message || error) });
  }
};
self.postMessage({ ready: true });
