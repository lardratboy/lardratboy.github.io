// fields.cpp — see fields.hpp. Each section is its JS source, ported in the
// same order of operations; JS's Math.imul is uint32 multiplication here, its
// `>>>` a shift of a uint32, and Math.floor a floor of the double.
#include "fields.hpp"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace poc {

/* ---- shared ------------------------------------------------------------------ */
// attr-core's rgb8: clamp each channel to 0–255 after rounding (Math.round:
// half up; std::round differs only below zero, which the clamp takes to 0).
static inline double c8(double v) { return std::min(255.0, std::max(0.0, std::round(v))); }
static inline uint32_t rgb8(double r, double g, double b) {
  auto i = [](double v) { return v != v ? 0u : (uint32_t)v; };   // NaN | 0 is 0 in JS
  return i(c8(r)) | i(c8(g)) << 8 | i(c8(b)) << 16;
}
static inline int32_t toInt32(double v) { return (int32_t)(uint32_t)(int64_t)v; }
static const int PERM[6][3] = { {0,1,2}, {0,2,1}, {1,0,2}, {1,2,0}, {2,0,1}, {2,1,0} };

const char* fieldName(FieldKind k) {
  static const char* n[] = { "none", "scatter", "kit", "dungeon" };
  return n[(int)k];
}

