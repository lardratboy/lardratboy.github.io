# vdb → vdag

*Asked for 2026-11-24: "an OpenVDB to vdag converter tool similar to the ply/glb one … I am keeping this part separate so we can have third-party open source MIT or zlib licenses only. Only use outside source after consulting me."*

`vdb/index.html` (serve the repo root with `npm run serve`, then open `http://localhost:8000/vdb/`). Drop `.vdb` files or choose them. Each file's grids are listed, and the converter picks one to take the shape from: a level set's inside, or a fog volume's density over a threshold, made solid. A colour grid, if there is one, is baked onto the surface. Each depth comes back as a `.vdag` with a front picture and a link to save it, as on [convert/](../convert/).

At the top: the depths (D = 6 to 10, and **native**, one world voxel a grid voxel), six or eight bits a channel, sampling (trilinear or nearest) and the up axis. Each file has its own choices: which grid, what's solid, the threshold and the colour. They're filled with what the converter chose once the file is read; change them and press "again". Settings are kept per browser. One file at a time, in a worker; cancel ends the worker. Nothing leaves the machine.

`node vdb/vdb-vdag.mjs <file.vdb …> [--list] [--D=8,10,native] [--grid=] [--solid=inside|above|active] [--threshold=] [--sampling=] [--colour=] [--up=] [--bits=] [--out=]` is the same conversion from the command line, writing the page's bytes. `--list` prints the grids and what it would choose.

## Licences: nothing outside

There is **no third-party code** in vdb/. The decoders a `.vdb` needs were written here from the formats' own descriptions: zlib's inflate (RFC 1950/1951), LZ4's block format, Blosc 1's chunk layout, and IEEE half floats (`codecs.js`, about 200 lines). OpenVDB's I/O was written from what its writer puts in a file (and checked against files it wrote; see Tests). three.js was offered and isn't used: the pictures and the stream viewer were enough.

Where outside code would come in, and why I stopped short (each for you to decide):

