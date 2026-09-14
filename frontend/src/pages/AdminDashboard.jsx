/**
 * AdminDashboard — the PEA Admin Portal, ported from the ATS HR Admin page and
 * trimmed to PEA's two tabs:
 *
 *   1) User Management — stats, search and filters, add / edit / activate /
 *      delete, following the Super Admin > Admin > HR ladder
 *   2) Module Access — which sidebar modules each HR user can open, saved the
 *      moment a switch is flipped
 *
 * Every rule shown here is enforced again by the API (users.service.js,
 * modulePermissions.service.js); this page only avoids offering what would be
 * refused.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Row, Col, Card, Table, Button, Input, Select, Modal, Form, Switch, Tag, Space, Typography, Tooltip, App, Alert,
  Empty, Spin,
} from 'antd';
import {
  UserOutlined, SettingOutlined, SearchOutlined, PlusOutlined, EditOutlined, DeleteOutlined, CheckCircleOutlined,
  CloseCircleOutlined, PoweroffOutlined, ReloadOutlined, SafetyOutlined, TeamOutlined, SolutionOutlined,
  FileExcelOutlined, CrownOutlined,
} from '@ant-design/icons';
import api, { unwrap } from '../api.js';
import RoleBadge from '../components/RoleBadge.jsx';
import { MODULES, ROLE_LABEL, initialsOf, isAdminTier, isSuperadmin, outranks } from '../auth.js';

const { Title, Text } = Typography;

const MIN_PASSWORD = 10;

const fullName = (u) => [u?.first_name, u?.last_name].filter(Boolean).join(' ') || u?.username || '';

/** A random password that passes PEA's rules. crypto, not Math.random. */
function generatePassword(length = 14) {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*_-+';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/** Every account, not the filtered view — the same scope the ATS export uses. */
function exportCsv(rows) {
  const cols = [
    ['First name', (r) => r.first_name],
    ['Last name', (r) => r.last_name],
    ['Username', (r) => r.username],
    ['Email', (r) => r.email],
    ['Role', (r) => ROLE_LABEL[r.role] || r.role],
    ['Status', (r) => (r.is_active ? 'Active' : 'Inactive')],
    ['Created', (r) => r.created_at?.slice(0, 10)],
    ['Last sign-in', (r) => (r.last_login_at ? new Date(r.last_login_at).toISOString() : '')],
  ];
  // Quote every cell, and defuse anything a spreadsheet would run as a formula.
  const cell = (v) => {
    const s = String(v ?? '');
    return `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
  };
  const csv = [cols.map(([h]) => cell(h)).join(','), ...rows.map((r) => cols.map(([, f]) => cell(f(r))).join(','))];
  const url = URL.createObjectURL(new Blob([`﻿${csv.join('\r\n')}`], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: 'AAPNA-PEA_Admin-Users.csv' });
  a.click();
  URL.revokeObjectURL(url);
}

function AdminStat({ label, value, foot, icon, tone, toneSoft, numColor }) {
  return (
    <div className="admin-stat" style={{ '--tone': tone, '--tone-soft': toneSoft, '--tone-num': numColor }}>
      <div className="admin-stat-body">
        <div>
          <div className="admin-stat-label">{label}</div>
          <div className="admin-stat-num">{value}</div>
          <div className="admin-stat-foot">{foot}</div>
        </div>
        <div className="admin-stat-icon">{icon}</div>
      </div>
    </div>
  );
}

const StatusPill = ({ active }) => (
  <span className={`pea-status pea-status--${active ? 'on' : 'off'}`}>
    <i />
    {active ? 'Active' : 'Inactive'}
  </span>
);

export default function AdminDashboard({ me }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const superMe = isSuperadmin(me.role);

  const [activeTab, setActiveTab] = useState('users');

  // User Management
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [generated, setGenerated] = useState(null);
  const [toToggle, setToToggle] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const [form] = Form.useForm();

  // Module Access
  const [modUserId, setModUserId] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const [savedAt, setSavedAt] = useState(0);

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users').then(unwrap) });
  const all = useMemo(() => users.data || [], [users.data]);
  const refreshUsers = () => qc.invalidateQueries({ queryKey: ['users'] });

  const hrUsers = useMemo(() => all.filter((u) => !isAdminTier(u.role)), [all]);
  const modUser = hrUsers.find((u) => u.id === modUserId) || hrUsers[0] || null;

  const access = useQuery({
    queryKey: ['module-access', modUser?.id],
    queryFn: () => api.get(`/users/${modUser.id}/modules`).then(unwrap),
    enabled: activeTab === 'modules' && Boolean(modUser),
  });

  // "✓ Auto-saved" shows for three seconds after each switch, restarting on every save.
  useEffect(() => {
    if (!savedAt) return undefined;
    const t = setTimeout(() => setSavedAt(0), 3000);
    return () => clearTimeout(t);
  }, [savedAt]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter(
      (u) =>
        (!q || `${u.first_name || ''} ${u.last_name || ''} ${u.email} ${u.username}`.toLowerCase().includes(q)) &&
        (!roleFilter || u.role === roleFilter) &&
        (!statusFilter || (statusFilter === 'active') === u.is_active)
    );
  }, [all, search, roleFilter, statusFilter]);

  const stats = useMemo(
    () => ({
      total: all.length,
      active: all.filter((u) => u.is_active).length,
      inactive: all.filter((u) => !u.is_active).length,
      supers: all.filter((u) => isSuperadmin(u.role)).length,
      admins: all.filter((u) => u.role === 'admin').length,
    }),
    [all]
  );

  /** What the signed-in admin may do to one account — mirrors users.service.refuseChange. */
  const rights = (r) => {
    const self = r.id === me.id;
    const peerSuper = !self && superMe && isSuperadmin(r.role);
    const below = outranks(me.role, r.role);
    return {
      self,
      peerSuper,
      canEdit: self || below || peerSuper,
      canToggle: !self && (below || peerSuper),
      canChangeRole: !self && (below || peerSuper),
      canSetPassword: !self && below,
      canDelete: superMe && !self,
    };
  };

  const roleOptions = [
    ...(superMe ? [{ value: 'superadmin', label: 'Super Admin' }] : []),
    { value: 'admin', label: 'Admin' },
    { value: 'hr', label: 'HR' },
  ];

  const onFail = (err) => {
    message.error(err.friendlyMessage);
  };

  const save = useMutation({
    mutationFn: ({ id, payload }) => (id ? api.patch(`/users/${id}`, payload) : api.post('/users', payload)).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setModalOpen(false);
      refreshUsers();
    },
    onError: (err) => {
      const msg = err.friendlyMessage;
      if (err.response?.status === 409) {
        form.setFields([{ name: /username/i.test(msg) ? 'username' : 'email', errors: [msg] }]);
      } else if (err.response?.status === 400 && /password/i.test(msg)) {
        form.setFields([{ name: 'password', errors: [msg] }]);
      } else {
        message.error(msg);
      }
    },
  });

  const toggle = useMutation({
    mutationFn: (u) => api.patch(`/users/${u.id}`, { is_active: !u.is_active }).then((r) => r.data),
    onSuccess: (_res, u) => {
      message.success(`${fullName(u)} ${u.is_active ? 'deactivated and signed out' : 'activated'}`);
      setToToggle(null);
      refreshUsers();
    },
    onError: onFail,
  });

  const remove = useMutation({
    mutationFn: (u) => api.delete(`/users/${u.id}`).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setToDelete(null);
      refreshUsers();
    },
    onError: onFail,
  });

  const setModule = useMutation({
    mutationFn: ({ userId, key, enabled }) => api.put(`/users/${userId}/modules/${key}`, { is_enabled: enabled }).then(unwrap),
    onMutate: ({ key }) => {
      setSavingKey(key);
    },
    onSuccess: (data) => {
      qc.setQueryData(['module-access', data.user_id], data);
      setSavedAt(Date.now());
    },
    onError: onFail,
    onSettled: () => {
      setSavingKey(null);
    },
  });

  const openModal = (record = null) => {
    setEditing(record);
    setGenerated(null);
    form.resetFields();
    if (record) {
      form.setFieldsValue({
        first_name: record.first_name,
        last_name: record.last_name,
        email: record.email,
        username: record.username,
        role: record.role,
        is_active: record.is_active ? '1' : '0',
      });
    }
    setModalOpen(true);
  };

  const autoGenerate = () => {
    const pw = generatePassword();
    form.setFieldsValue({ password: pw, confirmPassword: pw });
    setGenerated(pw);
    message.info('Password auto-generated');
  };

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('Copied to clipboard');
    } catch {
      message.error('Could not copy — select the password and copy it instead');
    }
  };

  const submit = (v) => {
    const payload = {
      first_name: v.first_name.trim(),
      last_name: v.last_name.trim(),
      // Blank means "use the email address", on create and edit alike.
      username: (v.username || '').trim(),
      role: v.role,
    };

    if (!editing) {
      save.mutate({ payload: { ...payload, email: v.email.trim(), password: v.password } });
      return;
    }

    const r = rights(editing);
    if (r.canToggle) payload.is_active = v.is_active === '1';
    if (r.canSetPassword && v.password) payload.password = v.password;
    save.mutate({ id: editing.id, payload });
  };

  const editRights = editing ? rights(editing) : null;

  const passwordFields = (required) => (
    <>
      <Row gutter={14}>
        <Col xs={24} sm={12}>
          <Form.Item
            label={required ? 'Password' : 'New Password'}
            name="password"
            rules={[
              ...(required ? [{ required: true, message: 'Password is required' }] : []),
              { min: MIN_PASSWORD, message: `At least ${MIN_PASSWORD} characters` },
            ]}
          >
            <Input.Password placeholder={required ? `Min ${MIN_PASSWORD} characters` : 'Leave blank to keep current'} autoComplete="new-password" />
          </Form.Item>
        </Col>
        <Col xs={24} sm={12}>
          <Form.Item
            label={required ? 'Confirm Password' : 'Confirm New Password'}
            name="confirmPassword"
            dependencies={['password']}
            required={required}
            rules={[
              ({ getFieldValue }) => ({
                validator: (_, value) => {
                  const pw = getFieldValue('password');
                  if (!pw && !value) return required ? Promise.reject(new Error('Please confirm the password')) : Promise.resolve();
                  return value === pw ? Promise.resolve() : Promise.reject(new Error('Passwords do not match'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="Re-enter" autoComplete="new-password" />
          </Form.Item>
        </Col>
      </Row>
      <div className="pea-gen-row">
        <Button icon={<SafetyOutlined />} onClick={autoGenerate}>
          Auto-Generate Password
        </Button>
        <span className="pea-gen-hint">Generates a secure random password</span>
      </div>
      {generated && (
        <div className="pea-cred-box">
          <span className="pea-cred-label">{required ? 'Password' : 'Generated Password'}</span>
          <span className="pea-cred-value">{generated}</span>
          <Button type="link" size="small" onClick={() => copy(generated)}>
            Copy
          </Button>
        </div>
      )}
      <div className="pea-gen-hint">Share it with them directly — PEA does not email passwords.</div>
    </>
  );

  const columns = [
    {
      title: 'User',
      key: 'user',
      render: (_, r) => (
        <div className="pea-user-cell">
          <span className="pea-admin-avatar">{initialsOf(r)}</span>
          <div style={{ minWidth: 0 }}>
            <div className="pea-user-cell-name">
              {fullName(r)}
              {r.id === me.id && <Tag style={{ marginInlineStart: 6 }}>you</Tag>}
            </div>
            <div className="pea-user-cell-email">{r.email}</div>
          </div>
        </div>
      ),
    },
    { title: 'Username', dataIndex: 'username', render: (v) => <span className="pea-mono">{v}</span> },
    { title: 'Role', dataIndex: 'role', render: (v) => <RoleBadge role={v} /> },
    { title: 'Status', dataIndex: 'is_active', render: (v) => <StatusPill active={v} /> },
    {
      title: 'Created',
      dataIndex: 'created_at',
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v ? v.slice(0, 10) : '—'}</Text>,
    },
    {
      title: 'Last sign-in',
      dataIndex: 'last_login_at',
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v ? new Date(v).toLocaleString() : 'never'}</Text>,
    },
    {
      title: 'Actions',
      key: 'actions',
      align: 'right',
      render: (_, r) => {
        // Only a super admin sees what can be done to a super admin, as in ATS.
        if (isSuperadmin(r.role) && !superMe) return <Text type="secondary">—</Text>;
        const x = rights(r);
        return (
          <Space size={2}>
            <Tooltip title={x.canEdit ? 'Edit' : 'You can only edit your own account and accounts below your role'}>
              <span>
                <Button type="text" size="small" className="pea-act pea-act--edit" disabled={!x.canEdit} icon={<EditOutlined />} onClick={() => openModal(r)} />
              </span>
            </Tooltip>
            <Tooltip
              title={
                x.self
                  ? 'You cannot deactivate your own account'
                  : !x.canToggle
                    ? 'You can only change the status of accounts below your role'
                    : r.is_active
                      ? 'Deactivate'
                      : 'Activate'
              }
            >
              <span>
                <Button type="text" size="small" className="pea-act pea-act--power" disabled={!x.canToggle} icon={<PoweroffOutlined />} onClick={() => setToToggle(r)} />
              </span>
            </Tooltip>
            <Tooltip title={!superMe ? 'Only a Super Admin can delete users' : x.self ? 'You cannot delete your own account' : 'Delete'}>
              <span>
                <Button type="text" size="small" className="pea-act pea-act--delete" disabled={!x.canDelete} icon={<DeleteOutlined />} onClick={() => setToDelete(r)} />
              </span>
            </Tooltip>
          </Space>
        );
      },
    },
  ];

  if (users.error?.response?.status === 403) {
    return (
      <div className="pea-admin">
        <Alert type="warning" showIcon message="Only an Admin or Super Admin can open the Admin Portal" />
      </div>
    );
  }

  return (
    <div className="pea-admin">
      {/* Capsule tab bar */}
      <div className="admin-tabbar">
        <div className="admin-tabs">
          <Button
            type="text"
            className={`admin-tab${activeTab === 'users' ? ' admin-tab--active' : ''}`}
            icon={<UserOutlined />}
            onClick={() => setActiveTab('users')}
          >
            User Management
          </Button>
          <Button
            type="text"
            className={`admin-tab${activeTab === 'modules' ? ' admin-tab--active' : ''}`}
            icon={<SettingOutlined />}
            onClick={() => setActiveTab('modules')}
          >
            Module Access
          </Button>
        </div>
        <Tooltip title="Refresh">
          <Button
            type="text"
            className="pea-icon-btn"
            aria-label="Refresh"
            icon={<ReloadOutlined spin={users.isFetching || access.isFetching} />}
            onClick={() => {
              users.refetch();
              if (activeTab === 'modules' && modUser) access.refetch();
            }}
          />
        </Tooltip>
      </div>

      {/* ── Tab 1: User Management ─────────────────────────────────────── */}
      {activeTab === 'users' && (
        <>
          <div className="admin-stats">
            <AdminStat
              label="Total Users"
              value={stats.total}
              foot="All registered accounts"
              icon={<TeamOutlined />}
              tone="var(--pea-green-600)"
              toneSoft="var(--pea-green-100)"
            />
            <AdminStat
              label="Active"
              value={stats.active}
              foot="Can sign in"
              icon={<CheckCircleOutlined />}
              tone="var(--pea-emerald)"
              toneSoft="var(--pea-emerald-soft)"
              numColor="var(--pea-emerald)"
            />
            <AdminStat
              label="Inactive"
              value={stats.inactive}
              foot="Access revoked"
              icon={<CloseCircleOutlined />}
              tone="var(--pea-red)"
              toneSoft="var(--pea-red-soft)"
              numColor="var(--pea-red)"
            />
            <AdminStat
              label="Admins"
              value={stats.supers + stats.admins}
              foot={`${stats.supers} Super Admin · ${stats.admins} Admin`}
              icon={<CrownOutlined />}
              tone="var(--pea-blue)"
              toneSoft="var(--pea-blue-soft)"
              numColor="var(--pea-blue)"
            />
          </div>

          <Card className="pea-admin-card" styles={{ body: { padding: 0 } }}>
            <div className="pea-admin-toolbar">
              <Space wrap size={12}>
                <span className="pea-admin-toolbar-title">User Management</span>
                <Input
                  allowClear
                  prefix={<SearchOutlined style={{ color: 'var(--pea-text-faint)' }} />}
                  placeholder="Search name / email…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ width: 220 }}
                />
                <Select
                  value={roleFilter}
                  onChange={setRoleFilter}
                  style={{ width: 140 }}
                  options={[
                    { value: '', label: 'All Roles' },
                    { value: 'superadmin', label: 'Super Admin' },
                    { value: 'admin', label: 'Admin' },
                    { value: 'hr', label: 'HR' },
                  ]}
                />
                <Select
                  value={statusFilter}
                  onChange={setStatusFilter}
                  style={{ width: 130 }}
                  options={[
                    { value: '', label: 'All Status' },
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                  ]}
                />
              </Space>
              <Space size={8} wrap>
                <Button icon={<FileExcelOutlined />} disabled={!all.length} onClick={() => exportCsv(all)}>
                  Export CSV
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => openModal()}>
                  Add User
                </Button>
              </Space>
            </div>

            <Table
              rowKey="id"
              loading={users.isLoading}
              dataSource={filtered}
              columns={columns}
              scroll={{ x: 980 }}
              pagination={{ pageSize: 10, showSizeChanger: false }}
            />
          </Card>
        </>
      )}

      {/* ── Tab 2: Module Access ───────────────────────────────────────── */}
      {activeTab === 'modules' && (
        <Row gutter={[20, 20]}>
          <Col xs={24} md={8}>
            <Card className="pea-admin-card" title={<span className="pea-select-title">Select User</span>} styles={{ body: { padding: 0 } }}>
              {hrUsers.length === 0 ? (
                <Empty style={{ padding: 32 }} description={users.isLoading ? 'Loading…' : 'No HR users yet — add one in User Management'} />
              ) : (
                <div className="pea-mod-users">
                  {hrUsers.map((u) => (
                    <button
                      type="button"
                      key={u.id}
                      className={`pea-mod-user${modUser?.id === u.id ? ' pea-mod-user--selected' : ''}`}
                      onClick={() => setModUserId(u.id)}
                    >
                      <span className="pea-admin-avatar">{initialsOf(u)}</span>
                      <span className="pea-mod-user-text">
                        <span className="pea-mod-user-name">{fullName(u)}</span>
                        <span className="pea-mod-user-role">
                          {ROLE_LABEL[u.role] || u.role}
                          {!u.is_active && ' · inactive'}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </Col>

          <Col xs={24} md={16}>
            <Card
              className="pea-admin-card"
              title={
                <div className="pea-mod-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="pea-mod-head-name">{modUser ? fullName(modUser) : 'Select a user'}</div>
                    <div className="pea-mod-head-sub">
                      {modUser ? `Configure module access for ${modUser.email}` : 'Choose a user from the left to manage their module access'}
                    </div>
                  </div>
                  {savedAt > 0 && <span className="pea-autosaved">✓ Auto-saved</span>}
                </div>
              }
            >
              {!modUser ? (
                <div className="pea-mod-empty">
                  <SolutionOutlined style={{ fontSize: 48, opacity: 0.3, marginBottom: 14 }} />
                  <Title level={4} style={{ fontSize: 14, margin: '0 0 5px' }}>No user selected</Title>
                  <Text type="secondary">Module access applies to HR users. Admins and Super Admins can open every module.</Text>
                </div>
              ) : access.isLoading ? (
                <Spin style={{ display: 'block', margin: '48px auto' }} />
              ) : access.error ? (
                <Alert type="error" showIcon message="Could not load module access" description={access.error.friendlyMessage} />
              ) : (
                <div className="pea-mod-list">
                  {access.data && !access.data.available && (
                    <Alert
                      type="warning"
                      showIcon
                      message="Module access is read-only until the database update is applied"
                      description="Apply prisma/ddl/2026-09-13b-pea-admin-portal.sql. Until then every HR user can open every module."
                    />
                  )}

                  {MODULES.map((m) => {
                    const enabled = Boolean(access.data?.modules.find((x) => x.key === m.key)?.is_enabled);
                    return (
                      <div key={m.key} className={`pea-module-row${enabled ? ' pea-module-row--on' : ''}`}>
                        <div className="pea-module-main">
                          <div className="pea-module-icon">{m.emoji}</div>
                          <div style={{ minWidth: 0 }}>
                            <div className="pea-module-label">{m.label}</div>
                            <div className="pea-module-desc">{m.desc}</div>
                            <span className={`pea-module-state pea-module-state--${enabled ? 'on' : 'off'}`}>
                              ● {enabled ? 'Enabled' : 'Restricted'}
                            </span>
                          </div>
                        </div>
                        <Switch
                          checked={enabled}
                          loading={savingKey === m.key}
                          disabled={!access.data?.available || (savingKey !== null && savingKey !== m.key)}
                          onChange={(checked) => setModule.mutate({ userId: modUser.id, key: m.key, enabled: checked })}
                        />
                      </div>
                    );
                  })}

                  {/* The ATS portal gates itself with an `hr_admin` switch. In PEA the
                      role decides, so this row explains that instead of pretending
                      to be a toggle. */}
                  <div className="pea-module-row pea-module-row--static">
                    <div className="pea-module-main">
                      <div className="pea-module-icon">🛡️</div>
                      <div style={{ minWidth: 0 }}>
                        <div className="pea-module-label">Admin Portal Access</div>
                        <div className="pea-module-desc">Granted by role, not by a switch — make this person an Admin in User Management</div>
                        <span className="pea-module-state pea-module-state--role">● Admins &amp; Super Admins only</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </Col>
        </Row>
      )}

      {/* CREATE / EDIT USER */}
      <Modal
        forceRender
        open={modalOpen}
        title={<span className="pea-modal-title">{editing ? 'Edit User Details' : 'Add New User'}</span>}
        onOk={() => form.submit()}
        onCancel={() => setModalOpen(false)}
        okText={editing ? 'Save Changes' : 'Create User'}
        confirmLoading={save.isPending}
        width={540}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} onFinish={submit}>
          <div className="pea-admin-section">Personal Information</div>
          <Row gutter={14}>
            <Col xs={24} sm={12}>
              <Form.Item label="First Name" name="first_name" rules={[{ required: true, whitespace: true, message: 'First name is required' }]}>
                <Input placeholder="e.g. Priya" />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12}>
              <Form.Item label="Last Name" name="last_name" rules={[{ required: true, whitespace: true, message: 'Last name is required' }]}>
                <Input placeholder="e.g. Sharma" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item
            label="Email Address"
            name="email"
            rules={[
              { required: true, message: 'Email address is required' },
              { type: 'email', message: 'Enter a valid email address' },
            ]}
          >
            <Input placeholder="priya.sharma@aapnainfotech.com" disabled={Boolean(editing)} autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="Username (Optional)"
            name="username"
            rules={[{ pattern: /^[a-zA-Z0-9._@-]{3,100}$/, message: '3–100 characters: letters, digits, dot, dash, underscore or @' }]}
            extra="Defaults to the email address. Users can sign in with either their username or email."
          >
            <Input placeholder="Leave blank to use the email address" autoComplete="off" />
          </Form.Item>

          <hr className="pea-admin-rule" />

          <div className="pea-admin-section">Account Settings</div>
          <Form.Item
            label="Role"
            name="role"
            rules={[{ required: true, message: 'Please select a role' }]}
            extra={editRights?.self ? 'You cannot change your own role.' : undefined}
          >
            <Select placeholder="— Select role —" options={roleOptions} disabled={Boolean(editing) && !editRights.canChangeRole} />
          </Form.Item>

          {!editing ? (
            <>
              <hr className="pea-admin-rule" />
              <div className="pea-admin-section">Set Password</div>
              {passwordFields(true)}
            </>
          ) : (
            <>
              <Form.Item
                label="Account Status"
                name="is_active"
                extra={editRights.self ? 'You cannot change the status of your own account.' : undefined}
              >
                <Select
                  disabled={!editRights.canToggle}
                  options={[
                    { value: '1', label: 'Active' },
                    { value: '0', label: 'Inactive' },
                  ]}
                />
              </Form.Item>
              <hr className="pea-admin-rule" />
              {editRights.canSetPassword ? (
                <>
                  <div className="pea-admin-section">Change Password (Optional)</div>
                  {passwordFields(false)}
                </>
              ) : (
                <Text type="secondary" className="pea-lock-note">
                  🔒{' '}
                  {editRights.self
                    ? 'Change your own password from the menu under your name.'
                    : "A Super Admin's password can only be changed by the account owner."}
                </Text>
              )}
            </>
          )}
        </Form>
      </Modal>

      {/* ACTIVATE / DEACTIVATE — deactivation reads as a warning, activation stays positive */}
      <Modal
        open={Boolean(toToggle)}
        title={
          <div className="pea-confirm-title">
            <span>{toToggle?.is_active ? '⚠️' : '✅'}</span>
            {toToggle?.is_active ? 'Deactivate User?' : 'Activate User?'}
          </div>
        }
        onOk={() => toggle.mutate(toToggle)}
        onCancel={() => setToToggle(null)}
        okText={toToggle?.is_active ? 'Deactivate' : 'Activate'}
        okButtonProps={{ danger: Boolean(toToggle?.is_active) }}
        confirmLoading={toggle.isPending}
        width={420}
      >
        {toToggle?.is_active ? (
          <div className="pea-warn-box">
            <strong>
              {fullName(toToggle)} ({toToggle.email})
            </strong>
            They are signed out immediately and cannot sign in until reactivated. Their history is kept.
          </div>
        ) : (
          <Text>&quot;{fullName(toToggle)}&quot; will be able to sign in again.</Text>
        )}
      </Modal>

      {/* DELETE */}
      <Modal
        open={Boolean(toDelete)}
        title={
          <div className="pea-confirm-title">
            <span>🗑️</span>Delete User?
          </div>
        }
        onOk={() => remove.mutate(toDelete)}
        onCancel={() => setToDelete(null)}
        okText="Delete Permanently"
        okButtonProps={{ danger: true }}
        confirmLoading={remove.isPending}
        width={420}
      >
        <Text>
          Delete &quot;{fullName(toDelete)}&quot; ({toDelete?.email})? This is permanent — their module access and
          notifications go too. Deactivate instead if they may come back.
        </Text>
      </Modal>
    </div>
  );
}
