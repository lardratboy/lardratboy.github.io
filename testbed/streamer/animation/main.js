/* The timeline: one clock, the chapters laid end to end, and the controls.
   The clock is the only state; every frame is drawn from it, so seeking,
   stepping and scrubbing are exact. window.__anim is there for the console
   and for headless screenshots (seek, pause, frame). */
import { buildAll } from './data.js';
import { createRenderer } from './gl.js';
import { SCENES, prepare, prefetchList } from './scenes.js';

const $ = id => document.getElementById(id);
const glCanvas = $('gl'), uiCanvas = $('ui'), g = uiCanvas.getContext('2d');

let D, R, P;
try {
  D = buildAll();
  R = createRenderer(glCanvas);
  P = prepare(R, D);
} catch (e){
  $('loading').querySelector('.msg').textContent = 'Could not start: ' + e.message;
  throw e;
}

const starts = []; let total = 0;
for (const s of SCENES){ starts.push(total); total += s.dur; }
const sceneAt = T => { let i = 0; while (i < SCENES.length - 1 && T >= starts[i + 1]) i++; return i; };

const params = new URLSearchParams(location.search);
let T = 0, playing = !params.has('paused'), speed = 1, last = performance.now();
if (params.has('t')) T = Math.min(total - 0.01, Math.max(0, +params.get('t') || 0));
if (params.has('c')){ const i = SCENES.findIndex(s => s.key === params.get('c') || String(SCENES.indexOf(s) + 1) === params.get('c')); if (i >= 0) T = starts[i]; }

/* ---- background jobs ------------------------------------------------------------
   The world chapters need a few hundred chunk jobs (~5 ms each). They're made a
   few a frame from the start, so by the time the film gets there they're done. */
let queue = null;
function prefetch(budget){
  if (!queue) queue = prefetchList(P);
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < budget) D.jobs.job(queue.pop());
}

/* ---- the user's look-around ------------------------------------------------------- */
const look = { yaw: 0, pitch: 0, zoom: 0, held: false, idle: 0 };
let drag = null;
glCanvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; look.held = true; glCanvas.setPointerCapture(e.pointerId); });
glCanvas.addEventListener('pointermove', e => {
  if (!drag) return;
  look.yaw -= (e.clientX - drag.x) * 0.006; look.pitch += (e.clientY - drag.y) * 0.005;
  look.pitch = Math.max(-0.9, Math.min(0.9, look.pitch));
  drag = { x: e.clientX, y: e.clientY };
});
const release = () => { drag = null; look.held = false; look.idle = 0; };
glCanvas.addEventListener('pointerup', release); glCanvas.addEventListener('pointercancel', release);
glCanvas.addEventListener('wheel', e => { e.preventDefault(); look.zoom = Math.max(-1.5, Math.min(1.5, look.zoom + e.deltaY * 0.0015)); look.idle = 0; }, { passive: false });

