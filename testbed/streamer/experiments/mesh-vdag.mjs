/* A real game asset (glTF binary) to world files: docs/colororgeneralfields.md
   §3, with an asset in place of the sketch's stand-ins. Not the engine.

     node experiments/mesh-vdag.mjs <asset.glb> [--D=8,10] [--mode=conservative|centres] [--out=dir] [--name=…]
                                    [--hollow] [--bake=off] [--bits=6|8]

   D = 8 and 10 by default. D = 12 is the hard test, but it takes minutes an
   asset (10 for the knight, against well under one at D ≤ 10) and up to
   1.3 GB, so it runs only when asked: --D=8,10,12 (your call, 2026-11-08).

   Writes <out>/<name>-d<D>.vdag for each D (one world each) and
   <out>/<name>-d<D>-front.png, -side.png, -top.png: the voxels seen along
   −z, −x and −y, each coloured from the asset's base-colour texture by the
   nearest triangle, which is what a baked word holds. <out> defaults to the
   asset's folder (the folder above it if the .glb sits in one called
   source/).

   The file's colour is baked (glb-colour-plan step 4): the world's colour is
   { kind: 'baked', skin, words }, and vdag-core writes the skin and the
   words in an ATTR section beside the shape, at six bits a channel by
   default (--bits=8 keeps the baked eight; glb-colour-log §5). With
   --bake=off (or in centres mode) the file is the shape alone, byte for
   byte what it was before ATTR.

   What a real asset brought that the stand-ins didn't (the first one tried:
   21,333 triangles from Blender's glTF exporter):
     1. Vertices split at UV seams. Welded by exact position first, or every
        seam is a boundary edge and the whole body is "open".
     2. Holes. The body had 25 small boundary loops (the largest 2% of its
        height) and 16 non-manifold edges, so the sketch's rule (a boundary
        edge makes a component surface only) made it a hollow shell. Here a
        component is capped instead: the edges whose signed uses don't cancel
        are its boundary as a chain, each connected group of them gets a cone
        from its centroid, and body + caps is then a cycle, whose crossing
        count is path independent, so the winding number is exact again. A cap
        decides what's inside but is never drawn as surface (M.cap in
        mesh-core.mjs). This is the flat patch a modeller would put over the
        hole; the generalized winding number would fill it more smoothly.
     3. Decals: small flat pieces (zero volume) laid on the body. A component
        is solid only if, capped, its volume is at least 1% of its own box's
        and its caps are under 5% of its area; anything else is surface only.
   The asset's up is +y and its front +z, as glTF and Blender export them.

   The bake (docs/glb-colour-plan.md step 1). In conservative mode the script
   also builds the *skin*, the voxels that get a baked word (every voxel that
   can show; mesh-asset.mjs's skinOf), and bakes one word per skin voxel in
   rank order (bakeSkin), and writes both into the file. What it holds to,
   and stops on if it fails:
     - the skin lies inside the shape, by id, at every depth;
     - every lod-0 record (the renderer's shown voxels, fastChunk) lies in
       the skin, at every depth;
     - at D = 8, the skin equals a dense oracle of its own, and every word
       equals baker's colour at its voxel, visited in Morton order by a
       decode of the rank (not the walk).
     - the file, read back and written again, is the same bytes: the same
       shape, skin and words (the writer's bytes depend only on the world);
     - at six bits, every lod-0 word the job makes from the file's words is
       the one it makes from the baked words, and no coarse channel moves by
       more than one 6-bit step (bitsCost), at lods 0–4.
   Then it prints what the bake costs, and what each part of the file
   costs: the shape's graph, the skin's (going on from the shape's level
   tables, against its own), the words. In centres mode a shown voxel needn't
   be touched, so there is no bake (--bake=off skips it anywhere).
   --hollow writes the skin as the world's shape: the inside is dropped, and
   the words' DAG is the shape (glb-colour-plan §3, decision 5). Seen from
   outside it's the same voxels, so the previews don't change.

   The pieces (the reader, the analysis, the bake, the previews) live in
   mesh-asset.mjs, shared with label-mesh.mjs. */
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { createCounts, prune, storeView } from '../dag-core.js';
import { rgb8 } from '../attr-core.js';
import { writeVdag, readVdag, encodeGraph } from '../vdag-core.js';
import { voxelize, denseOracle } from './mesh-core.mjs';
import { readGlb, analyse, place, sampler, cutouts, baker, preview, VIEWS, skinOf, skinOracle, bakeSkin, shownOutside, bakedCost, bitsCost } from './mesh-asset.mjs';
import { createBaked } from '../baked-core.js';

