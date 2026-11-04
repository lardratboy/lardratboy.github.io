/* Module worker: expands chunks off the main thread (docs/stream-plan.md,
   decision 9). block-showroom's src/core/worker.js, with the job swapped
   from build(i, j) to expand(chunk, lod).

   It holds one world at a time: a DAG snapshot (keys, counts, poses)
   that stream-pool.js posts once per world, tagged with the streamer's
   revision. A job for any other revision is refused, which can only
   happen if a message is lost, because the pool posts the world before
   any job of its revision and a worker's messages arrive in order. The
   result goes back as transferable buffers: 4 bytes a record and 4 of
   attribute (step 6), or a ray page's grid, bricks and attribute block
   (steps 5 and 6). The world's colour field is rebuilt here from the
   snapshot's descriptor (colours.js). */
import { createJobRunner } from './stream-core.js';
import { colourOf } from './colours.js';

let runner = null, revision = -1;
self.onmessage = ({ data }) => {
  if (data.type === 'world'){
    runner = createJobRunner(data.snap, colourOf);
    revision = data.revision;
    return;
  }
  try {
    if (data.type !== 'expand') throw new Error('unknown job type ' + data.type);
    if (!runner || data.world !== revision) throw new Error(`no world ${data.world} (have ${revision})`);
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
