# renderanim/: from DAG to GPU, the render film

A 5 min 54 s animated walk through the stream viewer's render pipeline,
in 18 chapters: how a world held as a DAG becomes instanced cubes on the
GPU, following one chunk through the JavaScript that moves it. It's the
companion to `animation/` (the first film, which explains the DAG itself),
and like it a single page with no build step and no dependencies:

    npm run serve        # then http://localhost:8000/renderanim/

Serve the repo root: the page imports the cores unchanged (`../dag-core.js`,
`../chunk-core.js`, `../stream-core.js`, `../kit-core.js`, `../colours.js`,
`../chunk-glsl.js`, `../experiments/stream-sim.mjs`) and fetches the source
files its code panels show, from beside them: by `main.js`'s own URL, as the
imports resolve, never the page's (fetched against the page, the panels all
said "not loaded" wherever the page sat at another path). A file that won't
load says why in its panel (the HTTP status and the path asked for).

## What's real

Three things make it more than a drawing.

- **The numbers are computed as the page loads**, by the repo's own code:
  the world is the stream viewer's opening world (the kit at D = 8, level-1
  colour frames, seed 1: `KIT_OPENING`), every chunk is run through
  `createJobRunner` over `worldSnapshot` (what `chunk-worker.js` does), and
  the job objects, the cut, the cover and the open sides are
  `createStreamer`'s, `selectChunks`'s and `coverOf`'s.
- **The code panels are the source**, fetched and looked up by anchor text
  (`code.js`), with the files' own line numbers. A change to the code moves
  the panel with it; a change that breaks an anchor or a highlighted line
  makes `check.mjs` fail.
- **The film draws chunks the viewer's way.** Each chunk's records and words
  go into one buffer exactly as `install()` does it, the VAO binds the same
  36-byte cube index, each chunk is one `drawElementsInstanced`, and the
  vertex shader prepends `chunk-glsl.js`'s `GLSL_DECODE` unchanged. So the
  cubes you watch being decoded are decoded by the code the film describes.
  The lighting is the film's own (edges, fog to its sky), except in the
  fragment chapter, which switches to the viewer's `shadeOut`.

What's illustrative, and says so on screen:

- **The stream chapter is a replay**: the real `createStreamer`, fed by four
  simulated workers on a virtual clock (the loop of
  `experiments/stream-sim.mjs`, with its job-time model `TEST_COST`), so the
  schedule is the same every load. It's played slowed down, by up to 90×
  while chunks arrive and less between, and the timeline shows the factor.
  Its cache is cut to 30 chunks so this small world shows eviction.
- **The film's cut uses detail 0.6**; the viewer uses 4, which at D = 8 puts
  every chunk at lod 0. The film says so in the cut chapter.
- **Hidden faces "fly off"** in the vertex chapter (`uHiddenT` in `gl.js`);
  the shader really moves them to (2, 2, 2, 1) in one step.
