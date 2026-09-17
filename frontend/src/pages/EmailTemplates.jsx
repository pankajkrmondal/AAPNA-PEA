import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Row, Col, List, Input, Select, Button, Alert, App, Spin, Typography, Space, Tag, Tooltip, Popconfirm,
} from 'antd';
import { MailOutlined, SaveOutlined, SearchOutlined, CopyOutlined, UndoOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import api, { unwrap, USER_KEY } from '../api.js';
import { isAdminTier } from '../auth.js';
import { useThemeMode } from '../theme.jsx';
import { EmailEditorTabs, EmailPreviewPane, FULL_TOOLBAR, sanitizeFragment } from '../components/EmailBodyEditor';
import '../styles/emailTemplates.css';

dayjs.extend(relativeTime);

const { Text, Title } = Typography;

const CATEGORIES = [
  { value: 'all', label: 'All emails' },
  { value: 'manager', label: 'To reporting manager' },
  { value: 'hr', label: 'To HR' },
  { value: 'it', label: 'To IT' },
];

const SAMPLE_TO = {
  manager: 'manager@aapnainfotech.com',
  hr: 'hr-team@aapnainfotech.com',
  it: 'it-team@aapnainfotech.com',
};

const fetchTemplates = () => api.get('/settings/templates').then(unwrap);

/** Why a body cannot be saved, or null. Mirrors validate() in emailTemplate.service.js. */
const bodyProblem = (html) => {
  if (/<script[\s>]|\son\w+\s*=|javascript:/i.test(html || '')) {
    return 'Scripts, event handlers and javascript: links are not allowed in an email.';
  }
  if (/<!DOCTYPE|<html[\s>]|<body[\s>]/i.test(html || '')) {
    return 'Enter only the message body — the AAPNA header, logo and footer are added automatically.';
  }
  return null;
};

/**
 * Email Templates — the subject and wording of every email PEA sends, edited
 * from the site. Same screen as ATS: list on the left, Subject + Editor /
 * HTML Code / Live Preview on the right. The AAPNA header, logo and footer are
 * added by the server and cannot be edited, so they cannot be broken.
 */
/**
 * @param {{embedded?: boolean}} props - `embedded` drops the page heading, for
 *   use as a Settings tab. One implementation either way.
 */
export default function EmailTemplates({ embedded = false } = {}) {
  const { message, modal } = App.useApp();
  const qc = useQueryClient();
  const { mode } = useThemeMode();
  const canEdit = isAdminTier(JSON.parse(localStorage.getItem(USER_KEY) || '{}').role);

  const templates = useQuery({ queryKey: ['email-templates'], queryFn: fetchTemplates });
  const list = templates.data || [];

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [selectedKey, setSelectedKey] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [editorRev, setEditorRev] = useState(0);
  const [tab, setTab] = useState('1');
  const [preview, setPreview] = useState(null);

  const selected = list.find((t) => t.key === selectedKey) || null;

  const load = (t) => {
    setSelectedKey(t.key);
    setSubject(t.subject);
    setBody(t.body);
    setDirty(false);
    setPreview(null);
    setTab('1');
    setEditorRev((r) => r + 1);
  };

  useEffect(() => {
    if (!selectedKey && list.length) load(list[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter(
      (t) => (category === 'all' || t.category === category) && (!q || `${t.name} ${t.subject}`.toLowerCase().includes(q))
    );
  }, [list, category, search]);

  const choose = (t) => {
    if (t.key === selectedKey) return;
    if (dirty) {
      modal.confirm({
        title: 'Discard unsaved changes?',
        content: `You have unsaved edits to "${selected?.name}". Switching emails will discard them.`,
        okText: 'Discard changes',
        okButtonProps: { danger: true },
        cancelText: 'Keep editing',
        onOk: () => load(t),
      });
      return;
    }
    load(t);
  };

  const runPreview = useMutation({
    mutationFn: ({ key, draft }) => api.post(`/settings/templates/${key}/preview`, draft).then(unwrap),
    onSuccess: setPreview,
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  // Live Preview is built by the server with sample data — the same code that
  // sends real mail. Rebuilt shortly after each change while the tab is open.
  useEffect(() => {
    if (tab !== '3' || !selectedKey) return undefined;
    const timer = setTimeout(
      () => runPreview.mutate({ key: selectedKey, draft: { subject, body: sanitizeFragment(body) } }),
      350
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedKey, subject, body]);

  const save = useMutation({
    mutationFn: () => {
      // Refuse, don't silently strip: the clean-up below would remove these and
      // report "saved", so the admin never learns part of the paste was lost.
      // Same rules as the server (emailTemplate.service.js).
      const problem = bodyProblem(body);
      if (problem) return Promise.reject(Object.assign(new Error(problem), { friendlyMessage: problem }));
      return api.put(`/settings/templates/${selectedKey}`, { subject, body: sanitizeFragment(body) }).then((r) => r.data);
    },
    onSuccess: (res) => {
      message.success(res.message);
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['email-templates'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const reset = useMutation({
    mutationFn: () => api.delete(`/settings/templates/${selectedKey}`).then((r) => r.data),
    onSuccess: async (res) => {
      message.success(res.message);
      // Fetch directly, not qc.fetchQuery: that can hand back the cached,
      // still-customised list, and the editor would keep the old wording.
      const fresh = await fetchTemplates();
      qc.setQueryData(['email-templates'], fresh);
      const t = fresh.find((x) => x.key === selectedKey);
      if (t) load(t);
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const copyHtml = async () => {
    try {
      await navigator.clipboard.writeText(body || '');
      message.success('Email HTML copied to clipboard.');
    } catch {
      message.error('Could not copy to clipboard.');
    }
  };

  if (templates.isLoading) return <Spin size="large" style={{ display: 'block', marginTop: 80 }} />;
  if (templates.error) {
    return <Alert type="error" message="Could not load email templates" description={templates.error.friendlyMessage} />;
  }

  return (
    <div className="email-page">
      {!embedded && (
        <div className="pea-page-head">
          <div>
            <h2>Email templates</h2>
            <p>The subject and wording of every email PEA sends. The AAPNA header, logo and footer are added automatically.</p>
          </div>
        </div>
      )}

      {!canEdit && (
        <Alert
          type="warning"
          showIcon
          style={{ borderRadius: 'var(--pea-radius)', marginBottom: 12 }}
          message="Read-only — only an admin can change email templates"
        />
      )}

      <div className="email-toolbar">
        <Input
          prefix={<SearchOutlined style={{ color: 'var(--pea-text-faint)' }} />}
          placeholder="Search templates"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
          className="email-toolbar__search"
        />
        <Select
          value={category}
          onChange={setCategory}
          options={CATEGORIES}
          popupMatchSelectWidth={false}
          className="email-toolbar__category"
        />
        <Text type="secondary" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
          {filtered.length} {filtered.length === 1 ? 'template' : 'templates'}
        </Text>

        <div style={{ flexGrow: 1 }} />

        {selected && (
          <Text type="secondary" style={{ fontSize: 12.5, whiteSpace: 'nowrap', color: dirty ? 'var(--pea-orange)' : undefined }}>
            {dirty
              ? 'Unsaved changes'
              : selected.overridden && selected.modifiedAt
                ? `Saved ${dayjs(selected.modifiedAt).fromNow()}`
                : 'Default wording'}
          </Text>
        )}

        {canEdit && selected?.overridden && (
          <Popconfirm
            title="Reset to the default wording?"
            description="Your changes to this email's subject and body are discarded."
            okText="Reset"
            okButtonProps={{ danger: true }}
            onConfirm={() => reset.mutate()}
          >
            <Button icon={<UndoOutlined />} loading={reset.isPending}>Reset to default</Button>
          </Popconfirm>
        )}

        {canEdit && (
          <Button
            type="primary"
            icon={<SaveOutlined />}
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!selected || !dirty}
          >
            Save changes
          </Button>
        )}
      </div>

      <Row gutter={[20, 20]} align="stretch">
        <Col xs={24} md={8}>
          <Card className="pea-card email-list-card" styles={{ body: { padding: '10px 0' } }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 32, textAlign: 'center' }}>
                <Text type="secondary">No email matches the search.</Text>
              </div>
            ) : (
              <List
                dataSource={filtered}
                className="email-template-list"
                renderItem={(item) => {
                  const isSelected = item.key === selectedKey;
                  return (
                    <List.Item
                      onClick={() => choose(item)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(item); } }}
                      role="button"
                      tabIndex={0}
                      aria-pressed={isSelected}
                      className={`template-list-item${isSelected ? ' is-selected' : ''}`}
                    >
                      <div style={{ display: 'flex', gap: 10, width: '100%', minWidth: 0 }}>
                        <Tooltip title={item.overridden ? 'Customised' : 'Default wording'}>
                          <span
                            className="template-list-item__dot"
                            style={{ background: item.overridden ? 'var(--pea-orange)' : 'var(--pea-green-600)' }}
                          />
                        </Tooltip>
                        <div style={{ minWidth: 0, flexGrow: 1 }}>
                          <div className="template-list-item__name">{item.name}</div>
                          <div className="template-list-item__sub">{item.categoryLabel} · {item.subject}</div>
                        </div>
                      </div>
                    </List.Item>
                  );
                }}
              />
            )}
          </Card>
        </Col>

        <Col xs={24} md={16}>
          {selected ? (
            <Card
              className="pea-card email-editor-card"
              title={
                <div style={{ minWidth: 0 }}>
                  <div className="email-editor-card__name">{selected.name}</div>
                  <Text type="secondary" style={{ fontSize: 11.5 }}>
                    {selected.recipient} — {selected.description}
                  </Text>
                </div>
              }
            >
              <div className="email-subject-row">
                <span className="email-subject-row__label">Subject</span>
                <Input
                  value={subject}
                  onChange={(e) => { setSubject(e.target.value); setDirty(true); }}
                  placeholder="Email subject line…"
                  maxLength={300}
                  showCount
                  variant="borderless"
                  className="email-subject-row__input"
                />
              </div>

              <EmailEditorTabs
                key={`${selectedKey}-${editorRev}`}
                bodyHtml={body}
                onBodyChange={(html) => { setBody(html); setDirty(true); }}
                subject={subject}
                wrapper={selected.wrapper}
                placeholders={selected.placeholders.map((p) => `{{${p.name}}}`)}
                toolbar={FULL_TOOLBAR}
                isDark={mode === 'dark'}
                onTabChange={setTab}
                htmlExtra={<Button size="small" icon={<CopyOutlined />} onClick={copyHtml}>Copy HTML</Button>}
                preview={
                  <EmailPreviewPane
                    subject={preview?.subject ?? subject}
                    html={preview?.body}
                    to={SAMPLE_TO[selected.category]}
                    loading={runPreview.isPending}
                  />
                }
              />

              <div className="email-placeholder-help">
                <Space size={6} wrap style={{ marginBottom: 6 }}>
                  <Text strong style={{ fontSize: 12.5 }}>Placeholders for this email</Text>
                  {selected.requiredAny.map((group) => (
                    <Tag key={group.join()} color="red" style={{ fontSize: 11 }}>
                      must contain {group.map((p) => `{{${p}}}`).join(' or ')}
                    </Tag>
                  ))}
                </Space>
                {selected.placeholders.map((p) => (
                  <div key={p.name} className="email-placeholder-help__row">
                    <Text code style={{ fontSize: 11.5 }}>{`{{${p.name}}}`}</Text>
                    {p.block && <Tag color="green" style={{ fontSize: 10.5, marginInlineEnd: 0 }}>block</Tag>}
                    <Text type="secondary" style={{ fontSize: 12 }}>{p.label}</Text>
                  </div>
                ))}
                <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 6 }}>
                  A <Tag color="green" style={{ fontSize: 10.5 }}>block</Tag> is built by PEA — a button with the live
                  link, or a table. Place it, move it or delete it like any other word.
                </Text>
              </div>
            </Card>
          ) : (
            <Card className="pea-card" style={{ minHeight: 400 }}>
              <Space direction="vertical" size={14} style={{ width: '100%', alignItems: 'center', paddingTop: 80 }}>
                <MailOutlined style={{ fontSize: 48, color: 'var(--pea-border-strong)' }} />
                <Title level={4} style={{ margin: 0 }}>No template selected</Title>
                <Text type="secondary">Select an email on the left to edit its subject and wording.</Text>
              </Space>
            </Card>
          )}
        </Col>
      </Row>
    </div>
  );
}
