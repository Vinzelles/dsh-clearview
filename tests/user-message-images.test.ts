/**
 * 用户消息里图片的展示契约（0.2.2）。
 *
 * 过去图片按自身宽高比铺满气泡（最大 460px 宽 / 520px 高）：一条带 1-2 张截图的
 * 消息就能占满整屏，把同一气泡里的文字挤到视野之外。现在用户消息的图片一律是
 * 同一尺寸的正方形缩略图，点开才是原图；文字永远独占一行，不被折叠或裁切。
 *
 * 回答与工具结果里的图片保持原有「按比例大图」，不受此契约影响。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from './support/render.ts';
import { Blocks } from '../src/client/Blocks.tsx';
import { Opening } from '../src/client/Opening.tsx';
import { chatNode, chatOf, turnLocation } from './support/chat-fixture.ts';
import { sessionHook } from './support/session.ts';

const slot = { renderSlotChain: ((_n: string, _o: unknown, options: { fallback: unknown }) => options.fallback) as never, loadImage: async () => 'blob:x' };
const sheet = readFileSync(new URL('../src/client/Reader.module.css', import.meta.url), 'utf8');
const rule = (pattern: RegExp) => pattern.exec(sheet)?.[1] ?? '';

const wide = { attachmentId: 'sha256:wide', mediaType: 'image/png', bytes: 12, width: 788, height: 267, name: 'image.png' };
const tall = { attachmentId: 'sha256:tall', mediaType: 'image/png', bytes: 12, width: 722, height: 775, name: 'image2.png' };

function userOpening(content: unknown[]): string {
  const turn = turnLocation({ status: 'open' });
  const user = chatNode('user', { content }, turn);
  return render(Opening, { useSession: sessionHook(chatOf([user], [turn])), nodeKey: user.key, ...slot });
}

test('a user message draws every image as the same square thumbnail, not at its own ratio', () => {
  const html = userOpening([{ type: 'image', attachment: wide }, { type: 'image', attachment: tall }]);
  assert.equal(html.match(/data-image-variant="thumb"/g)?.length, 2, 'both images are thumbnails');
  assert.doesNotMatch(html, /data-image-variant="full"/);
  // The square comes from the stylesheet token, so the frame keeps no per-image aspect ratio.
  assert.doesNotMatch(html, /aspect-ratio/);
  // The attachment name moves to the hover title of the zoom button instead of an inline caption.
  assert.doesNotMatch(html, /<figcaption/);
});

test('the text of a user message stays in the bubble, on its own line, after the pictures', () => {
  const html = userOpening([{ type: 'image', attachment: wide }, { type: 'image', attachment: tall }, { type: 'text', text: '需要优化多图展示' }]);
  assert.match(html, /<div class="blocks"[^>]*data-reader-blocks-source="user"/);
  // Source order is preserved and the text is never dropped or collapsed…
  assert.match(html, /<div class="userText">需要优化多图展示<\/div>/);
  assert.ok(html.indexOf('userText') > html.lastIndexOf('imageFigure'), 'the text follows the thumbnails');
});

test('answers and tool results keep the full-size image with its caption', () => {
  const html = render(Blocks, { blocks: [{ kind: 'image', attachment: wide }], ...slot } as never);
  assert.match(html, /data-reader-blocks-source="assistant"/);
  assert.match(html, /data-image-variant="full"/);
  assert.match(html, /style="aspect-ratio:788 \/ 267"/);
  assert.match(html, /<figcaption>image\.png<\/figcaption>/);
});

test('user bubbles lay thumbnails out as a row and give every other block a whole line', () => {
  const row = rule(/\.blocks\[data-reader-blocks-source=user\] \{([^}]*)\}/);
  assert.match(row, /flex-direction: row/);
  assert.match(row, /flex-wrap: wrap/);
  assert.match(row, /gap: var\(--cv-blocks-gap, 16px\) 8px/);
  // The text (and any non-image block) may never shrink into a sliver beside the thumbnails.
  const line = rule(/\.blocks\[data-reader-blocks-source=user\] > :not\(\[data-reader-image\]\) \{([^}]*)\}/);
  assert.match(line, /flex: 1 1 100%/);
  assert.match(line, /min-width: 0/);
});

test('the thumbnail is one square token size, cropped, and its text cannot be clipped away', () => {
  assert.match(rule(/\.root \{([^}]*)\}/), /--cv-image-thumb: 88px/);
  const figure = rule(/\.imageFigure\[data-image-variant=thumb\] \{([^}]*)\}/);
  assert.match(figure, /width: var\(--cv-image-thumb, 88px\)/);
  const frame = rule(/\.imageFigure\[data-image-variant=thumb\] \.imageFrame \{([^}]*)\}/);
  assert.match(frame, /width: var\(--cv-image-thumb, 88px\)/);
  assert.match(frame, /height: var\(--cv-image-thumb, 88px\)/);
  // The full-size frame's 96px floor would stretch the square.
  assert.match(frame, /min-height: 0/);
  assert.match(rule(/\.imageFigure\[data-image-variant=thumb\] \.imageOpen img \{([^}]*)\}/), /object-fit: cover/);
  // User text keeps wrapping, and nothing in the bubble clips it.
  const text = rule(/\.userText \{([^}]*)\}/);
  assert.match(text, /white-space: pre-wrap/);
  for (const block of [text, rule(/\.blocks\[data-reader-blocks-source=user\] > :not\(\[data-reader-image\]\) \{([^}]*)\}/)]) {
    assert.doesNotMatch(block, /overflow: hidden|line-clamp|max-height/);
  }
});
