/* Address → number-picture recipe. The base traits come from the
   bimoblock address logic unchanged (pages, seed, districts): `sym` is the
   fold, `arch` the clip (off on roam) and `density` the digit threshold.
   The dials roam by R₂ (dials.js), the roam fold among them. Pure, like
   cellRecipe. */
import { imod, clamp } from '../config.js';
import { Axis, Filter, Digit, Pin } from '../state.js';
import { cellRecipe, axisDelta } from './recipe.js';
import { owns, roamDials, districtDials } from './dials.js';
import { Core } from '../core/bimoblock-core.js';

const DIALS = ['shape', 'number', 'base'];
const FULL = Core.ARCH_NAMES.indexOf('full');
/* The folds roam picks from: none, and the groups that keep the y axis,
   so the units stay at the bottom and the plan view turns symmetric.
   A lathe is already symmetric about its axis, so it is left unfolded. */
export const ROAM_FOLDS = ['C1', 'Cs', 'C2v', 'C4', 'C4v'].map(n => Core.GROUPS.findIndex(g => g.name.startsWith(n + ':')));
/* The density axis on digit pages walks the threshold in tenths, so
   base 10 runs from the 9s alone (0.1) to every nonzero digit (0.9). */
const densOf = step => (step + 1) / 10;

/** @param {number} i @param {number} j @returns {{P: import('../types.js').DigitRecipe, kin: import('../types.js').Kin|null}} */
export function digitCellRecipe(i, j){
  const base = cellRecipe(i, j);
  const D = { ...base.P };
  let kin = base.kin;

  if (!kin){
    // The clip is an option: on roam a number picture is unclipped (full).
    if (!owns('arch') && Filter.arch < 0) D.arch = FULL;
    if (Axis.x === 'dens') D.density = densOf(imod(i, 9));
    else if (Axis.y === 'dens') D.density = densOf(imod(j, 9));
    const roamFold = !owns('sym') && Filter.sym < 0;
    roamDials(i, j, D, DIALS, Digit, roamFold ? [[ROAM_FOLDS.length, v => { D.sym = ROAM_FOLDS[v]; }]] : []);
    if (roamFold && D.shape === 1) D.sym = 0;
  } else {
    // The bimoblock field and lift are unused here, so their drift is noise;
    // the density is a digit threshold, held at the pin's unless an axis walks it.
    const drift = kin.drift.filter(t => t !== 'field' && t !== 'lift' && t !== 'density');
    const dDens = axisDelta('dens', i - Pin.i, j - Pin.j);
    D.density = dDens === null ? Pin.params.density : clamp(Math.round(Pin.params.density * 10 + dDens) / 10, 0.1, 0.9);
    drift.push(...districtDials(i, j, D, DIALS, kin, 0x7f4a7c15));
    kin = { ...kin, drift };
  }
  return { P: D, kin };
}
