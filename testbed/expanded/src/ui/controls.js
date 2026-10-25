/* CONTROLS — the bottom panel (tabs of selects, sliders, buttons, goto box) and
   the global keyboard map. Binds every element in the constructor. Simple
   settings are written straight into state.js / CFG; anything that has to
   coordinate several owners (focus, pins, flushing the lattice) goes
   through the `actions` the composition root supplies. */
import { Core } from '../core/bimoblock-core.js';
import { SOURCE_NAMES, PLACE_NAMES, ORIENT_NAMES, WARP_NAMES, EPS_STEPS } from '../core/neoblock-core.js';
import { FRAME_NAMES, FORMULA_NAMES, BANDS, K_NAMES } from '../core/field-core.js';
import { SHAPE_NAMES, NUMBER_NAMES, BASE_NAMES } from '../core/digit-core.js';
import { RULE_NAMES, STENCIL_NAMES, LEVEL_NAMES, STEPS } from '../core/carry-core.js';
import { MOTIF_NAMES, FLAW_NAMES, PERIODS, VIEW_NAMES } from '../core/claudegen-core.js';
import { RULE_NAMES as NEST_RULES, INNER_NAMES, CARVE_NAMES, TWIST_NAMES } from '../core/nest-core.js';
import { RULE_NAMES as CA_RULES, SEED_NAMES, TIME_NAMES, DRAW_NAMES } from '../core/spacetime-core.js';
import { CFG, clamp } from '../config.js';
import { Axis, Filter, Mint, Pin, State, Bloom, Focus, Marks, Neo, Easy, Digit, Carry, Claudegen, Nest, Spacetime, Generator } from '../state.js';
import { symmetryLabel, cellWorldX, cellWorldZ, axisRoles } from '../lattice/recipe.js';
import { GENERATORS, generatorURL, activeGenerator } from '../lattice/generators.js';
import { exportSpecimenOBJ, exportSheetOBJ } from '../export/obj.js';
import { buildDetached } from '../lattice/generation.js';
import { writeHash, commitHash, hashString } from './permalink.js';
import { initTabs } from './tabs.js';

const { GROUPS, ARCH_NAMES, FIELD_NAMES } = Core;

function opt(sel, value, label, selected){
  const o = document.createElement('option');
  o.value = value; o.textContent = label;
  if (selected) o.selected = true;
  sel.appendChild(o);
}