const args = process.argv.slice(2), opt = (k, d) => { const a = args.find(s => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const file = args.find(a => !a.startsWith('--'));
if (!file){ console.error('usage: node experiments/mesh-vdag.mjs <asset.glb> [--D=8,10] [--mode=conservative|centres] [--out=dir]'); process.exit(1); }
const DEPTHS = opt('D', '8,10').split(',').map(Number), MODE = opt('mode', 'conservative');
const HOLLOW = args.includes('--hollow'), BAKE = MODE === 'conservative' && opt('bake', 'on') !== 'off', BITS = +opt('bits', '6');
if (BITS !== 6 && BITS !== 8){ console.error('--bits is 6 or 8'); process.exit(1); }
if (HOLLOW && !BAKE){ console.error('--hollow writes the skin, which needs the bake (conservative mode, no --bake=off)'); process.exit(1); }
const dir = path.dirname(path.resolve(file)), OUT = path.resolve(opt('out', path.basename(dir) === 'source' ? path.dirname(dir) : dir));
// A generator's hash or UUID for a file name (Tripo's) says nothing: the
// asset's folder names it instead. --name= overrides both.
const BASE = path.basename(file).replace(/\.glb$/i, ''), HASHY = /^[0-9a-f-]{16,}$/i.test(BASE);
const NAME = opt('name', HASHY ? path.basename(OUT) : BASE);
const SLUG = NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const fmt = (x, d = 0) => x.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });
const say = s => console.log(s);
// A file's NODE bytes, and its ATTR's skin and words (vdag-core.js's layout).
function fileParts(file){
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength), out = { node: 0, skin: 0, words: 0, attr: 0 };
  for (let p = 8; p < file.length;){
    const tag = String.fromCharCode(...file.subarray(p, p + 4)), n = dv.getUint32(p + 4, true), b = file.subarray(p + 8, p + 8 + n);
    if (tag === 'NODE') out.node = n - 2;
    if (tag === 'ATTR'){
      let q = 1; while (b[q - 1] >= 128) q++;                 // the world's varint
      q += 2;
      let len = 0, m = 1; for (;;){ const x = b[q++]; len += (x & 127) * m; m *= 128; if (x < 128) break; }
      Object.assign(out, { attr: n, skin: len, words: n - q - len - 2 });
    }
    p += 8 + n;
  }
  return out;
}

