import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { render } from './support/render.ts';
import { Blocks } from '../src/client/Blocks.tsx';
import { Opening } from '../src/client/Opening.tsx';
import { chatNode, chatOf, turnLocation } from './support/chat-fixture.ts';
import { sessionHook } from './support/session.ts';

const renderers = { renderSlotChain: ((_n: string, _o: unknown, options: { fallback: unknown }) => options.fallback) as never, loadImage: async () => 'blob:x' };

const attachment = (attachmentId: string, name: string, width: number, height: number) => ({ attachmentId, name, width, height });

test('user-message images are square thumbnails without captions or aspect boxes', () => {
  const turn = turnLocation({ status: 'open' });
  const user = chatNode('user', {
    content: [
      { type: 'image', attachment: attachment('a1', 'one.png', 788, 267) },
      { type: 'image', attachment: attachment('a2', 'two.png', 722, 775) },
      { type: 'text', text: '需要优化多图展示' },
    ],
  }, turn);
  const html = render(Opening, { useSession: sessionHook(chatOf([user], [turn])), nodeKey: user.key, ...renderers });
  // One square container per image, in one row of the bubble.
  assert.equal((html.match(/data-image-variant="thumb"/g) ?? []).length, 2);
  assert.match(html, /data-reader-blocks-source="user"/);
  // A thumbnail must not reserve the original aspect box: the frame is a fixed square token.
  assert.doesNotMatch(html, /aspect-ratio/);
  // The attachment name stays discoverable as the zoom button title (the button mounts once the
  // image URL arrives, so the server markup cannot carry it), never as a caption row.
  const source = readFileSync(new URL('../src/client/Blocks.tsx', import.meta.url), 'utf8');
  assert.match(source, /title=\{thumb \? reference\?\.name : undefined\}/);
  assert.doesNotMatch(html, /<figcaption>/);
});

test('the user message text renders after the thumbnails and keeps its own full line', () => {
  const turn = turnLocation({ status: 'open' });
  const user = chatNode('user', {
    content: [
      { type: 'image', attachment: attachment('a1', 'one.png', 788, 267) },
      { type: 'text', text: '需要优化多图展示' },
    ],
  }, turn);
  const html = render(Opening, { useSession: sessionHook(chatOf([user], [turn])), nodeKey: user.key, ...renderers });
  const lastImage = html.lastIndexOf('data-reader-image');
  assert.ok(lastImage >= 0, 'expected the thumbnail figure in the markup');
  assert.ok(html.indexOf('需要优化多图展示') > lastImage, 'text must follow the thumbnails');
  assert.match(html, /data-reader-user-text="true"/);
});

test('an answer keeps full-size images with their caption and aspect ratio', () => {
  const html = render(Blocks, {
    blocks: [{ kind: 'image', attachment: attachment('a1', 'one.png', 788, 267) }],
    source: 'assistant',
    ...renderers,
  } as never);
  assert.match(html, /data-image-variant="full"/);
  assert.match(html, /style="aspect-ratio:788 \/ 267"/);
  assert.match(html, /<figcaption>one\.png<\/figcaption>/);
});

const sheet = readFileSync(new URL('../src/client/Reader.module.css', import.meta.url), 'utf8');
const rule = (selector: string) => {
  const start = sheet.indexOf(selector);
  assert.ok(start >= 0, `missing rule ${selector}`);
  const open = sheet.indexOf('{', start);
  const close = sheet.indexOf('}', open);
  return sheet.slice(open + 1, close);
};

test('the user block flow lays thumbnails in a wrapping row and gives text a full line', () => {
  const row = rule('.blocks[data-reader-blocks-source=user] {');
  assert.match(row, /flex-direction: row;/);
  assert.match(row, /flex-wrap: wrap;/);
  assert.match(row, /gap: var\(--cv-blocks-gap, 16px\) 8px;/);
  const others = rule('.blocks[data-reader-blocks-source=user] > :not([data-reader-image]) {');
  assert.match(others, /flex: 1 1 100%;/);
  assert.match(others, /min-width: 0;/);
  // The host wraps slot content in a display:contents [data-slot]; the real flex items are its
  // children, so the full-line constraint has to reach through the wrapper as well.
  const slotted = rule('.blocks[data-reader-blocks-source=user] > [data-slot] > :not([data-reader-image]) {');
  assert.match(slotted, /flex: 1 1 100%;/);
  assert.match(slotted, /min-width: 0;/);
});

test('thumbnails use one square token and crop instead of letterboxing', () => {
  assert.match(sheet, /--cv-image-thumb: 88px;/);
  const figure = rule('.imageFigure[data-image-variant=thumb] {');
  assert.match(figure, /width: var\(--cv-image-thumb, 88px\);/);
  const frame = rule('.imageFigure[data-image-variant=thumb] .imageFrame {');
  assert.match(frame, /box-sizing: border-box;/);
  assert.match(frame, /width: var\(--cv-image-thumb, 88px\);/);
  assert.match(frame, /height: var\(--cv-image-thumb, 88px\);/);
  assert.match(frame, /max-height: none;/);
  const crop = rule('.imageFigure[data-image-variant=thumb] .imageOpen img {');
  assert.match(crop, /object-fit: cover;/);
});

test('the user text seat is never clipped by the thumbnail layout', () => {
  const text = rule('.userText {');
  assert.doesNotMatch(text, /overflow: hidden|line-clamp|max-height/);
  const others = rule('.blocks[data-reader-blocks-source=user] > :not([data-reader-image]) {');
  assert.doesNotMatch(others, /overflow: hidden|line-clamp|max-height/);
});
