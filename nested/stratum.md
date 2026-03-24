# Stratum: Hierarchical Spatial Decomposition for Binary Data Exploration

**A unified framework for visualizing arbitrary data as navigable, GPU-accelerated hierarchical point clouds**

---

## Abstract

We present Stratum, a system for transforming arbitrary binary data — or structured point clouds — into interactive hierarchical spatial visualizations. The core algorithm interprets raw bytes as streams of N-component tuples, decomposes each tuple through a configurable chain of nested quantization levels (a mixed-radix number system), deduplicates the result via a bit-table indexed by the composite hierarchical address, and uploads a single packed-integer vertex buffer to the GPU. A vertex shader reconstructs world-space positions on demand, applies gap inflation across nesting tiers, and maps hierarchical addresses through perceptual color palettes — all from uniform-driven parameters with zero geometry re-upload.

The key theoretical insight is that the **hierarchical address** — a chain of small integer triples produced by the decomposition — is the canonical data representation, not an intermediate step toward world-space coordinates. Position, color, deduplication keys, spatial sort order, and level-of-detail are all projections of this single representation. This separation of canonical form from view-dependent materialization eliminates the float32 precision wall, halves GPU memory versus conventional position+color attributes, and makes projection mode switching, gap adjustment, and visual parameter changes instantaneous.

The system is implemented as a single-file HTML5/WebGPU application with zero external dependencies. It supports 15 data type interpretations, three projection modes (3D Spatial, Tiled 2D, Atlas 3D), SDF-based spatial filtering, and real-time interaction at 60fps across point clouds of tens of millions of points.

---

## 1. Introduction

### 1.1 The Problem

Binary data is the substrate of computation. Executables, model weights, disk images, compressed archives, network captures, sensor streams — every digital artifact is ultimately a sequence of bytes. Yet our tools for examining this substrate are remarkably impoverished: hex editors show rows of numbers, entropy plots show one-dimensional statistics, and file format parsers require prior knowledge of structure.

The gap between raw bytes and human understanding is not a display problem — it is a *dimensionality* problem. A byte stream is one-dimensional. The structures encoded within it — headers, tables, compressed regions, entropy boundaries, alignment patterns — are inherently multi-dimensional. Revealing these structures requires projecting the data into a space where spatial proximity encodes informational similarity.

### 1.2 The Approach

Stratum treats any file as a flat stream of scalar values, groups every N consecutive scalars into a tuple, normalizes each tuple to the unit hypercube, and decomposes it through a configurable hierarchy of quantization levels. The result is a point cloud in which the spatial position of each point encodes its value, and the hierarchical nesting of the visualization encodes the precision of that encoding.

The hierarchy is not merely a rendering trick. It is a *number system* — a mixed-radix positional encoding where each level contributes digits of increasing refinement. The coarsest level partitions the value space into broad regions; each subsequent level subdivides those regions into finer cells. The complete address — the chain of cell indices across all levels — is a lossless representation of the quantized coordinate, from which position, color, sort keys, and deduplication identifiers are all derived.

### 1.3 Design Principles

Stratum is built on five separations of concern that compound into architectural flexibility:

1. **Data representation is separated from spatial layout.** The hierarchical address is the canonical form; world-space position is a view-dependent projection computed on the GPU.

2. **Deduplication is separated from encoding.** The bit-concatenated composite coordinates serve both the dedup bit-table and the Morton sort, while the per-level packed encoding serves the GPU independently.

3. **Structural gaps are separated from content scale.** The inflation system ensures that gap adjustments at any level propagate proportionally to inner content, preserving visual legibility across the hierarchy.

4. **Color is separated from geometry.** Both are reconstructed from the same packed integers, with palette mapping applied as a post-process in the vertex shader.

5. **Buffer content is separated from visual parameters.** The packed buffer changes only on heavy operations (file load, data type change, level reconfiguration). Everything else — gaps, inflation, projection mode, palette, scale, point size, spatial filtering — is a uniform change.

---

## 2. Input: Binary Data as N-Tuple Streams

