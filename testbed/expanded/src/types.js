/* Shared JSDoc typedefs. No runtime code: this module exists so editors can
   give completion and hover docs on the plain objects that flow between the
   core, the worker, the generation pool and the virtualiser, without a
   TypeScript build. Reference a type from any module with a
   `@type {import('../types.js').BlockData}` tag, or in @param / @returns. The names match what the code calls the
   values: `P` is a Recipe, `p` is a BlockData, `l` is a Level. */

/**
 * One tier of the nested voxel grid. `Tier.levels[0]` is the outer (macro)
 * tier; the resolution is the product of every `radix`.
 * @typedef {Object} Level
 * @property {number} radix  Cells per side at this tier (2..5 in practice).
 * @property {number} gap    Fraction of a cell left empty between children
 *                           of this tier, applied during voxel layout.
 * @property {number} [sym]  Subgroup index for this tier when
 *                           `Recipe.tierSymmetry` is on; `-1`/absent means
 *                           "inherit the specimen's group".
 * @property {boolean} [neo] Neoblock pages only: the tier belongs to the
 *                           neoblock in a composite (a leading run of tiers;
 *                           see `compositeSplit()` in core/neoblock-core.js).
 */

/**
 * What the core needs to build one specimen. Pure data: the same Recipe and
 * levels always produce the same voxels. Produced by `cellParams()` /
 * `cellRecipe()` and checked by `test/golden.json`.
 * @typedef {Object} Recipe
 * @property {number} sym            Index into `Core.GROUPS` (Oh subgroup).
 * @property {number} arch           Index into `Core.ARCH_NAMES` (envelope).
 * @property {number} field          Index into `Core.FIELD_NAMES` (scalar field).
 * @property {number} lift           Index into `Core.LIFT_NAMES`.
 * @property {number} density        Fraction of envelope cells kept (0.06..0.72).
 * @property {bigint} seed           Unsigned 64-bit hash; drives the field.
 * @property {boolean} [tierSymmetry] Each tier folds by its own `Level.sym`.
 */

/**
 * A neoblock recipe: the bimoblock Recipe its source is built from, plus the
 * modifier dials. Every dial is a small integer so any of them can be an
 * axis role; at 0 a dial does nothing. See core/neoblock-core.js.
 * @typedef {Recipe & {
 *   source?: number,
 *   place?: number,
 *   palette?: number,
 *   orient?: number,
 *   warp: number,
 *   warpAmt: number,
 *   eps: number,
 *   largest: number
 * }} NeoRecipe
 * `source` 0 builds the bimoblock itself, 1 a composite (bimoblock children
 * on the inner tiers); `place` 0 fills every macro cell, 1 only the cells
 * of the base bimoblock built on the outer tiers; `palette` 1..8 distinct
 * children; `orient` indexes `ORIENT_NAMES` (none, coherent, random). The
 * composite dials are read only when `source` is 1, and absent means 0.
 * `warp` indexes `WARP_NAMES` (0 none, 1 twist, 2 taper, 3 bend, 4 shear);
 * `warpAmt` 0..8 is the amount in ninths of full; `eps` 0..8 indexes
 * `EPS_STEPS`; `largest` 1 keeps only the largest connected piece.
 */

/**
 * A mod-field recipe (`?g=field`): the bimoblock Recipe's traits with new
 * jobs, plus three dials. See core/field-core.js and easyfields.md.
 * @typedef {Recipe & {
 *   frame: number,
 *   formula: number,
 *   bands: number,
 *   k?: number
 * }} FieldRecipe
 * `sym` is the fold (0, C1, is none), `arch` the clipping envelope and
 * `density` the duty: a voxel is kept when (g mod m)/m < density. `field`
 * and `lift` are unused. `frame` indexes `FRAME_NAMES`, `formula`
 * `FORMULA_NAMES`, `bands` `BANDS` (pascal: a base and apex, `pascalStep`),
 * `k` `K_NAMES` (missing is 0, 1/m).
 */

