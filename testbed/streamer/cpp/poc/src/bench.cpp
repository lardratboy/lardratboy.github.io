// bench.cpp — vdagbench: the same work as bench/bench.mjs, in C++, so the two
// can be read side by side.
//
//   vdagbench <file.vdag> [--world i] [--detail 4] [--max 1024] [--rule shadow]
//             [--threads 4] [--reps 5] [--eye view|centre|x,y,z]... [--no-colour] [--json]
//
// For each eye: the cut (selectChunks), then every chunk of it as a job
// (fastChunk + the buried shortcut, all the cut's nodes, as the streamer wants
// them with splitsResident), on one thread cold and warm and on N threads.
// The checksum is FNV-1a over every job's numbers, records and words in key
// order; bench.mjs prints the same one when the two did the same work.
#include "loaded.hpp"
#include "pool.hpp"
#include <algorithm>
#include <cstdio>
#include <cstring>

using namespace poc;

static uint32_t fnv(uint32_t h, uint32_t v) {
  for (int i = 0; i < 4; i++) { h ^= v >> (8 * i) & 255; h *= 0x01000193u; }
  return h;
}
static uint32_t checksum(const std::vector<JobReq>& jobs, const std::vector<JobResult>& res) {
  std::vector<size_t> order(jobs.size());
  for (size_t i = 0; i < order.size(); i++) order[i] = i;
  std::sort(order.begin(), order.end(), [&](size_t a, size_t b) {
    const JobReq &A = jobs[a], &B = jobs[b];
    if (A.lod != B.lod) return A.lod < B.lod;
    if (A.x != B.x) return A.x < B.x;
    if (A.y != B.y) return A.y < B.y;
    return A.z < B.z;
  });
  uint32_t h = 0x811c9dc5u;
  for (size_t i : order) {
    const JobResult& r = res[i];
    h = fnv(h, (uint32_t)r.lod); h = fnv(h, (uint32_t)r.cx); h = fnv(h, (uint32_t)r.cy); h = fnv(h, (uint32_t)r.cz);
    h = fnv(h, r.count); h = fnv(h, (uint32_t)r.records.size()); h = fnv(h, r.quads);
    for (int f = 0; f < 6; f++) h = fnv(h, r.openQuads[f]);
    h = fnv(h, (uint32_t)r.occupied);
    for (uint32_t v : r.records) h = fnv(h, v);
    h = fnv(h, (uint32_t)r.attrs.size());
    for (uint32_t v : r.attrs) h = fnv(h, v);
  }
  return h;
}
static double median(std::vector<double> v) { std::sort(v.begin(), v.end()); return v.empty() ? 0 : v[v.size() / 2]; }
static double minOf(const std::vector<double>& v) { return v.empty() ? 0 : *std::min_element(v.begin(), v.end()); }

// Every job of `jobs` on `n` threads, each with a fresh scratch: the wall time.
static double runThreads(const World& w, Rule rule, const std::vector<JobReq>& jobs, int n, std::vector<JobResult>& res) {
  res.assign(jobs.size(), JobResult{});
  std::atomic<size_t> next{ 0 };
  const double t0 = nowMs();
  std::vector<std::thread> ts;
  for (int t = 0; t < n; t++)
    ts.emplace_back([&] {
      JobScratch s;
      for (size_t i; (i = next++) < jobs.size();) res[i] = runJob(w, s, jobs[i].lod, jobs[i].x, jobs[i].y, jobs[i].z, rule);
    });
  for (auto& t : ts) t.join();
  return nowMs() - t0;
}

