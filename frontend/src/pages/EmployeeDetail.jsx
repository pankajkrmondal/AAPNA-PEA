import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Descriptions, Tag, Table, Space, Typography, Timeline, Button, Spin, Alert,
  Row, Col, App, Empty, Tooltip,
} from 'antd';
import { ArrowLeftOutlined, SendOutlined, PauseOutlined, PlayCircleOutlined } from '@ant-design/icons';
import api, { unwrap } from '../api.js';

const fmt = (d) => (d ? String(d).slice(0, 10) : '—');

const STATUS_COLOUR = {
  pending: 'default',
  email_sent: 'orange',
  opened: 'blue',
  completed: 'green',
  skipped: 'default',
};

const STATUS_LABEL = {
  pending: 'Not yet sent',
  email_sent: 'Awaiting response',
  opened: 'Opened, not submitted',
  completed: 'Completed',
  skipped: 'Not applicable',
};

export default function EmployeeDetail() {
  const { id } = useParams();
  const { message } = App.useApp();
  const qc = useQueryClient();

  const { data: e, isLoading } = useQuery({
    queryKey: ['employee', id],
    queryFn: () => api.get(`/employees/${id}/full`).then(unwrap),
  });

  const resend = useMutation({
    mutationFn: (seqNo) =>
      api.post('/admin/send-evaluation', { office_email: e.office_email, seq_no: seqNo }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      qc.invalidateQueries({ queryKey: ['employee', id] });
    },
    onError: (err) => message.error(err.friendlyMessage),
  });

  const toggleHalt = useMutation({
    mutationFn: (halt) => api.post(`/employees/${id}/halt`, { halt }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      qc.invalidateQueries({ queryKey: ['employee', id] });
    },
    onError: (err) => message.error(err.friendlyMessage),
  });

  if (isLoading) return <Spin size="large" style={{ display: 'block', marginTop: 80 }} />;
  if (!e) return <Alert type="error" message="Employee not found" />;

  const ats = e.atsHistory || { linked: false };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
        <Space>
          <Link to="/employees"><Button icon={<ArrowLeftOutlined />} /></Link>
          <Typography.Title level={4} style={{ margin: 0 }}>{e.full_name}</Typography.Title>
          <Tag>{e.is_experienced ? 'Experienced' : 'Fresher'}</Tag>
          {e.halt_process && <Tag color="default">Paused</Tag>}
          {e.confirmation_status && (
            <Tag color={e.confirmation_status === 'Confirmed' ? 'green' : 'orange'}>{e.confirmation_status}</Tag>
          )}
        </Space>
        <Button
          icon={e.halt_process ? <PlayCircleOutlined /> : <PauseOutlined />}
          onClick={() => toggleHalt.mutate(!e.halt_process)}
          loading={toggleHalt.isPending}
        >
          {e.halt_process ? 'Resume evaluations' : 'Pause evaluations'}
        </Button>
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card size="small" title="Details">
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="Office email">{e.office_email}</Descriptions.Item>
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
          <Card
            size="small"
            title="Recruitment history (from ATS)"
            extra={ats.linked && !ats.unavailable ? <Tag color="green">Linked</Tag> : <Tag>Not linked</Tag>}
          >
            {!ats.linked ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                    {ats.reason ||
                      'Not linked to an ATS record. This does not mean they had no interviews.'}
                  </Typography.Text>
                }
              />
            ) : ats.unavailable ? (
              <Alert type="warning" message="ATS data is temporarily unavailable" description={ats.reason} />
            ) : (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <Descriptions column={1} size="small" bordered>
                  <Descriptions.Item label="Applied for">{ats.candidate.position_applied || '—'}</Descriptions.Item>
                  <Descriptions.Item label="Personal email">{ats.candidate.candidate_email}</Descriptions.Item>
                  <Descriptions.Item label="Offer joining date">{fmt(ats.offer?.joining_date)}</Descriptions.Item>
                  <Descriptions.Item label="Interview rounds">
                    {ats.summary.interviewRounds}
                    {ats.summary.averageInterviewRating != null && (
                      <Tag style={{ marginLeft: 8 }}>avg {ats.summary.averageInterviewRating}</Tag>
                    )}
                  </Descriptions.Item>
                </Descriptions>

                {ats.scorecards.length > 0 && (
                  <Table
                    size="small"
                    rowKey="id"
                    pagination={false}
                    dataSource={ats.scorecards}
                    columns={[
                      { title: 'Round', dataIndex: 'stage_key' },
                      { title: 'Interviewer', dataIndex: 'recipient_name', render: (v) => v || '—' },
                      {
                        title: 'Rating',
                        width: 80,
                        render: (_, r) => r.final_rating ?? r.avg_score ?? '—',
                      },
                      {
                        title: 'Recommendation',
                        dataIndex: 'recommendation',
                        render: (v) => (v ? <Tag>{v}</Tag> : '—'),
                      },
                    ]}
                  />
                )}
              </Space>
            )}
          </Card>
        </Col>
      </Row>

      <Card size="small" title="Evaluation timeline">
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={e.cycles}
          columns={[
            {
              title: '#',
              dataIndex: 'seq_no',
              width: 60,
              render: (v, r) => (
                <Space size={4}>
                  {v}
                  {r.is_extension && <Tooltip title="Extension"><Tag color="purple">ext</Tag></Tooltip>}
                </Space>
              ),
            },
            {
              title: 'Period',
              width: 200,
              render: (_, r) => `${fmt(r.period_from)} → ${fmt(r.period_to)}`,
            },
            { title: 'Due', dataIndex: 'due_date', width: 110, render: fmt },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 170,
              render: (v) => <Tag color={STATUS_COLOUR[v]}>{STATUS_LABEL[v] || v}</Tag>,
            },
            {
              title: 'Average',
              dataIndex: 'avg_rating',
              width: 90,
              render: (v) =>
                v == null ? '—' : <Tag color={v >= 3.5 ? 'green' : v >= 2.5 ? 'blue' : 'red'}>{Number(v)}</Tag>,
            },
            { title: 'Submitted', dataIndex: 'submitted_at', width: 110, render: fmt },
            {
              title: 'Chased',
              dataIndex: 'reminder_count',
              width: 80,
              render: (v) => (v ? `${v}×` : '—'),
            },
            {
              title: '',
              width: 120,
              render: (_, r) =>
                ['pending', 'email_sent', 'opened'].includes(r.status) && !e.halt_process ? (
                  <Button
                    size="small"
                    icon={<SendOutlined />}
                    loading={resend.isPending}
                    onClick={() => resend.mutate(r.seq_no)}
                  >
                    {r.status === 'pending' ? 'Send' : 'Resend'}
                  </Button>
                ) : null,
            },
          ]}
          expandable={{
            rowExpandable: (r) => r.scores?.length > 0 || !!r.remarks || !!r.legacy_raw,
            expandedRowRender: (r) => (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
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

      {e.audit?.length > 0 && (
        <Card size="small" title="Change history">
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
    </Space>
  );
}
