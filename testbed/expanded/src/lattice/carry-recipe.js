/* Address → carry recipe. The base traits come from the bimoblock
   address logic unchanged (pages, seed, districts): `sym` is an optional
   fold and `arch` an optional clip, both off on roam, since a symmetric
   stencil already gives the specimen its symmetry. The dials (rule,
   stencil, step, level) roam by R₂ (dials.js). Pure, like cellRecipe. */
import { Filter, Carry } from '../state.js';
import { cellRecipe } from './recipe.js';
import { owns, roamDials, districtDials } from './dials.js';
import { Core } from '../core/bimoblock-core.js';

const DIALS = ['rule', 'stencil', 'step', 'level'];
const FULL = Core.ARCH_NAMES.indexOf('full');

/** @param {number} i @param {number} j @returns {{P: import('../types.js').CarryRecipe, kin: import('../types.js').Kin|null}} */
export function carryCellRecipe(i, j){
  const base = cellRecipe(i, j);
  const C = { ...base.P };
  let kin = base.kin;
  if (!kin){
    if (!owns('sym') && Filter.sym < 0) C.sym = 0;
    if (!owns('arch') && Filter.arch < 0) C.arch = FULL;
    roamDials(i, j, C, DIALS, Carry);
  } else {
    // The bimoblock field, lift and density are unused here, so their drift is noise.
    const drift = kin.drift.filter(t => t !== 'field' && t !== 'lift' && t !== 'density');
    drift.push(...districtDials(i, j, C, DIALS, kin, 0x1b873593));
    kin = { ...kin, drift };
  }
  return { P: C, kin };
}