- **zstd and blosclz** inside Blosc. OpenVDB itself always asks Blosc for LZ4 (`bloscToStream`), and every file here is LZ4. A file whose Blosc chunks are zstd or blosclz is refused with the codec's name. A zstd decoder is a big piece of code; if one is ever needed, there are MIT ones to look at first.
- **Point data grids** (`Tree_ptdataidx32_…`, OpenVDB points, Houdini's VDB points). These are listed with a reason and not read. They're attribute arrays with their own paged compression, a different reader. They could become point clouds the PLY way (`growCloud`). See question 1.

## The format, as the reader reads it

(`vdb-core.js`; the article you sent, [VDB: a deep dive](https://jangafx.com/insights/vdb-a-deep-dive), agrees with the header, the strings, the metadata, the descriptor and the topology, and says it leaves out compression, tiles, mask compression and bool or mask leaves. Those are written here from OpenVDB's own reader and held to its files.)

```
header        " BDV" 0 0 0 0         8 bytes of magic
              file version           u32 (read from 222: compression per grid; 224 now)
              library major, minor   u32, u32
              has grid offsets       u8
              UUID                   36 ASCII characters
              file metadata          u32 count, then (name, type name, u32 size, value)
              grid count             i32 (written with offsets or without)
per grid      unique name            u32-length string (a "\x1e" suffix tells duplicates apart)
              type                   "Tree_float_5_4_3", "_HalfFloat" if saved as half
              instance parent        string ("" if none; an instance has no tree)
              grid, block, end       i64 offsets (0 in a stream)
  at grid     compression flags      u32: 1 zlib, 2 active mask, 4 Blosc
              metadata               class ("level set", "fog volume"), file_bbox_min/max, …
              transform              a map's name, then its doubles (Scale(Translate)Map:
                                     translation, scale, voxel size and three inverses;
                                     AffineMap: a 4 × 4, row vectors; a frustum: its box,
                                     taper, depth and a second map)
              topology               i32 1 (buffers a leaf), background (full precision),
                                     u32 root tiles, u32 root children; each tile its origin,
                                     value, active byte; each child its origin, then depth
                                     first: child mask, value mask, tile values, children
                                     in slot order; a leaf's topology is its value mask
              buffers                each leaf in the same order: its mask again, its values
values        a byte saying what was left out (codes 0–6 below), up to two inactive values,
              a selection mask, then the values: only the active ones if the grid has the
              active-mask flag, through zlib or Blosc behind an i64 size (≤ 0: |size| raw
              bytes), as halves if the type says so (and nothing at all for no halves)
```

A node's slot `i` is `x << 2n | y << n | z` for its local coordinates (x major, z minor), and a mask is 64-bit words, little-endian, bit `i & 63` of word `i >> 6`. The tree is 5-4-3 in practice (a top node of 32³ children of 16³ leaves of 8³ voxels, 4,096 voxels a side). The reader takes any sizes the type names; tests cover 4-3 and 3-3-3-3.

**The inactive-value codes** (`readCompressedValues`). Each node, and each leaf, can leave out its inactive values:

| code | written | the inactive voxels are |
| --- | --- | --- |
| 0 | nothing | the background |
| 1 | nothing | minus the background (a level set's inside) |
| 2 | one value | that value |
| 3 | a mask | the background where the mask is on, minus it where off |
| 4 | a value and a mask | the background where on, the value where off |
| 5 | two values and a mask | the second where on, the first where off |
| 6 | every value | (no mask compression in this node) |

"The background" is the root's, which OpenVDB tags the stream with as it reads the root.

**Two traps.** Blender's fluid cache "ZIP" setting writes flags 2 (active mask only, no zlib at all): no real file here is zlib. And with no flags (Blender's "None"), every internal node writes all 32,768 (or 4,096) tile values, which is why that cache is 800 KB for 8³ voxels of smoke.

The reader keeps every value as **float32**, whatever the grid's type (half, double, int). A converter only compares and interpolates values. A root tile's value and the background stay whole. `probe(x, y, z)` answers a voxel's value and active bit the way OpenVDB's accessor does (leaf voxel, else the deepest node's tile, else the root tile, else the background), caching the last leaf and root entry.

**Big files.** The worker hands the reader the `File` itself. It reads the header, then each grid's descriptor, metadata and transform (64 KB at a time, growing only if needed), then **only the grids the conversion asks for**, each grid's bytes once. A file of eight grids where you use two never holds the other six. The grid's values are held decompressed (2 KB a leaf as float32). A 500,000-leaf simulation would be a gigabyte, the limit to know about.

## What's solid

A grid is a value at every integer point of its index space (a voxel's value sits at its centre). The world's voxel v asks the grid at its centre's place p, by one rule, **g(p) > 0**:

| rule | g | used for (by default) |
| --- | --- | --- |
| inside | threshold − value | a level set (threshold 0) |
| above | value − threshold | a fog volume (threshold **0.05**, so faint wisps don't swell it) |
| active | ±1 by the active bit | anything else: the grid's own topology |

A vec3 grid's value is its length. **Sampling:** trilinear interpolates g between the eight voxels round p (OpenVDB's BoxSampler), so a world finer than the grid gets smooth surfaces, not steps of grid voxels; nearest takes the voxel p falls in. *active* is always nearest. An axis with no fraction reads one voxel, not two, which is what makes native exact.

**The fit.** Native is one world voxel a grid voxel, at the smallest D that holds the grid with a voxel round it (capped at 12). Any other D scales the solid's box to 92% of the side, centred in x and z and 4% off the floor, as convert/'s clouds are. **Blender's caches are z-up** (the viewer is y-up). They're recognised by Blender's `file_base_resolution` entry, and up = auto turns them: world (x, y, z) reads grid (x, z, −y), a rotation, not a mirror.

**How it's built.** `store.fromField` asks a cell at a time. A cell's voxels sample p over a box of grid voxels: its corners' p, rounded out by the stencil, exact because p(v) is one monotone expression. `range()` answers from minima and maxima of g kept per leaf and per internal node, stopping as soon as it sees both signs. That alone was slow where the world is much finer than the grid: a cell within one grid voxel of the surface sees both signs in its stencil and was split to its voxels, a shell as thick as a grid voxel is wide. Blender's 10-voxel smoke at D = 10, about 94 world voxels a grid voxel, took 44 s for its shape.

The fix is that a trilinear g is multilinear between grid points, so over a box spanning at most two grid cells an axis its extremes are at the corners of the pieces the grid cuts it into. Those (at most 27) decide the cell exactly. The 44 s became 1.2 s, the same voxels.

**The skin** (the voxels a chunk can show: solid, with a face on air or the world's edge) comes from the shape's DAG, not the grid. One walk down carries each node's six face neighbours, so a neighbour is a child away. Resampling the grid seven times a voxel had been most of the time. A world with no colour skips it.

## Colour

The words are one per skin voxel in rank (Morton) order, a baked field as convert/'s:

| `--colour` | what | default when |
| --- | --- | --- |
| `grid:<vec3>` | Houdini's `Cd`: linear RGB, to sRGB by ^(1/2.2) as glb-core does vertex colours | a vec3 grid named Cd, color, colour, col, albedo, rgb or diffuse, whose box meets the shape's |
| `rgb:<r>,<g>,<b>[/<d>]` | three scalar grids, divided by a fourth | Blender's `color_r`, `_g`, `_b`; divided by `density` in Blender's caches (it keeps colour premultiplied by density) |
| `heat:<grid>`, `grey:<grid>` | a scalar through a ramp over its active values' range | never |
| `none` | the shape alone; the viewer draws it in gamut | otherwise |

Each colour grid is asked in its own index space, through world space when its transform isn't the shape's (the fixture's temperature grid has twice the voxel size). Only its **active** voxels are interpolated, so colour doesn't fade to the background's black at the smoke's edge. A heat ramp of a fog's own density is nearly black: its surface is at the threshold density by construction. Temperature or flame show more.

## What it can't do yet (and says so)

- **Frustum and turned grids** are converted in their index space. A grid whose voxels aren't cubes in the world, or that's turned, gets a note ("drawn as cubes", "drawn in its own index space"). See question 3.
- **File versions before 222** (before compression went per grid) are refused with the version number.
- Point data grids, point index grids, string grids, and Blosc's zstd, blosclz and snappy: refused with a reason (above).

## Measured

On this machine (M2 Max, Node 22), the CLI:

| file | grid | depths | shape | skin + words | total |
| --- | --- | --- | --- | --- | --- |
| Houdini `smoke.vdb` (2.5 MB, half, 3,117 leaves, 105 × 217 × 105) | density > 0.05 | D = 8, 10, native (8) | 0.14, 2.0, 0.11 s | (no colour) | 2.7 s |
| the same, heat-coloured by density | | D = 8, 10, native | 0.14, 2.0, 0.11 s | 0.15, 2.9, 0.14 s | 6.4 s |
| Blender smoke (Blosc, half, 10 × 10 × 11) | density, colour ÷ density, z-up | D = 8, 10 | 0.08, 1.2 s | 0.27, 4.5 s | 6.6 s |
| pyopenvdb sphere (23³ level set) | inside | D = 8, 10 | 0.10, 1.4 s | (no colour) | 1.8 s |

Houdini's smoke at D = 10 is 31,260,817 voxels in 146,496 nodes, a 945 KB file (2.2 MB with its 2.58 million words).

## Tests

All under `npm test` (the Node ones, about 1.5 min together, mostly mutants) and `npm run test:browser` (the page).

- **`vdb/test/make-fixtures.py`** runs in Blender (its pyopenvdb is **OpenVDB 10.0**, the only copy on this machine) and writes `vdb/test/fixtures/`:
  - pyopenvdb's grids: a level-set sphere in full and as half, a fog with tiles across a root boundary, Cd, a double grid on another voxel size, int32, bool, a half vec3d, an affine-turned sphere, and a root tile;
  - one frame of a tiny Blender smoke-and-fire sim, cached three ways: Blosc + half, active-mask only, and nothing.

  Beside each it writes what OpenVDB reads back: every leaf voxel and its active bit, every tile that isn't inactive background (and a count of those), the leaf count, the transform at four points and the metadata. That's 2 MB in all.
- **`codecs.test.js`** (~1 s): inflate against Node's zlib at every level and strategy (8,000 buffers, 200 KB of stored blocks); every truncation throws, and a flipped bit throws or gives the original bytes. LZ4 and Blosc against the fixture's own encoders in every shape (split or not, the 0x10 flag, stored, several blocks with a leftover, zlib inside, type sizes 1 to 12). All 65,536 halves against their bits. Then **17 mutants**.
- **`vdb-core.test.js`** (~5 s, then ~50 s of mutants):
  - every value, active bit, tile, leaf origin, transform and metadata entry of the four real files, against OpenVDB's own reading, `===`;
  - then files from **`vdb-fixture.js`**, a writer of the tests' own (its own LZ4 and Blosc encoders, Node's zlib), for what no real file holds: zlib, raw chunks behind negative sizes, each inactive-value code 0–6 written on purpose (and seen written), half grids with no active values, mask, int64 and vec3i grids, node sizes 4-3 and 3-3-3-3, every map, a stream without offsets and an instance;
  - every truncation of a file throws `Damaged`, 400 files with a changed byte read or throw `Damaged` (never another error), and the refusals;
  - then **23 mutants**.
- **`vdb-convert.test.js`** (~3 s, then ~25 s of mutants):
  - 16 cases (level sets, fog, nearest, native, z-up, a vec3 shape, a mask grid, integers with g = 0 exactly, and a written block of solid tiles round a leaf with a hole), each sampled voxel by voxel the plain way and built by `fromDense` in the converter's store. It must be the converter's root by id, and so must its skin. Every word is held to colour worked out in the test, in a Morton order made bit by bit.
  - Then the whole conversion: files read back, the CLI's bytes, the defaults, refusals.
  - Then **25 mutants**.

  Three first tries survived and taught something. The hull's float tolerance is out of reach of every fixture; the mutants now hold what it must keep, g = 0 as air. A node's whole range used for part of it is only conservative, so the mutants now miss part of a box. And a leaf's range that ignores its inactive voxels needs a hole in a leaf with nothing but solid round it, which only a 64³ block made by hand has.
- **`vdb/test/browser/vdb.test.js`** (~15 s, then ~2 min of mutants): the page by its real controls (the file input, a drop, the depth boxes and menus, a file's choices changed and "again", a failure keeping the choices, a refusal, cancel mid-build, remove, settings across a reload). Every file is Node's `convertVdb` bytes. Then **13 mutants of the page's wiring**.

`node vdb/vdb-vdag.mjs ~/Downloads/smoke.vdb --list` reads your Houdini file; it isn't in the fixtures (its licence is unknown), but it was checked against OpenVDB's reading of it voxel for voxel (1,595,904 values, all equal) while this was built.

## Questions

1. **Point data grids.** Houdini's VDB points and OpenVDB's points are a common kind of `.vdb`. Worth a reader (attribute arrays, paged compression), turned into clouds the PLY way?
2. **The fog's default threshold**, 0.05. "Any density at all" (0) swells smoke with faint wisps; 0.05 looked right on Houdini's smoke. Keep it, or another value?
3. **Grids that aren't cubes in the world** (non-uniform voxel sizes, turned or frustum grids) are drawn in their own index space. Resample them in world space instead (a world voxel asks the grid through the inverse map)? It's the same machinery, a different p.
4. **Sequences** (`smoke.0001.vdb` …): one file a frame today. Anything wanted for a run of frames?
5. **Colour from linear grids** goes through ^(1/2.2), as glb-core's vertex colours do. Right for your files?
