import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Space, Button, Select, Switch, Alert, App, Popconfirm, Typography, Tooltip,
  Tabs, Empty, Modal,
} from 'antd';
import { LinkOutlined, CopyOutlined, StopOutlined, SendOutlined } from '@ant-design/icons';
import api, { unwrap } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';
import { formatDateTime, formatDate } from '../formatDate.js';

const fmt = (d) => formatDateTime(d);

/**
 * An employee's own link — their dates, and however much detail HR has chosen
 * to disclose in Settings → Access.
 */
function EmployeeLinkTab() {
  const { message } = App.useApp();
  const [employeeId, setEmployeeId] = useState();
  const [url, setUrl] = useState(null);

  const employees = useQuery({
    queryKey: ['employees', 'link-picker'],
    queryFn: () => api.get('/employees', { params: { limit: 500 } }).then((r) => r.data),
  });

  const level = useQuery({
    queryKey: ['self-view-level'],
    queryFn: () => api.get('/self-view-links/level').then(unwrap),
    retry: false,
  });

  const issue = useMutation({
    mutationFn: () => api.post('/self-view-links', { employee_id: employeeId }).then((r) => r.data),
    onSuccess: (res) => { setUrl(res.data.url); message.success(res.message); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const rows = employees.data?.data || [];
  const disclosure = level.data?.level;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {disclosure === 'off' ? (
        <Alert
          type="warning"
          showIcon
          message="Employee self-view is switched off"
          description={
            <>
              Links can still be created but will not open. Turn it on in{' '}
              <Link to="/settings">Settings → Access</Link> first.
            </>
          }
        />
      ) : (
        <Alert
          type="info"
          showIcon
          message={`Employees currently see: ${disclosure || '…'}`}
          description="What a link discloses is set once for everyone in Settings → Access, not per link."
        />
      )}

      <Space wrap align="end">
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Employee</div>
          <Select
            showSearch
            style={{ width: 320 }}
            placeholder="Choose an employee…"
            loading={employees.isLoading}
            value={employeeId}
            onChange={(v) => { setEmployeeId(v); setUrl(null); }}
            optionFilterProp="label"
            options={rows.map((e) => ({ value: e.id, label: `${e.full_name} · ${e.office_email}` }))}
          />
        </div>
        <Button
          type="primary"
          icon={<LinkOutlined />}
          disabled={!employeeId}
          loading={issue.isPending}
          onClick={() => issue.mutate()}
        >
          Create link
        </Button>
      </Space>

      {url && (
        <Alert
          type="success"
          showIcon
          message="Link created — it works without a login"
          description={
            <Typography.Text copyable={{ text: url }} style={{ wordBreak: 'break-all' }}>
              {url}
            </Typography.Text>
          }
        />
      )}
    </Space>
  );
}

/** The evaluation form link — the one HR could not get at all before. */
function EvaluationLinkTab() {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={
        <div style={{ maxWidth: 460, margin: '0 auto' }}>
          <p style={{ marginBottom: 8 }}>
            Evaluation form links are created automatically when an evaluation falls due.
          </p>
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            To copy or resend one, open <Link to="/evaluations?scope=waiting">Evaluations</Link> and
            use <strong>Copy link</strong> on the row. That way the link you share is the one the
            manager already has, rather than a new one that cancels it.
          </Typography.Text>
        </div>
      }
    />
  );
}

/**
 * Link generation — all three kinds of link PEA issues, in one place.
 *
 * They used to live in three: a manager's team link here, an employee's own
 * link on the Employee page, and an evaluation form link nowhere at all (HR
 * could only resend, which silently replaced the manager's existing link).
 *
 * Same trust model throughout: the link IS the credential, it expires, and it
 * can be revoked. Nobody who opens one needs a PEA login.
 */
export default function ManagerLinks() {
  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>Link generation</h2>
          <p>Create, copy or email a link. Nobody needs a login to open one.</p>
        </div>
      </div>

      <Tabs
        items={[
          { key: 'manager', label: "Manager's team", children: <ManagerTeamTab /> },
          { key: 'employee', label: "Employee's own view", children: <EmployeeLinkTab /> },
          { key: 'evaluation', label: 'Evaluation form', children: <EvaluationLinkTab /> },
        ]}
      />
    </>
  );
}

