/* The 2D overlay: labels pinned to 3D points, glass panels, bit diagrams
   (animation/ui.js's), and the render film's own: code panels of the repo's
   source, the pipeline map, cards for JS objects and strips for typed arrays.
   Everything is drawn into one canvas over the GL one, in CSS pixels, every
   frame, as a function of the scene's time, so scrubbing is exact. */

export const FONT = '"Inter", "SF Pro Text", system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO = '"JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace';

export const INK = '#e9eefb', DIM = '#97a3bf', FAINT = '#5d6884';
export const ACCENT = '#5ad1ff', PINK = '#ff6fae', GOLD = '#ffd166', GREEN = '#8fe388', RED = '#ff6b7d', VIOLET = '#b69cff';
export const LEVEL = { 5: '#ff7a90', 4: '#ffa25c', 3: '#ffd166', 2: '#8fe388', 1: '#5ad1ff', 0: '#b69cff' };
export const LOD = ['#5ad1ff', '#8fe388', '#ffd166', '#ffa25c', '#ff7a90', '#c58bff'];

export const fmt = n => Math.round(n).toLocaleString('en-US');
export const rgb01 = hex => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];
export const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${a})`;

export function text(g, s, x, y, { size = 14, weight = 500, color = INK, align = 'left', base = 'alphabetic', alpha = 1, mono = false, shadow = true, track = 0 } = {}){
  if (alpha <= 0.003) return 0;
  g.save();
  g.globalAlpha = Math.min(1, alpha);
  g.font = `${weight} ${size}px ${mono ? MONO : FONT}`;
  g.textAlign = align; g.textBaseline = base;
  if (track) g.letterSpacing = `${track}px`;
  if (shadow){ g.shadowColor = 'rgba(0,0,0,0.65)'; g.shadowBlur = 8; g.shadowOffsetY = 1; }
  g.fillStyle = color;
  g.fillText(s, x, y);
  const w = g.measureText(s).width;
  g.restore();
  return w;
}
export function measure(g, s, { size = 14, weight = 500, mono = false } = {}){
  g.save(); g.font = `${weight} ${size}px ${mono ? MONO : FONT}`; const w = g.measureText(s).width; g.restore(); return w;
}
function rrect(g, x, y, w, h, r){
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
export function panel(g, x, y, w, h, { alpha = 1, r = 14, stroke = 'rgba(140, 190, 255, 0.16)', fill = 'rgba(12, 16, 26, 0.74)' } = {}){
  if (alpha <= 0.003) return;
  g.save(); g.globalAlpha = Math.min(1, alpha);
  g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 24; g.shadowOffsetY = 6;
  rrect(g, x, y, w, h, r); g.fillStyle = fill; g.fill();
  g.shadowColor = 'transparent';
  g.lineWidth = 1; g.strokeStyle = stroke; g.stroke();
  g.restore();
}
export function pill(g, s, x, y, { size = 12, color = INK, bg = 'rgba(12,16,26,0.78)', border = 'rgba(140,190,255,0.22)', alpha = 1, mono = false, align = 'center', weight = 600 } = {}){
  if (alpha <= 0.003) return;
  const w = measure(g, s, { size, mono, weight }) + size * 1.3, h = size * 1.9;
  const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  g.save(); g.globalAlpha = Math.min(1, alpha);
  rrect(g, x0, y - h / 2, w, h, h / 2); g.fillStyle = bg; g.fill(); g.strokeStyle = border; g.lineWidth = 1; g.stroke();
  g.restore();
  text(g, s, x0 + w / 2, y + 0.5, { size, color, align: 'center', base: 'middle', alpha, mono, weight, shadow: false });
}
// A label at a 3D point, with an optional leader from the point.
export function label3(F, g, p, s, { dx = 0, dy = 0, alpha = 1, dot = false, color = INK, ...o } = {}){
  const q = F.project(p);
  if (!q || alpha <= 0.003) return null;
  const x = q[0] / F.view.dpr, y = q[1] / F.view.dpr;
  if (dot || dx || dy){
    g.save(); g.globalAlpha = alpha * 0.8; g.strokeStyle = color; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + dx, y + dy); g.stroke();
    g.fillStyle = color; g.beginPath(); g.arc(x, y, 2.5, 0, Math.PI * 2); g.fill();
    g.restore();
  }
  pill(g, s, x + dx, y + dy, { alpha, color, ...o });
  return [x, y];
}
export function screenOf(F, p){
  const q = F.project(p);
  return q ? [q[0] / F.view.dpr, q[1] / F.view.dpr] : null;
}

/* A 32-bit word, most significant bit first, in coloured fields:
   fields = [{ name, at, len, color }], value a uint32. */
export function bits(g, x, y, value, fields, { cell = 15, gap = 2, alpha = 1, reveal = 1, highlight = -1 } = {}){
  if (alpha <= 0.003) return;
  const fieldOf = b => fields.find(f => b >= f.at && b < f.at + f.len);
  g.save(); g.globalAlpha = alpha;
  const W = cell + gap;
  for (let i = 0; i < 32; i++){
    const b = 31 - i, f = fieldOf(b), on = value >>> b & 1;
    const shown = Math.min(1, Math.max(0, reveal * 40 - i * 0.25));
    if (shown <= 0) continue;
    const cx = x + i * W + (f ? 0 : 0);
    g.globalAlpha = alpha * shown;
    rrect(g, cx, y, cell, cell * 1.35, 3);
    const col = f ? f.color : '#3a4258';
    g.fillStyle = on ? col : 'rgba(255,255,255,0.04)'; g.fill();
    g.strokeStyle = f ? col : '#3a4258'; g.lineWidth = f && fields.indexOf(f) === highlight ? 2 : 1; g.stroke();
    g.font = `600 ${cell * 0.62}px ${MONO}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = on ? '#0b0f18' : 'rgba(233,238,251,0.45)';
    g.fillText(on ? '1' : '0', cx + cell / 2, y + cell * 0.7);
  }
  g.globalAlpha = alpha;
  for (const f of fields){
    const i0 = 31 - (f.at + f.len - 1), i1 = 31 - f.at;
    const x0 = x + i0 * W, x1 = x + i1 * W + cell;
    g.strokeStyle = f.color; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x0, y + cell * 1.35 + 6); g.lineTo(x0, y + cell * 1.35 + 10); g.lineTo(x1, y + cell * 1.35 + 10); g.lineTo(x1, y + cell * 1.35 + 6); g.stroke();
    if (f.name) text(g, f.name, (x0 + x1) / 2, y + cell * 1.35 + 26, { size: 11.5, weight: 600, color: f.color, align: 'center', shadow: false, alpha });
    if (f.sub) text(g, f.sub, (x0 + x1) / 2, y + cell * 1.35 + 42, { size: 11, weight: 500, color: DIM, align: 'center', shadow: false, alpha, mono: true });
  }
  g.restore();
  return 32 * W - gap;
}

