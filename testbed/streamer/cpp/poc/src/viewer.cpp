// viewer.cpp — vdagview: the stream viewer's raster path in C++.
//
//   vdagview [file.vdag] [--world i] [--threads 4] [--detail 4] [--rule shadow] [--vsync 0|1] [--shot out.png] [--hud 0|1]
//
// What it is: stream-viewer.html's records path, nothing else. Each frame the
// cut (selectChunks) and cover (coverOf) are taken at the eye; missing chunks
// go to a pool of worker threads as jobs (fastChunk), nearest first; finished
// ones are uploaded within a per-frame budget, one buffer and VAO a chunk; the
// cover is drawn as instanced cubes, 36 indices an instance, one draw a chunk,
// frustum-culled and near first, by a shader that decodes the same 4-byte
// record and attribute word as GLSL_DECODE and GLSL_ATTR. Same fog, same
// lights, same colours (the attribute word for baked worlds and the named
// fields ported in fields.cpp: scatter, kit, dungeon; gamut otherwise).
//
// What it isn't: no ray path, no occlusion queries, no edits, actors, walking,
// SSAO, or the named colour fields beyond those three (caves, terrain, the
// lattice, shapes, rows draw in gamut). Those are what the comparison leaves out.
//
// Controls: WASD fly (Q/E or Ctrl/Space down/up, Shift ×4), right or left drag
// to look, wheel = speed, H = panel, F = freeze the cut, R = flush and time a
// cold converge, drop a .vdag on the window to open it.
#include "loaded.hpp"
#include "pool.hpp"

#include <SDL3/SDL.h>
#ifdef __APPLE__
#include <OpenGL/gl3.h>
#else
#define GL_GLEXT_PROTOTYPES
#include <SDL3/SDL_opengl.h>
#endif
#include "imgui.h"
#include "imgui_impl_opengl3.h"
#include "imgui_impl_sdl3.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <deque>
#include <filesystem>
#include <unordered_set>
#include <zlib.h>

using namespace poc;

// A PNG of the frame, for --shot (zlib's deflate and crc32, no image library).
static bool writePng(const std::string& path, int w, int h, const std::vector<uint8_t>& rgba) {
  std::vector<uint8_t> raw;
  raw.reserve((size_t)(w * 3 + 1) * h);
  for (int y = h - 1; y >= 0; y--) {               // GL's rows are bottom up
    raw.push_back(0);
    for (int x = 0; x < w; x++) for (int c = 0; c < 3; c++) raw.push_back(rgba[((size_t)y * w + x) * 4 + c]);
  }
  uLongf zn = compressBound(raw.size());
  std::vector<uint8_t> z(zn);
  if (compress2(z.data(), &zn, raw.data(), raw.size(), 6) != Z_OK) return false;
  z.resize(zn);
  FILE* f = fopen(path.c_str(), "wb");
  if (!f) return false;
  auto be = [](uint32_t v, uint8_t* o) { o[0] = v >> 24; o[1] = v >> 16; o[2] = v >> 8; o[3] = (uint8_t)v; };
  auto chunk = [&](const char* tag, const uint8_t* d, uint32_t n) {
    uint8_t b[4]; be(n, b); fwrite(b, 1, 4, f); fwrite(tag, 1, 4, f); if (n) fwrite(d, 1, n, f);
    uint32_t c = crc32(0, (const Bytef*)tag, 4); c = crc32(c, d, n); be(c, b); fwrite(b, 1, 4, f);
  };
  const uint8_t sig[8] = { 137, 80, 78, 71, 13, 10, 26, 10 };
  fwrite(sig, 1, 8, f);
  uint8_t ihdr[13]; be(w, ihdr); be(h, ihdr + 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = ihdr[11] = ihdr[12] = 0;
  chunk("IHDR", ihdr, 13); chunk("IDAT", z.data(), (uint32_t)z.size()); chunk("IEND", nullptr, 0);
  fclose(f);
  return true;
}

/* ---- shaders ------------------------------------------------------------
   The vertex shader is rasterVS with GLSL_DECODE pasted in: the record's
   Morton cell is decoded, the cube corner placed eye-relative (uOrigin is the
   chunk's corner minus the eye, so float32 stays exact near the eye), and a
   face the record doesn't show is thrown outside the clip box. */
static const char* VS = R"(#version 410 core
uvec3 mortonDecode(uint i){
  uvec3 c = uvec3(0u);
  for (uint b = 0u; b < 6u; b++){
    c.x |= ((i >> (3u*b))      & 1u) << b;
    c.y |= ((i >> (3u*b + 1u)) & 1u) << b;
    c.z |= ((i >> (3u*b + 2u)) & 1u) << b;
  }
  return c;
}
uniform vec3 uOrigin;
uniform float uCellSize;
uniform uint uOpenSides;
uvec3 recCell(uint r){ return mortonDecode(r & 262143u); }
uint  recMask(uint r){ return (r >> 18u) & 63u; }
vec3  recCentre(uint r){ return uOrigin + (vec3(recCell(r)) + 0.5) * uCellSize; }
uint  boundaryBits(uvec3 c){
  return (c.x == 63u ? 1u : 0u) | (c.x == 0u ? 2u : 0u) | (c.y == 63u ? 4u : 0u)
       | (c.y == 0u ? 8u : 0u) | (c.z == 63u ? 16u : 0u) | (c.z == 0u ? 32u : 0u);
}
uint  recShown(uint r){ return recMask(r) | (boundaryBits(recCell(r)) & uOpenSides); }
layout(location = 0) in uint aRec;
layout(location = 1) in uint aAttr;
uniform mat4 uViewProj;
uniform vec3 uEyeN;
uniform float uInvSide;
const vec3 CORNER[24] = vec3[24](
  vec3(.5,-.5,-.5),vec3(.5,.5,-.5),vec3(.5,.5,.5),vec3(.5,-.5,.5),     vec3(-.5,-.5,.5),vec3(-.5,.5,.5),vec3(-.5,.5,-.5),vec3(-.5,-.5,-.5),
  vec3(-.5,.5,-.5),vec3(-.5,.5,.5),vec3(.5,.5,.5),vec3(.5,.5,-.5),     vec3(-.5,-.5,.5),vec3(-.5,-.5,-.5),vec3(.5,-.5,-.5),vec3(.5,-.5,.5),
  vec3(.5,-.5,.5),vec3(.5,.5,.5),vec3(-.5,.5,.5),vec3(-.5,-.5,.5),     vec3(-.5,-.5,-.5),vec3(-.5,.5,-.5),vec3(.5,.5,-.5),vec3(.5,-.5,-.5));
const vec3 NORMAL[6] = vec3[6](vec3(1,0,0), vec3(-1,0,0), vec3(0,1,0), vec3(0,-1,0), vec3(0,0,1), vec3(0,0,-1));
out vec3 vRel;
out vec3 vNormal;
out vec3 vGamut;
flat out uint vAttr;
void main(){
  vAttr = aAttr;
  uint corner = uint(gl_VertexID), face = corner / 4u;
  vec3 p = recCentre(aRec) + CORNER[corner] * uCellSize;
  vRel = p;
  vGamut = uEyeN + p * uInvSide;
  vNormal = NORMAL[face];
  gl_Position = uViewProj * vec4(p, 1.0);
  if (((recShown(aRec) >> face) & 1u) == 0u) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
)";
static const char* FS = R"(#version 410 core
in vec3 vRel;
in vec3 vNormal;
in vec3 vGamut;
flat in uint vAttr;
uniform int uColorMode;     // 0 attribute, 1 gamut, 2 lod, 3 chunk, 4 plain
uniform vec3 uLodColor;
uniform vec3 uChunkColor;
uniform float uFog;
out vec4 outColor;
vec3 attrColour(uint w){ return vec3(uvec3((w >> 2u) & 63u, (w >> 10u) & 63u, (w >> 18u) & 63u)) / 63.0; }
void main(){
  vec3 base = uColorMode == 0 ? attrColour(vAttr) : uColorMode == 1 ? clamp(vGamut, 0.0, 1.0)
            : uColorMode == 2 ? uLodColor : uColorMode == 3 ? uChunkColor : vec3(0.75);
  float shade = 0.55 + 0.45 * max(dot(vNormal, normalize(vec3(0.5, 0.8, 0.35))), 0.0)
              + 0.12 * max(dot(vNormal, normalize(vec3(-0.6, -0.2, -0.7))), 0.0);
  float fog = 1.0 - exp(-length(vRel) * uFog);
  outColor = vec4(mix(base * shade, vec3(0.027, 0.027, 0.039), fog * 0.85), 1.0);
}
)";

