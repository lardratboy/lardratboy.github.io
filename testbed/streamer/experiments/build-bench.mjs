/* The page's world builds, timed in headless Chrome (docs/math-world.md §9,
   asked for 2026-11-20 with the ground in column parts): scatter-build.js's
   buildScatterInWorkers run as the stream viewer runs it, the math world on
   the page's build threads (min(8, cores − 1)) and the scatter on its chunk
   workers' count (min(4, cores − 1)), each world built `--runs` times, the
   median kept, with the voxels and nodes it made (so two trees can be held
   to the same world). Nothing is drawn.

   node experiments/build-bench.mjs [--root=dir] [--only=math,scatter] [--D=10,11,12] [--runs=3]
   --root serves another checkout (a `git worktree` of an older commit) to
   compare with; its own scatter-build.js is what runs. It measures build
   times, so run it on an idle machine. Prints only. */
import { findChrome, serveStatic, launchChrome, REPO_ROOT } from '../test/browser/harness.js';
import { resolve } from 'node:path';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const root = resolve(arg('root') || REPO_ROOT) + '/', kinds = (arg('only') || 'math,scatter').split(','), depths = (arg('D') || '10,11,12').split(',').map(Number), runs = +(arg('runs') || 3);
const chrome = findChrome();
if (!chrome){ console.log('no Chrome found (TESTBED_CHROME=/path)'); process.exit(0); }
const server = await serveStatic(root), { session, close } = await launchChrome(chrome);
try {
  // Any page of the origin will do for the imports (a 404's empty body is Chrome's
  // error page, of no origin): a module's text, shown as text.
  await session.send('Page.navigate', { url: `${server.origin}/dag-core.js` });
  await new Promise(r => setTimeout(r, 500));
  console.log(`root ${root}, ${await session.evaluate('navigator.hardwareConcurrency')} cores`);
  console.log('world    D   threads   median s   runs s                 voxels          nodes');
  for (const kind of kinds) for (const D of depths){
    const r = await session.evaluate(`(async () => {
      const B = await import('/scatter-build.js'), { createCounts } = await import('/dag-core.js');
      const core = await import(${JSON.stringify(kind === 'math' ? '/math-core.js' : '/scatter-core.js')});
      const desc = ${kind === 'math' ? 'core.mathDesc' : 'core.scatterDesc'}({ D: ${D} }), cores = navigator.hardwareConcurrency || 4;
      const workers = ${kind === 'math'} ? Math.min(8, Math.max(1, cores - 1)) : Math.min(4, Math.max(1, cores - 1));
      const times = [];
      let w = null;
      for (let k = 0; k < ${runs}; k++){ const t0 = performance.now(); w = await B.buildScatterInWorkers(desc, { workers }); times.push((performance.now() - t0) / 1000); }
      const c = createCounts(w.store);
      return { workers, times, voxels: c.of(w.root), nodes: w.nodes, fellBack: w.fellBack ?? null };
    })()`);
    const med = r.times.slice().sort((a, b) => a - b)[Math.floor(r.times.length / 2)];
    console.log(`${kind.padEnd(8)} ${String(D).padStart(2)}  ${String(r.workers).padStart(7)}   ${med.toFixed(2).padStart(8)}   ${r.times.map(t => t.toFixed(2)).join(' ').padEnd(20)} ${r.voxels.toLocaleString().padStart(14)} ${r.nodes.toLocaleString().padStart(14)}${r.fellBack ? '  FELL BACK: ' + r.fellBack : ''}`);
  }
} finally {
  await close();
  await server.close();
}
