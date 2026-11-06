/* What a click costs on the page: editBench() in headless Chrome, with real workers
   and message hops. Prints only (docs/edit-mode-log.md §5). Software GL, so the
   window is small, to keep drawing out of the way of what this can say: hops, jobs,
   install, setRoot. The upload and the frame on a real GPU are only in ?editbench on
   a real machine. It measures job times, so run it on an idle machine.

   node experiments/edit-bench.mjs [--clicks=16] [--workers=4] [--size=160x120] */
import os from 'node:os';
import { findChrome, serveStatic, launchChrome } from '../test/browser/harness.js';

const arg = (name, d) => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : d; };
const clicks = +arg('clicks', 16), workers = +arg('workers', 4), [w, h] = arg('size', '160x120').split('x').map(Number);
const chrome = findChrome();
if (!chrome){ console.error('no Chrome found'); process.exit(1); }
const server = await serveStatic(), browser = await launchChrome(chrome), s = browser.session;
await s.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
await s.send('Page.navigate', { url: `${server.origin}/stream-viewer.html?world=clay&workers=${workers}` });
await s.waitFor('!!window.__stream && !!window.editBench', { timeout: 120000, label: 'the viewer' });
const load0 = os.loadavg()[0], r = await s.evaluate(`editBench({ clicks: ${clicks} })`);
const two = x => `${x.median.toFixed(x.median < 10 ? 2 : 0)} / ${x.most.toFixed(x.most < 10 ? 2 : 0)}`;
console.log(`${r.renderer}, ${r.size.join('×')}, ${r.workers} workers (${r.mode}), load average ${load0.toFixed(1)} → ${os.loadavg()[0].toFixed(1)}, median / most\n`);
console.log('| world | edit | cut | clicks | click to frame, ms | frames | chunks in the flip | KB | setRoot ms | log ms | rAF ms |');
console.log('|---|---|---:|---:|---|---|---|---|---|---|---:|');
for (const x of r.rows) console.log(`| ${x.world} | ${x.kind} | ${x.cut} | ${x.clicks}${x.misses ? ` (${x.misses} missed)` : ''}${x.late ? ` (${x.late} late)` : ''} | ${two(x.ms)} | ${two(x.frames)} | ${two(x.chunks)} | ${two(x.kb)} | ${two(x.setRootMs)} | ${two(x.logMs)} | ${x.frameMs.toFixed(1)} |`);
await browser.close(); await server.close();
