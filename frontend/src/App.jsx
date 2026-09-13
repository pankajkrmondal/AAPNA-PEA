import { useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Button, Tooltip, Dropdown, Tag } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  UserAddOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SunOutlined,
  MoonOutlined,
  UserOutlined,
  BarChartOutlined,
  CloudUploadOutlined,
  LinkOutlined,
  SettingOutlined,
  UsergroupAddOutlined,
  KeyOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import api, { unwrap, TOKEN_KEY, USER_KEY } from './api.js';
import { useThemeMode } from './theme.jsx';
import NotificationBell from './components/NotificationBell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Employees from './pages/Employees.jsx';
import EmployeeDetail from './pages/EmployeeDetail.jsx';
import NewJoiners from './pages/NewJoiners.jsx';
import Analytics from './pages/Analytics.jsx';
import ImportSheet from './pages/ImportSheet.jsx';
import ManagerLinks from './pages/ManagerLinks.jsx';
import ManagerPortal from './pages/ManagerPortal.jsx';
import Settings from './pages/Settings.jsx';
import Users from './pages/Users.jsx';
import SelfView from './pages/SelfView.jsx';
import ChangePasswordModal from './components/ChangePasswordModal.jsx';

const { Header, Content, Sider } = Layout;

// `min` hides an item from roles that could not use it. The API enforces the
// same rule on its own; this only avoids showing someone a screen that would
// refuse them.
const RANK = { viewer: 10, hr: 20, admin: 30 };

const NAV = [
  { key: '/', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/employees', icon: <TeamOutlined />, label: 'Employees' },
  { key: '/new-joiners', icon: <UserAddOutlined />, label: 'New joiners' },
  { key: '/analytics', icon: <BarChartOutlined />, label: 'Analytics' },
  { key: '/import', icon: <CloudUploadOutlined />, label: 'Import sheet', min: 'hr' },
  { key: '/manager-portal', icon: <LinkOutlined />, label: 'Manager portal', min: 'hr' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings', min: 'hr' },
  { key: '/users', icon: <UsergroupAddOutlined />, label: 'Users', min: 'admin' },
];

const TITLES = Object.fromEntries(NAV.map((n) => [n.key, n.label]));

const initials = (user) =>
  (user.first_name?.[0] || user.username?.[0] || '?').toUpperCase() +
  (user.last_name?.[0] || '').toUpperCase();

function Shell({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { mode, toggle } = useThemeMode();
  const [collapsed, setCollapsed] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const user = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
  const nav = NAV.filter((n) => !n.min || (RANK[user.role] ?? 0) >= RANK[n.min]).map(({ min: _m, ...n }) => n);

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

  const selected = nav.map((n) => n.key)
    .filter((key) => key !== '/' && location.pathname.startsWith(key))
    .at(0) ?? '/';
  const title = location.pathname.startsWith('/employees/') ? 'Employee' : TITLES[selected];

  return (
    <Layout className="pea-layout">
      {/* Both stay on antd's "light" theme deliberately: the dark algorithm in
          theme.jsx already recolours them, whereas antd's own dark preset would
          override the green selection tint with its stock blue. */}
      <Sider
        className="pea-sider"
        theme="light"
        width={248}
        collapsedWidth={78}
        collapsible
        collapsed={collapsed}
        trigger={null}
        breakpoint="lg"
        onBreakpoint={setCollapsed}
      >
        <div className="pea-brand">
          <div className="pea-brand-mark">PEA</div>
          {!collapsed && (
            <div className="pea-brand-text">
              <span className="pea-brand-name">AAPNA</span>
              <span className="pea-brand-sub">Evaluation Platform</span>
            </div>
          )}
        </div>

        <Menu
          className="pea-nav"
          theme="light"
          mode="inline"
          selectedKeys={[selected]}
          items={nav}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>

      <Layout>
        <Header className="pea-header">
          <Button
            type="text"
            className="pea-icon-btn"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed((c) => !c)}
          />
          <h1 className="pea-header-title">{title}</h1>

          <div style={{ flex: 1 }} />

          {diag && !diag.willActuallySendEmail && (
            <Tooltip title={diag.blockers?.join(' · ')}>
              <Tag icon={<SafetyCertificateOutlined />} color="gold" style={{ marginInlineEnd: 0 }}>
                No email is being sent
              </Tag>
            </Tooltip>
          )}

          <NotificationBell />

          <Tooltip title={mode === 'dark' ? 'Switch to light' : 'Switch to dark'}>
            <Button
              type="text"
              className="pea-icon-btn"
              icon={mode === 'dark' ? <MoonOutlined /> : <SunOutlined />}
              onClick={toggle}
            />
          </Tooltip>

          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'who',
                  disabled: true,
                  icon: <UserOutlined />,
                  label: user.email || user.username,
                },
                { type: 'divider' },
                { key: 'password', icon: <KeyOutlined />, label: 'Change password' },
                { key: 'out', icon: <LogoutOutlined />, label: 'Sign out', danger: true },
              ],
              onClick: ({ key }) => {
                if (key === 'out') logout();
                if (key === 'password') setPwOpen(true);
              },
            }}
          >
            <div className="pea-user-chip" style={{ cursor: 'pointer' }}>
              <div>
                <div className="pea-user-name">{user.first_name || user.username}</div>
                <div className="pea-user-role">{user.role}</div>
              </div>
              <div className="pea-avatar">{initials(user)}</div>
            </div>
          </Dropdown>
        </Header>

        <Content className="pea-content">
          <div className="pea-page">{children}</div>
        </Content>
        <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      </Layout>
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
      <Route path="/new-joiners" element={<Protected><NewJoiners /></Protected>} />
      <Route path="/analytics" element={<Protected><Analytics /></Protected>} />
      <Route path="/import" element={<Protected><ImportSheet /></Protected>} />
      <Route path="/manager-portal" element={<Protected><ManagerLinks /></Protected>} />
      <Route path="/settings" element={<Protected><Settings /></Protected>} />
      <Route path="/users" element={<Protected><Users /></Protected>} />
      {/* PUBLIC — a reporting manager's own link. No HR shell, no HR session. */}
      <Route path="/manager/:token" element={<ManagerPortal />} />
      {/* PUBLIC — an employee's own probation, from a link HR shared. */}
      <Route path="/me/:token" element={<SelfView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
