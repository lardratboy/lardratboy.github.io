/* PLY files to world files from the command line: convert/'s convertPly
   (ply-core.js under it) over an fs stream, so the page and this write the
   same bytes (test/ply-core.test.js holds the page's core to it, and
   test/browser/convert.test.js the page). docs/convert.md §PLY.

     node experiments/ply-vdag.mjs <file.ply ...> [--D=8,10] [--bits=6|8] [--bake=off] [--out=dir]
         [--point=cube:1|ball:2] [--opacity=0.2] [--colour=vertices]

   Beside each file by default, as mesh-vdag.mjs writes. Prints what each
   stage took and the memory the process held at the end, which is what the
   page's worker holds too. No pictures (--thumbs to time them).

   The page's PLY settings (convert.md §PLY, 2026-11-18): --point is what a
   cloud's point fills (cube or ball, radius 0–3; cube:0 by default),
   --opacity drops a cloud's fainter points, --colour=vertices colours a
   mesh from its vertices. A textured mesh's TextureFiles are read from
   beside it (a JPEG through sips or ffmpeg, as mesh-vdag.mjs does). */
import { createReadStream, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { convertPly, nameOf, DEPTHS } from '../convert/convert-core.js';
import { decodeJpeg } from './mesh-asset.mjs';

const args = process.argv.slice(2), files = args.filter(a => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find(a => a.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const depths = opt('D', '8,10').split(',').map(Number), bits = Number(opt('bits', 6)), bake = opt('bake', 'on') !== 'off', out = opt('out', null);
const thumbs = args.includes('--thumbs'), opacity = Number(opt('opacity', 0)), meshColour = opt('colour', 'triangles');
const [shape, r] = opt('point', 'cube:0').split(':'), point = { shape, r: Number(r ?? 0) };
if (!files.length){ console.error('usage: node experiments/ply-vdag.mjs <file.ply ...> [--D=8,10] [--bits=6|8] [--bake=off] [--out=dir] [--point=cube:1|ball:2] [--opacity=0.2] [--colour=vertices] [--thumbs]'); process.exit(1); }
for (const D of depths) if (!DEPTHS.includes(D)) { console.error(`D = ${D}: ${DEPTHS[0]} to ${DEPTHS.at(-1)}`); process.exit(1); }

const fmt = n => n.toLocaleString('en-US'), ms = t => `${(t / 1000).toFixed(2)} s`;
for (const file of files){
  const size = statSync(file).size, name = nameOf(file), t0 = performance.now();
  let read = 0;
  console.log(`${file} (${(size / 1048576).toFixed(1)} MB)`);
  // A texture is looked for beside the file, by the name its TextureFile gives.
  const beside = { get: t => { const at = join(dirname(file), t); return existsSync(at) ? new Uint8Array(readFileSync(at)) : undefined; } };
  const platform = async (bytes, type) => { if (type === 'image/jpeg') return decodeJpeg(Buffer.from(bytes)); throw new Error(`${type} isn't decoded here`); };
  const r = await convertPly(createReadStream(file, { highWaterMark: 8 << 20 }), {
    name, depths, bits, bake, size, thumbs, point, opacity, meshColour, files: beside, platform,
    onStage: (D, s) => { if (D === null && s === 'analysing') read = performance.now() - t0; },
    onAsset: a => {
      if (!read) read = performance.now() - t0;
      console.log(`  read in ${ms(read)}: ${a.kind === 'points' ? `${fmt(a.points)} points, ${a.colour ?? 'no'} colour` : `${fmt(a.triangles)} triangles, ${fmt(a.components)} components, ${fmt(a.solid)} solid`} (${a.format})`);
      if (a.notes.length) console.log(`  notes: ${a.notes.join(' · ')}`);
    },
    onWorld: w => {
      const at = join(out ?? dirname(file), w.file);
      writeFileSync(at, w.bytes);
      const st = Object.entries(w.ms).map(([k, v]) => `${k} ${ms(v)}`).join(', ');
      const fell = w.fellBack ? `, ${fmt(w.fellBack)} from the triangles` : '';
      console.log(`  D = ${w.D}: ${fmt(w.voxels)} voxels, ${fmt(w.nodes)} nodes, ${fmt(w.skin)} words${fell}, ${(w.bytes.length / 1024).toFixed(0)} KB → ${at}\n          ${st}`);
    },
  });
  console.log(`  all in ${ms(performance.now() - t0)}, ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB resident`);
  void r;
}