/**
 * A number-picture recipe (`?g=digit`): the bimoblock Recipe's traits with
 * new jobs, plus three dials. See core/digit-core.js and newground.md.
 * @typedef {Recipe & {
 *   shape: number,
 *   number: number,
 *   base: number
 * }} DigitRecipe
 * `sym` is the fold (0, C1, is none), `arch` the clipping envelope and
 * `density` the digit threshold (`keepFrom()`: 0.9 and up keeps every
 * nonzero digit); `field` and `lift` are unused. `shape` indexes
 * `SHAPE_NAMES`, `number` `NUMBER_NAMES` (a family: the seed picks the
 * member, `numberMember()`), `base` `BASE_NAMES`.
 */

/**
 * A carry recipe (`?g=carry`): the bimoblock Recipe's traits with new
 * jobs, plus four dials. See core/carry-core.js and whatnext.md §3–§6.
 * @typedef {Recipe & {
 *   rule: number,
 *   stencil: number,
 *   step: number,
 *   level: number
 * }} CarryRecipe
 * `sym` is the fold and `arch` the clipping envelope, both off on roam;
 * `field`, `lift` and `density` are unused. `rule` indexes `RULE_NAMES`
 * (powers, sandpile); `stencil` indexes the rule's list in
 * `STENCIL_NAMES`; `step` is T counting down from the largest that fits
 * (powers) or the grain count (sandpile, `GRAIN_SCALE`); `level` is the
 * prime (powers, `PRIMES`) or which stable values are kept (sandpile,
 * `KEEP_NAMES`). The seed picks the coefficients mod p and the sources.
 */

/**
 * A claudegen recipe (`?g=claudegen`): the bimoblock Recipe's traits with
 * new jobs, plus four dials. See core/claudegen-core.js and claudegen.md.
 * @typedef {Recipe & {
 *   motif: number,
 *   flaw: number,
 *   strength: number,
 *   spacing: number,
 *   view?: number
 * }} ClaudegenRecipe
 * `sym` is the fold and `arch` the clipping envelope, both off on roam;
 * `density` is the fill (the share of the perfect crystal's voxels kept);
 * `field` and `lift` are unused. `motif` indexes `MOTIFS`, `flaw`
 * `FLAWS`, `strength` the flaw's row of `STRENGTH_NAMES` and `spacing`
 * `PERIODS`, `view` `VIEWS` (absent is on the grid). The seed picks the
 * flaw's sense, core and extent.
 */

/**
 * A nestblock recipe (`?g=nest`): the bimoblock Recipe's traits with new
 * jobs, plus four dials. See core/nest-core.js and nestblocks.md.
 * @typedef {Recipe & {
 *   outer: number,
 *   inner: number,
 *   carve: number,
 *   twist: number
 * }} NestRecipe
 * `sym` is the fold (on roam one of `ROAM_FOLDS`) and `arch` the clipping
 * envelope, off on roam; `field`, `lift` and `density` are unused.
 * `outer` indexes `RULE_NAMES` (rule k keeps the classes in the bits of
 * k + 1), `inner` `INNER_NAMES` (0 is the outer rule again), `carve`
 * `CARVES` and `twist` `TWIST_NAMES`. The seed picks which orbits a carve
 * keeps and each kept orbit's turn.
 */

/**
 * A spacetime recipe (`?g=spacetime`): the bimoblock Recipe's traits with
 * new jobs, plus four dials. See core/spacetime-core.js and spacetime.md.
 * @typedef {Recipe & {
 *   ca: number,
 *   start: number,
 *   time: number,
 *   draw: number
 * }} SpacetimeRecipe
 * `sym` is the fold (on roam one of `ROAM_FOLDS`; a group that moves y is
 * cut to the part that keeps it) and `arch` the clipping envelope, off on
 * roam; `field`, `lift` and `density` are unused. `ca` indexes `RULES`,
 * `start` `SEED_NAMES`, `time` `TIME_NAMES` (0 forward, 1 mirrored) and
 * `draw` `DRAW_NAMES` (0 auto, the rule's own pick per time mode). The
 * seed picks a motif's distance from the centre and a soup's cells.
 */

