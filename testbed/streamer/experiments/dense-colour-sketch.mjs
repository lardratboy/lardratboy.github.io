/* Dense colour on the D = 8 knight: a word for every voxel, stored three ways
   (docs/densecolor.md §3).
     node experiments/dense-colour-sketch.mjs [file.vdag]   (default worlds/scene/knight-d8.vdag)

   A baked file has a word for each skin voxel only (glb-colour-plan §3, 15%
   of the knight's voxels). "Dense" gives every voxel of the shape one. The
   inside here is the nearest skin voxel's word (onelog-plan §5's answer C):
   a flood out from the skin through the shape, 6-connected, first come.

   For the skin alone and for the dense field, at the file's own words (the
   knight's file is six bits a channel), at a 256-colour palette, and for a
   painted stand-in (the shape in 8 colours by aligned 16³ regions, as snapped
   blocks or voxel art would paint it), it prints:
     - words by rank (today's ATTR): raw, gzipped (level 9), and packed in
       blocks of 64 as memory would hold them (a palette of the block's
       distinct words, then ceil(log2 k) bits a word, a 4-byte offset each);
     - a colour DAG: leaves are colours, air is "don't care" (a node whose
       cared-for voxels are one colour collapses to that colour, labels-log
       §2's masked rule), nodes hash-consed as dag-core's are. Raw is 8
       four-byte refs a node; gzipped is that table, children first;
     - a lossy colour octree (not shared): a node whose voxels all lie within
       t of their mean, per channel in 8-bit units, collapses to the mean.

   Then, from the DAG alone (so the D = 10 file beside it too, if it's
   there), the occupied cells at levels 1–4: what an inside kept at a coarser
   grain than the skin would cost (docs/densecolor.md §7).

   Dense grids, so the tables above take D ≤ 8 (16M cells, ~1.5 GB with the
   octree); ~10 s. A sketch: prints only, nothing imports it.

   The file is made by
     node experiments/mesh-vdag.mjs test-3d-models/armored-knight-character/source/<id>.glb --D=8,10 --name=knight --out=worlds/scene */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { readVdag } from '../vdag-core.js';
import { storeView, EMPTY, FULL } from '../dag-core.js';

const file = process.argv[2] || 'worlds/scene/knight-d8.vdag';
if (!fs.existsSync(file)){ console.log(`${file}: not there (see this script's header)`); process.exit(0); }
const { worlds } = await readVdag(fs.readFileSync(file));
const w = worlds.find(w => w.colour?.kind === 'baked');
if (!w){ console.log(`${file}: no baked world`); process.exit(0); }
if (w.D > 8){ console.log(`${file}: D = ${w.D}, dense up to 8 only`); process.exit(0); }
const store = storeView({ keys: w.keys }), D = w.D, N = 2 ** D, V = N ** 3;

// Morton index → linear index (octant bit 0 x, bit 1 y, bit 2 z, as store.child).
const mort = new Uint32Array(V);
for (let m = 0; m < V; m++){
  let x = 0, y = 0, z = 0;
  for (let b = 0; b < D; b++){ x |= (m >> 3 * b & 1) << b; y |= (m >> 3 * b + 1 & 1) << b; z |= (m >> 3 * b + 2 & 1) << b; }
  mort[m] = x + N * (y + N * z);
}
const dense = root => {
  const g = new Uint8Array(V);
  const walk = (id, l, x, y, z) => {
    if (id === EMPTY) return;
    const s = 2 ** l;
    if (id === FULL){ for (let k = z; k < z + s; k++) for (let j = y; j < y + s; j++) g.fill(1, x + N * (j + N * k), x + s + N * (j + N * k)); return; }
    for (let o = 0; o < 8; o++) walk(store.child(id, o), l - 1, x + (o & 1) * s / 2, y + (o >> 1 & 1) * s / 2, z + (o >> 2) * s / 2);
  };
  walk(root, D, 0, 0, 0);
  return g;
};
const shape = dense(w.root), skin = dense(w.colour.skin);
let nShape = 0, nSkin = 0;
for (let v = 0; v < V; v++){ nShape += shape[v]; nSkin += skin[v]; }

// The skin's words, placed by rank (−1: no word).
const skinCol = new Int32Array(V).fill(-1);
{ let r = 0; for (let m = 0; m < V; m++){ const v = mort[m]; if (skin[v]) skinCol[v] = w.colour.words[r++] & 0xffffff; } }

