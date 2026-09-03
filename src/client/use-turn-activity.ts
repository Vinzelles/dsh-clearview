import { useEffect, useMemo, useRef, useState } from 'react';
import type { UseConversationSession } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import {
  activityLabel, latestOpenTurn, phaseStartMs, type ActivityPhase, type TurnSnapshot,
} from './turn-activity.js';

export interface ActivityView {
  label: string;
  seconds: number | null; // null = 等待操作/无计时
  key: string | null;     // null = 无活动（不渲染）
  phase: ActivityPhase;
}

const IDLE: ActivityView = { label: '', seconds: null, key: null, phase: 'idle' };

export function useTurnActivity(useSession: UseConversationSession): ActivityView {
  const [now, setNow] = useState(() => Date.now());
  // The selector reads only raw snapshot data (never derives with `now`), so
  // it re-runs only when the store actually changes.
  const raw = useSession(snapshot => {
    let latest: TurnSnapshot | undefined;
    let latestTurnNumber: number | null = null;
    for (const [num, turn] of snapshot.chat.timeline.turns) {
      if (turn.status !== 'open') continue;
      // TurnSnapshot models step data as a Map, while the runtime hands a
      // keyed Location reader; copy the one business value turn-activity reads.
      latest = {
        status: turn.status,
        steps: turn.steps.map(step => {
          const data = new Map<string, unknown>();
          const assistant = step.data.get('assistant-step');
          if (assistant !== undefined) data.set('assistant-step', assistant);
          return { step: step.step, data };
        }),
      };
      latestTurnNumber = num;
    }
    return {
      turn: latest, pending: snapshot.pending.length,
      hasOpenTurn: latest !== undefined, turnNumber: latestTurnNumber,
    };
  });
  // Per-key first-seen origins for the phase timer. The timer origin is the
  // phase key's first display time on this client, not a step timestamp:
  // running steps only carry step-level `data.time`, so timing from it would
  // never restart inside one streaming step (e.g. reasoning→text). The
  // turn-number prefix keeps a new turn from reusing an older phase's origin.
  const startedRef = useRef(new Map<string, number>());
  // Seconds tick: 1s interval, gated on an open turn so an idle Reader stops
  // re-rendering every second. The gate uses the stable `hasOpenTurn` boolean,
  // not the `turn` object reference: the snapshot rebuilds `turn` on every
  // store update while streaming, which would tear down and recreate the
  // interval before it can fire. The derivation below re-runs only when `now`
  // or the raw snapshot changes; the bar re-renders at most once per second.
  useEffect(() => {
    if (!raw.hasOpenTurn) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [raw.hasOpenTurn]);
  return useMemo<ActivityView>(() => {
    const result = latestOpenTurn(raw.turn, raw.pending, []);
    if (!result) return IDLE;
    const started = phaseStartMs(`${raw.turnNumber ?? 0}:${result.key}`, startedRef.current, now);
    const seconds = result.phase === 'waiting'
      ? null
      : Math.max(0, Math.floor((now - started) / 1000));
    return { label: activityLabel(result.phase), seconds, key: result.key, phase: result.phase };
  }, [raw, now]);
}
