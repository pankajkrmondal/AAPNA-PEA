/**
 * EvaluationActions — what HR can do to one evaluation, from its page.
 *
 *   Send to someone else   an acting manager answers this one            M7
 *   Enter ratings          HR types them in on the manager's behalf      B5
 *     · Copy from evaluation N   start from last time's answers          M8
 *   Reopen                 hand a submitted one back to be corrected     M6
 *   Record what was done   about feedback that was flagged               P8
 *
 * The page offers only what the server says will work (`e.actions`), so a
 * database without the 02-10-2026 update simply shows fewer buttons. Every
 * rule is enforced again by the API; this file only avoids offering what
 * would be refused.
 */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Alert, App, Button, Collapse, Form, Input, Modal, Radio, Space, Table, Tooltip } from 'antd';
import {
  CheckCircleOutlined, CopyOutlined, EditOutlined, FlagOutlined, HistoryOutlined, RollbackOutlined, SwapOutlined,
} from '@ant-design/icons';
import api from '../api.js';
import StatusPill from './StatusPill.jsx';
import PersonPicker from './PersonPicker.jsx';
import { avg, decisionTone, formatDate, ratingWord } from '../evaluationDisplay.js';
import { formatDateTime } from '../formatDate.js';

const RATINGS = [1, 2, 3, 4, 5];

/** A mutation that posts to one of this evaluation's actions and reports the result. */
function useAction(e, path, { onDone, close }) {
  const { message } = App.useApp();
  return useMutation({
    mutationFn: (body) => api.post(`/evaluations/${e.id}/${path}`, body).then((r) => r.data),
    onSuccess: (res) => {
      message.success(res.message);
      close();
      onDone?.();
    },
    onError: (err) => { message.error(err.friendlyMessage); },
  });
}

