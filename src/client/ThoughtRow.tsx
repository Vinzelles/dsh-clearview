import { useCallback, useEffect, useId, useState } from 'react';
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

export const THOUGHT_READ_DELAY = 2400;
type ThoughtPhase = 'live' | 'grace' | 'manual' | 'closing' | 'folded';

/** Keep one viewport through streaming, reading grace and the eventual animated fold. */
export function ThoughtRow({ durationMs, motion, onRead, children, initialOpen = false, follow = false, active = false, retain = false, held = false, liveStatus, onReleased, onManualReadChange }: {
  durationMs: number | null; motion: boolean; onRead: () => void; children: ReactNode; initialOpen?: boolean; follow?: boolean;
  active?: boolean; retain?: boolean; held?: boolean; liveStatus?: ReactNode; onReleased?: () => void; onManualReadChange?: (reading: boolean) => void;
}) {
  const [state, setState] = useState<{ active: boolean; phase: ThoughtPhase; explicit: boolean }>(() => ({ active, phase: active ? 'live' : initialOpen ? 'manual' : 'folded', explicit: false }));
  // Derive a phase before React commits: a completed thought must never render a closed frame.
  if (state.active !== active) setState({ active, phase: active ? 'live' : 'grace', explicit: false });
  else if (retain && !state.explicit && state.phase === 'closing') setState({ ...state, phase: 'grace' });
  const open = active || state.phase === 'live' || state.phase === 'grace' || state.phase === 'manual' || retain && !state.explicit && state.phase === 'closing';
  useEffect(() => {
    if (active || retain || state.phase !== 'grace') return;
    const timer = window.setTimeout(() => setState(previous => ({ ...previous, phase: 'closing', explicit: false })), THOUGHT_READ_DELAY);
    return () => window.clearTimeout(timer);
  }, [active, retain, state.phase]);
  const id = useId();
  const toggle = useCallback(() => {
    onRead();
    onManualReadChange?.(!open);
    setState(previous => ({ ...previous, phase: open ? 'closing' : 'manual', explicit: true }));
  }, [onRead, open, onManualReadChange]);
  const released = useCallback(() => {
    setState(previous => ({ ...previous, phase: 'folded' }));
    onReleased?.();
  }, [onReleased]);
  const manualRead = useCallback((reading: boolean) => {
    onManualReadChange?.(reading);
    // An explicit end to retrospective reading closes promptly, with the same size animation.
    if (!reading && !active) setState(previous => ({ ...previous, phase: 'closing', explicit: true }));
  }, [onManualReadChange, active]);
  return <div className={css.thought} data-reader-reasoning={!active || undefined} data-expanded={open} data-thought-phase={active ? 'live' : state.phase}>
    {active ? liveStatus : <Line icon={<IconThinkOutlineRegular size={14} />} label={thoughtLabel(durationMs)} open={open} onToggle={toggle} controls={id} />}
    <CollapseBody open={open} motion={motion} onCloseComplete={released}><div id={id}>
      <LiveThought follow={open && follow && (active || !held)} motion={motion} live={active} onManualReadChange={held || active || state.phase === 'manual' ? manualRead : undefined}>{children}</LiveThought>
    </div></CollapseBody>
  </div>;
}
