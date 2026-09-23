/**
 * needsAction.service.js — one ranked list of what HR should do next.
 *
 * ── Why one list rather than four tables ───────────────────────────────────
 *
 * The Dashboard showed overdue evaluations, awaiting evaluations, confirmation
 * deadlines and data-quality problems as four separate tables, each capped at
 * 25 rows. That layout asks the reader to do the prioritising: to look at four
 * lists and work out which of them is actually urgent this morning. It also
 * hides the worst cases, because a table sorted by date puts the oldest first
 * only within its own category — a probation 60 days past its decision sits in
 * a different table from an evaluation nobody can send at all.
 *
 * This produces ONE list, most urgent first, where every row says what is wrong
 * in plain words and carries the single action that fixes it.
 *
 * ── The ranking ────────────────────────────────────────────────────────────
 *
 * Severity first, then how long it has been wrong. The order of the kinds is a
 * judgement about consequence:
 *
 *   1. blocked      — PEA physically cannot send. Silent and permanent until a
 *                     person fixes the record, so it outranks anything that is
 *                     merely late.
 *   2. decision     — a probation past its confirmation deadline. Someone's
 *                     employment status is unresolved.
 *   3. not_sent     — due, but no email has gone out. The schedule has slipped.
 *   4. waiting      — the manager has the link and has not answered.
 *
 * Nothing here is capped at a low number: the point of the list is that it
 * ends, so HR can see they are done.
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import { todayIn, daysBetween, dateIn, formatDisplay } from '../utils/dateUtils.js';
import { findDeadlineBreaches } from './confirmationDeadline.service.js';
import { getUnreadFeedback } from './evaluationBoard.service.js';

const AWAITING = ['email_sent', 'opened'];

/**
 * Rank order — lower sorts first.
 *
 * `feedback` (23-Sep redesign) is a submitted evaluation that needs a read: not
 * confirmed, extended, or low scores. It sits after the missed deadline and
 * before the slipped schedule — a manager has told HR something is wrong, and
 * nobody on HR has read it yet.
 */
const KIND_RANK = { blocked: 0, decision: 1, feedback: 2, not_sent: 3, waiting: 4 };

/** The pill on a feedback row: the most serious of its reasons. */
function feedbackProblem(r) {
  if (r.decision === 'Not Confirmed') return 'Not confirmed';
  if (r.decision?.startsWith('Extend')) return 'Probation extended';
  return 'Low scores';
}

/** "1.86 / 5 · all 7 questions rated 2 or lower · “Struggling with the pace…”" */
function feedbackDetail(r) {
  const parts = [`${r.avgRating?.toFixed(2) ?? '—'} / 5`];
  if (r.decision?.startsWith('Extend')) parts.push(r.decision);
  if (!r.decision) {
    const low = r.scores.filter((s) => s.rating !== null && s.rating <= 2).length;
    if (low) parts.push(`${low === r.scores.length ? `all ${low}` : low} question${low === 1 ? '' : 's'} rated 2 or lower`);
  }
  const text = r.remarks || r.reason;
  if (text) parts.push(`“${text.length > 110 ? `${text.slice(0, 110).trimEnd()}…` : text}”`);
  return parts.join(' · ');
}

/**
 * Everything that needs a person, ranked.
 *
 * @param {{limit?: number, userId?: number}} [opts] - `userId` decides which
 *   feedback this person has already read
 * @returns {Promise<{items: object[], total: number, byKind: object, summary: object}>}
 */