// A small table of rows [label, value, color], right-aligned values.
export function table(g, x, y, w, rows, { alpha = 1, size = 13, line = 22, title = null } = {}){
  if (alpha <= 0.003) return y;
  if (title){ text(g, title, x, y, { size: 11, weight: 700, color: DIM, alpha, track: 1.2, shadow: false }); y += line; }
  for (const r of rows){
    const [l, v, c = INK, a = 1] = r;
    if (a <= 0.003){ y += line; continue; }
    if (c && r.swatch !== false){ g.save(); g.globalAlpha = alpha * a; g.fillStyle = c; g.beginPath(); g.arc(x + 4, y - size * 0.35, 4, 0, Math.PI * 2); g.fill(); g.restore(); }
    text(g, l, x + 16, y, { size, weight: 500, color: DIM, alpha: alpha * a, shadow: false });
    text(g, v, x + w, y, { size, weight: 650, color: c || INK, alpha: alpha * a, align: 'right', mono: true, shadow: false });
    y += line;
  }
  return y;
}

/* ---- the render film's pieces ------------------------------------------------ */
export const MAIN = ACCENT, WORKER = GREEN, GPU = PINK;
export const LANES = [
  { name: 'MAIN THREAD', color: MAIN },
  { name: 'WORKERS ×4', color: WORKER },
  { name: 'GPU', color: GPU },
];

