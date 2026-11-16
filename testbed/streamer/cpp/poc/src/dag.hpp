// dag.hpp — the hash-consed binary voxel DAG, as dag-core.js has it.
//
// A node is 9 uint32 words: its level, then 8 child ids in Morton octant
// order (octant = bx | by<<1 | bz<<2). EMPTY (0) and FULL (1, a level-0
// voxel) are never stored; real ids start at FIRST_NODE (2) and are handed
// out children-first, so a node's children always have smaller ids. That is
// what lets counts be one sweep up the ids, exactly like createCounts.
//
// Plain structs and free functions on purpose: this is a proof of concept
// whose point is to time the same algorithms as the JavaScript, not to
// design a C++ engine.
#pragma once
#include <cstdint>
#include <vector>
#include <cmath>

namespace poc {

constexpr uint32_t EMPTY = 0, FULL = 1, FIRST_NODE = 2;
constexpr int CHUNK_LEVELS = 6, CHUNK_SIDE = 64, BRICK_LEVELS = 3;
constexpr int COUNT_EXACT_LEVEL = 17;

struct Store {
  std::vector<uint32_t> keys;   // 9 words a node, id order
  std::vector<int32_t> table;   // open addressing over node slots
  uint32_t n = 0;

  uint32_t maxId() const { return n + FIRST_NODE - 1; }
  uint32_t child(uint32_t id, int o) const { return keys[(size_t)(id - FIRST_NODE) * 9 + 1 + o]; }
  uint32_t levelOf(uint32_t id) const { return id < FIRST_NODE ? 0 : keys[(size_t)(id - FIRST_NODE) * 9]; }
};

// The same hash as dag-core's Interner (FNV with a fold), so the probe
// sequences behave alike; ids don't depend on it either way.
inline uint32_t hashKey(const uint32_t* a) {
  uint32_t h = 0x811c9dc5u;
  for (int i = 0; i < 9; i++) { h = (h ^ a[i]) * 0x01000193u; h ^= h >> 15; }
  return h;
}

inline void rehash(Store& s) {
  std::vector<int32_t> t(s.table.empty() ? (1 << 17) : s.table.size() * 2, -1);
  const size_t mask = t.size() - 1;
  for (uint32_t i = 0; i < s.n; i++) {
    size_t j = hashKey(&s.keys[(size_t)i * 9]) & mask;
    while (t[j] >= 0) j = (j + 1) & mask;
    t[j] = (int32_t)i;
  }
  s.table.swap(t);
}

// createStore().intern: all-EMPTY children is EMPTY, otherwise the id of the
// one node with these words, made if new.
inline uint32_t intern(Store& s, uint32_t level, const uint32_t ch[8]) {
  uint32_t any = 0;
  for (int o = 0; o < 8; o++) any |= ch[o];
  if (!any) return EMPTY;
  uint32_t key[9] = { level, ch[0], ch[1], ch[2], ch[3], ch[4], ch[5], ch[6], ch[7] };
  if (s.table.empty()) rehash(s);
  const size_t mask = s.table.size() - 1;
  size_t i = hashKey(key) & mask;
  for (;;) {
    int32_t slot = s.table[i];
    if (slot < 0) break;
    const uint32_t* k = &s.keys[(size_t)slot * 9];
    bool same = true;
    for (int j = 0; j < 9; j++) if (k[j] != key[j]) { same = false; break; }
    if (same) return (uint32_t)slot + FIRST_NODE;
    i = (i + 1) & mask;
  }
  s.keys.insert(s.keys.end(), key, key + 9);
  s.table[i] = (int32_t)s.n;
  uint32_t id = s.n++ + FIRST_NODE;
  if ((size_t)s.n * 2 > s.table.size()) rehash(s);
  return id;
}

// createCounts: voxels under every id, float64 as in JS (exact to 2^53).
inline std::vector<double> makeCounts(const Store& s) {
  std::vector<double> c(s.maxId() + 1, 0.0);
  c[FULL] = 1;
  const uint32_t* k = s.keys.data();
  for (uint32_t id = FIRST_NODE; id <= s.maxId(); id++) {
    const uint32_t* ch = k + (size_t)(id - FIRST_NODE) * 9 + 1;
    double t = 0;
    for (int o = 0; o < 8; o++) t += c[ch[o]];
    c[id] = t;
  }
  return c;
}

inline double pow8(int k) { return std::ldexp(1.0, 3 * k); }

// dag-core's isFull: the count test, exact to level 17, then a walk down the
// solid chain above it (a count past 2^53 can't feel one missing voxel).
inline bool isFull(const Store& s, const double* counts, uint32_t id, int level) {
  if (counts[id] != pow8(level)) return false;
  for (int k = level; k > COUNT_EXACT_LEVEL; k--) {
    uint32_t c = s.child(id, 0);
    for (int o = 1; o < 8; o++) if (s.child(id, o) != c) return false;
    id = c;
  }
  return level <= COUNT_EXACT_LEVEL || counts[id] == pow8(COUNT_EXACT_LEVEL);
}

// chunk-core's nodeAt / chunkNode.
inline uint32_t nodeAt(const Store& s, uint32_t root, int D, int level, int64_t X, int64_t Y, int64_t Z) {
  const int64_t side = (int64_t)1 << (D - level);
  if (X < 0 || Y < 0 || Z < 0 || X >= side || Y >= side || Z >= side) return EMPTY;
  uint32_t id = root;
  for (int k = D - 1; k >= level && id >= FIRST_NODE; k--) {
    const int b = k - level;
    id = s.child(id, (int)((X >> b & 1) | (Y >> b & 1) << 1 | (Z >> b & 1) << 2));
  }
  return id;
}
struct NodeRef { uint32_t id; int level; };
inline NodeRef chunkNode(const Store& s, uint32_t root, int D, int lod, int64_t cx, int64_t cy, int64_t cz) {
  if (D >= lod + CHUNK_LEVELS) return { nodeAt(s, root, D, lod + CHUNK_LEVELS, cx, cy, cz), lod + CHUNK_LEVELS };
  return { (cx | cy | cz) == 0 ? root : EMPTY, D };
}

} // namespace poc