### 2.1 Data Type Interpretation

The input to Stratum is an `ArrayBuffer` of arbitrary binary content. A configurable data type defines how to extract scalar values from the byte stream. Fifteen types are supported, spanning integer representations (uint4, uint8, uint16, uint32, int4, int8, int16, int32), IEEE and non-standard floating point (fp4/E2M1, fp8/E4M3, fp8/E5M2, fp16, bf16, fp32, fp64), with configurable endianness for multi-byte types.

Every N consecutive scalars form a **tuple** — a point in an N-dimensional normalized coordinate space. The standard configuration uses N=3, producing a point cloud in 3D space, but the framework generalizes to arbitrary N (see §11).

### 2.2 Normalization

Integer types are normalized to a uniform 32-bit unsigned domain via linear scaling:

```
v_norm = (v - type.min) / (type.max - type.min) × (2³² - 1)
```

Floating-point types pass through a `tanh` mapping that compresses the infinite float range into the unit interval while preserving sign and relative magnitude:

```
v_norm = (tanh(clamp(f, -20, 20)) × 0.5 + 0.5) × (2³² - 1)
```

This normalization is critical: it maps every supported data type into a common domain where the subsequent decomposition operates uniformly, regardless of the original value range or representation.

### 2.3 What Binary Data Looks Like

Different file types produce characteristic point-cloud signatures when decomposed as 3-tuples:

- **Compressed data** (JPEG, ZIP, LZ4) fills the cube nearly uniformly — high entropy distributes tuples across the value space with few repeated patterns.
- **Structured formats** (ELF executables, PDF, SQLite) produce distinctive clusters reflecting header structures, code sections, padding regions, and alignment patterns.
- **Machine learning weights** in fp16 or bf16 exhibit concentrated distributions near zero with long tails, creating characteristic shapes under the tanh normalization.
- **Raw sensor data** often reveals periodic structures, quantization artifacts, and noise floors as distinct spatial features.

The visualization functions as a binary data fingerprint — a spatial signature that reveals structure invisible to hex editors and statistical summaries.

---

## 3. Multi-Level Hierarchical Decomposition

### 3.1 The Mixed-Radix Number System

The core algorithm decomposes each normalized coordinate through a chain of L quantization levels. Each level is parameterized by a bit-width b defining d = 2^b divisions per axis, and a gap factor controlling visual separation between cells. Levels are ordered outer to inner: Level 0 is the coarsest partition, Level L−1 is the finest.

For each normalized value r ∈ [0, 1), the decomposition maintains a remainder that propagates through levels:

```
rem = r

for level i = 0, 1, ..., L−1:
    d_i = 2^(bits_i)
    ix_i = min(d_i − 1, ⌊rem × d_i⌋)
    rem = rem × d_i − ix_i
```

The output is a **hierarchical address**: the chain of indices ix₀, ix₁, ..., ix_{L-1}. Applied independently to each of the 3 (or N) axes, this produces a chain of index triples that locates the tuple within a nested grid structure.

This is mathematically a mixed-radix expansion. The original coordinate can be reconstructed (up to quantization error) by the inverse accumulation:

```
val = ix₀/d₀ + ix₁/(d₀·d₁) + ix₂/(d₀·d₁·d₂) + ...
```

The effective resolution per axis is the product of all divisions: D_eff = ∏ d_i. For the current 3-tier configuration at 4 bits each, D_eff = 16³ = 4096 positions per axis from a chain of small integers. For four levels of 64 divisions each, D_eff = 64⁴ = 16,777,216 — over 16 million distinct positions per axis.

### 3.2 The Hierarchical Address as Canonical Representation

A key insight that emerged during implementation: the hierarchical address chain is not merely an intermediate step toward world-space coordinates — it is the **canonical data representation** from which all derived quantities are projections.

When the index digits for each axis are bit-concatenated across levels:

```
fullX = (ix₀ << Σb_{1..L-1}) | (ix₁ << Σb_{2..L-1}) | ... | ix_{L-1}
```

