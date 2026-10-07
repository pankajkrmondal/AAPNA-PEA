import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Input, Select, Space, Button, Typography, Modal, Form, DatePicker,
  Switch, App, Progress, Alert, Descriptions, Tooltip,
} from 'antd';
import { PlusOutlined, SearchOutlined, DownloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { unwrap } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';
import { formatDate, DATE_FORMAT } from '../formatDate.js';
import PastDueChoice, { PAST_DUE_DEFAULT, pastDueAction } from '../components/PastDueChoice.jsx';
import PersonPicker, { useManagerPick } from '../components/PersonPicker.jsx';

const { Option } = Select;

/**
 * U5 — the "Status" filter. The values are the ones the API takes
 * (employee.service.js LIST_STATES); it used to offer the decision only, so
 * nobody could ask the list who was on hold or who had left.
 */
const STATE_OPTIONS = [
  { value: 'in_probation', label: 'In probation' },
  { value: 'extended', label: 'Extended' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'not_confirmed', label: 'Not Confirmed' },
  { value: 'paused', label: 'Paused' },
  { value: 'held', label: 'Held (may have left)' },
  { value: 'left', label: 'Left' },
  // Archive (07-10-2026) — probation over, out of the day-to-day lists.
  { value: 'archived', label: 'Archived' },
];

export default function Employees() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  // U7 — the box types freely; the list is asked for once typing has paused,
  // not on every keystroke. Same 350 ms the board's search uses.
  const [searchText, setSearchText] = useState('');
  useEffect(() => {
    const t = setTimeout(() => {
      const settled = searchText.trim();
      if (settled !== search) { setSearch(settled); setPage(1); }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);
  const [type, setType] = useState();
  // U5 — `status` held a decision (confirmation_status); the filter is one of
  // STATE_OPTIONS now, and there is a manager filter beside it.
  // const [status, setStatus] = useState();
  // Archive (07-10-2026) — the "N archived" link on the Dashboard and the bell
  // open this list on ?state=archived. It was: useState();
  const [params] = useSearchParams();
  const [state, setState] = useState(() => {
    const s = params.get('state');
    return STATE_OPTIONS.some((o) => o.value === s) ? s : undefined;
  });
  const [rm, setRm] = useState();
  // U6 — { field, order } once a column heading is clicked; newest first until then.
  const [sort, setSort] = useState(null);
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  // B5 / U9 — what to do with evaluations already past due on the joining date entered.
  const [pastDue, setPastDue] = useState(PAST_DUE_DEFAULT);
  const [form] = Form.useForm();
  // U8 — choosing a manager by name fills their email and suggests the project leader.
  const { onPickManager, plNote, clearPlNote } = useManagerPick(form);

  // U5 / U6 — what the list is narrowed and ordered by. The export sends the
  // same, so the file is the list on screen and not something else.
  const filters = {
    search: search || undefined,
    type,
    state,
    rm,
    sort: sort?.field,
    order: sort?.order,
  };

  const { data, isLoading } = useQuery({
    queryKey: ['employees', search, type, state, rm, sort?.field, sort?.order, page],
    queryFn: () =>
      api
        // U5 — was: params: { search: search || undefined, type, confirmation_status: status, page, limit: 25 }
        .get('/employees', { params: { ...filters, page, limit: 25 } })
        .then((r) => r.data),
  });

  // U5 — every reporting manager, for the manager filter.
  const { data: managers } = useQuery({
    queryKey: ['employee-managers'],
    queryFn: () => api.get('/employees/managers').then(unwrap),
    staleTime: 60_000,
  });
  const managerOptions = (managers || []).map((m) => ({
    value: m.email,
    label: `${m.name || m.email} (${m.people})`,
  }));

  /**
   * U6 — the list as a file. Fetched through the API client so the JWT goes
   * with it; opening the URL directly would send no Authorization header.
   */
  const exportList = useMutation({
    mutationFn: () => api.get('/employees/export', { params: filters, responseType: 'blob' }),
    onSuccess: (res) => {
      const name = /filename="([^"]+)"/.exec(res.headers['content-disposition'] || '')?.[1]
        || `Commandos - ${formatDate(new Date())}.xlsx`;
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  /** U6 — antd reports a sort as 'ascend' / 'descend' / nothing; the API takes asc / desc. */
  const sortOrderOf = (field) =>
    sort?.field === field ? (sort.order === 'desc' ? 'descend' : 'ascend') : null;

  const onTableChange = (pagination, _filters, sorter) => {
    const s = Array.isArray(sorter) ? sorter[0] : sorter;
    const next = s?.order ? { field: s.columnKey, order: s.order === 'descend' ? 'desc' : 'asc' } : null;
    const changed = (next?.field || null) !== (sort?.field || null) || (next?.order || null) !== (sort?.order || null);
    setSort(next);
    // A new order starts again from the first page; otherwise it is a page turn.
    setPage(changed ? 1 : pagination.current);
  };


  const create = useMutation({
    mutationFn: (values) => api.post('/employees', values).then(unwrap),
    onSuccess: (emp) => {
      const closed = emp.cycles.filter((c) => c.status === 'skipped').length;
      message.success(
        `${emp.full_name} added — ${emp.cycles.length} evaluations scheduled` +
          (closed ? `, ${closed} past-due closed as history` : '')
      );
      setAddOpen(false);
      setPreview(null);
      setPastDue(PAST_DUE_DEFAULT);
      clearPlNote();
      form.resetFields();
      qc.invalidateQueries({ queryKey: ['employees'] });
      qc.invalidateQueries({ queryKey: ['employee-managers'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  // Shows the exact dates before saving. The cadence rule was previously
  // invisible — HR had no way to see when evaluations would land.
  const previewSchedule = async () => {
    const { doj, is_experienced } = form.getFieldsValue();
    if (!doj) return;
    const rows = await api
      .post('/employees/preview-schedule', {
        doj: dayjs(doj).format('YYYY-MM-DD'),
        is_experienced: !!is_experienced,
      })
      .then(unwrap);
    setPreview(rows);
  };

  // U6 — Name, DOJ, Reporting manager and Status sort on the server (the list
  // is paged, so sorting the 25 rows on screen would be a lie). "Next due" does
  // not: it is worked out from each person's evaluations.
  const columns = [
    {
      title: 'Name',
      dataIndex: 'full_name',
      key: 'name',
      sorter: true,
      sortOrder: sortOrderOf('name'),
      render: (v, r) => (
        <Space direction="vertical" size={0}>
          <Link to={`/employees/${r.id}`}>{v}</Link>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.office_email}</Typography.Text>
        </Space>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'is_experienced',
      width: 110,
      render: (v) => <StatusPill tone="mute" nodot>{v ? 'Experienced' : 'Fresher'}</StatusPill>,
    },
    // H6 / U4 — was: render: (v) => String(v).slice(0, 10)
    {
      title: 'DOJ',
      dataIndex: 'doj',
      key: 'doj',
      width: 120,
      className: 'pea-num',
      sorter: true,
      sortOrder: sortOrderOf('doj'),
      render: (v) => formatDate(v),
    },
    {
      title: 'Reporting manager',
      dataIndex: 'rm_name',
      key: 'manager',
      sorter: true,
      sortOrder: sortOrderOf('manager'),
    },
    /* U6 — the two columns before they could be sorted, kept for reference:
    { title: 'DOJ', dataIndex: 'doj', width: 110, className: 'pea-num', render: (v) => formatDate(v) },
    { title: 'Reporting manager', dataIndex: 'rm_name' },
    */
    {
      title: 'Progress',
      width: 160,
      render: (_, r) => {
        const p = r.progress;
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Progress
              percent={p.total ? Math.round((p.completed / p.total) * 100) : 0}
              size="small"
              format={() => `${p.completed}/${p.total}`}
            />
            {p.overdue > 0 && <StatusPill tone="crit">{p.overdue} overdue</StatusPill>}
            {p.awaitingResponse > 0 && (
              <StatusPill tone="warn">{p.awaitingResponse} awaiting</StatusPill>
            )}
          </Space>
        );
      },
    },
    {
      title: 'Next due',
      dataIndex: ['progress', 'nextDue'],
      width: 110,
      className: 'pea-num',
      render: (v) => formatDate(v),
    },
    {
      title: 'Status',
      dataIndex: 'confirmation_status',
      key: 'status',
      width: 190,
      sorter: true,
      sortOrder: sortOrderOf('status'),
      // U5 — the pill is as it was; under it, who Microsoft 365 says may have
      // left, so the "Held" filter shows why each row is there.
      render: (v, r) => (
        <Space direction="vertical" size={2}>
          {/* Archive (07-10-2026) — an archived row (found by search, or under the
              Archived filter) says so, with the decision it ended on. */}
          {r.archived ? (
            <Tooltip title={`Probation over — ${r.employment_status === 'left' ? 'left' : r.confirmation_status || 'decided'}. Read-only; restore from their page.`}>
              <StatusPill tone="mute">Archived</StatusPill>
            </Tooltip>
          ) : r.halt_process ? (
            <StatusPill tone="warn">Paused</StatusPill>
          ) : r.employment_status === 'left' ? (
            <StatusPill tone="mute">Left</StatusPill>
          ) : v ? (
            <StatusPill tone={v === 'Confirmed' ? 'ok' : v === 'Not Confirmed' ? 'crit' : 'ext'}>
              {v}
            </StatusPill>
          ) : (
            <StatusPill tone="info">In probation</StatusPill>
          )}
          {r.mayHaveLeft && (
            <Tooltip
              title={
                r.heldAsLeaver
                  ? 'Microsoft 365 shows this account switched off and unlicensed, or removed, so evaluations have stopped. Confirm the exit, or mark them as still here, on the New joiners screen.'
                  : 'Microsoft 365 shows this account switched off and unlicensed, or removed. Confirm the exit, or mark them as still here, on the New joiners screen.'
              }
            >
              <StatusPill tone="crit">{r.heldAsLeaver ? 'Held — may have left' : 'May have left'}</StatusPill>
            </Tooltip>
          )}
        </Space>
      ),
    },
    /* U5 / U6 — the Status column before the "may have left" line and the
       sort, kept for reference:
    {
      title: 'Status',
      dataIndex: 'confirmation_status',
      width: 150,
      render: (v, r) =>
        r.halt_process ? (
          <StatusPill tone="warn">Paused</StatusPill>
        ) : r.employment_status === 'left' ? (
          <StatusPill tone="mute">Left</StatusPill>
        ) : v ? (
          <StatusPill tone={v === 'Confirmed' ? 'ok' : v === 'Not Confirmed' ? 'crit' : 'ext'}>
            {v}
          </StatusPill>
        ) : (
          <StatusPill tone="info">In probation</StatusPill>
        ),
    },
    */
  ];

  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>Commandos</h2>
          <p>Everyone on a probation schedule, and where each one has got to</p>
        </div>
        <Space wrap>
          {/* U6 — the list below as a file: same filters, same order. */}
          <Tooltip title="Download the Commandos listed below as an Excel workbook — the same filters and the same order.">
            <Button
              icon={<DownloadOutlined />}
              loading={exportList.isPending}
              disabled={!data?.pagination?.total}
              onClick={() => exportList.mutate()}
            >
              Export
            </Button>
          </Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>Add Commando</Button>
        </Space>
      </div>

      <Card className="pea-card" size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            placeholder="Search name, email or manager"
            prefix={<SearchOutlined />}
            allowClear
            style={{ width: 280 }}
            value={searchText}
            // U7 — was: onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <Select placeholder="Type" allowClear style={{ width: 150 }} onChange={(v) => { setType(v); setPage(1); }}>
            <Option value="fresher">Fresher</Option>
            <Option value="experienced">Experienced</Option>
          </Select>
          {/* U5 — status covers paused, held and left as well as the decision. */}
          <Select
            placeholder="Status"
            allowClear
            style={{ width: 200 }}
            value={state}
            options={STATE_OPTIONS}
            onChange={(v) => { setState(v); setPage(1); }}
          />
          {/* U5 — everyone who reports to one manager. */}
          <Select
            placeholder="All managers"
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ minWidth: 220 }}
            popupMatchSelectWidth={false}
            value={rm}
            options={managerOptions}
            onChange={(v) => { setRm(v); setPage(1); }}
          />
          {/* U5 — the Status filter before, kept for reference. It offered the
              decision only, and sent it as `confirmation_status`.

          <Select placeholder="Status" allowClear style={{ width: 180 }} onChange={(v) => { setStatus(v); setPage(1); }}>
            <Option value="pending">In probation</Option>
            <Option value="Confirmed">Confirmed</Option>
            <Option value="Not Confirmed">Not Confirmed</Option>
            <Option value="Extend for 1 month">Extended 1 month</Option>
            <Option value="Extend for 2 months">Extended 2 months</Option>
          </Select>
          */}
        </Space>

        <Table
          rowKey="id"
          size="small"
          loading={isLoading}
          dataSource={data?.data || []}
          columns={columns}
          // U6 — one handler for a page turn and a column sort. The pager had
          // its own `onChange: setPage`, which is commented out below.
          onChange={onTableChange}
          pagination={{
            current: page,
            pageSize: 25,
            total: data?.pagination?.total || 0,
            // onChange: setPage,
            showSizeChanger: false,
            showTotal: (t) => `${t} Commando(s)`,
          }}
        />
      </Card>

      {/* Add employee */}
      <Modal
        title="Add Commando"
        open={addOpen}
        onCancel={() => { setAddOpen(false); setPreview(null); clearPlNote(); }}
        onOk={() => form.submit()}
        confirmLoading={create.isPending}
        okText="Add and schedule"
        width={620}
      >
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          onFinish={(v) => create.mutate({
            ...v,
            doj: dayjs(v.doj).format('YYYY-MM-DD'),
            // B5 / U9 — only when something is already past due; otherwise nothing to choose.
            ...((preview || []).some((p) => p.past_due) ? { past_due_action: pastDueAction(pastDue) } : {}),
          })}
          onValuesChange={(changed) => {
            if ('doj' in changed || 'is_experienced' in changed) previewSchedule();
          }}
        >
          <Form.Item name="full_name" label="Full name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="office_email" label="Office email" rules={[{ required: true, type: 'email' }]}>
            <Input placeholder="name@aapnainfotech.com" />
          </Form.Item>
          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item name="doj" label="Date of joining" rules={[{ required: true }]} style={{ flex: 1 }}>
              {/* A real date picker: the free-text DOJ is what broke the old
                  system, so the format can no longer be got wrong. */}
              <DatePicker style={{ width: '100%' }} format={DATE_FORMAT} />
            </Form.Item>
            <Form.Item name="is_experienced" label="Experienced" valuePropName="checked" initialValue={false}>
              <Switch checkedChildren="Yes" unCheckedChildren="No" />
            </Form.Item>
          </Space>
          {/* U8 — pick the manager from Microsoft 365 by name: the email comes
              with them and the project leader is suggested. Typing still works.
              The three boxes were plain <Input />s. */}
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
            extra={plNote || undefined}
          >
            <PersonPicker field="email" placeholder="Type a name, or the email" />
          </Form.Item>

          {/* B5 / U9 — a joining date in the past puts evaluations in the past too. */}
          <PastDueChoice
            count={(preview || []).filter((p) => p.past_due).length}
            value={pastDue}
            onChange={setPastDue}
            manager={form.getFieldValue('rm_name') || 'the manager'}
          />

          {preview && (
            <Alert
              type="info"
              message={`${preview.length} evaluations will be scheduled`}
              description={
                <Space wrap size={[6, 6]}>
                  {preview.map((p) => (
                    <Tag key={p.seq_no} color={p.past_due ? 'orange' : undefined}>#{p.seq_no} · {formatDate(p.due_date)}{p.past_due ? ' · past' : ''}</Tag>
                  ))}
                </Space>
              }
            />
          )}
        </Form>
      </Modal>

    </>
  );
}
