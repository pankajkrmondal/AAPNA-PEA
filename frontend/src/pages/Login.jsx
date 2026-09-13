import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Typography, Alert, Divider } from 'antd';
import { LockOutlined, UserOutlined, WindowsOutlined } from '@ant-design/icons';
import api, { TOKEN_KEY, USER_KEY } from '../api.js';

export default function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  useEffect(() => {
    api.get('/auth/sso/config').then((r) => setSsoEnabled(!!r.data?.data?.enabled)).catch(() => {});

    // Returning from Microsoft. The token arrives in the URL fragment, which
    // no server ever sees; it is removed from the address bar immediately.
    const params = new URLSearchParams(window.location.hash.slice(1));
    const ssoToken = params.get('sso_token');
    const ssoError = params.get('sso_error');
    if (!ssoToken && !ssoError) return;

    window.history.replaceState(null, '', window.location.pathname);

    if (ssoError) {
      setError(ssoError);
      return;
    }

    setLoading(true);
    api
      .get('/auth/me', { headers: { Authorization: `Bearer ${ssoToken}` } })
      .then((r) => {
        localStorage.setItem(TOKEN_KEY, ssoToken);
        localStorage.setItem(USER_KEY, JSON.stringify(r.data.data));
        navigate('/');
      })
      .catch((err) => setError(err.friendlyMessage))
      .finally(() => setLoading(false));
  }, [navigate]);

  const onFinish = async (values) => {
    setLoading(true);
    setError('');
    try {
      const res = await api.post('/auth/login', values);
      const { token, user } = res.data.data;
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      navigate('/');
    } catch (err) {
      setError(err.friendlyMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="pea-login">
      <div className="pea-login-card">
        <div className="pea-login-brand">
          <div className="pea-brand-mark">PEA</div>
          <div className="pea-brand-text">
            <span className="pea-brand-name">AAPNA</span>
            <span className="pea-brand-sub">Evaluation Platform</span>
          </div>
        </div>

        <Typography.Title level={4} style={{ marginTop: 0, marginBottom: 2 }}>
          Sign in
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 22 }}>
          Performance Evaluation · Human Resources
        </Typography.Paragraph>

        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="identifier"
            label="Username or email"
            rules={[{ required: true, message: 'Please enter your username or email' }]}
          >
            <Input size="large" prefix={<UserOutlined />} autoFocus autoComplete="username" />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password size="large" prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>

          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            Sign in
          </Button>
        </Form>

        {ssoEnabled && (
          <>
            <Divider plain style={{ fontSize: 12 }}>or</Divider>
            <Button
              size="large"
              block
              icon={<WindowsOutlined />}
              href={`${import.meta.env.VITE_API_URL || '/api'}/auth/sso/start`}
            >
              Sign in with Microsoft
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
