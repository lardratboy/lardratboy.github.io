/* pad-core.js: a gamepad, read as the stream viewer's fly camera wants it.
   Pure: no DOM, no imports. The page polls navigator.getGamepads() once a
   frame and hands the pad here; everything that decides what a stick or a
   button does lives in this file, so test/pad-core.test.js can hold it
   with fake pads.

   The layout is the Gamepad API's "standard" mapping (an Xbox or
   PlayStation pad in Chrome and Safari), the same on both:

     left stick     move: forward/back, strafe (WASD)
     right stick    look: yaw, pitch (the arrows, or a drag)
     RT / LT        up / down, analog (E / Q)
     A (cross), L3  hold: ×4 (shift)
     RB / LB        speed ×2 / ÷2 (the wheel)
     Y (triangle)   freeze the cut (F)

   A pad without the standard mapping still gets its axes 0–3 as the two
   sticks (the usual order); its buttons are anyone's guess, so they're
   read the same way and may land elsewhere.

   Sticks rest a little off centre (0.05–0.1 on worn pads), so a radial
   dead zone drops everything inside DEAD, rescales the rest to start at 0,
   and squares the magnitude: half a push is a quarter speed, which is what
   lets a stick creep up on a specimen and still cross a 4,096³ world. A
   radial zone, not one per axis, so a diagonal push isn't snapped to an
   axis. */

export const PAD = {
  DEAD: 0.15,           // sticks: radial dead zone
  TRIGGER_DEAD: 0.05,   // triggers rest at 0 but read a hair above on some pads
  YAW: 0.0022,          // rad / ms at full deflection (the arrows turn at 0.0015)
  PITCH: 0.0016,        // rad / ms (the arrows: 0.0012)
};
// Standard-mapping button indices.
export const BUTTON = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, L3: 10, R3: 11 };

// One stick through the radial dead zone and the square response.
export function stick(x, y, dead = PAD.DEAD){
  const m = Math.hypot(x, y);
  if (!(m > dead)) return [0, 0];                       // NaN (a missing axis) rests too
  const k = Math.min(1, (m - dead) / (1 - dead)), s = k * k / m;
  return [x * s, y * s];
}
const trigger = v => v > PAD.TRIGGER_DEAD ? (v - PAD.TRIGGER_DEAD) / (1 - PAD.TRIGGER_DEAD) : 0;

// The pad to fly with: the first connected one, standard mapping first.
export function pickPad(pads){
  let any = null;
  for (const p of pads || []){
    if (!p || p.connected === false) continue;
    if (p.mapping === 'standard') return p;
    any ??= p;
  }
  return any;
}

/* One frame's reading. `held` is last frame's buttons (the `held` this
   returned then), so presses are edges: a held RB doubles the speed once.
     move    [strafe right, forward, up], each in [−1, 1]
     look    [turn right, pitch up], each in [−1, 1], times PAD.YAW / PITCH a ms
     boost   ×4 held
     pressed the buttons that went down this frame, by name
     active  anything off rest (the page saves the view when this goes false) */
export function readPad(pad, held = []){
  const ax = i => +(pad.axes?.[i] ?? 0), btn = i => pad.buttons?.[i], down = i => { const b = btn(i); return !!b && (b.pressed || b.value > 0.5); };
  const value = i => { const b = btn(i); return b ? +(b.value ?? (b.pressed ? 1 : 0)) : 0; };
  const [sx, sy] = stick(ax(0), ax(1)), [lx, ly] = stick(ax(2), ax(3));
  const up = trigger(value(BUTTON.RT)) - trigger(value(BUTTON.LT));
  // The Gamepad API's y axes point down: a stick pushed away reads −1.
  const move = [sx, 0 - sy, up], look = [lx, 0 - ly];   // 0 − v, not −v: a resting stick reads 0, not −0
  const now = (pad.buttons || []).map((_, i) => down(i)), pressed = new Set();
  for (const [name, i] of Object.entries(BUTTON)) if (now[i] && !held[i]) pressed.add(name);
  const boost = !!(now[BUTTON.A] || now[BUTTON.L3]);
  const active = move.some(v => v !== 0) || look.some(v => v !== 0) || now.some(Boolean);
  return { move, look, boost, pressed, held: now, active };
}