static GLuint compile(GLenum type, const char* src) {
  GLuint s = glCreateShader(type);
  glShaderSource(s, 1, &src, nullptr);
  glCompileShader(s);
  GLint ok; glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
  if (!ok) { char log[4096]; glGetShaderInfoLog(s, sizeof log, nullptr, log); fprintf(stderr, "shader: %s\n", log); exit(1); }
  return s;
}

/* ---- the camera: the stream viewer's fly camera ----------------------------- */
struct Cam { double eye[3] = { 0, 0, 0 }, yaw = 0, pitch = 0, speedMul = 1; };
static void fwdOf(const Cam& c, double f[3]) { f[0] = std::cos(c.pitch) * std::sin(c.yaw); f[1] = std::sin(c.pitch); f[2] = std::cos(c.pitch) * std::cos(c.yaw); }
static void cross(const double a[3], const double b[3], double o[3]) { o[0] = a[1]*b[2] - a[2]*b[1]; o[1] = a[2]*b[0] - a[0]*b[2]; o[2] = a[0]*b[1] - a[1]*b[0]; }
static void norm(double a[3]) { double l = std::sqrt(a[0]*a[0] + a[1]*a[1] + a[2]*a[2]); if (l == 0) l = 1; for (int i = 0; i < 3; i++) a[i] /= l; }
// viewProj: rotation and projection only (positions are eye-relative); 0.9 rad vertical fov.
static void viewProj(const Cam& c, double aspect, double near, double far, float M[16]) {
  const double f = 1 / std::tan(0.45);
  const double P[16] = { f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0 };
  double fw[3]; fwdOf(c, fw);
  double z[3] = { -fw[0], -fw[1], -fw[2] }, up[3] = { 0, 1, 0 }, x[3], y[3];
  cross(up, z, x); norm(x); cross(z, x, y);
  const double V[16] = { x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1 };
  for (int col = 0; col < 4; col++) for (int r = 0; r < 4; r++) {
    double s = 0; for (int k = 0; k < 4; k++) s += P[k * 4 + r] * V[col * 4 + k]; M[col * 4 + r] = (float)s;
  }
}
// Gribb–Hartmann planes, inside >= 0, and stream-viewer's boxVisible.
static void frustumPlanes(const float M[16], double pl[6][4]) {
  for (int i = 0; i < 6; i++) {
    const int a = i >> 1; const double sgn = (i & 1) ? -1 : 1;
    for (int k = 0; k < 4; k++) pl[i][k] = M[k * 4 + 3] + sgn * M[k * 4 + a];
  }
}
static bool boxVisible(const double pl[6][4], const double lo[3], double size) {
  for (int i = 0; i < 6; i++) {
    const double* p = pl[i];
    const double x = lo[0] + (p[0] > 0 ? size : 0), y = lo[1] + (p[1] > 0 ? size : 0), z = lo[2] + (p[2] > 0 ? size : 0);
    if (p[0] * x + p[1] * y + p[2] * z + p[3] < 0) return false;
  }
  return true;
}

/* ---- colours ---------------------------------------------------------------- */
static void lodColor(int l, float out[3]) {
  const double h = std::fmod(l * 0.137 + 0.58, 1.0), c = 0.5, x = c * (1 - std::fabs(std::fmod(h * 6, 2.0) - 1)), m = 0.32;
  const int k = (int)std::floor(h * 6);
  const double rgb[6][3] = { {c, x, 0}, {x, c, 0}, {0, c, x}, {0, x, c}, {x, 0, c}, {c, 0, x} };
  for (int i = 0; i < 3; i++) out[i] = (float)(rgb[k][i] + m);
}
static void chunkColor(const Chunk& d, float out[3]) {
  uint32_t h = (uint32_t)(d.x + 1) * 0x27d4eb2du ^ (uint32_t)(d.y + 3) * 0x165667b1u ^ (uint32_t)(d.z + 7) * 0x9e3779b1u ^ (uint32_t)(d.lod + 11) * 0x85ebca6bu;
  h = (h ^ (h >> 15)) * 0x85ebca6bu;
  out[0] = 0.35f + 0.6f * ((h & 255) / 255.f); out[1] = 0.35f + 0.6f * ((h >> 8 & 255) / 255.f); out[2] = 0.35f + 0.6f * ((h >> 16 & 255) / 255.f);
}