int main(int argc, char** argv) {
  std::string path; int which = 0, maxChunks = 1024, reps = 5, threads = 4; double detail = 4;
  Rule rule = Rule::Shadow; bool json = false, colour = true;
  std::vector<std::string> eyes;
  for (int i = 1; i < argc; i++) {
    std::string a = argv[i];
    auto next = [&]() -> const char* { if (i + 1 >= argc) { fprintf(stderr, "%s needs a value\n", a.c_str()); exit(2); } return argv[++i]; };
    if (a == "--world") which = atoi(next());
    else if (a == "--detail") detail = atof(next());
    else if (a == "--max") maxChunks = atoi(next());
    else if (a == "--reps") reps = std::max(1, atoi(next()));
    else if (a == "--threads") threads = std::max(1, atoi(next()));
    else if (a == "--rule") { const char* r = next(); if (!ruleFromName(r, rule)) { fprintf(stderr, "unknown rule %s\n", r); return 2; } }
    else if (a == "--eye") eyes.push_back(next());
    else if (a == "--json") json = true;
    else if (a == "--no-colour") colour = false;
    else if (a[0] != '-') path = a;
    else { fprintf(stderr, "unknown option %s\n", a.c_str()); return 2; }
  }
  if (path.empty()) {
    fprintf(stderr, "usage: vdagbench <file.vdag> [--world i] [--detail 4] [--max 1024] [--rule shadow] [--threads 4] [--reps 5] [--eye view|centre|x,y,z] [--no-colour] [--json]\n");
    return 2;
  }
  if (eyes.empty()) eyes = { "view", "centre" };

  std::unique_ptr<Loaded> L;
  try { L = loadWorld(path, which, colour); } catch (std::exception& e) { fprintf(stderr, "%s: %s\n", path.c_str(), e.what()); return 1; }
  const WorldInfo& info = L->info();
  const LoadTimes& t = L->file.t;
  const double side = L->side();
  printf("C++  %s\n", path.c_str());
  printf("     world '%s'  D = %d  nodes %u  voxels %.0f  %s\n", info.name.c_str(), info.D, L->file.store.n, L->counts[info.root],
         info.baked ? ("baked, " + std::to_string(info.words.size()) + " words at " + std::to_string(info.bits) + " bits").c_str()
         : L->world.named ? (std::string("named colour: ") + fieldName(L->named.kind)).c_str()
         : ("no colour (gamut)" + (L->colourNote.empty() || !colour ? std::string() : ": " + L->colourNote)).c_str());
  printf("     load  read %.1f  unpack %.1f  decode %.1f  attr %.1f  counts %.1f  baked %.1f  = %.1f ms  (%zu bytes, %zu payload)\n",
         t.read, t.unpack, t.decode, t.attr, t.counts, t.baked, t.read + t.unpack + t.decode + t.attr + t.counts + t.baked, L->file.bytes, L->file.payloadBytes);

  const std::string colourName = info.baked ? "baked" : L->world.named ? fieldName(L->named.kind) : "gamut";
  std::string jsonOut = "{\"lang\":\"cpp\",\"colour\":\"" + colourName + "\",\"file\":\"" + path + "\",\"load\":" + std::to_string(t.read + t.unpack + t.decode + t.attr + t.counts + t.baked) + ",\"eyes\":[";
  for (size_t ei = 0; ei < eyes.size(); ei++) {
    double eye[3], yaw, pitch;
    const std::string& e = eyes[ei];
    if (e == "view") defaultView(*L, eye, yaw, pitch);
    else if (e == "centre") eye[0] = eye[1] = eye[2] = 0.5 * side;
    else if (sscanf(e.c_str(), "%lf,%lf,%lf", &eye[0], &eye[1], &eye[2]) != 3) { fprintf(stderr, "bad eye %s\n", e.c_str()); return 2; }

    // The cut, timed over many runs (it's small).
    Cut cut;
    std::vector<double> cutMs;
    for (int r = 0; r < 50; r++) { const double t0 = nowMs(); cut = selectChunks(L->cutWorld(), eye, detail, maxChunks); cutMs.push_back(nowMs() - t0); }
    // The jobs: every node of the cut, in the streamer's order (dist / size, then coarse first).
    std::vector<int> order;
    for (size_t i = 0; i < cut.nodes.size(); i++) order.push_back((int)i);
    std::stable_sort(order.begin(), order.end(), [&](int a, int b) {
      const Chunk &A = cut.nodes[a], &B = cut.nodes[b];
      const double ra = A.dist / A.size, rb = B.dist / B.size;
      if (ra != rb) return ra < rb;
      return A.lod > B.lod;
    });
    std::vector<JobReq> jobs;
    for (int i : order) { const Chunk& c = cut.nodes[i]; jobs.push_back({ c.lod, c.x, c.y, c.z, c.key }); }

    // One thread, cold (a fresh scratch every rep) and warm (the mask cache and
    // the colour memo kept from the run before, as a worker's are mid-flight).
    std::vector<JobResult> res(jobs.size());
    std::vector<double> cold, warm, perJob;
    for (int r = 0; r < reps; r++) {
      JobScratch s;
      double t0 = nowMs();
      for (size_t i = 0; i < jobs.size(); i++) res[i] = runJob(L->world, s, jobs[i].lod, jobs[i].x, jobs[i].y, jobs[i].z, rule);
      cold.push_back(nowMs() - t0);
      t0 = nowMs();
      for (size_t i = 0; i < jobs.size(); i++) res[i] = runJob(L->world, s, jobs[i].lod, jobs[i].x, jobs[i].y, jobs[i].z, rule);
      warm.push_back(nowMs() - t0);
      if (r == reps - 1) for (auto& x : res) perJob.push_back(x.ms);
    }
    const uint32_t sum = checksum(jobs, res);
    std::vector<JobResult> mres;
    std::vector<double> multi;
    for (int r = 0; r < reps; r++) multi.push_back(runThreads(L->world, rule, jobs, threads, mres));
    const uint32_t msum = checksum(jobs, mres);

    size_t recs = 0, tail = 0, words = 0, buried = 0, empty = 0; double tris = 0;
    for (auto& x : res) { recs += x.count; tail += x.records.size() - x.count; words += x.attrs.size(); buried += x.buriedChunk; empty += !x.buriedChunk && x.records.empty(); tris += 2.0 * x.quads; }
    int lodHist[32] = {};
    for (int li : cut.leaves) lodHist[cut.nodes[li].lod]++;
    std::string lods;
    for (int l = 0; l < 32; l++) if (lodHist[l]) lods += " " + std::to_string(l) + ":" + std::to_string(lodHist[l]);

    printf("\n     eye %-7s [%.1f, %.1f, %.1f]  detail %g  rule %s\n", e.c_str(), eye[0], eye[1], eye[2], detail, ruleName(rule));
    printf("     cut   %zu nodes, %zu leaves (lod%s), capped %d   %.3f ms median\n", cut.nodes.size(), cut.leaves.size(), lods.c_str(), cut.capped, median(cutMs));
    printf("     jobs  %zu  (%zu buried, %zu empty)  records %zu + tail %zu  words %zu  triangles %.0f  bytes %.1f MB\n",
           jobs.size(), buried, empty, recs, tail, words, tris, 4.0 * (recs + tail + words) / 1048576.0);
    printf("     1 thread   cold %.1f ms (min of %d)  warm %.1f ms   per job: median %.3f  max %.2f ms\n",
           minOf(cold), reps, minOf(warm), median(perJob), perJob.empty() ? 0 : *std::max_element(perJob.begin(), perJob.end()));
    printf("     %d threads  %.1f ms wall (min of %d)  = %.1fx one thread cold\n", threads, minOf(multi), reps, minOf(cold) / minOf(multi));
    printf("     checksum %08x%s\n", sum, msum == sum ? "" : "  (threads DIFFER!)");
    char buf[512];
    snprintf(buf, sizeof buf, "%s{\"eye\":\"%s\",\"nodes\":%zu,\"leaves\":%zu,\"cutMs\":%.4f,\"cold\":%.3f,\"warm\":%.3f,\"multi\":%.3f,\"threads\":%d,\"records\":%zu,\"tail\":%zu,\"words\":%zu,\"checksum\":\"%08x\"}",
             ei ? "," : "", e.c_str(), cut.nodes.size(), cut.leaves.size(), median(cutMs), minOf(cold), minOf(warm), minOf(multi), threads, recs, tail, words, sum);
    jsonOut += buf;
  }
  jsonOut += "]}";
  if (json) printf("\nJSON %s\n", jsonOut.c_str());
  return 0;
}
