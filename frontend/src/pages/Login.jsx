import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Form, Input, Button, Alert } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import api, { TOKEN_KEY, USER_KEY } from '../api.js';
import { homePath } from '../auth.js';
import AuthShell from '../components/AuthShell.jsx';
import Turnstile from '../components/Turnstile.jsx';

// Cloudflare Turnstile site key. Unset = no widget (the backend decides
// whether a token is required).
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

export default function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstile = useRef(null);
  // Chrome ignores autocomplete="off" on sign-in forms and fills saved logins
  // as the page loads — but it never fills a read-only field. So both fields
  // stay read-only until the user focuses one, and the form always opens empty.
  const [locked, setLocked] = useState(true);
  const unlock = () => setLocked(false);

  const onFinish = async (values) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/login', { ...values, turnstileToken });
      const { token, user } = res.data.data;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      // The first module this account can open — the dashboard may be switched off.
      navigate(homePath(user));
    } catch (err) {
      setError(err.friendlyMessage);
      // The token was spent on this attempt; get a fresh one for the next.
      turnstile.current?.reset();
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to manage probation evaluations">
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Form layout="vertical" onFinish={onFinish} requiredMark={false} autoComplete="off">
        <Form.Item
          name="identifier"
          label="Username or email"
          rules={[{ required: true, message: 'Please enter your username or email' }]}
        >
          {/* No autoFocus: focusing on load would unlock the field before Chrome fills it. */}
          <Input size="large" prefix={<UserOutlined />} autoComplete="off" readOnly={locked} onFocus={unlock} />
        </Form.Item>

        <Form.Item
          name="password"
          label="Password"
          rules={[{ required: true, message: 'Please enter your password' }]}
          style={{ marginBottom: 8 }}
        >
          <Input.Password size="large" prefix={<LockOutlined />} autoComplete="new-password" readOnly={locked} onFocus={unlock} />
        </Form.Item>

        <div style={{ textAlign: 'right', marginBottom: 16 }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>

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
          Sign in
        </Button>
      </Form>
    </AuthShell>
  );
}
