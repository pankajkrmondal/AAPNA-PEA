import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Space, Button, Modal, Form, Input, DatePicker, Radio, Alert,
  App, Tooltip, Typography, Empty, Popconfirm,
} from 'antd';
import {
  SyncOutlined, EyeOutlined, UserAddOutlined, CloseOutlined, CheckOutlined,
  LogoutOutlined, ClusterOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { unwrap } from '../api.js';

const fmt = (d) => (d ? String(d).slice(0, 10) : '—');

/**
 * A value Entra supplied but nobody has checked. The label matters: measured
 * coverage says the manager is right 88% of the time when set and the account
 * date is within ±3 days only 70% of the time, so presenting either as fact
 * would be a lie of omission.
 */
function Suggested({ value, source, hint }) {
  if (!value) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Space size={6}>
      <span>{value}</span>
      {source && (
        <Tooltip title={hint}>
          <Tag color="gold" style={{ fontSize: 11 }}>unverified</Tag>
        </Tooltip>
      )}
    </Space>
  );
}

export default function NewJoiners() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [accepting, setAccepting] = useState(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['intake-inbox'],
    queryFn: () => api.get('/intake/inbox').then(unwrap),
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['intake-inbox'] });
    qc.invalidateQueries({ queryKey: ['employees'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const scan = useMutation({
    mutationFn: (dryRun) => api.post(`/intake/scan?dryRun=${dryRun}`).then((r) => r.data),
    onSuccess: (res) => { message.success(res.message); refresh(); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const accept = useMutation({
    mutationFn: ({ id, values }) => api.post(`/intake/joiners/${id}/accept`, values).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setAccepting(null);
      form.resetFields();
      refresh();
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const dismiss = useMutation({
    mutationFn: (id) => api.post(`/intake/joiners/${id}/dismiss`, { reason: 'Not a new joiner' }),
    onSuccess: () => { message.success('Removed from the inbox'); refresh(); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const leaverAction = useMutation({
    mutationFn: ({ id, action }) => api.post(`/intake/leavers/${id}/${action}`).then((r) => r.data),
    onSuccess: (res) => { message.success(res.message); refresh(); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const seedMap = useMutation({
    mutationFn: () => api.post('/intake/rm-pl-map/seed').then((r) => r.data),
    onSuccess: (res) => { message.success(res.message); refresh(); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const openAccept = (row) => {
    setAccepting(row);
    form.setFieldsValue({
      full_name: row.display_name,
      personal_email: undefined,
      office_email: row.office_email,
      // Prefilled but never pre-answered: the two fields Microsoft does not
      // hold are left for HR, and is_experienced has no default at all.
      doj: row.suggested_doj ? dayjs(row.suggested_doj) : null,
      is_experienced: undefined,
      rm_name: row.suggested_rm_name,
      rm_email: row.suggested_rm_email,
      pl_email: row.suggested_pl_email,
    });
  };

  const counts = data?.counts || {};
  const lastScan = data?.lastScan;

  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>New joiners</h2>
          <p>
            New Microsoft accounts, however the person joined · confirm what Microsoft
            cannot tell us · anyone can also be added directly from Employees
            {lastScan && (
              <> · last scan {new Date(lastScan.runAt).toLocaleString()} ({lastScan.status})</>
            )}
          </p>
        </div>
        <Space wrap>
          {/* Always available, not only once an ambiguity exists — the map is
              empty on first use, which is exactly when it needs seeding. */}
          <Tooltip title="Rebuild the reporting-manager → project-leader map from the current roster">
            <Button icon={<ClusterOutlined />} onClick={() => seedMap.mutate()} loading={seedMap.isPending}>
              Rebuild RM→PL map
            </Button>
          </Tooltip>
          <Button icon={<EyeOutlined />} onClick={() => scan.mutate(true)} loading={scan.isPending}>
            Dry run
          </Button>
          <Button type="primary" icon={<SyncOutlined />} onClick={() => scan.mutate(false)} loading={scan.isPending}>
            Scan now
          </Button>
        </Space>
      </div>

      {data?.setupRequired && (
        <Alert
          type="error"
          showIcon
          style={{ borderRadius: 'var(--pea-radius)' }}
          message="Entra intake is not set up on this database yet"
          description={
            <>
              The tables this screen needs do not exist on this database. Create them
              with the PEA schema DDL, then reload.
            </>
          }
        />
      )}

      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        style={{ borderRadius: 'var(--pea-radius)' }}
        message="Two things always need a person"
        description={
          <>
            Entra holds no joining date and no fresher/experienced flag — both attributes
            are unpopulated across all 260 accounts. The suggested date is the date IT
            created the Microsoft account, which is within a few days about 70% of the
            time and, for a rejoiner whose old account was reused, has been out by over
            two years. A wrong date moves every evaluation, so PEA asks rather than
            assumes.
          </>
        }
      />

      {counts.ambiguousPlMappings > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ borderRadius: 'var(--pea-radius)' }}
          message={`${counts.ambiguousPlMappings} reporting manager(s) map to more than one project leader`}
          description="Their project leader is left blank rather than guessed. Set it once on the employee and the mapping is remembered."
        />
      )}

      {/* ── Entra-detected joiners ─────────────────────────────────────── */}
      <Card
        className="pea-card"
        size="small"
        title={<span className="pea-section-title">Detected in Entra</span>}
        extra={<span className="pea-count">{counts.joiners ?? 0}</span>}
      >
        <Table
          size="small"
          rowKey="id"
          loading={isLoading}
          pagination={false}
          dataSource={data?.joiners || []}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No new accounts waiting. Run a scan to check Entra."
              />
            ),
          }}
          columns={[
            {
              title: 'Name',
              dataIndex: 'display_name',
              render: (v, r) => (
                <Space direction="vertical" size={0}>
                  <Typography.Text strong>{v || '—'}</Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.office_email}</Typography.Text>
                </Space>
              ),
            },
            {
              title: 'Account created',
              dataIndex: 'account_created_at',
              width: 140,
              render: (v) => fmt(v),
            },
            {
              title: 'Suggested DOJ',
              width: 170,
              render: (_, r) => (
                <Suggested
                  value={r.suggested_doj}
                  source={r.doj_source}
                  hint="The Microsoft account creation date, used as a proxy. Right within ±3 days about 70% of the time."
                />
              ),
            },
            {
              title: 'Reporting manager',
              render: (_, r) => (
                <Suggested
                  value={r.suggested_rm_email}
                  source={r.rm_source}
                  hint="From the Entra manager attribute. Set on 73% of new accounts and correct 88% of the time when set."
                />
              ),
            },
            {
              title: 'Project leader',
              render: (_, r) =>
                r.suggested_pl_email ? (
                  <Suggested value={r.suggested_pl_email} source={r.pl_source} hint="Derived from the reporting manager." />
                ) : (
                  <Tooltip title="Either the manager is unknown, or they map to more than one project leader.">
                    <Tag>needs HR</Tag>
                  </Tooltip>
                ),
            },
            {
              title: '',
              width: 190,
              render: (_, r) => (
                <Space size={6}>
                  <Button size="small" type="primary" icon={<UserAddOutlined />} onClick={() => openAccept(r)}>
                    Confirm
                  </Button>
                  <Popconfirm
                    title="Remove from the inbox?"
                    description="They will not reappear unless Entra changes."
                    onConfirm={() => dismiss.mutate(r.id)}
                  >
                    <Button size="small" icon={<CloseOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Leaver suggestions ─────────────────────────────────────────── */}
      <Card
        className="pea-card"
        size="small"
        title={<span className="pea-section-title">Possible leavers</span>}
        extra={<span className="pea-count pea-count-muted">{counts.leavers ?? 0}</span>}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="Flagged only when the account is BOTH disabled and unlicensed"
          description="The original rule was 'no licence means they have left'. Across 91 accounts that flags 68 people — mostly resource accounts, guests and unlicensed staff who are still here. Requiring both signals gives 16. Nothing is changed until you confirm."
        />
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.leavers || []}
          locale={{ emptyText: 'Nobody flagged' }}
          columns={[
            {
              title: 'Employee',
              dataIndex: 'full_name',
              render: (v, r) => (
                <Space direction="vertical" size={0}>
                  <Link to={`/employees/${r.id}`}>{v}</Link>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.office_email}</Typography.Text>
                </Space>
              ),
            },
            { title: 'DOJ', dataIndex: 'doj', width: 110, render: fmt },
            {
              title: 'Entra says',
              width: 200,
              render: (_, r) => (
                <Space size={4} wrap>
                  <Tag color="red">{r.azure_account_enabled === false ? 'disabled' : 'enabled'}</Tag>
                  <Tag color="red">{r.license_assigned === false ? 'no licence' : 'licensed'}</Tag>
                </Space>
              ),
            },
            { title: 'Flagged', dataIndex: 'leaver_flagged_at', width: 120, render: fmt },
            {
              title: '',
              width: 210,
              render: (_, r) => (
                <Space size={6}>
                  <Popconfirm
                    title="Mark as having left?"
                    description="All outstanding evaluations stop immediately."
                    onConfirm={() => leaverAction.mutate({ id: r.id, action: 'confirm' })}
                  >
                    <Button size="small" danger icon={<LogoutOutlined />}>They left</Button>
                  </Popconfirm>
                  <Button
                    size="small"
                    icon={<CheckOutlined />}
                    onClick={() => leaverAction.mutate({ id: r.id, action: 'dismiss' })}
                  >
                    Still here
                  </Button>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Confirm-and-add ────────────────────────────────────────────── */}
      <Modal
        title={`Confirm ${accepting?.display_name || 'new joiner'}`}
        open={!!accepting}
        onCancel={() => { setAccepting(null); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={accept.isPending}
        okText="Add and schedule"
        width={620}
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(v) =>
            accept.mutate({
              id: accepting.id,
              values: { ...v, doj: dayjs(v.doj).format('YYYY-MM-DD') },
            })
          }
        >
          <Form.Item name="full_name" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="office_email" label="Office email" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="name@aapnainfotech.com" />
          </Form.Item>
          <Form.Item name="personal_email" label="Personal email (optional)" rules={[{ type: 'email' }]}>
            <Input />
          </Form.Item>

          <Form.Item
            name="doj"
            label="Date of joining"
            rules={[{ required: true, message: 'Confirm the joining date' }]}
            extra={
              accepting?.doj_source === 'account_created'
                ? 'Prefilled from the Microsoft account creation date — check it against the offer letter or with the employee.'
                : undefined
            }
          >
            <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
          </Form.Item>

          <Form.Item
            name="is_experienced"
            label="Fresher or experienced"
            rules={[{ required: true, message: 'This decides the whole schedule — please choose' }]}
            extra="Microsoft holds nothing here. A fresher gets 6 monthly evaluations; an experienced hire gets 3 two-monthly ones."
          >
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value={false}>Fresher</Radio.Button>
              <Radio.Button value>Experienced</Radio.Button>
            </Radio.Group>
          </Form.Item>

          <Form.Item name="rm_name" label="Reporting manager" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="rm_email" label="Reporting manager email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="pl_email"
            label="Project leader email"
            rules={[{ required: true, type: 'email' }]}
            extra={accepting?.pl_source === 'rm_map' ? 'Derived from the reporting manager.' : undefined}
          >
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
