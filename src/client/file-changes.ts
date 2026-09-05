/**
 * 从已加载的会话窗口推导「本会话实际发生的文件改动」（纯计算：无 DOM、无网络、
 * 无 React 依赖，可单测）。
 *
 * 分类口径（新增/修改/删除不混淆）：
 * - 新增／修改：取文件变更工具的渲染意图（diff 卡片 / generic kind=edit，与原生
 *   deliverables 同一词汇表），并用工具结果文本消歧 —— `write` 的结果固定是
 *   「Created file」或「Updated file」；`str_replace_editor` 的 create 命令是
 *   新增、str_replace/insert 是修改。渲染意图缺失时退回参数里的 file_path/path。
 * - 删除：核心工具集没有文件删除工具，删除只发生在 shell 里。只统计 shell 工具
 *   （pwsh/bash/…或 terminal 卡片）成功执行（未报错且退出码非 0 不计）的移除
 *   命令：rm / rmdir / del / erase / Remove-Item / git rm / mv / Move-Item 等；
 *   动态令牌（通配符、变量、嵌套表达式、未闭合引号）一律跳过，宁缺勿错。
 * - 每路径净状态（按日志顺序折叠）：本会话内新建后又删除的文件净零不展示；
 *   会话前已存在、被改后删除的是「删除」；先建后改多次仍是「新增」；
 *   重命名（mv）表现为源「删除」+ 目标「新增」。
 * - 路径统一正斜杠并相对会话 cwd 展示；Windows 下按大小写不敏感去重。
 *
 * 统计范围 = 传入的节点窗口（调用方传阅读视图已过滤撤回隐藏后的可见顺序）。
 * 窗口可能不完整（更早历史未加载），由调用方以 `hasMore` 提示，本模块不假装全量。
 *
 * 已知边界（有意不做）：shell 间接创建/修改（`> file` 重定向、git checkout 回退等）
 * 与未声明变更渲染意图的插件工具（如技能库写入）不进入统计——它们无法可靠分类。
 */
import type { ChatConversationViewNode, ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client';
import { executionFacts, inputFields, stringValue } from './tool-activity.js';

export type FileChangeKind = 'added' | 'modified' | 'deleted';
export type FileOpKind = 'create' | 'modify' | 'delete';

/** 一次文件路径操作（path 为原始写法，展示归一化在汇总阶段做）。 */
export interface FileOp { op: FileOpKind; path: string }
/** 带归属轮次的操作（汇总输入）。 */
export interface TimedOp extends FileOp { turn: number | null }

export interface FileChangeEntry { key: string; display: string; kind: FileChangeKind; turns: number[] }
export interface FileChangeSummary {
  added: FileChangeEntry[];
  modified: FileChangeEntry[];
  deleted: FileChangeEntry[];
  total: number;
}

export const EMPTY_FILE_CHANGES: FileChangeSummary = { added: [], modified: [], deleted: [], total: 0 };

type SettledToolCall = Extract<ToolCallBlock, { kind: 'tool-result' }>;
function isSettled(block: ToolCallBlock): block is SettledToolCall {
  return 'kind' in block;
}

/** 渲染意图的最小结构读取面（不依赖 dsh-tools 类型，按形状收窄）。 */
interface CallViewLike {
  card?: unknown;
  kind?: unknown;
  locations?: readonly { path?: unknown }[] | null;
  diffs?: readonly { path?: unknown }[] | null;
}
function viewOf(view: unknown): CallViewLike | null {
  return view && typeof view === 'object' ? view as CallViewLike : null;
}
function viewPaths(view: CallViewLike): string[] {
  const out: string[] = [];
  for (const item of view.locations ?? []) if (typeof item.path === 'string' && item.path) out.push(item.path);
  if (out.length === 0) for (const item of view.diffs ?? []) if (typeof item.path === 'string' && item.path) out.push(item.path);
  return [...new Set(out)];
}

const SHELL_TOOL_NAMES = new Set(['bash', 'shell', 'sh', 'terminal', 'exec_command', 'pwsh', 'cmd']);
const MUTATOR_TOOL_NAMES = new Set(['write', 'edit', 'str_replace_editor']);

function resultText(block: SettledToolCall): string {
  const parts: string[] = [];
  for (const item of block.content) if (item.type === 'text') parts.push(item.text);
  return parts.join('\n');
}

/** diff 卡片一次改动的净效果：create（新建）还是 modify（改既有）。 */
function diffOpFor(normName: string, args: Record<string, unknown>, block: SettledToolCall): 'create' | 'modify' {
  const text = resultText(block);
  if (normName === 'write') {
    // write 工具的成功结果固定为「Created file」或「Updated file」（formatWriteOutput）。
    if (/(^|\n)\s*Created file/m.test(text)) return 'create';
    if (/(^|\n)\s*Updated file/m.test(text)) return 'modify';
    // 结果文本缺失时退回 presentationMeta：create 的 before 为 null，diffs 恒为空数组。
    const meta = block.meta;
    if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
      const diffs = (meta as { diffs?: unknown }).diffs;
      if (Array.isArray(diffs) && diffs.length === 0) return 'create';
    }
    return 'modify';
  }
  if (normName === 'str_replace_editor') return stringValue(args, 'command') === 'create' ? 'create' : 'modify';
  if (/new file created successfully|has been created successfully/i.test(text)) return 'create';
  return 'modify';
}

