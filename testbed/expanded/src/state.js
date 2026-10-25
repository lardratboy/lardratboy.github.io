/* The app's shared mutable state, as plain objects. Deliberately no
   methods yet: this is the one place the former top-level globals live, so
   every module reads and writes the same instance. Phase 4 hands each of
   these to the class that owns it. */

/* Which generator fills the lattice. Chosen once at startup from `?g=`
   (see lattice/generators.js) and fixed for the page's life, so the cache
   never holds two generators' specimens at once. */
export const Generator = { id:'bimo' };

export const Axis   = { x:'arch', y:'sym' };
/* Neoblock dials that no axis enumerates (the neo tab's controls); an axis
   that enumerates a dial overrides its value here, as with Filter. */
export const Neo    = { source:0, place:1, palette:4, orient:1, warp:1, warpAmt:4, eps:0, largest:0 };
/* Mod-field dials held constant from the field tab; -1 roams (the page
   picks), and an axis that enumerates a dial overrides it, as with Filter. */
export const Easy   = { frame:-1, formula:-1, bands:-1, k:-1 };
/* Number-picture dials held constant from the digit tab, likewise. */
export const Digit  = { shape:-1, number:-1, base:-1 };
/* Carry dials held constant from the carry tab, likewise. */
export const Carry  = { rule:-1, stencil:-1, step:-1, level:-1 };
/* Claudegen dials held constant from the claudegen tab, likewise. */
export const Claudegen = { motif:-1, flaw:-1, strength:-1, spacing:-1, view:-1 };
/* Nestblock dials held constant from the nest tab, likewise. */
export const Nest = { outer:-1, inner:-1, carve:-1, twist:-1 };
/* Spacetime dials held constant from the spacetime tab, likewise. */
export const Spacetime = { ca:-1, start:-1, time:-1, draw:-1 };
export const Filter = { sym:-1, arch:-1, field:-1 };
export const Mint   = { gen:0, density:0.25 };

/* Tier layout is global (like density), not per-cell. `levels` is
   reassigned wholesale by the presets, hence the wrapper object. */
export const Tier = {
  /** @type {import('./types.js').Level[]} */
  levels: [{ radix:9, gap:0.0 }],
  symmetry: false
};

/* Sibling-district pin; see cellRecipe() in lattice/recipe.js. */
/** `params` is the pinned specimen's Recipe; `want` is the address awaiting its build. */
export const Pin = { on:false, i:0, j:0, radius:4, epoch:0, params:null, want:null };

export const State = {
  align: false, labels: true, legend: true,
  spin: 0.34, haze: 0.42, time: 0,
  colorMode: 'gamut',  // 'gamut' | 'chiral' | 'orbit' — see specimenChiral()
  /* 'solid' | 'wire' | 'points' | 'centers' — how a specimen's geometry is
     drawn. Display-only, like colorMode: derived views are built lazily
     from the cached mesh (Virtualiser.viewOf), never by regenerating. */
  renderMode: 'solid'
};
export const Bloom = { on: false };
export const Focus = { i:0, j:0 };
export const Hover = { i:0, j:0, on:false };
/* Cells marked for batch operations (the sheet export), toggled by double
   click. Keyed by address "i,j" rather than by cache key: a mark names a
   place on the lattice, and whatever stands there when the operation runs
   is what gets processed — across re-mints and blooms alike. */
/** @type {Map<string, {i:number, j:number}>} */
export const Marks = new Map();
