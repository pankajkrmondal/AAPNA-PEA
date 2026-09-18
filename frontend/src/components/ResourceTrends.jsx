/**
 * ResourceTrends — the Trends tab's lead table: people, not totals.
 *
 * The change Subhajit asked for on 15-Sep (11:09):
 *
 *   "We don't want the analytics of how many evaluations have been completed…
 *    You can think of giving resource-wise analytics… That person is growing,
 *    or that person is coming down."
 *
 * Each row is one person with their first average, their latest, the change,
 * and the parameter that fell furthest. Expanding a row shows every parameter
 * evaluation by evaluation — the "quality up, speed down" view (12:10) that an
 * overall average hides by construction.
 *
 * Only people with two or more comparable evaluations appear: movement is the
 * whole point, and one evaluation has nothing to move from.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Input, Select, Space, Alert, Typography, Spin } from 'antd';
import { Link } from 'react-router-dom';
import api, { unwrap } from '../api.js';
import StatusPill from './StatusPill.jsx';
import TrendDelta, { TrendPill } from './TrendDelta.jsx';

/** The per-parameter table shown when a row is expanded. */
function ParameterBreakdown({ employeeId }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['employee-trend', employeeId],
    queryFn: () => api.get(`/analytics/resource-trends/${employeeId}`).then(unwrap),
  });

  if (isLoading) return <Spin size="small" style={{ margin: 12 }} />;
  if (error) return <Alert type="error" showIcon message={error.friendlyMessage} />;
  if (!data || data.columns.length === 0) return null;

  const { columns, parameters, averages, change, legacyCycles, basis } = data;

  return (
    <div style={{ padding: '4px 0 8px' }}>
      <Typography.Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginBottom: 6 }}>
        {data.employee.name} · every parameter, evaluation by evaluation · change is since E{columns[0]}
      </Typography.Text>

      <Table
        size="small"
        rowKey={(r) => r.key || r.label}
        pagination={false}
        scroll={{ x: 'max-content' }}
        dataSource={[
          ...parameters.map((x) => ({ ...x, key: x.key })),
          { key: '__average__', label: 'Average', ratings: averages, change, isAverage: true },
        ]}
        rowClassName={(r) => (r.isAverage ? 'pea-trend-average-row' : '')}
        columns={[
          { title: 'Parameter', dataIndex: 'label', width: 210 },
          ...columns.map((seq, i) => ({
            title: `E${seq}`,
            key: `e${seq}`,
            width: 70,
            align: 'right',
            render: (_, r) => {
              const v = r.ratings[i];
              return v === null || v === undefined
                ? <span style={{ color: 'var(--pea-text-muted)' }}>—</span>
                : <span style={{ fontVariantNumeric: 'tabular-nums' }}>{v.toFixed(1)}</span>;
            },
          })),
          {
            title: 'Change',
            key: 'change',
            width: 90,
            align: 'right',
            render: (_, r) => <TrendDelta change={r.change} />,
          },
        ]}
      />

      {legacyCycles > 0 && (
        <Typography.Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 6 }}>
          {basis}
        </Typography.Text>
      )}
    </div>
  );
}

export default function ResourceTrends() {
  const [search, setSearch] = useState('');
  const [cohort, setCohort] = useState();
  const [trend, setTrend] = useState();

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['resource-trends', search, cohort, trend],
    queryFn: () =>
      api
        .get('/analytics/resource-trends', { params: { search: search || undefined, cohort, trend } })
        .then(unwrap),
    placeholderData: (previous) => previous,
  });

  if (error) {
    return <Alert type="error" showIcon message="Could not load resource trends" description={error.friendlyMessage} />;
  }

  return (
    <Card
      className="pea-card"
      size="small"
      title={<span className="pea-section-title">Resource trends</span>}
      extra={
        <Space size={8} wrap>
          {isFetching && <Spin size="small" />}
          <Input.Search
            allowClear
            placeholder="Search employee…"
            style={{ width: 200 }}
            onSearch={setSearch}
            onChange={(e) => !e.target.value && setSearch('')}
          />
          <Select
            allowClear
            placeholder="Fresher and experienced"
            style={{ width: 190 }}
            value={cohort}
            onChange={setCohort}
            options={[
              { value: 'fresher', label: 'Freshers only' },
              { value: 'experienced', label: 'Experienced only' },
            ]}
          />
          <Select
            allowClear
            placeholder="Trend: all"
            style={{ width: 150 }}
            value={trend}
            onChange={setTrend}
            options={[
              { value: 'growing', label: 'Growing' },
              { value: 'declining', label: 'Coming down' },
              { value: 'steady', label: 'Steady' },
            ]}
          />
        </Space>
      }
    >
      <Table
        size="small"
        rowKey="employeeId"
        loading={isLoading}
        dataSource={data || []}
        pagination={{ pageSize: 25, hideOnSinglePage: true, showSizeChanger: false }}
        scroll={{ x: 'max-content' }}
        locale={{
          emptyText:
            'No one has two submitted evaluations yet in this filter. Movement needs at least two to compare.',
        }}
        expandable={{
          expandedRowRender: (r) => <ParameterBreakdown employeeId={r.employeeId} />,
          rowExpandable: (r) => r.done >= 2,
        }}
        columns={[
          {
            title: 'Employee',
            dataIndex: 'name',
            fixed: 'left',
            width: 210,
            render: (v, r) => (
              <div>
                <Link to={`/employees/${r.employeeId}`} style={{ fontWeight: 600 }}>{v}</Link>
                <div style={{ fontSize: 11.5, color: 'var(--pea-text-muted)' }}>
                  {r.cohort === 'experienced' ? 'Experienced' : 'Fresher'}
                  {r.employmentStatus === 'left' && (
                    <StatusPill tone="mute" style={{ marginLeft: 6 }}>Left</StatusPill>
                  )}
                </div>
              </div>
            ),
          },
          { title: 'Reporting manager', dataIndex: 'rmName', width: 170, render: (v) => v || '—' },
          {
            title: 'Evaluations done',
            key: 'done',
            width: 140,
            render: (_, r) => `${r.done} of ${r.totalCycles}`,
          },
          {
            title: 'First',
            dataIndex: 'firstAvg',
            width: 80,
            align: 'right',
            render: (v) => (v == null ? '—' : v.toFixed(1)),
          },
          {
            title: 'Latest',
            dataIndex: 'latestAvg',
            width: 80,
            align: 'right',
            render: (v) => (v == null ? '—' : v.toFixed(1)),
          },
          {
            title: 'Change',
            dataIndex: 'change',
            width: 92,
            align: 'right',
            sorter: (a, b) => (a.change ?? 0) - (b.change ?? 0),
            render: (v) => <TrendDelta change={v} />,
          },
          {
            title: 'Trend',
            dataIndex: 'direction',
            width: 130,
            render: (v, r) => <TrendPill direction={v} done={r.done} />,
          },
          {
            title: 'Biggest parameter drop',
            key: 'drop',
            width: 220,
            render: (_, r) =>
              r.biggestDrop ? (
                <Space size={6}>
                  <span>{r.biggestDrop.label}</span>
                  <TrendDelta change={r.biggestDrop.change} />
                </Space>
              ) : (
                <span style={{ color: 'var(--pea-text-muted)' }}>—</span>
              ),
          },
        ]}
      />
    </Card>
  );
}
