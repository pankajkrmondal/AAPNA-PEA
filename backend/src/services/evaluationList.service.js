/**
 * evaluationList.service.js — every evaluation in one list.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * There has never been a list of evaluations across people. To answer "what is
 * outstanding?" you either opened employees one at a time, or read four
 * separate Dashboard tables that each stop at 25 rows — so on a busy month the
 * honest answer was "I cannot tell from this screen".
 *
 * ── The tabs are the Overview figures ──────────────────────────────────────
 *
 * Each tab here is exactly one of the Overview counts, so clicking a figure
 * opens the matching list and the two can never disagree. That is the reason
 * the filters live in one place (`SCOPES`) rather than being written out twice:
 * a count that does not match its own list is worse than no count at all.
 *
 * ── Status is derived, not stored ──────────────────────────────────────────
 *
 * `pending` in the database is two different situations: not yet due, and past
 * due with no email sent. The second is a fault someone must act on; the first
 * is the calendar working normally. They are separated here, matching
 * frontend/src/evaluationStatus.js.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { queueEmail } from './notification.service.js';
import { leaverHoldApplies } from './evaluation.service.js';
import { todayIn, addDays, toDateString, daysBetween } from '../utils/dateUtils.js';

/** Statuses meaning the link is out and nobody has responded. */
const AWAITING = ['email_sent', 'opened'];

/** How far ahead "coming up" looks. Matches the Dashboard. */
const SOON_DAYS = 14;

/** The database CHECK on reminder_count. See remindNow() for why it matters. */
const MAX_REMINDER_COUNT = 2;

/**
 * Only evaluations for people PEA would actually chase. A left, held or
 * already-decided employee's rows are noise on a work list.
 */
const listableEmployee = {
  employment_status: 'active',
};

/**
 * The tab definitions: one place, used for both the counts and the rows.
 * @param {Date} today
 * @returns {Record<string, {label: string, where: object}>}
 */
function scopes(today) {
  const soon = addDays(today, SOON_DAYS);

  return {
    waiting: {
      label: 'Waiting for manager',
      where: { status: { in: AWAITING } },
    },
    not_sent: {
      label: 'Not sent yet',
      where: { status: 'pending', due_date: { lte: today } },
    },
    due_soon: {
      label: `Due in ${SOON_DAYS} days`,
      where: { status: 'pending', due_date: { gt: today, lte: soon } },
    },
    decisions: {
      label: 'Decisions due',
      // The cycle carrying the confirm/extend question, still unanswered.
      where: {
        status: { in: [...AWAITING, 'pending'] },
        due_date: { lte: soon },
        employee: { confirmation_status: null },
        is_final: true,
      },
    },
    submitted: {
      label: 'Submitted',
      where: { status: 'completed' },
    },
    all: {
      label: 'All',
      where: {},
    },
  };
}

/**
 * Is this the cycle on which the confirmation decision is asked?
 *
 * It is the highest-numbered cycle the employee has — 6 for a fresher, 3 for
 * someone experienced, and the new final one after an extension. Prisma cannot
 * express "the maximum seq_no per employee" in a `where`, so the decisions tab
 * is filtered in SQL below rather than through the scope object.
 */
const FINAL_CYCLE_SQL = Prisma.sql`
  c.seq_no = (SELECT max(x.seq_no) FROM pea_evaluation_cycles x WHERE x.employee_id = c.employee_id)`;

/**
 * Counts for every tab, in one pass.
 * @returns {Promise<Record<string, number>>}
 */
export async function getCounts() {
  const today = todayIn(config.scheduler.timezone);
  const soon = addDays(today, SOON_DAYS);

  const [row] = await prisma.$queryRaw`
    SELECT
      count(*) FILTER (WHERE c.status IN ('email_sent','opened'))::int              AS waiting,
      count(*) FILTER (WHERE c.status = 'pending' AND c.due_date <= ${today})::int  AS not_sent,
      count(*) FILTER (WHERE c.status = 'pending'
                         AND c.due_date > ${today} AND c.due_date <= ${soon})::int  AS due_soon,
      count(*) FILTER (WHERE c.status IN ('email_sent','opened','pending')
                         AND c.due_date <= ${soon}
                         AND e.confirmation_status IS NULL
                         AND ${FINAL_CYCLE_SQL})::int                               AS decisions,
      count(*) FILTER (WHERE c.status = 'completed')::int                           AS submitted,
      count(*)::int                                                                 AS all
      FROM pea_evaluation_cycles c
      JOIN pea_employees e ON e.id = c.employee_id
     WHERE e.employment_status = 'active'`;

  return row;
}

/**
 * One page of evaluations.
 *
 * @param {object} q
 * @param {string} [q.scope='all'] - a key of scopes()
 * @param {string} [q.search] - employee name or office email
 * @param {string} [q.rm] - reporting manager email
 * @param {'fresher'|'experienced'} [q.cohort]
 * @param {string} [q.dueFrom] @param {string} [q.dueTo] - YYYY-MM-DD
 * @param {number} [q.page=1] @param {number} [q.limit=50]
 * @returns {Promise<{rows: object[], total: number, page: number, limit: number, counts: object}>}
 */
