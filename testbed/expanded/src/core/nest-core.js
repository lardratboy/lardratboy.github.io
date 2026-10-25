/* ================== NESTBLOCK CORE ===================================
   Generator #7 (`?g=nest`, design in nestblocks.md): blocks made of
   smaller copies of themselves. A bimoblock's structure comes from its
   fold, its envelope and its tiers, and its noise from a scalar field cut
   at a threshold. A nestblock keeps the fold and the tiers and has no
   field at all: every voxel is decided by one rule applied at every tier.

     Cut the cube into r × r × r children. Keep some of them. Each kept
     child is a smaller copy of the next tier, which is cut the same way.

   A child's class is how many of its coordinates are on the outer layer
   (core, face, edge, corner), and a rule is a set of classes, so there
   are exactly 15 rules: edge + corner is the Menger sponge, core + face
   the Vicsek cross. The outer tier takes one rule and the inner tiers
   another (or the same, a self-similar fractal).

     outer   the outer tier's rule
     inner   the inner tiers' rule, or the same as the outer
     carve   under a fold smaller than Oh a class splits into orbits; carve
             keeps a share of each kept class's orbits (at least one), so
             the rule keeps its classes and the fold stays exact
     twist   each kept child is a turned (or turned and mirrored) copy,
             passed on round its orbit so the fold stays exact; a turn
             only shows on a child that isn't symmetric under it, so it
             needs a carve and a fold below Oh first

   The seed picks which orbits a carve keeps and the turn each orbit gets,
   once per radix, so tiers of the same radix repeat them exactly. There
   is no density: the rules set the fill. Radix 2 has only corners, so a
   rule with no corners falls back to corners there.

   Then the shared instanceArrays(), so everything downstream is shared.
   No orbit labels: specimens are coloured by position in every mode.
   Pure like the other cores: no DOM, no THREE, runs in the worker.
   ================================================================ */
import { createBimoblockCore } from './bimoblock-core.js';

export const CLASS_NAMES = ['core', 'face', 'edge', 'corner'];
/* Rule k keeps the classes in the bits of k + 1 (core 1, face 2, edge 4,
   corner 8). Four classes give exactly 15 rules at any radix, so the
   catalogue is complete and never appended. */
export const RULE_NAMES = ['dot', 'faces', 'vicsek cross', 'edges', 'even checker', 'mosely snowflake',
  'heavy mosely', 'cantor dust', 'saltire', 'odd checker', 'jack', 'menger sponge', 'menger + core',
  'hollow', 'solid'];
export const ruleMask = rule => (rule | 0) + 1;
export const ruleClasses = rule => CLASS_NAMES.filter((_, c) => ruleMask(rule) >> c & 1).join(' + ');
/* The inner dial: 0 is the outer rule again, k the rule k − 1. */
export const INNER_NAMES = ['same as outer', ...RULE_NAMES];
export const innerRule = N => (N.inner | 0) ? (N.inner | 0) - 1 : N.outer | 0;
export const CARVES = [{ name:'none', share:1 }, { name:'¾', share:0.75 }, { name:'½', share:0.5 }, { name:'¼', share:0.25 }];
export const CARVE_NAMES = CARVES.map(c => c.name);
export const TWIST_NAMES = ['none', 'turns', 'turns + mirrors'];
/* What a tier keeps when its rule keeps no child at its radix (radix 2,
   where every child is a corner). */
export const FALLBACK_MASK = 8;

