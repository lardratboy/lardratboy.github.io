# The WebGPU quest: what would it actually buy us?

*Written 2026-11-01, in answer to "I'm not certain WebGPU offers us much. What exactly would it get us: 10×? 100×?" This looks at where time goes in the code as it stands (main at `52098e3`), what WebGPU changes in each place, and what WebGL2 can already do. Gains marked **measured** come from the docs; gains marked **estimate** are my reasoning and haven't been run.*

---

## The short answer

**Switching APIs makes nothing 10× faster.** WebGPU runs on the same GPU, with the same rasterizer and the same shader cores. Today's work, moved across unchanged, would land within roughly 1–1.5× of where it is. Big gains come from *algorithms*, and almost every algorithm on our list can be written in WebGL2.

**There's one exception, and it is our measured bottleneck: building chunks.** The workers expand chunks in JavaScript at 2–19 ms a job, and colour adds 6–200%. That limits how fast you can fly. WebGPU has **compute shaders with atomics and scatter writes**, so `expandChunk` could run on the GPU, writing records and pages straight into the buffers the renderer reads. That is the one place where **10–100× is plausible** (estimate). WebGL2 can't do that job without heroic workarounds.

So the WebGPU question is really this: **do we want chunk generation on the GPU?** If yes, WebGPU is required. If no, it buys us little, and your doubt is right.

---

## Where the time goes today (measured)

| Stage | Cost | Source |
|---|---|---|
| Chunk job (worker, JS): `expandChunk` walk, lod rule, seams | median 2–19 ms a chunk, up to 91 ms on the dense graph row | stream-findings §1 |
| …with colour (meanDepth 1) | +6% to +200% | attrs-findings §2 |
| Throughput, 4 workers | 90–1,500 chunks a second; near a surface, ~16 lod-0 chunks a second at best | stream-findings §2 |
| Cut + cover (main thread) | 0.1–2.5 ms a frame | stream-findings §1 |
| Raster on your GPU | 263K cubes in 1.43 ms, ~5 ns a cube | ray-findings, "Your GPU so far" |
| Ray on your GPU, sparse far view | 62 ms before PR #9; ~3.6× fewer texture reads since, not re-timed | ray-findings |
| Draw calls | one `drawElementsInstanced` per chunk, 5 uniform sets each, up to ~1,000 a frame | `stream-viewer.html` `renderView` |

The simulator said **the workers set the speed limit**. Your one real-GPU reading said raster is cheap and sparse tracing is expensive. Your `?bench` runs would settle the GPU side; see the end of this file.

---

## Area by area

### 1. Chunk generation: the one big win (WebGPU only)

**Today:** four module workers run `expandChunk` serially in JS. A 64³ chunk at lod 0 walks up to 262K cells. Results are copied into transferable buffers, admitted under upload budgets, then uploaded with `bufferData` / `texSubImage2D`.

**With WebGPU compute:**
- A 64³ chunk is 512 bricks of 8³. Each brick's work is independent: its lod rule, its face masks against its apron, its colour mean. That is one workgroup per brick and one thread per cell, the shape GPUs are built for.
- The colour fields (`colours.js`, `shapes.mjs`) are pure arithmetic of position, so they port to WGSL directly. Field evaluation is what made colour cost up to 3×, and on a GPU it's close to free.
- Variable-length output (only shown cells become records) needs a **prefix sum and a scatter**. That's a standard compute pattern, and it needs atomics or a scan pass, which WebGL2 doesn't have.
- **Nothing round-trips to the CPU.** Records land in the buffer the draw reads, so `UPLOAD_BYTES` budgets, transfers and admission metering stop mattering for generated content.
- Shape worlds could skip the DAG walk entirely and evaluate the field per cell. Testbed rows need the DAG walk, but their DAG is a few hundred nodes and fits in one storage buffer.

**Estimate: 10–100× chunk throughput.** My reasoning: a mid-range GPU has thousands of lanes against our 4 JS threads, and the work per cell is a few dozen integer operations plus one field evaluation. The real ceiling will be set by the scan, the DAG lookups and dispatch overhead, which I can't predict without a spike. It is still the only line in this file where an order of magnitude is realistic.

**What it costs:**
- **The oracle discipline doubles.** `expandChunk` stays the CPU oracle, and a WGSL twin must match it record for record and word for word, like `classifyPagesCPU` and `GLSL_RAY` today. That's the same pattern we already run, at a bigger size.
- **The renderer has to move too.** WebGL2 and WebGPU contexts **can't share GPU buffers**. Generating on WebGPU and drawing on WebGL2 would mean reading results back to the CPU and uploading them again, which throws away much of the gain. GPU generation therefore means a WebGPU renderer as well.
- The lod rules sort cells by count. On a GPU that becomes a counting sort or a top-k per brick: fine, but new code.

**Cheaper alternatives** (all WebGL2-compatible, all CPU-side):

