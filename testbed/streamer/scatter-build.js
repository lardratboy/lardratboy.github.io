/* SCATTER BUILD: a scatter or lattice world built across module workers
   (docs/scatter-plan.md, decision 8; docs/lattice3d-plan.md). The page's
   side of buildScatter and buildLattice: the same two passes and the
   same merge (scatter-core's moreUntil, pickUnique, assignCells,
   mergePart; lattice-core's nextRange, pickCells, mergePart), with the
   work spread over scatter-worker.js threads:
     - for the scatter world, one worker builds the ground while the
       others run pass A over contiguous ranges of recipes;
     - pass B sends each recipe back to the worker that built it, which
       still holds its occupancy;
     - one more worker, the assembler, takes each part straight from the
       worker that made it (a MessageChannel a builder), imports them in
       a fixed order (ground first, so ids stay children-first), grafts
       and prunes, and sends the pruned keys back. The main thread holds
       the world as a read-only storeView of them: it never imports,
       grafts or prunes, so it keeps drawing the old world meanwhile (at
       R = 5, 128³ that was 6–12 s held still; docs/lattice3d-log.md §8).
   The lattice world has no ground, and with axes 'traits' no pass A
   either (its cells don't need to be unique): pass B builds and places
   each cell, the cells dealt round the workers.

   The workers are short-lived: they're terminated once the world is
   built. The chunk pool's workers keep expanding the old world
   meanwhile, which the page keeps drawing.

   A build can be CANCELLED: `signal` (an AbortSignal) rejects the build
   with an AbortError and terminates its workers, wherever they are. The
   page does that when a newer world is asked for while one is building
   (dragging the lattice's R or size), so builds never queue up behind
   each other.

   Progress: onPhase(text, fraction), fraction in [0, 1] or null. The
   workers say how far into each range they are (scatter-worker.js's
   ticker), so the fraction moves within a pass, not only between its
   rounds and slices.

   Without workers (or if one fails) it falls back to buildScatter or
   buildLattice on the main thread, which is the same world, much slower.
   A cancelled build never falls back. */
import { storeView } from './dag-core.js';
import { scatterLayout, pickUnique, moreUntil, assignCells, buildScatter } from './scatter-core.js';
import * as lattice from './lattice-core.js';

const abortError = () => new DOMException('the build was superseded', 'AbortError');
export const isAbort = e => e && e.name === 'AbortError';
export const PLACE_SLICE = 32768;

function spawn(){
  const w = new Worker(new URL('./scatter-worker.js', import.meta.url), { type: 'module' });
  let next = 0, failed = null;
  const waiting = new Map();
  const ready = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('scatter worker startup timed out')), 10000);
    w.onmessage = ({ data }) => {
      if (data.ready){ clearTimeout(t); resolve(); return; }
      // A progress note from inside a range: the ask is still running.
      if (data.progress != null){ waiting.get(data.id)?.onProgress?.(data.progress); return; }
      const p = waiting.get(data.id);
      waiting.delete(data.id);
      if (p) data.error ? p.reject(new Error(data.error)) : p.resolve(data);
    };
    // A worker that has failed fails every ask after too: the assembler's
    // finish may be asked after the error, and would wait for ever.
    w.onerror = e => { e.preventDefault(); clearTimeout(t); failed = new Error(e.message || 'scatter worker error'); reject(failed); for (const p of waiting.values()) p.reject(failed); };
  });
  const ask = (msg, transfer = [], onProgress = null) => new Promise((resolve, reject) => {
    if (failed) return reject(failed);
    const id = next++;
    waiting.set(id, { resolve, reject, onProgress });
    w.postMessage({ ...msg, id }, transfer);
  });
  return { ready, ask, close: () => w.terminate() };
}
// A channel from a builder to the assembler: the builder's tagged results go down it.
function connect(asm, builder){
  const ch = new MessageChannel();
  return Promise.all([asm.ask({ type: 'asm-port' }, [ch.port1]), builder.ask({ type: 'port' }, [ch.port2])]);
}
// The assembler's answer as the world: the pruned keys, read through a view.
function assembled(r){
  return { store: storeView({ keys: r.keys }), root: r.root, table: r.table, blocks: r.blocks, dropped: r.dropped, nodes: r.keys.length / 9 };
}