export function roundRect(g, x, y, w, h, r){ rrect(g, x, y, w, h, r); }

export function arrow(g, x0, y0, x1, y1, { color = INK, alpha = 1, w = 1.5, head = 7, dash = null, bend = 0 } = {}){
  if (alpha <= 0.003) return;
  g.save(); g.globalAlpha = Math.min(1, alpha); g.strokeStyle = color; g.fillStyle = color; g.lineWidth = w;
  if (dash) g.setLineDash(dash);
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const cx = mx - dy / L * bend, cy = my + dx / L * bend;
  g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(cx, cy, x1, y1); g.stroke();
  g.setLineDash([]);
  const ax = x1 - cx, ay = y1 - cy, al = Math.hypot(ax, ay) || 1, ux = ax / al, uy = ay / al;
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - ux * head - uy * head * 0.55, y1 - uy * head + ux * head * 0.55);
  g.lineTo(x1 - ux * head + uy * head * 0.55, y1 - uy * head - ux * head * 0.55); g.closePath(); g.fill();
  g.restore();
}
// A point along the same curve, for a packet travelling it.
export function along(x0, y0, x1, y1, u, bend = 0){
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2, dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy) || 1;
  const cx = mx - dy / L * bend, cy = my + dx / L * bend, v = 1 - u;
  return [v * v * x0 + 2 * v * u * cx + u * u * x1, v * v * y0 + 2 * v * u * cy + u * u * y1];
}
export function dot2(g, x, y, r, color, alpha = 1, glow = 0){
  if (alpha <= 0.003) return;
  g.save(); g.globalAlpha = Math.min(1, alpha); g.fillStyle = color;
  if (glow){ g.shadowColor = color; g.shadowBlur = glow; }
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.restore();
}

/* A code panel: a snippet from code.js's `snippet`, its file and first line in
   the header, its lines numbered as in the file and coloured by a small
   tokenizer, wrapped to the panel. `hl` is a line index (a float eases the
   bar between lines) and `span` how many lines it covers. Returns the
   panel's height. */
const KW = new Set(('const let var function return if else for of in new while break continue throw try catch finally typeof ' +
  'class this null true false undefined export import from await async yield ' +
  'uniform in out flat layout precision highp mediump int uint float bool void vec2 vec3 vec4 uvec3 ivec2 mat4 const').split(' '));
