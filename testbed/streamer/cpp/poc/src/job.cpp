// job.cpp — fastChunk (job-core.js), ported line for line, plus the parts of
// chunk-core.js it imports (keepCount, addShadow, TIE_RANK, cellAttr's
// baked branch). The comments say only where C++ had to differ; the why of
// every step is in job-core.js and chunk-core.js.
//
// Three exact shortcuts over the reference walk (job-core's header):
//   1. a full node of side >= 4 cells fills its grid block and lists only its shell;
//   2. a per-brick rule's kept cells are a 512-bit mask per (rule, lod, node);
//   3. the seam test is cached per job and walks from the neighbour chunk.
#include "job.hpp"
#include "vdag.hpp"
#include <algorithm>
#include <cstring>

namespace poc {

const char* ruleName(Rule r) {
  static const char* names[] = { "any", "majority", "volume", "opacity", "adaptive", "shadow" };
  return names[(int)r];
}
bool ruleFromName(const char* s, Rule& out) {
  for (int i = 0; i < 6; i++) if (!strcmp(s, ruleName((Rule)i))) { out = (Rule)i; return true; }
  return false;
}

/* ---- chunk-core's pieces --------------------------------------------------- */
static const struct TieRank {
  uint16_t rank[512];
  TieRank() {
    auto h = [](uint32_t i) { uint32_t x = (i + 0x9e37u) * 0x85ebca6bu; x ^= x >> 13; x *= 0xc2b2ae35u; return x ^ x >> 16; };
    uint16_t order[512];
    for (int i = 0; i < 512; i++) order[i] = (uint16_t)i;
    std::sort(order, order + 512, [&](uint16_t a, uint16_t b) { uint32_t ha = h(a), hb = h(b); return ha != hb ? ha < hb : a < b; });
    for (int r = 0; r < 512; r++) rank[order[r]] = (uint16_t)r;
  }
} TIE;

static bool perBrickRule(Rule r) { return r == Rule::Volume || r == Rule::Opacity || r == Rule::Adaptive || r == Rule::Shadow; }

// JS Math.round on the non-negative numbers these are: half up, which for
// x >= 0 is std::round's half away from zero.
static double jsRound(double x) { return std::round(x); }

static double adaptiveDepth(double C, double n, int lod, double occupied) {
  const double p = C / (n * pow8(lod)), q = occupied / n, top = std::ldexp(1.0, lod);
  if (q >= 1 || p >= 1) return top;
  const double s = std::log(1 - q) / std::log(1 - p);
  return std::min(top, std::max(1.0, std::cbrt(s)));
}
static double keepCount(Rule rule, double C, double n, int lod, double occupied) {
  const double v = pow8(lod);
  double depth = std::ldexp(1.0, lod);
  if (rule == Rule::Adaptive || rule == Rule::Shadow) depth = adaptiveDepth(C, n, lod, occupied);
  const double k = rule == Rule::Volume ? jsRound(C / v) : jsRound(n * (1 - std::pow(1 - C / (n * v), depth)));
  return std::min(k, occupied);
}

// The brick listing (B_LOCAL, B_COUNT, B_ORDER, B_KEEP in the JS).
struct BrickList { uint16_t local[512]; double count[512]; uint16_t order[512]; uint8_t keep[512]; int n = 0; };
static thread_local BrickList BL;

static void addShadow(int m, BrickList& b) {
  int16_t best[3 * 64];
  std::fill(best, best + 192, (int16_t)-1);
  auto column = [&](int c, int i) {
    const int16_t k = best[c];
    if (k < 0 || b.count[i] > b.count[k] || (b.count[i] == b.count[k] && TIE.rank[b.local[i]] < TIE.rank[b.local[k]])) best[c] = (int16_t)i;
  };
  for (int i = 0; i < m; i++) {
    const int l = b.local[i];
    const int x = (l & 1) | (l >> 2 & 2) | (l >> 4 & 4), y = (l >> 1 & 1) | (l >> 3 & 2) | (l >> 5 & 4), z = (l >> 2 & 1) | (l >> 4 & 2) | (l >> 6 & 4);
    column(y | z << 3, i);
    column(64 + (x | z << 3), i);
    column(128 + (x | y << 3), i);
  }
  for (int c = 0; c < 192; c++) if (best[c] >= 0 && !b.keep[best[c]]) b.keep[best[c]] = 1;
}

static inline uint32_t to6(double v) { return (uint32_t)std::min(63.0, std::max(0.0, jsRound(v * 63 / 255))); }
static inline uint32_t attrOf8(double r, double g, double b) { return to6(r) << 2 | to6(g) << 10 | to6(b) << 18; }

/* ---- the job -------------------------------------------------------------------- */
constexpr int G = 66, GG = G * G, SHELL_MIN = 2, MASK_CAP = 1 << 16;
constexpr uint32_t ALL_KEPT = 0xffffffffu;
static inline int gIndex(int x, int y, int z) { return (x + 1) + G * ((y + 1) + G * (z + 1)); }

struct Apron { int d[3], lo[3], hi[3]; };
static const Apron APRONS[6] = {
  { { 1, 0, 0}, {64, 0, 0}, {64, 63, 63} }, { {-1, 0, 0}, {-1, 0, 0}, {-1, 63, 63} },
  { { 0, 1, 0}, {0, 64, 0}, {63, 64, 63} }, { { 0,-1, 0}, {0, -1, 0}, {63, -1, 63} },
  { { 0, 0, 1}, {0, 0, 64}, {63, 63, 64} }, { { 0, 0,-1}, {0, 0, -1}, {63, 63, -1} } };

struct Ctx {
  const Store& st; const double* counts; JobScratch& s;
  Rule rule; int lod, brickAt; bool perBrick, majority, fullKeepsAll, colour; double cellVoxels;
  uint8_t* grid; double interior = 0;

