/**
 * 阅读流底部的「本会话文件改动」展示区。
 *
 * 可见条件（全部满足才显示）：
 * - 无运行对话：本插件已有的活动条判定（activity.key === null）+ 宿主 running 位 + 无待处理交互/排队消息；
 * - 无后台任务：本会话的 jobsBySession 里没有 running/stopping 的任务；
 * - 会话至少有一个轮次（空白会话不显示空态噪音）；
 * - 窗口已加载完成（loading 期间不显示）。
 * 执行中/有后台任务时整体隐藏（不占位、不渲染）。
 *
 * 内容来自 file-changes.ts 的纯推导（仅本会话已加载窗口）；更早历史未加载时
 * 以「仅已加载记录」标注，不假装全量。路径点击通过注入的 openFile 打开
 * （与原生对话视图同一 Host 打开器）；无 openFile 时退化为纯文本。
 *
 * 存在性校准：shell 删除（尤其 `Get-ChildItem … | Remove-Item` 这类管道命令）
 * 无法静态解析，建了又删的文件会留在「新增」里。挂载后按目录拉取条目名
 * （listDirNames），用 reconcileFileChanges 校准：新增且已不存在 → 净零剔除；
 * 修改且已不存在 → 改判删除；删除且仍存在 → 剔除。任一目录查询失败则放弃
 * 校准，维持解析结果（宁缺勿错）。
 *
 * 展示设计（v4）：收起时是一行（标题 + 文件数 + 新增/修改/删除标签）；展开后是与过程
 * 面板同款的面板，按操作分组列出路径（目录弱化、文件名主色），点击在右侧栏预览。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useChatSelector, useSessionSelector } from './compat/session-snapshot.js';
import { EMPTY_FILE_CHANGES, collectFileChanges, reconcileFileChanges } from './file-changes.js';
import type { FileChangeEntry, FileChangeKind, FileChangeSummary } from './file-changes.js';
import { CollapseBody, MountFade } from './motion.js';
import { Chevron } from './ProcessRow.js';
import type { ReaderProps } from './types.js';
import css from './FileChanges.module.css';

/** 展开后每组默认显示的文件数上限（超出折叠为「展开其余 N 个」）。 */
const FILE_LIMIT = 12;

export interface FileChangesPanelProps extends Pick<ReaderProps, 'useSession' | 'useSessions' | 'sessionId' | 'useProjection' | 'jobsSource' | 'watchJobs'> {
  order: readonly string[];
  motion: boolean;
  /** 窗口未加载完整（更早历史未拉取）。 */
  hasMore: boolean;
  /** 阅读视图活动判定：无开放轮次、无待处理交互、窗口已加载。 */
  conversationIdle: boolean;
  openFile?: (path: string) => void;
  /** 列目录条目名（存在性校准用）；缺省时跳过校准。 */
  listDirNames?: (path: string) => Promise<ReadonlySet<string>>;
}