/* ---- experiments/shapes.mjs: the hills ------------------------------------------ */
static double shapeHash3(int32_t i, int32_t j, int32_t k) {
  uint32_t h = (uint32_t)i * 0x27d4eb2du ^ (uint32_t)j * 0x165667b1u ^ (uint32_t)k * 0x9e3779b1u;
  h = (h ^ (h >> 15)) * 0x85ebca6bu; h ^= h >> 13;
  return h / 4294967296.0;
}
static double noise2(double x, double y) {
  const double i = std::floor(x), j = std::floor(y), fx = x - i, fy = y - j;
  const double sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const int32_t I = toInt32(i), J = toInt32(j);
  const double a = shapeHash3(I, J, 7), b = shapeHash3(I + 1, J, 7), c = shapeHash3(I, J + 1, 7), d = shapeHash3(I + 1, J + 1, 7);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
static double fbm(double x, double y) {
  double v = 0, amp = 0.5, f = 1;
  for (int o = 0; o < 5; o++) { v += amp * noise2(x * f, y * f); amp *= 0.5; f *= 2; }
  return v;
}
static bool hillsInside(double x, double y, double z) { return y <= 0.24 * fbm(1.5 * x + 4, 1.5 * z + 4) - 0.3; }
static const double HILLS[6][4] = { {-0.25, 196, 182, 132}, {-0.22, 104, 150, 70}, {-0.17, 72, 124, 56}, {-0.13, 62, 104, 50},
                                    {-0.11, 128, 118, 102}, {-0.09, 150, 142, 134} };
static uint32_t ramp(double t, const double (*stops)[4], int n) {
  if (t <= stops[0][0]) return rgb8(stops[0][1], stops[0][2], stops[0][3]);
  for (int i = 1; i < n; i++) {
    if (t <= stops[i][0]) {
      const double* s0 = stops[i - 1]; const double* s1 = stops[i];
      const double u = (t - s0[0]) / (s1[0] - s0[0]);
      return rgb8(s0[1] + (s1[1] - s0[1]) * u, s0[2] + (s1[2] - s0[2]) * u, s0[3] + (s1[3] - s0[3]) * u);
    }
  }
  return rgb8(stops[n - 1][1], stops[n - 1][2], stops[n - 1][3]);
}
static uint32_t hillsColour(double x, double y, double z) { return ramp(y + 0.02 * (noise2(9 * x + 1, 9 * z + 2) - 0.5), HILLS, 6); }

/* ---- scatter-core.js: scatterColour --------------------------------------------- */
static uint32_t scatterColour(const ScatterField& f, double x, double y, double z) {
  const double i = std::floor(x / f.pitch), j = std::floor(z / f.pitch);
  if (i >= 0 && j >= 0 && i < f.perAxis && j < f.perAxis) {
    const size_t o = 6 * ((size_t)j * f.perAxis + (size_t)i);
    const double x0 = f.table[o + 2], y0 = f.table[o + 3], z0 = f.table[o + 4], R = f.R;
    if (x >= x0 && x < x0 + R && y >= y0 && y < y0 + R && z >= z0 && z < z0 + R && !hillsInside(x * f.s - 1, y * f.s - 1, z * f.s - 1)) {
      // unturn([x − x0, y − y0, z − z0], R, e)
      const int e = f.table[o + 1]; const int* P = PERM[e >> 3];
      const double w[3] = { x - x0, y - y0, z - z0 }; double u[3];
      for (int a = 0; a < 3; a++) u[P[a]] = (e >> a & 1) ? R - w[a] : w[a];
      return rgb8(255 * u[0] / R, 255 * u[1] / R, 255 * u[2] / R);
    }
  }
  return hillsColour(x * f.s - 1, y * f.s - 1, z * f.s - 1);      // colourFieldOf(hills, D)
}

/* ---- kit-core.js: kitPlan ------------------------------------------------------- */
static uint32_t hash32(uint32_t a, uint32_t b) {   // specimen-core.js
  uint32_t h = a ^ (b + 1) * 0x9e3779b1u;
  h = (h ^ (h >> 16)) * 0x85ebca6bu;
  h = (h ^ (h >> 13)) * 0xc2b2ae35u;
  return h ^ (h >> 16);
}
struct Rng {
  uint32_t s = 0x9e3779b9u;
  Rng(uint32_t seed, uint32_t l, uint32_t j) { s = hash32(s, seed); s = hash32(s, l); s = hash32(s, j); }
  double operator()() { s = hash32(s, 0x85ebca6bu); return s / 4294967296.0; }
};
static int pick(Rng& r, int n) { return (int)std::min((double)(n - 1), std::floor(r() * n)); }

static int detOf(int e) {
  static const int SIGN[6] = { 1, -1, -1, 1, 1, -1 };
  return SIGN[e >> 3] * ((((e & 1) + (e >> 1 & 1) + (e >> 2 & 1)) & 1) ? -1 : 1);
}
static const struct Turns {
  std::vector<int> proper, yTurns;
  Turns() {
    for (int e = 0; e < 48; e++) if (detOf(e) == 1) proper.push_back(e);
    for (int e : proper) if (PERM[e >> 3][1] == 1 && !(e & 2)) yTurns.push_back(e);
  }
} TURNS;

enum Mask { FRAME, CROSS, PILLARS, TOWER, SLABS, ARCHES, STAIR, CORNERS, COURT, SKYLINE, NMASK };
static const struct Masks {
  std::vector<int> slots[NMASK];
  Masks() {
    auto ext = [](int v) { return v == 0 || v == 3; };
    auto mid = [](int v) { return v == 1 || v == 2; };
    for (int z = 0; z < 4; z++) for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
      const int s = x + 4 * y + 16 * z, ne = ext(x) + ext(y) + ext(z), nm = mid(x) + mid(y) + mid(z);
      if (ne >= 2) slots[FRAME].push_back(s);
      if (nm >= 2) slots[CROSS].push_back(s);
      if ((ext(x) && ext(z)) || y == 0) slots[PILLARS].push_back(s);
      if ((mid(x) && mid(z)) || (y == 3 && mid(x) + mid(z) >= 1)) slots[TOWER].push_back(s);
      if (y == 0 || (y == 3 && (ext(x) || ext(z)))) slots[SLABS].push_back(s);
      if (y == 3 || (ext(x) && ext(z))) slots[ARCHES].push_back(s);
      if (y <= x && (!mid(z) || y == x)) slots[STAIR].push_back(s);
      if (ne == 3 || nm == 3) slots[CORNERS].push_back(s);
      if (y == 0 || (y == 1 && (ext(x) || ext(z))) || (mid(x) && mid(z))) slots[COURT].push_back(s);
    }
  }
} MASKS;
static std::vector<int> maskSlots(int name, Rng& r) {
  if (name != SKYLINE) return MASKS.slots[name];
  static const int HEIGHTS[5] = { 0, 0, 1, 2, 3 };
  int h[16];
  for (int i = 0; i < 16; i++) h[i] = HEIGHTS[pick(r, 5)];
  std::vector<int> m;
  for (int z = 0; z < 4; z++) for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) if (y <= h[x + 4 * z]) m.push_back(x + 4 * y + 16 * z);
  return m;
}
static std::vector<int> familyOf(int l, int L, bool ground, bool grounded) {
  if (grounded) return l == L ? std::vector<int>{ PILLARS, COURT, SKYLINE } : std::vector<int>{ PILLARS, SLABS, COURT, SKYLINE };
  if (l == L) return { FRAME };
  if (ground && l == L - 1) return { TOWER, PILLARS, ARCHES, FRAME };
  return l == 1 ? std::vector<int>{ FRAME, CROSS, ARCHES, PILLARS, SLABS } : l == 2 ? std::vector<int>{ TOWER, PILLARS, FRAME, ARCHES }
                : std::vector<int>{ FRAME, PILLARS, CROSS };
}
constexpr int KIT_PARTS = 8;                 // PART_NAMES.length
static const int GROUND_PARTS[3] = { 0, 1, 7 };   // block, slab, step