  void list(int x, int y, int z, uint32_t index, uint32_t id) {
    s.cells.push_back(index); s.xyz.push_back((uint32_t)x | (uint32_t)y << 8 | (uint32_t)z << 16);
    if (colour) s.ids.push_back(id);
  }
  void fillBox(int x0, int y0, int z0, int x1, int y1, int z1) {
    const int len = x1 - x0 + 1;
    if (len <= 0) return;
    for (int z = z0; z <= z1; z++) for (int y = y0; y <= y1; y++) memset(grid + gIndex(x0, y, z), 1, len);
  }
  bool full(uint32_t id, int k) const { return isFull(st, counts, id, k); }

  void listLocals(uint32_t id, int j, int local) {
    if (id == EMPTY) return;
    if (j == lod) { BL.local[BL.n] = (uint16_t)local; BL.count[BL.n] = counts[id]; BL.n++; return; }
    for (int o = 0; o < 8; o++) listLocals(st.child(id, o), j - 1, local << 3 | o);
  }
  uint32_t makeMask(uint32_t id, int k) {
    BL.n = 0;
    listLocals(id, k, 0);
    const int m = BL.n;
    const double keep = keepCount(rule, counts[id], pow8(k - lod), lod, m);
    if (keep >= m) return ALL_KEPT;
    for (int i = 0; i < m; i++) BL.order[i] = (uint16_t)i;
    std::sort(BL.order, BL.order + m, [](uint16_t a, uint16_t b) {
      if (BL.count[a] != BL.count[b]) return BL.count[a] > BL.count[b];
      return TIE.rank[BL.local[a]] < TIE.rank[BL.local[b]];
    });
    std::array<uint32_t, 16> mask{};
    const int kk = (int)keep;
    if (rule == Rule::Shadow) {
      std::fill(BL.keep, BL.keep + m, 0);
      for (int i = 0; i < kk; i++) BL.keep[BL.order[i]] = 1;
      addShadow(m, BL);
      for (int i = 0; i < m; i++) if (BL.keep[i]) { const int l = BL.local[i]; mask[l >> 5] |= 1u << (l & 31); }
    } else
      for (int i = 0; i < kk; i++) { const int l = BL.local[BL.order[i]]; mask[l >> 5] |= 1u << (l & 31); }
    s.maskPool.push_back(mask);
    return (uint32_t)s.maskPool.size() - 1;
  }
  uint32_t maskOf(uint32_t id) {
    const uint64_t key = (uint64_t)rule << 40 | (uint64_t)lod << 32 | id;
    auto it = s.masks.find(key);
    if (it != s.masks.end()) { s.maskHits++; return it->second; }
    s.maskMisses++;
    if (s.masks.size() >= (size_t)MASK_CAP) { s.masks.clear(); s.maskPool.clear(); }
    const uint32_t m = makeMask(id, brickAt);
    s.masks.emplace(key, m);
    return m;
  }
  static bool anyKept(const uint32_t* mask, int a, int span) {
    if (span == 1) return mask[a >> 5] >> (a & 31) & 1;
    if (span == 8) return mask[a >> 5] >> (a & 31) & 255;
    for (int w = a >> 5, end = w + (span >> 5); w < end; w++) if (mask[w]) return true;
    return false;
  }