export async function listEvaluations(q = {}) {
  const today = todayIn(config.scheduler.timezone);
  const table = scopes(today);
  const scope = table[q.scope] ? q.scope : 'all';

  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));

  const where = {
    ...table[scope].where,
    employee: { ...listableEmployee, ...(table[scope].where.employee || {}) },
  };

  // `is_final` is not a column — it is the marker the decisions scope uses.
  // Translated here into the one thing Prisma can express, and finished off
  // with a post-filter below.
  const decisionsOnly = where.is_final === true;
  delete where.is_final;

  const search = String(q.search || '').trim();
  if (search) {
    where.employee.OR = [
      { full_name: { contains: search, mode: 'insensitive' } },
      { office_email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const rm = String(q.rm || '').trim().toLowerCase();
  if (rm) where.employee.rm_email = { equals: rm, mode: 'insensitive' };

  if (q.cohort === 'fresher') where.employee.is_experienced = false;
  if (q.cohort === 'experienced') where.employee.is_experienced = true;

  if (q.dueFrom || q.dueTo) {
    where.due_date = {
      ...(where.due_date || {}),
      ...(q.dueFrom ? { gte: new Date(q.dueFrom) } : {}),
      ...(q.dueTo ? { lte: new Date(q.dueTo) } : {}),
    };
  }

  // The decisions scope needs "highest seq_no for this employee", which Prisma
  // cannot express. Resolve those ids first and constrain by them.
  if (decisionsOnly) {
    const finals = await prisma.$queryRaw`
      SELECT c.id::text AS id
        FROM pea_evaluation_cycles c
       WHERE ${FINAL_CYCLE_SQL}`;
    where.id = { in: finals.map((f) => BigInt(f.id)) };
  }

  const [rows, total, counts] = await Promise.all([
    prisma.pea_evaluation_cycles.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true, full_name: true, office_email: true, is_experienced: true,
            rm_name: true, rm_email: true, pl_email: true, confirmation_status: true,
          },
        },
      },
      orderBy: [{ due_date: 'asc' }, { employee_id: 'asc' }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.pea_evaluation_cycles.count({ where }),
    getCounts(),
  ]);

  return {
    rows: rows.map((c) => shape(c, today)),
    total,
    page,
    limit,
    counts,
    scope,
    scopes: Object.entries(table).map(([key, s]) => ({ key, label: s.label })),
  };
}

/**
 * One row as the screen needs it, with the derived facts the table shows.
 * @param {object} c - cycle with `employee` included
 * @param {Date} today
 */
function shape(c, today) {
  const e = c.employee;
  const overdueUnsent = c.status === 'pending' && c.due_date <= today;

  return {
    id: String(c.id),
    employeeId: String(e.id),
    employeeName: e.full_name,
    employeeEmail: e.office_email,
    cohort: e.is_experienced ? 'experienced' : 'fresher',
    rmName: e.rm_name,
    rmEmail: e.rm_email,
    plEmail: e.pl_email,
    confirmationStatus: e.confirmation_status,

    seqNo: c.seq_no,
    isExtension: c.is_extension,
    periodFrom: toDateString(c.period_from),
    periodTo: toDateString(c.period_to),
    dueDate: toDateString(c.due_date),
    sentAt: c.sent_at,
    submittedAt: c.submitted_at,
    avgRating: c.avg_rating === null ? null : Number(c.avg_rating),
    reminderCount: c.reminder_count,
    legacy: !!c.legacy_format,

    // The screen shows "Not sent yet" in red for this case; the raw status is
    // still sent so the client is never guessing.
    status: c.status,
    derivedStatus: overdueUnsent ? 'not_sent' : c.status,

    // How long someone has been waiting — the column HR sorts by in practice.
    waitingDays:
      c.status === 'pending' && overdueUnsent
        ? daysBetween(c.due_date, today)
        : AWAITING.includes(c.status) && c.sent_at
          ? daysBetween(c.sent_at, today)
          : null,

    // Whether a link exists that a manager could still open.
    linkLive: AWAITING.includes(c.status) && c.token_expires_at > new Date(),
    token: AWAITING.includes(c.status) ? c.token : null,
  };
}

/**
 * Send an extra reminder for one or more evaluations, now.
 *
 * Deliberately NOT the same as "Resend" on the employee page. Resend issues a
 * fresh link, which silently invalidates the one already in the manager's
 * inbox — so a manager who was halfway through the form loses it. This nudges
 * the EXISTING link: same token, same form, one more email.
 *
 * Every guard the automatic sweep applies is applied here too. A held leaver
 * must not be chased just because HR ticked a row on a list.
 *
 * @param {Array<string|number|bigint>} ids - cycle ids
 * @param {string} actor
 * @returns {Promise<{sent: number, skipped: object[]}>}
 */
