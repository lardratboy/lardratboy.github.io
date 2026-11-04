/* ================== CHUNK GLSL (pure) ================================
   The record decode, as the one GLSL string every program prepends
   (ifsandwhats.md §9.4: one source per shared shader fragment). It moved
   here from chunk-viewer.html in step 4 (docs/stream-plan.md, decision 12),
   because stream-viewer.html draws the same records. chunk-viewer.html's
   decode probe runs this string under transform feedback and compares
   every function below with chunk-core.js's CPU decode, exactly, so this
   file and chunk-core's packRecord / mortonOf / shownMask change together
   (CLAUDE.md, "A record's layout").

   Record layout: chunk-core.js's header. mortonDecode undoes mortonOf:
   bit 3b of the index is bit b of x, 3b+1 of y, 3b+2 of z. The centre is
   exact in f32 when the origin is an integer below 2^24: the cell is an
   integer below 64, + 0.5, times a power of two. stream-viewer passes a
   camera-relative origin instead, which is not an integer; the probe
   checks the formula with integer origins, and the render only needs it
   to be close.

   recShown is the mask the render uses: the record's own faces, plus
   every boundary face on a side the virtualiser has flagged open, because
   the neighbour across it is drawn at another lod (chunk-core.js,
   "seams between lods"). chunk-viewer sets uOpenSides = 0, which makes it
   the plain mask.

   GLSL_ATTR (step 6) is the attribute word's decode, attr-core.js's
   attrRGB in GLSL: layout A, colour in the high 6 bits of each of the R, G
   and B bytes, the reserved bits ignored. The same probe reads every word
   back through it and compares with attrRGB, exactly (CLAUDE.md, "An
   attribute word's layout"). Every program that shades with the word
   prepends it: both viewers' raster passes and the ray pass. */
import { CELL_MASK, MASK_SHIFT, POSE_SHIFT } from './chunk-core.js';
import { R_SHIFT, G_SHIFT, B_SHIFT } from './attr-core.js';

export const GLSL_DECODE = `
uvec3 mortonDecode(uint i){
  uvec3 c = uvec3(0u);
  for (uint b = 0u; b < 6u; b++){
    c.x |= ((i >> (3u*b))      & 1u) << b;
    c.y |= ((i >> (3u*b + 1u)) & 1u) << b;
    c.z |= ((i >> (3u*b + 2u)) & 1u) << b;
  }
  return c;
}
uniform vec3 uOrigin;      // chunk low corner, voxels
uniform float uCellSize;   // 2^lod voxels
uniform uint uOpenSides;   // +X −X +Y −Y +Z −Z: neighbour drawn at another lod
uvec3 recCell(uint r){ return mortonDecode(r & ${CELL_MASK}u); }
uint  recMask(uint r){ return (r >> ${MASK_SHIFT}u) & 63u; }
uint  recPose(uint r){ return (r >> ${POSE_SHIFT}u) & 63u; }
vec3  recCentre(uint r){ return uOrigin + (vec3(recCell(r)) + 0.5) * uCellSize; }
uint  boundaryBits(uvec3 c){
  return (c.x == 63u ? 1u : 0u) | (c.x == 0u ? 2u : 0u) | (c.y == 63u ? 4u : 0u)
       | (c.y == 0u ? 8u : 0u) | (c.z == 63u ? 16u : 0u) | (c.z == 0u ? 32u : 0u);
}
uint  recShown(uint r){ return recMask(r) | (boundaryBits(recCell(r)) & uOpenSides); }
bool  faceShown(uint r, uint f){ return ((recShown(r) >> f) & 1u) == 1u; }
`;

export const GLSL_ATTR = `
uvec3 attrRGB(uint w){ return uvec3((w >> ${R_SHIFT}u) & 63u, (w >> ${G_SHIFT}u) & 63u, (w >> ${B_SHIFT}u) & 63u); }
vec3  attrColour(uint w){ return vec3(attrRGB(w)) / 63.0; }
`;
