/* ================== SPACETIME CORE ===================================
   Generator #8 (`?g=spacetime`, design in spacetime.md): a 2D cellular
   automaton with time as height. The automaton runs on the floor (x, z)
   and its generations are stacked, generation 0 at the top, time running
   down: a voxel (x, y, z) is filled if cell (x, z) is alive in the
   generation drawn at layer y.

     ca      the rule: Conway's B/S notation and Wolfram's outer
             totalistic code are the same thing (bit 2n + c says what a
             cell in state c with n live neighbours becomes)
     start   generation 0: a centred seed (dot, plus, ring), or a motif
             or soup in one quadrant that the fold copies round the centre
     time    forward (generations 0 … R−1 on a window onto an infinite
             plane), or mirrored (Fredkin's next = rule(now) XOR previous,
             started from the seed twice, so the history runs the same way
             both ways and the specimen is an hourglass)
     draw    alive, or trail (alive now or a generation before, which
             joins up rules whose children touch their parents only along
             an edge); auto is the rule's own choice per time mode

   Every rule is outer totalistic, so it commutes with the eight
   symmetries of the square: a seed with some symmetry keeps it in every
   generation, and the fold is exact by construction. Time isn't space,
   so a fold may only move x and z: a group that moves y falls back to
   the part of it that keeps y (Oh → C4v, Td → C2v on the diagonals,
   C3 and S6 → C1).

   No rule is born from nothing (no B0), so a cell outside the live cells'
   box grown by one stays dead: each generation is computed on that box
   only, on a plane big enough that nothing ever reaches its edge, which
   is exactly the infinite plane. The seed picks a motif's distance from
   the centre and a soup's cells.

   Then the shared instanceArrays(), so everything downstream is shared.
   No orbit labels: specimens are coloured by position in every mode.
   Pure like the other cores: no DOM, no THREE, runs in the worker.
   ================================================================ */
import { createBimoblockCore } from './bimoblock-core.js';

export const NEIGHBOURHOODS = [{ name:'Moore', short:'M', n:8 }, { name:'von Neumann', short:'vN', n:4 }];
export const DRAW_NAMES = ['auto', 'alive', 'trail'];
const ALIVE = 1, TRAIL = 2;
/* The rules, only ever appended. `auto` is the draw for [forward,
   mirrored], picked from pictures: trail where alive leaves cubes that
   touch only along edges (Seeds forward: 45% lone cubes), alive where
   trail would fill a checkerboard solid (Seeds and code 518 mirrored) or
   adds little (the Life family). */
export const RULES = [
  { name:'Life',              nb:0, B:[3],          S:[2, 3],             auto:[ALIVE, ALIVE] },
  { name:'HighLife',          nb:0, B:[3, 6],       S:[2, 3],             auto:[ALIVE, ALIVE] },
  { name:'Day & Night',       nb:0, B:[3, 6, 7, 8], S:[3, 4, 6, 7, 8],    auto:[ALIVE, ALIVE] },
  { name:'Seeds',             nb:0, B:[2],          S:[],                 auto:[TRAIL, ALIVE] },
  { name:'Gnarl',             nb:0, B:[1],          S:[1],                auto:[TRAIL, TRAIL] },
  { name:'Replicator',        nb:0, B:[1, 3, 5, 7], S:[1, 3, 5, 7],       auto:[ALIVE, ALIVE] },
  { name:'Life without death', nb:0, B:[3],         S:[0, 1, 2, 3, 4, 5, 6, 7, 8], auto:[ALIVE, ALIVE] },
  { name:'Serviettes',        nb:0, B:[2, 3, 4],    S:[],                 auto:[TRAIL, TRAIL] },
  { name:'code 462',          nb:1, B:[1, 3, 4],    S:[0, 1, 3],          auto:[ALIVE, ALIVE] },
  { name:'code 614',          nb:1, B:[1, 3],       S:[0, 2, 4],          auto:[ALIVE, ALIVE] },
  { name:'code 518',          nb:1, B:[1],          S:[0, 4],             auto:[TRAIL, ALIVE] },
  { name:'code 134',          nb:1, B:[1],          S:[0, 3],             auto:[TRAIL, ALIVE] },
  { name:'code 92',           nb:1, B:[1, 2, 3],    S:[1],                auto:[ALIVE, ALIVE] },
  { name:'code 180',          nb:1, B:[1, 2],       S:[2, 3],             auto:[ALIVE, TRAIL] },
  { name:'code 492',          nb:1, B:[1, 3, 4],    S:[1, 2, 3],          auto:[ALIVE, ALIVE] },
  { name:'code 118',          nb:1, B:[1, 2, 3],    S:[0, 2],             auto:[ALIVE, ALIVE] }
];
export const RULE_NAMES = RULES.map(r => r.name);
/* Wolfram's outer totalistic code: bit 2n + c for state c, n neighbours. */
export const ruleCode = r => r.B.reduce((a, n) => a + 2 ** (2 * n), 0) + r.S.reduce((a, n) => a + 2 ** (2 * n + 1), 0);
export const ruleBS = r => `B${r.B.join('')}/S${r.S.join('')}`;
/** The B/S sets of a code on a neighbourhood. @param {number} code @param {number} nb */
export function codeRule(code, nb){
  const B = [], S = [];
  for (let n = 0; n <= NEIGHBOURHOODS[nb].n; n++){
    if (Math.floor(code / 2 ** (2 * n)) % 2) B.push(n);
    if (Math.floor(code / 2 ** (2 * n + 1)) % 2) S.push(n);
  }
  return { B, S };
}

