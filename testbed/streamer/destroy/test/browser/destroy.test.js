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
       Node stamp gives, and a blast in it keeps the mass;
     - saving and opening (README, "Saving an arena"): a rocket, then the
       real Save button with the debris in flight, which must wait for every
       body to bake before it writes; the download, caught on disk and read
       in Node by vdag-core and file-core, is the page's grid cell for cell
       (a hash) with the page's eye as its view; another arena built, with
       debris flying, then the file opened through the real Open input is the
       saved grid again with its mass and no debris, the walker where the
       view stood, and a blast in it keeps the mass; the same file as the
       stream viewer saves an edited arena (`, edited` on the name, a tower
       over its top, its camera outside the arena as the view) opens as a
       saved arena grown to hold the tower, Node's cell for cell, with the
       walker at the near edge;
       and the ball opened as the arena is Node's arenaOfWorld, cell for
       cell. Then SAVE_MUTANTS, run through the same check.
   The selftest also holds: every projectile fired (1 + 1 rockets, 1 + 7
   bolts) meets the plane and blows; a rocket under the walker throws it up;
   and every chunk's buffer, read back from the GPU, is meshChunk's words
   for the grid as it is now. Then mutants of the page's wiring
   (PAGE_MUTANTS, copies as destroy/mutant-destroy-<k>.html, removed after),
   each of which the selftest must catch. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findChrome, serveStatic, launchChrome, REPO_ROOT } from '../../../test/browser/harness.js';
import { createStore, createCounts, storeView } from '../../../dag-core.js';
import { writeVdag } from '../../../vdag-core.js';
import { dagItem, fitLod, itemVoxels, arenaDesc } from '../../content-core.js';
import { arenaOfWorld, arenaWorld } from '../../file-core.js';
import { createArena, SOLID_BIT } from '../../arena-core.js';
import { readVdag } from '../../../vdag-core.js';
import { colourOf } from '../../../colours.js';

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

