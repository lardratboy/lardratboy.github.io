/* A sketch for docs/computedags.md: what would compute shaders do for us, and
   what would actors in the world cost? Not an engine change: no core file is
   touched and nothing here is wired to the viewer. It exists so the discussion
   starts from numbers.

   Node sections, all on one thread:
     a. the oracle: every claim below that can be wrong, against dense grids.
     b. what a real chunk job does: reads, cells, records. That's what a GPU would
        have to do, and how much of it is a walk over empty space.
     c. a build as a dispatch: how wide each level is (cells asked, nodes interned,
        nodes kept), the shape of a level-by-level parallel build.
     d. an actor's queries: a point, a box, a swept box. No counts or classes: an
        id other than EMPTY means "something's in here", so a non-empty node lying
        wholly inside the box answers at once.
     e. connectivity through a DAG. realtimecsg.md §7 says connected components
        aren't a function of a node. True of the world's, but a *node's own*
        components and which faces they touch are, and joining two neighbours'
        faces is a function of the pair. So a flood of a world costs one flood per
        unique 16³ node, one join per unique pair of neighbours, and a union-find
        over the places. The oracle holds it to a dense flood.
     f. diggers: actors that edit. Nodes an edit leaves behind, chunks it dirties,
        what `prune` gets back.

   The GPU half is experiments/compute-probe.html, in a real browser. --gpu drives
   it in headless Chrome (real GPU if Chrome will give one; --swiftshader for the
   software adapter, which is the CI question).

   node experiments/compute-sketch.mjs                everything but the GPU (~5 min)
   node experiments/compute-sketch.mjs --only=ad      only those sections
   node experiments/compute-sketch.mjs --gpu          the probe page, Chrome
   It measures job times, so run it on an idle machine. */
import { createStore, createCounts, prune, EMPTY, FULL, FIRST_NODE } from '../dag-core.js';
import { expandChunk, chunkNode, nodeAt } from '../chunk-core.js';
import { createWorld, selectChunks } from '../stream-core.js';
import { SHAPES, fieldOf } from './shapes.mjs';
import { kitDesc, buildKit } from '../kit-core.js';
import { caveDesc, buildCaves } from '../cave-core.js';
import { clayDesc, buildClay } from '../clay-core.js';
import { place } from '../edit-core.js';

const arg = (name, d) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const only = arg('only', 'abcdef');
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : NaN; };
const fmt = (x, d = 2) => Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d }) : '-';
const say = s => console.log(s);
const row = cells => say('| ' + cells.join(' | ') + ' |');

// A little xorshift, so a run's samples are the same every time.
const rng = seed => () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2 ** 32; };

const shape = n => SHAPES.find(s => s.name === n);
function shapeWorld(name, D){
  const store = createStore(), t0 = performance.now(), { root } = store.fromField(D, fieldOf(shape(name), D));
  return { name: `${name} D=${D}`, store, root, D, buildMs: performance.now() - t0 };
}
function kitWorld(D){
  const k = buildKit(kitDesc({ D }));
  return { name: `kit D=${D}`, store: k.store, root: k.root, D };
}
function caveWorld(D, G){
  const c = buildCaves(caveDesc(G ? { D, G } : { D }));
  return { name: `caves D=${D}`, store: c.store, root: c.root, D };
}
const nodesOf = w => w.store.size ?? w.store.snapshot().keys.length / 9;

/* ---- queries an actor makes ------------------------------------------- */

/* Is anything solid in the half-open box? No counts: EMPTY is the only id that
   holds nothing (an empty subtree is never stored), so a non-empty node lying
   wholly inside the box answers yes without going further. */
function boxHits(store, id, k, x, y, z, lo, hi){
  if (id === EMPTY) return false;
  const s = 2 ** k;
  if (x >= hi[0] || y >= hi[1] || z >= hi[2] || x + s <= lo[0] || y + s <= lo[1] || z + s <= lo[2]) return false;
  if (x >= lo[0] && y >= lo[1] && z >= lo[2] && x + s <= hi[0] && y + s <= hi[1] && z + s <= hi[2]) return true;
  const h = s / 2;
  for (let o = 0; o < 8; o++)
    if (boxHits(store, store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h, lo, hi)) return true;
  return false;
}
/* The largest move along +axis or −axis before a box hits something, up to `want`:
   sweep by the slab the move would newly occupy, largest aligned steps left to the
   walk. Plain bisection of the slab is enough for a sketch. */
