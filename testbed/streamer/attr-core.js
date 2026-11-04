/* ================== ATTR CORE (pure) =================================
   Q13's attribute word (docs/attributes-q13.md, decided 2026-10-10): one
   32-bit word per shown voxel, laid out as RGBA8 bytes, little-endian, so
   byte 0 is R:

     bits  0–1   reserved      bits  2–7   red,   6 bits
     bits  8–9   reserved      bits 10–15  green, 6 bits
     bits 16–17  reserved      bits 18–23  blue,  6 bits
     bits 24–31  reserved (the A byte)

   Colour sits in the high 6 bits of each colour byte, so an image codec
   that predicts per channel sees one channel per byte (Q14), and the
   reserved bits are the low 2 of each colour byte plus all of A. Writers
   write 0 there, readers ignore it: every word baked now stays valid when
   a field is defined later, and each such field must bring its own coarse
   reduction (attributes-q13.md §3).

   This file decides the layout. GLSL_ATTR in chunk-glsl.js is the shader
   half, and chunk-viewer.html's probe holds the two to each other exactly
   (CLAUDE.md, "An attribute word's layout"). No imports, so a worker,
   Node and the pages load it as is.
   ===================================================================== */

export const R_SHIFT = 2, G_SHIFT = 10, B_SHIFT = 18;
export const ATTR_COLOUR = (63 << R_SHIFT | 63 << G_SHIFT | 63 << B_SHIFT) >>> 0;
export const ATTR_RESERVED = ~ATTR_COLOUR >>> 0;

export const packAttr = (r6, g6, b6) => (r6 << R_SHIFT | g6 << G_SHIFT | b6 << B_SHIFT) >>> 0;
export const attrRGB = w => [w >>> R_SHIFT & 63, w >>> G_SHIFT & 63, w >>> B_SHIFT & 63];

/* 8-bit channel (a float in [0, 255], since a coarse mean is one) to 6
   bits, round to nearest: v · 63 / 255. 0 → 0 and 255 → 63, and the
   rounding is the only loss, done once per word (docs/attrs-plan.md,
   decision 6). */
export const to6 = v => Math.min(63, Math.max(0, Math.round(v * 63 / 255)));
export const attrOf8 = (r, g, b) => packAttr(to6(r), to6(g), to6(b));

/* A colour field returns 8-bit RGB packed as r | g << 8 | b << 16: one
   integer, no allocation per voxel. rgb8 packs, and clamps a float. */
const c8 = v => Math.min(255, Math.max(0, Math.round(v)));
export const rgb8 = (r, g, b) => c8(r) | c8(g) << 8 | c8(b) << 16;
export const r8 = c => c & 255, g8 = c => c >> 8 & 255, b8 = c => c >> 16 & 255;
