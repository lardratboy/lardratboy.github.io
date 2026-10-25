/* Address → spacetime recipe. The base traits come from the bimoblock
   address logic unchanged (pages, seed, districts): `sym` is the fold,
   which on roam is one of the three groups that keep a seed's copies
   architectural (C1, Cs and C2 are reached only through the symmetry
   filter or an axis: a C1 soup is the one place this generator reads as
   noise), and a fold that moves y is cut to the part that keeps it in
   the core; `arch` is an optional clip, off on roam; `density` is
   unused, since the rule decides every cell. The dials (ca, start, time)
   roam by R₂ (dials.js), the fold and a weighted time with them; draw is
   auto on roam. Pure, like cellRecipe. */
import { Filter, Spacetime } from '../state.js';
import { cellRecipe } from './recipe.js';
import { owns, roamDials, districtDials } from './dials.js';
import { Core } from '../core/bimoblock-core.js';

const DIALS = ['ca', 'start', 'time', 'draw'];
const FULL = Core.ARCH_NAMES.indexOf('full');
/* The folds roam picks from: C4v, C4, C2v. */
export const ROAM_FOLDS = ['C4v', 'C4', 'C2v'].map(n => Core.GROUPS.findIndex(g => g.name.startsWith(n + ':')));
/* Times on roam, mirrored two in three: forward Life at R = 32 is often
   nearly empty, and a reversible rule never dies out. */
export const ROAM_TIMES = [1, 1, 0];

/** @param {number} i @param {number} j @returns {{P: import('../types.js').SpacetimeRecipe, kin: import('../types.js').Kin|null}} */
export function spacetimeCellRecipe(i, j){
  const base = cellRecipe(i, j);
  const C = { ...base.P };
  let kin = base.kin;
  if (!kin){
    if (!owns('arch') && Filter.arch < 0) C.arch = FULL;
    const free = d => !owns(d) && Spacetime[d] < 0;
    if (free('draw')) C.draw = 0;
    const extra = [];
    if (free('time')) extra.push([ROAM_TIMES.length, v => { C.time = ROAM_TIMES[v]; }]);
    if (!owns('sym') && Filter.sym < 0) extra.push([ROAM_FOLDS.length, v => { C.sym = ROAM_FOLDS[v]; }]);
    roamDials(i, j, C, DIALS.filter(d => !((d === 'time' || d === 'draw') && free(d))), Spacetime, extra);
  } else {
    // The bimoblock field, lift and density are unused here, so their drift is noise.
    const drift = kin.drift.filter(t => t !== 'field' && t !== 'lift' && t !== 'density');
    // A fold that drifts stays among the roam folds.
    if (drift.includes('sym') && !ROAM_FOLDS.includes(C.sym)) C.sym = ROAM_FOLDS[C.sym % ROAM_FOLDS.length];
    drift.push(...districtDials(i, j, C, DIALS, kin, 0x3c6ef372));
    kin = { ...kin, drift };
  }
  return { P: C, kin };
}
