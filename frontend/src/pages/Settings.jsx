import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Tabs, Switch, InputNumber, Input, Select, Button, Space, Typography, Alert, App, Table, Spin,
} from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import api, { unwrap, USER_KEY } from '../api.js';
import { isAdminTier } from '../auth.js';
import StatusPill from '../components/StatusPill.jsx';

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
    <div className="pea-setting-row">
      <div className="pea-setting-main">
        <Space size={6} wrap>
          <Typography.Text strong>{s.label}</Typography.Text>
          {/* A classification of the setting, not a state of it — no dot. */}
          {s.critical && <StatusPill tone="warn" nodot>announced to admins</StatusPill>}
        </Space>
        <div><Typography.Text type="secondary" style={{ fontSize: 12.5 }}>{s.help}</Typography.Text></div>
        {/* The pea_settings column name. Plumbing rather than a setting, so the
            API sends it to a super admin only — see listSettings. */}
        {s.showKey && <Typography.Text type="secondary" className="pea-setting-key">{s.key}</Typography.Text>}
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
  const canEdit = isAdminTier(user.role);

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get('/settings').then(unwrap) });

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
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => settings.refetch()}>Refresh</Button>
        </Space>
      </div>

      {/* The environment banner that used to sit here is gone. Which
          environment this is, and where its email goes, is a deployment fact
          rather than something anyone reads a settings screen to learn — and on
          production it said nothing at all. The one thing it was useful for,
          "no real email is going out", is already in the header chip on every
          screen, with the reasons behind it. */}

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
            // Upload sheet is NOT a tab here any more: it has its own sidebar
            // entry, below Link generation. It is a task HR performs, not a
            // setting they adjust, and it was the one thing in this screen
            // people had to be told where to find. Its access switch is
            // unchanged, so who may open it is exactly as before.
            //
            // Email templates left for the same reason, earlier.
            //
            // "Not in effect" is a list of database rows that nothing reads.
            // It exists so a maintainer does not change one in pgAdmin
            // expecting an effect — a question only whoever maintains the
            // system asks, so the API sends it to a super admin alone.
            ...(data.notInEffect
              ? [{
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
              }]
              : []),
          ]}
        />
      </Card>
    </>
  );
}
