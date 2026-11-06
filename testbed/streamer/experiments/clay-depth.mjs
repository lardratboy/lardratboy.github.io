/* Where does depth stop working? Raster against ray on the clay worlds, in a real
   browser, for docs/clay-log.md §3.

   realtimecsg.md §11.4 worked out from the code that the ray pass's float32 eye
   would start to matter somewhere past D = 20, without seeing it. This looks:
   the same view through each path alone (the page's rasterVsRay), for the lump
   and the ground, at each depth, off the menu's limit by a URL. Software GL, so
   the time means little, but the pixels are the pixels.

   node experiments/clay-depth.mjs           the table, and writes docs/data/clay-depth.json
   node experiments/clay-depth.mjs --print   prints only */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findChrome, serveStatic, launchChrome, REPO_ROOT } from '../test/browser/harness.js';

const PRINT = process.argv.includes('--print');
const chrome = findChrome();
if (!chrome) throw new Error('no Chrome found (TESTBED_CHROME=/path/to/chrome)');
const server = await serveStatic(), browser = await launchChrome(chrome), s = browser.session;
await s.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
const rows = [];
console.log('| world | D | eye x | lit pixels | hit by one path only | colour differs | converged |');
console.log('|---|---:|---:|---:|---:|---:|---|');
for (const [name, param] of [['ball 256', D => `${D},256,ball,0`], ['block 256', D => `${D},256,block,0`], ['flat ground', D => `${D},0,ball,1`]])
  for (const D of [12, 16, 20, 22, 24, 26, 28]){
    await s.send('Page.navigate', { url: `${server.origin}/stream-viewer.html?world=clay&clay=${param(D)}&workers=4` });
    await s.waitFor(`!!window.__stream && !!window.rasterVsRay && window.__stream.world?.D === ${D}`, { timeout: 120000, label: `clay at D = ${D}` });
    const r = await s.evaluate('rasterVsRay()', { timeout: 600000 });
    rows.push({ name, D, ...r });
    console.log(`| ${name} | ${D} | ${Math.round(r.eye[0]).toLocaleString('en-US')} | ${r.lit.toLocaleString('en-US')} | ${r.hitOnly.toLocaleString('en-US')} | ${r.colour.toLocaleString('en-US')} | ${r.converged ? 'yes' : 'NO'} |`);
  }
await browser.close(); await server.close();
if (!PRINT) writeFileSync(join(REPO_ROOT, 'docs/data/clay-depth.json'), JSON.stringify(rows, null, 1) + '\n');
