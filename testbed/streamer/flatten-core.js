/* =====================================================================
   FLATTEN CORE: an edited world as a plain baked world (docs/open-questions.md
   §1, road 2, chosen 2026-11-27; docs/save-edits-log.md).

   The question, asked four times, was how to save a world with edits. Three
   roads were costed: the op log as a section (the file is the session, undo
   included), flattened (the shape and a word a skin voxel), or a colour DAG
   overlay. The answers:

     - road 2: "a saved world opening as a plain file anywhere, and
       accepting the depth limit for things that can't be reasonably saved";
     - no undo across a save: "bake/prune for efficiency on save";
     - no referenced children, no ACTR, no ARGS for now.

   So a save forgets how the world was made. What it keeps is what the world
   draws at lod 0: the edited root's shape (NODE), and its colours as a baked
   field (ATTR), one word for every voxel that can show, sampled from the
   field the chunk workers draw (the base's named field under the one log's
   blocks and drops, log-core's createOneTable). Export/, explore/, destroy/
   and the stream viewer open it as they open an imported asset.

   **The steps.** Pure, and a generator, so the page can run it a few
   milliseconds a frame as it bakes a large drop (log-core's dropSteps):

     prune   the edited root's nodes, copied into a fresh store (dag-core's
             prune, then importKeys). The session's store keeps every node
             any edit ever made, undone ones included; the file needs only
             the root's. A fresh store also keeps the skin's nodes out of
             the live one, whose tails would ship them to every worker. At
             the end the keys are pruned once more, to the root and the skin.
     skin    dag-core's surfaceOf: the solid voxels with an empty face
             neighbour, outside the world counting as empty. Exactly the
             voxels that get a lod-0 record.
     refuse  a skin of more than `max` voxels (FLAT_MAX). The words are a
             Uint32Array the reader holds and every chunk worker gets a copy
             of, so this is the depth limit the answer accepted, and it is a
             limit on the skin, not on D: the D = 20 clay's 256 ball is a
             170,000-voxel skin, D = 20 flat ground's top alone is 2^40.
     words   the skin walked in Morton order (octant o = bit 0 x, bit 1 y,
             bit 2 z: rank order, baked-core's), each voxel's word what
             cellAttr asks at lod 0: the field at the voxel's centre at
             level 0, & 0xffffff, or, for a field with `mean` (a world
             saved before, edited again: docs/edit-saved-plan.md §6), its
             mean(0) quantized as the job does (to6) and widened back to
             eight bits as a six-bit file is read. Walked a level-BLOCK
             subtree at a time, with a step between.

   **Why the mean road takes a word of its own.** The point road rounds to
   eight bits (rgb8) and the job then quantizes to six; a field with `mean`
   is quantized once, unrounded. For a skin word or a block they agree (both
   integers), but a voxel a break exposed takes baked-core's fallback, a
   mean of many words, and to6(2.4) is 1 where to6(round(2.4)) is 0. So the
   word is the six-bit value the session drew, held as round(q · 255 / 63),
   which vdag-core's six-bit writer narrows back to q and its reader widens
   to the same: the reopened world draws the session's lod 0 again. It costs
   nothing, the file holding six bits anyway (FLAT_BITS).

   **What it holds.** At lod 0 every voxel that shows draws the word it drew
   in the session, so a lod-0 frame of the file is the session's, byte for
   byte (test/flatten-core.test.js runs expandChunk over both). Coarse lods
   differ: a baked field's coarse cell is the mean of the skin under it,
   where the session's named field averaged its own samples (chunk-core's
   meanUnder). So does a cell no skin voxel is under, the seam tail of a
   chunk whose neighbour isn't drawn: baked-core's fallback, the mean of the
   nearest enclosing cell with skin.

   **Saved again.** A saved world opens as a baked file, and a baked file
   takes blocks and drops (docs/edit-saved-plan.md, built 2026-11-27): the
   session's field is then sceneField over the baked base, which keeps a
   `mean`, and this flattens it as it does any other. Edit, save, open,
   edit, save: each file has its own skin and words, and coarse lods start
   fresh from the new skin. No undo crosses a save.
   ===================================================================== */
import { createStore, createCounts, prune, surfaceOf, EMPTY } from './dag-core.js';
import { to6 } from './attr-core.js';

/* 2^26 words, 256 MiB as a Uint32Array. The glTF assets at D = 12 were 130–230
   MB of words, shipped to the workers and drawn (glb-colour-log §1), so a
   saved world may be as large as the largest asset already opened. Measured
   skins (2026-11-27, docs/save-edits-log.md §2): the kit at D = 10 is 31.8M,
   clay at D = 12 with ground 34.7M, the city at D = 11 35.4M (all in); the
   kit at D = 12 885M and the city at D = 13 671M (out). */