// FNV-1a of a grid's cells, written the same in the page.
const HASH = `cells => { let h = 0x811c9dc5; for (let i = 0; i < cells.length; i++){ h = Math.imul(h ^ cells[i], 0x01000193); } return h >>> 0; }`;
const hashOf = eval(HASH);
async function arenaOfFile(file){
  const { worlds: [w] } = await readVdag(new Uint8Array(readFileSync(file)), { colourOf });
  const store = storeView({ keys: w.keys }), counts = createCounts(store);
  let colour = null;
  try { colour = w.colour ? colourOf(w.colour, { store, counts, D: w.D }) : null; } catch {}
  return { w, r: arenaOfWorld({ store, counts, root: w.root, D: w.D, name: w.name }, colour) };
}
const settled = `(() => { for (let k = 0; k < 1500 && __destroy.debris.bodies.length; k++) __destroy.update(1 / 60); return __destroy.debris.bodies.length; })()`;
// The save and open check, on whichever page is loaded; throws on the first thing wrong.
async function saveAndOpen(s, ball){
  const downloads = mkdtempSync(join(tmpdir(), 'destroy-save-'));
  try {
    await s.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
    await s.evaluate(`(async () => { __destroy.files.length = 0; Object.assign(__destroy.settings, { size: 128, height: 96, plane: 16, seed: 3, specimens: 4, maths: 1 }); await __destroy.build(); })()`);
    // A rocket into the first thing, then Save with its debris still flying.
    const flying = await s.evaluate(`(() => { const p = __destroy.built.placed[0]; __destroy.explode([p.at[0] + p.size[0] / 2, p.at[1] + 4, p.at[2]], 7, 'rocket');
      for (let k = 0; k < 3; k++) __destroy.update(1 / 60);
      // The walker away from the spawn (the eye follows it), so the view tells.
      __destroy.walker.p = [20.25, 40, 20.75]; __destroy.cam.yaw = 1; __destroy.cam.pitch = -0.4;
      document.getElementById('saveArena').click(); return { bodies: __destroy.debris.bodies.length, saving: __destroy.saving }; })()`);
    assert.ok(flying.bodies > 0, 'debris in flight');
    assert.ok(flying.saving, 'the save waits');
    await new Promise(r => setTimeout(r, 400));
    assert.equal(readdirSync(downloads).length, 0, 'nothing saved while debris flies');
    assert.equal(await s.evaluate(settled), 0, 'the debris baked');
    const page = await s.evaluate(`(() => { const A = __destroy.arena; return { hash: (${HASH})(A.cells), count: A.count, total: __destroy.total, X: A.X, Y: A.Y, Z: A.Z,
      eye: __destroy.cam.eye.slice(), yaw: __destroy.cam.yaw, pitch: __destroy.cam.pitch }; })()`);
    assert.equal(page.count, page.total, 'the mass before the save');
    const saved = join(downloads, 'arena-128-seed3.vdag');
    for (let i = 0; i < 200 && !(existsSync(saved) && !readdirSync(downloads).some(f => f.endsWith('.crdownload'))); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(existsSync(saved), `the save downloads arena-128-seed3.vdag (${readdirSync(downloads)})`);
    const { w, r } = await arenaOfFile(saved);
    assert.equal(w.name, 'arena 128 × 96 × 128');
    assert.ok(r.saved, 'a saved arena');
    assert.deepEqual([r.A.X, r.A.Y, r.A.Z], [page.X, page.Y, page.Z]);
    assert.equal(r.A.count, page.count, 'the file holds every voxel');
    assert.equal(hashOf(r.A.cells), page.hash, 'the file is the page\'s grid');
    assert.deepEqual(w.view, { eye: page.eye, yaw: page.yaw, pitch: page.pitch }, 'the view is the eye');
    assert.ok(Math.hypot(page.eye[0] - 64, page.eye[2] - 114) > 20, `the eye away from the spawn (${page.eye})`);
    assert.equal((await s.evaluate('__destroy.lastSave')).voxels, page.count);
    // Another arena (another seed, another mass) with debris flying in it, then the file opened through
    // the real input: the grid saved, its mass, no debris, the walker at its view.
    await s.evaluate(`(async () => { __destroy.settings.seed = 4; await __destroy.build(); __destroy.explode([40, 17, 40], 9, 'rocket'); __destroy.update(1 / 60); })()`);
    const { root: doc } = await s.send('DOM.getDocument');
    const { nodeId } = await s.send('DOM.querySelector', { nodeId: doc.nodeId, selector: '#arenaInput' });
    await s.send('DOM.setFileInputFiles', { nodeId, files: [saved] });
    await s.waitFor(`__destroy.built && __destroy.built.opened && __destroy.built.opened.name === 'arena-128-seed3.vdag'`, { timeout: 60000, label: 'the arena opened' });
    const opened = await s.evaluate(`(() => { const A = __destroy.arena; return { hash: (${HASH})(A.cells), count: A.count, total: __destroy.total, opened: __destroy.built.opened,
      bodies: __destroy.debris.bodies.length, walker: __destroy.walker && __destroy.walker.p.slice(), size: [A.X, A.Y, A.Z] }; })()`);
    assert.equal(opened.hash, page.hash, 'opened, the arena is the saved grid');
    assert.equal(opened.count, page.count); assert.equal(opened.total, page.count, 'the mass to keep is the file\'s');
    assert.deepEqual(opened.size, [page.X, page.Y, page.Z]);
    assert.ok(opened.opened.saved && opened.opened.lod === 0);
    assert.equal(opened.bodies, 0);
    assert.ok(opened.walker && Math.abs(opened.walker[0] - page.eye[0]) < 1e-9 && Math.abs(opened.walker[2] - page.eye[2]) < 1e-9, `the walker where the view stood (${opened.walker})`);
    const after = await s.evaluate(`(() => { __destroy.explode([64, 18, 64], 7, 'rocket'); for (let k = 0; k < 1500 && __destroy.debris.bodies.length; k++) __destroy.update(1 / 60);
      return { ...__destroy.mass(), left: __destroy.debris.bodies.length }; })()`);
    assert.equal(after.left, 0); assert.equal(after.world, after.total, 'a blast in the opened arena keeps the mass');
    // The same arena as the stream viewer saves it edited (2026-11-27): `, edited` on its name, a tower
    // built over its top (to y = 130 over 96), and its view the viewer's camera, out over the edge looking
    // in. Still a saved arena, grown to hold the tower (130 + 64 up to 32: 224), the walker at the near edge.
    const edited = join(downloads, 'arena-128-seed3-edited.vdag'), tall = createArena(page.X, 160, page.Z);
    tall.cells.set(r.A.cells);
    for (let y = 0; y < 130; y++) for (let z = 50; z < 54; z++) for (let x = 30; x < 33; x++) tall.cells[tall.idx(x, y, z)] = SOLID_BIT | 0x2a5 | y;
    tall.recount();
    writeFileSync(edited, await writeVdag([{ ...arenaWorld(tall), name: `${w.name}, edited`, view: { eye: [170.5, 120, -40.25], yaw: -0.98, pitch: -0.43 } }]));
    const grown = (await arenaOfFile(edited)).r;
    assert.deepEqual([grown.A.X, grown.A.Y, grown.A.Z, grown.grown], [page.X, 224, page.Z, page.Y], 'Node grows it');
    await s.send('DOM.setFileInputFiles', { nodeId, files: [edited] });
    await s.waitFor(`__destroy.built && __destroy.built.opened && __destroy.built.opened.name === 'arena-128-seed3-edited.vdag'`, { timeout: 60000, label: 'the edited arena opened' });
    const outside = await s.evaluate(`(() => { const A = __destroy.arena; return { hash: (${HASH})(A.cells), count: A.count, total: __destroy.total, opened: __destroy.built.opened,
      walker: __destroy.walker && __destroy.walker.p.slice(), size: [A.X, A.Y, A.Z], note: document.getElementById('fileNote').textContent }; })()`);
    assert.equal(outside.hash, hashOf(grown.A.cells), 'the edited arena is Node\'s, cell for cell');
    assert.equal(outside.count, tall.count); assert.equal(outside.total, tall.count, 'every voxel, the tower\'s too');
    assert.ok(outside.opened.saved && outside.opened.lod === 0 && outside.opened.grown === page.Y, 'an arena edited in the viewer opens as a saved arena, grown');
    assert.deepEqual(outside.size, [page.X, 224, page.Z]);
    assert.match(outside.note, /grown from 96 tall/);
    assert.ok(outside.walker && outside.walker[0] === page.X / 2 && outside.walker[2] === page.Z - 14, `a view outside the arena: the walker at the near edge (${outside.walker})`);
    // Any other world opened as the arena: Node's arenaOfWorld.
    if (ball){
      const want = (await arenaOfFile(ball)).r;
      await s.send('DOM.setFileInputFiles', { nodeId, files: [ball] });
      await s.waitFor(`__destroy.built && __destroy.built.opened && __destroy.built.opened.name === 'ball.vdag'`, { timeout: 60000, label: 'the ball opened as the arena' });
      const got = await s.evaluate(`(() => { const A = __destroy.arena; return { hash: (${HASH})(A.cells), count: A.count, size: [A.X, A.Y, A.Z], saved: __destroy.built.opened.saved }; })()`);
      assert.equal(got.saved, false);
      assert.deepEqual(got.size, [want.A.X, want.A.Y, want.A.Z]);
      assert.equal(got.count, want.A.count);
      assert.equal(got.hash, hashOf(want.A.cells), 'the ball as the arena is Node\'s');
    }
  } finally { rmSync(downloads, { recursive: true, force: true }); }
}
test('save a wrecked arena and open it again, through the real buttons', { skip, timeout: 240000 }, async () => {
  await saveAndOpen(browser.session, dir && join(dir, 'ball.vdag'));
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
const SAVE_MUTANTS = [
  ['saved with debris in flight', 'if (!p || p.started || !A || streaming || D.bodies.length) return;', 'if (!p || p.started || !A || streaming) return;'],
  ['the save never retried', '  if (A) remesh(streaming ? 10 : 5);\n  trySave();\n', '  if (A) remesh(streaming ? 10 : 5);\n'],
  ['no view saved', 'view: { eye: cam.eye.slice(), yaw: cam.yaw, pitch: cam.pitch } } }, [cells.buffer]);', 'view: null } }, [cells.buffer]);'],
  ['the save button unwired', "$('saveArena').onclick = () => saveArena().catch(() => {});\n", ''],
  ['opened empty', 'A = createArena(o.X, o.Y, o.Z, o.cells);', 'A = createArena(o.X, o.Y, o.Z);'],
  ['old debris kept', "    D = createDebris(); projectiles.length = 0; particles.length = 0; lights.length = 0;\n    dropMeshes();\n    streaming = null;", "    projectiles.length = 0; particles.length = 0; lights.length = 0;\n    dropMeshes();\n    streaming = null;"],
  ['the old mass kept', '    total = A.count;\n    shadow.mat = shadowMatrix(); shadow.dirty = true;\n    // The file\'s view', '    shadow.mat = shadowMatrix(); shadow.dirty = true;\n    // The file\'s view'],
  ['the walker at the edge', 'const v = viewInArena(o.view, o), eye', 'const v = null, eye'],
  ['any view trusted', 'const v = viewInArena(o.view, o), eye', 'const v = o.view, eye'],
];
test('every mutant of the save and open is caught', { skip, timeout: 600000 }, async t => {
  const src = readFileSync(join(REPO_ROOT, PAGE), 'utf8'), s = browser.session;
  for (const [k, [name, from, to]] of SAVE_MUTANTS.entries()){
    assert.equal(src.split(from).length, 2, `mutant ${name}: its text must occur exactly once in the page`);
    const file = join(REPO_ROOT, 'destroy', `mutant-destroy-save-${k}.html`);
    try {
      writeFileSync(file, src.replace(from, to));
      await s.send('Page.navigate', { url: `${server.origin}/destroy/mutant-destroy-save-${k}.html?test=1` });
      let caught = null;
      try {
        await s.waitFor('window.__destroy && window.__destroy.ready === true', { timeout: 20000 });
        await saveAndOpen(s, null);
      } catch (e){ caught = e.message; }
      assert.ok(caught, `mutant ${name} survived`);
      t.diagnostic(`mutant ${name}: ${String(caught).split('\n')[0]}`);
    } finally { rmSync(file, { force: true }); }
  }
  errors.length = 0;
});
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
