/* What a carved knight's inside shows (docs/onelog-plan.md §5, docs/onelog-log.md §4).
     node experiments/knight-inside.mjs [file.vdag ...]   (default worlds/scene/knight-d8.vdag)
   A baked file has a word for each skin voxel only. A voxel with none (the
   inside, which a break shows) takes the mean of the smallest aligned cube
   around it, in the child's own frame, that holds skin, climbing at most 6
   levels (baked-core's climb, onelog-plan Q2's answer A). This prints, for
   every voxel of the shape:
     - how many are skin and how many inside;
     - the side of the cube an inside voxel climbs to;
     - how far it is from the nearest skin voxel (6-connected steps through the shape);
     - how bright the words are, and the means the inside takes: luminance
       (Rec. 709 weights on the words' sRGB bytes, as drawn: the viewer writes a
       word's channels with no conversion), skin with an open face against skin
       with none, and the share of near-black words.
   plan §5's tables came from a throwaway script; this is it, kept. It reads
   the file through vdag-core and asks the field through baked-core, so the
   means are the ones a job draws (`field.mean(0, …)`); the rest is dense
   arithmetic of its own. Dense, so D ≤ 8 (256³ bytes a grid); a D = 10 file
   is refused. Prints only. ~1 s.

   The files are made by
     node experiments/mesh-vdag.mjs test-3d-models/armored-knight-character/source/<id>.glb --D=8,10 --name=knight --out=worlds/scene */
import fs from 'node:fs';
import path from 'node:path';
import { readVdag } from '../vdag-core.js';
import { storeView, createCounts, EMPTY, FULL } from '../dag-core.js';
import { createBaked } from '../baked-core.js';

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['worlds/scene/knight-d8.vdag'];
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const pct = (a, n) => (100 * a / n).toFixed(0) + '%';

