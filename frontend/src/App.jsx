import { Routes, Route, Navigate, Link, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Button, Typography, Space, Tag } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import api, { unwrap, TOKEN_KEY, USER_KEY } from './api.js';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Employees from './pages/Employees.jsx';
import EmployeeDetail from './pages/EmployeeDetail.jsx';

const { Header, Content } = Layout;

function Shell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem(USER_KEY) || '{}');

  // Surfaced in the header because both brakes silently mean "no manager hears
  // from us", and that is precisely the failure the old system suffered from.
  const { data: diag } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: () => api.get('/admin/diagnostics').then(unwrap),
    refetchInterval: 60_000,
  });

  const logout = async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* signing out locally is what matters */
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    navigate('/login');
  };

  const selected = location.pathname.startsWith('/employees') ? '/employees' : '/';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ display: 'flex', alignItems: 'center', gap: 24, paddingInline: 20 }}>
        <Typography.Text strong style={{ color: '#fff', fontSize: 16, whiteSpace: 'nowrap' }}>
          Performance Evaluation
        </Typography.Text>

        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[selected]}
          style={{ flex: 1, minWidth: 0, background: 'transparent' }}
          items={[
            { key: '/', icon: <DashboardOutlined />, label: <Link to="/">Dashboard</Link> },
            { key: '/employees', icon: <TeamOutlined />, label: <Link to="/employees">Employees</Link> },
          ]}
        />

        <Space size={10}>
          {diag && !diag.willActuallySendEmail && (
            <Tag icon={<SafetyCertificateOutlined />} color="gold" title={diag.blockers.join(' · ')}>
              No email is being sent
            </Tag>
          )}
          <Typography.Text style={{ color: 'rgba(255,255,255,.8)' }}>
            {user.first_name || user.username} ({user.role})
          </Typography.Text>
          <Button type="text" icon={<LogoutOutlined />} onClick={logout} style={{ color: '#fff' }}>
            Sign out
          </Button>
        </Space>
      </Header>

      <Content style={{ padding: 20, background: '#f0f2f5' }}>{children}</Content>
    </Layout>
  );
}

function Protected({ children }) {
  if (!localStorage.getItem(TOKEN_KEY)) return <Navigate to="/login" replace />;
  return <Shell>{children}</Shell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected><Dashboard /></Protected>} />
      <Route path="/employees" element={<Protected><Employees /></Protected>} />
      <Route path="/employees/:id" element={<Protected><EmployeeDetail /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
