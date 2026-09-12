import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, Alert } from 'antd';
import api, { TOKEN_KEY, USER_KEY } from '../api.js';

export default function Login() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    <div
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#345C72',
        padding: 16,
      }}
    >
      <Card style={{ width: 380, maxWidth: '100%' }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Performance Evaluation
        </Typography.Title>
        <Typography.Paragraph type="secondary" style={{ marginTop: -8 }}>
          AAPNA Infotech · Human Resources
        </Typography.Paragraph>

        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

        <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="identifier"
            label="Username or email"
            rules={[{ required: true, message: 'Please enter your username or email' }]}
          >
            <Input size="large" autoFocus autoComplete="username" />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password size="large" autoComplete="current-password" />
          </Form.Item>

          <Button type="primary" htmlType="submit" size="large" block loading={loading}>
            Sign in
          </Button>
        </Form>
      </Card>
    </div>
  );
}
