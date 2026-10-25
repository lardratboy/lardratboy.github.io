/* Address → nestblock recipe. The base traits come from the bimoblock
   address logic unchanged (pages, seed, districts): `sym` is the fold,
   which on roam is one of the seven groups that keep a nestblock
   architectural (C1, Cs and C2 leave too many free choices a tier and
   read as noise, so they are reached only through the symmetry filter or
   an axis); `arch` is an optional clip, off on roam; `density` is unused,
   since the rules set the fill. The dials (outer, inner, carve, twist)
   roam by R₂ (dials.js), the fold with them. Pure, like cellRecipe. */
import { Filter, Nest } from '../state.js';
import { cellRecipe } from './recipe.js';
import { owns, roamDials, districtDials } from './dials.js';
import { Core } from '../core/bimoblock-core.js';

const DIALS = ['outer', 'inner', 'carve', 'twist'];
const FULL = Core.ARCH_NAMES.indexOf('full');
/* The folds roam picks from, Oh first: C2v … Oh, GROUPS 3 … 9. */
export const ROAM_FOLDS = [9, 8, 7, 6, 5, 4, 3];
/* Inner rules on roam: the same as the outer half the time, so half the
   roam pages are self-similar fractals and half are one rule made of
   another. */
export const ROAM_INNER = [...Array(15).fill(0), ...Array.from({ length: 15 }, (_, k) => k + 1)];
/* Carves on roam, ½ first: page 0, 0 is the rule × fold sheet, where an
   uncarved page would be ten identical rows. */
export const ROAM_CARVES = [2, 1, 3, 0];

/** @param {number} i @param {number} j @returns {{P: import('../types.js').NestRecipe, kin: import('../types.js').Kin|null}} */
export function nestCellRecipe(i, j){
  const base = cellRecipe(i, j);
  const C = { ...base.P };
  let kin = base.kin;
  if (!kin){
    if (!owns('arch') && Filter.arch < 0) C.arch = FULL;
    const extra = [];
    const free = d => !owns(d) && Nest[d] < 0;
    if (free('inner')) extra.push([ROAM_INNER.length, v => { C.inner = ROAM_INNER[v]; }]);
    if (free('carve')) extra.push([ROAM_CARVES.length, v => { C.carve = ROAM_CARVES[v]; }]);
    if (!owns('sym') && Filter.sym < 0) extra.push([ROAM_FOLDS.length, v => { C.sym = ROAM_FOLDS[v]; }]);
    // Weighted dials that roam are picked from their lists above instead.
    roamDials(i, j, C, DIALS.filter(d => !((d === 'inner' || d === 'carve') && free(d))), Nest, extra);
  } else {
    // The bimoblock field, lift and density are unused here, so their drift is noise.
    const drift = kin.drift.filter(t => t !== 'field' && t !== 'lift' && t !== 'density');
    // A fold that drifts stays among the roam folds.
    if (drift.includes('sym') && C.sym < ROAM_FOLDS.at(-1)) C.sym = ROAM_FOLDS.at(-1);
    drift.push(...districtDials(i, j, C, DIALS, kin, 0x7a3b9c41));
    kin = { ...kin, drift };
  }
  return { P: C, kin };
}
