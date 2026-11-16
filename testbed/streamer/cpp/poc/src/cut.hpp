// cut.hpp — stream-core.js's cut and cover, and its clearance.
//
//   selectChunks  split a chunk into its non-empty children while the eye is
//                 nearer its box than `detail` chunk sides (and its lod > 0),
//                 largest-looking first from a binary heap, refusing a split
//                 past maxChunks. Every voxel lies in exactly one leaf.
//   coverOf       what to draw given what is resident: bottom-up, a region
//                 draws complete tilings, "complete beats finer", and each
//                 drawn chunk gets `open`, the sides whose same-lod neighbour
//                 exists but isn't drawn (the seam tail shows there).
//   clearance     how far the nearest voxel is (the near plane, the speed).
//
// The heap is the JS heap step for step, so a capped cut keeps the same
// chunks as the browser's.
#pragma once
#include "dag.hpp"
#include <functional>
#include <unordered_map>

namespace poc {

struct Chunk {
  int lod = 0; int64_t x = 0, y = 0, z = 0;
  uint32_t id = EMPTY;
  double size = 0, lo[3] = { 0, 0, 0 }, dist = 0;
  int parent = -1, kidsBegin = -1, kidsCount = 0;   // indices into Cut::nodes
  uint64_t key = 0;
  int open = 0;
};

// 5 bits of lod and 19 a coordinate: worlds to D = 25.
inline uint64_t keyOf(int lod, int64_t x, int64_t y, int64_t z) {
  return (uint64_t)lod << 57 | (uint64_t)x << 38 | (uint64_t)y << 19 | (uint64_t)z;
}

struct CutWorld { const Store* store; uint32_t root; int D; };

struct Cut {
  CutWorld world{};
  double eye[3] = { 0, 0, 0 };
  std::vector<Chunk> nodes;                     // every chunk of the cut, leaves and splits
  std::unordered_map<uint64_t, int> index;      // key -> nodes[]
  std::vector<int> leaves;                      // nearest first
  int root = -1, capped = 0;
};

Cut selectChunks(const CutWorld& w, const double eye[3], double detail, int maxChunks, int minLod = 0);

struct Cover {
  std::vector<Chunk> draw;
  int holes = 0, up = 0, down = 0;
  std::vector<int> holeLeaves;                  // indices into the cut's nodes
};
Cover coverOf(const Cut& cut, const std::function<bool(uint64_t)>& has);

double clearance(const CutWorld& w, const double eye[3], int budget = 2048);

} // namespace poc
