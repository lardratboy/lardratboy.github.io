/* node animation/shots.mjs [outdir] [times...]

   Opens the animation in headless Chrome on this machine's GPU (the repo's
   test/browser/harness.js), paused, and screenshots it at the given times
   (seconds; by default a few seconds into every chapter), printing any
   console error. A reading aid for the film, not a test. */
import { writeFileSync, mkdirSync } from 'node:fs';
import { findChrome, serveStatic, launchChrome } from '../test/browser/harness.js';

const [outDir = 'animation/shots', ...ts] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const server = await serveStatic(), browser = await launchChrome(findChrome());
const s = browser.session, sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = [];
s.ws.addEventListener('message', ({ data }) => {
  const m = JSON.parse(data);
  if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
});
try {
  await s.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await s.send('Page.navigate', { url: `${server.origin}/animation/index.html?paused` });
  for (let i = 0; i < 100; i++){ if (await s.evaluate('!!window.__anim').catch(() => false)) break; await sleep(100); if (errors.length) break; }
  if (errors.length) throw new Error(errors.join('\n'));
  await s.evaluate('__anim.drain()');
  let times = ts.map(Number);
  if (!times.length){
    const info = await s.evaluate('JSON.stringify(__anim.SCENES.map((x, i) => [x.key, __anim.starts[i], x.dur]))');
    times = JSON.parse(info).flatMap(([, st, d]) => [st + d * 0.35, st + d * 0.8]);
  }
  for (const t of times){
    await s.evaluate(`__anim.seek(${t})`);
    await sleep(250);
    const { data } = await s.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
    const name = `${outDir}/t${String(t.toFixed(1)).padStart(6, '0')}.jpg`;
    writeFileSync(name, Buffer.from(data, 'base64'));
    console.log(name);
  }
  if (errors.length) console.log('ERRORS:\n' + errors.join('\n'));
} finally { await browser.close(); await server.close(); }