const REMOVE_VERBS = new Set(['rm', 'rmdir', 'rd', 'unlink', 'shred', 'trash', 'del', 'erase', 'remove-item', 'ri']);
const MOVE_VERBS = new Set(['mv', 'move', 'move-item', 'rename-item', 'rename', 'ren']);

/** 单段 /x（无斜杠/冒号续段）在 Windows 语境是标志位（del /s /q），不是路径。 */
function isPathToken(token: string): boolean {
  if (!token || token.startsWith('\u0000')) return false;
  if (token.startsWith('-')) return false;
  if (token === '.' || token === '..') return false;
  if (token === '/' || /^[a-z]:\/?$/i.test(token)) return false;
  if (/^\/[^/:]*$/.test(token)) return false;
  // 含逗号：PowerShell 数组字面量（'a','b' / a,b），不是单个路径。
  if (token.includes(',')) return false;
  if (/^[,\'"`]|[,'"`]$/.test(token)) return false;
  if (/[?*${}()`%]/.test(token)) return false;
  if (/^[<>|&]+$/.test(token)) return false;
  if (/^\d+$/.test(token)) return false;
  return true;
}

function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < segment.length) {
    while (i < segment.length && /\s/.test(segment[i])) i++;
    if (i >= segment.length) break;
    const ch = segment[i];
    if (ch === '"' || ch === "'") {
      i++;
      let value = '';
      while (i < segment.length && segment[i] !== ch) value += segment[i++];
      const closed = i < segment.length;
      if (closed) i++;
      // 未闭合、或引号后又紧连内容（'a'x 这类内嵌写法）→ 整体视为不可解析。
      // 引号后跟逗号（'a','b'）是 PowerShell 数组写法：消费逗号当分隔符，
      // 逗号后紧跟下一个引号（数组连写）同样合法——两种情况都算可解析。
      let commaArray = false;
      if (closed && i < segment.length && segment[i] === ',') {
        i++;
        if (i < segment.length && (segment[i] === '"' || segment[i] === "'")) commaArray = true;
      }
      const ok = closed && (commaArray || i >= segment.length || /\s/.test(segment[i]));
      tokens.push(ok ? value : '\u0000' + value);
    } else {
      let value = '';
      while (i < segment.length && !/\s/.test(segment[i])) value += segment[i++];
      tokens.push(value);
    }
  }
  return tokens;
}

/** 从一条 shell 命令里提取可确定命名的移除/移动操作。解析不了就返回空。 */
export function shellFileOps(command: string): FileOp[] {
  const ops: FileOp[] = [];
  if (!command) return ops;
  for (const segment of command.split(/&&|\|\||\||;|\n|`/)) {
    const tokens = tokenize(segment);
    if (tokens.length === 0) continue;
    let verb: 'remove' | 'move' | null = null;
    let rest: string[] = [];
    const first = tokens[0];
    if (first.toLowerCase() === 'git' && tokens.length > 1) {
      const sub = tokens[1].toLowerCase();
      if (sub === 'rm') { verb = 'remove'; rest = tokens.slice(2); }
      else if (sub === 'mv') { verb = 'move'; rest = tokens.slice(2); }
    } else {
      const head = first.replace(/^&/, '').toLowerCase();
      if (REMOVE_VERBS.has(head)) { verb = 'remove'; rest = tokens.slice(1); }
      else if (MOVE_VERBS.has(head)) { verb = 'move'; rest = tokens.slice(1); }
    }
    if (!verb) continue;
    // PowerShell 逗号数组：`Remove-Item a,b,c` / `Remove-Item 'a','b'` 是一次传
    // 多个路径参数。只对移除动词拆分（move 的逗号数组语义是「多源移动」，无法
    // 为每个源解析目标，保持宁缺勿错）；拆分后逐段剥引号再校验。
    const expanded: string[] = [];
    for (const token of rest) {
      if (verb === 'remove' && token.includes(',')) {
        for (const part of token.split(',')) {
          const trimmed = part.replace(/^['"]+|['"]+$/g, '');
          if (trimmed) expanded.push(trimmed);
        }
      } else {
        expanded.push(token);
      }
    }
    const paths = expanded.filter(isPathToken);
    if (verb === 'remove') {
      for (const path of paths) ops.push({ op: 'delete', path });
    } else if (paths.length === 2) {
      // 恰好两个路径才可判定：mv 多源入目录无法为每个源解析目标名，宁缺勿错。
      ops.push({ op: 'delete', path: paths[0] });
      ops.push({ op: 'create', path: paths[1] });
    }
  }
  return ops;
}

/** 一次已结算工具调用贡献的文件操作（递归入口在 collectFileChanges）。 */
export function fileOpsOf(block: ToolCallBlock): FileOp[] {
  if (!isSettled(block) || block.isError) return [];
  const normName = (block.call?.name ?? '').trim().toLowerCase();
  const args = inputFields(block.call?.argsRaw);
  const view = viewOf(block.callView);
  if (view && view.card === 'diff') {
    const op = diffOpFor(normName, args, block);
    return viewPaths(view).map(path => ({ op, path }));
  }
  if (view && view.card === 'generic') {
    const paths = viewPaths(view);
    if (view.kind === 'edit') return paths.map(path => ({ op: 'modify' as const, path }));
    if (view.kind === 'delete') return paths.map(path => ({ op: 'delete' as const, path }));
    return [];
  }
  if (view && view.card === 'terminal' || SHELL_TOOL_NAMES.has(normName)) {
    // 删除只认「成功执行过的移除命令」：出错或退出码非 0 的命令不算数。
    const facts = executionFacts(block);
    if (facts.signal || (facts.exitCode !== undefined && facts.exitCode !== 0)) return [];
    return shellFileOps(stringValue(args, 'command', 'cmd', 'script') ?? '');
  }
  // 渲染意图缺失（晚到的重放可能不带 view）时退回已知变更工具 + 参数路径。
  if (MUTATOR_TOOL_NAMES.has(normName)) {
    const path = stringValue(args, 'file_path', 'path', 'filePath');
    return path ? [{ op: diffOpFor(normName, args, block), path }] : [];
  }
  return [];
}

const WINDOWS_ABS = /^[a-z]:[\\/]/i;
function isWindowsPath(path: string): boolean {
  return WINDOWS_ABS.test(path) || path.startsWith('\\\\');
}
function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || WINDOWS_ABS.test(path);
}
/** 归一化：去首尾空白、反斜杠转正斜杠、折叠多余斜杠。 */
export function normalizePath(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}
function joinPaths(base: string, rel: string): string {
  return base.replace(/\/+$/, '') + '/' + rel;
}
function relativize(abs: string, cwd: string, win: boolean): string {
  const root = normalizePath(cwd).replace(/\/+$/, '');
  const eq = (a: string, b: string) => (win ? a.toLowerCase() === b.toLowerCase() : a === b);
  const startWith = (a: string, b: string) => (win ? a.toLowerCase().startsWith(b.toLowerCase()) : a.startsWith(b));
  if (eq(abs, root)) return '.';
  if (root !== '' && startWith(abs, root + '/')) return abs.slice(root.length + 1);
  const a = abs.split('/');
  const c = root.split('/');
  let common = 0;
  const n = Math.min(a.length, c.length);
  for (let i = 0; i < n; i++) {
    if (eq(a[i], c[i])) common = i + 1;
    else break;
  }
  if (common === 0) return abs; // 不同盘符/无公共祖先 → 保持绝对路径
  const up = c.length - common;
  return Array.from({ length: up }, () => '..').concat(a.slice(common)).join('/');
}

/** 展示/去重用的路径对：key 全量归一（Windows 不区分大小写），display 相对 cwd。 */
export function resolveDisplayPath(rawPath: string, cwd?: string): { key: string; display: string } {
  const raw = normalizePath(rawPath);
  if (!raw) return { key: '', display: '' };
  const win = isWindowsPath(raw) || (cwd !== undefined && isWindowsPath(cwd));
  const abs = isAbsolutePath(raw) ? raw : cwd ? joinPaths(normalizePath(cwd), raw) : raw;
  const display = cwd ? (relativize(abs, cwd, win) || abs) : abs;
  const key = (win ? abs.toLowerCase() : abs) || (win ? raw.toLowerCase() : raw);
  return { key, display: display || raw };
}

/** 按日志顺序折叠为每路径净状态，输出新增/修改/删除三类。 */
export function summarizeFileOps(ops: readonly TimedOp[], cwd?: string): FileChangeSummary {
  interface State { key: string; display: string; first: 'create' | 'touch'; last: FileOpKind; turns: number[] }
  const byKey = new Map<string, State>();
  for (const op of ops) {
    if (!op.path) continue;
    const { key, display } = resolveDisplayPath(op.path, cwd);
    if (!key) continue;
    let state = byKey.get(key);
    if (!state) {
      state = { key, display, first: op.op === 'create' ? 'create' : 'touch', last: op.op, turns: [] };
      byKey.set(key, state);
    } else {
      state.last = op.op;
    }
    if (op.turn !== null && !state.turns.includes(op.turn)) state.turns.push(op.turn);
  }
  const added: FileChangeEntry[] = [];
  const modified: FileChangeEntry[] = [];
  const deleted: FileChangeEntry[] = [];
  for (const state of byKey.values()) {
    let kind: FileChangeKind | null;
    if (state.last === 'delete') kind = state.first === 'create' ? null : 'deleted';
    else kind = state.first === 'create' ? 'added' : 'modified';
    if (kind === null) continue; // 本会话内建了又删 → 净零
    const entry: FileChangeEntry = { key: state.key, display: state.display, kind, turns: state.turns };
    if (kind === 'added') added.push(entry);
    else if (kind === 'deleted') deleted.push(entry);
    else modified.push(entry);
  }
  return { added, modified, deleted, total: added.length + modified.length + deleted.length };
}

/**
 * 用目录存在性校准净状态：shell 删除（尤其管道式 `Get-ChildItem … | Remove-Item`）
 * 无法静态解析时，删除操作会缺失，建了又删的文件会错误地留在「新增」里。
 * 以各目录的实际条目名集合为准：
 * - 新增 且 已不存在 → 净零（建了又删），剔除；
 * - 修改 且 已不存在 → 会话内被删（删除操作没被解析到），改判「删除」；
 * - 删除 且 仍存在  → 记录过期（之后被重建过），剔除；
 * - 其余保持不变。present 的键是 display 路径的目录段（'' 表示顶层），
 *   值是该目录下的条目名集合（比较不区分大小写）。
 */
export function reconcileFileChanges(
  summary: FileChangeSummary,
  present: ReadonlyMap<string, ReadonlySet<string>>,
): FileChangeSummary {
  const exists = (display: string): boolean | undefined => {
    const i = display.lastIndexOf('/');
    const dir = i < 0 ? '' : display.slice(0, i);
    const name = (i < 0 ? display : display.slice(i + 1)).toLowerCase();
    const names = present.get(dir);
    if (!names) return undefined;
    for (const n of names) if (n.toLowerCase() === name) return true;
    return false;
  };
  const added: FileChangeEntry[] = [];
  const modified: FileChangeEntry[] = [];
  const deleted: FileChangeEntry[] = [];
  for (const entry of summary.added) {
    const state = exists(entry.display);
    if (state === false) continue; // 建了又删 → 净零
    added.push(entry);
  }
  for (const entry of summary.modified) {
    const state = exists(entry.display);
    if (state === false) { deleted.push({ ...entry, kind: 'deleted' }); continue; }
    modified.push(entry);
  }
  for (const entry of summary.deleted) {
    const state = exists(entry.display);
    if (state === true) continue; // 删除后又重建 → 记录过期
    deleted.push(entry);
  }
  return { added, modified, deleted, total: added.length + modified.length + deleted.length };
}

function walk(block: ToolCallBlock, turn: number | null, ops: TimedOp[], seen: Set<string>): void {
  // 子调用在根结算前依次落定：先子后根 ≈ 日志顺序。
  for (const sub of block.subCalls) {
    if (seen.has(sub.callId)) continue;
    seen.add(sub.callId);
    walk(sub, turn, ops, seen);
  }
  for (const op of fileOpsOf(block)) ops.push({ ...op, turn });
}

/** 会话窗口 → 文件改动汇总。order 传调用方已过滤（撤回/隐藏）后的可见节点顺序。 */
export function collectFileChanges(
  order: readonly string[],
  getNode: (key: string) => ChatConversationViewNode | undefined,
  cwd?: string,
): FileChangeSummary {
  const ops: TimedOp[] = [];
  for (const key of order) {
    const node = getNode(key);
    if (!node || node.visibility === 'hidden' || node.kind !== 'tool-call') continue;
    const root = (node.data as { root?: ToolCallBlock }).root;
    if (!root) continue;
    const turn = node.location.kind === 'step' || node.location.kind === 'turn' ? node.location.turn.turn : null;
    walk(root, turn, ops, new Set<string>());
  }
  return summarizeFileOps(ops, cwd);
}