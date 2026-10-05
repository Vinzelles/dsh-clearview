// Minimal browser globals for server-rendering components under node:test.
// window deliberately has no `document`, so react-dom/server stays in its
// non-DOM path.
const g = globalThis as Record<string, unknown>;
const noop = () => {};
const media = () => ({ matches: false, addEventListener: noop, removeEventListener: noop });
g.document ??= { hidden: false, timeline: { currentTime: 0 }, addEventListener: noop, removeEventListener: noop, getSelection: () => null, activeElement: null };
g.window ??= { matchMedia: media, addEventListener: noop, removeEventListener: noop, setInterval, clearInterval, setTimeout, clearTimeout };
g.requestAnimationFrame ??= (callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 16);
g.cancelAnimationFrame ??= (id: ReturnType<typeof setTimeout>) => clearTimeout(id);
export {};
