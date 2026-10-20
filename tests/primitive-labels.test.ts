import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DIFF_LABELS, JSON_TREE_LABELS, JSON_TRUNCATED, MARKDOWN_LABELS, READ_LABELS, SEARCH_LABELS, TERMINAL_LABELS, WEB_LABELS } from '../src/client/native/primitive-labels.ts';

test('JSON tree labels carry every field the 0.1.2 component dereferences', () => {
  for (const key of ['copyValue', 'copyJson', 'copyPath', 'copyPrettyJson', 'copyCompactJson', 'copied', 'copyFailed', 'collapseNode', 'expandNode', 'copyButtonTitle']) {
    assert.ok(JSON_TREE_LABELS[key as keyof typeof JSON_TREE_LABELS] !== undefined, `missing ${key}`);
  }
  assert.equal(JSON_TREE_LABELS.copyButtonTitle('复制值'), '复制值；右键点击可选择复制方式');
});

test('terminal labels cover status, fold and copy chrome with native wording', () => {
  assert.equal(TERMINAL_LABELS.running, '运行中');
  assert.equal(TERMINAL_LABELS.done, '已完成');
  assert.equal(TERMINAL_LABELS.signal('KILL'), '信号 KILL');
  assert.equal(TERMINAL_LABELS.exitCode(7), '退出码 7');
  assert.equal(TERMINAL_LABELS.commandLine(3), '第 3 行命令行');
  assert.equal(TERMINAL_LABELS.expand(18), '… 其余 18 行');
  assert.equal(TERMINAL_LABELS.expandAria(18), '展开其余 18 行输出');
  for (const key of ['copy', 'copied', 'noOutput', 'collapseAria', 'collapse', 'failed', 'commandLine']) {
    assert.ok(TERMINAL_LABELS[key as keyof typeof TERMINAL_LABELS] !== undefined, `missing ${key}`);
  }
});

test('read, diff and search labels expose the exact summary/fold functions', () => {
  assert.equal(READ_LABELS.window(12, 1600), '显示 12 / 1600 行');
  assert.equal(READ_LABELS.expand(30), '… 其余 30 行');
  assert.equal(DIFF_LABELS.files(3), '3 个文件');
  assert.equal(DIFF_LABELS.expand(9), '… 其余 9 行');
  assert.equal(SEARCH_LABELS.pathsSummary(4, 40, false), '4 个路径');
  assert.equal(SEARCH_LABELS.pathsSummary(4, 40, true), '显示 4 / 共 40 个路径');
  assert.equal(SEARCH_LABELS.matchesSummary(5, 90, 3, false), '5 处匹配 · 3 个文件');
  assert.equal(SEARCH_LABELS.matchesSummary(5, 90, 3, true), '显示 5 / 共 90 处匹配 · 3 个文件');
  assert.equal(SEARCH_LABELS.noResults, '无结果');
});

test('web and markdown labels nest the markdown chrome intact', () => {
  assert.equal(MARKDOWN_LABELS.code.copyLabel, '复制');
  assert.equal(MARKDOWN_LABELS.footnotes, '脚注');
  assert.equal(WEB_LABELS.markdown, MARKDOWN_LABELS);
  assert.equal(WEB_LABELS.http, 'HTTP');
  assert.equal(WEB_LABELS.noResults, '未找到结果');
  assert.equal(WEB_LABELS.sourcesTruncated, '来源列表已截断');
  assert.equal(WEB_LABELS.contentTruncated, '内容已截断');
});
