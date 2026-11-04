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
   thing (which results are stale) and never reaches the worker. */
import { createJobRunner } from './stream-core.js';
import { colourOf } from './colours.js';

export class StreamPool {
  constructor(streamer, { workerCount = 4 } = {}){
    this.streamer = streamer;
    this.workerCount = workerCount;
    this.slots = [];
    this.world = null;               // { snap, revision }
    this.runner = null;              // the main-thread runner, built lazily
    this.mode = workerCount ? 'starting workers' : 'compatibility';
    this.suspended = false;
    this.completed = 0;
  }
  get liveWorkers(){ return this.slots.filter(s => !s.dead).length; }
  get busy(){ return this.slots.filter(s => s.job).length; }

  setWorld(snap, revision){
    this.world = { snap, revision };
    this.runner = null;
    for (const s of this.slots) if (s.ready && !s.dead) this._sendWorld(s);
  }
  _sendWorld(slot){
    if (!this.world) return;
    slot.worker.postMessage({ type: 'world', snap: this.world.snap, revision: this.world.revision });
    slot.revision = this.world.revision;
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
    this.completed++;
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
      this.runner ||= createJobRunner(this.world.snap, colourOf);
      try { this.completed++; this.streamer.complete(job, this.runner(job)); }
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
        slot.worker.postMessage({ type: 'expand', jobId: job.jobId, world: this.world.revision, lod: job.lod,
                                  cx: job.cx, cy: job.cy, cz: job.cz, lodRule: job.lodRule, kind: job.kind });
      } catch (e){ slot.fail(e.message); }
    }
  }
}
