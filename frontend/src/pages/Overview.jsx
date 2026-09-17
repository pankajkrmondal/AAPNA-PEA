/**
 * Overview — what needs action now, and how evaluations are trending.
 *
 * Replaces the separate Dashboard and Analytics screens. Called Overview rather
 * than Dashboard because it holds two genuinely different things, and the tab
 * names say which is which: "Needs action" is for this morning, "Trends" is for
 * looking back.
 *
 * ── What changed from the old Dashboard ────────────────────────────────────
 *
 *   · Four capped tables and a warning box become ONE ranked list. Each row
 *     says what is wrong in plain words and carries the single action that
 *     fixes it.
 *   · Every figure opens its own list on the Evaluations screen, with the
 *     matching filter already applied — so a number is never a dead end.
 *   · The greeting, the ticking clock and the "AAPNA PEA Platform" badge are
 *     gone. They took the top third of the screen and told HR nothing.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Space, Button, Alert, Spin, App, Tooltip, Tabs, Typography, Modal, Empty,
} from 'antd';
// The KPI tiles lost their icon chips with the 17-Sep compact strip, so the
// icons those used are gone from this import too.
import {
  DownloadOutlined, SyncOutlined, EyeOutlined, RightOutlined,
} from '@ant-design/icons';
import api, { unwrap, TOKEN_KEY } from '../api.js';
import StatCard from '../components/StatCard.jsx';
import StatusPill from '../components/StatusPill.jsx';
import Analytics from './Analytics.jsx';
import { formatDate } from '../formatDate.js';

const ratio = (a, b) => (b ? a / b : null);

/**
 * How each kind of problem is shown. Colour is never the only signal — the pill
 * always carries its wording.
 *
 * `tone` names one of the six proposal states rather than an Ant tag colour, so
 * these rows match the status pills on every other screen.
 */
const KIND = {
  blocked: { tag: 'Cannot be sent', tone: 'crit' },
  decision: { tag: 'Decision due', tone: 'crit' },
  not_sent: { tag: 'Not sent yet', tone: 'crit' },
  waiting: { tag: 'Waiting', tone: 'warn' },
};

/**
 * The two small panels beside the action list.
 *
 * Both read `upcomingList` and `recentSubmissions`, which the dashboard
 * endpoint already returns and the built screen simply never drew — so these
 * cost no server work. They are deliberately short: this is peripheral vision
 * next to "Act on these first", not a second worklist.
 */
function SidePanel({ title, note, rows, empty, render }) {
  return (
    <Card
      className="pea-card pea-side-panel"
      size="small"
      title={<span className="pea-section-title">{title}</span>}
      extra={
        note ? (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{note}</Typography.Text>
        ) : null
      }
    >
      {rows.length === 0 ? (
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>{empty}</Typography.Text>
      ) : (
        <ul className="pea-side-list">{rows.map(render)}</ul>
      )}
    </Card>
  );
}

