import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Descriptions, Tag, Table, Space, Typography, Timeline, Button, Spin, Alert,
  Row, Col, App, Tooltip, Modal, Form, Input, DatePicker, Radio, Select, Popconfirm, Progress,
} from 'antd';
import {
  SendOutlined, PauseOutlined, PlayCircleOutlined, EditOutlined,
  LockOutlined, UnlockOutlined, WarningOutlined, MailOutlined, ShareAltOutlined, DeleteOutlined,
  DownloadOutlined, MoreOutlined, ArrowUpOutlined, ArrowDownOutlined, ClockCircleOutlined, LoadingOutlined,
} from '@ant-design/icons';
import { Dropdown } from 'antd';
import dayjs from 'dayjs';
import api, { unwrap, USER_KEY } from '../api.js';
import { isAdminTier } from '../auth.js';
import ShareReportModal from '../components/ShareReportModal.jsx';
import { evaluationStatus } from '../evaluationStatus.js';
import StatusPill from '../components/StatusPill.jsx';
import { formatDate as fmt } from '../formatDate.js';
import { Avatar, LoadProblem } from '../components/board/BoardParts.jsx';
import { CommentMatrix, JourneyStepper, trendOf } from '../components/EmployeeJourney.jsx';
import { decisionTone } from '../evaluationDisplay.js';
import { useCrumbs } from '../crumbs.jsx';

/** Same rule as the server: case and extra spaces do not matter. */
const normName = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

const CONFIRMATION_OPTIONS = ['Confirmed', 'Not Confirmed', 'Extend for 1 month', 'Extend for 2 months'];

/**
 * Where an Entra-sourced value stands. Plan §6.5 Part 2: "from Azure" until HR
 * corrects it, "manually overridden" once locked, and a visible disagreement
 * whenever Entra still holds something different — a lock must never hide
 * that IT's record is wrong.
 */
function AzureProvenance({ field, info, onUnlock, onReport, unlocking }) {
  if (!info) return null;
  return (
    <Space size={4} wrap style={{ marginTop: 4 }}>
      {info.locked ? (
        <>
          <Tooltip title="HR corrected this value. Microsoft 365 will not overwrite it.">
            <Tag icon={<LockOutlined />} color="purple">manually overridden</Tag>
          </Tooltip>
          <Popconfirm
            title="Unlock and follow Microsoft 365 again?"
            description={info.azureValue ? `The value becomes "${info.azureValue}".` : 'Microsoft 365 holds no value yet.'}
            onConfirm={() => onUnlock(field)}
          >
            <Button size="small" type="link" icon={<UnlockOutlined />} loading={unlocking}>
              Unlock
            </Button>
          </Popconfirm>
        </>
      ) : (
        <Tag color="blue">from Microsoft 365</Tag>
      )}
      {info.differs && (
        <>
          <Tooltip title={`Microsoft 365 currently holds: ${info.azureValue}`}>
            <Tag icon={<WarningOutlined />} color="red">differs from Microsoft 365</Tag>
          </Tooltip>
          <Button size="small" type="link" icon={<MailOutlined />} onClick={() => onReport(field)}>
            Report to IT
          </Button>
        </>
      )}
    </Space>
  );
}

// Status names and date wording live in shared modules, so this page and the
// manager portal cannot drift apart on what the same evaluation is called or
// when it happened.

