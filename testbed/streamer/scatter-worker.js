/* Module worker: builds part of a scatter or lattice world, or assembles
   one (docs/scatter-plan.md, decision 8; docs/lattice3d-plan.md;
   scatter-build.js drives it). A lattice descriptor (desc.kind ===
   'lattice') sends the work to lattice-core.js instead of scatter-core.js.

   A builder answers three messages, each once:
     ground  { desc }          the ground, top-down (fromField), as a
                               store's keys and its root (scatter only);
     prints  { desc, n0, n1 }  recipes [n0, n1) built and fingerprinted
                               (pass A). The occupancies stay here for
                               pass B, which the driver sends back to the
                               worker that built each recipe;
     place   { desc, jobs }    those recipes placed in their cells
                               (pass B), in a store of this worker's own:
                               its keys, the blocks and the placements.
                               A lattice's comes in slices; the occupancies
                               are dropped after the one marked `last`.
   While prints or place runs it sends { id, progress } now and then: how
   many recipes or cells of this ask are done (ticker, below).
   With a `tag`, ground and place send their result to the assembler
   instead (over the port the driver gave this worker, `port`), and answer
   the driver with the count only.

   The assembler (docs/lattice3d-log.md §8) is where the world is put
   together, so the page's main thread never holds the store:
     assemble { desc, order, prints }  start: the tags in the order they're
                               merged (ground first), and the scatter's
                               prints (its table wants each one's voxels);
     asm-port                  a port to one builder; parts arrive on it,
                               in any order, and are merged in `order`
                               as soon as the next one is in;
     finish                    once every part is merged: graft, prune,
                               and answer with the pruned keys, the root
                               and the table.
   That was the 6–12 s the main thread held still at R = 5, 128³.

   Keys go back as transferable buffers. Everything this does is
   scatter-core.js's, lattice-core.js's or dag-core.js's, which Node
   tests; this file only moves messages. */
import { createStore, prune, EMPTY } from './dag-core.js';
import { groundOf, fingerprintRange, placeRange, scatterLayout, mergePart, TABLE_WORDS } from './scatter-core.js';
import * as lattice from './lattice-core.js';

const occs = new Map();
let toAsm = null, asm = null;
/* Parts can come before `assemble` does: the scatter's ground is sent as
   soon as it's built, during pass A, and assemble only after it (it
   carries pass A's prints). The first version had nowhere to put it, and
   the build sat at "grafting and pruning" for ever. */
const early = new Map();

function landed(tag, part){
  if (!asm){ early.set(tag, part); return; }
  asm.landed.set(tag, part);
  while (asm.next < asm.order.length && asm.landed.has(asm.order[asm.next])){
    const t = asm.order[asm.next++], p = asm.landed.get(t), t0 = performance.now();
    asm.landed.delete(t);
    if (t === 'ground') asm.groundRoot = asm.store.importKeys(p.keys)[p.root];
    else if (asm.isLattice) lattice.mergePart(asm.store, asm.layout, asm.table, asm.blocks, p);
    else mergePart(asm.store, asm.layout, asm.prints, asm.table, asm.blocks, p);
    asm.ms.merge += performance.now() - t0;
  }
  if (asm.finish != null) finish();
}
function finish(){
  const { desc, store, blocks, table, ms } = asm, id = asm.finish;
  if (asm.error){ const error = 'assembling: ' + asm.error; asm = null; self.postMessage({ id, error }); return; }
  if (asm.next < asm.order.length) return;          // parts still on their way
  let t0 = performance.now();
  const grafted = store.graft(asm.groundRoot, desc.D, Math.log2(asm.isLattice ? desc.B : desc.R), blocks);
  ms.graft = performance.now() - t0; t0 = performance.now();
  const { keys, map } = prune(store.snapshot().keys, [grafted]);
  ms.prune = performance.now() - t0;
  const out = { id, keys, root: map[grafted], table, blocks: blocks.length, dropped: store.size - keys.length / 9, ms };
  asm = null;
  self.postMessage(out, [keys.buffer, table.buffer]);
}

