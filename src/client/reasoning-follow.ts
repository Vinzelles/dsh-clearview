/** Transitions.dev Reasoning stream, adapted to appended content, never a loop. */
export const REASON_HOLD = 840;
export const REASON_STEP = 500;
export const REASON_LINES = 2;
/** First step after mount or resume: start before the reference hold elapses. */
export const REASON_FIRST = 200;
/** Calm beat between two-line steps (REASON_HOLD period minus the step). */
export const REASON_CALM_BEAT = REASON_HOLD - REASON_STEP;
/** Lag (in two-line steps) beyond which the viewport glides to the live tail. */
export const REASON_CATCH_LINES = 4;
/** Distance-scaled catch-up glide duration bounds (ms). */
export const REASON_CATCH_MIN = 400;
export const REASON_CATCH_MAX = 1800;
/** Beat between a catch-up glide and the re-evaluation of the live tail (ms). */
export const REASON_CATCH_BEAT = 120;
/** Glide durations when the stream ends while still following (ms). */
export const REASON_END_MIN = 420;
export const REASON_END_MAX = 600;

export function reasoningTarget(top: number, contentHeight: number, viewportHeight: number, lineHeight: number): number {
  const end = Math.max(0, contentHeight - viewportHeight);
  const current = Math.min(end, Math.max(0, top));
  // Receiving a burst changes the available transcript, never the step size.
  // Only the final, partial step may be shorter than the reference's two lines.
  return Math.min(end, current + Math.max(1, lineHeight) * REASON_LINES);
}

export interface ReasoningAdvance {
  target: number;
  duration: number;
  catchUp: boolean;
}

/**
 * Decide the next follow step from the live tail. A lag of a few lines keeps
 * the calm two-line step; a larger lag glides to the current end so a fast
 * stream never leaves the viewport persistently behind. The target is always
 * clamped to the real end: a burst extends the glide, it never overshoots.
 */
export function reasoningAdvance(top: number, contentHeight: number, viewportHeight: number, lineHeight: number): ReasoningAdvance {
  const end = Math.max(0, contentHeight - viewportHeight);
  const current = Math.min(end, Math.max(0, top));
  const gap = end - current;
  if (gap < 1) return { target: current, duration: 0, catchUp: false };
  const step = Math.max(1, lineHeight) * REASON_LINES;
  if (gap <= step * REASON_CATCH_LINES) return { target: Math.min(end, current + step), duration: REASON_STEP, catchUp: false };
  return { target: end, duration: Math.min(REASON_CATCH_MAX, Math.max(REASON_CATCH_MIN, Math.round(gap * 0.8))), catchUp: true };
}