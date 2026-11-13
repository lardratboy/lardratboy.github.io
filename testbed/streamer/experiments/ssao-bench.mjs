/* What screen-space ambient occlusion costs the stream viewer's frame, from
   headless Chrome on this machine's GPU (docs/vdagssao.md §5). For each view:
   the page's ssaoBench() (each setting against none, converged first), then
   the frame with SSAO off, on (the defaults) and the AO alone, as JPEGs to
   docs/images/ssao-gpu-<view>-{off,on,ao}.jpg. Prints only, besides the
   pictures. It measures frame times, so run it on an idle machine.

   node experiments/ssao-bench.mjs [--size=1280x800] [--dpr=2] [--only=kit,street] [--shots=0] [--clock=timer]
   The wall clock by default (whole frames, gl.finish, off and on interleaved); --clock=timer
   for GPU timer queries, which on the M2 Max charged SSAO for part of the raster pass
   (vdagssao.md §5). */
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import { findChrome, serveStatic, launchChrome } from '../test/browser/harness.js';

const arg = (name, d) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const clock = arg('clock', 'wall'), [w, h] = arg('size', '1280x800').split('x').map(Number), dpr = +arg('dpr', 2), only = arg('only', null)?.split(','), shots = arg('shots', '1') !== '0';
const VIEWS = {
  kit: 'world=kit:1',                                                         // the D = 14 kit, the opening view
  street: 'world=kit:1&eye=328,1966,328&yaw=0.78&pitch=-0.05',              // kit.mjs's street at D = 14
  caves: 'world=caves:1',                                                     // the start chamber
  hills: 'world=shape:hills',
  // Flat ground at D = 20 has nothing to occlude anything: AO below 1 there is
  // all artifact. 64 voxels up the near plane is 32; 2 up it's 1, and 24-bit
  // depth steps reach a voxel by 4,000 voxels out (vdagssao.md §6).
  flat64: 'world=clay&clay=20,0,ball,1&eye=524288.5,524352,524288.5&yaw=0.6&pitch=-0.06',
  flat2: 'world=clay&clay=20,0,ball,1&eye=524288.5,524290,524288.5&yaw=0.6&pitch=-0.02',
};
const SHOTS = { caves: ['off', 'on', 'ao'], hills: ['off', 'on', 'ao'], street: ['on', 'ao'], flat2: ['ao'] };
const chrome = findChrome();
if (!chrome){ console.error('no Chrome found'); process.exit(1); }
const server = await serveStatic(), browser = await launchChrome(chrome), s = browser.session;
await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
const load0 = os.loadavg()[0];
let header = false;
for (const [name, query] of Object.entries(VIEWS)){
  if (only && !only.includes(name)) continue;
  await s.send('Page.navigate', { url: `${server.origin}/stream-viewer.html?${query}&workers=4` });
  await s.waitFor('!!window.__stream?.world && !!window.ssaoBench && !!window.__ssao', { timeout: 300000, label: `the ${name} view` });
  const r = await s.evaluate(`ssaoBench(${clock ? `{ clock: '${clock}' }` : ''})`);
  if (r.error){ console.log(`${name}: ${r.error}`); continue; }
  if (!header){
    console.log(`${r.renderer}, ${r.size.join('×')} (${w}×${h} at ${dpr}×), ${r.clock} clock, load average ${load0.toFixed(1)}\n`);
    console.log(`| view | cubes | AO on | mean AO | below 0.8 | ${r.rows.map(x => x.name).join(' | ')} |`);
    console.log(`|---|---:|---:|---:|---:|${r.rows.map(() => '---:').join('|')}|`);
    header = true;
  }
  console.log(`| ${name}${r.converged ? '' : ' (not converged)'} | ${(r.cubes / 1e6).toFixed(2)}M | ${(100 * r.covered).toFixed(0)}% | ${r.aoMean.toFixed(3)} | ${(100 * r.aoDark).toFixed(0)}% | ` +
    r.rows.map(x => x.settings ? `+${x.ssaoMs.toFixed(2)}` : `${x.frameMs.toFixed(2)}`).join(' | ') + ' |');
  if (!shots) continue;
  // The pictures vdagssao.md shows, and no others.
  for (const [tag, set] of [['off', 'null'], ['on', '__ssao.defaults'], ['ao', '__ssao.defaults, true']]){
    if (!SHOTS[name]?.includes(tag)) continue;
    await s.evaluate(`__ssao.set(${set})`);
    await s.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))');
    const { data } = await s.send('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip: { x: 0, y: 0, width: w, height: h, scale: 1 / dpr } });
    writeFileSync(`docs/images/ssao-gpu-${name}-${tag}.jpg`, Buffer.from(data, 'base64'));
  }
  // Half resolution against full: the middle of the caves' AO at the device's own pixels.
  if (name === 'caves') for (const [tag, scale] of [['half', 2], ['full', 1]]){
    await s.evaluate(`__ssao.set({ ...__ssao.defaults, scale: ${scale} }, true)`);
    await s.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))))');
    const { data } = await s.send('Page.captureScreenshot', { format: 'jpeg', quality: 88, clip: { x: w / 4, y: h / 4, width: w / 2, height: h / 2, scale: 1 } });
    writeFileSync(`docs/images/ssao-gpu-caves-ao-${tag}.jpg`, Buffer.from(data, 'base64'));
  }
}
console.log(`\nframe ms for "off"; the others are what SSAO adds to it, ms. Load average after: ${os.loadavg()[0].toFixed(1)}`);
await browser.close(); await server.close();
