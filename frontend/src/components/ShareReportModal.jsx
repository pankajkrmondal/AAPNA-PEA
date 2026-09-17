/**
 * ShareReportModal — R-05. Answer "how is this person doing?" in one click.
 *
 * Subhajit, 15-Sep demo (19:44):
 *
 *   "Anuj drops an email to me that I want to know what is the current
 *    evolution status of XYZ resource… So I will be able to send the evolution
 *    report within one click. I can send an email to Anuj keeping Rakhi ma'am
 *    in CC."
 *
 * So the dialog opens with the CC already filled in and the cursor's only real
 * job being the To address — the one thing PEA cannot guess, because whoever
 * asked is not a role the system knows about.
 */
import { useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal, Form, Select, Input, Alert, Typography, Space, Tag, App } from 'antd';
import { FileExcelOutlined } from '@ant-design/icons';
import api from '../api.js';

const DOMAIN = '@aapnainfotech.com';

/** Mirrors the server's rule, so a mistake is caught before the request. */
const validAddress = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.endsWith(DOMAIN);

export default function ShareReportModal({ open, onClose, employee, progress }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const completed = progress?.completed ?? 0;

  // Suggested, not imposed — the reporting manager and project leader are the
  // people usually copied, and HR can remove either.
  useEffect(() => {
    if (!open) return;
    form.setFieldsValue({
      to: [],
      cc: [employee?.rm_email, employee?.pl_email].filter(Boolean),
      note: '',
    });
  }, [open, employee, form]);

  const share = useMutation({
    mutationFn: (values) =>
      api.post(`/employees/${employee.id}/share-report`, values).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      onClose();
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const emailOptions = (values) =>
    values.map((v) => ({ value: v, label: v }));

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <div>
          <Typography.Text type="secondary" style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase' }}>
            Share evaluation report
          </Typography.Text>
          <div style={{ fontSize: 18, fontWeight: 600 }}>{employee?.full_name}</div>
          <Typography.Text type="secondary" style={{ fontSize: 12.5, fontWeight: 400 }}>
            {completed} of {progress?.total ?? 0} evaluations submitted
            {employee?.rm_name ? ` · Reporting manager ${employee.rm_name}` : ''}
          </Typography.Text>
        </div>
      }
      okText="Send report"
      confirmLoading={share.isPending}
      onOk={() => form.submit()}
      okButtonProps={{ disabled: completed === 0 }}
      width={620}
      destroyOnClose
    >
      {completed === 0 ? (
        <Alert
          type="warning"
          showIcon
          message="Nothing to report yet"
          description="No evaluation has been submitted for this person, so there is nothing to send."
        />
      ) : (
        <Form form={form} layout="vertical" onFinish={(v) => share.mutate(v)} requiredMark={false}>
          <Form.Item
            name="to"
            label="To"
            rules={[
              { required: true, message: 'Enter at least one recipient.' },
              {
                validator: (_, v) =>
                  !v || v.every(validAddress)
                    ? Promise.resolve()
                    : Promise.reject(new Error(`Recipients must be ${DOMAIN} addresses.`)),
              },
            ]}
            extra={`Anyone with an ${DOMAIN} address. Type an address and press Enter.`}
          >
            <Select mode="tags" tokenSeparators={[',', ';', ' ']} options={emailOptions([])} placeholder="name@aapnainfotech.com" />
          </Form.Item>

          <Form.Item
            name="cc"
            label="CC"
            rules={[{
              validator: (_, v) =>
                !v || v.every(validAddress)
                  ? Promise.resolve()
                  : Promise.reject(new Error(`Recipients must be ${DOMAIN} addresses.`)),
            }]}
            extra="Suggested: the reporting manager and project leader. Remove anyone who should not see this."
          >
            <Select mode="tags" tokenSeparators={[',', ';', ' ']} options={emailOptions([])} />
          </Form.Item>

          <Form.Item name="note" label="Note, optional">
            <Input.TextArea rows={2} placeholder="Evaluations so far, as you asked." maxLength={500} showCount />
          </Form.Item>

          <Space align="start" style={{ padding: '10px 12px', background: 'var(--pea-surface-2)', borderRadius: 8, width: '100%' }}>
            <FileExcelOutlined style={{ fontSize: 20, color: 'var(--pea-green-600)' }} />
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>
                {String(employee?.full_name || 'employee').replace(/[^a-z0-9]+/gi, '-')}-evaluation-report.xlsx
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 11.5 }}>
                Attached · every submitted evaluation, parameter scores and remarks.
                The email also lists the evaluations in full, so the reader does not have to open it.
              </Typography.Text>
            </div>
          </Space>

          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message={
              <span>
                This report contains ratings and manager comments.{' '}
                <Tag color="default" style={{ marginInlineStart: 4 }}>Recorded in the change history</Tag>
              </span>
            }
          />
        </Form>
      )}
    </Modal>
  );
}
