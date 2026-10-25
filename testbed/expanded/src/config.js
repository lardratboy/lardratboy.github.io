/* Lattice constants: tuning knobs, axis roles, palette, small integer
   helpers and the levels-editor preset table. No state lives here except
   CFG, whose fields the sliders adjust at runtime. */
import * as THREE from 'three';
import { Core } from './core/bimoblock-core.js';
import { SOURCE_NAMES, PLACE_NAMES, ORIENT_NAMES, PALETTE_MAX, WARP_NAMES, EPS_STEPS, WARP_STEPS } from './core/neoblock-core.js';
import { FRAME_NAMES, FORMULA_NAMES, BANDS, K_NAMES } from './core/field-core.js';
import { SHAPE_NAMES, NUMBER_NAMES, BASE_NAMES } from './core/digit-core.js';
import { RULE_NAMES, STENCILS, STEPS, PRIMES } from './core/carry-core.js';
import { MOTIF_NAMES, FLAW_NAMES, STRENGTHS, PERIODS, VIEW_NAMES } from './core/claudegen-core.js';
import { RULE_NAMES as NEST_RULES, INNER_NAMES, CARVE_NAMES, TWIST_NAMES } from './core/nest-core.js';
import { RULE_NAMES as CA_RULES, SEED_NAMES, TIME_NAMES, DRAW_NAMES } from './core/spacetime-core.js';

const { GROUPS, ARCH_NAMES, FIELD_NAMES, LIFT_NAMES } = Core;

export const TAU = Math.PI * 2;

export const CFG = {
  CELL:        2.6,     // lattice pitch, world units
  BLOCK_S:     1.18,    // specimen scale (geometry is a unit cube)
  MAX_VISIBLE: 336,     // horizon depth: specimens drawn at once, live
  POD_MAX:     480,     // pod instance allocation, and the ceiling on the above
  CACHE_MAX:   760,     // retained generated blocks (each owns geometry)
  MAX_SPAN:    62,      // clamp on the cell box scanned per rebuild
  LOD_PX:      30,      // projected CSS-pixel size below which the 3^3 proxy is used
  INSTALL_MS:  1.0,     // soft CPU budget for accepting worker results
  UPLOAD_BYTES: 8 * 1048576, // newly admitted geometry per frame (one oversize allowed)
  RESULT_BYTES: 96 * 1048576,
  CACHE_BYTES: 256 * 1048576
};

/* ---- axis roles -------------------------------------------------------
   A role is an enumeration plus its period.  'free' means the axis does
   not enumerate anything, so its coordinate feeds the seed directly. */
export const ROLES = [
  { id:'free',  label:'free roam',  count:0 },
  { id:'arch',  label:'archetype',  count:ARCH_NAMES.length  },
  { id:'sym',   label:'symmetry',   count:GROUPS.length      },
  { id:'field', label:'field',      count:FIELD_NAMES.length },
  { id:'lift',  label:'lift',       count:LIFT_NAMES.length  },
  { id:'dens',  label:'density',    count:9                  }
];
/* Neoblock dials as roles: offered on the axes only when ?g=neo, so a
   sweep along an axis walks a dial (see neoCellRecipe in lattice/neo-recipe.js).
   `min` offsets a dial that does not start at 0 (palette is 1..8). */
export const NEO_ROLES = [
  { id:'source',  label:'source',           count:SOURCE_NAMES.length },
  { id:'place',   label:'placement',        count:PLACE_NAMES.length },
  { id:'palette', label:'palette size',     count:PALETTE_MAX, min:1 },
  { id:'orient',  label:'orientation',      count:ORIENT_NAMES.length },
  { id:'warp',    label:'warp kind',        count:WARP_NAMES.length },
  { id:'warpAmt', label:'warp amount',      count:WARP_STEPS },
  { id:'eps',     label:'broken symmetry',  count:EPS_STEPS.length },
  { id:'largest', label:'largest piece',    count:2 }
];
/* Mod-field dials as roles (?g=field). The bimoblock field and lift mean
   nothing there, so those two roles are not offered. */
export const FIELD_ROLES = [
  { id:'frame',   label:'frame',            count:FRAME_NAMES.length },
  { id:'formula', label:'mod field',        count:FORMULA_NAMES.length },
  { id:'bands',   label:'bands (modulus)',  count:BANDS.length },
  { id:'k',       label:'k (rational / irrational)', count:K_NAMES.length }
];
/* Number-picture dials as roles (?g=digit). The density role walks the
   digit threshold there (digit-recipe.js). */
export const DIGIT_ROLES = [
  { id:'shape',   label:'shape',            count:SHAPE_NAMES.length },
  { id:'number',  label:'number',           count:NUMBER_NAMES.length },
  { id:'base',    label:'base',             count:BASE_NAMES.length }
];
/* Carry dials as roles (?g=carry). What stencil, step and level mean
   depends on the rule; each has the same count under every rule. Density
   has no job there (level says what is kept). */