/** A reporting manager's "my team" link — the original screen, now a tab. */
function ManagerTeamTab() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [rmEmail, setRmEmail] = useState();
  const [send, setSend] = useState(false);
  const [lastUrl, setLastUrl] = useState(null);

  const managers = useQuery({
    queryKey: ['manager-list'],
    queryFn: () => api.get('/manager-links/managers').then(unwrap),
  });

  const links = useQuery({
    queryKey: ['manager-links'],
    queryFn: () => api.get('/manager-links').then(unwrap),
    retry: false,
  });

  const create = useMutation({
    mutationFn: () => api.post('/manager-links', { rm_email: rmEmail, send }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setLastUrl(res.data.url);
      qc.invalidateQueries({ queryKey: ['manager-links'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  /**
   * Email a team link to every manager who has someone in probation.
   *
   * This is the single-link endpoint in a loop — no new server work. The loop is
   * sequential on purpose: each call issues a link and sends mail, and firing
   * them all at once would hand the mail server a burst for no gain.
   *
   * Failures are counted rather than thrown, so one bad address cannot leave the
   * run half-done with no report of what got through.
   */
  const bulkEmail = useMutation({
    mutationFn: async (emails) => {
      let sent = 0;
      const failed = [];
      for (const email of emails) {
        try {
          await api.post('/manager-links', { rm_email: email, send: true });
          sent += 1;
        } catch {
          failed.push(email);
        }
      }
      return { sent, failed };
    },
    onSuccess: ({ sent, failed }) => {
      message.success(`Emailed ${sent} team link(s)`);
      // Each failure is named: a silent partial success would leave HR
      // believing every manager was nudged.
      failed.forEach((f) => message.warning(`${f}: link could not be sent`, 6));
      qc.invalidateQueries({ queryKey: ['manager-links'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  /** Managers with at least one person still in probation. */
  const pendingManagers = (managers.data || []).filter((m) => m.in_probation > 0);

  const confirmBulk = () => {
    Modal.confirm({
      title: 'Email team links to these managers?',
      width: 520,
      okText: `Email ${pendingManagers.length} manager(s)`,
      cancelText: 'Cancel',
      content: (
        <div>
          <p style={{ marginTop: 8 }}>
            This emails a team-portal link to every manager who has someone in probation:
          </p>
          <ul style={{ paddingLeft: 18, maxHeight: 180, overflow: 'auto' }}>
            {pendingManagers.map((m) => (
              <li key={m.rm_email}>
                {m.rm_name || m.rm_email} — {m.in_probation} in probation
              </li>
            ))}
          </ul>
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            Each manager's previous link stops working. Outside production these emails
            only ever reach the test inbox.
          </Typography.Text>
        </div>
      ),
      onOk: () => bulkEmail.mutateAsync(pendingManagers.map((m) => m.rm_email)),
    });
  };

  const revoke = useMutation({
    mutationFn: (id) => api.post(`/manager-links/${id}/revoke`),
    onSuccess: () => { message.success('Link revoked'); qc.invalidateQueries({ queryKey: ['manager-links'] }); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      message.success('Link copied');
    } catch {
      message.info(url);
    }
  };

  const setupMissing = links.error?.response?.status === 503;

  return (
    <>
      {setupMissing && (
        <Alert
          type="error"
          showIcon
          style={{ borderRadius: 'var(--pea-radius)', marginBottom: 12 }}
          message="Manager team links aren’t available yet"
          description="Ask your PEA admin to finish setting it up, then reload this page."
        />
      )}

      <Card className="pea-card" size="small" title={<span className="pea-section-title">Issue a link</span>}>
        <Space wrap align="center">
          <Select
            showSearch
            placeholder="Choose a reporting manager"
            style={{ width: 360, maxWidth: '100%' }}
            loading={managers.isLoading}
            value={rmEmail}
            onChange={setRmEmail}
            optionFilterProp="label"
            options={(managers.data || []).map((m) => ({
              value: m.rm_email,
              label: `${m.rm_name || m.rm_email} — ${m.team_size} report(s), ${m.in_probation} in probation`,
            }))}
          />
          <Space size={6}>
            <Switch checked={send} onChange={setSend} />
            <Typography.Text>Email it to them</Typography.Text>
          </Space>
          <Tooltip
            title={
              send
                ? "Creates the manager's personal link (valid 30 days by default, Settings → Access) and emails it to them using the Manager portal link template. Their previous link stops working. Outside production the email reaches only the test inbox."
                : "Creates the manager's personal link (valid 30 days by default, Settings → Access) for you to copy and share. No email is sent. Their previous link stops working."
            }
          >
            <Button
              type="primary"
              icon={send ? <SendOutlined /> : <LinkOutlined />}
              disabled={!rmEmail}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              {send ? 'Create and email' : 'Create link'}
            </Button>
          </Tooltip>
        </Space>

        {/* The bulk nudge: one button for every manager with someone in
            probation, rather than picking them off the list one at a time. */}
        {pendingManagers.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <Tooltip title="Issues a fresh team link for each manager who has someone in probation and emails it to them. Shows exactly who would be emailed before sending.">
              <Button
                icon={<SendOutlined />}
                loading={bulkEmail.isPending}
                onClick={confirmBulk}
              >
                Email team links to managers with pending evaluations ({pendingManagers.length})
              </Button>
            </Tooltip>
          </div>
        )}

        <Alert
          type="info"
          showIcon
          style={{ marginTop: 14 }}
          message="Creating a new link revokes that manager's previous one"
          description="Outside production, 'Email it to them' only ever reaches the test inbox — never the real manager."
        />

        {lastUrl && (
          <Alert
            type="success"
            showIcon
            style={{ marginTop: 12 }}
            message="Link ready"
            description={<Typography.Text copyable={{ text: lastUrl }} style={{ wordBreak: 'break-all' }}>{lastUrl}</Typography.Text>}
          />
        )}
      </Card>

      <Card className="pea-card" size="small" title={<span className="pea-section-title">Issued links</span>}>
        <Table
          size="small"
          rowKey="id"
          loading={links.isLoading}
          dataSource={links.data || []}
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          scroll={{ x: 800 }}
          locale={{ emptyText: 'No links issued yet' }}
          columns={[
            {
              title: 'Manager',
              dataIndex: 'rm_name',
              render: (v, r) => (
                <div>
                  <div>{v || '—'}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.rm_email}</Typography.Text>
                </div>
              ),
            },
            {
              title: 'State',
              dataIndex: 'state',
              width: 100,
              // Expired is a spent link, not a fault — mute. Revoked is crit,
              // because someone took it away on purpose.
              render: (v) => (
                <StatusPill tone={v === 'active' ? 'ok' : v === 'expired' ? 'mute' : 'crit'}>
                  {v}
                </StatusPill>
              ),
            },
            { title: 'Expires', dataIndex: 'expires_at', width: 180, className: 'pea-num', render: fmt },
            { title: 'Last opened', dataIndex: 'last_used_at', width: 180, className: 'pea-num', render: fmt },
            { title: 'Opens', dataIndex: 'use_count', width: 70, className: 'pea-num' },
            { title: 'Issued by', dataIndex: 'created_by', width: 120 },
            {
              title: '',
              width: 110,
              render: (_, r) =>
                r.state === 'active' ? (
                  <Space size={4}>
                    <Tooltip title="Copy link: copies this manager's personal link to the clipboard so you can share it.">
                      <Button size="small" icon={<CopyOutlined />} onClick={() => copy(r.url)} />
                    </Tooltip>
                    <Popconfirm title="Revoke this link?" description="It stops working immediately." onConfirm={() => revoke.mutate(r.id)}>
                      {/* Below the button: the confirmation opens above it, and a tooltip
                          on top of it would sit over the OK button and swallow the click. */}
                      <Tooltip placement="bottom" title="Revoke link: asks to confirm, then cancels this link so it stops working immediately. Create a new link to give the manager access again.">
                        <Button size="small" danger icon={<StopOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  </Space>
                ) : null,
            },
          ]}
        />
      </Card>
    </>
  );
}
