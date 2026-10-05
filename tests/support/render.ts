import './dom.ts';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/** Server-render one component; the server-side useLayoutEffect warning is expected noise. */
export function render<P extends object>(component: ComponentType<P>, props: P): string {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (String(args[0]).includes('useLayoutEffect does nothing on the server')) return;
    original(...args);
  };
  try { return renderToStaticMarkup(createElement(component, props)); } finally { console.error = original; }
}
