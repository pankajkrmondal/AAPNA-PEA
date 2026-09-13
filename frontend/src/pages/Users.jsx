import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Space, Button, Modal, Form, Input, Select, Switch, App, Typography, Alert, Tooltip,
} from 'antd';
import { UserAddOutlined, KeyOutlined, EditOutlined } from '@ant-design/icons';
import api, { unwrap, USER_KEY } from '../api.js';

const ROLE_COLOUR = { admin: 'purple', hr: 'green', viewer: 'default' };
const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin — users, settings, final import' },
  { value: 'hr', label: 'HR — employees, evaluations, inbox' },
  { value: 'viewer', label: 'Viewer — read-only reporting' },
];

const passwordRules = [
  { required: true, message: 'Enter a password' },
  { min: 10, message: 'At least 10 characters — a short phrase works well' },
];

/**
 * Who can sign in. This is what makes Enhancement E1 real: when Subhajit takes
 * over from Shweta, add him here and deactivate her — no file ownership to
 * transfer, no flows to re-authorise.
 */
export default function Users() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const me = JSON.parse(localStorage.getItem(USER_KEY) || '{}');

  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [addForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [resetForm] = Form.useForm();

  const { data, isLoading, error } = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users').then(unwrap) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation({
    mutationFn: (v) => api.post('/users', v).then((r) => r.data),
    onSuccess: (res) => { message.success(res.message); setAdding(false); addForm.resetFields(); refresh(); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const update = useMutation({
    mutationFn: ({ id, values }) => api.patch(`/users/${id}`, values).then((r) => r.data),
    onSuccess: (res) => { message.success(res.message); setEditing(null); refresh(); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const reset = useMutation({
    mutationFn: ({ id, password }) => api.post(`/users/${id}/reset-password`, { password }).then((r) => r.data),
    onSuccess: (res) => { message.success(res.message); setResetting(null); resetForm.resetFields(); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  if (error?.response?.status === 403) {
    return <Alert type="warning" showIcon message="Only an admin can manage users" />;
  }

  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>Users</h2>
          <p>Who can sign in to PEA · reporting managers never need an account</p>
        </div>
        <Button type="primary" icon={<UserAddOutlined />} onClick={() => setAdding(true)}>Add user</Button>
      </div>

      <Card className="pea-card" size="small">
        <Table
          size="small"
          rowKey="id"
          loading={isLoading}
          dataSource={data || []}
          pagination={false}
          scroll={{ x: 820 }}
          columns={[
            {
              title: 'User',
              dataIndex: 'username',
              render: (v, r) => (
                <div>
                  <Space size={6}>
                    <Typography.Text strong>{[r.first_name, r.last_name].filter(Boolean).join(' ') || v}</Typography.Text>
                    {r.id === me.id && <Tag>you</Tag>}
                  </Space>
                  <div>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{v} · {r.email}</Typography.Text>
                  </div>
                </div>
              ),
            },
            { title: 'Role', dataIndex: 'role', width: 100, render: (v) => <Tag color={ROLE_COLOUR[v]}>{v}</Tag> },
            {
              title: 'Status',
              dataIndex: 'is_active',
              width: 110,
              render: (v) => (v ? <Tag color="green">active</Tag> : <Tag>deactivated</Tag>),
            },
            {
              title: 'Last sign-in',
              dataIndex: 'last_login_at',
              width: 180,
              render: (v) => (v ? new Date(v).toLocaleString() : <Typography.Text type="secondary">never</Typography.Text>),
            },
            {
              title: '',
              width: 190,
              render: (_, r) => (
                <Space size={6}>
                  <Button
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => {
                      setEditing(r);
                      editForm.setFieldsValue({
                        first_name: r.first_name,
                        last_name: r.last_name,
                        email: r.email,
                        role: r.role,
                        is_active: r.is_active,
                      });
                    }}
                  >
                    Edit
                  </Button>
                  <Tooltip title={r.id === me.id ? 'Change your own password from the menu under your name' : 'Set a new password'}>
                    <Button size="small" icon={<KeyOutlined />} disabled={r.id === me.id} onClick={() => setResetting(r)}>
                      Reset
                    </Button>
                  </Tooltip>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title="Add user"
        open={adding}
        onCancel={() => setAdding(false)}
        onOk={() => addForm.submit()}
        confirmLoading={create.isPending}
        okText="Add"
      >
        <Form form={addForm} layout="vertical" requiredMark={false} initialValues={{ role: 'hr' }} onFinish={(v) => create.mutate(v)}>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="first_name" label="First name" style={{ flex: 1 }}><Input /></Form.Item>
            <Form.Item name="last_name" label="Last name" style={{ flex: 1 }}><Input /></Form.Item>
          </Space>
          <Form.Item name="username" label="Username" rules={[{ required: true }, { pattern: /^[a-zA-Z0-9._-]{3,100}$/, message: 'Letters, digits, dot, dash or underscore' }]}>
            <Input autoComplete="off" />
          </Form.Item>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="name@aapnainfotech.com" autoComplete="off" />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item name="password" label="Initial password" rules={passwordRules} extra="Share it with them directly — PEA does not email passwords.">
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editing ? `Edit ${editing.username}` : ''}
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={() => editForm.submit()}
        confirmLoading={update.isPending}
        okText="Save"
      >
        {editing?.id === me.id && (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} message="You cannot change your own role or deactivate yourself" />
        )}
        <Form form={editForm} layout="vertical" requiredMark={false} onFinish={(values) => update.mutate({ id: editing.id, values })}>
          <Space size={12} style={{ display: 'flex' }}>
            <Form.Item name="first_name" label="First name" style={{ flex: 1 }}><Input /></Form.Item>
            <Form.Item name="last_name" label="Last name" style={{ flex: 1 }}><Input /></Form.Item>
          </Space>
          <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email' }]}><Input /></Form.Item>
          <Form.Item name="role" label="Role" extra="Changing the role signs them out everywhere.">
            <Select options={ROLE_OPTIONS} disabled={editing?.id === me.id} />
          </Form.Item>
          <Form.Item name="is_active" label="Can sign in" valuePropName="checked" extra="Deactivating signs them out immediately. Their history is kept.">
            <Switch disabled={editing?.id === me.id} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={resetting ? `Reset password — ${resetting.username}` : ''}
        open={!!resetting}
        onCancel={() => setResetting(null)}
        onOk={() => resetForm.submit()}
        confirmLoading={reset.isPending}
        okText="Reset"
      >
        <Form form={resetForm} layout="vertical" requiredMark={false} onFinish={({ password }) => reset.mutate({ id: resetting.id, password })}>
          <Form.Item name="password" label="New password" rules={passwordRules} extra="They are signed out everywhere and must use this next time.">
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
