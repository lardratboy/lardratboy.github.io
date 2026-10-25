/* ================== NEOBLOCK CORE ===================================
   The sandbox generator: a bimoblock-style source followed by modifiers
   that loosen the bimoblock rules, one occupancy grid in and one out.

     source     bimoblockOcc(base recipe, levels)      occ + orbit per cell
                or a composite: bimoblocks as the inner tiers (below)
     warp       nearest-cell resample through an exact inverse map
     break      flip any cell with probability ε        (broken symmetry)
     largest    keep the largest 6-connected piece

   then the same instanceArrays() bimoblocks use, so everything downstream
   (worker transfer, renderer, LOD proxy, OBJ export, analysis) is shared.
   Every modifier is skipped at dial 0, so a neoblock with every dial at 0
   is exactly its source bimoblock — test/neoblock.test.js holds that.

   Pure like the bimoblock core: no DOM, no THREE, runs in the worker.
   Per-cell randomness is a hash of (seed, step, cell index), never a
   sequential PRNG, so a result does not depend on visiting order and one
   dial never reshuffles another's choices.
   ================================================================ */
import { createBimoblockCore } from './bimoblock-core.js';

export const SOURCE_NAMES = ['bimoblock', 'composite'];
export const PLACE_NAMES = ['every cell', 'bimoblock'];
export const ORIENT_NAMES = ['none', 'coherent', 'random'];
export const PALETTE_MAX = 8;    // palette 1..8 distinct children
export const WARP_NAMES = ['none', 'twist', 'taper', 'bend', 'shear'];
/* ε per `eps` step: finer near zero, where a small change is most visible. */
export const EPS_STEPS = [0, 0.02, 0.04, 0.07, 0.10, 0.15, 0.20, 0.30, 0.40];
export const WARP_STEPS = 9;   // warpAmt 0..8 → amount 0..1

/* Step ids salt the per-cell hash, so steps draw independent randomness. */
const STEP_BREAK = 0x6b5f1d3b;
const STEP_CHILD = 0x2f9be6d1, STEP_SLOT = 0x58f1c3a7, STEP_ORIENT = 0x13c4e9b5;

/* How many outer tiers a composite gives the neoblock: the leading run of
   levels marked `neo` (the levels editor's owner picker), and at least the
   first. 0 when no tier would be left for the children, i.e. a single-tier
   layout or every tier marked neo: then there is nothing to compose and
   the source stays a plain bimoblock.
   @param {import('../types.js').Level[]} levels */
export function compositeSplit(levels){
  let n = 0;
  while (n < levels.length && levels[n].neo) n++;
  n = Math.max(1, n);
  return n < levels.length ? n : 0;
}

