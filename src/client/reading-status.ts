/** The tail row keeps its normal-flow resting position while eased follow catches up. */
export function statusBottomInset(viewportBottom: number, turnBottom: number, remainingScroll: number): number {
  return Math.max(0, Math.round(viewportBottom - turnBottom + remainingScroll));
}
