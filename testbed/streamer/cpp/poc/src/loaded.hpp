// loaded.hpp — a world ready to stream: the file's store, its counts, and a
// baked colour field when it has one. Held by pointer, because World and
// Baked point into it.
#pragma once
#include "vdag.hpp"
#include "job.hpp"
#include "cut.hpp"
#include <memory>

namespace poc {

struct Loaded {
  std::string path;
  VdagFile file;
  int which = 0;
  std::vector<double> counts;
  Baked baked;
  Named named;
  std::string colourNote;          // why a world has no field here, if it hasn't
  World world;
  CutWorld cutWorld() const { return { world.store, world.root, world.D }; }
  const WorldInfo& info() const { return file.worlds[which]; }
  double side() const { return std::ldexp(1.0, world.D); }
};

// colour = false: no named field even where one is ported (to time without it).
inline std::unique_ptr<Loaded> loadWorld(const std::string& path, int which = 0, bool colour = true) {
  auto L = std::make_unique<Loaded>();
  L->path = path;
  L->file = readVdag(path);
  if (L->file.worlds.empty()) throw std::runtime_error("the file holds no worlds");
  if (which < 0 || which >= (int)L->file.worlds.size()) throw std::runtime_error("no world " + std::to_string(which));
  L->which = which;
  const WorldInfo& w = L->file.worlds[which];
  if (w.D > 25) throw std::runtime_error("this proof of concept draws worlds to D = 25");
  double t0 = nowMs();
  L->counts = makeCounts(L->file.store);
  L->file.t.counts = nowMs() - t0;
  L->world = { &L->file.store, L->counts.data(), w.root, w.D, nullptr };
  t0 = nowMs();
  if (w.baked) {
    L->baked = makeBaked(L->file.store, L->counts.data(), w.skin, w.D, w.words);
    L->world.baked = &L->baked;
  } else if (colour) {
    L->named = makeNamed(w, L->colourNote);
    if (L->named.kind != FieldKind::None) L->world.named = &L->named;
  }
  L->file.t.baked = nowMs() - t0;
  return L;
}

// The view a file opens at: its own if it saved one, else the stream
// viewer's kit view (outside the low corner, above it, looking in).
inline void defaultView(const Loaded& L, double eye[3], double& yaw, double& pitch) {
  const WorldInfo& w = L.info();
  if (w.hasView) { for (int a = 0; a < 3; a++) eye[a] = w.eye[a]; yaw = w.yaw; pitch = w.pitch; return; }
  const double s = L.side();
  eye[0] = -0.35 * s; eye[1] = 0.9 * s; eye[2] = -0.45 * s; yaw = 0.68; pitch = -0.5;
}

} // namespace poc