the resulting B-bit composite coordinates (fullX, fullY, fullZ) serve as a universal identifier for the cell. This single intermediate representation feeds three consumers simultaneously:

1. **GPU packed encoding**: `(ix << 16) | (iy << 8) | iz` per level — the vertex attribute.
2. **Deduplication**: `(fullZ << 2B) | (fullY << B) | fullX` as bit-table index — O(1) uniqueness test.
3. **Spatial sorting**: bit-interleaved Morton code from (fullX, fullY, fullZ) — cache-coherent buffer order.

The hierarchical address is the number. Everything else is a view of it.

### 3.3 The Address Tree

The set of all possible hierarchical addresses forms a tree of depth L. The root represents the entire unit cube. Each node at level i has d_i³ children. A leaf at depth L represents a single finest-level cell. The total capacity is ∏ d_i³ leaves, but for typical inputs only a tiny fraction are occupied — a 1MB file as uint8 triples produces ~333K points occupying at most 333K of the 2^(3B) possible leaves. The tree is extremely sparse.

This tree structure enables several operations through simple bit manipulation:

- **Prefix truncation**: dropping the last k levels yields the address of a coarser ancestor cell — the spatial equivalent of going from a street address to a zip code.
- **Sibling enumeration**: cells sharing the same prefix but differing at a given level tile their common parent cell.
- **Depth as resolution control**: adding or removing levels refines or coarsens the entire grid, with dramatic visual effect — at L=1 a torus is a cloud of blobs; at L=3 each blob reveals hundreds of finer cells.

---

## 4. Bit-Table Deduplication

### 4.1 Motivation

When multiple input tuples quantize to the same hierarchical address — which is common for large files with repetitive structure — the duplicates must be collapsed. The original approach used JavaScript `Set` objects with string keys, incurring per-tuple string allocation, variable-length hashing, and memory proportional to the unique count.

### 4.2 The Bit-Table Approach

The composite flat index derived from the hierarchical address is already an integer suitable for indexing into a bit array. When the total bit-depth 3B ≤ 30, this index maps directly into a `Uint32Array` used as a bit table, providing O(1) constant-time, zero-allocation deduplication with fixed memory of 2^(3B)/8 bytes.

For the current 3-tier × 4-bit configuration (B = 12, 3B = 36 exceeding the flat table limit), the implementation uses a GPU-side 128MB atomic bit table with a 30-bit address space, processing the decomposition and deduplication in a single compute shader pass with workgroup-local atomic accumulation.

### 4.3 Occupancy as a Diagnostic

The bit table makes the grid's total capacity explicit. The occupancy ratio U / 2^(3B) becomes a first-class diagnostic:

- Below 0.01%: very sparse — typical for surfaces in high-resolution grids.
- 1–10%: moderately populated — volumetric data or low-resolution grids.
- Above 50%: dense — the grid is too coarse for the data; consider adding a level.
- Near 100%: saturated — dedup has no benefit; the data fills the representable space.

### 4.4 Analytical Applications

The fixed-size, content-independent memory footprint of the bit table enables operations beyond deduplication:

- **Diff visualization**: XOR of two files' bit tables identifies the symmetric difference at O(2^(3B)/32) word operations — far faster than byte-level diff, with the result immediately visualizable.
- **Cross-file correlation**: bitwise AND counts shared quantized tuples, functioning as a fast similarity metric.
- **Entropy mapping**: occupancy at different hierarchy depths reveals local entropy structure — fully occupied outer cells with sparse inner cells indicate repeating patterns; sparse outer cells with uniform inner occupancy indicate high entropy.

---

## 5. GPU Pipeline

### 5.1 Packed Attribute Encoding

Each point is encoded as a single `vec4` attribute (16 bytes), where each component stores one nesting level's index triple:

```
component = float( (ix << 16) | (iy << 8) | iz )
```

For L < 4 levels, unused components are zero. All values are below 2²⁴, ensuring exact representation in float32. This encoding halves GPU memory versus storing separate position and color float32 attributes.

### 5.2 Compute Pipeline

The WebGPU compute shader fuses the entire data pipeline into a single dispatch:

