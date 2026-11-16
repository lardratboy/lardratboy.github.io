// vdag.cpp — see vdag.hpp. The graph decoder is graphDecoder's, line for line.
#include "vdag.hpp"
#include <zlib.h>
#include <algorithm>
#include <chrono>
#include <cstring>
#include <fstream>
#include <map>
#include <memory>
#include <stdexcept>

namespace poc {

double nowMs() {
  using namespace std::chrono;
  return duration<double, std::milli>(steady_clock::now().time_since_epoch()).count();
}

static std::runtime_error damaged(const std::string& why) { return std::runtime_error("the file is damaged: " + why); }

struct JsonReader {
  const char* p; const char* e;
  void ws() { while (p < e && (*p == ' ' || *p == '\n' || *p == '\r' || *p == '\t')) p++; }
  std::string string() {
    std::string s; p++;
    while (p < e && *p != '"') {
      if (*p == '\\' && p + 1 < e) { p++; s += (*p == 'n' ? '\n' : *p); p++; continue; }
      s += *p++;
    }
    if (p >= e) throw damaged("its DESC section isn't JSON");
    p++;
    return s;
  }
  Json value() {
    ws();
    if (p >= e) throw damaged("its DESC section isn't JSON");
    Json j;
    if (*p == '{') {
      j.type = Json::Obj; p++; ws();
      if (*p == '}') { p++; return j; }
      for (;;) {
        ws(); if (*p != '"') throw damaged("its DESC section isn't JSON");
        std::string k = string(); ws();
        if (*p++ != ':') throw damaged("its DESC section isn't JSON");
        j.obj.emplace_back(k, value()); ws();
        if (*p == ',') { p++; continue; }
        if (*p == '}') { p++; return j; }
        throw damaged("its DESC section isn't JSON");
      }
    }
    if (*p == '[') {
      j.type = Json::Arr; p++; ws();
      if (*p == ']') { p++; return j; }
      for (;;) {
        j.arr.push_back(value()); ws();
        if (*p == ',') { p++; continue; }
        if (*p == ']') { p++; return j; }
        throw damaged("its DESC section isn't JSON");
      }
    }
    if (*p == '"') { j.type = Json::Str; j.str = string(); return j; }
    if (!strncmp(p, "true", 4)) { p += 4; j.type = Json::Bool; j.b = true; return j; }
    if (!strncmp(p, "false", 5)) { p += 5; j.type = Json::Bool; return j; }
    if (!strncmp(p, "null", 4)) { p += 4; return j; }
    char* end = nullptr;
    j.num = strtod(p, &end);
    if (end == p) throw damaged("its DESC section isn't JSON");
    j.type = Json::Num; p = end;
    return j;
  }
};

/* ---- bytes ------------------------------------------------------------------ */
struct Reader {
  const uint8_t* b; size_t n; size_t p = 0;
  uint64_t varint() {
    uint64_t v = 0, m = 1; uint8_t x;
    do {
      if (p >= n) throw damaged("it ends in the middle of a number");
      x = b[p++];
      v += (uint64_t)(x & 127) * m;
      m *= 128;
      if (m > (1ull << 49)) throw damaged("a number is too long");
    } while (x >= 128);
    return v;
  }
};

static std::vector<uint8_t> gunzip(const uint8_t* src, size_t n) {
  std::vector<uint8_t> out(std::max<size_t>(n * 4, 1 << 16));
  z_stream s{};
  if (inflateInit2(&s, 16 + MAX_WBITS) != Z_OK) throw std::runtime_error("zlib init failed");
  s.next_in = const_cast<uint8_t*>(src); s.avail_in = (uInt)n;
  size_t have = 0;
  for (;;) {
    if (have == out.size()) out.resize(out.size() * 2);
    s.next_out = out.data() + have; s.avail_out = (uInt)std::min<size_t>(out.size() - have, 1u << 30);
    int r = inflate(&s, Z_NO_FLUSH);
    have = (size_t)(s.next_out - out.data());
    if (r == Z_STREAM_END) break;
    if (r != Z_OK && r != Z_BUF_ERROR) { inflateEnd(&s); throw damaged("a compressed section doesn't unpack"); }
    if (r == Z_BUF_ERROR && s.avail_in == 0 && s.avail_out != 0) { inflateEnd(&s); throw damaged("a compressed section doesn't unpack"); }
    if (have > (1ull << 31)) { inflateEnd(&s); throw damaged("it unpacks to more than 2 GB"); }
  }
  inflateEnd(&s);
  out.resize(have);
  return out;
}
static std::vector<uint8_t> unpacked(uint8_t code, const uint8_t* b, size_t n) {
  if (code == 1) return gunzip(b, n);
  if (code == 0) return std::vector<uint8_t>(b, b + n);
  throw std::runtime_error("unknown compression " + std::to_string(code) + ": the file is from a newer version");
}

/* ---- the graph ----------------------------------------------------------------
   ref(l)  := varint d; d = 0: body(l) follows; d > 0: the d-th most recent
              level-l node
   body(l) := mask, then per present child: l = 2, the child's mask (level-1
              nodes aren't referenced); l > 2, ref(l − 1).
   Tables carry on across payloads; `aside` forgets what a payload added. */
struct GraphDecoder {
  Store& store;
  std::vector<std::vector<uint32_t>> tables = std::vector<std::vector<uint32_t>>(31);
  uint32_t leafs[256] = {};
  const uint8_t* bytes = nullptr; size_t n = 0; size_t p = 0;

