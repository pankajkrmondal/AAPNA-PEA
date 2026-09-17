import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Spin, Result, Space, Typography, Table, Collapse, Empty } from 'antd';
import StatusPill from '../components/StatusPill.jsx';

// Keyed on the wording selfView.service.js sends, which uses the shared state
// names told from the employee's own side. The tones are the same six used on
// every HR screen, so one state never changes colour with the audience.
const STATUS_TONE = {
  Scheduled: 'info',
  'With your manager': 'warn',
  Submitted: 'ok',
  Closed: 'mute',
};

/**
 * PUBLIC page — an employee's own probation, opened from a link HR shared.
 * What appears depends entirely on the level HR chose; the API never sends
 * more than that level allows, so this page cannot reveal more by accident.
 *
 * fetch, not the shared axios instance — see ManagerPortal.jsx for why.
 */
export default function SelfView() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.VITE_API_URL || '/api';
    fetch(`${base}/self-view/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.message || 'This link could not be opened');
        return body.data;
      })
      .then((data) => !cancelled && setState({ loading: false, data, error: null }))
      .catch((err) => !cancelled && setState({ loading: false, data: null, error: err.message }));
    return () => { cancelled = true; };
  }, [token]);

  const wrap = (children) => (
    <div style={{ minHeight: '100vh', background: 'var(--pea-bg)', paddingBlock: 28 }}>
      <div style={{ maxWidth: 960, margin: '0 auto', paddingInline: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="pea-login-brand" style={{ marginBottom: 0 }}>
          <div className="pea-brand-mark">PEA</div>
          <div className="pea-brand-text">
            <span className="pea-brand-name">AAPNA</span>
            <span className="pea-brand-sub">Performance Evaluation</span>
          </div>
        </div>
        {children}
      </div>
    </div>
  );

  if (state.loading) return wrap(<Spin size="large" style={{ marginTop: 80 }} />);
  if (state.error) {
    return wrap(<Card className="pea-card"><Result status="warning" title="This link cannot be opened" subTitle={state.error} /></Card>);
  }

  const d = state.data;
  const showAverages = d.level === 'averages' || d.level === 'full';
  const completed = d.evaluations.filter((e) => e.status === 'Completed').length;

  return wrap(
    <>
      <section className="pea-hero">
        <div className="pea-hero-main">
          <span className="pea-pill"><span className="pea-pill-dot" />Your probation</span>
          <h2 className="pea-hero-title">Hello, {d.name.split(' ')[0]}</h2>
          <p className="pea-hero-sub">
            {d.type} · joined {d.doj} · reporting manager {d.manager}
            <br />
            {completed} of {d.evaluations.length} evaluations completed
          </p>
        </div>
        {showAverages && d.decision && (
          <StatusPill
            tone={
              d.decision === 'Confirmed' ? 'ok' : d.decision === 'Not Confirmed' ? 'crit' : 'ext'
            }
          >
            {d.decision}
          </StatusPill>
        )}
      </section>

      <Card className="pea-card" size="small" title={<span className="pea-section-title">Your evaluations</span>}>
        <Table
          size="small"
          rowKey="number"
          pagination={false}
          dataSource={d.evaluations}
          scroll={{ x: 560 }}
          columns={[
            {
              title: '#',
              dataIndex: 'number',
              width: 60,
              render: (v, r) => (
                <Space size={4}>{v}{r.extension && <StatusPill tone="ext" nodot>ext</StatusPill>}</Space>
              ),
            },
            { title: 'Period', dataIndex: 'period', render: (v) => v || '—' },
            { title: 'Due', dataIndex: 'due', width: 110, className: 'pea-num' },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 170,
              render: (v) => <StatusPill tone={STATUS_TONE[v] || 'mute'}>{v}</StatusPill>,
            },
            ...(showAverages
              ? [{ title: 'Average', dataIndex: 'average', width: 100, render: (v) => (v == null ? '—' : `${v} / 5`) }]
              : []),
          ]}
        />
      </Card>

      {d.level === 'full' && (
        <Card className="pea-card" size="small" title={<span className="pea-section-title">Feedback from your manager</span>}>
          {d.evaluations.some((e) => e.scores?.length || e.remarks) ? (
            <Collapse
              items={d.evaluations
                .filter((e) => e.scores?.length || e.remarks)
                .map((e) => ({
                  key: e.number,
                  label: `Evaluation ${e.number}${e.period ? ` · ${e.period}` : ''}${e.average != null ? ` · ${e.average} / 5` : ''}`,
                  children: (
                    <>
                      <Table
                        size="small"
                        rowKey="parameter"
                        pagination={false}
                        dataSource={e.scores || []}
                        columns={[
                          { title: 'Parameter', dataIndex: 'parameter', width: 220 },
                          { title: 'Rating', dataIndex: 'rating', width: 80 },
                          { title: 'Comment', dataIndex: 'comment', render: (v) => v || '—' },
                        ]}
                      />
                      {e.remarks && (
                        <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
                          <strong>Overall remarks:</strong> {e.remarks}
                        </Typography.Paragraph>
                      )}
                    </>
                  ),
                }))}
            />
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No feedback submitted yet" />
          )}
        </Card>
      )}

      <Typography.Text type="secondary" style={{ textAlign: 'center' }}>
        This link is personal to you and expires on {new Date(d.expiresAt).toLocaleDateString()}. Questions? Speak to HR.
      </Typography.Text>
    </>
  );
}
