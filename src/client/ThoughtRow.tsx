import { useCallback, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { IconThinkOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { Line } from './Line.js';
import { CollapseBody } from './motion.js';
import { LiveThought } from './LiveThought.js';
import css from './ThoughtRow.module.css';

export function formatThinkingSeconds(seconds: number): string {
  if (seconds < 1) return '不到 1 秒';
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} 分 ${rest} 秒` : `${minutes} 分钟`;
}

export function thoughtLabel(durationMs: number | null): string {
  if (durationMs === null) return '思考';
  const seconds = Math.round(durationMs / 1000);
  return seconds < 1 ? '思考了不到 1 秒' : `思考了 ${formatThinkingSeconds(seconds)}`;
}

/** A settled thought: one line, its full text on demand. */
export function ThoughtRow({ durationMs, motion, onRead, children, initialOpen = false, follow = false }: { durationMs: number | null; motion: boolean; onRead: () => void; children: ReactNode; initialOpen?: boolean; follow?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  const id = useId();
  const toggle = useCallback(() => { onRead(); setOpen(value => !value); }, [onRead]);
  return <div className={css.thought} data-reader-reasoning data-expanded={open}>
    <Line icon={<IconThinkOutlineRegular size={14} />} label={thoughtLabel(durationMs)} open={open} onToggle={toggle} controls={id} />
    <CollapseBody open={open} motion={motion}><div id={id}>
      <LiveThought follow={open && follow} motion={motion} live={false}>{children}</LiveThought>
    </div></CollapseBody>
  </div>;
}
