/* ARENA CORE: the destruction arena's voxels (destroy/README.md). Pure, no
   imports, no DOM: every rule the page plays by is here or in
   debris-core.js, and destroy/test/ holds them in Node.

   WHY A DENSE GRID, NOT THE DAG. Everything else in this repo keeps a world
   as a hash-consed DAG, which is what lets a D = 20 world fit at all. An
   arena is the opposite case: a few hundred voxels a side, and edited
   hundreds of times a second (a rocket carves a ball of ~1,400 voxels,
   then every piece of rubble writes its voxels back one by one when it
   lands). A DAG edit re-interns a path per voxel and moves the root, and
   the streamer re-expands every chunk the root touched; here an edit is
   one store into a Uint16Array and a dirty bit on a 32³ chunk. 384 × 192 ×
   384 is 28 million cells, 57 MB at two bytes a cell, and the DAG is where
   the content comes *from* (content-core.js stamps .vdag worlds, math
   shapes and specimens in) and could go back to (fromDense) if an arena
   were ever saved.

   A CELL is a Uint16: 0 is air, anything else is solid, with bit 15 set and
   its colour in the low 15 bits as 5:5:5 RGB (so a black voxel is 0x8000,
   never 0). Five bits a channel is coarser than the attribute word's six,
   which is fine for an arena: the voxels are big on screen and the light
   does the rest.

   THE LAYOUT is y-major: index = x + X·(z + Z·y), so a horizontal slab is
   contiguous and a step up is X·Z. X, Y and Z are multiples of CHUNK = 32,
   the mesh's unit: a chunk's instances are rebuilt whenever a cell in it,
   or a cell next to it (faces and ambient occlusion read one cell round),
   changes.

   OUTSIDE THE ARENA, for physics (solidAt, boxSolid): solid below y = 0
   and beyond the four sides (invisible walls), air above. For the mesh
   (faceMask, aoAt): air beyond the sides (the plane's edge shows its
   layers) and above, solid below. For rays (raycast): air beyond the sides
   and above, solid below the arena (only under it).

   BEDROCK: y = 0 is never carved (blast's `floor`), so nothing falls out of
   the world and the walker always has a floor.

   MASS is the point of the arena (asked for 2026-11-21: "when they settle
   they should bake into the voxels around, basically mass is preserved in
   the world"). `count` is kept exact by `set`, and every function here that
   takes voxels out of the grid hands them back as a list, so the caller
   can carry them as debris and put every one back: `blast` returns what it
   carved, `detach` what it lifted, and `nearestFree` always finds a place
   (it throws only if the arena is full). */

export const CHUNK = 32, CHUNK_BITS = 5;
export const AIR = 0, SOLID_BIT = 0x8000;

/* ---- colours -------------------------------------------------------------- */
export const pack = (r, g, b) => (SOLID_BIT | (r >> 3) | (g >> 3) << 5 | (b >> 3) << 10);
// rgb8 (colours.js's packing: r | g << 8 | b << 16) to a cell.
export const fromRgb8 = c => pack(c & 255, c >> 8 & 255, c >> 16 & 255);
// A 5-bit channel widened to 8 the usual way (c << 3 | c >> 2: 31 → 255).
const widen = c => c << 3 | c >> 2;
export const rgbOf = v => [widen(v & 31), widen(v >> 5 & 31), widen(v >> 10 & 31)];
/* Toward another colour by t in [0, 1] (scorch, slag), in the cell's own
   five bits, rounding the step: a channel moves while a step of t would
   move it at least half a level, so it settles within one level (8 of
   255) of the target and stays. Done in eight bits and packed, the >> 3
   truncated every step, and a dark channel scorched toward char stuck
   below it (green at 16, not 30: the test caught it). */
export function mixCell(v, r, g, b, t){
  const to = [r, g, b], out = [v & 31, v >> 5 & 31, v >> 10 & 31];
  for (let i = 0; i < 3; i++) out[i] += Math.round((Math.round(to[i] * 31 / 255) - out[i]) * t);
  return SOLID_BIT | out[0] | out[1] << 5 | out[2] << 10;
}

