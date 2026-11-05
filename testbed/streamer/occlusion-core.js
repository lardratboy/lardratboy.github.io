/* occlusion-core.js: which raster chunks the stream viewer can skip because
   something nearer hides them (docs/occlusion.md, path-occupancy.md
   question 5). Pure: no DOM, no gl, no imports. The page owns the GL
   queries and asks this file every decision, so test/occlusion-core.test.js
   can fly it with fake query results and a fake GPU's latency.

   How it works. After the raster pass, the page draws each candidate
   chunk's box, grown by one of its cells, depth-tested against the frame's
   depth with every write off, inside an occlusion query
   (ANY_SAMPLES_PASSED_CONSERVATIVE). No sample passing means the whole box
   lies behind what was drawn, so none of the chunk's cubes could have
   shown. The next frames skip its cubes, and keep querying its box, so the
   chunk comes back once something stops hiding it.

   Why skipping never changes a converged image: a cube inside the grown
   box is at least a cell behind the box's front faces along every ray, so
   wherever the cube would win the depth test, the box's front face would
   pass it first. A chunk whose box passes nowhere has no cube that could
   win a pixel. The page's occlusionProbe holds the rendered image with
   chunks skipped to the one without, byte for byte.

   What it costs in correctness: a result is late. WebGL2 never makes a
   query's result available before the page returns to the event loop
   (the spec says so, to stop sync stalls), so a result describes a past
   frame's depth. A chunk revealed by the eye's move (round a corner, out
   of a tunnel) is skipped until a query issued after the reveal lands:
   with results L frames late, up to 2L − 1 frames (the query already in
   flight when it was revealed lands first, and says hidden). A hole for
   a frame or two, then the chunk. It's the price every query-based
   culler pays (CHC, Bittner et al. 2004), and why `?occlusion=0` turns it
   off.

   The rules, each a test:
     - a chunk with no result for its current entry is drawn. A result
       belongs to the entry it measured: a new job result is a new entry
       (stream-core installs one object a job), and its cubes may differ;
     - a chunk that leaves the candidate list (out of the frustum, out of
       the cover, near the eye, no cubes) loses its result, so it comes
       back drawn. Otherwise a chunk culled for a while would return with
       a "hidden" measured from somewhere else;
     - at most one query per chunk is in flight. Re-querying a pending
       chunk every frame would starve it: with results a frame late, the
       newest query would never be the one that's ready;
     - a pause forgets everything. The tracker counts renders, so if the
       page's frames go on without rendering (streamSelftest's flights,
       which draw only at the end of each phase; the bench converging; a
       ?quiet start), a result from long ago would look like last
       frame's, with the eye somewhere else. begin(tick), with the page's
       frame count, starts empty when a frame was missed. Not time: under
       SwiftShader a frame is a second, and a slow GPU is where culling
       matters most;
     - a hidden chunk is queried again as soon as its last query lands,
       since that's the one whose answer can bring it back. A visible one
       only every `revisit` frames, staggered by arrival, since its answer
       only saves time. With revisit 1 the page queries every candidate
       every frame its query isn't pending. */

export const OCCLUSION = {
  REVISIT: 4,          // frames between queries of a chunk last seen visible
};

/* The eye-near test. The query box is drawn with back faces culled, so
   only its front faces can pass. That's right unless the near plane cuts
   the box: a ray through the cut enters the box behind the near plane,
   and the front face it entered by is clipped away. A box within the
   near plane's corner distance of the eye (the eye at the origin, boxes
   eye-relative) may be cut, so it's always drawn and never queried.
   Outside that ball, every ray from the eye through the screen passes
   the near rectangle before it can reach the box. */
export function nearRadius(near, aspect, tanHalfFov){
  return near * Math.sqrt(1 + tanHalfFov * tanHalfFov * (1 + aspect * aspect));
}
export function nearEye(lo, size, radius){
  let d2 = 0;
  for (let a = 0; a < 3; a++){
    const v = lo[a] > 0 ? lo[a] : lo[a] + size < 0 ? -(lo[a] + size) : 0;
    d2 += v * v;
  }
  return d2 <= radius * radius;
}

/* The tracker. Per frame, the page calls begin(), then consider(key,
   owner) for every candidate in draw order, query(state) for each one it
   then queries, and end(). Results come back through landed(state,
   visible), in any frame after the one that asked; a result for a state
   that's been dropped is ignored. `owner` is whatever identifies the
   chunk's content (the page passes the cache entry object). */
