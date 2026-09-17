import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Row, Col, Card, Table, Tag, Space, Button, Alert, Spin, App, Tooltip, Modal, Typography,
} from 'antd';
import {
  WarningOutlined, ClockCircleOutlined, CheckCircleOutlined, DownloadOutlined,
  SyncOutlined, TeamOutlined, CalendarOutlined, SolutionOutlined, EyeOutlined,
} from '@ant-design/icons';
import api, { unwrap, TOKEN_KEY, USER_KEY } from '../api.js';
import StatCard from '../components/StatCard.jsx';
import HintIcon from '../components/HintIcon.jsx';
import { formatDate as fmt } from '../formatDate.js';

const greeting = (h) => (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening');

const ratio = (part, whole) => (whole ? part / whole : 0);

const SectionTitle = ({ children, hint }) => (
  <span className="pea-section-title">
    {children}
    <HintIcon title={hint} />
  </span>
);

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="pea-clock">
      {now.toLocaleTimeString('en-GB', { hour12: true }).toUpperCase()}
    </span>
  );
}

export default function Dashboard() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const user = JSON.parse(localStorage.getItem(USER_KEY) || '{}');

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
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  /**
   * "Run sweep now" used to send immediately on one click — real email, to real
   * managers, with nothing shown first but a count that vanished after a few
   * seconds. It now runs the dry run FIRST and asks about the actual numbers,
   * so the decision is made against what would really happen rather than a
   * remembered glance at a toast.
   */
  const confirmAndSweep = useMutation({
    mutationFn: () => api.post('/admin/sweep?dryRun=true').then((r) => r.data),
    onError: (err) => { message.error(err.friendlyMessage); },
    onSuccess: (res) => {
      const d = res.data || {};
      const evaluations = d.evaluations?.due ?? 0;
      const reminders = d.reminders?.due ?? 0;

      if (evaluations + reminders === 0) {
        message.info('Nothing is due right now, so no email would be sent.');
        return;
      }

      Modal.confirm({
        title: 'Send these emails now?',
        width: 520,
        okText: `Send ${evaluations + reminders} email(s) now`,
        cancelText: 'Cancel',
        content: (
          <div>
            <p style={{ marginTop: 8 }}>This sends real email to reporting managers:</p>
            <ul style={{ paddingLeft: 18 }}>
              {evaluations > 0 && (
                <li><strong>{evaluations}</strong> evaluation request(s) now due</li>
              )}
              {reminders > 0 && (
                <li><strong>{reminders}</strong> reminder(s) for evaluations already sent</li>
              )}
            </ul>
            <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
              The daily sweep would send these at 11:00 anyway. Running it now does not
              send anything twice.
            </Typography.Text>
          </div>
        ),
        onOk: () => sweep.mutateAsync(false),
      });
    },
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
    <>
      <section className="pea-hero">
        <div className="pea-hero-main">
          <span className="pea-pill">
            <span className="pea-pill-dot" />
            AAPNA PEA Platform
          </span>
          <h2 className="pea-hero-title">
            {greeting(new Date().getHours())}, {user.first_name || user.username} 👋
          </h2>
          <p className="pea-hero-sub">
            Here&apos;s what&apos;s happening across your evaluation pipeline · <Clock />
            <br />
            As at {data.today} ({data.timezone})
          </p>
        </div>

        <div className="pea-hero-actions">
          <Tooltip title="Download a snapshot in the old master workbook layout (Sheet1 summary, Sheet2 ratings). Changes nothing.">
            <Button icon={<DownloadOutlined />} onClick={download}>Export to Excel</Button>
          </Tooltip>
          <Tooltip title="Dry run: shows how many evaluation emails and reminders would be sent now, and probations near or past their deadline. Nothing is sent or changed.">
            <Button icon={<EyeOutlined />} onClick={() => sweep.mutate(true)} loading={sweep.isPending}>
              Preview sweep
            </Button>
          </Tooltip>
          <Tooltip title="Runs the real daily sweep now instead of at 11:00. Shows exactly what would be sent and asks before sending anything.">
            <Button
              type="primary"
              icon={<SyncOutlined />}
              onClick={() => confirmAndSweep.mutate()}
              loading={confirmAndSweep.isPending || sweep.isPending}
            >
              Send due emails now…
            </Button>
          </Tooltip>
        </div>
      </section>

      <div className="pea-stats">
        <StatCard
          label="Active employees"
          value={emp.active}
          icon={<TeamOutlined />}
          accent="green"
          hint="Employees whose employment is Active. The footer shows everyone on record and how many are marked Left."
          foot={`${emp.total} on record · ${emp.left} left`}
          share={ratio(emp.active, emp.total)}
        />
        <StatCard
          label="In probation"
          value={emp.inProbation}
          icon={<SolutionOutlined />}
          accent="blue"
          hint="Active employees whose probation is still running — no decision yet, or extended."
          foot={`${emp.confirmed} confirmed · ${emp.extended} extended`}
          share={ratio(emp.inProbation, emp.active)}
        />
        <StatCard
          label="Overdue"
          value={ev.overdue}
          icon={<WarningOutlined />}
          accent="red"
          hint="Due, and nobody has been asked yet. The spreadsheet could not show this at all."
          foot="Nobody has been asked yet"
          share={ratio(ev.overdue, ev.total)}
        />
        <StatCard
          label="Awaiting response"
          value={ev.awaitingResponse}
          icon={<ClockCircleOutlined />}
          accent="orange"
          hint="Link sent, manager has not responded. Previously indistinguishable from 'not sent'."
          foot="Sent, no reply from the manager"
          share={ratio(ev.awaitingResponse, ev.total)}
        />
        <StatCard
          label="Due in 14 days"
          value={ev.dueInNext14Days}
          icon={<CalendarOutlined />}
          accent="violet"
          hint="Evaluations not yet sent that fall due in the next 14 days."
          foot="Coming up in the next fortnight"
          share={ratio(ev.dueInNext14Days, ev.total)}
        />
        <StatCard
          label="Submitted"
          value={ev.completed}
          suffix={`/ ${ev.total}`}
          icon={<CheckCircleOutlined />}
          accent="emerald"
          hint="Evaluations submitted, out of those that have actually fallen due. Evaluations scheduled for later are not counted against you."
          foot={
            ev.averageRating != null
              ? `Average rating ${ev.averageRating.toFixed(2)}`
              : 'No ratings submitted yet'
          }
          share={ratio(ev.completed, ev.total)}
        />
      </div>

      {issueCount > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ borderRadius: 'var(--pea-radius)' }}
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
              {issues.confirmationOverdue > 0 && (
                <span>{issues.confirmationOverdue} past the confirmation deadline (6 months from joining, 8 if extended) — listed below.</span>
              )}
            </Space>
          }
        />
      )}

      {(dq?.confirmationOverdue?.length > 0 || dq?.confirmationDueSoon?.length > 0) && (
        <Card
          className="pea-card"
          size="small"
          title={<span className="pea-section-title">Confirmation deadline — a decision is due</span>}
          extra={
            <Space size={6}>
              <Tag color="red">{dq.confirmationOverdue.length} overdue</Tag>
              <Tag color="gold">{dq.confirmationDueSoon.length} within 14 days</Tag>
            </Space>
          }
        >
          <Table
            size="small"
            rowKey="id"
            pagination={{ pageSize: 8, hideOnSinglePage: true }}
            dataSource={[...dq.confirmationOverdue, ...dq.confirmationDueSoon]}
            scroll={{ x: 760 }}
            columns={[
              {
                title: 'Employee',
                dataIndex: 'full_name',
                render: (v, r) => <Link to={`/employees/${r.id}`}>{v}</Link>,
              },
              { title: 'Type', dataIndex: 'type', width: 110, render: (v) => <Tag>{v}</Tag> },
              { title: 'Joined', dataIndex: 'doj', width: 110 },
              {
                title: 'Deadline',
                dataIndex: 'deadline',
                width: 150,
                render: (v, r) => (
                  <Space size={4}>{v}{r.extended && <Tag color="purple">extended</Tag>}</Space>
                ),
              },
              {
                title: 'Status',
                dataIndex: 'daysOverdue',
                width: 150,
                render: (v) =>
                  v > 0 ? (
                    <Tag color={v > 60 ? 'red' : 'orange'}>{v} days overdue</Tag>
                  ) : (
                    <Tag color="gold">due in {Math.abs(v)} days</Tag>
                  ),
              },
              { title: 'Manager', dataIndex: 'rm_name' },
            ]}
          />
        </Card>
      )}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={12}>
          <Card
            className="pea-card"
            size="small"
            title={
              <SectionTitle hint="Up to 25 evaluations due today or earlier whose email has not been sent, oldest first. Normally the next sweep sends them. If one stays here, check for missing RM/PL details, or whether the scheduler or email is off (see the yellow header tag). Late: orange up to 14 days, red beyond.">
                Overdue — nobody has been asked
              </SectionTitle>
            }
            extra={<span className="pea-count">{data.overdueList.length}</span>}
          >
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
          <Card
            className="pea-card"
            size="small"
            title={
              <SectionTitle hint="Up to 25 evaluations sent to the manager and not yet submitted, longest waiting first. Use it to know which managers to chase. Chased = reminders sent; a blue 'opened' tag means the manager opened the form.">
                Awaiting a manager&apos;s response
              </SectionTitle>
            }
            extra={<span className="pea-count">{data.awaitingList.length}</span>}
          >
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
          <Card
            className="pea-card"
            size="small"
            title={
              <SectionTitle hint="Up to 25 evaluations falling due in the next two weeks, soonest first. Plan ahead: warn a manager, or fix a wrong DOJ or manager before the email goes out.">
                Coming up in the next 14 days
              </SectionTitle>
            }
            extra={<span className="pea-count pea-count-muted">{data.upcomingList.length}</span>}
          >
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
          <Card
            className="pea-card"
            size="small"
            title={
              <SectionTitle hint="The last 10 evaluations submitted by managers, newest first. Average is out of 5 (green ≥ 3.5, blue ≥ 2.5, red below). Decision appears only on a final evaluation: green for Confirmed, orange otherwise.">
                Recently submitted
              </SectionTitle>
            }
            extra={<span className="pea-count pea-count-muted">{data.recentSubmissions.length}</span>}
          >
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
    </>
  );
}
