import { describe, expect, it } from 'vitest';
import { OUTPUT_FPS, cfrPlan, frameTimestampUs } from '../../web/src/compositor/cfr';

describe('30fps CFR planner', () => {
  it('stamps every frame on a 1/30s grid the muxer will not collapse', () => {
    let prev = 0;
    for (let i = 0; i <= 600; i++) {
      const units = Math.round((frameTimestampUs(i) / 1e6) * OUTPUT_FPS);
      if (i > 0) expect(units - prev).toBe(1);
      prev = units;
    }
  });

  it('steady 30Hz emits exactly one frame per tick', () => {
    let next = 0;
    let encoded = 0;
    const frameUs = 1e6 / OUTPUT_FPS;
    for (let i = 0; i < 300; i++) {
      const plan = cfrPlan(i * frameUs, next, 8);
      expect(plan.encode).toBe(1);
      encoded += plan.encode;
      next = plan.nextIndex;
    }
    expect(encoded).toBe(300);
    expect(next).toBe(300);
  });

  it('a 25Hz caller still schedules 30 frames per second', () => {
    let next = 0;
    let encoded = 0;
    for (let ms = 0; ms < 10_000; ms += 40) {
      const plan = cfrPlan(ms * 1000, next, 8);
      encoded += plan.encode;
      next = plan.nextIndex;
    }
    expect(encoded).toBeGreaterThanOrEqual(298);
    expect(encoded).toBeLessThanOrEqual(302);
  });

  it('a long stall snaps instead of encoding a backlog', () => {
    const plan = cfrPlan(5_000_000, 0, 8);
    expect(plan.encode).toBe(1);
    expect(plan.startIndex).toBe(150);
    expect(plan.nextIndex).toBe(151);
  });

  it('does not emit a second frame for the same slot', () => {
    const first = cfrPlan(0, 0, 8);
    expect(first).toEqual({ encode: 1, startIndex: 0, nextIndex: 1 });
    expect(cfrPlan(0, first.nextIndex, 8).encode).toBe(0);
  });
});