export function createOcclusion({ revisit = OCCLUSION.REVISIT } = {}){
  const S = new Map();
  let frame = 0, seq = 0, last = -Infinity;
  const stats = { frame: 0, candidates: 0, skipped: 0, queried: 0, landed: 0, stale: 0, hidden: 0, pauses: 0 };
  function fresh(key, owner){
    const s = { key, owner, seq: seq++, seen: frame, result: null, landedAt: -1, pending: false, askedAt: -1 };
    S.set(key, s);
    return s;
  }
  return {
    stats,
    get size(){ return S.size; },
    state: key => S.get(key),
    // `tick`: the page's frame count, the same for every render in one
    // frame (the bench's back-to-back views). Leave it out (the probe,
    // which renders without page frames) to never pause.
    begin(tick){
      if (tick !== undefined){
        if (tick - last > 1 && S.size){ S.clear(); stats.pauses++; }
        last = tick;
      }
      frame++;
      stats.frame = frame; stats.candidates = 0; stats.skipped = 0; stats.queried = 0;
    },
    /* A candidate this frame: a raster chunk in the frustum, with cubes,
       not near the eye. Returns { state, draw, query }: draw its cubes or
       skip them, and whether to query its box after the raster pass. */
    consider(key, owner){
      let s = S.get(key);
      if (!s || s.owner !== owner || s.seen < frame - 1) s = fresh(key, owner);
      s.seen = frame;
      stats.candidates++;
      const draw = s.result !== false;
      if (!draw) stats.skipped++;
      // Never two in flight. Unknown or hidden: as soon as the last one
      // lands. Visible: on this chunk's turn, `revisit` frames apart.
      const query = !s.pending && (s.result !== true || (frame + s.seq) % revisit === 0);
      return { state: s, draw, query };
    },
    // The page issued a query for this state this frame.
    query(s){ s.pending = true; s.askedAt = frame; stats.queried++; },
    // A query landed: visible = any sample passed.
    landed(s, visible){
      if (S.get(s.key) !== s){ stats.stale++; return false; }
      s.pending = false; s.result = !!visible; s.landedAt = frame; stats.landed++;
      return true;
    },
    // Drop every chunk that wasn't a candidate this frame.
    end(){
      let hidden = 0;
      for (const [key, s] of S){
        if (s.seen !== frame) S.delete(key);
        else if (s.result === false) hidden++;
      }
      stats.hidden = hidden;
    },
    clear(){ S.clear(); },
  };
}

/* The depth-readback test (docs/occlusion.md §6), the second way to find
   hidden chunks. Your Safari bench of the queries: 147 queries cost 3.1 ms
   of submit time, about 21 µs each, though they took 511K of 554K cubes
   off the GPU. Safari runs WebGL in its GPU process, and every getter is a
   round trip there. So instead the page reduces the frame's depth to its
   farthest value per TILE × TILE pixels on the GPU, reads that small image
   back once (asynchronously, a fence and a pixel-pack buffer), and tests
   every candidate's box against it here: two round trips a frame, however
   many chunks.

   A box is hidden when its nearest point is behind the farthest depth of
   every tile its screen rectangle touches. Every pixel a cube inside the
   box covers lies in that rectangle, and the cube there is at least as far
   as the box's nearest corner (window depth only grows with distance along
   the view axis, so the box's nearest point is a corner), so it's behind
   the depth drawn at that pixel. That's coarser than a query (a tile with
   one gap in the wall lets the whole tile through), and as exact: it never
   calls a box hidden that a query would see.

   `tiles` holds each tile's farthest depth as a 24-bit integer
   (round(z · DEPTH_MAX)), rows from the bottom as GL reads them. The
   encoding rounds, and Metal's depth is float32, not 24 bits, so a tile
   can read up to half a unit nearer than it is: `margin` (2 units) covers
   it. A corner nearer than the near plane, or behind the eye, means the
   box may cross the near plane and its projection is unbounded: visible.
   M is viewProj's column-major matrix; box [x, y, z, side], eye-relative. */
export const DEPTH_MAX = 16777215;
export function hiddenByTiles(M, box, tiles, { w, h, tile, near, margin = 2 }){
  const tw = Math.ceil(w / tile), th = Math.ceil(h / tile);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, zMin = Infinity;
  for (let i = 0; i < 8; i++){
    const x = box[0] + (i & 1 ? box[3] : 0), y = box[1] + (i & 2 ? box[3] : 0), z = box[2] + (i & 4 ? box[3] : 0);
    const cw = M[3] * x + M[7] * y + M[11] * z + M[15];
    if (!(cw > near)) return false;
    const sx = ((M[0] * x + M[4] * y + M[8] * z + M[12]) / cw * 0.5 + 0.5) * w;
    const sy = ((M[1] * x + M[5] * y + M[9] * z + M[13]) / cw * 0.5 + 0.5) * h;
    const sz = (M[2] * x + M[6] * y + M[10] * z + M[14]) / cw * 0.5 + 0.5;
    if (sx < x0) x0 = sx; if (sx > x1) x1 = sx;
    if (sy < y0) y0 = sy; if (sy > y1) y1 = sy;
    if (sz < zMin) zMin = sz;
  }
  const tx0 = Math.max(0, Math.floor(x0 / tile)), tx1 = Math.min(tw - 1, Math.floor(x1 / tile));
  const ty0 = Math.max(0, Math.floor(y0 / tile)), ty1 = Math.min(th - 1, Math.floor(y1 / tile));
  if (tx0 > tx1 || ty0 > ty1) return false;              // off screen: not this test's to say
  const kBox = zMin * DEPTH_MAX;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++)
    if (tiles[ty * tw + tx] + margin >= kBox) return false;
  return true;
}
