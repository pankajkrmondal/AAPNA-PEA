import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Input, Select, Space, Button, Typography, Modal, Form, DatePicker,
  Switch, App, Progress, Alert, Descriptions,
} from 'antd';
import { PlusOutlined, ImportOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { unwrap } from '../api.js';

const { Option } = Select;

export default function Employees() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [type, setType] = useState();
  const [status, setStatus] = useState();
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [handoffOpen, setHandoffOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [form] = Form.useForm();

  const { data, isLoading } = useQuery({
    queryKey: ['employees', search, type, status, page],
    queryFn: () =>
      api
        .get('/employees', { params: { search: search || undefined, type, confirmation_status: status, page, limit: 25 } })
        .then((r) => r.data),
  });

  const { data: handoffs } = useQuery({
    queryKey: ['handoffs'],
    queryFn: () => api.get('/ats/handoffs').then(unwrap),
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
    onError: (err) => message.error(err.friendlyMessage),
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
      render: (v) => <Tag>{v ? 'Experienced' : 'Fresher'}</Tag>,
    },
    { title: 'DOJ', dataIndex: 'doj', width: 110, render: (v) => String(v).slice(0, 10) },
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
            {p.overdue > 0 && <Tag color="red">{p.overdue} overdue</Tag>}
            {p.awaitingResponse > 0 && <Tag color="orange">{p.awaitingResponse} awaiting</Tag>}
          </Space>
        );
      },
    },
    {
      title: 'Next due',
      dataIndex: ['progress', 'nextDue'],
      width: 110,
      render: (v) => (v ? String(v).slice(0, 10) : '—'),
    },
    {
      title: 'Status',
      dataIndex: 'confirmation_status',
      width: 150,
      render: (v, r) =>
        r.halt_process ? (
          <Tag color="default">Paused</Tag>
        ) : r.employment_status === 'left' ? (
          <Tag color="default">Left</Tag>
        ) : v ? (
          <Tag color={v === 'Confirmed' ? 'green' : v === 'Not Confirmed' ? 'red' : 'orange'}>{v}</Tag>
        ) : (
          <Tag color="blue">In probation</Tag>
        ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Typography.Title level={4} style={{ margin: 0 }}>Employees</Typography.Title>
        <Space wrap>
          {handoffs?.length > 0 && (
            <Button icon={<ImportOutlined />} onClick={() => setHandoffOpen(true)}>
              {handoffs.length} from ATS
            </Button>
          )}
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>Add employee</Button>
        </Space>
      </Space>

      <Card size="small">
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

      {/* ATS handoffs */}
      <Modal
        title="Accepted ATS offers not yet tracked here"
        open={handoffOpen}
        onCancel={() => setHandoffOpen(false)}
        footer={null}
        width={780}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="The joining date comes from the ATS offer"
          description="ATS holds the personal email and the agreed joining date; the office email, reporting manager and project leader are not in ATS and still need entering here."
        />
        <Table
          size="small"
          rowKey="pipeline_id"
          dataSource={handoffs || []}
          pagination={{ pageSize: 8 }}
          columns={[
            { title: 'Candidate', dataIndex: 'candidate_name' },
            { title: 'Personal email', dataIndex: 'candidate_email' },
            { title: 'Role', dataIndex: 'position_applied', render: (v) => v || '—' },
            { title: 'Joining', dataIndex: 'joining_date', width: 110 },
          ]}
        />
      </Modal>
    </Space>
  );
}