/* A 32-bit hash of three integers and a seed (Murmur's finaliser on a
   mix), for jagged craters and debris spins: the same blast carves the
   same voxels in Node and the page. */
export function hash4(x, y, z, s){
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(s | 0, 0x165667b1);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return h >>> 0;
}

/* ---- the grid ------------------------------------------------------------- */
export function createArena(X, Y, Z, cells = null){
  for (const [n, v] of [['X', X], ['Y', Y], ['Z', Z]])
    if (!(Number.isInteger(v) && v > 0 && v % CHUNK === 0)) throw new RangeError(`arena: ${n} = ${v} isn't a positive multiple of ${CHUNK}`);
  const XZ = X * Z, N = XZ * Y;
  const given = !!cells;
  if (cells && cells.length !== N) throw new RangeError(`arena: ${cells.length} cells for ${X} × ${Y} × ${Z}`);
  cells ||= new Uint16Array(N);
  const CX = X >> CHUNK_BITS, CY = Y >> CHUNK_BITS, CZ = Z >> CHUNK_BITS;
  const chunkSolid = new Int32Array(CX * CY * CZ), dirty = new Uint8Array(CX * CY * CZ), dirtyList = [];
  const A = {
    X, Y, Z, XZ, N, cells, CX, CY, CZ, chunkSolid, dirty, dirtyList, count: 0,
    idx: (x, y, z) => x + X * (z + Z * y),
    inBounds: (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < X && y < Y && z < Z,
    chunkIndex: (cx, cy, cz) => cx + CX * (cz + CZ * cy),
  };
  // The raw cell, 0 outside.
  A.get = (x, y, z) => (x >= 0 && y >= 0 && z >= 0 && x < X && y < Y && z < Z) ? cells[x + X * (z + Z * y)] : 0;
  // Air inside the arena: where a voxel may be put.
  A.free = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < X && y < Y && z < Z && cells[x + X * (z + Z * y)] === 0;
  // Physics: walls beside, a floor below, the sky open.
  A.solidAt = (x, y, z) => {
    if (y < 0 || x < 0 || z < 0 || x >= X || z >= Z) return true;
    if (y >= Y) return false;
    return cells[x + X * (z + Z * y)] !== 0;
  };
  /* Anything solid in the box of cells [lo, hi)? walk-core's question
     (`world(lo, hi)`), with the arena's outside. */
  A.boxSolid = (lo, hi) => {
    if (lo[1] < 0 || lo[0] < 0 || lo[2] < 0 || hi[0] > X || hi[2] > Z) return true;
    const y1 = Math.min(hi[1], Y);
    for (let y = lo[1]; y < y1; y++) for (let z = lo[2]; z < hi[2]; z++){
      const row = X * (z + Z * y);
      for (let x = lo[0]; x < hi[0]; x++) if (cells[row + x]) return true;
    }
    return false;
  };
  A.markDirty = (cx, cy, cz) => {
    if (cx < 0 || cy < 0 || cz < 0 || cx >= CX || cy >= CY || cz >= CZ) return;
    const c = cx + CX * (cz + CZ * cy);
    if (!dirty[c]){ dirty[c] = 1; dirtyList.push(c); }
  };
  /* The chunks whose instances read cell (x, y, z): its own, and any chunk
     within one cell of it (a face's mask reads the six neighbours, its
     occlusion the cells round the face). */
  const touch = (x, y, z) => {
    const x0 = (x - 1) >> CHUNK_BITS, x1 = (x + 1) >> CHUNK_BITS, y0 = (y - 1) >> CHUNK_BITS, y1 = (y + 1) >> CHUNK_BITS;
    const z0 = (z - 1) >> CHUNK_BITS, z1 = (z + 1) >> CHUNK_BITS;
    for (let cy = y0; cy <= y1; cy++) for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) A.markDirty(cx, cy, cz);
  };
  A.set = (x, y, z, v) => {
    if (!(x >= 0 && y >= 0 && z >= 0 && x < X && y < Y && z < Z)) throw new RangeError(`arena: set outside at ${x}, ${y}, ${z}`);
    const i = x + X * (z + Z * y), old = cells[i];
    if (old === v) return;
    cells[i] = v;
    if (!old !== !v){
      const d = v ? 1 : -1;
      A.count += d;
      chunkSolid[(x >> CHUNK_BITS) + CX * ((z >> CHUNK_BITS) + CZ * (y >> CHUNK_BITS))] += d;
      touch(x, y, z);
    } else A.markDirty(x >> CHUNK_BITS, y >> CHUNK_BITS, z >> CHUNK_BITS);
  };
  A.setIndex = (i, v) => { const x = i % X, t = (i - x) / X, z = t % Z; A.set(x, (t - z) / Z, z, v); };
  // After a bulk fill of `cells` (the builder's): the counts, and every chunk dirty.
  A.recount = () => {
    chunkSolid.fill(0); A.count = 0;
    for (let y = 0, i = 0; y < Y; y++){ const cy = (y >> CHUNK_BITS) * CZ;
      for (let z = 0; z < Z; z++){ const cz = (cy + (z >> CHUNK_BITS)) * CX;
        for (let x = 0; x < X; x++, i++) if (cells[i]){ A.count++; chunkSolid[cz + (x >> CHUNK_BITS)]++; } } }
    dirtyList.length = 0; dirty.fill(0);
    for (let c = 0; c < dirty.length; c++){ dirty[c] = 1; dirtyList.push(c); }
    return A;
  };
  /* After a bulk write of `cells` inside the box [lo, hi) (the page
     stamping a thing the builder placed, 2026-11-23): the counts of the
     chunks the box meets, made again, and every chunk that reads a cell of
     the box dirty (as `set`'s touch: within a cell of it). The whole grid's
     recount would do, but it dirties every chunk, and a thing at a time
     would re-mesh the arena dozens of times. */
  A.refreshBox = (lo, hi) => {
    const c0 = lo.map(v => Math.max(0, v) >> CHUNK_BITS), c1 = [hi[0] - 1, hi[1] - 1, hi[2] - 1].map((v, a) => Math.min(v, [X, Y, Z][a] - 1) >> CHUNK_BITS);
    for (let cy = c0[1]; cy <= c1[1]; cy++) for (let cz = c0[2]; cz <= c1[2]; cz++) for (let cx = c0[0]; cx <= c1[0]; cx++){
      let n = 0;
      for (let y = cy << CHUNK_BITS, y1 = y + CHUNK; y < y1; y++) for (let z = cz << CHUNK_BITS, z1 = z + CHUNK; z < z1; z++){
        const row = X * (z + Z * y) + (cx << CHUNK_BITS);
        for (let x = 0; x < CHUNK; x++) if (cells[row + x]) n++;
      }
      const c = cx + CX * (cz + CZ * cy);
      A.count += n - chunkSolid[c]; chunkSolid[c] = n;
    }
    for (let cy = (lo[1] - 1) >> CHUNK_BITS; cy <= hi[1] >> CHUNK_BITS; cy++)
      for (let cz = (lo[2] - 1) >> CHUNK_BITS; cz <= hi[2] >> CHUNK_BITS; cz++)
        for (let cx = (lo[0] - 1) >> CHUNK_BITS; cx <= hi[0] >> CHUNK_BITS; cx++) A.markDirty(cx, cy, cz);
    return A;
  };
  // The next dirty chunk, cleared, or -1.
  A.takeDirty = () => { while (dirtyList.length){ const c = dirtyList.shift(); if (dirty[c]){ dirty[c] = 0; return c; } } return -1; };
  if (given) A.recount();
  else for (let c = 0; c < dirty.length; c++){ dirty[c] = 1; dirtyList.push(c); }
  return A;
}

