/* camera-core.js: the stream viewer's mouse camera, as sol-v4's (2026-11-12,
   docs/camera.md). Pure, no imports, no DOM: every decision here is held by
   test/camera-core.test.js, and the page only hands it pointer deltas.

   sol-v4-tower-contact-sheet.html's PushThroughCamera orbits a target:
   left drag orbits, right drag (or shift and left) pans, middle drag and the
   wheel dolly, smoothed, and a dolly that would come nearer than a threshold
   pushes the target on instead, so the wheel goes through things rather than
   stopping at them. Two fingers pinch and pan.

   The stream viewer's camera is a fly camera: an eye, a yaw and a pitch, which
   WASD, the pad, the arrows, permalinks, edit mode and every selftest read and
   write. So the orbit camera here is a view of that state, not a second one:
   the target is the point `radius` along the forward ray, and each function
   takes { eye, yaw, pitch } and a radius and gives the new { eye, yaw, pitch }
   back. Nothing else moves; the target stays where it was in the world.

   The arithmetic of the forward, right and up vectors is the page's (fwd(),
   pointerRay), written once more here: yaw about +y, pitch up from the
   horizon, forward (cos p sin y, sin p, cos p cos y), right forward × +y,
   up right × forward. Sol-v4's azimuth is yaw − π and its elevation is
   −pitch, so its `azimuth -= dx·speed; elevation += dy·speed` is
   `yaw -= dx·speed; pitch -= dy·speed` here. */

export const CAMERA = {
  // Half the vertical field of view, as viewProj's 0.45 rad.
  half: 0.45,
  // Pitch stops a little short of straight up and down, as the page's look always has.
  pitchMax: 1.55,
  // A drag across the view's height is a whole turn (sol-v4's 2π / height).
  turn: 2 * Math.PI,
  // Dolly: a wheel line of 1 px is e^0.001, a middle drag of 1 px up e^0.005 (sol-v4's).
  wheel: 0.001, drag: 0.005,
  // The wheel is eased: each second takes 1 − e^−8 of what's left (sol-v4's).
  ease: 8,
  // What one gesture may ask for at most, in e-folds (sol-v4's ±8).
  pendingMax: 8,
};

export const forwardOf = (yaw, pitch) => [Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch), Math.cos(pitch) * Math.cos(yaw)];
export function basisOf(yaw, pitch){
  const f = forwardOf(yaw, pitch), rl = Math.hypot(f[2], f[0]) || 1;
  // f × (0, 1, 0) = (−f.z, 0, f.x), normalised; then up = right × forward.
  const r = [-f[2] / rl, 0, f[0] / rl];
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u };
}
export const targetOf = (cam, radius) => { const f = forwardOf(cam.yaw, cam.pitch); return [0, 1, 2].map(a => cam.eye[a] + radius * f[a]); };
const clampPitch = p => Math.max(-CAMERA.pitchMax, Math.min(CAMERA.pitchMax, p));

/* Which gesture a button is: left orbits, right pans, middle dollies, and
   shift with the left pans (sol-v4's pointerdown). A Mac's ctrl-click is a
   right click to the browser already. Anything else is no gesture. */
export function modeOf(button, shift = false){
  if (button === 1) return 'dolly';
  if (button === 2 || (button === 0 && shift)) return 'pan';
  if (button === 0) return 'orbit';
  return null;
}

/* Orbit: about the target, which stays put. dx, dy in CSS pixels; `height` the
   view's, so a drag the view's height is a whole turn on any screen. */
export function orbit(cam, radius, dx, dy, height){
  const speed = CAMERA.turn / Math.max(height, 1), target = targetOf(cam, radius);
  const yaw = cam.yaw - dx * speed, pitch = clampPitch(cam.pitch - dy * speed), f = forwardOf(yaw, pitch);
  return { eye: [0, 1, 2].map(a => target[a] - radius * f[a]), yaw, pitch };
}

/* Pan: the eye slides in the view's plane, so the point at the target's depth
   stays under the pointer, exactly (a "grab"). A point at depth d moves
   d·2·tan(half)/height voxels for a pixel (viewProj's projection), and the
   target is at depth `radius`. sol-v4 used 2·radius/1.8 for its own field
   of view; this is the same rule for ours. */
export function pan(cam, radius, dx, dy, height){
  const { r, u } = basisOf(cam.yaw, cam.pitch), k = 2 * radius * Math.tan(CAMERA.half) / Math.max(height, 1);
  return { eye: [0, 1, 2].map(a => cam.eye[a] + k * (-dx * r[a] + dy * u[a])), yaw: cam.yaw, pitch: cam.pitch };
}

/* Dolly by e^s about the target. Nearer than `threshold` the target is pushed
   on along the view instead (sol-v4's push-through), so a dolly in never stops:
   the eye goes through what it was looking at, at the threshold's pace. A
   radius below the threshold counts as the threshold, or an orbit about a
   point a voxel away would make the wheel crawl. At most `maxRadius` out.
   Returns the camera and the radius it leaves. */
export function dolly(cam, radius, s, { threshold, maxRadius = Infinity }){
  const f = forwardOf(cam.yaw, cam.pitch), r0 = Math.max(radius, threshold);
  const target = [0, 1, 2].map(a => cam.eye[a] + r0 * f[a]);
  let next = Math.min(maxRadius, r0 * Math.exp(s));
  if (next < threshold){
    for (let a = 0; a < 3; a++) target[a] += f[a] * (threshold - next);
    next = threshold;
  }
  return { eye: [0, 1, 2].map(a => target[a] - next * f[a]), yaw: cam.yaw, pitch: cam.pitch, radius: next };
}

/* What a wheel event asks for, in e-folds: lines and pages made pixels
   (deltaMode 1 and 2), as sol-v4 does. Positive is out. */
export function wheelLog(deltaY, deltaMode, pageHeight){
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? pageHeight : 1;
  return deltaY * unit * CAMERA.wheel;
}
// What's waiting, with more asked for: at most pendingMax either way.
export const addPending = (pending, s) => Number.isFinite(s) ? Math.max(-CAMERA.pendingMax, Math.min(CAMERA.pendingMax, pending + s)) : pending;
/* This frame's share of what's waiting (dt in ms): 1 − e^−8dt of it, and all of
   it once what would be left is under 1e−5, so the steps add up to exactly
   what was asked. */
export function easeStep(pending, dtMs){
  if (pending === 0) return 0;
  const step = pending * (1 - Math.exp(-CAMERA.ease * dtMs / 1000));
  return Math.abs(pending - step) < 1e-5 ? pending : step;
}

/* Two fingers: the change in their spread is a dolly (apart is in), and the
   change in their middle a pan. `before` and `after` are { x, y, distance }. */
export function pinchOf(before, after){
  const log = before.distance > 0 && after.distance > 0 ? Math.log(before.distance / after.distance) : 0;
  return { log, dx: after.x - before.x, dy: after.y - before.y };
}