1. **Decode**: 15 data type interpreters (uint4 through fp64, LE/BE) read raw bytes from a staging buffer.
2. **Normalize**: map decoded values to the 32-bit unsigned domain.
3. **Decompose**: extract tier indices via bit-shifting from the normalized value.
4. **Deduplicate**: atomic bit-table probe and set, with workgroup-local accumulation reducing global contention by 256×.
5. **Pack**: encode surviving unique points as the `vec4` format.
6. **Count**: atomic counter feeds the indirect draw buffer.

The entire pipeline streams through the input once with zero intermediate allocation. For 10MB of uint8 data (~3.3M tuples), processing completes in 100–300ms on commodity hardware.

### 5.3 Render Pipeline

The vertex shader unpacks the `vec4` via bit-shift extraction, then reconstructs world-space coordinates by iterating levels and summing offset contributions. A mode uniform selects between projection paths (3D, Tiled 2D, Atlas 3D). The same unpacked indices feed the color reconstruction via inner-to-outer accumulation, producing RGB values from the hierarchical address without any additional per-point data.

The fragment shader renders billboard point sprites with circular SDF discard, applies SDF-based cross-section slab and AABB clipping with CSG composition (intersect/union/subtract), and modulates alpha for soft-edge effects.

### 5.4 The Three-Tier Update Model

| Trigger | Pipeline cost | What changes |
|---|---|---|
| Gaps, inflation, projection mode, palette, point size, gravity, clipping | **Uniform only** — sub-millisecond | Stride/center/scale recomputed per frame |
| Buffer sort order toggle | **Medium** — buffer reorder | Morton-sort cached packed buffer |
| File load, data type, endianness, bit shift | **Heavy** — full compute | Decode → dedup → pack dispatch |

This separation is the core design win. All visual exploration — gap adjustment, projection switching, spatial filtering, gravity — operates at uniform-only cost regardless of point count.

---

## 6. Spatial Reconstruction and Projection Modes

### 6.1 3D Spatial Projection

The default mode maps the hierarchical address to an isotropic three-dimensional position. Each level contributes an offset proportional to its index times a stride value that accounts for the number of cells at finer levels. Configurable gaps at each level introduce spacing between cells, making the hierarchical nesting visually legible — the data appears as a mosaic of mosaics, with coarse cells visibly containing finer sub-cells.

### 6.2 Tiled 2D Projection

The tiled mode folds the Z-axis at each level into a rectangular tile grid, projecting the full three-dimensional hierarchy onto a flat plane as a fractal mosaic. For d divisions along Z, the fold produces √d columns and √d rows of tiles, each containing the X-Y slice for that Z value. Applied recursively across levels, this produces a self-similar tiling where each tile contains a complete sub-mosaic of the next nesting level.

At four levels of 64³ divisions, the tiled projection spans ~68 billion cells per axis — renderable as a point cloud but impossible as a texture, and illegible as flat float32 coordinates, yet perfectly tractable as ~200K points reconstructed from 72 bits of packed integer address each.

### 6.3 Atlas 3D Projection

The Atlas 3D mode resolves a fundamental tension: 2D projections sacrifice depth perception, while 3D views suffer occlusion. Atlas 3D flattens only the macro tier into a 2D tile grid while preserving the meso and micro tiers as 3D sub-scenes within each tile. The result is a flat grid of miniature dioramas — each macro cell becomes a small 3D world containing its interior population.

A depth-scale parameter continuously blends between flat (equivalent to Tiled 2D) and full-cube 3D sub-scenes. An independent sub-rotation matrix (controlled by middle-drag) rotates all dioramas simultaneously while the atlas remains fixed, enabling inspection of 3D structure within the overview context.

### 6.4 The Projection Spectrum

The three modes form a spectrum of dimensionality reduction:

| Mode | Tiers flattened | Tiers in 3D | Character |
|---|---|---|---|
| 3D Spatial | 0 | All | Full 3D, occluded macro structure |
| Atlas 3D | 1 (macro) | 2 (meso+micro) | Grid of dioramas |
| Tiled 2D | All | 0 | Pure flat fractal mosaic |

