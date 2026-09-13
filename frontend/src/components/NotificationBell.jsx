import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Popover, List, Typography, Empty, Tag, Tooltip, Space } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import api, { unwrap } from '../api.js';

const SEVERITY_COLOUR = { info: 'green', warning: 'gold', critical: 'red' };

const ago = (iso) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/**
 * The header bell. Read state is personal — reading an alert here does not
 * clear it for anyone else on the HR team.
 */
export default function NotificationBell() {
  const navigate = useNavigate();
  const qc = useQueryClient();

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

  const open = (n) => {
    if (!n.read_at) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  const content = (
    <div style={{ width: 380, maxWidth: '85vw' }}>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8 }}>
        <Typography.Text strong>Notifications</Typography.Text>
        {unread > 0 && (
          <Button size="small" type="link" icon={<CheckOutlined />} onClick={() => markAll.mutate()}>
            Mark all read
          </Button>
        )}
      </Space>

      {data && !data.available ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Notifications are not set up on this database yet (2026-09-13 DDL)."
        />
      ) : (
        <List
          size="small"
          dataSource={items}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing yet" /> }}
          style={{ maxHeight: 420, overflowY: 'auto' }}
          renderItem={(n) => (
            <List.Item
              onClick={() => open(n)}
              style={{
                cursor: n.link ? 'pointer' : 'default',
                background: n.read_at ? 'transparent' : 'var(--pea-green-50)',
                borderRadius: 10,
                paddingInline: 10,
                marginBottom: 4,
              }}
            >
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <Space size={6} style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Space size={6}>
                    <Tag color={SEVERITY_COLOUR[n.severity] || 'green'} style={{ marginInlineEnd: 0 }}>
                      {n.severity}
                    </Tag>
                    <Typography.Text strong={!n.read_at} style={{ fontSize: 13 }}>
                      {n.title}
                    </Typography.Text>
                  </Space>
                  <Typography.Text type="secondary" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                    {ago(n.created_at)}
                  </Typography.Text>
                </Space>
                {n.body && (
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'pre-line' }}>
                    {n.body}
                  </Typography.Text>
                )}
              </Space>
            </List.Item>
          )}
        />
      )}
    </div>
  );

  return (
    <Popover content={content} trigger="click" placement="bottomRight">
      <Tooltip title={unread ? `${unread} unread` : 'Notifications'}>
        <Badge count={unread} size="small" offset={[-4, 4]}>
          <Button type="text" className="pea-icon-btn" icon={<BellOutlined />} />
        </Badge>
      </Tooltip>
    </Popover>
  );
}