const TYPES = new Set('Uint32Array Uint8Array Float64Array Int32Array Map Set Math'.split(' '));
function tokens(line){
  const out = [], re = /(\/\/.*$|\/\*.*?(\*\/|$)|^\s*\*.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`?)|(\b0x[0-9a-fA-F]+u?\b|\b\d+(?:\.\d+)?(?:e-?\d+)?u?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d'"`]+)/g;
  let m;
  while ((m = re.exec(line))){
    const [t] = m;
    let c = '#c8d0e4';
    if (m[1]) c = '#6f7b98';
    else if (m[3]) c = '#ffd166';
    else if (m[4]) c = '#c9a8ff';
    else if (m[5]){
      if (KW.has(t)) c = '#ff8fbf';
      else if (TYPES.has(t)) c = '#7fe0c2';
      else if (line[re.lastIndex] === '(') c = '#7cd6ff';
      else if (t === 'gl' || /^[A-Z][A-Z_0-9]+$/.test(t)) c = '#9fe39a';
    } else if (m[7]) c = '#9aa6c2';
    out.push([t, c]);
    if (!t.length) re.lastIndex++;
  }
  return out;
}
export function codePanel(g, snip, x, y, w, { alpha = 1, hl = null, span = 1, size = 12, maxLines = 30, note = null } = {}){
  if (alpha <= 0.003 || !snip) return 0;
  if (snip.error){
    panel(g, x, y, w, 46, { alpha });
    text(g, snip.error, x + 14, y + 28, { size: 11.5, color: RED, alpha, mono: true, shadow: false });
    return 46;
  }
  const lh = Math.round(size * 1.42), gut = 44, pad = 14, top = 34;
  g.save(); g.font = `500 ${size}px ${MONO}`; const cw = g.measureText('M').width; g.restore();
  const cols = Math.max(20, Math.floor((w - gut - pad) / cw));
  // Wrap: a continuation keeps the line's indent plus two.
  const vis = [];
  snip.lines.forEach((l, i) => {
    if (l.length <= cols){ vis.push({ i, s: l, first: true }); return; }
    const ind = l.match(/^ */)[0].length + 2;
    let rest = l, first = true;
    while (rest.length){
      const room = first ? cols : cols - ind;
      let cut = rest.length <= room ? rest.length : rest.lastIndexOf(' ', room);
      if (cut <= room * 0.5) cut = Math.min(room, rest.length);
      vis.push({ i, s: (first ? '' : ' '.repeat(ind)) + rest.slice(0, cut), first });
      rest = rest.slice(cut).replace(/^ /, ''); first = false;
    }
  });
  const shown = vis.slice(0, maxLines), h = top + shown.length * lh + 12;
  panel(g, x, y, w, h, { alpha, fill: 'rgba(9, 12, 20, 0.86)' });
  g.save(); g.globalAlpha = alpha;
  text(g, snip.file + ':' + snip.line, x + pad, y + 21, { size: 11, weight: 600, color: DIM, mono: true, shadow: false });
  text(g, note || snip.title, x + w - pad, y + 21, { size: 11, weight: 700, color: ACCENT, align: 'right', shadow: false, track: 0.4 });
  g.strokeStyle = 'rgba(140,190,255,0.12)'; g.beginPath(); g.moveTo(x, y + top - 4); g.lineTo(x + w, y + top - 4); g.stroke();
  // The highlight bar: from the first visual row of line ⌊hl⌋ to the last of ⌊hl⌋ + span − 1, eased between.
  if (hl !== null && hl >= 0){
    const rowOf = (li, last) => { let r = -1; shown.forEach((v, k) => { if (v.i === li && (r < 0 || last)) r = k; }); return r; };
    const a = Math.floor(hl), f = hl - a;
    const r0a = rowOf(a, false), r1a = rowOf(a + span - 1, true), r0b = rowOf(a + 1, false), r1b = rowOf(a + span, true);
    let r0 = r0a, r1 = r1a;
    if (f > 0 && r0b >= 0){ r0 = r0a + (r0b - r0a) * f; r1 = r1a + ((r1b >= 0 ? r1b : r0b) - r1a) * f; }
    if (r0 >= 0){
      g.fillStyle = 'rgba(90, 209, 255, 0.13)';
      rrect(g, x + 4, y + top + r0 * lh - 2, w - 8, (r1 - r0 + 1) * lh + 2, 5); g.fill();
      g.fillStyle = ACCENT; g.fillRect(x + 4, y + top + r0 * lh - 1, 2.5, (r1 - r0 + 1) * lh);
    }
  }
  shown.forEach((v, k) => {
    const yy = y + top + k * lh + lh * 0.72;
    if (v.first) text(g, String(snip.line + v.i), x + gut - 10, yy, { size: size - 1, color: FAINT, align: 'right', mono: true, shadow: false, alpha });
    let xx = x + gut;
    g.font = `500 ${size}px ${MONO}`; g.textBaseline = 'alphabetic';
    for (const [t, c] of tokens(v.s)){ g.fillStyle = c; g.fillText(t, xx, yy); xx += cw * t.length; }
  });
  g.restore();
  return h;
}

/* A card: a JS object as its fields, `rows` = [[key, value, color?], ...]. */
export function card(g, x, y, w, title, rows, { alpha = 1, color = ACCENT, size = 12.5, line = 20, sub = null } = {}){
  if (alpha <= 0.003) return 0;
  const h = 40 + rows.length * line + (sub ? 16 : 0);
  panel(g, x, y, w, h, { alpha, stroke: css(rgb01(color), 0.35) });
  text(g, title, x + 14, y + 23, { size: 12.5, weight: 700, color, alpha, mono: true, shadow: false });
  if (sub) text(g, sub, x + 14, y + 40, { size: 11, weight: 500, color: DIM, alpha, shadow: false });
  rows.forEach(([k, v, c], i) => {
    const yy = y + (sub ? 56 : 44) + i * line + line * 0.55;
    text(g, k, x + 14, yy, { size, weight: 500, color: DIM, alpha, mono: true, shadow: false });
    text(g, String(v), x + w - 14, yy, { size, weight: 600, color: c || INK, alpha, mono: true, align: 'right', shadow: false });
  });
  return h;
}

