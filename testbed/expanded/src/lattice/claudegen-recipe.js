/* Address → claudegen recipe. The base traits come from the bimoblock
   address logic unchanged (pages, seed, districts): `sym` is an optional
   fold and `arch` an optional clip, both off on roam, since a flaw is
   what breaks a crystal's symmetry; `density` is the fill and keeps its
   slider, axis role and drift. The dials (motif, flaw, strength,
   spacing, view) roam by R₂ (dials.js); the view is weighted, so about
   one roam page in four is turned off the grid. Pure, like cellRecipe. */
import { Filter, Claudegen } from '../state.js';
import { cellRecipe } from './recipe.js';
import { owns, roamDials, districtDials } from './dials.js';
import { Core } from '../core/bimoblock-core.js';

const DIALS = ['motif', 'flaw', 'strength', 'spacing', 'view'];
const FULL = Core.ARCH_NAMES.indexOf('full');
/* The views roam picks from: on the grid nine times in twelve, each
   tilt once, so a tilted crystal is a find rather than the norm. */
export const ROAM_VIEWS = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3];

/** @param {number} i @param {number} j @returns {{P: import('../types.js').ClaudegenRecipe, kin: import('../types.js').Kin|null}} */
export function claudegenCellRecipe(i, j){
  const base = cellRecipe(i, j);
  const C = { ...base.P };
  let kin = base.kin;
  if (!kin){
    if (!owns('sym') && Filter.sym < 0) C.sym = 0;
    if (!owns('arch') && Filter.arch < 0) C.arch = FULL;
    const roamView = !owns('view') && Claudegen.view < 0;
    roamDials(i, j, C, roamView ? DIALS.filter(d => d !== 'view') : DIALS, Claudegen,
      roamView ? [[ROAM_VIEWS.length, v => { C.view = ROAM_VIEWS[v]; }]] : []);
  } else {
    // The bimoblock field and lift are unused here, so their drift is noise.
    const drift = kin.drift.filter(t => t !== 'field' && t !== 'lift');
    drift.push(...districtDials(i, j, C, DIALS, kin, 0x5f356495));
    kin = { ...kin, drift };
  }
  return { P: C, kin };
}