| Alternative | Estimated gain | Notes |
|---|---|---|
| Counting-sort selection (step 3b q5) | 1.5–3× on per-brick rules | Sorting is most of the 2–4× that *adaptive* costs over *any* |
| Solid-brick skip inside the walk | large on solids, ~1× on porous | The sphere walks 4.5M cells to emit 109K records |
| Boundary-only walk for full chunks | large on terrain interiors | attrs-findings q4 |
| WASM (+ SIMD) | 2–5× | A guess. JS integer code is already decent |
| More workers | ∝ cores | Free, up to the machine's limit |

Stacked, these could plausibly reach 3–10× on the cases that hurt, without touching the graphics API. They're also prerequisites in a sense: a GPU port should port the fast algorithm, not today's slow one.

### 2. The raster pass: ~1× on the GPU, maybe 2–5× on submission

**GPU time:** the same instanced cubes go through the same hardware. **~1×.**

**CPU submission:** about 1,000 draws, each with 5 uniform calls and a VAO bind. WebGPU's render bundles and dynamic uniform offsets make each draw cheaper to submit, perhaps **2–5× less CPU per draw** (estimate). That matters only if submission is a visible share of the frame, and we haven't measured it. WebGL2 also has an answer here: put chunks in shared buffers and draw them with `WEBGL_multi_draw` (an extension, available in Chrome), or move the per-chunk uniforms into a texture indexed by `gl_DrawID`.

**GPU-driven culling** is the bigger idea: Hi-Z occlusion culling in compute, then `drawIndirect`. On dense views most of the 15M cubes are hidden behind others. But the ray path already takes those views, and WebGL2 has occlusion queries (one frame late) for chunk-level culling. **Partly WebGPU-only**, and its gain depends on content we route to the ray path anyway.

### 3. The ray pass: ~1–1.5× from the API, more from algorithms that work in either

What WebGPU would change in `GLSL_RAY`:
- **Native `countOneBits`** replaces `popcount32` (SWAR) in the attribute lookup. That runs once per hit pixel, over at most 16 words. Negligible.
- **Native `firstLeadingBit`** would make "largest empty aligned block" and ancestor levels O(1) bit tricks (ifsandwhats §10.1). Some arithmetic saved per step; the steps are bound by texture reads, not arithmetic.
- **Storage buffers instead of integer textures:** `texelFetch` on an `RGBA32UI` texture is already a plain load. Flexibility, not speed.
- **A compute-shader march** with workgroup shared memory, e.g. to cache the cover-tree top for a tile of rays. Modest, maybe 1.2–1.5× (estimate).

What would make the march substantially faster works in WebGL2 too:
- a **coarse pre-pass** (march at 1/4 resolution, start full-resolution rays from there; a render target is enough);
- **stopping at pixel footprint** (§5.4) instead of descending to lod 0 everywhere;
- **Oh-class brick sharing** (ray-findings q3), which is a memory win more than a speed one.

**~1–1.5× from WebGPU itself** (estimate). Larger gains are algorithmic and available in both APIs.

### 4. Residency and feedback: nice, not needed

§5.2 planned a GPU feedback buffer ("I wanted node X, it wasn't there"). The step 4 streamer decides residency on the CPU from distance, in 0.1–2.5 ms a frame, and that works. Feedback would add *occlusion-aware* residency: no jobs for chunks behind a hill. That could cut jobs on terrain-like views, but WebGL2 can do it the old VT way (an ID buffer at 1/8 resolution, `readPixels` into a PBO behind a fence). **Easier in WebGPU, not exclusive to it.**

### 5. Limits and plumbing: flexibility, not speed

| | WebGL2 today | WebGPU |
|---|---|---|
| Attribute heap | a 4,096 × 4,096 `R32UI` texture (64 MB), capped by `MAX_TEXTURE_SIZE` | a storage buffer: 128 MB binding by default, often 1–2 GB if you request higher limits on desktop |
| 64-bit masks | `[lo, hi]` uint32 pairs | the same: WGSL has no 64-bit integers either |
| GPU timers | `EXT_disjoint_timer_query_webgl2` (what `?bench` uses) | `timestamp-query`, also an optional feature |
| Probes | transform feedback (`chunkSelftest`) | storage-buffer readback: simpler |
| Shared DAG across workers | needs COOP/COEP for `SharedArrayBuffer` | unrelated to the API |

The heap ceiling is the one limit we've actually hit: the densest row traced from lod 0 needs ~16M words, which is the whole heap. Paging a second heap texture fixes that in WebGL2.

---

## What switching would cost

