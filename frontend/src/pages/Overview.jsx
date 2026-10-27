/**
 * Dashboard — what needs action now, and how evaluations are trending.
 *
 * The file is still Overview.jsx: it was briefly called Overview, and renaming
 * the file would churn every import for no gain.
 *
 * ── The 23-Sep redesign ────────────────────────────────────────────────────
 *
 *   · One sentence says what came back: "Five evaluations came back this week.
 *     Three need a read." The second number is personal — it counts the
 *     feedback needing attention that THIS user has not opened yet.
 *   · "Act on these first" now includes that feedback — not confirmed,
 *     extended, low scores — with a "Read feedback" button that opens the
 *     evaluation itself. Reading it clears the row for that reader only.
 *   · Every figure still opens the list behind it, so a number is never a dead
 *     end.
 *
 * ── The 27-Oct walkthrough (Raginee Somani) ────────────────────────────────
 *
 *   · W-01 — "Preview" and "Send due emails now…" are gone. The daily send is
 *     automatic; a manual trigger only invited the question "why would I?".
 *     The sweep endpoint stays for the scheduler and the Admin Portal.
 *   · W-02 — "Coming up" and "Recently submitted" are gone: the tiles already
 *     say the same, and each tile opens the people behind its number.
 *   · W-03 — "In probation" opens the list too, like every other tile.
 *   · W-04 — no average across different people; it mixes fresher and
 *     experienced tracks and means nothing for any one person.
 *   Before these, the file is as at commit ce72b9a.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button, Alert, Spin, App, Tooltip, Tabs, Empty, Popconfirm,
} from 'antd';
import {
  DownloadOutlined, ArrowRightOutlined, ExclamationCircleOutlined, ClockCircleOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import api, { unwrap, TOKEN_KEY } from '../api.js';
import { useCurrentUser } from '../auth.js';
import StatusPill from '../components/StatusPill.jsx';
import { Avatar } from '../components/board/BoardParts.jsx';
import Analytics from './Analytics.jsx';
import { formatDate } from '../formatDate.js';
import { daysLabel } from '../evaluationDisplay.js';

/**
 * How each kind of problem is shown. Colour is never the only signal — the pill
 * always carries its wording. Feedback takes its tone from what it is about.
 */
const KIND = {
  blocked: { tone: 'crit', icon: <ExclamationCircleOutlined /> },
  decision: { tone: 'crit', icon: <ExclamationCircleOutlined />, label: 'Deadline passed' },
  feedback: { tone: 'crit', icon: <ExclamationCircleOutlined /> },
  not_sent: { tone: 'crit', icon: <ExclamationCircleOutlined /> },
  waiting: { tone: 'warn', icon: <ClockCircleOutlined /> },
};

const feedbackTone = (problem) => (problem === 'Probation extended' ? 'warn' : 'crit');

/** Numbers as words for the opening sentence, the way a person would say them. */
const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const say = (n, lower = false) => {
  const w = n <= 10 ? WORDS[n] : String(n);
  return lower ? w.toLowerCase() : w;
};

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

