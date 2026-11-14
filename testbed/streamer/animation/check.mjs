/* node animation/check.mjs

   Prints every number the animation shows, and holds its data to checks of
   its own: the town's DAG expands back to its dense grid, the tree laid out
   for the hash-consing chapter has the census's counts, and the world's
   colour field reads the town voxel the world's DAG has there (each town's
   turn undone). A failure exits 1. */
import { buildAll, worldIndex, TOWN_D, TOWN_R, WORLD_D } from './data.js';
import { attrOf8, attrRGB } from '../attr-core.js';

const A = buildAll();
let bad = 0;
const check = (ok, what) => { if (!ok){ bad++; console.log('FAIL', what); } };

// 1. The town round-trips.
const occ = A.store.expand(A.town.root, TOWN_D);
let diff = 0;
for (let i = 0; i < occ.length; i++) if (occ[i] !== A.town.occ[i]) diff++;
check(diff === 0, `town expand differs in ${diff} voxels`);

// 2. The tree's counts are the census's.
for (let k = 1; k <= TOWN_D; k++){
  check(A.tree.count[k] === A.census.svo[k], `tree level ${k}: ${A.tree.count[k]} vs svo ${A.census.svo[k]}`);
  check(A.tree.uniq[k] === A.census.dag[k], `tree level ${k}: ${A.tree.uniq[k]} unique vs dag ${A.census.dag[k]}`);
}

// 3. The world's turns, read back (worldIndex, which the colour field uses),
//    agree with its DAG on whole towns.
const W = A.world, q = (x, y, z) => A.store.query(W.root, WORLD_D, x, y, z);
let wrong = 0, tested = 0;
for (const [tx, tz] of [[0, 0], [1, 0], [0, 1], [5, 9], [63, 63], [17, 40]])
  for (let z = 0; z < 32; z++) for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++){
    const X = tx * 32 + x, Z = tz * 32 + z;
    tested++;
    if (q(X, y, Z) !== A.town.occ[worldIndex(X + .5, y + .5, Z + .5)]) wrong++;
  }
check(wrong === 0, `the world's turns read back disagree with the DAG at ${wrong} of ${tested} voxels`);

// 4. A few cuts, and what their jobs cost.
const eyes = [[300, 60, 300], [1024, 120, 1024], [80, 400, 1900]];
const t0 = performance.now();
for (const eye of eyes){
  const sel = A.select(eye, { detail: 1, maxChunks: 1024 });
  const byLod = {};
  let cubes = 0, faces = 0;
  for (const c of sel.leaves){ byLod[c.lod] = (byLod[c.lod] || 0) + 1; const j = A.jobs.job(c); cubes += j.count; faces += j.faces; }
  console.log(`cut at ${eye}: ${sel.leaves.length} leaves`, byLod, `records ${cubes} faces ${faces}`);
}
console.log(`(${(performance.now() - t0).toFixed(0)} ms) jobs asked ${A.jobs.asked}, run ${A.jobs.run} (stamps cached ${A.jobs.cached})`);

console.log('\nbuilt in', A.ms.toFixed(0), 'ms');
console.log('town voxels', A.census.svo[0], 'blocks', A.town.blocks.length);
console.log('level  svo  dag  classes');
for (let k = TOWN_D; k >= 0; k--) console.log(k, A.census.svo[k], A.census.dag[k], A.classCensus.classes[0][k]);
console.log('dag total', A.census.dag.reduce((a, b) => a + b, 0), 'svo total', A.census.svo.slice(1).reduce((a, b) => a + b, 0));
console.log('blocks:', A.blocks.map(b => `${b.kind}${b.face} id${b.id} cls${b.cls} pose${b.pose}`).join('  '));
for (const j of A.townJobs) console.log(`town lod ${j.lod}: occupied ${j.out.occupied} records ${j.out.count} buried ${j.buried.length} bytes ${j.out.bytes}`);
console.log('world: towns', W.towns, 'nodes added', A.worldNodesAdded, 'dag', A.worldCensus.dag.reduce((a, b) => a + b, 0),
            'voxels', A.worldCensus.svo[0]);

console.log('focus town', A.focus, 'pick', A.pick && { x: A.pick.x, y: A.pick.y, z: A.pick.z, mask: A.pick.mask, pose: A.pick.pose, cell: A.pick.cell },
            'merge', A.merge && { ...A.merge.rec, on: A.merge.kids.filter(k => k.on).length });
check(A.focus && A.pick && A.merge, 'focus, pick and merge must all be found');

// 5. The colour chapters: the trace's rank is createBaked's and the voxel's
//    place in Morton order; the range's mean is the words summed one by one;
//    each lineage word is the dense mean of the voxels under its cell.
const Cc = A.colour, f = Cc.flag;
check(Cc.rank === Cc.baked.rank(f[0], f[1], f[2]), `trace rank ${Cc.rank} vs baked.rank ${Cc.baked.rank(f[0], f[1], f[2])}`);
check(Cc.skin[Cc.rank].join() === f.join(), 'the rank names the flag in Morton order');
check(Cc.range.mean.every((m, i) => m === Cc.range.direct[i]), `range mean ${Cc.range.mean} vs direct ${Cc.range.direct}`);
check(Cc.range.scanned === Cc.range.head + Cc.range.tail, `scanned ${Cc.range.scanned} vs ${Cc.range.head} + ${Cc.range.tail}`);
for (const L of Cc.lineage){
  const s = L.X << L.level, e = s + (1 << L.level), acc = [0, 0, 0];
  let n = 0;
  for (let z = L.Z << L.level; z < (L.Z + 1) << L.level; z++) for (let y = L.Y << L.level; y < (L.Y + 1) << L.level; y++) for (let x = s; x < e; x++){
    const i = x + 32 * (y + 32 * z);
    if (!A.town.occ[i]) continue;
    n++; const c = A.town.col[i]; acc[0] += c & 255; acc[1] += c >> 8 & 255; acc[2] += c >> 16 & 255;
  }
  const w = attrOf8(acc[0] / n, acc[1] / n, acc[2] / n);
  check(n === L.count && w === L.word, `lineage level ${L.level}: ${n} voxels vs ${L.count}, word ${w} vs ${L.word}`);
}
console.log('pyramid records', Cc.pyramid.map(p => p.count).join(' · '), ' lineage counts', Cc.lineage.map(l => l.count).join(' → '));
console.log('walk cell', Cc.walk.X, Cc.walk.Y, Cc.walk.Z, 'kids', Cc.walk.kids.map(k => `${k.count}${k.sampleAir ? '(air)' : ''}`).join(' '), 'md1', attrRGB(Cc.walk.md1), 'exact', attrRGB(Cc.walk.exact));
console.log('skin', Cc.skinCount, 'rank of flag', Cc.rank, 'trace adds', Cc.trace.map(t => t.add).join(' + '));
console.log('range', Cc.range.start, '+', Cc.range.n, 'rows', Cc.range.rows, 'head', Cc.range.head, 'tail', Cc.range.tail, 'scanned', Cc.range.scanned, 'mean', Cc.range.mean.map(m => m.toFixed(2)).join(','));
process.exit(bad ? 1 : 0);
