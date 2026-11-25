# vdb → vdag

*Asked for 2026-11-24: "an OpenVDB to vdag converter tool similar to the ply/glb one … I am keeping this part separate so we can have third-party open source MIT or zlib licenses only. Only use outside source after consulting me."*

`vdb/index.html` (serve the repo root with `npm run serve`, then open `http://localhost:8000/vdb/`). Drop `.vdb` files or choose them. Each file's grids are listed, and the converter picks one to take the shape from: a level set's inside, or a fog volume's density over a threshold, made solid, or a point grid's points, made voxels as convert/ makes a PLY cloud's. A colour grid (or a point grid's Cd), if there is one, is baked onto the surface. Each depth comes back as a `.vdag` with a front picture and a link to save it, as on [convert/](../convert/).

At the top: the depths (D = 6 to 10, and **native**, one world voxel a grid voxel), six or eight bits a channel, sampling (trilinear or nearest), the up axis, **linear colour to sRGB** (the 1/2.2, on by default), and for point grids what a point fills and the opacity under which points are dropped. Each file has its own choices: which grid, what's solid, the threshold and the colour. They're filled with what the converter chose once the file is read; change them and press "again". Settings are kept per browser. One file at a time, in a worker; cancel ends the worker. Nothing leaves the machine.

`node vdb/vdb-vdag.mjs <file.vdb …> [--list] [--D=8,10,native] [--grid=] [--solid=inside|above|active] [--threshold=] [--sampling=] [--colour=] [--up=] [--bits=] [--gamma=on|off] [--point=cube:1|ball:2] [--opacity=0.2] [--out=]` is the same conversion from the command line, writing the page's bytes. `--list` prints the grids and what it would choose.

It reads **file formats 220 to 225**: OpenVDB 2 (OpenVDB's own sample `bunny_cloud.vdb` is 220) to OpenVDB 14 (225, which added half grids).

## Licences: nothing outside

There is **no third-party code** in vdb/. The decoders a `.vdb` needs were written here from the formats' own descriptions: zlib's inflate (RFC 1950/1951), LZ4's block format, Blosc 1's chunk layout, and IEEE half floats (`codecs.js`, about 200 lines). OpenVDB's I/O was written from what its writer puts in a file (and checked against files it wrote; see Tests). three.js was offered and isn't used: the pictures and the stream viewer were enough.

**OpenVDB itself, as a tool** (agreed 2026-11-24: "brew install openvdb"). Blender's pyopenvdb (OpenVDB 10) can read point data grids but not make one, so the point fixtures come from Homebrew's OpenVDB 14 (Apache-2.0), through `vdb/test/openvdb-tool.cpp`, a small program that links it to write files and say what it reads back. That program and its output are test material; nothing in `vdb/` imports or copies OpenVDB. The point layout below was written from OpenVDB 14's own source (the same release's tarball, `brew fetch --build-from-source openvdb`), read for the format, as its volume I/O was.

Where outside code would come in, and why I stopped short (each for you to decide):

- **zstd and blosclz** inside Blosc. OpenVDB itself always asks Blosc for LZ4 (`bloscToStream`), and every file here is LZ4. A file whose Blosc chunks are zstd or blosclz is refused with the codec's name. A zstd decoder is a big piece of code; if one is ever needed, there are MIT ones to look at first.

## The format, as the reader reads it

