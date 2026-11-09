/* ================== BAKED CORE (pure) ================================
   A baked colour field: an imported asset's own colours, one word per skin
   voxel, read as a colour field (docs/glb-colour-plan.md step 2).

   What it reads, all made by experiments/mesh-vdag.mjs (step 1, mesh-asset's
   skinOf and bakeSkin):
     - the skin, a bit DAG of the voxels that get a word: every voxel that
       can show, in conservative mode (glb-colour-log §1). It lives in a
       dag-core store or a storeView, beside the shape or as the shape
       itself (--hollow), so nothing here assumes two different roots;
     - the words, rgb8 (r | g << 8 | b << 16, attr-core's field format), one
       per skin voxel in rank order: a voxel's rank is its place in the
       skin's Morton order, octant o = bit 0 x, bit 1 y, bit 2 z, which is
       store.child's order and the order a depth-first walk visits them.
       The high byte is kept for a material (E4) and ignored here.

   Two questions, answered exactly:

   field(x, y, z)    a voxel's word, at the voxel holding (x, y, z): the
                     arguments are floored, because cellAttr asks lod 0 at
                     the voxel's centre (x + 0.5, …). A walk down the skin
                     adds the counts of the octants it passes, which is the
                     voxel's rank, and the word is words[rank].
   field.mean(level, x, y, z, out)
                     the mean of the skin's words under the level-`level`
                     cell holding (x, y, z), as three 8-bit channels in
                     floats, written to `out` and returned. Not quantized:
                     the job quantizes once (attrs-plan decision 6). A cell
                     is one skin subtree, so its skin is one rank range
                     [r, r + n), and the mean is that range's sum over n.
                     At level 0 it is the word itself, so a job that asks
                     `mean` at every lod gives the same words as `field` at
                     lod 0 (step 3).

   The range sum. Prefix sums at every word would be 24 bytes a word (53 MB
   for the pack's 2.2M skin voxels at D = 10). So this keeps a running sum
   every BLOCK = 64 words (three float64 a block, 0.4 bytes a word: 0.84 MB
   for the pack at D = 10), and scans at most 63 words at each end of a
   range, 126 a mean. Every sum is of integers below 2^53 (255 · 2^32 for the
   largest Uint32Array), so it is exact, and a mean is one division of exact
   integers: the same float a dense brute force gets, which is how the test
   holds it, with ===.

   A cell with no skin. At lod 0 every voxel that can show is in the skin, so
   a shown voxel always has its word. But two kinds of cell get asked and
   have none:
     - the seam tail at any lod: cells the apron alone buried, drawn only
       when a side is open (chunk-core's expandChunk). At lod 0 those are
       inside voxels, and inside voxels aren't in the skin;
     - a coarse cell under a rule that drops cells (adaptive, the decided
       rule): a dropped neighbour counts as empty, so a cell of solid inside
       can show a face.
   Such a cell takes the mean of the **smallest enclosing cell that has
   skin**, climbing at most `climb` levels (CHUNK_LEVELS, 6, by default). A
   level-l cell's level-(l + 6) ancestor is its chunk at lod l (chunks are
   64 cells a side and aligned), so the fallback reads only inside the
   cell's own chunk, which is stream-core §2c's stamp rule: a word reads
   only inside its own chunk's box. If the whole chunk has no skin (a chunk
   of solid inside), the word is the mean of the whole skin, a constant of
   the world, which reads no neighbour. An empty skin gives black.
   `stats` counts each kind, so step 6 can say how often they happen.

   No DOM, no gl: dag-core for the ids and chunk-core for CHUNK_LEVELS, so a
   chunk worker loads it as is. Built in O(words) (the block sums); a lookup
   is up to D steps of up to 7 count reads, and far fewer when it follows a
   lookup nearby (the path memo, in descend).
   ===================================================================== */
import { EMPTY, createCounts } from './dag-core.js';
import { CHUNK_LEVELS } from './chunk-core.js';

export const BLOCK = 64;

/* opts   counts  createCounts(store) to share with the job (the skin's nodes
                  usually sit in the shape's store); one is made if absent
          climb   how many levels a cell with no skin climbs for a mean
                  (default CHUNK_LEVELS: never past its own chunk) */