/** The one list that replaces four tables. */
function NeedsAction({ data, isLoading }) {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const remind = useMutation({
    mutationFn: (id) => api.post('/evaluations/remind', { ids: [id] }).then((r) => r.data),
    onSuccess: (res) => {
      if (res.data?.skipped?.length) message.warning(res.data.skipped[0].reason, 6);
      else message.success(res.message);
      qc.invalidateQueries({ queryKey: ['needs-action'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  if (isLoading) return <section className="pea-card pea-card-pad"><Spin /></section>;
  const items = data?.items || [];

  return (
    <section className="pea-card pea-todo">
      <header className="pea-todo-head">
        <h3>Act on these first</h3>
        <span className="pea-muted pea-small">
          {data?.total ? `${data.total} item${data.total === 1 ? '' : 's'} · most urgent at the top` : ''}
        </span>
      </header>

      {items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing needs attention right now." />
      ) : (
        <ul className="pea-todo-list">
          {items.map((r) => {
            const k = KIND[r.kind] || KIND.waiting;
            const tone = r.kind === 'feedback' ? feedbackTone(r.problem) : k.tone;
            const about = String(r.title || '').split(' · ').slice(1).join(' · ');
            return (
              <li key={`${r.kind}-${r.employeeId}-${r.cycleId || ''}`} className={`pea-todo-row${r.kind === 'feedback' ? ' is-feedback' : ''}`}>
                <Avatar name={r.employeeName} size="sm" />
                <div className="pea-todo-who">
                  <Link to={`/employees/${r.employeeId}`} className="pea-todo-name">{r.employeeName}</Link>
                  <div className="pea-muted pea-small">
                    {about}
                    {r.stopped > 1 ? ` · ${r.stopped} evaluations stopped` : ''}
                  </div>
                </div>
                <div className="pea-todo-pill">
                  <StatusPill tone={tone} nodot className="pea-pill-icon">
                    {k.icon} {k.label || r.problem}
                  </StatusPill>
                </div>
                <p className="pea-todo-detail">{r.detail}</p>
                <span className="pea-todo-days pea-muted">{daysLabel(r.days)}</span>
                <div className="pea-todo-go">
                  {r.kind === 'feedback' ? (
                    <Link to={r.link}>
                      <Button type="primary" icon={<MessageOutlined />}>Read feedback</Button>
                    </Link>
                  ) : r.kind === 'waiting' && r.cycleId ? (
                    <Popconfirm
                      title="Send an extra reminder?"
                      description={<div style={{ maxWidth: 280 }}>Emails the reporting manager again with the link they already have.</div>}
                      okText="Send"
                      onConfirm={() => remind.mutate(r.cycleId)}
                    >
                      <Button loading={remind.isPending && remind.variables === r.cycleId}>Remind now</Button>
                    </Popconfirm>
                  ) : (
                    <Link to={r.link}><Button>{r.action}</Button></Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export default function Overview() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [tab, setTab] = useState('action');

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(unwrap),
  });

  const { data: counts } = useQuery({
    queryKey: ['evaluation-counts'],
    queryFn: () => api.get('/evaluations/counts').then(unwrap),
    retry: false,
  });

  const { data: action, isLoading: actionLoading } = useQuery({
    queryKey: ['needs-action'],
    queryFn: () => api.get('/dashboard/needs-action').then(unwrap),
  });

  const download = async () => {
    const res = await fetch('/api/dashboard/export', {
      headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` },
    });
    if (!res.ok) return message.error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Probation Evaluation - ${formatDate(new Date())}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <Spin size="large" style={{ display: 'block', marginTop: 80 }} />;
  if (!data) return <Alert type="error" message="Could not load the dashboard" />;

  const { employees: emp, evaluations: ev } = data;

  /**
   * Every figure opens the list behind it — a number is never a dead end.
   * W-03 — and the list holds exactly the people the number counts, so a tile
   * may carry extra filters (the end date on the "Due" tile).
   */
  const openBoard = (status, extra = {}) => {
    const q = new URLSearchParams({ ...(status ? { status } : {}), ...extra });
    navigate(`/evaluations${q.toString() ? `?${q}` : ''}`);
  };
  // Q-1 (27-10-2026) — the "Due" tile looks two months ahead; the server says
  // up to which day, so the list it opens stops on the same day. It was 14
  // days, worked out here:
  // const in14 = new Date(Date.now() + 14 * 86_400_000).toLocaleDateString('en-CA', { timeZone: data.timezone });
  const dueUntil = ev.dueAheadUntil;
  const dueMonths = ev.dueAheadMonths ?? 2;

  const now = new Date();
  const dateLine = now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const week = action?.summary?.submittedThisWeek ?? 0;
  const needRead = action?.summary?.needRead ?? 0;
  const summary = week === 0
    ? 'No evaluations came back this week.'
    : `${say(week)} evaluation${week === 1 ? '' : 's'} came back this week.${
      needRead ? ` ${say(needRead)} still need${needRead === 1 ? 's' : ''} a read.` : ' None needs a read.'}`;

  const oldestWaiting = (data.awaitingList || []).reduce((m, a) => Math.max(m, a.daysWaiting ?? 0), 0);

  return (
    <>
      <div className="pea-dash-head">
        <div>
          <div className="pea-eyebrow">{dateLine}</div>
          <h2 className="pea-display">{greeting(now)}, {user.first_name || user.username}</h2>
          <p className="pea-lead">{summary}</p>
        </div>
        <div className="pea-dash-actions">
          <Tooltip title="Download a snapshot in the old master workbook layout. Changes nothing.">
            <Button icon={<DownloadOutlined />} onClick={download}>Export</Button>
          </Tooltip>
        </div>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        className="pea-dash-tabs"
        items={[
          { key: 'action', label: 'Needs action' },
          { key: 'trends', label: 'Trends' },
        ]}
      />

      {tab === 'action' ? (
        <>
          <div className="pea-tiles">
            {/* W-03 — a div acting as a button rather than a <button>, because
                the "archived" link inside it may not sit in a real button. */}
            <div
              className="pea-tile pea-tile--link"
              role="button"
              tabIndex={0}
              onClick={() => navigate('/employees?state=probation')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/employees?state=probation'); }
              }}
            >
              <strong>{emp.inProbation}</strong>
              <span>In probation</span>
              {/* Archive (07-10-2026) — the confirmed are archived the morning
                  after, so "N confirmed" would read 0 almost always. It was:
              <small>{emp.confirmed} confirmed · {emp.extended} extended</small> */}
              <small>
                {emp.extended} extended
                {emp.archived != null && (
                  <> · <Link to="/employees?state=archived" onClick={(e) => e.stopPropagation()}>{emp.archived} archived</Link></>
                )}
              </small>
            </div>
            {/* W-03 — was openBoard('waiting'): that chip leaves out the opened
                links this number counts. */}
            <button type="button" className="pea-tile" onClick={() => openBoard('with_manager')}>
              <strong>{counts?.waiting ?? ev.awaitingResponse}</strong>
              <span>Waiting for manager</span>
              <small>{oldestWaiting ? `oldest waiting ${daysLabel(oldestWaiting)}` : 'nobody is waiting'}</small>
            </button>
            <button type="button" className="pea-tile" onClick={() => openBoard('not_sent')}>
              <strong className={(counts?.not_sent ?? ev.overdue) ? 'pea-ink-muted' : ''}>{counts?.not_sent ?? ev.overdue}</strong>
              <span>Not sent yet</span>
              <small>{(counts?.not_sent ?? ev.overdue) ? 'needs a fix' : 'all sent on time'}</small>
            </button>
            {/* W-03 — was openBoard('scheduled'): every future evaluation, not
                only the next 14 days, so the list did not match the number. */}
            {/* Q-1 — "Due in 14 days" became "Due in the next 2 months". */}
            <button type="button" className="pea-tile" onClick={() => openBoard('scheduled', dueUntil ? { to: dueUntil } : {})}>
              <strong>{counts?.due_soon ?? ev.dueAhead}</strong>
              <span>Due in the next {dueMonths} months</span>
              <small>sent automatically</small>
            </button>
            <button type="button" className="pea-tile pea-tile--accent" onClick={() => openBoard('submitted')}>
              <strong>{ev.completed} <em>/ {ev.total}</em></strong>
              <span>Submitted</span>
              {/* W-04 — was: {ev.averageRating != null ? `average ${ev.averageRating.toFixed(2)} · ` : ''} */}
              <small>
                <span className="pea-link-strong">open the board <ArrowRightOutlined /></span>
              </small>
            </button>
          </div>

          <NeedsAction data={action} isLoading={actionLoading} />

          {/* W-02 — the "Coming up" and "Recently submitted" pair stood here
              (see ce72b9a). "Due in 14 days" and "Submitted" open the same
              people, so the pair only repeated the tiles. */}
        </>
      ) : (
        // The whole Analytics screen, heading suppressed. Resource trends lead
        // it and the aggregate charts sit collapsed underneath — one
        // implementation, so the two can never drift apart.
        <Analytics embedded />
      )}
    </>
  );
}
