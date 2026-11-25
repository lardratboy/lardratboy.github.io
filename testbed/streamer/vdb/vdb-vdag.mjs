#!/usr/bin/env node
/* OpenVDB files to world files from the command line: vdb-convert.js's
   convertVdb over a file handle, so the same bytes as vdb/index.html.

     node vdb/vdb-vdag.mjs <file.vdb ...> [--list] [--D=8,10,native] [--grid=<name>]
       [--solid=inside|above|active] [--threshold=<t>] [--sampling=trilinear|nearest]
       [--colour=auto|none|grid:<vec3>|rgb:<r>,<g>,<b>[/<d>]|heat:<grid>|grey:<grid>]
       [--up=auto|y|z] [--bits=6|8] [--gamma=on|off] [--out=<dir>]
       a point grid: [--colour=auto|none|attr:<vec3 attribute>] [--point=cube:1|ball:2] [--opacity=0.2]

   --list prints each file's grids and what the converter would choose, and
   writes nothing. The files go beside each .vdb unless --out says where. */
import { open, mkdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { inspectVdb } from './vdb-core.js';
import { convertVdb, nameOf, summaryOf, defaultShape, defaultColour, modeOf, thresholdOf, colourChoices, isBlender } from './vdb-convert.js';

const args = process.argv.slice(2), files = args.filter(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const flag = k => args.includes(`--${k}`);
if (!files.length){
  console.log('usage: node vdb/vdb-vdag.mjs <file.vdb ...> [--list] [--D=8,10,native] [--grid=] [--solid=] [--threshold=] [--sampling=] [--colour=] [--up=] [--bits=] [--gamma=] [--point=] [--opacity=] [--out=]');
  process.exit(1);
}
const depths = opt('D', '8,10').split(',').map(d => d === 'native' ? d : Number(d));
const threshold = opt('threshold', null), bits = Number(opt('bits', 6));
const gammaOpt = opt('gamma', 'on'), [pshape, pr] = opt('point', 'cube:0').split(':');
if (!['on', 'off'].includes(gammaOpt)){ console.log(`--gamma is on or off, not ${gammaOpt}`); process.exit(1); }

async function source(path){
  const fh = await open(path, 'r'), { size } = await fh.stat();
  return { fh, src: { size, read: async (o, n) => { const len = Math.max(0, Math.min(n, size - o)), b = new Uint8Array(len); let got = 0; while (got < len){ const { bytesRead } = await fh.read(b, got, len - got, o + got); if (!bytesRead) break; got += bytesRead; } return b.subarray(0, got); } } };
}

for (const path of files){
  const { fh, src } = await source(path);
  try {
    if (flag('list')){
      const file = await inspectVdb(src), shape = defaultShape(file), g = file.grids.find(x => x.uniqueName === shape);
      console.log(`${path}: file format ${file.version}, OpenVDB ${file.library.join('.')}${isBlender(file) ? ', a Blender cache (z-up)' : ''}`);
      for (const s of summaryOf(file)) console.log(`  ${s.name}: ${s.type}${s.half ? ' (half)' : ''}, ${s.class}${s.voxels != null ? `, ${s.voxels.toLocaleString('en-US')} active` : ''}${s.bbox ? `, ${s.bbox[0].join(',')} to ${s.bbox[1].join(',')}` : ''}, ${s.map}${s.why ? `: ${s.why}` : ''}`);
      if (g?.points) console.log(`  would take ${shape} (its points), colour its Cd if it has one (the attributes are in its leaves, so --list doesn't read them)`);
      else if (g) console.log(`  would take ${shape} (${modeOf(g)}${modeOf(g) === 'active' ? '' : ` ${thresholdOf(modeOf(g))}`}), colour ${defaultColour(file, shape)}; colours: ${colourChoices(file).map(c => c.value).join(', ')}`);
      continue;
    }
    const out = opt('out', dirname(path)), t0 = performance.now();
    await mkdir(out, { recursive: true });
    await convertVdb(src, {
      name: nameOf(path), depths, bits, grid: opt('grid', null), mode: opt('solid', null), threshold: threshold == null ? null : Number(threshold),
      sampling: opt('sampling', 'trilinear'), colour: opt('colour', 'auto'), up: opt('up', 'auto'), gamma: gammaOpt === 'on',
      point: { shape: pshape, r: Number(pr ?? 0) }, opacity: Number(opt('opacity', 0)),
      onAsset: a => {
        if (!a.size) return;                 // the first telling, before the solid's known
        if (a.mode === 'points') console.log(`${path}: ${a.grid}, ${a.points.toLocaleString('en-US')} points in ${a.leaves.toLocaleString('en-US')} leaves (attributes ${a.attributes.map(x => `${x.name} ${x.type}/${x.codec}`).join(', ')}), up ${a.up}, colour ${a.colour}${a.colour === 'none' ? '' : `, gamma ${a.gamma ? 'on' : 'off'}`}, a point fills ${a.point.r ? `a ${a.point.shape} of ${a.point.r}` : 'its voxel'}${a.opacity ? `, opacity ${a.opacity} by ${a.alpha}` : ''}; ${a.size.join(' × ')}${a.native ? ` (native D = ${a.native})` : ''}`);
        else console.log(`${path}: ${a.grid} (${a.class}), ${a.mode}${a.mode === 'active' ? '' : ` ${a.threshold}`}, ${a.sampling}, up ${a.up}, colour ${a.colour}${a.colour === 'none' ? '' : `, gamma ${a.gamma ? 'on' : 'off'}`}; solid ${a.size.join(' × ')} grid voxels (native D = ${a.native})`);
        for (const n of a.notes) console.log(`  note: ${n}`);
      },
      onWorld: w => {
        writeFileSync(join(out, w.file), w.bytes);
        console.log(`  ${w.file}: D = ${w.D}, ${w.voxels.toLocaleString('en-US')} voxels, ${w.nodes.toLocaleString('en-US')} nodes, ${w.skin.toLocaleString('en-US')} words, ${(w.bytes.length / 1024).toFixed(0)} KB · ${Object.entries(w.ms).map(([k, v]) => `${k} ${(v / 1000).toFixed(2)} s`).join(', ')}`);
      },
    });
    console.log(`  ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  } finally { await fh.close(); }
}
