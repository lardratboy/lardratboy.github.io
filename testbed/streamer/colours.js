/* COLOURS — the colour field each world names (docs/attrs-plan.md,
   decisions 1 and 2). Pure; imports attr-core.js and the shapes.

   A world's snapshot carries a descriptor, not a function, because a
   worker can't receive a function:
     { kind: 'shape', name, D }   the shape's own colour (shapes.mjs)
     { kind: 'row', D }           the testbed rows' shared colour, below
     { kind: 'scatter', …, table } the scatter world's: the ground's colour,
                                  and each specimen's gamut colour in its
                                  own frame (scatter-core.js, scatterColour)
     { kind: 'lattice', …, table } the lattice world's: the same gamut
                                  colour, grey between the boxes
                                  (lattice-core.js, latticeColour)
     { kind: 'kit', … }           the kit world's: the gamut in each
                                  level-c entry's own frame, turned with
                                  it (kit-core.js, kitColour). No table:
                                  the field rebuilds the kit's plan from
                                  the descriptor, a few ms
     { kind: 'caves', D, seed, G } the caves' (cave-core.js, caveColour):
                                  strata, the surface's grass, rock and
                                  snow, water and lava. No table: the
                                  field rebuilds the plan, ~0.6 s at D = 12
     { kind: 'clay', D, lump, … } the clay and flat worlds' (clay-core.js,
                                  clayColour): clay above the centre plane,
                                  ground below it. Nothing to rebuild
     null                         no colour: jobs emit no words
   colourOf(desc) turns it into a field on whichever side asks: the
   worker, the pool's main-thread fallback, Node's simulator and the tests.
   A field takes a point in voxel units (voxel i's centre is i + 0.5) and
   returns 8-bit RGB packed by attr-core's rgb8.

   The rows' colour. A row is an automaton with no notion of material, so
   its colour is a field of position alone: a cosine palette along a
   diagonal of the world, so the large structure reads as a gradient, and
   a ±12% brightness jitter per aligned 4³ block of voxels. The jitter is
   there for the coarse mean (decision 5): a smooth field averages to
   almost what any sample gives, but a block jitter averages to the
   palette alone from lod 2 up, so a mean that is wrong shows. */
import { rgb8 } from './attr-core.js';
import { SHAPES, colourFieldOf } from './experiments/shapes.mjs';
import { scatterColour } from './scatter-core.js';
import { latticeColour } from './lattice-core.js';
import { kitColour } from './kit-core.js';
import { caveColour } from './cave-core.js';
import { clayColour } from './clay-core.js';

const TAU = 2 * Math.PI;
function hash3(i, j, k){
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x165667b1) ^ Math.imul(k | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
/* The palette is a 1,024-entry table: three cosines per call were most
   of a records job's colour time on the rows (~100 ns a voxel). */
const PAL = new Float64Array(3 * 1024);
for (let i = 0; i < 1024; i++){
  const t = i / 1023;
  PAL[3 * i] = 255 * (0.55 + 0.4 * Math.cos(TAU * t));
  PAL[3 * i + 1] = 255 * (0.5 + 0.4 * Math.cos(TAU * (t + 0.18)));
  PAL[3 * i + 2] = 255 * (0.5 + 0.42 * Math.cos(TAU * (t + 0.4)));
}
export function rowColour(D){
  const inv = 1023 / 2 ** D;
  return (x, y, z) => {
    const i = 3 * Math.min(1023, Math.max(0, Math.round((0.45 * y + 0.35 * x + 0.2 * z) * inv)));
    const k = 0.88 + 0.24 * hash3(Math.floor(x / 4), Math.floor(y / 4), Math.floor(z / 4));
    return rgb8(k * PAL[i], k * PAL[i + 1], k * PAL[i + 2]);
  };
}

export function colourOf(desc){
  if (!desc) return null;
  if (desc.kind === 'row') return rowColour(desc.D);
  if (desc.kind === 'shape'){
    const shape = SHAPES.find(s => s.name === desc.name);
    if (!shape) throw new Error(`colourOf: no shape '${desc.name}'`);
    return colourFieldOf(shape, desc.D);
  }
  if (desc.kind === 'scatter') return scatterColour(desc, rgb8);
  if (desc.kind === 'lattice') return latticeColour(desc, rgb8);
  if (desc.kind === 'kit') return kitColour(desc, rgb8);
  if (desc.kind === 'caves') return caveColour(desc, rgb8);
  if (desc.kind === 'clay') return clayColour(desc, rgb8);
  throw new Error(`colourOf: unknown kind '${desc.kind}'`);
}