/* ---- the mesh ---------------------------------------------------------------
   A chunk's exposed voxels as instances of three uint32s, for the page's
   instanced cube (one instance a voxel, drawing of each axis's two faces
   the one on the eye's side, the stream viewer's "three faces a cube"):
     w0  local x | y << 5 | z << 10 | mask << 15
     w1  colour (15 bits) | AO of faces +x, −x << 16 (8 bits each)
     w2  AO of faces +y, −y, +z, −z (8 bits each)
   Face f = 2a + (negative ? 1 : 0) on axis a; mask bit f is set when the
   face shows (the cell beyond is air). A face's AO is its four corners,
   two bits each (3 lit, 0 in a corner), corner k = cu | cv << 1 along the
   face's tangents u = (a + 1) % 3, v = (a + 2) % 3: the classic voxel rule,
   (side₁ and side₂) ? 0 : 3 − side₁ − side₂ − corner, over the cells of the
   layer beyond the face. The shader decodes the same words; meshChunk's test
   holds every bit to a brute force. */
export const FACE_AXIS = [0, 0, 1, 1, 2, 2], FACE_SIGN = [1, -1, 1, -1, 1, -1];
// Solid for the mesh: air beside and above the arena, solid below.
export function meshSolid(A, x, y, z){
  if (y < 0) return 1;
  if (x < 0 || z < 0 || x >= A.X || z >= A.Z || y >= A.Y) return 0;
  return A.cells[x + A.X * (z + A.Z * y)] ? 1 : 0;
}
export function faceMask(A, x, y, z){
  let m = 0;
  for (let f = 0; f < 6; f++){
    const a = FACE_AXIS[f], s = FACE_SIGN[f], p = [x, y, z];
    p[a] += s;
    if (!meshSolid(A, p[0], p[1], p[2])) m |= 1 << f;
  }
  return m;
}
export function aoAt(A, x, y, z, f, k){
  const a = FACE_AXIS[f], s = FACE_SIGN[f], u = (a + 1) % 3, v = (a + 2) % 3;
  const L = [x, y, z]; L[a] += s;
  const du = k & 1 ? 1 : -1, dv = k & 2 ? 1 : -1;
  const p1 = L.slice(), p2 = L.slice(), p3 = L.slice();
  p1[u] += du; p2[v] += dv; p3[u] += du; p3[v] += dv;
  const s1 = meshSolid(A, ...p1), s2 = meshSolid(A, ...p2), c = meshSolid(A, ...p3);
  return s1 && s2 ? 0 : 3 - s1 - s2 - c;
}

