/**
 * Evaluations — every evaluation for every employee, in one list.
 *
 * Until now there was no way to answer "what is outstanding?" from one screen.
 * You opened employees one at a time, or read four Dashboard tables that each
 * stopped at 25 rows — so on a busy month the honest answer was "I cannot tell
 * from this screen".
 *
 * Two things make this usable rather than just complete:
 *
 *   · the tabs ARE the Overview figures, so a number you click always opens the
 *     list behind it and the two can never disagree;
 *   · "Remind now" nudges the link the manager already has. "Resend" on the
 *     employee page issues a NEW link, which silently kills the old one — so a
 *     manager halfway through the form loses their work. These are different
 *     actions and are deliberately named differently.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Space, Button, Input, Select, DatePicker, Tabs, App, Tooltip,
  Typography, Checkbox, Segmented, Popconfirm,
} from 'antd';
import { BellOutlined, LinkOutlined, MailOutlined } from '@ant-design/icons';
import api, { unwrap } from '../api.js';
import { evaluationStatus } from '../evaluationStatus.js';
import StatusPill from '../components/StatusPill.jsx';
import { formatDate, formatDateTime } from '../formatDate.js';

const { RangePicker } = DatePicker;

/** The email log view — "did that manager actually get it?" */
function EmailsSent() {
  const [filters, setFilters] = useState({ page: 1, limit: 50 });

  const { data, isLoading } = useQuery({
    queryKey: ['evaluation-emails', filters],
    queryFn: () => api.get('/evaluations/emails', { params: filters }).then(unwrap),
    placeholderData: (p) => p,
  });

  const types = Object.keys(data?.byType || {}).sort();

  return (
    <Card className="pea-card" size="small">
      <Space wrap style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          placeholder="Recipient or subject…"
          style={{ width: 240 }}
          onSearch={(v) => setFilters((f) => ({ ...f, search: v || undefined, page: 1 }))}
        />
        <Select
          allowClear
          placeholder="All types"
          style={{ width: 190 }}
          options={types.map((t) => ({ value: t, label: `${t} (${data.byType[t]})` }))}
          onChange={(v) => setFilters((f) => ({ ...f, type: v, page: 1 }))}
        />
        <Select
          allowClear
          placeholder="All outcomes"
          style={{ width: 170 }}
          options={[
            { value: 'sent', label: `Sent (${data?.byStatus?.sent ?? 0})` },
            { value: 'failed', label: `Failed (${data?.byStatus?.failed ?? 0})` },
            { value: 'suppressed', label: `Not sent (${data?.byStatus?.suppressed ?? 0})` },
          ]}
          onChange={(v) => setFilters((f) => ({ ...f, status: v, page: 1 }))}
        />
      </Space>

      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={data?.rows || []}
        scroll={{ x: 'max-content' }}
        pagination={{
          current: data?.page || 1,
          pageSize: data?.limit || 50,
          total: data?.total || 0,
          showSizeChanger: false,
          onChange: (page) => setFilters((f) => ({ ...f, page })),
          showTotal: (t) => `${t} email(s)`,
        }}
        columns={[
          { title: 'When', dataIndex: 'sentAt', width: 150, render: (v) => formatDateTime(v) },
          { title: 'Type', dataIndex: 'type', width: 160 },
          {
            title: 'About',
            width: 200,
            render: (_, r) =>
              r.employeeName ? (
                <Link to={`/employees/${r.employeeId}`}>
                  {r.employeeName}
                  {r.seqNo ? ` · ${r.seqNo}` : ''}
                </Link>
              ) : (
                <span style={{ color: 'var(--pea-text-muted)' }}>—</span>
              ),
          },
          { title: 'To', dataIndex: 'to', width: 260, ellipsis: true },
          { title: 'Subject', dataIndex: 'subject', ellipsis: true },
          {
            title: 'Outcome',
            dataIndex: 'status',
            width: 130,
            render: (v, r) => {
              if (v === 'sent') return <Tag color="green">Sent</Tag>;
              if (v === 'failed') {
                return (
                  <Tooltip title={r.error || 'No reason recorded'}>
                    <Tag color="red">Failed</Tag>
                  </Tooltip>
                );
              }
              return (
                <Tooltip title={r.error || 'Email is paused, so this was recorded but not sent.'}>
                  <Tag>Not sent</Tag>
                </Tooltip>
              );
            },
          },
        ]}
      />
    </Card>
  );
}