export async function buildScatterInWorkers(desc, { workers = 4, onPhase = () => {}, signal = null } = {}){
  const isLattice = desc.kind === 'lattice';
  const fallback = () => isLattice ? lattice.buildLattice(desc, { onPhase }) : buildScatter(desc, { onPhase });
  if (signal?.aborted) throw abortError();
  if (!workers) return { ...fallback(), threads: 0 };
  // The bar only moves forward: pass A's fraction within a round is a
  // guess from the yield so far, and the round's real count can be lower.
  const report = onPhase;
  let shown = 0;
  onPhase = (t, f) => report(t, f == null ? f : (shown = Math.max(shown, f)));
  const t0 = performance.now(), pool = Array.from({ length: workers + (isLattice ? 0 : 1) }, spawn), asm = spawn();
  // Every wait races the signal, so a cancel doesn't wait for a worker.
  const cancelled = new Promise((_, reject) => signal?.addEventListener('abort', () => reject(abortError()), { once: true }));
  cancelled.catch(() => {});
  const wait = p => Promise.race([p, cancelled]);
  try {
    await wait(Promise.all([...pool, asm].map(p => p.ready)));
    await wait(Promise.all(pool.map(p => connect(asm, p))));
    return isLattice ? await latticeInWorkers(desc, pool, asm, { t0, wait, onPhase })
                     : await scatterInWorkers(desc, pool, asm, { t0, wait, onPhase });
  } catch (e){
    if (isAbort(e) || signal?.aborted) throw abortError();
    console.warn(`${desc.kind || 'scatter'}: workers failed, building on the main thread`, e);
    return { ...fallback(), threads: 0, fellBack: String(e.message || e) };
  } finally {
    for (const p of pool) p.close();
    asm.close();
  }
}

async function scatterInWorkers(desc, pool, asm, { t0, wait, onPhase }){
  const layout = scatterLayout(desc), N = layout.cells.length, [groundW, ...builders] = pool;
  onPhase(`ground and ${N} specimens on ${builders.length} threads`, 0);
  const groundP = groundW.ask({ type: 'ground', desc, tag: 'ground' });
  // Pass A: contiguous ranges, one per builder; who built what, for pass B.
  const prints = [], owner = [];
  let picked = [];
  while (picked.length < N){
    const n0 = prints.length, n1 = moreUntil(n0, N, picked.length), per = Math.ceil((n1 - n0) / builders.length);
    const done = builders.map(() => 0), y = n0 ? picked.length / n0 : 1, had = picked.length;
    const tick = () => { const d = done.reduce((a, b) => a + b, 0);
      onPhase(`fingerprinting recipes ${(n0 + d).toLocaleString()} of ${n1.toLocaleString()}, ~${Math.min(N, Math.round(had + y * d))} of ${N} unique`, 0.7 * Math.min(1, (had + y * d) / N)); };
    const got = await wait(Promise.all(builders.map((b, k) => {
      const a = n0 + k * per, z = Math.min(n1, a + per);
      for (let n = a; n < z; n++) owner[n] = k;
      return a < z ? b.ask({ type: 'prints', desc, n0: a, n1: z }, [], d => { done[k] = d; tick(); }) : { prints: [] };
    })));
    for (const g of got) prints.push(...g.prints);
    picked = pickUnique(prints, N);
    onPhase(`fingerprinted ${prints.length} recipes, ${picked.length} of ${N} unique`, 0.7 * picked.length / N);
  }
  const tA = performance.now();
  // Pass B, each recipe on its builder, every part to the assembler; the
  // ground's keys are merged first.
  const jobs = assignCells(layout, picked);
  onPhase('placing', 0.7);
  await wait(asm.ask({ type: 'assemble', desc, order: ['ground', ...builders.map((_, k) => k)], prints }));
  const placedBy = builders.map(() => 0), tickB = () => {
    const d = placedBy.reduce((a, b) => a + b, 0);
    onPhase(`placed ${d} of ${N}`, 0.7 + 0.25 * d / N);
  };
  await wait(Promise.all([groundP, ...builders.map((b, k) => b.ask({ type: 'place', desc, jobs: jobs.filter(j => owner[j.n] === k), tag: k }, [],
                                                                   d => { placedBy[k] = d; tickB(); }))]));
  const tB = performance.now();
  onPhase('grafting and pruning', 0.95);
  const r = await wait(asm.ask({ type: 'finish' }));
  return { ...assembled(r), D: desc.D, layout, prints, picked, skipped: picked[N - 1] + 1 - N,
           threads: pool.length - 1, ms: { passA: tA - t0, passB: tB - tA, assemble: r.ms, total: performance.now() - t0 } };
}

/* The lattice: pass A as the scatter's (random axes only), then pass B on
   whichever worker holds each recipe; trait cells are dealt round. Parts
   report as they land, so the progress moves during pass B too. */