/* The hot loop: neighbours by index where the cell isn't on the arena's
   border, meshSolid where it is. Most of a chunk is buried or air, and
   costs one or seven reads. */
export function meshChunk(A, c, out = null){
  const { X, Y, Z, XZ, cells, CX, CZ } = A;
  const cx = c % CX, t = (c - cx) / CX, cz = t % CZ, cy = (t - cz) / CZ;
  if (!A.chunkSolid[c]) return { words: out ? out.subarray(0, 0) : new Uint32Array(0), count: 0, cx, cy, cz };
  let words = out && out.length >= 3 * 4096 ? out : new Uint32Array(3 * 4096), n = 0;
  const x0 = cx * CHUNK, y0 = cy * CHUNK, z0 = cz * CHUNK;
  for (let ly = 0; ly < CHUNK; ly++){ const y = y0 + ly;
    for (let lz = 0; lz < CHUNK; lz++){ const z = z0 + lz, row = X * (z + Z * y);
      for (let lx = 0; lx < CHUNK; lx++){
        const x = x0 + lx, i = row + x, v = cells[i];
        if (!v) continue;
        let m;
        if (x > 0 && x < X - 1 && z > 0 && z < Z - 1 && y > 0 && y < Y - 1)
          m = (cells[i + 1] ? 0 : 1) | (cells[i - 1] ? 0 : 2) | (cells[i + XZ] ? 0 : 4) | (cells[i - XZ] ? 0 : 8) | (cells[i + X] ? 0 : 16) | (cells[i - X] ? 0 : 32);
        else m = faceMask(A, x, y, z);
        if (!m) continue;
        let ao1 = 0, ao2 = 0;
        for (let f = 0; f < 6; f++){
          if (!(m >> f & 1)) continue;
          let bits = 0;
          for (let k = 0; k < 4; k++) bits |= aoAt(A, x, y, z, f, k) << 2 * k;
          if (f < 2) ao1 |= bits << 8 * f; else ao2 |= bits << 8 * (f - 2);
        }
        if (3 * n + 3 > words.length){ const w = new Uint32Array(words.length * 2); w.set(words); words = w; }
        words[3 * n] = lx | ly << 5 | lz << 10 | m << 15;
        words[3 * n + 1] = ((v & 0x7fff) | ao1 << 16) >>> 0;
        words[3 * n + 2] = ao2 >>> 0;
        n++;
      }
    }
  }
  return { words: words.subarray(0, 3 * n), count: n, cx, cy, cz };
}

