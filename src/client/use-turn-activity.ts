import { useEffect, useMemo, useState } from 'react';
import { useChatSelector, usePendingSelector } from './compat/session-snapshot.js';
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client';
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import {
  activityLabel, latestOpenTurn, phaseKeyOf, type ActivityPhase, type TurnSnapshot,
} from './turn-activity.js';

export interface ActivityView {
  label: string;
  seconds: number | null; // null = 等待操作/无计时
  key: string | null;     // null = 无活动（不渲染）
  phase: ActivityPhase;
}

const IDLE: ActivityView = { label: '', seconds: null, key: null, phase: 'idle' };

export function useTurnActivity(useSession: SnapshotSelectorHook<SessionSnapshot>): ActivityView {
  const [now, setNow] = useState(() => Date.now());
  // 选择器只返回原始值：原来每次 store 更新都返回一个新对象（且为每个步骤重建
  // Map），Object.is 判定必然不相等，于是每个流式 chunk 都让整个阅读树重渲染一次。
  // 现在只有「阶段键 / 待处理数 / 是否有开放轮次」变化才触发重渲染。
  const pending = usePendingSelector(useSession, value => value.length);
  const raw = useChatSelector(useSession, chat => {
    let latest: TurnSnapshot | undefined;
    for (const turn of chat.timeline.turns.values()) {
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
    return {
      turn: latest,
      hasOpenTurn: latest !== undefined,
      phaseKey: latest ? phaseKeyOf(latest, latestStep(latest), latestSince(latest)) : 'idle',
    };
  }, turnActivityEqual);
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
  // Derive the view locally: this does not need a second host subscription.
  // Timer ticks still update the Reader; stable group props let history bail out.
  return useMemo<ActivityView>(() => {
    const result = latestOpenTurn(raw.turn, pending, []);
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
  }, [raw, pending, now]);
}

/** 阅读页重渲染判定：秒数每 tick 变化，但它只影响状态条自己的文案，不应带着
 *  整棵阅读树重渲染（键/阶段变化才重渲染）。 */
export function sameActivity(a: ActivityView, b: ActivityView): boolean {
  return a.key === b.key && a.phase === b.phase && a.label === b.label && a.seconds === b.seconds;
}

/** 只比较真正影响阅读页渲染的字段（`turn` 对象每 chunk 都换引用）。 */
function turnActivityEqual(
  a: { turn?: TurnSnapshot; hasOpenTurn: boolean; phaseKey: string },
  b: { turn?: TurnSnapshot; hasOpenTurn: boolean; phaseKey: string },
): boolean {
  return a.hasOpenTurn === b.hasOpenTurn && a.phaseKey === b.phaseKey;
}

function latestStep(turn: TurnSnapshot): number {
  for (let i = (turn.steps?.length ?? 0) - 1; i >= 0; i--) {
    if (turn.steps![i]!.data.get('assistant-step')) return turn.steps![i]!.step;
  }
  return 0;
}

function latestSince(turn: TurnSnapshot): number | null {
  for (let i = (turn.steps?.length ?? 0) - 1; i >= 0; i--) {
    const data = turn.steps![i]!.data.get('assistant-step') as { time?: number } | undefined;
    if (data && typeof data.time === 'number') return data.time;
  }
  return null;
}
