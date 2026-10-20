import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChatConversationViewNode, ToolCallBlock, ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client';
import {
  collectFileChanges, EMPTY_FILE_CHANGES, fileOpsOf, reconcileFileChanges, resolveDisplayPath, shellFileOps, summarizeFileOps, fileChangeCounts,
} from '../src/client/file-changes.js';

/** 一个已结算工具调用的最小夹具（未给出的字段取无害默认）。 */
function settled(overrides: Partial<ToolResultNode> = {}): ToolResultNode {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'call-1',
    call: { name: 'write', argsRaw: '{}' },
    callTime: 0,
    content: [],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
    ...overrides,
  };
}

const writeArgs = (path: string, content = 'x') => JSON.stringify({ file_path: path, content });
const WRITE_CREATED = '<path>w.txt</path>\n<type>file</type>\n<content>\nCreated file\n</content>';
const WRITE_UPDATED = '<path>w.txt</path>\n<type>file</type>\n<content>\nUpdated file\n</content>';
const diffView = (path: string) => ({ card: 'diff', title: `Write ${path}`, diffs: [{ path, oldText: null, newText: 'x' }], locations: [{ path }] });

test('write 工具：结果文本 Created file → 新增', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'write', argsRaw: writeArgs('w.txt') },
    content: [{ type: 'text', text: WRITE_CREATED }],
    callView: diffView('w.txt'),
  }));
  assert.deepEqual(ops, [{ op: 'create', path: 'w.txt' }]);
});

test('write 工具：结果文本 Updated file → 修改', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'write', argsRaw: writeArgs('w.txt') },
    content: [{ type: 'text', text: WRITE_UPDATED }],
    callView: diffView('w.txt'),
  }));
  assert.deepEqual(ops, [{ op: 'modify', path: 'w.txt' }]);
});

test('write 工具：结果文本缺失时退回 meta.diffs 空数组 → 新增', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'write', argsRaw: writeArgs('w.txt') },
    meta: { diffs: [] },
    callView: diffView('w.txt'),
  }));
  assert.deepEqual(ops, [{ op: 'create', path: 'w.txt' }]);
});

test('write 工具：文本与 meta 都缺失 → 保守归为修改', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'write', argsRaw: writeArgs('w.txt') },
    callView: diffView('w.txt'),
  }));
  assert.deepEqual(ops, [{ op: 'modify', path: 'w.txt' }]);
});

test('edit 工具（diff 卡片）→ 修改', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'edit', argsRaw: JSON.stringify({ file_path: 'b.ts', old_string: 'a', new_string: 'b' }) },
    content: [{ type: 'text', text: 'The file b.ts has been updated successfully.' }],
    callView: { card: 'diff', title: 'Edit b.ts', diffs: [{ path: 'b.ts', oldText: 'a', newText: 'b' }], locations: [{ path: 'b.ts' }] },
  }));
  assert.deepEqual(ops, [{ op: 'modify', path: 'b.ts' }]);
});

test('str_replace_editor：create 命令 → 新增；str_replace 命令 → 修改', () => {
  const create = fileOpsOf(settled({
    call: { name: 'str_replace_editor', argsRaw: JSON.stringify({ command: 'create', path: 'c.ts', file_text: 'x' }) },
    callView: diffView('c.ts'),
  }));
  assert.deepEqual(create, [{ op: 'create', path: 'c.ts' }]);
  const replace = fileOpsOf(settled({
    call: { name: 'str_replace_editor', argsRaw: JSON.stringify({ command: 'str_replace', path: 'c.ts', old_str: 'a', new_str: 'b' }) },
    callView: diffView('c.ts'),
  }));
  assert.deepEqual(replace, [{ op: 'modify', path: 'c.ts' }]);
});

test('str_replace_editor 的 insert（generic kind=edit 卡片）→ 修改', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'str_replace_editor', argsRaw: JSON.stringify({ command: 'insert', path: 'c.ts', insert_line: 1, new_str: 'x' }) },
    callView: { card: 'generic', title: 'insert c.ts', kind: 'edit', locations: [{ path: 'c.ts' }] },
  }));
  assert.deepEqual(ops, [{ op: 'modify', path: 'c.ts' }]);
});