/* A typed array as a strip of cells: `n` cells shown of `total`, each coloured
   by colorOf(i), with a label above and a byte count. */
export function strip(g, x, y, w, h, { n, total = n, colorOf, label = '', right = '', alpha = 1, gap = 1, fill = 1 } = {}){
  if (alpha <= 0.003) return;
  const cw = (w - gap * (n - 1)) / n;
  g.save(); g.globalAlpha = Math.min(1, alpha);
  const k = Math.min(n, Math.ceil(n * fill));
  for (let i = 0; i < k; i++){ g.fillStyle = colorOf(i); g.fillRect(x + i * (cw + gap), y, Math.max(0.6, cw), h); }
  g.strokeStyle = 'rgba(140,190,255,0.25)'; g.lineWidth = 1; g.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  g.restore();
  if (label) text(g, label, x, y - 8, { size: 11.5, weight: 650, color: INK, alpha, mono: true, shadow: false });
  if (right) text(g, right, x + w, y - 8, { size: 11.5, weight: 600, color: DIM, alpha, mono: true, align: 'right', shadow: false });
}

/* ---- the pipeline map ------------------------------------------------------------
   Every stage of a chunk's road, in its lane (main thread, workers, GPU),
   left to right. Drawn big in the first and last chapters and small at the
   top of every other, with the chapter's stage lit. */
