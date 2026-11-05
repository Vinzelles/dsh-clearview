/** Pure decision table for the reader's conversation-level follow, so the
 *  DOM hook stays wiring only. The reading guards — a live text selection, or
 *  focus on a text-editing surface inside the reader — intentionally pause
 *  auto-follow; incidental focus on a control (a clicked disclosure, a tab,
 *  the scrollable thinking card) does NOT, or it silently stalls the viewport
 *  at the bottom and the jump dock surfaces at turn end with a real offset.
 *  A guard pause the reader cannot see or end is the silent-stall bug this
 *  table makes visible (`surface`). */

/** Same gap budget the scroll attribution uses to call a position "at bottom". */
export const READING_SURFACE_GAP = 72;

export type ReadingFollowAction = 'follow' | 'stabilize' | 'surface' | 'none';

/**
 * What a content resize should do, given the reading guards and follow state.
 *
 * - `follow`    — advance the viewport toward the newest content.
 * - `stabilize` — reader is detached; hold the captured anchor in place.
 * - `surface`   — a guard is holding follow while the user still claims the
 *   bottom (following=true): content has outrun the viewport, so show the
 *   jump pill. Without this the pause is invisible until the reader scrolls.
 * - `none`      — hold; a selection also freezes anchor work (stale-anchor
 *   writes would move the very text the reader selected).
 */
export function readingFollowAction(
  guards: { selected: boolean; focused: boolean },
  following: boolean,
  gap: number,
): ReadingFollowAction {
  if (!following) return guards.selected ? 'none' : 'stabilize';
  if (guards.selected || guards.focused) return gap > READING_SURFACE_GAP ? 'surface' : 'none';
  return 'follow';
}

/**
 * What a reader-caused scroll event (never one of our own eased writes) does
 * to follow intent. Position alone is NOT intent: re-attaching is reserved for
 * a downward reader gesture (`wantDown`) that actually settled at the bottom
 * surface. An upward pass that lands inside the surface gap — or a
 * scroll-anchoring event that carries no reader gesture at all — holds the
 * current intent. The position-only rule is what used to re-pin follow after
 * a small or interrupted scroll-up, so the next content growth yanked the
 * reader back to the bottom.
 *
 * A down-gesture that lands OUTSIDE the surface stays pending: a smooth
 * scroll, fling or scrollbar drag emits a run of scroll events, and only the
 * one that crosses into the surface may resume follow. Consuming the gesture
 * on an out-of-surface event is what kept the jump pill up after the reader
 * had already reached the bottom by hand.
 */
export function readingScrollAction(
  following: boolean,
  wantDown: boolean,
  atSurface: boolean,
): { following: boolean; wantDown: boolean } {
  // Only a pending downward gesture can temporarily leave the surface here.
  // Upward gestures detach in their input handler; native layout/clamping
  // scrolls have neither intent and must not interrupt an eased follow.
  if (!atSurface) return { following: wantDown ? false : following, wantDown };
  if (wantDown) return { following: true, wantDown: false };
  return { following, wantDown };
}

/**
 * One scroll body between a wheel's target and the conversation port.
 * `holds` mirrors `overscroll-behavior[-y]: contain|none`: a body that cannot move any
 * further also stops the chain, so the port never sees that step either.
 */
export interface NestedWheelBody {
  current: number;
  scrollHeight: number;
  clientHeight: number;
  holds: boolean;
}

/**
 * Whether the port stays where it is because a nested scroll body spends this wheel step.
 * A wheel aimed at the capped process body is not an intent to stop following the batch:
 * releasing there froze the page follow while the page itself had not moved a pixel, and the
 * reader came back from another window to a viewport that had silently stopped tracking.
 * Only a step that can actually reach the port may detach the follow.
 */
export function nestedConsumesWheel(chain: readonly NestedWheelBody[], deltaY: number): boolean {
  if (deltaY === 0) return true;
  for (const body of chain) {
    const span = body.scrollHeight - body.clientHeight;
    if (span <= 1) continue;
    if (deltaY < 0 ? body.current > 0.5 : body.current < span - 0.5) return true;
    if (body.holds) return true;
  }
  return false;
}