export const CARRY_ROLES = [
  { id:'rule',    label:'rule',             count:RULE_NAMES.length },
  { id:'stencil', label:'stencil',          count:STENCILS },
  { id:'step',    label:'step (T / grains)', count:STEPS },
  { id:'level',   label:'level (p / kept)', count:PRIMES.length }
];
/* Claudegen dials as roles (?g=claudegen). What a strength step means
   depends on the flaw; it has four under every flaw. The density role
   walks the fill there: the share of the perfect crystal that is kept. */
export const CLAUDEGEN_ROLES = [
  { id:'motif',    label:'crystal',           count:MOTIF_NAMES.length },
  { id:'flaw',     label:'flaw',              count:FLAW_NAMES.length },
  { id:'strength', label:'flaw strength',     count:STRENGTHS },
  { id:'spacing',  label:'spacing (periods)', count:PERIODS.length },
  { id:'view',     label:'view (orientation)', count:VIEW_NAMES.length }
];
/* Nestblock dials as roles (?g=nest). The fold is the bimoblock symmetry
   role; density has no job there (the rules set the fill). */
export const NEST_ROLES = [
  { id:'outer',    label:'rule (outer tier)', count:NEST_RULES.length },
  { id:'inner',    label:'inner rule',        count:INNER_NAMES.length },
  { id:'carve',    label:'carve',             count:CARVE_NAMES.length },
  { id:'twist',    label:'twist',             count:TWIST_NAMES.length }
];
/* Spacetime dials as roles (?g=spacetime). The fold is the bimoblock
   symmetry role; density has no job there (the rule decides every cell). */
export const SPACETIME_ROLES = [
  { id:'ca',       label:'rule (automaton)',  count:CA_RULES.length },
  { id:'start',    label:'seed (generation 0)', count:SEED_NAMES.length },
  { id:'time',     label:'time',              count:TIME_NAMES.length },
  { id:'draw',     label:'draw',              count:DRAW_NAMES.length }
];
/* The roles each generator's axis menus offer, in menu order. */
export const GENERATOR_ROLES = {
  bimo:  ROLES,
  neo:   [...ROLES, ...NEO_ROLES],
  field: [...ROLES.filter(r => r.id !== 'field' && r.id !== 'lift'), ...FIELD_ROLES],
  digit: [...ROLES.filter(r => r.id !== 'field' && r.id !== 'lift'), ...DIGIT_ROLES],
  carry: [...ROLES.filter(r => r.id !== 'field' && r.id !== 'lift' && r.id !== 'dens'), ...CARRY_ROLES],
  claudegen: [...ROLES.filter(r => r.id !== 'field' && r.id !== 'lift'), ...CLAUDEGEN_ROLES],
  nest:  [...ROLES.filter(r => r.id !== 'field' && r.id !== 'lift' && r.id !== 'dens'), ...NEST_ROLES],
  spacetime: [...ROLES.filter(r => r.id !== 'field' && r.id !== 'lift' && r.id !== 'dens'), ...SPACETIME_ROLES]
};
export const ROLE_BY_ID = {};
for (const r of [...ROLES, ...NEO_ROLES, ...FIELD_ROLES, ...DIGIT_ROLES, ...CARRY_ROLES, ...CLAUDEGEN_ROLES, ...NEST_ROLES, ...SPACETIME_ROLES]) ROLE_BY_ID[r.id] = r;

export const GROUP_COLORS = ['#ff3ea5','#ff8a3d','#ffd23d','#9bff3d','#3dff8a',
                             '#00f5d4','#3dc9ff','#6f7dff','#b46cff','#ff5edb'];
export const GROUP_RGB = GROUP_COLORS.map(h => new THREE.Color(h));

export const imod = (a, n) => ((a % n) + n) % n;
export const idiv = (a, n) => Math.floor(a / n);
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

/* ---- levels editor ----------------------------------------------------
   MAX_R guards against a runaway per-specimen cell count: unlike the
   standalone prototype (one specimen at a time), the lattice keeps up to
   CFG.POD_MAX specimens live at once, so the safe ceiling here is much
   lower. It covers every shipped preset (tower3=27, tower4=16, hetero=24)
   with headroom. */
export const MAX_R = 64;

export const PRESETS = {
  classic: [{radix:9,gap:0.0}],
  tower3:  [{radix:3,gap:0.35},{radix:3,gap:0.12},{radix:3,gap:0.04}],
  tower4:  [{radix:2,gap:0.35},{radix:2,gap:0.20},{radix:2,gap:0.10},{radix:2,gap:0.04}],
  hetero:  [{radix:4,gap:0.30},{radix:3,gap:0.14},{radix:2,gap:0.05}],
  n4:      [{radix:4,gap:0.30},{radix:4,gap:0.08}],
  n5:      [{radix:5,gap:0.20}]
};
