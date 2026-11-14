/* The 2D overlay: labels pinned to 3D points, glass panels, bit diagrams.
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
