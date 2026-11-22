/* Screenshots of the arena (destroy/README.md): `node destroy/test/browser/shots.mjs [outdir]`
   builds the default arena in headless Chrome on the GPU and writes
   destroy-*.jpg: the opening view, a rocket's blast in flight, the rubble
   settled, the plasma's melt, and a tower's top cut loose and falling. The
   shots drive the page by __destroy (headless Chrome has no pointer lock). */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { findChrome, serveStatic, launchChrome, REPO_ROOT } from '../../../test/browser/harness.js';

const out = process.argv[2] || join(REPO_ROOT, 'destroy', 'images');
mkdirSync(out, { recursive: true });
const server = await serveStatic(), browser = await launchChrome(findChrome()), s = browser.session;
const errors = [];
s.ws.addEventListener('message', ({ data }) => { const m = JSON.parse(data); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description); });
await s.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
await s.send('Page.navigate', { url: `${server.origin}/destroy/index.html?test=1&${process.env.QUERY || ''}` });
await s.waitFor('window.__destroy && __destroy.ready', { timeout: 30000 });
await s.evaluate('__destroy.build().then(() => true)');
const shot = async name => {
  await s.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const { data } = await s.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 });
  writeFileSync(join(out, `destroy-${name}.jpg`), Buffer.from(data, 'base64'));
  console.log('wrote', name);
};
const run = (n, dt = 1 / 60) => s.evaluate(`(() => { for (let k = 0; k < ${n}; k++) __destroy.update(${dt}); __destroy.remesh(Infinity); return __destroy.mass(); })()`);
await s.evaluate(`__destroy.live = false; true`);
await run(30);
await shot('opening');
// Stand back from the biggest thing, aim at its face, and blast where the aim meets it.
const target = await s.evaluate(`(() => { const p = __destroy.built.placed.slice().sort((a, b) => b.voxels - a.voxels)[0];
  const c = [p.at[0] + p.size[0] / 2, p.at[1] + p.size[1] * 0.4, p.at[2] + p.size[2] / 2];
  __destroy.walker.p = [c[0] + 20, p.at[1], Math.min(__destroy.arena.Z - 4, p.at[2] + p.size[2] + 60)]; __destroy.walker.v = [0, 0, 0]; __destroy.update(1 / 60);
  const e = __destroy.cam.eye; __destroy.cam.yaw = Math.atan2(c[0] - e[0], c[2] - e[2]); __destroy.cam.pitch = Math.atan2(c[1] - e[1], Math.hypot(c[0] - e[0], c[2] - e[2]));
  const d = [c[0] - e[0], c[1] - e[1], c[2] - e[2]], h = __destroy.raycast(e, d, 2);
  return { c: h ? h.p : c, n: h ? h.n : [0, 0, 1], name: p.name }; })()`);
console.log('target', target.name, target.c);
await s.evaluate(`__destroy.explode(${JSON.stringify(target.c)}, 9, 'rocket', ${JSON.stringify(target.n)}); true`);
await run(9);
await shot('blast');
await run(28);
await shot('debris');
await run(400);
await shot('settled');
// The plasma: a burst of melt at the target's face.
await s.evaluate(`(() => { __destroy.setWeapon('plasma'); for (let k = 0; k < 14; k++){ const c = ${JSON.stringify(target.c)}; const e = __destroy.cam.eye, d = [c[0] + (k % 5) * 3 - 6 - e[0], c[1] + 8 + Math.floor(k / 5) * 3 - e[1], c[2] - e[2]], h = __destroy.raycast(e, d, 2); if (h) __destroy.explode(h.p, 2.5, 'plasma', h.n); __destroy.update(1 / 60); } return true; })()`);
await run(20);
await shot('plasma');
await run(600);
await shot('slag');
const m = await s.evaluate('__destroy.mass()');
console.log('mass', m, 'errors', errors);
await browser.close(); await server.close();