/* ---- rays ------------------------------------------------------------------
   The first solid cell a ray from o along d meets within tMax, meaning the
   first it spends a positive length in (edit-core's pick's rule; d need not
   be a unit; t is in d's lengths), by Amanatides and Woo's walk: t, the
   cell, the face it came in by (n, pointing back at the ray), the point.
   Outside the arena is air but for below it, so a ray leaving the sides or
   the top flies on until tMax; one under y = 0 hits the floor, which is
   only under the arena (beyond its sides there is nothing to hit, so a
   rocket fired out of the arena flies on rather than meeting an endless
   floor no one can see). */
export function raycast(A, o, d, tMax){
  const { X, Y, Z, cells } = A;
  let x = Math.floor(o[0]), y = Math.floor(o[1]), z = Math.floor(o[2]);
  const sx = d[0] > 0 ? 1 : d[0] < 0 ? -1 : 0, sy = d[1] > 0 ? 1 : d[1] < 0 ? -1 : 0, sz = d[2] > 0 ? 1 : d[2] < 0 ? -1 : 0;
  const tdx = sx ? Math.abs(1 / d[0]) : Infinity, tdy = sy ? Math.abs(1 / d[1]) : Infinity, tdz = sz ? Math.abs(1 / d[2]) : Infinity;
  let tx = sx > 0 ? (x + 1 - o[0]) * tdx : sx < 0 ? (o[0] - x) * tdx : Infinity;
  let ty = sy > 0 ? (y + 1 - o[1]) * tdy : sy < 0 ? (o[1] - y) * tdy : Infinity;
  let tz = sz > 0 ? (z + 1 - o[2]) * tdz : sz < 0 ? (o[2] - z) * tdz : Infinity;
  let t = 0, n = [0, 0, 0];
  for (let guard = 0; guard < 1e6; guard++){
    const hit = x >= 0 && z >= 0 && x < X && z < Z && (y < 0 || (y < Y && cells[x + X * (z + Z * y)] !== 0));
    if (hit) return { t, x, y, z, n, p: [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] };
    // Every axis whose boundary comes next steps at once: through an edge or a corner the
    // cells touched only along it (zero length inside) are passed, never hit, so the cell
    // met doesn't depend on which axis is tried first (the test's rays through corners).
    const tn = Math.min(tx, ty, tz);
    t = tn; n = [0, 0, 0];
    if (tx === tn){ x += sx; tx += tdx; n[0] = -sx; }
    if (ty === tn){ y += sy; ty += tdy; if (!n[0]) n[1] = -sy; }
    if (tz === tn){ z += sz; tz += tdz; if (!n[0] && !n[1]) n[2] = -sz; }
    if (t > tMax) return null;
    // Out of the arena and leaving it for good: nothing more to meet.
    if ((x < 0 && sx <= 0) || (z < 0 && sz <= 0) || (x >= X && sx >= 0) || (z >= Z && sz >= 0) || (y >= Y && sy >= 0)) return null;
  }
  return null;
}

/* ---- blasts ------------------------------------------------------------------
   Carve a ball of radius r round c: every solid cell whose centre is within
   r·(1 − jag/2 + jag·h) of c, h a hash of the cell's 2³ block in [0, 1), so
   the crater's edge is chunky rather than a smooth ball. Cells below
   `floor` (bedrock) stay. The carved cells come back as triples and their
   colours, in index order, for the caller to turn into debris: nothing is
   lost here. A shell `scorch` thick beyond the edge is darkened toward
   char (a colour, not mass). */
