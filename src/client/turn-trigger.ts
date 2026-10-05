/** Source families of a non-human message that starts a Turn (mirrors ui-chat turnTriggerDetails). */
export type TriggerIcon = 'agent' | 'github' | 'goal' | 'job' | 'plugin' | 'request' | 'schedule' | 'subagent' | 'team' | 'webhook';

export interface TriggerDetails { title: string; icon: TriggerIcon }

const TITLES: Record<TriggerIcon, string> = {
  request: '收到执行请求',
  goal: '继续执行目标',
  agent: '收到任务消息',
  team: '收到团队消息',
  subagent: '子任务状态更新',
  github: '收到 GitHub 事件',
  webhook: '收到外部事件',
  schedule: '自动化任务',
  job: '后台任务状态更新',
  plugin: '插件状态更新',
};

export const TRIGGER_EXPLANATION = '这条通知触发了本轮回复。';

export function triggerDetails(source: unknown): TriggerDetails {
  const record = typeof source === 'object' && source !== null && !Array.isArray(source) ? source as Record<string, unknown> : null;
  const kind = typeof record?.kind === 'string' ? record.kind : undefined;
  const icon: TriggerIcon = kind === 'goal' ? 'goal'
    : kind === 'agent-message' ? 'agent'
    : kind === 'team-message' ? 'team'
    : kind === 'subagent-settled' ? 'subagent'
    : kind === 'webhook' ? (record?.provider === 'github' ? 'github' : 'webhook')
    : kind === 'schedule' ? 'schedule'
    : kind === 'tool-jobs' ? 'job'
    : kind === 'cordis-host-runner' ? 'plugin'
    : 'request';
  return { title: TITLES[icon], icon };
}
