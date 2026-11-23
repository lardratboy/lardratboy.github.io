/* ================== THE CODE ON SCREEN (pure) ===========================
   The film's code panels show the repo's own source, read when the page
   loads (fetch, in main.js) or from disk (check.mjs), never a copy pasted
   into the film. A snippet is named by an anchor: a piece of one line that
   occurs exactly once in its file. The panel starts `from` lines after that
   line (negative is before it) and shows `n` lines, with the file's own
   line numbers. A highlight names a substring of one of those lines.

   So a change to the code moves the panel with it, and a change that
   removes an anchor or a highlighted substring makes `node
   renderanim/check.mjs` fail rather than the film showing something stale.
   ======================================================================== */

export const FILES = ['stream-viewer.html', 'stream-core.js', 'stream-pool.js', 'chunk-worker.js',
                      'chunk-core.js', 'chunk-glsl.js', 'job-core.js', 'dag-core.js'];

export const SNIPS = {
  worldSnapshot: { file: 'stream-core.js', at: 'export function worldSnapshot(store, root, D', n: 9, title: 'worldSnapshot' },
  setWorld:      { file: 'stream-pool.js', at: '  setWorld(snap, revision){', n: 13, title: 'StreamPool: setWorld' },
  workerWorld:   { file: 'chunk-worker.js', at: 'self.onmessage = ({ data }) => {', n: 6, title: 'chunk-worker.js' },
  store:         { file: 'dag-core.js', at: 'const child = (id, o) => nodes.keys', from: -1, n: 2, title: 'createStore' },
  nodeAt:        { file: 'chunk-core.js', at: 'export function nodeAt(store, root, D, level, X, Y, Z){', n: 13, title: 'nodeAt, chunkNode' },
  select:        { file: 'stream-core.js', at: '  let count = 1;', from: 1, n: 17, title: 'selectChunks' },
  tile:          { file: 'stream-core.js', at: '  const tile = c => {', n: 10, title: 'coverOf' },
  nextJob:       { file: 'stream-core.js', at: '    for (const c of S.queue){', n: 14, title: 'streamer.nextJob' },
  dispatch:      { file: 'stream-pool.js', at: '      slot.job = job;', from: -3, n: 13, title: 'StreamPool.dispatch' },
  runner:        { file: 'stream-core.js', at: '  const run = job => {', n: 21, title: 'createJobRunner: run' },
  walk:          { file: 'chunk-core.js', at: 'function walk(ctx, id, k, X0, Y0, Z0, index, pose){', n: 17, title: 'chunk-core: walk' },
  aprons:        { file: 'chunk-core.js', at: "  if (border === 'apron' && n > 0){", n: 11, title: 'expandChunk: the aprons' },
  masks:         { file: 'chunk-core.js', at: '    const m = (grid[g + 1] ? 0 : 1)  | (grid[g - 1] ? 0 : 2)', from: -3, n: 21, title: 'expandChunk: face masks' },
  pack:          { file: 'chunk-core.js', at: 'export const packRecord', from: -1, n: 5, title: 'the record' },
  cellAttr:      { file: 'chunk-core.js', at: 'export function cellAttr(', n: 14, title: 'cellAttr' },
  transfer:      { file: 'chunk-worker.js', at: '    const result = runner(data);', n: 8, title: 'chunk-worker.js: the reply' },
  finish:        { file: 'stream-pool.js', at: '  _finish(slot, msg){', n: 8, title: 'StreamPool._finish' },
  complete:      { file: 'stream-core.js', at: '  function complete(job, result){', n: 12, title: 'streamer.complete' },
  service:       { file: 'stream-core.js', at: '    while (S.results.length && accepted < cfg.maxInstalls){', from: -1, n: 11, title: 'streamer.service' },
  installItem:   { file: 'stream-core.js', at: '    entry.gpu = install(entry);', from: -5, n: 7, title: 'streamer: installItem' },
  install:       { file: 'stream-viewer.html', at: '  // Records, then their words: one buffer, two integer attributes.', from: -1, n: 20, title: 'install(entry)' },
  cubeIndex:     { file: 'stream-viewer.html', at: 'const CUBE_TRIS = 36, CUBE_LINES = 60;', n: 14, title: 'the cube index' },
  faceOff:       { file: 'stream-viewer.html', at: 'const FACE_OFF = [', n: 4, title: 'FACE_OFF: 24 corners' },
  drawList:      { file: 'stream-viewer.html', at: '    list.push({ d, e, ...q, dist: Math.hypot(', from: -5, n: 8, title: 'renderView: the list' },
  drawCall:      { file: 'stream-viewer.html', at: '      gl.uniform3f(U.uOrigin, origin[0], origin[1], origin[2]);', from: -15, n: 25, title: 'renderView: one draw a chunk' },
  rasterVS:      { file: 'stream-viewer.html', at: '  vInst = gl_InstanceID;', from: -1, n: 15, title: 'rasterVS (GLSL)' },
  decode:        { file: 'chunk-glsl.js', at: 'uvec3 mortonDecode(uint i){', n: 22, title: 'GLSL_DECODE' },
  shadeOut:      { file: 'stream-viewer.html', at: 'vec4 shadeOut(vec3 base, vec3 normal, vec3 rel){', from: -4, n: 16, title: 'GLSL_SHADE' },
  fsMain:        { file: 'stream-viewer.html', at: '            : uColorMode == 8 ? attrColour(vAttr) : vec3(0.75);', from: -6, n: 9, title: 'the raster FS' },
  frame:         { file: 'stream-viewer.html', at: 'function frame({ draw: doDraw = true } = {}){', n: 12, title: 'frame()' },
  seamDraw:      { file: 'stream-viewer.html', at: '      const open = state.seams ? d.open : 0, n = open ? e.total : e.count;', n: 1, title: 'renderView' },
  recShown:      { file: 'chunk-glsl.js', at: 'uint  boundaryBits(uvec3 c){', n: 6, title: 'GLSL_DECODE: the open sides' },
};

/* texts: { file: string }, why: { file: reason it didn't load }. Returns
   { file: lines[] }, the reasons kept under WHY for snippet's error. */
const WHY = Symbol('why');
export const indexSources = (texts, why = {}) =>
  Object.assign(Object.fromEntries(Object.entries(texts).map(([f, s]) => [f, s.split('\n')])), { [WHY]: why });

/* A snippet: { name, file, title, line (1-based, of its first line), lines,
   hl(sub) → index of the first line holding sub, or -1 } or { error }. */
export function snippet(src, name){
  const spec = SNIPS[name];
  if (!spec) return { error: `no snippet '${name}'` };
  const lines = src && src[spec.file];
  if (!lines){
    const reason = src && src[WHY] && src[WHY][spec.file];
    return { error: `${spec.file} not loaded` + (reason ? `: ${reason}` : '') };
  }
  const at = [];
  lines.forEach((l, i) => { if (l.includes(spec.at)) at.push(i); });
  if (at.length !== 1) return { error: `${spec.file}: anchor found ${at.length} times: ${spec.at}` };
  const start = at[0] + (spec.from || 0), body = lines.slice(start, start + spec.n);
  const lo = Math.min(...body.filter(l => l.trim()).map(l => l.match(/^ */)[0].length));
  const shown = body.map(l => l.slice(lo));
  return { name, file: spec.file, title: spec.title, line: start + 1, lines: shown,
           hl: sub => shown.findIndex(l => l.includes(sub)) };
}
