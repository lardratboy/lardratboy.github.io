/* GENERATORS — what can fill the lattice, and which one does on this page.
   One generator at a time: `?g=<id>` picks it at startup and it stays for
   the page's life. Each entry supplies the address → recipe step and the
   text the inspector and floor labels show for one of its specimens; the
   numeric build behind the same id lives in core/cores.js, so it can run in
   a worker. */
import { Core } from '../core/bimoblock-core.js';
import { PLACE_NAMES, ORIENT_NAMES, WARP_NAMES, EPS_STEPS, WARP_STEPS, compositeSplit } from '../core/neoblock-core.js';
import { FRAME_NAMES, FORMULA_NAMES, FORMULA_PASCAL, FORMULA_NORM, REAL_FORMULAS, BANDS, K_NAMES, PASCAL_APEX } from '../core/field-core.js';
import { SHAPE_NAMES, NUMBER_NAMES, NUMBER_TEXT, BASE_NAMES, FRACTIONAL, COLLATZ } from '../core/digit-core.js';
import { RULE_NAMES, STENCIL_NAMES, LEVEL_NAMES, POWER_STENCILS } from '../core/carry-core.js';
import { MOTIFS, FLAWS, STRENGTH_NAMES, PERIODS, VIEWS } from '../core/claudegen-core.js';
import { RULE_NAMES as NEST_RULES, CARVE_NAMES, TWIST_NAMES, ruleClasses } from '../core/nest-core.js';
import { RULES as CA_RULES, NEIGHBOURHOODS, SEED_NAMES, CENTRED_SEEDS, SOUP_SIZE, TIME_NAMES, DRAW_NAMES, ruleCode, ruleBS } from '../core/spacetime-core.js';
import { ARRANGEMENTS, SEAT_NAMES, WHOLE_NOTES, groupName } from '../core/mirror-core.js';
import { Generator, Axis, Tier, Mint } from '../state.js';
import { cellRecipe, symmetryLabel } from './recipe.js';
import { neoCellRecipe } from './neo-recipe.js';
import { fieldCellRecipe } from './field-recipe.js';
import { digitCellRecipe } from './digit-recipe.js';
import { carryCellRecipe } from './carry-recipe.js';
import { claudegenCellRecipe } from './claudegen-recipe.js';
import { nestCellRecipe } from './nest-recipe.js';
import { spacetimeCellRecipe } from './spacetime-recipe.js';
import { mirrorCellRecipe } from './mirror-recipe.js';

const { ARCH_NAMES, FIELD_NAMES, NATIVE_FIELDS, LEGACY_FIELD_COUNT, LIFT_NAMES } = Core;
const k = text => `<span class="k">${text}</span>`;

/* The inspector's trait lines for a recipe built on bimoblock traits. */
const bimoTraits = p =>
  `${k(p.tierSymmetry ? 'tiers out → in' : 'group')} <b>${symmetryLabel(p)}</b>\n` +
  `${k('archetype')} <b>${ARCH_NAMES[p.arch]}</b>\n` +
  `${k('field')} <b>${FIELD_NAMES[p.field]}</b>` +
    (p.field >= NATIVE_FIELDS && p.field < LEGACY_FIELD_COUNT ? ` ${k('/')} <b>${LIFT_NAMES[p.lift]}</b>` : '') + `\n`;

/* A mod field's modulus text: the bands it asked for and, once built, the
   modulus and phase they came to at this resolution (a real formula's
   modulus is a band width; pascal: the base and apex its step came to). */
const fmtMod = m => Number.isInteger(m) ? String(m) : m.toPrecision(3);
const modText = p => p.formula === FORMULA_PASCAL
  ? (p.meta ? `base ${p.meta.base} · apex ${PASCAL_APEX[p.meta.apex]}` : `step ${(p.bands | 0) + 1}`)
  : `${BANDS[p.bands]} band${BANDS[p.bands] === 1 ? '' : 's'}${p.meta ? ` · mod ${fmtMod(p.meta.modulus)}` : ''}` +
    (p.meta?.phase ? ` · phase ${p.meta.phase}` : '');
/* The seeded or layout parameters the build reports: sign pattern, p,
   periods, cell, radices, tile. */
const detailText = p => p.meta?.detail ?? '';
/* k: a frequency on integer formulas, a phase and frequency nudge on real
   ones (norm has no frequency to nudge), nothing on pascal. */