export async function getNeedsAction({ limit = 50, userId = null } = {}) {
  const today = todayIn(config.scheduler.timezone);

  const [cycles, deadlines, feedback] = await Promise.all([
    prisma.pea_evaluation_cycles.findMany({
      where: {
        OR: [
          { status: 'pending', due_date: { lte: today } },
          { status: { in: AWAITING } },
        ],
        employee: { employment_status: 'active', halt_process: false },
      },
      include: {
        employee: {
          select: {
            id: true, full_name: true, is_experienced: true,
            rm_name: true, rm_email: true, pl_email: true,
            leaver_flagged_at: true, leaver_dismissed_at: true,
          },
        },
      },
      orderBy: { due_date: 'asc' },
    }),
    findDeadlineBreaches(),
    // Best-effort: the list must still load if the read-receipt lookup fails.
    getUnreadFeedback(userId).catch(() => ({ items: [], submittedThisWeek: 0 })),
  ]);

  const items = [];
  // A held leaver's whole schedule is stopped, so listing every stopped cycle
  // would bury the rest of the list under one person. One row per person, with
  // the count on it.
  const heldSeen = new Map();

  // ── Evaluations ──────────────────────────────────────────────────────────
  for (const c of cycles) {
    const e = c.employee;

    // A record PEA cannot send for is a different problem from a late one, and
    // it will never resolve itself. The completeness guard in the sweep is the
    // same list of fields, so this is what that guard is silently skipping.
    const missing = [];
    if (!e.rm_email?.trim()) missing.push('reporting manager email');
    if (!e.rm_name?.trim()) missing.push('reporting manager name');
    if (!e.pl_email?.trim()) missing.push('project leader email');

    const heldAsLeaver =
      !!e.leaver_flagged_at
      && !(e.leaver_dismissed_at && e.leaver_dismissed_at >= e.leaver_flagged_at);

    // A held leaver is NOT dropped from this list.
    //
    // The first version skipped these, reasoning that New joiners already shows
    // them. Against real data that removed 23 of 24 items — because a flag
    // silently stops evaluations, and the person whose evaluations stopped is
    // precisely who HR needs to decide about. A "what needs doing" list that
    // hides work is the failure this screen exists to prevent, so it is shown
    // as its own kind with the action pointing at the decision.
    if (heldAsLeaver) {
      const existing = heldSeen.get(String(e.id));
      if (existing) {
        existing.stopped += 1;
        existing.days = Math.max(existing.days, daysBetween(c.due_date, today));
      } else {
        const row = {
          kind: 'blocked',
          employeeId: String(e.id),
          employeeName: e.full_name,
          title: `${e.full_name} · on hold`,
          problem: 'May have left',
          detail:
            'Microsoft 365 shows this account switched off or gone, so evaluations have stopped. '
            + 'Confirm the exit, or mark them as still here.',
          action: 'Review',
          link: '/new-joiners',
          days: daysBetween(c.due_date, today),
          stopped: 1,
        };
        heldSeen.set(String(e.id), row);
        items.push(row);
      }
      continue;
    }

    if (missing.length > 0) {
      items.push({
        kind: 'blocked',
        employeeId: String(e.id),
        employeeName: e.full_name,
        title: `${e.full_name} · evaluation ${c.seq_no}`,
        problem: 'Cannot be sent',
        detail: `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing.`,
        action: 'Fix details',
        link: `/employees/${e.id}`,
        days: daysBetween(c.due_date, today),
        cycleId: String(c.id),
      });
      continue;
    }

    if (c.status === 'pending') {
      items.push({
        kind: 'not_sent',
        employeeId: String(e.id),
        employeeName: e.full_name,
        title: `${e.full_name} · evaluation ${c.seq_no}`,
        problem: 'Not sent yet',
        detail: `Due ${formatDisplay(c.due_date)}, no email has gone out.`,
        action: 'Send now',
        // Straight to the evaluation — the row was about this one, and its
        // page shows the status timeline and the send action together.
        link: `/evaluations/${c.id}?status=not_sent`,
        days: daysBetween(c.due_date, today),
        cycleId: String(c.id),
      });
      continue;
    }

    const waiting = c.sent_at ? daysBetween(c.sent_at, today) : 0;
    const chased = c.reminder_count;

    items.push({
      kind: 'waiting',
      employeeId: String(e.id),
      employeeName: e.full_name,
      title: `${e.full_name} · evaluation ${c.seq_no}`,
      problem: `Waiting ${waiting} day${waiting === 1 ? '' : 's'}`,
      detail:
        `${chased === 0 ? 'No reminder sent yet' : `${chased} reminder${chased === 1 ? '' : 's'} sent`}`
        + ` · manager ${e.rm_name || e.rm_email}`,
      action: 'Remind now',
      link: `/evaluations/${c.id}?status=${c.status === 'opened' ? 'opened' : 'waiting'}`,
      days: waiting,
      cycleId: String(c.id),
    });
  }

  // ── Confirmation decisions ───────────────────────────────────────────────
  for (const d of deadlines.overdue) {
    items.push({
      kind: 'decision',
      employeeId: String(d.id),
      employeeName: d.full_name,
      title: `${d.full_name} · confirmation decision`,
      problem: `Deadline passed ${d.daysOverdue} day${d.daysOverdue === 1 ? '' : 's'} ago`,
      detail:
        `Probation ended ${d.deadline}${d.extended ? ' (extended)' : ''}, no decision recorded.`,
      action: 'Open',
      link: `/employees/${d.id}`,
      days: d.daysOverdue,
    });
  }

  // ── Feedback that needs a read ───────────────────────────────────────────
  for (const r of feedback.items) {
    items.push({
      kind: 'feedback',
      employeeId: r.employeeId,
      employeeName: r.employeeName,
      title: `${r.employeeName} · evaluation ${r.seqNo}${r.isFinal ? ' · final' : ''}`,
      problem: feedbackProblem(r),
      detail: feedbackDetail(r),
      action: 'Read feedback',
      link: `/evaluations/${r.id}`,
      days: r.submittedAt ? daysBetween(dateIn(r.submittedAt, config.scheduler.timezone), today) : 0,
      cycleId: r.id,
    });
  }

  // Within a kind, the longest-standing first — except feedback, which is
  // newest first: yesterday's extension is the one nobody has seen.
  items.sort(
    (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind]
      || (a.kind === 'feedback' ? a.days - b.days : b.days - a.days)
      || a.employeeName.localeCompare(b.employeeName)
  );

  const byKind = items.reduce((acc, i) => ({ ...acc, [i.kind]: (acc[i.kind] || 0) + 1 }), {});

  return {
    items: items.slice(0, limit),
    total: items.length,
    byKind,
    // "Five evaluations came back this week. Three need a read."
    summary: { submittedThisWeek: feedback.submittedThisWeek, needRead: feedback.items.length },
  };
}
