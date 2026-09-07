/**
 * Payload readers for Chat node kinds outside this build's typed node map.
 *
 * The reader is typed against the 0.1.1 conversation contract; 0.1.2 projects
 * two additional node kinds (`system-prompt`, `turn-process`), and the
 * `command-input` / `workflow-run` renderer kinds belong to optional business
 * modules whose type contributions are not part of this build. None of them
 * appear in `ChatNodeDataMap`, so every read narrows `data: unknown`
 * defensively: an unreadable payload reports null and the caller decides
 * whether to fall back, never crashes the reading flow.
 */

/** Workflow run / phase / member status as recorded by ui-workflow-run. */
export type WorkflowRunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';

/** Readable parts of one `workflow-run` node payload; unknown fields stay null. */
export interface WorkflowRunSummary {
  name: string | null;
  status: WorkflowRunStatus | null;
  phaseCount: number | null;
  memberCount: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

const WORKFLOW_STATUSES: readonly WorkflowRunStatus[] = ['running', 'completed', 'failed', 'cancelled', 'interrupted'];

/**
 * Read one workflow-run payload: the run name, its durable status, and the
 * member totals across phases. Member counting is all-or-nothing per phase —
 * an unreadable phase would make a partial total lie about scale, so it
 * reports null instead.
 */
export function workflowRunSummary(data: unknown): WorkflowRunSummary {
  const record = asRecord(data);
  const name = typeof record?.name === 'string' && record.name !== '' ? record.name : null;
  const status = WORKFLOW_STATUSES.includes(record?.status as WorkflowRunStatus)
    ? record?.status as WorkflowRunStatus
    : null;
  const phases = Array.isArray(record?.phases) ? record.phases : null;
  let memberCount: number | null = null;
  if (phases !== null) {
    memberCount = 0;
    for (const phase of phases) {
      const members = asRecord(phase)?.members;
      if (!Array.isArray(members)) { memberCount = null; break; }
      memberCount += members.length;
    }
  }
  return { name, status, phaseCount: phases === null ? null : phases.length, memberCount };
}

/** The status label for the workflow record card; null means unreadable. */
export function workflowStatusLabel(status: WorkflowRunStatus | null): string {
  switch (status) {
    case 'running': return '运行中';
    case 'completed': return '已完成';
    case 'failed': return '已失败';
    case 'cancelled': return '已取消';
    case 'interrupted': return '已中断';
    default: return '状态未知';
  }
}

/**
 * One plain text payload (`system-prompt` / `command-input`): the `text`
 * string, or null when the record carries none. An empty string is a real
 * payload — the caller decides whether an empty text renders at all
 * (native skips empty system prompts, so the reader does too).
 */
export function nodeText(data: unknown): string | null {
  const text = asRecord(data)?.text;
  return typeof text === 'string' ? text : null;
}