export async function remindNow(ids, actor) {
  const wanted = [...new Set((ids || []).map(String))].filter((s) => /^\d+$/.test(s));
  if (wanted.length === 0) throw new AppError('Select at least one evaluation to remind.', 400);
  if (wanted.length > 100) throw new AppError('Please remind at most 100 evaluations at a time.', 400);

  const cycles = await prisma.pea_evaluation_cycles.findMany({
    where: { id: { in: wanted.map(BigInt) } },
    include: { employee: true },
  });

  const skipped = [];
  let sent = 0;

  for (const cycle of cycles) {
    const who = `${cycle.employee.full_name} · evaluation ${cycle.seq_no}`;

    if (!AWAITING.includes(cycle.status)) {
      skipped.push({ id: String(cycle.id), who, reason: 'No link is outstanding for this evaluation.' });
      continue;
    }
    if (cycle.token_expires_at && cycle.token_expires_at < new Date()) {
      skipped.push({ id: String(cycle.id), who, reason: 'The link has expired — use Resend to issue a new one.' });
      continue;
    }
    if (cycle.employee.halt_process) {
      skipped.push({ id: String(cycle.id), who, reason: 'Evaluations are on hold for this person.' });
      continue;
    }
    if (cycle.employee.employment_status !== 'active') {
      skipped.push({ id: String(cycle.id), who, reason: 'This person is marked as having left.' });
      continue;
    }
    // eslint-disable-next-line no-await-in-loop
    if (await leaverHoldApplies(cycle.employee)) {
      skipped.push({ id: String(cycle.id), who, reason: 'On hold — Microsoft 365 shows this person may have left.' });
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const result = await queueEmail({
      type: 'reminder',
      cycle,
      context: { reminderNumber: cycle.reminder_count + 1 },
    });

    if (result.status === 'failed') {
      skipped.push({ id: String(cycle.id), who, reason: result.error || 'The email could not be sent.' });
      continue;
    }

    // `reminder_count` is CHECK-constrained to 0..2 because it drives the
    // AUTOMATIC chase: the sweep stops once it reaches the configured maximum.
    // A manual nudge is a person deciding to ask again, not the schedule
    // running, so it must not be able to push the counter out of range — the
    // artifact shows "Remind now" on rows already at "2 of 2", which is exactly
    // the case that would otherwise hit the constraint and surface as a raw
    // database error. Capped, and the real time is recorded in
    // last_reminded_at either way.
    const capped = Math.min(cycle.reminder_count + 1, MAX_REMINDER_COUNT);

    // eslint-disable-next-line no-await-in-loop
    await prisma.pea_evaluation_cycles.update({
      where: { id: cycle.id },
      data: {
        reminder_count: capped,
        last_reminded_at: new Date(),
        modified_at: new Date(),
      },
    });
    sent += 1;
  }

  logger.info(`[evaluations] ${actor} sent ${sent} manual reminder(s), ${skipped.length} skipped`);
  return { sent, skipped };
}

/**
 * Every email PEA has sent — the "Emails sent" view.
 *
 * Every send is already recorded in pea_email_log and nothing has ever read
 * those rows back, so "did that manager actually get the email?" could only be
 * answered from the database. Stage 9 of the go-live plan depends on being able
 * to answer it from the screen.
 *
 * @param {object} q
 * @param {string} [q.type] - email_type filter
 * @param {string} [q.status] - sent | failed | suppressed
 * @param {string} [q.search] - recipient or subject
 * @param {number} [q.page=1] @param {number} [q.limit=50]
 */
export async function listEmails(q = {}) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));

  const where = {};
  if (q.type) where.email_type = String(q.type);
  if (q.status) where.status = String(q.status);

  const search = String(q.search || '').trim();
  if (search) {
    where.OR = [
      { recipient_email: { contains: search, mode: 'insensitive' } },
      { subject: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [rows, total, byStatus, byType] = await Promise.all([
    prisma.pea_email_log.findMany({
      where,
      include: {
        employee: { select: { id: true, full_name: true } },
        cycle: { select: { seq_no: true } },
      },
      orderBy: { sent_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.pea_email_log.count({ where }),
    prisma.pea_email_log.groupBy({ by: ['status'], _count: true }),
    prisma.pea_email_log.groupBy({ by: ['email_type'], _count: true }),
  ]);

  return {
    rows: rows.map((r) => ({
      id: String(r.id),
      sentAt: r.sent_at,
      type: r.email_type,
      to: r.recipient_email,
      cc: r.cc_emails,
      subject: r.subject,
      status: r.status,
      error: r.error_message,
      employeeId: r.employee ? String(r.employee.id) : null,
      employeeName: r.employee?.full_name || null,
      seqNo: r.cycle?.seq_no ?? null,
    })),
    total,
    page,
    limit,
    byStatus: Object.fromEntries(byStatus.map((s) => [s.status, s._count])),
    byType: Object.fromEntries(byType.map((t) => [t.email_type, t._count])),
  };
}
