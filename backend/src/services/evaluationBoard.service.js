/**
 * evaluationBoard.service.js — "What every manager said".
 *
 * ── Why a second read model beside evaluationList.service.js ──────────────
 *
 * The work list answers "what is outstanding?". The board answers the question
 * HR actually asked in the redesign review: "what did the manager SAY?" — the
 * overall comment, the reason for the decision and every question comment, for
 * every evaluation, on one screen. The work list never loaded a single comment,
 * so reading one meant opening an employee, expanding a row, and doing that
 * forty times.
 *
 * The board card, the table row and the evaluation profile all come from
 * `shape()` below, so the three can never disagree about a status, a delta or
 * whether something needs attention.
 *
 * ── Status buckets ────────────────────────────────────────────────────────
 *
 * The design's chips, derived — nothing new is stored:
 *
 *   scheduled  pending, not yet due            (the calendar working normally)
 *   not_sent   pending, past due               (a fault someone must fix)
 *   waiting    email_sent                      (link out, not opened)
 *   opened     opened                          (manager has the form open)
 *   submitted  completed
 *   closed     skipped                         (no longer needed)
 *
 * ── "Needs attention" ─────────────────────────────────────────────────────
 *
 * A SUBMITTED evaluation needs a read when the manager did not confirm, or
 * extended, or the average is below 2.5, or any single question is rated 2 or
 * lower. Those are the rules printed on the design's filter banner, and they
 * live in exactly one SQL fragment and one JS function here.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { RATING_SCALE } from '../config/ratingScale.js';
import { hasDecisionReason, hasEvaluationReads } from '../utils/schemaCapabilities.js';
import { todayIn, toDateString, daysBetween, dateIn } from '../utils/dateUtils.js';

/** An average below this needs a read. */
export const LOW_AVERAGE = 2.5;
/** A single question rated at or below this needs a read. */
export const LOW_RATING = 2;

/** How far back the Dashboard looks for feedback that still needs a read. */
export const FEEDBACK_WINDOW_DAYS = 30;

/**
 * Compact question names for the card grid, where the full label wraps. The
 * profile and the email still use the label the manager was shown.
 */
export const SHORT_LABELS = Object.freeze({
  quality_of_work: 'Quality',
  meeting_deadline: 'Deadlines',
  communication: 'Communication',
  proactiveness: 'Proactiveness',
  skill_development: 'Skill growth',
  cultural_fit: 'Culture fit',
  x_factor: 'X-Factor',
});

/** The chips, in the order the design shows them. `attention` is the last. */
export const BUCKETS = Object.freeze(['submitted', 'waiting', 'opened', 'scheduled', 'not_sent', 'closed']);

/** Everything a caller may filter by. `in_progress` and `recent` back the section "Show all" links. */
const STATUS_FILTERS = new Set(['all', ...BUCKETS, 'attention', 'in_progress', 'recent']);

const IN_PROGRESS = ['waiting', 'opened', 'not_sent', 'scheduled'];

/**
 * The word for a rating, from the same scale the manager rated against.
 * An average is placed at its nearest whole point: 2.57 reads "Satisfied",
 * 1.71 "Dissatisfied" — which is how the design labels them.
 * @param {number|null} value
 * @returns {{label: string, tone: 'crit'|'info'|'ok'}|null}
 */
export function ratingBand(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  const point = Math.min(5, Math.max(1, Math.round(Number(value))));
  const row = RATING_SCALE.find((r) => r.value === point);
  return { label: row.label, tone: point <= LOW_RATING ? 'crit' : point === 3 ? 'info' : 'ok' };
}

/**
 * Why a submitted evaluation needs a read — the JS twin of ATTENTION_SQL.
 * @param {{status: string, confirmation_status: string|null, avg_rating: any, scores?: {rating: any}[]}} c
 * @returns {string[]} empty when it does not
 */
