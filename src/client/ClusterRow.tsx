import { Fragment, useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { DisclosureRow, IconFlatListOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { CollapseBody } from './motion.js';
import { RowGlyph, RowSeparator } from './ProcessRow.js';
import { clusterElapsedMs, formatOperationClusterSummary, type OperationRow, type PanelItem } from './process-steps.js';
import { activityPhase, activitySummary } from './tool-activity.js';
import { formatDuration } from './ToolRow.js';
import css from './ClusterRow.module.css';

export type ClusterOperation = Extract<OperationRow, { kind: 'cluster' }>;

/** 「正在 …」 plus the title of the call that is running now; records and settled calls add nothing. */
function activeLabel(items: readonly PanelItem[]): string {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!;
    if (item.kind === 'tool' && ['preparing', 'running'].includes(activityPhase(item.entry))) return `正在 ${activitySummary(item.entry).title}`;
  }
  return '';
}

/**
 * Two or more consecutive tool calls (and command records) as one native-grammar row: the 0.1.18 summary as
 * its title, total elapsed on the right, collapsed unless a member failed. Members indent one level below.
 */
export function ClusterRow({ cluster, motion, onRead, renderItem }: {
  cluster: ClusterOperation; motion: boolean; onRead: () => void; renderItem: (item: PanelItem) => ReactNode;
}) {
  // Local choice keyed by the cluster (the React key is its stable cluster key); no choice follows the failure state.
  const [choice, setChoice] = useState<boolean | null>(null);
  const open = choice ?? cluster.hasFailed;
  const toggle = useCallback(() => { onRead(); setChoice(!open); }, [onRead, open]);
  const state = cluster.hasActive ? 'running' : cluster.hasFailed ? 'failed' : 'idle';
  const title = formatOperationClusterSummary(cluster.summary);
  const label = cluster.hasActive ? activeLabel(cluster.items) : '';
  const elapsed = cluster.hasActive ? null : clusterElapsedMs(cluster.items);
  return <div className={css.cluster} data-reader-cluster={cluster.key} data-cluster-state={state} data-expanded={open}>
    <DisclosureRow icon={<RowGlyph tone={state === 'running' ? 'active' : state === 'failed' ? 'failed' : 'idle'} icon={<IconFlatListOutlineRegular size={14} />} />}
      title={title} open={open} expandable expandOnRowClick previewChevron keepContentWhenOpen onToggle={toggle} running={cluster.hasActive && motion}
      rowClassName={css.row} titleClassName={cluster.hasFailed ? css.failedTitle : undefined}
      collapsedContent={<>
        <span className={css.fill}>{label && <><RowSeparator /><span className={css.activeText} title={label}>{label}</span></>}</span>
        {cluster.summary.failed > 0 && <span className={css.failure}>{cluster.summary.failed} 次失败</span>}
        {elapsed !== null && <span className={css.end}>{formatDuration(elapsed)}</span>}
      </>} />
    <CollapseBody open={open} motion={motion}>
      <div className={css.members}>{cluster.items.map(item => <Fragment key={item.key}>{renderItem(item)}</Fragment>)}</div>
    </CollapseBody>
  </div>;
}
