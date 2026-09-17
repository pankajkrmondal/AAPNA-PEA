/**
 * TrendDelta — one parameter's or one person's movement, as HR reads it.
 *
 * Subhajit asked to see whether a person is growing or coming down (15-Sep
 * demo, 11:09), so the number alone is not the answer: +0.6 means nothing
 * without knowing that up is good and that 0.6 is a real move rather than
 * rounding. Hence an arrow, a sign and a colour, all agreeing.
 *
 * Colour is never the only carrier — the arrow and the sign say the same thing
 * for anyone who cannot distinguish red from green.
 */
import { Tooltip } from 'antd';
import StatusPill from './StatusPill.jsx';

/** Matches TREND_BAND in analytics.service.js — a change of this much is real. */
export const TREND_BAND = 0.3;

/** @param {number|null|undefined} change */
export function directionOf(change) {
  if (change === null || change === undefined) return null;
  if (change >= TREND_BAND) return 'growing';
  if (change <= -TREND_BAND) return 'declining';
  return 'steady';
}

// The state tokens, so a delta is the same green and red as every pill. Both
// have a dark counterpart, so these stay legible in either theme.
const LOOK = {
  growing: { arrow: '▲', colour: 'var(--pea-ok, #0a7f57)' },
  declining: { arrow: '▼', colour: 'var(--pea-crit, #c11f1f)' },
  steady: { arrow: '—', colour: 'var(--pea-muted, #5f6a59)' },
};

/**
 * @param {{change: number|null|undefined, showZero?: boolean}} props
 *   showZero — render "— 0.0" rather than a dash when the change is exactly nil.
 */
export default function TrendDelta({ change, showZero = true }) {
  if (change === null || change === undefined) {
    return (
      <Tooltip title="Needs two submitted evaluations before movement can be measured">
        <span style={{ color: 'var(--pea-text-muted)' }}>—</span>
      </Tooltip>
    );
  }
  if (change === 0 && !showZero) return <span style={{ color: 'var(--pea-text-muted)' }}>—</span>;

  const { arrow, colour } = LOOK[directionOf(change)];
  const magnitude = Math.abs(change).toFixed(1);

  return (
    <span style={{ color: colour, fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
      {arrow} {magnitude}
    </span>
  );
}

/** The word form — "Growing", "Coming down", "Steady" — for the roster column. */
export function TrendPill({ direction, done }) {
  if (!direction) {
    return (
      <StatusPill tone="mute" nodot>
        {done === 1 ? 'One evaluation' : 'Not enough data'}
      </StatusPill>
    );
  }
  if (direction === 'growing') return <StatusPill tone="ok">Growing</StatusPill>;
  if (direction === 'declining') return <StatusPill tone="crit">Coming down</StatusPill>;
  return <StatusPill tone="mute">Steady</StatusPill>;
}