/* ---- the streamer's cache ------------------------------------------------------
   createStreamer's admission, eviction and queue, without edits or the ray
   kind. A resident entry owns a buffer (records, then words) and a VAO; an
   empty result is resident and owns nothing. */
struct Entry {
  GLuint vao = 0, buf = 0;
  uint32_t count = 0, total = 0, quads = 0, openQuads[6] = {};
  size_t bytes = 0;
  uint64_t seen = 0;
  int lod = 0;
};

struct Rolling {
  std::deque<double> v; size_t cap = 2000;
  void add(double x) { v.push_back(x); if (v.size() > cap) v.pop_front(); }
  double pct(double p) const { if (v.empty()) return 0; std::vector<double> s(v.begin(), v.end()); std::sort(s.begin(), s.end()); return s[std::min(s.size() - 1, (size_t)(p * s.size()))]; }
  double mean() const { double t = 0; for (double x : v) t += x; return v.empty() ? 0 : t / v.size(); }
};

struct App {
  std::unique_ptr<Loaded> L;
  std::string error, status;
  Pool pool; int threads = 4;
  std::unordered_map<uint64_t, Entry> cache;
  size_t cacheBytes = 0, cacheMaxBytes = 256u << 20, cacheMax = 4096;
  std::unordered_map<uint64_t, JobResult> waiting;      // finished, not yet uploaded
  Cut cut; Cover cover;
  Cam cam;
  float detail = 4; int maxChunks = 1024; Rule rule = Rule::Shadow;
  bool gpuTimer = true, seams = true, cull = true, freeze = false, vsync = true, showPanel = true;
  int colorMode = -1;                                    // -1: auto (attribute if baked, else gamut)
  int maxInstalls = 32; float uploadMB = 8;
  uint64_t tick = 0;
  GLuint cubeIndex = 0, prog = 0;
  struct { GLint viewProj, origin, cellSize, openSides, eyeN, invSide, colorMode, lodColor, chunkColor, fog; } U{};
  GLuint queries[8] = {}; int qHead = 0, qCount = 0;
  // stats
  double near = 1, clear = 0;
  Rolling jobMs, frameMs, cpuMs, gpuMs;
  double clearMs = 0, submitMs = 0, waitMs = 0, queryMs = 0, selectMs = 0, coverMs = 0, installMs = 0, drawMs = 0, queueMs = 0, uiMs = 0;
  uint64_t drawn = 0, culled = 0, instances = 0, triangles = 0, installs = 0;
  size_t busy = 0, queued = 0;
  size_t gpuBytes = 0;
  // the converge timer (a flush, a load): until nothing is queued, running, waiting, or a hole
  bool converging = false; double convergeStart = 0, convergeMs = 0, convergeLastJob = 0; int convergeFrames = 0; uint64_t convergeJobs = 0; double convergeJobMs = 0;
  uint64_t jobsTotal = 0; double jobMsTotal = 0;
  std::vector<std::string> files; char filter[128] = ""; int pick = -1;
};

static void dispose(App& a, Entry& e) {
  if (e.vao) { glDeleteVertexArrays(1, &e.vao); glDeleteBuffers(1, &e.buf); a.gpuBytes -= e.bytes; }
  a.cacheBytes -= e.bytes;
  e.vao = e.buf = 0;
}
static void flush(App& a) {
  for (auto& [k, e] : a.cache) dispose(a, e);
  a.cache.clear(); a.waiting.clear(); a.cacheBytes = 0;
  if (a.L) poolSetWorld(a.pool, a.L->world, a.rule);
  a.converging = true; a.convergeStart = nowMs(); a.convergeJobs = 0; a.convergeJobMs = 0; a.convergeFrames = 0; a.convergeLastJob = 0;
}
static void install(App& a, uint64_t key, JobResult& r) {
  Entry e;
  e.count = r.count; e.total = (uint32_t)r.records.size(); e.quads = r.quads; e.lod = r.lod;
  memcpy(e.openQuads, r.openQuads, sizeof e.openQuads);
  e.bytes = 4 * (r.records.size() + r.attrs.size());
  e.seen = a.tick;
  if (e.total) {
    glGenVertexArrays(1, &e.vao); glGenBuffers(1, &e.buf);
    glBindVertexArray(e.vao);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, a.cubeIndex);
    glBindBuffer(GL_ARRAY_BUFFER, e.buf);
    glBufferData(GL_ARRAY_BUFFER, e.bytes, nullptr, GL_STATIC_DRAW);
    glBufferSubData(GL_ARRAY_BUFFER, 0, 4 * r.records.size(), r.records.data());
    glEnableVertexAttribArray(0);
    glVertexAttribIPointer(0, 1, GL_UNSIGNED_INT, 4, (void*)0);
    glVertexAttribDivisor(0, 1);
    if (!r.attrs.empty()) {
      glBufferSubData(GL_ARRAY_BUFFER, 4 * r.records.size(), 4 * r.attrs.size(), r.attrs.data());
      glEnableVertexAttribArray(1);
      glVertexAttribIPointer(1, 1, GL_UNSIGNED_INT, 4, (void*)(4 * r.records.size()));
      glVertexAttribDivisor(1, 1);
    } else {
      glDisableVertexAttribArray(1);
      glVertexAttribI1ui(1, 0);
    }
    glBindVertexArray(0);
    a.gpuBytes += e.bytes;
  }
  auto it = a.cache.find(key);
  if (it != a.cache.end()) dispose(a, it->second);
  a.cache[key] = e;
  a.cacheBytes += e.bytes;
  a.installs++;
}

