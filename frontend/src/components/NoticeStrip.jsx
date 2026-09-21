/**
 * NoticeStrip — one compact line per screen for everything that would otherwise
 * be a stack of full-width Alert banners.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * New joiners and Link generation had grown three and two banners respectively,
 * each several lines tall, sitting between the page heading and the first
 * table. The content was worth keeping — it says what the Microsoft 365 check
 * found and what a link does — but as stacked banners it pushed the tables that
 * HR actually work in below the fold, and left a gap between sections wide
 * enough to look like a layout fault.
 *
 * So the same notices collapse to a single strip: severity dot, a short summary
 * of each, and a toggle. Closed it costs one line; open it shows every word
 * that used to be on the screen. Nothing is dismissible — an unread problem
 * that disappears on reload is exactly the silent failure PEA exists to remove.
 *
 * Permanent explanatory text is NOT a notice and does not belong here. That is
 * a HintIcon next to the section title: it is true every day, so it should not
 * take a line every day.
 */
import { useState } from 'react';
import { Typography } from 'antd';
import {
  ExclamationCircleFilled, InfoCircleFilled, CloseCircleFilled, DownOutlined,
} from '@ant-design/icons';

const ICONS = {
  error: <CloseCircleFilled />,
  warning: <ExclamationCircleFilled />,
  info: <InfoCircleFilled />,
};

/** Worst tone wins the strip: a problem must never be coloured as an aside. */
const RANK = { info: 0, warning: 1, error: 2 };

/**
 * @param {object} props
 * @param {Array<{key: string, tone?: 'info'|'warning'|'error', summary: React.ReactNode,
 *   detail?: React.ReactNode}>} props.items - one entry per notice. `summary` is
 *   the few words shown closed; `detail` is everything shown open.
 * @param {boolean} [props.defaultOpen] - start expanded, for a screen where the
 *   detail is the point rather than a reference
 */
export default function NoticeStrip({ items = [], defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);

  const rows = items.filter(Boolean);
  if (rows.length === 0) return null;

  const tone = rows.reduce(
    (worst, r) => (RANK[r.tone || 'info'] > RANK[worst] ? (r.tone || 'info') : worst),
    'info'
  );

  // Only worth expanding if there is something more to show than the summaries.
  const expandable = rows.some((r) => r.detail);

  return (
    <div className={`pea-notice pea-notice--${tone}`} data-open={open || undefined}>
      <button
        type="button"
        className="pea-notice-bar"
        onClick={() => expandable && setOpen((v) => !v)}
        aria-expanded={expandable ? open : undefined}
        // A strip with nothing to expand is a label, not a control.
        style={expandable ? undefined : { cursor: 'default' }}
      >
        <span className="pea-notice-icon">{ICONS[tone]}</span>

        <span className="pea-notice-summaries">
          {rows.map((r, i) => (
            <span key={r.key} className="pea-notice-summary">
              {i > 0 && <span className="pea-notice-dot">·</span>}
              {r.summary}
            </span>
          ))}
        </span>

        {expandable && (
          <span className="pea-notice-toggle">
            {open ? 'Hide' : 'Details'}
            <DownOutlined className="pea-notice-chevron" />
          </span>
        )}
      </button>

      {open && expandable && (
        <div className="pea-notice-body">
          {rows.filter((r) => r.detail).map((r, i, shown) => (
            <div key={r.key} className="pea-notice-item">
              {/* With one notice the summary is already on the bar directly
                  above, so repeating it as a heading says the same thing twice
                  two lines apart. With several it is the only thing telling
                  them apart, so it stays. */}
              {shown.length > 1 && (
                <Typography.Text strong style={{ fontSize: 13 }}>{r.summary}</Typography.Text>
              )}
              <div className="pea-notice-detail">{r.detail}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
