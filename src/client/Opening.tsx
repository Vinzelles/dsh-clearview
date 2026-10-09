import { memo, useState } from 'react';
import type { ComponentType } from 'react';
import {
  IconAgentPresetOutlineRegular, IconAlarmClockOutlineRegular, IconCodeOutlineRegular, IconCordisPluginOutlineRegular,
  IconGoalOutlineRegular, IconLinkOutlineRegular, IconPaperPlaneOutlineRegular, IconQueueOutlineRegular,
  IconUserOutlineRegular, IconUsersOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { Blocks } from './Blocks.js';
import { useChatSelector } from './compat/session-snapshot.js';
import { CollapseBody } from './motion.js';
import { nodeText } from './node-payloads.js';
import { Chevron, Inset } from './ProcessRow.js';
import { useReaderActions } from './reader-context.js';
import { UserBubble } from './UserBubble.js';
import { fmtClock } from './turn-meta.js';
import { TRIGGER_EXPLANATION, triggerDetails, type TriggerIcon } from './turn-trigger.js';
import { contentBlocks } from './user-content.js';
import type { BlockRenderProps, ReaderProps } from './types.js';
import css from './Opening.module.css';

const TRIGGER_ICONS: Record<TriggerIcon, ComponentType<{ size?: number }>> = {
  agent: IconUserOutlineRegular,
  github: IconCodeOutlineRegular,
  goal: IconGoalOutlineRegular,
  job: IconQueueOutlineRegular,
  plugin: IconCordisPluginOutlineRegular,
  request: IconPaperPlaneOutlineRegular,
  schedule: IconAlarmClockOutlineRegular,
  subagent: IconAgentPresetOutlineRegular,
  team: IconUsersOutlineRegular,
  webhook: IconLinkOutlineRegular,
};

/** 引用 A、B · 技能 x, from the labels the Chat projection attached to a sent message. */
export function labelsLine(data: unknown): string {
  const value = typeof data === 'object' && data !== null ? data as { referenceLabels?: unknown; skillNames?: unknown } : {};
  const list = (items: unknown) => Array.isArray(items) ? items.filter((item): item is string => typeof item === 'string' && item !== '') : [];
  const references = list(value.referenceLabels);
  const skills = list(value.skillNames);
  return [references.length ? `引用 ${references.join('、')}` : '', skills.length ? `技能 ${skills.join('、')}` : ''].filter(Boolean).join(' · ');
}

function plainText(content: unknown): string {
  return contentBlocks(content).flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n\n');
}

/** What starts a turn: the user's message, a /goal-style command input, or a non-human trigger. */
export const Opening = memo(function Opening({ useSession, nodeKey, ...render }: BlockRenderProps & Pick<ReaderProps, 'useSession'> & { nodeKey: string }) {
  const node = useChatSelector(useSession, chat => chat.nodes.get(nodeKey));
  const { motion } = useReaderActions();
  const [open, setOpen] = useState(false);
  if (!node || node.visibility === 'hidden') return null;
  if (node.kind === 'turn-trigger') {
    const data = node.data as { source?: unknown; content?: unknown; time?: unknown };
    const details = triggerDetails(data.source);
    const Icon = TRIGGER_ICONS[details.icon];
    const time = typeof data.time === 'number' ? fmtClock(data.time) : null;
    const body = plainText(data.content);
    return <div className={css.trigger} data-reader-trigger={details.icon} data-reader-key={nodeKey}>
      <button type="button" className={css.triggerButton} aria-expanded={open} onClick={() => setOpen(value => !value)}>
        <span className={css.triggerIcon} aria-hidden="true"><Icon size={14} /></span>
        <span className={css.triggerTitle}>{details.title}</span>
        {time && <span className={css.triggerTime}>{time}</span>}
        <span className={css.triggerAction}>{open ? '收起原文' : '展开原文'}</span>
        <Chevron open={open} />
      </button>
      <CollapseBody open={open} motion={motion}>
        <Inset className={css.triggerBody}><p className={css.triggerNote}>{TRIGGER_EXPLANATION}</p>{body || '（原文为空）'}</Inset>
      </CollapseBody>
    </div>;
  }
  const command = node.kind === 'command-input';
  const blocks = command ? [{ kind: 'text' as const, text: nodeText(node.data) ?? '' }] : contentBlocks((node.data as { content?: unknown }).content);
  const labels = node.kind === 'user' ? labelsLine(node.data) : '';
  return <div className={css.group}>
    <UserBubble label={command ? '命令输入' : undefined} data={{ 'data-reader-anchor': true, 'data-reader-key': nodeKey, ...(command ? { 'data-reader-command-input': '' } : {}) }}>
      <Blocks {...render} blocks={blocks} source="user" />
    </UserBubble>
    {labels && <div className={css.labels} data-reader-user-labels>{labels}</div>}
  </div>;
});
