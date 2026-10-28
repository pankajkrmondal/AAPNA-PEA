import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Upload, Button, Space, Alert, Table, Tag, Row, Col, Statistic, App, Popconfirm, Typography, Steps, Tooltip,
} from 'antd';
// U8 (decided 02-10-2026) — `ClusterOutlined` was the icon of the removed "Rebuild map" button:
// import {
//   InboxOutlined, EyeOutlined, ExperimentOutlined, CloudUploadOutlined, ClusterOutlined,
// } from '@ant-design/icons';
import {
  InboxOutlined, EyeOutlined, ExperimentOutlined, CloudUploadOutlined, DownloadOutlined,
} from '@ant-design/icons';
import api, { unwrap, USER_KEY, TOKEN_KEY } from '../api.js';
import PageHeader from '../components/PageHeader.jsx';
import { coverageLabel } from '../evaluationDisplay.js';
import { isAdminTier } from '../auth.js';
import HintIcon from '../components/HintIcon.jsx';
import { formatDate } from '../formatDate.js';

/** How each source of a rating reads to HR — excelImport.service.js resolveRating(). */
const SOURCE_WORDS = {
  sheet2: 'Sheet2 ratings',
  sheet1_text: 'ratings written in Sheet1',
  sheet2_average: 'overall number in Sheet2',
  sheet1_number: 'overall number in Sheet1',
};

/**
 * "Ratings found" — what each Completed evaluation imports with, and the gaps,
 * before anything is saved. Excel import (28-10-2026). A missing Sheet2 is not
 * an error; this says what PEA will use instead.
 * @param {{preview: object}} props
 */
function RatingsFound({ preview }) {
  const r = preview.ratings || {};
  const total = (r.full || 0) + (r.partial || 0) + (r.averageOnly || 0) + (r.none || 0);
  if (!total) return null;
  const gaps = total - (r.full || 0);

  return (
    <>
      <Alert
        type={gaps ? 'warning' : 'success'}
        showIcon
        style={{ margin: '16px 0 10px' }}
        message={`Ratings found for ${total} completed evaluation${total === 1 ? '' : 's'}`}
        description={
          <>
            {r.full || 0} fully rated · {r.partial || 0} partly rated · {r.averageOnly || 0} average only · {r.none || 0} without a rating.
            {!preview.ratingsSheetFound && ' There is no Sheet2 in this file, so PEA uses what Sheet1 has.'}
            {gaps > 0 && ' All of them are imported. Missing ratings can be added later on each evaluation’s page; one without a rating is left out of the Commando’s average until then.'}
          </>
        }
      />
      {gaps > 0 && (
        <Table
          size="small"
          rowKey={(x) => `${x.excelRow}-${x.evaluation}`}
          pagination={false}
          dataSource={preview.ratingRows}
          columns={[
            { title: 'Row', dataIndex: 'excelRow', width: 70 },
            { title: 'Name', dataIndex: 'name' },
            { title: 'Evaluation', dataIndex: 'evaluation', width: 100 },
            { title: 'Imported as', dataIndex: 'coverage', render: (v, x) => <Tag color={v === 'none' ? 'red' : 'gold'}>{coverageLabel(v, x.rated)}</Tag> },
            { title: 'Average', dataIndex: 'average', width: 90, render: (v) => (v == null ? '—' : v.toFixed(2)) },
            { title: 'From', dataIndex: 'source', render: (v) => SOURCE_WORDS[v] || '—' },
          ]}
        />
      )}
    </>
  );
}

/**
 * Load the master sheet without a developer. Plan R5: the migration is
 * reviewed, not silent — so the order is always preview → test run → import,
 * and the rejected rows are the part HR must actually read.
 */
/**
 * @param {{embedded?: boolean}} props - `embedded` drops the page heading, for
 *   rendering inside another screen. It has its own sidebar entry now, so the
 *   normal case is the full page; the flag is kept for reuse elsewhere.
 */