// The inside: the nearest skin voxel's word, by a flood through the shape.
const nearCol = skinCol.slice();
{
  let front = [];
  for (let v = 0; v < V; v++) if (skin[v]) front.push(v);
  const steps = [1, -1, N, -N, N * N, -N * N];
  while (front.length){
    const next = [];
    for (const v of front){
      const x = v % N, y = Math.floor(v / N) % N, z = Math.floor(v / (N * N));
      for (let k = 0; k < 6; k++){
        const a = k >> 1, sgn = k & 1 ? -1 : 1, c = [x, y, z][a] + sgn;
        if (c < 0 || c >= N) continue;
        const u = v + steps[k];
        if (shape[u] && nearCol[u] < 0){ nearCol[u] = nearCol[v]; next.push(u); }
      }
    }
    front = next;
  }
}

// A 256-colour palette: the most common colours of the dense field, each
// colour mapped to the nearest entry.
const freq = new Map();
for (let v = 0; v < V; v++) if (nearCol[v] >= 0) freq.set(nearCol[v], (freq.get(nearCol[v]) || 0) + 1);
const pal = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256).map(e => e[0]);
const palOf = new Map();
const toPal = c => {
  let r = palOf.get(c);
  if (r !== undefined) return r;
  let best = Infinity;
  for (const p of pal){
    const d = ((p & 255) - (c & 255)) ** 2 + ((p >> 8 & 255) - (c >> 8 & 255)) ** 2 + ((p >> 16 & 255) - (c >> 16 & 255)) ** 2;
    if (d < best){ best = d; r = p; }
  }
  palOf.set(c, r);
  return r;
};
const mapGrid = (g, f) => { const o = new Int32Array(V); for (let v = 0; v < V; v++) o[v] = g[v] < 0 ? -1 : f(g[v]); return o; };

// The painted stand-in: 8 colours by aligned 16³ region.
const PAINT = [0x3050a0, 0xa04030, 0x40a040, 0xd0c060, 0x806040, 0x909090, 0x202020, 0xe0e0e0];
const painted = new Int32Array(V).fill(-1);
for (let v = 0; v < V; v++) if (shape[v]){
  const x = v % N, y = Math.floor(v / N) % N, z = Math.floor(v / (N * N));
  painted[v] = PAINT[((x >> 4) * 7 + (y >> 4) * 3 + (z >> 4)) % 8];
}

const gz = a => zlib.gzipSync(Buffer.from(a.buffer, a.byteOffset, a.byteLength), { level: 9 }).length;
const rankWords = (g, sel) => { const out = []; for (let m = 0; m < V; m++){ const v = mort[m]; if (sel[v]) out.push(g[v]); } return Uint32Array.from(out); };

function blockPacked(words, B = 64){
  let bytes = 0;
  for (let i = 0; i < words.length; i += B){
    const n = Math.min(B, words.length - i), k = new Set(words.subarray(i, i + n)).size;
    bytes += 4 + 3 * k + Math.ceil(n * Math.ceil(Math.log2(Math.max(k, 1))) / 8);
  }
  return bytes;
}

function colourDag(g){
  let cur = new Int32Array(V);
  for (let m = 0; m < V; m++) cur[m] = g[mort[m]];
  const intern = new Map(), table = [], perLevel = [];
  let nodes = 0;
  for (let l = 1; l <= D; l++){
    const next = new Int32Array(cur.length / 8);
    let made = 0;
    for (let i = 0; i < next.length; i++){
      let u = -1, uni = true;
      for (let o = 0; o < 8; o++){
        const c = cur[8 * i + o];
        if (c === -1) continue;
        if (c >= 1 << 24 || (u !== -1 && c !== u)){ uni = false; break; }
        u = c;
      }
      if (uni){ next[i] = u; continue; }
      const key = Array.prototype.join.call(cur.subarray(8 * i, 8 * i + 8), ',');
      let id = intern.get(key);
      if (id === undefined){
        id = (1 << 24) + nodes++; intern.set(key, id); made++;
        for (let o = 0; o < 8; o++) table.push(cur[8 * i + o]);
      }
      next[i] = id;
    }
    perLevel.push(made); cur = next;
  }
  const t = Int32Array.from(table);
  return { nodes, perLevel, raw: t.byteLength, gz: gz(t) };
}

