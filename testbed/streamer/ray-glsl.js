/* ================== RAY GLSL (pure) ==================================
   GLSL_RAY: the ray path's classifier and tracer, the one source every
   program prepends (the ray pass and both probes in stream-viewer.html),
   as GLSL_DECODE is for records. It is ray-core.js's classifyPagesCPU and
   traceCPU written again line for line, so **the two change together**,
   and the probes hold them to each other: classify exactly, trace up to
   float32 grazes (docs/ray-plan.md, decision 8).

   Textures (layouts in ray-core.js's header):
     uTree    RGBA32UI, TREE_TEXELS texels a node, TREE_W wide:
              texel 0 = (kind, lod, page, 0), texels 1–2 = children 0–7
     uPages   R32UI, PAGE_WORDS wide, one page per row
     uBricks  RGBA32UI, BRICK_ROW bricks a row, 4 texels a brick
   Everything is in voxels, with integer cells; positions are floats only
   inside the march, and the crossed cell is carried as an integer, as in
   sol-v4's traceTower (docs/tracer-cell-carry.md).

   GLSL_RAY_ATTR (step 6) is ray-core's attrAtCPU line for line: the word
   of a hit cell, from its page's run in the attribute heap, at the cell's
   rank among the run's shown bits. GLSL ES 3.00 has no bitCount, so the
   rank is a SWAR popcount over at most 16 mask words. Two more textures:
     uPageAttr  R32UI, PAGE_WORDS wide, one page per row (as uPages):
                the run's heap index per grid entry, or ATTR_NONE
     uAttrHeap  R32UI, HEAP_W wide: the runs
   A probe holds it to attrAtCPU exactly (stream-viewer's raySelftest). */
import { ATTR_NONE, HEAP_W, RUN_HEAD } from './ray-core.js';
export const TREE_TEXELS = 3, TREE_W = 768, BRICK_ROW = 256;