static void loadFile(App& a, const std::string& path, int which = 0) {
  poolStop(a.pool);                              // running jobs read the old world: let them finish first
  for (auto& [k, e] : a.cache) dispose(a, e);
  a.cache.clear(); a.waiting.clear(); a.cacheBytes = 0;
  a.cut = Cut{}; a.cover = Cover{};
  a.L.reset();
  a.error.clear();
  try {
    a.L = loadWorld(path, which);
    defaultView(*a.L, a.cam.eye, a.cam.yaw, a.cam.pitch);
    a.colorMode = -1;
    const LoadTimes& t = a.L->file.t;
    char buf[256];
    snprintf(buf, sizeof buf, "read %.1f  unpack %.1f  decode %.1f  attr %.1f  counts %.1f  baked %.1f ms",
             t.read, t.unpack, t.decode, t.attr, t.counts, t.baked);
    a.status = buf;
  } catch (std::exception& e) { a.error = path + ": " + e.what(); }
  poolStart(a.pool, a.threads);
  if (a.L) flush(a);
}

static void scanFiles(App& a) {
  namespace fs = std::filesystem;
  a.files.clear();
  for (const char* dir : { "worlds", "test-3d-models", "cpp/poc/worlds" }) {
    fs::path p = fs::path(POC_REPO_ROOT) / dir;
    std::error_code ec;
    if (!fs::exists(p, ec)) continue;
    for (auto it = fs::recursive_directory_iterator(p, ec); it != fs::recursive_directory_iterator(); it.increment(ec))
      if (it->path().extension() == ".vdag") a.files.push_back(fs::relative(it->path(), POC_REPO_ROOT, ec).string());
  }
  std::sort(a.files.begin(), a.files.end());
}

/* ---- a frame of streaming ------------------------------------------------------
   update(eye) then recover(): the cut, results in under budget, the cover, the
   job queue (the top chunk, holes nearest first, then the rest of the cut by
   dist / size, coarse first), and eviction of the least recently seen. */
static void stream(App& a) {
  if (!a.L) return;
  const CutWorld cw = a.L->cutWorld();
  double t0 = nowMs();
  if (!a.freeze || a.cut.root < 0) a.cut = selectChunks(cw, a.cam.eye, a.detail, a.maxChunks);
  a.selectMs = nowMs() - t0;

  int busy; size_t queued;
  for (auto& [key, r] : poolTake(a.pool, busy, queued)) {
    a.jobMs.add(r.ms); a.jobsTotal++; a.jobMsTotal += r.ms;
    if (a.converging) { a.convergeJobs++; a.convergeJobMs += r.ms; a.convergeLastJob = nowMs() - a.convergeStart; }
    a.waiting[key] = std::move(r);
  }
  a.busy = busy; a.queued = queued;

  // Admission: wanted results only, nearest-ranked first, within the frame's upload budget.
  t0 = nowMs();
  {
    std::vector<std::pair<double, uint64_t>> order;
    for (auto it = a.waiting.begin(); it != a.waiting.end();) {
      auto c = a.cut.index.find(it->first);
      if (c == a.cut.index.end() && it->first != keyOf(std::max(0, a.L->world.D - CHUNK_LEVELS), 0, 0, 0)) { it = a.waiting.erase(it); continue; }
      const Chunk& ch = a.cut.nodes[c == a.cut.index.end() ? 0 : c->second];
      order.emplace_back(ch.dist / ch.size, it->first);
      ++it;
    }
    std::sort(order.begin(), order.end());
    int n = 0; double bytes = 0;
    for (auto& [rank, key] : order) {
      if (n >= a.maxInstalls || bytes > a.uploadMB * 1048576.0) break;
      JobResult& r = a.waiting[key];
      bytes += 4.0 * (r.records.size() + r.attrs.size());
      install(a, key, r);
      a.waiting.erase(key);
      n++;
    }
  }
  a.installMs = nowMs() - t0;

  t0 = nowMs();
  a.tick++;
  a.cover = coverOf(a.cut, [&](uint64_t k) { return a.cache.count(k) > 0; });
  a.coverMs = nowMs() - t0;
  for (const Chunk& d : a.cover.draw) if (auto it = a.cache.find(d.key); it != a.cache.end()) it->second.seen = a.tick;
  for (const Chunk& c : a.cut.nodes) if (auto it = a.cache.find(c.key); it != a.cache.end()) it->second.seen = a.tick;

  t0 = nowMs();
  std::vector<JobReq> q;
  std::unordered_set<uint64_t> holeKeys;
  auto missing = [&](const Chunk& c) { return !a.cache.count(c.key) && !a.waiting.count(c.key); };
  if (a.cut.root >= 0 && missing(a.cut.nodes[a.cut.root])) { const Chunk& c = a.cut.nodes[a.cut.root]; q.push_back({ c.lod, c.x, c.y, c.z, c.key }); }
  for (int li : a.cover.holeLeaves) { const Chunk& c = a.cut.nodes[li]; holeKeys.insert(c.key); if (missing(c) && li != a.cut.root) q.push_back({ c.lod, c.x, c.y, c.z, c.key }); }
  std::vector<int> rest;
  for (size_t i = 0; i < a.cut.nodes.size(); i++) {
    const Chunk& c = a.cut.nodes[i];
    if ((int)i != a.cut.root && !holeKeys.count(c.key) && missing(c)) rest.push_back((int)i);
  }
  std::stable_sort(rest.begin(), rest.end(), [&](int x, int y) {
    const Chunk &A = a.cut.nodes[x], &B = a.cut.nodes[y];
    const double ra = A.dist / A.size, rb = B.dist / B.size;
    return ra != rb ? ra < rb : A.lod > B.lod;
  });
  for (int i : rest) { const Chunk& c = a.cut.nodes[i]; q.push_back({ c.lod, c.x, c.y, c.z, c.key }); }
  poolSetQueue(a.pool, q);
  a.queueMs = nowMs() - t0;

  // Eviction: the least recently seen, never what this frame draws or wants.
  if (a.cache.size() > a.cacheMax || a.cacheBytes > a.cacheMaxBytes) {
    std::unordered_set<uint64_t> keep;
    for (const Chunk& d : a.cover.draw) keep.insert(d.key);
    for (const Chunk& c : a.cut.nodes) keep.insert(c.key);
    std::vector<std::pair<uint64_t, uint64_t>> cold;
    for (auto& [k, e] : a.cache) if (!keep.count(k)) cold.emplace_back(e.seen, k);
    std::sort(cold.begin(), cold.end());
    for (auto& [seen, k] : cold) {
      if (a.cache.size() <= a.cacheMax && a.cacheBytes <= a.cacheMaxBytes) break;
      dispose(a, a.cache[k]); a.cache.erase(k);
    }
  }

  if (a.converging) a.convergeFrames++;
  if (a.converging && q.empty() && a.busy == 0 && a.queued == 0 && a.waiting.empty() && a.cover.holes == 0) {
    a.converging = false; a.convergeMs = nowMs() - a.convergeStart;
  }
}

