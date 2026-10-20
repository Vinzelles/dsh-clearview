import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MOTION } from '../src/client/motion-tokens.ts';
import { COMPAT_CSS } from '../src/client/compat/styles.ts';
import { StatusText } from '../src/client/motion.tsx';
import { render } from './support/render.ts';

const readerCss = readFileSync(new URL('../src/client/Reader.module.css', import.meta.url), 'utf8');

test('motion tokens follow the spec', () => {
  assert.deepEqual(MOTION, { ease: 'cubic-bezier(.2,.8,.2,1)', fast: 100, swap: 200, size: 260, swapDistance: 4, swapBlur: 1, swapGap: 50 });
});

test('the root mirrors the motion tokens and follows the host font delta', () => {
  assert.match(readerCss, /--cv-ease: cubic-bezier\(\.2,\.8,\.2,1\);/);
  assert.match(readerCss, /--cv-fast: 100ms;/);
  assert.match(readerCss, /--cv-swap: 200ms;/);
  assert.match(readerCss, /--cv-size: 260ms;/);
  assert.match(readerCss, /--cc-size-ui: calc\(14px \+ var\(--dsh-content-font-delta, 0px\)\);/);
  assert.match(readerCss, /--think-distance: 4px;/);
  assert.doesNotMatch(readerCss, /@keyframes thinkShimmer/);
});

test('heavy mode only optimizes off-screen layout and never degrades visible motion', () => {
  assert.match(COMPAT_CSS, /\[data-dshcp-heavy="on"\] section\[data-reader-turn\]/);
  assert.doesNotMatch(COMPAT_CSS, /\[data-dshcp-heavy="on"\][^{]*(data-reader-word|data-reader-atom|data-shimmer|data-reader-shimmer)/);
});

test('status text uses the native shimmer only while busy', () => {
  assert.match(render(StatusText, { text: '正在思考', motion: true, shimmer: true, className: 'x' }), /data-stub="TextShimmer" data-active="true"/);
  assert.doesNotMatch(render(StatusText, { text: '已完成', motion: true, shimmer: false }), /TextShimmer/);
});