export const STAGES = [
  { key: 'dag',       lane: 0, label: 'the DAG',          fn: 'store, root, D' },
  { key: 'snapshot',  lane: 0, label: 'snapshot',         fn: 'worldSnapshot · setWorld' },
  { key: 'cut',       lane: 0, label: 'the cut',          fn: 'selectChunks · coverOf' },
  { key: 'job',       lane: 0, label: 'a job',            fn: 'nextJob · postMessage' },
  { key: 'expand',    lane: 1, label: 'expand',           fn: 'runner · fastChunk' },
  { key: 'reply',     lane: 1, label: 'reply',            fn: 'postMessage · transfer' },
  { key: 'admit',     lane: 0, label: 'admit',            fn: 'complete · service' },
  { key: 'install',   lane: 0, label: 'install',          fn: 'bufferData · VAO' },
  { key: 'draw',      lane: 0, label: 'draw',             fn: 'renderView · drawElements­Instanced' },
  { key: 'vertex',    lane: 2, label: 'vertex',           fn: 'GLSL_DECODE' },
  { key: 'fragment',  lane: 2, label: 'fragment',         fn: 'attrColour · shadeOut' },
];
export function drawMap(g, x, y, w, { active = null, alpha = 1, reveal = 1, big = false, packet = -1, lit = null } = {}){
  if (alpha <= 0.003) return 0;
  if (big && w < 600) return drawMapList(g, x, y, w, { active, alpha, reveal, packet, lit });
  const laneH = big ? 78 : 22, top = big ? 34 : 0, labelW = big ? 120 : 0;
  const n = STAGES.length, colW = (w - labelW) / n, h = top + 3 * laneH;
  const pos = i => [x + labelW + colW * (i + 0.5), y + top + laneH * (STAGES[i].lane + 0.5)];
  g.save(); g.globalAlpha = Math.min(1, alpha);
  if (big){
    LANES.forEach((L, k) => {
      const yy = y + top + k * laneH;
      g.fillStyle = css(rgb01(L.color), 0.06); g.fillRect(x, yy + 2, w, laneH - 4);
      text(g, L.name, x + 10, yy + laneH / 2 + 4, { size: 10.5, weight: 800, color: L.color, track: 1.3, shadow: false, alpha });
    });
  } else {
    g.fillStyle = 'rgba(9, 12, 20, 0.55)'; rrect(g, x - 8, y - 5, w + 16, h + 10, 9); g.fill();
  }
  // The road: stage to stage.
  for (let i = 0; i + 1 < n; i++){
    const u = Math.min(1, Math.max(0, reveal * n - i - 0.5));
    if (u <= 0) continue;
    const [x0, y0] = pos(i), [x1, y1] = pos(i + 1);
    g.strokeStyle = 'rgba(180, 200, 240, 0.35)'; g.lineWidth = big ? 1.6 : 1;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + (x1 - x0) * u, y0 + (y1 - y0) * u); g.stroke();
  }
  STAGES.forEach((s, i) => {
    const u = Math.min(1, Math.max(0, reveal * n - i));
    if (u <= 0) return;
    const [cx, cy] = pos(i), col = LANES[s.lane].color, on = active === s.key || (lit && lit.has(s.key));
    const r = big ? 7 : 4;
    dot2(g, cx, cy, on ? r + 1.5 : r, col, u * (on || big || !active ? 1 : 0.4), on ? 14 : 0);
    if (big){
      text(g, s.label, cx, cy - 15, { size: 12.5, weight: 700, color: on || !active ? INK : DIM, align: 'center', alpha: u, shadow: false });
      // The functions, one a line; a soft hyphen breaks a long name.
      const parts = s.fn.split(' · ').flatMap(p => p.includes('\u00ad') ? [p.split('\u00ad')[0] + '-', p.split('\u00ad')[1]] : [p]);
      parts.forEach((p, k) => text(g, p, cx, cy + 22 + 12 * k, { size: 10, weight: 500, color: on || !active ? col : FAINT, align: 'center', alpha: u, mono: true, shadow: false }));
    } else if (on){
      text(g, s.label, cx, y + h + 14, { size: 10.5, weight: 700, color: col, align: 'center', alpha: u, shadow: false });
    }
  });
  if (packet >= 0 && packet <= n - 1){
    const i = Math.min(n - 2, Math.floor(packet)), f = packet - i, [x0, y0] = pos(i), [x1, y1] = pos(i + 1);
    dot2(g, x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, big ? 5 : 3, GOLD, 1, 16);
  }
  g.restore();
  return h;
}
/* The same map for a narrow screen: one stage a row, its lane by colour. */
function drawMapList(g, x, y, w, { active, alpha, reveal, packet, lit }){
  const row = 27, n = STAGES.length;
  panel(g, x - 6, y - 8, w + 12, n * row + 34, { alpha: alpha * 0.9 });
  LANES.forEach((L, k) => text(g, L.name, x + 8 + k * (w / 3), y + 12, { size: 9.5, weight: 800, color: L.color, track: 1, shadow: false, alpha }));
  STAGES.forEach((s, i) => {
    const u = Math.min(1, Math.max(0, reveal * n - i)), yy = y + 38 + i * row, col = LANES[s.lane].color;
    const on = active === s.key || (lit && lit.has(s.key)) || Math.round(packet) === i;
    if (u <= 0) return;
    const dx = x + 14 + s.lane * 16;
    dot2(g, dx, yy - 4, on ? 6 : 4.5, col, alpha * u, on ? 12 : 0);
    text(g, s.label, x + 70, yy, { size: 12, weight: 700, color: INK, alpha: alpha * u, shadow: false });
    let fn = s.fn.replace('\u00ad', '');
    if (measure(g, fn, { size: 10, mono: true }) > w - 150) fn = fn.split(' · ').pop();
    text(g, fn, x + w - 6, yy, { size: 10, weight: 500, color: col, alpha: alpha * u, mono: true, align: 'right', shadow: false });
  });
  return n * row + 34;
}
export const mapPos = (x, y, w, i, big = true) => {
  const laneH = big ? 78 : 22, top = big ? 34 : 0, labelW = big ? 120 : 0, colW = (w - labelW) / STAGES.length;
  return [x + labelW + colW * (i + 0.5), y + top + laneH * (STAGES[i].lane + 0.5)];
};