/** @param {ReturnType<typeof createBimoblockCore>} [bimo] reuse an existing bimoblock core */
export function createNeoblockCore(bimo = createBimoblockCore()){
  const { GROUPS, applyG, mulE, levelResolution } = bimo;

  /* Inverse of each Oh element code (signed permutations: the transpose). */
  const INV_E = new Uint8Array(48);
  for (let e = 0; e < 48; e++) for (let f = 0; f < 48; f++) if (mulE(e, f) === 0){ INV_E[e] = f; break; }

  /* 32-bit avalanche of (seed words, step, cell). */
  function cellHash(lo, hi, step, c){
    let h = Math.imul(c ^ step, 0x9e3779b1) ^ lo;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13) ^ hi, 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }

  /* Source coordinate for an output coordinate, both centred in [-1, 1]
     per axis (index space, so tier blocks stay aligned). Each warp is an
     exact inverse of its forward map at amount a ∈ (0, 1].
     Returns false when the source lies outside the block. */
  function inverseWarp(kind, a, u, out){
    let x = u[0], y = u[1], z = u[2];
    if (kind === 1){                       // twist about y: angle ∝ y
      const t = -a * Math.PI * y, c = Math.cos(t), s = Math.sin(t);
      const nx = x * c - z * s; z = x * s + z * c; x = nx;
    } else if (kind === 2){                // taper: (x, z) shrink toward +y
      const k = 1 - 0.6 * a * (y + 1) / 2;
      x /= k; z /= k;
    } else if (kind === 3){                // bend: y axis onto an arc about the +x side
      const phi = a * Math.PI / 2, rho = 2 / phi;
      const dx = rho - x, r = Math.hypot(dx, y);
      y = Math.atan2(y, dx) * rho; x = rho - r;
    } else if (kind === 4){                // shear: x leans with y
      x -= a * 0.6 * y;
    }
    out[0] = x; out[1] = y; out[2] = z;
    return x >= -1 && x <= 1 && y >= -1 && y <= 1 && z >= -1 && z <= 1;
  }

  /* Nearest-cell resample: each output cell takes its source cell's
     occupancy and orbit byte. Blocky on purpose (first pass). */
  function warpGrid(occ, orbit, R, kind, a){
    const out = new Uint8Array(R*R*R), orb = new Uint8Array(R*R*R);
    if (R < 2) return { occ: occ.slice(), orbit: orbit.slice() };
    const h = (R - 1) / 2, u = [0, 0, 0], s = [0, 0, 0];
    for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++){
      u[0] = (x - h) / h; u[1] = (y - h) / h; u[2] = (z - h) / h;
      if (!inverseWarp(kind, a, u, s)) continue;
      const sx = Math.round(s[0] * h + h), sy = Math.round(s[1] * h + h), sz = Math.round(s[2] * h + h);
      const from = sx + R * sy + R * R * sz, to = x + R * y + R * R * z;
      out[to] = occ[from]; orb[to] = orbit[from];
    }
    return { occ: out, orbit: orb };
  }

  /* Broken symmetry, anywhere: every cell flips with probability ε. */
  function breakGrid(occ, eps, seed){
    const { lo, hi } = bimo.seedWords(seed);
    const cut = eps * 4294967296;
    for (let c = 0; c < occ.length; c++)
      if (cellHash(lo, hi, STEP_BREAK, c) < cut) occ[c] ^= 1;
    return occ;
  }

  /* Keep the largest 6-connected piece (in index space; tier gaps don't
     separate). Ties go to the piece found first, i.e. lowest flat index. */
  function largestPiece(occ, R){
    const n = R*R*R, label = new Int32Array(n), stack = new Int32Array(n);
    let best = 0, bestSize = 0, next = 0;
    for (let start = 0; start < n; start++){
      if (!occ[start] || label[start]) continue;
      const id = ++next;
      let top = 0, size = 0;
      stack[top++] = start; label[start] = id;
      while (top){
        const c = stack[--top]; size++;
        const x = c % R, y = ((c / R) | 0) % R, z = (c / (R*R)) | 0;
        const visit = d => { if (occ[d] && !label[d]){ label[d] = id; stack[top++] = d; } };
        if (x + 1 < R) visit(c + 1);
        if (x > 0)     visit(c - 1);
        if (y + 1 < R) visit(c + R);
        if (y > 0)     visit(c - R);
        if (z + 1 < R) visit(c + R*R);
        if (z > 0)     visit(c - R*R);
      }
      if (size > bestSize){ bestSize = size; best = id; }
    }
    for (let c = 0; c < n; c++) occ[c] = label[c] === best && best ? 1 : 0;
    return occ;
  }

  function countFilled(occ){
    let f = 0;
    for (let c = 0; c < occ.length; c++) f += occ[c];
    return f;
  }

  /* ---- composite source ---------------------------------------------
     The outer `split` tiers belong to the neoblock, the rest to bimoblock
     children: each placed macro cell of the Ro³ outer grid receives one
     child, an Ri³ bimoblock built on the inner tiers, so R = Ro·Ri and the
     tier gaps fall where the levels editor puts them.

       place    0  every macro cell        1  the base recipe as a bimoblock
                                              on the outer tiers
       palette  1..8 distinct children: child 0 is the base recipe on the
                inner tiers, child m > 0 the same with a seed hashed from m,
                so the palette reads as variations on one design
       orient   0  unturned   1  coherent   2  a random Oh element per cell

     The placement group is the base group (the outer tier's own group
     under independent tier symmetry). A macro cell's palette slot hashes
     its orbit representative under that group, so cells that are images of
     each other get the same child. Coherent orientation turns each child
     by the inverse of the element that folds its cell onto the
     representative, which makes a symmetric placement give a symmetric
     composite even when the children are less symmetric than it (the
     levels editor's per-tier groups set that up). Exact wherever the
     group moves every macro cell; a cell on a mirror or an axis would
     also need its child symmetric under that cell's stabiliser.

     The orbit byte carries the palette slot (orbitOrder = palette), so the
     orbit colouring shows which child is which. */
  function childSeed(seed, m){
    if (!m) return seed;
    const { lo, hi } = bimo.seedWords(seed);
    const a = cellHash(lo, hi, STEP_CHILD, 2 * m), b = cellHash(hi, lo, STEP_CHILD, 2 * m + 1);
    return (BigInt(b) << 32n) | BigInt(a);
  }

  /* Flat child index → flat index after turning by Oh element `e`. */
  function turnTable(Ri, e){
    const h = (Ri - 1) / 2, t = new Int32Array(Ri * Ri * Ri), v = [0, 0, 0];
    for (let z = 0; z < Ri; z++) for (let y = 0; y < Ri; y++) for (let x = 0; x < Ri; x++){
      v[0] = x - h; v[1] = y - h; v[2] = z - h;
      const w = applyG(v, e);
      t[x + Ri * y + Ri * Ri * z] = (w[0] + h) + Ri * (w[1] + h) + Ri * Ri * (w[2] + h);
    }
    return t;
  }

  /** @param {import('../types.js').NeoRecipe} N @param {import('../types.js').Level[]} levels
   *  @param {number} split @returns {import('../types.js').OccResult} */
  function compositeOcc(N, levels, split){
    const started = performance.now();
    const outer = levels.slice(0, split), inner = levels.slice(split);
    const Ro = levelResolution(outer), Ri = levelResolution(inner), R = Ro * Ri;
    const placed = N.place ? bimo.bimoblockOcc(N, outer).occ : null;
    const gs = N.tierSymmetry ? outer[0].sym : -1;
    const els = GROUPS[gs == null || gs < 0 ? N.sym : gs].els;
    const palette = Math.max(1, Math.min(PALETTE_MAX, N.palette | 0));
    const orient = N.orient | 0;
    const { lo, hi } = bimo.seedWords(N.seed);

    const kids = new Array(palette), turns = new Map();
    const occ = new Uint8Array(R * R * R), orbit = new Uint8Array(R * R * R);
    const ho = (Ro - 1) / 2, v = [0, 0, 0];
    let filled = 0, envelopeCells = 0;
    for (let cz = 0; cz < Ro; cz++) for (let cy = 0; cy < Ro; cy++) for (let cx = 0; cx < Ro; cx++){
      const c = cx + Ro * cy + Ro * Ro * cz;
      if (placed && !placed[c]) continue;

      // Fold the macro cell onto its orbit representative, as foldOrbit()
      // does: lexicographic minimum, lowest element index on a tie.
      v[0] = cx - ho; v[1] = cy - ho; v[2] = cz - ho;
      let bx = v[0], by = v[1], bz = v[2], bi = 0;
      if (palette > 1 || orient === 1)
        for (let i = 1; i < els.length; i++){
          const w = applyG(v, els[i]);
          if (w[0] < bx || (w[0] === bx && (w[1] < by || (w[1] === by && w[2] < bz)))){
            bx = w[0]; by = w[1]; bz = w[2]; bi = i;
          }
        }
      const rep = (bx + ho) + Ro * (by + ho) + Ro * Ro * (bz + ho);
      const slot = palette > 1 ? cellHash(lo, hi, STEP_SLOT, rep) % palette : 0;
      const e = orient === 1 ? INV_E[els[bi]] : orient === 2 ? cellHash(lo, hi, STEP_ORIENT, c) % 48 : 0;

      const kid = kids[slot] || (kids[slot] = bimo.bimoblockOcc({ ...N, seed: childSeed(N.seed, slot) }, inner));
      let t = null;
      if (e){ t = turns.get(e); if (!t) turns.set(e, t = turnTable(Ri, e)); }
      const ox = cx * Ri, oy = cy * Ri, oz = cz * Ri, ko = kid.occ;
      for (let k = 0; k < ko.length; k++){
        if (!ko[k]) continue;
        const w = t ? t[k] : k;
        const wx = w % Ri, wy = ((w / Ri) | 0) % Ri, wz = (w / (Ri * Ri)) | 0;
        const d = (ox + wx) + R * (oy + wy) + R * R * (oz + wz);
        occ[d] = 1; orbit[d] = slot; filled++;
      }
      envelopeCells += kid.envelopeCells;
    }
    return { occ, R, filled, envelopeCells, orbit, orbitOrder: palette,
      timings: { evaluate: performance.now() - started, select: 0 } };
  }

  /** @param {import('../types.js').NeoRecipe} N @param {import('../types.js').Level[]} levels
   *  @returns {import('../types.js').BuildResult} */
  function buildNeo(N, levels){
    const started = performance.now();
    const split = N.source ? compositeSplit(levels) : 0;
    const src = split ? compositeOcc(N, levels, split) : bimo.bimoblockOcc(N, levels);
    const R = src.R;
    let occ = src.occ, orbit = src.orbit, filled = src.filled;

    const t0 = performance.now();
    const warpOn = N.warp > 0 && N.warpAmt > 0;
    if (warpOn) ({ occ, orbit } = warpGrid(occ, orbit, R, N.warp, N.warpAmt / (WARP_STEPS - 1)));
    const t1 = performance.now();
    const breakOn = N.eps > 0;
    if (breakOn) breakGrid(occ, EPS_STEPS[N.eps], N.seed);
    const t2 = performance.now();
    if (N.largest) largestPiece(occ, R);
    const t3 = performance.now();
    if (warpOn || breakOn || N.largest) filled = countFilled(occ);

    const instances = bimo.instanceArrays(occ, 0, filled, levels, R, orbit, src.orbitOrder);
    return { occ, R, filled, envelopeCells: src.envelopeCells, instances,
      timings: { evaluate: src.timings.evaluate, select: src.timings.select,
        warp: t1 - t0, break: t2 - t1, largest: t3 - t2,
        mesh: instances.timings.mesh, bounds: instances.timings.bounds,
        total: performance.now() - started } };
  }

  return { SOURCE_NAMES, PLACE_NAMES, ORIENT_NAMES, PALETTE_MAX, WARP_NAMES, EPS_STEPS, WARP_STEPS,
    compositeSplit, buildNeo, compositeOcc, warpGrid, breakGrid, largestPiece };
}
