/* arena-core.js against oracles that share nothing with it but the cell
   packing (destroy/README.md):
     - pack and rgbOf over every 5-bit value; mixCell converging;
     - the count and the per-chunk counts after random edits against a
       recount by hand, and dirt: re-meshing only the dirty chunks after
       random edits gives every chunk's words a full re-mesh gives; the
       same after boxes written behind its back and refreshBox;
     - meshChunk's every word (place, mask, colour, the four corners of every
       face) against a dense grid read with the rule written out here;
     - raycast against a slab test on every solid cell (the nearest entry,
       rays from inside, the floor under y = 0, rays leaving the arena);
     - blast's carve against the formula, the bedrock kept, the scorch only
       recolouring, and the mass carved = the count lost;
     - looseAround against a full 26-connected labelling of the arena;
     - detach, nearestFree and settleDown against their promises;
   then mutants of arena-core.js's text (the walk-core way: each must be
   caught, and its text must occur exactly once). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as REAL from '../arena-core.js';

const HERE = dirname(fileURLToPath(import.meta.url));

// A small deterministic generator, the test's own.
function rng(seed){ let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/* A world to test on: a slab floor, blobs, thin walls, floating bits, and
   a column touching the arena's sides. */
function sample(M, seed, X = 64, Y = 64, Z = 64){
  const A = M.createArena(X, Y, Z), r = rng(seed);
  for (let y = 0; y < 6; y++) for (let z = 0; z < Z; z++) for (let x = 0; x < X; x++) A.cells[A.idx(x, y, z)] = M.pack(100 + y * 10, 120, 90);
  for (let b = 0; b < 10; b++){
    const c = [r() * X, 6 + r() * (Y - 20), r() * Z], R = 2 + r() * 7, col = M.pack(r() * 255, r() * 255, r() * 255);
    for (let z = Math.max(0, Math.floor(c[2] - R)); z < Math.min(Z, c[2] + R); z++)
      for (let y = Math.max(0, Math.floor(c[1] - R)); y < Math.min(Y, c[1] + R); y++)
        for (let x = Math.max(0, Math.floor(c[0] - R)); x < Math.min(X, c[0] + R); x++)
          if ((x + 0.5 - c[0]) ** 2 + (y + 0.5 - c[1]) ** 2 + (z + 0.5 - c[2]) ** 2 < R * R) A.cells[A.idx(x, y, z)] = col;
  }
  for (let y = 6; y < 30; y++) for (let x = 10; x < 40; x++) A.cells[A.idx(x, y, 31)] = M.pack(200, 30, 30);    // a wall one thick
  for (let y = 6; y < 20; y++) A.cells[A.idx(0, y, 0)] = A.cells[A.idx(X - 1, y, Z - 1)] = M.pack(9, 9, 9);   // corner posts
  for (let k = 0; k < 40; k++) A.cells[A.idx(Math.floor(r() * X), Math.floor(30 + r() * 30), Math.floor(r() * Z))] = M.pack(250, 250, 0);
  return A.recount();
}
// The test's solid rule for the mesh: below y = 0 solid, beside and above air.
const meshS = (A, x, y, z) => y < 0 ? 1 : (x < 0 || z < 0 || x >= A.X || z >= A.Z || y >= A.Y) ? 0 : A.cells[x + A.X * (z + A.Z * y)] ? 1 : 0;
const NORMALS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

