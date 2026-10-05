import { useEffect, useMemo, useRef, useState } from 'react';
import { FileChangesPanel } from './FileChanges.js';
import { TurnSection } from './TurnSection.js';
import { formatSeconds } from './turn-activity.js';
import { useTurnActivity } from './use-turn-activity.js';
import { MountFade, useContentWidth, useMotionAllowed, usePinnedSelection, useReadingScroll } from './motion.js';
import { StreamMotionContext } from './streaming.js';
import { ReaderActionsContext, type ReaderActions } from './reader-context.js';
import { useCompatReaderProps, useChatSelector, usePendingSelector, useSessionSelector, readerSnapshot } from './compat/session-snapshot.js';
import { READER_COMPAT_MOUNT_EVENT, READER_COMPAT_UNMOUNT_EVENT, registerReaderSnapshot } from './compat/reader-root.js';
import { createReaderStructureSelector } from './reader-selection.js';
import { READER_VERSION } from './version.js';
import type { ReaderProps } from './types.js';
import css from './Reader.module.css';

function Switch({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: () => void; title?: string }) {
  return <button type="button" className={css.switchButton} role="switch" aria-checked={checked} onClick={onChange} title={title}>
    <span className={css.switchLabel} data-checked={checked}>{label}</span>
  </button>;
}

