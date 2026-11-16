// baked.hpp — baked-core.js's createBaked: a world's own colours, one rgb8
// word per skin voxel in rank (Morton) order, asked as the exact mean of a
// cell's skin at any level.
//
// Split in two because threads share one and not the other:
//   Baked        the words and the block sums (a running sum every 64 words),
//                read-only, shared by every worker;
//   BakedCursor  the path memo (where the last walk went), one per worker.
//                It's what makes a lod-0 word cost about one child read
//                instead of D, and it's mutable, so it can't be shared.
#pragma once
#include "dag.hpp"

namespace poc {

constexpr int BAKED_BLOCK = 64;

struct Baked {
  const Store* store = nullptr;
  const double* counts = nullptr;
  uint32_t skin = EMPTY;
  int D = 0, climb = CHUNK_LEVELS;
  const uint32_t* words = nullptr;
  double N = 0;
  std::vector<double> S;          // S[3k + c]: channel c over words [0, 64k)
  double whole[3] = { 0, 0, 0 };  // the whole skin's mean, the last fallback
};

struct BakedCursor {
  int32_t pathId[32]; double pathStart[32];
  int lastK = 0; int32_t lx = 0, ly = 0, lz = 0;
  uint32_t atId = EMPTY; int atLevel = 0; double atStart = 0;
};

Baked makeBaked(const Store& store, const double* counts, uint32_t skin, int D, const std::vector<uint32_t>& words);
BakedCursor makeCursor(const Baked& b);
// field.mean(level, x, y, z, out): x, y, z in voxels; out = three 8-bit channels as floats.
void bakedMean(const Baked& b, BakedCursor& c, int level, int64_t x, int64_t y, int64_t z, double out[3]);

} // namespace poc
