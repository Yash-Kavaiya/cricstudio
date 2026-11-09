/** Output cadence for YouTube. 30 is what the broadcast is set up as. */
export const OUTPUT_FPS = 30;
/** One frame, in microseconds (WebCodecs timestamps). Not an integer: 1e6/30. */
export const FRAME_US = 1_000_000 / OUTPUT_FPS;

/** Presentation timestamp for frame `index`, rounded so a 30 Hz mp4 timescale lands on exact ticks. */
export function frameTimestampUs(index: number): number {
  return Math.round(index * FRAME_US);
}

export interface CfrPlan {
  /** how many frames to encode now */
  encode: number;
  /** index of the first of those frames */
  startIndex: number;
  /** index to store after encoding (the next frame that is not yet due) */
  nextIndex: number;
}

/**
 * How many CFR frames are due at `elapsedUs`.
 * A caller slower than 30 Hz (the compositor sometimes takes longer than one frame)
 * still catches up, so the stream stays on 30 fps. A stall longer than `maxBurst`
 * snaps to "now" instead of encoding a huge backlog into the live encoder.
 */
export function cfrPlan(elapsedUs: number, nextIndex: number, maxBurst: number): CfrPlan {
  const elapsed = elapsedUs < 0 ? 0 : elapsedUs;
  // 1e-6 absorbs binary rounding at exact frame boundaries (63 * (1e6/30) is not exact)
  const lastDue = Math.floor(elapsed / FRAME_US + 1e-6);
  if (nextIndex > lastDue) return { encode: 0, startIndex: nextIndex, nextIndex };
  const count = lastDue - nextIndex + 1;
  if (count > maxBurst) return { encode: 1, startIndex: lastDue, nextIndex: lastDue + 1 };
  return { encode: count, startIndex: nextIndex, nextIndex: lastDue + 1 };
}
