import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Tabs, Switch, InputNumber, Input, Select, Button, Space, Typography, Alert, App, Table, Spin,
} from 'antd';
import { SaveOutlined, ReloadOutlined } from '@ant-design/icons';
import api, { unwrap, USER_KEY } from '../api.js';
import { canUse, isAdminTier } from '../auth.js';
import PageHeader from '../components/PageHeader.jsx';
import StatusPill from '../components/StatusPill.jsx';
// Walkthrough (27-10-2026) W-12 — both are tabs of this screen again.
import ImportSheet from './ImportSheet.jsx';
import EmailTemplates from './EmailTemplates.jsx';

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
      // H1 (AD sync) — a list of domains and a Microsoft 365 group id are both
      // longer than the default box.
      case 'domain_list':
        return <Input {...common} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="aapnainfotech.com, mera.work" style={{ width: 420, maxWidth: '100%' }} />;
      case 'guid':
        return <Input {...common} value={draft} onChange={(e) => setDraft(e.target.value)} allowClear placeholder="Not set" style={{ width: 340, maxWidth: '100%' }} />;
      // H1 (07-10-2026) — plain words, e.g. the designation words that suggest
      // fresher or experienced. Blank switches the suggestion off.
      case 'word_list':
        return (
          <Input.TextArea
            {...common}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder="Not set — nothing is suggested"
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
  // W-12 — each part of this screen keeps its own access switch. The screen
  // opens for any one of them; only the parts switched on are shown.
  const canSettings = canUse(user, 'settings');
  const canImport = canUse(user, 'import_sheet');
  const canTemplates = canUse(user, 'email_templates');
  // The open tab lives in the URL, so /import and /email-templates land on theirs.
  const [params, setParams] = useSearchParams();

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then(unwrap),
    enabled: canSettings,
  });

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

  if (canSettings && settings.isLoading) return <Spin size="large" style={{ display: 'block', marginTop: 80 }} />;
  if (canSettings && settings.error) return <Alert type="error" message="Could not load settings" description={settings.error.friendlyMessage} />;

  const data = settings.data || { groups: [] };

  // W-12 — the tabs this user may open, in order: the settings groups, then
  // Upload sheet and Email templates, then (super admin only) Not in effect.
  const tabKeys = [
    ...(canSettings ? data.groups.map((g) => g.name) : []),
    ...(canImport ? ['upload-sheet'] : []),
    ...(canTemplates ? ['email-templates'] : []),
    ...(data.notInEffect ? ['not-in-effect'] : []),
  ];
  const activeTab = tabKeys.includes(params.get('tab')) ? params.get('tab') : tabKeys[0];

  return (
    <>
      {/* Walkthrough (27-10-2026) W-13 — Subhajit: the subtitle "Everything the
          Power Automate flows hardcoded — changeable without a deployment" is
          the build team's language, not HR's. Removed. */}
      {/* Headers (28-10-2026) — the words are auth.js pageCopy('settings'). It
          read "Who is emailed and when, the rules for new joiners, the upload
          sheet and the email templates — change any of them here, at any time". */}
      <PageHeader
        module="settings"
        actions={canSettings && (
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => settings.refetch()}>Refresh</Button>
          </Space>
        )}
      />

      {/* The environment banner that used to sit here is gone. Which
          environment this is, and where its email goes, is a deployment fact
          rather than something anyone reads a settings screen to learn — and on
          production it said nothing at all. The one thing it was useful for,
          "no real email is going out", is already in the header chip on every
          screen, with the reasons behind it. */}

      {!canEdit && canSettings && (
        <Alert type="warning" showIcon style={{ borderRadius: 'var(--pea-radius)' }} message="Read-only — only an admin can change settings" />
      )}

      <Card className="pea-card" size="small">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setParams({ tab: key }, { replace: true })}
          destroyOnHidden
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
            // Walkthrough (27-10-2026) W-12 — Upload sheet and Email templates
            // are tabs here again, at Raginee's request. Before, they had their
            // own sidebar entries ("a task HR performs, not a setting they
            // adjust"). Each tab still follows its own access switch.
            // Headers (28-10-2026) — the tab read "Upload sheet"; its key and
            // address (?tab=upload-sheet) are unchanged so links still work.
            ...(canImport ? [{ key: 'upload-sheet', label: 'Upload Excel', children: <ImportSheet embedded /> }] : []),
            ...(canTemplates ? [{ key: 'email-templates', label: 'Email templates', children: <EmailTemplates embedded /> }] : []),
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