static bool makeKit(const Json& d, int D, KitField& k, std::string& why) {
  const int L = (int)d.num0("L", (D - 4) / 2.0), seed = (int)d.num0("seed", 1), ornaments = (int)d.num0("ornaments", 0);
  const Json* g = d.get("ground"); const bool ground = g && g->type == Json::Bool && g->b;
  const Json* sh = d.get("share"); const bool hasShare = sh && sh->type == Json::Num; const double share = hasShare ? sh->num : 0;
  const Json* libs = d.get("libs");
  if (!libs || libs->type != Json::Arr || (int)libs->arr.size() != L - 1 || D != 4 + 2 * L) { why = "a kit descriptor this can't read"; return false; }
  std::vector<int> sizes{ KIT_PARTS + ornaments };
  for (auto& v : libs->arr) sizes.push_back((int)v.num);
  sizes.push_back(1);
  std::vector<std::vector<int>> floors{ { GROUND_PARTS[0], GROUND_PARTS[1], GROUND_PARTS[2] } };
  k.CH.assign(L + 1, {}); k.TU.assign(L + 1, {});
  for (int l = 1; l <= L; l++) {
    const int n = sizes[l], gN = !ground ? 0 : l == L ? 1 : (n + 1) / 2;
    auto& child = k.CH[l]; auto& turn = k.TU[l];
    child.assign(64 * (size_t)n, -1); turn.assign(64 * (size_t)n, 0);
    // Level 1's non-floor child: the share's one draw (kit-core's childOf).
    auto pickChild = [&](Rng& r) -> int {
      if (l != 1) return pick(r, sizes[l - 1]);
      if (!hasShare || !ornaments) return pick(r, sizes[0]);
      const double u = r(), s = share / 100;
      return u < s ? KIT_PARTS + (int)std::min((double)(ornaments - 1), std::floor(u / s * ornaments))
                   : (int)std::min((double)(KIT_PARTS - 1), std::floor((u - s) / (1 - s) * KIT_PARTS));
    };
    for (int j = 0; j < n; j++) {
      Rng r((uint32_t)seed, (uint32_t)l, (uint32_t)j);
      const bool isG = j < gN;
      const std::vector<int> fam = familyOf(l, L, ground, isG);
      const int name = fam[pick(r, (int)fam.size())];
      const bool upright = ground && l >= L - 1;
      for (int s : maskSlots(name, r)) {
        const bool floor = isG && (s >> 2 & 3) == 0;
        const auto& fl = floors[l - 1];
        child[64 * j + s] = floor ? fl[pick(r, (int)fl.size())] : pickChild(r);
        turn[64 * j + s] = (uint8_t)(floor || upright ? TURNS.yTurns[pick(r, 4)] : TURNS.proper[pick(r, 24)]);
      }
    }
    std::vector<int> f(gN);
    for (int j = 0; j < gN; j++) f[j] = j;
    floors.push_back(f);
  }
  // kitColour's constants.
  k.L = L; k.c = (int)d.num0("colourLevel", std::min(2, L));
  auto sideOf = [](int l) { return 16.0 * std::pow(4.0, l); };
  k.world = sideOf(L);
  for (int l = 0; l <= L; l++) k.SIDE.push_back(sideOf(l));
  for (int e = 0; e < 48; e++) for (int i = 0; i < 3; i++) { k.PX[3 * e + i] = (uint8_t)PERM[e >> 3][i]; k.FL[3 * e + i] = (uint8_t)(e >> i & 1); }
  k.S = sideOf(k.c); k.K = 215 / k.S; k.cells = k.world / k.S;
  return true;
}