/* The expected instances of chunk c, as a Map from local place to its three words. */
function expectedChunk(A, c){
  const cx = c % A.CX, cz = Math.floor(c / A.CX) % A.CZ, cy = Math.floor(c / (A.CX * A.CZ)), out = new Map();
  for (let ly = 0; ly < 32; ly++) for (let lz = 0; lz < 32; lz++) for (let lx = 0; lx < 32; lx++){
    const x = cx * 32 + lx, y = cy * 32 + ly, z = cz * 32 + lz, v = A.cells[x + A.X * (z + A.Z * y)];
    if (!v) continue;
    let m = 0;
    const ao = [0, 0, 0, 0, 0, 0];
    NORMALS.forEach((n, f) => {
      if (meshS(A, x + n[0], y + n[1], z + n[2])) return;
      m |= 1 << f;
      const a = n.findIndex(e => e !== 0), u = (a + 1) % 3, w = (a + 2) % 3;
      for (let k = 0; k < 4; k++){
        const L = [x + n[0], y + n[1], z + n[2]], du = k & 1 ? 1 : -1, dw = k & 2 ? 1 : -1;
        const p1 = L.slice(), p2 = L.slice(), p3 = L.slice(); p1[u] += du; p2[w] += dw; p3[u] += du; p3[w] += dw;
        const s1 = meshS(A, ...p1), s2 = meshS(A, ...p2), cc = meshS(A, ...p3);
        ao[f] |= (s1 && s2 ? 0 : 3 - s1 - s2 - cc) << 2 * k;
      }
    });
    if (!m) continue;
    out.set(lx | ly << 5 | lz << 10, [(lx | ly << 5 | lz << 10 | m << 15) >>> 0, ((v & 0x7fff) | ao[0] << 16 | ao[1] << 24) >>> 0, (ao[2] | ao[3] << 8 | ao[4] << 16 | ao[5] << 24) >>> 0]);
  }
  return out;
}
const asMap = r => { const m = new Map(); for (let k = 0; k < r.count; k++) m.set(r.words[3 * k] & 0x7fff, [r.words[3 * k], r.words[3 * k + 1], r.words[3 * k + 2]]); return m; };

/* The first solid cell along a ray, by a slab test on every solid cell and
   the floor: the least entry t ≥ 0 of a cell the ray spends a positive
   length in (a cell the origin is in enters at 0; one touched only along an
   edge or at a corner isn't met). */
function bruteRay(A, o, d, tMax){
  let best = null;
  const consider = (x, y, z, size = [1, 1, 1], floor = false) => {
    let t0 = -Infinity, t1 = Infinity;
    for (let a = 0; a < 3; a++){
      const lo = [x, y, z][a], hi = lo + size[a];
      if (d[a] === 0){ if (o[a] < lo || o[a] >= hi) return; continue; }
      let ta = (lo - o[a]) / d[a], tb = (hi - o[a]) / d[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    const t = Math.max(0, t0);
    if (!(t1 > t)) return;
    if (t <= tMax && (!best || t < best.t - 1e-12)) best = floor ? { t, floor } : { t, x, y, z };
  };
  for (let y = 0; y < A.Y; y++) for (let z = 0; z < A.Z; z++) for (let x = 0; x < A.X; x++) if (A.cells[x + A.X * (z + A.Z * y)]) consider(x, y, z);
  // The floor: everything under the arena, and only under it.
  consider(0, -1e9, 0, [A.X, 1e9, A.Z], true);
  return best;
}

/* A full 26-connected labelling: the unsupported pieces (no cell at y = 0). */
function unsupported(A){
  const lab = new Int32Array(A.N), pieces = [];
  let id = 0;
  for (let s = 0; s < A.N; s++){
    if (!A.cells[s] || lab[s]) continue;
    const list = [s], stack = [s]; lab[s] = ++id; let held = false;
    while (stack.length){
      const i = stack.pop(), x = i % A.X, z = Math.floor(i / A.X) % A.Z, y = Math.floor(i / A.XZ);
      if (y === 0) held = true;
      for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++){
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= A.X || Y >= A.Y || Z >= A.Z) continue;
        const j = X + A.X * (Z + A.Z * Y);
        if (A.cells[j] && !lab[j]){ lab[j] = id; list.push(j); stack.push(j); }
      }
    }
    if (!held) pieces.push(list.sort((a, b) => a - b));
  }
  return pieces;
}
const airFace = (A, i) => { const x = i % A.X, z = Math.floor(i / A.X) % A.Z, y = Math.floor(i / A.XZ);
  return NORMALS.some(n => { const X = x + n[0], Y = y + n[1], Z = z + n[2]; return X < 0 || Z < 0 || X >= A.X || Z >= A.Z || Y >= A.Y || (Y >= 0 && !A.cells[X + A.X * (Z + A.Z * Y)]); }); };

