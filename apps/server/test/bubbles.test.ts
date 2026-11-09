import { describe, expect, it } from 'vitest';
import {
  CAM_BUBBLE_SHAPES,
  applyBubblePatch,
  bubbleLayout,
  bubbleNameHeight,
  canEditBubble,
  sanitizeBubbleFields,
  type BubbleBrandFields,
} from '@cricstudio/shared';
import { defaultState } from '../src/studio/room';

const rec = {
  id: 's',
  name: 'Show',
  matchKey: 'demo:replay',
  hostTokenHash: '',
  guestTokenHash: '',
  programTokenHash: '',
  guestTokenEnc: '',
  settings: '{}',
  createdAt: 0,
};

const prev: BubbleBrandFields = {
  camBubbles: false,
  camBubblesAllScenes: true,
  camBubbleCorner: 'br',
  camBubbleSize: 220,
  camBubbleShape: 'ball',
  camBubbleSlots: { old: { x: 1, y: 2, shape: 'ball' } },
};

describe('camera frames', () => {
  it('new studios auto-pick matches and keep the ball as the default frame', () => {
    const st = defaultState(rec);
    expect(st.autopilot.autoMatch).toBe(true);
    expect(st.brand.camBubbles).toBe(false);
    expect(st.brand.camBubblesAllScenes).toBe(true);
    expect(st.brand.camBubbleShape).toBe('ball');
    expect(st.brand.camBubbleSlots).toEqual({});
  });

  it('offers a ball, a square and stumps', () => {
    const ids = CAM_BUBBLE_SHAPES.map((s) => s.id);
    expect(ids).toEqual(['ball', 'square', 'rounded', 'stumps', 'wide', 'oval', 'diamond', 'shield']);
  });

  it('packs one ball into the bottom-right corner', () => {
    const [b] = bubbleLayout([{ id: 'h' }], { camBubbleSize: 220, camBubbleCorner: 'br', camBubbleShape: 'ball' }, 0);
    const nameH = bubbleNameHeight(220, 220);
    expect(b.w).toBe(220);
    expect(b.h).toBe(220);
    expect(b.shape).toBe('ball');
    expect(b.placed).toBe(false);
    expect(b.x).toBeCloseTo(1920 - 36 - 220);
    expect(b.y).toBeCloseTo(1080 - 36 - nameH - 220);
  });

  it('packs a second person to the left of the first', () => {
    const boxes = bubbleLayout([{ id: 'h' }, { id: 'g' }], { camBubbleSize: 220, camBubbleCorner: 'br' }, 0);
    expect(boxes[0].x).toBeCloseTo(1664);
    expect(boxes[1].x).toBeCloseTo(1422);
    expect(boxes[1].y).toBeCloseTo(boxes[0].y);
  });

  it('keeps a wide row inside the frame', () => {
    const people = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}` }));
    const boxes = bubbleLayout(people, { camBubbleSize: 400, camBubbleShape: 'wide', camBubbleCorner: 'br' }, 0);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(36 - 0.01);
      expect(b.x + b.w).toBeLessThanOrEqual(1920 - 36 + 0.01);
    }
  });

  it('stumps are portrait and wide is landscape', () => {
    const [stumps] = bubbleLayout([{ id: 'h' }], { camBubbleShape: 'stumps', camBubbleSize: 220 }, 0);
    expect(stumps.h).toBeGreaterThan(stumps.w);
    expect(stumps.w).toBeCloseTo(220 * 0.78);
    expect(stumps.h).toBeCloseTo(220 * 1.22);
    const [wide] = bubbleLayout([{ id: 'h' }], { camBubbleShape: 'wide', camBubbleSize: 220 }, 0);
    expect(wide.w).toBeGreaterThan(wide.h);
  });

  it('honors a custom spot and clamps it onto the picture', () => {
    const [kept] = bubbleLayout([{ id: 'h' }], { camBubbleSlots: { h: { x: 100, y: 120, shape: 'square' } }, camBubbleShape: 'ball' }, 0);
    expect(kept.placed).toBe(true);
    expect(kept.shape).toBe('square');
    expect(kept.x).toBeCloseTo(100);
    expect(kept.y).toBeCloseTo(120);
    const [clamped] = bubbleLayout([{ id: 'h' }], { camBubbleSlots: { h: { x: 5000, y: -80, shape: 'square' } } }, 0);
    expect(clamped.x).toBeCloseTo(1920 - 220 - 12);
    expect(clamped.y).toBeCloseTo(12);
  });

  it('replaces the slot map and drops a bad shape', () => {
    const kept = sanitizeBubbleFields({ camBubbles: true }, prev);
    expect(kept.camBubbles).toBe(true);
    expect(kept.camBubbleSlots.old).toEqual({ x: 1, y: 2, shape: 'ball' });

    const out = sanitizeBubbleFields(
      {
        camBubbleShape: 'nope' as never,
        camBubbleSlots: {
          a: { x: 10, y: 20, shape: 'square' },
          b: { x: 3, y: 4, shape: 'nope' as never },
        },
      },
      prev,
    );
    expect(out.camBubbleShape).toBe('ball');
    expect(out.camBubbleSlots.old).toBeUndefined();
    expect(out.camBubbleSlots.a).toEqual({ x: 10, y: 20, shape: 'square' });
    expect(out.camBubbleSlots.b).toEqual({ x: 3, y: 4 });
  });

  it('keeps a shape when the spot is reset or the shape name is junk', () => {
    const reset = applyBubblePatch({ g: { x: 10, y: 20, shape: 'stumps' } }, 'g', { clearPosition: true });
    expect(reset.g).toEqual({ shape: 'stumps' });
    const junk = applyBubblePatch(reset, 'g', { shape: 'not-a-shape' as never });
    expect(junk.g.shape).toBe('stumps');
  });

  it('lets a guest move only their own frame', () => {
    expect(canEditBubble('guest', 'g1', 'g1')).toBe(true);
    expect(canEditBubble('guest', 'g1', 'host')).toBe(false);
    expect(canEditBubble('host', 'h', 'g1')).toBe(true);
    expect(canEditBubble('program', 'p', 'p')).toBe(false);
    expect(canEditBubble('guest', 'g1', '')).toBe(false);
  });
});