function sweep(store, root, D, lo, hi, axis, want){
  const sign = Math.sign(want), n = Math.abs(want), a = [...lo], b = [...hi];
  if (sign > 0){ a[axis] = hi[axis]; b[axis] = hi[axis] + n; } else { a[axis] = lo[axis] - n; b[axis] = lo[axis]; }
  if (!boxHits(store, root, D, 0, 0, 0, a, b)) return want;
  let got = 0, top = n;                    // the slab [0, got) is clear, [0, top) isn't
  while (top - got > 1){
    const m = (got + top) >> 1;
    if (sign > 0) b[axis] = hi[axis] + m; else a[axis] = lo[axis] - m;
    if (boxHits(store, root, D, 0, 0, 0, a, b)) top = m; else got = m;
  }
  return sign * got;
}
/* A place near the surface: go down at random through non-empty children, then
   step off by a few voxels. Unweighted, so it visits every part of the graph, not
   every part of the world in proportion. */
export function surfacePoints(store, root, D, n, seed = 12345){
  const r = rng(seed), out = new Int32Array(n * 3), side = 2 ** D, opts = new Uint8Array(8);
  for (let i = 0; i < n; i++){
    let id = root, x = 0, y = 0, z = 0;
    for (let k = D - 1; k >= 0 && id >= FIRST_NODE; k--){
      let m = 0;
      for (let o = 0; o < 8; o++) if (store.child(id, o) !== EMPTY) opts[m++] = o;
      if (!m) break;
      const o = opts[Math.floor(r() * m)];
      id = store.child(id, o);
      x = 2 * x + (o & 1); y = 2 * y + (o >> 1 & 1); z = 2 * z + (o >> 2);
    }
    const j = () => Math.floor(r() * 17) - 8, c = v => Math.max(0, Math.min(side - 1, v));
    out[3 * i] = c(x + j()); out[3 * i + 1] = c(y + j()); out[3 * i + 2] = c(z + j());
  }
  return out;
}

