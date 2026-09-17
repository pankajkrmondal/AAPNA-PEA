import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Input, Select, Space, Button, Typography, Modal, Form, DatePicker,
  Switch, App, Progress, Alert, Descriptions,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { unwrap } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';

const { Option } = Select;

export default function Employees() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [type, setType] = useState();
  const [status, setStatus] = useState();
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['employees', search, type, status, page],
    queryFn: () =>
      api
        .get('/employees', { params: { search: search || undefined, type, confirmation_status: status, page, limit: 25 } })
        .then((r) => r.data),
  });


  const create = useMutation({
    mutationFn: (values) => api.post('/employees', values).then(unwrap),
    onSuccess: (emp) => {
      message.success(`${emp.full_name} added — ${emp.cycles.length} evaluations scheduled`);
      setAddOpen(false);
      setPreview(null);
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  // Shows the exact dates before saving. The cadence rule was previously
  // invisible — HR had no way to see when evaluations would land.
  const previewSchedule = async () => {
    const { doj, is_experienced } = form.getFieldsValue();
    if (!doj) return;
    const rows = await api
      .post('/employees/preview-schedule', {
        doj: dayjs(doj).format('YYYY-MM-DD'),
        is_experienced: !!is_experienced,
      })
      .then(unwrap);
    setPreview(rows);
  };

  const columns = [
    {
      title: 'Name',
      dataIndex: 'full_name',
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Link to={`/employees/${r.id}`}>{v}</Link>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.office_email}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'is_experienced',
      width: 110,
      render: (v) => <StatusPill tone="mute" nodot>{v ? 'Experienced' : 'Fresher'}</StatusPill>,
    },
    { title: 'DOJ', dataIndex: 'doj', width: 110, className: 'pea-num', render: (v) => String(v).slice(0, 10) },
    { title: 'Reporting manager', dataIndex: 'rm_name' },
    {
      title: 'Progress',
      width: 160,
      render: (_, r) => {
        const p = r.progress;
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Progress
              percent={p.total ? Math.round((p.completed / p.total) * 100) : 0}
              size="small"
              format={() => `${p.completed}/${p.total}`}
            />
            {p.overdue > 0 && <StatusPill tone="crit">{p.overdue} overdue</StatusPill>}
            {p.awaitingResponse > 0 && (
              <StatusPill tone="warn">{p.awaitingResponse} awaiting</StatusPill>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Next due',
      dataIndex: ['progress', 'nextDue'],
      width: 110,
      className: 'pea-num',
      render: (v) => (v ? String(v).slice(0, 10) : '—'),
    },
    {
      title: 'Status',
      dataIndex: 'confirmation_status',
      width: 150,
      render: (v, r) =>
        r.halt_process ? (
          <StatusPill tone="warn">Paused</StatusPill>
        ) : r.employment_status === 'left' ? (
          <StatusPill tone="mute">Left</StatusPill>
        ) : v ? (
          <StatusPill tone={v === 'Confirmed' ? 'ok' : v === 'Not Confirmed' ? 'crit' : 'ext'}>
            {v}
          </StatusPill>
        ) : (
          <StatusPill tone="info">In probation</StatusPill>
        ),
    },
  ];

  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>Employees</h2>
          <p>Everyone on a probation schedule, and where each one has got to</p>
        </div>
        <Space wrap>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>Add employee</Button>
        </Space>
      </div>

      <Card className="pea-card" size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            placeholder="Search name, email or manager"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 280 }}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <Select placeholder="Type" allowClear style={{ width: 150 }} onChange={(v) => { setType(v); setPage(1); }}>
            <Option value="fresher">Fresher</Option>
            <Option value="experienced">Experienced</Option>
          </Select>
          <Select placeholder="Status" allowClear style={{ width: 180 }} onChange={(v) => { setStatus(v); setPage(1); }}>
            <Option value="pending">In probation</Option>
            <Option value="Confirmed">Confirmed</Option>
            <Option value="Not Confirmed">Not Confirmed</Option>
            <Option value="Extend for 1 month">Extended 1 month</Option>
            <Option value="Extend for 2 months">Extended 2 months</Option>
          </Select>
        </Space>

        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={data?.data || []}
          columns={columns}
          pagination={{
            current: page,
            pageSize: 25,
            total: data?.pagination?.total || 0,
            onChange: setPage,
            showTotal: (t) => `${t} employee(s)`,
          }}
        />
      </Card>

      {/* Add employee */}
      <Modal
        title="Add employee"
        open={addOpen}
        onCancel={() => { setAddOpen(false); setPreview(null); }}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        okText="Add and schedule"
        width={620}
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(v) => create.mutate({ ...v, doj: dayjs(v.doj).format('YYYY-MM-DD') })}
          onValuesChange={(changed) => {
            if ('doj' in changed || 'is_experienced' in changed) previewSchedule();
          }}
        >
          <Form.Item name="full_name" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="office_email" label="Office email" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="name@aapnainfotech.com" />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item name="doj" label="Date of joining" rules={[{ required: true }]} style={{ flex: 1 }}>
              {/* A real date picker: the free-text DOJ is what broke the old
                  system, so the format can no longer be got wrong. */}
              <DatePicker style={{ width: '100%' }} format="DD-MMM-YYYY" />
            </Form.Item>
            <Form.Item name="is_experienced" label="Experienced" valuePropName="checked" initialValue={false}>
              <Switch checkedChildren="Yes" unCheckedChildren="No" />
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

          {preview && (
            <Alert
              type="info"
              message={`${preview.length} evaluations will be scheduled`}
              description={
                <Space wrap size={[6, 6]}>
                  {preview.map((p) => (
                    <Tag key={p.seq_no}>#{p.seq_no} · {p.due_date}</Tag>
                  ))}
                </Space>
              }
            />
          )}
        </Form>
      </Modal>

    </>
  );
}
