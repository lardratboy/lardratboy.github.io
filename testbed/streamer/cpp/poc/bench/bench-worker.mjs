/* bench-worker.mjs — one chunk worker for bench.mjs: chunk-worker.js's job
   minus the messaging protocol. It holds its own copy of the snapshot (it came
   by structured clone), makes a fresh runner per run (a cold mask cache, as
   bench.cpp's fresh JobScratch), and pulls job indices off a shared counter. */
import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';

const { root, snap } = workerData;
const { createJobRunner } = await import(path.join(root, 'stream-core.js'));
const { colourOf } = await import(path.join(root, 'colours.js'));
parentPort.postMessage('ready');
parentPort.on('message', ({ jobs, counter }) => {
  const run = createJobRunner(snap, colourOf), out = [], transfer = [];
  for (let i; (i = Atomics.add(counter, 0, 1)) < jobs.length;){
    const r = run(jobs[i]);
    out.push([i, { records: r.records, attrs: r.attrs, count: r.count, quads: r.quads, openQuads: r.openQuads, occupied: r.occupied, buriedChunk: !!r.buriedChunk }]);
    transfer.push(r.records.buffer);
    if (r.attrs) transfer.push(r.attrs.buffer);
  }
  parentPort.postMessage(out, transfer.filter((b, i, a) => b.byteLength && a.indexOf(b) === i));
});
