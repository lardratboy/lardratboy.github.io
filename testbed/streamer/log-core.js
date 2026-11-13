/* =====================================================================
   LOG CORE: one log for blocks and drops (docs/onelog-plan.md, step 1).
   Pure: imports dag-core.js, edit-core.js and scene-core.js, no DOM, no gl,
   so it runs in Node, a worker or the page.

   Until now a world had one of two logs: edit-core's createEditLog (blocks)
   or scene-core's createSceneLog (drops), the same design written twice, and
   the runner refused a world with both, since "the latest op wins" needs one
   list ordering them (scene-plan §4 Q3). This is that list. Both old logs
   stay, as the oracles test/one-log.test.js holds this to: a history of
   blocks only must be the block log's op for op, and one of drops only the
   scene log's.

   **The root is the ops applied in order**: a block by edit-core's `place`
   (one path of interns), a drop by `bakeScene` of that one placement onto
   the root so far. So a drop after a break fills the hole it covers, and a
   break after a drop cuts the child. Replay is the ops in order (`replayLog`),
   never "bake every live drop, then the blocks", which is what the scene
   log's twin could do while drops were all there was.

   **The colour rule** (plan §3): a voxel takes the colour of the latest op
   that made it solid. A block colours every voxel of its block, a drop every
   voxel its child is solid in (even where the world was solid already), and
   a break nothing: a voxel solid after a break was filled by a later op. So
   the follower keeps edit-core's block table (places only) and scene-core's
   drop list, both numbered by the op's place in this log, and sceneField
   (given the table) takes the later of the two. Coarse cells keep each
   side's rule: a block over the cell's centre, a drop solid anywhere in the
   cell, the later if both. That's a choice at lod 1 and above, never at 0.

   **What answered the plan's questions** (2026-11-12): one undo stack for
   both kinds (Q4), so `Z` takes back the latest op, and the page opens a box
   only when that op was a drop; both tools only on clay and flat ground (Q1);
   the block tool moves to the free cursor (Q3, the page's business); a
   carved knight's inside is the baked field's mean for now (Q2, nothing here).
   ===================================================================== */
import { EMPTY } from './dag-core.js';
import { place, createBlockTable, BREAK } from './edit-core.js';
import { bakeScene, prepared, importWorld, checkPlacement, paintOf as dropPaint, sceneField } from './scene-core.js';

/* ---- the log ------------------------------------------------------------------
   Eight int32 words an op, so a worker takes them as a buffer and a file can
   write them:

     BLOCK  level, X, Y, Z, colour (r | g << 8 | b << 16, or BREAK), 0, 0
            (createEditLog's five, padded)
     DROP   world, at x, y, z, turn, scale, T (createSceneLog's seven: the
            world's index in this log, and the prepared child's id, which a
            worker can't make since a storeView can't intern)

   **What isn't an op** is what wasn't before: a block that changes no voxel
   (so a block over solid ground, or over a knight, can't recolour it, by the
   2026-11-05 decision), and a drop with no voxel in the world. Either keeps
   the redo steps. A drop into solid rock *is* an op, since it recolours.

   **Paint** (the chunks whose colour may now read differently, for
   stream-core's setRoot): a place paints its block, a break nothing (breaks
   don't colour), a drop its placed bounds in level-6 blocks (scene-core's
   paintOf). Undo and redo paint the same as the op they move past: the table
   loses or regains that block, the list that drop, and nothing else.

   **One parent store a log**, for both kinds: a drop's T and a baked skin
   are ids in it, and every root is. A storeView can't intern, so it's
   refused before anything is asked of it.

   **The epoch**, as both old logs': undo, then a different op (of either
   kind), leaves the same count with a different op on the end, so every undo
   starts a new epoch and a follower seeing one rebuilds from op 0. The trap
   the test sets is the mixed one: undo a drop, then place a block. */