/** M7 — send this one evaluation to an acting manager. */
function DelegateDialog({ e, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const act = useAction(e, 'delegate', { onDone, close: onClose });

  return (
    <Modal
      title={`Send evaluation ${e.seqNo} to someone else`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={act.isPending}
      okText="Send"
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="For when the reporting manager is away"
        description={
          <>
            This one evaluation goes to the person below in place of <strong>{e.rmName}</strong>, who is copied.
            Any link already sent stops working. The next evaluation goes to {e.rmName} again.
          </>
        }
      />
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => act.mutate(v)}>
        {/* U8 — pick the acting manager from Microsoft 365 by name; their email
            is filled in. Typing still works. It was a plain <Input />. */}
        <Form.Item
          name="name"
          label="Acting manager's name"
          rules={[{ required: true, whitespace: true, message: 'Give their name' }]}
          extra="Start typing a name to pick from Microsoft 365."
        >
          <PersonPicker onPick={(p) => form.setFieldsValue({ email: p.email })} />
        </Form.Item>
        <Form.Item name="email" label="Their email" rules={[{ required: true, type: 'email', message: 'Give a valid email address' }]}>
          <Input placeholder="name@aapnainfotech.com" />
        </Form.Item>
        <Form.Item name="note" label="Note for the record" extra="Optional. Kept in the change history, not sent.">
          <Input.TextArea rows={2} maxLength={500} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** B5 — HR enters the ratings in the app. M8 — "Copy from evaluation N". */
function RecordDialog({ e, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const act = useAction(e, 'record', { onDone, close: onClose });
  const before = e.previousEvaluation;

  const copyPrevious = () => {
    const ratings = {};
    for (const s of before.scores) {
      if (e.questions.some((q) => q.key === s.key)) {
        ratings[s.key] = { rating: s.rating == null ? undefined : Math.round(s.rating), comments: s.comment || '' };
      }
    }
    form.setFieldsValue({ ratings, remarks: before.remarks || '' });
  };

  return (
    <Modal
      title={`Enter ratings for evaluation ${e.seqNo} — ${e.employeeName}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={act.isPending}
      okText="Record evaluation"
      width={760}
      destroyOnClose
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message={`Recorded as entered by HR on behalf of ${e.withName || e.rmName}`}
        description={
          <>
            For history the manager never answered in PEA. A rating is needed on every question; a comment is not.
            No email is sent{e.linkLive ? ', and the link already with the manager stops working' : ''}.
            {e.isFinal && <> A confirmation decision is recorded separately, with <strong>Record decision</strong> on the Commando page.</>}
          </>
        }
      />
      {before && (
        <Tooltip title={`Fills in the ratings and comments from evaluation ${before.seqNo} as a starting point. Nothing is saved until you record.`}>
          <Button icon={<CopyOutlined />} onClick={copyPrevious} style={{ marginBottom: 14 }}>
            Copy from evaluation {before.seqNo}
          </Button>
        </Tooltip>
      )}
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => act.mutate(v)}>
        {e.questions.map((q, i) => (
          <div key={q.key} style={{ marginBottom: 14 }}>
            <Form.Item
              name={['ratings', q.key, 'rating']}
              label={`${i + 1}. ${q.label}`}
              rules={[{ required: true, message: 'Choose a rating' }]}
              style={{ marginBottom: 6 }}
            >
              <Radio.Group optionType="button" buttonStyle="solid">
                {RATINGS.map((n) => (
                  <Tooltip key={n} title={ratingWord(n)}><Radio.Button value={n}>{n}</Radio.Button></Tooltip>
                ))}
              </Radio.Group>
            </Form.Item>
            <Form.Item name={['ratings', q.key, 'comments']} style={{ marginBottom: 0 }}>
              <Input placeholder="Comment (optional)" maxLength={2000} />
            </Form.Item>
          </div>
        ))}
        <Form.Item name="remarks" label="Overall remarks (optional)">
          <Input.TextArea rows={2} maxLength={2000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** M6 — hand a submitted evaluation back to be corrected. */
function ReopenDialog({ e, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const act = useAction(e, 'reopen', { onDone, close: onClose });

  return (
    <Modal
      title={`Reopen evaluation ${e.seqNo} for ${e.employeeName}?`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={act.isPending}
      okText="Reopen and send back"
      destroyOnClose
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 14 }}
        message={`It goes back to ${e.answeredBy || e.rmName} to correct`}
        description={
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>Their answers are filled in on the form, so they change only what is wrong.</li>
            <li>What they submitted is kept as an earlier version, with your reason.</li>
            {e.decision && <li>The decision it carried (<strong>{e.decision}</strong>) is taken back until they submit again.</li>}
            <li>Until they do, this evaluation shows as waiting for the manager.</li>
          </ul>
        }
      />
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => act.mutate(v)}>
        <Form.Item
          name="reason"
          label="Why is it being reopened?"
          rules={[{ required: true, whitespace: true, message: 'Give a reason — the manager is told, and it is kept on the record' }]}
          extra="The manager sees this in the email."
        >
          <Input.TextArea rows={3} maxLength={2000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/** P8 — say what HR did about flagged feedback. */
function FollowUpDialog({ e, open, onClose, onDone }) {
  const [form] = Form.useForm();
  const act = useAction(e, 'follow-up', { onDone, close: onClose });

  return (
    <Modal
      title="Record what was done"
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={act.isPending}
      okText="Record"
      destroyOnClose
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => act.mutate(v)}>
        <Form.Item name="outcome" label="What was done about this evaluation?" rules={[{ required: true, message: 'Choose one' }]}>
          <Radio.Group>
            <Space direction="vertical" size={6}>
              {(e.followUpOutcomes || []).map((o) => <Radio key={o.value} value={o.value}>{o.label}</Radio>)}
            </Space>
          </Radio.Group>
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(a, b) => a.outcome !== b.outcome}>
          {({ getFieldValue }) => (
            <Form.Item
              name="note"
              label="Note"
              rules={[{ required: getFieldValue('outcome') === 'other', whitespace: true, message: 'Say what was done' }]}
              extra="Once recorded, this evaluation leaves “Needs attention” for the whole HR team."
            >
              <Input.TextArea rows={3} maxLength={2000} showCount />
            </Form.Item>
          )}
        </Form.Item>
      </Form>
    </Modal>
  );
}

/**
 * The buttons for an evaluation nobody has answered yet: send it to an acting
 * manager, or enter its ratings by hand.
 * @param {{e: object, onDone: () => void}} props
 */
export function OpenEvaluationActions({ e, onDone }) {
  const [dialog, setDialog] = useState(null);
  const can = e.actions || {};
  if (!can.delegate && !can.record) return null;

  return (
    <div className="pea-side-actions" style={{ marginTop: 10 }}>
      {can.delegate && (
        <Tooltip title="The reporting manager is away: send this one evaluation to an acting manager.">
          <Button icon={<SwapOutlined />} onClick={() => setDialog('delegate')} block>Send to someone else…</Button>
        </Tooltip>
      )}
      {can.record && (
        <Tooltip title="Type the ratings in on the manager's behalf — for history they never answered in PEA.">
          <Button icon={<EditOutlined />} onClick={() => setDialog('record')} block>Enter ratings…</Button>
        </Tooltip>
      )}
      <DelegateDialog e={e} open={dialog === 'delegate'} onClose={() => setDialog(null)} onDone={onDone} />
      <RecordDialog e={e} open={dialog === 'record'} onClose={() => setDialog(null)} onDone={onDone} />
    </div>
  );
}

/**
 * "Reopen…" for a submitted evaluation. Shown but disabled, with the reason,
 * when this one cannot be reopened — so HR is told why rather than left to wonder.
 * @param {{e: object, onDone: () => void}} props
 */
export function ReopenAction({ e, onDone }) {
  const [open, setOpen] = useState(false);
  const can = e.actions || {};
  if (!can.reopen && !can.reopenBlocked) return null;

  return (
    <>
      <Tooltip title={can.reopenBlocked || 'Send it back to be corrected. What was submitted is kept as an earlier version.'}>
        <Button type="text" icon={<RollbackOutlined />} disabled={!can.reopen} onClick={() => setOpen(true)}>
          Reopen…
        </Button>
      </Tooltip>
      <ReopenDialog e={e} open={open} onClose={() => setOpen(false)} onDone={onDone} />
    </>
  );
}

/**
 * Why an evaluation was flagged, and what HR did about it.
 * @param {{e: object, onDone: () => void}} props
 */
export function AttentionCard({ e, onDone }) {
  const [open, setOpen] = useState(false);
  if (!e.attentionReasons?.length) return null;
  const done = e.followUp;
  const can = e.actions || {};

  return (
    <section className="pea-card pea-card-pad pea-attention-card pea-no-print">
      <div className={`pea-kicker ${done ? 'pea-ink-ok' : 'pea-ink-warn'}`}>
        {done ? <><CheckCircleOutlined /> Flagged — dealt with</> : <><FlagOutlined /> Needs attention</>}
      </div>
      <ul>{e.attentionReasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {done && (
        <p className="pea-small" style={{ marginBottom: 8 }}>
          <strong>{done.label}</strong>
          {done.note && <> — {done.note}</>}
          <br />
          <span className="pea-muted">{done.by} · {formatDateTime(done.at)}</span>
        </p>
      )}
      {can.followUp && (
        <Button size="small" type={done ? 'default' : 'primary'} onClick={() => setOpen(true)}>
          {done ? 'Add another' : 'Record what was done'}
        </Button>
      )}
      {(e.followUps || []).length > 1 && (
        <Collapse
          ghost
          size="small"
          style={{ marginTop: 6 }}
          items={[{
            key: 'all',
            label: `All ${e.followUps.length} follow-ups`,
            children: (
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {e.followUps.map((f) => (
                  <li key={`${f.at}-${f.outcome}`} className="pea-small">
                    <strong>{f.label}</strong>{f.note && <> — {f.note}</>}{' '}
                    <span className="pea-muted">({f.by}, {formatDateTime(f.at)})</span>
                  </li>
                ))}
              </ul>
            ),
          }]}
        />
      )}
      <FollowUpDialog e={e} open={open} onClose={() => setOpen(false)} onDone={onDone} />
    </section>
  );
}

/**
 * What was submitted before each time HR reopened this evaluation — M6.
 * @param {{revisions?: object[]}} props
 */
export function EarlierVersions({ revisions = [] }) {
  if (!revisions.length) return null;

  return (
    <section className="pea-card pea-card-pad pea-no-print" style={{ marginTop: 16 }}>
      <div className="pea-kicker"><HistoryOutlined /> Earlier version{revisions.length === 1 ? '' : 's'}</div>
      <Collapse
        ghost
        items={revisions.map((r) => ({
          key: r.id,
          label: (
            <span>
              Submitted {formatDate(r.submittedAt)}{r.answeredBy ? ` by ${r.answeredBy}` : ''}
              {r.avgRating != null && <> · average {avg(r.avgRating)}</>}
              {r.decision && <> · <StatusPill tone={decisionTone(r.decision)} nodot>{r.decision}</StatusPill></>}
            </span>
          ),
          children: (
            <>
              <p className="pea-small">
                <strong>Reopened by {r.reopenedBy} on {formatDateTime(r.reopenedAt)}.</strong> {r.reason}
              </p>
              <Table
                size="small"
                rowKey="key"
                pagination={false}
                dataSource={r.scores}
                columns={[
                  { title: 'Question', dataIndex: 'label' },
                  { title: 'Rating', dataIndex: 'rating', width: 80 },
                  { title: 'Comment', dataIndex: 'comment', render: (v) => v || '—' },
                ]}
              />
              {r.remarks && <p className="pea-small" style={{ marginTop: 8 }}><strong>Overall remarks:</strong> {r.remarks}</p>}
              {r.decisionReason && <p className="pea-small"><strong>Reason for the decision:</strong> {r.decisionReason}</p>}
            </>
          ),
        }))}
      />
    </section>
  );
}
