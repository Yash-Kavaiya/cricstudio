import { describe, expect, it } from 'vitest';
import { INTRO_HANDOFF_S, inRoofRing, introPose, type IntroPose } from '../../web/src/compositor/introCamera';

function rayHitsRoof(p: IntroPose): boolean {
  for (let u = 0; u <= 1; u += 0.01) {
    if (inRoofRing(p.x + (p.tx - p.x) * u, p.y + (p.ty - p.y) * u, p.z + (p.tz - p.z) * u)) return true;
  }
  return false;
}

/** Same projection as PerspectiveCamera(42, 16/9) after lookAt. NDC is -1..1. */
function project(p: IntroPose, px: number, py: number, pz: number) {
  const fx = p.tx - p.x;
  const fy = p.ty - p.y;
  const fz = p.tz - p.z;
  const fl = Math.hypot(fx, fy, fz);
  const zx = -fx / fl;
  const zy = -fy / fl;
  const zz = -fz / fl;
  let xx = zz;
  let xy = 0;
  let xz = -zx;
  const xl = Math.hypot(xx, xy, xz) || 1;
  xx /= xl;
  xy /= xl;
  xz /= xl;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const vx = px - p.x;
  const vy = py - p.y;
  const vz = pz - p.z;
  const cx = vx * xx + vy * xy + vz * xz;
  const cy = vx * yx + vy * yy + vz * yz;
  const cz = vx * zx + vy * zy + vz * zz;
  const fyv = 1 / Math.tan(((42 * Math.PI) / 180) / 2);
  const fxv = fyv / (16 / 9);
  return { x: (cx * fxv) / -cz, y: (cy * fyv) / -cz, front: cz < 0 };
}

describe('match intro camera', () => {
  it('opens on the same high wide aerial', () => {
    const p = introPose(0);
    expect(p.y).toBeCloseTo(28, 5);
    expect(Math.hypot(p.x, p.z)).toBeCloseTo(40, 4);
    expect(p.ty).toBeCloseTo(0, 5);
  });

  it('is still on that aerial at the handoff, above the roof', () => {
    const p = introPose(INTRO_HANDOFF_S);
    expect(p.y).toBeGreaterThan(10);
    expect(Math.hypot(p.x / 1.08, p.z)).toBeGreaterThan(18);
    expect(rayHitsRoof(p)).toBe(false);
  });

  it('holds low behind the near stumps with the pitch in frame and the roof out', () => {
    const p = introPose(8);
    expect(p.y).toBeGreaterThan(0.7);
    expect(p.y).toBeLessThan(1.6);
    expect(p.z).toBeGreaterThan(3.2);
    expect(p.z).toBeLessThan(5);
    expect(Math.hypot(p.x, p.z)).toBeLessThan(6);
    expect(p.tz).toBeLessThan(p.z - 2);
    expect(p.tz).toBeGreaterThan(-1.6);
    const mid = project(p, 0, 0.04, 0);
    const far = project(p, 0, 0.38, -1.75);
    const near = project(p, 0, 0.38, 1.75);
    const roof = project(p, 0, 6.4, -16);
    expect(mid.front).toBe(true);
    expect(Math.abs(mid.x)).toBeLessThan(0.25);
    expect(mid.y).toBeGreaterThan(-0.5);
    expect(mid.y).toBeLessThan(0.35);
    expect(far.front).toBe(true);
    expect(Math.abs(far.x)).toBeLessThan(0.4);
    expect(Math.abs(far.y)).toBeLessThan(0.55);
    expect(near.front).toBe(true);
    expect(near.y).toBeGreaterThan(-0.55);
    expect(roof.y).toBeGreaterThan(1);
  });

  it('never flies through the roof, which is what hid the pitch', () => {
    expect(rayHitsRoof({ x: 0, y: 7, z: 18, tx: 0, ty: 1.6, tz: 0 })).toBe(true);
    for (let ms = 0; ms <= 9000; ms += 40) {
      const p = introPose(ms / 1000);
      expect(inRoofRing(p.x, p.y, p.z)).toBe(false);
      if (Math.hypot(p.x / 1.08, p.z) > 12) expect(p.y).toBeGreaterThan(9);
      expect(rayHitsRoof(p)).toBe(false);
    }
  });
});
