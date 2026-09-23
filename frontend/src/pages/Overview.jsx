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
 *   · Recently submitted shows what the manager SAID, not only the average.
 *   · Every figure still opens the list behind it, so a number is never a dead
 *     end.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button, Alert, Spin, App, Tooltip, Tabs, Typography, Empty, Popconfirm,
} from 'antd';
import {
  DownloadOutlined, EyeOutlined, ArrowRightOutlined, ExclamationCircleOutlined, ClockCircleOutlined,
  MessageOutlined,
} from '@ant-design/icons';
import api, { unwrap, TOKEN_KEY } from '../api.js';
import { useCurrentUser } from '../auth.js';
import StatusPill from '../components/StatusPill.jsx';
import { Avatar } from '../components/board/BoardParts.jsx';
import Analytics from './Analytics.jsx';
import { formatDate } from '../formatDate.js';
import { avg, daysLabel, decisionTone, ratingTone, shortDate } from '../evaluationDisplay.js';

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
  // `modal` alongside `message`: the static Modal.confirm renders outside the
  // ConfigProvider, so it ignores the theme. This one confirms sending real
  // email, so it should look like the rest of the product.
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
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

  const sweep = useMutation({
    mutationFn: (dryRun) => api.post(`/admin/sweep?dryRun=${dryRun}`).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['needs-action'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  /** Dry run first, then confirm against the real numbers. */
  const confirmAndSweep = useMutation({
    mutationFn: () => api.post('/admin/sweep?dryRun=true').then((r) => r.data),
    onError: (err) => { message.error(err.friendlyMessage); },
    onSuccess: (res) => {
      const d = res.data || {};
      const evaluations = d.evaluations?.due ?? 0;
      const reminders = d.reminders?.due ?? 0;

      if (evaluations + reminders === 0) {
        message.info('Nothing is due right now, so no email would be sent.');
        return;
      }

      modal.confirm({
        title: 'Send these emails now?',
        width: 520,
        okText: `Send ${evaluations + reminders} email(s) now`,
        cancelText: 'Cancel',
        content: (
          <div>
            <p style={{ marginTop: 8 }}>This sends real email to reporting managers:</p>
            <ul style={{ paddingLeft: 18 }}>
              {evaluations > 0 && <li><strong>{evaluations}</strong> evaluation request(s) now due</li>}
              {reminders > 0 && <li><strong>{reminders}</strong> reminder(s) for evaluations already sent</li>}
            </ul>
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              The daily sweep would send these at 11:00 anyway. Running it now does not send
              anything twice.
            </Typography.Text>
          </div>
        ),
        onOk: () => sweep.mutateAsync(false),
      });
    },
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
    a.download = `Performance Evaluation - ${formatDate(new Date())}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <Spin size="large" style={{ display: 'block', marginTop: 80 }} />;
  if (!data) return <Alert type="error" message="Could not load the dashboard" />;

  const { employees: emp, evaluations: ev } = data;

  /** Every figure opens the list behind it — a number is never a dead end. */
  const openBoard = (status) => navigate(`/evaluations${status ? `?status=${status}` : ''}`);

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
          <Tooltip title="Shows what would be sent now. Nothing is sent or changed.">
            <Button icon={<EyeOutlined />} onClick={() => sweep.mutate(true)} loading={sweep.isPending}>
              Preview
            </Button>
          </Tooltip>
          <Tooltip title="Shows exactly what would be sent and asks before sending anything.">
            <Button
              type="primary"
              onClick={() => confirmAndSweep.mutate()}
              loading={confirmAndSweep.isPending || sweep.isPending}
            >
              Send due emails now…
            </Button>
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
            <div className="pea-tile">
              <strong>{emp.inProbation}</strong>
              <span>In probation</span>
              <small>{emp.confirmed} confirmed · {emp.extended} extended</small>
            </div>
            <button type="button" className="pea-tile" onClick={() => openBoard('waiting')}>
              <strong>{counts?.waiting ?? ev.awaitingResponse}</strong>
              <span>Waiting for manager</span>
              <small>{oldestWaiting ? `oldest waiting ${daysLabel(oldestWaiting)}` : 'nobody is waiting'}</small>
            </button>
            <button type="button" className="pea-tile" onClick={() => openBoard('not_sent')}>
              <strong className={(counts?.not_sent ?? ev.overdue) ? 'pea-ink-muted' : ''}>{counts?.not_sent ?? ev.overdue}</strong>
              <span>Not sent yet</span>
              <small>{(counts?.not_sent ?? ev.overdue) ? 'needs a fix' : 'all sent on time'}</small>
            </button>
            <button type="button" className="pea-tile" onClick={() => openBoard('scheduled')}>
              <strong>{counts?.due_soon ?? ev.dueInNext14Days}</strong>
              <span>Due in 14 days</span>
              <small>sent automatically</small>
            </button>
            <button type="button" className="pea-tile pea-tile--accent" onClick={() => openBoard('submitted')}>
              <strong>{ev.completed} <em>/ {ev.total}</em></strong>
              <span>Submitted</span>
              <small>
                {ev.averageRating != null ? `average ${ev.averageRating.toFixed(2)} · ` : ''}
                <span className="pea-link-strong">open the board <ArrowRightOutlined /></span>
              </small>
            </button>
          </div>

          <NeedsAction data={action} isLoading={actionLoading} />

          <div className="pea-overview-pair">
            <section className="pea-card pea-card-pad pea-mini-list">
              <header className="pea-mini-head">
                <h3>Coming up</h3>
                <span className="pea-muted pea-small">next 14 days</span>
              </header>
              {(data.upcomingList || []).length === 0 ? (
                <p className="pea-muted">Nothing falls due in the next 14 days.</p>
              ) : (
                <ul>
                  {data.upcomingList.slice(0, 8).map((r) => (
                    <li key={r.cycleId}>
                      <Avatar name={r.employee} size="xs" />
                      <Link to={`/evaluations/${r.cycleId}`} className="pea-mini-name">{r.employee}</Link>
                      <span className="pea-muted">evaluation {r.seqNo}</span>
                      <span className="pea-grow" />
                      <span className="pea-num pea-muted">{shortDate(r.dueDate)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="pea-card pea-card-pad pea-mini-list">
              <header className="pea-mini-head">
                <h3>Recently submitted</h3>
                <span className="pea-grow" />
                <Link to="/evaluations?status=submitted" className="pea-link-strong">
                  Open the board <ArrowRightOutlined />
                </Link>
              </header>
              {(data.recentSubmissions || []).length === 0 ? (
                <p className="pea-muted">No evaluations submitted yet.</p>
              ) : (
                <ul className="pea-recent">
                  {data.recentSubmissions.slice(0, 6).map((r) => (
                    <li key={r.cycleId}>
                      <Avatar name={r.employee} />
                      <div className="pea-recent-body">
                        <div>
                          <Link to={`/evaluations/${r.cycleId}`} className="pea-mini-name">{r.employee}</Link>{' '}
                          <span className="pea-muted pea-small">
                            E{r.seqNo}{r.isFinal ? ' · final' : ''} · {shortDate(r.submittedAt)}
                          </span>
                        </div>
                        {r.remarks ? (
                          <em className="pea-clamp-2">“{r.remarks}”</em>
                        ) : (
                          <em className="pea-muted">
                            No overall comment · {r.commentedCount} of {r.questionCount} questions commented
                          </em>
                        )}
                      </div>
                      <div className="pea-recent-score">
                        <strong className={`pea-ink-${ratingTone(r.average)}`}>{avg(r.average)}</strong>
                        {r.confirmation && (
                          <StatusPill tone={decisionTone(r.confirmation)} nodot>{r.confirmation}</StatusPill>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
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
