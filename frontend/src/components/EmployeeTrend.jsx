/**
 * EmployeeTrend — "is this person growing?", on their own page.
 *
 * Two cards, per the 15-Sep screen proposal: the average of each submitted
 * evaluation as a line, and every parameter evaluation by evaluation with what
 * rose and what fell since the first one.
 *
 * The parameter table is the half Subhajit actually asked for (12:10): "even if
 * the quality of the work has increased, but the speed of the work has
 * decreased". A single average hides exactly that, which is why the table is
 * not collapsed behind the chart.
 */
import { useQuery } from '@tanstack/react-query';
import { Card, Table, Row, Col, Spin, Alert, Empty, Typography, Space } from 'antd';
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, LabelList,
} from 'recharts';
import { useMemo } from 'react';
import api, { unwrap } from '../api.js';
import { useThemeMode } from '../theme.jsx';
import TrendDelta, { TrendPill } from './TrendDelta.jsx';

/** Recharts draws SVG attributes, which do not resolve CSS variables — see Analytics.jsx. */
function usePalette() {
  const { mode } = useThemeMode();
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    return {
      green: v('--pea-green-600'),
      greenSoft: v('--pea-green-200'),
      text: v('--pea-text-muted'),
      grid: v('--pea-border'),
      surface: v('--pea-surface'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
}

export default function EmployeeTrend({ employeeId }) {
  const p = usePalette();

  const { data, isLoading, error } = useQuery({
    queryKey: ['employee-trend', employeeId],
    queryFn: () => api.get(`/analytics/resource-trends/${employeeId}`).then(unwrap),
    enabled: Boolean(employeeId),
  });

  if (isLoading) {
    return <Card className="pea-card" size="small"><Spin /></Card>;
  }

  // Trends sit behind the Analytics module switch; a user without it still sees
  // the rest of the employee page rather than an error.
  if (error) {
    if (error.response?.status === 403) return null;
    return <Alert type="error" showIcon message={error.friendlyMessage} />;
  }
  if (!data) return null;

  const { columns, parameters, averages, change, direction, cycles, legacyCycles, basis } = data;

  if (columns.length === 0) {
    return (
      <Card className="pea-card" size="small" title={<span className="pea-section-title">Performance trend</span>}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No submitted evaluations yet. The trend appears once a manager has scored this person."
        />
      </Card>
    );
  }

  const chartData = columns.map((seq, i) => ({
    name: `E${seq}`,
    average: averages[i],
  }));

  // The next due evaluation, drawn as a marker so the line does not look like
  // it simply stopped.
  const nextDue = cycles.find((c) => c.status !== 'completed' && !c.legacy);

  const paramColumns = [
    {
      title: 'Parameter',
      dataIndex: 'label',
      fixed: 'left',
      width: 210,
      render: (v) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    ...columns.map((seq, i) => ({
      title: `E${seq}`,
      key: `e${seq}`,
      width: 74,
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
      width: 92,
      align: 'right',
      render: (_, r) => <TrendDelta change={r.change} />,
    },
  ];

  const averageRow = {
    key: '__average__',
    label: 'Average',
    ratings: averages,
    change,
    isAverage: true,
  };

  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={11}>
        <Card
          className="pea-card"
          size="small"
          title={<span className="pea-section-title">Performance trend</span>}
          extra={
            <Space size={6}>
              <TrendPill direction={direction} done={columns.length} />
              <TrendDelta change={change} />
            </Space>
          }
        >
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={chartData} margin={{ top: 18, right: 16, bottom: 4, left: -18 }}>
              <CartesianGrid stroke={p.grid} vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: p.text }} axisLine={false} tickLine={false} />
              <YAxis
                domain={[1, 5]}
                ticks={[1, 2, 3, 4, 5]}
                tick={{ fontSize: 12, fill: p.text }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{ background: p.surface, border: `1px solid ${p.grid}`, borderRadius: 10, fontSize: 12 }}
                formatter={(v) => [v?.toFixed?.(2) ?? v, 'Average']}
              />
              <Area type="monotone" dataKey="average" stroke="none" fill={p.greenSoft} fillOpacity={0.5} />
              <Line
                type="monotone"
                dataKey="average"
                stroke={p.green}
                strokeWidth={2}
                dot={{ r: 4, fill: p.green }}
                activeDot={{ r: 5 }}
                connectNulls
              >
                <LabelList
                  dataKey="average"
                  position="top"
                  offset={10}
                  style={{ fontSize: 11, fill: p.text, fontVariantNumeric: 'tabular-nums' }}
                  formatter={(v) => (v === null || v === undefined ? '' : v.toFixed(1))}
                />
              </Line>
              {nextDue && <ReferenceLine y={null} stroke={p.grid} />}
            </ComposedChart>
          </ResponsiveContainer>

          <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
            Average of each submitted evaluation, on the 1–5 scale.
            {nextDue && ` Evaluation ${nextDue.seqNo} is due ${nextDue.dueDate}.`}
          </Typography.Text>
        </Card>
      </Col>

      <Col xs={24} xl={13}>
        <Card
          className="pea-card"
          size="small"
          title={<span className="pea-section-title">Parameters by evaluation</span>}
          extra={
            <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
              change since E{columns[0]}
            </Typography.Text>
          }
        >
          <Table
            size="small"
            rowKey={(r) => r.key || r.label}
            pagination={false}
            scroll={{ x: 'max-content' }}
            dataSource={[...parameters.map((x) => ({ ...x, key: x.key })), averageRow]}
            columns={paramColumns}
            rowClassName={(r) => (r.isAverage ? 'pea-trend-average-row' : '')}
          />

          {legacyCycles > 0 && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 10 }}
              message={
                legacyCycles === 1
                  ? '1 earlier evaluation is not shown here'
                  : `${legacyCycles} earlier evaluations are not shown here`
              }
              description={basis}
            />
          )}
        </Card>
      </Col>
    </Row>
  );
}
