import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card, Table, Tag, Space, Button, Select, Switch, Alert, App, Popconfirm, Typography, Tooltip,
} from 'antd';
import { LinkOutlined, CopyOutlined, StopOutlined, SendOutlined } from '@ant-design/icons';
import api, { unwrap } from '../api.js';

const fmt = (d) => (d ? new Date(d).toLocaleString() : '—');

/**
 * Issue a reporting manager their "my team" link. Same trust model as the
 * evaluation form: the link is the credential, it expires, and it can be
 * revoked here at any time.
 */
export default function ManagerLinks() {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [rmEmail, setRmEmail] = useState();
  const [send, setSend] = useState(false);
  const [lastUrl, setLastUrl] = useState(null);

  const managers = useQuery({
    queryKey: ['manager-list'],
    queryFn: () => api.get('/manager-links/managers').then(unwrap),
  });

  const links = useQuery({
    queryKey: ['manager-links'],
    queryFn: () => api.get('/manager-links').then(unwrap),
    retry: false,
  });

  const create = useMutation({
    mutationFn: () => api.post('/manager-links', { rm_email: rmEmail, send }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setLastUrl(res.data.url);
      qc.invalidateQueries({ queryKey: ['manager-links'] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const revoke = useMutation({
    mutationFn: (id) => api.post(`/manager-links/${id}/revoke`),
    onSuccess: () => { message.success('Link revoked'); qc.invalidateQueries({ queryKey: ['manager-links'] }); },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const copy = async (url) => {
    try {
      await navigator.clipboard.writeText(url);
      message.success('Link copied');
    } catch {
      message.info(url);
    }
  };

  const setupMissing = links.error?.response?.status === 503;

  return (
    <>
      <div className="pea-page-head">
        <div>
          <h2>Manager portal</h2>
          <p>Give a reporting manager one link to see their whole team's evaluations — no login</p>
        </div>
      </div>

      {setupMissing && (
        <Alert
          type="error"
          showIcon
          style={{ borderRadius: 'var(--pea-radius)' }}
          message="The manager portal is not set up on this database yet"
          description={<>Apply <Typography.Text code>prisma/ddl/2026-09-13-pea-phase2-features.sql</Typography.Text> via pgAdmin, then reload.</>}
        />
      )}

      <Card className="pea-card" size="small" title={<span className="pea-section-title">Issue a link</span>}>
        <Space wrap align="center">
          <Select
            showSearch
            placeholder="Choose a reporting manager"
            style={{ width: 360, maxWidth: '100%' }}
            loading={managers.isLoading}
            value={rmEmail}
            onChange={setRmEmail}
            optionFilterProp="label"
            options={(managers.data || []).map((m) => ({
              value: m.rm_email,
              label: `${m.rm_name || m.rm_email} — ${m.team_size} report(s), ${m.in_probation} in probation`,
            }))}
          />
          <Space size={6}>
            <Switch checked={send} onChange={setSend} />
            <Typography.Text>Email it to them</Typography.Text>
          </Space>
          <Tooltip
            title={
              send
                ? "Creates the manager's personal link (valid 30 days by default, Settings → Access) and emails it to them using the Manager portal link template. Their previous link stops working. Outside production the email reaches only the test inbox."
                : "Creates the manager's personal link (valid 30 days by default, Settings → Access) for you to copy and share. No email is sent. Their previous link stops working."
            }
          >
            <Button
              type="primary"
              icon={send ? <SendOutlined /> : <LinkOutlined />}
              disabled={!rmEmail}
              loading={create.isPending}
              onClick={() => create.mutate()}
            >
              {send ? 'Create and email' : 'Create link'}
            </Button>
          </Tooltip>
        </Space>

        <Alert
          type="info"
          showIcon
          style={{ marginTop: 14 }}
          message="Creating a new link revokes that manager's previous one"
          description="Outside production, 'Email it to them' only ever reaches the test inbox — never the real manager."
        />

        {lastUrl && (
          <Alert
            type="success"
            showIcon
            style={{ marginTop: 12 }}
            message="Link ready"
            description={<Typography.Text copyable={{ text: lastUrl }} style={{ wordBreak: 'break-all' }}>{lastUrl}</Typography.Text>}
          />
        )}
      </Card>

      <Card className="pea-card" size="small" title={<span className="pea-section-title">Issued links</span>}>
        <Table
          size="small"
          rowKey="id"
          loading={links.isLoading}
          dataSource={links.data || []}
          pagination={{ pageSize: 15, hideOnSinglePage: true }}
          scroll={{ x: 800 }}
          locale={{ emptyText: 'No links issued yet' }}
          columns={[
            {
              title: 'Manager',
              dataIndex: 'rm_name',
              render: (v, r) => (
                <div>
                  <div>{v || '—'}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{r.rm_email}</Typography.Text>
                </div>
              ),
            },
            {
              title: 'State',
              dataIndex: 'state',
              width: 100,
              render: (v) => <Tag color={v === 'active' ? 'green' : v === 'expired' ? 'default' : 'red'}>{v}</Tag>,
            },
            { title: 'Expires', dataIndex: 'expires_at', width: 180, render: fmt },
            { title: 'Last opened', dataIndex: 'last_used_at', width: 180, render: fmt },
            { title: 'Opens', dataIndex: 'use_count', width: 70 },
            { title: 'Issued by', dataIndex: 'created_by', width: 120 },
            {
              title: '',
              width: 110,
              render: (_, r) =>
                r.state === 'active' ? (
                  <Space size={4}>
                    <Tooltip title="Copy link: copies this manager's personal link to the clipboard so you can share it.">
                      <Button size="small" icon={<CopyOutlined />} onClick={() => copy(r.url)} />
                    </Tooltip>
                    <Popconfirm title="Revoke this link?" description="It stops working immediately." onConfirm={() => revoke.mutate(r.id)}>
                      <Tooltip title="Revoke link: asks to confirm, then cancels this link so it stops working immediately. Create a new link to give the manager access again.">
                        <Button size="small" danger icon={<StopOutlined />} />
                      </Tooltip>
                    </Popconfirm>
                  </Space>
                ) : null,
            },
          ]}
        />
      </Card>
    </>
  );
}
