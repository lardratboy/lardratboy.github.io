/* What the one log's colour costs a job (docs/onelog-plan.md §3, step 2;
   docs/onelog-log.md §2): flat ground at D = 10 (clay-core, the world that
   takes both tools), with 64 blocks, 16 drops, or both, made on the ground's
   middle 256² by the page's own path (a pick straight down, the block over or
   under the face it hits; drops of baked stand-ins for the knight,
   test/baked-worlds.js's solidBaked at D = 6, scales −1 to +1, turned).

   Every non-empty chunk meeting the edited region at lods 0–2 runs through
   fastChunk (shadow, meanDepth 1, seams), coloured four ways:

     ground      the clay field alone, on the ground with no edits
     blocks      64 blocks: editedField over a block table (today's road) and
                 the one table's field (log-core), on the same root
     drops       16 drops: the scene table's field (today's road) and the one
                 table's, on the same root
     both        the 64 blocks and 16 drops interleaved in one log: the one
                 table's field (there was no road for it before)

   Each time is the best of five runs. Prints only. It measures job times, so
   run it on an idle machine. */
import { createStore, createCounts } from '../dag-core.js';
import { fastChunk, createJobCache } from '../job-core.js';
import { CHUNK_SIDE } from '../chunk-core.js';
import { buildClay, clayDesc } from '../clay-core.js';
import { colourOf } from '../colours.js';
import { pick, placeTarget, breakTarget, createEditLog, createBlockTable, editedField, PALETTE } from '../edit-core.js';
import { createSceneLog, createSceneTable } from '../scene-core.js';
import { createOneLog, createOneTable } from '../log-core.js';
import { PROPER } from '../scatter-core.js';
import { solidBaked } from '../test/baked-worlds.js';

const D = 10, desc = clayDesc({ D, lump: 0, ground: true }), store = createStore(), { root: ground } = buildClay(desc, store);
const LO = 384, HI = 640, SURFACE = 512;
const b = solidBaked(6, 5), kid = { store: b.store, root: b.root, D: 6, skin: b.skin, colour: { kind: 'baked', skin: b.skin, words: b.words } };

let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
const drops = Array.from({ length: 16 }, (_, i) => {
  const scale = i % 3 - 1, side = 2 ** (6 + scale);
  return { world: kid, at: [LO + Math.floor(rand() * (HI - LO - side)), SURFACE - (side >> 2), LO + Math.floor(rand() * (HI - LO - side))], turn: PROPER[(i * 7) % 24], scale };
});
// A block: a pick straight down at a random point of the region, then the block
// over the face it hits (two in three) or under it (a break).
function blockOn(root){
  const x = LO + rand() * (HI - LO), z = LO + rand() * (HI - LO), level = [0, 0, 1, 1, 2, 3][Math.floor(rand() * 6)];
  const hit = pick(store, root, D, [x, 2 ** D - 1, z], [0, -1, 0]);
  if (!hit) return null;
  return rand() < 2 / 3 ? { t: placeTarget(hit, level, D), colour: PALETTE[Math.floor(rand() * PALETTE.length)] } : { t: breakTarget(hit, level), colour: null };
}
const rgbOf = c => typeof c === 'number' ? c : c[0] | c[1] << 8 | c[2] << 16;

// Three histories in one store: blocks alone, drops alone, both interleaved.
const blockLog = createEditLog(ground), oneBlocks = createOneLog(ground);
for (let n = 0; n < 64;){
  const b = blockOn(blockLog.root);
  if (!b || !b.t) continue;
  const a = b.colour === null ? blockLog.erase(store, D, b.t) : blockLog.place(store, D, b.t, rgbOf(b.colour));
  const c = b.colour === null ? oneBlocks.erase(store, D, b.t) : oneBlocks.place(store, D, b.t, rgbOf(b.colour));
  if (!a !== !c || blockLog.root !== oneBlocks.root) throw new Error('the one log isn\'t the block log');
  if (a) n++;
}
const sceneLog = createSceneLog(ground), oneDrops = createOneLog(ground);
for (const p of drops){ sceneLog.drop(store, D, p); oneDrops.drop(store, D, p); }
if (sceneLog.root !== oneDrops.root) throw new Error('the one log isn\'t the scene log');
const both = createOneLog(ground);
let placed = 0, dropped = 0;
while (placed < 64 || dropped < 16){
  if (dropped < 16 && (placed >= 64 || rand() < 0.2)){ if (both.drop(store, D, drops[dropped])) dropped++; continue; }
  const b = blockOn(both.root);
  if (b && b.t && (b.colour === null ? both.erase(store, D, b.t) : both.place(store, D, b.t, rgbOf(b.colour)))) placed++;
}

const counts = createCounts(store), base = colourOf(desc);
const fieldOf = (d, dD) => colourOf(d, { store, counts, D: dD });
const oneField = log => { const t = createOneTable(store, fieldOf); t.sync(log.delta()); return t.field(base); };
const blockField = () => { const t = createBlockTable(); t.sync(blockLog.delta()); return editedField(base, t); };
const sceneFieldOf = () => { const t = createSceneTable(store, fieldOf); t.sync(sceneLog.delta()); return t.field(base); };

function chunksOf(root, lod){
  const side = CHUNK_SIDE * 2 ** lod, out = [];
  const a = Math.floor(LO / side), z1 = Math.ceil(HI / side), y0 = Math.floor((SURFACE - 128) / side), y1 = Math.ceil((SURFACE + 192) / side);
  for (let cz = a; cz < z1; cz++) for (let cy = y0; cy < y1; cy++) for (let cx = a; cx < z1; cx++){
    const c = fastChunk(store, root, D, { lod, cx, cy, cz }, { counts, lodRule: 'shadow', seams: true });
    if (c.count) out.push({ lod, cx, cy, cz });
  }
  return out;
}
function time(root, chunks, colour){
  let best = Infinity, words = 0;
  for (let k = 0; k < 6; k++){
    const cache = createJobCache(), t = performance.now();
    words = 0;
    for (const c of chunks) words += fastChunk(store, root, D, c, { counts, lodRule: 'shadow', colour, meanDepth: 1, seams: true, cache }).attrs.length;
    if (k) best = Math.min(best, performance.now() - t);    // the first run warms
  }
  return { ms: best, words };
}
const f = x => x.ms.toFixed(1).padStart(7);
console.log(`flat ground, D = ${D}: 64 blocks (${blockLog.count} ops), 16 drops (${sceneLog.count}), both (${both.count}); ${store.maxId} nodes`);
console.log('lod  chunks   ground |   blocks: old    one  |    drops: old    one  |  both: one   words');
for (const lod of [0, 1, 2]){
  const cs = chunksOf(both.root, lod);
  const g = time(ground, cs, base);
  const bo = time(blockLog.root, cs, blockField()), bn = time(blockLog.root, cs, oneField(oneBlocks));
  const so = time(sceneLog.root, cs, sceneFieldOf()), sn = time(sceneLog.root, cs, oneField(oneDrops));
  const bb = time(both.root, cs, oneField(both));
  console.log(`${lod}    ${String(cs.length).padStart(5)}  ${f(g)} | ${f(bo)} ${f(bn)} (×${(bn.ms / bo.ms).toFixed(2)}) | ${f(so)} ${f(sn)} (×${(sn.ms / so.ms).toFixed(2)}) | ${f(bb)}  ${bb.words}`);
}