export const CHAR = [38, 32, 28];
export function blast(A, c, r, { seed = 1, jag = 0.3, floor = 1, scorch = 1.5, char = 0.35 } = {}){
  const R = r * (1 + jag / 2) + scorch + 1;
  const x0 = Math.max(0, Math.floor(c[0] - R)), x1 = Math.min(A.X - 1, Math.ceil(c[0] + R));
  const y0 = Math.max(floor, Math.floor(c[1] - R)), y1 = Math.min(A.Y - 1, Math.ceil(c[1] + R));
  const z0 = Math.max(0, Math.floor(c[2] - R)), z1 = Math.min(A.Z - 1, Math.ceil(c[2] + R));
  const at = [], cols = [], burnt = [];
  for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){
    const v = A.cells[x + A.X * (z + A.Z * y)];
    if (!v) continue;
    const dx = x + 0.5 - c[0], dy = y + 0.5 - c[1], dz = z + 0.5 - c[2], d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const re = r * (1 - jag / 2 + jag * (hash4(x >> 1, y >> 1, z >> 1, seed) / 4294967296));
    if (d < re){ at.push(x, y, z); cols.push(v); }
    else if (d < re + scorch) burnt.push(x, y, z);
  }
  for (let k = 0; k < at.length; k += 3) A.set(at[k], at[k + 1], at[k + 2], AIR);
  for (let k = 0; k < burnt.length; k += 3){
    const x = burnt[k], y = burnt[k + 1], z = burnt[k + 2];
    A.set(x, y, z, mixCell(A.cells[A.idx(x, y, z)], CHAR[0], CHAR[1], CHAR[2], char));
  }
  return { at: Int32Array.from(at), cols: Uint16Array.from(cols), box: [x0, y0, z0, x1 + 1, y1 + 1, z1 + 1] };
}

/* ---- loose pieces ------------------------------------------------------------
   After a blast, which solid pieces near it hang on nothing? A piece is
   SUPPORTED if it reaches bedrock (y = 0) through solid cells, 26-connected
   (corner contacts hold: the math world's sheets and tubes are made of
   balls, and a 6-connected rule would drop half a gyroid at the first
   shot). Seeds are the solid cells of the box with an air face (anything a
   blast cut loose touches the crater). Each seed's piece is walked depth
   first, downward neighbours popped first, so a supported piece usually
   finds bedrock in a few dozen steps; meeting a cell another walk labelled
   ends the walk (it was held); and a walk past `limit` cells counts as supported (a cliff too
   big to fall stays up: a limit on the work, said so). The rest are LOOSE:
   each comes back whole, as cell indices, for the caller to lift out
   (`detach`) and drop. The test holds it to a full labelling. */
export function looseAround(A, box, limit = 60000){
  const { X, Y, Z, XZ, cells } = A;
  const [bx0, by0, bz0, bx1, by1, bz1] = box;
  const label = new Map(), loose = [];
  let comp = 0;
  const stack = [];
  const airFace = (x, y, z, i) =>
    (x > 0 && !cells[i - 1]) || (x < X - 1 && !cells[i + 1]) || (y < Y - 1 && !cells[i + XZ]) ||
    (y > 0 && !cells[i - XZ]) || (z > 0 && !cells[i - X]) || (z < Z - 1 && !cells[i + X]) ||
    x === 0 || x === X - 1 || z === 0 || z === Z - 1 || y === Y - 1;
  for (let y = Math.max(0, by0); y < Math.min(Y, by1); y++) for (let z = Math.max(0, bz0); z < Math.min(Z, bz1); z++)
    for (let x = Math.max(0, bx0); x < Math.min(X, bx1); x++){
      const s = x + X * (z + Z * y);
      if (!cells[s] || label.has(s) || !airFace(x, y, z, s)) continue;
      const id = ++comp, members = [s];
      let held = y === 0;
      label.set(s, id); stack.length = 0; stack.push(s);
      walk: while (stack.length && !held){
        const i = stack.pop(), cx = i % X, t = (i - cx) / X, cz = t % Z, cy = (t - cz) / Z;
        if (cy === 0){ held = true; break; }
        for (let dy = 1; dy >= -1; dy--){ const ny = cy + dy; if (ny < 0 || ny >= Y) continue;
          for (let dz = -1; dz <= 1; dz++){ const nz = cz + dz; if (nz < 0 || nz >= Z) continue;
            for (let dx = -1; dx <= 1; dx++){ const nx = cx + dx; if (nx < 0 || nx >= X) continue;
              const j = nx + X * (nz + Z * ny);
              if (!cells[j]) continue;
              const l = label.get(j);
              if (l === undefined){ label.set(j, id); members.push(j); stack.push(j); }
              // Another walk's cell: always a held piece's, since a loose piece is walked whole
              // (its walk only ends when nothing is left), so nothing outside it touches it.
              else if (l !== id){ held = true; break walk; }
            } } }
        if (members.length > limit){ held = true; break; }
      }
      if (!held) loose.push(Int32Array.from(members));
    }
  return loose;
}