/** @param {ReturnType<typeof createBimoblockCore>} [bimo] reuse an existing bimoblock core */
export function createNestCore(bimo = createBimoblockCore()){
  const { GROUPS, applyG, mulE, envelope, levelResolution, seedWords } = bimo;

  /* The cube group as tables: products, inverses, which elements are
     turns, and each element as a signed permutation for the inner loop
     (applyG(v, e)[j] = SG[3e + j] · v[PM[3e + j]]). */
  const MUL = new Uint8Array(48 * 48), INV = new Uint8Array(48), ROT = new Uint8Array(48);
  const PM = new Uint8Array(144), SG = new Int8Array(144);
  for (let a = 0; a < 48; a++){
    for (let b = 0; b < 48; b++){ MUL[a * 48 + b] = mulE(a, b); if (MUL[a * 48 + b] === 0) INV[a] = b; }
    const w = applyG([1, 2, 3], a);
    for (let j = 0; j < 3; j++){ PM[3 * a + j] = Math.abs(w[j]) - 1; SG[3 * a + j] = Math.sign(w[j]); }
    const x = applyG([1, 0, 0], a), y = applyG([0, 1, 0], a), z = applyG([0, 0, 1], a);
    ROT[a] = x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]) > 0 ? 1 : 0;
  }

  /* A seeded hash of (radix, child, salt): the same for every tier of a
     radix and every rule, so a carve or a turn never depends on which
     rule or tier asks. */
  const pick = (W, r, i, salt) => {
    let h = Math.imul(W.lo ^ Math.imul(r * 0x10001 + salt, 0x9e3779b1), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ W.hi ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = Math.imul(h ^ Math.imul(i + 1, 0x27d4eb2d) ^ (h >>> 16), 0x2c1b3c6d) >>> 0;
    return (h ^ (h >>> 15)) >>> 0;
  };

  /* One tier's table at radix r: which children are kept, and the turn
     each is read through. Children are grouped into orbits of the fold
     group G and every decision is made per orbit, so the kept set is
     G-invariant. A kept orbit's turn g lands on its member e·c₀ as e·g;
     since the tier below is itself G-invariant, that is the same copy as
     the conjugate e·g·e⁻¹, which is what keeps the fold exact. A turn on
     c₀ must agree with c₀'s own stabiliser H (g⁻¹·H·g ⊆ G), and turns
     inside G are skipped, since they change nothing. */
  function tierTable(r, mask, sym, W, share, twist){
    const G = GROUPS[sym], inG = new Uint8Array(48), h = (r - 1) / 2, n = r * r * r;
    for (const e of G.els) inG[e] = 1;
    const idx = c => (c[0] + h) + r * (c[1] + h) + r * r * (c[2] + h);
    const seen = new Uint8Array(n), byClass = [[], [], [], []];
    for (let i = 0; i < n; i++){
      if (seen[i]) continue;
      const c0 = [i % r - h, Math.floor(i / r) % r - h, Math.floor(i / (r * r)) - h];
      const members = [];
      for (const e of G.els){ const k = idx(applyG(c0, e)); members.push(e, k); seen[k] = 1; }
      const cls = (Math.abs(c0[0]) === h) + (Math.abs(c0[1]) === h) + (Math.abs(c0[2]) === h);
      byClass[cls].push({ i, members, rank: pick(W, r, i, 1) });
    }
    let m = mask;
    const fallback = !byClass.some((list, c) => (m >> c & 1) && list.length);
    if (fallback) m = FALLBACK_MASK;
    const kept = new Uint8Array(n), turn = new Uint8Array(n);
    let orbits = 0, keptOrbits = 0, turned = 0;
    for (let c = 0; c < 4; c++){
      if (!(m >> c & 1)) continue;
      const list = byClass[c];
      orbits += list.length;
      const want = list.length ? Math.max(1, Math.round(share * list.length)) : 0;
      keptOrbits += want;
      for (const o of list.slice().sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, want)){
        let g0 = 0;
        if (twist){
          const stab = [];
          for (let k = 0; k < o.members.length; k += 2) if (o.members[k + 1] === o.i) stab.push(o.members[k]);
          const ok = [];
          for (let g = 0; g < 48; g++){
            if (inG[g] || (twist === 1 && !ROT[g])) continue;
            if (stab.every(s => inG[MUL[MUL[INV[g] * 48 + s] * 48 + g]])) ok.push(g);
          }
          if (ok.length) g0 = ok[pick(W, r, o.i, 2) % ok.length];
        }
        for (let k = 0; k < o.members.length; k += 2){
          const cell = o.members[k + 1];
          if (g0 && !kept[cell]) turned++;
          kept[cell] = 1;
          turn[cell] = g0 ? MUL[o.members[k] * 48 + g0] : 0;
        }
      }
    }
    let count = 0;
    for (let k = 0; k < n; k++) count += kept[k];
    return { r, h, kept, turn, count, cells: n, orbits, keptOrbits, fallback, turned };
  }

  /* The tables a recipe asks for, one per tier: the outer rule on tier 0,
     the inner rule below. Tiers asking for the same (radix, rule) share
     one table, so a self-similar block repeats itself exactly. */
  function nestTables(N, levels){
    const W = seedWords(N.seed), share = (CARVES[N.carve | 0] ?? CARVES[0]).share, twist = N.twist | 0;
    const memo = new Map();
    return levels.map((l, i) => {
      const mask = ruleMask(i === 0 ? N.outer : innerRule(N)), key = l.radix + '|' + mask;
      if (!memo.has(key)) memo.set(key, tierTable(l.radix, mask, N.sym | 0, W, share, twist));
      return memo.get(key);
    });
  }

  /** An OccResult with no orbit labels.
   *  @param {import('../types.js').NestRecipe} N @param {import('../types.js').Level[]} levels
   *  @returns {Omit<import('../types.js').OccResult, 'orbit' | 'orbitOrder'> & {meta:Object}} */
  function nestOcc(N, levels){
    const started = performance.now();
    const R = levelResolution(levels), h = R - 1, L = levels.length, NN = R * R * R, inv = 1 / (h || 1);
    const tables = nestTables(N, levels);
    // Every axis value's centred digit at every tier.
    const D = new Float64Array(R * L);
    for (let u = 0; u < R; u++){
      let rem = u;
      for (let i = L - 1; i >= 0; i--){ const r = levels[i].radix; D[u * L + i] = rem % r - (r - 1) / 2; rem = Math.floor(rem / r); }
    }
    /* A voxel is kept if its child is kept at every tier. A is the turn
       that maps the voxel's digits into the current child's own frame:
       each kept child's turn t is undone (A ← t⁻¹·A) before the next
       tier's digits are read. */
    const member = (x, y, z) => {
      let A = 0;
      for (let i = 0; i < L; i++){
        const t = tables[i], v0 = D[x * L + i], v1 = D[y * L + i], v2 = D[z * L + i], a = 3 * A;
        const c0 = SG[a] * (PM[a] === 0 ? v0 : PM[a] === 1 ? v1 : v2);
        const c1 = SG[a + 1] * (PM[a + 1] === 0 ? v0 : PM[a + 1] === 1 ? v1 : v2);
        const c2 = SG[a + 2] * (PM[a + 2] === 0 ? v0 : PM[a + 2] === 1 ? v1 : v2);
        const k = (c0 + t.h) + t.r * (c1 + t.h) + t.r * t.r * (c2 + t.h);
        if (!t.kept[k]) return false;
        if (t.turn[k]) A = MUL[INV[t.turn[k]] * 48 + A];
      }
      return true;
    };
    /* The clip is read at each fold orbit's first cell in scan order, as
       in the other cores, so a clipped block keeps the fold; the rule is
       read at every cell, and is G-invariant by construction (tested). */
    const els = GROUPS[N.sym | 0].els, nE = els.length;
    const occ = new Uint8Array(NN), visited = new Uint8Array(NN);
    const idx = t => (t + h) / 2, v = [0, 0, 0];
    let filled = 0, envelopeCells = 0;
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
      const here = x + R * y + R * R * z;
      if (visited[here]) continue;
      const X = 2 * x - h, Y = 2 * y - h, Z = 2 * z - h;
      const inside = envelope(X * inv, Y * inv, Z * inv, N.arch);
      v[0] = X; v[1] = Y; v[2] = Z;
      for (let e = 0; e < nE; e++){
        const u = nE > 1 ? applyG(v, els[e]) : v;
        const ux = idx(u[0]), uy = idx(u[1]), uz = idx(u[2]), cell = ux + R * uy + R * R * uz;
        if (visited[cell]) continue;
        visited[cell] = 1;
        if (!inside) continue;
        envelopeCells++;
        if (member(ux, uy, uz)){ occ[cell] = 1; filled++; }
      }
    }
    const tiers = tables.map(t => ({ r: t.r, kept: t.count, cells: t.cells, orbits: t.orbits,
      keptOrbits: t.keptOrbits, fallback: t.fallback, turned: t.turned }));
    // A fractal dimension when every tier is the same radix and keeps the same count.
    const same = tiers.every(t => t.r === tiers[0].r && t.kept === tiers[0].kept) && tiers[0].r > 1;
    const dimension = same ? Math.log(tiers[0].kept) / Math.log(tiers[0].r) : null;
    const fill = tiers.reduce((p, t) => p * t.kept / t.cells, 1);
    return { occ, R, filled, envelopeCells,
      meta: { tiers, dimension, fill },
      timings: { evaluate: performance.now() - started, select: 0 } };
  }

  /** @param {import('../types.js').NestRecipe} N @param {import('../types.js').Level[]} levels
   *  @returns {import('../types.js').BuildResult} */
  function buildNest(N, levels){
    const started = performance.now();
    const src = nestOcc(N, levels);
    const instances = bimo.instanceArrays(src.occ, 0, src.filled, levels, src.R);
    return { occ: src.occ, R: src.R, filled: src.filled, envelopeCells: src.envelopeCells, instances,
      meta: src.meta,
      timings: { evaluate: src.timings.evaluate, select: 0,
        mesh: instances.timings.mesh, bounds: instances.timings.bounds,
        total: performance.now() - started } };
  }

  /* For tests: the tier tables on their own. */
  return { buildNest, nestOcc, nestTables };
}
