/**
 * EvaluationBoard — "What every manager said".
 *
 * Status, the overall comment and every question comment — for every
 * evaluation, on one screen. Until now reading what a manager wrote meant
 * opening an employee, expanding a row of a table, and doing that once per
 * person.
 *
 * Two views of one list:
 *
 *   · Cards — for READING. With no status picked, three sections: what needs
 *     attention, what just came back, and what is still with a manager.
 *   · Table — for bulk work: scanning, selecting and reminding. Every row opens
 *     the same evaluation profile the card does.
 *
 * Everything the reader chooses lives in the URL, so Back returns to the list
 * as it was, the Dashboard can link to one chip, and a view can be shared.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  App, Button, DatePicker, Empty, Input, Pagination, Popconfirm, Segmented, Select, Space, Table, Tooltip,
} from 'antd';
import {
  AppstoreOutlined, ArrowRightOutlined, BellOutlined, FlagOutlined, RightOutlined, SearchOutlined,
  UnorderedListOutlined, MailOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import api, { unwrap } from '../api.js';
import StatusPill from '../components/StatusPill.jsx';
import {
  Avatar, BucketPill, CardSkeleton, EvaluationCard, LoadProblem, ProgressCard,
} from '../components/board/BoardParts.jsx';
import { BUCKETS, LEGACY_SCOPE, avg, decisionTone, ratingTone, shortDate } from '../evaluationDisplay.js';
import { useCrumbs } from '../crumbs.jsx';

const { RangePicker } = DatePicker;

/** Filters carried from the board into the profile, so Previous / Next walk the same list. */
const CARRY = ['search', 'rm', 'cohort', 'from', 'to'];

const PAGE_SIZE = { cards: 24, table: 50 };

/**
 * The monthly average over the last six months, as a small line under
 * "Average rating". Absent or a single month draws nothing.
 * @param {{points?: {month: string, average: number}[]}} props
 */
function TrendLine({ points }) {
  if (!points || points.length < 2) return null;
  const w = 64;
  const h = 22;
  const x = (i) => 2 + (i * (w - 4)) / (points.length - 1);
  const y = (v) => h - 2 - ((v - 1) / 4) * (h - 4);
  const last = points.at(-1);
  return (
    <svg className="pea-figure-trend" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img"
      aria-label={`Monthly average, ${points[0].month} to ${last.month}: ${points.map((p) => avg(p.average)).join(', ')}`}>
      <polyline points={points.map((p, i) => `${x(i)},${y(p.average)}`).join(' ')} />
      <circle cx={x(points.length - 1)} cy={y(last.average)} r="2.5" />
    </svg>
  );
}

/** The status a card's profile link should walk: a section's rows are all "submitted" or their own bucket. */
function walkStatus(row, status) {
  if (status !== 'all') return status;
  return row.bucket;
}

