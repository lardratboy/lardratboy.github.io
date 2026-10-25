/* ================== FINGERPRINTS ====================================
   A specimen unfolded into a 512 × 512 image. 64³ = 512² = 2¹⁸, so at
   R = 64 every voxel owns exactly one pixel and every pixel one voxel.

   The mapping is Morton (Z-order): interleave the voxel's x, y, z bits
   into one 18-bit index (x in bits 0, 3, 6 …, y in 1, 4, 7 …, z in
   2, 5, 8 …), then deal that index's even bits to the pixel's u and its
   odd bits to v. A 2^k-aligned cube of voxels is the low 3k bits of the
   index, so it lands on one aligned block of pixels: 4³ voxels on an 8 × 8
   square, 16³ on 64 × 64 (odd k gives a 2 : 1 rectangle). Power-of-two
   tiers therefore show up as the image's own square subdivisions.

   Any other R is first resampled to 64³ by nearest cell, so the picture is
   always 512²; it is then a faithful unfold only when R divides 64, and
   tiers line up with the squares only when the radices are powers of two.

   Pure: no DOM, no THREE. The colour of a voxel is passed in as a mode,
   so the core stays independent of the renderer.
   ================================================================ */

export const FP_GRID = 64;               // voxels per side of the unfolded grid
export const FP_SIDE = 512;              // pixels per side of the image
const BACKGROUND = [10, 8, 22];          // empty cells

/* Spread the low 6 bits of n so bit i lands on bit 3i. */
function spread3(n){
  let m = 0;
  for (let i = 0; i < 6; i++) m |= ((n >> i) & 1) << (3 * i);
  return m;
}
/* Gather every other bit of m, starting at bit `from`, into a 9-bit number. */
function gather2(m, from){
  let n = 0;
  for (let i = 0; i < 9; i++) n |= ((m >> (2 * i + from)) & 1) << i;
  return n;
}

/** Pixel (u, v) of voxel (x, y, z) on the 64³ grid.
 *  @param {number} x @param {number} y @param {number} z @returns {[number, number]} */
export function mortonPixel(x, y, z){
  const m = spread3(x) | (spread3(y) << 1) | (spread3(z) << 2);
  return [gather2(m, 0), gather2(m, 1)];
}

let TABLE = null;
/** Pixel index `u + 512·v` for every cell of the 64³ grid, x fastest. Built once.
 *  @returns {Uint32Array} */
export function mortonTable(){
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(FP_GRID ** 3);
  for (let z = 0; z < FP_GRID; z++) for (let y = 0; y < FP_GRID; y++) for (let x = 0; x < FP_GRID; x++){
    const [u, v] = mortonPixel(x, y, z);
    TABLE[x + FP_GRID * y + FP_GRID * FP_GRID * z] = u + FP_SIDE * v;
  }
  return TABLE;
}

/** Unfold an instance record into RGBA pixels.
 *  `mode` 'orbit' paints each voxel `orbitColor(orbitIdx, orbitOrder)` (the
 *  same hue ramp the renderer's orbit mode uses); anything else paints the
 *  voxel's grid position as RGB, like the gamut colouring. Records with no
 *  orbit bytes fall back to position colour.
 *  @param {import('../types.js').InstanceArrays} inst  a full-resolution record (N ≤ 64)
 *  @param {string} mode
 *  @param {(bi:number, order:number) => number[]} [orbitColor]
 *  @returns {Uint8ClampedArray} `512 × 512 × 4` bytes, row-major from v = 0 */
export function fingerprintRGBA(inst, mode, orbitColor){
  const R = inst.N, n = R * R * R;
  if (R > FP_GRID) throw new Error(`fingerprint needs R ≤ ${FP_GRID}, got ${R}`);
  const rgb = new Uint8Array(n * 3), lit = new Uint8Array(n);
  const useOrbit = mode === 'orbit' && !!inst.orbitIdx && inst.orbitOrder > 0 && !!orbitColor;
  const s = 255 / Math.max(1, R - 1);
  for (let k = 0; k < inst.count; k++){
    const c = inst.cells[k];
    lit[c] = 1;
    if (useOrbit){
      const col = orbitColor(inst.orbitIdx[k], inst.orbitOrder);
      rgb[3*c] = col[0] * 255; rgb[3*c+1] = col[1] * 255; rgb[3*c+2] = col[2] * 255;
    } else {
      rgb[3*c] = (c % R) * s; rgb[3*c+1] = (((c / R) | 0) % R) * s; rgb[3*c+2] = ((c / (R*R)) | 0) * s;
    }
  }

  const src = new Int32Array(FP_GRID);
  for (let X = 0; X < FP_GRID; X++) src[X] = Math.floor(X * R / FP_GRID);
  const table = mortonTable(), out = new Uint8ClampedArray(FP_SIDE * FP_SIDE * 4);
  for (let Z = 0; Z < FP_GRID; Z++) for (let Y = 0; Y < FP_GRID; Y++){
    const row = R * src[Y] + R * R * src[Z], base = FP_GRID * Y + FP_GRID * FP_GRID * Z;
    for (let X = 0; X < FP_GRID; X++){
      const c = src[X] + row, p = 4 * table[X + base];
      if (lit[c]){ out[p] = rgb[3*c]; out[p+1] = rgb[3*c+1]; out[p+2] = rgb[3*c+2]; }
      else { out[p] = BACKGROUND[0]; out[p+1] = BACKGROUND[1]; out[p+2] = BACKGROUND[2]; }
      out[p+3] = 255;
    }
  }
  return out;
}
