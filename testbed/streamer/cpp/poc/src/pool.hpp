// pool.hpp — the chunk workers: stream-pool.js + chunk-worker.js, as threads.
//
// The browser posts a snapshot of the DAG to each worker once (a copy per
// worker) and jobs as messages; results come back as transferred buffers.
// Here every thread reads the one store in place, which is the first thing
// C++ buys: no copies, no structured clone, no message hops. Each thread has
// its own JobScratch (grid, mask cache, colour memo), as each JS worker has
// its own module state.
//
// The main thread replaces the queue every frame (setQueue), nearest first,
// so a job that's no longer wanted is never started; results are tagged with
// the generation of the world they were made for, and stale ones dropped.
#pragma once
#include "job.hpp"
#include <atomic>
#include <condition_variable>
#include <deque>
#include <mutex>
#include <thread>
#include <unordered_set>
#ifdef __APPLE__
#include <pthread/qos.h>
#endif

namespace poc {

struct JobReq { int lod; int64_t x, y, z; uint64_t key; };

struct Pool {
  World world{};
  Rule rule = Rule::Shadow;
  uint64_t generation = 0;
  std::vector<std::thread> threads;
  std::mutex m;
  std::condition_variable cv;
  std::deque<JobReq> queue;
  std::vector<std::pair<uint64_t, JobResult>> done;   // (key, result)
  std::unordered_set<uint64_t> running;              // keys being worked on
  int busy = 0;
  bool stop = false;
  std::atomic<uint64_t> jobsRun{ 0 };
};

inline void poolStart(Pool& p, int n) {
  p.stop = false;
  for (int i = 0; i < n; i++)
    p.threads.emplace_back([&p] {
#ifdef __APPLE__
      // Without a class, macOS may run these on the efficiency cores, and a
      // GUI app that isn't frontmost gets App Nap besides: job times swung
      // 0.5 to 3 ms between runs of the same view. A browser's chunk workers
      // get whatever the browser asks for; this is what we ask for.
      pthread_set_qos_class_self_np(QOS_CLASS_USER_INITIATED, 0);
#endif
      JobScratch scratch;
      for (;;) {
        JobReq j; World w; Rule rule; uint64_t gen;
        {
          std::unique_lock<std::mutex> lk(p.m);
          p.cv.wait(lk, [&] { return p.stop || !p.queue.empty(); });
          if (p.stop) return;
          j = p.queue.front(); p.queue.pop_front();
          w = p.world; rule = p.rule; gen = p.generation;
          p.busy++; p.running.insert(j.key);
        }
        JobResult r = runJob(w, scratch, j.lod, j.x, j.y, j.z, rule);
        p.jobsRun++;
        std::lock_guard<std::mutex> lk(p.m);
        p.busy--; p.running.erase(j.key);
        if (gen == p.generation) p.done.emplace_back(j.key, std::move(r));
      }
    });
}
inline void poolStop(Pool& p) {
  { std::lock_guard<std::mutex> lk(p.m); p.stop = true; p.queue.clear(); }
  p.cv.notify_all();
  for (auto& t : p.threads) t.join();
  p.threads.clear();
  p.done.clear(); p.busy = 0; p.running.clear();
}
// A new world or rule: running jobs finish and are dropped.
inline void poolSetWorld(Pool& p, const World& w, Rule rule) {
  std::lock_guard<std::mutex> lk(p.m);
  p.world = w; p.rule = rule; p.generation++;
  p.queue.clear(); p.done.clear();
}
// Keys already running, or done and not yet taken, aren't queued again.
inline void poolSetQueue(Pool& p, const std::vector<JobReq>& q) {
  {
    std::lock_guard<std::mutex> lk(p.m);
    p.queue.clear();
    std::unordered_set<uint64_t> doneKeys;
    for (auto& d : p.done) doneKeys.insert(d.first);
    for (const JobReq& j : q) if (!p.running.count(j.key) && !doneKeys.count(j.key)) p.queue.push_back(j);
  }
  p.cv.notify_all();
}
inline std::vector<std::pair<uint64_t, JobResult>> poolTake(Pool& p, int& busy, size_t& queued) {
  std::lock_guard<std::mutex> lk(p.m);
  busy = p.busy; queued = p.queue.size();
  std::vector<std::pair<uint64_t, JobResult>> out;
  out.swap(p.done);
  return out;
}

} // namespace poc
