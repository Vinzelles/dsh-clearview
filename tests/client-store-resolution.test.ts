/**
 * 0.1.2 客户端 store 引擎解析的回归锁（对应「启动页 Failed to load plugins」那类
 * bundle 级硬失败）：
 *   1. src/client 不得对 `@deepseek-ai/dsh-client-runtime/client` 做**值导入**。
 *      dshx 客户端构建会把值导入提升成工厂顶部一次写死的 `require`；0.1.2 删除了
 *      该包且模块表没有同名种子，于是这次 require 抛「missed the module table」，
 *      整个插件条的导入失败——不是局部降级，而是插件整体不加载。`import type`
 *      编译期擦除，两版安全。
 *   2. store.ts 的引擎解析表必须两个拼写都在、且 0.1.2 的拼写排在前面（宿主若另装
 *      同名 compat 种子，也不能抢先于真实引擎），并用 try/catch 逐条查表。
 *   3. 构建产物（lib/client.js 存在时）不得再出现写死的 legacy require——源码锁
 *      只看意图，产物锁才证明真正发出的字节。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const CLIENT_ROOT = new URL('../src/client', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const LEGACY = '@deepseek-ai/dsh-client-runtime/client';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(tsx|ts)$/.test(entry) ? [full] : [];
  });
}

function relative(file: string): string {
  return file.replace(/\\/g, '/').split('src/client/')[1]!;
}

/** 该文件对 specifier 的值导入子句（`import type` 与全内联 `{ type X }` 不算）。 */
function valueImportsOf(file: string, specifier: string): string[] {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const hits: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const moduleSpecifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(moduleSpecifier) || moduleSpecifier.text !== specifier) continue;
    const clause = statement.importClause;
    if (clause === undefined) { hits.push('裸副作用导入'); continue; }
    if (clause.isTypeOnly) continue;
    if (clause.name !== undefined) { hits.push(`默认导入 ${clause.name.text}`); continue; }
    const bindings = clause.namedBindings;
    if (bindings === undefined) { hits.push('空子句'); continue; }
    if (ts.isNamespaceImport(bindings)) { hits.push(`命名空间导入 ${bindings.name.text}`); continue; }
    const values = bindings.elements.filter(element => !element.isTypeOnly).map(element => element.name.text);
    if (values.length > 0) hits.push(`{ ${values.join(', ')} }`);
  }
  return hits;
}

test('client sources never value-import the runtime package 0.1.2 removed', () => {
  const offenders = sourceFiles(CLIENT_ROOT)
    .map(file => ({ file, hits: valueImportsOf(file, LEGACY) }))
    .filter(entry => entry.hits.length > 0)
    .map(entry => `${relative(entry.file)}: ${entry.hits.join(' | ')}`);
  assert.deepEqual(offenders, []);
});

test('the store engine is resolved at runtime across both platform spellings', () => {
  const source = readFileSync(join(CLIENT_ROOT, 'store.ts'), 'utf8');
  const table = /const STORE_ENGINE_SPECIFIERS = \[([\s\S]*?)\]/.exec(source);
  assert.ok(table !== null, '缺少 STORE_ENGINE_SPECIFIERS 解析表');
  const entries = [...table[1]!.matchAll(/'([^']+)'/g)].map(match => match[1]!);
  // 新平台优先：0.1.2+ 预置 dsh-client-store，0.1.1 只有 runtime 包是真实预载模块。
  assert.deepEqual(entries, ['@deepseek-ai/dsh-client-store', LEGACY]);
  // 逐条 try/catch 查表：缺失的拼写必须是可捕获的抛出，而非 bundle 级硬失败。
  assert.match(source, /typeof require === 'function'/);
  assert.match(source, /for \(const specifier of STORE_ENGINE_SPECIFIERS\)/);
  assert.match(source, /catch \(error\)/);
});

test('the built client bundle carries no hard-coded require for the removed package', () => {
  const bundle = new URL('../lib/client.js', import.meta.url);
  // 未构建的工作区跳过：上面的源码锁已经覆盖意图。
  if (!existsSync(bundle)) return;
  const source = readFileSync(bundle, 'utf8');
  const hardCoded = new RegExp(`require\\("${LEGACY.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\)`);
  assert.doesNotMatch(source, hardCoded);
});