export const LOG_WORDS = 8, BLOCK = 0, DROP = 1;
export function createOneLog(base){
  let cap = 64, ops = new Int32Array(cap * LOG_WORDS), roots = new Uint32Array(cap + 1);
  let n = 0, top = 0, epoch = 0, parent = null;
  roots[0] = base;
  const worlds = [], indexOf = new Map(), paints = [];
  function guard(store){
    if (typeof store.intern !== 'function') throw new Error('one log: the parent\'s store must intern (a storeView can\'t: import its keys into a createStore first)');
    if (parent && store !== parent) throw new Error('one log: one parent store a log (its roots and drops name ids in it)');
  }
  // A world's index, registering it on its first drop, as the scene log does:
  // a baked skin rewritten to its id in the parent's store.
  function register(store, world){
    let i = indexOf.get(world);
    if (i !== undefined) return i;
    let colour = world.colour ?? null;
    if (colour && colour.kind === 'baked'){
      if (world.skin === undefined || colour.skin !== world.skin) throw new Error(`one log: a baked world's colour names skin ${colour.skin}, and the world's skin is ${world.skin}`);
      colour = { ...colour, skin: importWorld(store, world).skin };
    }
    worlds.push({ world, D: world.D, colour });
    indexOf.set(world, i = worlds.length - 1);
    return i;
  }
  function push(store, root, kind, a, b, c, d, e, f, g, paint){
    if (n === cap){
      const o2 = new Int32Array(cap * 2 * LOG_WORDS), r2 = new Uint32Array(cap * 2 + 1);
      o2.set(ops); r2.set(roots); ops = o2; roots = r2; cap *= 2;
    }
    const j = n * LOG_WORDS;
    ops[j] = kind; ops[j + 1] = a; ops[j + 2] = b; ops[j + 3] = c; ops[j + 4] = d; ops[j + 5] = e; ops[j + 6] = f; ops[j + 7] = g;
    paints[n] = paint;
    roots[++n] = root;
    top = n;     // a new op ends the redo branch
    parent = store;
  }
  function block(store, D, { level, X, Y, Z }, colour){
    guard(store);
    const root = roots[n], out = place(store, root, D, level, X, Y, Z, colour === BREAK ? EMPTY : store.solid(level));
    if (out === root) return null;
    const paint = colour === BREAK ? [] : [{ level, X, Y, Z }];
    push(store, out, BLOCK, level, X, Y, Z, colour, 0, 0, paint);
    return { paint };
  }
  // Op i, decoded: what undo hands back, and what the page reads.
  function opAt(i){
    if (!(i >= 0 && i < top)) throw new RangeError(`one log: no op ${i} (${top} on the stack)`);
    const j = i * LOG_WORDS;
    if (ops[j] === BLOCK) return { kind: 'block', level: ops[j + 1], X: ops[j + 2], Y: ops[j + 3], Z: ops[j + 4], colour: ops[j + 5] };
    return { kind: 'drop', world: worlds[ops[j + 1]].world, at: [ops[j + 2], ops[j + 3], ops[j + 4]], turn: ops[j + 5], scale: ops[j + 6] };
  }
  return {
    /* Each returns null if the op changed nothing, or { paint } for setRoot. */
    place(store, D, target, colour){
      if (!Number.isInteger(colour) || colour < 0 || colour > 0xffffff) throw new RangeError(`log.place: colour ${colour} isn't r | g << 8 | b << 16`);
      return block(store, D, target, colour);
    },
    erase: (store, D, target) => block(store, D, target, BREAK),
    /* Drop `p` ({ world, at, turn, scale }) on the current root. */
    drop(store, D, p){
      guard(store);
      checkPlacement(p, D);
      const c = prepared(store, p), paint = dropPaint(store, c.id, c.D, p.at, D);
      if (!paint.length) return null;
      const root = bakeScene(store, roots[n], D, [p]);
      push(store, root, DROP, register(store, p.world), p.at[0], p.at[1], p.at[2], p.turn ?? 0, p.scale ?? 0, c.id, paint);
      return { paint };
    },
    /* Undo and redo hand back the op they moved past too ({ paint, op }), so
       the page can pick a drop up into its box and leave a block undone. */
    undo(){ if (!n) return null; n--; epoch++; return { paint: paints[n], op: opAt(n) }; },
    redo(){ if (n === top) return null; n++; return { paint: paints[n - 1], op: opAt(n - 1) }; },
    get root(){ return roots[n]; }, get count(){ return n; }, get epoch(){ return epoch; },
    get canUndo(){ return n > 0; }, get canRedo(){ return n < top; },
    get worldCount(){ return worlds.length; },
    rootAt: i => roots[i],
    opAt,
    // The latest live op, decoded, or null: what Z would take back.
    last: () => n ? opAt(n - 1) : null,
    // The live drops, as placements, in op order: what snapRef reads.
    placements(){
      const out = [];
      for (let i = 0; i < n; i++) if (ops[i * LOG_WORDS] === DROP){ const { world, at, turn, scale } = opAt(i); out.push({ world, at, turn, scale }); }
      return out;
    },
    // The dropped worlds, by index: replayLog's `worlds`.
    worlds: () => worlds.map(w => w.world),
    /* What a follower that has seen `seen` ops at `seenEpoch`, and the first
       `seenWorlds` worlds, still needs, as a copy it can be posted. All the
       ops if the epoch has moved on; worlds never start over. */
    delta(seenEpoch = -1, seen = 0, seenWorlds = 0){
      const from = seenEpoch === epoch ? seen : 0;
      return { epoch, from, count: n, ops: ops.slice(from * LOG_WORDS, n * LOG_WORDS),
               worldsFrom: seenWorlds, worlds: worlds.slice(seenWorlds).map(w => ({ D: w.D, colour: w.colour })) };
    },
    // All the live ops, not a copy: for replay and for files.
    ops: () => ops.subarray(0, n * LOG_WORDS),
  };
}

