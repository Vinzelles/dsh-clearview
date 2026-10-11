import { objectValue, toolIdentity, type ToolActivityEntry, type ToolPhase } from './tool-activity.js';

export interface QuestionOption { label: string; description?: string }
export interface QuestionHistoryItem {
  id: string; question: string; header?: string; detail?: string; options: QuestionOption[];
  selected: string[]; custom?: string;
  answerState: 'answered' | 'skipped' | 'missing' | 'pending' | 'unavailable';
}
export interface QuestionHistory {
  questions: QuestionHistoryItem[];
  state: 'answered' | 'partial' | 'skipped' | 'pending' | 'failed' | 'interrupted' | 'unreadable';
  status: string;
  note?: string;
}

function parse(raw: string): Record<string, unknown> | null {
  try { return objectValue(JSON.parse(raw)); } catch { return null; }
}
const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** Strict ID matching: an incomplete/malformed result must never be shown as a user's decision. */
export function questionHistory(entry: Pick<ToolActivityEntry, 'block' | 'draft'>, phase: ToolPhase): QuestionHistory {
  const input = parse(toolIdentity(entry).raw);
  const rawQuestions = input?.questions;
  const questions: QuestionHistoryItem[] = [];
  const ids = new Set<string>();
  let inputValid = Array.isArray(rawQuestions) && rawQuestions.length > 0;
  if (Array.isArray(rawQuestions)) for (const raw of rawQuestions) {
    const item = objectValue(raw);
    if (!nonBlank(item?.id) || !nonBlank(item.question) || ids.has(item.id)) { inputValid = false; break; }
    ids.add(item.id);
    const options: QuestionOption[] = [];
    if (Array.isArray(item.options)) for (const rawOption of item.options) {
      const option = objectValue(rawOption);
      if (nonBlank(option?.label)) options.push({ label: option.label, ...(nonBlank(option.description) ? { description: option.description } : {}) });
    }
    questions.push({ id: item.id, question: item.question, options, selected: [], answerState: 'unavailable',
      ...(nonBlank(item.header) ? { header: item.header } : {}), ...(nonBlank(item.detail) ? { detail: item.detail } : {}) });
  }
  if (!inputValid) questions.length = 0;
  if (phase === 'failed' || phase === 'interrupted') return { questions, state: phase,
    status: phase === 'failed' ? '问答未完成' : '问答已中断', note: '没有可确认的用户答案，原始记录保留。' };
  if (phase === 'preparing' || phase === 'running') {
    questions.forEach(item => { item.answerState = 'pending'; });
    return { questions, state: 'pending', status: '等待用户回答',
      ...(!inputValid ? { note: '问题内容尚未完整到达。' } : {}) };
  }
  if (!inputValid) return { questions, state: 'unreadable', status: '问题内容无法解析', note: '请查看原始记录。' };
  const block = entry.block;
  const resultText = block && 'kind' in block ? block.content.flatMap(item => item.type === 'text' ? [item.text] : []).join('') : '';
  const rawAnswers = parse(resultText)?.answers;
  const answers = new Map<string, { selected: string[]; custom?: string }>();
  let resultValid = Array.isArray(rawAnswers);
  if (Array.isArray(rawAnswers)) for (const raw of rawAnswers) {
    const answer = objectValue(raw);
    if (!nonBlank(answer?.id) || answers.has(answer.id) || !Array.isArray(answer.selected)
      || !answer.selected.every(nonBlank) || (answer.custom !== undefined && typeof answer.custom !== 'string')) {
      resultValid = false; break;
    }
    answers.set(answer.id, { selected: [...answer.selected], ...(nonBlank(answer.custom) ? { custom: answer.custom } : {}) });
  }
  if (!resultValid) return { questions, state: 'unreadable', status: '答案内容无法解析', note: '请查看原始记录，未推测用户选择。' };
  let answered = 0;
  for (const item of questions) {
    const answer = answers.get(item.id);
    if (!answer) { item.answerState = Array.isArray(rawAnswers) && rawAnswers.length === 0 ? 'skipped' : 'missing'; continue; }
    item.selected = answer.selected;
    item.custom = answer.custom;
    item.answerState = answer.selected.length > 0 || answer.custom ? 'answered' : 'skipped';
    if (item.answerState === 'answered') answered++;
  }
  const unmatched = [...answers.keys()].some(id => !ids.has(id));
  const missing = questions.some(item => item.answerState === 'missing');
  return { questions, state: missing || unmatched ? 'partial' : answered === 0 ? 'skipped' : 'answered',
    status: answered === 0 && !missing && !unmatched ? '未作答' : `已回答 ${answered} / ${questions.length}`,
    ...(missing || unmatched ? { note: '部分问题与答案未能匹配，完整结果见原始记录。' } : {}) };
}