/* ---- a frame of drawing: renderView's raster pass ------------------------------ */
static void render(App& a, int w, int h) {
  glViewport(0, 0, w, h);
  glClearColor(0.027f, 0.027f, 0.039f, 1);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
  a.drawn = a.culled = a.instances = a.triangles = 0;
  if (!a.L || a.cut.root < 0) return;
  const double t0 = nowMs();
  const double side = a.L->side();
  a.clear = clearance(a.L->cutWorld(), a.cam.eye, 2048);
  a.clearMs = nowMs() - t0;
  a.near = std::max(0.05, std::min(64.0, 0.5 * a.clear));
  const double far = 4 * side + std::sqrt(a.cam.eye[0] * a.cam.eye[0] + a.cam.eye[1] * a.cam.eye[1] + a.cam.eye[2] * a.cam.eye[2]);
  float M[16]; viewProj(a.cam, (double)w / h, a.near, far, M);
  double planes[6][4]; frustumPlanes(M, planes);

  const double w0 = nowMs();
  glEnable(GL_DEPTH_TEST); glEnable(GL_CULL_FACE);
  glUseProgram(a.prog);
  glUniformMatrix4fv(a.U.viewProj, 1, GL_FALSE, M);
  glUniform3f(a.U.eyeN, (float)(a.cam.eye[0] / side), (float)(a.cam.eye[1] / side), (float)(a.cam.eye[2] / side));
  glUniform1f(a.U.invSide, (float)(1 / side));
  const int mode = a.colorMode >= 0 ? a.colorMode : a.L->world.coloured() ? 0 : 1;
  glUniform1i(a.U.colorMode, mode);
  glUniform1f(a.U.fog, (float)(1 / (1.5 * side)));
  // On macOS the first GL calls of a frame block until the GPU has let go of
  // a drawable: that's the GPU's time showing up on the CPU (measured 8 ms of
  // a GPU-bound frame here, against 0.3 ms to submit every draw). Kept apart
  // so the panel doesn't call it CPU work. (Not glFinish: that would stop the
  // CPU and GPU overlapping, and change what's measured.)
  a.waitMs = nowMs() - w0;

  struct Item { const Chunk* d; const Entry* e; double rel[3]; double dist; };
  std::vector<Item> list;
  list.reserve(a.cover.draw.size());
  for (const Chunk& d : a.cover.draw) {
    auto it = a.cache.find(d.key);
    if (it == a.cache.end() || !it->second.vao) continue;
    Item q{ &d, &it->second, { d.lo[0] - a.cam.eye[0], d.lo[1] - a.cam.eye[1], d.lo[2] - a.cam.eye[2] }, 0 };
    const double hx = q.rel[0] + d.size / 2, hy = q.rel[1] + d.size / 2, hz = q.rel[2] + d.size / 2;
    q.dist = std::sqrt(hx * hx + hy * hy + hz * hz);
    list.push_back(q);
  }
  std::sort(list.begin(), list.end(), [](const Item& x, const Item& y) { return x.dist < y.dist; });

  // GPU time of the chunk draws, read a few frames late so nothing waits.
  const bool timing = a.gpuTimer && a.qCount < 8;
  if (timing) glBeginQuery(GL_TIME_ELAPSED, a.queries[(a.qHead + a.qCount) % 8]);
  float c[3];
  const double s0 = nowMs();
  for (const Item& q : list) {
    if (a.cull && !boxVisible(planes, q.rel, q.d->size)) { a.culled++; continue; }
    const int open = a.seams ? q.d->open : 0;
    const uint32_t n = open ? q.e->total : q.e->count;
    if (!n) continue;
    glUniform3f(a.U.origin, (float)q.rel[0], (float)q.rel[1], (float)q.rel[2]);
    glUniform1f(a.U.cellSize, (float)std::ldexp(1.0, q.d->lod));
    glUniform1ui(a.U.openSides, (GLuint)open);
    lodColor(q.d->lod, c); glUniform3fv(a.U.lodColor, 1, c);
    chunkColor(*q.d, c); glUniform3fv(a.U.chunkColor, 1, c);
    glBindVertexArray(q.e->vao);
    glDrawElementsInstanced(GL_TRIANGLES, 36, GL_UNSIGNED_BYTE, nullptr, (GLsizei)n);
    a.drawn++; a.instances += n;
    uint32_t quads = q.e->quads;
    for (int f = 0; f < 6; f++) if (open >> f & 1) quads += q.e->openQuads[f];
    a.triangles += 2ull * quads;
  }
  glBindVertexArray(0);
  a.submitMs = nowMs() - s0;
  if (timing) { glEndQuery(GL_TIME_ELAPSED); a.qCount++; }
  const double q0 = nowMs();
  // Only queries 6 frames old are asked: asking a younger one whether it's
  // ready blocked here until the GPU finished (6 ms a frame on the kit).
  while (a.qCount >= 6) {
    GLint ready = 0;
    glGetQueryObjectiv(a.queries[a.qHead], GL_QUERY_RESULT_AVAILABLE, &ready);
    if (!ready) break;
    GLuint64 ns = 0; glGetQueryObjectui64v(a.queries[a.qHead], GL_QUERY_RESULT, &ns);
    a.gpuMs.add(ns / 1e6);
    a.qHead = (a.qHead + 1) % 8; a.qCount--;
  }
  a.queryMs = nowMs() - q0;
  glDisable(GL_CULL_FACE); glDisable(GL_DEPTH_TEST);
  a.drawMs = nowMs() - t0;
}

