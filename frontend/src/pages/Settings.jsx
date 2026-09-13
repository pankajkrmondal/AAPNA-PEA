import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Tabs, Switch, InputNumber, Input, Select, Button, Space, Tag, Typography, Alert, App, Table,
  Modal, Form, Spin, Tooltip, Popconfirm,
} from 'antd';
import { SaveOutlined, EditOutlined, EyeOutlined, UndoOutlined, ReloadOutlined } from '@ant-design/icons';
import api, { unwrap, USER_KEY } from '../api.js';

/** One editable setting. Saves on its own, so a bad value never blocks the rest. */
function SettingRow({ s, canEdit, onSave, saving }) {
  const [draft, setDraft] = useState(s.value);
  useEffect(() => setDraft(s.value), [s.value]);

  const dirty = String(draft ?? '') !== String(s.value ?? '');

  const control = (() => {
    const common = { disabled: !canEdit };
    switch (s.type) {
      case 'boolean':
        return (
          <Switch
            {...common}
            checked={draft === 'true'}
            onChange={(v) => setDraft(v ? 'true' : 'false')}
            checkedChildren="On"
            unCheckedChildren="Off"
          />
        );
      case 'integer':
        return <InputNumber {...common} min={s.min} max={s.max} value={Number(draft)} onChange={(v) => setDraft(v == null ? '' : String(v))} style={{ width: 140 }} />;
      case 'choice':
        return <Select {...common} value={draft} onChange={setDraft} style={{ width: 180 }} options={s.options.map((o) => ({ value: o, label: o }))} />;
      case 'email_list':
        return (
          <Input.TextArea
            {...common}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder="name@aapnainfotech.com; other@aapnainfotech.com"
            style={{ width: 420, maxWidth: '100%' }}
          />
        );
      default:
        return <Input {...common} value={draft} onChange={(e) => setDraft(e.target.value)} style={{ width: 260, maxWidth: '100%' }} />;
    }
  })();

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, padding: '14px 0', borderBottom: '1px solid var(--pea-border)' }}>
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <Space size={6} wrap>
          <Typography.Text strong>{s.label}</Typography.Text>
          {s.critical && <Tag color="gold">announced to admins</Tag>}
          {s.restart && <Tag color="purple">needs restart</Tag>}
        </Space>
        <div><Typography.Text type="secondary" style={{ fontSize: 12.5 }}>{s.help}</Typography.Text></div>
        <Typography.Text type="secondary" style={{ fontSize: 11, fontFamily: 'ui-monospace, Consolas, monospace' }}>{s.key}</Typography.Text>
      </div>
      <Space align="start" wrap>
        {control}
        {canEdit && (
          <Button
            type={dirty ? 'primary' : 'default'}
            icon={<SaveOutlined />}
            disabled={!dirty}
            loading={saving}
            onClick={() => onSave(s.key, draft)}
          >
            Save
          </Button>
        )}
      </Space>
    </div>
  );
}