export default function Evaluations() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();

  /*
   * The tab and the search box are read from the URL, because the Overview
   * links here to answer a specific question — "the four that have not been
   * sent", "this person's evaluation 2". Arriving on the default tab with no
   * filter loses that question: HR clicked a row about one person and got an
   * unfiltered list of twenty, with no sign of which row they meant.
   *
   * The URL stays the source of truth afterwards, so Back returns to the list
   * as it was and the link can be shared.
   */
  const scope = params.get('scope') || 'waiting';
  const focus = params.get('employee') || '';

  const [view, setView] = useState('Evaluations');
  const [filters, setFilters] = useState({ page: 1, limit: 50 });
  const [selected, setSelected] = useState([]);
  const [groupByManager, setGroupByManager] = useState(false);

  const setScope = (key) => {
    // Changing tab by hand clears the single-person focus: the reader has moved
    // on from the row they arrived from.
    const next = new URLSearchParams(params);
    next.set('scope', key);
    next.delete('employee');
    setParams(next, { replace: true });
  };

  const query = { ...filters, scope, ...(focus ? { search: focus } : {}) };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['evaluations', query],
    queryFn: () => api.get('/evaluations', { params: query }).then(unwrap),
    placeholderData: (p) => p,
  });

  const remind = useMutation({
    mutationFn: (ids) => api.post('/evaluations/remind', { ids }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      // Each skip has a reason worth reading — a silent partial success would
      // leave HR believing every manager was chased.
      (res.data?.skipped || []).forEach((s) => message.warning(`${s.who}: ${s.reason}`, 6));
      setSelected([]);
      qc.invalidateQueries({ queryKey: ['evaluations'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const counts = data?.counts || {};
  // The count rides in a chip on the tab itself; the active tab's chip picks up
  // the accent wash, which is what marks it as current alongside the underline.
  const tabs = (data?.scopes || []).map((s) => ({
    key: s.key,
    label: (
      <span className="pea-tab-label">
        {s.label}
        <span className={`pea-tab-chip${scope === s.key ? ' is-active' : ''}`}>
          {counts[s.key] ?? 0}
        </span>
      </span>
    ),
  }));

  /**
   * Group the rows by reporting manager.
   *
   * The workflow this serves is one Teams message covering all of a manager's
   * pending evaluations, so the manager's name and address head the group and
   * the rows beneath are what goes in that message.
   *
   * This groups the page in hand, not the whole result set — the list is paged
   * on the server. With the default 50 rows a manager's evaluations will
   * normally sit together anyway, and the group header says how many it found,
   * so a split across pages is visible rather than silent.
   */
  const rows = data?.rows || [];
  const groups = (() => {
    if (!groupByManager) return null;
    const byManager = new Map();
    for (const r of rows) {
      const key = r.rmEmail || r.rmName || '—';
      if (!byManager.has(key)) {
        byManager.set(key, { key, name: r.rmName, email: r.rmEmail, rows: [] });
      }
      byManager.get(key).rows.push(r);
    }
    // Busiest manager first: that is the one whose message is worth writing.
    return [...byManager.values()].sort((a, b) => b.rows.length - a.rows.length);
  })();

  const copyLink = async (row) => {
    // Built from the API base the app is actually talking to, so it is right in
    // development, staging and production without a per-environment constant.
    const base = new URL(api.defaults.baseURL, window.location.origin);
    const url = `${base.origin}${base.pathname.replace(/\/$/, '')}/evaluation/${row.token}`;
    try {
      await navigator.clipboard.writeText(url);
      message.success('Link copied — paste it to the manager');
    } catch {
      message.info(url);
    }
  };

  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch, page: 1 }));

  /**
   * One column set, shared by the flat table and the grouped one, so the two
   * views can never drift apart. Numeric columns carry `pea-num` for tabular
   * figures — without it a column of days and counts visibly wobbles.
   */
  const columns = [
    {
      title: 'Employee',
      fixed: 'left',
      width: 210,
      render: (_, r) => (
        <div>
          <Link to={`/employees/${r.employeeId}`} style={{ fontWeight: 600 }}>
            {r.employeeName}
          </Link>
          <div style={{ fontSize: 11.5, color: 'var(--pea-text-muted)' }}>
            {r.cohort === 'experienced' ? 'Experienced' : 'Fresher'}
          </div>
        </div>
      ),
    },
    {
      title: 'Evaluation',
      width: 130,
      render: (_, r) => (
        <Space size={4}>
          {r.seqNo}
          {r.isExtension && <StatusPill tone="ext" nodot>extension</StatusPill>}
        </Space>
      ),
    },
    {
      title: 'Period',
      width: 190,
      render: (_, r) => `${formatDate(r.periodFrom)} → ${formatDate(r.periodTo)}`,
    },
    {
      title: 'Due',
      dataIndex: 'dueDate',
      width: 125,
      className: 'pea-num',
      render: (v) => formatDate(v),
    },
    {
      title: 'Status',
      width: 165,
      render: (_, r) => {
        const s = evaluationStatus({ status: r.derivedStatus });
        return <StatusPill state={s.key}>{s.label}</StatusPill>;
      },
    },
    {
      title: 'Waiting',
      dataIndex: 'waitingDays',
      width: 100,
      className: 'pea-num',
      render: (v) => (v == null ? '—' : `${v} day${v === 1 ? '' : 's'}`),
    },
    {
      title: 'Reminders',
      dataIndex: 'reminderCount',
      width: 100,
      className: 'pea-num',
      render: (v) => `${v} of 2`,
    },
    {
      title: 'Reporting manager',
      width: 190,
      render: (_, r) => (
        <div>
          <div>{r.rmName || '—'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--pea-text-muted)' }}>{r.rmEmail}</div>
        </div>
      ),
    },
    {
      title: '',
      width: 220,
      fixed: 'right',
      render: (_, r) =>
        r.linkLive ? (
          <Space size={4}>
            <Popconfirm
              title="Send an extra reminder?"
              description={
                <div style={{ maxWidth: 300 }}>
                  Emails {r.rmEmail} again with the link they already have.
                </div>
              }
              okText="Send"
              onConfirm={() => remind.mutate([r.id])}
            >
              <Button size="small" icon={<BellOutlined />}>Remind</Button>
            </Popconfirm>
            {/* Text, not icon-only: "copy what?" is not obvious from a
                chain-link glyph alone. */}
            <Tooltip title="Copy this manager's evaluation link">
              <Button size="small" type="link" icon={<LinkOutlined />} onClick={() => copyLink(r)}>
                Copy link
              </Button>
            </Tooltip>
          </Space>
        ) : null,
    },
  ];

  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>Evaluations</h2>
          <p>Every evaluation for every employee — what is due, who it is waiting on, and what came back</p>
        </div>
        <Space wrap>
          {isFetching && <Typography.Text type="secondary" style={{ fontSize: 12 }}>updating…</Typography.Text>}
          <Segmented
            value={view}
            onChange={setView}
            options={['Evaluations', 'Emails sent']}
          />
        </Space>
      </div>

      {view === 'Emails sent' ? (
        <EmailsSent />
      ) : (
        <>
          <Tabs
            activeKey={scope}
            onChange={(k) => { setScope(k); setSelected([]); setFilters((f) => ({ ...f, page: 1 })); }}
            items={tabs}
          />

          <Card className="pea-card" size="small">
            <Space wrap style={{ marginBottom: 12 }}>
              <Input.Search
                allowClear
                placeholder="Search employee…"
                style={{ width: 220 }}
                onSearch={(v) => setFilter({ search: v || undefined })}
              />
              <Select
                allowClear
                placeholder="Fresher and experienced"
                style={{ width: 200 }}
                options={[
                  { value: 'fresher', label: 'Freshers only' },
                  { value: 'experienced', label: 'Experienced only' },
                ]}
                onChange={(v) => setFilter({ cohort: v })}
              />
              <RangePicker
                format="DD-MMM-YYYY"
                placeholder={['Due from', 'Due to']}
                onChange={(v) =>
                  setFilter({
                    dueFrom: v?.[0] ? v[0].format('YYYY-MM-DD') : undefined,
                    dueTo: v?.[1] ? v[1].format('YYYY-MM-DD') : undefined,
                  })
                }
              />
              {/* The workflow: one Teams message covering all of a manager's
                  pending evaluations, rather than chasing them one row at a time. */}
              <Tooltip title="Gather this page's evaluations under each reporting manager.">
                <Checkbox
                  checked={groupByManager}
                  onChange={(e) => setGroupByManager(e.target.checked)}
                >
                  Group by manager
                </Checkbox>
              </Tooltip>
            </Space>

            {/*
              Arriving from an Overview row filters to that person. Saying so —
              and offering the way out — is the difference between "why is there
              only one row?" and "this is the row I clicked".
            */}
            {focus && (
              <div className="pea-focus-bar">
                <span>
                  Showing <strong>{focus}</strong> only, from the Overview.
                </span>
                <Button
                  size="small"
                  type="link"
                  onClick={() => {
                    const next = new URLSearchParams(params);
                    next.delete('employee');
                    setParams(next, { replace: true });
                  }}
                >
                  Show all {data?.scopes?.find((s) => s.key === scope)?.label?.toLowerCase() || ''}
                </Button>
              </div>
            )}

            {/* An accent strip rather than an Ant Alert: this is a bulk-action
                bar, not a notice, and it should not read as a warning. */}
            {selected.length > 0 && (
              <div className="pea-bulk-bar">
                <strong>{selected.length} selected</strong>
                <Space wrap size={4}>
                  <Popconfirm
                    title="Send an extra reminder?"
                    description={
                      <div style={{ maxWidth: 320 }}>
                        This emails the reporting manager again using the link they already have.
                        It does not cancel or replace that link.
                      </div>
                    }
                    okText="Send reminders"
                    onConfirm={() => remind.mutate(selected)}
                  >
                    <Button size="small" type="primary" icon={<BellOutlined />} loading={remind.isPending}>
                      Remind now
                    </Button>
                  </Popconfirm>
                  <Button size="small" type="link" onClick={() => setSelected([])}>Clear</Button>
                </Space>
              </div>
            )}

            {groupByManager ? (
              groups.length === 0 ? (
                <Typography.Text type="secondary">
                  Nothing in this list — which is usually good news.
                </Typography.Text>
              ) : (
                groups.map((g) => (
                  <div key={g.key} className="pea-manager-group">
                    <div className="pea-manager-group-head">
                      <div>
                        <strong>{g.name || 'No reporting manager'}</strong>
                        {g.email && <span className="pea-manager-group-email">{g.email}</span>}
                      </div>
                      <StatusPill tone="mute" nodot>
                        {g.rows.length} evaluation{g.rows.length === 1 ? '' : 's'}
                      </StatusPill>
                    </div>

                    <Table
                      size="small"
                      rowKey="id"
                      dataSource={g.rows}
                      pagination={false}
                      scroll={{ x: 'max-content' }}
                      rowSelection={{
                        selectedRowKeys: selected,
                        onChange: setSelected,
                        getCheckboxProps: (r) => ({ disabled: !r.linkLive }),
                      }}
                      // The manager is the group heading, so repeating the column
                      // inside every group would say the same thing twice.
                      columns={columns.filter((c) => c.title !== 'Reporting manager')}
                    />
                  </div>
                ))
              )
            ) : (
              <Table
                size="small"
                rowKey="id"
                loading={isLoading}
                dataSource={rows}
                scroll={{ x: 'max-content' }}
                rowSelection={{
                  selectedRowKeys: selected,
                  onChange: setSelected,
                  getCheckboxProps: (r) => ({ disabled: !r.linkLive }),
                }}
                pagination={{
                  current: data?.page || 1,
                  pageSize: data?.limit || 50,
                  total: data?.total || 0,
                  showSizeChanger: false,
                  onChange: (page) => setFilters((f) => ({ ...f, page })),
                  showTotal: (t) => `${t} evaluation(s)`,
                }}
                locale={{ emptyText: 'Nothing in this list — which is usually good news.' }}
                columns={columns}
              />
            )}
          </Card>
        </>
      )}
    </>
  );
}
