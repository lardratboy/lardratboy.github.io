# animation/: the vdag explainer film

A 4 min 51 s animated walk through the engine, from voxels to pixels, in 18
chapters, the last five on colour. It's a single page with no build step and no dependencies, like
the rest of the repo. Serve the repo root and open the page:

    npm run serve        # then http://localhost:8000/animation/

It has to be served from the repo root, because it imports `../dag-core.js`,
`../chunk-core.js`, `../stream-core.js` and `../attr-core.js` unchanged.
Those imports are what make it more than a drawing: **every number on
screen is computed live by the cores**. If the town or the world changed,
the film's numbers would change with them.

## Controls

space plays and pauses, ← → step through chapters, shift + ← → seek ±5 s,
1–9 jump to a chapter, f is full screen, h hides everything but the picture,
and c opens the chapter list. Drag to look around and use the wheel to
zoom; the camera eases back to its path after 2.5 s. The link takes
`?t=<seconds>`, `?c=<chapter key or number>` and `?paused`.

## The chapters

| # | key | what it shows | where the numbers come from |
|---|-----|---------------|-----------------------------|
| 1 | intro | the town assembling | `census(...).svo[0]`: 5,606 voxels |
| 2 | octree | the cube split into octants, level by level; Morton octant numbers; empty octants | the town's tree (`townTree`), the census per level |
| 3 | tree | the octree laid out as a cone tree, coloured by DAG slot | 1 · 6 · 22 · 168 · 1,034 tree nodes, distinct per level |
| 4 | hashcons | duplicate subtrees fly together, bottom up; FULL; one real key | 1,231 → 109 nodes; the house's key read from `store.child` |
| 5 | symmetry | four house facings turned back into one class; all 48 elements of Oh | `createClasses(store, OH48)`: class 21, 109 nodes → 31 classes |
| 6 | worlds | 64 × 64 turned towns, far ones at coarser lods | `census` of the D = 11 world: 728 nodes, 22,962,176 voxels |
| 7 | cut | a flight over the world with the real cut | `selectChunks(createWorld(...), eye, { detail: 1 })` every frame, `expandChunk` per chunk |
| 8 | job | one chunk job: buried cells culled, one record decoded bit by bit | `expandChunk` on the town (`cells: true`): 5,606 → 3,932 records, 15,728 bytes |
| 9 | lod | the town at lods 0–3 under the shadow rule | `expandChunk({ lod, lodRule: 'shadow' })`: 3,932 · 756 · 137 · 22 |
| 10 | stream | the cut → four workers → GPU cache, LRU, the cover | **illustrative**: a fixed schedule, not createStreamer |
| 11 | raster | records stamped in Morton order along the Z-curve | the town's records in walk order |
| 12 | rays | the page's brick atlas; rays marching bricks then cells; an image filling | atlas: 22 bricks → 9 (the DAG's level-3 count); **the march is a CPU sketch of the idea**, not ray-core's `traceCPU` |
| 13 | colour | the attribute word; a coarse cell's mean; pond and lawn share id 102 | the record's real word from `cellAttr`; `D.blocks` ids |
| 14 | pyramid | the town at lods 0–5, every non-empty node a cell; the flag's ancestors, their counts and words | `expandChunk({ lodRule: 'any', meanDepth: lod })`, exact means; `cellAttr` per ancestor: 1 → 2 → 12 → 131 → 259 → 5,606 voxels |
| 15 | walk | one lod-2 cell as `cellAttr` walks it at meanDepth 1: children, counts, sample points (5 of 8 in air), against the exact mean | the town's worst cell for that error, chosen by `cellAttr` at both depths |
| 16 | baked | the skin; its words in Morton rank order on a wall of 64-word rows; the flag's rank walked level by level | `createBaked` over the town's skin (3,932 words); rank 3,747 + 96 + 28 + 7 + 1 = 3,879, equal to `baked.rank` |
| 17 | range | a house brick's skin is one run of words; block sums for whole rows, scans at the ends; the mean lands on the brick | `baked.range` → [248, 489); `baked.mean(3, …)`: 2 block-sum reads + 8 + 41 scanned |
| 18 | finale | a low flight through the world, with the cut live | as chapter 7 |

## Files

- `index.html`: the shell (canvases, caption, controls, chapter menu) and its CSS.
- `main.js`: the timeline. One clock; each frame is drawn from it, so
  seeking is exact. It makes the world chapters' chunk jobs ahead of time,
  7 ms a frame from the start, so they're ready before chapter 7.
  `window.__anim` is there for the console and the screenshot script.