export default function ImportSheet({ embedded = false } = {}) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const user = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
  const isAdmin = isAdminTier(user.role);

  const form = () => {
    const fd = new FormData();
    fd.append('file', file);
    return fd;
  };

  const runPreview = useMutation({
    mutationFn: () => api.post('/import/preview', form()).then(unwrap),
    onSuccess: (data) => { setPreview(data); setResult(null); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const runImport = useMutation({
    mutationFn: (dryRun) => api.post(`/import/excel?dryRun=${dryRun}`, form()).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setResult(res.data);
      if (!res.data.dryRun) {
        qc.invalidateQueries({ queryKey: ['employees'] });
        qc.invalidateQueries({ queryKey: ['dashboard'] });
      }
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  /* U8 (decided 02-10-2026) — a joiner's project leader comes from the Leaders
     list in Microsoft 365 and from nowhere else, so there is no map to rebuild
     after an upload. Kept for reference:

  const seedMap = useMutation({
    mutationFn: () => api.post('/intake/rm-pl-map/seed').then((r) => r.data),
    onSuccess: (res) => { message.success(res.message); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });
  */

  const step = result && !result.dryRun ? 3 : result?.dryRun ? 2 : preview ? 1 : 0;
  const busy = runPreview.isPending || runImport.isPending;

  // Excel import (28-10-2026) — the empty workbook to fill in, the same
  // fetch-and-save as the Dashboard's Export.
  const downloadTemplate = async () => {
    const res = await fetch('/api/import/template', {
      headers: { Authorization: `Bearer ${localStorage.getItem(TOKEN_KEY)}` },
    });
    if (!res.ok) return message.error('Could not download the template');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'PEA - Excel upload template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Headers (28-10-2026) — the copy is in auth.js, like every screen's. It
          read "Upload sheet" / "For go-live, and for anyone the Microsoft 365
          check missed · preview the file, test run, then import — nothing is
          written until the last step". */}
      {!embedded && <PageHeader module="import_sheet" />}

      {/* R-07 — Pankaj built this for the case where the automatic pick-up
          misses someone (14:38), and Subhajit approved it as "a good addition"
          (15:39) while saying the dependence on sync "scares me". It is the
          remedy half of R-03: the alert says who is missing, this puts them in.
          Headers (28-10-2026) — reworded for HR, with the template. It read:
          "Most people arrive on their own through the nightly Microsoft 365
          check. Use this screen to load the master sheet at go-live, or to add
          anyone that check could not pick up — someone with no manager or no
          joining date in Microsoft 365. PEA emails you when that happens, so you
          should not have to go looking." */}
      <Alert
        type="info"
        showIcon
        style={{ borderRadius: 'var(--pea-radius)', marginBottom: 12 }}
        message="Add Commandos and their past evaluations from Excel"
        description={
          <>
            New joiners normally arrive on their own from their AAPNA email account. Use this to
            load people who were on probation before PEA, with the evaluations already done, or
            anyone the daily check could not pick up. Download the template, fill it in, then
            check it and import it. Nothing is saved until you press Import.
            <div style={{ marginTop: 10 }}>
              <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>Download template</Button>
            </div>
          </>
        }
      />

      <Card className="pea-card" size="small">
        {/* Headers (28-10-2026) — the steps were Choose file · Preview the file · Test run · Import. */}
        <Steps
          size="small"
          current={step}
          style={{ marginBottom: 18 }}
          items={[
            { title: 'Choose file' },
            { title: 'Check file' },
            { title: 'Trial import' },
            { title: 'Import' },
          ]}
        />

        <Upload.Dragger
          accept=".xlsx,.xls,.xlsm"
          maxCount={1}
          beforeUpload={(f) => {
            setFile(f);
            setPreview(null);
            setResult(null);
            return false; // hold it here; nothing uploads until a button is pressed
          }}
          onRemove={() => { setFile(null); setPreview(null); setResult(null); }}
          fileList={file ? [file] : []}
        >
          <p className="ant-upload-drag-icon"><InboxOutlined /></p>
          {/* Headers (28-10-2026) — it read "Drop the master Excel workbook here,
              or click to choose" and "Sheet1, columns A–H. Max 10 MB." */}
          <p className="ant-upload-text">
            Drop your filled-in Excel template here, or click to choose
            {/* Stop the click reaching the dragger, or tapping the hint opens the file picker. */}
            <span onClick={(e) => e.stopPropagation()}>
              <HintIcon title="Accepts .xlsx, .xls and .xlsm, up to 10 MB. PEA reads Sheet1 (one row per Commando) and, if it is there, Sheet2 (the ratings). The old master workbook works too, as it has the same columns. Choosing a file uploads nothing until you press a button. Remove the file to start again." />
            </span>
          </p>
          <p className="ant-upload-hint">Sheet1 for the people, Sheet2 for ratings (optional). Max 10 MB.</p>
        </Upload.Dragger>

        <Space wrap style={{ marginTop: 14 }}>
          {/* Headers (28-10-2026) — "Preview" and "Test run" became "Check file" and "Trial import". */}
          <Tooltip title="Enabled once a file is chosen. Reads every row and shows what would happen — who is refused and why, which ratings are missing, and which managers will be emailed. Saves nothing.">
            <Button icon={<EyeOutlined />} disabled={!file} loading={runPreview.isPending} onClick={() => runPreview.mutate()}>
              Check file
            </Button>
          </Tooltip>
          <Tooltip title="Enabled after Check file. Goes through the whole import without saving, and shows how many would be added, how many are already in PEA, and anything that would fail. Saves nothing.">
            <Button
              icon={<ExperimentOutlined />}
              disabled={!file || !preview}
              loading={runImport.isPending && runImport.variables === true}
              onClick={() => runImport.mutate(true)}
            >
              Trial import
            </Button>
          </Tooltip>
          {isAdmin ? (
            <Popconfirm
              title="Import for real?"
              description="Creates Commandos and generates their evaluation schedules. Existing office emails are skipped, not overwritten."
              onConfirm={() => runImport.mutate(false)}
              disabled={!file || !result?.dryRun}
            >
              <Tooltip title="Admins only, enabled after a Trial import. Asks to confirm, then adds the Commandos with their evaluations and ratings. Anyone whose office email is already in PEA is skipped, not changed. This saves.">
                <Button
                  type="primary"
                  icon={<CloudUploadOutlined />}
                  disabled={!file || !result?.dryRun || busy}
                  loading={runImport.isPending && runImport.variables === false}
                >
                  Import
                </Button>
              </Tooltip>
            </Popconfirm>
          ) : (
            <Typography.Text type="secondary">
              Only an admin can run the final import.
              <HintIcon title="Import adds the Commandos and their evaluations, so only Admins and Super Admins can run it. You can still Check file and Trial import." />
            </Typography.Text>
          )}
        </Space>
      </Card>

      {preview && (
        // Headers (28-10-2026) — "File check results" was "Reconciliation report".
        <Card className="pea-card" size="small" title={<span className="pea-section-title">File check results</span>}>
          {/* Excel import (28-10-2026) — "Old rows → Confirmed" and "Unanswered
              MS Forms links" were the last two figures here; nothing is
              confirmed on the sheet's behalf now, and the emailed list covers
              every evaluation the next daily send will email. */}
          <Row gutter={[16, 16]}>
            <Col xs={12} md={4}><Statistic title="Rows read" value={preview.rowsRead} /></Col>
            <Col xs={12} md={4}><Statistic title="Ready to import" value={preview.valid} valueStyle={{ color: 'var(--pea-green-600)' }} /></Col>
            <Col xs={12} md={4}><Statistic title="Refused" value={preview.rejected} valueStyle={{ color: preview.rejected ? 'var(--pea-red)' : undefined }} /></Col>
            <Col xs={12} md={4}><Statistic title="Freshers" value={preview.freshers} /></Col>
            <Col xs={12} md={4}><Statistic title="Experienced" value={preview.experienced} /></Col>
            <Col xs={12} md={4}><Statistic title="Already decided" value={preview.withConfirmation} /></Col>
            <Col xs={12} md={4}><Statistic title="Decision needed" value={preview.decisionNeeded} /></Col>
            <Col xs={12} md={4}><Statistic title="Managers to be emailed" value={preview.toEmail} /></Col>
          </Row>

          {/* Excel import (28-10-2026) — what each Completed evaluation brings. */}
          <RatingsFound preview={preview} />

          {preview.toEmail > 0 && (
            <>
              {/* It read: "Power Automate sent these, but no answer was recorded
                  — PEA will send a fresh link" / "The MS Forms are closed at
                  go-live, so the old link no longer works. …" */}
              <Alert
                type="info"
                showIcon
                style={{ margin: '16px 0 10px' }}
                message="These managers will be emailed an evaluation at the next daily send (11:00)"
                description="Each evaluation was due in the last 45 days and is not marked Completed. Anything due earlier is closed instead of sent. People on hold, or already confirmed or not confirmed, are not emailed."
              />
              <Table
                size="small"
                rowKey={(r) => `${r.excelRow}-${r.evaluation}`}
                pagination={false}
                dataSource={preview.toEmailRows}
                columns={[
                  { title: 'Row', dataIndex: 'excelRow', width: 70 },
                  { title: 'Name', dataIndex: 'name' },
                  { title: 'Manager', dataIndex: 'rm_email' },
                  { title: 'Evaluation', dataIndex: 'evaluation', width: 100 },
                  { title: 'Was due', dataIndex: 'due', width: 110, render: (v) => formatDate(v) },
                  { title: 'Sheet says', dataIndex: 'wasSent', width: 150, render: (v) => (v ? 'Email Sent — not answered' : 'Not sent yet') },
                ]}
              />
            </>
          )}

          {preview.decisionNeeded > 0 && (
            <>
              <Alert
                type="warning"
                showIcon
                style={{ margin: '16px 0 10px' }}
                message="Probation already over, with no decision in the sheet"
                description="They are imported as still on probation, and their Commando page shows “Decision due”. Record the decision there once they are in, or fill in Confirmation Status in the sheet before importing."
              />
              <Table
                size="small"
                rowKey="excelRow"
                pagination={false}
                dataSource={preview.decisionNeededRows}
                columns={[
                  { title: 'Row', dataIndex: 'excelRow', width: 70 },
                  { title: 'Name', dataIndex: 'name' },
                  { title: 'DOJ', dataIndex: 'doj', width: 110, render: (v) => formatDate(v) },
                  { title: 'Probation ended', dataIndex: 'ended', width: 140, render: (v) => formatDate(v) },
                  { title: 'Sheet status', dataIndex: 'status', render: (v) => v || 'blank' },
                ]}
              />
            </>
          )}

          {preview.warnings?.length > 0 && (
            <>
              <Alert
                type="warning"
                showIcon
                style={{ margin: '16px 0 10px' }}
                message="Things in the file that will be ignored"
                description="These do not stop the import. Fix them in the file and check it again if they matter."
              />
              <Table
                size="small"
                rowKey={(r, i) => `${r.sheet}-${r.row}-${i}`}
                pagination={false}
                dataSource={preview.warnings}
                columns={[
                  { title: 'Sheet', dataIndex: 'sheet', width: 90 },
                  { title: 'Row', dataIndex: 'row', width: 70 },
                  { title: 'What', dataIndex: 'message' },
                ]}
              />
            </>
          )}

          {/* Excel import (28-10-2026) — removed with the rule, kept for reference:
          {preview.autoConfirmed > 0 && (
            <>
              <Alert
                type="info"
                showIcon
                style={{ margin: '16px 0 10px' }}
                message={`Old rows imported as Confirmed (joined more than 8 months ago, no final decision)`}
                description="Demo data, per HR decision 16. No emails are sent for these people."
              />
              <Table … dataSource={preview.autoConfirmedRows} … />
            </>
          )}
          */}

          {preview.rejected > 0 && (
            <>
              <Alert
                type="warning"
                showIcon
                style={{ margin: '16px 0 10px' }}
                message="Refused rows will NOT be imported"
                description="Fix these in the file and press Check file again. Nobody on this list is added."
              />
              <Table
                size="small"
                rowKey="excelRow"
                pagination={false}
                dataSource={preview.rejectedRows}
                columns={[
                  { title: 'Row', dataIndex: 'excelRow', width: 70 },
                  { title: 'Name', dataIndex: 'name', render: (v) => v || '—' },
                  { title: 'Office email', dataIndex: 'officeEmail', render: (v) => v || '—' },
                  {
                    title: 'Why',
                    dataIndex: 'reasons',
                    render: (v) => (
                      <Space wrap size={[4, 4]}>{(v || []).map((r) => <Tag color="red" key={r}>{r}</Tag>)}</Space>
                    ),
                  },
                ]}
              />
            </>
          )}

          <Typography.Title level={5} style={{ marginTop: 18 }}>First 20 valid rows</Typography.Title>
          <Table
            size="small"
            rowKey="excelRow"
            pagination={false}
            dataSource={preview.preview}
            columns={[
              { title: 'Row', dataIndex: 'excelRow', width: 70 },
              { title: 'Name', dataIndex: 'full_name' },
              { title: 'Office email', dataIndex: 'office_email' },
              { title: 'Type', dataIndex: 'type', render: (v) => <Tag>{v}</Tag> },
              { title: 'DOJ', dataIndex: 'doj', width: 110, render: (v) => formatDate(v) },
              {
                title: 'Status',
                dataIndex: 'confirmation_status',
                // Excel import (28-10-2026) — the "Confirmed (old row)" tag is gone with the rule.
                render: (v) => v || <Tag color="blue">In probation</Tag>,
              },
              { title: 'Evaluations', dataIndex: 'evaluationsToCreate', width: 100 },
            ]}
          />
        </Card>
      )}

      {result && (
        <Card
          className="pea-card"
          size="small"
          title={<span className="pea-section-title">{result.dryRun ? 'Trial import result — nothing saved' : 'Import result'}</span>}
        >
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <Statistic title={result.dryRun ? 'Would import' : 'Imported'} value={result.dryRun ? result.createdRows.length : result.imported} />
            </Col>
            <Col xs={12} md={6}><Statistic title="Already in PEA" value={result.skippedExisting} /></Col>
            <Col xs={12} md={6}><Statistic title="Failed" value={result.failed} valueStyle={{ color: result.failed ? 'var(--pea-red)' : undefined }} /></Col>
            <Col xs={12} md={6}><Statistic title="Rejected" value={result.rejected} /></Col>
          </Row>

          {result.failed > 0 && (
            <Table
              style={{ marginTop: 14 }}
              size="small"
              rowKey="excelRow"
              pagination={false}
              dataSource={result.failedRows}
              columns={[
                { title: 'Row', dataIndex: 'excelRow', width: 70 },
                { title: 'Office email', dataIndex: 'office_email' },
                { title: 'Error', dataIndex: 'error' },
              ]}
            />
          )}

          {/* U8 (decided 02-10-2026) — removed from the screen, kept for
              reference. The step it asked for is no longer needed: the New
              Joiner Inbox takes each joiner's project leader from the Leaders
              list, not from this roster.

          {!result.dryRun && result.imported > 0 && (
            <Alert
              type="success"
              showIcon
              style={{ marginTop: 14 }}
              message="Next: rebuild the reporting-manager → project-leader map"
              description="The New Joiner Inbox derives each joiner's project leader from this roster. It was built from the old data until now."
              action={
                <Button icon={<ClusterOutlined />} onClick={() => seedMap.mutate()} loading={seedMap.isPending}>
                  Rebuild map
                </Button>
              }
            />
          )}
          */}
        </Card>
      )}
    </>
  );
}
