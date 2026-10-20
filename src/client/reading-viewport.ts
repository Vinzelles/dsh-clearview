import { useEffect, type RefObject } from 'react';

/** Keep the reading column inside the visible part of a host pane that is wider than the window. */
export function readingInsets(left: number, right: number, viewportWidth: number): { left: number; right: number } {
  if (![left, right, viewportWidth].every(Number.isFinite) || right <= left || viewportWidth <= 0) return { left: 0, right: 0 };
  const width = right - left;
  const hiddenLeft = Math.min(width, Math.max(0, -left));
  return { left: hiddenLeft, right: Math.min(width - hiddenLeft, Math.max(0, right - viewportWidth)) };
}

export function useVisibleReadingWidth(root: RefObject<HTMLDivElement>) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const view = element.ownerDocument.defaultView;
    if (!view) return;
    let frame = 0;
    let observedWidth = -1;
    let windowLeft = view.scrollX;
    const scrollLeft = new Map<Element, number>();
    for (let node = element.parentElement; node; node = node.parentElement) scrollLeft.set(node, node.scrollLeft);
    const measure = () => {
      frame = 0;
      const box = element.getBoundingClientRect();
      const insets = readingInsets(box.left, box.right, view.innerWidth);
      for (const side of ['left', 'right'] as const) {
        const property = `--reader-viewport-${side}`;
        const value = `${insets[side]}px`;
        if (element.style.getPropertyValue(property) !== value) element.style.setProperty(property, value);
      }
    };
    const schedule = () => { if (!frame) frame = view.requestAnimationFrame(measure); };
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      // Streaming height changes must not introduce an extra layout read per token.
      if (width !== observedWidth) { observedWidth = width; schedule(); }
    });
    const onScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && scrollLeft.has(target)) {
        if (scrollLeft.get(target) === target.scrollLeft) return;
        scrollLeft.set(target, target.scrollLeft); schedule();
      } else if (target === element.ownerDocument && windowLeft !== view.scrollX) {
        windowLeft = view.scrollX; schedule();
      }
    };
    observer.observe(element);
    view.addEventListener('resize', schedule);
    element.ownerDocument.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      observer.disconnect();
      view.cancelAnimationFrame(frame);
      view.removeEventListener('resize', schedule);
      element.ownerDocument.removeEventListener('scroll', onScroll, true);
      element.style.removeProperty('--reader-viewport-left');
      element.style.removeProperty('--reader-viewport-right');
    };
  }, [root]);
}
