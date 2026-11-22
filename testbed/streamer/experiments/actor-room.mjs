/* How far the page's actors keep from the eye (docs/actors-log.md, "More room",
   asked for 2026-11-21: "crowding the player's view too often"). The page's
   leash (stream-viewer's actorLeash) at two settings, the old LEASH 48 /
   SPACE 16 and the new 96 / 32, on clay's flat ground at D = 10, 100 actors
   of each kind, the eye 40 above the ground looking 0.3 down, still or flying
   along z at 30 voxels a second. Ticks 600–1800 (10 to 30 s) are sampled
   every tenth: the distance from the eye to each actor's centre (mean,
   quartiles, the nearest), and the share inside a cone of 0.6 rad round the
   view, and of those, nearer than 32. The core's functions, unchanged; the
   regather as the page's (twice a second, past 16 × LEASH). Prints only.
   `node experiments/actor-room.mjs` (~1 min). */
import { buildClay, clayDesc } from '../clay-core.js';
import { dagWorld, createActors, spawnNear, tickActors, regather, FLIER, ONE } from '../actor-core.js';
import { actorBody } from '../body-core.js';

const D = 10, { store, root } = buildClay(clayDesc({ D, lump: 0, ground: true }));
const world = dagWorld(store, root, D), side = 2 ** D;
const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
const FWD = norm([0, -0.3, 1]), CONE = 0.6;

function run(LEASH, SPACE, kind, speed, n = 100, ticks = 1800){
  const eye = [side / 2 + 0.5, side / 2 + 40.5, side / 4 + 0.5];
  const leash = () => ({ at: eye.map(v => Math.round(v * ONE)), radius: LEASH, shift: 4, max: 256, inner: SPACE, innerShift: 2, innerMax: 192 });
  const A = createActors(n);
  for (let i = 0; i < n; i++){ A.kind[i] = kind; spawnNear(world, A, i, actorBody(1, i).size, 1, eye.map(Math.floor), LEASH, 32, FLIER.trap, leash()); }
  const ds = []; let seen = 0, seenNear = 0;
  for (let t = 0; t < ticks; t++){
    eye[2] += speed / 60;
    const L = leash();
    tickActors(world, A, { ...FLIER, leash: L });
    if (A.t % 30 === 0) regather(world, A, 1, eye.map(Math.floor), LEASH, 16 * LEASH, 8, FLIER.trap, L);
    if (t < 600 || t % 10) continue;
    for (let i = 0; i < n; i++){
      if (!A.alive[i]) continue;
      const c = [0, 1, 2].map(a => A.pos[3 * i + a] / ONE + A.size[3 * i + a] / 2 - eye[a]), d = Math.hypot(...c);
      ds.push(d);
      if (c[0] * FWD[0] + c[1] * FWD[1] + c[2] * FWD[2] > d * Math.cos(CONE)){ seen++; if (d < 32) seenNear++; }
    }
  }
  ds.sort((a, b) => a - b);
  const q = p => ds[Math.floor(p * (ds.length - 1))].toFixed(0), pc = k => (100 * k / ds.length).toFixed(1) + '%';
  return `${String(ds.reduce((s, v) => s + v, 0) / ds.length | 0).padStart(5)} ${q(0.25).padStart(5)} ${q(0.5).padStart(5)} ${q(0.75).padStart(5)} ${q(0).padStart(6)} ${pc(seen).padStart(8)} ${pc(seenNear).padStart(9)}`;
}

console.log('leash space kind      eye    | mean   q1  med   q3  nearest  in view  view < 32');
for (const [LEASH, SPACE] of [[48, 16], [96, 32]])
  for (const [kind, name] of [[0, 'fliers'], [1, 'explorers'], [2, 'vehicles']])
    for (const speed of [0, 30])
      console.log(`${String(LEASH).padStart(5)} ${String(SPACE).padStart(5)} ${name.padEnd(9)} ${speed ? 'flying' : 'still '} | ${run(LEASH, SPACE, kind, speed)}`);
