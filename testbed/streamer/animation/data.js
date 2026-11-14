/* ================== THE ANIMATION'S DATA (pure) =========================
   Everything the explainer shows is built here, with the repo's own cores
   (dag-core, chunk-core, stream-core) called unchanged, so the numbers on
   screen are measured, not copied. No DOM and no gl, so Node can import it:

     node animation/check.mjs

   prints every number the animation will show, and holds the town and the
   world to independent dense checks.

   Two worlds:

   - THE TOWN, D = 5 (32³). Sixteen columns of 8³ blocks on a 4 × 4 grid:
     houses facing four ways, towers stacked one to three blocks high, trees,
     a pond and a plain lawn. It's small enough to draw every node of its
     tree, and built from repeats, so hash-consing has something to do: a
     house is one level-3 node however many times it appears, and its four
     facings are four nodes but one Oh class.

   - THE WORLD, D = 11 (2048³). 64 × 64 towns, each turned by one of the four
     quarter turns about y (scene-core's Y_TURNS), chosen by a hash. It's
     what the cut, the chunk jobs and the lods run on. Its colour is the
     town's, read back through the turn.

   Colour is a field over voxels (colours.js's contract: colour(x, y, z)
   at a voxel's centre, rgb8), never part of the DAG: the pond and the lawn
   are the same node and different colours, which is the point the colour
   chapter makes.
   ======================================================================== */
import { createStore, createClasses, createCounts, census, applyG, INV, OH48, EMPTY, FULL, FIRST_NODE } from '../dag-core.js';
import { expandChunk, cellAttr, mortonOf, mortonXYZ, cellOf, maskOf, poseOf, chunkNode, CHUNK_LEVELS } from '../chunk-core.js';
import { createWorld, selectChunks } from '../stream-core.js';
import { attrRGB, attrOf8 } from '../attr-core.js';
import { createBaked, BLOCK as WORDS_A_BLOCK } from '../baked-core.js';

export const TOWN_D = 5, TOWN_R = 32, BLOCK = 8;
export const WORLD_D = 11;
export const Y_TURNS = [0, 41, 5, 44];          // scene-core.js's: the four quarter turns about y