/* ---- kit-core.js: kitColour ----------------------------------------------------- */
constexpr int FRAME_CACHE = 4096;
// The point's coordinates in its level-c frame, into u; false in an empty slot.
static bool frameOf(const KitField& k, double x, double y, double z, double* u) {
  int j = 0;
  for (int l = k.L; l > k.c; l--) {
    const double s = k.SIDE[l - 1];
    const double i = std::min(3.0, std::floor(x / s)), kk = std::min(3.0, std::floor(y / s)), m = std::min(3.0, std::floor(z / s));
    const int at = 64 * j + (int)i + 4 * (int)kk + 16 * (int)m, next = k.CH[l][at];
    if (next < 0) return false;
    const double w[3] = { x - i * s, y - kk * s, z - m * s };
    const int e = k.TU[l][at];
    for (int a = 0; a < 3; a++) u[k.PX[3 * e + a]] = k.FL[3 * e + a] ? s - w[a] : w[a];
    x = u[0]; y = u[1]; z = u[2]; j = next;
  }
  u[0] = x; u[1] = y; u[2] = z;
  return true;
}
static uint32_t kitColour(const KitField& k, FieldCache& fc, double x, double y, double z) {
  const uint32_t grey = rgb8(128, 128, 128);
  if (!(x >= 0 && y >= 0 && z >= 0 && x < k.world && y < k.world && z < k.world)) return grey;
  if (fc.key.empty()) { fc.key.assign(FRAME_CACHE + 3, -1.0); fc.map.assign(12 * FRAME_CACHE, 0.0); }
  double* u = &fc.key[FRAME_CACHE];         // kitColour's `u`, kept across calls as the JS's is
  const double S = k.S, ix = std::floor(x / S), iy = std::floor(y / S), iz = std::floor(z / S), key = ix + k.cells * (iy + k.cells * iz);
  const int line = (int)(((uint32_t)toInt32(ix) * 73856093u ^ (uint32_t)toInt32(iy) * 19349663u ^ (uint32_t)toInt32(iz) * 83492791u) & (FRAME_CACHE - 1));
  double* M = &fc.map[12 * (size_t)line];
  const double qx = (ix + 0.5) * S, qy = (iy + 0.5) * S, qz = (iz + 0.5) * S;
  if (fc.key[line] != key) {
    fc.key[line] = key;
    if (!frameOf(k, qx, qy, qz, u)) M[0] = NAN;
    else {
      const double u0 = u[0], u1 = u[1], u2 = u[2];
      M[0] = u0; M[1] = u1; M[2] = u2;
      for (int a = 0; a < 3; a++) {
        frameOf(k, a == 0 ? qx + 1 : qx, a == 1 ? qy + 1 : qy, a == 2 ? qz + 1 : qz, u);
        M[3 + 3 * a] = u[0] - u0; M[4 + 3 * a] = u[1] - u1; M[5 + 3 * a] = u[2] - u2;
      }
    }
  }
  if (M[0] != M[0]) return grey;
  const double dx = x - qx, dy = y - qy, dz = z - qz;
  const double ux = M[0] + M[3] * dx + M[6] * dy + M[9] * dz;
  const double uy = M[1] + M[4] * dx + M[7] * dy + M[10] * dz;
  const double uz = M[2] + M[5] * dx + M[8] * dy + M[11] * dz;
  return rgb8(40 + k.K * ux, 40 + k.K * uy, 40 + k.K * uz);
}

