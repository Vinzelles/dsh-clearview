import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triggerDetails } from '../src/client/turn-trigger.ts';

test('every known source kind maps to the native title and icon family', () => {
  const cases: [unknown, string, string][] = [
    [{ kind: 'goal' }, '继续执行目标', 'goal'],
    [{ kind: 'agent-message' }, '收到任务消息', 'agent'],
    [{ kind: 'team-message' }, '收到团队消息', 'team'],
    [{ kind: 'subagent-settled' }, '子任务状态更新', 'subagent'],
    [{ kind: 'webhook', provider: 'github' }, '收到 GitHub 事件', 'github'],
    [{ kind: 'webhook', provider: 'gitlab' }, '收到外部事件', 'webhook'],
    [{ kind: 'schedule' }, '自动化任务', 'schedule'],
    [{ kind: 'tool-jobs' }, '后台任务状态更新', 'job'],
    [{ kind: 'cordis-host-runner' }, '插件状态更新', 'plugin'],
  ];
  for (const [source, title, icon] of cases) assert.deepEqual(triggerDetails(source), { title, icon });
});

test('unknown or unreadable sources fall back to an execution request', () => {
  for (const source of [{ kind: 'new-kind' }, {}, null, 'schedule', 42, []]) {
    assert.deepEqual(triggerDetails(source), { title: '收到执行请求', icon: 'request' });
  }
});