If each tier's flatness were independently controllable, the named modes become corners of an L-dimensional parameter cube. The continuous depth-scale slider already demonstrates this principle within Atlas 3D.

---

## 7. Gap Inflation

### 7.1 The Problem

In a naive hierarchical layout, increasing the gap at an outer level pushes inner cells apart by large distances (because the gap multiplies the outer stride, which is the base for all inner positions). Meanwhile, the inner cells themselves don't grow — their visual proportion shrinks toward zero. At large outer gaps, the inner structure becomes invisible: tiny dots separated by vast empty space.

### 7.2 The Solution

Gap inflation introduces a multiplicative scaling factor that propagates outer gap sizes into inner strides. When the gap at level i increases, the stride at level i+1 grows proportionally, ensuring that inner content expands to fill the visual space created by the outer gap.

The inflation parameter (0 to 1) controls propagation strength:

- At 0: no inflation. Inner cells maintain fixed size regardless of outer gaps. Increasing outer gap makes inner structure vanish.
- At 0.5: partial inflation. Inner cells grow, but not enough to fill the expanded space. Visual proportion degrades gracefully.
- At 1.0: full inflation. Inner cells scale proportionally. The ratio of inner cell size to outer spacing is preserved regardless of gap settings.

This is a uniform-only change — zero shader modification required, zero buffer rebuild. The inflated strides feed directly into the position reconstruction formula.

---

## 8. Color: The Position-Color Isomorphism

### 8.1 Coordinates as Colors

Colors are reconstructed in the vertex shader from the same packed indices that produce position. The inner-to-outer accumulation:

```
nc = (0, 0, 0)
for i from L−1 down to 0:
    nc = (nc + (ix_i, iy_i, iz_i)) / d_i
```

recovers nc ≈ (rx, ry, rz), the original normalized coordinate. Interpreted as RGB, this maps 3D spatial position directly to color: the red channel encodes X, green encodes Y, blue encodes Z. Points in the same coarse cell share similar dominant color (set by the outer digits) with subtle variation from inner digits.

### 8.2 Why This Works

This is not a coincidence — it is a direct consequence of the mixed-radix structure. The hierarchical address *is* the number. Composition reconstructs the number. Whether we interpret the result as a spatial coordinate or a color channel is a downstream choice. The GPU computes both from the same packed integers using the same arithmetic, differing only in what the result drives (`gl_Position` vs. vertex color output).

Color is not a separate data channel — it is a **view** of the same hierarchical address that produces position.

### 8.3 Multi-Level Color Legibility

The color encoding makes the hierarchical structure visually legible without explicit boundary rendering:

- **Level 0** digits determine dominant hue (broad color regions).
- **Level 1** digits modulate within that hue (visible as color banding within regions).
- **Level 2+** digits add fine texture (subtle gradients within bands).

This is perceptually analogous to how a topographic map uses color: coarse elevation determines the hue zone, fine elevation adds contour detail. Beyond this natural RGB mapping, a palette system can remap the recovered coordinates through perceptual color ramps (Spectrum, Inferno, Neon, Aurora, Ember, Frost, Mono) for domain-specific emphasis.

---

## 9. Spatial Filtering: Cross-Section Slabs and Clipping Volumes

### 9.1 SDF-Based Fragment Clipping

Point clouds are inherently occluded — front points obscure back points. Stratum implements spatial filtering via signed distance fields (SDFs) evaluated in the fragment shader:

**Cross-section slabs** are defined by a plane (position + normal) and a thickness. Points within the slab are visible; points outside are discarded. The slab slides through the point cloud like a CT scan, revealing internal structure. The signed distance from the plane also drives soft-edge alpha fadeout, depth coloring, and distance-based sizing — creating a focal-plane effect where the slab center is sharp and edges soften.

**Axis-Aligned Bounding Boxes** (AABBs) define a rectangular clipping volume with 6-axis min/max controls. In include mode, only points inside the box survive; in exclude mode, the box carves away a region.

