/* What 4³ colour bricks would save on our own files (docs/morebricks.md).
     node experiments/morebricks-sketch.mjs file.vdag [file.vdag ...]

   bricks.md (another assistant's C++ prototype) stores a four-byte field in
   4³ bricks over a rectangular extent: a dense x-major directory of one word
   a brick, then a payload a brick in one of five exact modes (constant,
   palette, axis, range, raw), whichever is smallest. On the destroy arena it
   beat the native baked sampler's memory (12.36 MiB against 20.76).

   Our baked colour is a word a skin voxel in rank order (Morton order), plus
   block sums every 64 words (baked-core: 4.375 bytes a word in memory). This
   sketch asks, for each baked world in the files, what the same words cost:

     - today: words raw + block sums, and the words gzipped (what ATTR holds,
       roughly: ATTR stores 6 or 8 bits a channel before gzip);
     - bricks as bricks.md has them: the skin's bounding box (rounded out to
       4, so a brick is a level-2 cell of the DAG), a word a brick of
       directory, a non-skin voxel transparent black (0), the smallest of the
       five modes. Payload sizes are bricks.md's table;
     - rank blocks: the words as baked-core holds them, cut every 64 by rank
       (so the block sums index them already), each block constant, palette,
       range or raw, whichever is smallest, plus a 4-byte offset a block.
       Axis doesn't apply: a rank block isn't a cube. This is densecolor.md
       §8's lever 1 ("pack"), with bricks.md's range and constant modes.

   Words are rgb8; the high byte is ignored as baked-core ignores it, so a
   fourth channel is constant 0 and costs nothing in range mode.
   Exact counts; no timing. A sketch: prints only, nothing imports it. */
import fs from 'node:fs';
import zlib from 'node:zlib';
import { readVdag } from '../vdag-core.js';
import { storeView, EMPTY, FULL } from '../dag-core.js';

const files = process.argv.slice(2);
if (!files.length){ console.log('usage: node experiments/morebricks-sketch.mjs file.vdag ...'); process.exit(0); }

// Skin voxels in Morton order (octant bit 0 x, 1 y, 2 z, as store.child).
function skinMortons(store, root, D){
  const out = [];
  const walk = (id, l, base) => {
    if (id === EMPTY) return;
    if (id === FULL){ const n = 8 ** l; for (let i = 0; i < n; i++) out.push(base + i); return; }
    const step = 8 ** (l - 1);
    for (let o = 0; o < 8; o++) walk(store.child(id, o), l - 1, base + o * step);
  };
  walk(root, D, 0);
  return out;
}
const deMorton = (m, D) => {
  let x = 0, y = 0, z = 0;
  for (let b = 0; b < D; b++){ const t = Math.floor(m / 8 ** b) % 8; x += (t & 1) << b; y += (t >> 1 & 1) << b; z += (t >> 2 & 1) << b; }
  return [x, y, z];
};
const width = v => v ? 32 - Math.clz32(v) : 0;   // bits to hold 0..v

// The smallest mode for n words (n ≤ 64), bricks.md's payload bytes.
// cube: the 64 words of a whole 4³ brick in Morton order, for axis mode.
function encode(ws, cube){
  const n = ws.length;
  const set = new Set(ws);
  const K = set.size;
  if (K === 1) return ['constant', 4];
  let best = ['raw', 4 * n];
  const w = width(K - 1);
  const pal = 4 + 4 * K + Math.ceil(n * w / 8);
  if (K <= 64 && pal < best[1]) best = ['palette', pal];
  if (cube){
    let axisOk = true;
    for (let c = 0; c < 3 && axisOk; c++){
      let any = false;
      for (let a = 0; a < 3 && !any; a++){
        const t = [-1, -1, -1, -1]; let ok = true;
        for (let i = 0; i < 64 && ok; i++){
          const lx = (i & 1) | (i >> 3 & 1) << 1, ly = (i >> 1 & 1) | (i >> 4 & 1) << 1, lz = (i >> 2 & 1) | (i >> 5 & 1) << 1;
          const k = [lx, ly, lz][a], v = ws[i] >> 8 * c & 255;
          if (t[k] < 0) t[k] = v; else if (t[k] !== v) ok = false;
        }
        any = ok;
      }
      axisOk = any;
    }
    if (axisOk && 20 < best[1]) best = ['axis', 20];
  }
  let B = 0;
  for (let c = 0; c < 3; c++){
    let lo = 255, hi = 0;
    for (const x of ws){ const v = x >> 8 * c & 255; if (v < lo) lo = v; if (v > hi) hi = v; }
    B += width(hi - lo);
  }
  const range = 8 + Math.ceil(n * B / 8);
  if (range < best[1]) best = ['range', range];
  return best;
}

