/* What DataPrism makes of a file of integer triples, as a picture
   (docs/nodesastuples.md §6): shared by experiments/tuples.mjs and
   experiments/offsets.mjs.

   DataPrism (../../dataprism-showroom/DataPrism.html, its dp.md §3) maps
   an integer linearly from its type's whole range to [−1, 1], bins each
   axis at q bits (8 by default) and keeps the first point in a bin.
   keep() does the same; preview() draws what's kept straight down each
   axis (XY, XZ, YZ), the nearest point winning, coloured by its position
   as DataPrism's XYZ colour is. DataPrism orbits and lays 1 MB chunks on
   a grid; this doesn't. */
import { deflateSync, crc32 } from 'node:zlib';

export const BITS = 8;
const BINS = 1 << BITS;
const RANGE = { uint32: [0, 4294967295], int16: [-32768, 32767] };

/* What DataPrism keeps of a file: each value → [−1, 1] over its type's
   whole range, BITS bits an axis, the first point in a bin. */
export function keep(t, type){
  const [lo, hi] = RANGE[type], bin = v => Math.min(BINS - 1, Math.floor((v - lo) / (hi - lo) * BINS));
  const seen = new Uint8Array(BINS ** 3), pts = [];
  for (let i = 0; i < t.length; i += 3){
    const b = [bin(t[i]), bin(t[i + 1]), bin(t[i + 2])], k = b[0] + BINS * (b[1] + BINS * b[2]);
    if (!seen[k]){ seen[k] = 1; pts.push(b); }
  }
  return pts;
}
/* Three views down the axes, 2 px a bin, nearest point wins (largest
   depth bin). With `slice`, only the points in the middle bin of the
   axis looked down (offset 0 of a symmetric cloud): the planes dz = 0,
   dy = 0 and dx = 0, where a projection would pile every depth on top. */
export function preview(pts, { slice = false } = {}){
  const S = 2 * BINS, gap = 8, W = 3 * S + 2 * gap, img = new Uint8Array(W * S * 3);
  const views = [[0, 1, 2], [0, 2, 1], [1, 2, 0]], depth = views.map(() => new Int16Array(BINS * BINS).fill(-1)), at = views.map(() => new Int32Array(BINS * BINS));
  pts.forEach((p, n) => views.forEach(([u, v, w], k) => {
    if (slice && p[w] !== BINS / 2) return;
    const c = p[u] + BINS * (BINS - 1 - p[v]);
    if (p[w] > depth[k][c]){ depth[k][c] = p[w]; at[k][c] = n; }
  }));
  views.forEach((_, k) => {
    for (let c = 0; c < BINS * BINS; c++){
      if (depth[k][c] < 0) continue;
      const p = pts[at[k][c]], x0 = k * (S + gap) + 2 * (c % BINS), y0 = 2 * Math.floor(c / BINS);
      // DataPrism's XYZ colour, lifted off black so dark corners still show.
      const rgb = p.map(b => 60 + Math.round(195 * b / (BINS - 1)));
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) img.set(rgb, 3 * ((y0 + dy) * W + x0 + dx));
    }
  });
  // The panels' edges, dim grey.
  for (let k = 0; k < 3; k++) for (let i = 0; i < S; i++) for (const [x, y] of [[k * (S + gap) + i, 0], [k * (S + gap) + i, S - 1], [k * (S + gap), i], [k * (S + gap) + S - 1, i]])
    if (!img[3 * (y * W + x)]) img.set([40, 40, 40], 3 * (y * W + x));
  return png(W, S, img);
}
export function png(w, h, rgb){
  const raw = Buffer.alloc((3 * w + 1) * h);
  for (let y = 0; y < h; y++){ raw[y * (3 * w + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + 3 * w * y, 3 * w).copy(raw, y * (3 * w + 1) + 1); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4);
    len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

