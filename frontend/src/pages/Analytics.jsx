import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Table, Tag, DatePicker, Space, Spin, Alert, Empty, Typography } from 'antd';
import dayjs from 'dayjs';
import {
  ResponsiveContainer, ComposedChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell,
} from 'recharts';
import {
  CheckCircleOutlined, StarOutlined, FieldTimeOutlined, NotificationOutlined,
} from '@ant-design/icons';
import api, { unwrap } from '../api.js';
import { useThemeMode } from '../theme.jsx';
import StatCard from '../components/StatCard.jsx';
import HintIcon from '../components/HintIcon.jsx';

/**
 * Recharts draws SVG attributes, which do not reliably resolve CSS variables,
 * so the palette is read from the live stylesheet — and re-read when the theme
 * flips, so charts follow light/dark like everything else.
 */
function usePalette() {
  const { mode } = useThemeMode();
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    return {
      green: v('--pea-green-600'),
      greenSoft: v('--pea-green-200'),
      blue: v('--pea-blue'),
      orange: v('--pea-orange'),
      red: v('--pea-red'),
      emerald: v('--pea-emerald'),
      violet: v('--pea-violet'),
      text: v('--pea-text-muted'),
      grid: v('--pea-border'),
      surface: v('--pea-surface'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
}

const OUTCOME_COLOUR = (p) => ({
  Confirmed: p.emerald,
  'Not Confirmed': p.red,
  'Extend for 1 month': p.orange,
  'Extend for 2 months': p.violet,
  'In probation': p.blue,
});

const chartTooltip = (p) => ({
  contentStyle: {
    background: p.surface,
    border: `1px solid ${p.grid}`,
    borderRadius: 10,
    fontSize: 12,
  },
});

const API_DATE = 'YYYY-MM-DD';

/** Quick picks — each ends today; HR can still choose any custom range. */
const rangePresets = () => {
  const today = dayjs().endOf('day');
  const monthsBack = (n) => [today.subtract(n - 1, 'month').startOf('month'), today];
  return [
    { label: 'Last 30 days', value: [today.subtract(29, 'day').startOf('day'), today] },
    { label: 'This month', value: [today.startOf('month'), today] },
    { label: 'Last 3 months', value: monthsBack(3) },
    { label: 'Last 6 months', value: monthsBack(6) },
    { label: 'Last 12 months', value: monthsBack(12) },
    { label: 'Last 24 months', value: monthsBack(24) },
    { label: 'This year', value: [today.startOf('year'), today] },
  ];
};

export default function Analytics() {
  const [range, setRange] = useState(() => rangePresets().find((r) => r.label === 'Last 12 months').value);
  const p = usePalette();

  const from = range[0].format(API_DATE);
  const to = range[1].format(API_DATE);

  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ['analytics', from, to],
    queryFn: () => api.get('/analytics', { params: { from, to } }).then(unwrap),
    // Keep the current charts on screen while a new range loads.
    placeholderData: (previous) => previous,
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', marginTop: 80 }} />;
  if (error) return <Alert type="error" message="Could not load analytics" description={error.friendlyMessage} />;

  const s = data.summary;
  const axis = { stroke: p.text, fontSize: 12 };
  const outcomeColour = OUTCOME_COLOUR(p);

  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>Analytics</h2>
          <p>Rating trends, parameter strengths and how quickly managers respond</p>
        </div>
        <Space size={8} wrap>
          {isFetching && <Spin size="small" />}
          <DatePicker.RangePicker
            value={range}
            onChange={(v) => v && setRange([v[0].startOf('day'), v[1].endOf('day')])}
            presets={rangePresets()}
            format="DD MMM YYYY"
            allowClear={false}
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
          />
          <HintIcon title="Pick any start date up to today. Every card, chart and the manager table cover evaluations in this range — dated by submission, or by due date for imported history. Probation outcomes always show the current position." />
        </Space>
      </div>

      <div className="pea-stats">
        <StatCard
          label="Evaluations completed"
          value={s.completed ?? 0}
          accent="green"
          icon={<CheckCircleOutlined />}
          hint="Total evaluations submitted by managers in the selected date range."
        />
        <StatCard
          label="Average rating"
          value={s.average_rating ?? '—'}
          suffix={s.average_rating != null ? '/ 5' : undefined}
          accent="blue"
          icon={<StarOutlined />}
          hint="Average of all completed evaluations in the range, out of 5. Shows — if none have ratings."
          share={s.average_rating != null ? s.average_rating / 5 : null}
        />
        <StatCard
          label="Avg response time"
          value={s.avg_response_days ?? '—'}
          suffix={s.avg_response_days != null ? 'days' : undefined}
          accent="orange"
          icon={<FieldTimeOutlined />}
          hint="From the evaluation email being sent to the manager submitting. Only evaluations PEA actually sent."
        />
        <StatCard
          label="Answered without a reminder"
          value={s.onTimeRate != null ? `${s.onTimeRate}%` : '—'}
          accent="emerald"
          icon={<NotificationOutlined />}
          share={s.onTimeRate != null ? s.onTimeRate / 100 : null}
          hint="Percentage of evaluations PEA sent that the manager submitted before any reminder went out. Imported history is excluded."
          foot={s.sent_by_pea ? `${s.without_reminder} of ${s.sent_by_pea} sent by PEA` : 'No evaluations sent by PEA yet'}
        />
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card
            className="pea-card"
            size="small"
            title={
              <span className="pea-section-title">
                Average rating by month
                <HintIcon title={data.trendBasis} />
              </span>
            }
          >
            {data.trend.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No completed evaluations in this date range" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                {/* Composed, not LineChart: a LineChart silently ignores the Bar child. */}
                <ComposedChart data={data.trend} margin={{ top: 10, right: 16, bottom: 0, left: -10 }}>
                  <CartesianGrid stroke={p.grid} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={axis} tickLine={false} axisLine={{ stroke: p.grid }} />
                  <YAxis yAxisId="r" domain={[0, 5]} tick={axis} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="n" orientation="right" allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
                  <Tooltip {...chartTooltip(p)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="n" dataKey="evaluations" name="Evaluations" fill={p.greenSoft} radius={[6, 6, 0, 0]} barSize={18} />
                  <Line yAxisId="r" type="monotone" dataKey="average" name="Average rating" stroke={p.green} strokeWidth={2.5} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card
            className="pea-card"
            size="small"
            title={
              <span className="pea-section-title">
                Probation outcomes
                <HintIcon title="Where every probation stands today. This is a snapshot of employees, so the date range does not change it." />
              </span>
            }
          >
            {data.outcomes.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={data.outcomes}
                    dataKey="employees"
                    nameKey="outcome"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    stroke={p.surface}
                  >
                    {data.outcomes.map((o) => (
                      <Cell key={o.outcome} fill={outcomeColour[o.outcome] || p.green} />
                    ))}
                  </Pie>
                  <Tooltip {...chartTooltip(p)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={14}>
          <Card
            className="pea-card"
            size="small"
            title={<span className="pea-section-title">Average by parameter — fresher vs experienced</span>}
          >
            {data.parameters.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="No per-parameter ratings yet. Imported history uses the older instrument and is excluded."
              />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={data.parameters} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 60 }}>
                  <CartesianGrid stroke={p.grid} strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" domain={[0, 5]} tick={axis} tickLine={false} axisLine={{ stroke: p.grid }} />
                  <YAxis type="category" dataKey="label" tick={axis} tickLine={false} axisLine={false} width={150} />
                  <Tooltip {...chartTooltip(p)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="fresher" name="Fresher" fill={p.green} radius={[0, 6, 6, 0]} barSize={10} />
                  <Bar dataKey="experienced" name="Experienced" fill={p.blue} radius={[0, 6, 6, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>

        <Col xs={24} xl={10}>
          <Card className="pea-card" size="small" title={<span className="pea-section-title">Rating distribution</span>}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data.distribution} margin={{ top: 10, right: 16, bottom: 0, left: -10 }}>
                <CartesianGrid stroke={p.grid} strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: p.grid }} />
                <YAxis allowDecimals={false} tick={axis} tickLine={false} axisLine={false} />
                <Tooltip {...chartTooltip(p)} />
                <Bar dataKey="evaluations" name="Evaluations" fill={p.emerald} radius={[6, 6, 0, 0]} barSize={34} />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Card className="pea-card" size="small" title={<span className="pea-section-title">Manager comparison</span>}>
        <Typography.Paragraph type="secondary" style={{ marginTop: -4 }}>
          Response time and reminders count only evaluations PEA sent. Imported history has no send
          date, and counting it as "answered instantly" would flatter everyone.
        </Typography.Paragraph>
        <Table
          size="small"
          rowKey="rm_email"
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          dataSource={data.managers}
          scroll={{ x: 900 }}
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
              sorter: (a, b) => String(a.rm_name).localeCompare(String(b.rm_name)),
            },
            { title: 'Team', dataIndex: 'employees', width: 70, sorter: (a, b) => a.employees - b.employees },
            { title: 'Completed', dataIndex: 'completed', width: 100, sorter: (a, b) => a.completed - b.completed },
            {
              title: 'Awaiting',
              dataIndex: 'awaiting',
              width: 90,
              render: (v) => (v ? <Tag color="orange">{v}</Tag> : 0),
              sorter: (a, b) => a.awaiting - b.awaiting,
            },
            {
              title: 'Avg rating',
              dataIndex: 'average_rating',
              width: 100,
              render: (v) => (v == null ? '—' : <Tag color={v >= 3.5 ? 'green' : v >= 2.5 ? 'blue' : 'red'}>{v}</Tag>),
              sorter: (a, b) => (a.average_rating ?? 0) - (b.average_rating ?? 0),
            },
            {
              title: 'Avg response',
              dataIndex: 'avg_response_days',
              width: 110,
              render: (v) => (v == null ? '—' : `${v} days`),
              sorter: (a, b) => (a.avg_response_days ?? 999) - (b.avg_response_days ?? 999),
            },
            {
              title: 'No reminder needed',
              dataIndex: 'onTimeRate',
              width: 150,
              render: (v, r) => (v == null ? '—' : `${v}% (${r.without_reminder}/${r.sent_by_pea})`),
              sorter: (a, b) => (a.onTimeRate ?? -1) - (b.onTimeRate ?? -1),
            },
          ]}
        />
      </Card>
    </>
  );
}