for (const file of files){
  if (!fs.existsSync(file)){ console.log(`${file}: not there (see this script's header)`); continue; }
  const { worlds } = await readVdag(fs.readFileSync(file));
  for (const w of worlds){
    if (w.colour?.kind !== 'baked'){ console.log(`${path.basename(file)}: not baked`); continue; }
    if (w.D > 8){ console.log(`${path.basename(file)}: D = ${w.D}, dense up to 8 only`); continue; }
    const store = storeView({ keys: w.keys }), counts = createCounts(store), D = w.D, N = 2 ** D;
    const field = createBaked(store, w.colour.skin, D, w.colour.words, { counts });
    const dense = root => {
      const g = new Uint8Array(N ** 3);
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
    // Skin counts by level, cell by cell: has[l][cell] for l = 1..6.
    const has = [skin];
    for (let l = 1, s = N; l <= Math.min(6, D); l++){
      const h = s >> 1, next = new Uint8Array(h ** 3), prev = has[l - 1];
      for (let z = 0; z < s; z++) for (let y = 0; y < s; y++) for (let x = 0; x < s; x++)
        if (prev[x + s * (y + s * z)]) next[(x >> 1) + h * ((y >> 1) + h * (z >> 1))] = 1;
      has.push(next); s = h;
    }
    // Steps to the nearest skin voxel through the shape: a flood out from the skin.
    const dist = new Int32Array(N ** 3).fill(-1);
    let front = [];
    for (let v = 0; v < N ** 3; v++) if (skin[v]){ dist[v] = 0; front.push(v); }
    for (let d = 1; front.length; d++){
      const next = [];
      for (const v of front){
        const x = v % N, y = Math.floor(v / N) % N, z = Math.floor(v / (N * N));
        for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]){
          const X = x + a, Y = y + b, Z = z + c;
          if (X < 0 || Y < 0 || Z < 0 || X >= N || Y >= N || Z >= N) continue;
          const u = X + N * (Y + N * Z);
          if (shape[u] && dist[u] < 0){ dist[u] = d; next.push(u); }
        }
      }
      front = next;
    }
    const sides = new Array(7).fill(0), far = [0, 0, 0, 0, 0, 0], FAR = [[1, 2], [3, 4], [5, 8], [9, 16], [17, Infinity]];
    const out = new Float64Array(3);
    let nShape = 0, nSkin = 0, nIn = 0, lumSkin = 0, lumIn = 0, nOpen = 0, lumOpen = 0, lumShut = 0, unreached = 0;
    for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
      const v = x + N * (y + N * z);
      if (!shape[v]) continue;
      nShape++;
      if (skin[v]){
        const c = field(x, y, z), L = lum(c & 255, c >> 8 & 255, c >> 16 & 255);
        nSkin++; lumSkin += L;
        const open = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].some(([a, b, cc]) => {
          const X = x + a, Y = y + b, Z = z + cc;
          return X < 0 || Y < 0 || Z < 0 || X >= N || Y >= N || Z >= N || !shape[X + N * (Y + N * Z)];
        });
        if (open){ nOpen++; lumOpen += L; } else lumShut += L;
        continue;
      }
      nIn++;
      field.mean(0, x, y, z, out); lumIn += lum(out[0], out[1], out[2]);
      let l = 1;
      while (l <= 6 && !has[l][(x >> l) + (N >> l) * ((y >> l) + (N >> l) * (z >> l))]) l++;
      sides[Math.min(l, 6)]++;
      const d = dist[v];
      if (d < 0) unreached++; else far[FAR.findIndex(([a, b]) => d >= a && d <= b)]++;
    }
    const words = w.colour.words, mx = c => Math.max(c & 255, c >> 8 & 255, c >> 16 & 255);
    const ch = [0, 8, 16].map(sh => words.reduce((a, c) => a + (c >> sh & 255), 0) / words.length);
    console.log(`\n${path.basename(file)} (D = ${D}, ${w.colour.bits ?? 8} bits a channel)\n`);
    console.log('| | voxels | share |\n| --- | ---: | ---: |');
    console.log(`| the shape | ${nShape.toLocaleString()} | |\n| skin (has its own word) | ${nSkin.toLocaleString()} | ${pct(nSkin, nShape)} |\n| inside (no word) | ${nIn.toLocaleString()} | ${pct(nIn, nShape)} |`);
    console.log('\nThe cube an inside voxel climbs to:\n\n| cube side | 2 | 4 | 8 | 16 | 32 | 64 |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    console.log(`| share of the inside | ${sides.slice(1).map(n => pct(n, nIn)).join(' | ')} |`);
    console.log(`\nSteps to the nearest skin voxel: ${FAR.map(([a, b], i) => `${b === Infinity ? `${a} or more` : `${a}–${b}`}: ${pct(far[i], nIn)}`).join(', ')}${unreached ? `, none reachable: ${pct(unreached, nIn)}` : ''}`);
    console.log(`\nHow bright (luminance of the sRGB bytes, 0–255):\n\n| | voxels | luminance |\n| --- | ---: | ---: |`);
    console.log(`| skin, every word | ${nSkin.toLocaleString()} | ${(lumSkin / nSkin).toFixed(1)} |`);
    console.log(`| skin with an open face | ${nOpen.toLocaleString()} | ${(lumOpen / nOpen).toFixed(1)} |`);
    console.log(`| skin with none (buried) | ${(nSkin - nOpen).toLocaleString()} | ${(lumShut / (nSkin - nOpen)).toFixed(1)} |`);
    console.log(`| inside, its cube's mean | ${nIn.toLocaleString()} | ${(lumIn / nIn).toFixed(1)} |`);
    console.log(`\nThe words' mean: R ${ch[0].toFixed(0)}, G ${ch[1].toFixed(0)}, B ${ch[2].toFixed(0)}. Near black: ${[8, 16, 32].map(t => `every channel under ${t}: ${(100 * words.filter(c => mx(c) < t).length / words.length).toFixed(0)}%`).join(', ')}.`);
  }
}
