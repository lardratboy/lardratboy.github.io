# A C++ vdag renderer, proof of concept

The question was what C++ buys over the JavaScript, so this is the stream
viewer's records path ported as directly as possible, and a bench that runs
the same work in both languages and checks that the bytes come out the same.
It's plain structs and free functions, threads, SDL3, OpenGL 4.1 and Dear
ImGui. There are no classes beyond what ImGui and std need.

**The short answer** (Apple M2 Max, 2026-11-15; the full table is
[below](#the-numbers)):

- **The chunk job is 3–4.5× faster in C++**, on one thread and on four, on
  every world tried. Records and colour words are **byte for byte the same**
  as the browser's job code on every cut measured.
- **The cut is 3–18× faster**, but it was already well under a millisecond in
  JS (0.05–0.6 ms).
- **Loading is 2–35× faster per phase.** Counts are 13–35× faster (one typed
  loop against a loop through closures), the graph decode 2–3×, and gunzip 2–7×.
- **Drawing is the GPU's**, the same in both: the same shader, the same
  instanced cubes, one draw a chunk. Submitting 85 draws takes 0.4 ms of CPU
  here. The browser's per-draw overhead (WebGL validation, ANGLE onto Metal)
  wasn't measured; see [What wasn't measured](#what-wasnt-measured).

## Build

```sh
brew install sdl3            # already there on this machine; cmake too
cmake -S cpp/poc -B cpp/poc/build
cmake --build cpp/poc/build -j
```

The configure step fetches Dear ImGui v1.91.9b from GitHub (FetchContent).
zlib is the macOS SDK's. `-DPOC_VIEWER=OFF` builds the bench alone, with no
SDL and no network.

## Run

```sh
cpp/poc/build/vdagview                                  # opens worlds/kit-d10.vdag
cpp/poc/build/vdagview worlds/scene/knight-d10.vdag --threads 4 --detail 4 --rule shadow --vsync 0
```

**WASD** fly (**Q/E** or **Ctrl/Space** down and up, **Shift** ×4); drag with
either button to look; the **wheel** sets the speed; **H** hides the panel;
**F** freezes the cut; **R** flushes the cache and times a cold converge.
Drop a `.vdag` on the window, or pick one in the panel (it lists `worlds/`,
`test-3d-models/` and `cpp/poc/worlds/`).

### Worlds with named colour

The scatter, the kit and the dungeon draw in their own colours, from the same
code as the browser's (below). `worlds/kit-d10.vdag` and `worlds/scatter-d10.vdag`
already have it; for a dungeon, a D = 12 kit and a scatter on today's ground:

```sh
node cpp/poc/bench/make-worlds.mjs     # ~7 s: cpp/poc/worlds/{dungeon-d10,dungeon-d12,kit-d12,scatter-d10}.vdag
cpp/poc/build/vdagview cpp/poc/worlds/dungeon-d10.vdag
```

`--shot out.png` waits for the world to converge, draws 60 more frames,
writes a PNG and prints what the frames cost, then exits:

```
converge 155 ms wall in 5 frames (last job back at 87 ms), 105 jobs, 77 ms of job time on 4 threads
frame 12.57 ms mean, CPU 1.98 ms, GPU 6.50 ms (p95 8.69), 85 draws, 7.49M triangles, 1985236 cubes
```

### The bench

```sh
cpp/poc/build/vdagbench worlds/caves-d10.vdag          # C++
node cpp/poc/bench/bench.mjs worlds/caves-d10.vdag     # the same steps through the repo's JS modules
node cpp/poc/bench/compare.mjs                         # both, on 13 worlds, as a markdown table (--no-colour: without words)
```

Each bench loads the file, takes the cut at two eyes, runs every node of the
cut as a job, and prints a checksum:

- **The eyes** are `view` (the file's saved view, else the stream viewer's kit
  view) and `centre` (the middle of the world, the worst case: about 1,000
  lod-0 chunks).
- **The jobs** are every node of the cut, splits included, as the streamer
  wants them (`splitsResident`), in its order. They run on 1 thread cold (a
  fresh mask cache and colour memo every rep), 1 thread warm (the same ones
  again), and N threads.
- **The checksum** is FNV-1a over every job's numbers, records and words in
  key order. The JS side runs `createJobRunner` from `stream-core.js`, which
  is `fastChunk` plus the buried-chunk shortcut, exactly what the browser's
  chunk workers run. Its N threads are `worker_threads`, each holding a
  structured-clone copy of the snapshot, as the browser's workers do.

It measures job times, so **run it on an idle machine**.

## What's in it

| file | what | ported from |
|---|---|---|
| `src/dag.hpp` | the store (9 words a node, hash-consed, children first), counts, `isFull`, `chunkNode` | `dag-core.js`, `chunk-core.js` |
| `src/vdag.cpp` | the `.vdag` reader: sections, gzip (zlib), the graph, a baked world's ATTR (skin and words, six bits widened) | `vdag-core.js` |
| `src/baked.cpp` | the baked colour field: block sums, exact means of a cell's skin, the path memo | `baked-core.js` |
| `src/fields.cpp` | the named colour fields: the scatter's (and the hills' noise and ramp under it), the kit's (and all of `kitPlan`, whose draws it reads), the dungeon's (and the 372 tiles and `tileKinds`, the materials it reads); `cellAttr`'s walk is in `job.cpp` | `scatter-core.js`, `experiments/shapes.mjs`, `kit-core.js`, `specimen-core.js`'s `hash32`, `dungeon-core.js`, `chunk-core.js` |
| `src/job.cpp` | the chunk job: shells of full nodes, per-brick masks, the cached seam test, the buried-chunk shortcut, every lod rule | `job-core.js`, `chunk-core.js`, `stream-core.js` |
| `src/cut.cpp` | the cut (the same binary heap, step for step), the cover with open sides, clearance | `stream-core.js` |
| `src/pool.hpp` | worker threads: a queue the main thread replaces every frame, results tagged by world | `stream-pool.js`, `chunk-worker.js` |
| `src/viewer.cpp` | SDL3 + GL 4.1 + ImGui: admission under an upload budget, LRU eviction, frustum culling, near-first instanced draws, GPU timer | `stream-viewer.html`'s `install`, `renderView`, `rasterVS`, `GLSL_SHADE` |
| `src/bench.cpp`, `bench/*.mjs` | the two benches, the comparison, and `make-worlds.mjs` (world files with named colour, by the repo's own builders) | |

The vertex shader is `GLSL_DECODE` and `rasterVS` pasted in. The fragment
shader is `GLSL_SHADE`'s lights and fog with the colour modes the viewer
draws records in (attribute, gamut, lod, chunk, plain).

### Left out, on purpose

- **The other named colour fields** (the caves', the terrain's, the lattice's,
  the shapes' and rows'). A world's named colour is code that rebuilds from its
  descriptor, so each kind has to be ported; three are (scatter, kit, dungeon).
  The others draw in the gamut colour, and both benches compute no words for
  them, so their rows leave out a cost the browser pays in every job.
- **Poses** (`createClasses`, the Oh classes) are 0, as only the ray path uses
  them. The JS bench runs without them too.
- The ray path, occlusion queries, edits, scenes, actors, walking, SSAO and
  file export.
- **Validation in the reader.** The JS `readVdag` prunes each world and checks
  the node, voxel and colour-print totals that DESC states; this reader doesn't.
  So the load column compares JS's whole reader with C++'s decode. Both
  benches print the decode alone as well (below).

## The numbers

Apple M2 Max (8 performance + 4 efficiency cores), Node 22.20, Apple clang 21
at `-O3`, 4 threads, detail 4, the shadow rule, min of 3 reps, from `node cpp/poc/bench/compare.mjs`. The machine
wasn't idle (load average about 3.7 throughout; a first run gave the same
ratios to within 0.5×), so read the ratios rather
than the milliseconds. "Same bytes" means the checksums agree.

This table was measured before the named colour fields were ported, so its
kit and scatter rows are **without colour words**. With them, the same
checksums agree in both languages on all six named-colour worlds tried (the
kit at D = 10 and 12, the scatter old and new, the dungeon at D = 10 and 12),
and one-thread job times there came out 3.2–6.9× faster in C++ (single runs,
not this table's protocol).

| world | eye | jobs | records + words | cut ms JS / C++ | 1 thread cold ms JS / C++ | warm ms JS / C++ | 4 threads ms JS / C++ | load ms JS / C++ | same bytes |
|---|---|---:|---:|---:|---:|---:|---:|---:|:---:|
| kit-d10 | view | 105 | 2.45M + 0.00M | 0.079 / 0.009 (9.1×) | 198.4 / 48.0 (**4.1×**) | 184.0 / 43.4 (4.2×) | 63.8 / 15.2 (**4.2×**) | 14.9 / 0.8 (19.6×) | yes |
| kit-d10 | centre | 1316 | 29.60M + 0.00M | 0.605 / 0.170 (3.6×) | 2462.2 / 596.8 (**4.1×**) | 2444.5 / 589.4 (4.1×) | 632.3 / 157.6 (**4.0×**) |  | yes |
| terrain-d10 | view | 115 | 0.58M + 0.00M | 0.083 / 0.009 (9.4×) | 347.8 / 92.7 (**3.7×**) | 209.3 / 50.3 (4.2×) | 116.5 / 30.7 (**3.8×**) | 31.0 / 4.5 (6.8×) | yes |
| terrain-d10 | centre | 1205 | 2.05M + 0.00M | 0.574 / 0.150 (3.8×) | 1726.4 / 424.2 (**4.1×**) | 1417.6 / 328.1 (4.3×) | 499.4 / 125.5 (**4.0×**) |  | yes |
| caves-d10 | view | 91 | 0.59M + 0.00M | 0.111 / 0.007 (16.6×) | 470.6 / 133.2 (**3.5×**) | 235.3 / 58.5 (4.0×) | 155.4 / 42.2 (**3.7×**) | 73.3 / 10.8 (6.8×) | yes |
| caves-d10 | centre | 1214 | 3.39M + 0.00M | 0.456 / 0.151 (3.0×) | 3148.1 / 786.7 (**4.0×**) | 2581.1 / 604.9 (4.3×) | 883.2 / 224.0 (**3.9×**) |  | yes |
| scatter-d10 | view | 79 | 0.62M + 0.00M | 0.096 / 0.006 (17.2×) | 286.3 / 82.6 (**3.5×**) | 154.7 / 38.3 (4.0×) | 81.7 / 23.6 (**3.5×**) | 65.5 / 11.9 (5.5×) | yes |
| scatter-d10 | centre | 1177 | 3.39M + 0.00M | 0.500 / 0.147 (3.4×) | 1653.7 / 425.9 (**3.9×**) | 1326.9 / 304.7 (4.4×) | 456.0 / 116.9 (**3.9×**) |  | yes |
| gyroid-d10 | view | 193 | 1.69M + 0.00M | 0.115 / 0.014 (8.1×) | 626.9 / 185.3 (**3.4×**) | 405.2 / 112.9 (3.6×) | 305.8 / 87.5 (**3.5×**) | 30.4 / 4.4 (6.9×) | yes |
| gyroid-d10 | centre | 1195 | 5.85M + 0.00M | 0.605 / 0.160 (3.8×) | 2540.6 / 648.9 (**3.9×**) | 2328.7 / 577.2 (4.0×) | 856.9 / 221.6 (**3.9×**) |  | yes |
| lattice-r-32-16--d10 | view | 94 | 2.21M + 0.00M | 0.110 / 0.006 (18.6×) | 882.8 / 342.0 (**2.6×**) | 223.4 / 67.9 (3.3×) | 305.5 / 111.1 (**2.7×**) | 411.2 / 111.2 (3.7×) | yes |
| lattice-r-32-16--d10 | centre | 1033 | 18.43M + 0.00M | 0.342 / 0.114 (3.0×) | 3234.2 / 998.2 (**3.2×**) | 2127.6 / 529.7 (4.0×) | 967.4 / 306.9 (**3.2×**) |  | yes |
| knight-d10 | view | 43 | 0.19M + 0.19M | 0.049 / 0.003 (18.1×) | 272.4 / 77.1 (**3.5×**) | 127.8 / 31.7 (4.0×) | 117.4 / 26.5 (**4.4×**) | 274.1 / 53.7 (5.1×) | yes |
| knight-d10 | centre | 1023 | 3.06M + 3.06M | 0.372 / 0.104 (3.6×) | 3447.6 / 824.9 (**4.2×**) | 2844.7 / 620.9 (4.6×) | 985.3 / 242.6 (**4.1×**) |  | yes |
| the-dwarf-d10 | view | 50 | 0.27M + 0.27M | 0.059 / 0.003 (18.5×) | 368.4 / 106.7 (**3.5×**) | 180.8 / 44.5 (4.1×) | 153.5 / 35.2 (**4.4×**) | 344.4 / 82.4 (4.2×) | yes |
| the-dwarf-d10 | centre | 1243 | 3.81M + 3.81M | 0.464 / 0.152 (3.1×) | 4460.0 / 1066.2 (**4.2×**) | 3688.5 / 804.5 (4.6×) | 1271.9 / 303.0 (**4.2×**) |  | yes |
| sands-location-d12 | view | 119 | 0.41M + 0.41M | 0.076 / 0.008 (9.8×) | 295.2 / 88.4 (**3.3×**) | 176.9 / 48.3 (3.7×) | 131.4 / 29.0 (**4.5×**) | 477.4 / 140.4 (3.4×) | yes |
| sands-location-d12 | centre | 276 | 0.99M + 0.99M | 0.068 / 0.018 (3.9×) | 634.8 / 185.3 (**3.4×**) | 401.4 / 95.1 (4.2×) | 222.4 / 59.1 (**3.8×**) |  | yes |

Load, phase by phase (C++ / JS, ms; JS's gunzip is `DecompressionStream`):

| world | file | nodes | read | unpack (gzip) | decode the graph | counts | all of `readVdag` (JS) |
|---|---:|---:|---:|---:|---:|---:|---:|
| lattice-r-5-128 | 43 MB | 3,005,679 | 15 / 12 | 95 / 184 | 576 / 1,154 | 15 / 192 | 1,709 |
| sands-location (D = 12) | 10 MB | 394,448 | 3 / 3 | 8 / 27 | 40 / 100 | 1.3 / 25 | 455 |
| knight (D = 10) | 4.4 MB | 217,279 | 4 / 3 | 2.5 / 17 | 9 / 24 | 0.6 / 15 | 247 |
| caves (D = 10) | 0.6 MB | 83,692 | 3 / 1 | 2 / 14 | 6.5 / 21 | 0.2 / 7 | 66 |

A baked world's ATTR (the skin's graph and gunzipping its words) is a
further 34 ms (knight) and 74 ms (sands) in C++; JS does it inside `readVdag`.

## What the numbers say

1. **The same algorithm runs 3–4.5× faster.** The job is integer walks over
   the DAG, a 287 KB occupancy grid, bit masks, and a sort per brick on a
   cache miss. JIT-compiled JS does this well; C++ does it better by about
   4× on one core, with no source-level tricks (no SIMD, no `-ffast-math`,
   which would change the rounding).
2. **Threads scale about the same in both.** C++ gets 3–4× on 4 threads and
   so do JS workers, because each job is independent and a few milliseconds
   long. What C++ saves is memory: every JS worker holds its own copy of the
   snapshot (36 bytes a node of keys and 8 of counts, plus a baked world's
   words: 25 MB a worker for the D = 10 knight, 132 MB for the 3M-node
   lattice), while the C++ threads share one store. The bench's shared
   counter also leaves out the browser's message hops between the page and
   its workers.
3. **Warm and cold differ by about the same in both.** Mid-flight, a worker's
   mask cache and colour memo are warm. The ratio is about the same warm as
   cold, so neither language gains more from the caches.
4. **Colour doesn't change the ratio.** On the baked worlds (knight, dwarf,
   sands), where every record also gets a word from the baked field's means,
   C++ is still 3.2–4.2× faster.
5. **Load is hash-consing and gzip.** The decode is 2–3× faster (interning is
   mostly cache misses into the table, in either language), and counts
   13–35×. JS's whole `readVdag` is 3–6× the C++ total, partly because it
   also prunes and checks.
6. **The frame is the GPU's.** The kit's opening view is 7.5M triangles from
   2M cubes in 85 draws: 6.5 ms of GPU time, with 0.4 ms of CPU to submit it
   all. The cut, cover and queue together are under 0.1 ms. So for this
   renderer C++ doesn't change frame rates; it changes how fast a new view
   fills in (jobs) and how fast a file opens.

## Traps hit on the way (macOS)

- **Polling a GL timer query blocks.** Asking `GL_QUERY_RESULT_AVAILABLE` of a
  query from the last few frames waited for the GPU: 6.2 ms of an 8.8 ms
  "CPU" frame. The viewer now asks only queries six frames old.
- **Threads with no QoS class wander onto the efficiency cores**, and an app
  that isn't frontmost gets App Nap: the same view's jobs took 0.5 to 3 ms
  from run to run. Worker threads now ask for `QOS_CLASS_USER_INITIATED`.
- **`istreambuf_iterator` reads a byte at a time**: 140 ms for the 43 MB
  lattice against Node's 12 ms. One sized read is 15 ms.
- **Rounding has to be JavaScript's.** `Math.round` is half up and
  `std::round` is half away from zero, which agree only on non-negative
  numbers (every number rounded here is non-negative). `keepCount` uses `pow`,
  `log` and `cbrt`, where V8's fdlibm and Apple's libm could differ in the
  last bit. No cut tried showed a difference, but that would be the first
  place to look if a checksum ever disagreed.
- **Fused multiply-adds.** On ARM, clang fuses `a*b + c` into one instruction
  by default, which rounds once where JS rounds twice. The colour fields
  (the hills' noise, the kit's frame maps, the dungeon's tints) are full of
  such expressions, so the build passes `-ffp-contract=off`. Measured: a
  build with fusing on had 35 fused instructions and still gave the same
  checksums on the kit, the scatter, the dungeon and the knight, because a
  word is rounded to 6 bits a channel and a last-bit difference rarely
  crosses a rounding boundary. "Rarely" isn't "never", so the flag stays.
- **A file's colour descriptor is the viewer's, not the builder's.**
  `scatterDesc()` has no `kind`; the stream viewer adds `kind: 'scatter'` when
  it makes the colour. The first scatter file `make-worlds.mjs` wrote had no
  colour in either reader.

## What wasn't measured

- **The browser's frame on the same view.** The shader and the draws are the
  same, so the GPU time should be too. The CPU side of WebGL (validation,
  ANGLE, the GPU process) costs more per draw, but at about 100 draws a frame
  that's a fraction of a millisecond. Measuring it would take the stream
  viewer opening a file from a link, which it can't do (`saveView` writes
  what a shelf world was built from).
- **The rest of the named colour fields.** The caves, the terrain and the
  lattice are still compared without colour.
- **A flight.** Both benches time converging from cold at fixed eyes, not a
  camera moving through a world.
