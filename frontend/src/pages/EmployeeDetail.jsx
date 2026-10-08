import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Descriptions, Tag, Table, Space, Typography, Timeline, Button, Spin, Alert,
  // U10 — `Select` was used only by the two dropdowns removed from Edit:
  // Row, Col, App, Tooltip, Modal, Form, Input, DatePicker, Radio, Select, Popconfirm, Progress,
  Row, Col, App, Tooltip, Modal, Form, Input, DatePicker, Radio, Popconfirm, Progress,
} from 'antd';
import {
  SendOutlined, PauseOutlined, PlayCircleOutlined, EditOutlined,
  LockOutlined, UnlockOutlined, WarningOutlined, MailOutlined, ShareAltOutlined, DeleteOutlined,
  DownloadOutlined, MoreOutlined, ArrowUpOutlined, ArrowDownOutlined, ClockCircleOutlined, LoadingOutlined,
  CheckCircleOutlined, LogoutOutlined, LoginOutlined, InboxOutlined, UndoOutlined,
} from '@ant-design/icons';
import { Dropdown } from 'antd';
import dayjs from 'dayjs';
import api, { unwrap, USER_KEY } from '../api.js';
import { isAdminTier } from '../auth.js';
import ShareReportModal from '../components/ShareReportModal.jsx';
import { evaluationStatus } from '../evaluationStatus.js';
import StatusPill from '../components/StatusPill.jsx';
import { formatDate as fmt, formatDateTime, DATE_FORMAT } from '../formatDate.js';
import { Avatar, LoadProblem } from '../components/board/BoardParts.jsx';
import { CommentMatrix, JourneyStepper, trendOf } from '../components/EmployeeJourney.jsx';
import { decisionTone } from '../evaluationDisplay.js';
import { useCrumbs } from '../crumbs.jsx';
import PastDueChoice, { PAST_DUE_DEFAULT, pastDueAction } from '../components/PastDueChoice.jsx';
import PersonPicker, { useManagerPick } from '../components/PersonPicker.jsx';
import EmployeeNotes from '../components/EmployeeNotes.jsx';

/** Same rule as the server: case and extra spaces do not matter. */
const normName = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

// U10 — the Edit form no longer has a decision dropdown. "Record decision"
// offers only what the server allows for this person (probation.decisionOptions),
// so the fixed list is not used any more:
// const CONFIRMATION_OPTIONS = ['Confirmed', 'Not Confirmed', 'Extend for 1 month', 'Extend for 2 months'];

/** What each decision does, as "Record decision" explains it. */
const DECISION_HELP = {
  Confirmed: 'make this person permanent. Open evaluations are closed.',
  'Not Confirmed': 'end the probation without confirming. Open evaluations are closed.',
  'Extend for 1 month': 'one more evaluation, 30 days after the last one.',
  'Extend for 2 months': 'two more evaluations, 30 and 60 days after the last one.',
};

/** The "Record decision" choice that clears a decision; sent to the API as blank. */
const CLEAR_DECISION = '__clear__';

/**
 * U12 — the change history in words HR uses. It printed the database column
 * names (`rm_email`, `halt_process`) and stopped at 20 entries.
 */
const AUDIT_LABELS = {
  full_name: 'Name',
  office_email: 'Office email',
  personal_email: 'Personal email',
  is_experienced: 'Fresher or experienced',
  doj: 'Date of joining',
  rm_name: 'Reporting manager',
  rm_email: 'Reporting manager email',
  pl_email: 'Project leader email',
  halt_process: 'Evaluations on hold',
  confirmation_status: 'Probation decision',
  employment_status: 'Employment',
  locked_fields: 'Values kept against Microsoft 365',
};

/** Where a change came from, as the history says it. */
const AUDIT_SOURCES = {
  manual: 'in PEA',
  azure: 'Microsoft 365',
  excel_import: 'sheet upload',
  ats: 'ATS',
  system: 'automatic',
};

/** How many history entries show before "Show all". */
const AUDIT_PREVIEW = 20;

/** One stored value as a person reads it. The audit table keeps everything as text. */
function auditValue(field, value) {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (field === 'doj') return fmt(value);
  if (field === 'is_experienced') return value === 'true' ? 'Experienced' : 'Fresher';
  if (field === 'halt_process') return value === 'true' ? 'Yes' : 'No';
  if (field === 'employment_status') return value === 'left' ? 'Left' : value === 'active' ? 'Active' : value;
  if (field === 'locked_fields') {
    return String(value).split(',').map((f) => AUDIT_LABELS[f.trim()] || f.trim()).join(', ');
  }
  return value;
}

/**
 * Where an Entra-sourced value stands. Plan §6.5 Part 2: "from Azure" until HR
 * corrects it, "manually overridden" once locked, and a visible disagreement
 * whenever Entra still holds something different — a lock must never hide
 * that IT's record is wrong.
 */
function AzureProvenance({ field, info, onUnlock, onReport, unlocking }) {
  if (!info) return null;
  return (
    <Space size={4} wrap style={{ marginTop: 4 }}>
      {info.locked ? (
        <>
          <Tooltip title="HR corrected this value. Microsoft 365 will not overwrite it.">
            <Tag icon={<LockOutlined />} color="purple">manually overridden</Tag>
          </Tooltip>
          <Popconfirm
            title="Unlock and follow Microsoft 365 again?"
            description={info.azureValue ? `The value becomes "${info.azureValue}".` : 'Microsoft 365 holds no value yet.'}
            onConfirm={() => onUnlock(field)}
          >
            <Button size="small" type="link" icon={<UnlockOutlined />} loading={unlocking}>
              Unlock
            </Button>
          </Popconfirm>
        </>
      ) : (
        <Tag color="blue">from Microsoft 365</Tag>
      )}
      {info.differs && (
        <>
          <Tooltip title={`Microsoft 365 currently holds: ${info.azureValue}`}>
            <Tag icon={<WarningOutlined />} color="red">differs from Microsoft 365</Tag>
          </Tooltip>
          <Button size="small" type="link" icon={<MailOutlined />} onClick={() => onReport(field)}>
            Report to IT
          </Button>
        </>
      )}
    </Space>
  );
}

// Status names and date wording live in shared modules, so this page and the
// manager portal cannot drift apart on what the same evaluation is called or
// when it happened.