export function FileChangesPanel({
  useSession, useSessions, sessionId, useProjection, jobsSource, watchJobs, order, motion, hasMore, conversationIdle, openFile, listDirNames,
}: FileChangesPanelProps) {
  const running = useSessionSelector(useSession, snapshot => snapshot.running);
  const inbox = useProjection('inbox');
  const localQueued = useSessionSelector(useSession, snapshot => snapshot.pendingSubmissions.some(item => item.placement === 'queued'));
  const queueBusy = localQueued || (inbox?.['next-turn'].length ?? 0) > 0;
  const turnCount = useChatSelector(useSession, chat => chat.timeline.turnOrder.length);
  const cwd = useSessions(list => list.byId[sessionId]?.cwd);
  useEffect(() => watchJobs(), [watchJobs]);
  const subscribeJobs = useMemo(() => (listener: () => void) => jobsSource.subscribe(listener), [jobsSource]);
  const liveJobs = useSyncExternalStore(subscribeJobs, () =>
    jobsSource.getSnapshot().rows[sessionId]?.some(job => job.status === 'running' || job.status === 'stopping') ?? false);
  const hidden = running || !conversationIdle || queueBusy || liveJobs || turnCount === 0;
  const nodes = useChatSelector(useSession, chat => hidden ? null : chat.nodes);
  // 忙时短路：流式期间窗口每个 chunk 都在变，避免白算。
  const summary = useMemo(
    () => (hidden || !nodes ? EMPTY_FILE_CHANGES : collectFileChanges(order, key => nodes.get(key), cwd)),
    [hidden, order, nodes, cwd],
  );
  // 存在性校准：shell 删除（尤其管道式命令）解析不到时，用目录条目集合把
  // 「建了又删」从新增里剔除、「误删」改判为删除。无 listDirNames 时跳过。
  const [adjusted, setAdjusted] = useState<FileChangeSummary>(summary);
  const auditSeq = useRef(0);
  useEffect(() => {
    setAdjusted(summary);
    if (hidden || !listDirNames || summary.total === 0) return;
    const seq = ++auditSeq.current;
    // 按 display 路径的目录段分组（'' = 顶层），去重后逐目录拉取条目名。
    const dirs = new Map<string, string[]>();
    for (const entry of [...summary.added, ...summary.modified, ...summary.deleted]) {
      const i = entry.display.lastIndexOf('/');
      const dir = i < 0 ? '' : entry.display.slice(0, i);
      const name = i < 0 ? entry.display : entry.display.slice(i + 1);
      const names = dirs.get(dir);
      if (names) { if (!names.includes(name)) names.push(name); }
      else dirs.set(dir, [name]);
    }
    let cancelled = false;
    (async () => {
      const present = new Map<string, ReadonlySet<string>>();
      const results = await Promise.allSettled([...dirs.keys()].map(async (dir) => {
        present.set(dir, await listDirNames(dir));
      }));
      if (cancelled || auditSeq.current !== seq) return;
      // 任一目录查询失败就放弃校准（宁缺勿错：宁可维持解析结果也不误删）。
      if (results.some(r => r.status === 'rejected')) return;
      setAdjusted(reconcileFileChanges(summary, present));
    })();
    return () => { cancelled = true; };
  }, [summary, hidden, listDirNames]);
  const [open, setOpen] = useState(false);
  // 空态（无文件改动，含校准后全部剔除）不渲染任何东西。
  const visible = !hidden && adjusted.total > 0;
  return <MountFade mounted={visible} motion={motion}>{({ entering }) => !visible ? null : (
    <section className={`${css.changes} ${entering ? css.entering : ''}`} data-reader-file-changes data-open={open} aria-label="本会话文件改动">
      <button type="button" className={css.header} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <Chevron open={open} />
        <span className={css.title}>本会话文件改动</span>
        <span className={css.meta}>{adjusted.total} 个文件{hasMore ? ' · 仅已加载记录' : ''}</span>
        <span className={css.tags} aria-hidden="true">
          {adjusted.added.length > 0 && <span className={css.tag} data-tone="added">新增 {adjusted.added.length}</span>}
          {adjusted.modified.length > 0 && <span className={css.tag} data-tone="modified">修改 {adjusted.modified.length}</span>}
          {adjusted.deleted.length > 0 && <span className={css.tag} data-tone="deleted">删除 {adjusted.deleted.length}</span>}
        </span>
      </button>
      <CollapseBody open={open} motion={motion}>
        <div className={css.body}>
          <FileGroup label="新增" tone="added" items={adjusted.added} openFile={openFile} />
          <FileGroup label="修改" tone="modified" items={adjusted.modified} openFile={openFile} />
          <FileGroup label="删除" tone="deleted" items={adjusted.deleted} openFile={openFile} />
        </div>
      </CollapseBody>
    </section>
  )}</MountFade>;
}

/** One operation group: label + count, then one path row per file (directory muted, name primary). */
function FileGroup({ label, tone, items, openFile }: {
  label: string; tone: FileChangeKind; items: readonly FileChangeEntry[]; openFile?: FileChangesPanelProps['openFile'];
}) {
  const [showAll, setShowAll] = useState(false);
  if (items.length === 0) return null;
  const visible = showAll ? items : items.slice(0, FILE_LIMIT);
  return <div className={css.group} data-tone={tone}>
    <div className={css.groupLabel}><span className={css.dot} aria-hidden="true" />{label} · {items.length}</div>
    {visible.map(item => {
      const cut = item.display.lastIndexOf('/');
      const directory = cut < 0 ? '' : item.display.slice(0, cut + 1);
      const name = cut < 0 ? item.display : item.display.slice(cut + 1);
      return <button key={item.key} type="button" className={css.file} title={item.display} disabled={!openFile} onClick={() => { void openFile?.(item.display); }}>
        {directory && <span className={css.directory}>{directory}</span>}<span className={css.name}>{name}</span>
      </button>;
    })}
    {items.length > visible.length && <button type="button" className={css.more} onClick={() => setShowAll(true)}>展开其余 {items.length - visible.length} 个</button>}
  </div>;
}
