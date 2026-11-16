// job.hpp — the chunk job: job-core.js's fastChunk with stream-core's
// buried-chunk shortcut, i.e. exactly what createJobRunner runs in the
// browser's chunk workers. One 64³ chunk of the DAG at a lod becomes 4-byte
// instance records (Morton cell | face mask << 18 | pose << 24), with the
// seam tail after them, and, for a baked world, one attribute word each.
//
// Poses are always 0 here: the viewer's poses come from createClasses (the
// Oh classes), which only the ray path's brick dedup needs. The JS twin
// (bench/bench.mjs) runs without classes too, so the bytes compare.
#pragma once
#include "dag.hpp"
#include "baked.hpp"
#include "fields.hpp"
#include <array>
#include <unordered_map>

namespace poc {

enum class Rule : int { Any, Majority, Volume, Opacity, Adaptive, Shadow };
const char* ruleName(Rule r);
bool ruleFromName(const char* s, Rule& out);

struct World {
  const Store* store = nullptr;
  const double* counts = nullptr;
  uint32_t root = EMPTY;
  int D = 0;
  const Baked* baked = nullptr;     // a baked field (its exact means), or
  const Named* named = nullptr;     // a named one (sampled, cellAttr's walk); neither: no words, gamut
  bool coloured() const { return baked || named; }
};

struct JobResult {
  int lod = 0; int64_t cx = 0, cy = 0, cz = 0;
  std::vector<uint32_t> records;    // count main records, then the seam tail
  std::vector<uint32_t> attrs;      // one per record when baked, else empty
  uint32_t count = 0, quads = 0, openQuads[6] = { 0, 0, 0, 0, 0, 0 };
  double occupied = 0;
  bool buriedChunk = false;
  double ms = 0;
};

// Each worker thread owns one: the 66³ occupancy grid and the other scratch
// arrays (module-level in the JS, one set per worker there too), the brick
// mask cache (createJobCache, one per runner), and the colour's path memo.
struct JobScratch {
  std::vector<uint8_t> grid = std::vector<uint8_t>(66 * 66 * 66);
  std::vector<uint8_t> coarse = std::vector<uint8_t>(34 * 34 * 34);
  std::vector<uint32_t> cells, xyz, ids;
  std::vector<uint32_t> recs, attrs, tail, tailAttrs;
  // masks: key (rule, lod, node) -> index into maskPool, or ALL_KEPT
  std::unordered_map<uint64_t, uint32_t> masks;
  std::vector<std::array<uint32_t, 16>> maskPool;
  uint64_t maskHits = 0, maskMisses = 0;
  BakedCursor cursor{};
  FieldCache fieldCache;
  const Baked* cursorOf = nullptr;
};

// Rule for lod 0 is always 'any' (stream-core's lodRuleOf); `rule` is the coarse lods'.
JobResult runJob(const World& w, JobScratch& s, int lod, int64_t cx, int64_t cy, int64_t cz, Rule coarseRule);

} // namespace poc
