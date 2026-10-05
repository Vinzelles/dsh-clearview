/**
 * 用户消息渲染路径的回归锁（对应 0.1.16 修复：部分设备上用户消息整条变成
 * 「此内容暂时无法在阅读页显示」）。
 *
 * 该兜底文案只在子树渲染抛错时出现，而用户消息路径上有两类跨内核版本脆弱的
 * 假设：
 *   1. 内容形状——image 块必须带 attachment，content 必须是块数组；
 *   2. 宿主组件——文本叶子一度直接用宿主 primitives 的 MessageText。
 * 0.1.13 的同类事故（0.1.2 起 primitives 的展示组件改为必传 labels，缺失即
 * 渲染期 TypeError）证明第 2 类会整条吞掉座位，因此这里把「自持」钉死。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { blockKey, contentBlocks, isAttachmentRef } from '../src/client/user-content.ts';
import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client';

const CLIENT_ROOT = new URL('../src/client', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function clientFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return clientFiles(full);
    return /\.(tsx|ts)$/.test(entry) ? [full] : [];
  });
}

const attachment = { attachmentId: 'sha256:abc', mediaType: 'image/png', bytes: 12, width: 415, height: 114, name: 'image.png' };

test('user content: text and image blocks survive verbatim', () => {
  assert.deepEqual(contentBlocks([{ type: 'image', attachment }, { type: 'text', text: '看图' }]), [
    { kind: 'image', attachment },
    { kind: 'text', text: '看图' },
  ]);
});

test('user content: shape drift degrades to the raw payload instead of throwing', () => {
  // image 块缺 attachment / attachmentId：过去会在 Blocks 的 key 计算与 ImageBlock
  // 渲染期解引用 undefined，整条用户消息被边界吞掉。
  assert.deepEqual(contentBlocks([{ type: 'image' }]), [{ kind: 'other', block: { type: 'image' } }]);
  assert.equal(contentBlocks([{ type: 'image', attachment: {} }])[0]!.kind, 'other');
  assert.equal(contentBlocks([{ type: 'image', attachment: { attachmentId: '' } }])[0]!.kind, 'other');
  // text 块没有字符串正文。
  assert.equal(contentBlocks([{ type: 'text' }])[0]!.kind, 'other');
  // 非数组 / 空值 / 未知形状。
  assert.deepEqual(contentBlocks(undefined), []);
  assert.deepEqual(contentBlocks(null), []);
  assert.deepEqual(contentBlocks({ blocks: [] }), [{ kind: 'other', block: { blocks: [] } }]);
  assert.equal(contentBlocks([42])[0]!.kind, 'other');
  // 旧内核把 content 直接投影为字符串：按文本解释才不丢内容。
  assert.deepEqual(contentBlocks('纯文本'), [{ kind: 'text', text: '纯文本' }]);
});

test('block keys never dereference a missing attachment', () => {
  const broken = { kind: 'image' } as unknown as AssistantBlock;
  assert.equal(blockKey(broken, 3), 'image:unknown:3');
  const named = { kind: 'image', attachment } as unknown as AssistantBlock;
  assert.equal(blockKey(named, 1), 'image:sha256:abc:1');
  assert.equal(blockKey({ kind: 'text', text: 'x' }, 2), '2:text');
});

test('isAttachmentRef accepts only a usable handle', () => {
  assert.equal(isAttachmentRef(attachment), true);
  assert.equal(isAttachmentRef({ attachmentId: 'sha256:x' }), true);
  assert.equal(isAttachmentRef({ attachmentId: '' }), false);
  assert.equal(isAttachmentRef({}), false);
  assert.equal(isAttachmentRef(null), false);
  assert.equal(isAttachmentRef(undefined), false);
  assert.equal(isAttachmentRef('sha256:x'), false);
});

test('user text no longer renders through the host MessageText primitive', () => {
  // 任何 `<MessageText` 用法都会让用户消息座位重新挂回宿主组件；宿主的可用性与
  // 入参契约随内核版本漂移，而阅读页对它的失败只能给出兜底文案。
  const offenders = clientFiles(CLIENT_ROOT)
    .filter(file => /<MessageText[\s/>]/.test(readFileSync(file, 'utf8')))
    .map(file => file.replace(/\\/g, '/').split('src/client/')[1]!);
  assert.deepEqual(offenders, []);
  const blocks = readFileSync(join(CLIENT_ROOT, 'Blocks.tsx'), 'utf8');
  assert.match(blocks, /source === 'user' \? <UserText text=\{block\.text\} \/>/);
  const css = readFileSync(join(CLIENT_ROOT, 'Reader.module.css'), 'utf8');
  assert.match(css, /\.userText \{ white-space: pre-wrap; word-break: break-word; \}/);
});

test('the fallback notice keeps an evidence channel', () => {
  // 静默吞错会让设备报告不可诊断（历史故障即如此）：错误与组件栈必须落 console，
  // 同一条原因落到 DOM 属性上，便于从元素检查/截图直接读出。
  const blocks = readFileSync(join(CLIENT_ROOT, 'Blocks.tsx'), 'utf8');
  assert.match(blocks, /componentDidCatch\(error: unknown, info: \{ componentStack\?: string \| null \}\)/);
  assert.match(blocks, /console\.error\('\[dsh-clearview\] 阅读页片段渲染失败/);
  assert.match(blocks, /data-reader-block-error=\{this\.state\.reason\}/);
});

test('image rendering degrades when the handle or loader is missing', () => {
  const blocks = readFileSync(join(CLIENT_ROOT, 'Blocks.tsx'), 'utf8');
  assert.match(blocks, /const usable = reference !== null && typeof loadImage === 'function';/);
  assert.match(blocks, /if \(!usable \|\| reference === null\) \{ setError\(true\); return; \}/);
  assert.match(blocks, /const \[error, setError\] = useState\(!usable\);/);
});
