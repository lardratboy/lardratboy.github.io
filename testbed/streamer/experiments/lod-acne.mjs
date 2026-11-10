/* Lod acne: the see-through holes a coarse lod opens in content that is
   opaque at lod 0 (docs/lodacne.md).

     node experiments/lod-acne.mjs                 # ~2 min the first time (builds), ~1 min after
     node experiments/lod-acne.mjs --print         # prints only
     node experiments/lod-acne.mjs --quick         # D = 8, prints only
     node experiments/lod-acne.mjs a.vdag b.vdag   # any world files, prints only

   Regenerates docs/lodacne-results.md and docs/data/lodacne.json. The
   readings are in docs/lodacne.md.

   The worlds are built here, from the assets' glTF files, by mesh-vdag.mjs
   (a child process, with its own checks), into worlds/lod-acne/ (gitignored)
   and kept there, so a second run reads them. Nothing in test-3d-models/ is
   written or read but the .glb: your own files there may be built either
   way, and the table needs one of each.
     barbarian, hollow   --hollow: the shape is the skin, one voxel thick
     barbarian, solid    the same asset as mesh-vdag builds it by default
     knight              closed and solid: the control
   An asset that isn't on disk is skipped with a note (test-3d-models/ is
   gitignored, and the assets aren't ours to publish).

   The measure. For each axis, a coarse column at lod l is the 2^l × 2^l fine
   columns under one coarse cell's footprint, through the whole world. It is
   *opaque* if every fine column hits a voxel, and a *hole* if it is opaque
   and no kept coarse cell lies in it: lod 0 shows a wall there and the lod
   shows the background, along that axis. Kept cells are the job's own
   choice: expandChunk with { counts, lodRule, cells: true } at one uniform
   lod, buried cells included (a buried cell still blocks the column).
   *Dents* are the softer measure: from each of the six sides, a coarse
   column whose first kept cell lies two cells or more behind *any*'s (or
   that has none where *any* has one). On a solid that's erosion, rock
   behind rock; on a hollow shell it's the inside of the far wall.

   Oblique views aren't measured: a hole a ray at an angle finds but no axis
   does. docs/lodacne.md §6 A needs that before it can claim more than axes.

   Checks, which stop the run if they fail:
     - *any* keeps a cell in a coarse column exactly when some fine column
       under it hits a voxel, at every lod, on every axis (so its holes are 0
       by construction, and the fine projection and the job agree);
     - at D ≤ 8, the fine projection (a DAG walk with a FULL shortcut) equals
       the projection of expandChunk's lod-0 cells. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCounts, storeView, EMPTY, FULL } from '../dag-core.js';
import { expandChunk, CHUNK_LEVELS } from '../chunk-core.js';
import { readVdag } from '../vdag-core.js';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.dirname(HERE);
const args = process.argv.slice(2), files = args.filter(a => !a.startsWith('--'));
const QUICK = args.includes('--quick'), PRINT = args.includes('--print') || QUICK || files.length > 0;
const D = QUICK ? 8 : 10;
const RULES = ['any', 'adaptive', 'shadow', 'opacity', 'volume'];   // any first: it is the dents' reference
const LODS = [1, 2, 3, 4];
const OUT = path.join(ROOT, 'worlds', 'lod-acne');

const ASSETS = [
  { key: 'barbarian-hollow', label: 'barbarian, hollow', glb: 'test-3d-models/convert/stylized_barbarian.glb', flags: ['--hollow'] },
  { key: 'barbarian-solid',  label: 'barbarian, solid',  glb: 'test-3d-models/convert/stylized_barbarian.glb', flags: [] },
  { key: 'knight',           label: 'knight (closed)',   glb: 'test-3d-models/armored-knight-character/source/76c262b4-d37c-4d7e-86a5-3a4ac6a172ef.glb', flags: [] },
];

const fmt = (x, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (a, b) => b ? `${(100 * a / b).toFixed(2)}%` : '–';

// A world file for an asset, built once into worlds/lod-acne/.
function worldFile(a){
  const file = path.join(OUT, `lod-acne-${a.key}-d${D}.vdag`);
  if (fs.existsSync(file)) return file;
  const glb = path.join(ROOT, a.glb);
  if (!fs.existsSync(glb)) return null;
  fs.mkdirSync(OUT, { recursive: true });
  console.error(`building ${a.label} at D = ${D} (mesh-vdag.mjs) …`);
  execFileSync(process.execPath, [path.join(HERE, 'mesh-vdag.mjs'), glb, `--D=${D}`, `--out=${OUT}`, `--name=lod-acne-${a.key}`, '--PNG=0', ...a.flags],
               { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] });
  return file;
}

// Lod 0's projection along each axis: axis a drops coordinate a, so
// P[0] is indexed (y, z), P[1] (x, z), P[2] (x, y).
function fineProjections(store, root, D){
  const N = 1 << D, P = [new Uint8Array(N * N), new Uint8Array(N * N), new Uint8Array(N * N)];
  const mark = (x, y, z, s) => {
    for (let i = 0; i < s; i++) for (let j = 0; j < s; j++){
      P[0][(y + i) * N + (z + j)] = 1; P[1][(x + i) * N + (z + j)] = 1; P[2][(x + i) * N + (y + j)] = 1;
    }
  };
  const walk = (id, k, x, y, z) => {
    if (id === EMPTY) return;
    const s = 1 << k;
    if (id === FULL || k === 0){ mark(x, y, z, s); return; }
    const h = s >> 1;
    for (let o = 0; o < 8; o++) walk(store.child(id, o), k - 1, x + (o & 1) * h, y + (o >> 1 & 1) * h, z + (o >> 2) * h);
  };
  walk(root, D, 0, 0, 0);
  return P;
}

// The coarse projections (C), and the first and last kept cell per column
// from each side (lo, hi), at side M, for one lod and rule. Chunk by chunk,
// so a lod-1 knight's 12M cells never sit in one array.
function coarseMaps(store, root, D, lod, rule, counts){
  const M = 1 << (D - lod), side = Math.max(1, M >> CHUNK_LEVELS);
  const C = [0, 1, 2].map(() => new Uint8Array(M * M));
  const lo = [0, 1, 2].map(() => new Int32Array(M * M).fill(M)), hi = [0, 1, 2].map(() => new Int32Array(M * M).fill(-1));
  let kept = 0;
  const put = (a, k, d) => { C[a][k] = 1; if (d < lo[a][k]) lo[a][k] = d; if (d > hi[a][k]) hi[a][k] = d; };
  for (let cz = 0; cz < side; cz++) for (let cy = 0; cy < side; cy++) for (let cx = 0; cx < side; cx++){
    const c = expandChunk(store, root, D, { lod, cx, cy, cz }, { lodRule: rule, counts, cells: true });
    for (const p of c.cells){
      const x = cx * 64 + (p & 255), y = cy * 64 + (p >> 8 & 255), z = cz * 64 + (p >> 16);
      put(0, y * M + z, x); put(1, x * M + z, y); put(2, x * M + y, z);
    }
    kept += c.cells.length;
  }
  return { C, lo, hi, kept };
}

async function measure(file, label){
  const t0 = performance.now();
  const { worlds: [w] } = await readVdag(fs.readFileSync(file));
  const store = storeView({ keys: w.keys }), counts = createCounts(store);
  const root = w.root, Dw = w.D, N = 1 << Dw;
  const hollow = !!(w.colour && w.colour.skin === root);
  const fine = fineProjections(store, root, Dw);
  if (Dw <= 8){
    const P = coarseMaps(store, root, Dw, 0, 'any', counts).C;
    for (let a = 0; a < 3; a++) for (let i = 0; i < N * N; i++)
      if (P[a][i] !== fine[a][i]) throw new Error(`${label}: lod 0's cells and the DAG walk disagree on axis ${a}, column ${i}`);
  }
  const rows = [];
  for (const lod of LODS){
    if (lod >= Dw) continue;
    const M = N >> lod, full = 1 << 2 * lod;
    const cover = [0, 1, 2].map(a => {
      const c = new Uint32Array(M * M), F = fine[a];
      for (let u = 0; u < N; u++) for (let v = 0; v < N; v++) if (F[u * N + v]) c[(u >> lod) * M + (v >> lod)]++;
      return c;
    });
    let ref = null;
    for (const rule of RULES){
      const m = coarseMaps(store, root, Dw, lod, rule, counts);
      if (rule === 'any'){
        ref = m;
        for (let a = 0; a < 3; a++) for (let i = 0; i < M * M; i++)
          if (m.C[a][i] !== (cover[a][i] > 0 ? 1 : 0)) throw new Error(`${label}: lod ${lod}, any's projection isn't the fine one's (axis ${a}, column ${i})`);
      }
      let opaque = 0, holes = 0, seen = 0, dents = 0;
      for (let a = 0; a < 3; a++) for (let i = 0; i < M * M; i++){
        if (cover[a][i] === full){ opaque++; if (!m.C[a][i]) holes++; }
        if (ref.hi[a][i] < 0) continue;
        seen += 2;
        if (m.hi[a][i] < 0){ dents += 2; continue; }
        if (m.lo[a][i] - ref.lo[a][i] >= 2) dents++;
        if (ref.hi[a][i] - m.hi[a][i] >= 2) dents++;
      }
      rows.push({ lod, rule, opaque, holes, dents, seen, kept: m.kept });
    }
  }
  return { label, file: path.relative(ROOT, file), D: Dw, voxels: counts.of(root), hollow, bytes: fs.statSync(file).size,
           seconds: +((performance.now() - t0) / 1000).toFixed(1), rows };
}

const worlds = [];
if (files.length) for (const f of files) worlds.push(await measure(path.resolve(f), path.basename(f)));
else for (const a of ASSETS){
  const f = worldFile(a);
  if (!f){ console.error(`skipped ${a.label}: ${a.glb} isn't on disk`); continue; }
  worlds.push(await measure(f, a.label));
}

// ---- the report ----
const L = [];
const say = s => L.push(s);
say('# Lod acne: results');
say('');
say(`Generated by \`node experiments/lod-acne.mjs\`${PRINT ? ' (printed, not written)' : ''}. Don't edit: the readings are in [lodacne.md](lodacne.md).`);
say('');
say('A **hole** is an opaque coarse column (every fine column under it hits a voxel) with no kept cell in it, so the background shows through along that axis; the three axes are pooled. A **dent** is a column whose first kept cell, from one of the six sides, is two cells or more behind *any*\'s. *Kept cells* include buried ones.');
say('');
say('## The worlds');
say('');
say('| world | D | voxels | shape | file | file bytes | s |');
say('|---|---:|---:|---|---|---:|---:|');
for (const w of worlds) say(`| ${w.label} | ${w.D} | ${fmt(w.voxels)} | ${w.hollow ? 'hollow (the shape is the skin)' : 'solid'} | \`${w.file}\` | ${fmt(w.bytes)} | ${w.seconds} |`);
say('');
say('## Holes, and kept cells against *any*\'s, under *adaptive* and *shadow*');
say('');
say('*adaptive* was the viewer\'s rule for lod ≥ 1 until 2026-11-09. *shadow* is *adaptive* plus the best cell of every column of each brick along x, y and z (docs/lodacne.md §6 A).');
say('');
say(`| lod | rule | ${worlds.map(w => `${w.label}: holes`).join(' | ')} | ${worlds.map(w => `${w.label}: cells`).join(' | ')} |`);
say(`|---:|---|${worlds.map(() => '---:').join('|')}|${worlds.map(() => '---:').join('|')}|`);
for (const lod of LODS) for (const rule of ['adaptive', 'shadow']){
  const row = w => w.rows.find(r => r.lod === lod && r.rule === rule), any = w => w.rows.find(r => r.lod === lod && r.rule === 'any');
  const holes = worlds.map(w => row(w) ? pct(row(w).holes, row(w).opaque) : '–');
  const cells = worlds.map(w => row(w) ? (row(w).kept / any(w).kept).toFixed(2) : '–');
  say(`| ${lod} | ${rule} | ${holes.join(' | ')} | ${cells.join(' | ')} |`);
}
say('');
say('*any* has no holes in any world at any lod (checked as the run goes: its projection is the fine one\'s).');
for (const w of worlds){
  say('');
  say(`## ${w.label}`);
  say('');
  say('| lod | rule | opaque columns | holes | of opaque | dents | of seen | kept cells | of *any*\'s |');
  say('|---:|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of w.rows){
    const any = w.rows.find(q => q.lod === r.lod && q.rule === 'any');
    say(`| ${r.lod} | ${r.rule} | ${fmt(r.opaque)} | ${fmt(r.holes)} | ${pct(r.holes, r.opaque)} | ${fmt(r.dents)} | ${pct(r.dents, r.seen)} | ${fmt(r.kept)} | ${(r.kept / any.kept).toFixed(2)} |`);
  }
}
const text = L.join('\n') + '\n';
if (PRINT) process.stdout.write(text);
else {
  fs.writeFileSync(path.join(ROOT, 'docs', 'lodacne-results.md'), text);
  fs.mkdirSync(path.join(ROOT, 'docs', 'data'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'docs', 'data', 'lodacne.json'), JSON.stringify({ D, rules: RULES, lods: LODS, worlds }, null, 1) + '\n');
  console.log(`wrote docs/lodacne-results.md and docs/data/lodacne.json (${worlds.length} worlds)`);
}
