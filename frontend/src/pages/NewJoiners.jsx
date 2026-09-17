import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Space, Button, Modal, Form, Input, DatePicker, Radio, Alert,
  App, Tooltip, Typography, Empty, Popconfirm,
} from 'antd';
import {
  SyncOutlined, EyeOutlined, UserAddOutlined, CloseOutlined, CheckOutlined,
  LogoutOutlined, ClusterOutlined, InfoCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { unwrap } from '../api.js';
import HintIcon from '../components/HintIcon.jsx';
import StatusPill from '../components/StatusPill.jsx';

const fmt = (d) => (d ? String(d).slice(0, 10) : '—');

/**
 * A value Entra supplied but nobody has checked. The label matters: measured
 * coverage says the manager is right 88% of the time when set and the account
 * date is within ±3 days only 70% of the time, so presenting either as fact
 * would be a lie of omission.
 */
function Suggested({ value, source, hint }) {
  if (!value) {
    // A required field with nothing in it. This is the flag that BLOCKS
    // confirming, so it is stated rather than left as a quiet dash.
    return <StatusPill tone="crit">Missing</StatusPill>;
  }
  return (
    <Space size={6}>
      <span>{value}</span>
      {source && (
        <Tooltip title={hint}>
          {/* "Check" rather than "unverified": Microsoft 365 filled this and is
              often wrong, so it wants a glance — but it does not stop HR
              confirming the row. */}
          <StatusPill tone="warn">Check</StatusPill>
        </Tooltip>
      )}
    </Space>
  );
}

/**
 * What a row needs before it can be confirmed, in plain words.
 *
 * The two flags mean different things and the distinction is the point:
 *
 *   · Missing — a required field is blank. Confirming is blocked.
 *   · Check   — Microsoft 365 supplied a value that is often wrong. Worth a
 *               look, but it does not block anything.
 *
 * A row with neither can be confirmed straight from the table.
 */
function toFix(r) {
  const missing = [];
  if (!r.suggested_doj) missing.push('date of joining');
  if (!r.suggested_rm_email) missing.push('reporting manager');
  if (!r.suggested_pl_email) missing.push('project leader');

  const check = [];
  if (r.suggested_doj && r.doj_source) check.push('date of joining');
  if (r.suggested_rm_email && r.rm_source) check.push('manager');

  return { missing, check, blocked: missing.length > 0 };
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

  // R-03 — the same problems the nightly email reports, shown the moment HR
  // opens the page. An email can be missed; the screen they already use cannot.
  const { data: sync } = useQuery({
    queryKey: ['sync-problems'],
    queryFn: () => api.get('/intake/sync-problems').then(unwrap),
    // A reporting view must never break the page it reports on.
    retry: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['intake-inbox'] });
    qc.invalidateQueries({ queryKey: ['sync-problems'] });
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

  /**
   * Add someone the Microsoft 365 check never found — the other half of the
   * missed-sync remedy. The sheet upload handles a batch at go-live; this is
   * for the single person the scan could not use.
   */
  const addByHand = useMutation({
    mutationFn: (values) => api.post('/employees', values).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setAccepting(null);
      form.resetFields();
      refresh();
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const openAddByHand = () => {
    form.resetFields();
    setAccepting({ byHand: true });
  };

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
          <Tooltip title="Rebuilds the RM → PL lookup from the current employee list. A manager who has always had the same PL gets that PL prefilled for new joiners; a manager with more than one PL is marked ambiguous and shows 'needs HR' instead. Entries set by hand are kept. Employees are not changed; no email is sent.">
            <Button icon={<ClusterOutlined />} onClick={() => seedMap.mutate()} loading={seedMap.isPending}>
              Rebuild RM→PL map
            </Button>
          </Tooltip>
          <Tooltip title="Runs the Entra scan as a test and reports what a real scan would find: new joiners, refreshed suggestions, possible leavers, and names/emails to sync. Only a log entry is written; no email is sent.">
            <Button icon={<EyeOutlined />} onClick={() => scan.mutate(true)} loading={scan.isPending}>
              Dry run
            </Button>
          </Tooltip>
          <Tooltip title="Runs the real Entra scan now (the nightly scan does the same if switched on in Settings → New joiners). Fills the inbox and records account status on employees. No email is sent; a bell notification is raised if something new is found.">
            <Button icon={<SyncOutlined />} onClick={() => scan.mutate(false)} loading={scan.isPending}>
              Scan now
            </Button>
          </Tooltip>
          <Tooltip title="Add someone the Microsoft 365 check could not pick up — no manager in the directory, a different email domain, or an account created before they joined.">
            <Button type="primary" icon={<UserAddOutlined />} onClick={openAddByHand}>
              Add by hand
            </Button>
          </Tooltip>
        </Space>
      </div>

      {/* R-03 — what the nightly alert would say, said here too. Subhajit,
          15-Sep (16:14): "if any data is not being synced properly from the AD,
          we should be getting an email alert so that we can take it up
          manually." The remedy is the sheet upload, so it is linked from here. */}
      {sync?.rows?.length > 0 && (
        <Alert
          type={sync.rows.some((p) => p.severity === 'critical') ? 'error' : 'warning'}
          showIcon
          style={{ borderRadius: 'var(--pea-radius)', marginBottom: 12 }}
          message={
            sync.rows.length === 1
              ? 'The Microsoft 365 check found something that needs your attention'
              : `The Microsoft 365 check found ${sync.rows.length} things that need your attention`
          }
          description={
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {sync.rows.map((p) => (
                  <li key={p.key}>
                    <strong>{p.title}</strong>
                    {p.subject && p.subject !== '—' ? ` — ${p.subject}. ` : '. '}
                    <span style={{ color: 'var(--pea-text-muted)' }}>{p.detail}</span>
                  </li>
                ))}
              </ul>
              {sync.rows.some((p) => p.fixable) && (
                <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
                  Add the missing details by hand below, or{' '}
                  <Link to="/import">upload the sheet</Link> with them. Everything else
                  carries on as normal.
                </Typography.Text>
              )}
            </Space>
          }
        />
      )}

      {data?.setupRequired && (
        <Alert
          type="error"
          showIcon
          style={{ borderRadius: 'var(--pea-radius)' }}
          message="New joiners isn’t available yet"
          description="Ask your PEA admin to finish setting it up, then reload this page."
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
        title={
          <span className="pea-section-title">
            Detected in Entra
            <HintIcon title="New Microsoft accounts waiting for HR to confirm (count at the top right). Turn a new account into a scheduled employee in two questions instead of typing eight columns." />
          </span>
        }
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
                    <StatusPill tone="crit">Missing</StatusPill>
                  </Tooltip>
                ),
            },
            {
              // Says in plain words what each row needs, so HR can see at a
              // glance which rows are ready and which want typing.
              title: 'To fix',
              width: 220,
              render: (_, r) => {
                const { missing, check } = toFix(r);
                if (missing.length === 0 && check.length === 0) {
                  return <Typography.Text type="secondary" style={{ fontSize: 12 }}>Nothing — ready to confirm</Typography.Text>;
                }
                return (
                  <Space direction="vertical" size={2}>
                    {missing.length > 0 && (
                      <Typography.Text style={{ fontSize: 12 }}>
                        Add the {missing.join(', ')}
                      </Typography.Text>
                    )}
                    {check.length > 0 && (
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        Check the {check.join(' and ')}
                      </Typography.Text>
                    )}
                  </Space>
                );
              },
            },
            {
              title: '',
              width: 190,
              render: (_, r) => (
                <Space size={6}>
                  <Tooltip
                    title={
                      toFix(r).blocked
                        ? 'Open the form to fill in what is missing, then confirm.'
                        : 'Everything needed is here — confirm this joiner.'
                    }
                  >
                    <Button size="small" type="primary" icon={<UserAddOutlined />} onClick={() => openAccept(r)}>
                      {toFix(r).blocked ? 'Review' : 'Confirm'}
                    </Button>
                  </Tooltip>
                  <Popconfirm
                    title="Remove from the inbox?"
                    description="They will not reappear unless Entra changes."
                    onConfirm={() => dismiss.mutate(r.id)}
                  >
                    <Tooltip title="Dismiss: remove this account from the inbox (after confirming). Use it for accounts that are not new joiners — shared mailboxes, test accounts and so on. A dismissed account does not come back on later scans.">
                      <Button size="small" icon={<CloseOutlined />} aria-label="Dismiss" />
                    </Tooltip>
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
        title={
          <span className="pea-section-title">
            Possible leavers
            <HintIcon title="Active employees whose Microsoft account looks like a leaver's. Flagged only when the account is BOTH disabled and unlicensed — no licence alone is not enough, as that wrongly flagged resource accounts, guests and unlicensed staff. Nothing changes until you confirm." />
          </span>
        }
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
                  <StatusPill tone="crit">
                    {r.azure_account_enabled === false ? 'disabled' : 'enabled'}
                  </StatusPill>
                  <StatusPill tone="crit">
                    {r.license_assigned === false ? 'no licence' : 'licensed'}
                  </StatusPill>
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
        title={
          accepting?.byHand
            ? 'Add a joiner by hand'
            : `Confirm ${accepting?.display_name || 'new joiner'}`
        }
        open={!!accepting}
        onCancel={() => { setAccepting(null); form.resetFields(); }}
        onOk={() => form.submit()}
        confirmLoading={accept.isPending || addByHand.isPending}
        okText="Add and schedule"
        width={620}
      >
        {accepting?.byHand && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 14 }}
            message="For anyone the Microsoft 365 check could not pick up"
            description="Their evaluation schedule is worked out from the joining date, exactly as it is for a joiner found automatically."
          />
        )}
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(v) => {
            const values = { ...v, doj: dayjs(v.doj).format('YYYY-MM-DD') };
            // Same form, two destinations: a found account is confirmed through
            // the intake inbox so the candidate row is closed out; a manual one
            // goes straight to the employee endpoint, which has no candidate to
            // reconcile.
            if (accepting.byHand) addByHand.mutate(values);
            else accept.mutate({ id: accepting.id, values });
          }}
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