/* ---- the panel ------------------------------------------------------------------- */
static void panel(App& a, double fps) {
  ImGui::SetNextWindowPos(ImVec2(10, 10), ImGuiCond_FirstUseEver);
  ImGui::SetNextWindowSize(ImVec2(470, 0), ImGuiCond_FirstUseEver);
  ImGui::Begin("vdag C++ proof of concept  (H hides)");
  if (ImGui::CollapsingHeader("World", ImGuiTreeNodeFlags_DefaultOpen)) {
    if (a.L) {
      const WorldInfo& w = a.L->info();
      ImGui::Text("%s", a.L->path.c_str());
      ImGui::Text("'%s'  D = %d  side %.0f  nodes %u  voxels %.4g", w.name.c_str(), w.D, a.L->side(), a.L->file.store.n, a.L->counts[w.root]);
      if (w.baked) ImGui::Text("baked colour: %zu words at %d bits", w.words.size(), w.bits);
      else if (a.L->world.named) ImGui::Text("named colour: %s (fields.cpp), a word a record", fieldName(a.L->named.kind));
      else ImGui::Text("colour: %s (drawn in gamut: %s)", w.kind.empty() ? "none" : w.kind.c_str(), a.L->colourNote.c_str());
      ImGui::TextWrapped("load: %s", a.status.c_str());
    }
    if (!a.error.empty()) ImGui::TextColored(ImVec4(1, 0.4f, 0.4f, 1), "%s", a.error.c_str());
    ImGui::SetNextItemWidth(200); ImGui::InputText("filter", a.filter, sizeof a.filter);
    ImGui::SameLine(); if (ImGui::Button("rescan")) scanFiles(a);
    if (ImGui::BeginListBox("##files", ImVec2(-1, 150))) {
      for (int i = 0; i < (int)a.files.size(); i++) {
        if (a.filter[0] && a.files[i].find(a.filter) == std::string::npos) continue;
        if (ImGui::Selectable(a.files[i].c_str(), a.pick == i, ImGuiSelectableFlags_AllowDoubleClick)) {
          a.pick = i;
          if (ImGui::IsMouseDoubleClicked(0)) loadFile(a, std::string(POC_REPO_ROOT) + "/" + a.files[i]);
        }
      }
      ImGui::EndListBox();
    }
    if (ImGui::Button("open selected") && a.pick >= 0) loadFile(a, std::string(POC_REPO_ROOT) + "/" + a.files[a.pick]);
    ImGui::SameLine(); ImGui::TextDisabled("(double-click, or drop a .vdag on the window)");
  }
  if (ImGui::CollapsingHeader("Frame", ImGuiTreeNodeFlags_DefaultOpen)) {
    ImGui::Text("%.0f fps   frame %.2f ms (p95 %.2f)   CPU %.2f ms   GPU %.2f ms (p95 %.2f)",
                fps, a.frameMs.mean(), a.frameMs.pct(0.95), a.cpuMs.mean(), a.gpuMs.mean(), a.gpuMs.pct(0.95));
    ImGui::Text("CPU: cut %.3f  install %.3f  cover %.3f  queue %.3f  draw %.3f  ui %.3f ms",
                a.selectMs, a.installMs, a.coverMs, a.queueMs, a.drawMs - a.waitMs, a.uiMs);
    ImGui::Text("     (draw = clearance %.3f + submit %.3f + the rest; waiting on the GPU %.3f ms)", a.clearMs, a.submitMs, a.waitMs);
    ImGui::Text("draws %llu  culled %llu  cubes %llu  triangles %.2fM",
                (unsigned long long)a.drawn, (unsigned long long)a.culled, (unsigned long long)a.instances, a.triangles / 1e6);
    ImGui::Text("eye %.1f, %.1f, %.1f   clear %.1f  near %.2f  speed x%.2f", a.cam.eye[0], a.cam.eye[1], a.cam.eye[2], a.clear, a.near, a.cam.speedMul);
    if (ImGui::Checkbox("vsync", &a.vsync)) SDL_GL_SetSwapInterval(a.vsync ? 1 : 0);
    ImGui::SameLine(); ImGui::Checkbox("GPU timer", &a.gpuTimer);
    ImGui::SameLine(); ImGui::Checkbox("frustum cull", &a.cull);
    ImGui::SameLine(); ImGui::Checkbox("seams", &a.seams);
    ImGui::SameLine(); ImGui::Checkbox("freeze cut (F)", &a.freeze);
    const char* modes[] = { "auto", "attribute", "gamut", "lod", "chunk", "plain" };
    int m = a.colorMode + 1;
    ImGui::SetNextItemWidth(140);
    if (ImGui::Combo("colour", &m, modes, 6)) a.colorMode = m - 1;
  }
  if (ImGui::CollapsingHeader("Streaming", ImGuiTreeNodeFlags_DefaultOpen)) {
    ImGui::Text("cut %zu nodes, %zu leaves, capped %d   drawn %zu   holes %d  up %d  down %d",
                a.cut.nodes.size(), a.cut.leaves.size(), a.cut.capped, a.cover.draw.size(), a.cover.holes, a.cover.up, a.cover.down);
    ImGui::Text("resident %zu (%.1f MB, GPU %.1f MB)   waiting %zu   queued %zu   running %zu",
                a.cache.size(), a.cacheBytes / 1048576.0, a.gpuBytes / 1048576.0, a.waiting.size(), a.queued, a.busy);
    ImGui::Text("jobs %llu   per job: mean %.3f  p50 %.3f  p95 %.3f  max %.2f ms",
                (unsigned long long)a.jobsTotal, a.jobMs.mean(), a.jobMs.pct(0.5), a.jobMs.pct(0.95), a.jobMs.pct(1.0));
    if (a.converging) ImGui::TextColored(ImVec4(1, 0.8f, 0.3f, 1), "converging... %.0f ms, %llu jobs", nowMs() - a.convergeStart, (unsigned long long)a.convergeJobs);
    else if (a.convergeMs > 0)
      ImGui::Text("last converge %.0f ms in %d frames (last job back at %.0f ms), %llu jobs, %.0f ms of job time",
                  a.convergeMs, a.convergeFrames, a.convergeLastJob, (unsigned long long)a.convergeJobs, a.convergeJobMs);
    if (ImGui::Button("flush + time converge (R)")) flush(a);
    ImGui::SetNextItemWidth(200);
    ImGui::SliderFloat("detail", &a.detail, 1, 8, "%.1f");
    ImGui::SetNextItemWidth(200);
    ImGui::SliderInt("max chunks", &a.maxChunks, 64, 4096);
    const char* rules[] = { "any", "majority", "volume", "opacity", "adaptive", "shadow" };
    int r = (int)a.rule;
    ImGui::SetNextItemWidth(200);
    if (ImGui::Combo("lod rule (lod > 0)", &r, rules, 6)) { a.rule = (Rule)r; flush(a); }
    int t = a.threads;
    ImGui::SetNextItemWidth(200);
    if (ImGui::SliderInt("worker threads", &t, 1, (int)std::max(1u, std::thread::hardware_concurrency()))) {}
    if (ImGui::IsItemDeactivatedAfterEdit() && t != a.threads) {
      a.threads = t;
      poolStop(a.pool); poolStart(a.pool, a.threads);
      if (a.L) poolSetWorld(a.pool, a.L->world, a.rule);
      a.waiting.clear();
    }
    ImGui::SetNextItemWidth(200); ImGui::SliderInt("installs / frame", &a.maxInstalls, 1, 512);
    ImGui::SetNextItemWidth(200); ImGui::SliderFloat("upload MB / frame", &a.uploadMB, 1, 256, "%.0f");
  }
  ImGui::End();
}

