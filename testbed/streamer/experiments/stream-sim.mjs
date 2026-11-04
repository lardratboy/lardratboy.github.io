/* The streamer in Node, on a virtual clock (docs/stream-plan.md, decision 14).

   stream-viewer.html runs createStreamer against real module workers and a
   real frame loop. This runs the same streamer, with the same jobs
   (createJobRunner, so real expandChunk calls on a real snapshot), but
   the workers are W slots on a virtual clock: a job dispatched at time t
   finishes at t + its measured time (or a fixed `jobMs`). One frame is
   `frameMs` of virtual time and goes, in the order the page does it:

     move the eye → update → each worker: finish, take the next job, and
     so on until its current job runs past the frame → service
     (admission) → check

   A worker chains jobs inside a frame because the page's pool dispatches
   on every worker message, not once a frame (block-showroom's dispatch()
   comment: "refill idle workers on completion"). A job can start no
   earlier than the frame's update, since that is when the queue was made.

   so the numbers don't depend on this machine's GPU, on SwiftShader, or
   on how busy the browser is. What they do depend on is how fast this
   machine runs expandChunk, which is what a worker would be doing. A
   measured time also differs from run to run, so the tests pass `cost`, a
   deterministic model of it (TEST_COST below), and get the same schedule
   every time; the experiment uses the measured times.

   Every job is really run once and its result memoised by (key, rule),
   so a sweep over budgets or worker counts pays for each chunk once. The
   memo keeps the measured time too, so a repeat costs what the first did. */
import { createStreamer, createJobRunner } from '../stream-core.js';
import { colourOf } from '../colours.js';

// The snapshot's colour descriptor, if any, is resolved as a worker would
// (colours.js), so simulated jobs carry their attribute words (step 6).
export function createSim({ world, snap, memo = new Map() }){
  const runner = createJobRunner(snap, colourOf);
  const run = job => {
    const k = job.key + '/' + job.lodRule + '/' + (job.kind || 'records');
    let r = memo.get(k);
    if (!r){ r = runner(job); memo.set(k, r); }
    return r;
  };
  /* A streamer on the virtual clock whose disposals the frame log sees.
     fly() makes one per flight; makeStreamer() makes one to fly several
     times (the path test changes options between flights). */
  const disposed = [];
  const makeStreamer = (options = {}) => {
    const st = createStreamer({ now: () => 0, keepRecords: false, ...options,
                                dispose: e => { disposed.push(e.key); options.dispose?.(e); } });
    st.setWorld(world);
    return st;
  };
  /* Fly `path(t)` (t in ms → eye) for `frames` frames. `check(frame, ctx)`
     is called after every frame; `options` go to createStreamer. */
  function fly({ path, frames, workers = 4, frameMs = 1000 / 60, jobMs = null, jobScale = 1, cost = null,
                 options = {}, check = null, streamer = null }){
    const st = streamer || makeStreamer(options);
    const slots = Array.from({ length: workers }, () => ({ job: null, result: null, done: 0, free: 0 }));
    const log = [];
    let t = 0;
    for (let f = 0; f < frames; f++){
      t += frameMs;
      disposed.length = 0;
      const eye = path(t);
      st.update(eye);
      let started = 0;
      for (const s of slots) for (;;){
        if (s.job){
          if (s.done > t) break;
          st.complete(s.job, s.result); s.free = s.done; s.job = null;
        }
        const job = st.nextJob();
        if (!job) break;
        const r = run(job);
        const ms = jobMs ?? (cost ? cost(r) : r.ms) * jobScale;
        s.job = job; s.result = r; s.done = Math.max(s.free, t - frameMs) + ms; started++;
      }
      st.service();
      const fr = st.frame, S = st.S;
      const row = {
        t, eye, leaves: st.sel ? st.sel.leaves.length : 0, nodes: st.sel ? st.sel.nodes.size : 0,
        capped: st.sel ? st.sel.capped : 0,
        drawn: fr.draw.length, holes: fr.holes.length, up: fr.up, down: fr.down, maxUp: fr.maxUp,
        missing: st.sel ? st.sel.leaves.filter(l => !S.cache.has(l.key)).length : 0,
        missingAll: st.sel ? [...st.sel.nodes.keys()].filter(k => !S.cache.has(k)).length : 0,
        resident: S.cache.size, cacheBytes: S.cacheBytes,
        drawRecords: fr.draw.reduce((a, d) => { const e = S.cache.get(d.key); return a + (e ? (d.open ? e.total : e.count) : 0); }, 0),
        drawBytes: fr.draw.reduce((a, d) => a + (S.cache.get(d.key)?.bytes || 0), 0),
        upload: S.stats.lastUpload, installs: S.stats.lastInstalls, started,
        busy: slots.filter(s => s.job).length, pending: S.pending.size, results: S.results.length,
        inFlight: [...S.pending.values()].filter(j => !j.done).length,
        open: fr.draw.filter(d => d.open).length,
        // The path (stream-core §2b): drawn pages, and chunks of the cut
        // resident in the kind they no longer want.
        rayDrawn: fr.draw.filter(d => S.cache.get(d.key)?.kind === 'page').length,
        stale: st.sel ? [...st.sel.nodes.keys()].filter(k => st.stale(k)).length : 0, switches: S.stats.switches,
        // Disposed and gone is an eviction; disposed and still resident is
        // a chunk replaced by its other kind (stream-core §2b).
        evicted: disposed.filter(k => !S.cache.has(k)), replaced: disposed.filter(k => S.cache.has(k)),
      };
      log.push(row);
      // A check that returns true ends the flight early.
      if (check && check(row, { st, slots }) === true) break;
    }
    return { st, log };
  }
  return { run, fly, memo, makeStreamer };
}

/* Paths. A straight line at `speed` voxels per second, and a stop. */
export const line = (from, to, speed) => t => {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const u = Math.min(1, speed * t / 1000 / d);
  return [from[0] + u * (to[0] - from[0]), from[1] + u * (to[1] - from[1]), from[2] + u * (to[2] - from[2])];
};
export const still = eye => () => eye;
// Wait at `from` for `wait` ms (to converge), then fly the line and stop.
export const after = (wait, from, to, speed) => { const l = line(from, to, speed); return t => t < wait ? from : l(t - wait); };

/* A job's time as a function of its result, for runs that must repeat
   exactly (the tests). Fitted by eye to experiments/stream.mjs's
   measurements: about 0.5 ms of fixed walk and apron, plus 0.2 µs per
   occupied cell. */
export const TEST_COST = r => 0.5 + 2e-4 * r.occupied;
