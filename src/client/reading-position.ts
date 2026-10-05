/** In-memory reading position per session: restored when the reading tab mounts again. */
export interface SavedPosition { anchorKey: string; offset: number }
export interface AnchorRect { key: string; top: number; bottom: number }

const positions = new Map<string, SavedPosition>();

/** The first anchor whose bottom is still below the viewport top, with its offset from that top. */
export function pickAnchor(anchors: readonly AnchorRect[], viewportTop: number): SavedPosition | null {
  for (const anchor of anchors) if (anchor.bottom > viewportTop) return { anchorKey: anchor.key, offset: anchor.top - viewportTop };
  return null;
}

export function rememberPosition(sessionId: string, position: SavedPosition | null): void {
  if (position) positions.set(sessionId, position);
  else positions.delete(sessionId);
}

export function recallPosition(sessionId: string): SavedPosition | null {
  return positions.get(sessionId) ?? null;
}