async function suite(M, { quick = false } = {}){
  // Colours.
  for (let c = 0; c < 32; c++){
    const v = M.pack(c << 3, c << 3, c << 3), w = (c << 3 | c >> 2);
    assert.deepEqual(M.rgbOf(v), [w, w, w], `channel ${c}`);
    assert.ok(v & M.SOLID_BIT, 'solid');
  }
  assert.equal(M.pack(0, 0, 0), 0x8000, 'black is solid');
  let v = M.pack(250, 10, 10);
  for (let k = 0; k < 40; k++) v = M.mixCell(v, 40, 30, 20, 0.4);
  // Five bits a channel: scorch settles within a step (8) of char and stays there.
  assert.equal(M.mixCell(v, 40, 30, 20, 0.4), v, 'scorch settles');
  [v & 31, v >> 5 & 31, v >> 10 & 31].forEach((c, i) => assert.ok(Math.abs(c - Math.round([40, 30, 20][i] * 31 / 255)) <= 1, `scorch settles a level from char, not at ${M.rgbOf(v)}`));

  // Counts and dirt.
  const r = rng(5);
  for (const seed of quick ? [1] : [1, 2]){
    const A = sample(M, seed);
    let n = 0; for (const c of A.cells) if (c) n++;
    assert.equal(A.count, n, 'the count');
    const before = Array.from({ length: A.CX * A.CY * A.CZ }, (_, c) => asMap(M.meshChunk(A, c)));
    while (A.takeDirty() >= 0);
    const meshes = before.slice();
    // Half the edits on a chunk's border (31 or 32 on one axis), checked every 5, so a
    // neighbour left clean isn't hidden by another edit dirtying it.
    const at = () => r() < 0.5 ? 31 + Math.floor(r() * 2) : Math.floor(r() * 64);
    for (let k = 0; k < 400; k++){
      const x = at(), y = at(), z = at();
      A.set(x, y, z, r() < 0.5 ? 0 : M.pack(r() * 255, r() * 255, r() * 255));
      if (k % 5 === 4){
        for (let c; (c = A.takeDirty()) >= 0;) meshes[c] = asMap(M.meshChunk(A, c));
        for (let c = 0; c < meshes.length; c++) assert.deepEqual(meshes[c], asMap(M.meshChunk(A, c)), `chunk ${c} wasn't dirty after edits`);
      }
    }
    let m = 0; const per = new Int32Array(A.chunkSolid.length);
    for (let i = 0; i < A.N; i++) if (A.cells[i]){ m++; const x = i % A.X, z = Math.floor(i / A.X) % A.Z, y = Math.floor(i / A.XZ); per[(x >> 5) + A.CX * ((z >> 5) + A.CZ * (y >> 5))]++; }
    assert.equal(A.count, m, 'the count after edits');
    assert.deepEqual(Array.from(A.chunkSolid), Array.from(per), 'per chunk');
    assert.throws(() => A.set(-1, 0, 0, 1), RangeError);
  }

  // refreshBox: boxes of cells written behind the arena's back (the page stamping a
  // thing), on chunk borders, at the arena's edges and inside one chunk, then the
  // count, the per-chunk counts and every chunk's mesh as above.
  for (const seed of quick ? [6] : [6, 7]){
    const A = sample(M, seed), rb = rng(seed * 7);
    const meshes = Array.from({ length: A.CX * A.CY * A.CZ }, (_, c) => asMap(M.meshChunk(A, c)));
    while (A.takeDirty() >= 0);
    const edge = () => [0, 30, 31, 32, 33, 40][Math.floor(rb() * 6)];
    for (let k = 0; k < (quick ? 12 : 30); k++){
      const lo = [edge(), edge(), edge()], hi = lo.map(v => Math.min(64, v + 1 + Math.floor(rb() * (k % 3 ? 3 : 30))));
      for (let y = lo[1]; y < hi[1]; y++) for (let z = lo[2]; z < hi[2]; z++) for (let x = lo[0]; x < hi[0]; x++)
        A.cells[A.idx(x, y, z)] = rb() < 0.3 ? 0 : M.pack(rb() * 255, 60, 60);
      A.refreshBox(lo, hi);
      for (let c; (c = A.takeDirty()) >= 0;) meshes[c] = asMap(M.meshChunk(A, c));
      for (let c = 0; c < meshes.length; c++) assert.deepEqual(meshes[c], asMap(M.meshChunk(A, c)), `refreshBox: chunk ${c} wasn't dirty`);
      let m = 0; const per = new Int32Array(A.chunkSolid.length);
      for (let i = 0; i < A.N; i++) if (A.cells[i]){ m++; const x = i % A.X, z = Math.floor(i / A.X) % A.Z, y = Math.floor(i / A.XZ); per[(x >> 5) + A.CX * ((z >> 5) + A.CZ * (y >> 5))]++; }
      assert.equal(A.count, m, 'refreshBox: the count');
      assert.deepEqual(Array.from(A.chunkSolid), Array.from(per), 'refreshBox: per chunk');
    }
  }

  // The mesh, word for word.
  for (const seed of quick ? [3] : [3, 4]){
    const A = sample(M, seed);
    for (let c = 0; c < A.CX * A.CY * A.CZ; c++) assert.deepEqual(asMap(M.meshChunk(A, c)), expectedChunk(A, c), `chunk ${c} of world ${seed}`);
  }

  // Rays.
  {
    const A = sample(M, 7), rr = rng(9);
    for (let k = 0; k < (quick ? 240 : 800); k++){
      let o = [rr() * 80 - 8, rr() * 80 - 10, rr() * 80 - 8], d = [rr() - 0.5, rr() - 0.5, rr() - 0.5];
      if (k % 7 === 0) d[k % 3] = 0;
      if (k % 11 === 0){ d[0] = 0; d[2] = 0; }
      // Every other ray through edges and corners exactly: from a cell's centre, along small
      // integer steps, so boundaries are crossed at the same t on two or three axes.
      if (k % 2){ o = o.map(v => Math.floor(v) + 0.5); d = [0, 1, 2].map(() => [-2, -1, 0, 1, 2][Math.floor(rr() * 5)]); if (!d.some(Boolean)) d[1] = -1; }
      const tMax = rr() * 200, got = M.raycast(A, o, d, tMax), want = bruteRay(A, o, d, tMax);
      if (!want){ assert.equal(got, null, `ray ${k} hit nothing`); continue; }
      assert.ok(got, `ray ${k} should hit at ${want.t}`);
      assert.ok(Math.abs(got.t - want.t) < 1e-9, `ray ${k}: t ${got.t}, not ${want.t}`);
      if (want.floor) assert.ok(got.y < 0, `ray ${k}: the floor`);
      else if (got.y >= 0) assert.ok(M.raycast(A, o, d, tMax) && A.cells[A.idx(got.x, got.y, got.z)], `ray ${k}: a solid cell`);
    }
  }

  // A checkerboard: every cell a diagonal ray touches only along an edge is solid, every
  // cell it passes through is air, so a walk that stops on a touch is caught at once.
  {
    const A = M.createArena(32, 32, 32), rr = rng(21);
    for (let y = 0; y < 32; y++) for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) if ((x + y + z) % 2 === 0) A.cells[A.idx(x, y, z)] = M.pack(200, 200, 200);
    A.recount();
    for (let k = 0; k < (quick ? 60 : 200); k++){
      const o = [1 + Math.floor(rr() * 30), 1 + Math.floor(rr() * 30), 1 + Math.floor(rr() * 30)];
      if ((o[0] + o[1] + o[2]) % 2 === 0) o[0] += 1;
      const d = [[1, 1, 0], [1, 0, 1], [0, 1, 1], [1, -1, 0], [-1, 1, 1], [1, 1, 1], [-1, -1, -1], [2, 0, 2]][k % 8].map(v => v * (rr() < 0.5 ? 1 : -1));
      const oc = o.map(v => v + 0.5), tMax = 40, got = M.raycast(A, oc, d, tMax), want = bruteRay(A, oc, d, tMax);
      if (!want){ assert.equal(got, null, `checkerboard ray ${k} meets nothing`); continue; }
      assert.ok(got && Math.abs(got.t - want.t) < 1e-9, `checkerboard ray ${k}: ${got && got.t}, not ${want.t}`);
    }
  }

  // Blasts.
  {
    const A = sample(M, 11), copy = A.cells.slice(), c = [30.3, 4.2, 28.7], R = 9;
    const b = M.blast(A, c, R, { seed: 4, jag: 0.3, scorch: 1.5, char: 0.35 });
    const want = new Set(), burnt = new Set();
    for (let y = 1; y < A.Y; y++) for (let z = 0; z < A.Z; z++) for (let x = 0; x < A.X; x++){
      const i = x + A.X * (z + A.Z * y);
      if (!copy[i]) continue;
      const d = Math.hypot(x + 0.5 - c[0], y + 0.5 - c[1], z + 0.5 - c[2]), re = R * (1 - 0.15 + 0.3 * (M.hash4(x >> 1, y >> 1, z >> 1, 4) / 4294967296));
      if (d < re) want.add(i); else if (d < re + 1.5) burnt.add(i);
    }
    const got = new Set();
    for (let k = 0; k < b.cols.length; k++){
      const i = A.idx(b.at[3 * k], b.at[3 * k + 1], b.at[3 * k + 2]);
      got.add(i); assert.equal(b.cols[k], copy[i], 'its colour comes back');
    }
    assert.deepEqual([...got].sort((p, q) => p - q), [...want].sort((p, q) => p - q), 'the carve');
    for (let i = 0; i < A.N; i++){
      if (want.has(i)) assert.equal(A.cells[i], 0);
      else if (burnt.has(i)) assert.equal(A.cells[i], M.mixCell(copy[i], ...M.CHAR, 0.35), 'scorched');
      else assert.equal(A.cells[i], copy[i], 'untouched');
    }
    let n = 0; for (const v of copy) if (v) n++;
    assert.equal(A.count, n - b.cols.length, 'mass carved = mass lost');
    for (let z = 0; z < A.Z; z++) for (let x = 0; x < A.X; x++) assert.ok(A.cells[A.idx(x, 0, z)], 'bedrock stays');
  }

  // Loose pieces against the labelling.
  for (const seed of quick ? [13] : [13, 14, 15]){
    const A = sample(M, seed), rr = rng(seed);
    for (let k = 0; k < 5; k++){
      const c = [rr() * 64, 6 + rr() * 30, rr() * 64], R = 3 + rr() * 8;
      const b = M.blast(A, c, R, { seed: k });
      const got = M.looseAround(A, b.box, 1e9).map(l => Array.from(l).sort((p, q) => p - q)).sort((p, q) => p[0] - q[0]);
      const [x0, y0, z0, x1, y1, z1] = b.box;
      const inBox = i => { const x = i % A.X, z = Math.floor(i / A.X) % A.Z, y = Math.floor(i / A.XZ); return x >= x0 && x < x1 && y >= y0 && y < y1 && z >= z0 && z < z1; };
      const want = unsupported(A).filter(p => p.some(i => inBox(i) && airFace(A, i))).sort((p, q) => p[0] - q[0]);
      assert.deepEqual(got, want, `loose pieces after blast ${k} of world ${seed}`);
      for (const p of got) M.detach(A, p);
    }
    // A limit too small counts a loose piece as held: a promise about the work, said so.
    const B = M.createArena(32, 32, 32);
    for (let y = 10; y < 20; y++) B.set(5, y, 5, M.pack(1, 2, 3));
    assert.equal(M.looseAround(B, [0, 0, 0, 32, 32, 32], 1e9).length, 1);
    assert.equal(M.looseAround(B, [0, 0, 0, 32, 32, 32], 4).length, 0);
  }

  // detach, nearestFree, settleDown.
  {
    const A = sample(M, 17), cells = [A.idx(3, 10, 4), A.idx(4, 10, 4), A.idx(4, 12, 6)];
    for (const i of cells) A.cells[i] = M.pack(10, 20, 30);
    A.recount();
    const n = A.count, d = M.detach(A, cells);
    assert.deepEqual(d.origin, [3, 10, 4]);
    assert.deepEqual(Array.from(d.offs), [0, 0, 0, 1, 0, 0, 1, 2, 2]);
    assert.equal(A.count, n - 3);
    for (const i of cells) assert.equal(A.cells[i], 0);
    const rr = rng(3);
    for (let k = 0; k < 300; k++){
      const c = [Math.floor(rr() * 70) - 3, Math.floor(rr() * 70) - 3, Math.floor(rr() * 70) - 3], p = M.nearestFree(A, c);
      assert.ok(A.free(...p), 'free');
      const cc = c.map((v, a) => Math.min([A.X, A.Y, A.Z][a] - 1, Math.max(0, v)));
      if (A.free(...cc)){ assert.deepEqual(p, cc, 'itself when free'); continue; }
      const dd = (p[0] - cc[0]) ** 2 + (p[1] - cc[1]) ** 2 + (p[2] - cc[2]) ** 2;
      if (Math.max(...p.map((v, a) => Math.abs(v - cc[a]))) <= 3){
        for (let dy = -3; dy <= 3; dy++) for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++){
          if (!A.free(cc[0] + dx, cc[1] + dy, cc[2] + dz)) continue;
          const e = dx * dx + dy * dy + dz * dz;
          assert.ok(e >= dd, `a nearer free cell at ${dx}, ${dy}, ${dz}`);
          if (e === dd && Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) === Math.max(...p.map((v, a) => Math.abs(v - cc[a])))) assert.ok(dy <= p[1] - cc[1], 'the higher of a tie');
        }
      }
    }
    for (let k = 0; k < 300; k++){
      const p = M.nearestFree(A, [Math.floor(rr() * 64), Math.floor(rr() * 64), Math.floor(rr() * 64)]), slide = k % 2 === 0, q = M.settleDown(A, p, slide);
      assert.ok(A.free(...q));
      assert.ok(q[1] === 0 || !A.free(q[0], q[1] - 1, q[2]), 'resting');
      assert.ok(q[1] <= p[1]);
      if (slide && q[1] > 0) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]])
        assert.ok(!(A.free(q[0] + dx, q[1], q[2] + dz) && A.free(q[0] + dx, q[1] - 1, q[2] + dz)), 'no open diagonal left');
    }
    const F = M.createArena(32, 32, 32);
    F.cells.fill(M.pack(1, 1, 1)); F.recount();
    assert.throws(() => M.nearestFree(F, [3, 3, 3]), /full/);
  }

  // The physics question: walls beside, a floor below, the sky open.
  {
    const A = M.createArena(32, 32, 32);
    assert.ok(A.solidAt(-1, 5, 5) && A.solidAt(5, 5, 32) && A.solidAt(5, -1, 5) && !A.solidAt(5, 32, 5) && !A.solidAt(5, 5, 5));
    assert.ok(A.boxSolid([-1, 1, 1], [1, 2, 2]) && !A.boxSolid([1, 30, 1], [2, 40, 2]) && A.boxSolid([1, -1, 1], [2, 1, 2]));
    // The floor, for rays: under the arena only, from above it and from under it.
    assert.equal(M.raycast(A, [5.5, 3.5, 5.5], [0, -1, 0], 10)?.t, 3.5);
    assert.equal(M.raycast(A, [5.5, -0.5, 5.5], [1, 0, 0], 10)?.t, 0);
    assert.equal(M.raycast(A, [-3.5, 3.5, 5.5], [0, -1, 0], 50), null);
    assert.equal(M.raycast(A, [-3.5, 2, 5.5], [1, -1, 0], 50)?.t, 3.5);
  }
}