test('generic kind=delete 卡片 → 删除（未来工具的前瞻路径）', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'delete_file', argsRaw: JSON.stringify({ file_path: 'd.txt' }) },
    callView: { card: 'generic', title: 'Delete d.txt', kind: 'delete', locations: [{ path: 'd.txt' }] },
  }));
  assert.deepEqual(ops, [{ op: 'delete', path: 'd.txt' }]);
});

test('失败的工具调用不计入', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'write', argsRaw: writeArgs('w.txt') },
    content: [{ type: 'text', text: WRITE_CREATED }],
    isError: true,
    callView: diffView('w.txt'),
  }));
  assert.deepEqual(ops, []);
});

test('未结算（运行中）的调用不计入', () => {
  const running: ToolCallBlock = {
    callId: 'call-2', name: 'write', argsRaw: writeArgs('w.txt'),
    turn: 1, step: 0, time: 0, callView: diffView('w.txt'), subCalls: [],
  };
  assert.deepEqual(fileOpsOf(running), []);
});

test('读取类工具不计入（view 卡片为 read）', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'read', argsRaw: JSON.stringify({ file_path: 'r.ts' }) },
    callView: { card: 'generic', title: 'Read r.ts', kind: 'read', locations: [{ path: 'r.ts' }] },
  }));
  assert.deepEqual(ops, []);
});

test('渲染意图缺失时退回参数路径（write）', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'write', argsRaw: writeArgs('w.txt') },
    content: [{ type: 'text', text: WRITE_CREATED }],
    callView: null,
  }));
  assert.deepEqual(ops, [{ op: 'create', path: 'w.txt' }]);
});

test('未知工具声明 diff 卡片 → 默认修改（不冒充新增）', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'apply_patch', argsRaw: JSON.stringify({ input: 'a' }) },
    callView: diffView('u.ts'),
  }));
  assert.deepEqual(ops, [{ op: 'modify', path: 'u.ts' }]);
});

test('shell：Remove-Item 成功 → 删除（绝对路径）', () => {
  const ops = fileOpsOf(settled({
    call: { name: 'pwsh', argsRaw: JSON.stringify({ command: 'Remove-Item -Recurse -Force "D:\\w\\tmp\\x"' }) },
    callView: { card: 'terminal', title: 'Remove-Item …' },
    resultView: { card: 'terminal', title: 'Remove-Item …', output: '', exitCode: 0 },
  }));
  assert.deepEqual(ops, [{ op: 'delete', path: 'D:\\w\\tmp\\x' }]);
});

test('shell：失败的移除命令不计入（退出码非 0 / isError）', () => {
  const failed = settled({
    call: { name: 'bash', argsRaw: JSON.stringify({ command: 'rm x.txt' }) },
    isError: true,
    callView: { card: 'terminal', title: 'rm x.txt' },
    resultView: { card: 'terminal', title: 'rm x.txt', output: 'no such file', exitCode: 1 },
  });
  assert.deepEqual(fileOpsOf(failed), []);
  const noErrorFlag = settled({
    call: { name: 'bash', argsRaw: JSON.stringify({ command: 'rm x.txt' }) },
    callView: { card: 'terminal', title: 'rm x.txt' },
    resultView: { card: 'terminal', title: 'rm x.txt', output: '', exitCode: 1 },
  });
  // 退出码非 0 但 isError 未置位的终端调用：同样不算成功。
  assert.deepEqual(fileOpsOf(noErrorFlag), []);
});

test('shellFileOps：常见移除动词与 git rm', () => {
  assert.deepEqual(shellFileOps('rm -rf node_modules'), [{ op: 'delete', path: 'node_modules' }]);
  assert.deepEqual(shellFileOps('git rm --cached a.txt && git add .'), [{ op: 'delete', path: 'a.txt' }]);
  assert.deepEqual(shellFileOps('del /s /q C:\\build\\out'), [{ op: 'delete', path: 'C:\\build\\out' }]);
  assert.deepEqual(shellFileOps('rmdir /s /q out && echo done'), [{ op: 'delete', path: 'out' }]);
  assert.deepEqual(shellFileOps('unlink old.tmp'), [{ op: 'delete', path: 'old.tmp' }]);
  assert.deepEqual(shellFileOps('rm -v a.txt b.txt'), [{ op: 'delete', path: 'a.txt' }, { op: 'delete', path: 'b.txt' }]);
});