/**
 * A bimomirror recipe (`?g=mirror`): the bimoblock Recipe, which is the
 * child's, plus two dials. See core/mirror-core.js and bimomirror.md.
 * @typedef {Recipe & {
 *   group: number,
 *   seat: number
 * }} MirrorRecipe
 * `sym`, `arch`, `field`, `lift`, `density` and the seed shape the child,
 * an ordinary bimoblock on the inner tiers (Oh becomes Td on roam).
 * `group` indexes `ARRANGEMENTS` (0 is the `copy` control, never on roam)
 * and `seat` is the sign change (Oh element 0–7) that flips the child
 * before it is placed, named by `SEAT_NAMES`.
 */

/**
 * How a district cell relates to its pin (`cellRecipe()` in lattice/recipe.js).
 * `null` outside a district.
 * @typedef {Object} Kin
 * @property {number} ring       Chebyshev distance from the pin; 0 is the pin.
 * @property {string[]} drift    Traits mutated away from the pin's recipe:
 *                               'sym' | 'arch' | 'field' | 'lift' | 'density' | 'seed'.
 */

/**
 * The full address → specimen resolution for one cell.
 * @typedef {Object} CellRecipe
 * @property {Recipe} P
 * @property {Kin|null} kin
 */

/**
 * Baked, independent-quad mesh buffers from `Core.expandInstances()` (and
 * `Core.meshArrays()`, which is that applied to a fresh record). Nothing on
 * the render path builds these any more: the OBJ exporters expand a record
 * on demand, and the golden hashes are defined on the result.
 * @typedef {Object} MeshArrays
 * @property {Float32Array} pos             xyz per vertex.
 * @property {Float32Array} col             rgb per vertex, the gamut colouring.
 * @property {Float32Array|null} colOrbit   rgb per vertex, coloured by fold orbit.
 * @property {Float32Array} nrm             xyz normal per vertex.
 * @property {Uint16Array|Uint32Array} idx  Triangle indices (32-bit above 65535 verts).
 * @property {number} quads
 * @property {number} tris                  Always `quads * 2`.
 * @property {{center:number[], radius:number}} bounds  Bounding sphere.
 * @property {number} bytes                 Total byte length of every buffer.
 * @property {{mesh:number, bounds:number}} timings  Milliseconds. `bounds`
 *   is kept for the perf-sample key but is always 0: the bounding sphere is
 *   derived from the occupied extent and the face masks, so there is no
 *   separate pass to time.
 */

/**
 * What a build actually ships, and what the cache holds: the occupancy walk's
 * own output, which every drawn and exported form is a function of. Transfers
 * out of a worker as four buffers — see `Core.instanceArrays()`.
 * @typedef {Object} InstanceArrays
 * @property {Uint32Array} cells        Flat grid index per occupied cell, walk order.
 * @property {Uint8Array} masks         Six-bit surviving-face set per cell.
 * @property {Uint8Array|null} orbitIdx Fold-element index per cell; full resolution only.
 * @property {number} orbitOrder        Orbit count for the hue ramp, 0 when uncoloured.
 * @property {number} count             Occupied cells, i.e. instances.
 * @property {number} N                 Grid resolution this record indexes (`R`, or `r0` for the proxy).
 * @property {Float64Array} centers     Axis centre table, shared by all three axes.
 * @property {number} cellSize          Physical cube width in unit-box coordinates.
 * @property {number} quads             Surviving faces, i.e. `sum(popcount(masks))`.
 * @property {number} tris              Always `quads * 2`; what survives masking, not what is submitted.
 * @property {{center:number[], radius:number}} bounds  Bounding sphere.
 * @property {number} bytes             Total byte length of every buffer.
 * @property {{mesh:number, bounds:number}} timings  Milliseconds.
 */

/**
 * Return value of `Core.bimoblockOcc(P, levels)`: the evaluate + select half
 * of a build, before any instance record exists.
 * @typedef {Object} OccResult
 * @property {Uint8Array} occ        Occupancy, `R*R*R`, x fastest.
 * @property {number} R              `levelResolution(levels)`.
 * @property {number} filled         Count of set cells in `occ`.
 * @property {number} envelopeCells  Cells inside the archetype envelope.
 * @property {Uint8Array} orbit      Winning fold-element index per cell, `R*R*R`;
 *                                   meaningful only where `occ` is set.
 * @property {number} orbitOrder     Orbit count for the hue ramp.
 * @property {{evaluate:number, select:number}} timings  Milliseconds.
 */

