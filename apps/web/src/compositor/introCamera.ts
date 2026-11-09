/**
 * Match-intro camera, in the stadium's own space (stage3d.ts): Y up, pitch along Z
 * from -2 to 2, stumps at z = ±1.75. The roof is a ring (inner radius ~14.8, height
 * ~6.2–6.6), open over the ground. The shot must end inside that hole, low, looking
 * down the pitch. Stopping outside the ring (the old rest, near y=7, z=18) puts the
 * roof between the lens and the strip.
 */

export interface IntroPose {
  x: number;
  y: number;
  z: number;
  /** world point the camera looks at */
  tx: number;
  ty: number;
  tz: number;
}

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const smooth = (t: number) => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};

/** The aerial the intro already used. Exact while t <= INTRO_HANDOFF_S. */
function aerial(t: number): IntroPose {
  const p = easeOut(t / 3.2);
  const ang = -1.4 + p * 1.4 + Math.sin(t * 0.2) * 0.08;
  const r = 40 - 22 * p;
  return {
    x: Math.sin(ang) * r,
    y: 28 - 21 * p,
    z: Math.cos(ang) * r,
    tx: 0,
    ty: 1.6 * p,
    tz: 0,
  };
}

/** Seconds of the original aerial before the camera turns in over the open middle. */
export const INTRO_HANDOFF_S = 1.35;

interface Key extends IntroPose {
  t: number;
}

const handoff = aerial(INTRO_HANDOFF_S);

// After the aerial: lift over the roof into the hole, drop onto the strip, then a slow push
// in behind the near stumps. Every key inside the ring stays under radius ~6, so the drop
// passes through open air (the roof's inner edge is ~14.8).
const KEYS: Key[] = [
  { t: INTRO_HANDOFF_S, ...handoff },
  { t: 2.9, x: 0.8, y: 14.2, z: 4.9, tx: 0, ty: 0.4, tz: 0 },
  { t: 4.35, x: 0.4, y: 1.4, z: 4.45, tx: 0, ty: 0.12, tz: -0.25 },
  { t: 5.75, x: 0.46, y: 1.28, z: 4.55, tx: 0, ty: 0.06, tz: -0.05 },
  // Hold just behind the near end, aimed at the middle of the strip so both
  // creases sit above the venue card and the roof stays out of the top of the frame.
  { t: 7.4, x: 0.4, y: 1.15, z: 4.3, tx: 0, ty: 0.02, tz: 0 },
];

/** Camera pose at `timeSec` seconds into the match intro. */
export function introPose(timeSec: number): IntroPose {
  const t = timeSec < 0 ? 0 : timeSec;
  if (t <= INTRO_HANDOFF_S) return aerial(t);
  let i = 0;
  while (i < KEYS.length - 2 && t >= KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const u = smooth((t - a.t) / (b.t - a.t));
  const lerp = (p: number, q: number) => p + (q - p) * u;
  // a breath on the hold, small enough that the lens stays on the strip
  const breathe = t > 5.75 ? Math.sin((t - 5.75) * 0.45) * 0.018 : 0;
  return {
    x: lerp(a.x, b.x),
    y: lerp(a.y, b.y) + breathe,
    z: lerp(a.z, b.z),
    tx: lerp(a.tx, b.tx),
    ty: lerp(a.ty, b.ty),
    tz: lerp(a.tz, b.tz),
  };
}

/**
 * True when a point sits in the roof ring built in stage3d (lathe radius 14.8–17.2,
 * height 6.2–6.6, scaled 1.08 on x). Margins are inside the mesh so nearby air is not flagged.
 */
export function inRoofRing(x: number, y: number, z: number): boolean {
  if (y < 5.55 || y > 7.15) return false;
  const r = Math.hypot(x / 1.08, z);
  return r > 14.3 && r < 17.7;
}
