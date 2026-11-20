/* ENDLESS BUILD: the threads under the endless lattice's worlds (docs/universe-plan.md
   step 5). A few long-lived module workers (world-worker.js), each building one
   world at a time; the page hands it, every frame the window changes, the tiles it
   wants that it hasn't got, nearest first (universe-core's endlessWindow `want`),
   and it keeps a queue of exactly those, so a tile the eye has left is never started.
   A build already started finishes, and the page keeps it (it may be wanted again).
   Every decision is the page's or universe-core's; this file only moves messages.

   Without workers (?workers=0, or none will start in 10 s) it builds on the page's
   thread, one world a task, so a frame waits for one world at most (the scatter's
   0.9 s is the worst; the rest are under 0.1 s). A build that fails is reported once
   and not asked again by the page. */
import { buildTile } from './tile-worlds.js';

export class TileBuilder {
  constructor({ workers = 2, onBuilt = () => {}, onFailed = () => {} } = {}){
    this.onBuilt = onBuilt; this.onFailed = onFailed;
    this.queue = []; this.flying = new Map(); this.serial = 0; this.built = 0;
    this.slots = []; this.mode = workers ? 'starting workers' : 'main thread';
    for (let n = 0; n < workers; n++) this._start();
    if (workers) this.timer = setTimeout(() => { if (!this.slots.some(s => s.ready)) this._fallBack('no world worker started in 10 s'); }, 10000);
  }
  _start(){
    const slot = { worker: null, ready: false, tile: null, id: 0 };
    try {
      const w = slot.worker = new Worker(new URL('./world-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = ({ data }) => {
        if (data.ready){ slot.ready = true; this.mode = 'workers'; this._dispatch(); return; }
        if (data.id !== slot.id || !slot.tile) return;
        const tile = slot.tile; slot.tile = null; this.flying.delete(tile.world);
        if (data.error) this.onFailed(tile, data.error); else { this.built++; this.onBuilt(tile, data); }
        this._dispatch();
      };
      w.onerror = e => { e.preventDefault(); this._lose(slot, e.message || 'world worker error'); };
    } catch (e){ this._fallBack(e.message); return; }
    this.slots.push(slot);
  }
  _lose(slot, why){
    if (slot.tile){ this.flying.delete(slot.tile.world); this.onFailed(slot.tile, why); slot.tile = null; }
    slot.worker.terminate(); this.slots = this.slots.filter(s => s !== slot);
    if (!this.slots.length) this._fallBack(why);
  }
  _fallBack(why){
    if (this.mode === 'main thread') return;
    console.warn('endless build: on the main thread:', why);
    for (const s of this.slots) s.worker.terminate();
    this.slots = []; this.mode = 'main thread';
    this._dispatch();
  }
  /* The tiles wanted, nearest first, and `has(key)`: what the page holds. The
     queue becomes the wanted tiles neither held nor building. */
  want(tiles, has){
    this.queue = tiles.filter(t => !has(t.world) && !this.flying.has(t.world));
    this._dispatch();
  }
  get busy(){ return this.flying.size; }
  _dispatch(){
    if (this.mode === 'main thread'){
      if (this.flying.size || !this.queue.length) return;
      const tile = this.queue.shift();
      this.flying.set(tile.world, tile);
      setTimeout(() => {
        this.flying.delete(tile.world);
        try {
          const w = buildTile(tile), { keys } = w.store.snapshot();
          this.built++;
          this.onBuilt(tile, { keys, root: w.root, D: w.D, ground: w.ground, colour: w.colour, label: w.label, ms: w.ms, nodes: w.store.size });
        } catch (e){ this.onFailed(tile, e.message); }
        this._dispatch();
      }, 0);
      return;
    }
    for (const slot of this.slots){
      if (!slot.ready || slot.tile || !this.queue.length) continue;
      const tile = this.queue.shift();
      slot.tile = tile; slot.id = ++this.serial;
      this.flying.set(tile.world, tile);
      slot.worker.postMessage({ id: slot.id, tile });
    }
  }
}
