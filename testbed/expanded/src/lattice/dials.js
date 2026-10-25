/* Generator dials on the lattice: the shared half of an address → recipe
   step for generators whose dials roam by Roberts' R₂ sequence (number
   pictures, carry). Each dial is enumerated by an axis if one owns it,
   held from the generator's tab if set (>= 0), and otherwise one digit of
   a single mixed-radix pick from the page (kronecker.js), so neighbouring
   pages never repeat once there are six or more combinations. Inside a
   district the dials inherit from the pin and drift like the base traits.
   Pure, like cellRecipe. */
import { ROLE_BY_ID, imod } from '../config.js';
import { Axis, Mint, Pin } from '../state.js';
import { cellPage, axisDelta, hash32 } from './recipe.js';
import { r2Pick } from './kronecker.js';
import { Core } from '../core/bimoblock-core.js';

export const owns = role => Axis.x === role || Axis.y === role;

/** Set R's dials on roam. `extra` are more free choices taken from the
 *  same pick, least significant last, as [count, set(value)] pairs.
 *  @param {number} i @param {number} j @param {Object} R the recipe
 *  @param {string[]} dials @param {Object<string, number>} held
 *  @param {Array<[number, (v:number) => void]>} [extra] */
export function roamDials(i, j, R, dials, held, extra = []){
  const { pageX, pageY } = cellPage(i, j);
  const free = [];
  for (const d of dials){
    const n = ROLE_BY_ID[d].count;
    if (Axis.x === d) R[d] = imod(i, n);
    else if (Axis.y === d) R[d] = imod(j, n);
    else if (held[d] >= 0) R[d] = held[d];
    else free.push([n, v => { R[d] = v; }]);
  }
  // The free choices as one mixed-radix number, first dial most significant.
  const all = [...free, ...extra];
  let c = r2Pick(pageX, pageY, Mint.gen, all.reduce((n, [k]) => n * k, 1));
  for (let k = all.length - 1; k >= 0; k--){
    const [n, set] = all[k];
    set(c % n); c = Math.floor(c / n);
  }
}

/** Set R's dials inside a district: dials an axis owns are re-centred on
 *  the pin, the rest inherited, then drifted with the same odds as the
 *  base traits. Returns the dials that drifted. `salt` keeps one
 *  generator's drift independent of another's.
 *  @param {number} i @param {number} j @param {Object} R @param {string[]} dials
 *  @param {import('../types.js').Kin} kin @param {number} salt @returns {string[]} */
export function districtDials(i, j, R, dials, kin, salt){
  const A = Pin.params, di = i - Pin.i, dj = j - Pin.j;
  const t01 = Pin.radius > 1 ? (kin.ring - 1) / (Pin.radius - 1) : 1;
  const W = Core.seedWords(A.seed);
  let rs = hash32(hash32(W.lo ^ Pin.epoch ^ salt, W.hi ^ (di * 83492791)), dj * 2654435761 + kin.ring) || 1;
  const rnd = () => { rs ^= rs << 13; rs ^= rs >>> 17; rs ^= rs << 5; rs >>>= 0; return rs / 4294967296; };
  const drift = [];
  for (const d of dials){
    const n = ROLE_BY_ID[d].count, delta = axisDelta(d, di, dj);
    R[d] = delta !== null ? imod(A[d] + delta, n) : A[d];
    if (delta === null && kin.ring > 0 && rnd() < t01){
      R[d] = imod(A[d] + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * (1 + t01 * n / 3))), n);
      drift.push(d);
    }
  }
  return drift;
}
