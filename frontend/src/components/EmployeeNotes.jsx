/**
 * EmployeeNotes — HR's notes on a Commando. L7.
 *
 * For what does not belong in an evaluation and should not be lost in
 * someone's inbox: "on medical leave until the 14th", "manager asked for a
 * mentor", "spoke to them about attendance". Notes only — no attachments.
 *
 * Seen by signed-in PEA users on this page and nowhere else. The Commando's
 * own view and the manager portal have no route to them.
 *
 * A note is added or deleted, never edited: what was written on a day stays
 * what was written on that day. Whoever wrote one can delete it, and so can an
 * admin; that it was deleted is recorded in the change history.
 *
 * The card is not shown at all until the database has the notes table
 * (2026-10-02 DDL) — `available: false` from the API.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { App, Button, Card, Input, Popconfirm, Typography } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import api, { unwrap } from '../api.js';
import HintIcon from './HintIcon.jsx';
import { formatDateTime } from '../formatDate.js';

/**
 * @param {{employeeId: string|number, name: string}} props
 */
// Archive (07-10-2026) — `readOnly` for an archived Commando: the notes are
// shown, but none can be added or deleted until they are restored.
export default function EmployeeNotes({ employeeId, name, readOnly = false }) {
  const { message } = App.useApp();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');

  const { data } = useQuery({
    queryKey: ['employee-notes', String(employeeId)],
    queryFn: () => api.get(`/employees/${employeeId}/notes`).then(unwrap),
    // Notes are an extra on this page; failing to load them must not break it.
    retry: false,
  });

  const reload = () => qc.invalidateQueries({ queryKey: ['employee-notes', String(employeeId)] });

  const add = useMutation({
    mutationFn: (body) => api.post(`/employees/${employeeId}/notes`, { body }).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      setDraft('');
      reload();
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  const remove = useMutation({
    mutationFn: (noteId) => api.delete(`/employees/${employeeId}/notes/${noteId}`).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      reload();
      // The deletion is written to the change history, which this page also shows.
      qc.invalidateQueries({ queryKey: ['employee', String(employeeId)] });
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });

  if (!data?.available) return null;

  const notes = data.notes || [];

  return (
    <Card
      className="pea-card pea-notes-card"
      size="small"
      title={
        <span className="pea-section-title">
          Notes
          <HintIcon title="HR's own notes on this Commando. Seen by signed-in PEA users only — never by the Commando or their manager, and never in a shared report. A note cannot be edited; whoever wrote it, or an admin, can delete it." />
        </span>
      }
      extra={<span className="pea-count pea-count-muted">{notes.length}</span>}
    >
      {!readOnly && (<>
      <Input.TextArea
        value={draft}
        onChange={(ev) => setDraft(ev.target.value)}
        autoSize={{ minRows: 2, maxRows: 8 }}
        maxLength={data.max}
        showCount
        placeholder={`A note about ${name} — for HR only`}
        aria-label="New note"
      />
      <Button
        type="primary"
        style={{ marginTop: 8 }}
        disabled={!draft.trim()}
        loading={add.isPending}
        onClick={() => add.mutate(draft)}
      >
        Add note
      </Button>
      </>)}

      <div style={{ marginTop: 12 }}>
        {notes.length === 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>No notes yet.</Typography.Text>
        )}
        {notes.map((n) => (
          <div className="pea-note" key={n.id}>
            <p className="pea-note-body">{n.body}</p>
            <div className="pea-note-meta">
              <span>{n.created_by} · {formatDateTime(n.created_at)}</span>
              {n.can_delete && !readOnly && (
                <Popconfirm
                  title="Delete this note?"
                  description="It cannot be brought back. The change history records that a note was deleted, not what it said."
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => remove.mutate(n.id)}
                >
                  <Button
                    size="small"
                    type="text"
                    icon={<DeleteOutlined />}
                    aria-label="Delete note"
                    loading={remove.isPending && remove.variables === n.id}
                  />
                </Popconfirm>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