- **The seams chapter slides the lod-1 side 240 voxels away** to show the
  lod-0 side's seam face; the faces the open sides add are tinted gold
  (`uSeamGlow`, a flag the film's vertex shader adds).

## The chapters

| # | key | what it shows | where the numbers come from |
|---|-----|---------------|-----------------------------|
| 1 | map | main thread, workers, GPU: the road, with what crosses each line | snapshot bytes; the job message's JSON length |
| 2 | dag | 9 numbers a node; root → chunk node → brick → voxel | `store.child`, `counts.of`: 963 nodes, 34,668 bytes of keys, 1,725,081 voxels |
| 3 | snapshot | `worldSnapshot`'s arrays, posted once to each of four workers | `snap.keys`, `counts`, `poses`, the kit descriptor |
| 4 | cut | `selectChunks` live with a moving eye, leaves by lod | `selectChunks(world, eye, { detail: 0.6 })` every frame |
| 5 | job | `nextJob()`'s object and the 110-byte message | a real streamer's `nextJob` from the film's eye |
| 6 | descend | the buried test; `nodeAt`'s octant digits down to node 569 | the focus chunk (1, 0, 1)'s path |
| 7 | walk | 87,096 cells appearing in walk order (Morton), with each index's bits | `expandChunk(..., { cells: true })` on the focus chunk |
| 8 | faces | the apron slabs; a cutaway, solid as cells and a shell as records; one cell's six tests | 53,522 buried of 87,096; mask 38 for the followed record |
| 9 | record | `packRecord`'s 32 bits; the attribute word's | record 33,345 = 0x109ba5d7, word 0xa4fca4 |
| 10 | reply | the transfer (measured: the posted buffer reads 0 bytes), `complete`, `service`'s budgets | `DEFAULTS.installMs`, `uploadBytes`, `maxInstalls` |
| 11 | install | `both`, `bufferData`, the VAO's three bindings, `entry.records = null` | 33,599 records + 33,599 words = 268,792 bytes |
| 12 | cube | the 24 corners and the 36 indices, triangle by triangle | `FACE_OFF` and `cubeIndex`, copied and checked |
| 13 | draw | `renderView`: the cover sorted, a frustum, one call a chunk | `coverOf` and `boxVisible` from a viewer eye |
| 14 | vertex | `mortonDecode`, the centre, 24 corners, hidden faces to (2, 2, 2, 1) | the followed record, drawn by `GLSL_DECODE` |
| 15 | fragment | the word unlit, then `shadeOut`'s light, then fog | the viewer's constants |
| 16 | seams | holes where lods meet; open sides and the seam tail close them | `coverOf`'s `open`; 1,133 faces and 72 tail cubes added |
| 17 | stream | the whole loop: cut, cover, four workers' jobs, installs, eviction | the replay (above) |
| 18 | finale | the road again, end to end | 28 chunks, 699,224 records, 1,947,004 triangles at lod 0 |

## Files

- `index.html`: the shell (canvases, caption, controls, chapter menu),
  `animation/index.html`'s.
- `main.js`: the clock and controls (`animation/main.js`'s), with the
  loading made async (the world, the jobs and the source files before the
  first frame) and the code panel's layout: a chapter with `side` slides
  its picture left by a lens shift so the panel has room. Under 900 px
  there's no panel. `window.__anim` is there for the console and the shots.
- `data.js`: **pure** (Node imports it). The world, every job, the focus
  chunk opened up, real job objects, the stream replay and the seams cover.
- `code.js`: **pure**. The snippets (file, anchor, offset, length) and the
  lookup.
- `scenes.js`: the 18 chapters, each `{ key, stage, title, dur, side, steps,
  cam(t), draw(c) }`, a function of the chapter's own time.
- `gl.js`: the renderer: `animation/gl.js`'s, plus the record program
  (`REC_VS` / `REC_FS` over `GLSL_DECODE`), `makeRecordBatch` (`install()`
  line for line) and `F.records` (one instanced draw a chunk), and the lens
  shift.
- `ui.js`: `animation/ui.js`'s overlay, plus code panels (a small tokenizer,
  wrapping, the eased highlight bar), the pipeline map (and its narrow
  form), cards and strips.
- `check.mjs`: `node renderanim/check.mjs` (~1 s) prints every number and
  holds the film to the code (below). Exits 1 on a failure.
- `shots.mjs`: `node renderanim/shots.mjs [outdir] [seconds...]` (~1 min)
  screenshots the film in headless Chrome on this machine's GPU and prints
  any console error. A reading aid, not a test.

## What `check.mjs` holds

1. The focus chunk's records and words from `expandChunk` equal the worker
   job's (`fastChunk`) byte for byte, as chapter 6 says.
2. The walk is in Morton order, and every job's records are sorted by cell,
   with a word each, faces before `borderStart` and none after.
3. The film's copies of the page are the page's: `FACE_OFF` character for
   character and by value, the cube index loop, `install()`'s buffer and
   attribute lines, `renderView`'s draw call and `rasterVS`'s hidden face.
4. Every code panel's anchor occurs exactly once, and every highlighted
   line is in its panel (it reads the highlights out of `scenes.js`).
5. The stream replay's installs fall in the stretches the chapter's clock
   slows down for (`P.skeys` in `scenes.js`). If the flight or the world
   changes, the check says to move them.
6. The seams chapter's chunks have open sides that add faces.
7. A buffer posted in a transfer list is detached (the reply chapter also
   measures this in the page).

## Things learned while making it

- **The kit's chunks are dense**: about 25,000 records a chunk at every lod,
  so a D = 10 kit's cut at detail 2 is 9.5 million records. D = 8, the
  viewer's own opening world, keeps the whole film at 60 fps at 2× pixel
  density in headless Chrome on the M2 Max, drawn as the viewer draws it.
- **This world loads in 6 frames** (100 ms of virtual time) with four
  workers, and after that the flight needs jobs in only four short bursts.
  A replay at one speed showed an empty worker timeline for most of the
  chapter, so its clock is piecewise: slow round each burst, quick between.
- **Seams are hard to see in place**: the two lods' surfaces sit on each
  other. Sliding one side away and looking at the other's seam face shows
  the holes, and the open sides closing them.
- **A lone cube shows the vertex shader best**: in place, its neighbours hide
  the very faces it drops.
