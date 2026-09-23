/**
 * BoardParts — the pieces of "What every manager said".
 *
 * The card is the design's unit: one evaluation, with its status, the average
 * and its change, the manager's overall comment, the reason for the decision
 * and every question comment. The same card serves the board, and its states
 * (no overall comment, imported legacy record, loading, could not load, no
 * access) are the ones the design's "States the developer must build" sheet
 * says must never be a blank panel.
 */
import { Link } from 'react-router-dom';
import { Button, Popconfirm, Tooltip } from 'antd';
import {
  ArrowDownOutlined, ArrowRightOutlined, ArrowUpOutlined, CalendarOutlined, CheckOutlined,
  ClockCircleOutlined, CloudUploadOutlined, ExclamationCircleOutlined, EyeOutlined, FlagOutlined,
  LockOutlined, MessageOutlined,
} from '@ant-design/icons';
import StatusPill from '../StatusPill.jsx';
import {
  avatarTone, initials, ratingTone, decisionTone, bucketMeta, evaluationLine, submittedLine,
  shortDate, daysLabel, avg,
} from '../../evaluationDisplay.js';

/** A round initials badge in the person's stable colour. */
export function Avatar({ name, size = 'md', className = '' }) {
  return (
    <span className={`pea-av pea-av--${size} pea-av--${avatarTone(name)} ${className}`} aria-hidden>
      {initials(name)}
    </span>
  );
}

/** The small square rating on each question row. */
export function RatingChip({ value, size = 'sm' }) {
  return (
    <span className={`pea-rchip pea-rchip--${size} pea-tone-${ratingTone(value)}`}>
      {value === null || value === undefined ? '—' : Number(value)}
    </span>
  );
}

/** "↓ 0.14" / "↑ 0.28" / "no change" — the change since the evaluation before. */
export function Delta({ value, suffix = '', showZero = false }) {
  if (value === null || value === undefined) return null;
  if (value === 0) {
    return showZero ? <span className="pea-delta pea-delta--flat">no change{suffix}</span> : null;
  }
  const up = value > 0;
  return (
    <span className={`pea-delta pea-delta--${up ? 'up' : 'down'}`}>
      {up ? <ArrowUpOutlined /> : <ArrowDownOutlined />} {Math.abs(value).toFixed(2).replace(/\.00$/, '')}{suffix}
    </span>
  );
}

/** The big average: "2.57 / 5". */
export function BigAverage({ value, size = 'md' }) {
  return (
    <span className={`pea-bigavg pea-bigavg--${size} pea-ink-${ratingTone(value)}`}>
      {avg(value)}<small> / 5</small>
    </span>
  );
}

/** The submitted-state pill with its tick. */
export function SubmittedPill() {
  return (
    <StatusPill tone="ok" nodot className="pea-pill-icon">
      <CheckOutlined /> Submitted
    </StatusPill>
  );
}

/** Any bucket's pill, with the design's small leading icon. */
export function BucketPill({ bucket }) {
  if (bucket === 'submitted') return <SubmittedPill />;
  const meta = bucketMeta(bucket);
  const icon = {
    waiting: <ClockCircleOutlined />,
    opened: <EyeOutlined />,
    not_sent: <ExclamationCircleOutlined />,
    scheduled: <CalendarOutlined />,
  }[bucket];
  return (
    <StatusPill tone={meta.tone} nodot={!!icon} className="pea-pill-icon">
      {icon} {meta.pill}
    </StatusPill>
  );
}

/**
 * The overall comment as a quotation, signed by the manager. Its absence is a
 * state of its own ("No overall comment — only the question comments below"),
 * never an empty box.
 */
export function QuoteBlock({ text, author, clamp = true, meta = 'overall comment' }) {
  if (!text) {
    return (
      <p className="pea-ev-nocomment">
        <MessageOutlined /> <em>No overall comment — only the question comments below.</em>
      </p>
    );
  }
  return (
    <figure className="pea-quote">
      <span className="pea-quote-mark" aria-hidden>“</span>
      <blockquote className={clamp ? 'pea-clamp-3' : ''}>{text}</blockquote>
      {author && (
        <figcaption>
          <Avatar name={author} size="xs" />
          <strong>{author}</strong> · {meta}
        </figcaption>
      )}
    </figure>
  );
}

