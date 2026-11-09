/* Module worker: reads and writes world files off the main thread
   (docs/binaryoutput.md §11). A 128³ lattice's file is 43 MB and 3M nodes,
   over a second of decoding that the page would otherwise spend frozen.

   Short-lived, one job a worker, as scatter-build.js's are; the page
   terminates it when the job ends. Every decision is vdag-core's. The colour
   fields come from colours.js here, since a worker can't be sent a function.
   Keys and tables come back as transferred buffers, nothing copied. */
import { readVdag, writeVdag } from './vdag-core.js';
import { colourOf } from './colours.js';

self.onmessage = async ({ data }) => {
  const onPhase = (text, fraction) => self.postMessage({ phase: text, fraction });
  try {
    if (data.op === 'read'){
      const { worlds, bytes } = await readVdag(data.bytes, { colourOf, onPhase }), transfer = [];
      for (const w of worlds){
        transfer.push(w.keys.buffer);
        if (w.colour?.table) transfer.push(w.colour.table.buffer);
        if (w.colour?.words) transfer.push(w.colour.words.buffer);
      }
      self.postMessage({ done: true, worlds, bytes }, transfer);
    } else if (data.op === 'write'){
      const file = await writeVdag(data.worlds, { colourOf, onPhase });
      self.postMessage({ done: true, file }, [file.buffer]);
    } else throw new Error(`unknown job ${data.op}`);
  } catch (error){
    self.postMessage({ done: true, error: String(error.message || error) });
  }
};