/* ---- dungeon-core.js: the tiles and tileKinds ----------------------------------- */
enum { ROCK, CORR, ROOM, STAIR_LO, STAIR_HI, CAP, SPIRAL_LO, SPIRAL_HI };
enum { AIR, M_ROCK, M_WALL, M_FLOOR, M_COBBLE, M_STEP, M_PILLAR, M_LIQUID, M_IRON, M_FLAME, M_RIM, M_LEDGE, M_SECRET, M_BRIDGE };
constexpr int TALL = 6, SPIRAL = 7, CODE_SHIFT = 8, CELL = 16;
constexpr int V_PILLAR = 1, V_BASIN = 2, V_BRAZIER = 3, V_TORCHES = 4, V_PIT = 8, V_BRIDGE_X = 1, V_CHANNEL = 1;
static const int DX[4] = { -1, 1, 0, 0 }, DZ[4] = { 0, 0, -1, 1 };
struct Tile { int kind; int s[4]; int down, up; };
static const struct Tiles {
  std::vector<Tile> T;
  void add(int kind, int a, int b, int c, int d, int down, int up) { T.push_back({ kind, { a, b, c, d }, down, up }); }
  Tiles() {
    // addTile's order, which the codes index.
    add(ROCK, 0, 0, 0, 0, 0, 0);
    for (int m = 1; m < 16; m++) add(CORR, m & 1, m >> 1 & 1, m >> 2 & 1, m >> 3 & 1, 0, 0);
    const int du[4][2] = { {0, 0}, {1, 0}, {0, 1}, {0, TALL} };
    for (auto& p : du) for (int q = 0; q < 81; q++) add(ROOM, q % 3, (q / 3) % 3, (q / 9) % 3, q / 27, p[0], p[1]);
    for (int d = 0; d < 4; d++) add(STAIR_LO, d == 0 ? 3 : 0, d == 1 ? 3 : 0, d == 2 ? 3 : 0, d == 3 ? 3 : 0, 0, 2 + d);
    for (int d = 0; d < 4; d++) add(STAIR_HI, (d ^ 1) == 0 ? 3 : 0, (d ^ 1) == 1 ? 3 : 0, (d ^ 1) == 2 ? 3 : 0, (d ^ 1) == 3 ? 3 : 0, 2 + d, 0);
    for (int m = 0; m < 16; m++) add(CAP, (m & 1) * 2, (m >> 1 & 1) * 2, (m >> 2 & 1) * 2, (m >> 3 & 1) * 2, TALL, 0);
    for (int d = 0; d < 4; d++) add(SPIRAL_LO, d == 0 ? 3 : 0, d == 1 ? 3 : 0, d == 2 ? 3 : 0, d == 3 ? 3 : 0, 0, SPIRAL + d);
    for (int d = 0; d < 4; d++) add(SPIRAL_HI, d == 0 ? 3 : 0, d == 1 ? 3 : 0, d == 2 ? 3 : 0, d == 3 ? 3 : 0, SPIRAL + d, 0);
  }
} TILES;

// The "diamond angle": monotone in the true angle, division only, so every engine agrees.
static double diamond(double p, double q) {
  return q >= 0 ? (p >= 0 ? q / (p + q) : 1 + -p / (q - p)) : (p < 0 ? 2 + -q / (-p - q) : 3 + p / (p - q));
}
static int spiralHeight(double p, double q) {
  const double A0 = 0.3, a = diamond(p, q);
  if (a < A0 || a > 4 - A0) return -1;
  return (int)std::min(18.0, 2 + std::floor(17 * (a - A0) / (4 - 2 * A0)));
}