test('arena-core against its oracles', async () => { await suite(REAL); });

const MUTANTS = [
  ['black is air', 'export const pack = (r, g, b) => (SOLID_BIT | ', 'export const pack = (r, g, b) => (0 | '],
  ['narrow widen', 'const widen = c => c << 3 | c >> 2;', 'const widen = c => c << 3;'],
  ['count lags', 'A.count += d;', 'A.count += d * (A.count < 10 ? 1 : 0);'],
  ['no neighbour dirt', 'const x0 = (x - 1) >> CHUNK_BITS, x1 = (x + 1) >> CHUNK_BITS', 'const x0 = x >> CHUNK_BITS, x1 = x >> CHUNK_BITS'],
  ['colour edits clean', '} else A.markDirty(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS);', '}'],
  ['floor shows', 'if (y < 0) return 1;\n  if (x < 0 || z < 0', 'if (y < 0) return 0;\n  if (x < 0 || z < 0'],
  ['inner mask swapped', "(cells[i + XZ] ? 0 : 4) | (cells[i - XZ] ? 0 : 8)", "(cells[i - XZ] ? 0 : 4) | (cells[i + XZ] ? 0 : 8)"],
  ['corner ignored', 'return s1 && s2 ? 0 : 3 - s1 - s2 - c;', 'return s1 && s2 ? 0 : 3 - s1 - s2;'],
  ['ao word shifted', 'if (f < 2) ao1 |= bits << 8 * f; else ao2 |= bits << 8 * (f - 2);', 'if (f < 2) ao1 |= bits << 8 * f; else ao2 |= bits << 8 * (f - 1);'],
  ['ties one at a time', 'if (ty === tn){ y += sy;', 'if (ty === tn && !n[0]){ y += sy;'],
  ['no floor for rays', '(y < 0 || (y < Y && cells', '(false || (y >= 0 && y < Y && cells'],
  ['an endless floor', 'const hit = x >= 0 && z >= 0 && x < X && z < Z && (y < 0 ||', 'const hit = y < 0 || x >= 0 && z >= 0 && x < X && z < Z && ('],
  ['ray gives up early', "if ((x < 0 && sx <= 0) || (z < 0 && sz <= 0) || (x >= X && sx >= 0) || (z >= Z && sz >= 0) || (y >= Y && sy >= 0)) return null;", "if (x < 0 || z < 0 || x >= X || z >= Z || y >= Y) return null;"],
  ['bedrock carved', 'const y0 = Math.max(floor, Math.floor(c[1] - R))', 'const y0 = Math.max(0, Math.floor(c[1] - R))'],
  ['smooth crater', "const re = r * (1 - jag / 2 + jag * (hash4(x >> 1, y >> 1, z >> 1, seed) / 4294967296));", 'const re = r;'],
  ['scorch carves', '    else if (d < re + scorch) burnt.push(x, y, z);', '    else if (d < re + scorch){ at.push(x, y, z); cols.push(v); }'],
  ['six-connected support', 'for (let dx = -1; dx <= 1; dx++){ const nx = cx + dx; if (nx < 0 || nx >= X) continue;', 'for (let dx = -1; dx <= 1; dx++){ const nx = cx + dx; if (nx < 0 || nx >= X || Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1) continue;'],
  ['a meeting held nothing', 'else if (l !== id){ held = true; break walk; }', 'else if (false){ held = true; break walk; }'],
  ['no limit', 'if (members.length > limit){ held = true; break; }', ''],
  ['detach keeps', '    A.set(x, y, z, AIR);\n  }\n  return { origin', '  }\n  return { origin'],
  ['farther free', 'if (d < bd || (d === bd && dy > by)){', 'if (d > bd || bd === Infinity){'],
  ['lower of a tie', 'if (d < bd || (d === bd && dy > by)){', 'if (d < bd || (d === bd && dy < by)){'],
  ['no drop', 'if (y > 0 && A.free(x, y - 1, z)){ y--; continue; }', ''],
  ['slides uphill', 'if (A.free(x + dx, y, z + dz) && A.free(x + dx, y - 1, z + dz)){ x += dx; z += dz; y--; moved = true; break; }', 'if (A.free(x + dx, y, z + dz)){ x += dx; z += dz; moved = true; break; }'],
  ['refresh misses its last chunk', '.map((v, a) => Math.min(v, [X, Y, Z][a] - 1) >> CHUNK_BITS);', '.map((v, a) => (Math.min(v, [X, Y, Z][a] - 1) >> CHUNK_BITS) - (a === 0 ? 1 : 0));'],
  ['refresh dirties no neighbour', 'for (let cx = (lo[0] - 1) >> CHUNK_BITS; cx <= hi[0] >> CHUNK_BITS; cx++)', 'for (let cx = lo[0] >> CHUNK_BITS; cx <= (hi[0] - 1) >> CHUNK_BITS; cx++)'],
  ['refresh counts twice', 'A.count += n - chunkSolid[c]; chunkSolid[c] = n;', 'A.count += n; chunkSolid[c] = n;'],
  ['walls open', 'if (y < 0 || x < 0 || z < 0 || x >= X || z >= Z) return true;\n    if (y >= Y) return false;', 'if (y < 0) return true;\n    if (x < 0 || z < 0 || x >= X || z >= Z || y >= Y) return false;'],
];
test('every mutant of arena-core is caught', async t => {
  const src = readFileSync(join(HERE, '..', 'arena-core.js'), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'arena-mutants-'));
  try {
    for (const [k, [name, from, to]] of MUTANTS.entries()){
      assert.equal(src.split(from).length, 2, `mutant ${name}: its text must occur exactly once in arena-core.js`);
      const file = join(dir, `arena-mutant-${k}.mjs`);
      writeFileSync(file, src.replace(from, to));
      const M = await import(pathToFileURL(file).href);
      let caught = null;
      try { await suite(M, { quick: true }); } catch (e){ caught = e; }
      assert.ok(caught, `mutant ${name} survived`);
      t.diagnostic(`mutant ${name}: ${caught.message.split('\n')[0]}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
