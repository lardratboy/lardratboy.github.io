/* How far would a float32 GPU's colour words drift from JS's float64 ones?
   docs/computedags.md §2, "Colour in float32" (Q6). Not a GPU: an emulation
   that runs every world's colour field (colours.js's colourOf, unchanged)
   with Math's transcendentals patched, and compares the 6-bit channels of
   the words it makes with the plain run's.

     f32     each sin, cos, atan2, sqrt, hypot, … result rounded to float32:
             about what good hardware gives.
     worst   that, plus the error WGSL is allowed, as I remember the spec
             (not checked against it: the fetch never reached §15.7.4):
             sin and cos ±2^-11 absolute, atan, atan2 and asin 4096 ulp,
             the rest 3 ulp. A uniform random error inside the bound.

   The trap: plain arithmetic stays float64 here. Fields that use only
   integer hashes, integer walks and + − × (rows, kit, caves, clay) read 0
   under both modes, and that proves nothing about them: a GPU's float32
   multiplies could still tip a rounding. Only a WGSL port can say.

   Points are random voxel centres anywhere in the world, not the shown
   cells a job would colour, and every word is a single voxel's (lod 0, no
   coarse mean). Seeds are fixed, so the table repeats exactly.

   node experiments/colour-f32.mjs        ~3 s */
import { colourOf } from '../colours.js';
import { SHAPES } from './shapes.mjs';
import { kitDesc } from '../kit-core.js';
import { caveDesc } from '../cave-core.js';
import { clayDesc } from '../clay-core.js';
import { to6 } from '../attr-core.js';

const M = { sin: Math.sin, cos: Math.cos, atan2: Math.atan2, atan: Math.atan, asin: Math.asin,
            sqrt: Math.sqrt, hypot: Math.hypot, exp: Math.exp, pow: Math.pow };
let seed = 0;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
// One float32 ulp at |v|.
const ulp = v => { const f = Math.fround(Math.abs(v)) || 2 ** -126; return Math.fround(f * (1 + 2 ** -23)) - f || 2 ** -149; };
function patch(mode){
  for (const k of Object.keys(M)){
    Math[k] = (...a) => {
      let v = M[k](...a);
      if (mode === 'worst'){
        const u = 2 * rnd() - 1;
        if (k === 'sin' || k === 'cos') v += u * 2 ** -11;
        else if (k === 'atan' || k === 'atan2' || k === 'asin') v += u * 4096 * ulp(v);
        else v += u * 3 * ulp(v);
      }
      return Math.fround(v);
    };
  }
}
const unpatch = () => Object.assign(Math, M);
const channels = c => [to6(c & 255), to6(c >> 8 & 255), to6(c >> 16 & 255)];

const worlds = [
  ...SHAPES.map(s => ({ name: s.name, desc: { kind: 'shape', name: s.name, D: 12 } })),
  { name: 'rows', desc: { kind: 'row', D: 12 } },
  { name: 'kit D=12', desc: kitDesc({ D: 12 }) },
  { name: 'caves D=10', desc: caveDesc({ D: 10 }) },
  { name: 'clay', desc: clayDesc() },
];
const N = 200000;
const pc = (n, of) => (100 * n / of).toFixed(4) + '%';
console.log(`${N.toLocaleString()} voxels a world\n`);
console.log('| world | mode | channels off by 1 | off by 2+ | words differing | largest, steps |');
console.log('|---|---|---:|---:|---:|---:|');
for (const w of worlds){
  unpatch();
  const plain = colourOf(w.desc), S = 2 ** w.desc.D;
  seed = 777;
  const pts = Array.from({ length: N }, () => [0, 0, 0].map(() => Math.floor(rnd() * S) + 0.5));
  const ref = pts.map(p => channels(plain(...p)));
  for (const mode of ['f32', 'worst']){
    patch(mode); seed = 99;
    let field;
    try { field = colourOf(w.desc); } finally { unpatch(); }
    patch(mode);
    let one = 0, more = 0, words = 0, largest = 0;
    try {
      for (let i = 0; i < N; i++){
        const a = ref[i], b = channels(field(...pts[i]));
        let any = false;
        for (let c = 0; c < 3; c++){
          const d = Math.abs(a[c] - b[c]);
          if (d === 1) one++; else if (d > 1) more++;
          if (d){ any = true; largest = Math.max(largest, d); }
        }
        if (any) words++;
      }
    } finally { unpatch(); }
    console.log(`| ${w.name} | ${mode} | ${pc(one, 3 * N)} | ${pc(more, 3 * N)} | ${pc(words, N)} | ${largest} |`);
  }
}