/** The one list that replaces four tables. */
function NeedsAction() {
  const { data, isLoading } = useQuery({
    queryKey: ['needs-action'],
    queryFn: () => api.get('/dashboard/needs-action').then(unwrap),
  });

  if (isLoading) return <Card className="pea-card" size="small"><Spin /></Card>;

  const items = data?.items || [];

  return (
    <Card
      className="pea-card"
      size="small"
      title={<span className="pea-section-title">Act on these first</span>}
      extra={
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {data?.total ? `${data.total} item(s) · most urgent at the top` : ''}
        </Typography.Text>
      }
    >
      {items.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Nothing needs attention right now."
        />
      ) : (
        <Table
          size="small"
          rowKey={(r) => `${r.kind}-${r.employeeId}-${r.cycleId || ''}`}
          dataSource={items}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          showHeader={false}
          columns={[
            {
              render: (_, r) => (
                <div>
                  <Space size={8} wrap>
                    <Link to={`/employees/${r.employeeId}`} style={{ fontWeight: 600 }}>
                      {r.title}
                    </Link>
                    <StatusPill tone={KIND[r.kind]?.tone}>{r.problem}</StatusPill>
                    {r.stopped > 1 && (
                      <StatusPill tone="mute" nodot>{r.stopped} evaluations stopped</StatusPill>
                    )}
                  </Space>
                  <div style={{ fontSize: 12, color: 'var(--pea-text-muted)', marginTop: 2 }}>
                    {r.detail}
                  </div>
                </div>
              ),
            },
            {
              width: 120,
              align: 'right',
              render: (_, r) => (
                <Link to={r.link}>
                  <Button size="small">{r.action}</Button>
                </Link>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}

export default function Overview() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [tab, setTab] = useState('action');

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(unwrap),
  });

  const { data: counts } = useQuery({
    queryKey: ['evaluation-counts'],
    queryFn: () => api.get('/evaluations/counts').then(unwrap),
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

      Modal.confirm({
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
  if (!data) return <Alert type="error" message="Could not load the overview" />;

  const { employees: emp, evaluations: ev } = data;

  /** Every figure opens the list behind it — a number is never a dead end. */
  const openList = (scope) => navigate(`/evaluations?scope=${scope}`);

  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>Overview</h2>
          <p>
            As at {formatDate(data.today)} · next automatic emails at 11:00 ({data.timezone})
          </p>
        </div>
        <Space wrap>
          <Tooltip title="Download a snapshot in the old master workbook layout. Changes nothing.">
            <Button icon={<DownloadOutlined />} onClick={download}>Export to Excel</Button>
          </Tooltip>
          <Tooltip title="Dry run: shows what would be sent now. Nothing is sent or changed.">
            <Button icon={<EyeOutlined />} onClick={() => sweep.mutate(true)} loading={sweep.isPending}>
              Preview
            </Button>
          </Tooltip>
          <Tooltip title="Shows exactly what would be sent and asks before sending anything.">
            <Button
              type="primary"
              icon={<SyncOutlined />}
              onClick={() => confirmAndSweep.mutate()}
              loading={confirmAndSweep.isPending || sweep.isPending}
            >
              Send due emails now…
            </Button>
          </Tooltip>
        </Space>
      </div>

      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: 'action', label: 'Needs action' },
          { key: 'trends', label: 'Trends' },
        ]}
      />

      {tab === 'action' ? (
        <>
          {/*
            The proposal's compact strip. Two tiles keep a bar because both are
            a real fraction of a real denominator; the other three never had one
            (see StatCard: a figure with no meaningful denominator is drawn
            without a bar rather than against an invented one).
          */}
          <div className="pea-stats pea-stats--compact">
            <StatCard
              compact
              label="In probation"
              value={emp.inProbation}
              accent="blue"
              hint="Active employees whose probation is still running — no decision yet, or extended."
              foot={`${emp.confirmed} confirmed · ${emp.extended} extended`}
              share={ratio(emp.inProbation, emp.active)}
            />
            <StatCard
              compact
              label="Waiting for manager"
              value={counts?.waiting ?? ev.awaiting}
              accent="orange"
              hint="Evaluation links sent, with no response yet."
              foot={<a onClick={() => openList('waiting')}>View list <RightOutlined style={{ fontSize: 10 }} /></a>}
            />
            <StatCard
              compact
              label="Not sent yet"
              value={counts?.not_sent ?? ev.overdue}
              accent="red"
              hint="Due, but no email has gone out. Usually a missing manager or project leader email."
              foot={<a onClick={() => openList('not_sent')}>View list <RightOutlined style={{ fontSize: 10 }} /></a>}
            />
            <StatCard
              compact
              label="Due in 14 days"
              value={counts?.due_soon ?? ev.dueSoon}
              accent="green"
              hint="Scheduled and sent automatically — nothing to do."
              foot={<a onClick={() => openList('due_soon')}>View list <RightOutlined style={{ fontSize: 10 }} /></a>}
            />
            <StatCard
              compact
              label="Submitted"
              value={ev.completed}
              suffix={`/ ${ev.total}`}
              accent="emerald"
              hint="Evaluations submitted, out of those that have actually fallen due."
              foot={
                ev.averageRating != null
                  ? `Average rating ${ev.averageRating.toFixed(2)}`
                  : 'No ratings submitted yet'
              }
              share={ratio(ev.completed, ev.total)}
            />
          </div>

          <div className="pea-overview-split">
            <NeedsAction />

            <div className="pea-overview-aside">
              <SidePanel
                title="Coming up"
                note="next 14 days"
                rows={(data.upcomingList || []).slice(0, 6)}
                empty="Nothing falls due in the next 14 days."
                render={(r) => (
                  <li key={r.cycleId}>
                    <Link to={`/employees/${r.employeeId}`}>{r.employee}</Link>
                    <span className="pea-side-meta">
                      #{r.seqNo} · {formatDate(r.dueDate)}
                    </span>
                  </li>
                )}
              />

              <SidePanel
                title="Recently submitted"
                rows={(data.recentSubmissions || []).slice(0, 6)}
                empty="No evaluations submitted yet."
                render={(r) => (
                  <li key={r.cycleId}>
                    <Link to={`/employees/${r.employeeId}`}>{r.employee}</Link>
                    <span className="pea-side-meta">
                      #{r.seqNo}
                      {r.average != null && ` · ${r.average.toFixed(2)} / 5`}
                    </span>
                  </li>
                )}
              />
            </div>
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