### 9.2 CSG Composition

When both slab and AABB are active, a CSG mode selects how they combine:

- **Intersect**: point must be inside both volumes.
- **Union**: point must be inside either volume.
- **Subtract**: point must be inside the slab but outside the AABB (or vice versa).

This provides surprising analytical power from simple primitives — the ability to isolate a thin cross-section within a bounded region, or carve specific volumes out of a broader slice.

### 9.3 Wireframe Gizmos

Both the slab plane and the AABB box are rendered as wireframe overlays with alpha-controllable visibility, providing spatial context for the clipping geometry. These are conventional line primitives sharing the same view transform as the point cloud.

---

## 10. The Floating Origin: Precision at Scale

### 10.1 The Float32 Precision Wall

IEEE 754 float32 has a 23-bit mantissa, giving ~16.7 million exactly representable integers. When world-space coordinates are materialized as float32, any effective resolution exceeding ~16M per axis causes aliasing — distinct cells map to the same float value. For the tiled 2D projection, which multiplies extent through Z-folding, this wall is hit at just three nesting levels with 64 divisions per level.

### 10.2 Why Packed Integers Bypass the Wall

The packed integer representation sidesteps this entirely. Each index is stored as an exact integer in float32 (all values ≤ 2²⁴ − 1 are exact). The vertex shader reconstructs coordinates by multiplying these exact integers by stride uniforms — single numbers per level, not per point. Distinct hierarchical addresses always produce distinct reconstructed positions because the integer indices are exact and the stride multipliers preserve their separation.

### 10.3 Relative Focus Shifting

For navigation at extreme depth, the engine decouples the universe origin from the camera focus. A `focusAddress` — a hierarchical path representing the cell under inspection — is subtracted from each point's address at every level *before* multiplying by the stride:

```
pos_rel = Σ_{i=0}^{L-1} ((index_i - focus_index_i) × step_i)
```

This ensures the point of interest is always near the mathematical origin, providing sub-pixel stability regardless of depth. Combined with semantic zoom (where exceeding a scale threshold triggers a "focus promotion" — updating the focus address and resetting the scale), the engine supports seamless infinite zoom through the hierarchy.

---

## 11. N-Dimensional Generalization

### 11.1 Beyond 3-Tuples

The decomposition applies independently to each axis and therefore generalizes trivially from 3 dimensions to N. Reading N consecutive scalars per tuple embeds each point in the N-dimensional unit hypercube. The hierarchical decomposition, bit-concatenation, and deduplication operate per-axis without modification.

The challenge is projection: we have at most 3 spatial dimensions (or 2 on a flat display) but potentially many more data dimensions. The tiled 2D projection provides the solution: instead of folding 1 axis (Z) to go from 3D to 2D, we fold N-2 axes to go from ND to 2D. Each folded dimension contributes a layer of tiles within tiles, producing a recursively nested mosaic that encodes the full N-dimensional structure.

### 11.2 Fold Order and Navigation

The order in which dimensions are folded determines which dimensions appear as spatial extent (the innermost display axes) and which appear as tiling structure (the folded axes). Changing fold order is a uniform change — the packed buffer is stable. Interactive axis selection lets users explore the data from every 2D perspective.

Gap inflation becomes critical for high-dimensional folds: without it, inner content shrinks exponentially with each fold level. With inflation, inner tiles maintain visual proportion, keeping the content navigable at every zoom depth.

### 11.3 Comparison to Dimensionality Reduction

Unlike PCA, t-SNE, and UMAP — which project away dimensions, destroying information — the Nested Mosaic folding preserves all dimensions. The price is that N-2 dimensions are encoded as tile structure rather than spatial extent, requiring hierarchical zoom to explore. But the encoding is lossless and reversible, and the exploration is interactive.

---

## 12. Morton Z-Curve Ordering

The output buffer benefits from spatial coherence: when adjacent vertices in buffer order are spatially adjacent, GPU vertex cache hit rates improve and memory access patterns align with cache lines.