const usesK = p => p.formula !== FORMULA_PASCAL;
const K_NOTES = ['rational · tiles every m', 'rational · tiles every 2m+1', 'irrational · never repeats', 'irrational · never repeats'];
const K_REAL = ['no nudge', 'phase + ½', 'phase + 1/φ', 'phase + √2−1'];
const kNote = p => !REAL_FORMULAS.includes(p.formula) ? K_NOTES[p.k | 0]
  : (p.k | 0) === 0 ? K_REAL[0]
  : K_REAL[p.k | 0] + (p.formula === FORMULA_NORM ? ' band' : ' band and period') + ((p.k | 0) > 1 ? ' · irrational' : '');
const K_SHORT = ['', ' ½', ' φ', ' √2'];

/* A number picture's lines: what its axes mean, the number in that shape
   (the seeded member is in meta.detail), which digits are kept, and how
   many digits the largest number has against the room the shape gives
   them (digits after the point never run out). */
const SHAPE_NOTES = ['x, z index the number · height is the digit', 'height is n · distance from the axis is the digit'];
const numberText = p => NUMBER_TEXT[p.number][p.shape === 1 ? 'lathe' : 'stack'];
const digitsText = p => {
  const m = p.meta;
  if (!m) return '';
  if (p.number === COLLATZ) return `${m.room} steps · ${m.reached} of ${m.count} reach 1`;
  if (m.digits === null) return `endless · room for ${m.room}`;
  return `${m.digits} · room for ${m.room}${m.digits > m.room ? ' · the top is cut off' : ''}`;
};
const keepText = p => {
  const m = p.meta;
  if (!m || m.keep === 1) return 'digit ≠ 0 kept';
  return p.base === 3 ? 'digit = 1 kept' : `digit ≥ ${m.keep} kept`;
};
const endText = p => FRACTIONAL.includes(p.number) ? 'digits after the point'
  : p.number === COLLATZ ? 'n itself ' + (p.shape === 1 ? 'on the axis' : 'at the bottom')
  : 'units ' + (p.shape === 1 ? 'on the axis' : 'at the bottom');

/* A carry specimen's lines: what its rule does, then what its stencil,
   step and level came to (T and its base-p digits, the grain count, the
   kept values), from the build's meta. */
const RULE_NOTES = ['f(X, Y, Z)ᵀ mod p · kept where nonzero', 'grains topple, one to each neighbour'];
const isPowers = p => (p.rule | 0) === 0;
const stencilText = p => {
  if (isPowers(p)) return POWER_STENCILS[p.stencil].time ? 'y is time, apex on top' : POWER_STENCILS[p.stencil].tetra ? 'from a corner' : 'centred';
  return p.meta ? `threshold ${p.meta.threshold}` : '';
};
const stepText = p => {
  const m = p.meta;
  if (!m) return `step ${p.step}`;
  if (isPowers(p)) return m.T === null ? `T 0 … R−1 down the y axis · step unused` : `T ${m.T} · base ${m.p}: ${m.Tdigits}`;
  return `${m.N} grains · ${m.sweeps} sweeps`;
};
const levelText = p => {
  if (isPowers(p)) return LEVEL_NAMES[0][p.level];
  return `keep ${LEVEL_NAMES[1][p.level]}` + (p.meta ? ` · value ≥ ${p.meta.keepFrom}` : '');
};
const carryShort = p => {
  const m = p.meta;
  if (isPowers(p)) return `${m && m.T !== null ? 'T' + m.T : 'time'} p${m?.p ?? ''}`;
  return m ? `${m.N} ≥${m.keepFrom}` : '';
};

/* A claudegen specimen's spacing: the lattice constant it came to at this
   resolution, and how many periods that is across the cube. */
const spacingText = p => {
  const m = p.meta;
  if (!m) return `${PERIODS[p.spacing]} periods`;
  const c = m.cell;
  return `a ${m.a} voxels · ${+m.periods.toFixed(1)} periods` + (c && (c[0] !== m.a || c[2] !== m.a) ? ` · cell ${c.join(' × ')}` : '');
};
const viewOf = p => VIEWS[p.view | 0] ?? VIEWS[0];
/* The strength is named per flaw; a perfect crystal's says where its origin sits. */
const strengthText = p => STRENGTH_NAMES[p.flaw][p.strength];

/* A nestblock's lines: what each tier kept, what the carve kept of the
   rule's orbits, and how many children a twist turned, from the build's
   meta. One figure stands for every tier when all tiers agree. */
