/* Address → mod-field recipe. The base traits come from the bimoblock
   address logic unchanged (pages, filters, density, districts): `sym` is
   the optional fold, `arch` the clip, `density` the duty. Each mod-field
   dial is enumerated by an axis if one owns it, held from the field tab
   (`Easy` in state.js) if set, and otherwise picked by the page hash, the
   way bimoblock traits are, so free roam stays varied even though most
   formulas have no seed. Inside a district the dials inherit from the pin
   and drift like the base traits. Pure, like cellRecipe. */
import { ROLE_BY_ID, imod } from '../config.js';
import { Axis, Filter, Easy, Mint, Pin } from '../state.js';
import { cellRecipe, cellPage, axisDelta, hash32 } from './recipe.js';
import { Core } from '../core/bimoblock-core.js';

const DIALS = ['frame', 'formula', 'bands', 'k'];
const owns = role => Axis.x === role || Axis.y === role;

/* The page hash's pick of a dial's value, by rendezvous: each value scores
   hash(h, dial, value) and the highest wins. Frames and formulas are only
   ever appended, and a new one takes just the pages it outscores, about
   1/(n+1) of them, where `h mod n` would have moved nearly all. */
function pick(h, d, n){
  let best = 0, top = -1;
  for (let v = 0; v < n; v++){
    const w = hash32(hash32(h, d * 0x632be5ab + 1), v * 0x27d4eb2d + 1);
    if (w > top){ top = w; best = v; }
  }
  return best;
}

/** @param {number} i @param {number} j @returns {{P: import('../types.js').FieldRecipe, kin: import('../types.js').Kin|null}} */
export function fieldCellRecipe(i, j){
  const base = cellRecipe(i, j);
  const F = { ...base.P };
  let kin = base.kin;

  if (!kin){
    // The fold is an option: on roam a mod field is unfolded (C1), so each
    // frame shows its own symmetry.
    if (!owns('sym') && Filter.sym < 0) F.sym = 0;
    const { pageX, pageY } = cellPage(i, j);
    const h = hash32(hash32(pageX, 0x3c6ef372 ^ Math.imul(Mint.gen, 0x9e3779b1)), pageY * 41 + 13);
    DIALS.forEach((d, k) => {
      const n = ROLE_BY_ID[d].count;
      F[d] = Axis.x === d ? imod(i, n) : Axis.y === d ? imod(j, n)
           : Easy[d] >= 0 ? Easy[d] : pick(h, k, n);
    });
  } else {
    // A district: dials an axis owns are re-centred on the pin, the rest
    // inherited, then drifted with the same odds as the base traits.
    const A = Pin.params, di = i - Pin.i, dj = j - Pin.j;
    const t01 = Pin.radius > 1 ? (kin.ring - 1) / (Pin.radius - 1) : 1;
    const W = Core.seedWords(A.seed);
    let rs = hash32(hash32(W.lo ^ Pin.epoch ^ 0x3c6ef372, W.hi ^ (di * 83492791)), dj * 2654435761 + kin.ring) || 1;
    const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
    // The bimoblock field and lift are unused here, so their drift is noise.
    const drift = kin.drift.filter(t => t !== 'field' && t !== 'lift');
    for (const d of DIALS){
      const n = ROLE_BY_ID[d].count, delta = axisDelta(d, di, dj);
      F[d] = delta !== null ? imod(A[d] + delta, n) : A[d];
      if (delta === null && kin.ring > 0 && rnd() < t01){
        F[d] = imod(A[d] + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * (1 + t01 * n / 3))), n);
        drift.push(d);
      }
    }
    kin = { ...kin, drift };
  }
  return { P: F, kin };
}
