// cut.cpp — see cut.hpp; each function is its stream-core.js namesake.
#include "cut.hpp"
#include <algorithm>
#include <unordered_set>

namespace poc {

static int64_t gridSide(int D, int lod) { return std::max<int64_t>(1, (int64_t)1 << std::max(0, D - lod - CHUNK_LEVELS)); }

static Chunk makeChunk(int lod, int64_t x, int64_t y, int64_t z, uint32_t id, int parent) {
  Chunk c;
  c.lod = lod; c.x = x; c.y = y; c.z = z; c.id = id; c.parent = parent;
  c.size = (double)CHUNK_SIDE * std::ldexp(1.0, lod);
  c.lo[0] = (double)x * c.size; c.lo[1] = (double)y * c.size; c.lo[2] = (double)z * c.size;
  c.key = keyOf(lod, x, y, z);
  return c;
}
static void childrenOf(const CutWorld& w, const Chunk& c, int self, std::vector<Chunk>& out) {
  if (c.lod == 0 || c.id < FIRST_NODE) return;
  for (int o = 0; o < 8; o++) {
    const uint32_t id = w.store->child(c.id, o);
    if (id != EMPTY) out.push_back(makeChunk(c.lod - 1, 2 * c.x + (o & 1), 2 * c.y + (o >> 1 & 1), 2 * c.z + (o >> 2), id, self));
  }
}
static double boxDistance(const double eye[3], const double lo[3], double size) {
  double d2 = 0;
  for (int a = 0; a < 3; a++) {
    const double l = lo[a], h = l + size, v = eye[a];
    const double d = v < l ? l - v : v > h ? v - h : 0;
    d2 += d * d;
  }
  return std::sqrt(d2);
}

Cut selectChunks(const CutWorld& w, const double eye[3], double detail, int maxChunks, int minLod) {
  Cut sel;
  sel.world = w;
  for (int a = 0; a < 3; a++) sel.eye[a] = eye[a];
  if (w.root == EMPTY) return sel;
  const int top = std::max(0, w.D - CHUNK_LEVELS);
  sel.nodes.reserve(2048);
  sel.nodes.push_back(makeChunk(top, 0, 0, 0, w.root, -1));
  sel.root = 0;
  sel.nodes[0].dist = boxDistance(eye, sel.nodes[0].lo, sel.nodes[0].size);
  std::vector<int> heap{ 0 };
  auto rank = [&](int i) { return sel.nodes[i].dist / sel.nodes[i].size; };
  auto push = [&](int c) {
    heap.push_back(c);
    for (size_t i = heap.size() - 1; i > 0;) {
      const size_t p = (i - 1) >> 1;
      if (rank(heap[p]) <= rank(heap[i])) break;
      std::swap(heap[p], heap[i]); i = p;
    }
  };
  auto pop = [&]() {
    const int top = heap[0], last = heap.back();
    heap.pop_back();
    if (!heap.empty()) {
      heap[0] = last;
      for (size_t i = 0;;) {
        const size_t l = 2 * i + 1, r = l + 1;
        size_t m = i;
        if (l < heap.size() && rank(heap[l]) < rank(heap[m])) m = l;
        if (r < heap.size() && rank(heap[r]) < rank(heap[m])) m = r;
        if (m == i) break;
        std::swap(heap[m], heap[i]); i = m;
      }
    }
    return top;
  };
  int count = 1;
  std::vector<Chunk> kids;
  while (!heap.empty()) {
    const int ci = pop();
    sel.index[sel.nodes[ci].key] = ci;
    const Chunk c = sel.nodes[ci];
    if (c.lod > minLod && c.dist < detail * c.size) {
      kids.clear();
      childrenOf(w, c, ci, kids);
      if (count - 1 + (int)kids.size() <= maxChunks) {
        count += (int)kids.size() - 1;
        sel.nodes[ci].kidsBegin = (int)sel.nodes.size(); sel.nodes[ci].kidsCount = (int)kids.size();
        for (Chunk& k : kids) {
          k.dist = boxDistance(eye, k.lo, k.size);
          sel.nodes.push_back(k);
          push((int)sel.nodes.size() - 1);
        }
        continue;
      }
      sel.capped++;
    }
    sel.leaves.push_back(ci);
  }
  std::stable_sort(sel.leaves.begin(), sel.leaves.end(), [&](int a, int b) {
    const Chunk &A = sel.nodes[a], &B = sel.nodes[b];
    if (A.dist != B.dist) return A.dist < B.dist;
    return A.lod > B.lod;
  });
  return sel;
}

Cover coverOf(const Cut& sel, const std::function<bool(uint64_t)>& has) {
  Cover out;
  if (sel.root < 0) return out;
  const CutWorld& w = sel.world;
  std::vector<Chunk> kids;
  // tile(c): appends a tiling of c's region to out.draw; returns whether it's complete.
  std::function<bool(int)> tile = [&](int ci) -> bool {
    const Chunk& c = sel.nodes[ci];
    if (c.kidsBegin < 0) {
      if (has(c.key)) { out.draw.push_back(c); return true; }
      kids.clear();
      childrenOf(w, c, ci, kids);
      size_t got = 0;
      for (const Chunk& k : kids) if (has(k.key)) { out.draw.push_back(k); got++; }
      return !kids.empty() && got == kids.size();
    }
    const size_t start = out.draw.size();
    bool all = true;
    for (int i = 0; i < c.kidsCount; i++) all = tile(c.kidsBegin + i) && all;
    if (all) return true;
    if (has(c.key)) { out.draw.resize(start); out.draw.push_back(c); return true; }
    return false;
  };
  tile(sel.root);
  std::unordered_set<uint64_t> drawKeys;
  for (const Chunk& d : out.draw) drawKeys.insert(d.key);
  for (int li : sel.leaves) {
    const Chunk& leaf = sel.nodes[li];
    if (drawKeys.count(leaf.key)) continue;
    int a = leaf.parent;
    while (a >= 0 && !drawKeys.count(sel.nodes[a].key)) a = sel.nodes[a].parent;
    if (a >= 0) { out.up++; continue; }
    kids.clear();
    childrenOf(w, leaf, li, kids);
    bool all = !kids.empty();
    for (const Chunk& k : kids) if (!drawKeys.count(k.key)) { all = false; break; }
    if (all) { out.down++; continue; }
    out.holes++; out.holeLeaves.push_back(li);
  }
  static const int SIDES[6][3] = { {1,0,0}, {-1,0,0}, {0,1,0}, {0,-1,0}, {0,0,1}, {0,0,-1} };
  for (Chunk& d : out.draw) {
    int open = 0;
    const int64_t g = gridSide(w.D, d.lod);
    for (int f = 0; f < 6; f++) {
      const int64_t x = d.x + SIDES[f][0], y = d.y + SIDES[f][1], z = d.z + SIDES[f][2];
      if (x < 0 || y < 0 || z < 0 || x >= g || y >= g || z >= g) continue;
      const uint64_t k = keyOf(d.lod, x, y, z);
      if (drawKeys.count(k)) continue;
      if (!sel.index.count(k) && chunkNode(*w.store, w.root, w.D, d.lod, x, y, z).id == EMPTY) continue;
      open |= 1 << f;
    }
    d.open = open;
  }
  return out;
}

double clearance(const CutWorld& w, const double eye[3], int budget) {
  if (w.root == EMPTY) return INFINITY;
  struct Item { uint32_t id; int k; double lo[3]; double d; };
  auto box = [&](const double lo[3], double size) {
    double d2 = 0;
    for (int a = 0; a < 3; a++) { const double v = eye[a], d = v < lo[a] ? lo[a] - v : v > lo[a] + size ? v - lo[a] - size : 0; d2 += d * d; }
    return std::sqrt(d2);
  };
  std::vector<Item> heap;
  Item r{ w.root, w.D, { 0, 0, 0 }, 0 };
  r.d = box(r.lo, std::ldexp(1.0, w.D));
  heap.push_back(r);
  auto cmp = [](const Item& a, const Item& b) { return a.d > b.d; };
  for (int n = 0; !heap.empty(); n++) {
    std::pop_heap(heap.begin(), heap.end(), cmp);
    const Item top = heap.back(); heap.pop_back();
    if (top.k == 0) return top.d;
    if (n >= budget) return top.d;
    const double h = std::ldexp(1.0, top.k - 1);
    for (int o = 0; o < 8; o++) {
      const uint32_t id = w.store->child(top.id, o);
      if (id == EMPTY) continue;
      Item c{ id, top.k - 1, { top.lo[0] + (o & 1) * h, top.lo[1] + (o >> 1 & 1) * h, top.lo[2] + (o >> 2) * h }, 0 };
      c.d = box(c.lo, h);
      heap.push_back(c); std::push_heap(heap.begin(), heap.end(), cmp);
    }
  }
  return INFINITY;
}

} // namespace poc
