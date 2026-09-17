import { useState } from 'react';
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Layout, Menu, Button, Tooltip, Dropdown, Tag, Result } from 'antd';
import {
  DashboardOutlined,
  TeamOutlined,
  UserAddOutlined,
  LogoutOutlined,
  SafetyCertificateOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
  BarChartOutlined,
  CloudUploadOutlined,
  LinkOutlined,
  SettingOutlined,
  KeyOutlined,
  MailOutlined,
} from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api, { unwrap, TOKEN_KEY } from './api.js';
import { MODULES, NESTED_MODULES, ROLE_LABEL, canUse, homePath, initialsOf, isAdminTier, signOut, useCurrentUser } from './auth.js';
import NotificationBell from './components/NotificationBell.jsx';
import ThemeToggle from './components/ThemeToggle.jsx';
import AdminPortalIcon from './components/AdminPortalIcon.jsx';
import ChangePasswordModal from './components/ChangePasswordModal.jsx';
import AdminLayout from './layouts/AdminLayout.jsx';
import Login from './pages/Login.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Overview from './pages/Overview.jsx';
import Employees from './pages/Employees.jsx';
import EmployeeDetail from './pages/EmployeeDetail.jsx';
import NewJoiners from './pages/NewJoiners.jsx';
import Analytics from './pages/Analytics.jsx';
import ImportSheet from './pages/ImportSheet.jsx';
import Evaluations from './pages/Evaluations.jsx';
import ManagerLinks from './pages/ManagerLinks.jsx';
import ManagerPortal from './pages/ManagerPortal.jsx';
import Settings from './pages/Settings.jsx';
import EmailTemplates from './pages/EmailTemplates.jsx';
import AdminDashboard from './pages/AdminDashboard.jsx';
import SelfView from './pages/SelfView.jsx';

const { Header, Content, Sider } = Layout;

/** Sidebar icons by module. Which items a user sees is Module Access — see auth.js. */
const ICONS = {
  dashboard: <DashboardOutlined />,
  employees: <TeamOutlined />,
  new_joiners: <UserAddOutlined />,
  analytics: <BarChartOutlined />,
  import_sheet: <CloudUploadOutlined />,
  manager_portal: <LinkOutlined />,
  email_templates: <MailOutlined />,
  settings: <SettingOutlined />,
};

// Nested modules keep their own titles: their routes still resolve, so a
// bookmark to /email-templates must not show a blank heading.
const TITLES = {
  ...Object.fromEntries([...MODULES, ...NESTED_MODULES].map((m) => [m.path, m.label])),
  '/no-access': 'No access',
};

const signedIn = () => Boolean(localStorage.getItem(TOKEN_KEY));

