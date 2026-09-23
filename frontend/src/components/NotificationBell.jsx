import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Popover, Empty, Tooltip } from 'antd';
import { ArrowRightOutlined, BellOutlined, CheckOutlined } from '@ant-design/icons';
import api, { unwrap } from '../api.js';

/** The dot beside each alert. A warning (not confirmed, extended) is orange. */
const SEVERITY_TONE = { info: 'ok', warning: 'warn', critical: 'crit' };

const ago = (iso) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

/** Where an alert goes, in words. An evaluation alert opens the evaluation, not the employee. */
const linkLabel = (link) => {
  if (/^\/evaluations\/\d+/.test(link)) return 'Open the evaluation';
  if (link.startsWith('/employees/')) return 'Open the employee';
  if (link.startsWith('/new-joiners')) return 'Open New joiners';
  return 'Open';
};

/**
 * The header bell. Read state is personal — reading an alert here does not
 * clear it for anyone else on the HR team.
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then(unwrap),
    refetchInterval: 60_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });

  const markRead = useMutation({ mutationFn: (id) => api.post(`/notifications/${id}/read`), onSuccess: refresh });
  const markAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });

  const items = data?.items || [];
  const unread = data?.unread || 0;

  const go = (n) => {
    if (!n.read_at) markRead.mutate(n.id);
    if (n.link) {
      setOpen(false);
      navigate(n.link);
    }
  };

  const content = (
    <div className="pea-bell">
      <div className="pea-bell-head">
        <strong>Notifications</strong>
        {unread > 0 && (
          <Button size="small" icon={<CheckOutlined />} onClick={() => markAll.mutate()}>
            Mark all read
          </Button>
        )}
      </div>

      {data && !data.available ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Notifications aren’t available yet. Ask your PEA admin to finish setting them up."
        />
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing yet" />
      ) : (
        <ul className="pea-bell-list">
          {items.map((n) => (
            <li key={n.id} className={`pea-bell-item${n.read_at ? '' : ' is-unread'}`}>
              <div className="pea-bell-title">
                <span className={`pea-bell-dot pea-bg-${SEVERITY_TONE[n.severity] || 'ok'}`} />
                <span className="pea-bell-text">{n.title}</span>
                <span className="pea-muted pea-small">{ago(n.created_at)}</span>
              </div>
              {n.body && <p className="pea-bell-body">{n.body}</p>}
              {n.link && (
                <button type="button" className="pea-link-strong pea-bell-go" onClick={() => go(n)}>
                  {linkLabel(n.link)} <ArrowRightOutlined />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="pea-bell-foot">An evaluation alert opens the evaluation itself — not the employee page.</div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      open={open}
      onOpenChange={setOpen}
      overlayClassName="pea-bell-pop"
    >
      {/* No tooltip while the panel is open — it would sit on top of it. */}
      <Tooltip title={open ? null : unread ? `${unread} unread` : 'Notifications'}>
        <Badge count={unread} size="small" offset={[-4, 4]}>
          <Button type="text" className="pea-icon-btn" icon={<BellOutlined />} aria-label="Notifications" />
        </Badge>
      </Tooltip>
    </Popover>
  );
}
