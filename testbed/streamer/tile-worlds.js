/* TILE WORLDS: the endless lattice's worlds, each built by its own core
   (docs/universe-plan.md step 5, docs/universe-log.md). Pure: imports the world
   cores and dag-core, no DOM, so the same build runs in world-worker.js, on the
   page's thread when there are no workers, and in Node's tests.

   A tile (universe-core's cellOf) names a world by kind, seed and depth: the kit
   at D = 8, the city, the dungeon (3 floors), the scatter and the math world (four
   objects on the scatter's hills; added 2026-11-20) at D = 9. Each is
   built as the page builds it alone, with the colour descriptor the page gives it
   (the dungeon's, the scatter's and the math world's carry their tables, so the
   chunk workers never collapse or place them again), and its datum, the y its ground stands at, from
   its own core (tileGrounds, which endlessOf takes for the plane's height). A file
   is the shelf's and never built here.

   What comes back is { store, root, D, ground, colour, label }; the worker sends
   the store's keys (pruned where the core prunes) and the page reads them as a
   storeView: a universe never edits, so its worlds need no real store. */
import { createStore } from './dag-core.js';
import { kitDesc, buildKit, kitGround } from './kit-core.js';
import { cityDesc, buildCity, cityGround } from './city-core.js';
import { dungeonDesc, dungeonPlan, buildDungeon, dungeonGround } from './dungeon-core.js';
import { scatterDesc, buildScatter, scatterGround } from './scatter-core.js';
import { mathDesc, buildMath, mathGround } from './math-core.js';

// Each kind's descriptor for a tile.
export function tileDesc(t){
  if (t.kind === 'kit') return kitDesc({ D: t.D, seed: t.seed });
  if (t.kind === 'city') return cityDesc({ D: t.D, seed: t.seed });
  if (t.kind === 'dungeon') return dungeonDesc({ D: t.D, seed: t.seed, floors: t.floors ?? 3 });
  if (t.kind === 'scatter') return scatterDesc({ D: t.D, seed: t.seed });
  if (t.kind === 'math') return mathDesc({ D: t.D, seed: t.seed });
  throw new Error(`tile-worlds: no build for a ${t.kind}`);
}
/* The five datums at the lattice's depths (universe-core's ENDLESS_KINDS). The
   scatter's is its hills' lowest edge top, the same for every seed (the hills are a
   fixed shape: universe-log step 1), so seed 1's stands for all of them; the test
   holds seeds 1 to 3 to it. The math world stands on the same hills by the same
   rule (mathGround), so its datum is the scatter's: the test holds that too. */
export function tileGrounds(kinds){
  const D = k => kinds.find(x => x.kind === k).D;
  return { kit: kitGround(kitDesc({ D: D('kit') })), city: cityGround(cityDesc({ D: D('city') })),
           dungeon: dungeonGround(dungeonDesc({ D: D('dungeon'), floors: kinds.find(x => x.kind === 'dungeon').floors })),
           scatter: scatterGround(scatterDesc({ D: D('scatter'), seed: 1 })),
           math: mathGround(mathDesc({ D: D('math'), seed: 1 })) };
}
/* A tile's world. In Node: a kit 8–23 ms, a city 30–60, a dungeon 40–100, the
   scatter 0.8–0.9 s, the math world 0.4–0.6 s (one thread; the page's own scatter and
   math world build across its workers). */
export function buildTile(t){
  const t0 = Date.now(), desc = tileDesc(t);
  let w;
  if (t.kind === 'kit'){ const k = buildKit(desc); w = { store: k.store, root: k.root, colour: desc, label: `kit, seed ${t.seed}` }; }
  else if (t.kind === 'city'){ const c = buildCity(desc); w = { store: c.store, root: c.root, colour: desc, label: `city, seed ${t.seed}` }; }
  else if (t.kind === 'dungeon'){
    const plan = dungeonPlan(desc), d = buildDungeon(desc, { store: createStore(), plan });
    w = { store: d.store, root: d.root, colour: { ...desc, table: plan.codes }, label: `dungeon, seed ${t.seed}, ${desc.floors} floors` };
  } else if (t.kind === 'math'){
    const m = buildMath(desc);
    w = { store: m.store, root: m.root, colour: { ...desc, table: m.table }, label: `math, seed ${t.seed}` };
  } else {
    const s = buildScatter(desc);
    w = { store: s.store, root: s.root, colour: { kind: 'scatter', ...desc, table: s.table }, label: `scatter, seed ${t.seed}` };
  }
  const ground = t.kind === 'kit' ? kitGround(desc) : t.kind === 'city' ? cityGround(desc) : t.kind === 'dungeon' ? dungeonGround(desc) : t.kind === 'math' ? mathGround(desc) : scatterGround(desc);
  return { ...w, D: t.D, ground, ms: Date.now() - t0 };
}