function Shell({ module, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const user = useCurrentUser();

  // A module switched off for this user is left out of the sidebar, and a
  // direct visit is redirected below. The API refuses it regardless.
  const nav = MODULES.filter((m) => canUse(user, m.key)).map((m) => ({ key: m.path, icon: ICONS[m.key], label: m.label }));

  // Surfaced in the header because both brakes silently mean "no manager hears
  // from us", and that is precisely the failure the old system suffered from.
  const { data: diag } = useQuery({
    queryKey: ['diagnostics'],
    queryFn: () => api.get('/admin/diagnostics').then(unwrap),
    refetchInterval: 60_000,
  });

  const logout = async () => {
    await signOut(qc);
    navigate('/login');
  };

  const selected = nav.map((n) => n.key)
    .filter((key) => key !== '/' && location.pathname.startsWith(key))
    .at(0) ?? '/';
  const title = location.pathname.startsWith('/employees/') ? 'Employee' : (TITLES[location.pathname] ?? TITLES[selected]);

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
            <Tooltip
              placement="bottom"
              title={
                <div className="pea-tip">
                  <div className="pea-tip-title">Why managers are not getting real emails</div>
                  <ul>
                    {diag.blockers?.map((b) => <li key={b}>{b}</li>)}
                  </ul>
                </div>
              }
            >
              <Tag icon={<SafetyCertificateOutlined />} color="gold" style={{ marginInlineEnd: 0 }}>
                No email is being sent
              </Tag>
            </Tooltip>
          )}

          <NotificationBell />

          <ThemeToggle />

          {isAdminTier(user.role) && (
            <Button className="pea-top-btn" type="text" icon={<AdminPortalIcon />} onClick={() => navigate('/admin')}>
              <span className="pea-hide-sm">Admin Portal</span>
            </Button>
          )}

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
                { key: 'password', icon: <KeyOutlined />, label: 'Change Password' },
                { key: 'out', icon: <LogoutOutlined />, label: 'Logout', danger: true },
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
                <div className="pea-user-role">{ROLE_LABEL[user.role] || user.role}</div>
              </div>
              <div className="pea-avatar">{initialsOf(user)}</div>
            </div>
          </Dropdown>
        </Header>

        <Content className="pea-content">
          <div className="pea-page">
            {module && !canUse(user, module) ? <Navigate to={homePath(user)} replace /> : children}
          </div>
        </Content>
        <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
      </Layout>
    </Layout>
  );
}

/** @param {{module?: string}} props - the Module Access key this screen needs */
function Protected({ module, children }) {
  if (!signedIn()) return <Navigate to="/login" replace />;
  return <Shell module={module}>{children}</Shell>;
}

/**
 * The Admin Portal — its own shell, admin tier only, as ATS's AdminRoute.
 * The sign-in check lives here, not in the route: a check in App's JSX is
 * evaluated once and would still say "signed out" after the user signs in.
 */
function AdminPortal() {
  const user = useCurrentUser();
  if (!signedIn()) return <Navigate to="/login" replace />;
  if (!isAdminTier(user.role)) return <Navigate to={homePath(user)} replace />;
  return (
    <AdminLayout user={user}>
      <AdminDashboard me={user} />
    </AdminLayout>
  );
}

/** Where an HR user lands when every module has been switched off for them. */
function NoAccess() {
  return (
    <Result
      status="403"
      title="No modules are enabled for your account"
      subTitle="You are signed in, but no PEA module is switched on for you yet. Ask an admin to enable one under Admin Portal → Module Access."
    />
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/" element={<Protected module="dashboard"><Overview /></Protected>} />
      <Route path="/employees" element={<Protected module="employees"><Employees /></Protected>} />
      <Route path="/employees/:id" element={<Protected module="employees"><EmployeeDetail /></Protected>} />
      <Route path="/new-joiners" element={<Protected module="new_joiners"><NewJoiners /></Protected>} />
      <Route path="/analytics" element={<Protected module="analytics"><Analytics /></Protected>} />
      <Route path="/evaluations" element={<Protected module="evaluations"><Evaluations /></Protected>} />
      <Route path="/import" element={<Protected module="import_sheet"><ImportSheet /></Protected>} />
      <Route path="/manager-portal" element={<Protected module="manager_portal"><ManagerLinks /></Protected>} />
      <Route path="/settings" element={<Protected module="settings"><Settings /></Protected>} />
      <Route path="/email-templates" element={<Protected module="email_templates"><EmailTemplates /></Protected>} />
      <Route path="/no-access" element={<Protected><NoAccess /></Protected>} />
      <Route path="/admin" element={<AdminPortal />} />
      {/* Users moved into the Admin Portal; old bookmarks still arrive. */}
      <Route path="/users" element={<Navigate to="/admin" replace />} />
      {/* PUBLIC — a reporting manager's own link. No HR shell, no HR session. */}
      <Route path="/manager/:token" element={<ManagerPortal />} />
      {/* PUBLIC — an employee's own probation, from a link HR shared. */}
      <Route path="/me/:token" element={<SelfView />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
