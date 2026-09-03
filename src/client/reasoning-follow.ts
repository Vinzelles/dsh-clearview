/** Continuous velocity-matched following for the reasoning stream. */
/** Proportional gain (1/s) closing residual lag against the live tail. */
export const FOLLOW_KP = 12;
/** EMA time constant (s) smoothing the measured content growth rate. */
export const FOLLOW_TAU = 0.12;
/** Speed cap (px/s) so a burst or a resume scrolls fast but never teleports. */
export const FOLLOW_VMAX = 2000;
/** Settle threshold (px) below which the loop parks itself until the next growth. */
export const FOLLOW_EPS = 0.5;
/** Frame delta clamp (s): a throttled or restored tab must not jump. */
export const FOLLOW_DT_MAX = 0.05;

export interface FollowState {
  pos: number;
  velocity: number;
  lastTail: number;
  lastAt: number;
}

export interface FollowTick extends FollowState {
  settled: boolean;
}

/**
 * One rAF tick of the follow controller: an EMA of the measured tail growth
 * feeds the speed forward, and a proportional term closes whatever lag remains.
 * Under steady streaming the feedforward converges to the exact growth rate,
 * so the viewport moves at constant speed with zero visible lag. The position
 * is clamped to the live tail every frame: a burst extends the approach, it
 * never overshoots the transcript end and rolls back.
 */
export function followAdvance(state: FollowState, tail: number, now: number): FollowTick {
  const dt = Math.min(FOLLOW_DT_MAX, Math.max(0.001, (now - state.lastAt) / 1000));
  const instant = (tail - state.lastTail) / dt;
  const velocity = Math.max(0, state.velocity + (instant - state.velocity) * (1 - Math.exp(-dt / FOLLOW_TAU)));
  const speed = Math.min(FOLLOW_VMAX, Math.max(0, velocity + (tail - state.pos) * FOLLOW_KP));
  const pos = Math.min(tail, Math.max(0, state.pos + speed * dt));
  const settled = tail - pos < FOLLOW_EPS && velocity < 2;
  return { pos, velocity: settled ? 0 : velocity, lastTail: tail, lastAt: now, settled };
}