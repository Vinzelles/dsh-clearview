/** WAAPI finishes arrive as separate tasks. Retire completed word wrappers in
 * one frame callback so React can batch their state changes. The animation has
 * already reached opacity:1/blur:0; keeping its wrapper until that frame has no
 * visual effect and preserves the absolute source timeline. */
const pending = new Set<() => void>();
let frame = 0;

export function settleOnFrame(settle: () => void): () => void {
  pending.add(settle);
  if (!frame) frame = requestAnimationFrame(() => {
    frame = 0;
    const batch = [...pending];
    pending.clear();
    for (const callback of batch) callback();
  });
  return () => {
    pending.delete(settle);
    if (!pending.size && frame) { cancelAnimationFrame(frame); frame = 0; }
  };
}