export function Reader(rawProps: ReaderProps) {
  // 0.1.2 把 chat / pending 拆成了独立标准钩子；这里合成回 0.1.1 形状并替换
  // props.useSession；热路径按 chat/session/pending 域直接在宿主选择，避免全量订阅。
  const props = useCompatReaderProps(rawProps);
  const root = useRef<HTMLDivElement>(null);
  const activatedAt = useRef(Date.now());
  const selectStructure = useMemo(createReaderStructureSelector, [props.sessionId]);
  const { visibleOrder, groups, hidden: rewindHidden, spans: rewindSpans, latestUserKey } = useChatSelector(props.useSession, selectStructure);
  const pending = usePendingSelector(props.useSession, value => value, (a, b) => a.length === b.length && a.every((item, index) => item === b[index]));
  const openError = useSessionSelector(props.useSession, snapshot => snapshot.openError);
  const loading = useSessionSelector(props.useSession, snapshot => snapshot.openState === 'loading');
  const hasMore = useSessionSelector(props.useSession, snapshot => snapshot.hasMore);
  const loadingOlder = useSessionSelector(props.useSession, snapshot => snapshot.loadingOlder);
  const motionPreference = props.useStore(state => state.motion);
  const collapseThinking = props.useStore(state => state.collapseThinking ?? false);
  const motion = useMotionAllowed(motionPreference);
  const activity = useTurnActivity(props.useSession);
  // 阅读流空闲判定（文件改动展示区的可见条件之一）：无开放轮次活动、无待处理交互、窗口已加载。
  const conversationIdle = !activity.key && pending.length === 0 && !loading;
  const streamMotion = useMemo(() => ({ enabled: motion, activatedAt: activatedAt.current }), [motion]);
  const scroll = useReadingScroll(root, motion);
  const { openFile, fork, fileMentions, inspectCall, openView } = props;
  // One value for every row: motion, host file/fork/inspect/view actions.
  const actions = useMemo<ReaderActions>(() => ({
    motion,
    openFile: openFile ? path => { void openFile(path).catch(() => {}); } : undefined,
    fork,
    fileMentions,
    inspectCall,
    showInChat: focus => openView('chat', focus),
  }), [motion, openFile, fork, fileMentions, inspectCall, openView]);
  // 兼容层根发现：阅读根是运行中在深层会话容器里挂载/卸载的，body 级观察器看不到
  // 它；由本组件在根挂载/卸载时广播事件，rewind 桥 / 轮统计行 / 收尾防吞只监听
  // 事件（见 compat/reader-root.ts watchReaderRoots），不在 body 上做全树观察。
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const unregister = registerReaderSnapshot(node, () => readerSnapshot(props.useSession));
    document.dispatchEvent(new CustomEvent<HTMLElement>(READER_COMPAT_MOUNT_EVENT, { detail: node }));
    return () => { document.dispatchEvent(new CustomEvent<HTMLElement>(READER_COMPAT_UNMOUNT_EVENT, { detail: node })); unregister(); };
  }, [props.useSession]);
  // The activity bar animates its width between label changes: `transition:
  // width` needs an explicit pixel value, so the content row's natural width
  // is tracked and pinned back onto the bar.
  const [trackActivityWidth, activityWidth] = useContentWidth();
  // The activity bar floats above the sticky composer. Sticky alone cannot
  // lift it when the transcript is shorter than the scrollport (no overflow,
  // nothing to stick against): the column must fill the scrollport so
  // margin-top:auto can push the bar to the screen bottom. Measure host
  // height minus the composer (a live CSS variable the host maintains on
  // the scroller) minus our own vertical padding.
  useEffect(() => {
    const content = root.current;
    if (!content) return;
    const host = content.closest<HTMLElement>('[data-conversation-scroll]');
    if (!host) return;
    const fit = () => {
      const composer = parseFloat(getComputedStyle(host).getPropertyValue('--dsh-composer-height')) || 152;
      const own = getComputedStyle(content);
      const padding = (parseFloat(own.paddingTop) || 0) + (parseFloat(own.paddingBottom) || 0);
      content.style.setProperty('--reader-flow-min-height', `${Math.max(0, host.clientHeight - composer - padding)}px`);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(host);
    // The host writes --dsh-composer-height onto the scroller's style attr.
    const attributes = new MutationObserver(fit);
    attributes.observe(host, { attributes: true, attributeFilter: ['style'] });
    return () => { observer.disconnect(); attributes.disconnect(); };
  }, []);
  const seenUserKeys = useRef(new Set<string>());
  const previousLatestUserKey = useRef<string | null>(null);
  useEffect(() => {
    const previous = previousLatestUserKey.current;
    const latest = latestUserKey;
    if (latest && previous && latest !== previous && !seenUserKeys.current.has(latest)) {
      const previousIndex = visibleOrder.indexOf(previous);
      const latestIndex = visibleOrder.indexOf(latest);
      // Only a user message appended after the previous latest user message
      // should force the viewport to the bottom; loading older history adds
      // older keys before the current latest and must not yank the reader.
      if (previousIndex >= 0 && latestIndex > previousIndex) scroll.jump();
    }
    if (latest) seenUserKeys.current.add(latest);
    previousLatestUserKey.current = latest;
  }, [latestUserKey]);
  const pinnedKeys = usePinnedSelection(root);
  const selectedProcessKeys = usePinnedSelection(root, '[data-reader-process]');
  const [historyError, setHistoryError] = useState(false);
  // 「本会话文件改动」作为最后一个轮次的收尾插槽（见 groups.map）。
  const fileChanges = useMemo(() => (
    <FileChangesPanel
      useProjection={props.useProjection}
      jobsSource={props.jobsSource}
      watchJobs={props.watchJobs}
      useSession={props.useSession}
      useSessions={props.useSessions}
      sessionId={props.sessionId}
      order={visibleOrder}
      motion={motion}
      hasMore={hasMore}
      conversationIdle={conversationIdle}
      openFile={props.openFile}
      listDirNames={props.listDirNames}
    />
  ), [props.useProjection, props.jobsSource, props.watchJobs, props.useSession, props.useSessions, props.sessionId, visibleOrder, motion, hasMore, conversationIdle, props.openFile, props.listDirNames]);
  return <StreamMotionContext.Provider value={streamMotion}><ReaderActionsContext.Provider value={actions}>
    <div ref={root} className={css.root} data-dsh-clearview={READER_VERSION} data-motion={motion ? 'on' : 'off'}>
      <div className={css.column}>
        <div className={css.toolbar} data-ud-check="reader-toolbar">
          <Switch label={`折叠思考${collapseThinking ? '开' : '关'}`} checked={collapseThinking} onChange={() => props.actions.setCollapseThinking(!collapseThinking)}
            title="开启后，已完成的思考只保留一行；关闭后显示前三行预览。" />
          <Switch label={`动效${motionPreference ? '开' : '关'}`} checked={motionPreference} onChange={() => props.actions.setMotion(!motionPreference)}
            title="新到文字柔和显现，过程平滑展开；关闭后立即完整显示，自动遵循系统减少动态效果设置。" />
        </div>
        {hasMore && <button type="button" className={css.historyButton} disabled={loadingOlder} onClick={async () => {
          setHistoryError(false);
          try { await props.loadOlder(); } catch { setHistoryError(true); }
        }}>{loadingOlder ? '正在加载更早记录' : '加载更早记录'}</button>}
        {historyError && <div className={css.notice}>历史记录加载失败，可再次尝试；现有内容未改变。</div>}
        {openError && <div className={css.error} role="alert">会话暂时无法读取：{openError.message}</div>}
        {loading && groups.length === 0 && <p className={css.empty} role="status">正在读取会话…</p>}
        {groups.map((group, index) => <TurnSection key={group.key} {...props} group={group} pinnedKeys={pinnedKeys} selectedProcessKeys={selectedProcessKeys}
          rewindHidden={rewindHidden} rewindSpans={rewindSpans} flowTail={index === groups.length - 1 ? fileChanges : undefined} />)}
        {pending.length > 0 && <MountFade mounted={pending.length > 0} motion={motion}>{({ entering }) =>
          <div className={`${css.attention} ${entering ? css.isEntering : css.isIn}`} role="alert" data-reader-attention>
            <strong>{pending.some(item => item.kind === 'question') ? '需要你回答一个问题' : '需要你的确认'}</strong>
            <span>请在下方原生操作区处理。此提示不会收进执行过程。</span>
          </div>}</MountFade>}
        <MountFade mounted={!!activity.key} motion={motion}>{({ entering }) => activity.key ? (
          <button type="button" className={`${css.activityBar} ${entering ? css.isEntering : css.isIn}`}
            style={activityWidth === null ? undefined : { width: `${activityWidth}px` }}
            data-detached={scroll.detached ? 'true' : undefined}
            data-phase={activity.phase} data-ud-check="reader-activity-bar"
            title={scroll.detached ? '回到最新' : undefined} onClick={scroll.jump}>
            <span className={css.activityBarContent} ref={trackActivityWidth}>
              <span className={css.activityText} role="status" data-reader-activity-label>{activity.label}</span>
              {activity.seconds !== null && (
                <span className={css.activityTimer} data-reader-activity-timer aria-hidden="true">{formatSeconds(activity.seconds)}</span>
              )}
            </span>
          </button>
        ) : null}</MountFade>
        <MountFade mounted={scroll.detached && !activity.key} motion={motion}>{({ entering }) => scroll.detached && !activity.key ? (
          <div className={`${css.jumpDock} ${entering ? css.isEntering : css.isIn}`}><button type="button" className={css.jump} onClick={scroll.jump} aria-label="回到最新" title="回到最新">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 3v10m-4-4 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button></div>
        ) : null}</MountFade>
      </div>
    </div>
  </ReaderActionsContext.Provider></StreamMotionContext.Provider>;
}