test('shellFileOps：mv 恰好两路径 → 源删除 + 目标新增；多源不解析', () => {
  assert.deepEqual(shellFileOps('mv old.txt new.txt'), [{ op: 'delete', path: 'old.txt' }, { op: 'create', path: 'new.txt' }]);
  assert.deepEqual(shellFileOps('git mv a.ts b.ts'), [{ op: 'delete', path: 'a.ts' }, { op: 'create', path: 'b.ts' }]);
  assert.deepEqual(shellFileOps('Move-Item -Path a.txt -Destination b.txt'), [{ op: 'delete', path: 'a.txt' }, { op: 'create', path: 'b.txt' }]);
  assert.deepEqual(shellFileOps('mv a b dir'), []);
});

test('shellFileOps：动态/不可确定令牌一律跳过', () => {
  assert.deepEqual(shellFileOps('Remove-Item *.tmp'), []);
  assert.deepEqual(shellFileOps('rm "$HOME/x"'), []);
  assert.deepEqual(shellFileOps('rm `whoami`'), []);
  assert.deepEqual(shellFileOps('Get-ChildItem -File | Remove-Item'), []);
  assert.deepEqual(shellFileOps('find . -name x -delete'), []);
  assert.deepEqual(shellFileOps('echo hello'), []);
});

test('shellFileOps：PowerShell 逗号数组参数（仅移除动词拆分）', () => {
  // 引号包裹的数组：'a','b' → 两个路径都被删
  assert.deepEqual(shellFileOps("Remove-Item 'a.txt','b.txt'"), [
    { op: 'delete', path: 'a.txt' }, { op: 'delete', path: 'b.txt' },
  ]);
  // 无引号数组：a,b,c → 三个路径
  assert.deepEqual(shellFileOps('Remove-Item a,b,c -Force'), [
    { op: 'delete', path: 'a' }, { op: 'delete', path: 'b' }, { op: 'delete', path: 'c' },
  ]);
  // move 动词不拆逗号（多源移动语义不明，宁缺勿错）
  assert.deepEqual(shellFileOps('Move-Item a,b dir'), []);
});

test('summarizeFileOps：每路径净状态折叠', () => {
  // 新建后多次修改 → 仍是新增
  let out = summarizeFileOps([
    { op: 'create', path: 'a.ts', turn: 1 },
    { op: 'modify', path: 'a.ts', turn: 1 },
    { op: 'modify', path: 'a.ts', turn: 2 },
  ]);
  assert.deepEqual(out.added.map(e => e.display), ['a.ts']);
  assert.deepEqual(out.added[0].turns, [1, 2]);
  assert.equal(out.total, 1);
  // 既有文件被改后删除 → 删除
  out = summarizeFileOps([
    { op: 'modify', path: 'b.ts', turn: 1 },
    { op: 'delete', path: 'b.ts', turn: 2 },
  ]);
  assert.deepEqual(out.deleted.map(e => e.display), ['b.ts']);
  // 本会话新建后又删除 → 净零，不展示
  out = summarizeFileOps([
    { op: 'create', path: 'c.tmp', turn: 1 },
    { op: 'delete', path: 'c.tmp', turn: 2 },
  ]);
  assert.deepEqual(out, EMPTY_FILE_CHANGES);
  // 既有文件删除后重建 → 修改（净效果：存在且内容变了）
  out = summarizeFileOps([
    { op: 'modify', path: 'd.ts', turn: 1 },
    { op: 'delete', path: 'd.ts', turn: 2 },
    { op: 'create', path: 'd.ts', turn: 3 },
  ]);
  assert.deepEqual(out.modified.map(e => e.display), ['d.ts']);
  // 本会话新建、删除、再新建 → 新增
  out = summarizeFileOps([
    { op: 'create', path: 'e.ts', turn: 1 },
    { op: 'delete', path: 'e.ts', turn: 2 },
    { op: 'create', path: 'e.ts', turn: 3 },
  ]);
  assert.deepEqual(out.added.map(e => e.display), ['e.ts']);
});

