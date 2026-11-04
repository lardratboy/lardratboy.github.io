/* ================== TESTBED ROWS (pure) ==============================
   sol-v4's contact-sheet rows, for anything that wants them as DAGs: the
   Node experiments and tests (through experiments/testbed-corpus.mjs) and,
   since step 4, stream-viewer.html (docs/stream-plan.md, decision 13). No
   imports and no DOM, so a page and Node load the same file.

   The page keeps its core inside the HTML (ifsandwhats.md §6 phase 0,
   splitting it, hasn't happened), so sliceCore() cuts the script out
   between the two marker lines

     /* ================== TOWER CORE (pure) BEGIN ...
     /* ================== TOWER CORE (pure) END ...

   and evaluates it as a function body that returns every top-level name.
   test/load-core.js reads the file with fs and calls it; a page fetch()es
   the HTML and does the same. The slice must stay free of DOM and gl at
   load time; the page says so at the BEGIN marker.

   rowsOf() rebuilds the page's six axes (buildRows() lives inside main(),
   out of reach) with the page's defaults: seed 42, density 0.44
   (DENSITIES[3]), field 0, 12 seed rows. Rule rows come in all four depth
   modes, with g48 = 13 as core.test.js uses, because g48 = 0 (the page
   default) makes "twist" the same as "uniform".

   automatonOf() is classifyCPU() unrolled into dag-core's fromRadix4
   callbacks, written line for line against it: the same digit
   (DIGIT_Q), the same centre (e = 2q − 3), graph before rules, the same
   residual step (4S − A·e), the same clamp and the same rejection. The
   state is (graph state, plane residuals). **It changes when classifyCPU
   does.** If the two ever disagree, the root-equality check in
   test/dag-core.test.js fails.
   ===================================================================== */

const BEGIN = '/* ================== TOWER CORE (pure) BEGIN';
const END = '/* ================== TOWER CORE (pure) END';

export function sliceCore(html, from = 'the page'){
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error(`core markers not found in ${from}`);
  const src = html.slice(a, b);
  // Top-level declarations start at column 0; comma-continued consts
  // (`const RADIX = 4, DIGITS = 64`) contribute their later names too.
  const names = new Set();
  for (const m of src.matchAll(/^(?:function\*?|class|const|let)\s+(\w+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^const\s+[^\n]*?,\s*(\w+)\s*=/gm)) names.add(m[1]);
  return new Function(`"use strict";\n${src}\nreturn { ${[...names].join(', ')} };`)();
}

export const TESTBED = { seed: 42, density: 0.44, fieldMode: 0, g48: 13, seedRows: 12 };
export const AXIS_NAMES = ['shell subsets', 'Td tetrahedra', 'convex polyhedra', 'graph systems', 'symmetry groups', 'seed scan'];

/* Rows as { axis, label, cfgFor(L) }; cfgFor gives classifyCPU's cfg. */
export function rowsOf(core, opts = TESTBED){
  const { DIGITS, MAXL, SHELL_SIZES, ruleFromShells, shellLabel, TD_RULES, tdLabel, POLYHEDRA,
          GRAPH_SYSTEMS, GROUPS, ruleForGroup, conicParams, ruleRandom, rulesFor, DEPTH_NAMES } = core;
  const allPass = () => new Uint32Array(2 * MAXL).fill(0xffffffff);
  const rows = [];
  const ruleRows = (axis, label, base) => DEPTH_NAMES.forEach((dn, dm) => rows.push({
    axis, label, depth: dn, base,
    cfgFor: L => ({ rules: rulesFor(base, dm, L, opts.g48, opts.seed), levels: L }),
  }));
  // Axis 0, the 15 shell subsets, in buildRows()'s order (heaviest first).
  Array.from({ length: 15 }, (_, i) => i + 1)
    .map(s => ({ s, k: [0, 1, 2, 3].reduce((a, i) => a + ((s >> i & 1) ? SHELL_SIZES[i] : 0), 0) }))
    .sort((a, b) => b.k - a.k || a.s - b.s)
    .forEach(({ s }) => ruleRows(0, shellLabel(s), ruleFromShells(s)));
  for (const r of TD_RULES) ruleRows(1, tdLabel(r.base), r.base);
  for (const p of POLYHEDRA)
    rows.push({ axis: 2, label: p.name, depth: '-', cfgFor: L => ({ rules: allPass(), levels: L, planes: p.planes }) });
  for (const g of GRAPH_SYSTEMS)
    rows.push({ axis: 3, label: g.label, depth: '-', graph: g, cfgFor: L => ({ rules: allPass(), levels: L, graph: g.states }) });
  const pars = conicParams(opts.seed);
  for (let gi = 0; gi < GROUPS.length; gi++)
    ruleRows(4, GROUPS[gi].name, ruleForGroup(gi, opts.fieldMode, opts.seed, opts.density, 0, pars));
  const want = Math.max(1, Math.round(opts.density * DIGITS));
  for (let i = 0; i < opts.seedRows; i++) ruleRows(5, `#${opts.seed}.${i}`, ruleRandom(opts.seed, i, want));
  return rows;
}

/* classifyCPU as fromRadix4 callbacks. */
export function automatonOf(core, cfg){
  const { DIGIT_Q, maskHas, stackHas } = core;
  const planes = cfg.planes || [], graph = cfg.graph, rules = cfg.rules;
  const U = planes.map(A => Math.abs(A[0]) + Math.abs(A[1]) + Math.abs(A[2]));
  return {
    start: { gs: 0, s: planes.map(A => A[3]) },
    step(l, st, d){
      const q = DIGIT_Q[d], ex = 2*q[0] - 3, ey = 2*q[1] - 3, ez = 2*q[2] - 3;
      let gs = st.gs;
      if (graph){
        if (!maskHas(graph[gs].keep, d)) return null;
        gs = graph[gs].succ[d];
      } else if (rules){
        if (!stackHas(rules, l, d)) return null;
      }
      const s = new Array(planes.length);
      for (let p = 0; p < planes.length; p++){
        const A = planes[p];
        let v = 4*st.s[p] - (A[0]*ex + A[1]*ey + A[2]*ez);
        if (v >  U[p]+1) v =  U[p]+1;
        if (v < -(U[p]+1)) v = -(U[p]+1);
        if (v < -U[p]) return null;
        s[p] = v;
      }
      return { gs, s };
    },
    accept: st => st.s.every(v => v >= 0),
    keyOf: st => st.gs + ':' + st.s.join(','),
  };
}