export function attentionReasons(c) {
  if (c.status !== 'completed') return [];
  const reasons = [];
  const decision = c.confirmation_status || '';

  if (decision === 'Not Confirmed') reasons.push('Not confirmed');
  if (decision.startsWith('Extend')) reasons.push('Probation extended');

  const avg = c.avg_rating === null || c.avg_rating === undefined ? null : Number(c.avg_rating);
  if (avg !== null && avg < LOW_AVERAGE) reasons.push(`Average below ${LOW_AVERAGE}`);

  const low = (c.scores || []).filter((s) => s.rating !== null && Number(s.rating) <= LOW_RATING).length;
  if (low) reasons.push(`${low} question${low === 1 ? '' : 's'} rated ${LOW_RATING} or lower`);

  return reasons;
}

/** SQL twin of attentionReasons(). `c` is pea_evaluation_cycles. */
const ATTENTION_SQL = Prisma.sql`(
  c.status = 'completed' AND (
       c.confirmation_status = 'Not Confirmed'
    OR c.confirmation_status LIKE 'Extend%'
    OR c.avg_rating < ${LOW_AVERAGE}
    OR EXISTS (SELECT 1 FROM pea_evaluation_scores s WHERE s.cycle_id = c.id AND s.rating <= ${LOW_RATING})
  ))`;

/** @param {Date} today */
const bucketSql = (today) => Prisma.sql`CASE
    WHEN c.status = 'completed'  THEN 'submitted'
    WHEN c.status = 'opened'     THEN 'opened'
    WHEN c.status = 'email_sent' THEN 'waiting'
    WHEN c.status = 'pending' AND c.due_date <= ${today} THEN 'not_sent'
    WHEN c.status = 'pending'    THEN 'scheduled'
    ELSE 'closed' END`;

/**
 * The board's filters as one WHERE clause over `pea_evaluation_cycles c JOIN
 * pea_employees e`. Only active employees: a leaver's evaluations are history,
 * not work, and they stay readable on the employee page.
 */
function filterSql(q) {
  const parts = [Prisma.sql`e.employment_status = 'active'`];

  const search = String(q.search || '').trim();
  if (search) {
    const like = `%${search}%`;
    parts.push(Prisma.sql`(e.full_name ILIKE ${like} OR e.office_email ILIKE ${like}
                           OR e.rm_name ILIKE ${like} OR e.rm_email ILIKE ${like})`);
  }

  const rm = String(q.rm || '').trim().toLowerCase();
  if (rm) parts.push(Prisma.sql`lower(e.rm_email) = ${rm}`);

  if (q.cohort === 'fresher') parts.push(Prisma.sql`e.is_experienced = false`);
  if (q.cohort === 'experienced') parts.push(Prisma.sql`e.is_experienced = true`);

  // "Any date": the day something happened — submitted if it was, otherwise
  // when it is (or was) due.
  const day = Prisma.sql`COALESCE((c.submitted_at AT TIME ZONE ${config.scheduler.timezone})::date, c.due_date)`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.from || '')) parts.push(Prisma.sql`${day} >= ${q.from}::date`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.to || '')) parts.push(Prisma.sql`${day} <= ${q.to}::date`);

  return Prisma.join(parts, ' AND ');
}

/** Restrict an already-bucketed row set to one chip. */
function statusSql(status) {
  switch (status) {
    case 'attention': return Prisma.sql`b.attention`;
    case 'recent': return Prisma.sql`b.bucket = 'submitted' AND NOT b.attention`;
    case 'in_progress': return Prisma.sql`b.bucket IN ('waiting','opened','not_sent','scheduled')`;
    case 'all': return Prisma.sql`TRUE`;
    default: return Prisma.sql`b.bucket = ${status}`;
  }
}

/**
 * One order for every list, so "1 of 41" on the profile is the same position
 * the row had on the board. Needs-attention first, then fresh feedback, then
 * work in progress — oldest waiting first — then closed.
 */
const ORDER_SQL = Prisma.sql`
  CASE WHEN b.attention THEN 0
       WHEN b.bucket = 'submitted' THEN 1
       WHEN b.bucket = 'waiting'   THEN 2
       WHEN b.bucket = 'opened'    THEN 3
       WHEN b.bucket = 'not_sent'  THEN 4
       WHEN b.bucket = 'scheduled' THEN 5
       ELSE 6 END,
  b.submitted_at DESC NULLS LAST,
  CASE WHEN b.bucket IN ('waiting','opened') THEN b.sent_at END ASC NULLS LAST,
  b.due_date ASC,
  b.id ASC`;