int main(int argc, char** argv) {
  App a;
  std::string file, shot; int which = 0;
  for (int i = 1; i < argc; i++) {
    std::string s = argv[i];
    auto next = [&]() { return i + 1 < argc ? argv[++i] : (char*)"0"; };
    if (s == "--threads") a.threads = std::max(1, atoi(next()));
    else if (s == "--detail") a.detail = (float)atof(next());
    else if (s == "--world") which = atoi(next());
    else if (s == "--vsync") a.vsync = atoi(next()) != 0;
    else if (s == "--rule") { if (!ruleFromName(next(), a.rule)) { fprintf(stderr, "unknown rule\n"); return 2; } }
    else if (s == "--shot") shot = next();
    else if (s == "--hud") a.showPanel = atoi(next()) != 0;
    else if (s[0] != '-') file = s;
  }

  if (!SDL_Init(SDL_INIT_VIDEO)) { fprintf(stderr, "SDL_Init: %s\n", SDL_GetError()); return 1; }
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 4);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 1);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE);
  SDL_GL_SetAttribute(SDL_GL_CONTEXT_FLAGS, SDL_GL_CONTEXT_FORWARD_COMPATIBLE_FLAG);
  SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1);
  SDL_GL_SetAttribute(SDL_GL_DEPTH_SIZE, 24);
  SDL_Window* win = SDL_CreateWindow("vdag C++ poc", 1600, 1000, SDL_WINDOW_OPENGL | SDL_WINDOW_RESIZABLE | SDL_WINDOW_HIGH_PIXEL_DENSITY);
  if (!win) { fprintf(stderr, "SDL_CreateWindow: %s\n", SDL_GetError()); return 1; }
  SDL_GLContext gl = SDL_GL_CreateContext(win);
  if (!gl) { fprintf(stderr, "SDL_GL_CreateContext: %s\n", SDL_GetError()); return 1; }
  SDL_GL_MakeCurrent(win, gl);
  SDL_GL_SetSwapInterval(a.vsync ? 1 : 0);
  printf("GL %s, %s\n", glGetString(GL_VERSION), glGetString(GL_RENDERER));

  IMGUI_CHECKVERSION();
  ImGui::CreateContext();
  ImGui::GetIO().IniFilename = nullptr;
  ImGui::StyleColorsDark();
  ImGui_ImplSDL3_InitForOpenGL(win, gl);
  ImGui_ImplOpenGL3_Init("#version 410");

  a.prog = glCreateProgram();
  glAttachShader(a.prog, compile(GL_VERTEX_SHADER, VS));
  glAttachShader(a.prog, compile(GL_FRAGMENT_SHADER, FS));
  glLinkProgram(a.prog);
  { GLint ok; glGetProgramiv(a.prog, GL_LINK_STATUS, &ok); if (!ok) { char log[4096]; glGetProgramInfoLog(a.prog, sizeof log, nullptr, log); fprintf(stderr, "link: %s\n", log); return 1; } }
  a.U = { glGetUniformLocation(a.prog, "uViewProj"), glGetUniformLocation(a.prog, "uOrigin"), glGetUniformLocation(a.prog, "uCellSize"),
          glGetUniformLocation(a.prog, "uOpenSides"), glGetUniformLocation(a.prog, "uEyeN"), glGetUniformLocation(a.prog, "uInvSide"),
          glGetUniformLocation(a.prog, "uColorMode"), glGetUniformLocation(a.prog, "uLodColor"), glGetUniformLocation(a.prog, "uChunkColor"),
          glGetUniformLocation(a.prog, "uFog") };
  // The cube: 4 corners a face in FACE_OFF's order, two triangles each (cubeIndex's first 36).
  {
    uint8_t idx[36];
    for (int f = 0; f < 6; f++) { const uint8_t b = (uint8_t)(4 * f); const uint8_t t[6] = { b, (uint8_t)(b + 1), (uint8_t)(b + 2), b, (uint8_t)(b + 2), (uint8_t)(b + 3) }; memcpy(idx + 6 * f, t, 6); }
    glGenBuffers(1, &a.cubeIndex);
    GLuint tmp; glGenVertexArrays(1, &tmp); glBindVertexArray(tmp);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, a.cubeIndex);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof idx, idx, GL_STATIC_DRAW);
    glBindVertexArray(0); glDeleteVertexArrays(1, &tmp);
  }
  glGenQueries(8, a.queries);

  scanFiles(a);
  poolStart(a.pool, a.threads);
  if (file.empty()) {
    // Open on the kit, as the stream viewer does, if the repo has it.
    for (const auto& f : a.files) if (f == "worlds/kit-d10.vdag") file = std::string(POC_REPO_ROOT) + "/" + f;
  }
  if (!file.empty()) loadFile(a, file, which);

  // --shot: once the world has converged and 60 more frames are drawn, write
  // the frame as a PNG, print what it cost, and exit.
  int afterConverge = -1;
  bool running = true, looking = false;
  double last = nowMs(), fpsT = last; int fpsN = 0; double fps = 0;
  while (running) {
    SDL_Event e;
    while (SDL_PollEvent(&e)) {
      ImGui_ImplSDL3_ProcessEvent(&e);
      const ImGuiIO& io = ImGui::GetIO();
      if (e.type == SDL_EVENT_QUIT || e.type == SDL_EVENT_WINDOW_CLOSE_REQUESTED) running = false;
      else if (e.type == SDL_EVENT_DROP_FILE && e.drop.data) loadFile(a, e.drop.data);
      else if (e.type == SDL_EVENT_MOUSE_BUTTON_DOWN && !io.WantCaptureMouse) looking = true;
      else if (e.type == SDL_EVENT_MOUSE_BUTTON_UP) looking = false;
      else if (e.type == SDL_EVENT_MOUSE_MOTION && looking) {
        a.cam.yaw -= e.motion.xrel * 0.004;
        a.cam.pitch = std::clamp(a.cam.pitch - e.motion.yrel * 0.004, -1.55, 1.55);
      } else if (e.type == SDL_EVENT_MOUSE_WHEEL && !io.WantCaptureMouse) a.cam.speedMul = std::clamp(a.cam.speedMul * std::pow(1.15, e.wheel.y), 0.01, 100.0);
      else if (e.type == SDL_EVENT_KEY_DOWN && !e.key.repeat && !io.WantCaptureKeyboard) {
        if (e.key.key == SDLK_H) a.showPanel = !a.showPanel;
        if (e.key.key == SDLK_F) a.freeze = !a.freeze;
        if (e.key.key == SDLK_R) flush(a);
        if (e.key.key == SDLK_ESCAPE) running = false;
      }
    }
    const double now = nowMs(), dt = std::min(0.1, (now - last) / 1000);
    a.frameMs.add(now - last);
    last = now; fpsN++;
    if (now - fpsT > 500) { fps = fpsN * 1000 / (now - fpsT); fpsN = 0; fpsT = now; }
    const double cpu0 = nowMs();

    // Fly: the stream viewer's speed, the world's local scale (the clearance) at the wheel's multiple.
    if (a.L && !ImGui::GetIO().WantCaptureKeyboard) {
      const bool* k = SDL_GetKeyboardState(nullptr);
      double f[3]; fwdOf(a.cam, f);
      double up[3] = { 0, 1, 0 }, z[3] = { -f[0], -f[1], -f[2] }, x[3]; cross(up, z, x); norm(x);   // x is the camera's right
      double mv[3] = { 0, 0, 0 };
      auto add = [&](const double* v, double s) { for (int i = 0; i < 3; i++) mv[i] += v[i] * s; };
      if (k[SDL_SCANCODE_W]) add(f, 1);
      if (k[SDL_SCANCODE_S]) add(f, -1);
      if (k[SDL_SCANCODE_D]) add(x, 1);
      if (k[SDL_SCANCODE_A]) add(x, -1);
      if (k[SDL_SCANCODE_E] || k[SDL_SCANCODE_SPACE]) add(up, 1);
      if (k[SDL_SCANCODE_Q] || k[SDL_SCANCODE_LCTRL]) add(up, -1);
      const double speed = std::min(a.L->side() / 3, std::max(2.0, a.clear)) * a.cam.speedMul * ((k[SDL_SCANCODE_LSHIFT] || k[SDL_SCANCODE_RSHIFT]) ? 4 : 1);
      for (int i = 0; i < 3; i++) a.cam.eye[i] += mv[i] * speed * dt;
    }

    stream(a);
    int w, h; SDL_GetWindowSizeInPixels(win, &w, &h);
    render(a, w, h);
    const double ui0 = nowMs();
    ImGui_ImplOpenGL3_NewFrame();
    ImGui_ImplSDL3_NewFrame();
    ImGui::NewFrame();
    if (a.showPanel) panel(a, fps);
    else {
      ImGui::SetNextWindowPos(ImVec2(ImGui::GetIO().DisplaySize.x - 90, ImGui::GetIO().DisplaySize.y - 30));
      ImGui::Begin("##fps", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_AlwaysAutoResize);
      ImGui::Text("%.0f fps", fps);
      ImGui::End();
    }
    ImGui::Render();
    ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
    a.uiMs = nowMs() - ui0;
    a.cpuMs.add(nowMs() - cpu0);
    if (!shot.empty() && a.L && !a.converging && a.convergeMs > 0 && ++afterConverge == 60) {
      std::vector<uint8_t> px((size_t)w * h * 4);
      glReadPixels(0, 0, w, h, GL_RGBA, GL_UNSIGNED_BYTE, px.data());
      writePng(shot, w, h, px);
      printf("shot %s (%dx%d)\n", shot.c_str(), w, h);
      printf("converge %.0f ms wall in %d frames (last job back at %.0f ms), %llu jobs, %.0f ms of job time on %d threads\n", a.convergeMs, a.convergeFrames,
             a.convergeLastJob, (unsigned long long)a.convergeJobs, a.convergeJobMs, a.threads);
      printf("last frame CPU: cut %.3f install %.3f cover %.3f queue %.3f draw %.3f (clearance %.3f submit %.3f) ui %.3f ms, GPU wait %.3f, query poll %.3f; job mean %.3f p50 %.3f ms\n",
             a.selectMs, a.installMs, a.coverMs, a.queueMs, a.drawMs - a.waitMs, a.clearMs, a.submitMs, a.uiMs, a.waitMs, a.queryMs, a.jobMs.mean(), a.jobMs.pct(0.5));
      printf("frame %.2f ms mean, CPU %.2f ms, GPU %.2f ms (p95 %.2f), %llu draws, %.2fM triangles, %llu cubes\n", a.frameMs.mean(), a.cpuMs.mean(),
             a.gpuMs.mean(), a.gpuMs.pct(0.95), (unsigned long long)a.drawn, a.triangles / 1e6, (unsigned long long)a.instances);
      running = false;
    }
    if (!shot.empty() && a.L == nullptr) running = false;
    SDL_GL_SwapWindow(win);
  }

  poolStop(a.pool);
  for (auto& [k, e] : a.cache) dispose(a, e);
  ImGui_ImplOpenGL3_Shutdown();
  ImGui_ImplSDL3_Shutdown();
  ImGui::DestroyContext();
  SDL_GL_DestroyContext(gl);
  SDL_DestroyWindow(win);
  SDL_Quit();
  return 0;
}
