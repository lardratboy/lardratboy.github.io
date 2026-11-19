/* node renderanim/check.mjs

   Prints every number the render film shows, and holds the film to what it
   claims about the code. A failure exits 1:

   1. the focus chunk's records and words from chunk-core's expandChunk equal
      the worker job's (createJobRunner, which runs job-core's fastChunk),
      byte for byte, as chapter 6 says;
   2. the walk hands out cells in Morton order (chapter 7), and every job's
      records are sorted by cell index, with a word for each;
   3. the film's copies of the page's GPU side are the page's: FACE_OFF
      character for character, the cube index loop, and install()'s buffer
      and attribute lines (gl.js's makeRecordBatch);
   4. every code panel's anchor occurs exactly once in its file, and every
      line the film highlights is in its panel (code.js, scenes.js);
   5. the stream replay's slow stretches land on its bursts of jobs (the
      chapter's clock is written for frames 0–5, 30, 45, 51 and 93);
   6. the seams chapter's chunks have open sides that add faces;
   7. a buffer posted with its buffer in the transfer list is detached. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAll, FOCUS, STREAM, FILM_DETAIL } from './data.js';
import { FILES, SNIPS, indexSources, snippet } from './code.js';
import { FACE_OFF } from './gl.js';
import { cellOf, maskOf, quadsShown } from '../chunk-core.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = f => readFileSync(ROOT + f, 'utf8');
let bad = 0;
const check = (ok, what) => { if (!ok){ bad++; console.log('FAIL', what); } return ok; };
const n = v => Math.round(v).toLocaleString('en-US');

const t0 = performance.now();
const A = buildAll();
console.log(`built in ${(performance.now() - t0).toFixed(0)} ms (kit ${A.times.build.toFixed(0)} ms, jobs ${A.times.jobs.toFixed(0)} ms)`);
console.log(`world: kit D = ${A.D}, ${n(A.nodes)} nodes, ${n(A.voxels)} voxels, ${A.oh} Oh classes`);
console.log(`snapshot: keys ${n(A.bytes.keys)} B, counts ${n(A.bytes.counts)} B, poses ${n(A.bytes.poses)} B, descriptor ${JSON.stringify(A.desc)}`);
A.totals.lod.forEach((L, l) => console.log(`lod ${l}: ${L.chunks} chunks, ${n(L.records)} records, ${n(L.occupied)} cells kept, ${n(L.bytes)} B of records + words`));
const F = A.focus;
console.log(`focus ${F.key}: node ${F.node}, ${n(F.occupied)} cells, ${n(F.count)} records, ${n(F.buried)} buried, tail ${F.tail}`);
console.log(`  path: ${F.path.map(s => `level ${s.level} child(${s.id}, ${s.o}) = ${s.next}`).join('; ')}`);
console.log(`  EMPTY skipped: ${F.levels.slice(1, 5).map(L => `level ${L.k}: ${L.empty}`).join(', ')}; apron ${F.apron.map(a => a.name + ' ' + a.cells.length).join(', ')}`);
const r = F.record;
console.log(`  record ${r.index}: 0x${r.rec.toString(16)} = cell ${r.cell} (${r.x}, ${r.y}, ${r.z}), mask ${r.mask}, pose ${r.pose}, word 0x${r.attr.toString(16)}`);
const jv = A.jobView;
console.log(`jobs: the streamer's order from the film's eye: ${jv.order.join(' ')}; the message is ${jv.bytes} bytes: ${JSON.stringify(jv.message)}`);
const S = A.stream;
console.log(`stream: ${S.frames.length} frames, ${S.bars.length} jobs, ${S.stats.installs} installs, ${S.stats.evictions} evictions, detail ${FILM_DETAIL}, cache ${STREAM.cacheMax}`);
const tris = [...A.jobs.values()].filter(j => j.lod === 0).reduce((a, j) => a + 2 * j.quads, 0);
console.log(`lod 0, whole world: ${n(tris)} triangles shown`);

// 1, 2
check(F.same, 'the focus chunk: expandChunk and the worker job differ');
check(F.sorted, 'the focus walk is not in Morton order');
for (const j of A.jobs.values()){
  check(j.attrs && j.attrs.length === j.records.length, `${j.key}: ${j.attrs?.length} words for ${j.records.length} records`);
  let sorted = true;
  for (let i = 1; i < j.count; i++) if (cellOf(j.records[i]) <= cellOf(j.records[i - 1])) sorted = false;
  check(sorted, `${j.key}: records not sorted by cell`);
  let masked = true;
  for (let i = 0; i < j.count; i++) if (!maskOf(j.records[i])) masked = false;
  for (let i = j.count; i < j.records.length; i++) if (maskOf(j.records[i])) masked = false;
  check(masked, `${j.key}: a record with no face before borderStart, or a tail record with one`);
}

// 3. The film's copies of the page.
const page = read('stream-viewer.html'), gl = read('renderanim/gl.js');
const between = (s, a, b) => { const i = s.indexOf(a); return i < 0 ? null : s.slice(i, s.indexOf(b, i) + b.length); };
const squash = s => s && s.replace(/\s+/g, '');
const pageFace = between(page, 'const FACE_OFF = [', ']];'), glFace = between(gl, 'export const FACE_OFF = [', ']];');
check(squash(pageFace)?.replace('constFACE_OFF', '') === squash(glFace)?.replace('exportconstFACE_OFF', ''), 'FACE_OFF: the film\'s copy differs from stream-viewer.html\'s');
check(JSON.stringify(eval(pageFace.replace('const FACE_OFF = ', ''))) === JSON.stringify(FACE_OFF), 'FACE_OFF: values differ');
for (const line of ['idx.set([b, b+1, b+2, b, b+2, b+3], 6 * f);', 'idx.set([b, b+1, b+1, b+2, b+2, b+3, b+3, b, b, b+2], CUBE_TRIS + 10 * f);',
                    'const both = new Uint32Array(2 * n);', 'gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cubeIndex);',
                    'gl.vertexAttribIPointer(0, 1, gl.UNSIGNED_INT, 4, 0);', 'gl.vertexAttribDivisor(0, 1);',
                    'gl.vertexAttribIPointer(1, 1, gl.UNSIGNED_INT, 4, 4 * n);', 'gl.vertexAttribDivisor(1, 1);',
                    'gl.bufferData(gl.ARRAY_BUFFER, both, gl.STATIC_DRAW);'])
  check(page.includes(line) && gl.includes(line), `the page and gl.js should both say: ${line}`);
check(page.includes('gl.drawElementsInstanced(gl.TRIANGLES, rasterDraw.tris, gl.UNSIGNED_BYTE, 0, n);'), 'renderView\'s draw call moved: the film shows it');
check(page.includes('const RASTER_DRAW = { prog, U, tris: 18 };'), 'the raster\'s index count moved: the film says 18');
check(page.includes('uint face = ALL_SIX ? k : 2u * k + (c[k] < 0.0 ? 0u : 1u), corner = 4u * face + v % 4u;'), 'rasterVS\'s three faces moved: the film shows them');
check(page.includes('if (!faceShown(aRec, face)${hideAlso}) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);'), 'rasterVS\'s hidden face moved: the film shows it');

// 4. The code panels.
const src = indexSources(Object.fromEntries(FILES.map(f => [f, read(f)])));
for (const name of Object.keys(SNIPS)){
  const s = snippet(src, name);
  if (!check(!s.error, `snippet ${name}: ${s.error}`)) continue;
}
const scenes = read('renderanim/scenes.js');
let used = 0;
for (const m of scenes.matchAll(/codeWalk\(c, '(\w+)', t, \[(.*?)\]\],?\s*\{/gs)){
  const s = snippet(src, m[1]);
  for (const q of m[2].matchAll(/\[[\d.]+, '((?:[^'\\]|\\.)*)'/g)){ used++; check(s.hl && s.hl(q[1].replace(/\\'/g, "'")) >= 0, `panel ${m[1]}: no line holds "${q[1]}"`); }
}
for (const m of scenes.matchAll(/[^k]\bcode\(c, '(\w+)', \{([^}]*)\}/g)){
  const s = snippet(src, m[1]);
  check(!s.error, `panel ${m[1]}: ${s.error}`);
  const hl = m[2].match(/hl: ([^,]*(?:\?[^:]*:[^,]*)?)/);
  if (!hl) continue;
  for (const q of hl[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)){ used++; check(s.hl && s.hl(q[1].replace(/\\'/g, "'")) >= 0, `panel ${m[1]}: no line holds "${q[1]}"`); }
}
console.log(`code panels: ${Object.keys(SNIPS).length} snippets, ${used} highlighted lines checked`);

// 5. The replay's bursts, where the chapter's clock slows down (scenes.js P.skeys).
const bursts = S.frames.filter(f => f.installed.length).map(f => f.f);
console.log(`stream: installs in frames ${bursts.join(' ')}`);
for (const [a, b] of [[0, 6], [29, 33], [44, 53], [92, 97]])
  check(bursts.some(f => f >= a && f <= b), `stream: no installs in frames ${a}–${b}, where the chapter slows down (update P.skeys)`);
check(bursts.every(f => [[0, 6], [29, 33], [44, 53], [92, 97]].some(([a, b]) => f >= a && f <= b)), 'stream: installs outside the slow stretches (update P.skeys)');

// 6. Seams.
const seams = A.seams.draw.filter(d => d.lo[1] === 0 && (d.lod === 0 ? d.lo[0] < 128 : d.lo[0] === 128));
const added = seams.filter(d => d.open).reduce((a, d) => { const j = A.jobs.get(d.key); return a + quadsShown(j.quads, j.openQuads, d.open) - j.quads; }, 0);
console.log(`seams: ${seams.length} chunks, ${seams.filter(d => d.open).length} with open sides, ${n(added)} faces added`);
check(seams.some(d => d.lod === 0 && d.open) && seams.some(d => d.lod === 1 && d.open) && added > 0, 'seams: the chapter\'s chunks have no open sides to show');

// 7. Transfer.
{
  const copy = new Uint32Array(F.job.records), ch = new MessageChannel();
  ch.port1.postMessage({ records: copy }, [copy.buffer]);
  check(copy.byteLength === 0, 'a transferred buffer was not detached');
  ch.port1.close(); ch.port2.close();
}

console.log(bad ? `${bad} FAILED` : 'all checks passed');
process.exit(bad ? 1 : 0);