test('reconcileFileChanges：目录条目校准净状态', () => {
  // 场景：解析记录 a=新增 b=修改 c=删除 d=新增，但实际目录里只有 b、d
  // （a 建了又删；c 已不存在即删除为真；d 仍存在）
  const summary = summarizeFileOps([
    { op: 'create', path: 'a.tmp', turn: 1 },
    { op: 'modify', path: 'b.ts', turn: 1 },
    { op: 'delete', path: 'c.log', turn: 1 },
    { op: 'create', path: 'd.ts', turn: 1 },
  ]);
  assert.deepEqual(summary.added.map(e => e.display), ['a.tmp', 'd.ts']);
  // 顶层目录：a、c 不存在，b、d 存在
  const present = new Map([['', new Set(['b.ts', 'd.ts'])]]);
  const fixed = reconcileFileChanges(summary, present);
  // a 建了又删 → 净零剔除；c 删除为真 → 保留删除
  assert.deepEqual(fixed.added.map(e => e.display), ['d.ts']);
  assert.deepEqual(fixed.modified.map(e => e.display), ['b.ts']);
  assert.deepEqual(fixed.deleted.map(e => e.display), ['c.log']);
  assert.equal(fixed.total, 3);
  // 子目录路径按目录段匹配
  const nested = summarizeFileOps([{ op: 'create', path: 'src/x.ts', turn: 1 }]);
  const fixed2 = reconcileFileChanges(nested, new Map([['src', new Set(['x.ts'])]]));
  assert.deepEqual(fixed2.added.map(e => e.display), ['src/x.ts']);
  const fixed3 = reconcileFileChanges(nested, new Map([['src', new Set(['y.ts'])]]));
  assert.deepEqual(fixed3, EMPTY_FILE_CHANGES);
  // 修改但已不存在 → 改判删除
  const modThenGone = summarizeFileOps([{ op: 'modify', path: 'gone.ts', turn: 1 }]);
  const fixed4 = reconcileFileChanges(modThenGone, new Map([['', new Set(['other.ts'])]]));
  assert.deepEqual(fixed4.deleted.map(e => e.display), ['gone.ts']);
  // 删除但仍在（记录过期）→ 剔除
  const staleDel = summarizeFileOps([{ op: 'delete', path: 'kept.ts', turn: 1 }]);
  const fixed5 = reconcileFileChanges(staleDel, new Map([['', new Set(['kept.ts'])]]));
  assert.deepEqual(fixed5, EMPTY_FILE_CHANGES);
  // 未知目录（present 缺该目录）→ 不做判断，维持原样
  const fixed6 = reconcileFileChanges(summary, new Map());
  assert.equal(fixed6.total, summary.total);
});

test('resolveDisplayPath：相对化、大小写不敏感去重、越界保持绝对', () => {
  const winCwd = 'D:\\work\\proj';
  assert.equal(resolveDisplayPath('D:\\work\\proj\\src\\a.ts', winCwd).display, 'src/a.ts');
  // 展示保留路径的原始拼写（真实大小写），去重按 key 不区分大小写
  assert.equal(resolveDisplayPath('d:/WORK/proj/SRC/a.ts', winCwd).display, 'SRC/a.ts');
  assert.equal(resolveDisplayPath('D:\\work\\proj\\SRC\\a.ts', winCwd).key, resolveDisplayPath('D:\\work\\proj\\src\\a.ts', winCwd).key);
  // 相对参数按 cwd 解析
  assert.equal(resolveDisplayPath('src\\a.ts', winCwd).display, 'src/a.ts');
  // 工作区外：保持绝对（归一化斜杠）
  assert.equal(resolveDisplayPath('C:\\other\\b.txt', winCwd).display, 'C:/other/b.txt');
  // POSIX
  assert.equal(resolveDisplayPath('/home/u/w/src/a.ts', '/home/u/w').display, 'src/a.ts');
  // 无 cwd：只归一化
  assert.equal(resolveDisplayPath('a\\b\\c.ts').display, 'a/b/c.ts');
  // 共享祖先：../ 形式
  assert.equal(resolveDisplayPath('D:\\work\\other\\a.ts', winCwd).display, '../other/a.ts');
});