/* ---- run ------------------------------------------------------------------------------------ */
const BAKED = [], W8 = new Map();
const t0 = performance.now(), G = readGlb(file), A = analyse(G);
say(`# ${NAME}\n`);
say(`${fmt(A.nt)} triangles (${G.meshes} meshes, ${G.instances} placed), ${fmt(A.nv)} vertices after welding, ${fmt(A.comps.length)} components${G.generator ? ` (${G.generator})` : ''}${G.CO ? ', vertex colours' : ''}.`);
say(`${G.materials.length} materials, ${G.materials.filter(m => m.image).length} textured (${[...new Set(G.materials.filter(m => m.image).map(m => `${m.image.w}²`))].join(', ')}), ${G.materials.filter(m => m.mask).length} alpha cutouts${G.materials.some(m => m.mask) ? ` (${G.materials.filter(m => m.mask).map(m => m.name).join(', ')})` : ''}.\n`);
say('| component | triangles | open edges | non-manifold | boundary loops | caps | cap area / area | volume / box | kind |');
say('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
// The largest dozen, then the rest in a line: a level has thousands.
A.comps.slice(0, 12).forEach((c, i) => {
  const box = c.hi.reduce((p, h, k) => p * Math.max(h - c.lo[k], 1e-12), 1);
  say(`| ${i + 1} | ${fmt(c.tris.length)} | ${c.open} | ${c.nonManifold} | ${c.loops} | ${c.caps.length} | ${fmt(100 * c.capArea / c.area, 2)}% | ${fmt(Math.abs(c.vol) / box, 3)} | ${c.solid ? (c.sign < 0 ? 'solid (inside out)' : 'solid') : 'surface'} |`);
});
if (A.comps.length > 12){
  const rest = A.comps.slice(12), solid = rest.filter(c => c.solid);
  say(`| ${fmt(rest.length)} more | ${fmt(rest.reduce((a, c) => a + c.tris.length, 0))} | ${fmt(rest.reduce((a, c) => a + c.open, 0))} | ${fmt(rest.reduce((a, c) => a + c.nonManifold, 0))} | | | | | ${fmt(solid.length)} solid, ${fmt(rest.length - solid.length)} surface |`);
}
say(`\nIn all: ${fmt(A.comps.filter(c => c.solid).length)} solid components (${fmt(A.comps.filter(c => c.solid).reduce((a, c) => a + c.tris.length, 0))} triangles), ${fmt(A.comps.filter(c => !c.solid).length)} surface only.`);
say(`\nMode: ${MODE}${HOLLOW ? ', hollow (the skin is the shape)' : ''}${BAKE ? '' : ', no bake'}. Out: ${OUT}\n`);
say('| D | side | build s | nodes (pruned) | solid voxels | file | written s | read back | previews s |');
say('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
for (const D of DEPTHS){
  const M = place(G, A, D), sample = sampler(G, M);
  M.keep = cutouts(G, M, sample);
  const b = voxelize(M, D, MODE);
  if (D === 8){
    const want = denseOracle(M, 8, MODE), got = b.store.expand(b.root, 8);
    let diff = 0; for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) diff++;
    if (diff) throw new Error(`D = 8: ${diff} voxels differ from the dense oracle`);
  }
  // The skin and its words, in the shape's store. Built before the snapshot;
  // the writer keeps only what the roots reach (the shape's, and the skin's
  // when the colour is written), so the shape's NODE section is byte for
  // byte what it was without the bake.
  let world = b.root, colour = null;
  if (BAKE){
    const st = b.store, sk = skinOf(M, D, st, b.root);
    if (st.union(b.root, sk.root) !== b.root) throw new Error(`D = ${D}: the skin isn't inside the shape`);
    const slow = baker(G, M, sample), W = bakeSkin(G, M, sample, st, sk.root, D, slow);
    if (D === 8){
      const want = skinOracle(M, 8, st.expand(b.root, 8)), got = st.expand(sk.root, 8);
      let diff = 0; for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) diff++;
      if (diff) throw new Error(`D = 8: ${diff} skin voxels differ from the skin oracle`);
      // Rank by a Morton decode, not the walk: bit 3l + a of i is axis a's bit l.
      let r = 0, bad = 0;
      for (let i = 0; i < 1 << 24; i++){
        let x = 0, y = 0, z = 0;
        for (let l = 0; l < 8; l++){ x |= (i >> 3 * l & 1) << l; y |= (i >> 3 * l + 1 & 1) << l; z |= (i >> 3 * l + 2 & 1) << l; }
        if (!got[x + 256 * (y + 256 * z)]) continue;
        const c = slow(x, y, z);
        if (W.words[r++] !== rgb8(c[0], c[1], c[2])) bad++;
      }
      if (r !== W.words.length || bad) throw new Error(`D = 8: ${bad} of ${r} words differ from baker's (${W.words.length} baked)`);
    }
    const solid = shownOutside(st, b.root, D, (x, y, z) => st.query(sk.root, D, x, y, z));
    if (solid.outside) throw new Error(`D = ${D}: ${solid.outside} shown voxels lie outside the skin`);
    // The baked field over the words (baked-core.js, step 2), and what its
    // means cost every drawn record at lods 0–4. A shown voxel at lod 0 has
    // its own word (the check above), so its mean never falls back.
    const tf = performance.now(), field = createBaked(st, sk.root, D, W.words), fieldMs = performance.now() - tf;
    const cost = bakedCost(st, b.root, D, field, [0, 1, 2, 3, 4]);
    if (cost[0].climbed[0] + cost[0].world[0]) throw new Error(`D = ${D}: a shown voxel's mean fell back`);
    const hollow = shownOutside(st, sk.root, D, null), cn = createCounts(st), keys0 = st.snapshot().keys;
    const nodes = roots => prune(keys0, roots).keys.length / 9, gz = zlib.gzipSync(Buffer.from(W.words.buffer));
    BAKED.push({ D, voxels: cn.of(b.root), skin: cn.of(sk.root), near: cn.of(sk.root) - cn.of(sk.touched), solid, hollow,
                 shapeNodes: nodes([b.root]), skinNodes: nodes([sk.root]), bothNodes: nodes([b.root, sk.root]),
                 gzip: gz.length, skinMs: sk.ms, bakeMs: W.ms, tests: W.tests, fellBack: W.fellBack, checked: D === 8,
                 field: { bytes: field.bytes, ms: fieldMs, cost } });
    if (HOLLOW) world = sk.root;
    W8.set(D, W.words);
    colour = { kind: 'baked', skin: sk.root, words: W.words, bits: BITS };
  }
  // The writer prunes to what the roots reach (the skin's too); keys here are
  // for the node count, the shape's alone, as the file's DESC says.
  const all = b.store.snapshot().keys, { keys } = prune(all, [world]);
  // In front of the asset (+z), looking back along −z at the middle of its
  // box, far enough to see all of it: level with a tall asset, from above
  // (0.45 rad) a flat one such as a level.
  const side = M.side, e = M.hi.map((v, a) => v - M.lo[a]), c = M.lo.map((v, a) => v + e[a] / 2);
  // (A level at the tall asset's distance was a speck on screen, all coarse lods.)
  const tall = e[1] >= 0.5 * Math.max(e[0], e[2]), elev = tall ? 0.05 : 0.5, dist = tall ? 1.55 * Math.max(e[0], e[1]) + e[2] / 2 : 0.8 * Math.max(e[0], e[2]);
  const view = { eye: [c[0], c[1] + dist * Math.sin(elev), c[2] + dist * Math.cos(elev)], yaw: Math.PI, pitch: -elev };
  const t1 = performance.now();
  const bytes = await writeVdag([{ keys: all, root: world, D, name: `${NAME} (D = ${D})`, colour, view, source: null }]);
  const out = path.join(OUT, `${SLUG}-d${D}.vdag`);
  fs.writeFileSync(out, bytes);
  // Read back and written again: the writer's bytes depend only on the world,
  // so the same bytes mean the file holds this world, node for node.
  const t2 = performance.now(), { worlds: [back] } = await readVdag(bytes);
  const again = await writeVdag([{ keys: back.keys, root: back.root, D, name: back.name, colour: back.colour, view: back.view, source: null }]);
  const voxels = createCounts(b.store).of(world), same = back.voxels === voxels && Buffer.compare(Buffer.from(again), Buffer.from(bytes)) === 0
    && (colour ? back.colourStatus === 'baked' : back.colour === null);
  if (!same) throw new Error(`D = ${D}: the file doesn't read back as the world written`);
  if (colour){
    // What each part costs. The skin alone: its own graph, gzipped as the file would.
    const e = BAKED.at(-1), parts = fileParts(bytes), sp = prune(all, [colour.skin]), sv = storeView({ keys: sp.keys });
    e.file = { ...parts, total: bytes.length, skinAlone: zlib.gzipSync(encodeGraph(sv, [sp.map[colour.skin]], [D])).length };
    // Six bits: the file's words over the same skin, against the baked ones (the
    // ranks are the skin's, whichever store holds it).
    if (BITS === 6){
      const st = b.store, f8 = createBaked(st, colour.skin, D, W8.get(D)), f6 = createBaked(st, colour.skin, D, back.colour.words);
      e.bits = bitsCost(st, b.root, D, f8, f6, [0, 1, 2, 3, 4]);
    }
  }
  const bake = baker(G, M, sample), store = b.store;
  for (const v of Object.keys(VIEWS)) fs.writeFileSync(path.join(OUT, `${SLUG}-d${D}-${v}.png`), preview(store, world, D, bake, v));
  const t3 = performance.now();
  say(`| ${D} | ${side} | ${fmt(b.ms / 1000, 1)} | ${fmt(keys.length / 9)} | ${fmt(voxels)} | ${fmt(bytes.length / 1024, 0)} KB | ${fmt((t2 - t1) / 1000, 1)} | ${same ? 'same' : '**differs**'} | ${fmt((t3 - t2) / 1000, 1)} |`);
}
if (DEPTHS.includes(8)) say(`\nD = 8 equals the dense oracle voxel for voxel (${MODE}).`);
if (BAKED.length){
  // Skin: the voxels with a word. Near caps: skin voxels only a cap's grown
  // box adds. Shown: lod-0 records of the solid shape (all in the skin, or
  // the run stopped). Nodes are what the roots reach. Words: 4 bytes raw
  // each; gzip as one stream. Quads: lod-0 faces drawn, solid and hollow.
  say('\n## The bake\n');
  say('| D | skin voxels | of occupied | near caps | shown | of skin | shape nodes | skin nodes | both | words raw | gzip | B a word | skin s | bake s | tests a word | quads, solid | quads, hollow |');
  say('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const mb = n => `${fmt(n / 2 ** 20, 1)} MB`, pc = (a, b) => `${fmt(100 * a / b, 1)}%`;
  for (const e of BAKED) say(`| ${e.D} | ${fmt(e.skin)} | ${pc(e.skin, e.voxels)} | ${fmt(e.near)} | ${fmt(e.solid.shown)} | ${pc(e.solid.shown, e.skin)} | ${fmt(e.shapeNodes)} | ${fmt(e.skinNodes)} | ${fmt(e.bothNodes)} | ${mb(4 * e.skin)} | ${mb(e.gzip)} | ${fmt(e.gzip / e.skin, 2)} | ${fmt(e.skinMs / 1000, 1)} | ${fmt(e.bakeMs / 1000, 1)} | ${fmt(e.tests / e.skin, 1)} | ${fmt(e.solid.quads)} | ${fmt(e.hollow.quads)} (${fmt(e.hollow.quads / e.solid.quads, 2)}×) |`);
  // The file (step 4): the shape's graph (NODE), the skin's going on from
  // its level tables and on its own, and the words, all as written (gzip
  // where it wins). A hollow world's skin is the shape: a back-reference.
  say('\n## The file\n');
  // Words at 8 bits is the baked words' gzip, what --bits=8 would write.
  say(`Words at ${BITS} bits a channel.\n`);
  say('| D | file | shape graph | skin graph | skin on its own | saved | words | at 8 bits | B a word | words of file |');
  say('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  const kb = n => `${fmt(n / 1024, 0)} KB`;
  for (const e of BAKED) if (e.file){
    const f = e.file;
    say(`| ${e.D} | ${kb(f.total)} | ${kb(f.node)} | ${kb(f.skin)} | ${kb(f.skinAlone)} | ${fmt(100 * (1 - f.skin / f.skinAlone), 0)}% | ${kb(f.words)} | ${kb(e.gzip)} | ${fmt(f.words / e.skin, 2)} | ${fmt(100 * f.words / f.total, 0)}% |`);
  }
  // Six bits through the job: lod 0's shown words never move (the run stops
  // if one does), so what moves is the seam tail there and coarse means above;
  // none by more than one 6-bit step in a channel.
  if (BAKED.some(e => e.bits)){
    say('\n## Six bits through the job\n');
    say('| D | lod | records | moved | of records | main moved | in 1 channel | 2 | 3 |');
    say('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const e of BAKED) for (const [i, r] of (e.bits ?? []).entries())
      say(`| ${i ? '' : e.D} | ${r.lod} | ${fmt(r.records)} | ${fmt(r.moved)} | ${fmt(100 * r.moved / Math.max(1, r.records), 2)}% | ${fmt(r.movedMain)} | ${fmt(r.channels[0])} | ${fmt(r.channels[1])} | ${fmt(r.channels[2])} |`);
  }
  // The baked field: block sums built once, then a mean per drawn record
  // (main and seam tail) at each lod the streamer draws. Climbed: a cell with
  // no skin that took an ancestor's mean within its chunk; world: no skin in
  // the chunk either. Main, then tail.
  say('\n## The baked field\n');
  say('| D | block sums | built ms | lod | records | tail | means / s | words a mean | max | climbed, main | tail | world, main | tail |');
  say('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const e of BAKED) for (const [i, r] of e.field.cost.entries()){
    const n = r.main + r.tail;
    say(`| ${i ? '' : e.D} | ${i ? '' : `${fmt(e.field.bytes / 1024, 0)} KB`} | ${i ? '' : fmt(e.field.ms, 0)} | ${r.lod} | ${fmt(r.main)} | ${fmt(r.tail)} | ${fmt(n / r.ms * 1000 / 1e6, 2)}M | ${fmt(r.scanned / n, 1)} | ${r.maxScan} | ${fmt(r.climbed[0])} | ${fmt(r.climbed[1])} | ${fmt(r.world[0])} | ${fmt(r.world[1])} |`);
  }
  // The job (step 3): every chunk at the lod, fastChunk without colour, with
  // the rows' named field (cellAttr's walk at meanDepth 1) and with the baked
  // field (cellAttr asks its mean), each with a cache of its own. Every
  // baked word was held to the mean's.
  say('\n## The job with baked colour\n');
  say('| D | lod | records | no colour, ms | named field, ms | baked, ms | baked / none | baked / named | µs a word, named | baked |');
  say('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const e of BAKED) for (const [i, r] of e.field.cost.entries()){
    const n = r.main + r.tail, [j0, j1, j2] = r.jobMs;
    say(`| ${i ? '' : e.D} | ${r.lod} | ${fmt(n)} | ${fmt(j0, 0)} | ${fmt(j1, 0)} | ${fmt(j2, 0)} | ${fmt(j2 / j0, 2)}× | ${fmt(j2 / j1, 2)}× | ${fmt(1000 * (j1 - j0) / n, 2)} | ${fmt(1000 * (j2 - j0) / n, 2)} |`);
  }
  const fb = BAKED.reduce((a, e) => a + e.fellBack, 0);
  say(`\nEvery shown voxel lies in the skin, and the skin in the shape, at every depth.${BAKED.some(e => e.checked) ? ' At D = 8 the skin equals its dense oracle and every word equals baker\'s.' : ''}${fb ? ` ${fmt(fb)} words fell back to baker (a cutout's nearest triangle not kept there).` : ''}`);
}
say(`\n${fmt((performance.now() - t0) / 1000, 0)} s in all.`);