  void shell(uint32_t id, int k, int X0, int Y0, int Z0, uint32_t index, int fx0, int fy0, int fz0, int fx1, int fy1, int fz1) {
    if (k == lod) { list(X0, Y0, Z0, index, id); return; }
    const int h = 1 << (k - 1 - lod);
    for (int o = 0; o < 8; o++) {
      const int x = X0 + (o & 1) * h, y = Y0 + (o >> 1 & 1) * h, z = Z0 + (o >> 2) * h;
      if (x > fx0 && x + h < fx1 && y > fy0 && y + h < fy1 && z > fz0 && z + h < fz1) { interior += (double)h * h * h; continue; }
      shell(st.child(id, o), k - 1, x, y, z, index << 3 | o, fx0, fy0, fz0, fx1, fy1, fz1);
    }
  }
  // lo == nullptr: the chunk's own cells; else an apron slab, marked only.
  void masked(uint32_t id, int j, int x, int y, int z, uint32_t index, int local, const uint32_t* mask, const int* lo, const int* hi) {
    if (id == EMPTY) return;
    if (j == lod) {
      if (!(mask[local >> 5] >> (local & 31) & 1)) return;
      grid[gIndex(x, y, z)] = 1;
      if (!lo) list(x, y, z, index, id);
      return;
    }
    const int levels = j - 1 - lod, h = 1 << levels, span = 1 << 3 * levels;
    for (int o = 0; o < 8; o++) {
      const int l = local << 3 | o;
      if (!anyKept(mask, l * span, span)) continue;
      const int cx = x + (o & 1) * h, cy = y + (o >> 1 & 1) * h, cz = z + (o >> 2) * h;
      if (lo && (cx > hi[0] || cy > hi[1] || cz > hi[2] || cx + h <= lo[0] || cy + h <= lo[1] || cz + h <= lo[2])) continue;
      masked(st.child(id, o), j - 1, cx, cy, cz, index << 3 | o, l, mask, lo, hi);
    }
  }
  void walk(uint32_t id, int k, int X0, int Y0, int Z0, uint32_t index) {
    if (id == EMPTY) return;
    if (k == brickAt && perBrick && !(fullKeepsAll && full(id, k))) {
      const uint32_t m = maskOf(id);
      if (m != ALL_KEPT) { masked(id, k, X0, Y0, Z0, index, 0, s.maskPool[m].data(), nullptr, nullptr); return; }
    }
    if (k == lod) {
      if (majority && 2 * counts[id] < cellVoxels) return;
      grid[gIndex(X0, Y0, Z0)] = 1;
      list(X0, Y0, Z0, index, id);
      return;
    }
    const int sd = 1 << (k - lod);
    if (k - lod >= SHELL_MIN && fullKeepsAll && full(id, k)) {
      fillBox(X0, Y0, Z0, X0 + sd - 1, Y0 + sd - 1, Z0 + sd - 1);
      shell(id, k, X0, Y0, Z0, index, X0, Y0, Z0, X0 + sd, Y0 + sd, Z0 + sd);
      return;
    }
    const int h = sd >> 1;
    for (int o = 0; o < 8; o++)
      walk(st.child(id, o), k - 1, X0 + (o & 1) * h, Y0 + (o >> 1 & 1) * h, Z0 + (o >> 2) * h, index << 3 | o);
  }
  void apron(uint32_t id, int k, int X0, int Y0, int Z0, const int* lo, const int* hi) {
    if (id == EMPTY) return;
    if (k == brickAt && perBrick && !(fullKeepsAll && full(id, k))) {
      const uint32_t m = maskOf(id);
      if (m != ALL_KEPT) { masked(id, k, X0, Y0, Z0, 0, 0, s.maskPool[m].data(), lo, hi); return; }
    }
    if (k == lod) {
      if (majority && 2 * counts[id] < cellVoxels) return;
      grid[gIndex(X0, Y0, Z0)] = 1;
      return;
    }
    const int sd = 1 << (k - lod);
    if (fullKeepsAll && full(id, k)) {
      fillBox(std::max(X0, lo[0]), std::max(Y0, lo[1]), std::max(Z0, lo[2]),
              std::min(X0 + sd - 1, hi[0]), std::min(Y0 + sd - 1, hi[1]), std::min(Z0 + sd - 1, hi[2]));
      return;
    }
    const int h = sd >> 1;
    for (int o = 0; o < 8; o++) {
      const int x = X0 + (o & 1) * h, y = Y0 + (o >> 1 & 1) * h, z = Z0 + (o >> 2) * h;
      if (x > hi[0] || y > hi[1] || z > hi[2] || x + h <= lo[0] || y + h <= lo[1] || z + h <= lo[2]) continue;
      apron(st.child(id, o), k - 1, x, y, z, lo, hi);
    }
  }
};

/* chunk-core's meanUnder: the field at the centre of every occupied cell at
   level `floor` under this one, weighted by its voxels. stream-core's
   MEAN_DEPTH is 1, so a coarse cell is the mean of its occupied children. */
constexpr int MEAN_DEPTH = 1;
static void meanUnder(const Store& st, const double* counts, const Named& f, FieldCache& fc, uint32_t id, int level, int floor,
                      double x, double y, double z, double acc[3]) {
  if (id == EMPTY) return;
  if (level == floor) {
    const double w = counts[id], h = std::ldexp(1.0, level) / 2;
    const uint32_t c = namedColour(f, fc, x + h, y + h, z + h);
    acc[0] += w * (c & 255); acc[1] += w * (c >> 8 & 255); acc[2] += w * (c >> 16 & 255);
    return;
  }
  const double h = std::ldexp(1.0, level - 1);
  for (int o = 0; o < 8; o++)
    meanUnder(st, counts, f, fc, st.child(id, o), level - 1, floor, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h, acc);
}

static inline int boundaryBits(int x, int y, int z) {
  return (x == 63 ? 1 : 0) | (x == 0 ? 2 : 0) | (y == 63 ? 4 : 0) | (y == 0 ? 8 : 0) | (z == 63 ? 16 : 0) | (z == 0 ? 32 : 0);
}
static inline int popcount6(int m) { return __builtin_popcount((unsigned)m & 63); }

static void fastChunk(const World& w, JobScratch& s, int lod, int64_t cx, int64_t cy, int64_t cz, Rule rule, JobResult& out) {
  const Store& st = *w.store;
  const double* counts = w.counts;
  if (s.cursorOf != w.baked) { if (w.baked) s.cursor = makeCursor(*w.baked); s.cursorOf = w.baked; }
  uint8_t* grid = s.grid.data();
  memset(grid, 0, s.grid.size());
  s.cells.clear(); s.xyz.clear(); s.ids.clear();

  const NodeRef start = chunkNode(st, w.root, w.D, lod, cx, cy, cz);
  const bool perBrick = perBrickRule(rule);
  const int brickAt = std::min(lod + BRICK_LEVELS, start.level);
  const double nBrick = pow8(brickAt - lod);
  const bool fullKeepsAll = !perBrick || keepCount(rule, pow8(brickAt), nBrick, lod, nBrick) == nBrick;
  Ctx c{ st, counts, s, rule, lod, brickAt, perBrick, rule == Rule::Majority, fullKeepsAll, w.coloured(), pow8(lod), grid };

  c.walk(start.id, start.level, 0, 0, 0, 0);
  const size_t n = s.cells.size();
  const double occupied = (double)n + c.interior;

  uint32_t nbIds[6];
  for (int f = 0; f < 6; f++) {
    const Apron& a = APRONS[f];
    const NodeRef nb = chunkNode(st, w.root, w.D, lod, cx + a.d[0], cy + a.d[1], cz + a.d[2]);
    nbIds[f] = nb.id;
    if (n > 0) c.apron(nb.id, nb.level, 64 * a.d[0], 64 * a.d[1], 64 * a.d[2], a.lo, a.hi);
  }

  // The seam test's cache: 34³ coarse cells, 2 = not asked yet.
  uint8_t* coarse = s.coarse.data();
  memset(coarse, 2, s.coarse.size());
  auto coarseFull = [&](int x, int y, int z) {
    const int key = ((x >> 1) + 1) + 34 * (((y >> 1) + 1) + 34 * ((z >> 1) + 1));
    uint8_t f = coarse[key];
    if (f != 2) return f == 1;
    const int side = x > 63 ? 0 : x < 0 ? 1 : y > 63 ? 2 : y < 0 ? 3 : z > 63 ? 4 : 5;
    uint32_t id = nbIds[side];
    const int lx = (x & 63) >> 1, ly = (y & 63) >> 1, lz = (z & 63) >> 1;
    for (int b = CHUNK_LEVELS - 2; b >= 0 && id >= FIRST_NODE; b--)
      id = st.child(id, (lx >> b & 1) | (ly >> b & 1) << 1 | (lz >> b & 1) << 2);
    f = id != EMPTY && isFull(st, counts, id, lod + 1) ? 1 : 0;
    coarse[key] = f;
    return f == 1;
  };

  s.recs.clear(); s.attrs.clear(); s.tail.clear(); s.tailAttrs.clear();
  const int64_t X0 = cx * 64, Y0 = cy * 64, Z0 = cz * 64;
  double acc[3];
  auto attrAt = [&](size_t i, int x, int y, int z) {
    const int64_t vx = (X0 + x) << lod, vy = (Y0 + y) << lod, vz = (Z0 + z) << lod;
    // cellAttr's baked branch: the field's exact mean, at every lod.
    if (w.baked) { bakedMean(*w.baked, s.cursor, lod, vx, vy, vz, acc); return attrOf8(acc[0], acc[1], acc[2]); }
    // A named field: the voxel's centre at lod 0, else the count-weighted mean
    // of the field at the centres of the sub-cells meanDepth levels down.
    if (lod == 0) {
      const uint32_t c = namedColour(*w.named, s.fieldCache, vx + 0.5, vy + 0.5, vz + 0.5);
      return attrOf8(c & 255, c >> 8 & 255, c >> 16 & 255);
    }
    acc[0] = acc[1] = acc[2] = 0;
    meanUnder(st, counts, *w.named, s.fieldCache, s.ids[i], lod, std::max(0, lod - MEAN_DEPTH), (double)vx, (double)vy, (double)vz, acc);
    const double n = counts[s.ids[i]];
    return attrOf8(acc[0] / n, acc[1] / n, acc[2] / n);
  };
  uint32_t quads = 0;
  uint32_t* openQuads = out.openQuads;
  auto tallyOpen = [&](int b) { for (int f = 0; b; f++, b >>= 1) if (b & 1) openQuads[f]++; };
  for (size_t i = 0; i < n; i++) {
    const uint32_t p = s.xyz[i];
    const int x = p & 255, y = p >> 8 & 255, z = p >> 16;
    const int g = gIndex(x, y, z);
    const int m = (grid[g + 1] ? 0 : 1) | (grid[g - 1] ? 0 : 2) | (grid[g + G] ? 0 : 4) | (grid[g - G] ? 0 : 8)
                | (grid[g + GG] ? 0 : 16) | (grid[g - GG] ? 0 : 32);
    if (!m) {
      const int b = boundaryBits(x, y, z);
      if (b && ((b & 1 && !coarseFull(x + 1, y, z)) || (b & 2 && !coarseFull(x - 1, y, z))
             || (b & 4 && !coarseFull(x, y + 1, z)) || (b & 8 && !coarseFull(x, y - 1, z))
             || (b & 16 && !coarseFull(x, y, z + 1)) || (b & 32 && !coarseFull(x, y, z - 1)))) {
        if (w.coloured()) s.tailAttrs.push_back(attrAt(i, x, y, z));
        s.tail.push_back(s.cells[i]);           // packRecord(cell, 0, pose 0)
        tallyOpen(b);
      }
      continue;
    }
    if (w.coloured()) s.attrs.push_back(attrAt(i, x, y, z));
    s.recs.push_back(s.cells[i] | (uint32_t)m << 18);
    quads += popcount6(m);
    tallyOpen(boundaryBits(x, y, z) & ~m);
  }
  out.count = (uint32_t)s.recs.size();
  out.records.reserve(s.recs.size() + s.tail.size());
  out.records.assign(s.recs.begin(), s.recs.end());
  out.records.insert(out.records.end(), s.tail.begin(), s.tail.end());
  if (w.coloured()) {
    out.attrs.reserve(out.records.size());
    out.attrs.assign(s.attrs.begin(), s.attrs.end());
    out.attrs.insert(out.attrs.end(), s.tailAttrs.begin(), s.tailAttrs.end());
  }
  out.quads = quads;
  out.occupied = occupied;
}

JobResult runJob(const World& w, JobScratch& s, int lod, int64_t cx, int64_t cy, int64_t cz, Rule coarseRule) {
  const double t0 = nowMs();
  JobResult r;
  r.lod = lod; r.cx = cx; r.cy = cy; r.cz = cz;
  // createJobRunner's buried-chunk shortcut: a full chunk with six full
  // same-lod neighbours shows nothing and has no seam tail.
  auto fullChunk = [&](int64_t x, int64_t y, int64_t z) {
    const uint32_t id = chunkNode(*w.store, w.root, w.D, lod, x, y, z).id;
    return id != EMPTY && isFull(*w.store, w.counts, id, lod + CHUNK_LEVELS);
  };
  if (w.D >= lod + CHUNK_LEVELS && fullChunk(cx, cy, cz)) {
    bool all = true;
    for (int f = 0; f < 6 && all; f++) all = fullChunk(cx + APRONS[f].d[0], cy + APRONS[f].d[1], cz + APRONS[f].d[2]);
    if (all) { r.occupied = 64.0 * 64 * 64; r.buriedChunk = true; r.ms = nowMs() - t0; return r; }
  }
  fastChunk(w, s, lod, cx, cy, cz, lod == 0 ? Rule::Any : coarseRule, r);
  r.ms = nowMs() - t0;
  return r;
}

} // namespace poc
