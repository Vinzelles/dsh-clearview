/**
 * WebKit（macOS 13.7 / Safari 16.5）兼容性回归锁：
 *
 *   1. 构建产物 lib/client.js（存在时）必须通过浏览器语法门禁
 *      scripts/browser-syntax-gate.mjs：
 *        a. 语法轴——esbuild 以 target es2022 重发产物；若源里出现 ES2023+ 语法
 *           （唯一新增语法是 ES2025 的 `using` 声明；正则 `v`/`d` 标志字面量不可
 *           转译、会被改写为运行期 `new RegExp(..., "v")`），输出里会留下
 *           `__using`/`__callDispose` 助手或 `new RegExp(..., "v")` 标记。
 *           Safari 16.5 解析不到这些语法，整个 bundle 在解析期 SyntaxError，
 *           插件条直接不加载（与 client-store-resolution 锁同级的 bundle 级硬失败）。
 *        b. 运行期轴——ES2024/25 全局 API（Object.groupBy、Promise.withResolvers、
 *           Array.fromAsync、Set 关系方法、Float8Array、iterator helpers 等）任何
 *           bundler 都不转译，Safari 16.5 上运行即 TypeError，只能源码层规避。
 *   2. tsdown.config.ts 必须把浏览器半边的 target 钉在 es2022——devkit 适配器的
 *      默认值是 es2024，若未来适配器升级或配置重构丢了这行覆盖，产物会再次
 *      漂移到 ES2024+ 语法（锁配置，防回归）。
 *
 * 背景：有 macOS 13.7（Safari 16.5）用户报告「ES2025 语法不支持」。本仓库 0.1.15
 * 产物经该门禁验证为 ES2022 语法干净（`using` 与 ES2024/25 API 均为零），故该
 * 报错若复现在 0.1.15 上，语法只能来自内核提供的种子/注入模块（宿主侧构建目标
 * 问题，需上报内核）——本锁同时保证本插件自身产物永不复发这一类缺陷。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { browserSyntaxGate } from '../scripts/browser-syntax-gate.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BUNDLE = join(ROOT, 'lib', 'client.js');

test('client bundle stays ES2022-syntax clean and free of ES2024/25 runtime APIs', async () => {
  if (!existsSync(BUNDLE)) return; // 未构建时跳过——与 client-store-resolution 的产物锁同约定
  const code = readFileSync(BUNDLE, 'utf8');
  const report = await browserSyntaxGate(code);
  assert.deepEqual(
    report.issues,
    [],
    `lib/client.js 含 Safari 16.5（macOS 13.7 WebKit）无法承载的构造：\n${report.issues.join('\n')}`,
  );
});

test('tsdown config pins the browser bundle to es2022', () => {
  const config = readFileSync(join(ROOT, 'tsdown.config.ts'), 'utf8');
  assert.match(
    config,
    /platform === 'browser'\)\s*config\.target = 'es2022'/,
    'tsdown.config.ts 必须把 browser 半边 target 钉在 es2022（devkit 适配器默认 es2024，Safari 16.5 不安全）',
  );
});