export default function EmployeeDetail() {
  const { id } = useParams();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const { data: e, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/employees/${id}/full`).then(unwrap),
  });

  useCrumbs([{ label: 'Employees', to: '/employees' }, { label: e?.full_name || 'Employee' }]);

  const resend = useMutation({
    mutationFn: (seqNo) =>
      api.post('/admin/send-evaluation', { office_email: e.office_email, seq_no: seqNo }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      qc.invalidateQueries({ queryKey: ['employee', id] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const toggleHalt = useMutation({
    mutationFn: (halt) => api.post(`/employees/${id}/halt`, { halt }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      qc.invalidateQueries({ queryKey: ['employee', id] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const [editOpen, setEditOpen] = useState(false);
  const [lockPrompt, setLockPrompt] = useState(null); // { payload, fields }
  const [reportField, setReportField] = useState(null);
  const [editForm] = Form.useForm();
  const [reportForm] = Form.useForm();

  const refresh = () => qc.invalidateQueries({ queryKey: ['employee', id] });

  /**
   * R-05 — fetched through the API client so the JWT goes with it. Opening the
   * URL directly would send no Authorization header and simply 401.
   */
  const downloadReport = useMutation({
    mutationFn: () => api.get(`/employees/${id}/report`, { responseType: 'blob' }),
    onSuccess: (res) => {
      const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] || '')?.[1]
        || 'evaluation-report.xlsx';
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const save = useMutation({
    mutationFn: (payload) => api.patch(`/employees/${id}`, payload).then((r) => r.data),
    onSuccess: (res) => {
      const moved = res.data?._meta?.rescheduled;
      message.success(
        moved ? `Saved — ${moved.updated} evaluation date(s) moved, ${moved.skipped} already sent left alone` : 'Saved'
      );
      setEditOpen(false);
      setLockPrompt(null);
      refresh();
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const [selfLink, setSelfLink] = useState(null);

  const issueSelfLink = useMutation({
    mutationFn: () => api.post(`/self-view-links/${id}`).then(unwrap),
    onSuccess: setSelfLink,
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const report = useMutation({
    mutationFn: (values) => api.post(`/employees/${id}/report-to-it`, values).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setReportField(null);
      reportForm.resetFields();
      refresh();
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const navigate = useNavigate();
  const isAdmin = isAdminTier(JSON.parse(localStorage.getItem(USER_KEY) || '{}').role);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [shareOpen, setShareOpen] = useState(false); // R-05

  const remove = useMutation({
    mutationFn: () => api.delete(`/employees/${id}`, { data: { confirm_name: deleteName } }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ['employees'] });
      navigate('/employees');
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', marginTop: 80 }} />;
  if (isError || !e) {
    return (
      <div className="pea-card pea-card-pad">
        <LoadProblem
          error={error}
          onRetry={refetch}
          what="This employee"
          extra={<Link to="/employees"><Button>All employees</Button></Link>}
        />
      </div>
    );
  }

  const progress = e.progress || { total: 0, completed: 0, awaitingResponse: 0, overdue: 0, nextDue: null };
  const azure = e.azure || { linked: false, fields: {} };
  // R-02. Defaults match the server's: the leaver hold is on, the manual pause
  // is not — so an older server that does not send this block still behaves.
  const hold = e.evaluationHold || { manualPauseEnabled: false, holdLeaversEnabled: true, heldAsLeaver: false };
  const manualPauseEnabled = hold.manualPauseEnabled;

  const openEdit = () => {
    editForm.setFieldsValue({
      full_name: e.full_name,
      office_email: e.office_email,
      personal_email: e.personal_email,
      doj: e.doj ? dayjs(String(e.doj).slice(0, 10)) : null,
      is_experienced: e.is_experienced,
      rm_name: e.rm_name,
      rm_email: e.rm_email,
      pl_email: e.pl_email,
      confirmation_status: e.confirmation_status || undefined,
      employment_status: e.employment_status,
    });
    setEditOpen(true);
  };

  const submitEdit = (values) => {
    const payload = {
      ...values,
      doj: values.doj ? values.doj.format('YYYY-MM-DD') : undefined,
      confirmation_status: values.confirmation_status || '',
    };

    // Changing an Entra-sourced value on a linked, unlocked field: ask once
    // whether the correction should stick. Plan §6.5 — "Keep my value" /
    // "Just this once".
    const changedAzureFields = azure.linked
      ? ['full_name', 'office_email'].filter(
          (f) =>
            !azure.fields[f]?.locked &&
            String(values[f] || '').trim().toLowerCase() !== String(e[f] || '').trim().toLowerCase()
        )
      : [];

    if (changedAzureFields.length) {
      setLockPrompt({ payload, fields: changedAzureFields });
      return;
    }
    save.mutate(payload);
  };

  const openReport = (field) => {
    setReportField(field);
    reportForm.setFieldsValue({ field, correct_value: e[field], note: '' });
  };

  // ── The hero's facts ─────────────────────────────────────────────────
  const cycles = e.cycles || [];
  const extended = e.confirmation_status?.startsWith('Extend');
  const nextOpen = cycles.find((c) => ['pending', 'email_sent', 'opened'].includes(c.status));
  const trend = trendOf(cycles);

  // Download, hold and delete are occasional; they live behind "More" so the
  // header carries the three actions the design names.
  const moreItems = [
    {
      key: 'download',
      icon: downloadReport.isPending ? <LoadingOutlined /> : <DownloadOutlined />,
      label: 'Download report (.xlsx)',
      disabled: progress.completed === 0,
    },
    // R-02 — Subhajit, 15-Sep (7:15): "Pause evolutions only works when a
    // resource has left." Exits are held automatically, so the manual button is
    // off unless HR switches it on for the long-leave case. Resume always shows
    // for anyone already paused: hiding it would strand them with no way back.
    ...((e.halt_process || manualPauseEnabled)
      ? [{
        key: 'halt',
        icon: e.halt_process ? <PlayCircleOutlined /> : <PauseOutlined />,
        label: e.halt_process ? 'Resume evaluations' : 'Hold for long leave',
      }]
      : []),
    ...(isAdmin ? [{ type: 'divider' }, { key: 'delete', icon: <DeleteOutlined />, label: 'Delete…', danger: true }] : []),
  ];

  return (
    <>
      <section className="pea-card pea-journey-hero">
        <Avatar name={e.full_name} size="xl" />
        <div className="pea-journey-id">
          <div className="pea-eyebrow">Employee · probation journey</div>
          <h1 className="pea-display">{e.full_name}</h1>
          <p className="pea-lead">
            {e.is_experienced ? 'Experienced' : 'Fresher'} · joined {fmt(e.doj)} · reporting manager {e.rm_name}
            {e.pl_email && <> · project leader {e.pl_email}</>}
          </p>
          <div className="pea-pill-row">
            {e.confirmation_status && !extended ? (
              <StatusPill tone={decisionTone(e.confirmation_status)}>{e.confirmation_status}</StatusPill>
            ) : extended ? (
              <span className="pea-fact"><ClockCircleOutlined /> <strong>Probation extended</strong></span>
            ) : (
              <StatusPill tone="info">In probation</StatusPill>
            )}
            <span className="pea-fact">{progress.completed} of {progress.total} evaluations submitted</span>
            {nextOpen && (
              <span className="pea-fact">
                {nextOpen.is_extension ? 'Extension due' : 'Next due'} {fmt(nextOpen.due_date)}
              </span>
            )}
            {trend && (
              <StatusPill tone={trend.tone} nodot className="pea-pill-icon">
                {trend.word === 'Improving' ? <ArrowUpOutlined /> : trend.word === 'Declining' ? <ArrowDownOutlined /> : null} {trend.text}
              </StatusPill>
            )}
            {e.halt_process && <StatusPill tone="warn">On hold</StatusPill>}
            {hold.heldAsLeaver && (
              <Tooltip title="Microsoft 365 shows this account switched off and unlicensed, so evaluations stopped on their own. Confirm the exit, or mark them as still here, on the New joiners screen.">
                <StatusPill tone="crit">Held — may have left</StatusPill>
              </Tooltip>
            )}
            {e.employment_status === 'left' && <StatusPill tone="mute">Left</StatusPill>}
          </div>
        </div>
        <div className="pea-journey-actions">
          <Button icon={<EditOutlined />} onClick={openEdit}>Edit</Button>
          <Tooltip title="A personal link so the employee can see their own probation. What it shows is set in Settings → Access.">
            <Button icon={<ShareAltOutlined />} loading={issueSelfLink.isPending} onClick={() => issueSelfLink.mutate()}>
              Employee link
            </Button>
          </Tooltip>
          {/* R-05 — Subhajit, 15-Sep (21:13): "time and again it's required for
              me actually." Share for the leader who emailed asking; Download
              (under More) for a Teams chat or a meeting. */}
          <Tooltip title="Email the whole evaluation record to whoever asked for it, with the spreadsheet attached.">
            <Button
              type="primary"
              icon={<MailOutlined />}
              disabled={progress.completed === 0}
              onClick={() => setShareOpen(true)}
            >
              Share report…
            </Button>
          </Tooltip>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: moreItems,
              onClick: ({ key }) => {
                if (key === 'download') downloadReport.mutate();
                if (key === 'halt') toggleHalt.mutate(!e.halt_process);
                if (key === 'delete') { setDeleteName(''); setDeleteOpen(true); }
              },
            }}
          >
            <Button icon={<MoreOutlined />} aria-label="More actions" loading={toggleHalt.isPending} />
          </Dropdown>
        </div>
      </section>

      <JourneyStepper employee={e} />
      <CommentMatrix employee={e} />

      <h2 className="pea-record-head">Record and schedule</h2>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card className="pea-card" size="small" title={<span className="pea-section-title">Details</span>}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Name">
                {e.full_name}
                {azure.linked && (
                  <AzureProvenance
                    field="full_name"
                    info={azure.fields.full_name}
                    onUnlock={(f) => save.mutate({ unlock_fields: [f] })}
                    onReport={openReport}
                    unlocking={save.isPending}
                  />
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Office email">
                {e.office_email}
                {azure.linked && (
                  <AzureProvenance
                    field="office_email"
                    info={azure.fields.office_email}
                    onUnlock={(f) => save.mutate({ unlock_fields: [f] })}
                    onReport={openReport}
                    unlocking={save.isPending}
                  />
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Personal email">{e.personal_email || '—'}</Descriptions.Item>
              <Descriptions.Item label="Date of joining">{fmt(e.doj)}</Descriptions.Item>
              <Descriptions.Item label="Reporting manager">
                {e.rm_name}<br />
                <Typography.Text type="secondary">{e.rm_email}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Project leader">{e.pl_email}</Descriptions.Item>
              <Descriptions.Item label="Added via">{e.source}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card className="pea-card" size="small" title={<span className="pea-section-title">Probation progress</span>}>
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {progress.completed} of {progress.total} evaluations completed
                </Typography.Text>
                <Progress
                  percent={progress.total ? Math.round((progress.completed / progress.total) * 100) : 0}
                  strokeColor="var(--pea-green-600)"
                  showInfo={false}
                />
              </div>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Decision">
                  {/* Confirmed → ok, Not Confirmed → crit, an extension → ext,
                      and no decision yet → the informational "In probation". */}
                  {e.confirmation_status ? (
                    <StatusPill
                      tone={
                        e.confirmation_status === 'Confirmed'
                          ? 'ok'
                          : e.confirmation_status === 'Not Confirmed'
                            ? 'crit'
                            : 'ext'
                      }
                    >
                      {e.confirmation_status}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="info">In probation</StatusPill>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Next evaluation due">{progress.nextDue ? fmt(progress.nextDue) : '—'}</Descriptions.Item>
                <Descriptions.Item label="Waiting on manager">
                  {progress.awaitingResponse
                    ? <StatusPill tone="warn">{progress.awaitingResponse}</StatusPill>
                    : 0}
                </Descriptions.Item>
                <Descriptions.Item label="Overdue (not yet sent)">
                  {progress.overdue ? <StatusPill tone="crit">{progress.overdue}</StatusPill> : 0}
                </Descriptions.Item>
                <Descriptions.Item label="Evaluations">
                  {hold.heldAsLeaver ? (
                    <Tooltip title="Confirm the exit, or mark them as still here, on the New joiners screen.">
                      <StatusPill tone="crit">Held — Microsoft 365 says they may have left</StatusPill>
                    </Tooltip>
                  ) : e.halt_process ? (
                    <StatusPill tone="warn">On hold by HR</StatusPill>
                  ) : hold.holdLeaversEnabled ? (
                    <Tooltip title="Evaluations stop on their own if the Microsoft 365 check finds this person has left.">
                      <span>Running</span>
                    </Tooltip>
                  ) : (
                    'Running'
                  )}
                </Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* R-06 — "whether that new joiner is growing or not" (Subhajit, 13:24)
          is now answered at the top: the trend pill, the stepper's averages and
          the comment grid's ▲▼. This table is the schedule and its actions. */}
      <Card className="pea-card" size="small" title={<span className="pea-section-title">Evaluation schedule</span>}>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={e.cycles}
          columns={[
            {
              title: '#',
              dataIndex: 'seq_no',
              width: 60,
              render: (v, r) => (
                <Space size={4}>
                  <Link to={`/evaluations/${r.id}`} title="Open this evaluation">{v}</Link>
                  {r.is_extension && (
                    <Tooltip title="Extension"><StatusPill tone="ext" nodot>ext</StatusPill></Tooltip>
                  )}
                </Space>
              ),
            },
            {
              title: 'Period',
              width: 200,
              render: (_, r) => `${fmt(r.period_from)} → ${fmt(r.period_to)}`,
            },
            { title: 'Due', dataIndex: 'due_date', width: 110, className: 'pea-num', render: fmt },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 170,
              render: (_, r) => {
                const s = evaluationStatus(r);
                return <StatusPill state={s.key}>{s.label}</StatusPill>;
              },
            },
            {
              title: 'Average',
              dataIndex: 'avg_rating',
              width: 90,
              className: 'pea-num',
              // A rating is a figure to compare down the column, so it is shown
              // as a number in the state colour rather than boxed in a pill.
              render: (v) =>
                v == null ? (
                  '—'
                ) : (
                  <strong style={{ color: `var(--pea-${v >= 3.5 ? 'ok' : v >= 2.5 ? 'info' : 'crit'})` }}>
                    {Number(v).toFixed(2)}
                  </strong>
                ),
            },
            { title: 'Submitted', dataIndex: 'submitted_at', width: 110, className: 'pea-num', render: fmt },
            {
              title: 'Chased',
              dataIndex: 'reminder_count',
              width: 80,
              className: 'pea-num',
              render: (v) => (v ? `${v}×` : '—'),
            },
            {
              title: '',
              width: 120,
              render: (_, r) => {
                if (!['pending', 'email_sent', 'opened'].includes(r.status)) return null;
                if (e.halt_process) return null;
                // R-02 — the hold has to cover the manual send too, or HR can
                // undo it by accident from the very screen that reports it.
                if (hold.heldAsLeaver) {
                  return (
                    <Tooltip title="On hold — Microsoft 365 shows this person may have left. Resolve it on the New joiners screen first.">
                      <Button size="small" icon={<SendOutlined />} disabled>Send</Button>
                    </Tooltip>
                  );
                }
                // One click used to email a real manager with no confirmation
                // and no indication of who would receive it. The popconfirm
                // names the recipient, because that is the fact worth checking
                // before an evaluation request goes out under HR's name.
                return (
                  <Popconfirm
                    title={r.status === 'pending' ? 'Send this evaluation now?' : 'Send this link again?'}
                    description={
                      <div style={{ maxWidth: 320 }}>
                        Evaluation {r.seq_no} for <strong>{e.full_name}</strong> goes to{' '}
                        <strong>{e.rm_email}</strong>
                        {e.pl_email ? <>, copying {e.pl_email}</> : null}.
                      </div>
                    }
                    okText={r.status === 'pending' ? 'Send now' : 'Resend now'}
                    cancelText="Cancel"
                    onConfirm={() => resend.mutate(r.seq_no)}
                  >
                    <Button size="small" icon={<SendOutlined />} loading={resend.isPending}>
                      {r.status === 'pending' ? 'Send' : 'Resend'}
                    </Button>
                  </Popconfirm>
                );
              },
            },
          ]}
          expandable={{
            rowExpandable: (r) => r.scores?.length > 0 || !!r.remarks || !!r.legacy_raw,
            expandedRowRender: (r) => (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {r.scores?.length > 0 && (
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={r.scores}
                    columns={[
                      { title: 'Parameter', dataIndex: 'param_label', width: 240 },
                      { title: 'Rating', dataIndex: 'rating', width: 80, render: (v) => Number(v) },
                      { title: 'Comment', dataIndex: 'comments', render: (v) => v || '—' },
                    ]}
                  />
                )}
                {r.remarks && (
                  <div>
                    <Typography.Text strong>Overall remarks: </Typography.Text>
                    <Typography.Text>{r.remarks}</Typography.Text>
                  </div>
                )}
                {r.legacy_raw && (
                  <Alert
                    type="info"
                    message="Imported from the original spreadsheet"
                    description={
                      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13 }}>
                        {r.legacy_raw}
                      </Typography.Paragraph>
                    }
                  />
                )}
              </Space>
            ),
          }}
        />
      </Card>

      {e.audit?.length > 0 && (
        <Card className="pea-card" size="small" title={<span className="pea-section-title">Change history</span>}>
          <Timeline
            items={e.audit.slice(0, 20).map((a) => ({
              children: (
                <Space direction="vertical" size={0}>
                  <Typography.Text>
                    <strong>{a.field_name}</strong>
                    {a.field_name !== '*' && (
                      <> changed from <em>{a.old_value || '(empty)'}</em> to <em>{a.new_value || '(empty)'}</em></>
                    )}
                    {a.field_name === '*' && <> — {a.new_value}</>}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {a.changed_by || 'system'} · {a.change_source} · {new Date(a.changed_at).toLocaleString()}
                  </Typography.Text>
                </Space>
              ),
            }))}
          />
        </Card>
      )}

      {/* ── Edit ───────────────────────────────────────────────────────── */}
      <Modal
        title={`Edit ${e.full_name}`}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => editForm.submit()}
        confirmLoading={save.isPending && !lockPrompt}
        okText="Save"
        width={640}
      >
        <Form form={editForm} layout="vertical" requiredMark={false} onFinish={submitEdit}>
          <Form.Item name="full_name" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="office_email" label="Office email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="personal_email" label="Personal email" rules={[{ type: 'email' }]}>
            <Input />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }} wrap>
            <Form.Item
              name="doj"
              label="Date of joining"
              rules={[{ required: true }]}
              extra="Changing this moves every evaluation not yet sent."
              style={{ minWidth: 220 }}
            >
              <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
            </Form.Item>
            <Form.Item
              name="is_experienced"
              label="Fresher or experienced"
              rules={[{ required: true }]}
              extra="Changes the cadence for evaluations not yet sent."
            >
              <Radio.Group optionType="button" buttonStyle="solid">
                <Radio.Button value={false}>Fresher</Radio.Button>
                <Radio.Button value>Experienced</Radio.Button>
              </Radio.Group>
            </Form.Item>
          </Space>
          <Form.Item name="rm_name" label="Reporting manager" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="rm_email" label="Reporting manager email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="pl_email" label="Project leader email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }} wrap>
            <Form.Item name="confirmation_status" label="Confirmation status" style={{ minWidth: 240 }}>
              <Select
                allowClear
                placeholder="In probation"
                options={CONFIRMATION_OPTIONS.map((v) => ({ value: v, label: v }))}
              />
            </Form.Item>
            <Form.Item name="employment_status" label="Employment" style={{ minWidth: 160 }}>
              <Select options={[{ value: 'active', label: 'Active' }, { value: 'left', label: 'Left' }]} />
            </Form.Item>
          </Space>
        </Form>
      </Modal>

      {/* ── Keep my value / Just this once — plan §6.5 ─────────────────── */}
      <Modal
        title="This value comes from Microsoft 365"
        open={!!lockPrompt}
        onCancel={() => setLockPrompt(null)}
        footer={[
          <Button key="cancel" onClick={() => setLockPrompt(null)}>Cancel</Button>,
          <Button
            key="once"
            loading={save.isPending}
            onClick={() => save.mutate(lockPrompt.payload)}
          >
            Just this once
          </Button>,
          <Button
            key="keep"
            type="primary"
            icon={<LockOutlined />}
            loading={save.isPending}
            onClick={() => save.mutate({ ...lockPrompt.payload, lock_fields: lockPrompt.fields })}
          >
            Keep my value
          </Button>,
        ]}
      >
        <Typography.Paragraph>
          You changed{' '}
          <strong>{(lockPrompt?.fields || []).map((f) => azure.fields[f]?.label || f).join(' and ')}</strong>, which
          comes from Microsoft 365.
        </Typography.Paragraph>
        <ul style={{ paddingLeft: 18 }}>
          <li><strong>Keep my value</strong> — Microsoft 365 will never overwrite it. You can unlock it later.</li>
          <li><strong>Just this once</strong> — saved now, but PEA may later put the Microsoft 365 value back.</li>
        </ul>
        <Typography.Text type="secondary">
          If Microsoft 365 itself is wrong, use <em>Report to IT</em> afterwards so it is fixed at source too.
        </Typography.Text>
      </Modal>

      {/* ── Employee self-view link ────────────────────────────────────── */}
      <Modal title="Employee link" open={!!selfLink} onCancel={() => setSelfLink(null)} footer={null}>
        {selfLink && (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`Shows: ${selfLink.level}`}
              description={
                {
                  schedule: 'Evaluation dates and status only — no ratings.',
                  averages: 'Dates, status, average rating per evaluation, and the final decision.',
                  full: 'Everything above, plus per-parameter ratings and the manager’s comments.',
                }[selfLink.level]
              }
            />
            <Typography.Paragraph copyable={{ text: selfLink.url }} style={{ wordBreak: 'break-all' }}>
              {selfLink.url}
            </Typography.Paragraph>
            <Typography.Text type="secondary">
              Valid until {new Date(selfLink.expiresAt).toLocaleDateString()}. PEA does not email it — share it
              directly. It stops working immediately if self-view is switched off or the employee is marked as having left.
            </Typography.Text>
          </>
        )}
      </Modal>

      {/* ── Delete employee — admin only, for demo and test records ───── */}
      <Modal
        title={`Delete ${e.full_name}?`}
        open={deleteOpen}
        onCancel={() => setDeleteOpen(false)}
        onOk={() => remove.mutate()}
        confirmLoading={remove.isPending}
        okText="Delete permanently"
        okButtonProps={{ danger: true, disabled: normName(deleteName) !== normName(e.full_name) }}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message="This cannot be undone"
          description="The employee, every evaluation, all ratings and the change history are removed. If this person really left, use Edit → Employment → Left instead — that keeps their history."
        />
        <Typography.Paragraph>
          Type <strong>{e.full_name}</strong> to confirm:
        </Typography.Paragraph>
        <Input
          value={deleteName}
          onChange={(ev) => setDeleteName(ev.target.value)}
          placeholder={e.full_name}
          onPressEnter={() => normName(deleteName) === normName(e.full_name) && remove.mutate()}
        />
      </Modal>

      {/* ── Report to IT — plan §6.5 Part 3 ────────────────────────────── */}
      <Modal
        title="Report a wrong value to IT"
        open={!!reportField}
        onCancel={() => setReportField(null)}
        onOk={() => reportForm.submit()}
        confirmLoading={report.isPending}
        okText="Send to IT"
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="Outside production this reaches the test inbox only"
          description="Staging never emails the real IT team."
        />
        <Form form={reportForm} layout="vertical" requiredMark={false} onFinish={(v) => report.mutate(v)}>
          <Form.Item name="field" hidden><Input /></Form.Item>
          <Form.Item label="Field">
            <Input value={azure.fields[reportField]?.label} disabled />
          </Form.Item>
          <Form.Item label="Microsoft 365 currently holds">
            <Input value={azure.fields[reportField]?.azureValue || '(blank)'} disabled />
          </Form.Item>
          <Form.Item name="correct_value" label="Correct value" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="note" label="Note for IT">
            <Input.TextArea rows={3} maxLength={2000} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <ShareReportModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        employee={e}
        progress={progress}
      />
    </>
  );
}