export class Controls {
  /* actions: { setFocus(i,j,announce), pinAt(i,j), unpin(),
                flushLattice(), applyConfiguration() } */
  constructor({ rig, virtualiser, hud, labels, fingerprint, actions }){
    this.rig = rig; this.virtualiser = virtualiser; this.hud = hud; this.labels = labels;
    this.actions = actions;
    const $ = id => document.getElementById(id);
    const setStatus = text => hud.setStatus(text);
    const showToast = msg => hud.showToast(msg);

    // A generator's own tab exists only on its pages; drop the others before
    // the tab strip is wired so a remembered tab can't select a missing page.
    if (Generator.id !== 'neo'){ $('neoTab').remove(); $('neoPage').remove(); }
    if (Generator.id !== 'field'){ $('fieldTab').remove(); $('fieldPage').remove(); }
    if (Generator.id !== 'digit'){ $('digitTab').remove(); $('digitPage').remove(); }
    if (Generator.id !== 'carry'){ $('carryTab').remove(); $('carryPage').remove(); }
    if (Generator.id !== 'claudegen'){ $('claudegenTab').remove(); $('claudegenPage').remove(); }
    if (Generator.id !== 'nest'){ $('nestTab').remove(); $('nestPage').remove(); }
    if (Generator.id !== 'spacetime'){ $('spacetimeTab').remove(); $('spacetimePage').remove(); }
    initTabs($('panel'));

    /* ---- selects ---------------------------------------------------- */
    const selAxX  = this.selAxX  = $('axX');
    const selAxY  = this.selAxY  = $('axY');
    const selSym  = this.selSym  = $('sym');
    const selArch = this.selArch = $('arch');
    const selFld  = this.selFld  = $('field');
    const selColor = $('colorMode');
    const selRender = $('renderMode');

    axisRoles().forEach(r => opt(selAxX, r.id, 'x axis: ' + r.label, r.id === Axis.x));
    axisRoles().forEach(r => opt(selAxY, r.id, 'y axis: ' + r.label, r.id === Axis.y));

    // Switching generator reloads at the same address: the generator is
    // fixed for a page's life (see lattice/generators.js).
    const selGen = $('generator');
    Object.values(GENERATORS).forEach(g => opt(selGen, g.id, 'generator: ' + g.label, g.id === Generator.id));
    selGen.addEventListener('change', () => {
      commitHash(rig);
      location.assign(generatorURL(selGen.value, location.href));
    });

    opt(selSym, '-1', 'symmetry: roam', true);
    GROUPS.forEach((g, i) => opt(selSym, String(i), 'symmetry: ' + g.name));
    opt(selArch, '-1', 'archetype: roam', true);
    ARCH_NAMES.forEach((n, i) => opt(selArch, String(i), 'archetype: ' + n));
    opt(selFld, '-1', 'field: roam', true);
    FIELD_NAMES.forEach((n, i) => opt(selFld, String(i), 'field: ' + n));
    // Only bimoblocks and neoblocks have a bimoblock field; elsewhere the archetype is a clip.
    if (Generator.id !== 'bimo' && Generator.id !== 'neo'){
      selFld.style.display = 'none';
      selArch.options[0].textContent = 'clip: roam';
      ARCH_NAMES.forEach((n, i) => { selArch.options[i + 1].textContent = 'clip: ' + n; });
      selSym.options[0].textContent = 'fold: none (roam)';
      GROUPS.forEach((g, i) => { selSym.options[i + 1].textContent = 'fold: ' + g.name; });
    }
    // A nestblock's fold roams over seven groups rather than staying off.
    if (Generator.id === 'nest') selSym.options[0].textContent = 'fold: roam (Oh … C2v)';
    // Likewise a spacetime fold, over the three that keep its copies architectural.
    if (Generator.id === 'spacetime') selSym.options[0].textContent = 'fold: roam (C4v, C4, C2v)';

    // Additive display modes only — never touch generation, so switching never
    // invalidates the cache or needs flushLattice(). Specimens built before this
    // mode existed (or LOD proxies, which never carry orbit data) just have no
    // colorOrbit attribute and layout() falls back to gamut for them.
    opt(selColor, 'gamut', 'color: gamut position', true);
    opt(selColor, 'chiral', 'color: chirality');
    opt(selColor, 'orbit', 'color: orbit index');

    // Likewise display-only: the views are cut from the cached mesh on demand.
    opt(selRender, 'solid',   'display: solid', true);
    opt(selRender, 'wire',    'display: wireframe');
    opt(selRender, 'points',  'display: vertices');
    opt(selRender, 'centers', 'display: box centers');

    selAxX.addEventListener('change', () => this.setAxis('x', selAxX.value));
    selAxY.addEventListener('change', () => this.setAxis('y', selAxY.value));
    selSym.addEventListener('change',  () => { Filter.sym   = parseInt(selSym.value, 10);  actions.flushLattice(); });
    selArch.addEventListener('change', () => { Filter.arch  = parseInt(selArch.value, 10); actions.flushLattice(); });
    selFld.addEventListener('change',  () => { Filter.field = parseInt(selFld.value, 10);  actions.flushLattice(); });
    selColor.addEventListener('change', () => {
      State.colorMode = selColor.value;
      const label = State.colorMode === 'chiral' ? 'chirality (amber = chiral, blue = achiral)'
        : State.colorMode === 'orbit' ? 'orbit index (hue = which symmetric copy folded here)'
        : 'gamut position';
      setStatus('color mode: ' + label);
    });
    selRender.addEventListener('change', () => {
      State.renderMode = selRender.value;
      virtualiser.resetSlots();   // the drawable class changes with the mode
      const label = { solid:'solid boxes', wire:'wireframe (box edges)',
                      points:'mesh vertices', centers:'box centers (one point per voxel)' }[State.renderMode];
      setStatus('display: ' + label);
    });

    /* ---- sliders ---------------------------------------------------- */
    const inDens  = this.inDens = $('dens');
    const inPitch = $('pitch');
    const inSize  = $('size');
    const inTilt  = this.inTilt = $('tilt');
    const inSpin  = $('spin');
    const inHaze  = $('haze');
    const inKin   = this.inKin = $('kin');
    const inHoriz = $('horizon');
    // A generator may read density its own way (digit pages: a threshold
    // that keeps every nonzero digit from 90%), with its own range and start.
    const gen = activeGenerator();
    if (gen.densityMax) inDens.max = String(gen.densityMax);
    inDens.value = String(Math.round(Mint.density * 100));

    inDens.addEventListener('input', () => {
      Mint.density = parseInt(inDens.value, 10) / 100;
      setStatus('generation density ' + inDens.value + '%');
      actions.applyConfiguration();
    });
    inPitch.addEventListener('input', () => {
      CFG.CELL = parseInt(inPitch.value, 10) / 10;
      virtualiser.invalidate();
      setStatus('lattice pitch ' + CFG.CELL.toFixed(1));
    });
    inSize.addEventListener('input', () => {
      CFG.BLOCK_S = parseInt(inSize.value, 10) / 100;
      setStatus('specimen size ' + CFG.BLOCK_S.toFixed(2));
    });
    inTilt.addEventListener('input', () => {
      rig.tilt = parseInt(inTilt.value, 10) * Math.PI / 180;
      rig.tilt = clamp(rig.tilt, 0.52, 1.535);
      rig.apply(); virtualiser.invalidate();
    });
    inSpin.addEventListener('input', () => { State.spin = parseInt(inSpin.value, 10) / 100; });
    inHaze.addEventListener('input', () => { State.haze = parseInt(inHaze.value, 10) / 100; });
    inKin.addEventListener('input', () => {
      Pin.radius = parseInt(inKin.value, 10);
      const n = 2 * Pin.radius + 1;
      setStatus('district radius ' + Pin.radius + '  ·  ' + (n * n) + ' relatives');
      if (Pin.on){ Pin.epoch++; virtualiser.invalidate(); }
    });
    inHoriz.addEventListener('input', () => {
      CFG.MAX_VISIBLE = Math.min(CFG.POD_MAX, parseInt(inHoriz.value, 10));
      virtualiser.invalidate();
      setStatus('horizon holds ' + CFG.MAX_VISIBLE + ' specimens');
    });

    /* ---- neoblock dials (neo pages only) ------------------------------ */
    if (Generator.id === 'neo'){
      const selSource = this.selSource = $('neoSource');
      const selPlace = this.selPlace = $('neoPlace');
      const inPalette = this.inPalette = $('neoPalette');
      const selOrient = this.selOrient = $('neoOrient');
      SOURCE_NAMES.forEach((n, i) => opt(selSource, String(i), 'source: ' + n, i === Neo.source));
      PLACE_NAMES.forEach((n, i) => opt(selPlace, String(i), 'placement: ' + n, i === Neo.place));
      ORIENT_NAMES.forEach((n, i) => opt(selOrient, String(i), 'turn: ' + n, i === Neo.orient));
      inPalette.value = String(Neo.palette);
      selSource.addEventListener('change', () => {
        Neo.source = parseInt(selSource.value, 10);
        setStatus('source ' + SOURCE_NAMES[Neo.source]);
        this.syncFilterEnablement();
        actions.flushLattice();
      });
      selPlace.addEventListener('change', () => {
        Neo.place = parseInt(selPlace.value, 10);
        setStatus('placement: ' + PLACE_NAMES[Neo.place]);
        actions.flushLattice();
      });
      inPalette.addEventListener('input', () => {
        Neo.palette = parseInt(inPalette.value, 10);
        setStatus('palette of ' + Neo.palette + (Neo.palette === 1 ? ' child' : ' children'));
        actions.applyConfiguration();
      });
      selOrient.addEventListener('change', () => {
        Neo.orient = parseInt(selOrient.value, 10);
        setStatus('children turned: ' + ORIENT_NAMES[Neo.orient]);
        actions.flushLattice();
      });

      const selWarp = this.selWarp = $('neoWarp');
      const inWarpAmt = this.inWarpAmt = $('neoWarpAmt');
      const inEps = this.inEps = $('neoEps');
      const btnLargest = this.btnLargest = $('neoLargest');
      WARP_NAMES.forEach((n, i) => opt(selWarp, String(i), 'warp: ' + n, i === Neo.warp));
      inWarpAmt.value = String(Neo.warpAmt);
      inEps.value = String(Neo.eps);
      btnLargest.classList.toggle('on', !!Neo.largest);
      selWarp.addEventListener('change', () => {
        Neo.warp = parseInt(selWarp.value, 10);
        setStatus('warp ' + WARP_NAMES[Neo.warp]);
        actions.flushLattice();
      });
      inWarpAmt.addEventListener('input', () => {
        Neo.warpAmt = parseInt(inWarpAmt.value, 10);
        setStatus('warp amount ' + Neo.warpAmt + ' / 8');
        actions.applyConfiguration();
      });
      inEps.addEventListener('input', () => {
        Neo.eps = parseInt(inEps.value, 10);
        setStatus('broken symmetry ε ' + EPS_STEPS[Neo.eps]);
        actions.applyConfiguration();
      });
      btnLargest.addEventListener('click', () => {
        Neo.largest = Neo.largest ? 0 : 1;
        btnLargest.classList.toggle('on', !!Neo.largest);
        setStatus(Neo.largest ? 'keeping only the largest piece' : 'keeping every piece');
        actions.flushLattice();
      });
    }

    /* ---- mod-field dials (field pages only) -------------------------- */
    if (Generator.id === 'field'){
      const dial = (id, key, names, what) => {
        const sel = this['sel_' + key] = $(id);
        opt(sel, '-1', what + ': roam', Easy[key] < 0);
        names.forEach((n, i) => opt(sel, String(i), what + ': ' + n, i === Easy[key]));
        sel.addEventListener('change', () => {
          Easy[key] = parseInt(sel.value, 10);
          setStatus(what + ' ' + (Easy[key] < 0 ? 'roams' : names[Easy[key]]));
          actions.flushLattice();
        });
      };
      dial('fieldFrame', 'frame', FRAME_NAMES, 'frame');
      dial('fieldFormula', 'formula', FORMULA_NAMES, 'formula');
      dial('fieldBands', 'bands', BANDS.map((b, i) => `${b} (pascal step ${i + 1})`), 'bands');
      dial('fieldK', 'k', K_NAMES, 'k');
    }

    /* ---- number-picture dials (digit pages only) --------------------- */
    if (Generator.id === 'digit'){
      const dial = (id, key, names, what) => {
        const sel = this['sel_' + key] = $(id);
        opt(sel, '-1', what + ': roam', Digit[key] < 0);
        names.forEach((n, i) => opt(sel, String(i), what + ': ' + n, i === Digit[key]));
        sel.addEventListener('change', () => {
          Digit[key] = parseInt(sel.value, 10);
          setStatus(what + ' ' + (Digit[key] < 0 ? 'roams' : names[Digit[key]]));
          actions.flushLattice();
        });
      };
      dial('digitShape', 'shape', SHAPE_NAMES, 'shape');
      dial('digitNumber', 'number', NUMBER_NAMES, 'number');
      dial('digitBase', 'base', BASE_NAMES, 'base');
    }

    /* ---- carry dials (carry pages only) ------------------------------ */
    if (Generator.id === 'carry'){
      const dial = (id, key, names, what) => {
        const sel = this['sel_' + key] = $(id);
        opt(sel, '-1', what + ': roam', Carry[key] < 0);
        names.forEach((n, i) => opt(sel, String(i), what + ': ' + n, i === Carry[key]));
        sel.addEventListener('change', () => {
          Carry[key] = parseInt(sel.value, 10);
          setStatus(what + ' ' + (Carry[key] < 0 ? 'roams' : names[Carry[key]]));
          actions.flushLattice();
        });
      };
      // Stencil and level mean something different per rule: list both.
      const both = lists => lists[0].map((n, i) => lists.map(l => l[i]).join(' | '));
      dial('carryRule', 'rule', RULE_NAMES, 'rule');
      dial('carryStencil', 'stencil', both(STENCIL_NAMES), 'stencil');
      dial('carryStep', 'step', Array.from({ length: STEPS }, (_, i) => String(i)), 'step');
      dial('carryLevel', 'level', both(LEVEL_NAMES), 'level');
    }

    /* ---- claudegen dials (claudegen pages only) ---------------------- */
    if (Generator.id === 'claudegen'){
      const dial = (id, key, names, what) => {
        const sel = this['sel_' + key] = $(id);
        opt(sel, '-1', what + ': roam', Claudegen[key] < 0);
        names.forEach((n, i) => opt(sel, String(i), what + ': ' + n, i === Claudegen[key]));
        sel.addEventListener('change', () => {
          Claudegen[key] = parseInt(sel.value, 10);
          setStatus(what + ' ' + (Claudegen[key] < 0 ? 'roams' : names[Claudegen[key]]));
          actions.flushLattice();
        });
      };
      dial('cgMotif', 'motif', MOTIF_NAMES, 'crystal');
      dial('cgFlaw', 'flaw', FLAW_NAMES, 'flaw');
      // A strength step means something different per flaw; the inspector names it.
      dial('cgStrength', 'strength', ['1 · gentlest', '2', '3', '4 · strongest'], 'strength');
      dial('cgSpacing', 'spacing', PERIODS.map(n => n + ' periods'), 'spacing');
      dial('cgView', 'view', VIEW_NAMES, 'view');
    }

    /* ---- nestblock dials (nest pages only) --------------------------- */
    if (Generator.id === 'nest'){
      const dial = (id, key, names, what) => {
        const sel = this['sel_' + key] = $(id);
        opt(sel, '-1', what + ': roam', Nest[key] < 0);
        names.forEach((n, i) => opt(sel, String(i), what + ': ' + n, i === Nest[key]));
        sel.addEventListener('change', () => {
          Nest[key] = parseInt(sel.value, 10);
          setStatus(what + ' ' + (Nest[key] < 0 ? 'roams' : names[Nest[key]]));
          actions.flushLattice();
        });
      };
      dial('nestOuter', 'outer', NEST_RULES, 'rule');
      dial('nestInner', 'inner', INNER_NAMES, 'inner');
      dial('nestCarve', 'carve', CARVE_NAMES, 'carve');
      dial('nestTwist', 'twist', TWIST_NAMES, 'twist');
    }

    /* ---- spacetime dials (spacetime pages only) ---------------------- */
    if (Generator.id === 'spacetime'){
      const dial = (id, key, names, what) => {
        const sel = this['sel_' + key] = $(id);
        opt(sel, '-1', what + (key === 'draw' ? ': roam (auto)' : ': roam'), Spacetime[key] < 0);
        names.forEach((n, i) => opt(sel, String(i), what + ': ' + n, i === Spacetime[key]));
        sel.addEventListener('change', () => {
          Spacetime[key] = parseInt(sel.value, 10);
          setStatus(what + ' ' + (Spacetime[key] < 0 ? 'roams' : names[Spacetime[key]]));
          actions.flushLattice();
        });
      };
      dial('stRule', 'ca', CA_RULES, 'rule');
      dial('stStart', 'start', SEED_NAMES, 'seed');
      dial('stTime', 'time', TIME_NAMES, 'time');
      dial('stDraw', 'draw', DRAW_NAMES, 'draw');
    }

    /* ---- buttons ---------------------------------------------------- */
    const btnHome   = $('home');
    const btnWarp   = $('warp');
    const btnAlign  = $('align');
    const btnBloom  = this.btnBloom = $('bloom');
    const btnLabels = $('labelsBtn');
    const btnKey    = $('keyBtn');
    const btnShuf   = $('shuffle');
    const inGoto    = $('goto');

    btnHome.addEventListener('click', () => { rig.glideTo(0, 0, 15); actions.setFocus(0, 0, false); setStatus('returned to origin'); });
    btnWarp.addEventListener('click', () => {
      const i = (Math.random() * 2000 - 1000) | 0, j = (Math.random() * 2000 - 1000) | 0;
      rig.x = cellWorldX(i); rig.z = cellWorldZ(j);
      rig.vx = rig.vz = 0;
      virtualiser.invalidate();
      actions.setFocus(i, j, false);
      showToast(`warped to district ${i}, ${j}`);
    });
    btnAlign.addEventListener('click', () => {
      State.align = !State.align;
      btnAlign.classList.toggle('on', State.align);
      setStatus(State.align ? 'specimens aligned for comparison' : 'idle rotation resumed');
    });
    btnBloom.addEventListener('click', () => {
      Bloom.on = !Bloom.on;
      btnBloom.classList.toggle('on', Bloom.on);
      if (Bloom.on){
        actions.pinAt(Focus.i, Focus.j);
        const p = virtualiser.at(Focus.i, Focus.j);
        showToast(p ? `blooming ${Focus.i}, ${Focus.j} · ${ARCH_NAMES[p.arch]} · ${symmetryLabel(p)}`
                    : `blooming ${Focus.i}, ${Focus.j}`);
      } else {
        actions.unpin();
        setStatus('district released — lattice restored');
      }
    });
    btnLabels.addEventListener('click', () => {
      State.labels = !State.labels;
      labels.markDirty();
      btnLabels.classList.toggle('on', State.labels);
    });
    btnKey.addEventListener('click', () => {
      State.legend = !State.legend;
      btnKey.classList.toggle('on', State.legend);
      hud.setLegendVisible(State.legend);
    });
    btnShuf.addEventListener('click', () => {
      Mint.gen++;
      actions.flushLattice();
      writeHash();
      showToast('lattice re-minted — generation ' + Mint.gen);
    });
    $('expSheet').addEventListener('click', () => this.exportSheet());
    $('expObj').addEventListener('click', () => this.exportSpecimen());
    $('fpBtn').addEventListener('click', () => fingerprint.toggle());

    inGoto.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key !== 'Enter') return;
      const m = /^\s*(-?\d+)\s*[, ]\s*(-?\d+)\s*$/.exec(inGoto.value);
      if (!m){ setStatus('address must look like  12, -7'); return; }
      const i = parseInt(m[1], 10), j = parseInt(m[2], 10);
      const far = Math.hypot(cellWorldX(i) - rig.x, cellWorldZ(j) - rig.z) > CFG.CELL * 26;
      if (far){ rig.x = cellWorldX(i); rig.z = cellWorldZ(j); virtualiser.invalidate(); }
      else rig.glideTo(i, j);
      actions.setFocus(i, j, false);
      inGoto.blur();
      showToast(`cell ${i}, ${j}`);
    });

    /* ---- keyboard --------------------------------------------------- */
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;
      const step = e.shiftKey ? 5 : 1;
      switch (e.key){
        case 'ArrowLeft':  rig.glideTo(Focus.i - step, Focus.j); actions.setFocus(Focus.i - step, Focus.j, false); e.preventDefault(); break;
        case 'ArrowRight': rig.glideTo(Focus.i + step, Focus.j); actions.setFocus(Focus.i + step, Focus.j, false); e.preventDefault(); break;
        case 'ArrowUp':    rig.glideTo(Focus.i, Focus.j + step); actions.setFocus(Focus.i, Focus.j + step, false); e.preventDefault(); break;
        case 'ArrowDown':  rig.glideTo(Focus.i, Focus.j - step); actions.setFocus(Focus.i, Focus.j - step, false); e.preventDefault(); break;
        case '[': actions.setFocus(Focus.i - 1, Focus.j, true); break;
        case ']': actions.setFocus(Focus.i + 1, Focus.j, true); break;
        case 'a': case 'A': btnAlign.click(); break;
        case 'b': case 'B': btnBloom.click(); break;
        case 'l': case 'L': btnLabels.click(); break;
        case 'k': case 'K': btnKey.click(); break;
        case 'g': case 'G': btnShuf.click(); break;
        case 'h': case 'H': btnHome.click(); break;
        case 'w': case 'W': btnWarp.click(); break;
        case 'o': case 'O': this.exportSpecimen(); break;
        case 'e': case 'E': this.exportSheet(); break;
        case 'c': case 'C': this.copyAddress(); break;
        case 'x': case 'X': this.clearMarks(); break;
        case 'f': case 'F': fingerprint.toggle(); break;
      }
    });

    this.syncFilterEnablement();
    this.setTiltSlider();
  }

  syncFilterEnablement(){
    this.selSym.disabled  = (Axis.x === 'sym'   || Axis.y === 'sym');
    this.selArch.disabled = (Axis.x === 'arch'  || Axis.y === 'arch');
    this.selFld.disabled  = (Axis.x === 'field' || Axis.y === 'field');
    this.inDens.disabled  = (Axis.x === 'dens'  || Axis.y === 'dens');
    if (Generator.id === 'neo'){
      const owned = id => Axis.x === id || Axis.y === id;
      // The composite dials only matter when the source can be a composite.
      const comp = Neo.source === 1 || owned('source');
      this.selSource.disabled  = owned('source');
      this.selPlace.disabled   = owned('place') || !comp;
      this.inPalette.disabled  = owned('palette') || !comp;
      this.selOrient.disabled  = owned('orient') || !comp;
      this.selWarp.disabled    = owned('warp');
      this.inWarpAmt.disabled  = owned('warpAmt');
      this.inEps.disabled      = owned('eps');
      this.btnLargest.disabled = owned('largest');
    }
    if (Generator.id === 'field')
      for (const key of ['frame', 'formula', 'bands', 'k'])
        this['sel_' + key].disabled = Axis.x === key || Axis.y === key;
    if (Generator.id === 'digit')
      for (const key of ['shape', 'number', 'base'])
        this['sel_' + key].disabled = Axis.x === key || Axis.y === key;
    if (Generator.id === 'carry'){
      for (const key of ['rule', 'stencil', 'step', 'level'])
        this['sel_' + key].disabled = Axis.x === key || Axis.y === key;
      this.inDens.disabled = true;   // the level dial says what is kept
    }
    if (Generator.id === 'claudegen')
      for (const key of ['motif', 'flaw', 'strength', 'spacing', 'view'])
        this['sel_' + key].disabled = Axis.x === key || Axis.y === key;
    if (Generator.id === 'nest'){
      for (const key of ['outer', 'inner', 'carve', 'twist'])
        this['sel_' + key].disabled = Axis.x === key || Axis.y === key;
      this.inDens.disabled = true;   // the rules set the fill
    }
    if (Generator.id === 'spacetime'){
      for (const key of ['ca', 'start', 'time', 'draw'])
        this['sel_' + key].disabled = Axis.x === key || Axis.y === key;
      this.inDens.disabled = true;   // the rule decides every cell
    }
  }

  setAxis(which, id){
    const other = which === 'x' ? 'y' : 'x';
    // Two axes may not enumerate the same thing; the loser falls back to roam.
    if (id !== 'free' && Axis[other] === id){
      Axis[other] = 'free';
      (other === 'x' ? this.selAxX : this.selAxY).value = 'free';
    }
    Axis[which] = id;
    this.syncFilterEnablement();
    this.hud.resetStatus();
    this.actions.flushLattice();
  }

  /* Mirror the rig's tilt into its slider (after an orbit drag). */
  setTiltSlider(){ this.inTilt.value = String(Math.round(this.rig.tilt * 180 / Math.PI)); }
  /* Mirror Bloom/Pin state into the button and radius slider (after a permalink). */
  syncBloomUI(){
    this.inKin.value = String(Pin.radius);
    this.btnBloom.classList.toggle('on', Bloom.on);
  }

  exportSpecimen(){
    exportSpecimenOBJ({ specimen: this.virtualiser.at(Focus.i, Focus.j), toast: m => this.hud.showToast(m) });
  }
  /* The marked cells if there are any, otherwise everything in view. A mark
     that is not resident (evicted, or never on screen) is built on the spot,
     so the export never silently drops one; unminted visible cells are
     simply skipped, as they always were. */
  exportSheet(){
    const v = this.virtualiser, marked = Marks.size > 0;
    const cells = marked
      ? [...Marks.values()].map(({ i, j }) => ({ i, j, p: v.at(i, j) || buildDetached(i, j) }))
      : v.visible.map(({ i, j, key }) => ({ i, j, p: v.cache.get(key) })).filter(c => c.p);
    exportSheetOBJ({ rig: this.rig, cells, marked, toast: m => this.hud.showToast(m) });
  }
  clearMarks(){
    const n = Marks.size;
    Marks.clear();
    this.hud.showToast(n ? `cleared ${n} mark${n === 1 ? '' : 's'}` : 'nothing marked');
  }
  copyAddress(){
    const rig = this.rig, showToast = m => this.hud.showToast(m);
    commitHash(rig);
    const text = location.href.split('#')[0] + hashString(rig);
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text)
        .then(() => showToast('address copied — ' + Focus.i + ', ' + Focus.j))
        .catch(err => { console.warn('clipboard refused', err); showToast('copy blocked; see console'); console.log(text); });
    } else {
      console.log(text);
      showToast('address logged to console');
    }
  }
}
