import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Row, Col, Card, Statistic, Table, Tag, Typography, Space, Button, Alert, Spin, App, Tooltip,
} from 'antd';
import {
  WarningOutlined, ClockCircleOutlined, CheckCircleOutlined, DownloadOutlined,
  SyncOutlined, TeamOutlined,
} from '@ant-design/icons';
import api, { unwrap, TOKEN_KEY } from '../api.js';

const fmt = (d) => (d ? String(d).slice(0, 10) : '—');

export default function Dashboard() {
  const { message } = App.useApp();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/dashboard').then(unwrap),
  });

  const { data: dq } = useQuery({
    queryKey: ['data-quality'],
    queryFn: () => api.get('/dashboard/data-quality').then(unwrap),
  });

  const sweep = useMutation({
    mutationFn: (dryRun) =>
      api.post(`/admin/sweep?dryRun=${dryRun}`).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => message.error(err.friendlyMessage),
  });

  const download = async () => {
    // Fetch rather than a plain link: the endpoint needs the Authorization
    // header, which an <a href> cannot send.
    const res = await fetch('/api/dashboard/export', {
      headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` },
    });
    if (!res.ok) return message.error('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Performance Evaluation - ${new Date().toISOString().slice(0, 10)}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <Spin size="large" style={{ display: 'block', marginTop: 80 }} />;
  if (!data) return <Alert type="error" message="Could not load the dashboard" />;

  const { employees: emp, evaluations: ev } = data;
  const issues = dq?.issues || {};
  const issueCount = Object.values(issues).reduce((a, b) => a + b, 0);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row justify="space-between" align="middle">
        <Typography.Title level={4} style={{ margin: 0 }}>
          Overview <Typography.Text type="secondary" style={{ fontSize: 14, fontWeight: 400 }}>
            as at {data.today} ({data.timezone})
          </Typography.Text>
        </Typography.Title>
        <Space>
          <Button icon={<DownloadOutlined />} onClick={download}>Export to Excel</Button>
          <Button onClick={() => sweep.mutate(true)} loading={sweep.isPending}>Preview sweep</Button>
          <Button type="primary" icon={<SyncOutlined />} onClick={() => sweep.mutate(false)} loading={sweep.isPending}>
            Run sweep now
          </Button>
        </Space>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="Active employees" value={emp.active} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small"><Statistic title="In probation" value={emp.inProbation} /></Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Tooltip title="Due, and nobody has been asked yet. The spreadsheet could not show this at all.">
              <Statistic
                title="Overdue"
                value={ev.overdue}
                valueStyle={{ color: ev.overdue ? '#cf1322' : undefined }}
                prefix={<WarningOutlined />}
              />
            </Tooltip>
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Tooltip title="Link sent, manager has not responded. Previously indistinguishable from 'not sent'.">
              <Statistic
                title="Awaiting response"
                value={ev.awaitingResponse}
                valueStyle={{ color: ev.awaitingResponse ? '#d46b08' : undefined }}
                prefix={<ClockCircleOutlined />}
              />
            </Tooltip>
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic title="Due in 14 days" value={ev.dueInNext14Days} />
          </Card>
        </Col>
        <Col xs={12} sm={8} lg={4}>
          <Card size="small">
            <Statistic
              title="Completed"
              value={ev.completed}
              suffix={`/ ${ev.total}`}
              prefix={<CheckCircleOutlined />}
            />
          </Card>
        </Col>
      </Row>

      {issueCount > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`${issueCount} record(s) need attention`}
          description={
            <Space direction="vertical" size={2}>
              {issues.missingContactDetails > 0 && (
                <span>{issues.missingContactDetails} missing an RM or PL contact — these are skipped by the sweep.</span>
              )}
              {issues.noScheduleGenerated > 0 && (
                <span>{issues.noScheduleGenerated} with no evaluation schedule at all.</span>
              )}
              {issues.noResponseAfterTwoReminders > 0 && (
                <span>{issues.noResponseAfterTwoReminders} chased twice with no response.</span>
              )}
              {issues.finishedWithoutDecision > 0 && (
                <span>{issues.finishedWithoutDecision} finished every evaluation but have no confirmation decision recorded.</span>
              )}
            </Space>
          }
        />
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title={<><WarningOutlined /> Overdue — nobody has been asked</>}>
            <Table
              size="small"
              rowKey="cycleId"
              pagination={false}
              locale={{ emptyText: 'Nothing overdue' }}
              dataSource={data.overdueList}
              columns={[
                {
                  title: 'Employee',
                  dataIndex: 'employee',
                  render: (v, r) => <Link to={`/employees/${r.employeeId}`}>{v}</Link>,
                },
                { title: 'Eval', dataIndex: 'seqNo', width: 60 },
                { title: 'Due', dataIndex: 'dueDate', width: 110 },
                {
                  title: 'Late',
                  dataIndex: 'daysLate',
                  width: 90,
                  render: (v) => <Tag color={v > 14 ? 'red' : 'orange'}>{v} days</Tag>,
                },
                { title: 'Manager', dataIndex: 'rm' },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card size="small" title={<><ClockCircleOutlined /> Awaiting a manager's response</>}>
            <Table
              size="small"
              rowKey="cycleId"
              pagination={false}
              locale={{ emptyText: 'Nothing outstanding' }}
              dataSource={data.awaitingList}
              columns={[
                {
                  title: 'Employee',
                  dataIndex: 'employee',
                  render: (v, r) => <Link to={`/employees/${r.employeeId}`}>{v}</Link>,
                },
                { title: 'Eval', dataIndex: 'seqNo', width: 60 },
                { title: 'Sent', dataIndex: 'sentAt', width: 110, render: fmt },
                {
                  title: 'Waiting',
                  dataIndex: 'daysWaiting',
                  width: 90,
                  render: (v) => (v == null ? '—' : `${v} days`),
                },
                {
                  title: 'Chased',
                  dataIndex: 'remindersSent',
                  width: 90,
                  render: (v, r) => (
                    <Space size={4}>
                      <Tag>{v}×</Tag>
                      {r.opened && <Tag color="blue">opened</Tag>}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="Coming up in the next 14 days">
            <Table
              size="small"
              rowKey="cycleId"
              pagination={false}
              locale={{ emptyText: 'Nothing due soon' }}
              dataSource={data.upcomingList}
              columns={[
                {
                  title: 'Employee',
                  dataIndex: 'employee',
                  render: (v, r) => <Link to={`/employees/${r.employeeId}`}>{v}</Link>,
                },
                { title: 'Eval', dataIndex: 'seqNo', width: 60 },
                { title: 'Due', dataIndex: 'dueDate', width: 110 },
                { title: 'Manager', dataIndex: 'rm' },
              ]}
            />
          </Card>
        </Col>

        <Col xs={24} xl={12}>
          <Card size="small" title="Recently submitted">
            <Table
              size="small"
              rowKey="cycleId"
              pagination={false}
              locale={{ emptyText: 'No submissions yet' }}
              dataSource={data.recentSubmissions}
              columns={[
                {
                  title: 'Employee',
                  dataIndex: 'employee',
                  render: (v, r) => <Link to={`/employees/${r.employeeId}`}>{v}</Link>,
                },
                { title: 'Eval', dataIndex: 'seqNo', width: 60 },
                {
                  title: 'Average',
                  dataIndex: 'average',
                  width: 90,
                  render: (v) =>
                    v == null ? '—' : <Tag color={v >= 3.5 ? 'green' : v >= 2.5 ? 'blue' : 'red'}>{v}</Tag>,
                },
                { title: 'Submitted', dataIndex: 'submittedAt', width: 110, render: fmt },
                {
                  title: 'Decision',
                  dataIndex: 'confirmation',
                  render: (v) => (v ? <Tag color={v === 'Confirmed' ? 'green' : 'orange'}>{v}</Tag> : '—'),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
