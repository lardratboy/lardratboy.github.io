/* ================== FINGERPRINTS ====================================
   A specimen's filled voxels as a picture: one pixel per voxel, on the
   smallest square that holds them all (side ⌈√count⌉).

   Pixel k is the record's k-th occupied cell, in its walk order (raster,
   x fastest, then y, then z), read row by row from the top left. Its RGB
   is the cell's grid position scaled to 0..255, (x, y, z) · 255 / (R − 1),
   like the gamut colouring; for R ≤ 256 every coordinate gets its own byte,
   so the position reads back exactly. The pixels after the last voxel are
   transparent, so they can't be mistaken for a voxel at the origin.

   Pure: no DOM, no THREE.
   ================================================================ */

/** Side of the smallest square with at least `count` pixels (at least 1).
 *  @param {number} count @returns {number} */
export function fingerprintSide(count){
  let s = Math.ceil(Math.sqrt(count));
  while (s * s < count) s++;
  while (s > 1 && (s - 1) * (s - 1) >= count) s--;
  return Math.max(1, s);
}

/** Lay an instance record's filled voxels out as RGBA pixels.
 *  @param {import('../types.js').InstanceArrays} inst  a full-resolution record
 *  @returns {{ side:number, data:Uint8ClampedArray }}  `side × side × 4` bytes, row-major from the top */
export function fingerprintRGBA(inst){
  const R = inst.N, RR = R * R, side = fingerprintSide(inst.count);
  const data = new Uint8ClampedArray(side * side * 4);
  const s = 255 / Math.max(1, R - 1);
  for (let k = 0; k < inst.count; k++){
    const c = inst.cells[k], p = 4 * k;
    data[p] = (c % R) * s; data[p+1] = (((c / R) | 0) % R) * s; data[p+2] = ((c / RR) | 0) * s;
    data[p+3] = 255;
  }
  return { side, data };
}
