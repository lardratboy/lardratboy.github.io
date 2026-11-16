// fields.hpp — named colour fields: a world's colour as code, rebuilt from
// its descriptor and table (colours.js's colourOf), for three kinds:
//
//   scatter  scatter-core.js's scatterColour: each specimen's gamut in its
//            own turned frame, over the hills' colour (experiments/shapes.mjs)
//   kit      kit-core.js's kitColour: the gamut in each level-c entry's own
//            frame, which needs kitPlan, so kitPlan is ported too
//   dungeon  dungeon-core.js's dungeonColour: by material, from the tile
//            codes in the table, which needs the tile table and tileKinds
//
// Each answers colour(x, y, z) → rgb8 (r | g << 8 | b << 16) at a point in
// voxels, as the JS fields do; chunk-core's cellAttr samples it (a voxel's
// centre at lod 0, the mean of sub-cell centres above). The arithmetic is the
// JS's in the same order, built without FMA contraction (CMakeLists.txt), so
// every word is the same bits as the browser's.
//
// Read-only once made, so every worker shares one. The kit's frame cache is
// the one mutable part: it lives in FieldCache, one per worker.
#pragma once
#include "vdag.hpp"
#include <array>
#include <string>
#include <unordered_map>

namespace poc {

enum class FieldKind { None, Scatter, Kit, Dungeon };

struct ScatterField { int D = 0, pitch = 0, R = 0, perAxis = 0; double s = 0; std::vector<int32_t> table; };

struct KitField {
  int L = 0, c = 0;
  double world = 0, S = 0, K = 0, cells = 0;
  std::vector<std::vector<int32_t>> CH;   // per level, child index a slot (−1 empty)
  std::vector<std::vector<uint8_t>> TU;   // per level, the slot's Oh turn
  std::vector<double> SIDE;
  uint8_t PX[48 * 3], FL[48 * 3];
};

struct DungeonField {
  int N = 0, F = 0;
  std::vector<int32_t> codes;
  // tileKinds(code, top) for every (code, top) the table holds, made at load.
  std::unordered_map<int32_t, std::array<uint8_t, 4096>> kinds;
};

struct Named {
  FieldKind kind = FieldKind::None;
  ScatterField scatter;
  KitField kit;
  DungeonField dungeon;
};

// The kit's per-worker frame cache: kitColour's KEY and MAP.
struct FieldCache {
  std::vector<double> key, map;
};

// A named field for this world, or kind None and the reason in `why`.
Named makeNamed(const WorldInfo& w, std::string& why);
const char* fieldName(FieldKind k);
uint32_t namedColour(const Named& f, FieldCache& cache, double x, double y, double z);

} // namespace poc