function toolNode(root: ToolCallBlock, turn: number, opts: { hidden?: boolean } = {}): ChatConversationViewNode {
  return {
    key: `chat:tool-call:${turn}`,
    target: 'chat',
    kind: 'tool-call',
    id: `t${turn}`,
    data: { root },
    anchorSeq: turn,
    location: { kind: 'step', turn: { turn } } as ChatConversationViewNode['location'],
    visibility: opts.hidden ? 'hidden' : 'visible',
  } as unknown as ChatConversationViewNode;
}

test('collectFileChanges：按节点窗口收集、去重、子调用计入、隐藏节点跳过', () => {
  const subagent = settled({
    callId: 'sub-root',
    call: { name: 'subagent', argsRaw: '{}' },
    callView: null,
    subCalls: [settled({
      callId: 'sub-1',
      call: { name: 'write', argsRaw: writeArgs('D:\\w\\child.txt') },
      content: [{ type: 'text', text: WRITE_CREATED }],
      callView: diffView('D:\\w\\child.txt'),
    })],
  });
  const edit = settled({
    callId: 'root-1',
    call: { name: 'edit', argsRaw: JSON.stringify({ file_path: 'D:\\w\\main.ts', old_string: 'a', new_string: 'b' }) },
    callView: { card: 'diff', title: 'Edit main.ts', diffs: [{ path: 'D:\\w\\main.ts', oldText: 'a', newText: 'b' }], locations: [{ path: 'D:\\w\\main.ts' }] },
  });
  const rm = settled({
    callId: 'root-2',
    call: { name: 'bash', argsRaw: JSON.stringify({ command: 'rm D:\\w\\gone.txt' }) },
    callView: { card: 'terminal', title: 'rm …' },
    resultView: { card: 'terminal', title: 'rm …', exitCode: 0 },
  });
  const nodes = new Map<string, ChatConversationViewNode>([
    ['n1', toolNode(edit, 1)],
    ['n2', toolNode(subagent, 2)],
    ['n3', toolNode(rm, 3)],
    ['n4', toolNode(settled({
      callId: 'hidden',
      call: { name: 'write', argsRaw: writeArgs('D:\\w\\hidden.txt') },
      content: [{ type: 'text', text: WRITE_CREATED }],
      callView: diffView('D:\\w\\hidden.txt'),
    }), 4, { hidden: true })],
  ]);
  const summary = collectFileChanges(['n1', 'n2', 'n3', 'n4'], key => nodes.get(key), 'D:\\w');
  assert.deepEqual(summary.added.map(e => e.display), ['child.txt']);
  assert.deepEqual(summary.modified.map(e => e.display), ['main.ts']);
  assert.deepEqual(summary.deleted.map(e => e.display), ['gone.txt']);
  assert.equal(summary.total, 3);
  // 隐藏（撤回）节点不计入
  assert.ok(!summary.added.some(e => e.display.includes('hidden')));
});

test('collectFileChanges：空窗口返回空汇总', () => {
  assert.deepEqual(collectFileChanges([], () => undefined, 'D:\\w'), EMPTY_FILE_CHANGES);
});

test('file review keeps applied diff records and counts shared context only once per edit', () => {
  const call = settled({ call: { name: 'edit', argsRaw: JSON.stringify({ file_path: 'a.ts', old_string: 'a', new_string: 'a\nb' }) }, meta: { diffs: [{ path: 'a.ts', oldText: 'a\n', newText: 'a\nb\n' }] } });
  const summary = collectFileChanges(['n'], () => toolNode(call, 1), 'D:/w');
  assert.equal(summary.total, 1);
  assert.deepEqual(fileChangeCounts(summary.modified[0]!), { added: 1, removed: 0 });
  assert.equal(summary.modified[0]!.edits?.[0]?.newText, 'a\nb\n');
  assert.equal(fileChangeCounts({ key: 'unknown', display: 'unknown', kind: 'modified', turns: [] }), null, 'missing counts are not zero counts');
});