export default function Settings() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const user = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
  const canEdit = user.role === 'admin';

  const [editing, setEditing] = useState(null);
  const [preview, setPreview] = useState(null);
  const [tplForm] = Form.useForm();

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings').then(unwrap) });
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get('/settings/templates').then(unwrap) });

  const save = useMutation({
    mutationFn: ({ key, value }) => api.put(`/settings/${key}`, { value }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      qc.invalidateQueries({ queryKey: ['settings'] });
      qc.invalidateQueries({ queryKey: ['diagnostics'] });
      qc.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const saveTpl = useMutation({
    mutationFn: ({ key, values }) => api.put(`/settings/templates/${key}`, values).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const runPreview = useMutation({
    mutationFn: ({ key, values }) => api.post(`/settings/templates/${key}/preview`, values).then(unwrap),
    onSuccess: setPreview,
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const openTemplate = (t) => {
    setEditing(t);
    tplForm.setFieldsValue({ subject: t.override.subject, body: t.override.body });
  };

  if (settings.isLoading) return <Spin size="large" style={{ display: 'block', marginTop: 80 }} />;
  if (settings.error) return <Alert type="error" message="Could not load settings" description={settings.error.friendlyMessage} />;

  const data = settings.data;

  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>Settings</h2>
          <p>Everything the Power Automate flows hardcoded — changeable without a deployment</p>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => { settings.refetch(); templates.refetch(); }}>Refresh</Button>
      </div>

      {data.emailRedirect && (
        <Alert
          type="info"
          showIcon
          style={{ borderRadius: 'var(--pea-radius)' }}
          message={`Environment: ${data.environment} — every email goes only to ${data.emailRedirect.join(', ')}`}
          description="This is enforced in code and cannot be changed from this screen. Real recipients are only ever emailed in production."
        />
      )}

      {!canEdit && (
        <Alert type="warning" showIcon style={{ borderRadius: 'var(--pea-radius)' }} message="Read-only — only an admin can change settings" />
      )}

      <Card className="pea-card" size="small">
        <Tabs
          items={[
            ...data.groups.map((g) => ({
              key: g.name,
              label: g.name,
              children: g.settings.map((s) => (
                <SettingRow
                  key={s.key}
                  s={s}
                  canEdit={canEdit}
                  saving={save.isPending && save.variables?.key === s.key}
                  onSave={(key, value) => save.mutate({ key, value })}
                />
              )),
            })),
            {
              key: 'templates',
              label: 'Email templates',
              children: (
                <Table
                  size="small"
                  rowKey="key"
                  loading={templates.isLoading}
                  pagination={false}
                  dataSource={templates.data || []}
                  columns={[
                    { title: 'Template', dataIndex: 'label' },
                    {
                      title: 'Wording',
                      width: 170,
                      render: (_, t) =>
                        !t.editable ? <Tag>built-in only</Tag> : t.overridden ? <Tag color="purple">customised</Tag> : <Tag color="green">built-in</Tag>,
                    },
                    {
                      title: '',
                      width: 200,
                      render: (_, t) => (
                        <Space size={6}>
                          <Button size="small" icon={<EyeOutlined />} onClick={() => runPreview.mutate({ key: t.key, values: t.override })}>
                            Preview
                          </Button>
                          {t.editable && (
                            <Button size="small" icon={<EditOutlined />} onClick={() => openTemplate(t)}>
                              {canEdit ? 'Edit' : 'View'}
                            </Button>
                          )}
                        </Space>
                      ),
                    },
                  ]}
                />
              ),
            },
            {
              key: 'not-in-effect',
              label: 'Not in effect',
              children: (
                <>
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="These rows exist in the database but nothing reads them"
                    description="Shown so nobody changes one in pgAdmin expecting an effect. The right-hand column says where the real control is."
                  />
                  <Table
                    size="small"
                    rowKey="key"
                    pagination={false}
                    dataSource={data.notInEffect}
                    columns={[
                      { title: 'Key', dataIndex: 'key', render: (v) => <Typography.Text code>{v}</Typography.Text> },
                      { title: 'Stored value', dataIndex: 'value', render: (v) => v || '—' },
                      { title: 'Actually controlled by', dataIndex: 'reason' },
                    ]}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>

      <Modal
        title={editing ? `${canEdit ? 'Edit' : 'View'}: ${editing.label}` : ''}
        open={!!editing}
        onCancel={() => setEditing(null)}
        width={820}
        footer={
          editing && [
            <Button key="preview" icon={<EyeOutlined />} onClick={() => runPreview.mutate({ key: editing.key, values: tplForm.getFieldsValue() })}>
              Preview
            </Button>,
            canEdit && editing.overridden && (
              <Popconfirm key="reset" title="Discard the custom wording and use the built-in template?" onConfirm={() => saveTpl.mutate({ key: editing.key, values: { subject: '', body: '' } })}>
                <Button icon={<UndoOutlined />}>Reset to built-in</Button>
              </Popconfirm>
            ),
            canEdit && (
              <Button key="save" type="primary" icon={<SaveOutlined />} loading={saveTpl.isPending} onClick={() => tplForm.submit()}>
                Save
              </Button>
            ),
          ]
        }
      >
        {editing && (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message="Leave a field blank to keep the built-in wording for it"
              description={
                <Space wrap size={[4, 4]}>
                  Placeholders:
                  {editing.variables.map((v) => (
                    <Tooltip key={v} title="Click to copy">
                      <Tag style={{ cursor: 'pointer' }} onClick={() => navigator.clipboard?.writeText(`{{${v}}}`)}>{`{{${v}}}`}</Tag>
                    </Tooltip>
                  ))}
                </Space>
              }
            />
            <Form form={tplForm} layout="vertical" disabled={!canEdit} onFinish={(values) => saveTpl.mutate({ key: editing.key, values })}>
              <Form.Item name="subject" label="Subject">
                <Input placeholder="(built-in subject)" />
              </Form.Item>
              <Form.Item name="body" label="Body (HTML — the signature is added automatically)">
                <Input.TextArea rows={12} placeholder="(built-in body)" style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12.5 }} />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>

      <Modal
        title={preview ? `Preview — ${preview.subject}` : ''}
        open={!!preview}
        onCancel={() => setPreview(null)}
        footer={null}
        width={760}
      >
        <Typography.Paragraph type="secondary" style={{ marginTop: -6 }}>
          Sample data only. Nothing is saved or sent.
        </Typography.Paragraph>
        {/* Sandboxed with no permissions: template HTML can never run script here. */}
        {preview && (
          <iframe
            title="Email preview"
            sandbox=""
            srcDoc={preview.body}
            style={{ width: '100%', height: 520, border: '1px solid var(--pea-border)', borderRadius: 10, background: '#fff' }}
          />
        )}
      </Modal>
    </>
  );
}
