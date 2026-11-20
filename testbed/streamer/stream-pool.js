/* STREAM POOL — the threads under a streamer (docs/stream-plan.md, decision 7).
   block-showroom's GenerationPool (src/lattice/generation.js), cut down
   to what is about threads: module worker slots, a startup timeout and
   one restart per slot, a 30 s job timeout, and a main-thread
   'compatibility' mode that runs one job per frame when workers are
   unavailable or `?workers=0`. Everything that is a decision (which job
   next, what is still wanted, what to admit) moved into stream-core.js's
   createStreamer, which Node tests, so this file only moves messages.

   The world travels separately from the jobs: setWorld(snap, epoch)
   posts the DAG snapshot to every worker once (structured clone, so each
   worker gets its own copy, §8.4), and a restarted worker gets it again
   before its first job. Jobs carry that epoch, so a worker can refuse a
   job meant for another world. The streamer's revision is a different
   thing (which results are stale) and never reaches the worker.

   An edit reaches a worker as a tail (stream-core §4b), on the port its
   jobs use, so a job runs with exactly the nodes and colour table it was
   dispatched with. The pool keeps every tail of the world, because a worker
   that restarts has only the snapshot: it gets that and all of them, in
   order, before its first job. So do the workers that weren't ready yet and
   the main-thread runner, which is built late. Under 1 KB a click, so about
   18 MB for an hour of nonstop clicking (docs/edit-mode-log.md §2).

   A universe (stream-core §1b, docs/universe-plan.md step 2) is many worlds
   under one epoch: setUniverse(snaps, revision) posts each world's snapshot
   once, tagged with its key (`id`), and a job names the world it reads
   (`job.world`, the streamer's; `id` in the message), so a worker keeps a
   runner a world. A restarted worker gets every snapshot again, as a plain
   world's gets its tails. A universe doesn't edit, so it has no tails. A plain
   world is the id null, so setWorld's messages are what they were. Each
   worker holds every world: fine for a fixed universe, and what layers
   (universekit Q7) will improve. The endless lattice (step 5) changes its
   universe as the eye moves, by updateUniverse: the worlds gained and a drop
   for each lost, one revision. */
import { createJobRunner } from './stream-core.js';
import { colourOf } from './colours.js';

export class StreamPool {
  constructor(streamer, { workerCount = 4 } = {}){
    this.streamer = streamer;
    this.workerCount = workerCount;
    this.slots = [];
    this.world = null;               // { snap, revision }, or a universe's { snaps, revision }
    this.tails = [];                 // every edit's tail for this world, in order
    this.runner = null;              // the main-thread runner, built lazily
    this.runners = new Map();        // a universe's main-thread runners, by world
    this.mode = workerCount ? 'starting workers' : 'compatibility';
    this.suspended = false;
    this.completed = 0;
  }
  get liveWorkers(){ return this.slots.filter(s => !s.dead).length; }
  get busy(){ return this.slots.filter(s => s.job).length; }

  setWorld(snap, revision){
    this.world = { snap, revision };
    this.tails = [];
    this.runner = null; this.runners.clear();
    for (const s of this.slots) if (s.ready && !s.dead) this._sendWorld(s);
  }
  _sendWorld(slot){
    if (!this.world) return;
    const { snaps, revision } = this.world;
    if (snaps) for (const [id, snap] of snaps) slot.worker.postMessage({ type: 'world', id, snap, revision });
    else slot.worker.postMessage({ type: 'world', snap: this.world.snap, revision: this.world.revision });
    slot.revision = this.world.revision;
    for (const tail of this.tails) slot.worker.postMessage({ type: 'tail', tail, revision: this.world.revision });
  }
  /* `snaps`: a Map (or [key, snap] pairs) of worldSnapshot by the universe's
     world keys, the keys its streamer's jobs name. */
  setUniverse(snaps, revision){
    this.world = { snaps: new Map(snaps), revision };
    this.tails = [];
    this.runner = null; this.runners.clear();
    for (const s of this.slots) if (s.ready && !s.dead) this._sendWorld(s);
  }
  /* Another universe under the same revision (universe-plan step 5, the endless
     lattice's windows): only what changed goes to the workers, a 'world' for each
     snapshot new to them (a key new, or the same key with another snapshot) and a
     'drop' for each key gone, so a window that moves sends the worlds it gained and
     frees the ones it left, and a worker's runners for the rest stay. The streamer
     (setUniverse's keep) has already forgotten every job of a world gone or changed,
     and a job is posted after the messages here on the same port, so no worker is
     asked for a world it has dropped. A slot not at this revision gets everything
     from _sendWorld, as a restarted one does. */
  updateUniverse(snaps){
    if (!this.world?.snaps) throw new Error('StreamPool: updateUniverse needs a universe (setUniverse first)');
    const old = this.world.snaps, next = new Map(snaps), { revision } = this.world;
    const added = [...next].filter(([id, snap]) => old.get(id) !== snap), dropped = [...old.keys()].filter(id => !next.has(id));
    this.world = { snaps: next, revision };
    for (const id of dropped) this.runners.delete(id);
    for (const [id] of added) this.runners.delete(id);
    for (const s of this.slots){
      if (!s.ready || s.dead || s.revision !== revision) continue;
      for (const id of dropped) s.worker.postMessage({ type: 'drop', id, revision });
      for (const [id, snap] of added) s.worker.postMessage({ type: 'world', id, snap, revision });
    }
    return { added: added.length, dropped: dropped.length };
  }
  /* What the streamer's publish hands the page: an edit's new nodes and colour
     ops. Called before any job can name the new root. A slot that isn't ready
     has nothing to keep up with, as it gets every tail when it is. */
  tail(tail){
    if (this.world?.snaps) throw new Error('StreamPool: a universe has no tails (it doesn\'t edit)');
    this.tails.push(tail);
    this.runner?.tail(tail);
    for (const s of this.slots) if (s.ready && !s.dead && s.revision === this.world.revision)
      s.worker.postMessage({ type: 'tail', tail, revision: this.world.revision });
  }

