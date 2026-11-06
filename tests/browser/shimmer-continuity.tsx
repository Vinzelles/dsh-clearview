import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Line } from '../../src/client/Line.tsx';
import { StatusLine } from '../../src/client/StatusLine.tsx';

// Actual components and CSS, but no host session, network, or user data.
const host = document.createElement('main');
document.body.style.cssText = 'margin:0;background:#888';
document.body.append(host);
const root = createRoot(host);
const labels = { short: '读取文件', long: '读取文件并检查当前任务的完整执行结果' };
const status = { short: '正在思考', long: '正在生成文件并检查当前任务的完整执行结果' };
const common: React.CSSProperties = {
  '--cv-row-height': '32px', '--cv-process-size': '16px', '--cc-size-small': '12px',
  '--cc-font-ui': 'sans-serif', '--cv-fast': '100ms', '--cv-ease': 'ease',
  '--cv-process-text': 'var(--cc-text-300)', '--cv-detail-border': 'var(--cc-text-500)',
} as React.CSSProperties;
const view = <>
  {(['light', 'dark'] as const).map(theme => <section key={theme} style={{ ...common, padding: 12,
    background: theme === 'light' ? '#faf9f5' : '#141413',
    '--cc-text-300': theme === 'light' ? '#525252' : '#b5b5b5',
    '--cc-text-100': theme === 'light' ? '#111111' : '#ffffff',
    '--cc-text-500': theme === 'light' ? '#777777' : '#888888',
  } as React.CSSProperties}>
    {(['short', 'long'] as const).map(length => <React.Fragment key={length}>
      <div data-case={`${theme}-${length}-line`}><Line icon="•" label={labels[length]} shimmer /></div>
      <div data-case={`${theme}-${length}-status`}><StatusLine phase="running" label={status[length]} elapsed={null} thinking={null} motion /></div>
    </React.Fragment>)}
  </section>)}
</>;
flushSync(() => root.render(view));

const cases = () => [...host.querySelectorAll<HTMLElement>('[data-case]')].map(container => {
  const element = container.querySelector<HTMLElement>('[data-shimmer]');
  if (!element) throw Error(`Missing shimmer: ${container.dataset.case}`);
  return { name: container.dataset.case!, element };
});
const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
(window as any).shimmerSample = async (time: number) => {
  const entries = cases();
  for (const { name, element } of entries) {
    const animations = element.getAnimations();
    if (animations.length !== 1) throw Error(`${name}: expected one shimmer animation, got ${animations.length}`);
    animations[0]!.pause();
    animations[0]!.currentTime = time;
  }
  await frame();
  return entries.map(({ name, element }) => {
    const { x, y, width, height } = element.getBoundingClientRect();
    const animation = element.getAnimations()[0]!;
    return { name, x, y, width, height, duration: animation.effect!.getTiming().duration,
      clip: getComputedStyle(element).backgroundClip };
  });
};
(window as any).shimmerCompare = async (images: string[], rects: { name: string; x: number; y: number; width: number; height: number }[]) => {
  const load = (data: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = `data:image/png;base64,${data}`;
  });
  const loaded = await Promise.all(images.map(load));
  const canvas = document.createElement('canvas');
  canvas.width = loaded[0]!.width; canvas.height = loaded[0]!.height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  return rects.map(rect => {
    const x = Math.floor(rect.x), y = Math.floor(rect.y);
    const width = Math.ceil(rect.x + rect.width) - x, height = Math.ceil(rect.y + rect.height) - y;
    const pixels = loaded.map(image => { context.clearRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0); return context.getImageData(x, y, width, height).data; });
    const difference = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let sum = 0;
      for (let index = 0; index < a.length; index += 4) for (let channel = 0; channel < 3; channel++) sum += Math.abs(a[index + channel]! - b[index + channel]!);
      return sum / (width * height * 3);
    };
    return { name: rect.name, boundary: difference(pixels[0]!, pixels[1]!), moving: difference(pixels[2]!, pixels[3]!) };
  });
};
// Seeking a CSSAnimation through the Web Animations API changes its ownership in Chrome.
// Remount before testing the media query so its animations remain CSS-controlled.
(window as any).shimmerRemount = async () => {
  flushSync(() => root.render(null));
  flushSync(() => root.render(view));
  await frame();
  return cases().map(({ name, element }) => ({ name, running: element.getAnimations().some(animation => animation.playState === 'running') }));
};
(window as any).shimmerReducedMotion = async () => {
  await frame(); // Let the media-query change reach computed styles and cancel CSS animations.
  return cases().map(({ name, element }) => ({ name,
    animations: element.getAnimations().map(animation => ({ kind: animation.constructor.name, state: animation.playState, name: (animation as CSSAnimation).animationName, property: (animation as CSSTransition).transitionProperty })),
    animationName: getComputedStyle(element).animationName, color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundImage }));
};
