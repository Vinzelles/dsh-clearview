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
 * 展示设计：摘要、前三个路径及可靠编辑行数；按需展开其余文件和只读差异审阅。
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useChatSelector, useSessionSelector } from './compat/session-snapshot.js';
import { EMPTY_FILE_CHANGES, collectFileChanges, reconcileFileChanges, fileChangeCounts } from './file-changes.js';
import type { FileChangeSummary } from './file-changes.js';
import { CollapseBody, MountFade } from './motion.js';
import { Chevron } from './ProcessRow.js';
import { DiffBlockL } from './native/labeled-blocks.js';
import type { ReaderProps } from './types.js';
import css from './FileChanges.module.css';

/** 卡片默认显示前三个文件，剩余文件由「再显示」展开。 */
const FILE_LIMIT = 3;

export interface FileChangesPanelProps extends Pick<ReaderProps, 'useSession' | 'useSessions' | 'sessionId' | 'useProjection' | 'jobsSource' | 'watchJobs'> {
  order: readonly string[];
  motion: boolean;
  /** 窗口未加载完整（更早历史未拉取）。 */
  hasMore: boolean;
  /** 阅读视图活动判定：无开放轮次、无待处理交互、窗口已加载。 */
  conversationIdle: boolean;
  openFile?: (path: string) => void | Promise<void>;
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
  const visible = !hidden && adjusted.total > 0;
  return <MountFade mounted={visible} motion={motion}>{({ entering }) => !visible ? null :
    <FileChangesCard summary={adjusted} motion={motion} hasMore={hasMore} openFile={openFile} entering={entering} />
  }</MountFade>;
}

/** A compact session summary, with three file rows visible before expanding the list. */
export function FileChangesCard({ summary, motion, hasMore, openFile, entering = false }: {
  summary: FileChangeSummary; motion: boolean; hasMore: boolean;
  openFile?: FileChangesPanelProps['openFile']; entering?: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const [review, setReview] = useState(false);
  const items = useMemo(() => [...summary.added, ...summary.modified, ...summary.deleted], [summary]);
  const counts = useMemo(() => items.map(fileChangeCounts), [items]);
  const known = counts.filter((item): item is NonNullable<typeof item> => item !== null);
  const totals = known.reduce((sum, item) => ({ added: sum.added + item.added, removed: sum.removed + item.removed }), { added: 0, removed: 0 });
  const visible = showAll ? items : items.slice(0, FILE_LIMIT);
  return <section className={`${css.changes} ${entering ? css.entering : ''}`} data-reader-file-changes data-open={review} aria-label="本会话文件改动">
    <div className={css.header}>
      <span className={css.icon} aria-hidden="true"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 3h12v14H4zM10 6v7M6.5 9.5h7" /></svg></span>
      <div className={css.heading}>
        <strong className={css.title}>已改动 {summary.total} 个文件</strong>
        <div className={css.meta}>
          {known.length > 0 && <span className={css.stats} title="已加载工具编辑的累计行数，不代表工作区净差异"><span data-add>+{totals.added}</span><span data-del>−{totals.removed}</span></span>}
          {hasMore && <span>仅已加载记录</span>}
          {known.length > 0 && known.length < items.length && <span>部分行数可用</span>}
        </div>
      </div>
      <button className={css.reviewButton} data-reader-file-review-toggle type="button" aria-expanded={review} onClick={() => setReview(value => !value)}>{review ? '关闭审阅' : '审阅'}</button>
    </div>
    <div className={css.body}>
      {visible.map((item, index) => { const stat = counts[index]; return <div className={css.fileRow} key={item.key} data-reader-changed-file>
        <button type="button" className={css.file} title={item.display} disabled={!openFile} onClick={() => openFileQuietly(openFile, item.display)}>{item.display}</button>
        {stat ? <span className={css.stats} aria-label={`增加 ${stat.added} 行，删除 ${stat.removed} 行`}><span data-add>+{stat.added}</span><span data-del>−{stat.removed}</span></span>
          : <span className={css.kind}>{item.kind === 'added' ? '新增' : item.kind === 'deleted' ? '删除' : '修改'}</span>}
      </div>; })}
      {items.length > FILE_LIMIT && <button type="button" className={css.more} aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? '收起文件列表' : `再显示 ${items.length - FILE_LIMIT} 个文件`}<Chevron open={showAll} /></button>}
    </div>
    <CollapseBody open={review} motion={motion}><div className={css.review} data-reader-file-review>{review && <>
      <p className={css.scope}>以下为本会话已加载的工具编辑记录；同一文件的多次编辑按记录顺序展示。</p>
      {items.map(item => <div className={css.reviewFile} key={item.key}>
        {item.edits?.length ? <DiffBlockL diffs={item.edits.map(edit => ({ path: item.display, ...edit }))} maxLines={24} />
          : <><strong>{item.display}</strong><p className={css.scope}>此记录没有可用的逐行差异。</p></>}
      </div>)}
    </>}</div></CollapseBody>
  </section>;
}

/** The host opener may reject (missing file, no handler); a click must never surface that as an unhandled rejection. */
export function openFileQuietly(openFile: FileChangesPanelProps['openFile'], path: string): void {
  try { void Promise.resolve(openFile?.(path)).catch(() => {}); } catch { /* a synchronous throw degrades the same way */ }
}