export default function EmployeeDetail() {
  const { id } = useParams();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const { data: e, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/employees/${id}/full`).then(unwrap),
  });

  useCrumbs([{ label: 'Commandos', to: '/employees' }, { label: e?.full_name || 'Commando' }]);

  const resend = useMutation({
    mutationFn: (seqNo) =>
      api.post('/admin/send-evaluation', { office_email: e.office_email, seq_no: seqNo }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      qc.invalidateQueries({ queryKey: ['employee', id] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const toggleHalt = useMutation({
    // B5 — was: (halt) => api.post(`/employees/${id}/halt`, { halt })
    // Resuming may now carry `past_due_action`, so the body is passed whole.
    mutationFn: (body) => api.post(`/employees/${id}/halt`, body).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setResumeOpen(false);
      qc.invalidateQueries({ queryKey: ['employee', id] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  // B5 / U9 — resuming after a hold asks what to do with evaluations that fell
  // due in the meantime, instead of sending them all the next morning.
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeChoice, setResumeChoice] = useState(PAST_DUE_DEFAULT);

  const [editOpen, setEditOpen] = useState(false);
  const [lockPrompt, setLockPrompt] = useState(null); // { payload, fields }
  const [reportField, setReportField] = useState(null);
  const [editForm] = Form.useForm();
  const [reportForm] = Form.useForm();
  // M3 — the manager's email as typed in Edit, to say what a change will do.
  const editingRmEmail = Form.useWatch('rm_email', editForm);
  // U8 — choosing a manager by name fills their email and suggests the project leader.
  const { onPickManager, plNote, clearPlNote } = useManagerPick(editForm);

  const refresh = () => qc.invalidateQueries({ queryKey: ['employee', id] });

  /**
   * R-05 — fetched through the API client so the JWT goes with it. Opening the
   * URL directly would send no Authorization header and simply 401.
   */
  const downloadReport = useMutation({
    mutationFn: () => api.get(`/employees/${id}/report`, { responseType: 'blob' }),
    onSuccess: (res) => {
      const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] || '')?.[1]
        || 'evaluation-report.xlsx';
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const save = useMutation({
    mutationFn: (payload) => api.patch(`/employees/${id}`, payload).then((r) => r.data),
    onSuccess: (res) => {
      const meta = res.data?._meta || {};
      const moved = meta.rescheduled;
      // M3 — a manager change cancels the open links and sends them on.
      const sentOn = meta.linksReissued || 0;
      const heldBack = meta.linksHeld || 0;
      const notes = [
        moved ? `${moved.updated} evaluation date(s) moved, ${moved.skipped} already sent left alone` : '',
        sentOn ? `${sentOn} open evaluation link(s) sent to the new manager` : '',
        heldBack ? `${heldBack} could not be sent yet and will go with the next daily send` : '',
      ].filter(Boolean);
      message.success(notes.length ? `Saved — ${notes.join('; ')}` : 'Saved');
      /* M3 — the message before the manager-change note, kept for reference:
      message.success(
        moved ? `Saved — ${moved.updated} evaluation date(s) moved, ${moved.skipped} already sent left alone` : 'Saved'
      );
      */
      setEditOpen(false);
      setLockPrompt(null);
      refresh();
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee-managers'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const [selfLink, setSelfLink] = useState(null);

  const issueSelfLink = useMutation({
    mutationFn: () => api.post(`/self-view-links/${id}`).then(unwrap),
    onSuccess: setSelfLink,
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const report = useMutation({
    mutationFn: (values) => api.post(`/employees/${id}/report-to-it`, values).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setReportField(null);
      reportForm.resetFields();
      refresh();
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const navigate = useNavigate();
  const isAdmin = isAdminTier(JSON.parse(localStorage.getItem(USER_KEY) || '{}').role);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteName, setDeleteName] = useState('');
  const [shareOpen, setShareOpen] = useState(false); // R-05
  const [auditAll, setAuditAll] = useState(false); // U12

  // U10 — a decision and an exit are their own actions, each with a reason and
  // a date, instead of two dropdowns inside Edit.
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [leftMode, setLeftMode] = useState(null); // 'left' | 'active' | null
  const [decisionForm] = Form.useForm();
  const [leftForm] = Form.useForm();

  const recordDecision = useMutation({
    mutationFn: (values) => api.post(`/employees/${id}/decision`, values).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setDecisionOpen(false);
      refresh();
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  // Archive (07-10-2026) — someone whose probation is over moves out of the
  // day-to-day lists, as a read-only record; Restore brings them back.
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [archiveReason, setArchiveReason] = useState('');
  const archiveDone = (res) => {
    message.success(res.message);
    setArchiveOpen(false);
    setRestoreOpen(false);
    setArchiveReason('');
    refresh();
    qc.invalidateQueries({ queryKey: ['employees'] });
  };
  const archiveMut = useMutation({
    mutationFn: () => api.post(`/employees/${id}/archive`, { reason: archiveReason }).then((r) => r.data),
    onSuccess: archiveDone,
    onError: (err) => { message.error(err.friendlyMessage); },
  });
  const restoreMut = useMutation({
    mutationFn: () => api.post(`/employees/${id}/restore`).then((r) => r.data),
    onSuccess: archiveDone,
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const markLeft = useMutation({
    mutationFn: ({ mode, ...values }) =>
      api.post(`/employees/${id}/${mode === 'active' ? 'mark-active' : 'mark-left'}`, values).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setLeftMode(null);
      refresh();
      qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/employees/${id}`, { data: { confirm_name: deleteName } }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ['employees'] });
      navigate('/employees');
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', marginTop: 80 }} />;
  if (isError || !e) {
    return (
      <div className="pea-card pea-card-pad">
        <LoadProblem
          error={error}
          onRetry={refetch}
          what="This Commando"
          extra={<Link to="/employees"><Button>All Commandos</Button></Link>}
        />
      </div>
    );
  }

  const progress = e.progress || { total: 0, completed: 0, awaitingResponse: 0, overdue: 0, nextDue: null };
  const azure = e.azure || { linked: false, fields: {} };
  // R-02. Defaults match the server's: the leaver hold is on, the manual pause
  // is not — so an older server that does not send this block still behaves.
  const hold = e.evaluationHold || { manualPauseEnabled: false, holdLeaversEnabled: true, heldAsLeaver: false };
  const manualPauseEnabled = hold.manualPauseEnabled;

  const openEdit = () => {
    editForm.setFieldsValue({
      full_name: e.full_name,
      office_email: e.office_email,
      personal_email: e.personal_email,
      doj: e.doj ? dayjs(String(e.doj).slice(0, 10)) : null,
      is_experienced: e.is_experienced,
      rm_name: e.rm_name,
      rm_email: e.rm_email,
      pl_email: e.pl_email,
      // U10 — no longer edited here; see "Record decision" and "Mark as left".
      // confirmation_status: e.confirmation_status || undefined,
      // employment_status: e.employment_status,
    });
    clearPlNote();
    setEditOpen(true);
  };

  const submitEdit = (values) => {
    const payload = {
      ...values,
      doj: values.doj ? values.doj.format('YYYY-MM-DD') : undefined,
      // U10 — confirmation_status: values.confirmation_status || '',
    };

    // Changing an Entra-sourced value on a linked, unlocked field: ask once
    // whether the correction should stick. Plan §6.5 — "Keep my value" /
    // "Just this once".
    const changedAzureFields = azure.linked
      ? ['full_name', 'office_email'].filter(
          (f) =>
            !azure.fields[f]?.locked &&
            String(values[f] || '').trim().toLowerCase() !== String(e[f] || '').trim().toLowerCase()
        )
      : [];

    if (changedAzureFields.length) {
      setLockPrompt({ payload, fields: changedAzureFields });
      return;
    }
    save.mutate(payload);
  };

  const openReport = (field) => {
    setReportField(field);
    reportForm.setFieldsValue({ field, correct_value: e[field], note: '' });
  };

  // ── The hero's facts ─────────────────────────────────────────────────
  const cycles = e.cycles || [];
  const extended = e.confirmation_status?.startsWith('Extend');
  // H3 (07-10-2026) — read only by the "Next due" pill, removed from the header:
  // const nextOpen = cycles.find((c) => ['pending', 'email_sent', 'opened'].includes(c.status));
  const trend = trendOf(cycles);

  // U11 / U10 — when the probation ends and what may still be decided. The
  // defaults cover an older server that does not send the block.
  const probation = e.probation
    || { endsOn: null, extensionsLeft: 0, decisionOptions: [], decided: false, daysPastEnd: 0 };
  const record = e.record || {};
  const hasLeft = e.employment_status === 'left';

  const openDecision = () => {
    decisionForm.resetFields();
    decisionForm.setFieldsValue({ date: dayjs() });
    setDecisionOpen(true);
  };

  const openLeft = (mode) => {
    leftForm.resetFields();
    leftForm.setFieldsValue({ left_on: dayjs() });
    setLeftMode(mode);
  };

  // M3 — links a manager is holding right now. Changing the manager's email
  // cancels these and sends them to the new one.
  const openLinks = cycles.filter((c) => ['email_sent', 'opened'].includes(c.status));
  const managerEmailChanged =
    editOpen &&
    !!editingRmEmail &&
    String(editingRmEmail).trim().toLowerCase() !== String(e.rm_email || '').trim().toLowerCase();

  // B5 / U9 — not yet sent and due today or earlier: the same rule the server
  // applies (pastDueToClose), so the count asked about is the count acted on.
  const todayIso = dayjs().format('YYYY-MM-DD');
  const pastDueCount = cycles.filter(
    (c) => c.status === 'pending' && String(c.due_date).slice(0, 10) <= todayIso
  ).length;

  const onHoldClick = () => {
    if (e.halt_process && pastDueCount > 0) {
      setResumeChoice(PAST_DUE_DEFAULT);
      setResumeOpen(true);
      return;
    }
    toggleHalt.mutate({ halt: !e.halt_process });
  };

  // Download, hold and delete are occasional; they live behind "More" so the
  // header carries the three actions the design names.
  // Archive (07-10-2026) — whether this person is archived (a read-only page),
  // and whether their probation is over, which is when Archive is offered.
  const archive = e.archive || { available: false, archived: false };
  const isArchived = !!archive.archived;
  const probationOver = ['Confirmed', 'Not Confirmed'].includes(e.confirmation_status) || hasLeft;

  const downloadItem = {
    key: 'download',
    icon: downloadReport.isPending ? <LoadingOutlined /> : <DownloadOutlined />,
    label: 'Download report (.xlsx)',
    disabled: progress.completed === 0,
  };
  const deleteItems = isAdmin ? [{ type: 'divider' }, { key: 'delete', icon: <DeleteOutlined />, label: 'Delete…', danger: true }] : [];

  // An archived record keeps Download, Restore and (admin) Delete only.
  const moreItems = isArchived ? [
    downloadItem,
    { key: 'restore', icon: <UndoOutlined />, label: 'Restore from the archive…' },
    ...deleteItems,
  ] : [
    // Archive (07-10-2026) — was the Download item written out here.
    downloadItem,
    // U10 — an exit is recorded here, with a reason and the last working day.
    hasLeft
      ? { key: 'active', icon: <LoginOutlined />, label: 'Mark as active again…' }
      : { key: 'left', icon: <LogoutOutlined />, label: 'Mark as left…' },
    // R-02 — Subhajit, 15-Sep (7:15): "Pause evolutions only works when a
    // resource has left." Exits are held automatically, so the manual button is
    // off unless HR switches it on for the long-leave case. Resume always shows
    // for anyone already paused: hiding it would strand them with no way back.
    ...((e.halt_process || manualPauseEnabled)
      ? [{
        key: 'halt',
        icon: e.halt_process ? <PlayCircleOutlined /> : <PauseOutlined />,
        label: e.halt_process ? 'Resume evaluations' : 'Hold for long leave',
      }]
      : []),
    // Archive (07-10-2026) — once the probation is over.
    ...(archive.available && probationOver
      ? [{ key: 'archive', icon: <InboxOutlined />, label: 'Archive…' }]
      : []),
    // Archive (07-10-2026) — was the Delete items written out here.
    ...deleteItems,
  ];

  return (
    <>
      {/* Archive (07-10-2026) — an archived Commando's page says so first. */}
      {isArchived && (
        <Alert
          type="info"
          showIcon
          icon={<InboxOutlined />}
          style={{ marginBottom: 16 }}
          message={`Archived on ${fmt(archive.archivedAt)}${archive.archivedBy ? ` by ${archive.archivedBy === 'auto-archive' ? 'PEA, automatically' : archive.archivedBy}` : ''}`}
          description={`${archive.reason ? `${archive.reason.replace(/\.?\s*$/, '.')} ` : ''}This record is read-only: it is kept in full and out of the day-to-day lists. Restore to make changes.`}
          action={<Button icon={<UndoOutlined />} onClick={() => setRestoreOpen(true)}>Restore</Button>}
        />
      )}
      <section className="pea-card pea-journey-hero">
        <Avatar name={e.full_name} size="xl" />
        <div className="pea-journey-id">
          <div className="pea-eyebrow">Commando · probation journey</div>
          <h1 className="pea-display">{e.full_name}</h1>
          <p className="pea-lead">
            {e.is_experienced ? 'Experienced' : 'Fresher'} · joined {fmt(e.doj)} · reporting manager {e.rm_name}
            {e.pl_email && <> · project leader {e.pl_email}</>}
          </p>
          <div className="pea-pill-row">
            {e.confirmation_status && !extended ? (
              <StatusPill tone={decisionTone(e.confirmation_status)}>{e.confirmation_status}</StatusPill>
            ) : extended ? (
              <span className="pea-fact"><ClockCircleOutlined /> <strong>Probation extended</strong></span>
            ) : (
              <StatusPill tone="info">In probation</StatusPill>
            )}
            {/* H3 (HR, 29-09-2026; removed 07-10-2026) — the submitted count, the
                probation end and the next due date were also in the "Probation
                progress" card below, so they are shown there only. Kept for
                reference, each as it was: */}
            {/* <span className="pea-fact">{progress.completed} of {progress.total} evaluations submitted</span> */}
            {/* U11 — when the probation ends, and whether a decision is owed. */}
            {/* {probation.endsOn && !probation.decided && !hasLeft && (
              <span className="pea-fact">Probation ends {fmt(probation.endsOn)}</span>
            )} */}
            {/* "Decision due" stays: it is a warning, not a repeat — the card has
                the end date, not that a decision is now owed. */}
            {probation.daysPastEnd > 0 && (
              <Tooltip title="The probation period has ended and no final decision is recorded. The manager is asked for one on the final evaluation; HR can also record it with Record decision.">
                <StatusPill tone={probation.daysPastEnd > 7 ? 'crit' : 'warn'}>
                  Decision due — ended {probation.daysPastEnd} day{probation.daysPastEnd === 1 ? '' : 's'} ago
                </StatusPill>
              </Tooltip>
            )}
            {/* H3 (07-10-2026) — removed. It showed the evaluation already sent and
                waiting, while the card's "Next evaluation due" shows the next one
                not yet sent: two different dates under the same words. It was:
            {nextOpen && (
              <span className="pea-fact">
                {nextOpen.is_extension ? 'Extension due' : 'Next due'} {fmt(nextOpen.due_date)}
              </span>
            )} */}
            {trend && (
              <StatusPill tone={trend.tone} nodot className="pea-pill-icon">
                {trend.word === 'Improving' ? <ArrowUpOutlined /> : trend.word === 'Declining' ? <ArrowDownOutlined /> : null} {trend.text}
              </StatusPill>
            )}
            {e.halt_process && <StatusPill tone="warn">On hold</StatusPill>}
            {hold.heldAsLeaver && (
              <Tooltip title="Microsoft 365 shows this account switched off and unlicensed, so evaluations stopped on their own. Confirm the exit, or mark them as still here, on the New joiners screen.">
                <StatusPill tone="crit">Held — may have left</StatusPill>
              </Tooltip>
            )}
            {e.employment_status === 'left' && <StatusPill tone="mute">Left</StatusPill>}
          </div>
        </div>
        <div className="pea-journey-actions">
          {/* Archive (07-10-2026) — Edit, Record decision and Commando link are
              not offered on an archived, read-only record; the three are as
              they were otherwise. */}
          {!isArchived && (<>
          <Button icon={<EditOutlined />} onClick={openEdit}>Edit</Button>
          {/* U10 — the decision is its own action, with a reason and a date. */}
          <Tooltip title={hasLeft ? 'This Commando is marked as having left.' : 'Confirm, do not confirm, or extend the probation — with a reason and a date.'}>
            <Button icon={<CheckCircleOutlined />} onClick={openDecision} disabled={hasLeft}>
              Record decision…
            </Button>
          </Tooltip>
          <Tooltip title="A personal link so the Commando can see their own probation. What it shows is set in Settings → Access.">
            <Button icon={<ShareAltOutlined />} loading={issueSelfLink.isPending} onClick={() => issueSelfLink.mutate()}>
              Commando link
            </Button>
          </Tooltip>
          </>)}
          {/* R-05 — Subhajit, 15-Sep (21:13): "time and again it's required for
              me actually." Share for the leader who emailed asking; Download
              (under More) for a Teams chat or a meeting. */}
          <Tooltip title="Email the whole evaluation record to whoever asked for it, with the spreadsheet attached.">
            <Button
              type="primary"
              icon={<MailOutlined />}
              disabled={progress.completed === 0}
              onClick={() => setShareOpen(true)}
            >
              Share report…
            </Button>
          </Tooltip>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: moreItems,
              onClick: ({ key }) => {
                if (key === 'download') downloadReport.mutate();
                // B5 — was: toggleHalt.mutate(!e.halt_process). Resume now asks first
                // when evaluations fell due during the hold.
                if (key === 'halt') onHoldClick();
                if (key === 'left' || key === 'active') openLeft(key);
                if (key === 'archive') { setArchiveReason(''); setArchiveOpen(true); }
                if (key === 'restore') setRestoreOpen(true);
                if (key === 'delete') { setDeleteName(''); setDeleteOpen(true); }
              },
            }}
          >
            <Button icon={<MoreOutlined />} aria-label="More actions" loading={toggleHalt.isPending} />
          </Dropdown>
        </div>
      </section>

      <JourneyStepper employee={e} />
      <CommentMatrix employee={e} />

      <h2 className="pea-record-head">Record and schedule</h2>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card className="pea-card" size="small" title={<span className="pea-section-title">Details</span>}>
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Name">
                {e.full_name}
                {azure.linked && (
                  <AzureProvenance
                    field="full_name"
                    info={azure.fields.full_name}
                    onUnlock={(f) => save.mutate({ unlock_fields: [f] })}
                    onReport={openReport}
                    unlocking={save.isPending}
                  />
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Office email">
                {e.office_email}
                {azure.linked && (
                  <AzureProvenance
                    field="office_email"
                    info={azure.fields.office_email}
                    onUnlock={(f) => save.mutate({ unlock_fields: [f] })}
                    onReport={openReport}
                    unlocking={save.isPending}
                  />
                )}
              </Descriptions.Item>
              <Descriptions.Item label="Personal email">{e.personal_email || '—'}</Descriptions.Item>
              <Descriptions.Item label="Date of joining">{fmt(e.doj)}</Descriptions.Item>
              <Descriptions.Item label="Reporting manager">
                {e.rm_name}<br />
                <Typography.Text type="secondary">{e.rm_email}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Project leader">{e.pl_email}</Descriptions.Item>
              <Descriptions.Item label="Added via">{e.source}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card className="pea-card" size="small" title={<span className="pea-section-title">Probation progress</span>}>
            <Space direction="vertical" size={14} style={{ width: '100%' }}>
              <div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {progress.completed} of {progress.total} evaluations completed
                </Typography.Text>
                <Progress
                  percent={progress.total ? Math.round((progress.completed / progress.total) * 100) : 0}
                  strokeColor="var(--pea-green-600)"
                  showInfo={false}
                />
              </div>
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="Decision">
                  {/* Confirmed → ok, Not Confirmed → crit, an extension → ext,
                      and no decision yet → the informational "In probation". */}
                  {e.confirmation_status ? (
                    <StatusPill
                      tone={
                        e.confirmation_status === 'Confirmed'
                          ? 'ok'
                          : e.confirmation_status === 'Not Confirmed'
                            ? 'crit'
                            : 'ext'
                      }
                    >
                      {e.confirmation_status}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="info">In probation</StatusPill>
                  )}
                  {/* U10 — the reason and date HR gave with "Record decision". */}
                  {record.decisionReason && (
                    <div className="pea-muted pea-small" style={{ marginTop: 6 }}>
                      {record.decisionOn ? `${fmt(record.decisionOn)} · ` : ''}{record.decisionBy ? `${record.decisionBy} · ` : ''}
                      {record.decisionReason}
                    </div>
                  )}
                </Descriptions.Item>
                {/* U11 — the end of the last evaluation's period; an extension moves it. */}
                <Descriptions.Item label="Probation ends">{fmt(probation.endsOn)}</Descriptions.Item>
                {hasLeft && (
                  <Descriptions.Item label="Left">
                    {record.leftOn ? fmt(record.leftOn) : 'Marked as left'}
                    {record.leftReason && <div className="pea-muted pea-small" style={{ marginTop: 6 }}>{record.leftReason}</div>}
                  </Descriptions.Item>
                )}
                <Descriptions.Item label="Next evaluation due">{progress.nextDue ? fmt(progress.nextDue) : '—'}</Descriptions.Item>
                <Descriptions.Item label="Waiting on manager">
                  {progress.awaitingResponse
                    ? <StatusPill tone="warn">{progress.awaitingResponse}</StatusPill>
                    : 0}
                </Descriptions.Item>
                <Descriptions.Item label="Overdue (not yet sent)">
                  {progress.overdue ? <StatusPill tone="crit">{progress.overdue}</StatusPill> : 0}
                </Descriptions.Item>
                <Descriptions.Item label="Evaluations">
                  {hold.heldAsLeaver ? (
                    <Tooltip title="Confirm the exit, or mark them as still here, on the New joiners screen.">
                      <StatusPill tone="crit">Held — Microsoft 365 says they may have left</StatusPill>
                    </Tooltip>
                  ) : e.halt_process ? (
                    <StatusPill tone="warn">On hold by HR</StatusPill>
                  ) : hold.holdLeaversEnabled ? (
                    <Tooltip title="Evaluations stop on their own if the Microsoft 365 check finds this person has left.">
                      <span>Running</span>
                    </Tooltip>
                  ) : (
                    'Running'
                  )}
                </Descriptions.Item>
              </Descriptions>
            </Space>
          </Card>
        </Col>
      </Row>

      {/* R-06 — "whether that new joiner is growing or not" (Subhajit, 13:24)
          is now answered at the top: the trend pill, the stepper's averages and
          the comment grid's ▲▼. This table is the schedule and its actions. */}
      <Card className="pea-card" size="small" title={<span className="pea-section-title">Evaluation schedule</span>}>
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          scroll={{ x: 'max-content' }}
          dataSource={e.cycles}
          columns={[
            {
              title: '#',
              dataIndex: 'seq_no',
              width: 60,
              render: (v, r) => (
                <Space size={4}>
                  <Link to={`/evaluations/${r.id}`} title="Open this evaluation">{v}</Link>
                  {r.is_extension && (
                    <Tooltip title="Extension"><StatusPill tone="ext" nodot>ext</StatusPill></Tooltip>
                  )}
                </Space>
              ),
            },
            {
              title: 'Period',
              width: 200,
              render: (_, r) => `${fmt(r.period_from)} → ${fmt(r.period_to)}`,
            },
            { title: 'Due', dataIndex: 'due_date', width: 110, className: 'pea-num', render: fmt },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 170,
              render: (_, r) => {
                const s = evaluationStatus(r);
                // M7 — an open evaluation that is with an acting manager says so.
                const withActing = r.delegated && ['email_sent', 'opened'].includes(r.status);
                return (
                  <>
                    <StatusPill state={s.key}>{s.label}</StatusPill>
                    {withActing && (
                      <div className="pea-muted pea-small" style={{ marginTop: 4 }}>
                        with {r.sent_to_name || r.sent_to_email}
                      </div>
                    )}
                  </>
                );
                // Before M7: return <StatusPill state={s.key}>{s.label}</StatusPill>;
              },
            },
            {
              title: 'Average',
              dataIndex: 'avg_rating',
              width: 90,
              className: 'pea-num',
              // A rating is a figure to compare down the column, so it is shown
              // as a number in the state colour rather than boxed in a pill.
              render: (v) =>
                v == null ? (
                  '—'
                ) : (
                  <strong style={{ color: `var(--pea-${v >= 3.5 ? 'ok' : v >= 2.5 ? 'info' : 'crit'})` }}>
                    {Number(v).toFixed(2)}
                  </strong>
                ),
            },
            { title: 'Submitted', dataIndex: 'submitted_at', width: 110, className: 'pea-num', render: fmt },
            {
              title: 'Chased',
              dataIndex: 'reminder_count',
              width: 80,
              className: 'pea-num',
              render: (v) => (v ? `${v}×` : '—'),
            },
            {
              title: '',
              width: 120,
              render: (_, r) => {
                if (!['pending', 'email_sent', 'opened'].includes(r.status)) return null;
                if (isArchived) return null; // Archive (07-10-2026) — read-only
                if (e.halt_process) return null;
                // R-02 — the hold has to cover the manual send too, or HR can
                // undo it by accident from the very screen that reports it.
                if (hold.heldAsLeaver) {
                  return (
                    <Tooltip title="On hold — Microsoft 365 shows this person may have left. Resolve it on the New joiners screen first.">
                      <Button size="small" icon={<SendOutlined />} disabled>Send</Button>
                    </Tooltip>
                  );
                }
                // One click used to email a real manager with no confirmation
                // and no indication of who would receive it. The popconfirm
                // names the recipient, because that is the fact worth checking
                // before an evaluation request goes out under HR's name.
                return (
                  <Popconfirm
                    title={r.status === 'pending' ? 'Send this evaluation now?' : 'Send this link again?'}
                    description={
                      <div style={{ maxWidth: 320 }}>
                        Evaluation {r.seq_no} for <strong>{e.full_name}</strong> goes to{' '}
                        <strong>{e.rm_email}</strong>
                        {e.pl_email ? <>, copying {e.pl_email}</> : null}.
                        {/* M7 — a plain send always goes back to the reporting manager. */}
                        {r.delegated && r.status !== 'pending' && (
                          <> It is with <strong>{r.sent_to_name || r.sent_to_email}</strong> now; their link stops working.</>
                        )}
                      </div>
                    }
                    okText={r.status === 'pending' ? 'Send now' : 'Resend now'}
                    cancelText="Cancel"
                    onConfirm={() => resend.mutate(r.seq_no)}
                  >
                    <Button size="small" icon={<SendOutlined />} loading={resend.isPending}>
                      {r.status === 'pending' ? 'Send' : 'Resend'}
                    </Button>
                  </Popconfirm>
                );
              },
            },
          ]}
          expandable={{
            rowExpandable: (r) => r.scores?.length > 0 || !!r.remarks || !!r.legacy_raw,
            expandedRowRender: (r) => (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {/* M3 / U13 — who actually answered, which is not always today's manager. */}
                {r.status === 'completed' && (r.submitted_by_name || r.entered_by) && (
                  <Typography.Text type="secondary">
                    Answered by <strong>{r.submitted_by_name || e.rm_name}</strong>
                    {r.delegated ? ' (acting manager)' : ''}
                    {r.entered_by ? ` · entered by HR (${r.entered_by})` : ''}
                  </Typography.Text>
                )}
                {r.scores?.length > 0 && (
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={r.scores}
                    columns={[
                      { title: 'Parameter', dataIndex: 'param_label', width: 240 },
                      { title: 'Rating', dataIndex: 'rating', width: 80, render: (v) => Number(v) },
                      { title: 'Comment', dataIndex: 'comments', render: (v) => v || '—' },
                    ]}
                  />
                )}
                {r.remarks && (
                  <div>
                    <Typography.Text strong>Overall remarks: </Typography.Text>
                    <Typography.Text>{r.remarks}</Typography.Text>
                  </div>
                )}
                {r.legacy_raw && (
                  <Alert
                    type="info"
                    message="Imported from the original spreadsheet"
                    description={
                      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 13 }}>
                        {r.legacy_raw}
                      </Typography.Paragraph>
                    }
                  />
                )}
              </Space>
            ),
          }}
        />
      </Card>

      {/* L7 — HR's notes. Shown only once the database has the notes table. */}
      {/* Archive (07-10-2026) — read-only while archived. It was:
          <EmployeeNotes employeeId={id} name={e.full_name} /> */}
      <EmployeeNotes employeeId={id} name={e.full_name} readOnly={isArchived} />

      {/* U12 — readable change history: labels in place of column names, one
          date format, and "Show all" past the first 20. */}
      {e.audit?.length > 0 && (
        <Card className="pea-card" size="small" title={<span className="pea-section-title">Change history</span>}>
          <Timeline
            items={(auditAll ? e.audit : e.audit.slice(0, AUDIT_PREVIEW)).map((a) => ({
              children: (
                <Space direction="vertical" size={0}>
                  <Typography.Text>
                    {a.field_name === '*' ? (
                      a.new_value
                    ) : (
                      <>
                        <strong>{AUDIT_LABELS[a.field_name] || a.field_name}</strong> changed from{' '}
                        <em>{auditValue(a.field_name, a.old_value)}</em> to{' '}
                        <em>{auditValue(a.field_name, a.new_value)}</em>
                      </>
                    )}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {a.changed_by || 'system'} · {AUDIT_SOURCES[a.change_source] || a.change_source} · {formatDateTime(a.changed_at)}
                  </Typography.Text>
                </Space>
              ),
            }))}
          />
          {e.audit.length > AUDIT_PREVIEW && (
            <Button type="link" style={{ paddingInline: 0 }} onClick={() => setAuditAll((v) => !v)}>
              {auditAll ? `Show the latest ${AUDIT_PREVIEW} only` : `Show all (${e.audit.length})`}
            </Button>
          )}
        </Card>
      )}
      {/* U12 — the change history before, kept for reference:
      {e.audit?.length > 0 && (
        <Card className="pea-card" size="small" title={<span className="pea-section-title">Change history</span>}>
          <Timeline
            items={e.audit.slice(0, 20).map((a) => ({
              children: (
                <Space direction="vertical" size={0}>
                  <Typography.Text>
                    <strong>{a.field_name}</strong>
                    {a.field_name !== '*' && (
                      <> changed from <em>{a.old_value || '(empty)'}</em> to <em>{a.new_value || '(empty)'}</em></>
                    )}
                    {a.field_name === '*' && <> — {a.new_value}</>}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {a.changed_by || 'system'} · {a.change_source} · {new Date(a.changed_at).toLocaleString()}
                  </Typography.Text>
                </Space>
              ),
            }))}
          />
        </Card>
      )}
      */}

      {/* ── Edit ───────────────────────────────────────────────────────── */}
      <Modal
        title={`Edit ${e.full_name}`}
        open={editOpen}
        onCancel={() => setEditOpen(false)}
        onOk={() => editForm.submit()}
        confirmLoading={save.isPending && !lockPrompt}
        okText="Save"
        width={640}
      >
        <Form form={editForm} layout="vertical" requiredMark={false} onFinish={submitEdit}>
          <Form.Item name="full_name" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="office_email" label="Office email" rules={[{ required: true, type: 'email' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="personal_email" label="Personal email" rules={[{ type: 'email' }]}>
            <Input />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }} wrap>
            <Form.Item
              name="doj"
              label="Date of joining"
              rules={[{ required: true }]}
              extra="Changing this moves every evaluation not yet sent."
              style={{ minWidth: 220 }}
            >
              <DatePicker style={{ width: '100%' }} format={DATE_FORMAT} />
            </Form.Item>
            <Form.Item
              name="is_experienced"
              label="Fresher or experienced"
              rules={[{ required: true }]}
              extra="Changes the cadence for evaluations not yet sent."
            >
              <Radio.Group optionType="button" buttonStyle="solid">
                <Radio.Button value={false}>Fresher</Radio.Button>
                <Radio.Button value>Experienced</Radio.Button>
              </Radio.Group>
            </Form.Item>
          </Space>
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
          {/* M3 — say what a manager change does before it is saved. */}
          {managerEmailChanged && openLinks.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 14 }}
              message={`${openLinks.length} open evaluation link${openLinks.length === 1 ? '' : 's'} will move to the new manager`}
              description={
                <>
                  Evaluation {openLinks.map((c) => c.seq_no).join(', ')} {openLinks.length === 1 ? 'is' : 'are'} with{' '}
                  {e.rm_name || e.rm_email} now. On Save {openLinks.length === 1 ? 'that link stops' : 'those links stop'} working and{' '}
                  {openLinks.length === 1 ? 'a new one is' : 'new ones are'} emailed to {editingRmEmail}. A draft the previous manager saved is discarded.
                 Evaluations already submitted stay under the name of whoever answered them.
                </>
              }
            />
          )}
          <Form.Item
            name="pl_email"
            label="Project leader email"
            rules={[{ required: true, type: 'email' }]}
            // Checked on leaving the box: while a name is being typed to search,
            // "not a valid email" would be noise.
            validateTrigger="onBlur"
            extra={plNote || undefined}
          >
            <PersonPicker field="email" placeholder="Type a name, or the email" />
          </Form.Item>
          {/* U10 — removed from Edit, kept for reference. One dropdown could end a
              probation with no reason and no date, and "Extend" chosen here
              scheduled nothing (B3). A decision is recorded with "Record
              decision…" and an exit with More → "Mark as left…".

          <Space size={16} style={{ display: 'flex' }} wrap>
            <Form.Item name="confirmation_status" label="Confirmation status" style={{ minWidth: 240 }}>
              <Select
                allowClear
                placeholder="In probation"
                options={CONFIRMATION_OPTIONS.map((v) => ({ value: v, label: v }))}
              />
            </Form.Item>
            <Form.Item name="employment_status" label="Employment" style={{ minWidth: 160 }}>
              <Select options={[{ value: 'active', label: 'Active' }, { value: 'left', label: 'Left' }]} />
            </Form.Item>
          </Space>
          */}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            The probation decision and “left” are not edited here. Use <strong>Record decision…</strong> on the
            page, or <strong>More → Mark as left…</strong> — each asks for a reason and a date.
          </Typography.Text>
        </Form>
      </Modal>

      {/* ── Archive and Restore — Archive (07-10-2026) ─────────────────── */}
      <Modal
        title={`Archive ${e.full_name}`}
        open={archiveOpen}
        onCancel={() => setArchiveOpen(false)}
        onOk={() => archiveMut.mutate()}
        confirmLoading={archiveMut.isPending}
        okText="Archive"
        width={560}
      >
        <Typography.Paragraph>
          Their probation is over ({hasLeft ? 'left' : e.confirmation_status}). Archiving moves them out of the
          Commandos list, the Evaluations board, the Dashboard, Trends and their manager’s team link, and stops
          the Microsoft 365 checks for them. Nothing is deleted: the record stays, read-only, under Commandos →
          Status → Archived, and Restore brings them back.
        </Typography.Paragraph>
        <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
          PEA does this by itself the morning after a decision or an exit; this is for doing it now.
        </Typography.Text>
        <Input.TextArea
          style={{ marginTop: 12 }}
          value={archiveReason}
          onChange={(ev) => setArchiveReason(ev.target.value)}
          maxLength={500}
          showCount
          autoSize={{ minRows: 2, maxRows: 5 }}
          placeholder="Reason (optional)"
          aria-label="Reason for archiving"
        />
      </Modal>

      <Modal
        title={`Restore ${e.full_name} from the archive?`}
        open={restoreOpen}
        onCancel={() => setRestoreOpen(false)}
        onOk={() => restoreMut.mutate()}
        confirmLoading={restoreMut.isPending}
        okText="Restore"
        width={520}
      >
        They come back into the Commandos list, the board, the Dashboard and Trends, and their record can be
        changed again. PEA will not archive them again by itself unless a new decision or exit is recorded.
      </Modal>

      {/* ── Resume after a hold — B5 / U9 ─────────────────────────────── */}
      <Modal
        title={`Resume evaluations for ${e.full_name}`}
        open={resumeOpen}
        onCancel={() => setResumeOpen(false)}
        onOk={() => toggleHalt.mutate({ halt: false, past_due_action: pastDueAction(resumeChoice) })}
        confirmLoading={toggleHalt.isPending}
        okText="Resume evaluations"
        width={600}
      >
        <PastDueChoice
          count={pastDueCount}
          value={resumeChoice}
          onChange={setResumeChoice}
          manager={e.rm_name || 'the manager'}
        />
      </Modal>

      {/* ── Record decision — U10, and the fix for B3 ─────────────────── */}
      <Modal
        title={`Record a decision for ${e.full_name}`}
        open={decisionOpen}
        onCancel={() => setDecisionOpen(false)}
        onOk={() => decisionForm.submit()}
        confirmLoading={recordDecision.isPending}
        okText="Record decision"
        width={600}
      >
        {probation.extensionsLeft < 2 && (
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 14 }}
            message={
              probation.extensionsLeft === 0
                ? 'This probation has reached its 8-month limit, so it can only be confirmed or not confirmed.'
                : 'This probation can be extended by one more month at most — it cannot run past 8 months.'
            }
          />
        )}
        <Form
          form={decisionForm}
          layout="vertical"
          requiredMark={false}
          onFinish={(v) => recordDecision.mutate({
            decision: v.decision === CLEAR_DECISION ? '' : v.decision,
            reason: v.reason,
            date: v.date ? v.date.format('YYYY-MM-DD') : undefined,
          })}
        >
          <Form.Item name="decision" label="Decision" rules={[{ required: true, message: 'Choose a decision' }]}>
            <Radio.Group>
              <Space direction="vertical" size={8}>
                {probation.decisionOptions.map((d) => (
                  <Radio key={d} value={d}>
                    <strong>{d}</strong> <span className="pea-muted">— {DECISION_HELP[d]}</span>
                  </Radio>
                ))}
                {e.confirmation_status && (
                  <Radio value={CLEAR_DECISION}>
                    <strong>Back to in probation</strong>{' '}
                    <span className="pea-muted">— clear the recorded decision. An extension evaluation not yet sent is withdrawn.</span>
                  </Radio>
                )}
              </Space>
            </Radio.Group>
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.decision !== b.decision}>
            {({ getFieldValue }) => {
              const optional = getFieldValue('decision') === 'Confirmed';
              return (
                <Form.Item
                  name="reason"
                  label="Reason"
                  rules={[{ required: !optional, whitespace: !optional, message: 'Give a reason — it goes on the record' }]}
                  extra={optional ? 'Optional for a confirmation.' : 'Required. It is kept on the record and shown in the change history.'}
                >
                  <Input.TextArea rows={3} maxLength={2000} showCount />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item name="date" label="Decision date" rules={[{ required: true, message: 'Choose the date' }]}>
            <DatePicker format={DATE_FORMAT} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Mark as left / active again — U10 ─────────────────────────── */}
      <Modal
        title={leftMode === 'active' ? `Mark ${e.full_name} as active again?` : `Mark ${e.full_name} as left?`}
        open={!!leftMode}
        onCancel={() => setLeftMode(null)}
        onOk={() => leftForm.submit()}
        confirmLoading={markLeft.isPending}
        okText={leftMode === 'active' ? 'Mark as active' : 'Mark as left'}
        okButtonProps={{ danger: leftMode === 'left' }}
      >
        <Alert
          type={leftMode === 'active' ? 'info' : 'warning'}
          showIcon
          style={{ marginBottom: 14 }}
          message={leftMode === 'active' ? 'Evaluations that were closed stay closed' : 'Evaluations stop straight away'}
          description={
            leftMode === 'active'
              ? 'Send the ones still wanted again from the evaluation schedule. Nothing goes to the manager on its own.'
              : 'Open evaluations are closed and the links already with the manager stop working. The history is kept, and no further email is sent.'
          }
        />
        <Form
          form={leftForm}
          layout="vertical"
          requiredMark={false}
          onFinish={(v) => markLeft.mutate({
            mode: leftMode,
            reason: v.reason,
            left_on: leftMode === 'left' && v.left_on ? v.left_on.format('YYYY-MM-DD') : undefined,
          })}
        >
          {leftMode === 'left' && (
            <Form.Item name="left_on" label="Last working day" rules={[{ required: true, message: 'Choose the date' }]}>
              <DatePicker format={DATE_FORMAT} allowClear={false} disabledDate={(d) => d.isAfter(dayjs(), 'day')} />
            </Form.Item>
          )}
          <Form.Item
            name="reason"
            label="Reason"
            rules={[{ required: true, whitespace: true, message: 'Give a reason — it goes on the record' }]}
          >
            <Input.TextArea rows={3} maxLength={2000} showCount />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Keep my value / Just this once — plan §6.5 ─────────────────── */}
      <Modal
        title="This value comes from Microsoft 365"
        open={!!lockPrompt}
        onCancel={() => setLockPrompt(null)}
        footer={[
          <Button key="cancel" onClick={() => setLockPrompt(null)}>Cancel</Button>,
          <Button
            key="once"
            loading={save.isPending}
            onClick={() => save.mutate(lockPrompt.payload)}
          >
            Just this once
          </Button>,
          <Button
            key="keep"
            type="primary"
            icon={<LockOutlined />}
            loading={save.isPending}
            onClick={() => save.mutate({ ...lockPrompt.payload, lock_fields: lockPrompt.fields })}
          >
            Keep my value
          </Button>,
        ]}
      >
        <Typography.Paragraph>
          You changed{' '}
          <strong>{(lockPrompt?.fields || []).map((f) => azure.fields[f]?.label || f).join(' and ')}</strong>, which
          comes from Microsoft 365.
        </Typography.Paragraph>
        <ul style={{ paddingLeft: 18 }}>
          <li><strong>Keep my value</strong> — Microsoft 365 will never overwrite it. You can unlock it later.</li>
          <li><strong>Just this once</strong> — saved now, but PEA may later put the Microsoft 365 value back.</li>
        </ul>
        <Typography.Text type="secondary">
          If Microsoft 365 itself is wrong, use <em>Report to IT</em> afterwards so it is fixed at source too.
        </Typography.Text>
      </Modal>

      {/* ── Employee self-view link ────────────────────────────────────── */}
      <Modal title="Commando link" open={!!selfLink} onCancel={() => setSelfLink(null)} footer={null}>
        {selfLink && (
          <>
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 12 }}
              message={`Shows: ${selfLink.level}`}
              description={
                {
                  schedule: 'Evaluation dates and status only — no ratings.',
                  averages: 'Dates, status, average rating per evaluation, and the final decision.',
                  full: 'Everything above, plus per-parameter ratings and the manager’s comments.',
                }[selfLink.level]
              }
            />
            <Typography.Paragraph copyable={{ text: selfLink.url }} style={{ wordBreak: 'break-all' }}>
              {selfLink.url}
            </Typography.Paragraph>
            <Typography.Text type="secondary">
              Valid until {fmt(selfLink.expiresAt)}. PEA does not email it — share it
              directly. It stops working immediately if self-view is switched off or the Commando is marked as having left.
            </Typography.Text>
          </>
        )}
      </Modal>

      {/* ── Delete employee — admin only, for demo and test records ───── */}
      <Modal
        title={`Delete ${e.full_name}?`}
        open={deleteOpen}
        onCancel={() => setDeleteOpen(false)}
        onOk={() => remove.mutate()}
        confirmLoading={remove.isPending}
        okText="Delete permanently"
        okButtonProps={{ danger: true, disabled: normName(deleteName) !== normName(e.full_name) }}
      >
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message="This cannot be undone"
          description="The Commando, every evaluation, all ratings and the change history are removed. If this person really left, use More → Mark as left instead — that keeps their history."
        />
        <Typography.Paragraph>
          Type <strong>{e.full_name}</strong> to confirm:
        </Typography.Paragraph>
        <Input
          value={deleteName}
          onChange={(ev) => setDeleteName(ev.target.value)}
          placeholder={e.full_name}
          onPressEnter={() => normName(deleteName) === normName(e.full_name) && remove.mutate()}
        />
      </Modal>

      {/* ── Report to IT — plan §6.5 Part 3 ────────────────────────────── */}
      <Modal
        title="Report a wrong value to IT"
        open={!!reportField}
        onCancel={() => setReportField(null)}
        onOk={() => reportForm.submit()}
        confirmLoading={report.isPending}
        okText="Send to IT"
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 14 }}
          message="Outside production this reaches the test inbox only"
          description="Staging never emails the real IT team."
        />
        <Form form={reportForm} layout="vertical" requiredMark={false} onFinish={(v) => report.mutate(v)}>
          <Form.Item name="field" hidden><Input /></Form.Item>
          <Form.Item label="Field">
            <Input value={azure.fields[reportField]?.label} disabled />
          </Form.Item>
          <Form.Item label="Microsoft 365 currently holds">
            <Input value={azure.fields[reportField]?.azureValue || '(blank)'} disabled />
          </Form.Item>
          <Form.Item name="correct_value" label="Correct value" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="note" label="Note for IT">
            <Input.TextArea rows={3} maxLength={2000} showCount />
          </Form.Item>
        </Form>
      </Modal>

      <ShareReportModal
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        employee={e}
        progress={progress}
      />
    </>
  );
}