/**
 * Return value of `Core.buildBlock(P, levels)`.
 * @typedef {Object} BuildResult
 * @property {Uint8Array} occ        Occupancy, `R*R*R`, x fastest.
 * @property {number} R              `levelResolution(levels)`.
 * @property {number} filled         Count of set cells in `occ`.
 * @property {number} envelopeCells  Cells inside the archetype envelope.
 * @property {InstanceArrays} instances
 * @property {{evaluate:number, select:number, mesh:number, bounds:number, total:number}} timings
 * @property {Object} [meta]         Generator-specific figures for the inspector
 *                                   (mod fields: `{modulus}`, number pictures:
 *                                   `{digits, room, base, keep}`, carry: `{T, p}`
 *                                   or `{N, threshold, keepFrom}`, claudegen:
 *                                   `{a, periods, detail}`, nestblocks: `{tiers,
 *                                   dimension, fill}`, spacetime: `{gens,
 *                                   population, extinct, fold, foldOrder, moved, offset,
 *                                   seedCells, draw, fill}`, bimomirrors: `{whole, hm,
 *                                   wholeOrder, aligned, childR, cells, kinds,
 *                                   fallback}`); carried to BlockData.
 */

/**
 * A resident specimen in `Virtualiser.cache`: the recipe it was built from
 * plus everything the renderer and inspector need. Built by
 * `GenerationPool.service()`, freed by `Virtualiser.evict()`.
 * @typedef {Recipe & {
 *   occ: Uint8Array,
 *   R: number,
 *   levels: Level[],
 *   filled: number,
 *   envelopeCells: number,
 *   inst: InstanceArrays,
 *   views: import('./scene/instancing.js').InstancedSpecimen,
 *   instLod: InstanceArrays|null,
 *   viewsLod: import('./scene/instancing.js').InstancedSpecimen|null,
 *   tris: number,
 *   lodTris?: number,
 *   aut: number,
 *   seen: number,
 *   kin: Kin|null,
 *   meta: Object|null,
 *   bytes: number,
 *   revision: number
 * }} BlockData
 * `inst` is the full-resolution instance record and `views` its GPU-side
 * attributes; `instLod`/`viewsLod` are the outer-tier proxy, built lazily by
 * `Virtualiser.lodOf()`. All four render modes index one of those two bundles
 * (see `InstancedSpecimen.geometryFor`), so a mode costs no GPU memory of its
 * own. `tris` is the submitted triangle count, cubes whole.
 * `aut` is the automorphism order, `-1` until the
 * analyze job for the focused cell lands. `seen` is the LRU tick.
 */

/**
 * The numeric message that crosses to a worker (or `runNumericJob()` on the
 * main thread). Only typed arrays and plain numbers: rendering objects
 * never cross threads.
 * @typedef {{ type:'build', jobId:number, generator:string, recipe:Recipe, levels:Level[] }} BuildJobMessage
 * @typedef {{ type:'analyze', jobId:number, occ:Uint8Array, R:number }} AnalyzeJobMessage
 * @typedef {BuildJobMessage|AnalyzeJobMessage} JobMessage
 */

/**
 * The pool's bookkeeping record for one in-flight job (`GenerationPool`).
 * `payload` becomes the `JobMessage`; the rest stays on the main thread so
 * the result can be matched, validated and installed when it comes back.
 * @typedef {Object} Job
 * @property {'build'|'analyze'} type
 * @property {number} i
 * @property {number} j
 * @property {string} key        `Virtualiser.keyOf(i, j)` at issue time.
 * @property {string} token      `revision/type/key`; the `pending` map key.
 * @property {number} estimate   Bytes reserved against `CFG.RESULT_BYTES`.
 * @property {Object} payload    Spread into the `JobMessage`.
 * @property {number} [revision] Pool revision at dispatch; stale results are dropped.
 * @property {number} [jobId]    Serial matched against the reply.
 * @property {CellRecipe} [rec]  build only.
 * @property {Level[]} [levels]  build only; a snapshot of `Tier.levels`.
 * @property {BlockData} [specimen] analyze only; receives `aut`.
 */

export {};