The Morton (Z-order) curve provides this coherence by bit-interleaving the composite coordinates into a single sort key. For B ≤ 10 (the current 30-bit address space), the Morton key is a single u32. Properties that make Morton ordering particularly valuable:

- **Spatial locality**: nearby cells have nearby Morton keys.
- **Hierarchical consistency**: truncating the Morton key yields a coarser cell's key — natural for LOD and frustum culling.
- **Layout invariance**: the sort order depends only on the hierarchical address, not on gaps, inflation, or projection mode. Sort once per compute, use across all visual parameter changes.

---

## 13. Export and Interoperability

### 13.1 PLY Export

The viewer exports the current view as PLY point clouds (ASCII or binary), mirroring the vertex shader's reconstruction on the CPU. The export reflects the active projection mode, gap settings, and inflation, enabling round-trip workflows: import any binary file, decompose it through the hierarchy, export a PLY of the resulting point cloud, and load it into MeshLab, CloudCompare, Blender, or any 3D tool.

### 13.2 Scene Graph Formats

The hierarchical address structure maps naturally to scene graph formats like glTF and USD. Macro cells become top-level nodes, meso cells become children, micro points become leaves — with gap transforms at each level. GLB (binary glTF) is the best balance: binary vertex data plus JSON scene graph, with file sizes comparable to the GPU buffer itself.

### 13.3 Visual State Preservation

A full visual state export reconstructs positions in the active projection mode, bakes gravity-based sizing and brightness into per-point attributes, applies slab and AABB clipping (discarding filtered points), and includes camera parameters. This enables production-quality offline rendering of the visualization in path tracers and DCC tools.

---

## 14. Computational Complexity

| Phase | Time | Space |
|---|---|---|
| Tuple reading + normalization | O(N) | O(1) streaming |
| Hierarchical decomposition | O(N × L) | O(1) per tuple |
| Bit-concatenation (fullX/Y/Z) | fused | fused |
| Deduplication (bit table, 3B ≤ 30) | O(N) | O(2^(3B)/8) fixed |
| Packed encoding | fused | fused |
| Morton sort (when requested) | O(U log U) | O(U) keys |
| GPU upload | O(U) | 16 bytes × U |
| Per-frame rendering | O(U) vertex shader | — |
| Uniform update (all visual params) | O(L) | — |

Where N = total tuples, L = nesting levels (≤ 4), U = unique points after dedup, B = total bits per axis. Decomposition, bit-concatenation, dedup, and packing are all fused into a single pass with zero intermediate allocation.

---

## 15. Implementation

### 15.1 Single-File Architecture

The entire application is a single HTML file containing inline CSS, HTML, JavaScript, and embedded WGSL shader source. No build step, no bundler, no frameworks. The only external dependency is the WebGPU API provided by the browser. This constraint is intentional: the tool can be shared as a single file, opened directly in a browser, hosted on any static server, or embedded in documentation.

### 15.2 Streaming via File.slice()

JavaScript heap memory equals the processing window size, not the file size. `File.slice()` reads chunks from disk into GPU staging buffers, enabling multi-gigabyte files to be processed with fixed memory overhead. The scrub timeline lets users slide a window through the file and adjust its size, treating the file as a spatial landscape to be explored temporally.

### 15.3 GPU Buffer Allocation

All GPU buffers are allocated once at initialization and reused across all dispatches:

| Buffer | Size | Purpose |
|---|---|---|
| bitTable | 128 MB | Dedup bit array (30-bit address space) |
| output | up to 768 MB | Packed point data (storage + vertex) |
| rawData | 128 MB | Staging for file chunks |
| indirect | 20 B | Draw indirect arguments |
| renderUniform | 240 B | All render uniforms |
| computeUniform | 32 B | Compute dispatch parameters |

---

## 16. Applications

### 16.1 Binary Forensics

Stratum reveals structure in binary data that is invisible to conventional tools. Compressed regions appear as uniform distributions; structured headers produce distinctive clusters; alignment patterns create geometric regularity. The visualization functions as a binary data fingerprint, enabling rapid format identification and anomaly detection without prior knowledge of file structure.