export const FLAT_MAX = 2 ** 26;
/* Six bits a channel, as mesh-vdag and destroy/ write: every lod-0 word the job
   draws is the one eight bits give (vdag-core's ATTR note), and the words are
   40–67% smaller. */
export const FLAT_BITS = 6;
const BLOCK = 6;

/* flattenSteps(store, root, D, field, opts) yields { phase, done, total } between
   steps and returns { keys, root, skin, D, words, voxels, skinVoxels, nodes }:
   `keys` a snapshot of a fresh store holding the root and the skin, both ids
   in it. `field(x, y, z, level)` is the world's colour field as the workers
   build it, with its `mean` if it has one. Throws, before any word, when the skin is over `max`. */
export function* flattenSteps(store, root, D, field, { max = FLAT_MAX } = {}){
  if (typeof field !== 'function') throw new Error('flatten: needs the world\'s colour field (a colourless world has nothing to bake)');
  yield { phase: 'prune', done: 0, total: 1 };
  const { keys, map } = prune(store.snapshot().keys, [root]);
  const flat = createStore(), ids = flat.importKeys(keys), r = root === EMPTY ? EMPTY : ids[map[root]];
  yield { phase: 'skin', done: 0, total: 1 };
  const skin = surfaceOf(flat, r, D), counts = createCounts(flat);
  const skinVoxels = skin === EMPTY ? 0 : counts.of(skin);
  if (skinVoxels > max) throw new Error(`this world can't be saved: ${big(skinVoxels)} voxels can show, and a saved world holds a colour for each, up to ${big(max)}`);
  const words = new Uint32Array(skinVoxels);
  // The level-BLOCK subtrees of the skin with anything in, in Morton order.
  const B = Math.min(BLOCK, D), blocks = [];
  const gather = (id, level, x, y, z) => {
    if (id === EMPTY) return;
    if (level === B){ blocks.push(id, x, y, z); return; }
    for (let o = 0; o < 8; o++) gather(flat.child(id, o), level - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
  };
  gather(skin, D, 0, 0, 0);
  let n = 0;
  // The six-bit value the job draws, widened as vdag-core's reader widens it (WIDEN6).
  const mean = field.mean, acc = new Float64Array(3), wide = v => Math.round(to6(v) * 255 / 63);
  const wordAt = mean ? (x, y, z) => (mean(0, x, y, z, acc), wide(acc[0]) | wide(acc[1]) << 8 | wide(acc[2]) << 16)
                      : (x, y, z) => field(x + 0.5, y + 0.5, z + 0.5, 0) & 0xffffff;
  const walk = (id, level, x, y, z) => {
    if (id === EMPTY) return;
    if (level === 0){ words[n++] = wordAt(x, y, z); return; }
    for (let o = 0; o < 8; o++) walk(flat.child(id, o), level - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2));
  };
  for (let i = 0; i < blocks.length; i += 4){
    yield { phase: 'words', done: n, total: skinVoxels };
    walk(blocks[i], B, blocks[i + 1], blocks[i + 2], blocks[i + 3]);
  }
  if (n !== skinVoxels) throw new Error(`flatten: ${n} words for ${skinVoxels} skin voxels`);
  // Once more, to the root and the skin: surfaceOf's buried test interns the
  // solid node of each level, which the world may not hold.
  const out = prune(flat.snapshot().keys, [r, skin]);
  return { keys: out.keys, root: out.map[r], skin: out.map[skin], D, words, voxels: r === EMPTY ? 0 : counts.of(r), skinVoxels, nodes: out.keys.length / 9 };
}
const big = n => n >= 1e9 ? `${(n / 1e9).toPrecision(3)} billion` : n >= 1e6 ? `${(n / 1e6).toPrecision(3)} million` : n.toLocaleString('en-US');

// The steps run straight through.
export function flatten(store, root, D, field, opts){
  const steps = flattenSteps(store, root, D, field, opts);
  for (;;){ const s = steps.next(); if (s.done) return s.value; }
}

/* writeVdag's world (vdag-core) for a flattened one: { keys, root, D, name,
   colour, view, source }, the colour baked at FLAT_BITS. */
export const flatWorld = (f, { name = '', view = null, source = null, bits = FLAT_BITS } = {}) =>
  ({ keys: f.keys, root: f.root, D: f.D, name, view, source, colour: { kind: 'baked', skin: f.skin, words: f.words, bits } });