/** The bucketed, filtered set as a CTE body. */
function baseSql(q, today) {
  return Prisma.sql`
    SELECT c.id, c.status, c.due_date, c.sent_at, c.submitted_at, c.avg_rating,
           ${bucketSql(today)} AS bucket,
           ${ATTENTION_SQL}   AS attention
      FROM pea_evaluation_cycles c
      JOIN pea_employees e ON e.id = c.employee_id
     WHERE ${filterSql(q)}`;
}

/**
 * Chip counts and the four headline figures, for the filters in hand (search,
 * manager, cohort, date) but across every status — so a chip always says how
 * many rows clicking it would show.
 */
async function summarise(q, today) {
  const [row] = await prisma.$queryRaw`
    WITH b AS (${baseSql(q, today)})
    SELECT count(*)::int                                             AS all,
           count(*) FILTER (WHERE bucket = 'submitted')::int         AS submitted,
           count(*) FILTER (WHERE bucket = 'waiting')::int           AS waiting,
           count(*) FILTER (WHERE bucket = 'opened')::int            AS opened,
           count(*) FILTER (WHERE bucket = 'scheduled')::int         AS scheduled,
           count(*) FILTER (WHERE bucket = 'not_sent')::int          AS not_sent,
           count(*) FILTER (WHERE bucket = 'closed')::int            AS closed,
           count(*) FILTER (WHERE attention)::int                    AS attention,
           count(*) FILTER (WHERE bucket = 'submitted' AND NOT attention)::int AS recent,
           count(*) FILTER (WHERE bucket IN ('waiting','opened','not_sent','scheduled'))::int AS in_progress,
           round(avg(avg_rating) FILTER (WHERE bucket = 'submitted'), 2)::float AS average
      FROM b`;

  return {
    counts: {
      all: row.all,
      submitted: row.submitted,
      waiting: row.waiting,
      opened: row.opened,
      scheduled: row.scheduled,
      not_sent: row.not_sent,
      closed: row.closed,
      attention: row.attention,
      recent: row.recent,
      in_progress: row.in_progress,
    },
    stats: {
      submitted: row.submitted,
      // "Waiting for manager" includes the ones the manager has opened: the
      // form being open is not an answer.
      waitingForManager: row.waiting + row.opened,
      needAttention: row.attention,
      averageRating: row.average,
    },
  };
}

/** Ordered ids for one status, optionally one page of them. */
async function orderedIds(q, status, today, { limit = null, offset = 0 } = {}) {
  const page = limit ? Prisma.sql`LIMIT ${limit} OFFSET ${offset}` : Prisma.empty;
  const rows = await prisma.$queryRaw`
    WITH b AS (${baseSql(q, today)})
    SELECT b.id::text AS id FROM b
     WHERE ${statusSql(status)}
     ORDER BY ${ORDER_SQL}
     ${page}`;
  return rows.map((r) => r.id);
}