/** One question: short label, rating, the manager's comment. Low ratings wash red. */
export function ScoreRows({ scores }) {
  return (
    <div className="pea-scores" role="table" aria-label="Question ratings and comments">
      {scores.map((s) => (
        <div
          key={s.key}
          role="row"
          className={`pea-score${s.rating !== null && s.rating <= 2 ? ' is-low' : ''}`}
        >
          <span role="rowheader" className="pea-score-q" title={s.label}>{s.short}</span>
          <RatingChip value={s.rating} />
          <span role="cell" className={`pea-score-c${s.comment ? '' : ' is-empty'}`} title={s.comment || undefined}>
            {s.comment || 'No comment'}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The accent a card's left edge takes: red for a bad outcome, orange for an extension. */
function attentionAccent(r) {
  if (!r.attention) return '';
  if (r.decision?.startsWith('Extend')) return 'warn';
  return 'crit';
}

/** Imported from the old sheet: free text, no per-question ratings. */
function LegacyBody({ r }) {
  return (
    <>
      <p className="pea-ev-legacy-note">
        <CloudUploadOutlined /> <em>No numeric rating — imported</em>
      </p>
      <div className="pea-ev-legacy-banner">
        <strong>Imported from the original spreadsheet</strong> — the old form stored free text, so there are no
        per-question ratings.
      </div>
      <pre className="pea-ev-legacy-raw">{r.legacy.raw || 'No text was recorded.'}</pre>
    </>
  );
}

/**
 * A submitted evaluation, in full.
 * @param {{r: object, to: string}} props - `to` is the profile link, carrying the list the reader is in
 */
export function EvaluationCard({ r, to }) {
  const accent = attentionAccent(r);
  const legacy = !!r.legacy && !r.scores.length;

  return (
    <article className={`pea-ev-card${accent ? ` pea-ev-card--${accent}` : ''}`}>
      <header className="pea-ev-head">
        <Avatar name={r.employeeName} />
        <div className="pea-ev-who">
          <Link to={to} className="pea-ev-name">{r.employeeName}</Link>
          <div className="pea-ev-sub">{evaluationLine(r)}</div>
        </div>
        <SubmittedPill />
      </header>

      <div className="pea-ev-meta">
        <ClockCircleOutlined /> {legacy ? `Submitted by ${r.rmName} · recorded on the old form` : submittedLine(r)}
      </div>

      {!legacy && (
        <div className="pea-ev-score">
          <BigAverage value={r.avgRating} />
          {r.band && <StatusPill tone={r.band.tone} nodot>{r.band.label}</StatusPill>}
          <Delta value={r.delta} />
          <span className="pea-grow" />
          {r.decision && <StatusPill tone={decisionTone(r.decision)} nodot>{r.decision}</StatusPill>}
          {r.attention && (
            <Tooltip title={`Needs attention: ${r.attentionReasons.join(' · ')}`}>
              <span className={`pea-flag pea-flag--${accent}`} aria-label="Needs attention"><FlagOutlined /></span>
            </Tooltip>
          )}
        </div>
      )}

      {legacy ? (
        <LegacyBody r={r} />
      ) : (
        <>
          <QuoteBlock text={r.remarks} author={r.remarks ? r.rmName : null} />

          {r.reason && (
            <p className="pea-ev-reason pea-clamp-2">
              <span className="pea-ev-reason-label">Reason for decision</span> {r.reason}
            </p>
          )}

          {r.scores.length > 0 && <ScoreRows scores={r.scores} />}
        </>
      )}

      <footer className="pea-ev-foot">
        <span className="pea-muted">
          <MessageOutlined />{' '}
          {legacy
            ? 'no per-question comments on imported records'
            : `${r.commentedCount} of ${r.questionCount} questions commented`}
        </span>
        <Link to={to} className="pea-link-strong">
          Open evaluation <ArrowRightOutlined />
        </Link>
      </footer>
    </article>
  );
}

/** Why an unsent evaluation has not gone — the fixable reason first. */
function notSentReason(r) {
  if (!r.rmEmail) return 'reporting manager email missing';
  if (!r.plEmail) return 'project leader email missing';
  return 'the daily send has not picked it up yet';
}

/**
 * An evaluation with no answer yet. Short on purpose: there is nothing the
 * manager has said, so the card says where the form is and offers the one
 * action that moves it on.
 */
export function ProgressCard({ r, to, onRemind, reminding }) {
  const detail = {
    waiting: `Sent ${shortDate(r.sentAt)} to ${r.rmName} · waiting ${daysLabel(r.waitingDays)}${
      r.reminderCount ? ` · ${r.reminderCount} reminder${r.reminderCount === 1 ? '' : 's'}` : ''}`,
    opened: `Opened ${shortDate(r.openedAt)} by ${r.rmName} · not submitted yet`,
    not_sent: `Due ${shortDate(r.dueDate)} · not sent — ${notSentReason(r)}`,
    scheduled: `Due ${shortDate(r.dueDate)} · sent to ${r.rmName} automatically`,
    closed: 'Closed — this evaluation is no longer needed.',
  }[r.bucket];

  const note = {
    waiting: `No comments yet — the link is with ${r.rmName}.`,
    opened: 'Manager has the form open — comments will appear here when submitted.',
    not_sent: 'Nothing has gone to the manager yet.',
    scheduled: 'Scheduled — the form goes out on the due date.',
    closed: 'Nothing was collected for this evaluation.',
  }[r.bucket];

  const missingContact = r.bucket === 'not_sent' && (!r.rmEmail || !r.plEmail);

  let action = null;
  if ((r.bucket === 'waiting' || r.bucket === 'opened') && r.linkLive) {
    action = (
      <Popconfirm
        title="Send an extra reminder?"
        description={<div style={{ maxWidth: 280 }}>Emails {r.rmEmail} again with the link they already have.</div>}
        okText="Send"
        onConfirm={() => onRemind?.(r)}
      >
        <Button size="small" loading={reminding}>Remind</Button>
      </Popconfirm>
    );
  } else if (missingContact) {
    action = <Link to={`/employees/${r.employeeId}`}><Button size="small">Fix details</Button></Link>;
  } else if (r.bucket === 'not_sent' || r.bucket === 'scheduled') {
    action = <Link to={to}><Button size="small">Send now</Button></Link>;
  }

  return (
    <article className="pea-ev-card pea-ev-card--mini">
      <header className="pea-ev-head">
        <Avatar name={r.employeeName} />
        <div className="pea-ev-who">
          <Link to={to} className="pea-ev-name">{r.employeeName}</Link>
          <div className="pea-ev-sub">{evaluationLine(r)}</div>
        </div>
      </header>
      <div><BucketPill bucket={r.bucket} /></div>
      <p className="pea-ev-detail">{detail}</p>
      <p className="pea-ev-note"><MessageOutlined /> <em>{note}</em></p>
      <footer className="pea-ev-foot">
        {action || <span />}
        <Link to={to} className="pea-link-strong">Open <ArrowRightOutlined /></Link>
      </footer>
    </article>
  );
}

/** A skeleton in the shape of the card — loading is never a blank panel. */
export function CardSkeleton({ mini = false }) {
  return (
    <div className={`pea-ev-card pea-skel-card${mini ? ' pea-ev-card--mini' : ''}`} aria-busy="true" aria-label="Loading">
      <div className="pea-skel-row">
        <span className="pea-skel pea-skel--circle" />
        <span style={{ flex: 1 }}>
          <span className="pea-skel pea-skel--line" style={{ width: '55%' }} />
          <span className="pea-skel pea-skel--line pea-skel--thin" style={{ width: '32%' }} />
        </span>
        {!mini && <span className="pea-skel pea-skel--pill" />}
      </div>
      <span className="pea-skel pea-skel--line pea-skel--thin" style={{ width: '70%' }} />
      {!mini && <span className="pea-skel pea-skel--block" />}
      <span className="pea-skel pea-skel--line pea-skel--thin" style={{ width: '95%' }} />
      <span className="pea-skel pea-skel--line pea-skel--thin" style={{ width: '82%' }} />
      {!mini && <span className="pea-skel pea-skel--line pea-skel--thin" style={{ width: '88%' }} />}
    </div>
  );
}

/**
 * Could not load, or not allowed — say why, and offer the way out.
 * @param {{error: any, onRetry?: () => void, extra?: React.ReactNode}} props
 */
export function LoadProblem({ error, onRetry, extra, what = 'This evaluation' }) {
  const status = error?.response?.status;

  if (status === 403) {
    return (
      <div className="pea-state">
        <span className="pea-state-icon"><LockOutlined /></span>
        <h3>You don’t have access to evaluations</h3>
        <p>
          Ask an admin to switch on <strong>Evaluations</strong> or <strong>Employees</strong> for you under Admin
          Portal → Module Access.
        </p>
      </div>
    );
  }

  const notFound = status === 404;
  // A server fault or no answer at all reads the same to the person looking at
  // it; only a 4xx carries a message written for them.
  const said = status && status < 500 && error?.friendlyMessage
    ? `${error.friendlyMessage.replace(/[.\s]+$/, '')}.`
    : 'The server did not answer.';
  return (
    <div className="pea-state">
      <span className="pea-state-icon pea-state-icon--crit"><ExclamationCircleOutlined /></span>
      <h3>{notFound ? `${what} was not found` : `${what} could not be loaded`}</h3>
      <p>
        {notFound ? 'It may have been removed, or the link is wrong.' : `${said} Nothing was changed.`}
      </p>
      <div className="pea-state-actions">
        {!notFound && onRetry && <Button type="primary" onClick={onRetry}>Try again</Button>}
        {extra}
      </div>
    </div>
  );
}
