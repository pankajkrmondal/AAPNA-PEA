/**
 * EvaluationProfile — one evaluation, everything the manager said.
 *
 * Where every "Open evaluation", every Dashboard "Read feedback" and every
 * bell alert lands. It answers, in order:
 *
 *   1. where is it?      the status timeline — scheduled, sent, reminded,
 *                        opened, submitted — with the real dates;
 *   2. how did it go?    the average, its change, and the trend so far;
 *   3. what was decided, and why?
 *   4. what did the manager say, question by question, and what moved since
 *      the evaluation before?
 *
 * An evaluation not yet answered shows the same frame with "nothing back yet"
 * and the one action that moves it on. The page prints as a clean, signed
 * record (Print), with the navigation and buttons left off.
 */
import { useEffect } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { App, Button, Popconfirm, Tooltip } from 'antd';
import {
  ArrowLeftOutlined, BellOutlined, CalendarOutlined, CheckOutlined, ClockCircleOutlined, CopyOutlined,
  EyeOutlined, ExportOutlined, FlagOutlined, LeftOutlined, MessageOutlined, PrinterOutlined, RightOutlined,
  SendOutlined,
} from '@ant-design/icons';
import api, { unwrap } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';
import { Avatar, BucketPill, Delta, LoadProblem, RatingChip } from '../components/board/BoardParts.jsx';
import {
  avg, bucketMeta, decisionTone, formatDate, ratingTone, ratingWord, shortDate, shortDateTime, daysLabel,
  missingComments,
} from '../evaluationDisplay.js';
import { formatDateTime } from '../formatDate.js';
import { getUser } from '../auth.js';
import { useCrumbs } from '../crumbs.jsx';

/** What the navigation says the reader is walking. */
const WALK_LABEL = {
  all: 'All',
  attention: 'Needs attention',
  recent: 'Recently submitted',
  in_progress: 'In progress',
  submitted: 'Submitted',
  waiting: 'Waiting for manager',
  opened: 'Opened',
  scheduled: 'Scheduled',
  not_sent: 'Not sent',
  closed: 'Closed',
};

const STEP_ICON = {
  scheduled: <CalendarOutlined />,
  sent: <SendOutlined />,
  reminders: <BellOutlined />,
  opened: <EyeOutlined />,
  submitted: <CheckOutlined />,
};

/** The line under each timeline step. */
function stepNote(s, e) {
  if (s.key === 'scheduled') return `due ${shortDate(e.dueDate)}`;
  if (s.key === 'reminders') return s.dates?.length ? s.dates.map((d) => shortDate(d)).join(' · ') : 'sent';
  if (s.key === 'sent') return s.at ? shortDateTime(s.at) : e.bucket === 'scheduled' ? 'on the due date' : 'not sent yet';
  if (s.key === 'opened') return s.at ? shortDateTime(s.at) : 'not opened yet';
  if (s.key === 'submitted') return s.at ? shortDateTime(s.at) : 'waiting for the manager';
  return '';
}