export default function EvaluationBoard() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  useCrumbs([{ label: 'Evaluations', to: '/evaluations' }, { label: 'Board' }]);

  // An old Overview or notification link: ?scope=waiting&employee=Name.
  useEffect(() => {
    if (!params.has('scope') && !params.has('employee')) return;
    const next = new URLSearchParams(params);
    const scope = next.get('scope');
    if (scope) next.set('status', LEGACY_SCOPE[scope] || 'all');
    if (next.get('employee')) next.set('search', next.get('employee'));
    next.delete('scope');
    next.delete('employee');
    setParams(next, { replace: true });
  }, [params, setParams]);

  const status = params.get('status') || 'all';
  const view = params.get('view') === 'table' ? 'table' : 'cards';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const filters = Object.fromEntries(CARRY.map((k) => [k, params.get(k) || undefined]));

  const set = (patch, { keepPage = false } = {}) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null || v === '' || (k === 'status' && v === 'all') || (k === 'view' && v === 'cards')) {
        next.delete(k);
      } else {
        next.set(k, String(v));
      }
    }
    if (!keepPage) next.delete('page');
    setParams(next, { replace: true });
  };

  // The search box types freely and settles into the URL after a pause.
  const [searchText, setSearchText] = useState(filters.search || '');
  useEffect(() => setSearchText(params.get('search') || ''), [params]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((searchText || '') !== (params.get('search') || '')) set({ search: searchText.trim() });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  const sectioned = view === 'cards' && status === 'all';
  const query = {
    ...filters,
    status,
    sections: sectioned ? 1 : undefined,
    page,
    limit: PAGE_SIZE[view],
  };

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ['board', query],
    queryFn: () => api.get('/evaluations/board', { params: query }).then(unwrap),
    placeholderData: (p) => p,
  });

  const [selected, setSelected] = useState([]);
  const remind = useMutation({
    mutationFn: (ids) => api.post('/evaluations/remind', { ids }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      (res.data?.skipped || []).forEach((s) => message.warning(`${s.who}: ${s.reason}`, 6));
      setSelected([]);
      qc.invalidateQueries({ queryKey: ['board'] });
      qc.invalidateQueries({ queryKey: ['needs-action'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  /** The profile link for a row, carrying the list it came from. */
  const profileLink = (row) => {
    const q = new URLSearchParams();
    q.set('status', walkStatus(row, status));
    for (const k of CARRY) if (filters[k]) q.set(k, filters[k]);
    return `/evaluations/${row.id}?${q}`;
  };

  const counts = data?.counts || {};
  const stats = data?.stats || {};

  const chips = [
    { key: 'all', label: 'All', count: counts.all },
    ...BUCKETS.map((b) => ({ key: b.key, label: b.label, count: counts[b.key], tone: b.tone })),
  ];

  const managerOptions = useMemo(
    () => (data?.managers || []).map((m) => ({ value: m.email, label: `${m.name || m.email} (${m.people})` })),
    [data?.managers]
  );

  if (isError && !data) {
    return (
      <div className="pea-card pea-card-pad">
        <LoadProblem error={error} onRetry={refetch} what="The board" />
      </div>
    );
  }

  return (
    <div className="pea-board">
      {/* ── Heading and the four figures ─────────────────────────────── */}
      <section className="pea-board-hero">
        <div>
          <div className="pea-eyebrow">Probation evaluations</div>
          <h2 className="pea-display">What every manager said</h2>
          <p className="pea-lead">
            Status, the overall comment and every question comment — for every evaluation, on one screen.
          </p>
        </div>
        <div className="pea-figures">
          <button type="button" className="pea-figure" onClick={() => set({ status: 'submitted' })}>
            <strong>{stats.submitted ?? '—'}</strong><span>Submitted</span>
          </button>
          <button type="button" className="pea-figure" onClick={() => set({ status: 'waiting' })}>
            <strong>{stats.waitingForManager ?? '—'}</strong><span>Waiting for manager</span>
          </button>
          <button type="button" className="pea-figure" onClick={() => set({ status: 'attention' })}>
            <strong className={stats.needAttention ? 'pea-ink-crit' : ''}>{stats.needAttention ?? '—'}</strong>
            <span>Need attention</span>
          </button>
          <div className="pea-figure pea-figure--static">
            <strong>{stats.averageRating == null ? '—' : avg(stats.averageRating)}</strong><span>Average rating</span>
            <TrendLine points={stats.averageTrend} />
          </div>
        </div>
      </section>

      {/* Chips and filters stay in reach down a long board. */}
      <div className="pea-board-controls">
        {/* ── Status chips ─────────────────────────────────────────────── */}
        <div className="pea-chips" role="tablist" aria-label="Status">
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              role="tab"
              aria-selected={status === c.key}
              className={`pea-chip${status === c.key ? ' is-active' : ''}`}
              onClick={() => { set({ status: c.key }); setSelected([]); }}
            >
              {c.tone && <span className={`pea-chip-dot pea-bg-${c.tone}`} />}
              {c.label}
              <span className="pea-chip-count">{c.count ?? 0}</span>
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={status === 'attention'}
            className={`pea-chip pea-chip--attention${status === 'attention' ? ' is-active' : ''}`}
            onClick={() => { set({ status: 'attention' }); setSelected([]); }}
          >
            <FlagOutlined /> Needs attention <span className="pea-chip-count">{counts.attention ?? 0}</span>
          </button>
        </div>

        {/* ── Filters ─────────────────────────────────────────────────── */}
        <div className="pea-filters">
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="Search employee or manager…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="pea-filter-search"
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="All managers"
            value={filters.rm}
            onChange={(v) => set({ rm: v })}
            options={managerOptions}
            className="pea-filter-select"
            popupMatchSelectWidth={false}
          />
          <Select
            allowClear
            placeholder="Fresher & experienced"
            value={filters.cohort}
            onChange={(v) => set({ cohort: v })}
            options={[
              { value: 'fresher', label: 'Freshers only' },
              { value: 'experienced', label: 'Experienced only' },
            ]}
            className="pea-filter-select"
          />
          <RangePicker
            format="DD-MMM-YYYY"
            placeholder={['Any date', '']}
            value={filters.from || filters.to ? [filters.from ? dayjs(filters.from) : null, filters.to ? dayjs(filters.to) : null] : null}
            onChange={(v) => set({
              from: v?.[0] ? v[0].format('YYYY-MM-DD') : undefined,
              to: v?.[1] ? v[1].format('YYYY-MM-DD') : undefined,
            })}
            allowEmpty={[true, true]}
            className="pea-filter-date"
          />
          <span className="pea-grow" />
          <Tooltip title="The previous list: group by manager for one message per manager, and every email PEA has sent.">
            <Link to="/evaluations/worklist"><Button type="text" icon={<MailOutlined />}>Work list &amp; emails</Button></Link>
          </Tooltip>
        </div>
      </div>

      <div className="pea-legend-row">
        <div className="pea-legend">
          <span>Ratings</span>
          <span className="pea-rchip pea-rchip--legend pea-tone-crit">1–2</span> Dissatisfied
          <span className="pea-rchip pea-rchip--legend pea-tone-info">3</span> Satisfied
          <span className="pea-rchip pea-rchip--legend pea-tone-ok">4–5</span> Highly satisfied / Exceptional
        </div>
        <Segmented
          value={view}
          onChange={(v) => { set({ view: v }); setSelected([]); }}
          options={[
            { value: 'cards', label: 'Cards', icon: <AppstoreOutlined /> },
            { value: 'table', label: 'Table', icon: <UnorderedListOutlined /> },
          ]}
        />
      </div>

      {status === 'attention' && (
        <div className="pea-banner pea-banner--crit">
          <FlagOutlined />
          <span>
            Showing the <strong>{counts.attention ?? 0}</strong> evaluation{counts.attention === 1 ? '' : 's'} that need
            attention — not confirmed, extended, an average below 2.5, or any question rated 2 or lower.
          </span>
          <button type="button" className="pea-link-strong" onClick={() => set({ status: 'all' })}>
            Clear filter <ArrowRightOutlined />
          </button>
        </div>
      )}
      {(status === 'recent' || status === 'in_progress') && (
        <div className="pea-banner">
          <span>
            Showing <strong>{status === 'recent' ? 'recently submitted evaluations that need no attention' : 'every evaluation still with a manager or not yet sent'}</strong>.
          </span>
          <button type="button" className="pea-link-strong" onClick={() => set({ status: 'all' })}>
            Clear filter <ArrowRightOutlined />
          </button>
        </div>
      )}

      {/* ── The list ────────────────────────────────────────────────── */}
      {view === 'table' ? (
        <BoardTable
          data={data}
          loading={isLoading || isFetching}
          selected={selected}
          setSelected={setSelected}
          onOpen={(r) => navigate(profileLink(r))}
          onRemind={(ids) => remind.mutate(ids)}
          reminding={remind.isPending}
          page={page}
          onPage={(p) => set({ page: p }, { keepPage: true })}
        />
      ) : isLoading && !data ? (
        <div className="pea-ev-grid">
          <CardSkeleton /><CardSkeleton />
        </div>
      ) : sectioned ? (
        (data?.sections || []).map((s) => (
          <BoardSection
            key={s.key}
            section={s}
            profileLink={profileLink}
            onShowAll={() => set({ status: s.key === 'recent' ? 'submitted' : s.key })}
            onRemind={(r) => remind.mutate([r.id])}
            reminding={remind.isPending}
          />
        ))
      ) : (
        <>
          <CardGrid
            rows={data?.rows || []}
            profileLink={profileLink}
            onRemind={(r) => remind.mutate([r.id])}
            reminding={remind.isPending}
          />
          {(data?.total || 0) > PAGE_SIZE.cards && (
            <Pagination
              className="pea-board-pager"
              current={page}
              pageSize={PAGE_SIZE.cards}
              total={data.total}
              showSizeChanger={false}
              onChange={(p) => { set({ page: p }, { keepPage: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            />
          )}
        </>
      )}
    </div>
  );
}

/** Cards for a list of rows: submitted ones in full, the rest compact. */
function CardGrid({ rows, profileLink, onRemind, reminding }) {
  if (!rows.length) {
    return (
      <div className="pea-card pea-card-pad">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No evaluations match — which is usually good news." />
      </div>
    );
  }
  const full = rows.filter((r) => r.bucket === 'submitted');
  const mini = rows.filter((r) => r.bucket !== 'submitted');
  return (
    <>
      {full.length > 0 && (
        <div className="pea-ev-grid">
          {full.map((r) => <EvaluationCard key={r.id} r={r} to={profileLink(r)} />)}
        </div>
      )}
      {mini.length > 0 && (
        <div className="pea-ev-grid pea-ev-grid--mini">
          {mini.map((r) => (
            <ProgressCard key={r.id} r={r} to={profileLink(r)} onRemind={onRemind} reminding={reminding} />
          ))}
        </div>
      )}
    </>
  );
}

const SECTION_DOT = { attention: 'crit', recent: 'ok', in_progress: 'warn' };

/** One of the three sections on the default card view. */
function BoardSection({ section, profileLink, onShowAll, onRemind, reminding }) {
  const { key, title, total, rows } = section;
  return (
    <section className="pea-board-section">
      <header className="pea-board-section-head">
        <span className={`pea-section-dot pea-bg-${SECTION_DOT[key]}`} />
        <h3>{title}</h3>
        <span className="pea-muted">{rows.length} of {total}</span>
        <span className="pea-grow" />
        {total > rows.length && (
          <button type="button" className="pea-link-strong" onClick={onShowAll}>
            Show all <ArrowRightOutlined />
          </button>
        )}
      </header>
      {rows.length === 0 ? (
        <p className="pea-muted pea-board-empty">
          {key === 'attention'
            ? 'Nothing needs attention — no low scores, and nobody extended or not confirmed.'
            : key === 'recent' ? 'Nothing has come back yet.' : 'Every evaluation has been answered.'}
        </p>
      ) : (
        <CardGrid rows={rows} profileLink={profileLink} onRemind={onRemind} reminding={reminding} />
      )}
    </section>
  );
}

/** The table view — for bulk work. */
function BoardTable({ data, loading, selected, setSelected, onOpen, onRemind, reminding, page, onPage }) {
  const rows = data?.rows || [];

  const commentCell = (r) => {
    if (r.bucket === 'submitted') {
      if (r.legacy && !r.scores.length) return <em className="pea-muted">Imported free text</em>;
      return r.remarks ? <span className="pea-clamp-2">{r.remarks}</span> : <em className="pea-muted">No overall comment</em>;
    }
    const text = {
      waiting: `No comments yet — the link is with ${r.rmName}.`,
      opened: 'Manager has the form open — comments appear when submitted.',
      not_sent: 'Nothing has gone to the manager yet.',
      scheduled: 'Scheduled — the form goes out on the due date.',
      closed: 'No longer needed.',
    }[r.bucket];
    return <em className="pea-muted pea-clamp-2">{text}</em>;
  };

  return (
    <div className="pea-card pea-board-table">
      {selected.length > 0 && (
        <div className="pea-bulk-bar">
          <strong>{selected.length} selected</strong>
          <Space wrap size={4}>
            <Popconfirm
              title="Send an extra reminder?"
              description={<div style={{ maxWidth: 320 }}>Emails each reporting manager again with the link they already have. It does not replace that link.</div>}
              okText="Send reminders"
              onConfirm={() => onRemind(selected)}
            >
              <Button size="small" type="primary" icon={<BellOutlined />} loading={reminding}>Remind now</Button>
            </Popconfirm>
            <Button size="small" type="link" onClick={() => setSelected([])}>Clear</Button>
          </Space>
        </div>
      )}
      <Table
        size="middle"
        rowKey="id"
        loading={loading}
        dataSource={rows}
        scroll={{ x: 'max-content' }}
        rowClassName={(r) => (r.attention ? `pea-row-attn pea-row-attn--${r.decision?.startsWith('Extend') ? 'warn' : 'crit'}` : '')}
        onRow={(r) => ({ onClick: (e) => { if (!e.target.closest('.ant-checkbox-wrapper, button, a')) onOpen(r); } })}
        rowSelection={{
          selectedRowKeys: selected,
          onChange: setSelected,
          getCheckboxProps: (r) => ({ disabled: !r.linkLive }),
        }}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE.table,
          total: data?.total || 0,
          showSizeChanger: false,
          onChange: onPage,
          showTotal: (t) => `${t} evaluation${t === 1 ? '' : 's'}`,
        }}
        locale={{ emptyText: 'No evaluations match — which is usually good news.' }}
        columns={[
          {
            title: '',
            width: 44,
            render: (_, r) => (r.attention ? (
              <Tooltip title={r.attentionReasons.join(' · ')}>
                <span
                  className={`pea-flag pea-flag--${r.decision?.startsWith('Extend') ? 'warn' : 'crit'}`}
                  aria-label={`Needs attention: ${r.attentionReasons.join(' · ')}`}
                  role="img"
                ><FlagOutlined /></span>
              </Tooltip>
            ) : null),
          },
          { title: 'Status', width: 170, render: (_, r) => <BucketPill bucket={r.bucket} /> },
          {
            title: 'Employee',
            width: 230,
            render: (_, r) => (
              <div className="pea-cell-person">
                <Avatar name={r.employeeName} size="sm" />
                <div>
                  <div className="pea-cell-name">{r.employeeName}</div>
                  <div className="pea-muted pea-small">
                    {r.cohort === 'experienced' ? 'Experienced' : 'Fresher'} · {r.rmName}
                  </div>
                </div>
              </div>
            ),
          },
          {
            title: 'Evaluation',
            width: 120,
            render: (_, r) => (
              <span className="pea-num">
                {r.seqNo} of {r.of}{' '}
                {r.isExtension ? <StatusPill tone="ext" nodot>ext</StatusPill> : r.isFinal ? <StatusPill tone="mute" nodot>final</StatusPill> : null}
              </span>
            ),
          },
          { title: 'Submitted', width: 100, className: 'pea-num', render: (_, r) => shortDate(r.submittedAt) },
          {
            title: 'Average',
            width: 90,
            className: 'pea-num',
            render: (_, r) => (r.avgRating == null ? '—' : <strong className={`pea-ink-${ratingTone(r.avgRating)} pea-avg-cell`}>{avg(r.avgRating)}</strong>),
          },
          {
            title: 'Decision',
            width: 170,
            render: (_, r) => (r.decision ? <StatusPill tone={decisionTone(r.decision)} nodot>{r.decision}</StatusPill> : <span className="pea-muted">—</span>),
          },
          { title: 'Overall comment', width: 240, render: (_, r) => <div className="pea-cell-comment">{commentCell(r)}</div> },
          {
            title: 'Comments',
            width: 96,
            className: 'pea-num',
            render: (_, r) => (r.questionCount ? `${r.commentedCount}/${r.questionCount}` : '—'),
          },
          { title: '', width: 36, render: () => <RightOutlined className="pea-muted" /> },
        ]}
      />
      <p className="pea-muted pea-small pea-table-foot">
        The table is for bulk work — sorting, selecting and reminding. Every row opens the same evaluation profile.
      </p>
    </div>
  );
}
