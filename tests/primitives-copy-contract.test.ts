/**
 * 0.1.2 primitives 文案契约的回归锁（针对 0.1.1 构建目标下 TS 无法强制的漂移）：
 *   1. 阅读页代码里不得再出现不带 truncatedLabel 的裸 <JsonBlock>——0.1.2 删除了
 *      0.1.1 的内置默认（defaultTruncatedLabel），>20k 展开时无守卫直调即
 *      TypeError；统一走 native/labeled-blocks.tsx 的 JsonBlockL。
 *   2. fence CodeBlock 的 copyLabel/copiedLabel 必须有显式回退——0.1.2 把 0.1.1
 *      内置的 '复制'/'复制成功' 默认删除，undefined 渲染空白按钮。
 *   3. JSON_TRUNCATED 与原生 0.1.2 zh 词典 json.truncated 模板逐字一致（插值除外）。
 *   4. 0.1.1 运行时忽略多余 prop：直传 truncatedLabel 两版安全（0.1.1 形参同名可选）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { JSON_TRUNCATED } from '../src/client/native/primitive-labels.ts';

const CLIENT_ROOT = new URL('../src/client', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return /\.(tsx|ts)$/.test(entry) ? [full] : [];
  });
}

test('no bare <JsonBlock> outside the labeled wrapper', () => {
  const offenders = tsxFiles(CLIENT_ROOT).filter(file => {
    if (file.replace(/\\/g, '/').endsWith('src/client/native/labeled-blocks.tsx')) return false;
    const source = readFileSync(file, 'utf8');
    // ContextBody keeps the native pattern (t('json.truncated')) — the copy
    // arrives via the seat, which satisfies the 0.1.2 contract too.
    return /<JsonBlock[\s(]/.test(source) && !/truncatedLabel/.test(source);
  });
  assert.deepEqual(offenders.map(file => file.replace(/\\/g, '/').split('src/client/')[1]!), []);
});

test('fence CodeBlock copy labels fall back to the 0.1.1 built-in defaults', () => {
  const source = readFileSync(join(CLIENT_ROOT, 'markdown', 'render.tsx'), 'utf8');
  assert.match(source, /copyLabel=\{context\.codeLabels\?\.copyLabel \?\? '复制'\}/);
  assert.match(source, /copiedLabel=\{context\.codeLabels\?\.copiedLabel \?\? '复制成功'\}/);
});

test('JSON_TRUNCATED matches the native zh template verbatim', () => {
  // 0.1.2 ui-chat chat-zh: "json.truncated": "… 已截断，共 {total} 字符"
  // 0.1.1 built-in: `… 已截断，共 ${total} 字符`
  assert.equal(JSON_TRUNCATED(20048), '… 已截断，共 20048 字符');
});
