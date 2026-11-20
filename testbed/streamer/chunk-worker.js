/* Module worker: expands chunks off the main thread (docs/stream-plan.md,
   decision 9). block-showroom's src/core/worker.js, with the job swapped
   from build(i, j) to expand(chunk, lod).

   It holds one world at a time (or one universe's worlds): a DAG snapshot (keys, counts, poses)
   that stream-pool.js posts once per world, tagged with the streamer's
   revision. A job for any other revision is refused, which can only
   happen if a message is lost, because the pool posts the world before
   any job of its revision and a worker's messages arrive in order. The
   result goes back as transferable buffers: 4 bytes a record and 4 of
   attribute (step 6), or a ray page's grid, bricks and attribute block
   (steps 5 and 6). The world's colour field is rebuilt here from the
   snapshot's descriptor (colours.js); a baked one's words came in the
   snapshot, and the field is built over this worker's view of the keys
   (glb-colour step 5).

   An edit arrives as a tail (stream-core §4b) on this same port, ahead of any
   job naming its root, and a job says which root it reads. A tail that doesn't
   fit throws here, and the pool's onerror restarts the worker, which gets the
   snapshot and every tail again.

   A universe (docs/universe-plan.md step 2) is many worlds under one revision:
   each comes as a 'world' message with its key (`id`), and a job names one
   (`id`, null for a plain world, which is how setWorld's messages read). A
   world message of a new revision forgets every runner; one of the same
   revision adds a world (or replaces it), and a 'drop' of the same revision
   forgets one (the endless lattice's windows, step 5). A universe has no tails. */
import { createJobRunner } from './stream-core.js';
import { colourOf } from './colours.js';

const runners = new Map();
let revision = -1;
self.onmessage = ({ data }) => {
  if (data.type === 'world'){
    if (data.revision !== revision){ runners.clear(); revision = data.revision; }
    const runner = createJobRunner(data.snap, colourOf);
    runners.set(data.id ?? null, runner);
    return;
  }
  // A world a universe no longer names (stream-pool's updateUniverse, step 5).
  if (data.type === 'drop'){
    if (data.revision === revision) runners.delete(data.id);
    return;
  }
  if (data.type === 'tail'){
    const runner = runners.get(null);
    if (!runner || data.revision !== revision) throw new Error(`a tail for world ${data.revision} (have ${revision})`);
    runner.tail(data.tail);
    return;
  }
  try {
    if (data.type !== 'expand') throw new Error('unknown job type ' + data.type);
    const runner = runners.get(data.id ?? null);
    if (!runner || data.world !== revision) throw new Error(`no world ${data.world}${data.id != null ? ' ' + data.id : ''} (have ${revision}${runners.size ? ': ' + [...runners.keys()].join(', ') : ''})`);
    const result = runner(data);
    // A records job sends its records and their words; a page job (step 5)
    // its brick grid, node ids and bits, and its attribute block (step 6).
    // Either way the buffers move, nothing is copied.
    const transfer = result.kind === 'page' ? [result.grid.buffer, result.ids.buffer, result.bits.buffer]
                                            : [result.records.buffer];
    for (const a of [result.attrs, result.attr, result.attrAt]) if (a) transfer.push(a.buffer);
    self.postMessage({ jobId: data.jobId, result }, transfer);
  } catch (error){
    self.postMessage({ jobId: data.jobId, error: String(error.message || error) });
  }
};
self.postMessage({ ready: true });
