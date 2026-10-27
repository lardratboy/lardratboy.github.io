/* Address → bimomirror recipe. The child is a bimoblock, so the base
   traits come from the bimoblock address logic unchanged (pages, seed,
   districts) and keep their jobs: `sym` is the child's fold, `arch`,
   `field`, `lift`, `density` and the seed shape it. Where the child's
   fold comes from is the mirror tab's `child` setting: the bimoblock at
   this address (Oh, which would make eight identical copies, becomes Td)
   or a roam of its own weighted towards the low folds, where the copies
   differ most. The dials (group, seat) roam by R₂ (dials.js); roam never
   picks the `copy` control, and the tab's `aligned` seat setting prefers
   the seats that line a C3 or S6 child up with the octant diagonal.
   Pure, like cellRecipe. */
import { Filter, Mirror } from '../state.js';
import { cellRecipe } from './recipe.js';
import { owns, roamDials, districtDials } from './dials.js';
import { ALIGNED_SEATS } from '../core/mirror-core.js';

const DIALS = ['group', 'seat'];
const OH = 9, TD = 8;
/* The arrangements roam picks from: mirror, turn, pinwheel, twist. */
export const ROAM_GROUPS = [1, 2, 3, 4];
/* Child folds for `child: roam`, weighted towards the low groups:
   C1 three times, Cs, C2 and C3 twice, the rest once, never Oh. */
export const ROAM_CHILD = [0, 0, 0, 1, 1, 2, 2, 3, 4, 4, 5, 6, 7, 8];
/* The mirror tab's seat setting when no seat is held: -1 any, -2 aligned. */
export const SEAT_ANY = -1, SEAT_ALIGNED = -2;

/** @param {number} i @param {number} j @returns {{P: import('../types.js').MirrorRecipe, kin: import('../types.js').Kin|null}} */
export function mirrorCellRecipe(i, j){
  const base = cellRecipe(i, j);
  const C = { ...base.P };
  let kin = base.kin;
  const foldFree = !owns('sym') && Filter.sym < 0;
  if (!kin){
    const extra = [];
    if (!owns('group') && Mirror.group < 0) extra.push([ROAM_GROUPS.length, v => { C.group = ROAM_GROUPS[v]; }]);
    if (foldFree && Mirror.child === 1) extra.push([ROAM_CHILD.length, v => { C.sym = ROAM_CHILD[v]; }]);
    roamDials(i, j, C, DIALS.filter(d => d !== 'group' || owns(d) || Mirror.group >= 0), Mirror, extra);
    if (foldFree && C.sym === OH) C.sym = TD;
    // Every aligned list has 2, 4 or 8 seats, so this stays uniform.
    if (!owns('seat') && Mirror.seat === SEAT_ALIGNED) C.seat = ALIGNED_SEATS[C.sym][C.seat % ALIGNED_SEATS[C.sym].length];
  } else {
    const drift = [...kin.drift];
    // Drift keeps away from what roam avoids: eight identical copies, and the control.
    if (drift.includes('sym') && C.sym === OH) C.sym = TD;
    drift.push(...districtDials(i, j, C, DIALS, kin, 0x6a09e667));
    if (drift.includes('group') && !C.group) C.group = ROAM_GROUPS[0];
    kin = { ...kin, drift };
  }
  return { P: C, kin };
}