export function createBaked(store, skin, D, words, opts = {}){
  if (!Number.isInteger(D) || D < 0 || D > 30) throw new Error(`createBaked: D = ${D} (0 to 30: coordinates are int32)`);
  if (!(words instanceof Uint32Array)) throw new Error('createBaked: words must be a Uint32Array');
  if (skin !== EMPTY && store.levelOf(skin) !== D) throw new Error(`createBaked: the skin's root is level ${store.levelOf(skin)}, not ${D}`);
  const counts = opts.counts || createCounts(store), climb = opts.climb ?? CHUNK_LEVELS;
  const of = id => id === EMPTY ? 0 : counts.of(id);
  const N = of(skin);
  if (N !== words.length) throw new Error(`createBaked: ${words.length} words for ${N} skin voxels`);

  // Block sums: S[3k + c] is channel c summed over words [0, 64k).
  const nb = Math.floor(N / BLOCK);
  const S = new Float64Array(3 * (nb + 1));
  let r = 0, g = 0, b = 0;
  for (let k = 0, i = 0; k <= nb; k++){
    S[3 * k] = r; S[3 * k + 1] = g; S[3 * k + 2] = b;
    if (k === nb) break;
    for (const end = i + BLOCK; i < end; i++){ const w = words[i]; r += w & 255; g += w >> 8 & 255; b += w >> 16 & 255; }
  }
  // steps: the children the walks have read, the empty one a walk stops at
  // included. Without the memo a lookup of a skin voxel reads D of them.
  const stats = { lookups: 0, means: 0, scanned: 0, maxScan: 0, climbed: 0, world: 0, steps: 0 };
  const whole = new Float64Array(3);
  if (N){ sumRange(0, N, whole); whole[0] /= N; whole[1] /= N; whole[2] /= N; stats.scanned = stats.maxScan = 0; }

  // Adds channel sums of words [a, b) to out; at most 2·(BLOCK − 1) words read.
  function sumRange(a, b, out){
    let s = 0;
    const scan = (i, j) => {
      for (; i < j; i++){ const w = words[i]; out[0] += w & 255; out[1] += w >> 8 & 255; out[2] += w >> 16 & 255; s++; }
    };
    const A = Math.ceil(a / BLOCK), B = Math.floor(b / BLOCK);
    if (A >= B) scan(a, b);
    else {
      scan(a, A * BLOCK); scan(B * BLOCK, b);
      out[0] += S[3 * B] - S[3 * A]; out[1] += S[3 * B + 1] - S[3 * A + 1]; out[2] += S[3 * B + 2] - S[3 * A + 2];
    }
    stats.scanned += s; if (s > stats.maxScan) stats.maxScan = s;
  }

  /* The walk: from the root down to `level` at cell (X, Y, Z) of that level,
     adding the counts of the octants before the one taken. Leaves the
     deepest non-empty node on the path and its first rank in `at`.

     The path memo (glb-colour-log §3, reading 2). A lod-0 word was a walk of
     all D levels, up to 7 count reads a level, and that walk was 1.7–3.4× a
     lod-0 job without colour. But a job asks its cells close together (a
     chunk's records share every level above the chunk, and neighbours in
     Morton order share most of the rest), so each walk now starts where the
     last one can be trusted. pathId[k] and pathStart[k] are the level-k
     node on the last walk's path and its first rank, kept for every k from
     D down to lastK, where that walk stopped. The level-k node holding a
     point depends only on the point's bits k and up, so it is shared with
     the last point exactly when no bit k or above differs: the walk starts
     at the lowest such k, h + 1 for the highest differing bit h, which is
     32 − clz32 of the coordinates' xor, and never below lastK.

     Coordinates are compared as voxels (X << level), since queries mix
     levels: a coarse cell after a voxel shares the levels at and above its
     own. Bits at D and above are clamped away, as the walk never reads
     them. A walk that starts below `level` (the new cell's node is on the
     path already) starts at `level` instead, and forgets what's below. */
  const at = { id: EMPTY, level: 0, start: 0 };
  const pathId = new Int32Array(D + 1), pathStart = new Float64Array(D + 1);
  pathId[D] = skin;
  let lastK = D, lx = 0, ly = 0, lz = 0;
  function descend(level, X, Y, Z){
    if (skin === EMPTY){ at.id = EMPTY; at.level = D; at.start = 0; return false; }
    const x = X << level, y = Y << level, z = Z << level;
    let k = 32 - Math.clz32((x ^ lx) | (y ^ ly) | (z ^ lz));
    if (k > D) k = D;
    if (k < lastK) k = lastK;
    if (k < level) k = level;
    let id = pathId[k], start = pathStart[k];
    const k0 = k;
    for (; k > level; k--){
      const s = k - 1, o = (x >> s & 1) | (y >> s & 1) << 1 | (z >> s & 1) << 2;
      const c = store.child(id, o);
      if (c === EMPTY) break;
      for (let j = 0; j < o; j++) start += of(store.child(id, j));
      id = c; pathId[s] = c; pathStart[s] = start;
    }
    stats.steps += k0 - k + (k > level ? 1 : 0);
    lastK = k; lx = x; ly = y; lz = z;
    at.id = id; at.level = k; at.start = start;
    return k === level && id !== EMPTY;
  }

  /* The mean of the cell `descend` stopped in, or the fallback: its deepest
     non-empty ancestor within `climb` levels, else the whole skin. */
  function meanAt(level, out){
    out[0] = out[1] = out[2] = 0;
    if (at.id === EMPTY || at.level > level + climb){
      stats.world++;
      out[0] = whole[0]; out[1] = whole[1]; out[2] = whole[2];
      return out;
    }
    if (at.level > level) stats.climbed++;
    const n = of(at.id);
    sumRange(at.start, at.start + n, out);
    out[0] /= n; out[1] /= n; out[2] /= n;
    return out;
  }

  const tmp = new Float64Array(3);
  const pack = c => Math.round(c[0]) | Math.round(c[1]) << 8 | Math.round(c[2]) << 16;
  function field(x, y, z){
    stats.lookups++;
    if (descend(0, Math.floor(x), Math.floor(y), Math.floor(z))) return words[at.start] & 0xffffff;
    return pack(meanAt(0, tmp));
  }
  field.mean = (level, x, y, z, out = new Float64Array(3)) => {
    stats.means++;
    descend(level, Math.floor(x) >> level, Math.floor(y) >> level, Math.floor(z) >> level);
    return meanAt(level, out);
  };
  // A voxel's rank, or −1 when it isn't in the skin.
  field.rank = (x, y, z) => descend(0, x, y, z) ? at.start : -1;
  // The rank range [start, start + n) of the level cell (X, Y, Z), or null
  // when it has no skin.
  field.range = (level, X, Y, Z) => descend(level, X, Y, Z) ? [at.start, of(at.id)] : null;
  field.sumRange = sumRange;
  field.stats = stats;
  field.voxels = N;
  field.whole = whole;
  field.bytes = S.byteLength;
  return field;
}