static void tileKinds(int32_t code, bool top, std::array<uint8_t, 4096>& out) {
  const Tile& t = TILES.T[code >> CODE_SHIFT];
  const int kind = t.kind, down = t.down, up = t.up, v = code & 255;
  const int* s = t.s;
  out.fill(M_ROCK);
  auto put = [&](int x, int y, int z, int m) { out[x + 16 * (y + 16 * z)] = (uint8_t)m; };
  auto mid = [](int a) { return a >= 6 && a <= 9; };
  auto along = [](int d, int x, int z) { return d < 2 ? z : x; };
  if (kind == ROOM) {
    for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
      const int ds[4] = { x, 15 - x, z, 15 - z };
      bool wall = false, door = false, secret = false, band = false;
      for (int d = 0; d < 4; d++) if (s[d] != 2 && ds[d] <= 1) {
        wall = true;
        if (s[d] == 1 && mid(along(d, x, z))) door = true;
        if (!down && ((v >> 4) & (1 << d)) && mid(along(d, x, z))) secret = true;
      }
      for (int d = 0; d < 4; d++) if (s[d] != 2 && ds[d] <= 5) band = true;
      for (int y = 0; y < 16; y++) {
        if (wall && secret && !door) { put(x, y, z, y >= 2 && y <= 9 ? M_SECRET : y == 1 ? M_FLOOR : M_WALL); continue; }
        if (wall) { put(x, y, z, door && y >= 2 && y <= 9 ? AIR : door && y == 1 ? M_FLOOR : M_WALL); continue; }
        if (y >= 2) { put(x, y, z, AIR); continue; }
        if (!down) put(x, y, z, y == 1 ? M_FLOOR : M_ROCK);
        else {
          const int b = v & 3, across = b == V_BRIDGE_X ? z : x;
          const bool onBridge = b && across >= 5 && across <= 10;
          put(x, y, z, onBridge ? M_BRIDGE : band ? (y == 1 ? M_LEDGE : M_ROCK) : AIR);
        }
      }
      if (down && (v & 3) && !band) {
        const int across = (v & 3) == V_BRIDGE_X ? z : x;
        if (across == 5 || across == 10) put(x, 2, z, M_IRON);
      }
    }
    if (!down) {
      const int c = v & 3;
      if (c == V_PILLAR) for (int z = 6; z <= 9; z++) for (int x = 6; x <= 9; x++) for (int y = 2; y < 16; y++) put(x, y, z, M_PILLAR);
      if (c == V_BASIN) for (int z = 4; z <= 11; z++) for (int x = 4; x <= 11; x++) put(x, 2, z, x == 4 || x == 11 || z == 4 || z == 11 ? M_RIM : M_LIQUID);
      if (c == V_BRAZIER) for (int z = 7; z <= 8; z++) for (int x = 7; x <= 8; x++) { put(x, 2, z, M_IRON); put(x, 3, z, M_IRON); put(x, 4, z, M_FLAME); }
      if (v & V_PIT) for (int z = 4; z <= 11; z++) for (int x = 4; x <= 11; x++) {
        const bool edge = x == 4 || x == 11 || z == 4 || z == 11;
        put(x, 1, z, edge ? M_RIM : AIR);
        if (!edge) put(x, 0, z, AIR);
      }
      if (v & V_TORCHES) for (int d = 0; d < 4; d++) {
        if (s[d] != 0 || ((v >> 4) & (1 << d))) continue;
        const int x = d == 0 ? 2 : d == 1 ? 13 : 7, z = d == 2 ? 2 : d == 3 ? 13 : 7;
        put(x, 8, z, M_IRON); put(x, 9, z, M_FLAME);
      }
    }
  } else if (kind == CAP) {
    for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
      const int ds[4] = { x, 15 - x, z, 15 - z };
      bool wall = false;
      for (int d = 0; d < 4; d++) if (s[d] != 2 && ds[d] <= 1) wall = true;
      for (int y = 0; y < 8; y++) put(x, y, z, wall ? M_WALL : AIR);
    }
  } else if (kind == CORR) {
    const int h = top ? 15 : 9;
    for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
      const bool centre = mid(x) && mid(z);
      const bool arm = (s[0] && mid(z) && x < 6) || (s[1] && mid(z) && x > 9) || (s[2] && mid(x) && z < 6) || (s[3] && mid(x) && z > 9);
      if (!centre && !arm) continue;
      const bool ch = (v & V_CHANNEL) && ((((s[0] && x <= 8) || (s[1] && x >= 7)) && (z == 7 || z == 8)) ||
                                          (((s[2] && z <= 8) || (s[3] && z >= 7)) && (x == 7 || x == 8)));
      if (ch) { put(x, 0, z, M_LIQUID); put(x, 1, z, AIR); }
      else put(x, 1, z, M_COBBLE);
      for (int y = 2; y <= h; y++) put(x, y, z, AIR);
    }
  } else if (kind == STAIR_LO || kind == STAIR_HI) {
    const int d = kind == STAIR_LO ? up - 2 : down - 2;
    const bool hi = kind == STAIR_HI;
    const int oy = hi ? 16 : 0;
    for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
      if (!mid(along(d, x, z))) continue;
      const int ds[4] = { x, 15 - x, z, 15 - z }, tt = ds[d];
      for (int y = 0; y < 16; y++) {
        const int g = y + oy;
        if (g <= 2 + tt) { if (g >= 2 || (!hi && g == 1)) put(x, y, z, M_STEP); }
        else if (g <= 10 + tt || (hi && top && tt >= 6)) put(x, y, z, AIR);
      }
    }
  } else if (kind == SPIRAL_LO || kind == SPIRAL_HI) {
    const bool hi = kind == SPIRAL_HI;
    const int d = hi ? down - SPIRAL : up - SPIRAL, oy = hi ? 16 : 0;
    for (int z = 0; z < 16; z++) for (int x = 0; x < 16; x++) {
      const int a = 2 * x - 15, b = 2 * z - 15;
      if (std::abs(a) > 13 || std::abs(b) > 13) {
        const int ds[4] = { x, 15 - x, z, 15 - z }, al = d < 2 ? z : x;
        if (ds[d] == 0 && mid(al)) for (int y = 1; y <= 9; y++) put(x, y, z, y == 1 ? M_FLOOR : AIR);
        continue;
      }
      if (a * a + b * b <= 26) { for (int y = 0; y < 16; y++) put(x, y, z, M_PILLAR); continue; }
      const int p = a * DX[d] + b * DZ[d], q = -a * DZ[d] + b * DX[d], H = spiralHeight(p, q);
      for (int y = 0; y < 16; y++) {
        const int g = y + oy;
        if (H < 0) put(x, y, z, g == 1 || g == 17 ? M_FLOOR : g == 0 || g == 16 ? M_ROCK : AIR);
        else put(x, y, z, g < H - 1 ? M_ROCK : g == H - 1 ? M_STEP : AIR);
      }
    }
  }
}

