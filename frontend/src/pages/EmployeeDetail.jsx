import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Descriptions, Tag, Table, Space, Typography, Timeline, Button, Spin, Alert,
  Row, Col, App, Tooltip, Modal, Form, Input, DatePicker, Radio, Select, Popconfirm, Progress,
} from 'antd';
import {
  ArrowLeftOutlined, SendOutlined, PauseOutlined, PlayCircleOutlined, EditOutlined,
  LockOutlined, UnlockOutlined, WarningOutlined, MailOutlined, ShareAltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { unwrap } from '../api.js';

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
          <Tooltip title="HR corrected this value. The Azure sync will not overwrite it.">
            <Tag icon={<LockOutlined />} color="purple">manually overridden</Tag>
          </Tooltip>
          <Popconfirm
            title="Unlock and follow Entra again?"
            description={info.azureValue ? `The value becomes "${info.azureValue}".` : 'Entra holds no value yet.'}
            onConfirm={() => onUnlock(field)}
          >
            <Button size="small" type="link" icon={<UnlockOutlined />} loading={unlocking}>
              Unlock / resync
            </Button>
          </Popconfirm>
        </>
      ) : (
        <Tag color="blue">from Azure</Tag>
      )}
      {info.differs && (
        <>
          <Tooltip title={`Entra currently holds: ${info.azureValue}`}>
            <Tag icon={<WarningOutlined />} color="red">differs from Azure</Tag>
          </Tooltip>
          <Button size="small" type="link" icon={<MailOutlined />} onClick={() => onReport(field)}>
            Report to IT
          </Button>
        </>
      )}
    </Space>
  );
}

const fmt = (d) => (d ? String(d).slice(0, 10) : '—');

const STATUS_COLOUR = {
  pending: 'default',
  email_sent: 'orange',
  opened: 'blue',
  completed: 'green',
  skipped: 'default',
};

const STATUS_LABEL = {
  pending: 'Not yet sent',
  email_sent: 'Awaiting response',
  opened: 'Opened, not submitted',
  completed: 'Completed',
  skipped: 'Not applicable',
};

export default function EmployeeDetail() {
  const { id } = useParams();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const { data: e, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/employees/${id}/full`).then(unwrap),
  });

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

  if (isLoading) return <Spin size="large" style={{ display: 'block', marginTop: 80 }} />;
  if (!e) return <Alert type="error" message="Employee not found" />;

  const progress = e.progress || { total: 0, completed: 0, awaitingResponse: 0, overdue: 0, nextDue: null };
  const azure = e.azure || { linked: false, fields: {} };

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

  return (
    <>
      <div className="pea-page-head">
        <Space wrap>
          <Link to="/employees"><Button icon={<ArrowLeftOutlined />} /></Link>
          <div>
            <h2>{e.full_name}</h2>
            <p>{e.office_email}</p>
          </div>
          <Tag>{e.is_experienced ? 'Experienced' : 'Fresher'}</Tag>
          {e.halt_process && <Tag color="default">Paused</Tag>}
          {e.confirmation_status && (
            <Tag color={e.confirmation_status === 'Confirmed' ? 'green' : 'orange'}>{e.confirmation_status}</Tag>
          )}
        </Space>
        <Space wrap>
          <Button icon={<EditOutlined />} onClick={openEdit}>Edit</Button>
          <Tooltip title="A personal link so the employee can see their own probation. What it shows is set in Settings → Access.">
            <Button icon={<ShareAltOutlined />} loading={issueSelfLink.isPending} onClick={() => issueSelfLink.mutate()}>
              Employee link
            </Button>
          </Tooltip>
          <Button
            icon={e.halt_process ? <PlayCircleOutlined /> : <PauseOutlined />}
            onClick={() => toggleHalt.mutate(!e.halt_process)}
            loading={toggleHalt.isPending}
          >
            {e.halt_process ? 'Resume evaluations' : 'Pause evaluations'}
          </Button>
        </Space>
      </div>

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
                  {e.confirmation_status ? (
                    <Tag color={e.confirmation_status === 'Confirmed' ? 'green' : e.confirmation_status === 'Not Confirmed' ? 'red' : 'orange'}>
                      {e.confirmation_status}
                    </Tag>
                  ) : (
                    <Tag color="blue">In probation</Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Next evaluation due">{progress.nextDue ? fmt(progress.nextDue) : '—'}</Descriptions.Item>
                <Descriptions.Item label="Waiting on manager">
                  {progress.awaitingResponse ? <Tag color="orange">{progress.awaitingResponse}</Tag> : 0}
                </Descriptions.Item>
                <Descriptions.Item label="Overdue (not yet sent)">
                  {progress.overdue ? <Tag color="red">{progress.overdue}</Tag> : 0}
                </Descriptions.Item>
                <Descriptions.Item label="Evaluations paused">{e.halt_process ? <Tag>Yes</Tag> : 'No'}</Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>
        </Col>
      </Row>

      <Card className="pea-card" size="small" title={<span className="pea-section-title">Evaluation timeline</span>}>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={e.cycles}
          columns={[
            {
              title: '#',
              dataIndex: 'seq_no',
              width: 60,
              render: (v, r) => (
                <Space size={4}>
                  {v}
                  {r.is_extension && <Tooltip title="Extension"><Tag color="purple">ext</Tag></Tooltip>}
                </Space>
              ),
            },
            {
              title: 'Period',
              width: 200,
              render: (_, r) => `${fmt(r.period_from)} → ${fmt(r.period_to)}`,
            },
            { title: 'Due', dataIndex: 'due_date', width: 110, render: fmt },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 170,
              render: (v) => <Tag color={STATUS_COLOUR[v]}>{STATUS_LABEL[v] || v}</Tag>,
            },
            {
              title: 'Average',
              dataIndex: 'avg_rating',
              width: 90,
              render: (v) =>
                v == null ? '—' : <Tag color={v >= 3.5 ? 'green' : v >= 2.5 ? 'blue' : 'red'}>{Number(v)}</Tag>,
            },
            { title: 'Submitted', dataIndex: 'submitted_at', width: 110, render: fmt },
            {
              title: 'Chased',
              dataIndex: 'reminder_count',
              width: 80,
              render: (v) => (v ? `${v}×` : '—'),
            },
            {
              title: '',
              width: 120,
              render: (_, r) =>
                ['pending', 'email_sent', 'opened'].includes(r.status) && !e.halt_process ? (
                  <Button
                    size="small"
                    icon={<SendOutlined />}
                    loading={resend.isPending}
                    onClick={() => resend.mutate(r.seq_no)}
                  >
                    {r.status === 'pending' ? 'Send' : 'Resend'}
                  </Button>
                ) : null,
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
        title="This value comes from Azure"
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
          Microsoft Entra supplies.
        </Typography.Paragraph>
        <ul style={{ paddingLeft: 18 }}>
          <li><strong>Keep my value</strong> — the Azure sync will never overwrite it. You can unlock it later.</li>
          <li><strong>Just this once</strong> — saved now, but a future sync may put Entra's value back.</li>
        </ul>
        <Typography.Text type="secondary">
          If Entra itself is wrong, use <em>Report to IT</em> afterwards so it is fixed at source too.
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
          <Form.Item label="Entra currently holds">
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
    </>
  );
}
