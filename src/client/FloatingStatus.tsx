import { StateDot } from '@deepseek-ai/dsh-client-ui-primitives';
import { MountFade, useContentWidth } from './motion.js';
import { formatSeconds } from './turn-activity.js';
import type { ActivityView } from './use-turn-activity.js';
import css from './FloatingStatus.module.css';

const Arrow = ({ size }: { size: number }) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3v10m-4-4 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** Shown only after the reader scrolls away: a status pill while running, the native round jump button when idle. */
export function FloatingStatus({ activity, detached, onJump, motion }: { activity: ActivityView; detached: boolean; onJump: () => void; motion: boolean }) {
  const running = activity.key !== null;
  // The pill's width follows its content so a label change slides instead of jumping.
  const [trackWidth, width] = useContentWidth();
  return <>
    <MountFade mounted={running && detached} motion={motion}>{({ entering }) => running && detached ? <div className={css.dock}>
      <button type="button" className={`${css.pill} ${entering ? css.entering : ''}`} onClick={onJump} title="回到最新" data-reader-activity-pill data-phase={activity.phase}
        style={width === null ? undefined : { width: `${width}px` }}>
        <span className={css.pillContent} ref={trackWidth}>
          <StateDot state={activity.phase === 'waiting' ? 'warning' : 'ongoing'} size={12} />
          <span className={css.label} role="status" data-reader-activity-label>{activity.label}</span>
          {activity.seconds !== null && <span className={css.timer} aria-hidden="true" data-reader-activity-timer>{formatSeconds(activity.seconds)}</span>}
          <Arrow size={12} />
        </span>
      </button>
    </div> : null}</MountFade>
    <MountFade mounted={!running && detached} motion={motion}>{({ entering }) => !running && detached ? <div className={css.dock}>
      <button type="button" className={`${css.circle} ${entering ? css.entering : ''}`} onClick={onJump} aria-label="回到最新" title="回到最新" data-reader-jump>
        <Arrow size={16} />
      </button>
    </div> : null}</MountFade>
  </>;
}
