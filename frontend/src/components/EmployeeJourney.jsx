/**
 * EmployeeJourney — one person's probation, evaluation by evaluation.
 *
 * Two panels from the redesign:
 *
 *   · "Where Riya is" — one dot per evaluation, with its date and average.
 *     Click a dot to open that evaluation in full.
 *   · "Every comment, evaluation by evaluation" — a grid with the evaluations
 *     across and the questions down, the manager's words in every cell and a
 *     ▲▼ where a rating moved since the evaluation before. It answers "is this
 *     person growing?" in the manager's own words, not only as a line on a
 *     chart.
 *
 * Built from the employee record the page already loads — no extra request.
 */
import { Link, useNavigate } from 'react-router-dom';
import { Button } from 'antd';
import { ArrowRightOutlined, CaretDownFilled, CaretUpFilled, CheckOutlined, MessageOutlined } from '@ant-design/icons';
import StatusPill from './StatusPill.jsx';
import { BucketPill, Delta, RatingChip } from './board/BoardParts.jsx';
import { avg, decisionTone, ratingTone, shortDate } from '../evaluationDisplay.js';

/** How far apart the first and latest averages must be to call it a trend. Matches analytics TREND_BAND. */
export const TREND_BAND = 0.3;

/** The board's status bucket for a raw cycle row from /employees/:id/full. */
export function bucketOf(c, today = new Date(new Date().toDateString())) {
  if (c.status === 'completed') return 'submitted';
  if (c.status === 'opened') return 'opened';
  if (c.status === 'email_sent') return 'waiting';
  if (c.status === 'pending') return new Date(String(c.due_date).slice(0, 10)) <= today ? 'not_sent' : 'scheduled';
  return 'closed';
}

/**
 * "Improving · 3.14 → 3.71", from the first and the latest submitted average.
 * @returns {{tone: string, text: string}|null}
 */
export function trendOf(cycles) {
  const done = cycles.filter((c) => c.status === 'completed' && c.avg_rating != null);
  if (done.length < 2) return null;
  const first = Number(done[0].avg_rating);
  const last = Number(done.at(-1).avg_rating);
  const diff = last - first;
  const word = diff >= TREND_BAND ? 'Improving' : diff <= -TREND_BAND ? 'Declining' : 'Steady';
  return { tone: word === 'Improving' ? 'ok' : word === 'Declining' ? 'crit' : 'mute', word, text: `${word} · ${avg(first)} → ${avg(last)}` };
}

/** Is this cycle the one carrying the decision? The highest-numbered one. */
const finalSeq = (cycles) => cycles.reduce((m, c) => Math.max(m, c.seq_no), 0);

/** The line under each dot on the stepper. */
function dotNote(c, isFinal) {
  const b = bucketOf(c);
  const prefix = c.is_extension ? 'Extension' : isFinal ? 'Final' : null;
  if (b === 'submitted') return `Submitted ${shortDate(c.submitted_at)}`;
  if (b === 'waiting') return `Waiting · sent ${shortDate(c.sent_at)}`;
  if (b === 'opened') return `Opened ${shortDate(c.opened_at)}`;
  if (b === 'not_sent') return `Not sent · due ${shortDate(c.due_date)}`;
  if (b === 'closed') return 'Closed';
  return `${prefix || 'Scheduled'} · due ${shortDate(c.due_date)}`;
}