/** Scheduled → sent → reminders → opened → submitted. Stacks vertically on a phone. */
function StatusTimeline({ e }) {
  return (
    <ol className="pea-steps">
      {e.timeline.map((s) => (
        <li
          key={s.key}
          className={`pea-step${s.done ? ' is-done' : ''}${s.current ? ' is-current' : ''} pea-step--${s.key}`}
        >
          <span className="pea-step-icon">{STEP_ICON[s.key]}</span>
          <div>
            <div className="pea-step-label">{s.label}</div>
            <div className="pea-step-note">{stepNote(s, e)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The average as a ring, the way the design shows it. */
function Ring({ value }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(1, Number(value) / 5));
  return (
    <svg className={`pea-ring pea-ink-${ratingTone(value)}`} viewBox="0 0 110 110" role="img" aria-label={`Average ${avg(value)} out of 5`}>
      <circle cx="55" cy="55" r={r} className="pea-ring-track" />
      <circle
        cx="55" cy="55" r={r}
        className="pea-ring-value"
        strokeDasharray={`${c * pct} ${c}`}
        transform="rotate(-90 55 55)"
      />
      <text x="55" y="56" textAnchor="middle" className="pea-ring-num">{avg(value)}</text>
      <text x="55" y="74" textAnchor="middle" className="pea-ring-sub">out of 5</text>
    </svg>
  );
}

/** Every submitted average so far, E1 … this one. */
function Sparkline({ history }) {
  if (history.length < 2) return null;
  const w = 260;
  const h = 44;
  const pad = 12;
  const x = (i) => pad + (i * (w - pad * 2)) / (history.length - 1);
  const y = (v) => h - 6 - ((v - 1) / 4) * (h - 12);
  const points = history.map((p, i) => `${x(i)},${y(p.avg)}`).join(' ');
  return (
    <div className="pea-spark">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label="Average by evaluation">
        <polyline points={points} className="pea-spark-line" />
        {history.map((p, i) => (
          <circle key={p.seqNo} cx={x(i)} cy={y(p.avg)} r={p.current ? 4 : 3} className={p.current ? 'is-current' : ''}>
            <title>{`E${p.seqNo}: ${avg(p.avg)}`}</title>
          </circle>
        ))}
      </svg>
      <div className="pea-spark-labels">
        {history.map((p) => <span key={p.seqNo} className={p.current ? 'is-current' : ''}>E{p.seqNo}</span>)}
      </div>
    </div>
  );
}

/** Five dots filled to the rating, in its tone. */
function Dots({ value }) {
  const n = value == null ? 0 : Math.round(Number(value));
  return (
    <span className={`pea-dots pea-ink-${ratingTone(value)}`} aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}
    </span>
  );
}

/** "↓ 1 since E5" — only where something moved. Unchanged says nothing. */
function QuestionDelta({ delta, since }) {
  if (!delta || !since) return null;
  return <Delta value={delta} suffix={` since E${since}`} />;
}

/** Scroll to a question card without touching the URL. */
function jumpTo(ev, key) {
  ev.preventDefault();
  document.getElementById(`q-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** The rail's "All seven ratings": the shape of the evaluation at a glance. Each row jumps to its question. */
function RatingsPanel({ scores }) {
  const count = scores.length === 7 ? 'seven' : scores.length;
  return (
    <section className="pea-card pea-card-pad pea-rail-panel pea-no-print">
      <div className="pea-kicker">All {count} ratings</div>
      <ul className="pea-rail-list">
        {scores.map((s) => (
          <li key={s.key}>
            <a href={`#q-${s.key}`} onClick={(ev) => jumpTo(ev, s.key)} className="pea-rail-rating">
              <span className="pea-rail-label" title={s.label}>{s.short}</span>
              <Dots value={s.rating} />
              <RatingChip value={s.rating} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The rail's "This probation": E1 … En, the current one marked, each one click away. */
function ProbationPanel({ e, walk }) {
  if (!e.probation?.length) return null;
  return (
    <section className="pea-card pea-card-pad pea-rail-panel pea-no-print">
      <div className="pea-kicker">This probation</div>
      <ol className="pea-rail-list">
        {e.probation.map((p) => {
          const body = (
            <>
              <span className="pea-rail-seq">E{p.seqNo}{p.isExtension ? ' · ext' : ''}</span>
              <span className="pea-rail-date">{p.submitted ? shortDate(p.date) : `due ${shortDate(p.date)}`}</span>
              <span className={`pea-rail-avg pea-ink-${ratingTone(p.avg)}`}>{p.avg == null ? '—' : avg(p.avg)}</span>
            </>
          );
          return (
            <li key={p.id}>
              {p.current ? (
                <span className="pea-rail-step is-current" aria-current="page">{body}</span>
              ) : (
                <Link to={`/evaluations/${p.id}${walk ? `?${walk}` : ''}`} className="pea-rail-step">{body}</Link>
              )}
            </li>
          );
        })}
      </ol>
      <Link to={`/employees/${e.employeeId}`} className="pea-link-strong pea-rail-more">
        The whole journey <RightOutlined />
      </Link>
    </section>
  );
}

/** "22-Sep-2026 at 15:04" */
const printedAt = (d = new Date()) =>
  `${formatDate(d)} at ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/**
 * The printed evaluation record (design 18). A layout of its own rather than
 * the screen squeezed onto paper: one page, a letterhead, four facts, the
 * decision and its reason, the overall comment, and every question as a table
 * row. Hidden on screen; everything else is hidden in print.
 */
function PrintRecord({ e, me }) {
  const submitted = e.bucket === 'submitted';
  const legacy = !!e.legacy && !e.scores.length;
  const suffix = e.isExtension ? ' (extension)' : e.isFinal ? ' (final)' : '';
  const reminders = e.reminderCount
    ? `${e.reminderCount} reminder${e.reminderCount === 1 ? '' : 's'}`
    : 'no reminders';
  const response = !submitted
    ? (e.sentAt ? `Sent ${formatDate(e.sentAt)} · ${reminders}` : 'Not sent yet')
    : e.daysAfterSending == null ? reminders
      : `${e.daysAfterSending === 0 ? 'same day as sending' : `${daysLabel(e.daysAfterSending)} after sending`} · ${reminders}`;
  const change = e.delta != null && e.previousSeqNo
    ? ` (${e.delta > 0 ? '+' : e.delta < 0 ? '−' : '±'}${Math.abs(e.delta).toFixed(2)} vs evaluation ${e.previousSeqNo})`
    : '';
  const who = me.first_name || me.username || 'HR';
  const role = { superadmin: 'Super Admin', admin: 'Admin', hr: 'HR' }[String(me.role || '').toLowerCase()] || 'HR';

  return (
    <article className="pea-print-record" aria-hidden>
      <header className="pr-head">
        <div className="pr-brand">
          <span className="pr-mark">PEA</span>
          <div><strong>AAPNA</strong><span>Performance evaluation</span></div>
        </div>
        <div className="pr-conf"><strong>Evaluation record</strong><span>Confidential</span></div>
      </header>

      <h1 className="pr-title">{e.employeeName} — Evaluation {e.seqNo} of {e.of}{suffix}</h1>
      <p className="pr-meta">
        {e.cohort === 'experienced' ? 'Experienced' : 'Fresher'}
        {e.periodFrom && <> · period {formatDate(e.periodFrom)} → {formatDate(e.periodTo)}</>}
        {' '}· reporting manager {e.rmName}
      </p>

      <div className="pr-facts">
        <div><span>Status</span>{submitted ? `Submitted ${formatDate(e.submittedAt)} · ${shortDateTime(e.submittedAt).split(' · ')[1]}` : bucketMeta(e.bucket).pill}</div>
        <div><span>Submitted by</span>{submitted ? `${e.rmName} (reporting manager)` : `With ${e.rmName} (reporting manager)`}</div>
        <div><span>Response</span>{response}</div>
        <div>
          <span>Average rating</span>
          {e.avgRating == null ? '—' : <><strong>{avg(e.avgRating)} / 5</strong>{e.band ? ` — ${e.band.label}` : ''}{change}</>}
        </div>
      </div>

      {e.decision && (
        <section className="pr-decision">
          <h2>Confirmation decision — {e.decision}</h2>
          <p>
            <strong>Manager’s reason.</strong>{' '}
            {e.reason || <em>No reason was recorded{e.decision === 'Confirmed' ? ' — none is needed to confirm.' : '.'}</em>}
          </p>
          {e.nextEvaluation && (
            <p className="pr-muted">
              Evaluation {e.nextEvaluation.seqNo}{e.nextEvaluation.isExtension ? ' (extension)' : ''} scheduled for {formatDate(e.nextEvaluation.dueDate)}
            </p>
          )}
        </section>
      )}

      <section className="pr-overall">
        <h2>Manager’s overall comment</h2>
        {legacy
          ? <p className="pr-pre">{e.legacy.raw || 'No text was recorded.'}</p>
          : !submitted
            ? <p><em>No comments yet — {e.rmName} has not submitted this evaluation.</em></p>
            : e.remarks
              ? <p className="pr-pre">{e.remarks}</p>
              : <p><em>No overall comment — only the question comments below.</em></p>}
      </section>

      {!legacy && (
        <section>
          <h2 className="pr-h2">Question by question</h2>
          <table className="pr-table">
            <thead>
              <tr><th aria-label="Number" /><th>Question</th><th>Rating</th><th>Manager’s comment</th></tr>
            </thead>
            <tbody>
              {(submitted ? e.scores : e.questions).map((s, i) => {
                const low = submitted && s.rating !== null && s.rating <= 2;
                return (
                  <tr key={s.key} className={low ? 'is-low' : ''}>
                    <td className="pr-num">{i + 1}</td>
                    <td className="pr-q">{s.label}</td>
                    <td className="pr-rating">
                      {submitted
                        ? <><strong>{s.rating ?? '—'}</strong><span>{ratingWord(s.rating)}</span></>
                        : <em>—</em>}
                    </td>
                    <td>{submitted ? (s.comment || <em>No comment</em>) : <em>Awaiting answer</em>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      <footer className="pr-foot">
        Printed from PEA by {who} ({role}) on {printedAt()} · Confidential — performance information about a named employee.
      </footer>
    </article>
  );
}

export default function EvaluationProfile() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { message, modal } = App.useApp();

  const walk = params.toString();
  const { data: e, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['evaluation', id, walk],
    queryFn: () => api.get(`/evaluations/${id}`, { params: Object.fromEntries(params) }).then(unwrap),
  });

  useCrumbs(e
    ? [{ label: 'Evaluations', to: '/evaluations' }, { label: e.employeeName, to: `/employees/${e.employeeId}` }, { label: `Evaluation ${e.seqNo}` }]
    : [{ label: 'Evaluations', to: '/evaluations' }, { label: 'Evaluation' }]);

  // Opening a submitted evaluation is reading it: clear its "Read feedback" row
  // for this person (and only this person) on the Dashboard.
  const submitted = e?.bucket === 'submitted';
  useEffect(() => {
    if (!submitted || e?.read) return;
    api.post(`/evaluations/${id}/read`)
      .then(() => qc.invalidateQueries({ queryKey: ['needs-action'] }))
      .catch(() => { /* a receipt is a nicety; never an error on screen */ });
  }, [id, submitted, e?.read, qc]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['evaluation', id] });
    qc.invalidateQueries({ queryKey: ['board'] });
    qc.invalidateQueries({ queryKey: ['needs-action'] });
  };

  const remind = useMutation({
    mutationFn: () => api.post('/evaluations/remind', { ids: [id] }).then((r) => r.data),
    onSuccess: (res) => {
      if (res.data?.skipped?.length) message.warning(res.data.skipped[0].reason, 6);
      else message.success(res.message);
      refresh();
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const send = useMutation({
    mutationFn: () => api.post('/admin/send-evaluation', { office_email: e.employeeEmail, seq_no: e.seqNo }).then((r) => r.data),
    onSuccess: (res) => { message.success(res.message); refresh(); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${what} copied`);
    } catch {
      modal.info({ title: what, content: <div style={{ wordBreak: 'break-all' }}>{text}</div> });
    }
  };

  /** The manager's own form link, while it is still live. */
  const formLink = () => {
    const base = new URL(api.defaults.baseURL, window.location.origin);
    return `${base.origin}${base.pathname.replace(/\/$/, '')}/evaluation/${e.token}`;
  };

  // Back to the list the reader came from, filters intact.
  const back = `/evaluations${walk ? `?${walk}` : ''}`;
  const go = (target) => navigate(`/evaluations/${target.id}${walk ? `?${walk}` : ''}`);

  if (isLoading) {
    return (
      <div className="pea-profile">
        <div className="pea-card pea-card-pad"><div className="pea-skel pea-skel--line" style={{ width: '40%' }} /><div className="pea-skel pea-skel--block" /></div>
      </div>
    );
  }
  if (isError || !e) {
    return (
      <div className="pea-card pea-card-pad">
        <LoadProblem
          error={error}
          onRetry={refetch}
          extra={<Link to="/evaluations"><Button>Back to evaluations</Button></Link>}
        />
      </div>
    );
  }

  const nav = e.navigation;
  const me = getUser();
  const legacy = !!e.legacy && !e.scores.length;
  const since = e.previousSeqNo;
  // Beside "Question by question", only what is news: a gap in the comments,
  // and a change since the evaluation before when something actually moved.
  const moved = since && e.scores.some((s) => s.delta);
  const qheadNote = [missingComments(e), moved ? `change since evaluation ${since}` : null].filter(Boolean).join(' · ');

  return (
    <div className="pea-profile">
      {/* What Print produces: its own layout (design 18), not the screen squeezed. */}
      <PrintRecord e={e} me={me} />

      {/* ── Back · page actions · Previous · position · Next ──────────── */}
      <div className="pea-profile-nav pea-no-print">
        <Link to={back} className="pea-back"><ArrowLeftOutlined /> Back to evaluations</Link>
        <div className="pea-page-actions">
          <Button type="text" icon={<PrinterOutlined />} onClick={() => window.print()}>Print</Button>
          <Tooltip title="A link to this page for someone on the HR team (sign-in required).">
            <Button type="text" icon={<CopyOutlined />} onClick={() => copy(`${window.location.origin}/evaluations/${e.id}`, 'Link')}>
              Copy link
            </Button>
          </Tooltip>
          <Link to={`/employees/${e.employeeId}`}>
            <Button type="text" icon={<ExportOutlined />}>Employee page</Button>
          </Link>
        </div>
        <div className="pea-walk">
          <Button
            icon={<LeftOutlined />}
            disabled={!nav.previous}
            onClick={() => nav.previous && go(nav.previous)}
            title={nav.previous ? `${nav.previous.name} · evaluation ${nav.previous.seqNo}` : undefined}
          >
            {nav.previous ? nav.previous.name : 'Previous'}
          </Button>
          {nav.position && (
            <span className="pea-walk-pos">
              <strong>{nav.position}</strong> of {nav.total} in {WALK_LABEL[nav.status] || nav.status}
            </span>
          )}
          <Button
            disabled={!nav.next}
            onClick={() => nav.next && go(nav.next)}
            title={nav.next ? `${nav.next.name} · evaluation ${nav.next.seqNo}` : undefined}
          >
            {nav.next ? nav.next.name : 'Next'} <RightOutlined />
          </Button>
        </div>
      </div>

      {/* ── Who, which evaluation, and where it is ─────────────────────── */}
      <section className="pea-card pea-profile-hero">
        <div className="pea-profile-id">
          <Avatar name={e.employeeName} size="xl" />
          <div className="pea-profile-title">
            <div className="pea-eyebrow">
              Evaluation {e.seqNo} of {e.of}
              {e.isExtension ? ' · extension' : e.isFinal ? ' · final evaluation' : ''}
            </div>
            <h1 className="pea-display">{e.employeeName}</h1>
            <p className="pea-lead">
              {e.cohort === 'experienced' ? 'Experienced' : 'Fresher'}
              {e.periodFrom && <> · period {formatDate(e.periodFrom)} → {formatDate(e.periodTo)}</>}
              {' '}· reporting manager {e.rmName}
            </p>
          </div>
          <div className="pea-profile-pills">
            <BucketPill bucket={e.bucket} />
            {e.decision && <StatusPill tone={decisionTone(e.decision)} nodot>{e.decision}</StatusPill>}
          </div>
        </div>
        <StatusTimeline e={e} />
      </section>

      <div className="pea-profile-grid">
        {/* ── Left: the numbers, the decision, and the actions ─────────── */}
        <aside className="pea-profile-side">
          {submitted && !legacy && (
            <section className="pea-card pea-card-pad pea-no-print">
              <div className="pea-kicker">Overall rating</div>
              <div className="pea-rating-head">
                <Ring value={e.avgRating} />
                <div>
                  <div className={`pea-rating-word pea-ink-${ratingTone(e.avgRating)}`}>{e.band?.label}</div>
                  {since && <Delta value={e.delta} suffix={` vs E${since}`} />}
                </div>
              </div>
              <Sparkline history={e.history} />
              {missingComments(e) && (
                <div className="pea-side-foot">
                  <MessageOutlined /> {missingComments(e)}
                </div>
              )}
            </section>
          )}

          {e.decision && (
            <section className="pea-card pea-card-pad pea-decision-card">
              <div className="pea-kicker">Confirmation decision</div>
              <StatusPill tone={decisionTone(e.decision)} nodot>{e.decision}</StatusPill>
              <div className="pea-kicker pea-kicker--sub">Manager’s reason</div>
              {e.reason ? (
                <p className="pea-reason-text">{e.reason}</p>
              ) : (
                <p className="pea-muted"><em>No reason was recorded{e.decision === 'Confirmed' ? ' — none is needed to confirm.' : '.'}</em></p>
              )}
              {e.nextEvaluation && (
                <p className="pea-muted pea-small pea-next-eval">
                  <CalendarOutlined /> Evaluation {e.nextEvaluation.seqNo}
                  {e.nextEvaluation.isExtension ? ' (extension)' : ''} scheduled for {formatDate(e.nextEvaluation.dueDate)}
                </p>
              )}
            </section>
          )}

          {e.attention && (
            <section className="pea-card pea-card-pad pea-attention-card pea-no-print">
              <div className="pea-kicker pea-ink-warn"><FlagOutlined /> Needs attention</div>
              <ul>{e.attentionReasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </section>
          )}

          {!submitted && (
            <section className="pea-card pea-card-pad pea-nothing-card pea-no-print">
              <div className="pea-kicker"><ClockCircleOutlined /> Nothing back yet</div>
              {e.bucket === 'waiting' || e.bucket === 'opened' ? (
                <>
                  <p>The form is with <strong>{e.rmName}</strong>.</p>
                  <ul className="pea-dotlist">
                    <li>Sent {shortDateTime(e.sentAt)}</li>
                    {e.reminderCount > 0 && (
                      <li>
                        {e.reminderCount} reminder{e.reminderCount === 1 ? '' : 's'}
                        {e.timeline.find((s) => s.key === 'reminders')?.dates?.length
                          ? ` (${e.timeline.find((s) => s.key === 'reminders').dates.map((d) => shortDate(d)).join(', ')})`
                          : ''}
                      </li>
                    )}
                    {e.openedAt && <li>Opened {shortDateTime(e.openedAt)}</li>}
                    <li>Waiting {daysLabel(e.waitingDays)}</li>
                  </ul>
                  {e.linkLive && (
                    <div className="pea-side-actions">
                      <Popconfirm
                        title="Send an extra reminder?"
                        description={<div style={{ maxWidth: 280 }}>Emails {e.rmEmail} again with the link they already have.</div>}
                        okText="Send"
                        onConfirm={() => remind.mutate()}
                      >
                        <Button type="primary" icon={<BellOutlined />} loading={remind.isPending}>Remind now</Button>
                      </Popconfirm>
                      <Button icon={<CopyOutlined />} onClick={() => copy(formLink(), 'Form link')} block>Copy link</Button>
                    </div>
                  )}
                </>
              ) : e.bucket === 'closed' ? (
                <p>This evaluation was closed — it is no longer needed.</p>
              ) : (
                <>
                  <p>
                    {e.bucket === 'not_sent'
                      ? <>Due {formatDate(e.dueDate)} and <strong>not sent</strong>. Nothing has gone to {e.rmName} yet.</>
                      : <>Scheduled for {formatDate(e.dueDate)}. The form goes to <strong>{e.rmName}</strong> automatically on that day.</>}
                  </p>
                  {(!e.rmEmail || !e.plEmail) ? (
                    <Link to={`/employees/${e.employeeId}`}><Button type="primary" block>Fix details</Button></Link>
                  ) : (
                    <Popconfirm
                      title="Send this evaluation now?"
                      description={
                        <div style={{ maxWidth: 300 }}>
                          Evaluation {e.seqNo} for <strong>{e.employeeName}</strong> goes to <strong>{e.rmEmail}</strong>
                          {e.plEmail ? <>, copying {e.plEmail}</> : null}.
                        </div>
                      }
                      okText="Send now"
                      onConfirm={() => send.mutate()}
                    >
                      <Button type="primary" icon={<SendOutlined />} loading={send.isPending} block>Send now</Button>
                    </Popconfirm>
                  )}
                </>
              )}
            </section>
          )}

          {submitted && !legacy && e.scores.length > 0 && <RatingsPanel scores={e.scores} />}
          <ProbationPanel e={e} walk={walk} />
        </aside>

        {/* ── Right: what the manager said ────────────────────────────── */}
        <main className="pea-profile-main">
          <section className="pea-card pea-card-pad pea-overall">
            <div className="pea-kicker">Manager’s overall comment</div>
            {legacy ? (
              <>
                <div className="pea-ev-legacy-banner">
                  <strong>Imported from the original spreadsheet</strong> — the old form stored free text, so there are
                  no per-question ratings.
                </div>
                <pre className="pea-ev-legacy-raw">{e.legacy.raw || 'No text was recorded.'}</pre>
              </>
            ) : !submitted ? (
              <p className="pea-ev-nocomment">
                <MessageOutlined /> <em>No comments yet. {e.rmName} has not submitted this evaluation.</em>
              </p>
            ) : e.remarks ? (
              <figure className="pea-quote pea-quote--big">
                <span className="pea-quote-mark" aria-hidden>“</span>
                <blockquote>{e.remarks}</blockquote>
                <figcaption>
                  <Avatar name={e.rmName} size="sm" />
                  <span><strong>{e.rmName}</strong><br /><span className="pea-muted">Reporting manager · {formatDateTime(e.submittedAt)}</span></span>
                </figcaption>
              </figure>
            ) : (
              <p className="pea-ev-nocomment">
                <MessageOutlined /> <em>No overall comment — only the question comments below.</em>
              </p>
            )}
          </section>

          {!legacy && (
            <>
              <h2 className="pea-qhead">
                Question by question
                {submitted ? (
                  <span className="pea-muted pea-qhead-by">
                    answered by <Avatar name={e.rmName} size="xs" /> {e.rmName}
                    {qheadNote && <> · {qheadNote}</>}
                  </span>
                ) : (
                  <span className="pea-muted">
                    the {e.questions.length === 7 ? 'seven' : e.questions.length} questions the manager is answering
                  </span>
                )}
              </h2>

              {submitted ? (
                <ol className="pea-qlist">
                  {e.scores.map((s, i) => (
                    <li key={s.key} id={`q-${s.key}`} className={`pea-card pea-q${s.rating !== null && s.rating <= 2 ? ' is-low' : ''}`}>
                      <div className="pea-q-head">
                        <span className="pea-q-num">{i + 1}</span>
                        <h3>{s.label}</h3>
                        <span className="pea-grow" />
                        <RatingChip value={s.rating} size="md" />
                        <span className="pea-muted pea-small pea-q-word">{ratingWord(s.rating)}</span>
                        <QuestionDelta delta={s.delta} since={since} />
                      </div>
                      <div className="pea-q-body">
                        {s.comment ? (
                          <p className="pea-q-comment">{s.comment}</p>
                        ) : (
                          <>
                            <MessageOutlined className="pea-muted" />
                            <p className="pea-q-comment is-empty"><em>No comment on this question.</em></p>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <ol className="pea-qlist">
                  {e.questions.map((q, i) => (
                    <li key={q.key} className="pea-card pea-q pea-q--pending">
                      <div className="pea-q-head">
                        <span className="pea-q-num">{i + 1}</span>
                        <h3 className="pea-q-plain">{q.label}</h3>
                        <span className="pea-grow" />
                        <em className="pea-muted pea-small">awaiting answer</em>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </main>
      </div>

    </div>
  );
}
