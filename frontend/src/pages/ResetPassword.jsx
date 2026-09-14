/**
 * ResetPassword — choose a new password from the emailed link (?token=…).
 * An expired, used or broken link gets a way back to request a new one.
 */
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Form, Input, Button, Alert, Result } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import api from '../api.js';
import AuthShell from '../components/AuthShell.jsx';

const MIN_PASSWORD = 10;

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const onFinish = async ({ newPassword }) => {
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/reset-password', { token, new_password: newPassword });
      setDone(true);
    } catch (err) {
      setError(err.friendlyMessage);
    } finally {
      setLoading(false);
    }
  };

  const requestNew = (
    <Link to="/forgot-password">
      <Button type="primary">Request a new link</Button>
    </Link>
  );

  if (!token) {
    return (
      <AuthShell title="Invalid reset link" subtitle="Password reset">
        <Result
          status="warning"
          style={{ padding: '8px 0' }}
          subTitle="This link is missing its reset token. Use the full link from your email, or request a new one."
          extra={requestNew}
        />
      </AuthShell>
    );
  }

  if (done) {
    return (
      <AuthShell title="Password reset" subtitle="You can sign in now">
        <Result
          status="success"
          style={{ padding: '8px 0' }}
          subTitle="Your password has been changed and every existing session was signed out. Sign in with your new password."
          extra={
            <Link to="/login">
              <Button type="primary">Sign in</Button>
            </Link>
          }
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Choose a new password" subtitle={`At least ${MIN_PASSWORD} characters`}>
      {error && (
        <Alert
          type="error"
          message={error}
          showIcon
          style={{ marginBottom: 16 }}
          action={<Link to="/forgot-password" style={{ whiteSpace: 'nowrap' }}>Request a new link</Link>}
        />
      )}

      <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="newPassword"
          label="New password"
          rules={[
            { required: true, message: 'Please enter a new password' },
            { min: MIN_PASSWORD, message: `Password must be at least ${MIN_PASSWORD} characters` },
          ]}
        >
          <Input.Password size="large" prefix={<LockOutlined />} autoFocus autoComplete="new-password" />
        </Form.Item>

        <Form.Item
          name="confirmPassword"
          label="Confirm new password"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: 'Please confirm the new password' },
            ({ getFieldValue }) => ({
              validator: (_, value) =>
                !value || getFieldValue('newPassword') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('Passwords do not match')),
            }),
          ]}
        >
          <Input.Password size="large" prefix={<LockOutlined />} autoComplete="new-password" />
        </Form.Item>

        <Button type="primary" htmlType="submit" size="large" block loading={loading}>
          Reset password
        </Button>
      </Form>
    </AuthShell>
  );
}
