import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, Tag, Button, Spin, Result, Space, Typography, Table, Alert } from 'antd';
import { FormOutlined } from '@ant-design/icons';

import { evaluationStatus } from '../evaluationStatus.js';
import StatusPill from '../components/StatusPill.jsx';
import { formatDate } from '../formatDate.js';

/**
 * PUBLIC page — a reporting manager's team, opened from their personal link.
 *
 * Uses fetch, NOT the shared axios instance: that instance attaches an HR
 * session token and bounces any 401 to the HR login page, neither of which
 * makes sense for a manager who has no PEA account.
 */
export default function ManagerPortal() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    const base = import.meta.env.VITE_API_URL || '/api';

    fetch(`${base}/manager/${encodeURIComponent(token)}`)
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
      <div style={{ maxWidth: 1080, margin: '0 auto', paddingInline: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
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
    return wrap(
      <Card className="pea-card">
        <Result status="warning" title="This link cannot be opened" subTitle={state.error} />
      </Card>
    );
  }

  const { data } = state;

  return wrap(
    <>
      <section className="pea-hero">
        <div className="pea-hero-main">
          <span className="pea-pill"><span className="pea-pill-dot" />Your team</span>
          <h2 className="pea-hero-title">Hello, {data.manager}</h2>
          <p className="pea-hero-sub">
            {data.people.length} team member(s) · link valid until {formatDate(data.expiresAt)}
          </p>
        </div>
        {data.waitingOnYou > 0 && (
          <Tag color="orange" style={{ fontSize: 14, padding: '6px 12px' }}>
            {data.waitingOnYou} evaluation(s) waiting for you
          </Tag>
        )}
      </section>

      {data.people.length === 0 && (
        <Alert type="info" showIcon message="Nobody currently reports to you in the evaluation system." />
      )}

      {data.people.map((person, i) => (
        <Card
          key={`${i}-${person.name}`}
          className="pea-card"
          size="small"
          title={
            <Space wrap>
              <span className="pea-section-title">{person.name}</span>
              {/* Fresher / Experienced is a classification, not a state — no dot. */}
              <StatusPill tone="mute" nodot>{person.type}</StatusPill>
              <Typography.Text type="secondary" style={{ fontSize: 12, fontWeight: 400 }}>joined {person.doj}</Typography.Text>
              {person.paused && <StatusPill tone="warn">Paused by HR</StatusPill>}
              {person.decision && (
                <StatusPill tone={person.decision === 'Confirmed' ? 'ok' : 'crit'}>
                  {person.decision}
                </StatusPill>
              )}
            </Space>
          }
        >
          <Table
            size="small"
            rowKey="number"
            pagination={false}
            dataSource={person.evaluations}
            scroll={{ x: 640 }}
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
              { title: 'Due', dataIndex: 'due', width: 120, render: (v) => formatDate(v) },
              {
                title: 'Status',
                dataIndex: 'status',
                width: 190,
                render: (_, r) => {
                  // Same names HR sees, addressed to the manager. The separate
                  // red "overdue" tag is gone: an overdue evaluation now says
                  // so in the status itself rather than needing two tags read
                  // together. `overdue` comes from the server, which compares
                  // against its own date rather than the reader's clock.
                  const s = evaluationStatus(
                    { status: r.overdue ? 'not_sent' : r.status },
                    { audience: 'manager' }
                  );
                  return <StatusPill state={s.key}>{s.label}</StatusPill>;
                },
              },
              {
                title: 'Your average',
                dataIndex: 'average',
                width: 110,
                render: (v) => (v == null ? '—' : `${v} / 5`),
              },
              {
                title: '',
                width: 150,
                render: (_, r) =>
                  r.formUrl ? (
                    <Button type="primary" size="small" icon={<FormOutlined />} href={r.formUrl}>
                      Open form
                    </Button>
                  ) : null,
              },
            ]}
          />
        </Card>
      ))}
    </>
  );
}
