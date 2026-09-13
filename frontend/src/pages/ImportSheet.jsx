import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Upload, Button, Space, Alert, Table, Tag, Row, Col, Statistic, App, Popconfirm, Typography, Steps,
} from 'antd';
import {
  InboxOutlined, EyeOutlined, ExperimentOutlined, CloudUploadOutlined, ClusterOutlined,
} from '@ant-design/icons';
import api, { unwrap, USER_KEY } from '../api.js';

/**
 * Load the master sheet without a developer. Plan R5: the migration is
 * reviewed, not silent — so the order is always preview → dry run → import,
 * and the rejected rows are the part HR must actually read.
 */
export default function ImportSheet() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const user = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
  const isAdmin = user.role === 'admin';

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

  const seedMap = useMutation({
    mutationFn: () => api.post('/intake/rm-pl-map/seed').then((r) => r.data),
    onSuccess: (res) => { message.success(res.message); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const step = result && !result.dryRun ? 3 : result?.dryRun ? 2 : preview ? 1 : 0;
  const busy = runPreview.isPending || runImport.isPending;

  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>Import master sheet</h2>
          <p>Preview, dry run, then import — nothing is written until the last step</p>
        </div>
      </div>

      <Card className="pea-card" size="small">
        <Steps
          size="small"
          current={step}
          style={{ marginBottom: 18 }}
          items={[
            { title: 'Choose file' },
            { title: 'Preview' },
            { title: 'Dry run' },
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
          <p className="ant-upload-text">Drop the master Excel workbook here, or click to choose</p>
          <p className="ant-upload-hint">Sheet1, columns A–H. Max 10 MB.</p>
        </Upload.Dragger>

        <Space wrap style={{ marginTop: 14 }}>
          <Button icon={<EyeOutlined />} disabled={!file} loading={runPreview.isPending} onClick={() => runPreview.mutate()}>
            Preview
          </Button>
          <Button
            icon={<ExperimentOutlined />}
            disabled={!file || !preview}
            loading={runImport.isPending && runImport.variables === true}
            onClick={() => runImport.mutate(true)}
          >
            Dry run
          </Button>
          {isAdmin ? (
            <Popconfirm
              title="Import for real?"
              description="Creates employees and generates their evaluation schedules. Existing office emails are skipped, not overwritten."
              onConfirm={() => runImport.mutate(false)}
              disabled={!file || !result?.dryRun}
            >
              <Button
                type="primary"
                icon={<CloudUploadOutlined />}
                disabled={!file || !result?.dryRun || busy}
                loading={runImport.isPending && runImport.variables === false}
              >
                Import
              </Button>
            </Popconfirm>
          ) : (
            <Typography.Text type="secondary">Only an admin can run the final import.</Typography.Text>
          )}
        </Space>
      </Card>

      {preview && (
        <Card className="pea-card" size="small" title={<span className="pea-section-title">Reconciliation report</span>}>
          <Row gutter={[16, 16]}>
            <Col xs={12} md={4}><Statistic title="Rows read" value={preview.rowsRead} /></Col>
            <Col xs={12} md={4}><Statistic title="Valid" value={preview.valid} valueStyle={{ color: 'var(--pea-green-600)' }} /></Col>
            <Col xs={12} md={4}><Statistic title="Rejected" value={preview.rejected} valueStyle={{ color: preview.rejected ? 'var(--pea-red)' : undefined }} /></Col>
            <Col xs={12} md={4}><Statistic title="Freshers" value={preview.freshers} /></Col>
            <Col xs={12} md={4}><Statistic title="Experienced" value={preview.experienced} /></Col>
            <Col xs={12} md={4}><Statistic title="Already decided" value={preview.withConfirmation} /></Col>
          </Row>

          {preview.rejected > 0 && (
            <>
              <Alert
                type="warning"
                showIcon
                style={{ margin: '16px 0 10px' }}
                message="Rejected rows will NOT be imported"
                description="Fix these in the workbook and preview again. This is the list HR signs off."
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
              { title: 'DOJ', dataIndex: 'doj', width: 110 },
              { title: 'Status', dataIndex: 'confirmation_status', render: (v) => v || <Tag color="blue">In probation</Tag> },
              { title: 'Evaluations', dataIndex: 'evaluationsToCreate', width: 100 },
            ]}
          />
        </Card>
      )}

      {result && (
        <Card
          className="pea-card"
          size="small"
          title={<span className="pea-section-title">{result.dryRun ? 'Dry run result' : 'Import result'}</span>}
        >
          <Row gutter={[16, 16]}>
            <Col xs={12} md={6}>
              <Statistic title={result.dryRun ? 'Would import' : 'Imported'} value={result.dryRun ? result.createdRows.length : result.imported} />
            </Col>
            <Col xs={12} md={6}><Statistic title="Already present (skipped)" value={result.skippedExisting} /></Col>
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
        </Card>
      )}
    </>
  );
}
