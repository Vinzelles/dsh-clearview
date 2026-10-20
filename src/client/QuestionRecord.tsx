import type { ReactNode } from 'react';
import { IconQuestionOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives';
import { CollapseBody } from './motion.js';
import type { QuestionHistory } from './question-record.js';
import { useReaderActions } from './reader-context.js';
import { InspectButton } from './ToolDetails.js';
import type { ToolPhase } from './tool-activity.js';
import css from './QuestionRecord.module.css';

const EMPTY_ANSWERS = { skipped: '未作答', missing: '未记录此问题的答案', pending: '尚未回答', unavailable: '答案不可用' };

/** Historical receipt only. Answers are plain text, never controls that can submit a decision. */
export function QuestionRecord({ history, callId, phase, open, onToggle, controls, children }: {
  history: QuestionHistory; callId: string; phase: ToolPhase; open: boolean;
  onToggle: () => void; controls: string; children: ReactNode;
}) {
  const { motion, inspectCall } = useReaderActions();
  return <section className={css.card} aria-label="问答记录" data-reader-question-record
    data-reader-tool-call={callId} data-tool-phase={phase} data-tool-category="other" data-expanded={open} data-question-state={history.state}>
    <div className={css.header}>
      <span className={css.summary}>
        <span className={css.title} data-question-title><IconQuestionOutlineRegular size={14} />问答记录</span>
        <span className={css.status} data-question-status>{history.status}</span>
      </span>
      <div className={css.actions}>
        <button type="button" className={css.original} aria-expanded={open} aria-controls={controls} onClick={onToggle} data-reader-question-original>
          <svg className={css.chevron} data-open={open} viewBox="0 0 12 12" aria-hidden="true"><path d="m4 2 4 4-4 4" /></svg>原始记录
        </button>
        {inspectCall && <InspectButton callId={callId} inspectCall={inspectCall} />}
      </div>
    </div>
    <div className={css.questions}>{history.questions.map(item => <div className={css.item} key={item.id} data-question-id={item.id}>
      <p className={css.question}>{item.header && <span className={css.heading}>{item.header} · </span>}{item.question}</p>
      <div className={css.answer} data-question-answer={item.answerState}>
        {item.answerState === 'answered' ? <>
          {item.selected.length > 0 && <ul className={css.selected}>{item.selected.map((value, i) => <li key={i}>
            <svg className={css.check} viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2 6 4.7 8.7 10 3.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span>{value}</span>
          </li>)}</ul>}
          {item.custom && <div className={css.custom}>{item.selected.length > 0 && <span className={css.customLabel}>补充：</span>}<p>{item.custom}</p></div>}
        </> : <span className={css.empty}>{EMPTY_ANSWERS[item.answerState]}</span>}
      </div>
    </div>)}</div>
    {history.note && <p className={css.note}>{history.note}</p>}
    <CollapseBody open={open} motion={motion}><div id={controls}>
      {history.questions.filter(item => item.detail || item.options.length > 0).map(item => <details className={css.context} key={item.id}>
        <summary>{item.header || '问题'} · 当时的背景与选项</summary>
        {item.detail && <p className={css.support}>{item.detail}</p>}
        {item.options.length > 0 && <ul className={css.options}>{item.options.map((option, i) => <li key={i}>
          <span>{option.label}</span>{option.description && <p>{option.description}</p>}
        </li>)}</ul>}
      </details>)}
      {children}
    </div></CollapseBody>
  </section>;
}