  uint8_t maskAt() {
    if (p >= n) throw damaged("the graph ends early");
    uint8_t m = bytes[p++];
    if (!m) throw damaged("a node has no children");
    return m;
  }
  uint32_t leaf(uint8_t m) {
    if (leafs[m]) return leafs[m];
    uint32_t bits[8];
    for (int o = 0; o < 8; o++) bits[o] = (m >> o & 1) ? FULL : EMPTY;
    return leafs[m] = intern(store, 1, bits);
  }
  uint32_t body(int l, uint8_t m) {
    if (l == 1) return leaf(m);
    uint32_t ch[8];
    for (int o = 0; o < 8; o++) ch[o] = !(m >> o & 1) ? EMPTY : l == 2 ? leaf(maskAt()) : ref(l - 1);
    return intern(store, l, ch);
  }
  uint32_t ref(int l) {
    Reader r{ bytes, n, p };
    uint64_t d = r.varint(); p = r.p;
    auto& t = tables[l];
    if (d) {
      if (d > t.size()) throw damaged("a reference points past its table");
      return t[t.size() - d];
    }
    uint32_t id = body(l, maskAt());
    tables[l].push_back(id);
    return id;
  }
  std::vector<uint32_t> decode(const std::vector<uint8_t>& b, const std::vector<int>& Ds) {
    bytes = b.data(); n = b.size(); p = 0;
    std::vector<uint32_t> roots;
    for (int D : Ds) {
      if (p + 1 < n && bytes[p] == 0 && bytes[p + 1] == 0) { p += 2; roots.push_back(EMPTY); continue; }
      roots.push_back(ref(D));
    }
    if (p != n) throw damaged(std::to_string(n - p) + " bytes follow the graph");
    return roots;
  }
  std::vector<uint32_t> aside(const std::vector<uint8_t>& b, const std::vector<int>& Ds) {
    std::vector<size_t> lengths;
    for (auto& t : tables) lengths.push_back(t.size());
    auto out = decode(b, Ds);
    for (size_t l = 0; l < tables.size(); l++) tables[l].resize(lengths[l]);
    return out;
  }
};

// round(q · 255 / 63), vdag-core's WIDEN6: a six-bit channel back to the
// eight-bit value whose to6 is q.
static const struct Widen6 {
  uint8_t v[64];
  Widen6() { for (int q = 0; q < 64; q++) v[q] = (uint8_t)std::round(q * 255.0 / 63.0); }
  uint8_t operator[](uint32_t q) const { return v[q]; }
} WIDEN6;

VdagFile readVdag(const std::string& path) {
  VdagFile F;
  double t0 = nowMs();
  // One sized read. istreambuf_iterator went a byte at a time: 140 ms for the
  // 43 MB lattice, against Node's 12 ms readFile.
  std::ifstream in(path, std::ios::binary | std::ios::ate);
  if (!in) throw std::runtime_error("can't open " + path);
  std::vector<uint8_t> file((size_t)in.tellg());
  in.seekg(0);
  if (!in.read((char*)file.data(), (std::streamsize)file.size())) throw std::runtime_error("can't read " + path);
  F.bytes = file.size();
  F.t.read = nowMs() - t0;

  if (file.size() < 8 || memcmp(file.data(), "VDAG", 4)) throw std::runtime_error("not a world file (no VDAG header)");
  uint32_t version; memcpy(&version, &file[4], 4);
  if (version != 1) throw std::runtime_error("a version " + std::to_string(version) + " world file; this reads version 1");
  struct Part { const uint8_t* b; size_t n; };
  std::map<std::string, Part> parts; std::vector<Part> attrs, tables;
  for (size_t p = 8; p < file.size();) {
    if (p + 8 > file.size()) throw damaged("it ends inside a section header");
    std::string tag((const char*)&file[p], 4);
    uint32_t n; memcpy(&n, &file[p + 4], 4);
    if (p + 8 + n > file.size()) throw damaged("section " + tag + " runs past the end");
    Part part{ &file[p + 8], n };
    if (tag == "ATTR") attrs.push_back(part); else if (tag == "TBLE") tables.push_back(part); else parts[tag] = part;
    p += 8 + n;
  }
  for (const char* tag : { "DESC", "ROOT", "NODE" }) if (!parts.count(tag)) throw damaged(std::string("it has no ") + tag + " section");

  // DESC: a list of worlds, or (the experiment's first files) one bare descriptor.
  JsonReader jr{ (const char*)parts["DESC"].b, (const char*)parts["DESC"].b + parts["DESC"].n };
  Json manifest = jr.value();
  const Json* list = manifest.get("worlds");
  bool bare = !list || list->type != Json::Arr;

  Reader rr{ parts["ROOT"].b, parts["ROOT"].n };
  size_t count = rr.varint();
  if (rr.p + count != rr.n) throw damaged("its ROOT section is the wrong length");
  std::vector<int> Ds;
  for (size_t i = 0; i < count; i++) { int D = rr.b[rr.p++]; if (D < 1 || D > 30) throw damaged("a world has D = " + std::to_string(D)); Ds.push_back(D); }
  if (!bare && list->arr.size() != count) throw damaged("its world list and roots disagree");

  F.worlds.resize(count);
  for (size_t i = 0; i < count; i++) {
    WorldInfo& w = F.worlds[i];
    w.D = Ds[i];
    const Json* e = bare ? nullptr : &list->arr[i];
    const Json* desc = bare ? &manifest : e->get("desc");
    if (desc && desc->type == Json::Obj) {
      w.desc = *desc;
      if (auto k = desc->get("kind"); k && k->type == Json::Str) w.kind = k->str;
    }
    if (e) {
      if (auto nm = e->get("name"); nm && nm->type == Json::Str) w.name = nm->str;
      if (auto v = e->get("view"); v && v->type == Json::Obj) {
        auto eye = v->get("eye"); auto yaw = v->get("yaw"); auto pitch = v->get("pitch");
        if (eye && eye->type == Json::Arr && eye->arr.size() == 3 && yaw && pitch) {
          for (int a = 0; a < 3; a++) w.eye[a] = eye->arr[a].num;
          w.yaw = yaw->num; w.pitch = pitch->num; w.hasView = true;
        }
      }
    }
    if (w.name.empty()) w.name = w.kind.empty() ? "world" : w.kind;
  }

  // NODE
  Part node = parts["NODE"];
  if (node.n < 2) throw damaged("its NODE section is empty");
  if (node.b[0] != 1) throw std::runtime_error("unknown node encoding: the file is from a newer version");
  t0 = nowMs();
  auto payload = unpacked(node.b[1], node.b + 2, node.n - 2);
  F.payloadBytes = payload.size();
  F.t.unpack = nowMs() - t0;
  t0 = nowMs();
  F.store.keys.reserve(payload.size() * 2);
  GraphDecoder dec{ F.store };
  auto roots = dec.decode(payload, Ds);
  for (size_t i = 0; i < count; i++) F.worlds[i].root = roots[i];
  F.t.decode = nowMs() - t0;

  // TBLE: a named colour's table, int32s. The experiment's first files (a
  // bare descriptor) hold it gzipped with no header.
  for (const Part& t : tables) {
    size_t i = 0;
    std::vector<uint8_t> bytes;
    if (bare) bytes = gunzip(t.b, t.n);
    else {
      Reader q{ t.b, t.n };
      i = q.varint();
      if (i >= count || q.p >= t.n) throw damaged("a table names a world that isn't there");
      bytes = unpacked(t.b[q.p], t.b + q.p + 1, t.n - q.p - 1);
    }
    if (bytes.size() % 4) throw damaged("a table isn't whole 32-bit words");
    F.worlds[i].table.resize(bytes.size() / 4);
    memcpy(F.worlds[i].table.data(), bytes.data(), bytes.size());
  }

  // ATTR: each skin goes on from NODE's tables, then they forget it.
  t0 = nowMs();
  for (const Part& a : attrs) {
    if (bare) throw damaged("a file from before world lists has an ATTR section");
    Reader q{ a.b, a.n };
    size_t i = q.varint();
    if (i >= count) throw damaged("an ATTR section names a world that isn't there");
    if (q.p + 2 > a.n) throw damaged("an ATTR section ends early");
    if (a.b[q.p] != 1) throw std::runtime_error("unknown skin encoding: the file is from a newer version");
    uint8_t skinCode = a.b[q.p + 1]; q.p += 2;
    size_t n = q.varint();
    if (q.p + n + 2 > a.n) throw damaged("an ATTR section ends early");
    auto skinBytes = unpacked(skinCode, a.b + q.p, n);
    uint32_t skin = dec.aside(skinBytes, { Ds[i] })[0];
    q.p += n;
    uint8_t wordEnc = a.b[q.p], wordCode = a.b[q.p + 1];
    if (wordEnc != 1 && wordEnc != 2) throw std::runtime_error("unknown word encoding: the file is from a newer version");
    auto bytes = unpacked(wordCode, a.b + q.p + 2, a.n - q.p - 2);
    if (bytes.size() % 4) throw damaged("a baked colour isn't whole 32-bit words");
    WorldInfo& w = F.worlds[i];
    w.words.resize(bytes.size() / 4);
    memcpy(w.words.data(), bytes.data(), bytes.size());
    if (wordEnc == 2)
      for (auto& x : w.words) {
        if (x & 0xc0c0c0u) throw damaged("a six-bit baked colour has a channel past 63");
        x = WIDEN6[x & 63] | WIDEN6[x >> 8 & 63] << 8 | WIDEN6[x >> 16 & 63] << 16 | (x & 0xff000000u);
      }
    w.baked = true; w.skin = skin; w.bits = wordEnc == 2 ? 6 : 8;
  }
  F.t.attr = nowMs() - t0;
  return F;
}

} // namespace poc