/* ---- dungeon-core.js: dungeonColour --------------------------------------------- */
static uint32_t mix3(int32_t a, int32_t b, int32_t c) {
  uint32_t h = 0x9e3779b9u;
  for (int32_t x : { a, b, c }) { h = (h ^ (uint32_t)x) * 0x85ebca6bu; h ^= h >> 13; h *= 0xc2b2ae35u; h ^= h >> 16; }
  return h;
}
static double dHash3(int32_t i, int32_t j, int32_t k) { return mix3(i, j, k) / 4294967296.0; }
static const double FLOOR_TINT[4][3] = { {1.18, 1.05, 0.86}, {1.0, 0.98, 0.94}, {0.84, 0.88, 0.98}, {0.78, 0.72, 0.74} };
static void tintOf(int f, int F, double out[3]) {
  if (F == 1) { for (int a = 0; a < 3; a++) out[a] = FLOOR_TINT[0][a]; return; }
  const double u = (double)(F - 1 - f) / (F - 1) * 3;
  const int i = (int)std::min(2.0, std::floor(u));
  const double w = u - i;
  for (int a = 0; a < 3; a++) out[a] = FLOOR_TINT[i][a] + (FLOOR_TINT[i + 1][a] - FLOOR_TINT[i][a]) * w;
}
static const double BASE[14][3] = { {0, 0, 0}, {88, 80, 72}, {134, 122, 108}, {150, 138, 118}, {108, 100, 90}, {152, 142, 124},
  {182, 172, 152}, {0, 0, 0}, {52, 48, 48}, {255, 176, 52}, {160, 150, 130}, {128, 86, 50}, {134, 122, 108}, {104, 70, 42} };