/** "Where Riya is". */
export function JourneyStepper({ employee }) {
  const navigate = useNavigate();
  const cycles = employee.cycles || [];
  const first = String(employee.full_name || '').split(' ')[0];
  const lastSeq = finalSeq(cycles);
  const latestDone = cycles.filter((c) => c.status === 'completed').at(-1)?.seq_no;

  if (!cycles.length) {
    return (
      <section className="pea-card pea-card-pad">
        <h3 className="pea-panel-title">Where {first} is</h3>
        <p className="pea-muted">No evaluations are scheduled yet.</p>
      </section>
    );
  }

  return (
    <section className="pea-card pea-card-pad">
      <div className="pea-panel-head">
        <h3 className="pea-panel-title">Where {first} is</h3>
        <span className="pea-muted pea-small">Each dot is one evaluation — click one to open it in full</span>
      </div>
      <ol className="pea-journey" style={{ '--n': cycles.length }}>
        {cycles.map((c, i) => {
          const done = c.status === 'completed';
          const isFinal = c.seq_no === lastSeq;
          const next = cycles[i + 1];
          return (
            <li
              key={c.id}
              className={`pea-jdot-item${done ? ' is-done' : ''}${c.seq_no === latestDone ? ' is-latest' : ''}${next?.status === 'completed' ? ' line-done' : ''}`}
            >
              <button
                type="button"
                className={`pea-jdot${isFinal && !done ? ' is-final' : ''}`}
                onClick={() => navigate(`/evaluations/${c.id}`)}
                aria-label={`Evaluation ${c.seq_no} — ${dotNote(c, isFinal)}`}
              >
                {done ? <CheckOutlined /> : c.seq_no}
              </button>
              <div className="pea-jdot-label">E{c.seq_no}</div>
              <div className="pea-jdot-note">{dotNote(c, isFinal)}</div>
              <div className={`pea-jdot-avg pea-ink-${ratingTone(c.avg_rating)}`}>
                {c.avg_rating != null ? avg(c.avg_rating) : '—'}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** How many submitted evaluations get a full column before the oldest fold into "earlier". */
const FULL_COLUMNS = 4;

/** "Every comment, evaluation by evaluation". */
export function CommentMatrix({ employee }) {
  const cycles = employee.cycles || [];
  const done = cycles.filter((c) => c.status === 'completed');
  const latest = done.at(-1);
  const lastSeq = finalSeq(cycles);

  // The questions, in the order the manager saw them, across every evaluation.
  const questions = [];
  for (const c of done) {
    for (const s of c.scores || []) {
      if (!questions.some((q) => q.key === s.param_key)) {
        questions.push({ key: s.param_key, label: s.param_label, order: s.sort_order });
      }
    }
  }
  questions.sort((a, b) => a.order - b.order);

  // With many evaluations the oldest fold into one narrow "earlier" column, so
  // the ones worth reading keep room for their words.
  const foldCount = Math.max(0, done.length - FULL_COLUMNS);
  const folded = done.slice(0, foldCount);
  const shown = cycles.filter((c) => !folded.includes(c));

  const hasDecision = cycles.some((c) => c.confirmation_status);
  const prevOf = (c) => done.filter((d) => d.seq_no < c.seq_no).at(-1);
  const ratingOf = (c, key) => {
    const s = (c?.scores || []).find((x) => x.param_key === key);
    return s ? { rating: s.rating == null ? null : Number(s.rating), comment: s.comments } : null;
  };

  if (!done.length) {
    return (
      <section className="pea-card pea-card-pad">
        <h3 className="pea-panel-title">Every comment, evaluation by evaluation</h3>
        <p className="pea-muted"><MessageOutlined /> No evaluation has been submitted yet — the managers’ words will appear here.</p>
      </section>
    );
  }

  const headOf = (c) => {
    if (c.status === 'completed') {
      return `${shortDate(c.period_from)} → ${shortDate(c.period_to)}`;
    }
    if (c.status === 'skipped') return 'closed';
    return c.is_extension ? 'extension' : c.seq_no === lastSeq ? 'final' : 'scheduled';
  };

  const statusCell = (c) => {
    const b = bucketOf(c);
    if (b === 'submitted') {
      return (
        <>
          <BucketPill bucket={b} />
          <div className="pea-muted pea-small pea-mt4">{shortDate(c.submitted_at)} · {employee.rm_name}</div>
        </>
      );
    }
    if (b === 'scheduled') {
      return (
        <div className="pea-muted pea-small">
          <strong className="pea-ink-muted">Scheduled</strong><br />due {shortDate(c.due_date)}
          {c.seq_no === lastSeq && !c.is_extension ? ' · final' : ''}
        </div>
      );
    }
    return <BucketPill bucket={b} />;
  };

  return (
    <section className="pea-card pea-card-pad">
      <div className="pea-panel-head">
        <h3 className="pea-panel-title">Every comment, evaluation by evaluation</h3>
        <span className="pea-muted pea-small">
          <MessageOutlined /> Manager’s words in each cell · <CaretUpFilled className="pea-ink-ok" /><CaretDownFilled className="pea-ink-crit" /> change from the evaluation before
        </span>
        <span className="pea-grow" />
        {latest && (
          <Link to={`/evaluations/${latest.id}`}>
            <Button type="primary">Open evaluation {latest.seq_no} in full <ArrowRightOutlined /></Button>
          </Link>
        )}
      </div>

      <div className="pea-matrix-wrap">
        <table className="pea-matrix">
          <thead>
            <tr>
              <th className="pea-matrix-rowhead">Evaluation</th>
              {folded.length > 0 && (
                <th className="pea-matrix-fold">
                  E{folded.map((c) => c.seq_no).join(' · E')}
                  <div className="pea-muted pea-small">earlier</div>
                </th>
              )}
              {shown.map((c) => (
                <th
                  key={c.id}
                  className={`${c.status === 'completed' ? 'is-done' : 'is-future'}${c === latest ? ' is-latest' : ''}`}
                >
                  <div className="pea-matrix-colhead">
                    <Link to={`/evaluations/${c.id}`}>E{c.seq_no}</Link>
                    {c === latest && <span className="pea-latest">Latest</span>}
                  </div>
                  <div className="pea-muted pea-small">{headOf(c)}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <th className="pea-matrix-rowhead">Status</th>
              {folded.length > 0 && <td className="pea-matrix-fold pea-muted pea-small">{folded.map((c) => avg(c.avg_rating)).join(' · ')}</td>}
              {shown.map((c) => <td key={c.id} className={c === latest ? 'is-latest' : ''}>{statusCell(c)}</td>)}
            </tr>
            <tr>
              <th className="pea-matrix-rowhead">Average</th>
              {folded.length > 0 && <td className="pea-matrix-fold">…</td>}
              {shown.map((c) => {
                if (c.status !== 'completed') return <td key={c.id} className="pea-muted">—</td>;
                const prev = prevOf(c);
                const delta = prev && prev.avg_rating != null && c.avg_rating != null
                  ? Number((Number(c.avg_rating) - Number(prev.avg_rating)).toFixed(2))
                  : null;
                return (
                  <td key={c.id} className={c === latest ? 'is-latest' : ''}>
                    <span className={`pea-matrix-avg pea-ink-${ratingTone(c.avg_rating)}`}>{avg(c.avg_rating)}</span>
                    <small className="pea-muted"> / 5</small>{' '}
                    <Delta value={delta} showZero />
                  </td>
                );
              })}
            </tr>
            <tr>
              <th className="pea-matrix-rowhead">Overall comment</th>
              {folded.length > 0 && <td className="pea-matrix-fold">…</td>}
              {shown.map((c) => (
                <td key={c.id} className={c === latest ? 'is-latest' : ''}>
                  {c.status !== 'completed' ? <span className="pea-muted">—</span>
                    : c.remarks ? <em className="pea-clamp-4">{c.remarks}</em>
                      : <em className="pea-muted">No overall comment</em>}
                </td>
              ))}
            </tr>
            {hasDecision && (
              <tr>
                <th className="pea-matrix-rowhead">Decision</th>
                {folded.length > 0 && <td className="pea-matrix-fold">…</td>}
                {shown.map((c) => (
                  <td key={c.id} className={c === latest ? 'is-latest' : ''}>
                    {c.confirmation_status
                      ? <StatusPill tone={decisionTone(c.confirmation_status)} nodot>{c.confirmation_status}</StatusPill>
                      : <span className="pea-muted">—</span>}
                  </td>
                ))}
              </tr>
            )}
            {questions.map((q) => (
              <tr key={q.key}>
                <th className="pea-matrix-rowhead">{q.label}</th>
                {folded.length > 0 && <td className="pea-matrix-fold">…</td>}
                {shown.map((c) => {
                  if (c.status !== 'completed') return <td key={c.id} className="pea-muted">—</td>;
                  const cur = ratingOf(c, q.key);
                  if (!cur) return <td key={c.id} className={`pea-muted${c === latest ? ' is-latest' : ''}`}>—</td>;
                  const before = ratingOf(prevOf(c), q.key);
                  const moved = before && before.rating != null && cur.rating != null ? cur.rating - before.rating : 0;
                  return (
                    <td key={c.id} className={c === latest ? 'is-latest' : ''}>
                      <div className="pea-matrix-cell">
                        <span className="pea-matrix-chip">
                          <RatingChip value={cur.rating} />
                          {moved > 0 && <CaretUpFilled className="pea-matrix-move pea-ink-ok" aria-label="up" />}
                          {moved < 0 && <CaretDownFilled className="pea-matrix-move pea-ink-crit" aria-label="down" />}
                        </span>
                        {cur.comment
                          ? <span className="pea-clamp-3">{cur.comment}</span>
                          : <em className="pea-muted">No comment</em>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
