import './support/dom.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { render } from './support/render.ts';
import { Blocks } from '../src/client/Blocks.tsx';
import { initialVisible, RevealLedgerContext, StreamMotionContext, type RevealLedger } from '../src/client/streaming.tsx';

test('a live leaf starts empty, a remounted one starts from what was already shown', () => {
  assert.equal(initialVisible('已经显示过的段落', true), '');
  assert.equal(initialVisible('已经显示过的段落', true, '已经显示'), '已经显示');
  assert.equal(initialVisible('已经显示过的段落', true, '已经显示过的段落'), '已经显示过的段落');
});

test('shown text that is not a prefix of the source is ignored', () => {
  assert.equal(initialVisible('改写后的段落', true, '已经显示'), '');
  assert.equal(initialVisible('短', true, '比来源更长的文字'), '');
});

test('a leaf that is not revealing starts from its full source', () => {
  assert.equal(initialVisible('全文', false), '全文');
  assert.equal(initialVisible('全文', false, '全'), '全文');
});

const TEXT = '我先检查一下工作区。';

function renderLive(ledger: RevealLedger | null, revealKey: string | undefined) {
  const blocks = createElement(Blocks, {
    blocks: [{ kind: 'text', text: TEXT }], streaming: true, startedAt: 1, liveText: true, revealKey,
    renderSlotChain: ((_name: string, _owner: unknown, options: { fallback: unknown }) => options.fallback) as never,
    loadImage: async () => 'blob:x',
  });
  return render(StreamMotionContext.Provider as never, {
    value: { enabled: true, activatedAt: 0 },
    children: createElement(RevealLedgerContext.Provider, { value: ledger }, blocks),
  } as never);
}

test('a live body paragraph with nothing shown yet mounts empty and reveals', () => {
  const html = renderLive(new Map(), 'node:0');
  assert.match(html, /data-received-length="10" data-shown-length="0"/);
  assert.doesNotMatch(html, /我先检查/);
});

test('the same paragraph remounted under the other route keeps the shown text and does not retype it', () => {
  const ledger: RevealLedger = new Map([['node:0:0', TEXT]]);
  const html = renderLive(ledger, 'node:0');
  assert.match(html, /data-received-length="10" data-shown-length="10"/);
  assert.match(html, /我先检查一下工作区。/);
  assert.doesNotMatch(html, /data-reader-word/);
  assert.doesNotMatch(html, /data-presentation-pending/);
});

test('a partly shown paragraph resumes from the shown prefix', () => {
  const html = renderLive(new Map([['node:0:0', '我先检查']]), 'node:0');
  assert.match(html, /data-shown-length="4"/);
  assert.match(html, /data-presentation-pending="true"/);
});

test('without a reveal key the ledger is not consulted', () => {
  const html = renderLive(new Map([['node:0:0', TEXT]]), undefined);
  assert.match(html, /data-shown-length="0"/);
});
