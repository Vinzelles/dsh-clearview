/** What to do with a pending focus request: scroll when the target is rendered, keep it pending while the session is still loading, otherwise drop it as unreachable. */
export type ViewRequestAction = 'scroll' | 'wait' | 'drop';

export function viewRequestAction(found: boolean, loading: boolean): ViewRequestAction {
  if (found) return 'scroll';
  return loading ? 'wait' : 'drop';
}
