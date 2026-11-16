/* compare.mjs — vdagbench (C++) against bench.mjs (JS) on a list of worlds,
   one markdown table out. Each side runs in its own process, one after the
   other, never at once (they'd share cores).

     node cpp/poc/bench/compare.mjs [files...] [--reps 3] [--threads 4] [--detail 4] [--rule shadow]

   With no files, the worlds below that exist (`node cpp/poc/bench/make-worlds.mjs`
   writes the named-colour ones). --no-colour runs both sides without colour. It measures job times, so run it
   on an idle machine. Every row's checksums must match: if they don't, the two
   didn't do the same work and the times mean nothing (the row says so). */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url)), ROOT = path.resolve(HERE, '../../..');
const BIN = path.resolve(HERE, '../build/vdagbench');
const DEFAULT = [
  'worlds/kit-d10.vdag', 'worlds/terrain-d10.vdag', 'worlds/caves-d10.vdag', 'worlds/scatter-d10.vdag',
  'worlds/gyroid-d10.vdag', 'worlds/lattice-r-32-16--d10.vdag',
  'worlds/scene/knight-d10.vdag', 'test-3d-models/convert/the-dwarf-d10.vdag',
  'test-3d-models/convert/sands-location-d12.vdag',
  // Named colour (cpp/poc/src/fields.cpp), from bench/make-worlds.mjs:
  'cpp/poc/worlds/kit-d12.vdag', 'cpp/poc/worlds/scatter-d10.vdag', 'cpp/poc/worlds/dungeon-d10.vdag', 'cpp/poc/worlds/dungeon-d12.vdag',
];
const args = process.argv.slice(2), pass = [], files = [];
for (let i = 0; i < args.length; i++){
  if (['--reps', '--threads', '--detail', '--rule', '--max'].includes(args[i])) pass.push(args[i], args[++i]);
  else if (args[i] === '--no-colour') pass.push(args[i]);
  else files.push(args[i]);
}
if (!pass.includes('--reps')) pass.push('--reps', '3');
const list = (files.length ? files : DEFAULT).filter(f => existsSync(path.resolve(ROOT, f)));
if (!existsSync(BIN)){ console.error(`build first: cmake -S cpp/poc -B cpp/poc/build && cmake --build cpp/poc/build (no ${BIN})`); process.exit(1); }

const run = (cmd, argv) => {
  const out = execFileSync(cmd, argv, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const line = out.split('\n').find(l => l.startsWith('JSON '));
  return { json: JSON.parse(line.slice(5)), text: out };
};
const f1 = v => v.toFixed(1), x = (a, b) => (a / b).toFixed(1) + '×';
const rows = [];
for (const f of list){
  process.stderr.write(`${f} ...`);
  const c = run(BIN, [f, ...pass, '--json']), j = run(process.execPath, [path.join(HERE, 'bench.mjs'), f, ...pass, '--json']);
  process.stderr.write(' done\n');
  rows.push({ f, c: c.json, j: j.json });
}
console.log(`| world | colour | eye | jobs | records + words | cut ms JS / C++ | 1 thread cold ms JS / C++ | warm ms JS / C++ | ${rows[0]?.c.eyes[0].threads ?? 4} threads ms JS / C++ | load ms JS / C++ | same bytes |`);
console.log('|---|---|---|---:|---:|---:|---:|---:|---:|---:|:---:|');
for (const { f, c, j } of rows)
  c.eyes.forEach((ce, i) => {
    const je = j.eyes[i], same = ce.checksum === je.checksum;
    console.log(`| ${path.basename(f, '.vdag')} | ${i ? '' : c.colour} | ${ce.eye} | ${ce.nodes} | ${((ce.records + ce.tail) / 1e6).toFixed(2)}M + ${(ce.words / 1e6).toFixed(2)}M ` +
                `| ${je.cutMs.toFixed(3)} / ${ce.cutMs.toFixed(3)} (${x(je.cutMs, ce.cutMs)}) ` +
                `| ${f1(je.cold)} / ${f1(ce.cold)} (**${x(je.cold, ce.cold)}**) | ${f1(je.warm)} / ${f1(ce.warm)} (${x(je.warm, ce.warm)}) ` +
                `| ${f1(je.multi)} / ${f1(ce.multi)} (**${x(je.multi, ce.multi)}**) ` +
                `| ${i ? '' : `${f1(j.load)} / ${f1(c.load)} (${x(j.load, c.load)})`} | ${same ? 'yes' : '**NO**'} |`);
  });
