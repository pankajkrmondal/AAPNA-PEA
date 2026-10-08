import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Space, Button, Modal, Form, Input, DatePicker, Radio, Alert,
  App, Tooltip, Typography, Empty, Popconfirm,
} from 'antd';
import {
  SyncOutlined, EyeOutlined, UserAddOutlined, CloseOutlined, CheckOutlined,
  // U8 (decided 02-10-2026) — `ClusterOutlined` was the icon of the removed
  // "Refresh project-leader suggestions" button:
  // LogoutOutlined, ClusterOutlined,
  LogoutOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { unwrap } from '../api.js';
import HintIcon from '../components/HintIcon.jsx';
import NoticeStrip from '../components/NoticeStrip.jsx';
import StatusPill from '../components/StatusPill.jsx';
import { formatDate, formatDateTime, DATE_FORMAT } from '../formatDate.js';
import PastDueChoice, { PAST_DUE_DEFAULT, pastDueAction } from '../components/PastDueChoice.jsx';
import PersonPicker, { useManagerPick } from '../components/PersonPicker.jsx';

/** U8 (AD sync) — where a suggested project leader came from, as the screen says it. */
const PL_HINT = {
  leaders_list: 'The first person on the Leaders list at or above the reporting manager.',
  // Decided 02-10-2026: the Leaders list is the only source now. A joiner who
  // was already waiting keeps this label until the next scan refreshes them.
  rm_map: 'Suggested from the current Commandos, before the Leaders list became the only source. The next scan replaces it.',
};

// H6 / U4 — was: const fmt = (d) => (d ? String(d).slice(0, 10) : '—');
const fmt = (d) => formatDate(d);

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
  // Clean table (07-10-2026) — one line: a long value ends in "…" with the
  // whole of it on hover, and the Check mark stays beside it. It was a <Space>
  // around a plain <span>{value}</span>, which wrapped instead.
  return (
    <div className="pea-suggested">
      <Tooltip title={value}>
        <span className="pea-suggested-value">{value}</span>
      </Tooltip>
      {source && (
        <Tooltip title={hint}>
          {/* "Check" rather than "unverified": Microsoft 365 filled this and is
              often wrong, so it wants a glance — but it does not stop HR
              confirming the row. */}
          <StatusPill tone="warn">Check</StatusPill>
        </Tooltip>
      )}
    </div>
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
  // H1 (07-10-2026) — fresher or experienced is suggested from the designation
  // when it can be. With no suggestion it is genuinely missing: the dialog
  // cannot be confirmed without it.
  const hasTrack = r.suggested_is_experienced === true || r.suggested_is_experienced === false;
  if (!hasTrack) missing.push('fresher or experienced');

  const check = [];
  if (r.suggested_doj && r.doj_source) check.push('date of joining');
  if (hasTrack) check.push('fresher or experienced');
  if (r.suggested_rm_email && r.rm_source) check.push('manager');

  return { missing, check, blocked: missing.length > 0 };
}

export default function NewJoiners() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [accepting, setAccepting] = useState(null);
  const [form] = Form.useForm();
  // U8 — choosing a manager by name fills their email and suggests the project leader.
  const { onPickManager, plNote, clearPlNote } = useManagerPick(form);

  const { data, isLoading } = useQuery({
    queryKey: ['intake-inbox'],
    queryFn: () => api.get('/intake/inbox').then(unwrap),
  });

  // H1 — whether PEA can read the directory, and the lists it is set to read.
  // The header already asks for this every minute; the same key shares the answer.
  const { data: diag } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: () => api.get('/admin/diagnostics').then(unwrap),
    retry: false,
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
    setPastDueCount(0);
    setPastDue(PAST_DUE_DEFAULT);
    clearPlNote();
    setAccepting({ byHand: true });
  };

  // B5 / U9 — how many evaluations the joining date and track on the form
  // would put in the past. Both must be chosen before there is a schedule to
  // count; a failed preview simply asks nothing.
  const [pastDueCount, setPastDueCount] = useState(0);
  const [pastDue, setPastDue] = useState(PAST_DUE_DEFAULT);
  const countPastDue = async () => {
    const { doj, is_experienced: experienced } = form.getFieldsValue();
    if (!doj || experienced === undefined) { setPastDueCount(0); return; }
    try {
      const rows = await api
        .post('/employees/preview-schedule', { doj: dayjs(doj).format('YYYY-MM-DD'), is_experienced: !!experienced })
        .then(unwrap);
      setPastDueCount(rows.filter((r) => r.past_due).length);
    } catch {
      setPastDueCount(0);
    }
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

  /* U8 (decided 02-10-2026) — the project leader comes from the Leaders list
     only, so there is no map of suggestions to refresh. Kept for reference:

  const seedMap = useMutation({
    mutationFn: () => api.post('/intake/rm-pl-map/seed').then((r) => r.data),
    onSuccess: (res) => { message.success(res.message); refresh(); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });
  */

  const openAccept = (row) => {
    setPastDueCount(0);
    setPastDue(PAST_DUE_DEFAULT);
    clearPlNote();
    setAccepting(row);
    form.setFieldsValue({
      full_name: row.display_name,
      personal_email: undefined,
      office_email: row.office_email,
      // Prefilled, never final: Microsoft 365 holds neither of these, so both
      // are suggestions HR confirms here. H1 (07-10-2026) — fresher or
      // experienced is preselected when the designation suggests one; it was
      // never preselected:
      //   is_experienced: undefined,
      doj: row.suggested_doj ? dayjs(row.suggested_doj) : null,
      is_experienced:
        row.suggested_is_experienced === true || row.suggested_is_experienced === false
          ? row.suggested_is_experienced
          : undefined,
      rm_name: row.suggested_rm_name,
      rm_email: row.suggested_rm_email,
      pl_email: row.suggested_pl_email,
    });
  };

  const counts = data?.counts || {};
  const lastScan = data?.lastScan;
  // H1 — which directory rules are in force (null from an older server).
  const rules = data?.rules;

  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>New joiners</h2>
          <p>
            New Microsoft accounts, however the person joined · confirm what Microsoft
            cannot tell us · anyone can also be added directly from Commandos
            {lastScan && (
              <> · last scan {formatDateTime(lastScan.runAt)} ({lastScan.status})</>
            )}
            {/* H1 — what the directory rules left out on that scan, so an empty
                inbox is not mistaken for "nobody was looked at". */}
            {lastScan?.leftOut && <> · left out: {lastScan.leftOut}</>}
          </p>
        </div>
        <Space wrap>
          {/* U8 (decided 02-10-2026) — removed from the screen, kept for
              reference. The project leader is taken from the Leaders list in
              Microsoft 365 and from nowhere else, so a button that rebuilt
              suggestions from the current Commandos would change nothing.

          <Tooltip title="Looks at the current Commandos to suggest each new joiner's project leader. A reporting manager who has always had the same project leader gets that project leader suggested; one who has more than one shows 'needs HR' instead. Project leaders you set by hand are kept. Commandos are not changed; no email is sent.">
            <Button icon={<ClusterOutlined />} onClick={() => seedMap.mutate()} loading={seedMap.isPending}>
              Refresh project-leader suggestions
            </Button>
          </Tooltip>
          */}
          <Tooltip title="Checks Microsoft 365 and shows what a real scan would find: new joiners, refreshed suggestions, possible leavers, and names or emails that changed. Nothing is changed and no email is sent.">
            <Button icon={<EyeOutlined />} onClick={() => scan.mutate(true)} loading={scan.isPending}>
              Test run
            </Button>
          </Tooltip>
          <Tooltip title="Checks Microsoft 365 now (the nightly check does the same if switched on in Settings → New joiners). Fills the inbox and records account status on Commandos. No email is sent; a bell notification is raised if something new is found.">
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

      {/* Three stacked banners became one strip. The wording is unchanged —
          only the amount of screen it takes before HR reach the table below.
          Everything that was a problem is still a problem here; what left is
          the permanent explainer, which is now the ⓘ on "Found in Microsoft 365"
          because it is true every day and so should not cost a line every day. */}
      <NoticeStrip
        items={[
          data?.setupRequired && {
            key: 'setup',
            tone: 'error',
            summary: 'New joiners isn’t available yet',
            detail: 'Ask your PEA admin to finish setting it up, then reload this page.',
          },

          // R-03 — what the nightly alert would say, said here too. Subhajit,
          // 15-Sep (16:14): "if any data is not being synced properly from the
          // AD, we should be getting an email alert so that we can take it up
          // manually." The remedy is the sheet upload, so it is linked here.
          sync?.rows?.length > 0 && {
            key: 'sync',
            tone: sync.rows.some((p) => p.severity === 'critical') ? 'error' : 'warning',
            summary:
              sync.rows.length === 1
                ? 'The Microsoft 365 check found something that needs your attention'
                : `The Microsoft 365 check found ${sync.rows.length} things that need your attention`,
            detail: (
              <>
                <ul>
                  {sync.rows.map((p) => (
                    <li key={p.key}>
                      <strong>{p.title}</strong>
                      {p.subject && p.subject !== '—' ? ` — ${p.subject}. ` : '. '}
                      {p.detail}
                    </li>
                  ))}
                </ul>
                {sync.rows.some((p) => p.fixable) && (
                  <div style={{ marginTop: 6 }}>
                    Add the missing details by hand below, or{' '}
                    <Link to="/import">upload the sheet</Link> with them. Everything
                    else carries on as normal.
                  </div>
                )}
              </>
            ),
          },

          // U8 (decided 02-10-2026) — removed from the screen, kept for
          // reference. It warned about the map learned from the current
          // Commandos, which no longer supplies anyone's project leader.
          // counts.ambiguousPlMappings > 0 && {
          //   key: 'ambiguous-pl',
          //   tone: 'warning',
          //   summary: `${counts.ambiguousPlMappings} reporting manager(s) have more than one project leader`,
          //   detail: 'Their project leader is left blank rather than guessed. Set it once on the Commando and PEA remembers it.',
          // },

          // H1 — PEA cannot read the directory, or one of the two lists it is
          // set to read. With a list set and unreadable the check stops rather
          // than guess, so this is the reason the inbox is not filling.
          diag?.directory && diag.directory.ok === false && {
            key: 'directory',
            tone: 'error',
            summary: 'PEA cannot read everything it needs from Microsoft 365',
            detail: `${diag.directory.detail} Until this is fixed the Microsoft 365 check stops without changing anything. Ask your PEA admin or IT.`,
          },

          // H1 — no Contractor list is set, so contract staff are not filtered
          // out. Said plainly, because the inbox looks the same either way.
          rules && !rules.contractorList && {
            key: 'no-contractor-list',
            tone: 'info',
            summary: 'Contract staff are not being filtered out',
            detail: 'PEA leaves contract staff out of this inbox by checking who is on the Contractor distribution list, as the MRA Reconcile flow does — but the list has been cleared in Settings → New joiners. An admin can set it there again. Until then, dismiss contract staff by hand.',
          },

          // H1 — who the last scan took off the inbox, and who it left out for
          // having no manager, by name.
          lastScan?.inboxRemoved?.length > 0 && {
            key: 'inbox-removed',
            tone: 'info',
            summary: `The last scan took ${lastScan.inboxRemoved.length} account(s) off this inbox`,
            detail: (
              <>
                <ul>{lastScan.inboxRemoved.map((line) => <li key={line}>{line}</li>)}</ul>
                They come back on their own if the rules stop applying to them.
              </>
            ),
          },
          lastScan?.noManager?.length > 0 && {
            key: 'no-manager',
            tone: 'warning',
            summary: `${lastScan.noManager.length} new account(s) left out — no manager in Microsoft 365`,
            detail: (
              <>
                <ul>{lastScan.noManager.map((who) => <li key={who}>{who}</li>)}</ul>
                They appear here on their own once Microsoft 365 has a manager for them — ask IT to set it. If one cannot wait, add them with “Add by hand”.
              </>
            ),
          },
        ]}
      />

      {/* ── Entra-detected joiners ─────────────────────────────────────── */}
      <Card
        className="pea-card"
        size="small"
        title={
          <span className="pea-section-title">
            Found in Microsoft 365
            <HintIcon title="New Microsoft accounts waiting for HR to confirm (count at the top right). Turn a new account into a scheduled Commando in two questions instead of typing eight columns. Two things always need a person: Microsoft 365 holds no joining date and no fresher/experienced flag — both attributes are unpopulated across all 260 accounts. The suggested date is the date IT created the Microsoft account, which is within a few days about 70% of the time and, for a rejoiner whose old account was reused, has been out by over two years. A wrong date moves every evaluation, so PEA asks rather than assumes." />
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
                description="No new accounts waiting. Run a scan to check Microsoft 365."
              />
            ),
          }}
          // Clean table (07-10-2026) — Harish: the Name column was squeezed to a
          // few letters, names broke mid-word, and "To fix" ran to six lines. Every
          // cell is one line now, at a fixed width, so nothing can be squeezed.
          // "Account created" and "To fix" said again what the Check and Missing
          // marks already say: the first is in the joining date's tooltip, the
          // second in the Confirm / Review button's. The columns before are kept
          // in the comment after this table.
          tableLayout="fixed"
          scroll={{ x: 1000 }}
          columns={[
            {
              title: 'Name',
              dataIndex: 'display_name',
              width: 220,
              render: (v, r) => (
                <div className="pea-joiner-person">
                  <Tooltip title={v}><span className="pea-joiner-person-name">{v || '—'}</span></Tooltip>
                  <Tooltip title={r.office_email}><span className="pea-joiner-person-sub">{r.office_email}</span></Tooltip>
                </div>
              ),
            },
            {
              title: 'Joining date',
              width: 180,
              render: (_, r) => (
                <Suggested
                  value={r.suggested_doj ? fmt(r.suggested_doj) : null}
                  source={r.doj_source}
                  hint={
                    (r.doj_source === 'account_created'
                      ? 'The Microsoft account creation date, used as a proxy. The next scan changes it to the day after.'
                      : 'The day after the Microsoft account was created. Microsoft 365 does not hold the joining date — check it against the offer letter.')
                    + (r.account_created_at ? ` Account created ${fmt(r.account_created_at)}.` : '')
                  }
                />
              ),
            },
            {
              title: 'Fresher or experienced',
              width: 190,
              render: (_, r) => (
                <Suggested
                  value={
                    r.suggested_is_experienced === true ? 'Experienced'
                      : r.suggested_is_experienced === false ? 'Fresher'
                        : null
                  }
                  source={r.track_source}
                  hint={`Suggested from the designation “${r.job_title || ''}”. Microsoft 365 does not hold the years of experience — confirm it.`}
                />
              ),
            },
            {
              title: 'Reporting manager',
              render: (_, r) => (
                <Suggested
                  value={r.suggested_rm_email}
                  source={r.rm_source}
                  hint="The manager recorded in Microsoft 365. Set on 73% of new accounts and correct 88% of the time when set."
                />
              ),
            },
            {
              title: 'Project leader',
              render: (_, r) =>
                r.suggested_pl_email ? (
                  <Suggested value={r.suggested_pl_email} source={r.pl_source} hint={PL_HINT[r.pl_source] || PL_HINT.rm_map} />
                ) : (
                  <Tooltip title="Nobody on the Leaders list is at or above this person's manager, or the manager is unknown. Choose the project leader when you confirm.">
                    <StatusPill tone="crit">Missing</StatusPill>
                  </Tooltip>
                ),
            },
            {
              title: '',
              width: 150,
              render: (_, r) => {
                const fix = toFix(r);
                // What the "To fix" column used to say, on the button.
                const tip = fix.blocked
                  ? `Add the ${fix.missing.join(', ')}, then confirm.${fix.check.length ? ` Check the ${fix.check.join(' and ')} too.` : ''}`
                  : fix.check.length
                    ? `Check the ${fix.check.join(' and ')}, then confirm.`
                    : 'Everything needed is here — confirm this joiner.';
                return (
                  <Space size={6}>
                    <Tooltip title={tip}>
                      <Button size="small" type="primary" icon={<UserAddOutlined />} onClick={() => openAccept(r)}>
                        {fix.blocked ? 'Review' : 'Confirm'}
                      </Button>
                    </Tooltip>
                    <Popconfirm
                      title="Remove from the inbox?"
                      description="They will not reappear unless their Microsoft 365 account changes."
                      onConfirm={() => dismiss.mutate(r.id)}
                    >
                      <Tooltip title="Dismiss: remove this account from the inbox (after confirming). Use it for accounts that are not new joiners — shared mailboxes, test accounts and so on. A dismissed account does not come back on later scans.">
                        <Button size="small" icon={<CloseOutlined />} aria-label="Dismiss" />
                      </Tooltip>
                    </Popconfirm>
                  </Space>
                );
              },
            },
          ]}
        />
        {/* Clean table (07-10-2026) — the inbox columns before, kept for reference:

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
              // H1 (07-10-2026) — the day after the account was created, and under
              // it the track the designation suggests. Both are suggestions; HR
              // confirms them. The hint read "The Microsoft account creation date,
              // used as a proxy. Right within ±3 days about 70% of the time."
              render: (_, r) => (
                <Space direction="vertical" size={4}>
                  <Suggested
                    value={r.suggested_doj ? fmt(r.suggested_doj) : null}
                    source={r.doj_source}
                    hint={
                      r.doj_source === 'account_created'
                        ? 'The Microsoft account creation date, used as a proxy. The next scan changes it to the day after.'
                        : 'The day after the Microsoft account was created. Microsoft 365 does not hold the joining date — check it against the offer letter.'
                    }
                  />
                  <Suggested
                    value={
                      r.suggested_is_experienced === true ? 'Experienced'
                        : r.suggested_is_experienced === false ? 'Fresher'
                          : null
                    }
                    source={r.track_source}
                    hint={`Suggested from the designation “${r.job_title || ''}”. Microsoft 365 does not hold the years of experience — confirm it.`}
                  />
                </Space>
              ),
            },
            {
              title: 'Reporting manager',
              render: (_, r) => (
                <Suggested
                  value={r.suggested_rm_email}
                  source={r.rm_source}
                  hint="The manager recorded in Microsoft 365. Set on 73% of new accounts and correct 88% of the time when set."
                />
              ),
            },
            {
              title: 'Project leader',
              render: (_, r) =>
                r.suggested_pl_email ? (
                  // U8 (AD sync) — the hint was always "Derived from the reporting manager."
                  <Suggested value={r.suggested_pl_email} source={r.pl_source} hint={PL_HINT[r.pl_source] || PL_HINT.rm_map} />
                ) : (
                  // U8 (decided 02-10-2026) — it read "Either the manager is unknown,
                  // or they have more than one project leader."
                  <Tooltip title="Nobody on the Leaders list is at or above this person's manager, or the manager is unknown. Choose the project leader when you confirm.">
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
                    description="They will not reappear unless their Microsoft 365 account changes."
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
        */}
      </Card>

      {/* ── Leaver suggestions ─────────────────────────────────────────── */}
      <Card
        className="pea-card"
        size="small"
        title={
          <span className="pea-section-title">
            Possible leavers
            <HintIcon title="Active Commandos whose Microsoft account looks like a leaver's. Flagged only when the account is BOTH disabled and unlicensed — no licence alone is not enough, as that wrongly flagged resource accounts, guests and unlicensed staff. Nothing changes until you confirm." />
          </span>
        }
        extra={<span className="pea-count pea-count-muted">{counts.leavers ?? 0}</span>}
      >
        {/* The banner that stood here said the same thing as the ⓘ above it,
            one line lower — so it only cost the table its space. */}
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data?.leavers || []}
          locale={{ emptyText: 'Nobody flagged' }}
          columns={[
            {
              title: 'Commando',
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
              title: 'Microsoft 365 says',
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
          onValuesChange={(changed) => {
            if ('doj' in changed || 'is_experienced' in changed) countPastDue();
          }}
          onFinish={(v) => {
            const values = {
              ...v,
              doj: dayjs(v.doj).format('YYYY-MM-DD'),
              // B5 / U9 — only when something is already past due.
              ...(pastDueCount ? { past_due_action: pastDueAction(pastDue) } : {}),
            };
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
            // H1 (07-10-2026) — was: accepting?.doj_source === 'account_created' ? 'Prefilled from the
            // Microsoft account creation date — check it against the offer letter or with the Commando.'
            extra={
              accepting?.doj_source === 'created_next_day'
                ? 'Suggested: the day after the Microsoft account was created. Microsoft 365 does not hold the joining date — check it against the offer letter or with the Commando.'
                : accepting?.doj_source === 'account_created'
                  ? 'Prefilled from the Microsoft account creation date — check it against the offer letter or with the Commando.'
                  : undefined
            }
          >
            <DatePicker style={{ width: '100%' }} format={DATE_FORMAT} />
          </Form.Item>

          <Form.Item
            name="is_experienced"
            label="Fresher or experienced"
            rules={[{ required: true, message: 'This decides the whole schedule — please choose' }]}
            // H1 (07-10-2026) — says where a preselected answer came from. It was:
            // extra="Microsoft holds nothing here. A fresher gets 6 monthly evaluations; an experienced hire gets 3 two-monthly ones."
            extra={
              accepting?.track_source === 'job_title'
                ? `Suggested from the designation “${accepting.job_title}” — check before confirming. A fresher gets 6 monthly evaluations; an experienced hire gets 3 two-monthly ones.`
                : 'Microsoft 365 holds nothing here. A fresher gets 6 monthly evaluations; an experienced hire gets 3 two-monthly ones.'
            }
          >
            <Radio.Group optionType="button" buttonStyle="solid">
              <Radio.Button value={false}>Fresher</Radio.Button>
              <Radio.Button value>Experienced</Radio.Button>
            </Radio.Group>
          </Form.Item>

          {/* U8 — pick the manager from Microsoft 365 by name: the email comes
              with them and the project leader is suggested. Typing still works.
              This box and the project leader's were plain <Input />s. */}
          <Form.Item
            name="rm_name"
            label="Reporting manager"
            rules={[{ required: true }]}
            extra="Start typing a name to pick from Microsoft 365 — the email is filled in for you."
          >
            <PersonPicker onPick={onPickManager} />
          </Form.Item>
          <Form.Item name="rm_email" label="Reporting manager email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item
            name="pl_email"
            label="Project leader email"
            rules={[{ required: true, type: 'email' }]}
            // Checked on leaving the box: while a name is being typed to search,
            // "not a valid email" would be noise.
            validateTrigger="onBlur"
            // U8 — was: extra={accepting?.pl_source === 'rm_map' ? 'Derived from the reporting manager.' : undefined}
            extra={plNote || PL_HINT[accepting?.pl_source] || undefined}
          >
            <PersonPicker field="email" placeholder="Type a name, or the email" />
          </Form.Item>

          {/* B5 / U9 — a joining date in the past puts evaluations in the past too. */}
          <PastDueChoice
            count={pastDueCount}
            value={pastDue}
            onChange={setPastDue}
            manager={form.getFieldValue('rm_name') || 'the manager'}
          />
        </Form>
      </Modal>
    </>
  );
}