/* ---- controls --------------------------------------------------------------------- */
const bar = $('scrub'), fill = $('fill'), knob = $('knob'), tip = $('tip');
SCENES.forEach((s, i) => {
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.style.left = (starts[i] / total * 100) + '%';
  seg.style.width = (s.dur / total * 100) + '%';
  bar.appendChild(seg);
  const li = document.createElement('li');
  li.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span><span>${s.title}</span><span class="d">${clock(s.dur)}</span>`;
  li.onclick = () => { seek(starts[i]); toggleMenu(false); };
  $('chapters').appendChild(li);
});
function clock(s){ s = Math.max(0, s); return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }
function seek(t){ T = Math.max(0, Math.min(total - 0.001, t)); look.yaw = look.pitch = look.zoom = 0; }
function setPlaying(p){ playing = p; if (playing && T >= total - 0.01) T = 0; $('play').dataset.state = playing ? 'playing' : 'paused'; $('play').setAttribute('aria-label', playing ? 'Pause' : 'Play'); }
function step(d){ const i = sceneAt(T); const into = T - starts[i]; seek(d < 0 && into > 1.2 ? starts[i] : starts[Math.max(0, Math.min(SCENES.length - 1, i + d))]); }
function toggleMenu(on){ $('menu').classList.toggle('open', on ?? !$('menu').classList.contains('open')); }
$('play').onclick = () => setPlaying(!playing);
$('prev').onclick = () => step(-1);
$('next').onclick = () => step(1);
$('speed').onclick = () => { speed = speed === 1 ? 1.5 : speed === 1.5 ? 2 : speed === 2 ? 0.5 : 1; $('speed').textContent = speed + '×'; };
$('menuBtn').onclick = () => toggleMenu();
$('full').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
let scrubbing = false;
const scrubTo = e => { const r = bar.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * total); };
bar.addEventListener('pointerdown', e => { scrubbing = true; bar.setPointerCapture(e.pointerId); scrubTo(e); });
bar.addEventListener('pointermove', e => {
  const r = bar.getBoundingClientRect(), u = (e.clientX - r.left) / r.width, t = u * total;
  tip.textContent = `${String(sceneAt(t) + 1).padStart(2, '0')} · ${SCENES[sceneAt(t)].title}  ${clock(t)}`;
  tip.style.left = Math.max(60, Math.min(r.width - 60, u * r.width)) + 'px';
  tip.classList.add('show');
  if (scrubbing) scrubTo(e);
});
bar.addEventListener('pointerleave', () => tip.classList.remove('show'));
bar.addEventListener('pointerup', () => { scrubbing = false; });
window.addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === ' ' || e.key === 'k'){ e.preventDefault(); setPlaying(!playing); }
  else if (e.key === 'ArrowRight'){ e.preventDefault(); e.shiftKey ? seek(T + 5) : step(1); }
  else if (e.key === 'ArrowLeft'){ e.preventDefault(); e.shiftKey ? seek(T - 5) : step(-1); }
  else if (e.key === 'Home') seek(0);
  else if (e.key === 'f') $('full').click();
  else if (e.key === 'h') document.body.classList.toggle('bare');
  else if (e.key === 'c') toggleMenu();
  else if (e.key === 'Escape') toggleMenu(false);
  else if (/^[1-9]$/.test(e.key)) seek(starts[Math.min(SCENES.length - 1, +e.key - 1)]);
});
let idleUI = 0;
window.addEventListener('pointermove', () => { idleUI = 0; document.body.classList.remove('idle'); });

/* ---- captions ---------------------------------------------------------------------- */
let capKey = '';
function caption(i, t){
  const s = SCENES[i];
  let body = s.steps[0][1];
  for (const [t0, b] of s.steps) if (t >= t0) body = b;
  const key = i + '|' + body;
  const cap = $('caption');
  if (key !== capKey){
    const chapterChanged = !capKey.startsWith(i + '|');
    capKey = key;
    $('kicker').textContent = `${String(i + 1).padStart(2, '0')} / ${SCENES.length}`;
    $('ctitle').textContent = s.title;
    const b = $('cbody');
    b.classList.remove('in'); void b.offsetWidth;
    b.innerHTML = body; b.classList.add('in');
    if (chapterChanged){ cap.classList.remove('in'); void cap.offsetWidth; cap.classList.add('in'); }
  }
  const out = Math.min(1, t / 0.5, (s.dur - t) / 0.45);
  cap.style.opacity = s.noCaption ? 0 : Math.max(0, out);
}

/* ---- the frame --------------------------------------------------------------------- */
const ENV0 = { ...R.env };
let frames = 0, fpsT = performance.now(), fps = 0;
function resize(){
  const dpr = Math.min(2, window.devicePixelRatio || 1), w = innerWidth, h = innerHeight;
  for (const c of [glCanvas, uiCanvas]){ c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px'; }
  return { dpr, w, h };
}
let size = resize();
window.addEventListener('resize', () => { size = resize(); });

function frame(now){
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (playing && !scrubbing){ T += dt * speed; if (T >= total){ T = total - 0.001; setPlaying(false); } }
  if (!look.held){ look.idle += dt; if (look.idle > 2.5){ const k = Math.exp(-dt * 1.2); look.yaw *= k; look.pitch *= k; look.zoom *= k; } }
  idleUI += dt; if (idleUI > 3 && playing) document.body.classList.add('idle');
  render();
  prefetch(playing ? 7 : 12);
  frames++; if (now - fpsT > 1000){ fps = frames * 1000 / (now - fpsT); frames = 0; fpsT = now; }
  requestAnimationFrame(frame);
}
function render(){
  const i = sceneAt(T), s = SCENES[i], t = T - starts[i];
  const { dpr, w, h } = size;
  const cam = s.cam.call(s, t, P);
  cam.yaw += look.yaw; cam.pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + look.pitch));
  if (cam.eye){
    // A camera with an eye (the fly-through) turns about the eye instead.
    const d = [cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], cam.target[2] - cam.eye[2]];
    const c = Math.cos(look.yaw), sn = Math.sin(look.yaw);
    cam.target = [cam.eye[0] + d[0] * c + d[2] * sn, cam.target[1] - look.pitch * 40, cam.eye[2] - d[0] * sn + d[2] * c];
    cam.yaw -= look.yaw; cam.pitch -= look.pitch;
  } else cam.dist *= Math.exp(look.zoom);
  Object.assign(R.env, ENV0, s.env ? s.env(t) : {});
  R.begin(cam, glCanvas.width, glCanvas.height, dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  s.draw.call(s, { F: R.F, g, t, W: w, H: h, P, D, dt: 0 });
  R.end();
  // a dip through black between chapters
  const edge = Math.min(i === 0 ? 1 : t / 0.4, i === SCENES.length - 1 ? 1 : (s.dur - t) / 0.4);
  const black = 1 - Math.max(0, Math.min(1, edge));
  if (i === 0 && t < 0.6) g.fillStyle = `rgba(4,5,9,${1 - t / 0.6})`, g.fillRect(0, 0, w, h);
  if (black > 0.001){ g.fillStyle = `rgba(4,5,9,${black})`; g.fillRect(0, 0, w, h); }
  caption(i, t);
  const u = T / total;
  fill.style.width = (u * 100) + '%'; knob.style.left = (u * 100) + '%';
  $('time').textContent = `${clock(T)} / ${clock(total)}`;
  $('now').textContent = `${String(i + 1).padStart(2, '0')} · ${s.title}`;
  [...$('chapters').children].forEach((li, k) => li.classList.toggle('on', k === i));
}

setPlaying(playing);
$('loading').classList.add('done');
requestAnimationFrame(t => { last = t; frame(t); });

window.__anim = {
  D, P, SCENES, starts, total,
  seek: t => { seek(t); render(); },
  pause: () => setPlaying(false), play: () => setPlaying(true),
  get T(){ return T; }, get fps(){ return fps; },
  get pending(){ return queue ? queue.length : -1; },
  drain: () => prefetch(1e9),
};
