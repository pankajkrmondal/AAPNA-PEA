/**
 * confirmationDeadline.service.js — the rule nobody had written down. Plan §2.7.
 *
 *   1. A new joiner starts with Confirmation Status empty.
 *   2. By 6 months from DOJ — 8 with an extension — a decision must be recorded.
 *
 * Measured against the real master sheet, 15 of 54 rows (28%) break it, some by
 * four years. They went unnoticed because a blank cell that is overdue looks
 * exactly like a blank cell that is supposed to be blank. This service makes the
 * difference visible.
 *
 * The existing `finishedWithoutDecision` check only fires once every cycle is
 * resolved. This one fires on the calendar, whatever state the cycles are in —
 * which is what would have caught the 15 stale rows the day each went stale.
 *
 * ⚠️ Decision 17 (should PEA *enforce* the deadline?) is still open with HR, so
 * this raises visibility only: a dashboard list, the bell, and an HR email
 * digest that is OFF unless `deadline_alert_email_enabled` is 'true'. It never
 * changes an employee record.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { addMonths, daysBetween, todayIn, toDateString, toUtcMidnight } from '../utils/dateUtils.js';
import { notifyStaff } from './inAppNotification.service.js';
import { queueEmail } from './notification.service.js';

const FINAL = ['Confirmed', 'Not Confirmed'];
const SOON_DAYS = 14;

/**
 * Where one employee stands against the deadline.
 *
 * Pure, so the rule is testable without a database.
 *
 * @param {{doj: Date|string, confirmation_status: string|null}} employee
 * @param {Date} today - UTC midnight
 * @param {{months?: number, extendedMonths?: number}} [rule]
 * @returns {{state: 'closed'|'ok'|'due_soon'|'overdue', deadline: Date|null, daysOverdue: number, extended: boolean}}
 */
export function assessDeadline(employee, today, { months = 6, extendedMonths = 8 } = {}) {
  const status = employee.confirmation_status || null;

  if (status && FINAL.includes(status)) {
    return { state: 'closed', deadline: null, daysOverdue: 0, extended: false };
  }

  const doj = toUtcMidnight(employee.doj);
  if (!doj) return { state: 'ok', deadline: null, daysOverdue: 0, extended: false };

  // "Extend for …" IS a filled-in status, but it is not an ending: the
  // probation still needs Confirmed or Not Confirmed, by the later deadline.
  const extended = !!status && status.startsWith('Extend');
  const deadline = addMonths(doj, extended ? extendedMonths : months);
  const delta = daysBetween(deadline, today); // positive once past

  if (delta > 0) return { state: 'overdue', deadline, daysOverdue: delta, extended };
  if (delta >= -SOON_DAYS) return { state: 'due_soon', deadline, daysOverdue: delta, extended };
  return { state: 'ok', deadline, daysOverdue: delta, extended };
}

/** Deadline lengths from settings, with the plan's values as fallback. */
async function rule() {
  const rows = await prisma.pea_settings.findMany({
    where: {
      setting_key: { in: ['confirmation_deadline_months', 'confirmation_deadline_extended_months'] },
    },
  });
  const byKey = Object.fromEntries(rows.map((r) => [r.setting_key, Number(r.setting_value)]));
  return {
    months: Number.isFinite(byKey.confirmation_deadline_months) && byKey.confirmation_deadline_months > 0
      ? byKey.confirmation_deadline_months
      : 6,
    extendedMonths:
      Number.isFinite(byKey.confirmation_deadline_extended_months) && byKey.confirmation_deadline_extended_months > 0
        ? byKey.confirmation_deadline_extended_months
        : 8,
  };
}

/**
 * Every active probation that is overdue or due within two weeks.
 * @returns {Promise<{rule: object, overdue: object[], dueSoon: object[]}>}
 */
export async function findDeadlineBreaches() {
  const today = todayIn(config.scheduler.timezone);
  const r = await rule();

  const open = await prisma.pea_employees.findMany({
    where: {
      employment_status: 'active',
      OR: [{ confirmation_status: null }, { confirmation_status: { startsWith: 'Extend' } }],
    },
    select: {
      id: true,
      full_name: true,
      office_email: true,
      doj: true,
      rm_name: true,
      confirmation_status: true,
      halt_process: true,
      is_experienced: true,
    },
    orderBy: { doj: 'asc' },
  });

  const overdue = [];
  const dueSoon = [];

  for (const e of open) {
    const a = assessDeadline(e, today, r);
    if (a.state !== 'overdue' && a.state !== 'due_soon') continue;

    const row = {
      id: String(e.id),
      full_name: e.full_name,
      office_email: e.office_email,
      rm_name: e.rm_name,
      doj: toDateString(e.doj),
      confirmation_status: e.confirmation_status,
      paused: e.halt_process,
      type: e.is_experienced ? 'experienced' : 'fresher',
      deadline: toDateString(a.deadline),
      extended: a.extended,
      daysOverdue: a.daysOverdue,
      monthsOverdue: a.state === 'overdue' ? Math.floor(a.daysOverdue / 30) : 0,
    };

    (a.state === 'overdue' ? overdue : dueSoon).push(row);
  }

  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue);
  dueSoon.sort((a, b) => b.daysOverdue - a.daysOverdue);

  return { rule: r, today: toDateString(today), overdue, dueSoon };
}

/**
 * The daily pass: ring the bell once per newly overdue probation, and send the
 * HR digest if HR has switched it on.
 *
 * @param {{dryRun?: boolean}} [opts]
 * @returns {Promise<object>}
 */
export async function runDeadlineAlerts({ dryRun = false } = {}) {
  const { overdue, dueSoon, today } = await findDeadlineBreaches();

  if (dryRun) return { dryRun, overdue: overdue.length, dueSoon: dueSoon.length, notified: 0, emailed: false };

  let notified = 0;
  for (const e of overdue) {
    // Keyed on employee + deadline: announced once, not every morning. If the
    // deadline moves (an extension is granted) the new one is announced afresh.
    notified += await notifyStaff({
      type: 'confirmation_overdue',
      title: `Confirmation overdue — ${e.full_name}`,
      body:
        `Deadline was ${e.deadline} (${e.extended ? 'extended probation' : '6 months from DOJ'}). ` +
        `${e.daysOverdue} day(s) past with no final decision recorded.`,
      link: `/employees/${e.id}`,
      severity: e.daysOverdue > 60 ? 'critical' : 'warning',
      dedupeKey: `deadline:${e.id}:${e.deadline}`,
    });
  }

  let emailed = false;
  const toggle = await prisma.pea_settings.findUnique({
    where: { setting_key: 'deadline_alert_email_enabled' },
  });

  if (toggle?.setting_value === 'true' && overdue.length > 0) {
    // The subject comes from the Email Templates screen ({{overdue_count}}, {{today}}).
    const result = await queueEmail({
      type: 'deadline_alert',
      context: { overdue, dueSoon, today },
    });
    emailed = result.status !== 'failed';
  }

  logger.info(
    `[deadline] ${overdue.length} overdue, ${dueSoon.length} due within ${SOON_DAYS} days — ` +
      `${notified} notification(s) raised${emailed ? ', HR digest queued' : ''}`
  );

  return { dryRun, overdue: overdue.length, dueSoon: dueSoon.length, notified, emailed };
}