/** confirmation_reason by cycle id — empty until the 2026-09-23 DDL is applied. */
async function reasonsFor(ids) {
  if (!ids.length || !(await hasDecisionReason())) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT id::text AS id, confirmation_reason AS reason
      FROM pea_evaluation_cycles
     WHERE id = ANY(${ids.map(BigInt)}::bigint[]) AND confirmation_reason IS NOT NULL`;
  return new Map(rows.map((r) => [r.id, r.reason]));
}

/** Which of these cycles this user has read — empty until the DDL is applied. */
async function readsFor(ids, userId) {
  if (!ids.length || !userId || !(await hasEvaluationReads())) return new Set();
  const rows = await prisma.$queryRaw`
    SELECT cycle_id::text AS id FROM pea_evaluation_reads
     WHERE user_id = ${Number(userId)} AND cycle_id = ANY(${ids.map(BigInt)}::bigint[])`;
  return new Set(rows.map((r) => r.id));
}

const EMPLOYEE_SELECT = {
  id: true, full_name: true, office_email: true, is_experienced: true, doj: true,
  rm_name: true, rm_email: true, pl_email: true, confirmation_status: true,
  halt_process: true, employment_status: true,
};

/**
 * Load cycles by id, with everything shape() needs, in the order given.
 * @param {string[]} ids
 * @param {{today: Date, userId?: number}} ctx
 */
async function hydrate(ids, { today, userId }) {
  if (!ids.length) return [];

  const cycles = await prisma.pea_evaluation_cycles.findMany({
    where: { id: { in: ids.map(BigInt) } },
    include: { employee: { select: EMPLOYEE_SELECT }, scores: { orderBy: { sort_order: 'asc' } } },
  });

  const employeeIds = [...new Set(cycles.map((c) => c.employee_id))];
  const [siblings, reasons, reads] = await Promise.all([
    prisma.pea_evaluation_cycles.findMany({
      where: { employee_id: { in: employeeIds } },
      select: { id: true, employee_id: true, seq_no: true, status: true, avg_rating: true, is_extension: true },
      orderBy: { seq_no: 'asc' },
    }),
    reasonsFor(ids),
    readsFor(ids, userId),
  ]);

  const byEmployee = new Map();
  for (const s of siblings) {
    const key = String(s.employee_id);
    if (!byEmployee.has(key)) byEmployee.set(key, []);
    byEmployee.get(key).push(s);
  }

  const byId = new Map(cycles.map((c) => [String(c.id), c]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((c) => shape(c, {
      today,
      siblings: byEmployee.get(String(c.employee_id)) || [],
      reason: reasons.get(String(c.id)) || null,
      read: reads.has(String(c.id)),
    }));
}

const num = (v) => (v === null || v === undefined ? null : Number(v));

/** Calendar days from one instant to another, in the scheduler's timezone. */
const tzDays = (from, to) =>
  from && to ? daysBetween(dateIn(from, config.scheduler.timezone), dateIn(to, config.scheduler.timezone)) : null;

/**
 * One evaluation as every screen shows it.
 * @param {object} c - cycle with employee and scores
 * @param {{today: Date, siblings: object[], reason: string|null, read: boolean}} ctx
 */
function shape(c, { today, siblings, reason, read }) {
  const e = c.employee;
  const tz = config.scheduler.timezone;

  const bucket =
    c.status === 'completed' ? 'submitted'
      : c.status === 'opened' ? 'opened'
        : c.status === 'email_sent' ? 'waiting'
          : c.status === 'pending' ? (c.due_date <= today ? 'not_sent' : 'scheduled')
            : 'closed';

  // "Evaluation 6 of 6": the planned schedule, so an extension granted later
  // does not rewrite what the final evaluation was called. An extension
  // cycle counts against everything scheduled.
  const planned = siblings.filter((s) => !s.is_extension).length;
  const total = siblings.length;
  const maxSeq = siblings.reduce((m, s) => Math.max(m, s.seq_no), 0);
  const isFinal = !!c.confirmation_status || (c.seq_no === maxSeq && c.status !== 'completed');

  // The change since the evaluation before — the nearest earlier SUBMITTED one.
  const previous = siblings
    .filter((s) => s.seq_no < c.seq_no && s.status === 'completed' && s.avg_rating !== null)
    .at(-1);
  const avg = num(c.avg_rating);
  const previousAvg = previous ? num(previous.avg_rating) : null;

  const scores = (c.scores || []).map((s) => ({
    key: s.param_key,
    label: s.param_label,
    short: SHORT_LABELS[s.param_key] || s.param_label,
    rating: num(s.rating),
    comment: s.comments || null,
  }));

  const awaiting = c.status === 'email_sent' || c.status === 'opened';
  const reasons = attentionReasons({ ...c, scores: c.scores });

  return {
    id: String(c.id),
    employeeId: String(e.id),
    employeeName: e.full_name,
    employeeEmail: e.office_email,
    cohort: e.is_experienced ? 'experienced' : 'fresher',
    doj: toDateString(e.doj),
    rmName: e.rm_name,
    rmEmail: e.rm_email,
    plEmail: e.pl_email,
    employeeDecision: e.confirmation_status,

    seqNo: c.seq_no,
    of: c.is_extension ? total : planned,
    totalCycles: total,
    isFinal,
    isExtension: c.is_extension,
    periodFrom: c.period_from ? toDateString(c.period_from) : null,
    periodTo: c.period_to ? toDateString(c.period_to) : null,
    dueDate: toDateString(c.due_date),

    status: c.status,
    bucket,
    sentAt: c.sent_at,
    openedAt: c.opened_at,
    submittedAt: c.submitted_at,
    submittedBy: c.submitted_by_email,
    reminderCount: c.reminder_count,
    lastRemindedAt: c.last_reminded_at,
    daysAfterSending: c.submitted_at && c.sent_at ? tzDays(c.sent_at, c.submitted_at) : null,
    waitingDays: awaiting && c.sent_at
      ? daysBetween(dateIn(c.sent_at, tz), today)
      : bucket === 'not_sent' ? daysBetween(c.due_date, today) : null,

    avgRating: avg,
    band: ratingBand(avg),
    previousAvg,
    previousSeqNo: previous?.seq_no ?? null,
    delta: avg !== null && previousAvg !== null ? Number((avg - previousAvg).toFixed(2)) : null,

    decision: c.confirmation_status,
    reason,
    remarks: c.remarks,
    legacy: c.legacy_format ? { format: c.legacy_format, raw: c.legacy_raw } : null,

    scores,
    questionCount: scores.length,
    commentedCount: scores.filter((s) => s.comment).length,

    attention: reasons.length > 0,
    attentionReasons: reasons,
    read,

    // Only while a manager could still use it.
    linkLive: awaiting && (!c.token_expires_at || c.token_expires_at > new Date()),
    token: awaiting ? c.token : null,
  };
}

/** Reporting managers who have at least one active employee, for the filter. */
async function managerOptions() {
  const rows = await prisma.$queryRaw`
    SELECT lower(rm_email) AS email, min(rm_name) AS name, count(*)::int AS people
      FROM pea_employees
     WHERE employment_status = 'active' AND coalesce(rm_email, '') <> ''
     GROUP BY lower(rm_email)
     ORDER BY min(rm_name)`;
  return rows;
}

/**
 * The board.
 *
 * @param {object} q
 * @param {string} [q.status='all'] - a chip key, `attention`, `in_progress` or `recent`
 * @param {string} [q.search] @param {string} [q.rm] @param {'fresher'|'experienced'} [q.cohort]
 * @param {string} [q.from] @param {string} [q.to] - YYYY-MM-DD
 * @param {'1'|'true'} [q.sections] - also return the three card-view sections
 * @param {number} [q.page=1] @param {number} [q.limit=24]
 * @param {number} [userId] - for read receipts
 */
export async function getBoard(q = {}, userId = null) {
  const today = todayIn(config.scheduler.timezone);
  const status = STATUS_FILTERS.has(q.status) ? q.status : 'all';
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 24));

  const wantSections = status === 'all' && (q.sections === '1' || q.sections === 'true');

  const [summary, pageIds, managers] = await Promise.all([
    summarise(q, today),
    wantSections ? Promise.resolve([]) : orderedIds(q, status, today, { limit, offset: (page - 1) * limit }),
    managerOptions(),
  ]);

  const result = {
    today: toDateString(today),
    status,
    ...summary,
    managers,
    page,
    limit,
    total: summary.counts[status] ?? summary.counts.all,
    rows: await hydrate(pageIds, { today, userId }),
  };

  if (wantSections) {
    // The card view's default: a few of each, most urgent first, with the
    // section's full count so "Show all" is never a surprise.
    const [attention, recent, inProgress] = await Promise.all([
      orderedIds(q, 'attention', today, { limit: 4 }),
      orderedIds(q, 'recent', today, { limit: 4 }),
      orderedIds(q, 'in_progress', today, { limit: 8 }),
    ]);
    const all = await hydrate([...attention, ...recent, ...inProgress], { today, userId });
    const pick = (ids) => ids.map((id) => all.find((r) => r.id === id)).filter(Boolean);

    result.sections = [
      { key: 'attention', title: 'Needs attention', total: summary.counts.attention, rows: pick(attention) },
      { key: 'recent', title: 'Recently submitted', total: summary.counts.recent, rows: pick(recent) },
      { key: 'in_progress', title: 'In progress — no comments yet', total: summary.counts.in_progress, rows: pick(inProgress) },
    ];
  }

  return result;
}

/**
 * The status timeline for one evaluation: scheduled → sent → reminders →
 * opened → submitted. Reminder dates come from the email log, which records
 * every one PEA sent; the counter alone cannot say when.
 */
async function timelineFor(c) {
  const reminders = await prisma.pea_email_log.findMany({
    where: { cycle_id: BigInt(c.id), email_type: 'reminder', status: { in: ['sent', 'suppressed'] } },
    select: { sent_at: true },
    orderBy: { sent_at: 'asc' },
  });
  const reminderDates = reminders.map((r) => r.sent_at);
  if (!reminderDates.length && c.reminderCount && c.lastRemindedAt) reminderDates.push(c.lastRemindedAt);

  const submitted = c.bucket === 'submitted';
  const steps = [
    { key: 'scheduled', label: 'Scheduled', at: c.dueDate, dateOnly: true, done: true, note: `due ${c.dueDate}` },
    { key: 'sent', label: 'Sent to manager', at: c.sentAt, done: !!c.sentAt },
  ];

  if (reminderDates.length || c.reminderCount) {
    const n = Math.max(reminderDates.length, c.reminderCount);
    steps.push({ key: 'reminders', label: `${n} reminder${n === 1 ? '' : 's'}`, dates: reminderDates, done: true });
  }

  steps.push(
    { key: 'opened', label: 'Opened', at: c.openedAt, done: !!c.openedAt },
    { key: 'submitted', label: 'Submitted', at: c.submittedAt, done: submitted },
  );

  // The step the evaluation is sitting on — the last one reached, unless it
  // has been submitted, in which case the last step is simply done.
  const reached = steps.filter((s) => s.done);
  const current = submitted ? 'submitted' : reached.at(-1)?.key;
  return steps.map((s) => ({ ...s, current: s.key === current }));
}

/**
 * One evaluation, as the profile page shows it.
 *
 * @param {string|number} id
 * @param {object} [q] - the board filters the reader arrived with, so Previous
 *   / Next walk the same list ("1 of 41 in Submitted")
 * @param {number} [userId]
 */
export async function getEvaluation(id, q = {}, userId = null) {
  if (!/^\d+$/.test(String(id))) throw new AppError('Evaluation not found', 404);
  const today = todayIn(config.scheduler.timezone);

  const [row] = await hydrate([String(id)], { today, userId });
  if (!row) throw new AppError('Evaluation not found', 404);

  const cycles = await prisma.pea_evaluation_cycles.findMany({
    where: { employee_id: BigInt(row.employeeId) },
    include: { scores: { select: { param_key: true, rating: true } } },
    orderBy: { seq_no: 'asc' },
  });

  // Per-question change since the previous submitted evaluation.
  const prev = cycles.filter((c) => c.seq_no < row.seqNo && c.status === 'completed' && c.scores.length).at(-1);
  const prevRatings = new Map((prev?.scores || []).map((s) => [s.param_key, num(s.rating)]));
  const scores = row.scores.map((s) => {
    const before = prevRatings.has(s.key) ? prevRatings.get(s.key) : null;
    return {
      ...s,
      band: ratingBand(s.rating),
      previous: before,
      delta: before !== null && s.rating !== null ? s.rating - before : null,
    };
  });

  // The sparkline: every submitted average up to and including this one.
  const history = cycles
    .filter((c) => c.seq_no <= row.seqNo && c.status === 'completed' && c.avg_rating !== null)
    .map((c) => ({ seqNo: c.seq_no, avg: num(c.avg_rating), current: c.seq_no === row.seqNo }));

  // After an extension, the next evaluation is already on the calendar.
  const next = cycles.find((c) => c.seq_no > row.seqNo && c.status !== 'skipped');
  const nextEvaluation = next
    ? { id: String(next.id), seqNo: next.seq_no, dueDate: toDateString(next.due_date), isExtension: next.is_extension }
    : null;

  // Not yet answered: show the questions the manager is being asked.
  let questions = [];
  if (!scores.length && !row.legacy) {
    questions = await prisma.pea_evaluation_params.findMany({
      where: { template: row.cohort, is_active: true },
      select: { param_key: true, param_label: true, sort_order: true },
      orderBy: { sort_order: 'asc' },
    });
  }

  // Previous / next in the list the reader came from.
  const status = STATUS_FILTERS.has(q.status) ? q.status : row.bucket;
  const ids = await orderedIds(q, status, today);
  const index = ids.indexOf(row.id);
  const neighbourIds = [ids[index - 1], ids[index + 1]].filter(Boolean);
  const neighbours = neighbourIds.length
    ? await prisma.pea_evaluation_cycles.findMany({
      where: { id: { in: neighbourIds.map(BigInt) } },
      select: { id: true, seq_no: true, employee: { select: { full_name: true } } },
    })
    : [];
  const describe = (nid) => {
    const n = neighbours.find((x) => String(x.id) === nid);
    return n ? { id: nid, name: n.employee.full_name, seqNo: n.seq_no } : null;
  };

  // reminder_count is capped at 2 by a CHECK (it drives the automatic chase),
  // so a manual "Remind now" on top is only visible in the email log. The page
  // shows one number, the true one, everywhere.
  const timeline = await timelineFor(row);
  const reminderStep = timeline.find((s) => s.key === 'reminders');
  const reminderCount = Math.max(row.reminderCount, reminderStep?.dates?.length || 0);

  return {
    ...row,
    reminderCount,
    scores,
    history,
    nextEvaluation,
    questions: questions.map((p) => ({ key: p.param_key, label: p.param_label })),
    timeline,
    navigation: {
      status,
      position: index >= 0 ? index + 1 : null,
      total: ids.length,
      previous: index > 0 ? describe(ids[index - 1]) : null,
      next: index >= 0 && index < ids.length - 1 ? describe(ids[index + 1]) : null,
    },
  };
}

/**
 * Record that this user has read a submitted evaluation. Idempotent, and a
 * no-op until the table exists — reading must never fail because of it.
 * @returns {Promise<boolean>} whether a receipt was stored
 */
export async function markRead(cycleId, userId) {
  if (!/^\d+$/.test(String(cycleId)) || !userId || !(await hasEvaluationReads())) return false;
  await prisma.$executeRaw`
    INSERT INTO pea_evaluation_reads (cycle_id, user_id)
    SELECT ${BigInt(cycleId)}, ${Number(userId)}
     WHERE EXISTS (SELECT 1 FROM pea_evaluation_cycles WHERE id = ${BigInt(cycleId)} AND status = 'completed')
    ON CONFLICT (cycle_id, user_id) DO NOTHING`;
  return true;
}

/**
 * Submitted evaluations that need attention and this user has not read, most
 * recent first — the "Read feedback" rows on the Dashboard.
 *
 * @param {number|null} userId
 * @param {{days?: number}} [opts]
 * @returns {Promise<{items: object[], submittedThisWeek: number}>}
 */
export async function getUnreadFeedback(userId, { days = FEEDBACK_WINDOW_DAYS } = {}) {
  const today = todayIn(config.scheduler.timezone);
  const since = new Date(Date.now() - days * 86_400_000);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);

  const [candidates, [{ week }]] = await Promise.all([
    prisma.$queryRaw`
      SELECT c.id::text AS id
        FROM pea_evaluation_cycles c
        JOIN pea_employees e ON e.id = c.employee_id
       WHERE e.employment_status = 'active'
         AND c.submitted_at >= ${since}
         AND ${ATTENTION_SQL}
       ORDER BY c.submitted_at DESC`,
    prisma.$queryRaw`
      SELECT count(*)::int AS week FROM pea_evaluation_cycles
       WHERE status = 'completed' AND submitted_at >= ${weekAgo}`,
  ]);

  const rows = await hydrate(candidates.map((r) => r.id), { today, userId });
  return { items: rows.filter((r) => !r.read), submittedThisWeek: week };
}