### 16.2 Machine Learning Weight Inspection

Neural network weight files (safetensors, GGUF, checkpoints) produce characteristic point-cloud signatures when viewed through Stratum. The tanh normalization maps the typical weight distribution (concentrated near zero with long tails) into a shape that reveals quantization artifacts, layer boundaries, dead neurons (zero-weight regions), and the difference between trained and random initialization.

### 16.3 Chaotic Attractor Visualization

Strange attractors (Lorenz, Thomas, Rössler) produce visually striking hierarchical decompositions. The fractal nature of the attractor resonates with the hierarchical nesting, creating self-similar visual patterns at each zoom level. The Tiled 2D projection of an attractor produces a fractal mosaic that reveals the attractor's structure at every scale simultaneously.

### 16.4 Scientific and Volumetric Data

Any data expressible as point clouds — medical imaging voxels, particle simulations, LiDAR scans, molecular coordinates — can be loaded directly. The hierarchical decomposition provides automatic multi-resolution representation, and the three projection modes offer complementary views of the same data.

---

## 17. Future Directions

### 17.1 Tiered Bit Tables for Deep Hierarchies

The current 128MB bit table supports 30 bits of address space. Supporting 4+ nesting levels at 8 bits each would require 96-bit addresses. A tiered approach — small bit table for outer levels, per-outer-cell hash sets for inner refinement — would handle deep hierarchies without astronomical memory requirements.

### 17.2 Hierarchical Frustum Culling

The flat dedup index preserves level structure: outer bits are MSBs. Masking off inner bits yields the outer-level cell index, enabling a two-pass approach: build coarse occupancy, test against the view frustum, dispatch inner-level processing only for visible macro cells. Combined with Morton ordering, frustum culling becomes a simple range query on the sorted buffer.

### 17.3 Multi-Resolution Level of Detail

The packed encoding naturally supports LOD. At extreme zoom-out, only tier-0 indices matter. A LOD system could maintain separate draw ranges per resolution level, switching via draw count changes with zero data movement.

### 17.4 Fractal Zoom

The Dive control (bit shift) already selects which bits of the 32-bit value drive the hierarchy. Animating this shift produces a "fractal zoom" — smoothly descending through precision levels, with each zoom revealing structure at the next bit depth. Combined with animated camera zoom and focus promotion, this enables seamless infinite descent into the data.

### 17.5 Sonification

The hierarchical address maps naturally to audio parameters. Morton-ordered traversal of the point cloud produces a spatial scan that can be mapped to frequency, amplitude, and stereo position — converting the visual structure into an audible one. Entropy variations become timbral changes; density becomes volume.

### 17.6 Embedding Visualization

For machine learning embeddings (N = 768 for BERT, N = 1536 for GPT-family), the N-dimensional generalization could visualize embedding spaces directly. With PCA-selected display axes and the remaining dimensions folded, clustering in embedding space would appear as tile-level co-occurrence.

---

## 18. Conclusion

Stratum demonstrates that the humble act of grouping bytes into tuples and decomposing them through a hierarchy of quantization levels produces a surprisingly rich analytical and visual framework. The key insight — that the hierarchical address is the canonical representation from which all other quantities are projections — enables an architecture where a single 16-byte-per-point buffer, uploaded once, supports instantaneous switching between projection modes, color palettes, gap configurations, spatial filters, and export formats.

The system transforms the abstract mathematical structure of mixed-radix decomposition into an interactive, GPU-accelerated exploration tool — equally applicable to binary data forensics, chaotic attractor visualization, ML weight inspection, scientific volumetric data, and any domain where hierarchical spatial structure reveals pattern invisible to conventional tools.

Data is not flat. Data is not a list. Data is a landscape — stratified, structured, and navigable. Stratum makes that landscape visible.

---

*This document consolidates and extends the Nested Mosaic whitepaper, bit-table deduplication research, gap inflation theory, mixed-radix coordinate analysis, N-dimensional generalization, navigation engine theory, Atlas 3D projection design, cross-section filtering design, and observations from the proof-of-concept implementation.*