/* ---- colours ------------------------------------------------------------ */
const rgb = (r, g, b) => (r & 255) | (g & 255) << 8 | (b & 255) << 16;
export const hexOf = c => [(c & 255) / 255, (c >> 8 & 255) / 255, (c >> 16 & 255) / 255];
function hash3(x, y, z, s = 0){
  let h = Math.imul(x + 1013 * s, 0x27d4eb2d) ^ Math.imul(y + 7, 0x165667b1) ^ Math.imul(z + 3, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
// A colour with a little per-voxel grain, so flat faces read as voxels.
const grain = (c, x, y, z, amt = 14) => {
  const k = (hash3(x, y, z, 9) - 0.5) * amt;
  return rgb(Math.max(0, Math.min(255, c[0] + k)), Math.max(0, Math.min(255, c[1] + k)), Math.max(0, Math.min(255, c[2] + k)));
};
const C = {
  stone: [112, 108, 120], dirt: [124, 86, 58], grass: [96, 168, 82], grass2: [120, 186, 90],
  wall: [236, 222, 196], post: [176, 150, 120], roof: [206, 84, 62], roof2: [170, 62, 50],
  door: [110, 70, 44], window: [255, 214, 120], tower: [150, 156, 172], towerDark: [118, 124, 142],
  slate: [74, 96, 150], trunk: [116, 80, 52], leaf: [62, 140, 76], leaf2: [92, 170, 84],
  water: [70, 150, 220], sand: [222, 204, 150], flag: [240, 190, 60],
};

/* ---- the blocks (8³, local coordinates 0..7, y up) -----------------------
   Each returns a colour (rgb8) or 0. Ground is three deep, so its middle
   layer is buried and the chunk chapter has something to cull. */
function ground(x, y, z){
  if (y === 0) return grain(C.stone, x, y, z);
  if (y === 1) return grain(C.dirt, x, y, z);
  if (y === 2) return grain((x + z) % 5 === 0 ? C.grass2 : C.grass, x, y, z, 18);
  return 0;
}
function pond(x, y, z){
  if (y === 2 && x >= 1 && x <= 6 && z >= 1 && z <= 6){
    const edge = x === 1 || x === 6 || z === 1 || z === 6;
    return grain(edge ? C.sand : C.water, x, y, z, 10);
  }
  return ground(x, y, z);
}
function house(x, y, z){
  const g = ground(x, y, z);
  if (g) return g;
  if (y >= 3 && y <= 4 && x >= 1 && x <= 6 && z >= 1 && z <= 6){
    const ex = x === 1 || x === 6, ez = z === 1 || z === 6;
    if (!ex && !ez) return 0;                       // hollow inside
    if (ex && ez) return grain(C.post, x, y, z, 8);
    if (z === 1 && (x === 3 || x === 4)) return y === 3 ? grain(C.door, x, y, z, 6) : grain(C.wall, x, y, z, 6);
    if (y === 4 && (ex ? (z === 3 || z === 4) : (x === 2 || x === 5))) return rgb(...C.window);
    return grain(C.wall, x, y, z, 6);
  }
  if (x >= 1 && x <= 6){
    if (y === 5 && z >= 0 && z <= 7) return grain(z === 0 || z === 7 ? C.roof2 : C.roof, x, y, z, 10);
    if (y === 6 && z >= 1 && z <= 6) return grain(C.roof, x, y, z, 10);
    if (y === 7 && z >= 2 && z <= 5) return grain(C.roof2, x, y, z, 10);
  }
  if (x === 5 && z === 6 && y === 7) return grain(C.stone, x, y, z);   // a chimney: makes the house chiral
  return 0;
}
const inCol = (x, z) => x >= 2 && x <= 5 && z >= 2 && z <= 5;
const towerWall = (x, y, z) => {
  const face = (x === 2 || x === 5) && (z === 3 || z === 4) || (z === 2 || z === 5) && (x === 3 || x === 4);
  if (face && y % 4 === 1) return rgb(...C.window);
  return grain((x + y + z) % 3 === 0 ? C.towerDark : C.tower, x, y, z, 10);
};
function towerBase(x, y, z){
  const g = ground(x, y, z);
  if (g) return g;
  return inCol(x, z) ? towerWall(x, y, z) : 0;
}
const towerMid = (x, y, z) => inCol(x, z) ? towerWall(x, y, z) : 0;
function towerTop(x, y, z){
  if (y <= 2) return inCol(x, z) ? towerWall(x, y, z) : 0;
  if (y === 3) return x >= 1 && x <= 6 && z >= 1 && z <= 6 ? grain(C.towerDark, x, y, z) : 0;
  if (y === 4) return (x === 1 || x === 6 || z === 1 || z === 6) && x >= 1 && x <= 6 && z >= 1 && z <= 6 && (x + z) % 2 === 1 ? grain(C.towerDark, x, y, z)
                    : inCol(x, z) ? grain(C.slate, x, y, z) : 0;
  if (y === 5) return inCol(x, z) ? grain(C.slate, x, y, z) : 0;
  if (y === 6) return x >= 3 && x <= 4 && z >= 3 && z <= 4 ? grain(C.slate, x, y, z) : 0;
  if (y === 7) return x === 3 && z === 3 ? rgb(...C.flag) : 0;
  return 0;
}
function tree(x, y, z){
  const g = ground(x, y, z);
  if (g) return g;
  if (y >= 3 && y <= 4 && x >= 3 && x <= 4 && z >= 3 && z <= 4) return grain(C.trunk, x, y, z, 8);
  if (y >= 5 && y <= 7 && x >= 1 && x <= 6 && z >= 1 && z <= 6){
    const dx = x - 3.5, dz = z - 3.5, dy = (y - 5.6) * 1.5, r = dx * dx + dz * dz + dy * dy;
    if (r <= 9.5) return grain(hash3(x, y, z, 3) < 0.5 ? C.leaf : C.leaf2, x, y, z, 16);
  }
  return 0;
}
const BLOCKS = { ground, pond, house, towerBase, towerMid, towerTop, tree };

// Quarter turns about the block's y axis: (x, z) -> (7 − z, x), f times.
function turnLocal(x, z, f){
  for (let i = 0; i < f; i++){ const t = x; x = 7 - z; z = t; }
  return [x, z];
}

/* The layout: one entry per column (bx, bz). H<f> a house facing f, T<n> a
   tower with n blocks above its base, P a tree, W the pond, G the lawn. */
export const LAYOUT = [
  ['H0', 'H1', 'T2', 'P' ],
  ['H3', 'W',  'H0', 'T1'],
  ['P',  'H2', 'H0', 'H1'],
  ['T3', 'H0', 'G',  'H2'],
];
// Every 8³ block of the town: { bx, by, bz, kind, face }.
export function townBlocks(){
  const out = [];
  for (let bz = 0; bz < 4; bz++) for (let bx = 0; bx < 4; bx++){
    const c = LAYOUT[bz][bx];
    if (c[0] === 'H') out.push({ bx, by: 0, bz, kind: 'house', face: +c[1] });
    else if (c === 'P') out.push({ bx, by: 0, bz, kind: 'tree', face: 0 });
    else if (c === 'W') out.push({ bx, by: 0, bz, kind: 'pond', face: 0 });
    else if (c === 'G') out.push({ bx, by: 0, bz, kind: 'ground', face: 0 });
    else {
      const n = +c[1];
      out.push({ bx, by: 0, bz, kind: 'towerBase', face: 0 });
      for (let k = 1; k < n; k++) out.push({ bx, by: k, bz, kind: 'towerMid', face: 0 });
      out.push({ bx, by: n, bz, kind: 'towerTop', face: 0 });
    }
  }
  return out;
}

/* ---- the town ---------------------------------------------------------- */
export function buildTown(store){
  const R = TOWN_R, occ = new Uint8Array(R * R * R), col = new Uint32Array(R * R * R);
  const blocks = townBlocks();
  for (const b of blocks){
    const fn = BLOCKS[b.kind];
    for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++){
      // The voxel at local (x, z) shows what the unturned block has at the
      // inverse turn: turning f times forward, so read 4 − f forward.
      const [ux, uz] = turnLocal(x, z, (4 - b.face) % 4);
      const c = fn(ux, y, uz);
      if (!c) continue;
      const i = (b.bx * 8 + x) + R * ((b.by * 8 + y) + R * (b.bz * 8 + z));
      occ[i] = 1; col[i] = c;
    }
  }
  const { root } = store.fromDense(occ, R);
  return { root, D: TOWN_D, R, occ, col, fill: fillNearest(occ, col, R), blocks };
}

/* A colour field is asked off its voxels too: a coarse mean samples sub-cell
   centres that may be air (shapes.mjs: "defined everywhere, not only
   inside"). A field that answers 0 there turns coarse towers black, which
   is what the first cut of this file did. So every empty voxel takes the
   colour of its nearest full one, by a breadth-first flood from all of
   them at once (6-connected, first come first served). */
function fillNearest(occ, col, R){
  const fill = new Uint32Array(col), seen = new Uint8Array(occ), q = new Int32Array(R * R * R);
  let head = 0, tail = 0;
  for (let i = 0; i < occ.length; i++) if (occ[i]) q[tail++] = i;
  const RR = R * R;
  while (head < tail){
    const i = q[head++], x = i % R, y = (i / R | 0) % R, z = i / RR | 0;
    const nb = [x > 0 ? i - 1 : -1, x < R - 1 ? i + 1 : -1, y > 0 ? i - R : -1, y < R - 1 ? i + R : -1, z > 0 ? i - RR : -1, z < R - 1 ? i + RR : -1];
    for (const j of nb) if (j >= 0 && !seen[j]){ seen[j] = 1; fill[j] = fill[i]; q[tail++] = j; }
  }
  return fill;
}

/* The node of each block: the level-3 node at its place. */
export function blockNode(store, town, b){
  let id = town.root;
  for (let k = TOWN_D - 1; k >= 3 && id >= FIRST_NODE; k--){
    const s = k - 3;
    id = store.child(id, (b.bx >> s & 1) | (b.by >> s & 1) << 1 | (b.bz >> s & 1) << 2);
  }
  return id;
}

/* ---- the town's tree, laid out --------------------------------------------
   Every node of the SVO down to `minLevel`, in depth-first (Morton) order:
   { level, id, x, y, z (node coords), parent (index), order (index within
   its level) }. The animation lays each level on a ring by `order`, and
   moves each node to its DAG slot (its id's rank among the level's ids). */
export function townTree(store, town, minLevel = 1){
  const nodes = [];
  const perLevel = new Map();
  const rec = (id, k, x, y, z, parent) => {
    if (id === EMPTY) return;
    const order = perLevel.get(k) || 0; perLevel.set(k, order + 1);
    const me = nodes.length;
    nodes.push({ level: k, id, x, y, z, parent, order });
    if (k <= minLevel || id < FIRST_NODE) return;
    for (let o = 0; o < 8; o++)
      rec(store.child(id, o), k - 1, 2 * x + (o & 1), 2 * y + (o >> 1 & 1), 2 * z + (o >> 2), me);
  };
  rec(town.root, TOWN_D, 0, 0, 0, -1);
  // DAG slots: unique ids per level, ranked by first appearance.
  const slots = new Map(), uniq = {};
  for (const n of nodes){
    const m = slots.get(n.level) || new Map();
    slots.set(n.level, m);
    if (!m.has(n.id)) m.set(n.id, m.size);
    n.slot = m.get(n.id);
  }
  for (const [k, m] of slots) uniq[k] = m.size;
  return { nodes, count: Object.fromEntries(perLevel), uniq };
}

/* ---- the world --------------------------------------------------------------
   64 × 64 towns, turned by hash. Built bottom-up from the town's turned
   copies, so it's a handful of interns; the store hash-conses the rest. */
export function turnOf(tx, tz){ return Y_TURNS[Math.floor(hash3(tx, 0, tz, 41) * 4)]; }
export function buildWorld(store, town, D = WORLD_D){
  const turned = Y_TURNS.map(e => store.transform(town.root, e));
  const n = 2 ** (D - TOWN_D);
  const ch = new Uint32Array(8);
  const build = (k, x, z) => {           // a node at level k whose y index is 0
    if (k === TOWN_D) return turned[Y_TURNS.indexOf(turnOf(x, z))];
    const kids = [];
    for (let o = 0; o < 8; o++) kids.push((o >> 1 & 1) ? EMPTY : build(k - 1, 2 * x + (o & 1), 2 * z + (o >> 2)));
    for (let o = 0; o < 8; o++) ch[o] = kids[o];
    return store.intern(k, ch);
  };
  const root = build(D, 0, 0);
  return { root, D, towns: n * n, turned };
}

/* Colour fields (colours.js's contract): colour(x, y, z) at a voxel centre,
   rgb8. The town's is a table; the world's reads it back through the turn
   of the town the voxel is in. Inverting a turn about the town's centre:
   p = g·q  <=>  q = g⁻¹·p, on coordinates centred at 15.5. */
const clampR = v => Math.max(0, Math.min(TOWN_R - 1, v));
export function townColour(town){
  const R = TOWN_R;
  return (x, y, z) => town.fill[clampR(Math.floor(x)) + R * (clampR(Math.floor(y)) + R * clampR(Math.floor(z)))];
}
/* The town voxel a world voxel shows: its town's turn undone. */
export function worldIndex(x, y, z){
  const R = TOWN_R, h = (R - 1) / 2;
  const i = Math.floor(x), j = clampR(Math.floor(y)), k = Math.floor(z);
  const e = turnOf(i >> TOWN_D, k >> TOWN_D);
  const q = applyG([(i & 31) - h, j - h, (k & 31) - h], INV[e]);
  return Math.round(q[0] + h) + R * (Math.round(q[1] + h) + R * Math.round(q[2] + h));
}
export function worldColour(town){
  return (x, y, z) => town.fill[worldIndex(x, y, z)];
}

/* ---- jobs ----------------------------------------------------------------
   A chunk job is expandChunk, keyed by its stamp: the seven nodes it reads
   (stream-core §2c), so a chunk that's a copy of one already done, with the
   same neighbours, costs nothing. The result is chunk-local, as a record
   is, so one job serves every copy: `words` is one face a word (cell
   x | y<<6 | z<<12 | face<<18, faces in the mask's order +X −X +Y −Y +Z −Z)
   and `cols` its rgb8, from the record's attribute word. The renderer
   places them with the chunk's origin and cell size, as the viewer's
   vertex shader does. */
export function createJobs(store, root, D, colour, { lodRule = 'shadow', classes = null } = {}){
  const counts = createCounts(store);
  const cache = new Map();
  let run = 0, asked = 0;
  const SIDES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  function stamp(c){
    const ids = [chunkNode(store, root, D, c.lod, c.x, c.y, c.z).id];
    for (const s of SIDES) ids.push(chunkNode(store, root, D, c.lod, c.x + s[0], c.y + s[1], c.z + s[2]).id);
    return c.lod + ':' + ids.join(',');
  }
  function job(c){
    asked++;
    const key = stamp(c);
    let hit = cache.get(key);
    if (!hit){
      run++;
      const t0 = performance.now();
      const out = expandChunk(store, root, D, { lod: c.lod, cx: c.x, cy: c.y, cz: c.z },
                              { counts, lodRule, colour, meanDepth: 1, classes });
      const n = out.count;
      let faces = 0;
      for (let i = 0; i < n; i++){ let m = maskOf(out.records[i]); while (m){ faces += m & 1; m >>= 1; } }
      const words = new Uint32Array(faces), cols = new Uint32Array(faces);
      let k = 0;
      for (let i = 0; i < n; i++){
        const r = out.records[i], [x, y, z] = mortonXYZ(cellOf(r)), m = maskOf(r);
        const [cr, cg, cb] = attrRGB(out.attrs[i]);
        const c = Math.round(cr * 255 / 63) | Math.round(cg * 255 / 63) << 8 | Math.round(cb * 255 / 63) << 16;
        for (let f = 0; f < 6; f++) if (m >> f & 1){ words[k] = (x | y << 6 | z << 12 | f << 18) >>> 0; cols[k] = c; k++; }
      }
      hit = { key, words, cols, count: n, faces, occupied: out.occupied, buried: out.buried, bytes: out.bytes, ms: performance.now() - t0 };
      cache.set(key, hit);
    }
    return hit;
  }
  return { job, stamp, counts, get run(){ return run; }, get asked(){ return asked; }, get cached(){ return cache.size; } };
}

/* ---- everything ------------------------------------------------------------ */
export function buildAll(){
  const t0 = performance.now();
  const store = createStore();
  const town = buildTown(store);
  const tCensus = census(store, [town.root]);
  const classes = createClasses(store, OH48);
  const cCensus = census(store, [town.root], [classes]);
  const tree = townTree(store, town, 1);
  const tColour = townColour(town);

  // The one-chunk job on the town (lod 0 to 3), every cell and its record.
  const counts = createCounts(store);
  const townJobs = [0, 1, 2, 3].map(lod => {
    const out = expandChunk(store, town.root, TOWN_D, { lod, cx: 0, cy: 0, cz: 0 },
                            { counts, lodRule: 'shadow', colour: tColour, meanDepth: 1, cells: true, classes });
    const recs = [];
    for (let i = 0; i < out.count; i++){
      const r = out.records[i], [x, y, z] = mortonXYZ(cellOf(r));
      recs.push({ r, x, y, z, mask: maskOf(r), pose: poseOf(r), cell: cellOf(r), attr: out.attrs[i] });
    }
    const shown = new Set(recs.map(q => q.x | q.y << 8 | q.z << 16));
    const buried = [];
    for (const p of out.cells) if (!shown.has(p)) buried.push([p & 255, p >> 8 & 255, p >> 16]);
    return { lod, out, recs, buried, cellSize: out.cellSize };
  });

  // Each block's node and class.
  const blocks = town.blocks.map(b => {
    const id = blockNode(store, town, b);
    return { ...b, id, cls: classes.cls(id), pose: classes.pose(id) };
  });

  const colour = buildColour(store, town, townJobs, tColour);

  // The world: towns turned, then the cut and its jobs.
  const sizeBefore = store.size;
  const world = buildWorld(store, town, WORLD_D);
  const wCensus = census(store, [world.root]);
  const wCounts = createCounts(store);
  const wColour = worldColour(town);
  const streamWorld = createWorld(store, world.root, WORLD_D);
  const jobs = createJobs(store, world.root, WORLD_D, wColour);

  // The town the camera starts from: the unturned one nearest the middle,
  // so the world chapter can grow out of the town without a jump.
  let focus = null;
  for (let r = 0; r < 32 && !focus; r++)
    for (let dz = -r; dz <= r && !focus; dz++) for (let dx = -r; dx <= r && !focus; dx++)
      if (Math.max(Math.abs(dx), Math.abs(dz)) === r && turnOf(32 + dx, 32 + dz) === 0) focus = [32 + dx, 32 + dz];

  // The record the chunk chapter decodes: a window of a turned house, so
  // its brick's pose isn't the identity.
  const turnedHouse = blocks.find(b => b.kind === 'house' && b.face === 1);
  const pick = townJobs[0].recs.find(q => (q.x >> 3) === turnedHouse.bx && (q.z >> 3) === turnedHouse.bz && q.y === 4
    && town.col[q.x + 32 * (q.y + 32 * q.z)] === rgb(...C.window));

  // The coarse cell the colour chapter takes apart: a lod-1 cell over a
  // roof's edge, part full and of more than one colour.
  // Of the cells nothing stands over, the one whose voxels differ most.
  let merge = null, best = -1;
  const spread = cs => {
    let m = 0;
    for (const a of cs) for (const b of cs)
      m = Math.max(m, Math.abs((a & 255) - (b & 255)) + Math.abs((a >> 8 & 255) - (b >> 8 & 255)) + Math.abs((a >> 16 & 255) - (b >> 16 & 255)));
    return m;
  };
  for (const q of townJobs[1].recs){
    if (q.y < 2) continue;
    const kids = [];
    for (let o = 0; o < 8; o++){
      const x = 2 * q.x + (o & 1), y = 2 * q.y + (o >> 1 & 1), z = 2 * q.z + (o >> 2);
      const i = x + 32 * (y + 32 * z);
      kids.push({ o, x, y, z, on: !!town.occ[i], col: town.col[i] });
    }
    const on = kids.filter(k => k.on);
    let open = true;
    for (let y = 2 * q.y + 2; y < 32 && open; y++) for (let o = 0; o < 4; o++)
      if (town.occ[(2 * q.x + (o & 1)) + 32 * (y + 32 * (2 * q.z + (o >> 1)))]) open = false;
    if (!open || on.length < 3 || on.length > 6) continue;
    const sp = spread(on.map(k => k.col));
    if (sp > best){ best = sp; merge = { rec: q, kids }; }
  }

  // How the world would grow: one more level of 2 × 2 copies costs one node.
  const growth = [];
  for (let D = TOWN_D; D <= 30; D++){
    const side = 2 ** D, towns = 4 ** (D - TOWN_D);
    growth.push({ D, side, towns, voxels: towns * tCensus.svo[0] });
  }

  return {
    ms: performance.now() - t0,
    store, town, tree, classes, blocks, townJobs,
    census: tCensus, classCensus: cCensus,
    world, worldCensus: wCensus, worldCounts: wCounts, worldNodesAdded: store.size - sizeBefore,
    streamWorld, jobs, select: (eye, opts) => selectChunks(streamWorld, eye, opts),
    townColour: tColour, worldColour: wColour, growth, focus, pick, merge, turnOf, colour,
  };
}

export { mortonXYZ, CHUNK_LEVELS, EMPTY, FULL, FIRST_NODE };

/* ---- the colour chapters ------------------------------------------------------
   Four chapters follow colour down the hierarchy, each from the cores:

   - the pyramid: the town at lods 0–5 under the any rule (every non-empty
     node a cell), each cell's word the exact mean (cellAttr with meanDepth =
     lod, so the walk reaches the voxels), and one voxel's ancestors, their
     voxel counts and their words;
   - the walk: one lod-2 cell, as cellAttr walks it at meanDepth 1 (the
     viewer's): its occupied level-1 children, each a count times the field at
     its centre, against the exact mean (meanDepth 2). The cell picked is the
     town's worst for that error, so the gap has something to show;
   - the baked field: the town's skin (every voxel the lod-0 job shows),
     its words in Morton rank order, createBaked over them, one voxel's rank
     walk traced level by level, and one brick's rank range with the block
     sums and scans its mean costs. */
function buildColour(store, town, townJobs, tColour){
  const R = TOWN_R;
  const counts = createCounts(store);
  const nodeOf = (level, X, Y, Z) => {
    let id = town.root;
    for (let k = TOWN_D - 1; k >= level && id >= FIRST_NODE; k--){
      const s = k - level;
      id = store.child(id, (X >> s & 1) | (Y >> s & 1) << 1 | (Z >> s & 1) << 2);
    }
    return id;
  };
  const exactWord = (level, X, Y, Z) => cellAttr(store, counts, tColour, nodeOf(level, X, Y, Z), level, level, X << level, Y << level, Z << level);

  // The pyramid.
  const pyramid = [0, 1, 2, 3, 4, 5].map(lod => {
    const out = expandChunk(store, town.root, TOWN_D, { lod, cx: 0, cy: 0, cz: 0 },
                            { counts, lodRule: 'any', colour: tColour, meanDepth: lod });
    const recs = [];
    for (let i = 0; i < out.count; i++){ const [x, y, z] = mortonXYZ(cellOf(out.records[i])); recs.push({ x, y, z, attr: out.attrs[i] }); }
    return { lod, cellSize: out.cellSize, recs, count: out.count, occupied: out.occupied };
  });
  // One voxel up the pyramid: the flag on the tallest tower.
  const tall = town.blocks.filter(b => b.kind === 'towerTop').sort((a, b) => b.by - a.by)[0];
  const v = [tall.bx * 8 + 3, tall.by * 8 + 7, tall.bz * 8 + 3];
  const lineage = [0, 1, 2, 3, 4, 5].map(l => {
    const X = v[0] >> l, Y = v[1] >> l, Z = v[2] >> l, id = nodeOf(l, X, Y, Z);
    return { level: l, X, Y, Z, id, count: counts.of(id), word: exactWord(l, X, Y, Z) };
  });

  // The walk: the lod-2 cell whose meanDepth-1 word is furthest from exact.
  const dist = (a, b) => { const p = attrRGB(a), q = attrRGB(b); return Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]); };
  let walk = null;
  for (let Z = 0; Z < 8; Z++) for (let Y = 0; Y < 8; Y++) for (let X = 0; X < 8; X++){
    const id = nodeOf(2, X, Y, Z);
    if (id < FIRST_NODE) continue;
    const kids = [];
    for (let o = 0; o < 8; o++){
      const c = store.child(id, o);
      if (c === EMPTY) continue;
      const cx = 4 * X + 2 * (o & 1), cy = 4 * Y + 2 * (o >> 1 & 1), cz = 4 * Z + 2 * (o >> 2);
      const sample = [cx + 1, cy + 1, cz + 1];           // meanUnder: corner + 2^level / 2
      const vox = [];
      for (let j = 0; j < 8; j++){
        const x = cx + (j & 1), y = cy + (j >> 1 & 1), z = cz + (j >> 2), i = x + R * (y + R * z);
        if (town.occ[i]) vox.push({ x, y, z, col: town.col[i] });
      }
      const si = sample[0] + R * (sample[1] + R * sample[2]);
      kids.push({ o, corner: [cx, cy, cz], count: counts.of(c), sample, sampleCol: tColour(sample[0], sample[1], sample[2]),
                  sampleAir: !(sample.every(q => q < R) && town.occ[si]), vox });
    }
    if (kids.length < 4) continue;
    const md1 = cellAttr(store, counts, tColour, id, 2, 1, 4 * X, 4 * Y, 4 * Z), exact = exactWord(2, X, Y, Z);
    const d = dist(md1, exact);
    if (!walk || d > walk.err) walk = { X, Y, Z, id, count: counts.of(id), kids, md1, exact, err: d };
  }

  // The baked field: the skin is every voxel the lod-0 job shows.
  const skinOcc = new Uint8Array(R * R * R);
  for (const q of townJobs[0].recs) skinOcc[q.x + R * (q.y + R * q.z)] = 1;
  const skinRoot = store.fromDense(skinOcc, R).root;
  const order = [];
  for (let i = 0; i < skinOcc.length; i++) if (skinOcc[i]){ const x = i % R, y = (i / R | 0) % R, z = i / (R * R) | 0; order.push([mortonOf(x, y, z), x, y, z, i]); }
  order.sort((a, b) => a[0] - b[0]);
  const words = Uint32Array.from(order, o => town.col[o[4]]);
  const bCounts = createCounts(store);
  const baked = createBaked(store, skinRoot, TOWN_D, words, { counts: bCounts });
  const skin = order.map(([, x, y, z]) => [x, y, z]);
  // One voxel's rank, walked as descend does, level by level.
  const trace = [];
  let id = skinRoot, start = 0;
  for (let k = TOWN_D; k > 0; k--){
    const sft = k - 1, o = (v[0] >> sft & 1) | (v[1] >> sft & 1) << 1 | (v[2] >> sft & 1) << 2;
    const before = [];
    for (let j = 0; j < o; j++) before.push({ o: j, n: bCounts.of(store.child(id, j)) });
    const add = before.reduce((a, b) => a + b.n, 0);
    trace.push({ level: k, o, before, add, start, corner: [v[0] >> k << k, v[1] >> k << k, v[2] >> k << k] });
    start += add; id = store.child(id, o);
  }
  const rank = start;
  // One brick's range: the first house turned a quarter.
  const hb = town.blocks.find(b => b.kind === 'house' && b.face === 1);
  const [r0, n] = baked.range(3, hb.bx, hb.by, hb.bz);
  const A = Math.ceil(r0 / WORDS_A_BLOCK), B = Math.floor((r0 + n) / WORDS_A_BLOCK);
  const before = baked.stats.scanned;
  const mean = Array.from(baked.mean(3, hb.bx * 8, hb.by * 8, hb.bz * 8));
  const scanned = baked.stats.scanned - before;
  const direct = [0, 0, 0];
  for (let i = r0; i < r0 + n; i++){ const w = words[i]; direct[0] += w & 255; direct[1] += w >> 8 & 255; direct[2] += w >> 16 & 255; }
  const range = { block: hb, start: r0, n, A, B, head: A < B ? A * WORDS_A_BLOCK - r0 : n, tail: A < B ? r0 + n - B * WORDS_A_BLOCK : 0,
                  rows: A < B ? B - A : 0, scanned, mean, word: attrOf8(mean[0], mean[1], mean[2]),
                  direct: direct.map(c => c / n) };

  return { pyramid, flag: v, lineage, walk, words, skin, skinCount: words.length, baked, rank, trace, range,
           blockSums: Math.floor(words.length / WORDS_A_BLOCK) + 1, sumBytes: baked.bytes };
}