- `scenes.js`: the 14 chapters. Each is `{ cam(t), env(t), steps, draw(c) }`,
  a pure function of the chapter's own time.
- `gl.js`: the renderer, raw WebGL2. Instanced cubes with a voxel-edge
  shader, static batches with a model matrix, **face batches** for world
  chunks (one instance per shown face, chunk-local, placed by a uniform
  origin and cell size, the way the viewer places records), screen-space
  capsule lines, and a background with an analytic floor grid. A batch that
  fades is dithered, so a whole town can fade without sorting its insides.
- `ui.js`: the 2D overlay: labels pinned to 3D points, panels, bit diagrams.
- `data.js`: **pure** (Node imports it). It builds the town, the world, the
  tree layout and the jobs with the cores.
- `check.mjs`: `node animation/check.mjs` prints every number the film uses
  and holds the data to its own checks. The town's DAG must expand back to
  its grid, the tree's counts must equal the census's, and the world's
  turns, read back, must agree with the world's DAG on whole towns. It
  exits 1 on a failure.
- `shots.mjs`: `node animation/shots.mjs [outdir] [seconds...]` screenshots
  the film in headless Chrome on this machine's GPU (the repo's
  `test/browser/harness.js`) and prints any console error. With no times
  given, it takes two shots a chapter.

## The two worlds

**The town** (D = 5, 32³) is 22 blocks of 8³ on a 4 × 4 grid: houses facing
four ways, towers one to three blocks high, trees, a pond and a lawn.
Ground is three voxels deep, so the job chapter has buried cells to cull.
The house has a chimney so that it's chiral, which keeps its four facings
four distinct nodes. Then the symmetry chapter has something to merge.

**The world** (D = 11, 2048³) is 64 × 64 towns, each turned by one of the
four quarter turns about y (scene-core's `Y_TURNS` = [0, 41, 5, 44]),
chosen by a hash. It's built bottom up from the town's four turned copies
(`store.transform`), and hash-consing does the rest: 619 nodes for 4,096
towns.

## The colour chapters

These were added after the first cut. They follow colour down the hierarchy,
the same road `docs/colorfields-explainer.md` covers as 2D slices, here in
3D on the town. Their data is `buildColour` in `data.js`, and `check.mjs`
holds it to dense sums of its own:

- every lineage word is the 6-bit word of the dense mean of the voxels in its
  cell, and every lineage count is that cell's voxel count;
- the traced rank equals `baked.rank`, and the skin voxel at that rank in
  Morton order is the flag;
- the range's mean equals its words summed one by one (`===` on the floats),
  and the words `createBaked` scanned are exactly the head plus the tail.

The town's skin is every voxel its lod-0 job shows, so it has no cell
without skin at levels 1–3. The climb fallback (a skinless cell takes its
nearest ancestor's mean, within its chunk) is in the caption only. The
colour fields explainer has a `climb` slider that shows it.

The walk chapter's cost figure (meanDepth 2 makes a lod-2 job 16–18× its
uncoloured time) comes from `docs/colorfields-explainer.md` ("Numbers it
surfaced"). It was not measured here.

## Things learned while making it

- **A colour field must be defined off its voxels.** A coarse mean samples
  sub-cell centres, and some of them are air (`cellAttr` → `meanUnder`;
  shapes.mjs says the same). The first version answered 0 there, which
  turned lod-3 towers black. Now every empty voxel takes its nearest full
  voxel's colour, by a breadth-first flood (`fillNearest`).
- **Each chunk job here is distinct.** A job is keyed by its stamp (the
  seven nodes it reads; stream-core §2c), and the cache in `createJobs` is
  keyed the same way. Every 64³ of this world holds four towns turned at
  random, so no two stamps meet and the cut's chunks are all distinct jobs.
  The chapter says so rather than claiming the copies are shared.
- **Drawing the cut as cubes was too much.** At detail 2 a cut is about
  2 million records; at detail 1, 0.5–1 million. Instancing a 36-vertex cube
  per record would cost 20–70 M vertices a frame, so world chunks are drawn
  as faces (about 1.7 a record), 60 fps at 2× pixel density in headless
  Chrome on the M2 Max.
- Coarse lods look olive from far away, because the count-weighted mean
  includes the dirt and stone under the grass. That's the real rule's
  behaviour (docs/densecolor.md discusses the inside), and the film shows it
  as it is.
