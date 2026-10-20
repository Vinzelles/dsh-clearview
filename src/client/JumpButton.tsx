import { MountFade } from './motion.js';
import css from './JumpButton.module.css';

const Arrow = () => <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10m-4-4 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** Shown only after the reader scrolls away from the tail. */
export function JumpButton({ detached, onJump, motion }: { detached: boolean; onJump: () => void; motion: boolean }) {
  return <MountFade mounted={detached} motion={motion}>{({ entering }) => detached ? <div className={css.dock}>
    <button type="button" className={`${css.circle} ${entering ? css.entering : ''}`} onClick={onJump} aria-label="回到最新" title="回到最新" data-reader-jump>
      <Arrow />
    </button>
  </div> : null}</MountFade>;
}