export const GLSL_RAY = `
uniform highp usampler2D uTree;
uniform highp usampler2D uPages;
uniform highp usampler2D uBricks;
uniform int uTop;          // lod of the top chunk
uniform int uD;            // world depth: the world is [0, 2^uD)^3 voxels
uniform int uSteps;        // march budget

int rayHitLod = -1;        // lod of the page the last classify hit, for shading
int raySteps = 0;          // iterations of the last traceRay

uvec4 treeTexel(int node, int k){
  int i = node * ${TREE_TEXELS} + k;
  return texelFetch(uTree, ivec2(i % ${TREE_W}, i / ${TREE_W}), 0);
}
int morton3(ivec3 v){
  int m = 0;
  for (int b = 0; b < 3; b++)
    m |= ((v.x >> b) & 1) << (3*b) | ((v.y >> b) & 1) << (3*b + 1) | ((v.z >> b) & 1) << (3*b + 2);
  return m;
}
uint brickWord(int slot, int w){
  uvec4 t = texelFetch(uBricks, ivec2(4 * (slot % ${BRICK_ROW}) + (w >> 2), slot / ${BRICK_ROW}), 0);
  int c = w & 3;
  return c == 0 ? t.x : c == 1 ? t.y : c == 2 ? t.z : t.w;
}

// The page half of classifyPages (ray-core's pageCell): inside the ray
// page at tree node \`node\` with corner lo, 0 for an occupied cell, else the
// largest empty aligned block: the brick (8 cells), a 4³ (two whole
// Morton words), a 2³ (one Morton byte), or the cell.
int pageCell(int node, ivec3 lo, ivec3 v){
  uvec4 head = treeTexel(node, 0);
  int lod = int(head.y), page = int(head.z);
  ivec3 c = (v - lo) >> lod;
  int slot = int(texelFetch(uPages, ivec2(morton3(c >> 3), page), 0).x);
  if (slot == 0) return 8 << lod;
  int l = morton3(c & 7);
  uint w = brickWord(slot, l >> 5);
  if (((w >> uint(l & 31)) & 1u) == 1u){ rayHitLod = lod; return 0; }
  int q = (l >> 6) * 2;
  if (brickWord(slot, q) == 0u && brickWord(slot, q + 1) == 0u) return 4 << lod;
  if (((w >> uint(l & 24)) & 255u) == 0u) return 2 << lod;
  return 1 << lod;
}

// 0: the voxel is in an occupied cell of a ray page. Otherwise the side of
// an aligned empty block that holds it (classifyPagesCPU, line for line).
// A ray-page leaf is left in rayLeaf*, so traceRay can skip the walk while
// the ray stays in that chunk.
int rayLeafNode = -1, rayLeafSize = 0;
ivec3 rayLeafLo = ivec3(0);
int classifyPages(ivec3 v){
  int node = 0, size = 64 << uTop;
  ivec3 lo = ivec3(0);
  for (int guard = 0; guard < 32; guard++){
    uvec4 head = treeTexel(node, 0);
    int kind = int(head.x);
    if (kind == 0){
      int h = size >> 1, o = 0;
      if (v.x >= lo.x + h){ o |= 1; lo.x += h; }
      if (v.y >= lo.y + h){ o |= 2; lo.y += h; }
      if (v.z >= lo.z + h){ o |= 4; lo.z += h; }
      size = h;
      uvec4 kids = treeTexel(node, 1 + (o >> 2));
      int k = o & 3;
      int c = int(k == 0 ? kids.x : k == 1 ? kids.y : k == 2 ? kids.z : kids.w);
      if (c == 0) return size;
      node = c;
      continue;
    }
    if (kind != 1) return size;
    rayLeafNode = node; rayLeafLo = lo; rayLeafSize = size;
    return pageCell(node, lo, v);
  }
  return 1;
}

/* traceCPU's skip march in float32. tHit: distance to the hit; cell: the
   voxel the ray enters the occupied cell by; axis: the face it came
   through (-1: it started inside). false when it leaves the world or the
   budget runs out (rayTruncated). The march starts at tMin: the ray pass
   passes the near plane's distance along this ray, so it clips exactly
   what the raster pass clips (docs/ray-log.md §5). It stops at tMax, the
   raster's depth along this ray, so a covered pixel only marches up to
   the surface that covers it (traceCPU, docs/ray-depth-plan.md). */
bool rayTruncated = false;
bool traceRay(vec3 o, vec3 d, float tMin, float tMax, out float tHit, out ivec3 cell, out int axis){
  tHit = 0.0; cell = ivec3(0); axis = -1; raySteps = 0; rayTruncated = false; rayLeafNode = -1;
  float S = float(1 << uD);
  int Si = 1 << uD;
  vec3 inv = 1.0 / d;
  vec3 ta = (vec3(0.0) - o) * inv, tb = (vec3(S) - o) * inv;
  vec3 tn = min(ta, tb), tf = max(ta, tb);
  float tEnter = max(max(tn.x, tn.y), tn.z), tExit = min(min(tf.x, tf.y), tf.z);
  float tEnd = min(tExit, tMax);
  float t = max(tEnter, tMin);
  if (t >= tEnd) return false;
  axis = tEnter < tMin ? -1 : (tn.x >= tn.y && tn.x >= tn.z) ? 0 : (tn.y >= tn.z ? 1 : 2);
  ivec3 c;
  for (int a = 0; a < 3; a++){
    float g = o[a] + t * d[a];
    int ci = int(floor(g));
    if (d[a] < 0.0 && g == float(ci)) ci--;
    c[a] = clamp(ci, 0, Si - 1);
  }
  for (int it = 1; it <= 4096; it++){      // not "step": that would hide step()
    if (it > uSteps){ rayTruncated = true; return false; }
    raySteps = it;
    if (any(lessThan(c, ivec3(0))) || any(greaterThanEqual(c, ivec3(Si))) || t >= tEnd) return false;
    int size;
    if (rayLeafNode >= 0 && all(greaterThanEqual(c, rayLeafLo)) && all(lessThan(c, rayLeafLo + rayLeafSize)))
      size = pageCell(rayLeafNode, rayLeafLo, c);
    else { rayLeafNode = -1; size = classifyPages(c); }
    if (size == 0){ tHit = t; cell = c; return true; }
    ivec3 lo = c - c % size;
    vec3 tbd = (vec3(mix(vec3(lo), vec3(lo + size), step(vec3(0.0), d))) - o) * inv;
    float te = min(min(tbd.x, tbd.y), tbd.z);
    axis = tbd.x == te ? 0 : tbd.y == te ? 1 : 2;
    ivec3 next;
    for (int a = 0; a < 3; a++){
      float g = o[a] + te * d[a];
      int ni = int(floor(g));
      if (d[a] < 0.0 && g == float(ni)) ni--;
      next[a] = clamp(ni, lo[a], lo[a] + size - 1);
      if (tbd[a] <= te) next[a] = d[a] > 0.0 ? lo[a] + size : lo[a] - 1;
    }
    c = next; t = te;
  }
  rayTruncated = true;
  return false;
}
`;

export const GLSL_RAY_ATTR = `
uniform highp usampler2D uPageAttr;
uniform highp usampler2D uAttrHeap;
const uint ATTR_NONE = ${ATTR_NONE}u;
uint heapWord(uint i){ return texelFetch(uAttrHeap, ivec2(int(i % ${HEAP_W}u), int(i / ${HEAP_W}u)), 0).x; }
uint popcount32(uint x){
  x -= (x >> 1u) & 0x55555555u;
  x = (x & 0x33333333u) + ((x >> 2u) & 0x33333333u);
  return (((x + (x >> 4u)) & 0x0f0f0f0fu) * 0x01010101u) >> 24u;
}
uint rayAttrAt(int node, ivec3 lo, ivec3 v){
  uvec4 head = treeTexel(node, 0);
  int lod = int(head.y), page = int(head.z);
  ivec3 c = (v - lo) >> lod;
  uint run = texelFetch(uPageAttr, ivec2(morton3(c >> 3), page), 0).x;
  if (run == ATTR_NONE) return ATTR_NONE;
  int l = morton3(c & 7), w = l >> 5;
  uint m = heapWord(run + uint(w));
  if (((m >> uint(l & 31)) & 1u) == 0u) return ATTR_NONE;
  uint rank = popcount32(m & ((1u << uint(l & 31)) - 1u));
  for (int k = 0; k < w; k++) rank += popcount32(heapWord(run + uint(k)));
  return heapWord(run + ${RUN_HEAD}u + rank);
}
// The word the last traceRay hit shows. Its page is still in rayLeaf*: a
// hit always comes from pageCell, reached either way (ray-core's
// hitAttrCPU finds the same page by classifying the cell again).
uint rayHitAttr(ivec3 cell){ return rayLeafNode < 0 ? ATTR_NONE : rayAttrAt(rayLeafNode, rayLeafLo, cell); }
`;
