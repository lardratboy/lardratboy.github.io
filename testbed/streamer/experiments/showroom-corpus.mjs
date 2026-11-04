/* block-showroom specimens as a corpus, for the hash-cons experiment and
   its tests (docs/hashcons-plan.md).

   The core is imported straight from the sibling checkout, so the numbers
   are for block-showroom as it stands; the report records its commit.
   BLOCK_SHOWROOM=/path overrides the location. Only bimoblock-core.js is
   loaded: lattice/recipe.js would be the natural source of recipes, but it
   imports config.js, which imports three.js through the page's import map,
   and Node has no import map. So recipes are sampled here, with the same
   hash32 and the same trait ranges recipe.js's cellParams() uses. */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export const SHOWROOM_DIR = resolve(process.env.BLOCK_SHOWROOM ||
  new URL('../../block-showroom', import.meta.url).pathname);
const CORE = resolve(SHOWROOM_DIR, 'src/core/bimoblock-core.js');

export const showroomAvailable = () => existsSync(CORE);

export async function loadShowroom(){
  const { createBimoblockCore } = await import(pathToFileURL(CORE).href);
  return createBimoblockCore();
}

export function showroomRevision(){
  try {
    return execFileSync('git', ['-C', SHOWROOM_DIR, 'log', '-1', '--format=%h %s'], { encoding: 'utf8' }).trim();
  } catch { return 'unknown'; }
}

/* Binary level stacks. Gaps are irrelevant here: they only move cubes
   apart when drawn (tierAxisLayout), and occupancy never sees them.
   For ordinary recipes even the radices only matter through R, because
   foldedAxis(u) is linear in u; they matter beyond R for tierSymmetry
   (each tier folds its own digit triple) and for the t: tier fields. */
const rep = (radix, n) => Array.from({ length: n }, () => ({ radix, gap: 0 }));
export const STACKS = {
  tower4: rep(2, 4),   // block-showroom PRESETS.tower4, R = 16
  n4:     rep(4, 2),   // PRESETS.n4, R = 16
  bin5:   rep(2, 5),   // R = 32
  bin6:   rep(2, 6),   // R = 64
  quad3:  rep(4, 3),   // R = 64
  bin7:   rep(2, 7),   // R = 128
  bin8:   rep(2, 8),   // R = 256
  quad4:  rep(4, 4),   // R = 256
};

// recipe.js's hash32 and seedFromWords, verbatim.
export function hash32(a, b){
  let h = ((a | 0) ^ Math.imul((b | 0) + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
const seedFromWords = (lo, hi) => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);

/* Specimen n of a deterministic sample. Traits not pinned by `fix` come
   off the hash, with cellParams()'s ranges: 10 groups, 12 archetypes,
   16 fields (10 legacy + 6 tier fields), 3 lifts, and the density axis's
   0.10 + k·0.055 steps. With tierSymmetry, each level gets its own group,
   like the levels editor's per-tier picker. */
export function sampleRecipe(core, n, levels, fix = {}){
  const h = hash32(hash32(n, 0x51ed270b), 0x2545f491);
  const h2 = hash32(hash32(n, 0x2545f491), 0x9e3779b1);
  const P = {
    sym:   fix.sym   ?? h % core.GROUPS.length,
    arch:  fix.arch  ?? (h >>> 8) % core.ARCH_NAMES.length,
    field: fix.field ?? (h >>> 16) % core.FIELD_NAMES.length,
    lift:  fix.lift  ?? (h >>> 24) % core.LIFT_NAMES.length,
    density: fix.density ?? 0.10 + (h2 % 12) * 0.055,
    seed: seedFromWords(hash32(h, 0x2545f491), hash32(h2, 0x9e3779b1)),
  };
  let lv = levels;
  if (fix.tierSymmetry){
    P.tierSymmetry = true;
    lv = levels.map((l, i) => ({ ...l, sym: hash32(h2, i + 1) % core.GROUPS.length }));
  }
  return { P, levels: lv };
}
