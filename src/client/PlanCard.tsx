import { Children, Fragment, cloneElement, isValidElement, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PlanTodo, PlanTone } from './transcript-model.js';
import css from './PlanCard.module.css';

export interface PlanCardProps {
  todos: readonly PlanTodo[];
  /** False while the tool payload has no checklist; the same component/key must render its promotion. */
  hasChecklist?: boolean;
  /** Derived by the parent from the latest call, independently of the retained checklist. */
  tone?: PlanTone;
  detail?: string;
  /** Original calls rendered by the parent with ToolRow (including its native details). */
  children?: ReactNode;
}

/** Reading intent must survive promotion from the always-open fallback to a checklist card. */
export function keepPlanHistoryOpen(history: HTMLElement | null, readerIntent = false): boolean {
  // Capture happens before a promotion commit can move focus or hide the original detail.
  if (readerIntent) return true;
  if (!history) return false;
  if (history.querySelector('[data-reader-tool-call][data-expanded="true"]')) return true;
  const doc = history.ownerDocument;
  if (doc.activeElement && history.contains(doc.activeElement)) return true;
  const selection = doc.getSelection();
  if (!selection || selection.isCollapsed) return false;
  if ((selection.anchorNode && history.contains(selection.anchorNode))
    || (selection.focusNode && history.contains(selection.focusNode))) return true;
  for (let index = 0; index < selection.rangeCount; index++) {
    if (selection.getRangeAt(index).intersectsNode(history)) return true;
  }
  return false;
}

/** A single fallback child and the parent's keyed Fragment history reconcile to the same call seats. */
export function planCallChildren(children: ReactNode): ReactNode[] {
  const calls: ReactNode[] = [];
  const visit = (nodes: ReactNode) => Children.forEach(nodes, child => {
    if (isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment) visit(child.props.children);
    else if (child != null && typeof child !== 'boolean') calls.push(isValidElement(child)
      ? cloneElement(child, { key: `plan-call:${calls.length}` }) : child);
  });
  visit(children);
  return calls;
}

export function PlanCard({ todos, hasChecklist = true, tone = 'idle', detail, children }: PlanCardProps) {
  const history = useRef<HTMLDetailsElement>(null);
  const previousChecklist = useRef(hasChecklist);
  const readerIntent = useRef(false);
  const [open, setOpen] = useState(!hasChecklist);
  useLayoutEffect(() => {
    if (!hasChecklist) setOpen(true);
    else if (!previousChecklist.current) setOpen(keepPlanHistoryOpen(history.current, readerIntent.current));
    previousChecklist.current = hasChecklist;
  }, [hasChecklist]);
  const done = todos.filter(todo => todo.status === 'completed').length;
  return <div className={hasChecklist ? css.card : css.fallback} data-reader-plan data-has-checklist={hasChecklist} data-tone={tone}>
    <div key="checklist" hidden={!hasChecklist}>
    {hasChecklist && <>
    <div className={css.title}>计划 · {done} / {todos.length}</div>
    {detail && <div className={css.status} role="status">{detail}</div>}
    {todos.length === 0 && <div className={css.status} data-reader-plan-empty>暂无计划条目</div>}
    {todos.map((todo, index) => <div key={index} className={css.item} data-status={todo.status}>
      <span className={css.box} aria-hidden="true">{todo.status === 'completed' &&
        <svg className={css.check} width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true" focusable="false">
          <path d="M1.5 5 4 7.5 8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      }</span>
      <span className={css.content}>{todo.content}</span>
    </div>)}
    </>}
    </div>
    <details key="history" ref={history} className={css.history} data-reader-plan-calls
      open={!hasChecklist || open || (!previousChecklist.current && readerIntent.current)}
      onFocusCapture={() => { if (!hasChecklist) readerIntent.current = true; }}
      onPointerDownCapture={() => { if (!hasChecklist) readerIntent.current = true; }}
      onToggle={event => { if (hasChecklist) setOpen(event.currentTarget.open); }}>
      <summary hidden={!hasChecklist}>原始计划调用</summary>
      <div className={css.calls}>{planCallChildren(children)}</div>
    </details>
  </div>;
}
