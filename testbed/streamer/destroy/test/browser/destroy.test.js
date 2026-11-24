/* The arena page (destroy/index.html) in headless Chrome on the machine's GPU
   (TESTBED_GL=software for SwiftShader), by the repo's harness. The cores'
   promises are held in Node (destroy/test/*.test.js); this holds the page's
   wiring to them:
     - __destroy.selftest(): a small arena built in the page's worker and
       streamed together on the page (the plane laid there, each thing
       stamped as the worker places it), which must be buildArena's grid
       cell for cell and the builder's count; then a
       rocket blast on every thing placed, then each weapon fired (plain and
       alt) through the same fire() and projectile step the mouse uses, the
       world run until every body has baked: the mass exact every frame
       (world + debris = the total at the build), no body ever inside the
       grid, nothing left in flight, frames drawn with no GL error, and no
       console error;
     - the settings panel: Tab opens it and a real click on its × closes
       it, in a window short enough to scroll it, scrolled to the end;
     - a .vdag world (a ball written by vdag-core in Node) added through the
       real file input: it is placed first, at the middle, with the voxels the
       Node stamp gives, and a blast in it keeps the mass.
   The selftest also holds: every projectile fired (1 + 1 rockets, 1 + 7
   bolts) meets the plane and blows; a rocket under the walker throws it up;
   and every chunk's buffer, read back from the GPU, is meshChunk's words
   for the grid as it is now. Then mutants of the page's wiring
   (PAGE_MUTANTS, copies as destroy/mutant-destroy-<k>.html, removed after),
   each of which the selftest must catch. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findChrome, serveStatic, launchChrome, REPO_ROOT } from '../../../test/browser/harness.js';
import { createStore, createCounts } from '../../../dag-core.js';
import { writeVdag } from '../../../vdag-core.js';
import { dagItem, fitLod, itemVoxels, arenaDesc } from '../../content-core.js';

const chrome = findChrome();
const skip = chrome ? false : 'no Chrome found (TESTBED_CHROME=/path/to/chrome to point at one, =0 to skip)';
const PAGE = process.env.DESTROY_PAGE || 'destroy/index.html';
let server, browser, errors = [], dir;

before(async () => {
  if (skip) return;
  server = await serveStatic();
  browser = await launchChrome(chrome);
  const s = browser.session;
  s.ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  });
  await s.send('Page.navigate', { url: `${server.origin}/${PAGE}?test=1` });
  await s.waitFor('window.__destroy && window.__destroy.ready === true', { timeout: 30000, label: 'the arena page to boot' });
});
after(async () => { if (browser) await browser.close(); if (server) await server.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

test('the selftest: blasts, both weapons, debris baked, mass exact', { skip, timeout: 240000 }, async () => {
  const r = await browser.session.evaluate('__destroy.selftest()');
  assert.deepEqual(r.errors, [], JSON.stringify(r));
  assert.ok(r.placed >= 3, `only ${r.placed} things placed`);
  assert.ok(r.carvedByRockets > 500, `rockets carved ${r.carvedByRockets}`);
  assert.ok(r.shots >= 4 && r.blasts > r.placed, JSON.stringify(r));
  assert.equal(r.left, 0, 'bodies still in flight');
  assert.equal(r.world, r.total);
  assert.ok(r.instances > 1000, `${r.instances} cubes drawn`);
  assert.ok(r.loose > 0, 'something was cut loose and fell');
  assert.equal(r.projectileBlasts, 10);
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepEqual(errors, []);
});

test('a .vdag world through the file input', { skip, timeout: 240000 }, async () => {
  // A ball of radius 12 in a D = 5 world, no colour (the page draws the gamut).
  const R = 32, occ = new Uint8Array(R ** 3);
  for (let z = 0; z < R; z++) for (let y = 0; y < R; y++) for (let x = 0; x < R; x++)
    if ((x - 15.5) ** 2 + (y - 12.5) ** 2 + (z - 15.5) ** 2 < 144) occ[x + R * (y + R * z)] = 1;
  const store = createStore(), { root, D } = store.fromDense(occ, R);
  const bytes = await writeVdag([{ name: 'ball', keys: store.snapshot().keys, root, D }]);
  dir = mkdtempSync(join(tmpdir(), 'destroy-'));
  const file = join(dir, 'ball.vdag');
  writeFileSync(file, bytes);
  const desc = arenaDesc({ size: 128, height: 96, plane: 16, seed: 3, specimens: 4, maths: 1 });
  const lod = fitLod(D, Math.min(desc.height - desc.plane - 8, Math.floor(desc.size * 0.6)));
  const want = itemVoxels(dagItem('ball', { store, counts: createCounts(store), root, D }, null, lod));
  const s = browser.session;
  const { root: doc } = await s.send('DOM.getDocument');
  const { nodeId } = await s.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#fileInput' });
  await s.send('DOM.setFileInputFiles', { nodeId, files: [file] });
  await s.waitFor(`__destroy.built && __destroy.built.placed.some(p => p.name === 'ball.vdag')`, { timeout: 60000, label: 'the arena with the ball' });
  const got = await s.evaluate(`(() => { const p = __destroy.built.placed[0]; return { name: p.name, voxels: p.voxels, at: p.at, size: p.size, sources: __destroy.built.sources }; })()`);
  assert.equal(got.name, 'ball.vdag');
  assert.equal(got.voxels, want);
  assert.equal(got.at[1], 16, 'stands on the plane');
  const after = await s.evaluate(`(() => { const p = __destroy.built.placed[0]; __destroy.explode([p.at[0] + p.size[0] / 2, p.at[1] + p.size[1] / 2, p.at[2]], 6, 'rocket');
    for (let k = 0; k < 900 && __destroy.debris.bodies.length; k++) __destroy.update(1 / 60);
    const m = __destroy.mass(); return { ...m, left: __destroy.debris.bodies.length }; })()`);
  assert.equal(after.left, 0);
  assert.equal(after.world, after.total);
  assert.deepEqual(errors, []);
});

test('the panel: Tab opens it, a real click on its × closes it, in a short window too', { skip, timeout: 60000 }, async () => {
  const s = browser.session, hidden = () => s.evaluate(`document.getElementById('panel').hidden`);
  const key = async () => {
    for (const type of ['rawKeyDown', 'keyUp']) await s.send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
  };
  for (const height of [900, 420]){
    await s.send('Emulation.setDeviceMetricsOverride', { width: 1280, height, deviceScaleFactor: 1, mobile: false });
    if (!(await hidden())) await key();
    assert.equal(await hidden(), true, 'closed to start');
    await key();
    assert.equal(await hidden(), false, `Tab opens it (${height} tall)`);
    // Scrolled to the end in the short window: the × must still be on screen at the top.
    await s.evaluate(`(() => { const p = document.getElementById('panel'); p.scrollTop = p.scrollHeight; })()`);
    const r = await s.evaluate(`(() => { const b = document.getElementById('panelX').getBoundingClientRect(), p = document.getElementById('panel'); return { x: b.x + b.width / 2, y: b.y + b.height / 2, top: b.top, panelTop: p.getBoundingClientRect().top, scrolls: p.scrollHeight > p.clientHeight }; })()`);
    if (height === 420) assert.ok(r.scrolls, 'the short window scrolls the panel');
    assert.ok(r.top >= r.panelTop && r.top < r.panelTop + 40, `the × at the panel's top (${r.top}, panel ${r.panelTop})`);
    for (const type of ['mousePressed', 'mouseReleased']) await s.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    assert.equal(await hidden(), true, `the × closes it (${height} tall)`);
  }
  await s.send('Emulation.clearDeviceMetricsOverride');
  assert.deepEqual(errors, []);
});

const PAGE_MUTANTS = [
  ['rubble lost', '} else burst(D, carved, c, r, { seed, cluster:', '} else void (D, carved, c, r, { seed, cluster:'],
  ['melt lost', '    burst(D, carved, c, r, { seed, liquid: true,', '    void (D, carved, c, r, { seed, liquid: true,'],
  ['loose pieces dropped', "b = addBody(D, makeBody(d.offs, d.cols, d.origin, [0, 0, 0], { kind: 'piece' }));", "b = makeBody(d.offs, d.cols, d.origin, [0, 0, 0], { kind: 'piece' });"],
  ['words not uploaded', '  if (r.count) gl.bufferSubData(gl.ARRAY_BUFFER, 0, r.words);', ''],
  ['no rocket jump', 'walker.v[1] += Math.max(u[1], 0.25) * k;', ''],
  ['bolts pass through', 'const hit = raycast(A, pr.p, pr.v, dt);', 'const hit = null;'],
  ['debris frozen', '  stepDebris(D, A, dt);\n', '\n'],
  ['one bolt a spread', 'const n = alt ? 7 : 1, spread', 'const n = 1, spread'],
  ['a thing unstamped', '  stampItem(A, { name, sx, sy, sz, cells }, at[0], at[1], at[2]);\n', ''],
  ['a thing uncounted', '  A.refreshBox(at, [at[0] + sx, at[1] + sy, at[2] + sz]);\n', ''],
  ['no plane', '  fillPlane(A, d.plane); A.refreshBox([0, 0, 0], [d.size, d.plane, d.size]);\n', ''],
];
test('every mutant of the page is caught', { skip, timeout: 600000 }, async t => {
  const src = readFileSync(join(REPO_ROOT, PAGE), 'utf8'), s = browser.session;
  for (const [k, [name, from, to]] of PAGE_MUTANTS.entries()){
    assert.equal(src.split(from).length, 2, `mutant ${name}: its text must occur exactly once in the page`);
    const file = join(REPO_ROOT, 'destroy', `mutant-destroy-${k}.html`);
    try {
      writeFileSync(file, src.replace(from, to));
      await s.send('Page.navigate', { url: `${server.origin}/destroy/mutant-destroy-${k}.html?test=1` });
      let caught = null;
      try {
        await s.waitFor('window.__destroy && window.__destroy.ready === true', { timeout: 20000 });
        const r = await s.evaluate('__destroy.selftest()');
        if (!r.ok) caught = r.errors[0] || `left ${r.left}, world ${r.world} of ${r.total}`;
        else if (r.loose === 0) caught = 'nothing cut loose';
        else if (r.projectileBlasts !== 10) caught = `${r.projectileBlasts} projectile blasts`;
      } catch (e){ caught = e.message; }
      assert.ok(caught, `mutant ${name} survived`);
      t.diagnostic(`mutant ${name}: ${String(caught).split('\n')[0]}`);
    } finally { rmSync(file, { force: true }); }
  }
  errors.length = 0;
});
