/* Module worker: one .vdb's conversion, off the page's thread (vdb-convert.js's
   convertVdb). It gets the File itself and reads it in pieces (vdb-core.js's
   fileSource: the header, each grid's descriptor, then only the grids the
   conversion asks for), so a file of several grids never sits in memory
   whole. One job a worker, as convert/'s: cancelling is terminating it. */
import { fileSource } from './vdb-core.js';
import { convertVdb } from './vdb-convert.js';

self.onmessage = async ({ data }) => {
  const post = (m, transfer) => self.postMessage(m, transfer);
  try {
    await convertVdb(fileSource(data.vdb), {
      name: data.name, depths: data.depths, bits: data.bits, sampling: data.sampling, up: data.up,
      grid: data.grid ?? null, mode: data.mode ?? null, threshold: data.threshold ?? null, colour: data.colour ?? 'auto',
      onAsset: asset => post({ asset }),
      onStage: (D, stage) => post({ stage: { D, stage } }),
      onWorld: world => post({ world }, [world.bytes.buffer, ...(world.thumb ? [world.thumb.rgba.buffer] : [])]),
    });
    post({ done: true });
  } catch (e){
    post({ error: String(e?.message ?? e) });
  }
};