static uint32_t dungeonColour(const DungeonField& g, double x, double y, double z) {
  const int N = g.N, F = g.F;
  const int32_t xi = toInt32(std::floor(x)), yi = toInt32(std::floor(y)), zi = toInt32(std::floor(z));
  const int cx = std::min(N - 1, std::max(0, xi >> 4)), cz = std::min(N - 1, std::max(0, zi >> 4)), f = std::min(F - 1, std::max(0, yi >> 4));
  const int32_t code = g.codes[cx + (size_t)N * (cz + (size_t)N * f)];
  const int lx = xi & 15, ly = yi & 15, lz = zi & 15;
  int m = yi >= F * CELL ? M_ROCK : g.kinds.at(code * 2 + (f == F - 1 ? 1 : 0))[lx + 16 * (ly + 16 * lz)];
  if (m == AIR) { const int kd = TILES.T[code >> CODE_SHIFT].kind; m = kd == ROOM || kd == CAP ? M_WALL : M_ROCK; }
  const double j = 0.9 + 0.2 * dHash3(xi, yi, zi);
  if (m == M_LIQUID) {
    const bool lava = f == 0 && F >= 3;
    const double n = dHash3(xi >> 1, f, zi >> 1);
    return lava ? rgb8(235 * j, (70 + 100 * n) * j, 24) : rgb8(40 * j, (100 + 40 * n) * j, 170 * j);
  }
  if (m == M_FLAME) return rgb8(255, 150 + 60 * dHash3(xi, yi, zi), 40);
  const double* c = BASE[m];
  double k = j;
  if (m == M_FLOOR) {
    const int32_t sx = xi >> 2, sz = zi >> 2;
    const bool joint = (xi & 3) == 0 || (zi & 3) == 0;
    k *= (0.86 + 0.24 * dHash3(sx, f, sz)) * (joint ? 0.8 : 1);
  } else if (m == M_WALL || m == M_SECRET) {
    const int32_t course = yi >> 1, a = (lx <= 1 || lx >= 14 ? zi : xi) + (course & 1) * 2;
    const bool mortar = (yi & 1) == 0 || (a & 3) == 0;
    k *= (0.9 + 0.18 * dHash3(a >> 2, course, f)) * (mortar ? 0.78 : 1) * (m == M_SECRET ? 0.93 : 1);
  } else if (m == M_LEDGE) k *= ((xi + zi) & 1) ? 0.92 : 1.04;
  else if (m == M_BRIDGE) k *= ((xi ^ zi) >> 1 & 1) ? 0.9 : 1.05;
  double tint[3] = { 1, 1, 1 };
  if (m != M_IRON) tintOf(f, F, tint);
  if (yi == F * CELL - 1 && m == M_ROCK) return rgb8((74 + 20 * dHash3(xi >> 1, 7, zi >> 1)) * j, 118 * j, 50 * j);
  if (f == F - 1 && (m == M_FLOOR || m == M_ROCK || m == M_COBBLE) && dHash3(xi >> 1, yi, zi >> 1) < 0.14) return rgb8(70 * j, 112 * j, 54 * j);
  return rgb8(c[0] * k * tint[0], c[1] * k * tint[1], c[2] * k * tint[2]);
}

/* ---- the field ------------------------------------------------------------------- */
Named makeNamed(const WorldInfo& w, std::string& why) {
  Named f;
  const Json& d = w.desc;
  if (w.kind == "scatter") {
    const Json* g = d.get("ground");
    if (!g || g->type != Json::Str || g->str != "hills") { why = "a scatter on ground other than the hills"; return f; }
    ScatterField& s = f.scatter;
    s.D = (int)d.num0("D", w.D); s.pitch = (int)d.num0("pitch"); s.R = (int)d.num0("R");
    if (s.D != w.D || s.pitch <= 0 || s.R <= 0) { why = "a scatter descriptor this can't read"; return f; }
    const double side = std::ldexp(1.0, s.D);
    s.perAxis = (int)std::floor(side / s.pitch); s.s = 2 / side;
    if (w.table.size() < 6 * (size_t)s.perAxis * s.perAxis) { why = "the scatter's table is short"; return f; }
    s.table = w.table;
    f.kind = FieldKind::Scatter;
  } else if (w.kind == "kit") {
    if (!makeKit(d, w.D, f.kit, why)) return f;
    f.kind = FieldKind::Kit;
  } else if (w.kind == "dungeon") {
    DungeonField& g = f.dungeon;
    g.F = (int)d.num0("floors"); g.N = 1 << std::max(0, w.D - 4);
    if (g.F < 1 || w.table.size() != (size_t)g.N * g.N * g.F) { why = "the dungeon's table doesn't fit its descriptor"; return f; }
    g.codes = w.table;
    for (size_t c = 0; c < g.codes.size(); c++) {
      const int32_t code = g.codes[c];
      if (code < 0 || (size_t)(code >> CODE_SHIFT) >= TILES.T.size()) { why = "a dungeon cell holds no tile"; return f; }
      const bool top = (int)(c / ((size_t)g.N * g.N)) == g.F - 1;
      const int32_t key = code * 2 + (top ? 1 : 0);
      if (!g.kinds.count(key)) tileKinds(code, top, g.kinds[key]);
    }
    f.kind = FieldKind::Dungeon;
  } else why = w.kind.empty() ? "no colour" : "a '" + w.kind + "' colour field isn't ported";
  return f;
}

uint32_t namedColour(const Named& f, FieldCache& cache, double x, double y, double z) {
  switch (f.kind) {
    case FieldKind::Scatter: return scatterColour(f.scatter, x, y, z);
    case FieldKind::Kit: return kitColour(f.kit, cache, x, y, z);
    case FieldKind::Dungeon: return dungeonColour(f.dungeon, x, y, z);
    default: return 0;
  }
}

} // namespace poc