/* Seeds, only ever appended. Cells are (column, row) = (x, z) offsets;
   the motifs sit in the + quadrant with their corner toward the centre,
   oriented so the glider flies away from it. */
export const SEED_NAMES = ['dot', 'plus', 'ring', 'R-pentomino', 'glider', 'B-heptomino', 'acorn', 'soup'];
export const CENTRED_SEEDS = 3;
const MOTIFS = [
  ['.##', '##.', '.#.'],
  ['.#.', '..#', '###'],
  ['#.##', '###.', '.#..'],
  ['.#.....', '...#...', '##..###']
].map(rows => rows.flatMap((row, b) => [...row].flatMap((ch, a) => ch === '#' ? [[a, b]] : [])));
export const SOUP_SIZE = 5;
/* The farthest a seed cell sits from the centre, in cells: an acorn
   three cells out. */
const SEED_REACH = 12;
export const TIME_NAMES = ['forward', 'mirrored'];

/** @param {ReturnType<typeof createBimoblockCore>} [bimo] reuse an existing bimoblock core */
export function createSpacetimeCore(bimo = createBimoblockCore()){
  const { GROUPS, applyG, envelope, levelResolution, seedWords } = bimo;

  /* A seeded hash of (salt, i), as on nest pages. */
  const pick = (W, salt, i) => {
    let h = Math.imul(W.lo ^ Math.imul(salt + 1, 0x9e3779b1), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ W.hi ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = Math.imul(h ^ Math.imul(i + 1, 0x27d4eb2d) ^ (h >>> 16), 0x2c1b3c6d) >>> 0;
    return (h ^ (h >>> 15)) >>> 0;
  };

  /* The fold that time allows: the elements of GROUPS[sym] that fix +y,
     each as a 2×2 integer matrix on (x, z), and the group they make. */
  const sameSet = (a, b) => a.length === b.length && a.every(e => b.includes(e));
  function timeFold(sym){
    const G = GROUPS[sym | 0];
    const els = G.els.filter(e => { const w = applyG([0, 1, 0], e); return w[0] === 0 && w[1] === 1 && w[2] === 0; });
    const mats = els.map(e => { const x = applyG([1, 0, 0], e), z = applyG([0, 0, 1], e); return [x[0], z[0], x[2], z[2]]; });
    const match = GROUPS.find(g => sameSet(g.els, els));
    return { els, mats, name: match ? match.name : 'C2v:diagonal', moved: els.length < G.els.length };
  }

  /* Generation 0 in doubled centred coordinates (u = 2x − (R − 1), so
     odd at even R and even at odd R), copied under the fold. The centred
     seeds are defined by a distance in doubled units, so each has an
     odd-R and an even-R version that is already fully symmetric. */
  function seedCells(N, R, mats){
    const start = N.start | 0, W = seedWords(N.seed), base = R % 2 ? 0 : 1;
    const cells = [];
    let offset = null;
    if (start < CENTRED_SEEDS){
      const lim = base + 6;
      for (let u = -lim; u <= lim; u += 2) for (let w = -lim; w <= lim; w += 2){
        const a = Math.abs(u), b = Math.abs(w), m = Math.max(a, b);
        if (start === 0 ? m <= 1 : start === 1 ? Math.min(a, b) <= 1 && m <= 3 : m === 2 || m === 3) cells.push([u, w]);
      }
    } else {
      let shape;
      if (start < 7){ offset = pick(W, 1, start) % 4; shape = MOTIFS[start - CENTRED_SEEDS]; }
      else {
        offset = 0;
        shape = [];
        for (let k = 0; k < SOUP_SIZE * SOUP_SIZE; k++) if (pick(W, 2, k) & 1) shape.push([k % SOUP_SIZE, Math.floor(k / SOUP_SIZE)]);
        if (!shape.length) shape.push([0, 0]);
      }
      const o = base + 2 * offset;
      for (const [a, b] of shape) for (const [p, q, r, s] of mats){
        const u = o + 2 * a, w = o + 2 * b;
        cells.push([p * u + q * w, r * u + s * w]);
      }
    }
    return { cells, offset };
  }

  /* The run: `steps` generations after the seed on a P × P plane, as
     windows of the central R × R. Each step is computed on the live box
     grown by one; the plane is wide enough that the box never reaches
     its edge, so the run is the infinite plane's. For tests, `extra`
     widens the plane further and `cells` replaces the seed (doubled
     centred coordinates, unfolded). */
  function history(N, R, { extra = 0, cells: given = null } = {}){
    const rule = RULES[N.ca | 0] ?? RULES[0], mirrored = (N.time | 0) === 1;
    const steps = mirrored ? Math.ceil(R / 2) - 1 : R - 1;
    const P = R + 2 * (steps + SEED_REACH + 2 + extra), off = (P - R) / 2;
    const fold = timeFold(N.sym);
    const { cells, offset } = given ? { cells: given, offset: null } : seedCells(N, R, fold.mats);
    /* Wolfram's code as a lookup: T[2n + c]. */
    const T = new Uint8Array(2 * 9 + 2);
    for (const n of rule.B) T[2 * n] = 1;
    for (const n of rule.S) T[2 * n + 1] = 1;
    const moore = rule.nb === 0;

    let cur = new Uint8Array(P * P);
    let box = [P, P, -1, -1], seedCount = 0;
    const grow = (b, x, z) => { if (x < b[0]) b[0] = x; if (z < b[1]) b[1] = z; if (x > b[2]) b[2] = x; if (z > b[3]) b[3] = z; };
    for (const [u, w] of cells){
      const x = (u + P - 1) / 2, z = (w + P - 1) / 2;
      seedCount += 1 - cur[x + P * z];
      cur[x + P * z] = 1;
      grow(box, x, z);
    }
    let prev = mirrored ? cur : new Uint8Array(P * P), prevBox = mirrored ? box : [P, P, -1, -1];

    const windows = [], population = [];
    const take = g => {
      const win = new Uint8Array(R * R);
      let n = 0;
      for (let z = 0; z < R; z++) for (let x = 0; x < R; x++) n += win[x + R * z] = g[(x + off) + P * (z + off)];
      windows.push(win);
      population.push(n);
    };
    take(cur);
    let extinct = box[2] < 0 ? 0 : null;
    for (let t = 1; t <= steps; t++){
      const next = new Uint8Array(P * P), nbox = [P, P, -1, -1];
      const x0 = Math.min(box[0], prevBox[0]) - 1, z0 = Math.min(box[1], prevBox[1]) - 1;
      const x1 = Math.max(box[2], prevBox[2]) + 1, z1 = Math.max(box[3], prevBox[3]) + 1;
      if (x0 < 1 || z0 < 1 || x1 > P - 2 || z1 > P - 2) throw new Error('spacetime: the run reached the plane edge');
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++){
        const i = x + P * z;
        let n = cur[i - 1] + cur[i + 1] + cur[i - P] + cur[i + P];
        if (moore) n += cur[i - P - 1] + cur[i - P + 1] + cur[i + P - 1] + cur[i + P + 1];
        const v = T[2 * n + cur[i]] ^ (mirrored ? prev[i] : 0);
        if (v){ next[i] = 1; grow(nbox, x, z); }
      }
      prev = cur; prevBox = box; cur = next; box = nbox;
      take(cur);
      if (extinct === null && box[2] < 0 && !mirrored) extinct = t;
    }
    return { windows, population, extinct, fold, offset, seedCount, plane: P, rule, mirrored };
  }

  /** The draw a recipe resolves to: ALIVE or TRAIL. */
  const drawOf = N => (N.draw | 0) || (RULES[N.ca | 0] ?? RULES[0]).auto[(N.time | 0) === 1 ? 1 : 0];

  /** An OccResult with no orbit labels.
   *  @param {import('../types.js').SpacetimeRecipe} N @param {import('../types.js').Level[]} levels
   *  @returns {Omit<import('../types.js').OccResult, 'orbit' | 'orbitOrder'> & {meta:Object}} */
  function spacetimeOcc(N, levels){
    const started = performance.now();
    const R = levelResolution(levels), h = R - 1, inv = 1 / (h || 1), RR = R * R;
    const H = history(N, R), draw = drawOf(N), gens = H.windows.length;
    /* The generation each layer shows. Forward: top to bottom. Mirrored:
       generation t at both R/2 − 1 − t and R/2 + t (even R), or both
       sides of a shared middle layer (odd R), since g(t) = g(−1 − t). */
    const genAt = y => !H.mirrored ? h - y : R % 2 ? Math.abs(y - h / 2) : y < R / 2 ? R / 2 - 1 - y : y - R / 2;
    // Trail: alive now or a generation before (by generation, so the mirror holds).
    const shown = H.windows.map((win, t) => {
      if (draw !== TRAIL || t === 0) return win;
      const out = new Uint8Array(RR), before = H.windows[t - 1];
      for (let i = 0; i < RR; i++) out[i] = win[i] | before[i];
      return out;
    });
    /* The clip is read at each fold orbit's first cell in scan order, as
       in the other cores, so a clipped block keeps the fold; the
       automaton is read at every cell, and is fold-invariant by
       construction (tested). The fold keeps y, so its orbits lie in one
       layer. */
    const occ = new Uint8Array(RR * R), visited = new Uint8Array(RR), mats = H.fold.mats;
    let filled = 0, envelopeCells = 0;
    for (let y = 0; y < R; y++){
      const layer = shown[genAt(y)], Y = 2 * y - h;
      visited.fill(0);
      for (let z = 0; z < R; z++) for (let x = 0; x < R; x++){
        if (visited[x + R * z]) continue;
        const X = 2 * x - h, Z = 2 * z - h;
        const inside = envelope(X * inv, Y * inv, Z * inv, N.arch);
        for (const [p, q, r, s] of mats){
          const ux = (p * X + q * Z + h) / 2, uz = (r * X + s * Z + h) / 2, cell = ux + R * uz;
          if (visited[cell]) continue;
          visited[cell] = 1;
          if (!inside) continue;
          envelopeCells++;
          if (layer[cell]){ occ[ux + R * y + RR * uz] = 1; filled++; }
        }
      }
    }
    return { occ, R, filled, envelopeCells,
      meta: { gens, population: H.population[gens - 1], extinct: H.extinct, fold: H.fold.name, foldOrder: H.fold.els.length, moved: H.fold.moved,
              offset: H.offset, seedCells: H.seedCount, draw: DRAW_NAMES[draw], fill: filled / (RR * R) },
      timings: { evaluate: performance.now() - started, select: 0 } };
  }

  /** @param {import('../types.js').SpacetimeRecipe} N @param {import('../types.js').Level[]} levels
   *  @returns {import('../types.js').BuildResult} */
  function buildSpacetime(N, levels){
    const started = performance.now();
    const src = spacetimeOcc(N, levels);
    const instances = bimo.instanceArrays(src.occ, 0, src.filled, levels, src.R);
    return { occ: src.occ, R: src.R, filled: src.filled, envelopeCells: src.envelopeCells, instances,
      meta: src.meta,
      timings: { evaluate: src.timings.evaluate, select: 0,
        mesh: instances.timings.mesh, bounds: instances.timings.bounds,
        total: performance.now() - started } };
  }

  /* For tests: the run and the fold on their own. */
  return { buildSpacetime, spacetimeOcc, history, timeFold, seedCells };
}