async function latticeInWorkers(desc, pool, asm, { t0, wait, onPhase }){
  const layout = lattice.latticeLayout(desc), N = layout.cells.length, label = `${N.toLocaleString()} specimens on ${pool.length} threads`;
  const owner = [], traits = desc.axes === 'traits', share = traits ? 0 : 0.6;
  let picked = [];
  onPhase(label, 0);
  if (traits){
    picked = lattice.traitPicks(N);
    for (let n = 0; n < N; n++) owner[n] = n % pool.length;
  } else {
    const prints = [];
    while (picked.length < N){
      const n0 = prints.length, n1 = lattice.nextRange(n0, N, picked.length), per = Math.ceil((n1 - n0) / pool.length);
      const done = pool.map(() => 0), y = n0 ? new Set(picked).size / n0 : 1, had = new Set(picked).size;
      const tick = () => { const d = done.reduce((a, b) => a + b, 0), u = Math.min(N, Math.round(had + y * d));
        onPhase(`${label}: fingerprinting recipes ${(n0 + d).toLocaleString()} of ${n1.toLocaleString()}, ~${u.toLocaleString()} of ${N.toLocaleString()} unique`, share * u / N); };
      const got = await wait(Promise.all(pool.map((b, k) => {
        const a = n0 + k * per, z = Math.min(n1, a + per);
        for (let n = a; n < z; n++) owner[n] = k;
        return a < z ? b.ask({ type: 'prints', desc, n0: a, n1: z }, [], d => { done[k] = d; tick(); }) : { prints: [] };
      })));
      for (const g of got) for (const p of g.prints) prints.push(p);
      picked = lattice.pickCells(prints, N);
      onPhase(`${label}: fingerprinted ${prints.length.toLocaleString()} recipes, ${new Set(picked).size.toLocaleString()} of ${N.toLocaleString()} unique`,
              share * Math.min(1, picked.length / N));
    }
  }
  /* Pass B in slices of at most PLACE_SLICE cells, each worker's one after
     another, so the toast moves during a 128³ build rather than sitting
     at "placing", and each slice's job objects are made only when it's
     sent. The assembler merges slices as they land, in a fixed order
     (round r of every worker, then round r + 1), so the blocks reach
     graft() in the same order every time; with one slice a worker that
     is the order one message per worker gave. (The pruned node count
     doesn't depend on the order, but the ids do.) Merging as they land
     keeps the heap down: at 128³, holding every slice until the end,
     the page's heap reached 3 GB (docs/lattice3d-log.md §5); it's the
     assembler's heap now. */
  const tA = performance.now(), mine = pool.map(() => []);
  for (let c = 0; c < N; c++) mine[owner[picked[c]]].push(c);
  const slices = mine.map(cs => Math.max(1, Math.ceil(cs.length / PLACE_SLICE)));
  const order = [];
  for (let r = 0; r < Math.max(...slices); r++) for (let k = 0; k < pool.length; k++) if (r < slices[k]) order.push(k * 65536 + r);
  // Cells placed so far, a worker's: its finished slices, and how far
  // into the current one it says it is (the old count, done × PLACE_SLICE,
  // read "placed 262,144" while the first slices were only being built).
  const placedBy = pool.map(() => 0), tick = () => {
    const d = placedBy.reduce((a, b) => a + b, 0);
    onPhase(`${label}: placed ${d.toLocaleString()} of ${N.toLocaleString()}`, share + (0.95 - share) * d / N);
  };
  onPhase(`${label}: placing`, share);
  await wait(asm.ask({ type: 'assemble', desc, order }));
  const parts = pool.map(async (b, k) => {
    for (let s = 0; s < slices[k]; s++){
      const base = s * PLACE_SLICE, jobs = lattice.cellJobs(layout, picked, mine[k].slice(base, base + PLACE_SLICE));
      await b.ask({ type: 'place', desc, jobs, last: s === slices[k] - 1, tag: k * 65536 + s }, [], d => { placedBy[k] = base + d; tick(); });
      placedBy[k] = base + jobs.length;
      tick();
    }
  });
  await wait(Promise.all(parts));
  const tB = performance.now();
  onPhase(`${label}: grafting and pruning`, 0.95);
  const r = await wait(asm.ask({ type: 'finish' }));
  return { ...assembled(r), D: desc.D, layout, picked, ...lattice.pickStats(picked),
           threads: pool.length, ms: { passA: tA - t0, passB: tB - tA, assemble: r.ms, graft: r.ms.graft + r.ms.prune, total: performance.now() - t0 } };
}
