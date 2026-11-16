// vdag.hpp — reading a .vdag world file (vdag-core.js's readVdag, the parts a
// renderer needs). The layout is decided in vdag-core.js; this only reads it.
//
// What is read: DESC (names, saved views, whether a world is baked), ROOT,
// NODE (gzip or stored, the graph written where each node is first used) and
// ATTR (a baked world's skin, continuing NODE's level tables, and its words,
// widened back from six bits when stored so). TBLE (a named colour's table) is
// skipped: named colour fields (kit, caves, ...) are JS code, not data, so
// this renderer draws those worlds in the gamut colour instead.
//
// What isn't: the JS reader prunes each world to a store of its own, checks the
// node and voxel counts DESC states, and recomputes the colour print. Those
// are validation, not decoding; vdagbench times the JS reader both ways.
#pragma once
#include "dag.hpp"
#include <string>

namespace poc {

/* ---- a small JSON reader, for DESC ----------------------------------------
   Only what DESC holds: objects, arrays, strings, numbers, true/false/null.
   Strings keep their escapes undecoded except \" and \\ (names are shown,
   never parsed further). */
struct Json {
  enum Type { Null, Bool, Num, Str, Arr, Obj } type = Null;
  double num = 0; bool b = false; std::string str;
  std::vector<Json> arr; std::vector<std::pair<std::string, Json>> obj;
  double num0(const char* k, double d = 0) const { auto j = get(k); return j && j->type == Num ? j->num : d; }
  const Json* get(const char* k) const {
    if (type != Obj) return nullptr;
    for (auto& [key, v] : obj) if (key == k) return &v;
    return nullptr;
  }
};
struct WorldInfo {
  std::string name;
  int D = 0;
  uint32_t root = EMPTY;
  bool hasView = false;
  double eye[3] = { 0, 0, 0 }, yaw = 0, pitch = 0;
  std::string kind;                 // the descriptor's kind ("kit", "baked", ...), "" if none
  Json desc;                        // the colour descriptor, as DESC holds it
  std::vector<int32_t> table;       // its table (TBLE): the scatter's specimens, the dungeon's tile codes
  bool baked = false;
  uint32_t skin = EMPTY;            // a baked world's skin root, in the same store
  int bits = 8;
  std::vector<uint32_t> words;      // rgb8, one per skin voxel in Morton (rank) order
};

struct LoadTimes { double read = 0, unpack = 0, decode = 0, attr = 0, counts = 0, baked = 0; };

struct VdagFile {
  Store store;                      // every world's nodes, one store
  std::vector<WorldInfo> worlds;
  size_t bytes = 0, payloadBytes = 0;
  LoadTimes t;
};

// Throws std::runtime_error with a reason on a file it can't read.
VdagFile readVdag(const std::string& path);

double nowMs();

} // namespace poc