const innerName = p => p.inner ? NEST_RULES[p.inner - 1] : 'same';
const foldName = p => symmetryLabel({ sym: p.sym });
const perTier = (p, f) => {
  const all = p.meta.tiers.map(f);
  return all.every(t => t === all[0]) ? all[0] + (all.length > 1 ? ' a tier' : '') : all.join(' · ');
};
const tiersText = p => {
  const t = p.meta?.tiers;
  if (!t) return '';
  const sameR = t.every(u => u.r === t[0].r);
  return (sameR ? `${t.map(u => u.kept).join(' · ')} of ${t[0].cells}` : t.map(u => `${u.kept} of ${u.cells}`).join(' · '));
};
const tiersNote = p => {
  const m = p.meta;
  if (!m) return '';
  return `fill ${+(m.fill * 100).toPrecision(3)}%` + (m.dimension !== null ? ` · dimension ${m.dimension.toFixed(2)}` : '') +
    (m.tiers.some(t => t.fallback) ? ' · radix 2 has only corners: kept them' : '');
};
const carveNote = p => !p.meta ? '' : p.carve
  ? perTier(p, t => `${t.keptOrbits} of ${t.orbits} orbits`)
  : `all ${perTier(p, t => t.orbits)} orbits`;
const twistNote = p => {
  if (!p.twist || !p.meta) return '';
  const n = p.meta.tiers.reduce((a, t) => a + t.turned, 0);
  return n ? perTier(p, t => `${t.turned} children turned`) : `nothing to turn under ${foldName(p)}`;
};
const nestShort = p => `${NEST_RULES[p.outer]}${p.inner ? ' / ' + innerName(p) : ''}`;

/* A spacetime specimen's lines: the rule under both its names (a
   mirrored rule is a different, reversible dynamics, and says so), the
   seed, how the generations are stacked, and what the build reports. */
const caRule = p => CA_RULES[p.ca];
const caName = p => caRule(p).name + (p.time === 1 ? ', reversible' : '');
const caNote = p => {
  const r = caRule(p), nb = NEIGHBOURHOODS[r.nb].name;
  return r.name.startsWith('code ') ? `${ruleBS(r)} (${nb})` : `${ruleBS(r)} · code ${ruleCode(r)} (${nb})`;
};
const seedNote = p => {
  const m = p.meta;
  if (!m) return '';
  const cells = `${m.seedCells} cell${m.seedCells === 1 ? '' : 's'}`;
  return p.start < CENTRED_SEEDS ? `centred · ${cells}`
    : p.start === SEED_NAMES.indexOf('soup') ? `${SOUP_SIZE} × ${SOUP_SIZE} at ½ · ${cells}`
    : `${m.offset} cell${m.offset === 1 ? '' : 's'} out · ${cells}`;
};
const timeNote = p => {
  const m = p.meta;
  if (!m) return '';
  if (p.time !== 1) return `generations 0–${m.gens - 1}, top to bottom${m.extinct !== null ? ` · dies out at ${m.extinct}` : ''}`;
  return `${m.gens} each way${p.R % 2 ? ', sharing the middle layer' : ''}`;
};
const DRAW_NOTES = ['', 'alive this generation', 'alive this generation or the one before'];
const drawNote = p => p.draw ? DRAW_NOTES[p.draw] : p.meta ? `${p.meta.draw}, the rule's pick ${p.time === 1 ? 'mirrored' : 'forward'}` : '';
const stFold = p => p.meta?.fold ?? symmetryLabel({ sym: p.sym });
const stFoldNote = p => p.meta?.moved ? `${symmetryLabel({ sym: p.sym })} moves y; time keeps this part` : '';

/* A bimomirror's lines: the arrangement and its group, the seat, the
   children (one kind at an even radix; at an odd one the cells on the
   mirror planes and axes are folded by their stabilisers too, so the
   kinds are listed by fold), and the whole's group, predicted from the
   recipe by the build. The child's traits are the bimoblock ones. */
const arrangement = p => ARRANGEMENTS[p.group] ?? ARRANGEMENTS[1];
const groupText = p => {
  const g = groupName(arrangement(p).els);
  return p.group ? `${g.name} (${g.hm}) · ${arrangement(p).note}` : arrangement(p).note;
};
const seatNote = p => p.meta?.aligned ? "lines the child's 3-fold axis up with the diagonal" : '';
const childrenText = p => {
  const m = p.meta;
  if (!m) return '';
  const kinds = m.kinds.length === 1 ? m.kinds[0][0] : m.kinds.map(([f, n]) => `${n} ${f}`).join(' · ');
  return `${m.cells} × ${m.childR}³ · ${kinds}`;
};
const wholeText = p => p.meta ? `${p.meta.whole} (${p.meta.hm})` : '';
const wholeNote = p => {
  const m = p.meta;
  if (!m) return '';
  return `${m.wholeOrder} symmetr${m.wholeOrder === 1 ? 'y' : 'ies'}` + (WHOLE_NOTES[m.whole] ? ' · ' + WHOLE_NOTES[m.whole] : '');
};
const mirrorShort = p => `${arrangement(p).name} · ${symmetryLabel({ sym: p.sym }, true)}${p.meta ? ' → ' + p.meta.whole : ''}`;