  start(){
    if (!this.workerCount) return;
    this.slots = Array.from({ length: this.workerCount }, () => ({ worker: null, job: null, ready: false, dead: false, restarts: 0, timer: null, revision: -1 }));
    for (const s of this.slots) this._startWorker(s);
  }
  _startWorker(slot){
    const fail = error => {
      const job = slot.job; slot.job = null;
      if (job) this.streamer.fail(job, error);
      this._restartWorker(slot);
    };
    slot.fail = fail;
    try {
      const w = slot.worker = new Worker(new URL('./chunk-worker.js', import.meta.url), { type: 'module' });
      slot.timer = setTimeout(() => fail('worker startup timed out'), 10000);
      w.onerror = e => { e.preventDefault(); fail(e.message || 'worker error'); };
      w.onmessageerror = () => fail('invalid worker message');
      w.onmessage = ({ data }) => {
        if (data.ready){
          clearTimeout(slot.timer); slot.timer = null; slot.ready = true;
          this.mode = 'workers';
          this._sendWorld(slot);
        } else this._finish(slot, data);
        this.dispatch();
      };
    } catch (e){ fail(e.message); }
  }
  _restartWorker(slot){
    clearTimeout(slot.timer);
    if (slot.worker){ slot.worker.onmessage = slot.worker.onerror = slot.worker.onmessageerror = null; slot.worker.terminate(); }
    slot.worker = null; slot.ready = false;
    if (slot.restarts++ < 1) this._startWorker(slot);
    else slot.dead = true;
    if (this.slots.every(s => s.dead)){
      this.mode = 'compatibility';
      console.warn('stream pool: workers unavailable, expanding on the main thread');
    }
  }
  _finish(slot, msg){
    const job = slot.job;
    if (!job || msg.jobId !== job.jobId) return;
    clearTimeout(slot.timer); slot.timer = null; slot.job = null;
    if (msg.error){ this.streamer.fail(job, msg.error); this._restartWorker(slot); return; }
    this.completed++; slot.completed = (slot.completed || 0) + 1;
    this.streamer.complete(job, msg.result);
  }
  suspend(){
    this.suspended = true;
    for (const s of this.slots){
      clearTimeout(s.timer);
      if (s.worker){ s.worker.onmessage = s.worker.onerror = s.worker.onmessageerror = null; s.worker.terminate(); }
      if (s.job) this.streamer.fail(s.job, 'suspended');
    }
    this.slots = [];
  }
  resume(){ this.suspended = false; this.mode = this.workerCount ? 'starting workers' : 'compatibility'; this.start(); }

  /* Refill idle workers. Called on every worker message and once a frame;
     in compatibility mode, once a frame runs at most one job, since a job
     can't be preempted. */
  dispatch(){
    if (this.suspended || !this.world) return;
    if (this.mode === 'compatibility'){
      const job = this.streamer.nextJob();
      if (!job) return;
      try { this.completed++; this.streamer.complete(job, this._runnerOf(job)(job)); }
      catch (e){ this.streamer.fail(job, e.message); }
      return;
    }
    for (const slot of this.slots){
      if (!slot.ready || slot.dead || slot.job) continue;
      if (slot.revision !== this.world.revision) this._sendWorld(slot);
      const job = this.streamer.nextJob();
      if (!job) break;
      slot.job = job;
      slot.timer = setTimeout(() => slot.fail('worker job timed out'), 30000);
      try {
        // `world` is the pool's world epoch, not the streamer's revision: the
        // streamer bumps its revision on any flush (a new rayLod, say), and
        // the worker's world is still good then (docs/ray-log.md §4).
        // `id` is the job's world in a universe (null for a plain world).
        slot.worker.postMessage({ type: 'expand', jobId: job.jobId, world: this.world.revision, id: job.world ?? null, lod: job.lod,
                                  cx: job.cx, cy: job.cy, cz: job.cz, lodRule: job.lodRule, kind: job.kind, root: job.root });
      } catch (e){ slot.fail(e.message); }
    }
  }
  // The main-thread runner for a job: the world's, or its world's in a universe.
  _runnerOf(job){
    const { snaps } = this.world;
    if (!snaps){
      if (!this.runner){
        this.runner = createJobRunner(this.world.snap, colourOf);
        for (const tail of this.tails) this.runner.tail(tail);
      }
      return this.runner;
    }
    let r = this.runners.get(job.world);
    if (!r){
      const snap = snaps.get(job.world);
      if (!snap) throw new Error(`StreamPool: no world '${job.world}' in this universe`);
      this.runners.set(job.world, r = createJobRunner(snap, colourOf));
    }
    return r;
  }
}
