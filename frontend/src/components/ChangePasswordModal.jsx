import { useMutation } from '@tanstack/react-query';
import { Modal, Form, Input, App } from 'antd';
import api from '../api.js';

/** A signed-in user changes their own password. Needs the current one. */
export default function ChangePasswordModal({ open, onClose }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();

  const change = useMutation({
    mutationFn: (v) =>
      api.post('/auth/change-password', { current_password: v.current_password, new_password: v.new_password }).then((r) => r.data),
    onSuccess: (res) => { message.success(res.message); form.resetFields(); onClose(); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  return (
    <Modal title="Change password" open={open} onCancel={onClose} onOk={() => form.submit()} confirmLoading={change.isPending} okText="Change">
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => change.mutate(v)}>
        <Form.Item name="current_password" label="Current password" rules={[{ required: true }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="new_password"
          label="New password"
          rules={[{ required: true }, { min: 10, message: 'At least 10 characters' }]}
          extra="Your other sessions will be signed out."
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="Repeat new password"
          dependencies={['new_password']}
          rules={[
            { required: true },
            ({ getFieldValue }) => ({
              validator: (_, v) => (!v || v === getFieldValue('new_password') ? Promise.resolve() : Promise.reject(new Error('Does not match'))),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