/* The composite part of a neoblock's description, or null when it is a
   plain bimoblock source. A composite asked for on a layout with nothing
   to split falls back to the bimoblock, and says so. */
function compositeText(p){
  if (!p.source) return null;
  const split = compositeSplit(p.levels);
  if (!split) return { inspector: `${k('generator')} <b>neoblock</b> ${k('· composite needs a bimo tier — showing the source bimoblock')}\n`, label: '' };
  const outer = p.levels.slice(0, split).map(l => l.radix).join('×');
  const inner = p.levels.slice(split).map(l => l.radix).join('×');
  return {
    inspector:
      `${k('generator')} <b>neoblock composite</b> ${k(`· neo [${outer}] · bimo [${inner}] · base bimoblock below`)}\n` +
      `${k('placement')} <b>${PLACE_NAMES[p.place]}</b> ${k('· palette')} <b>${p.palette}</b> ${k('· turn')} <b>${ORIENT_NAMES[p.orient]}</b>\n`,
    label: `comp ${p.palette} ${ORIENT_NAMES[p.orient].slice(0, 3)} · `
  };
}

export const GENERATORS = {
  bimo: {
    id:'bimo', label:'bimoblock', cellRecipe,
    /* Inspector lines beyond the shared bimoblock ones. */
    describe: () => '',
    traits: bimoTraits,
    labelText: p => ARCH_NAMES[p.arch] + ' · ' + symmetryLabel(p, true)
  },
  neo: {
    id:'neo', label:'neoblock', cellRecipe: neoCellRecipe,
    /* The default view is a sweep: warp grows along x, symmetry breaks along y. */
    axes: { x:'warpAmt', y:'eps' },
    describe: p =>
      (compositeText(p)?.inspector ?? `${k('generator')} <b>neoblock</b> ${k('· source bimoblock below')}\n`) +
      `${k('warp')} <b>${WARP_NAMES[p.warp]}</b> ${k(p.warp ? `${p.warpAmt} / ${WARP_STEPS - 1}` : '')}\n` +
      `${k('broken symmetry')} <b>ε ${EPS_STEPS[p.eps]}</b>\n` +
      `${k('largest piece')} <b>${p.largest ? 'on' : 'off'}</b>\n`,
    traits: bimoTraits,
    labelText: p => `${compositeText(p)?.label ?? ''}${WARP_NAMES[p.warp]} ${p.warp ? p.warpAmt : ''} · ε ${EPS_STEPS[p.eps]}${p.largest ? ' · 1pc' : ''}`
  },
  field: {
    id:'field', label:'mod field', cellRecipe: fieldCellRecipe,
    /* The default view is a contact sheet: every frame against every formula. */
    axes: { x:'frame', y:'formula' },
    /* The starting tier layout. A mod field needs room: at the global
       default (R = 9) a formula has five distance steps per axis. R = 16,
       solid. R = 32 looks better but streams ~5M triangles for a full
       horizon; the levels panel can change it like any layout. */
    levels: [{ radix:2, gap:0 }, { radix:8, gap:0 }],
    /* Recipe dials a bloom carries from the pin, beyond the base traits. */
    pinTraits: ['frame', 'formula', 'bands', 'k'],
    describe: p =>
      `${k('generator')} <b>mod field</b>\n` +
      `${k('frame')} <b>${FRAME_NAMES[p.frame]}</b>\n` +
      `${k('formula')} <b>${FORMULA_NAMES[p.formula]}</b> ${k('· ' + modText(p))}\n` +
      (detailText(p) ? `${k('params')} <b>${detailText(p)}</b>\n` : '') +
      (usesK(p) ? `${k('k')} <b>${K_NAMES[p.k | 0]}</b> ${k('· ' + kNote(p))}\n`
                : `${k('k')} <b>—</b> ${k('· not used by ' + FORMULA_NAMES[p.formula])}\n`),
    traits: p =>
      `${k('fold')} <b>${p.sym ? symmetryLabel(p) : 'none'}</b>\n` +
      `${k('clip')} <b>${ARCH_NAMES[p.arch]}</b>\n`,
    labelText: p => `${FRAME_NAMES[p.frame]} · ${FORMULA_NAMES[p.formula]} ` +
      (p.formula === FORMULA_PASCAL ? (p.meta ? `b${p.meta.base} ${PASCAL_APEX[p.meta.apex]}` : `#${(p.bands | 0) + 1}`)
                                    : `/${BANDS[p.bands]}${usesK(p) ? K_SHORT[p.k | 0] : ''}`),
    /* The focus toast and the OBJ header, which otherwise name bimoblock traits. */
    brief: p => `${FRAME_NAMES[p.frame]} · ${FORMULA_NAMES[p.formula]} · ${modText(p)}${usesK(p) && p.k ? ' · k ' + K_NAMES[p.k] : ''}`,
    objTraits: p => `frame: ${FRAME_NAMES[p.frame]}  formula: ${FORMULA_NAMES[p.formula]} (${modText(p)}${detailText(p) ? ' · ' + detailText(p) : ''})  ` +
      `k: ${usesK(p) ? K_NAMES[p.k | 0] : 'n/a'}  fold: ${p.sym ? symmetryLabel(p) : 'none'}  clip: ${ARCH_NAMES[p.arch]}`
  },
  digit: {
    id:'digit', label:'number picture', cellRecipe: digitCellRecipe,
    /* The default view is a contact sheet: each shape against each number. */
    axes: { x:'shape', y:'number' },
    /* R = 32 in two tiers, no gaps: a stack wants height for its digits,
       and a gap would cut the picture in half. */
    levels: [{ radix:2, gap:0 }, { radix:16, gap:0 }],
    pinTraits: ['shape', 'number', 'base'],
    /* Density is the digit threshold: from 90% every nonzero digit is
       kept, so the slider runs to 100 and digit pages start there. */
    densityStart: 0.9, densityMax: 100,
    describe: p =>
      `${k('generator')} <b>number picture</b>\n` +
      `${k('shape')} <b>${SHAPE_NAMES[p.shape]}</b> ${k('· ' + SHAPE_NOTES[p.shape])}\n` +
      `${k('number')} <b>${NUMBER_NAMES[p.number]}</b> ${k('· ' + numberText(p))}\n` +
      (p.meta?.detail ? `${k('params')} <b>${p.meta.detail}</b>\n` : '') +
      `${k('base')} <b>${BASE_NAMES[p.base]}</b> ${k('· ' + keepText(p) + ' · ' + endText(p))}\n` +
      (p.meta ? `${k('digits')} <b>${digitsText(p)}</b>\n` : ''),
    traits: p =>
      `${k('fold')} <b>${p.sym ? symmetryLabel(p) : 'none'}</b>\n` +
      `${k('clip')} <b>${ARCH_NAMES[p.arch]}</b>\n`,
    labelText: p => `${SHAPE_NAMES[p.shape]} · ${NUMBER_NAMES[p.number]} · b${BASE_NAMES[p.base]}${p.meta && p.meta.keep > 1 ? ' ≥' + p.meta.keep : ''}`,
    brief: p => `${SHAPE_NAMES[p.shape]} · ${NUMBER_NAMES[p.number]}${p.meta?.detail ? ' (' + p.meta.detail + ')' : ''} · base ${BASE_NAMES[p.base]}`,
    objTraits: p => `shape: ${SHAPE_NAMES[p.shape]}  number: ${NUMBER_NAMES[p.number]} = ${numberText(p)}${p.meta?.detail ? ' (' + p.meta.detail + ')' : ''}  ` +
      `base: ${BASE_NAMES[p.base]} (${keepText(p)})  fold: ${p.sym ? symmetryLabel(p) : 'none'}  clip: ${ARCH_NAMES[p.arch]}`
  },
  carry: {
    id:'carry', label:'carry', cellRecipe: carryCellRecipe,
    /* The default view is a contact sheet: each stencil against each step. */
    axes: { x:'stencil', y:'step' },
    /* R = 32 in two tiers, no gaps, as for number pictures: T up to 15. */
    levels: [{ radix:2, gap:0 }, { radix:16, gap:0 }],
    pinTraits: ['rule', 'stencil', 'step', 'level'],
    /* What is kept is the level dial's job. */
    density: false,
    describe: p =>
      `${k('generator')} <b>carry</b>\n` +
      `${k('rule')} <b>${RULE_NAMES[p.rule]}</b> ${k('· ' + RULE_NOTES[p.rule])}\n` +
      `${k('stencil')} <b>${STENCIL_NAMES[p.rule][p.stencil]}</b> ${k(stencilText(p) ? '· ' + stencilText(p) : '')}\n` +
      `${k('step')} <b>${stepText(p)}</b>\n` +
      `${k('level')} <b>${levelText(p)}</b>\n` +
      (p.meta?.detail ? `${k('params')} <b>${p.meta.detail}</b>\n` : ''),
    traits: p =>
      `${k('fold')} <b>${p.sym ? symmetryLabel(p) : 'none'}</b>\n` +
      `${k('clip')} <b>${ARCH_NAMES[p.arch]}</b>\n`,
    labelText: p => `${RULE_NAMES[p.rule]} · ${STENCIL_NAMES[p.rule][p.stencil]} · ${carryShort(p)}`,
    brief: p => `${RULE_NAMES[p.rule]} · ${STENCIL_NAMES[p.rule][p.stencil]} · ${stepText(p)} · ${levelText(p)}`,
    objTraits: p => `rule: ${RULE_NAMES[p.rule]}  stencil: ${STENCIL_NAMES[p.rule][p.stencil]}  step: ${stepText(p)}  level: ${levelText(p)}` +
      `${p.meta?.detail ? '  (' + p.meta.detail + ')' : ''}  fold: ${p.sym ? symmetryLabel(p) : 'none'}  clip: ${ARCH_NAMES[p.arch]}`
  },
  claudegen: {
    id:'claudegen', label:'claudegen', cellRecipe: claudegenCellRecipe,
    /* The default view is a contact sheet: each flaw in each crystal. */
    axes: { x:'flaw', y:'motif' },
    /* R = 32 in two tiers, no gaps: a gap would itself be a flaw. */
    levels: [{ radix:2, gap:0 }, { radix:16, gap:0 }],
    pinTraits: ['motif', 'flaw', 'strength', 'spacing', 'view'],
    /* The fill: plates two voxels thick at a = 8, balls nearly touching. */
    densityStart: 0.3,
    describe: p =>
      `${k('generator')} <b>claudegen</b> ${k('· a crystal with one flaw')}\n` +
      `${k('crystal')} <b>${MOTIFS[p.motif].name}</b> ${k('· ' + MOTIFS[p.motif].note)}\n` +
      `${k('flaw')} <b>${FLAWS[p.flaw].name}</b> ${k('· ' + FLAWS[p.flaw].note)}\n` +
      `${k('strength')} <b>${strengthText(p)}</b>\n` +
      `${k('spacing')} <b>${spacingText(p)}</b>\n` +
      `${k('view')} <b>${viewOf(p).name}</b> ${k('· ' + viewOf(p).note)}\n` +
      (p.meta?.detail ? `${k('params')} <b>${p.meta.detail}</b>\n` : ''),
    traits: p =>
      `${k('fold')} <b>${p.sym ? symmetryLabel(p) : 'none'}</b>\n` +
      `${k('clip')} <b>${ARCH_NAMES[p.arch]}</b>\n`,
    labelText: p => `${MOTIFS[p.motif].name} · ${FLAWS[p.flaw].name}${p.flaw ? ' · ' + strengthText(p) : ''}${p.view ? ' · ' + viewOf(p).name : ''}`,
    brief: p => `${MOTIFS[p.motif].name} · ${FLAWS[p.flaw].name} · ${strengthText(p)} · ${spacingText(p)}${p.view ? ' · ' + viewOf(p).name : ''}`,
    objTraits: p => `crystal: ${MOTIFS[p.motif].name}  flaw: ${FLAWS[p.flaw].name}  strength: ${strengthText(p)}  spacing: ${spacingText(p)}  view: ${viewOf(p).name}` +
      `${p.meta?.detail ? '  (' + p.meta.detail + ')' : ''}  fill: ${(p.density * 100).toFixed(0)}%  fold: ${p.sym ? symmetryLabel(p) : 'none'}  clip: ${ARCH_NAMES[p.arch]}`
  },
  nest: {
    id:'nest', label:'nestblock', cellRecipe: nestCellRecipe,
    /* The default view is a contact sheet: each rule (the same at every
       tier on page 0, 0) under each fold, so the Oh row is the classics
       and the rows below it their carved variations. */
    axes: { x:'outer', y:'sym' },
    /* R = 27 in three tiers with gaps, so the nesting shows. */
    levels: [{ radix:3, gap:0.35 }, { radix:3, gap:0.12 }, { radix:3, gap:0.04 }],
    pinTraits: ['outer', 'inner', 'carve', 'twist'],
    /* The rules set the fill. */
    density: false,
    describe: p =>
      `${k('generator')} <b>nestblock</b> ${k('· blocks made of smaller copies of themselves')}\n` +
      `${k('rule')} <b>${NEST_RULES[p.outer]}</b> ${k('· ' + ruleClasses(p.outer) + ' · outer tier')}\n` +
      `${k('inner')} <b>${innerName(p)}</b> ${k('· ' + (p.inner ? ruleClasses(p.inner - 1) : 'self-similar'))}\n` +
      `${k('carve')} <b>${CARVE_NAMES[p.carve]}</b> ${k(carveNote(p) ? '· ' + carveNote(p) : '')}\n` +
      `${k('twist')} <b>${TWIST_NAMES[p.twist]}</b> ${k(twistNote(p) ? '· ' + twistNote(p) : '')}\n` +
      (p.meta ? `${k('kept')} <b>${tiersText(p)}</b> ${k('· ' + tiersNote(p))}\n` : ''),
    traits: p =>
      `${k('fold')} <b>${foldName(p)}</b>\n` +
      `${k('clip')} <b>${ARCH_NAMES[p.arch]}</b>\n`,
    labelText: p => `${nestShort(p)} · ${symmetryLabel({ sym: p.sym }, true)}${p.carve ? ' · carve ' + CARVE_NAMES[p.carve] : ''}${p.twist ? ' · ' + TWIST_NAMES[p.twist] : ''}`,
    brief: p => `${nestShort(p)} · ${foldName(p)} · carve ${CARVE_NAMES[p.carve]} · twist ${TWIST_NAMES[p.twist]}`,
    objTraits: p => `rule: ${NEST_RULES[p.outer]} (${ruleClasses(p.outer)})  inner: ${innerName(p)}  carve: ${CARVE_NAMES[p.carve]}  ` +
      `twist: ${TWIST_NAMES[p.twist]}  kept: ${tiersText(p)}  fold: ${foldName(p)}  clip: ${ARCH_NAMES[p.arch]}`
  },
  spacetime: {
    id:'spacetime', label:'spacetime', cellRecipe: spacetimeCellRecipe,
    /* The default view is a contact sheet: each rule from each seed. */
    axes: { x:'ca', y:'start' },
    /* R = 32 in two tiers, no gaps: a gap would cut a generation in two. */
    levels: [{ radix:2, gap:0 }, { radix:16, gap:0 }],
    pinTraits: ['ca', 'start', 'time', 'draw'],
    /* The rule decides every cell. */
    density: false,
    /* The aut-order is out of the fold time allows (Oh is cut to C4v). */
    foldOrder: p => p.meta?.foldOrder,
    describe: p =>
      `${k('generator')} <b>spacetime</b> ${k('· a cellular automaton, time running down')}\n` +
      `${k('rule')} <b>${caName(p)}</b> ${k('· ' + caNote(p))}\n` +
      `${k('seed')} <b>${SEED_NAMES[p.start]}</b> ${k(seedNote(p) ? '· ' + seedNote(p) : '')}\n` +
      `${k('time')} <b>${TIME_NAMES[p.time]}</b> ${k(timeNote(p) ? '· ' + timeNote(p) : '')}\n` +
      `${k('draw')} <b>${DRAW_NAMES[p.draw]}</b> ${k(drawNote(p) ? '· ' + drawNote(p) : '')}\n` +
      (p.meta ? `${k('last')} <b>${p.meta.population} alive</b> ${k(`· the last generation, in the window · fill ${+(p.meta.fill * 100).toPrecision(3)}%`)}\n` : ''),
    traits: p =>
      `${k('fold')} <b>${stFold(p)}</b> ${k(stFoldNote(p) ? '· ' + stFoldNote(p) : '')}\n` +
      `${k('clip')} <b>${ARCH_NAMES[p.arch]}</b>\n`,
    labelText: p => `${caRule(p).name} · ${SEED_NAMES[p.start]} · ${stFold(p).split(':')[0]} · ${TIME_NAMES[p.time]}${p.draw ? ' · ' + DRAW_NAMES[p.draw] : ''}`,
    brief: p => `${caName(p)} · ${SEED_NAMES[p.start]} · ${stFold(p)} · ${TIME_NAMES[p.time]} · draw ${DRAW_NAMES[p.draw]}`,
    objTraits: p => `rule: ${caName(p)} (${caNote(p)})  seed: ${SEED_NAMES[p.start]}${seedNote(p) ? ' (' + seedNote(p) + ')' : ''}  ` +
      `time: ${TIME_NAMES[p.time]}  draw: ${DRAW_NAMES[p.draw]}${p.meta ? ' (' + p.meta.draw + ')' : ''}  fold: ${stFold(p)}  clip: ${ARCH_NAMES[p.arch]}`
  },
  mirror: {
    id:'mirror', label:'bimomirror', cellRecipe: mirrorCellRecipe,
    /* The default view is a contact sheet: each arrangement (copy, then
       the four groups) against each child fold, the table in
       bimomirror.md §4. */
    axes: { x:'group', y:'sym' },
    /* R = 18: the octants, each a classic two-tier 9³ child. The levels
       panel sets the gap: 0 fuses the copies into a kaleidoscope. */
    levels: [{ radix:2, gap:0.35 }, { radix:3, gap:0.3 }, { radix:3, gap:0.06 }],
    pinTraits: ['group', 'seat'],
    /* The aut-order is out of the whole's predicted group. */
    foldOrder: p => p.meta?.wholeOrder,
    describe: p => p.meta?.fallback
      ? `${k('generator')} <b>bimomirror</b> ${k('· one tier has nothing inside to mirror — showing the bimoblock')}\n`
      : `${k('generator')} <b>bimomirror</b> ${k('· one bimoblock, mirrored into its cells')}\n` +
        `${k('arrangement')} <b>${arrangement(p).name}</b> ${k('· ' + groupText(p))}\n` +
        `${k('seat')} <b>${SEAT_NAMES[p.seat]} in</b> ${k(seatNote(p) ? '· ' + seatNote(p) : '')}\n` +
        (p.meta ? `${k('children')} <b>${childrenText(p)}</b>\n` : '') +
        (p.meta ? `${k('whole')} <b>${wholeText(p)}</b> ${k('· ' + wholeNote(p))}\n` : ''),
    traits: p =>
      `${k('child fold')} <b>${symmetryLabel({ sym: p.sym })}</b>\n` +
      `${k('archetype')} <b>${ARCH_NAMES[p.arch]}</b>\n` +
      `${k('field')} <b>${FIELD_NAMES[p.field]}</b>` +
        (p.field >= NATIVE_FIELDS && p.field < LEGACY_FIELD_COUNT ? ` ${k('/')} <b>${LIFT_NAMES[p.lift]}</b>` : '') + `\n`,
    labelText: mirrorShort,
    brief: p => `${arrangement(p).name} · seat ${SEAT_NAMES[p.seat]} · child ${symmetryLabel({ sym: p.sym })} ${ARCH_NAMES[p.arch]}${p.meta ? ' · whole ' + wholeText(p) : ''}`,
    objTraits: p => `arrangement: ${arrangement(p).name}  seat: ${SEAT_NAMES[p.seat]} in  children: ${childrenText(p)}  whole: ${wholeText(p)}  ` +
      `child fold: ${symmetryLabel({ sym: p.sym })}  archetype: ${ARCH_NAMES[p.arch]}  field: ${FIELD_NAMES[p.field]}  density: ${(p.density * 100).toFixed(0)}%`
  }
};

/** The generator filling the lattice on this page. */
export function activeGenerator(){ return GENERATORS[Generator.id]; }

/* Read `?g=` once at startup. An unknown id falls back to bimoblocks, so a
   mistyped link still opens on something. */
export function selectGenerator(search){
  const want = new URLSearchParams(search).get('g');
  if (want && !GENERATORS[want]) console.warn(`[lattice] unknown generator '${want}', using bimoblock`);
  Generator.id = want && GENERATORS[want] ? want : 'bimo';
  const g = activeGenerator();
  if (g.axes){ Axis.x = g.axes.x; Axis.y = g.axes.y; }
  if (g.levels) Tier.levels = g.levels.map(l => ({ ...l }));
  if (g.densityStart) Mint.density = g.densityStart;
  return g;
}

/* The URL of this page under another generator: same address, `?g=` swapped
   (dropped for bimoblock, the default, so plain links stay plain). */
export function generatorURL(id, href){
  const u = new URL(href);
  if (id === 'bimo') u.searchParams.delete('g'); else u.searchParams.set('g', id);
  return u.toString();
}