(`vdb-core.js`; the article you sent, [VDB: a deep dive](https://jangafx.com/insights/vdb-a-deep-dive), agrees with the header, the strings, the metadata, the descriptor and the topology, and says it leaves out compression, tiles, mask compression and bool or mask leaves. Those are written here from OpenVDB's own reader and held to its files.)

```
header        " BDV" 0 0 0 0         8 bytes of magic
              file version           u32 (read from 220; 225 now)
              library major, minor   u32, u32
              has grid offsets       u8
              compression            u8, 220 and 221 only: zlib (1) or none, the whole file's
              UUID                   36 ASCII characters
              file metadata          u32 count, then (name, type name, u32 size, value)
              grid count             i32 (written with offsets or without)
per grid      unique name            u32-length string (a "\x1e" suffix tells duplicates apart)
              type                   "Tree_float_5_4_3", "_HalfFloat" if saved as half
              instance parent        string ("" if none; an instance has no tree)
              grid, block, end       i64 offsets (0 in a stream)
  at grid     compression flags      u32: 1 zlib, 2 active mask, 4 Blosc (from 222)
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

**Before 222** (OpenVDB 2, formats 220 and 221) compression was the file's, a byte in the header, and the layout differs in three places. A node writes no metadata byte, so every value is there (code 6). An internal node writes tile values only for the slots with no child, in slot order. A leaf's buffer starts with its value mask, then its origin (three i32) and a buffer count (an i8, 1, or more for an older library's auxiliary buffers, which follow its values and are read and dropped). Files before 220 are refused: their headers and roots differ again, and OpenVDB 13 dropped them too.

**225** (OpenVDB 13) added the **half grid**, `Tree_half_5_4_3`: a value is two bytes everywhere (background, tiles, leaves), whatever the saved-as-half flag. Nothing else moved: OpenVDB 14's float, mask and vec3 grids read as 224's did.

**Two traps.** Blender's fluid cache "ZIP" setting writes flags 2 (active mask only, no zlib at all): no real file here is zlib. And with no flags (Blender's "None"), every internal node writes all 32,768 (or 4,096) tile values, which is why that cache is 800 KB for 8³ voxels of smoke.

### Point data grids

(`readPoints`; asked 2026-11-24, question 1.) A point data grid, `Tree_ptdataidx32_5_4_3`, is a uint32 tree whose topology reads as any other's. Leaf voxel i holds the end of its points' run in the leaf's attribute arrays; the run starts where voxel i − 1's ends. Its buffers are written in **passes**, each over every leaf in order (`Grid::writeBuffers`), A being the most attributes any leaf has:

```
u16 passes        2A + 4
pass 0            each leaf: u16, its voxel buffer's compressed size
pass 1            each leaf: a header byte (bit 0: every later leaf shares this
                  descriptor and writes none; bit 1: a u64 count of bytes to skip
                  follows), the descriptor (u64 count; each attribute's value
                  type and codec; each name and its position; the groups; a
                  metadata map, where strings live as "string:<i>"), then each
                  array's metadata: u64 bytes (+6), flags, serialization flags
                  (strided, uniform, paged), u32 size, a u32 stride if strided
pass 2 + a        attribute a's page headers, read as a leaf's array first needs
                  a page: i32 compressed size and i32 size, or a negative size
                  alone (stored)
pass A + 2        each leaf: its value mask, then u16 n and n bytes of Blosc, or
                  65535 and 2,048 raw bytes: the 512 offsets
pass A + 3 + a    attribute a's pages, each read as a leaf's array first reaches
                  it. A page (1 MB at most) is several leaves' arrays one after
                  another, so a leaf's array is a slice of one page
pass 2A + 3       nothing
```

Arrays are paged only when the grid has Blosc. Otherwise each leaf's array is its own bytes in pass A + 3 + a, with a Blosc flag byte first unless it's uniform. A **uniform** array holds one value for all its points, and a leaf of one point's arrays usually are. Blosc pads anything of 48 to 127 bytes to 128 before compressing, so a short page comes back 128 bytes long.

The codecs a value can be stored by, each decoded in its value type's float32 arithmetic as OpenVDB does it:

| codec | stored as | value |
| --- | --- | --- |
| `null` | the value type | itself |
| `trnc` | float and vec3s as halves, int32 as int16 | widened |
| `fxpt8`, `fxpt16` | u8 or u16 a component | s / max − ½: a voxel-space position in [−½, ½] |
| `ufxpt8`, `ufxpt16` | u8 or u16 a component | s / max, in [0, 1] (colours, alpha) |
| `uvec` | u16 | a unit vector: 6 + 7 bits of a 126-step octahedron, three signs |
| `grp` | u8 | 8 groups' membership bits (group k in the k ÷ 8-th group array) |
| `str` | u32 | an index into the descriptor's strings (0 is "") |

A point's world position is its voxel plus its voxel-space position, through the grid's map. Every attribute is decoded, or only the ones asked for (`want`), the rest walked over and never decompressed: the converter asks for P, colour-like names and alpha-like names. Points in inactive voxels count, as OpenVDB's `beginIndexAll` iterates them. Leaves whose descriptors differ are refused (OpenVDB writes one shared descriptor), as are 64-bit offset grids (`ptdataidx64`, never written by OpenVDB).

The reader keeps every value as **float32**, whatever the grid's type (half, double, int). A converter only compares and interpolates values. A root tile's value and the background stay whole. `probe(x, y, z)` answers a voxel's value and active bit the way OpenVDB's accessor does (leaf voxel, else the deepest node's tile, else the root tile, else the background), caching the last leaf and root entry.

**Big files.** The worker hands the reader the `File` itself. It reads the header, then each grid's descriptor, metadata and transform (64 KB at a time, growing only if needed), then **only the grids the conversion asks for**, each grid's bytes once. A file of eight grids where you use two never holds the other six. The grid's values are held decompressed (2 KB a leaf as float32). A 500,000-leaf simulation would be a gigabyte, the limit to know about.

## What's solid

A grid is a value at every integer point of its index space (a voxel's value sits at its centre). The world's voxel v asks the grid at its centre's place p, by one rule, **g(p) > 0**:

| rule | g | used for (by default) |
| --- | --- | --- |
| inside | threshold − value | a level set (threshold 0) |
| above | value − threshold | a fog volume (threshold **0.05**, so faint wisps don't swell it) |
| active | ±1 by the active bit | anything else: the grid's own topology |
| points | a point in the voxel | a point data grid (its own; see below) |

A vec3 grid's value is its length. **Sampling:** trilinear interpolates g between the eight voxels round p (OpenVDB's BoxSampler), so a world finer than the grid gets smooth surfaces, not steps of grid voxels; nearest takes the voxel p falls in. *active* is always nearest. An axis with no fraction reads one voxel, not two, which is what makes native exact.

**The fit.** Native is one world voxel a grid voxel, at the smallest D that holds the grid with a voxel round it (capped at 12). Any other D scales the solid's box to 92% of the side, centred in x and z and 4% off the floor, as convert/'s clouds are. **Blender's caches are z-up** (the viewer is y-up). They're recognised by Blender's `file_base_resolution` entry, and up = auto turns them: world (x, y, z) reads grid (x, z, −y), a rotation, not a mirror.

**How it's built.** `store.fromField` asks a cell at a time. A cell's voxels sample p over a box of grid voxels: its corners' p, rounded out by the stencil, exact because p(v) is one monotone expression. `range()` answers from minima and maxima of g kept per leaf and per internal node, stopping as soon as it sees both signs. That alone was slow where the world is much finer than the grid: a cell within one grid voxel of the surface sees both signs in its stencil and was split to its voxels, a shell as thick as a grid voxel is wide. Blender's 10-voxel smoke at D = 10, about 94 world voxels a grid voxel, took 44 s for its shape.

The fix is that a trilinear g is multilinear between grid points, so over a box spanning at most two grid cells an axis its extremes are at the corners of the pieces the grid cuts it into. Those (at most 27) decide the cell exactly. The 44 s became 1.2 s, the same voxels.

**Points.** A point grid's world is made as convert/ makes a PLY cloud (ply-core's `pointsDepth`, which `vdb-convert.js` calls unchanged but for a `fit` it may pass). A depth fits the points' **world** positions (92% of the side, as a cloud), so a turned or stretched grid comes out as it is in the world, which question 3 asks of volumes. Native puts each point in its own grid voxel, one world voxel a grid voxel, placed as a volume's native box is. A point fills its voxel, or a cube of side 3, 5 or 7, or a ball of radius 1½ to 3½ round it (the page's "a point fills"). Points under the opacity are dropped before the fit, by an attribute named Alpha, alpha or opacity (a note says so when there's none). A voxel's word is the mean colour of the points in the smallest cube round it that holds any: its own points if it has some.

**The skin** (the voxels a chunk can show: solid, with a face on air or the world's edge) comes from the shape's DAG, not the grid. One walk down carries each node's six face neighbours, so a neighbour is a child away. Resampling the grid seven times a voxel had been most of the time. A world with no colour skips it.

## Colour

The words are one per skin voxel in rank (Morton) order, a baked field as convert/'s:

| `--colour` | what | default when |
| --- | --- | --- |
| `grid:<vec3>` | Houdini's `Cd`: linear RGB, to sRGB by ^(1/2.2) as glb-core does vertex colours | a vec3 grid named Cd, color, colour, col, albedo, rgb or diffuse, whose box meets the shape's |
| `rgb:<r>,<g>,<b>[/<d>]` | three scalar grids, divided by a fourth | Blender's `color_r`, `_g`, `_b`; divided by `density` in Blender's caches (it keeps colour premultiplied by density) |
| `heat:<grid>`, `grey:<grid>` | a scalar through a ramp over its active values' range | never |
| `attr:<vec3>` | a point grid's colour attribute, linear, through 1/2.2 | a point grid's Cd (or color, col, rgb, …) |
| `none` | the shape alone; the viewer draws it in gamut | otherwise |

**Gamma** (question 5, 2026-11-24: "a checkbox to enable/disable gamma correction"). The page's "linear colour to sRGB (1/2.2)" box, on by default, and the CLI's `--gamma=on|off`. Off, a linear value v (a Cd grid's, Blender's channels after the density, a point's Cd) becomes the word 255·v as it stands. A heat or grey ramp has no gamma either way.

Each colour grid is asked in its own index space, through world space when its transform isn't the shape's (the fixture's temperature grid has twice the voxel size). Only its **active** voxels are interpolated, so colour doesn't fade to the background's black at the smoke's edge. A heat ramp of a fog's own density is nearly black: its surface is at the threshold density by construction. Temperature or flame show more.

## What it can't do yet (and says so)

- **Frustum and turned grids** are converted in their index space. A grid whose voxels aren't cubes in the world, or that's turned, gets a note ("drawn as cubes", "drawn in its own index space"). See question 3.
- **File versions before 220** are refused with the version number.
- Point index grids, string grids, 64-bit point offsets, point leaves with differing attributes, and Blosc's zstd, blosclz and snappy: refused with a reason (above). A point attribute of a type or codec the reader doesn't know is listed as not read; its grid still reads.

## Measured

On this machine (M2 Max, Node 22), the CLI:

| file | grid | depths | shape | skin + words | total |
| --- | --- | --- | --- | --- | --- |
| Houdini `smoke.vdb` (2.5 MB, half, 3,117 leaves, 105 × 217 × 105) | density > 0.05 | D = 8, 10, native (8) | 0.14, 2.0, 0.11 s | (no colour) | 2.7 s |
| the same, heat-coloured by density | | D = 8, 10, native | 0.14, 2.0, 0.11 s | 0.15, 2.9, 0.14 s | 6.4 s |
| Blender smoke (Blosc, half, 10 × 10 × 11) | density, colour ÷ density, z-up | D = 8, 10 | 0.08, 1.2 s | 0.27, 4.5 s | 6.6 s |
| pyopenvdb sphere (23³ level set) | inside | D = 8, 10 | 0.10, 1.4 s | (no colour) | 1.8 s |
| OpenVDB's `bunny_cloud.vdb` (84 MB, file format 220, 66,212 leaves, 561 × 563 × 431) | density > 0.05 | D = 8, 10 | 0.35, 7.9 s | (no colour) | 12.2 s (3.5 s of it reading) |
| OpenVDB's `utahteapot.vdb` (19 MB, 222, half level set, 975 × 457 × 611) | inside | D = 8, 10 | 0.11, 1.3 s | (no colour) | 1.8 s |
| OpenVDB 14's `big` points (100,000 in 462 leaves, two 1 MB pages) | points | D = 8, 10, native (7) | 0.04, 0.07, 0.02 s | (no colour) | 0.4 s |

Houdini's smoke at D = 10 is 31,260,817 voxels in 146,496 nodes, a 945 KB file (2.2 MB with its 2.58 million words).

## Tests

All under `npm test` (the Node ones, about 1.5 min together, mostly mutants) and `npm run test:browser` (the page).

- **`vdb/test/make-fixtures.py`** runs in Blender (its pyopenvdb is **OpenVDB 10.0**, the only copy on this machine) and writes `vdb/test/fixtures/`:
  - pyopenvdb's grids: a level-set sphere in full and as half, a fog with tiles across a root boundary, Cd, a double grid on another voxel size, int32, bool, a half vec3d, an affine-turned sphere, and a root tile;
  - one frame of a tiny Blender smoke-and-fire sim, cached three ways: Blosc + half, active-mask only, and nothing.

  Beside each it writes what OpenVDB reads back: every leaf voxel and its active bit, every tile that isn't inactive background (and a count of those), the leaf count, the transform at four points and the metadata. That's 2 MB in all.
- **`vdb/test/openvdb-tool.cpp`**, run by `sh vdb/test/make-ovdb-fixtures.sh` (Homebrew's **OpenVDB 14**), writes the rest of `fixtures/`:
  - `ovdb-points.vdb`: six point data grids, Blosc and paged: positions by every codec (16- and 8-bit fixed point, plain floats, halves); Cd as halves and at 16-bit fixed point; unit-vector normals; float, int32, int64, double, vec3d and strided attributes; a uniform one; strings; two groups; a scale-translate and an affine map; a voxel of 120 points; a grid whose int32 attribute is one padded page; and 100,000 points whose positions take two pages;
  - `ovdb-points-zip.vdb` and `-none.vdb`, the same grids but the big one, unpaged (one dump for both, which the script checks);
  - `ovdb14-grids.vdb`, file format 225: a level set, a half grid with a tile, a float grid saved as half, a vec3s and a mask grid;
  - the dumps (the volume dump as make-fixtures.py's; a point grid adds its leaves' offsets, every point's voxel-space position, world position, attributes, strings and groups), and `ovdb-uvec.sha256`, the hash of OpenVDB's unpacking of all 65,536 unit-vector codes. 5.5 MB on disk, 2 MB in git.
- **`vdb/test/dump-sample.py`** (Blender) and **`samples.test.js`** hold the reader to OpenVDB 10's reading of files too large or too foreign to commit, when `VDB_SAMPLES` and `VDB_ORACLES` name their directories (it skips otherwise). Run 2026-11-24 on OpenVDB's `bunny_cloud.vdb` (format 220: 19,209,249 active entries and all 144,559,272 voxels of its box), `utahteapot.vdb` (6,960,047 active entries) and the Houdini `smoke.vdb` (every voxel of its box): all OpenVDB's, `===`.
- **`codecs.test.js`** (~1 s): inflate against Node's zlib at every level and strategy (8,000 buffers, 200 KB of stored blocks); every truncation throws, and a flipped bit throws or gives the original bytes. LZ4 and Blosc against the fixture's own encoders in every shape (split or not, the 0x10 flag, stored, several blocks with a leftover, zlib inside, type sizes 1 to 12). All 65,536 halves against their bits. Then **17 mutants**.
- **`vdb-core.test.js`** (~40 s, then ~2 min of mutants):
  - every value, active bit, tile, leaf origin, transform and metadata entry of the five real volume files, against OpenVDB's own reading, `===`;
  - every point of the three point files: its voxel, its voxel-space position and world position, every attribute value, string and group, every leaf's origin, mask and offsets; asked for one attribute, the same values with the rest left undecoded; and the shapes the files must hold between them (several pages, a stored page, a padded one, a stride, every codec above). Every unit-vector code, by hash;
  - the old layout from the writer: formats 220 and 221, zlib or not, halves, extra leaf buffers; and 225's half grid in every compression;
  - then files from **`vdb-fixture.js`**, a writer of the tests' own (its own LZ4 and Blosc encoders, Node's zlib), for what no real file holds: zlib, raw chunks behind negative sizes, each inactive-value code 0–6 written on purpose (and seen written), half grids with no active values, mask, int64 and vec3i grids, node sizes 4-3 and 3-3-3-3, every map, a stream without offsets and an instance;
  - every truncation of a file throws `Damaged`, 400 files with a changed byte read or throw `Damaged` (never another error), and the same for a real point file (about 600 cuts and 200 changed bytes), and the refusals;
  - then **46 mutants** (7 of the old layout and 225, 16 of the points).
- **`vdb-convert.test.js`** (~5 s, then ~50 s of mutants):
  - 16 cases (level sets, fog, nearest, native, z-up, a vec3 shape, a mask grid, integers with g = 0 exactly, and a written block of solid tiles round a leaf with a hole), each sampled voxel by voxel the plain way and built by `fromDense` in the converter's store. It must be the converter's root by id, and so must its skin. Every word is held to colour worked out in the test, in a Morton order made bit by bit.
  - Two more with gamma off, and 225's half grid and level set.
  - Ten point cases (fitted and native, z-up, every fill, opacity, gamma off, a turned grid), each world read back from its file into a store of its own and held by root id to the dense world made in the test from the points (the matrix, the fit and the kernel written out), its skin the same, and every word (eight bits) the mean of the smallest cube of points round it. The zlib and plain files make the Blosc file's bytes.
  - Then the whole conversion: files read back, the CLI's bytes (a point grid's too), the defaults (a point grid's told twice, its colours its vec3 attributes), refusals.
  - Then **33 mutants** (9 of gamma and the points).

  Three first tries survived and taught something. The hull's float tolerance is out of reach of every fixture; the mutants now hold what it must keep, g = 0 as air. A node's whole range used for part of it is only conservative, so the mutants now miss part of a box. And a leaf's range that ignores its inactive voxels needs a hole in a leaf with nothing but solid round it, which only a 64³ block made by hand has.
- **`vdb/test/browser/vdb.test.js`** (~15 s, then ~3 min of mutants): the page by its real controls (the file input, a drop, the depth boxes and menus, a file's choices changed and "again", a failure keeping the choices, a refusal, cancel mid-build, remove, the gamma box, a point grid with a fill and an opacity, its one rule and its colours, another of its grids again, settings across a reload). Every file is Node's `convertVdb` bytes. Then **19 mutants of the page's wiring**.

`node vdb/vdb-vdag.mjs ~/Downloads/smoke.vdb --list` reads your Houdini file; it isn't in the fixtures (its licence is unknown), but it was checked against OpenVDB's reading of it voxel for voxel (1,595,904 values, all equal) while this was built.

## Questions

1. **Point data grids.** Houdini's VDB points and OpenVDB's points are a common kind of `.vdb`. Worth a reader (attribute arrays, paged compression), turned into clouds the PLY way?

[BPT: We should handle point .vdb * ]

Done (2026-11-24): point data grids read (every codec OpenVDB writes, paged or not) and convert as PLY clouds do. See "Point data grids" and "Points" above. The fixtures come from OpenVDB 14 itself (Homebrew, a tool only). The same work found two more gaps: file format 220 (`bunny_cloud.vdb` was refused) and 225 (OpenVDB 13's half grids). Both read now.

2. **The fog's default threshold**, 0.05. "Any density at all" (0) swells smoke with faint wisps; 0.05 looked right on Houdini's smoke. Keep it, or another value?

[BPT: keep it as default for now ]

Kept.

3. **Grids that aren't cubes in the world** (non-uniform voxel sizes, turned or frustum grids) are drawn in their own index space. Resample them in world space instead (a world voxel asks the grid through the inverse map)? It's the same machinery, a different p.

[BPT: not sure, I haven't encountered one so let's hold off implementing this ]

Held. Point grids already come out in world space at a fitted depth (a point has a world position whatever its grid), so only volumes are still in their index space.

4. **Sequences** (`smoke.0001.vdb` …): one file a frame today. Anything wanted for a run of frames?

[BPT: one file a frame is fine, future ]

As is.

5. **Colour from linear grids** goes through ^(1/2.2), as glb-core's vertex colours do. Right for your files?

[BPT: might want to add a checkbox to enable/disable gamma correction ]

Done: "linear colour to sRGB (1/2.2)" in the page's settings, on by default (the files are the same bytes as before), `--gamma=off` on the CLI.

## Future discussion

* Vector fields (seems like we could use our color fields as quantized 6 bit signed 3 channel vector field -32 to +31, thoughts?)

  **Thoughts (2026-11-24).** It fits, and nearly everything already built would carry it unchanged, if it's stored the right way. Four points:

  1. **Store it offset, not signed.** A component c in −31 … +31 written as c + 32 (1 … 63) is an ordinary six-bit channel. The coarse reduction every lod uses is the count-weighted mean per channel (`cellAttr`, the baked field's block sums, the six-bit file encoding). The mean of offset values is the offset of the mean, so a coarse cell holds the mean vector exactly, and none of those needs to know it's a vector. Two's complement would break every one of them: the mean of 0x3F (−1) and 0x01 (+1) isn't 0. Use −31 … +31, not −32: then 0 is exact and the range is symmetric. A world-level scale (units a step, the largest |component| ÷ 31) goes in the descriptor, so `{ kind: 'baked', … }` becomes, say, `{ kind: 'vector', scale, … }` over the same words.
  2. **Six bits is coarse.** It's 1 part in 31 of the largest component. Smoke velocities span a wide range, so the slow half of a sim rounds to 0 or ±1. Companding (√ or μ-law) would spread the steps but breaks the linear mean in point 1. If precision matters, the word has 14 reserved bits, but 8 bits a component needs 24, so a vector can't share a word with an 8-bit colour. It would be its own field (multidag-attributes.md's second word or DAG), or a world is either coloured or a vector field.
  3. **Baked words live on the skin only.** A velocity field wants the inside of the smoke too: an actor drifting through it, or debris in destroy/ pushed by it, asks inside. For that it needs the inside-at-a-coarser-grain work (docs/densecolor.md), or a separate overlay. Drawn on the surface, the skin is enough.
  4. **A mean shortens vectors where they disagree.** That's the right box filter for flow (net flux through a cell) and the wrong one for a picture of direction: a vortex's coarse cell reads ~0. Fine for advection; normalise for display.

  The free part: offset-binary words drawn as colour are exactly a normal-map picture (zero is mid grey, +x is red), so the viewer would show a vector world today with no change. What would you use one for: to look at, or to drive actors and debris? That decides between a skin field (cheap, now) and an inside field (densecolor's work first).