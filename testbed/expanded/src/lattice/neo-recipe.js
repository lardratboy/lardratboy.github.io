/* Address → neoblock recipe. The base traits come from the bimoblock
   address logic unchanged (pages, filters, density, districts); each
   modifier dial is enumerated by an axis if one owns it, else taken from
   the neo tab (`Neo` in state.js). Pure, like cellRecipe. */
import { ROLE_BY_ID, imod } from '../config.js';
import { Axis, Neo } from '../state.js';
import { cellRecipe } from './recipe.js';

const DIALS = ['source', 'place', 'palette', 'orient', 'warp', 'warpAmt', 'eps', 'largest'];

/** @param {number} i @param {number} j @returns {{P: import('../types.js').NeoRecipe, kin: import('../types.js').Kin|null}} */
export function neoCellRecipe(i, j){
  const { P, kin } = cellRecipe(i, j);
  const N = { ...P };
  for (const d of DIALS){
    const { count: n, min = 0 } = ROLE_BY_ID[d];
    N[d] = Axis.x === d ? min + imod(i, n) : Axis.y === d ? min + imod(j, n) : Neo[d];
  }
  return { P: N, kin };
}