/* ---- connectivity through the DAG ------------------------------------- */
const L = 4, N = 16, NN = N * N, NNN = N * N * N;
function createConnectivity(store){
  const summaries = new Map(), joins = new Map(), occ = new Uint8Array(NNN), lab = new Int16Array(NNN), stack = new Int32Array(NNN);
  const stats = { floodMs: 0, joinMs: 0, joinPairs: 0 };
  const AIR = { comps: 1, faces: null, sizes: [NNN] };
  const fill = (id, k, x, y, z) => {
    if (id === EMPTY) return;
    if (k === 0){ occ[x + N * (y + N * z)] = 1; return; }
    const h = 1 << (k - 1);
    for (let o = 0; o < 8; o++) fill(store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
  };
  /* A node's air: its 6-connected components, and each face's labels. −1 is solid.
     Faces in the mask's order: +x, −x, +y, −y, +z, −z. A function of the node alone,
     so one per unique 16³ however many places hold it. */
  function summary(id){
    if (id === EMPTY) return AIR;
    let s = summaries.get(id);
    if (s) return s;
    const t0 = performance.now();
    occ.fill(0); fill(id, L, 0, 0, 0);
    lab.fill(-1);
    let comps = 0;
    const sizes = [];
    for (let i = 0; i < NNN; i++){
      if (occ[i] || lab[i] >= 0) continue;
      let sp = 0, size = 0; stack[sp++] = i; lab[i] = comps;
      while (sp){
        const c = stack[--sp], x = c & 15, y = c >> 4 & 15, z = c >> 8;
        size++;
        const go = j => { if (!occ[j] && lab[j] < 0){ lab[j] = comps; stack[sp++] = j; } };
        if (x < 15) go(c + 1); if (x > 0) go(c - 1);
        if (y < 15) go(c + N); if (y > 0) go(c - N);
        if (z < 15) go(c + NN); if (z > 0) go(c - NN);
      }
      sizes.push(size);
      comps++;
    }
    const faces = [new Int16Array(NN), new Int16Array(NN), new Int16Array(NN), new Int16Array(NN), new Int16Array(NN), new Int16Array(NN)];
    for (let u = 0; u < N; u++) for (let v = 0; v < N; v++){
      const p = u + N * v;
      faces[0][p] = lab[15 + N * (u + N * v)]; faces[1][p] = lab[0 + N * (u + N * v)];
      faces[2][p] = lab[u + N * (15 + N * v)]; faces[3][p] = lab[u + N * (0 + N * v)];
      faces[4][p] = lab[u + N * (v + N * 15)]; faces[5][p] = lab[u + N * (v + N * 0)];
    }
    s = { comps, faces, sizes };
    summaries.set(id, s);
    stats.floodMs += performance.now() - t0;
    return s;
  }
  /* Which of a's components touch which of b's across a's + side on `axis`: a
     function of the pair, memoized like a BDD apply's table. */
  function join(a, b, axis){
    const key = (a * 2 ** 25 + b) * 3 + axis;
    let j = joins.get(key);
    if (j) return j;
    const sa = summary(a), sb = summary(b), t0 = performance.now(), seen = new Set(), out = [];
    for (let p = 0; p < NN; p++){
      const la = sa.faces ? sa.faces[2 * axis][p] : 0, lb = sb.faces ? sb.faces[2 * axis + 1][p] : 0;
      if (la < 0 || lb < 0) continue;
      const k = la * 65536 + lb;
      if (!seen.has(k)){ seen.add(k); out.push(la, lb); }
    }
    j = Int32Array.from(out);
    joins.set(key, j);
    stats.joinPairs += out.length / 2;
    stats.joinMs += performance.now() - t0;
    return j;
  }
  return { summary, join, summaries, joins, stats };
}
/* The air's components in a whole world by union-find over its places. */
function airComponents(store, root, D, conn = createConnectivity(store)){
  const S = 2 ** (D - L), ids = new Uint32Array(S * S * S);
  const fillIds = (id, k, x, y, z) => {
    if (k === L){ ids[x + S * (y + S * z)] = id; return; }
    if (id === EMPTY) return;                       // already 0
    const h = 1 << (k - L - 1);
    for (let o = 0; o < 8; o++) fillIds(store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
  };
  const t0 = performance.now();
  fillIds(root, D, 0, 0, 0);
  const offset = new Uint32Array(S * S * S + 1);
  for (let i = 0; i < ids.length; i++) offset[i + 1] = offset[i] + conn.summary(ids[i]).comps;
  const parent = new Uint32Array(offset[ids.length]);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = i => { while (parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const steps = [1, S, S * S];
  let places = 0;
  for (let z = 0, i = 0; z < S; z++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++, i++){
    const c = [x, y, z];
    for (let axis = 0; axis < 3; axis++){
      if (c[axis] === S - 1) continue;
      const j = i + steps[axis], a = ids[i], b = ids[j];
      places++;
      const pairs = conn.join(a, b, axis);
      for (let p = 0; p < pairs.length; p += 2){
        const u = find(offset[i] + pairs[p]), v = find(offset[j] + pairs[p + 1]);
        if (u !== v) parent[u] = v;
      }
    }
  }
  // Voxels per component: is the air one space with pockets, or many spaces?
  const voxels = new Float64Array(parent.length);
  let air = 0;
  for (let i = 0; i < ids.length; i++){
    const { sizes } = conn.summary(ids[i]);
    for (let c = 0; c < sizes.length; c++){ voxels[find(offset[i] + c)] += sizes[c]; air += sizes[c]; }
  }
  let comps = 0, largest = 0, one = 0;
  for (let i = 0; i < parent.length; i++) if (find(i) === i){ comps++; if (voxels[i] > largest) largest = voxels[i]; if (voxels[i] === 1) one++; }
  return { comps, ms: performance.now() - t0, labels: parent.length, places, largest, air, one };
}
function denseAir(occ, R){
  const lab = new Int32Array(R * R * R).fill(-1), stack = [];
  let comps = 0;
  for (let i = 0; i < occ.length; i++){
    if (occ[i] || lab[i] >= 0) continue;
    stack.push(i); lab[i] = comps;
    while (stack.length){
      const c = stack.pop(), x = c % R, y = Math.floor(c / R) % R, z = Math.floor(c / (R * R));
      const go = j => { if (!occ[j] && lab[j] < 0){ lab[j] = comps; stack.push(j); } };
      if (x < R - 1) go(c + 1); if (x > 0) go(c - 1);
      if (y < R - 1) go(c + R); if (y > 0) go(c - R);
      if (z < R - 1) go(c + R * R); if (z > 0) go(c - R * R);
    }
    comps++;
  }
  const sizes = new Float64Array(comps);
  for (let i = 0; i < lab.length; i++) if (lab[i] >= 0) sizes[lab[i]]++;
  return { comps, largest: sizes.reduce((a, b) => Math.max(a, b), 0) };
}

/* ---- a: the oracle ---------------------------------------------------- */
if (only.includes('a')){
  say('\n## a. The oracle (D = 8, every claim against dense)\n');
  const worlds = [shapeWorld('hills', 8), shapeWorld('gyroid', 8), kitWorld(8), caveWorld(8, 48)];
  for (const w of worlds){
    const R = 2 ** w.D, occ = w.store.expand(w.root, w.D), r = rng(99);
    // boxHits against the dense grid, at boxes of every shape.
    for (let t = 0; t < 4000; t++){
      const lo = [0, 1, 2].map(() => Math.floor(r() * R)), hi = lo.map(v => Math.min(R, v + 1 + Math.floor(r() * (t % 3 ? 8 : 64))));
      let want = false;
      for (let z = lo[2]; z < hi[2] && !want; z++) for (let y = lo[1]; y < hi[1] && !want; y++) for (let x = lo[0]; x < hi[0]; x++)
        if (occ[x + R * (y + R * z)]){ want = true; break; }
      if (boxHits(w.store, w.root, w.D, 0, 0, 0, lo, hi) !== want) throw new Error(`boxHits wrong on ${w.name} at ${lo} ${hi}`);
    }
    // sweep: the slab it clears is clear, and one more voxel isn't.
    for (let t = 0; t < 800; t++){
      const lo = [0, 1, 2].map(() => 32 + Math.floor(r() * (R - 64))), hi = lo.map((v, i) => v + 1 + (i === 1 ? 1 : 0));
      if (boxHits(w.store, w.root, w.D, 0, 0, 0, lo, hi)) continue;
      const axis = t % 3, want = (t & 1 ? 1 : -1) * (1 + Math.floor(r() * 24)), got = sweep(w.store, w.root, w.D, lo, hi, axis, want);
      const a = [...lo], b = [...hi];
      if (got > 0) { a[axis] = hi[axis]; b[axis] = hi[axis] + got; } else if (got < 0) { a[axis] = lo[axis] + got; b[axis] = lo[axis]; }
      if (got && boxHits(w.store, w.root, w.D, 0, 0, 0, a, b)) throw new Error(`sweep on ${w.name}: not clear`);
      if (Math.abs(got) < Math.abs(want)){
        const a2 = [...lo], b2 = [...hi], m = Math.abs(got) + 1;
        if (want > 0){ a2[axis] = hi[axis] + m - 1; b2[axis] = hi[axis] + m; } else { a2[axis] = lo[axis] - m; b2[axis] = lo[axis] - m + 1; }
        if (!boxHits(w.store, w.root, w.D, 0, 0, 0, a2, b2)) throw new Error(`sweep on ${w.name}: stopped short`);
      }
    }
    const dense = denseAir(occ, R), viaDag = airComponents(w.store, w.root, w.D);
    if (dense.comps !== viaDag.comps || dense.largest !== viaDag.largest) throw new Error(`airComponents on ${w.name}: ${viaDag.comps} / ${viaDag.largest}, dense flood ${dense.comps} / ${dense.largest}`);
    say(`- ${w.name}: boxHits and sweep agree; air components ${viaDag.comps}, largest ${viaDag.largest} voxels = the dense flood's`);
  }
}

/* ---- b: what a real job does ------------------------------------------ */
if (only.includes('b')){
  say('\n## b. A real job: the cut at rest, one job per sampled leaf\n');
  row(['world', 'nodes', 'leaves', 'lods', 'job ms med / p95', 'child reads', 'occupied', 'records', 'reads / record', 'bricks: non-empty / distinct nodes']);
  row(Array(10).fill('---'));
  const views = [
    [shapeWorld('hills', 12), [0.5, 0.75, 0.5]], [shapeWorld('gyroid', 11), [0.5, 0.5, 0.5]],
    [kitWorld(14), [0.02, 0.12, 0.02]], [kitWorld(16), [0.02, 0.12, 0.02]], [caveWorld(12), [0.5, 0.42, 0.5]],
  ];
  for (const [w, e] of views){
    const world = createWorld(w.store, w.root, w.D), eye = e.map(v => v * world.side);
    const sel = selectChunks(world, eye, { detail: 2 }), counts = createCounts(w.store);
    const leaves = sel.leaves.filter(c => c.id !== EMPTY), step = Math.max(1, Math.floor(leaves.length / 64));
    const ms = [], reads = [], occ = [], recs = [], bricks = [], distinct = [];
    let n = 0;
    const counted = { child: (id, o) => { n++; return w.store.child(id, o); }, levelOf: w.store.levelOf };
    for (let i = 0; i < leaves.length; i += step){
      const c = leaves[i], chunk = { lod: c.lod, cx: c.x, cy: c.y, cz: c.z }, opts = { counts, lodRule: c.lod ? 'adaptive' : 'any', seams: true };
      const t0 = performance.now(), out = expandChunk(w.store, w.root, w.D, chunk, opts);
      ms.push(performance.now() - t0);
      n = 0; expandChunk(counted, w.root, w.D, chunk, opts); reads.push(n);
      occ.push(out.occupied); recs.push(out.records.length);
      // The 8³ bricks under this chunk, and how many different nodes they are.
      const seen = new Set(); let nb = 0;
      const walkB = (id, k) => {
        if (id === EMPTY) return;
        if (k === c.lod + 3){ nb++; seen.add(id); return; }
        for (let o = 0; o < 8; o++) walkB(w.store.child(id, o), k - 1);
      };
      const start = chunkNode(w.store, w.root, w.D, c.lod, c.x, c.y, c.z);
      walkB(start.id, start.level);
      bricks.push(nb); distinct.push(seen.size);
    }
    const lods = leaves.map(c => c.lod), p95 = [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)];
    row([w.name, fmt(nodesOf(w), 0), leaves.length, `${Math.min(...lods)}–${Math.max(...lods)}`, `${fmt(median(ms), 1)} / ${fmt(p95, 1)}`,
         fmt(median(reads), 0), fmt(median(occ), 0), fmt(median(recs), 0), fmt(median(reads) / Math.max(1, median(recs)), 1), `${fmt(median(bricks), 0)} / ${fmt(median(distinct), 0)}`]);
  }
}

/* ---- c: a build as a dispatch ----------------------------------------- */
if (only.includes('c')){
  say('\n## c. A build, level by level: what each dispatch would hold\n');
  for (const [name, D] of [['hills', 12], ['gyroid', 11], ['terrain', 12]]){
    const store = createStore(), asked = new Float64Array(D + 1), open = new Float64Array(D + 1), f = fieldOf(shape(name), D);
    const t0 = performance.now();
    const { root } = store.fromField(D, (k, x, y, z) => { const v = f(k, x, y, z); asked[k]++; if (v < 0) open[k]++; return v; });
    const ms = performance.now() - t0, kept = new Float64Array(D + 1), { keys } = store.snapshot();
    for (let p = 0; p < keys.length; p += 9) kept[keys[p]]++;
    say(`\n${name} D=${D}: ${fmt(keys.length / 9, 0)} nodes, ${fmt(ms, 0)} ms on one thread`);
    row(['level', 'cells asked', 'undecided (would intern)', 'nodes kept', 'kept / interned']); row(Array(5).fill('---'));
    for (let k = D; k >= 1; k--) row([k, fmt(asked[k], 0), fmt(open[k], 0), fmt(kept[k], 0), fmt(kept[k] / Math.max(1, open[k]), 3)]);
    if (!root) throw new Error('empty');
  }
}

/* ---- d: an actor's queries -------------------------------------------- */
if (only.includes('d')){
  say('\n## d. An actor\'s queries, one thread\n');
  row(['world', 'nodes', 'MB', 'point ns', 'box 1×2×1 ns', 'box 16×32×16 ns', 'box 256×512×256 ns', 'sweep 8 ns', 'hit share (1×2×1)']);
  row(Array(9).fill('---'));
  const clay = clayDesc(), cw = buildClay(clay);
  const worlds = [shapeWorld('hills', 12), kitWorld(14), kitWorld(16), caveWorld(12), { name: 'clay D=20', store: cw.store, root: cw.root, D: 20 }];
  for (const w of worlds){
    const M = 200000, pts = surfacePoints(w.store, w.root, w.D, M), { store, root, D } = w, side = 2 ** D;
    const time = (fn, n = M) => { const t0 = performance.now(); let hits = 0; for (let i = 0; i < n; i++) hits += fn(i) ? 1 : 0; return { ns: (performance.now() - t0) / n * 1e6, hits }; };
    const pt = time(i => store.query(root, D, pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]));
    const box = (sx, sy, sz) => time(i => {
      const lo = [pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]], hi = [Math.min(side, lo[0] + sx), Math.min(side, lo[1] + sy), Math.min(side, lo[2] + sz)];
      return boxHits(store, root, D, 0, 0, 0, lo, hi);
    }, M >> 1);
    const b1 = box(1, 2, 1), b2 = box(16, 32, 16), b3 = box(256, 512, 256);
    const sw = time(i => {
      const lo = [pts[3 * i], Math.min(side - 16, pts[3 * i + 1] + 4), pts[3 * i + 2]], hi = [lo[0] + 1, lo[1] + 2, lo[2] + 1];
      return sweep(store, root, D, lo, hi, 1, -8) !== -8;
    }, M >> 1);
    row([w.name, fmt(nodesOf(w), 0), fmt(nodesOf(w) * 36 / 2 ** 20, 1), fmt(pt.ns, 0), fmt(b1.ns, 0), fmt(b2.ns, 0), fmt(b3.ns, 0), fmt(sw.ns, 0), fmt(b1.hits / (M >> 1), 2)]);
  }
}

/* ---- e: connectivity -------------------------------------------------- */
if (only.includes('e')){
  say('\n## e. The air\'s components through the DAG (L = 4, 16³ summaries)\n');
  row(['world', 'nodes', 'places (16³)', 'unique 16³', 'flood ms total', 'components: mean / max', 'pairs asked', 'unique pairs', 'join ms', 'whole world ms', 'air components', 'largest, % of air', 'summaries MB']);
  row(Array(13).fill('---'));
  for (const w of [shapeWorld('hills', 10), shapeWorld('gyroid', 10), kitWorld(10), kitWorld(12), shapeWorld('hills', 12), shapeWorld('gyroid', 11), caveWorld(10), caveWorld(12)]){
    const conn = createConnectivity(w.store), r = airComponents(w.store, w.root, w.D, conn);
    const comps = [...conn.summaries.values()].map(s => s.comps), mean = comps.reduce((a, b) => a + b, 0) / Math.max(1, comps.length);
    const bytes = conn.summaries.size * 6 * 256 * 2 + conn.stats.joinPairs * 8;
    row([w.name, fmt(nodesOf(w), 0), fmt(2 ** (3 * (w.D - L)), 0), fmt(conn.summaries.size, 0), fmt(conn.stats.floodMs, 0), `${fmt(mean, 1)} / ${comps.reduce((a, b) => Math.max(a, b), 0)}`,
         fmt(r.places, 0), fmt(conn.joins.size, 0), fmt(conn.stats.joinMs, 0), fmt(r.ms, 0), fmt(r.comps, 0), fmt(100 * r.largest / r.air, 2), fmt(bytes / 2 ** 20, 0)]);
  }
}

/* ---- f: diggers ------------------------------------------------------- */
if (only.includes('f')){
  say('\n## f. Diggers: actors that break one voxel at a time, on flat ground at D = 20\n');
  row(['actors', 'spread', 'edits', 'µs / edit', 'new nodes / edit', 'bytes / edit', 'chunks dirtied per 100 ms tick', 'nodes after', 'prune ms', 'kept by prune']);
  row(Array(10).fill('---'));
  for (const [actors, spread] of [[1, 'one'], [100, 'cluster'], [100, 'scattered'], [1000, 'cluster'], [1000, 'scattered']]){
    const desc = clayDesc({ lump: 0, ground: true }), built = buildClay(desc), { store, D } = built;
    let root = built.root;
    const side = 2 ** D, base = side / 2 - 1, r = rng(7), range = spread === 'scattered' ? 1 << 14 : 512;
    const pos = Array.from({ length: actors }, () => [side / 2 + Math.floor(r() * range), base, side / 2 + Math.floor(r() * range)]);
    const before = store.snapshot().keys.length / 9, ticks = 20;
    let edits = 0, ms = 0, dirty = 0;
    for (let t = 0; t < ticks; t++){
      const chunks = new Set(), t0 = performance.now();
      for (const p of pos){
        // A walk of one voxel, then the voxel under its feet goes.
        p[0] += Math.floor(r() * 3) - 1; p[2] += Math.floor(r() * 3) - 1;
        root = place(store, root, D, 0, p[0], p[1], p[2], EMPTY);
        edits++;
        const cx = p[0] >> 6, cy = p[1] >> 6, cz = p[2] >> 6;
        chunks.add(cx * 2 ** 28 + cy * 2 ** 14 + cz);
      }
      ms += performance.now() - t0; dirty += chunks.size;
    }
    const { keys } = store.snapshot(), after = keys.length / 9, t1 = performance.now(), pruned = prune(keys, [root]), pruneMs = performance.now() - t1;
    const kept = (pruned.keys ?? pruned).length / 9, nn = (after - before) / edits;
    row([actors, spread, fmt(edits, 0), fmt(ms / edits * 1000, 1), fmt(nn, 1), fmt(nn * 36, 0), fmt(dirty / ticks, 0), fmt(after, 0), fmt(pruneMs, 1), fmt(kept, 0)]);
  }
}

/* ---- the GPU half: experiments/compute-probe.html in Chrome ----------- */
if (process.argv.includes('--gpu')){
  const { findChrome, serveStatic, launchChrome } = await import('../test/browser/harness.js');
  const chrome = findChrome();
  if (!chrome) throw new Error('no Chrome (TESTBED_CHROME=/path)');
  const soft = process.argv.includes('--swiftshader');
  const flags = soft
    // On macOS the adapter needs ANGLE on SwiftShader and --use-gpu-in-tests: without
    // them the first mapAsync aborts ("a valid external Instance reference no longer
    // exists"), and with --disable-gpu there's no adapter at all.
    ? ['--headless=new', '--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gpu-in-tests', '--disable-gpu-watchdog']
    : ['--headless=new', '--enable-unsafe-webgpu'];
  const server = await serveStatic(), browser = await launchChrome(chrome, flags), s = browser.session;
  await s.send('Page.navigate', { url: `${server.origin}/experiments/${arg('page', 'compute-probe.html')}` });
  await s.waitFor(`typeof computeProbe === 'function'`, { timeout: 30000, label: 'the probe page' });
  const out = await s.evaluate(`computeProbe({ quick: ${process.argv.includes('--quick') || soft} }).then(r => JSON.stringify(r))`);
  console.log(JSON.stringify(JSON.parse(out), null, 1));
  await browser.close(); await server.close();
}