function lossyLeaves(g, t){
  let cur = new Array(V);
  for (let m = 0; m < V; m++){
    const c = g[mort[m]];
    cur[m] = c < 0 ? null : { n: 1, s: [c & 255, c >> 8 & 255, c >> 16 & 255], lo: [c & 255, c >> 8 & 255, c >> 16 & 255], hi: [c & 255, c >> 8 & 255, c >> 16 & 255], leaf: true, leaves: 1 };
  }
  for (let l = 1; l <= D; l++){
    const next = new Array(cur.length / 8);
    for (let i = 0; i < next.length; i++){
      let n = 0, leaves = 0, allLeaf = true;
      const s = [0, 0, 0], lo = [255, 255, 255], hi = [0, 0, 0];
      for (let o = 0; o < 8; o++){
        const c = cur[8 * i + o];
        if (!c) continue;
        n += c.n; leaves += c.leaves; if (!c.leaf) allLeaf = false;
        for (let k = 0; k < 3; k++){ s[k] += c.s[k]; lo[k] = Math.min(lo[k], c.lo[k]); hi[k] = Math.max(hi[k], c.hi[k]); }
      }
      if (!n){ next[i] = null; continue; }
      const ok = allLeaf && [0, 1, 2].every(k => hi[k] - s[k] / n <= t && s[k] / n - lo[k] <= t);
      next[i] = { n, s, lo, hi, leaf: ok, leaves: ok ? 1 : leaves };
    }
    cur = next;
  }
  return cur[0].leaves;
}

const KB = b => (b / 1024).toFixed(0);
console.log(`${file}: D = ${D}, shape ${nShape.toLocaleString()} voxels, skin ${nSkin.toLocaleString()} (the shape is ${(nShape / nSkin).toFixed(2)}× the skin)\n`);
console.log('| field | words | colours | words raw KB | gzip KB | packed KB | B a word, packed | DAG nodes | DAG raw KB | DAG gzip KB | DAG nodes by level, 1 → D |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
const row = (name, g, sel) => {
  const words = rankWords(g, sel), dag = colourDag(g), packed = blockPacked(words);
  console.log(`| ${name} | ${words.length.toLocaleString()} | ${new Set(words).size.toLocaleString()} | ${KB(4 * words.length)} | ${KB(gz(words))} | ${KB(packed)} | ${(packed / words.length).toFixed(2)} | ${dag.nodes.toLocaleString()} | ${KB(dag.raw)} | ${KB(dag.gz)} | ${dag.perLevel.join(' ')} |`);
};
row('skin', skinCol, skin);
row('skin, 256 colours', mapGrid(skinCol, toPal), skin);
row('dense, nearest skin', nearCol, shape);
row('dense, nearest, 256 colours', mapGrid(nearCol, toPal), shape);
row('dense, painted 16³ regions', painted, shape);

console.log('\n| lossy octree, t (8-bit units) | skin leaves | dense leaves |');
console.log('|---:|---:|---:|');
for (const t of [0, 4, 8, 16]) console.log(`| ${t} | ${lossyLeaves(skinCol, t).toLocaleString()} | ${lossyLeaves(nearCol, t).toLocaleString()} |`);

/* The inside at a coarser grain: one word per occupied level-k cell (the
   shape coarsened by the any rule), counted from the DAG, so D = 10 too.
   Beside the skin's words, what "skin at the voxel, inside at 2^k" costs at
   most (a surface cell is counted though the skin covers it). */
console.log('\n| file | D | shape voxels | skin words | occupied cells, level 1 | 2 | 3 | 4 | level giving an inside of D = 8\'s grain |');
console.log('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
for (const f of [file, file.replace('-d8', '-d10')]){
  if (!fs.existsSync(f)) continue;
  const { worlds: ws } = await readVdag(fs.readFileSync(f));
  const b = ws.find(w => w.colour?.kind === 'baked');
  const st = storeView({ keys: b.keys });
  const memo = new Map();
  // cells(id, level)[k]: occupied level-k cells under a node of level `level`.
  const cells = (id, level) => {
    if (id === EMPTY) return null;
    const key = id * 64 + level;
    let r = memo.get(key);
    if (r) return r;
    r = new Float64Array(5);
    if (id === FULL){ for (let k = 0; k < 5 && k <= level; k++) r[k] = 8 ** (level - k); }
    else {
      for (let o = 0; o < 8; o++){ const c = cells(st.child(id, o), level - 1); if (c) for (let k = 0; k < 5; k++) r[k] += c[k]; }
      if (level < 5) r[level] = 1;
    }
    memo.set(key, r);
    return r;
  };
  const c = cells(b.root, b.D), s = cells(b.colour.skin, b.D);
  console.log(`| ${f.split('/').pop()} | ${b.D} | ${c[0].toLocaleString()} | ${s[0].toLocaleString()} | ${c[1].toLocaleString()} | ${c[2].toLocaleString()} | ${c[3].toLocaleString()} | ${c[4].toLocaleString()} | ${b.D - 8} |`);
}
