/**
 * ForgotPassword — request a reset link by username or email. Always shows the
 * same success screen whether or not the account exists, so the page cannot be
 * used to find out who has an account. The ATS page, in the PEA sign-in card.
 */
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Form, Input, Button, Alert, Result } from 'antd';
import { ArrowLeftOutlined, UserOutlined } from '@ant-design/icons';
import api from '../api.js';
import AuthShell from '../components/AuthShell.jsx';
import Turnstile from '../components/Turnstile.jsx';

const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

export default function ForgotPassword() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstile = useRef(null);

  const onFinish = async ({ identifier }) => {
    setLoading(true);
    setError('');
    try {
      await api.post('/auth/forgot-password', { identifier: identifier.trim(), turnstileToken });
      setSent(true);
    } catch (err) {
      setError(err.friendlyMessage);
      turnstile.current?.reset();
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your email" subtitle="Password reset">
        <Result
          status="success"
          style={{ padding: '8px 0' }}
          subTitle="If an account exists for that username or email, a password reset link has been sent to its email address. The link expires in 30 minutes and works once."
          extra={
            <Link to="/login">
              <Button type="primary">Back to sign in</Button>
            </Link>
          }
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot password" subtitle="We will email you a link to choose a new password">
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="identifier"
          label="Username or email"
          rules={[{ required: true, message: 'Please enter your username or email' }]}
        >
          <Input size="large" prefix={<UserOutlined />} autoFocus autoComplete="username" />
        </Form.Item>

        {TURNSTILE_SITE_KEY && (
          <div style={{ marginBottom: 16 }}>
            <Turnstile
              ref={turnstile}
              siteKey={TURNSTILE_SITE_KEY}
              onToken={setTurnstileToken}
              onLoadError={() =>
                setError('The security check could not load. Check your connection or turn off content blockers, then reload the page.')
              }
            />
          </div>
        )}

        <Button
          type="primary"
          htmlType="submit"
          size="large"
          block
          loading={loading}
          disabled={Boolean(TURNSTILE_SITE_KEY) && !turnstileToken}
        >
          Send reset link
        </Button>

        <div style={{ textAlign: 'center', marginTop: 16 }}>
          <Link to="/login">
            <ArrowLeftOutlined style={{ fontSize: 12, marginRight: 6 }} />
            Back to sign in
          </Link>
        </div>
      </Form>
    </AuthShell>
  );
}