const MiB = b => (b / 2 ** 20).toFixed(2);
const tally = () => ({ constant: 0, palette: 0, axis: 0, range: 0, raw: 0 });
const modes = t => Object.entries(t).filter(e => e[1]).map(([k, v]) => `${k} ${v.toLocaleString()}`).join(', ');

console.log('| world | D | skin words | box (voxels) | today in memory | gzip words | bricks.md bricks | rank blocks | bricks ÷ today | blocks ÷ today |');
console.log('|---|---:|---:|---|---:|---:|---:|---:|---:|---:|');
const notes = [];
for (const file of files){
  if (!fs.existsSync(file)){ notes.push(`${file}: not there`); continue; }
  const { worlds } = await readVdag(fs.readFileSync(file));
  for (const w of worlds){
    if (w.colour?.kind !== 'baked') continue;
    const store = storeView({ keys: w.keys }), D = w.D;
    const words = w.colour.words.map(x => x & 0xffffff);
    const ms = skinMortons(store, w.colour.skin, D);
    if (ms.length !== words.length) throw new Error(`${file}: ${ms.length} skin voxels, ${words.length} words`);
    const N = words.length;
    const today = 4 * N + 24 * (Math.floor(N / 64) + 1);
    const gz = zlib.gzipSync(Buffer.from(Uint32Array.from(words).buffer), { level: 9 }).length;

    // bricks.md's bricks over the skin's box, rounded out to multiples of 4.
    const lo = [Infinity, Infinity, Infinity], hi = [-1, -1, -1];
    for (const m of ms){ const p = deMorton(m, D); for (let a = 0; a < 3; a++){ if (p[a] < lo[a]) lo[a] = p[a]; if (p[a] > hi[a]) hi[a] = p[a]; } }
    const nb = [0, 1, 2].map(a => (hi[a] >> 2) - (lo[a] >> 2) + 1);
    const total = nb[0] * nb[1] * nb[2];
    const bt = tally();
    let bricks = 4 * total, occupied = 0;
    for (let i = 0; i < N;){
      const key = Math.floor(ms[i] / 64), cube = new Array(64).fill(0);
      for (; i < N && Math.floor(ms[i] / 64) === key; i++) cube[ms[i] % 64] = words[i];
      const [mode, bytes] = encode(cube, true);
      bt[mode]++; bricks += bytes; occupied++;
    }
    bt.constant += total - occupied; bricks += 4 * (total - occupied);   // all-air bricks

    // Rank blocks of 64.
    const rt = tally();
    let blocks = 24 * (Math.floor(N / 64) + 1);   // the block sums stay
    for (let i = 0; i < N; i += 64){
      const [mode, bytes] = encode(words.slice(i, i + 64), false);
      rt[mode]++; blocks += 4 + bytes;
    }

    const name = `${file.split('/').pop()}${worlds.length > 1 ? ` (${w.name})` : ''}`;
    console.log(`| ${name} | ${D} | ${N.toLocaleString()} | ${nb.map(n => 4 * n).join(' × ')} | ${MiB(today)} | ${MiB(gz)} | ${MiB(bricks)} | ${MiB(blocks)} | ${(bricks / today).toFixed(2)} | ${(blocks / today).toFixed(2)} |`);
    notes.push(`${name}: bricks ${total.toLocaleString()} (${occupied.toLocaleString()} hold skin; ${modes(bt)}); rank blocks ${modes(rt)}`);
  }
}
console.log('\nMiB throughout. "today" is baked-core: 4 bytes a word plus block sums. Rank blocks include the block sums.\n');
for (const n of notes) console.log(`- ${n}`);