/* Lift cells out of the grid: their place (relative to the lowest corner),
   their colours, and that corner. Mass leaves the grid here and must come
   back through bake (debris-core). */
export function detach(A, list){
  const { X, Z } = A, n = list.length, offs = new Int16Array(3 * n), cols = new Uint16Array(n);
  let x0 = Infinity, y0 = Infinity, z0 = Infinity;
  const xyz = new Int32Array(3 * n);
  for (let k = 0; k < n; k++){
    const i = list[k], x = i % X, t = (i - x) / X, z = t % Z, y = (t - z) / Z;
    xyz[3 * k] = x; xyz[3 * k + 1] = y; xyz[3 * k + 2] = z;
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
  }
  for (let k = 0; k < n; k++){
    const x = xyz[3 * k], y = xyz[3 * k + 1], z = xyz[3 * k + 2];
    offs[3 * k] = x - x0; offs[3 * k + 1] = y - y0; offs[3 * k + 2] = z - z0;
    cols[k] = A.cells[list[k]];
    A.set(x, y, z, AIR);
  }
  return { origin: [x0, y0, z0], offs, cols };
}

/* ---- putting voxels back -----------------------------------------------------
   The nearest air cell to c (clamped into the arena), for a voxel that
   lands where its cell is taken: c itself; else the nearest within a few
   cells (by distance, then the higher, so rubble lands on a pile rather
   than in a cave under it); else the first air up c's column (the top of
   whatever it fell into); else wider shells. Throws only when the arena is
   full, so mass is never dropped quietly. */
export function nearestFree(A, c){
  const x = Math.min(A.X - 1, Math.max(0, c[0])), y = Math.min(A.Y - 1, Math.max(0, c[1])), z = Math.min(A.Z - 1, Math.max(0, c[2]));
  if (A.free(x, y, z)) return [x, y, z];
  const shell = (r) => {
    let best = null, bd = Infinity, by = -Infinity;
    for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++){
      if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue;
      if (!A.free(x + dx, y + dy, z + dz)) continue;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd || (d === bd && dy > by)){ best = [x + dx, y + dy, z + dz]; bd = d; by = dy; }
    }
    return best;
  };
  for (let r = 1; r <= 3; r++){ const p = shell(r); if (p) return p; }
  for (let yy = y + 1; yy < A.Y; yy++) if (A.free(x, yy, z)) return [x, yy, z];
  const far = Math.max(A.X, A.Y, A.Z);
  for (let r = 4; r <= far; r++){ const p = shell(r); if (p) return p; }
  throw new Error('arena: full, nowhere to put a voxel');
}

/* A voxel put at p settles: straight down while the cell under it is air,
   and if `slide` (molten slag, single grains), down a diagonal while one is
   open, the side and the cell under it both air (sand's angle of repose,
   one across for one down). The diagonals are tried in an order hashed from
   the place, so a pile spreads evenly. At most `steps` moves. */
const DIAG = [[1, 0], [-1, 0], [0, 1], [0, -1]];
export function settleDown(A, p, slide = false, steps = 512){
  let [x, y, z] = p;
  for (let s = 0; s < steps; s++){
    if (y > 0 && A.free(x, y - 1, z)){ y--; continue; }
    if (!slide || y === 0) break;
    const h = hash4(x, y, z, 7), o = h & 3;
    let moved = false;
    for (let k = 0; k < 4; k++){
      const [dx, dz] = DIAG[(o + k) & 3];
      if (A.free(x + dx, y, z + dz) && A.free(x + dx, y - 1, z + dz)){ x += dx; z += dz; y--; moved = true; break; }
    }
    if (!moved) break;
  }
  return [x, y, z];
}