- **Every shader twin, rewritten in WGSL**: `GLSL_DECODE`, `GLSL_ATTR`, `GLSL_RAY`, `GLSL_RAY_ATTR`, and sol-v4's `classify`/`trace` if the contact sheet moves too. Each "change together, line for line" rule in CLAUDE.md gets a third party during the transition, unless the cut-over is clean.
- **The browser test harness.** `npm run test:browser` uses headless Chrome with software GL. Headless WebGPU on SwiftShader exists but needs different flags and is less mature. I'd have to verify it before relying on it.
- **Reach.** WebGPU shipped in Chrome/Edge in 2023, in Safari in 2025, and in Firefox on Windows in 2025, with other platforms following. That's broad on desktop but not universal, so WebGL2 stays as a fallback or becomes a second renderer to maintain.
- **WGSL's uniformity rules** sometimes reject texture sampling in divergent loops. `textureLoad` is exempt, and our marches only load, so this is probably fine.

---

## Verdict

| What | WebGPU gain | Exclusive to WebGPU? |
|---|---|---|
| Chunk generation on the GPU | **10–100×** throughput (estimate, unproven) | **Yes**, in practice |
| Raster GPU time | ~1× | — |
| Raster draw submission | 2–5× CPU per draw (estimate), only if it matters | No (`WEBGL_multi_draw`) |
| GPU occlusion culling | content-dependent | Partly |
| Ray march | ~1–1.5× | No: the real wins are algorithmic |
| Feedback buffer | enables occlusion-aware residency | No: harder, not impossible |
| Bigger buffers | removes the 64 MB heap ceiling | No: page a second texture |

**My recommendation: don't port for its own sake.** Do the CPU job speed-ups first (counting sort, solid-brick skip, boundary walk, maybe WASM), because they're small and local and have oracles already. If flight speed is still worker-bound after that, run one **spike** before committing:

> Port the lod-0, colourless `expandChunk` for a single shape field (sphere or terrain) to a WGSL compute shader on a standalone page. Hold it to `expandChunk` record for record, and measure chunks a second against 4 workers on your GPU.

The decision rule: **≥10× with exact records** means GPU generation earns WebGPU its place, and the renderer follows, because the buffers can't be shared. **Less than that** means we stay on WebGL2, update §11 Q1/Q15 to "decided: WebGL2", and the doubt you had was right.

That spike is roughly a step's worth of work (a page, a WGSL kernel with a scan, a probe). It answers the question with a number, which beats arguing it here.

---

## The first measurement (2026-11-01)

Your first `?bench`, on Safari 27 with an Apple GPU, used the wall-clock fallback, because Safari has no GPU timer extension. The canvas was 2560 × 871. The view was seed row #42.0 from inside ([docs/ray-findings.md](docs/ray-findings.md), "Your GPU so far"):

- **Raster: 397K cubes in 2.1–2.6 ms. Ray: 8.5–8.8 ms.** Both fit well inside a 60 Hz frame (16.7 ms). Raster is ~4× faster here.
- **Submission is 0.22 ms for 98 draws, ~2 µs a draw.** Even the 1,000-draw views would spend ~2 ms issuing calls. So §2's "2–5× cheaper submission" could save a millisecond or two a frame at most. **That argument for WebGPU is gone.**
- On this view, then, **the GPU side needs nothing WebGPU offers.** That leaves §1 (chunk generation) as the only real case, as the verdict says. The dense graph row would test the GPU hardest: 15.4M cubes is ~90 ms of raster at this rate, against an estimated ~5–10 ms of ray. That still argues for the ray path, not for a new API.

**Second reading, the dense graph row** (same machine and eye): raster draws 15.4M cubes in **45–47 ms**, which misses 60 Hz. The ray traces the same view in **under 0.5 ms** (0.40–0.43, at the wall clock's noise floor). That's about 100×, in WebGL2, from the ray path we already have. It's the clearest evidence yet that **the big rendering wins here are algorithmic**: the hardest view to draw got its two orders of magnitude from choosing the right path, not from a new API. (It also shows the path should be picked per chunk by density, not by lod: see ray-findings question 5.)

**Third reading, the terrain:** raster only is fastest (2.6 ms); every hybrid mode costs 7–9 ms. The cause is in our ray pass, not in WebGL2: it writes `gl_FragDepth` and doesn't stop at the raster's depth, so every pixel traces a full ray (ray-findings question 6). Over the three views, the best mode is always under 3.5 ms on your Mac. **The rendering side doesn't need WebGPU.** It needs a per-chunk choice of path and a depth-bounded march, and both are plain WebGL2. What remains for WebGPU is §1, chunk generation, and the spike is the way to decide it.

## What would sharpen this

Your `?bench` runs. Paste the `streamBench` lines from the console (or `JSON.stringify(window.__bench)`), with the world and eye for each. Three readings matter:

- **If raster plus ray stays well under your frame budget on the default views,** the GPU side is not a problem, every rendering argument for WebGPU above is moot, and only generation is left.
- **If the ray pass is still tens of milliseconds** on sparse far views after PR #9, the algorithmic march work (coarse pre-pass, footprint stop) is the next thing, and it works in WebGL2.
- **The `renderer` string** says which GPU and backend (ANGLE on Metal, D3D, …) the numbers came from. That tells me whether WebGL2's translation layer is costing us anything WebGPU would avoid.