self.onmessage = ({ data, ports }) => {
  try {
    const { desc } = data, isLattice = desc?.kind === 'lattice';
    if (data.type === 'port'){
      toAsm = ports[0];
      self.postMessage({ id: data.id });
    } else if (data.type === 'asm-port'){
      // A merge that throws is reported at finish (before it, nobody is asking).
      ports[0].onmessage = ({ data: part }) => {
        try { landed(part.tag, part); }
        catch (e){ if (!asm) throw e; asm.error = String(e.message || e); if (asm.finish != null) finish(); }
      };
      self.postMessage({ id: data.id });
    } else if (data.type === 'assemble'){
      const layout = isLattice ? lattice.latticeLayout(desc) : scatterLayout(desc);
      asm = { desc, isLattice, layout, order: data.order, prints: data.prints, next: 0, landed: new Map(), store: createStore(), blocks: [],
              table: new Int32Array(TABLE_WORDS * layout.cells.length), groundRoot: EMPTY, finish: null, ms: { merge: 0 } };
      self.postMessage({ id: data.id });
      for (const [tag, part] of early){ early.delete(tag); landed(tag, part); }
    } else if (data.type === 'finish'){
      asm.finish = data.id;
      finish();
    } else if (data.type === 'ground'){
      const store = createStore(), { root } = store.fromField(desc.D, groundOf(desc).field), { keys } = store.snapshot();
      send(data, { keys, root });
    } else if (data.type === 'prints'){
      const one = isLattice ? lattice.printRange : fingerprintRange, prints = [], tick = ticker(data.id);
      for (let n = data.n0; n < data.n1; n += BATCH){
        for (const p of one(desc, n, Math.min(data.n1, n + BATCH), occs)) prints.push(p);
        tick(Math.min(data.n1, n + BATCH) - data.n0);
      }
      self.postMessage({ id: data.id, prints });
    } else if (data.type === 'place'){
      const store = createStore(), blocks = [], placed = [], tick = ticker(data.id), ground = isLattice ? null : groundOf(desc);
      for (let j = 0; j < data.jobs.length; j += BATCH){
        const jobs = data.jobs.slice(j, j + BATCH);
        const part = isLattice ? lattice.placeRange(desc, jobs, store, occs) : placeRange(desc, jobs, store, occs, ground);
        for (const b of part.blocks) blocks.push(b);
        for (const p of part.placed) placed.push(p);
        tick(Math.min(data.jobs.length, j + BATCH));
      }
      const { keys } = store.snapshot();
      // A lattice's pass B comes in slices; the last one says so.
      if (!isLattice || data.last) occs.clear();
      send(data, { keys, blocks, placed });
    } else throw new Error('unknown message ' + data.type);
  } catch (error){
    self.postMessage({ id: data.id, error: String(error.message || error) });
  }
};
/* Progress from inside a range (asked for 2026-11-03: "show life"). A
   128³ lattice's pass B was 8 slices a worker of 32,768 cells, a few
   seconds each, and every worker finished its slice at about the same
   moment, so the toast sat still for seconds and then jumped. The range
   is run here in batches of BATCH (the core's own loop, a piece at a
   time, into the same store: the same blocks in the same order), and
   between batches the worker tells the driver how far it is, at most
   every TICK_MS. The core functions stay as they were. */
const BATCH = 64, TICK_MS = 150;
function ticker(id){
  let last = performance.now();
  return done => {
    const t = performance.now();
    if (t - last < TICK_MS) return;
    last = t;
    self.postMessage({ id, progress: done });
  };
}
// A result to the assembler (tagged), or back to the driver (as before).
function send(data, part){
  if (data.tag == null){ self.postMessage({ id: data.id, ...part }, [part.keys.buffer]); return; }
  toAsm.postMessage({ tag: data.tag, ...part }, [part.keys.buffer]);
  self.postMessage({ id: data.id, placed: part.placed ? part.placed.length : 0 });
}
self.postMessage({ ready: true });
