import { Fragment, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import { CollapseBody, StatusText } from './motion.js';
import { FoldRow } from './ProcessRow.js';
import { groupSteps, type PanelCounts, type PanelEntry, type PanelItem, type PanelStatus } from './process-steps.js';
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
  earlierOpen: boolean;
  onEarlierOpen: () => void;
  motion: boolean;
  isActive: (item: PanelItem) => boolean;
  renderItem: (item: PanelItem) => ReactNode;
}

/** One turn's process in a hairline panel: a status header and step-grouped rows. */
export function ProcessPanel(props: ProcessPanelProps) {
  const bodyId = useId();
  const [openFolds, setOpenFolds] = useState<ReadonlySet<string>>(() => new Set());
  const layout = groupSteps(props.items, { condense: props.status !== 'done' && !props.earlierOpen, isActive: props.isActive });
  const toggleFold = (key: string) => setOpenFolds(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });
  const renderEntry = (entry: PanelEntry) => entry.kind === 'item'
    ? <Fragment key={entry.item.key}>{props.renderItem(entry.item)}</Fragment>
    : <Fragment key={entry.key}>
      <FoldRow count={entry.items.length} open={openFolds.has(entry.key)} onToggle={() => toggleFold(entry.key)} />
      {openFolds.has(entry.key) && entry.items.map(item => <Fragment key={item.key}>{props.renderItem(item)}</Fragment>)}
    </Fragment>;
  return <div className={css.panel} data-reader-panel data-status={props.status}>
    <div className={css.header} data-reader-disclosure data-expanded={props.open}>
      <button type="button" className={css.headerButton} aria-expanded={props.open} aria-controls={bodyId}
        aria-label={`${props.open ? '收起' : '展开'}执行过程，${props.statusLabel}`} onClick={() => props.onOpenChange(!props.open)}>
        <span className={css.glyph} aria-hidden="true">{props.status === 'running' ? <StateDot state="ongoing" size={12} /> : <StateDot state={DOT[props.status]} />}</span>
        <StatusText text={props.statusLabel} motion={props.motion} shimmer={props.status === 'running'} className={css.status} />
        {props.elapsed && <span className={css.elapsed}>{props.elapsed}</span>}
        <span className={css.spacer} />
        {props.counts.steps > 0 && <span className={css.tag}>{props.counts.steps} 步</span>}
        {props.counts.tools > 0 && <span className={css.tag}>{props.counts.tools} 次工具</span>}
        {props.counts.failed > 0 && <span className={`${css.tag} ${css.tagDanger}`}>{props.counts.failed} 次失败</span>}
        <svg className={css.headerChevron} data-open={props.open} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m4 10 4-4 4 4" /></svg>
      </button>
    </div>
    <CollapseBody open={props.open} motion={props.motion}>
      <div id={bodyId} className={css.body} data-reader-process data-reader-process-key={props.panelKey}>
        {layout.earlier && <button type="button" className={css.earlier} onClick={props.onEarlierOpen} data-reader-earlier>
          <svg className={css.earlierChevron} viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m6 4 4 4-4 4" /></svg>
          <span>前 {layout.earlier.steps} 步</span>
          {layout.earlier.summary && <><span className={css.dot} aria-hidden="true" /><span className={css.earlierSummary}>{layout.earlier.summary}</span></>}
        </button>}
        {layout.groups.map(group => <div key={group.key} className={css.step} data-reader-step={group.label}>
          {group.label !== '' && <div className={css.stepLabel}>{group.label}</div>}
          {group.entries.map(renderEntry)}
        </div>)}
      </div>
    </CollapseBody>
  </div>;
}
