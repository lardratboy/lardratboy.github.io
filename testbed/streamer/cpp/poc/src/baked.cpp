// baked.cpp — see baked.hpp; the arithmetic is baked-core.js's, in the same
// order, so every mean is the same float64 and every word the same bits.
#include "baked.hpp"
#include <stdexcept>

namespace poc {

static void sumRange(const Baked& b, double a, double e, double out[3]) {
  const int64_t A = (int64_t)std::ceil(a / BAKED_BLOCK), B = (int64_t)std::floor(e / BAKED_BLOCK);
  auto scan = [&](int64_t i, int64_t j) {
    for (; i < j; i++) { const uint32_t w = b.words[i]; out[0] += w & 255; out[1] += w >> 8 & 255; out[2] += w >> 16 & 255; }
  };
  if (A >= B) scan((int64_t)a, (int64_t)e);
  else {
    scan((int64_t)a, A * BAKED_BLOCK); scan(B * BAKED_BLOCK, (int64_t)e);
    out[0] += b.S[3 * B] - b.S[3 * A]; out[1] += b.S[3 * B + 1] - b.S[3 * A + 1]; out[2] += b.S[3 * B + 2] - b.S[3 * A + 2];
  }
}

Baked makeBaked(const Store& store, const double* counts, uint32_t skin, int D, const std::vector<uint32_t>& words) {
  Baked b;
  b.store = &store; b.counts = counts; b.skin = skin; b.D = D; b.words = words.data();
  b.N = skin == EMPTY ? 0 : counts[skin];
  if (b.N != (double)words.size()) throw std::runtime_error("baked: words and skin voxels differ");
  const int64_t N = (int64_t)b.N, nb = N / BAKED_BLOCK;
  b.S.assign(3 * (nb + 1), 0.0);
  double r = 0, g = 0, bl = 0;
  for (int64_t k = 0, i = 0; k <= nb; k++) {
    b.S[3 * k] = r; b.S[3 * k + 1] = g; b.S[3 * k + 2] = bl;
    if (k == nb) break;
    for (const int64_t end = i + BAKED_BLOCK; i < end; i++) { const uint32_t w = words[i]; r += w & 255; g += w >> 8 & 255; bl += w >> 16 & 255; }
  }
  if (N) { sumRange(b, 0, b.N, b.whole); for (double& v : b.whole) v /= b.N; }
  return b;
}

BakedCursor makeCursor(const Baked& b) {
  BakedCursor c{};
  c.pathId[b.D] = (int32_t)b.skin; c.pathStart[b.D] = 0;
  c.lastK = b.D;
  return c;
}

// descend(level, X, Y, Z): the walk from where the last one can be trusted
// (the highest bit where the two points differ, never below where it stopped).
static bool descend(const Baked& b, BakedCursor& c, int level, int32_t X, int32_t Y, int32_t Z) {
  if (b.skin == EMPTY) { c.atId = EMPTY; c.atLevel = b.D; c.atStart = 0; return false; }
  const int32_t x = X << level, y = Y << level, z = Z << level;
  const uint32_t diff = (uint32_t)((x ^ c.lx) | (y ^ c.ly) | (z ^ c.lz));
  int k = diff ? 32 - __builtin_clz(diff) : 0;
  if (k > b.D) k = b.D;
  if (k < c.lastK) k = c.lastK;
  if (k < level) k = level;
  uint32_t id = (uint32_t)c.pathId[k]; double start = c.pathStart[k];
  const Store& s = *b.store;
  for (; k > level; k--) {
    const int sh = k - 1, o = (x >> sh & 1) | (y >> sh & 1) << 1 | (z >> sh & 1) << 2;
    const uint32_t ch = s.child(id, o);
    if (ch == EMPTY) break;
    for (int j = 0; j < o; j++) { const uint32_t q = s.child(id, j); if (q != EMPTY) start += b.counts[q]; }
    id = ch; c.pathId[sh] = (int32_t)ch; c.pathStart[sh] = start;
  }
  c.lastK = k; c.lx = x; c.ly = y; c.lz = z;
  c.atId = id; c.atLevel = k; c.atStart = start;
  return k == level && id != EMPTY;
}

void bakedMean(const Baked& b, BakedCursor& c, int level, int64_t x, int64_t y, int64_t z, double out[3]) {
  descend(b, c, level, (int32_t)(x >> level), (int32_t)(y >> level), (int32_t)(z >> level));
  out[0] = out[1] = out[2] = 0;
  if (c.atId == EMPTY || c.atLevel > level + b.climb) { out[0] = b.whole[0]; out[1] = b.whole[1]; out[2] = b.whole[2]; return; }
  const double n = c.atId == EMPTY ? 0 : b.counts[c.atId];
  sumRange(b, c.atStart, c.atStart + n, out);
  out[0] /= n; out[1] /= n; out[2] /= n;
}

} // namespace poc
