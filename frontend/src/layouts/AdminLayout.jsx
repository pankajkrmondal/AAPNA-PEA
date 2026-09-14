/**
 * AdminLayout — the Admin Portal shell. As in ATS it is a separate shell from
 * the main app: its own top bar and no sidebar, with a button back to the
 * Evaluation Portal, the theme toggle, a user chip carrying Change Password,
 * and Logout.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown } from 'antd';
import { DashboardOutlined, KeyOutlined, LogoutOutlined } from '@ant-design/icons';
import ThemeToggle from '../components/ThemeToggle.jsx';
import ChangePasswordModal from '../components/ChangePasswordModal.jsx';
import AdminPortalIcon from '../components/AdminPortalIcon.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import { homePath, initialsOf, signOut } from '../auth.js';

export default function AdminLayout({ user, children }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="pea-admin-shell">
      <header className="pea-admin-topbar">
        <div className="pea-admin-left">
          <div className="pea-brand-mark">PEA</div>
          <div className="pea-admin-sep" />
          <div className="pea-admin-brand-icon">
            <AdminPortalIcon />
          </div>
          <div style={{ lineHeight: 1.2, minWidth: 0 }}>
            <div className="pea-admin-title-row">
              <span className="pea-admin-title">HR Admin</span>
              <RoleBadge role={user.role} />
            </div>
            <span className="pea-admin-sub">Users · Access</span>
          </div>
        </div>

        <div className="pea-admin-right">
          <ThemeToggle />
          <Button className="pea-top-btn" type="text" icon={<DashboardOutlined />} onClick={() => navigate(homePath(user))}>
            <span className="pea-hide-sm">Evaluation Portal</span>
          </Button>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: [{ key: 'password', icon: <KeyOutlined />, label: 'Change Password' }],
              onClick: () => setPwOpen(true),
            }}
          >
            <button type="button" className="pea-admin-chip">
              <span className="pea-admin-chip-avatar">{initialsOf(user)}</span>
              <span className="pea-hide-sm">{user.username}</span>
            </button>
          </Dropdown>
          <Button
            className="pea-top-btn pea-top-btn--logout"
            type="text"
            icon={<LogoutOutlined />}
            onClick={async () => {
              await signOut(qc);
              navigate('/login');
            }}
          >
            <span className="pea-hide-sm">Logout</span>
          </Button>
        </div>
      </header>

      <main className="pea-admin-main">{children}</main>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}
