import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render } from './support/render.ts';
import { Blocks } from '../src/client/Blocks.tsx';

test('settled answer text links inline-code file mentions', () => {
  const html = render(Blocks, {
    blocks: [{ kind: 'text', text: '已更新 `src/a.ts` 和 `missing.ts`。' }],
    renderSlotChain: ((_name: string, _owner: unknown, options: { fallback: unknown }) => options.fallback) as never,
    loadImage: async () => 'blob:x',
    fileMentions: { resolve: (value: string) => value === 'src/a.ts' ? { open: () => {}, label: '打开 src/a.ts', title: 'D:/repo/src/a.ts' } : undefined },
  });
  assert.match(html, /<button[^>]*title="D:\/repo\/src\/a.ts"[^>]*aria-label="打开 src\/a.ts"[^>]*>src\/a.ts<\/button>/);
  assert.match(html, /<code>missing.ts<\/code>/);
});


test('reader streaming does not opt into host text reveal highlights', () => {
  const html = render(Blocks, {
    blocks: [], streaming: true,
    renderSlotChain: ((_name: string, _owner: unknown, options: { fallback: unknown }) => options.fallback) as never,
    loadImage: async () => 'blob:x',
  });
  assert.doesNotMatch(html, / data-streaming=/, 'host reveal engines claim this generic marker');
  assert.match(html, / data-reader-streaming="true"/);
});
