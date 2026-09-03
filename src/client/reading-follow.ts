/** Pure decision table for the reader's conversation-level follow, so the
 *  DOM hook stays wiring only. The reading guards (a live text selection or
 *  focus inside the reader) intentionally pause auto-follow — but a pause the
 *  reader cannot see or end is the silent-stall bug this table fixes. */

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
