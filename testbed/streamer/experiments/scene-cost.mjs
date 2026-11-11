/* What the scene field costs a job (docs/scene-log.md §2.2): the D = 10 kit
   with 1 and 16 baked stand-ins for the knight (test/baked-worlds.js's
   solidBaked, D = 6, scales −1 to +1, turned) dropped near the middle.
   Every chunk of the world's cut at lods 0–2 through fastChunk (shadow,
   meanDepth 1), coloured by the kit's field alone and by the scene field.
   Whole-world totals: the chunks a placement touches cost more than this,
   far ones less. ~1.5 min. It measures job times, so run it on an idle
   machine. Prints only. */
import { createStore, createCounts, prune } from '../dag-core.js';
import { fastChunk, createJobCache } from '../job-core.js';
import { expandWorld } from '../chunk-core.js';
import { createBaked } from '../baked-core.js';
import { kitDesc, buildKit } from '../kit-core.js';
import { PROPER } from '../scatter-core.js';
import { colourOf } from '../colours.js';
import { bakeScene, prepared, importWorld, sceneField } from '../scene-core.js';
import { solidBaked } from '../test/baked-worlds.js';

const D = 10, desc = kitDesc({ D }), kit = buildKit(desc);
const store = createStore(), kitRoot = store.importKeys(prune(kit.store.snapshot().keys, [kit.root]).keys)[kit.root];
const b = solidBaked(6, 5), world = { store: b.store, root: b.root, D: 6, skin: b.skin };
for (const n of [1, 16]){
  const s = createStore(), r0 = s.importKeys(prune(kit.store.snapshot().keys, [kit.root]).keys)[kit.root];
  const ps = Array.from({ length: n }, (_, i) => ({ world, at: [300 + 97 * (i % 4), 40 + (i >> 3) * 70, 300 + 89 * (i >> 2 & 1) + 13 * i], turn: PROPER[i % 24], scale: i % 3 - 1 }));
  const t0 = performance.now(), root = bakeScene(s, r0, D, ps), tb = performance.now() - t0;
  const counts = createCounts(s), base = colourOf(desc);
  const list = () => ps.map(p => ({ T: prepared(s, p).id, D: 6, at: p.at, turn: p.turn, scale: p.scale, colour: createBaked(s, importWorld(s, world).skin, 6, b.words, { counts }) }));
  for (const lod of [0, 1, 2]){
    const chunks = expandWorld(s, root, D, lod, { lodRule: 'shadow', counts }).map(c => { const side = 64 * c.cellSize; return { lod, cx: c.origin[0] / side, cy: c.origin[1] / side, cz: c.origin[2] / side }; });
    const time = colour => { const cache = createJobCache(); const t = performance.now(); let w = 0; for (const c of chunks) w += fastChunk(s, root, D, c, { counts, lodRule: 'shadow', colour, meanDepth: 1, seams: true, cache }).attrs.length; return [performance.now() - t, w]; };
    time(base); // warm
    const [a, wa] = time(base), [c, wc] = time(sceneField(s, base, list()));
    console.log(`${n} placements (bake ${tb.toFixed(0)} ms), lod ${lod}: ${chunks.length} chunks, ${wa} words; kit field ${a.toFixed(0)} ms, scene field ${c.toFixed(0)} ms (×${(c / a).toFixed(2)})`);
  }
}
