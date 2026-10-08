import { Fragment, useId, useMemo } from 'react';
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client';
import type { ReactNode } from 'react';
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import { ClusterRow } from './ClusterRow.js';
import { CollapseBody, StatusText } from './motion.js';
import { groupOperations, groupSteps, mergeThoughts, type PanelCounts, type PanelItem, type PanelStatus } from './process-steps.js';
import css from './ProcessPanel.module.css';

const DOT: Record<Exclude<PanelStatus, 'running'>, 'done' | 'error' | 'warning' | 'idle'> = {
  done: 'done', interrupted: 'error', error: 'error', waiting: 'warning', unknown: 'idle',
};

export interface ProcessPanelProps {
  panelKey: string;
  status: PanelStatus;
  statusLabel: string;
  elapsed: string | null;
  counts: PanelCounts;
  items: readonly PanelItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Explicit reading inside the panel (opening a cluster) pins it open. */
  onRead: () => void;
  earlierOpen: boolean;
  onEarlierOpen: () => void;
  motion: boolean;
  /** Resolves record nodes, to tell command records from the rest. */
  get: (key: string) => ChatConversationViewNode | undefined;
  turnClosed: boolean;
  renderItem: (item: PanelItem) => ReactNode;
  /** A settled thought merged with the one healthy operation after it. */
  renderThought: (thought: PanelItem, operation: PanelItem) => ReactNode;
}

/** One turn's process: a plain status header row and, below it, the rows in time order with tool runs clustered. */
export function ProcessPanel(props: ProcessPanelProps) {
  const bodyId = useId();
  const condense = props.status !== 'done' && !props.earlierOpen;
  const layout = useMemo(() => groupSteps(props.items, { condense }), [props.items, condense]);
  const rows = useMemo(() => mergeThoughts(groupOperations(layout.visible, props.get, props.turnClosed), props.get, props.turnClosed), [layout.visible, props.get, props.turnClosed]);
  const { counts } = props;
  const meta: ReactNode[] = [];
  if (props.elapsed) meta.push(<span key="elapsed" className={`${css.meta} ${css.elapsed}`}>{props.elapsed}</span>);
  if (counts.steps > 0) meta.push(<span key="steps" className={css.meta}>{counts.steps} 步</span>);
  if (counts.tools > 0) meta.push(<span key="tools" className={css.meta}>{counts.tools} 次工具</span>);
  if (counts.failed > 0) meta.push(<span key="failed" className={`${css.meta} ${css.metaDanger}`}>{counts.failed} 次失败</span>);
  return <div className={css.panel} data-reader-panel data-status={props.status}>
    <div className={css.header} data-reader-disclosure data-expanded={props.open}>
      <button type="button" className={css.headerButton} aria-expanded={props.open} aria-controls={bodyId}
        aria-label={`${props.open ? '收起' : '展开'}执行过程，${props.statusLabel}`} onClick={() => props.onOpenChange(!props.open)}>
        <svg className={css.headerChevron} data-open={props.open} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
        <span className={css.glyph} aria-hidden="true">{props.status === 'running' ? <StateDot state="ongoing" size={12} /> : <StateDot state={DOT[props.status]} />}</span>
        <StatusText text={props.statusLabel} motion={props.motion} shimmer={props.status === 'running'} className={css.status} />
        {meta}
      </button>
    </div>
    <CollapseBody open={props.open} motion={props.motion}>
      <div id={bodyId} className={css.body} data-reader-process data-reader-process-key={props.panelKey}>
        {layout.earlier && <button type="button" className={css.earlier} onClick={props.onEarlierOpen} data-reader-earlier>
          <svg className={css.earlierChevron} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
          <span>前 {layout.earlier.steps} 步</span>
          {layout.earlier.summary && <><span className={css.dot} aria-hidden="true" /><span className={css.earlierSummary}>{layout.earlier.summary}</span></>}
        </button>}
        {rows.map(row => row.kind === 'single'
          ? <Fragment key={row.item.key}>{props.renderItem(row.item)}</Fragment>
          : row.kind === 'thought'
            ? <Fragment key={row.reasoning.key}>{props.renderThought(row.reasoning, row.operation)}</Fragment>
            : <ClusterRow key={row.key} cluster={row} motion={props.motion} onRead={props.onRead} renderItem={props.renderItem} />)}
      </div>
    </CollapseBody>
  </div>;
}