/* The root that `count` ops make from `base`, in any store: the ops in order,
   `worlds` the log's (log.worlds()). Equal to the log's root by id in the
   log's own store, by hash-consing, and the same shape anywhere else. */
export function replayLog(store, D, base, ops, worlds, count = ops.length / LOG_WORDS){
  let root = base;
  for (let i = 0; i < count; i++){
    const j = i * LOG_WORDS;
    if (ops[j] === BLOCK){
      const l = ops[j + 1];
      root = place(store, root, D, l, ops[j + 2], ops[j + 3], ops[j + 4], ops[j + 5] === BREAK ? EMPTY : store.solid(l));
    } else if (ops[j] === DROP){
      root = bakeScene(store, root, D, [{ world: worlds[ops[j + 1]], at: [ops[j + 2], ops[j + 3], ops[j + 4]], turn: ops[j + 5], scale: ops[j + 6] }]);
    } else throw new Error(`replayLog: op ${i} is of kind ${ops[j]}`);
  }
  return root;
}

/* ---- the follower: the one log's deltas on the other side ----------------------
   What a chunk worker keeps: a block table of the places and a drop list
   (createSceneTable's, with each world's field built once by `fieldOf(desc,
   D)`), both numbered by op. createBlockTable's and createSceneTable's rules:
   a new epoch starts at op 0 and rebuilds both, a delta has to start where
   this one stopped, and so does its world list. A gap throws, and the pool
   restarts the worker with every tail: a follower quietly missing an op would
   draw a wrong colour until something else repainted the chunk.

   `field(base)` is the base with both over it: sceneField with the table, or
   the base itself while there are no ops, so a world whose every op is
   undone draws its own bytes, and one with drops alone draws exactly what
   the scene table's field does. */
export function createOneTable(store, fieldOf){
  const worlds = [];
  let epoch = 0, seen = 0, list = [], blocks = createBlockTable(), places = 0;
  return {
    sync({ epoch: e, from, count, ops, worldsFrom, worlds: ws }){
      if (worldsFrom !== worlds.length) throw new Error(`one table: this table has ${worlds.length} worlds, the delta starts at ${worldsFrom}`);
      if (e !== epoch){
        if (from !== 0) throw new Error(`one table: a new epoch has to start at op 0, not ${from}`);
        list = []; blocks = createBlockTable(); places = 0; epoch = e;
      } else if (from !== seen) throw new Error(`one table: this table has ${seen} ops, the delta starts at ${from}`);
      for (const w of ws) worlds.push({ D: w.D, colour: w.colour ? fieldOf(w.colour, w.D) : null });
      for (let s = from, j = 0; s < count; s++, j += LOG_WORDS){
        if (ops[j] === BLOCK){
          if (ops[j + 5] !== BREAK){ blocks.add(ops[j + 1], ops[j + 2], ops[j + 3], ops[j + 4], ops[j + 5], s); places++; }
        } else if (ops[j] === DROP){
          const w = worlds[ops[j + 1]];
          if (!w) throw new Error(`one table: op ${s} drops world ${ops[j + 1]}, and there are ${worlds.length}`);
          list.push({ T: ops[j + 7], D: w.D, at: [ops[j + 2], ops[j + 3], ops[j + 4]], turn: ops[j + 5], scale: ops[j + 6], colour: w.colour, seq: s });
        } else throw new Error(`one table: op ${s} is of kind ${ops[j]}`);
      }
      seen = count;
    },
    field: base => sceneField(store, base, list, places ? blocks : null),
    get list(){ return list.slice(); },
    get places(){ return places; },
    get seen(){ return seen; }, get epoch(){ return epoch; }, get worldCount(){ return worlds.length; },
  };
}
