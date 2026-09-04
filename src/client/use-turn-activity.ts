import { useEffect, useMemo, useState } from 'react';
import type { UseConversationSession } from '@deepseek-ai/dsh-client-runtime/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import {
  activityLabel, latestOpenTurn, type ActivityPhase, type TurnSnapshot,
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
    for (const turn of snapshot.chat.timeline.turns.values()) {
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
    }
    return { turn: latest, pending: snapshot.pending.length, hasOpenTurn: latest !== undefined };
  });
  // Seconds tick: 1s interval, gated on an open turn so an idle Reader stops
  // re-rendering every second. The gate uses the stable `hasOpenTurn` boolean,
  // not the `turn` object reference: the snapshot rebuilds `turn` on every
  // store update while streaming, which would tear down and recreate the
  // interval before it can fire. An immediate tick on gate-open keeps `now`
  // fresh the moment a turn appears (the frozen idle value would otherwise
  // lag behind the real start).
  useEffect(() => {
    if (!raw.hasOpenTurn) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [raw.hasOpenTurn]);
  return useMemo<ActivityView>(() => {
    const result = latestOpenTurn(raw.turn, raw.pending, []);
    if (!result) return IDLE;
    // Timer origin is the step's real event timestamp (`since`), never a
    // local first-seen estimate: a first-seen origin inflates after an idle
    // gap (the tick is gated off while idle) and resets on session switches
    // or remounts, while the data timestamp is correct across both. The
    // clock therefore restarts when the turn moves to a new step (each step
    // carries its own `data.time`); inside one streaming step, where the
    // protocol exposes no block-level timestamps, it keeps running.
    const seconds = result.phase === 'waiting' || result.since == null
      ? null
      : Math.max(0, Math.floor((now - result.since) / 1000));
    return { label: activityLabel(result.phase), seconds, key: result.key, phase: result.phase };
  }, [raw, now]);
}
