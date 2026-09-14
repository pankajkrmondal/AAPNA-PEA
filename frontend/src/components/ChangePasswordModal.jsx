/**
 * ChangePasswordModal — self-service password change for whoever is signed
 * in. The ATS modal, against PEA's password rules: the current password is
 * verified on the server, and other sessions are signed out on success while
 * this one stays alive.
 */
import { useMutation } from '@tanstack/react-query';
import { Modal, Form, Input, App } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import api from '../api.js';

const MIN_PASSWORD = 10;

export default function ChangePasswordModal({ open, onClose }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const close = () => {
    form.resetFields();
    onClose();
  };

  const change = useMutation({
    mutationFn: (v) =>
      api
        .post('/auth/change-password', { current_password: v.currentPassword, new_password: v.newPassword })
        .then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      close();
    },
    onError: (err) => {
      // A refused password belongs next to its field, as in ATS.
      if (err.response?.status === 400) {
        const field = /current password/i.test(err.friendlyMessage) ? 'currentPassword' : 'newPassword';
        form.setFields([{ name: field, errors: [err.friendlyMessage] }]);
      } else {
        message.error(err.friendlyMessage);
      }
    },
  });

  return (
    <Modal
      title="Change Password"
      open={open}
      onOk={() => form.submit()}
      onCancel={close}
      okText="Change Password"
      confirmLoading={change.isPending}
      width={420}
    >
      <Form form={form} layout="vertical" requiredMark={false} style={{ marginTop: 12 }} onFinish={(v) => change.mutate(v)}>
        <Form.Item
          name="currentPassword"
          label="Current Password"
          rules={[{ required: true, message: 'Please enter your current password.' }]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Current password" autoComplete="current-password" />
        </Form.Item>

        <Form.Item
          name="newPassword"
          label="New Password"
          extra="Your other sessions will be signed out."
          rules={[
            { required: true, message: 'Please enter a new password.' },
            { min: MIN_PASSWORD, message: `Password must be at least ${MIN_PASSWORD} characters.` },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder={`Min ${MIN_PASSWORD} characters`} autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="Confirm New Password"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: 'Please confirm the new password.' },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || getFieldValue('newPassword') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('Passwords do not match.')),
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder="Re-enter new password" autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
