import type { PlanTodo } from './transcript-model.js';
import css from './PlanCard.module.css';

export function PlanCard({ todos }: { todos: readonly PlanTodo[] }) {
  const done = todos.filter(todo => todo.status === 'completed').length;
  return <div className={css.card} data-reader-plan>
    <div className={css.title}>计划 · {done} / {todos.length}</div>
    {todos.map((todo, index) => <div key={index} className={css.item} data-status={todo.status}>
      <span className={css.box} aria-hidden="true">{todo.status === 'completed' ? '✓' : ''}</span>
      <span className={css.content}>{todo.content}</span>
    </div>)}
  </div>;
}
