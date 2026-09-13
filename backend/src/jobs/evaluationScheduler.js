/**
 * evaluationScheduler.js — the daily sweep.
 *
 * Replaces the `PEA - Sending Evaluation Form Link Flow V2` recurrence and, for
 * reminders, the `PEA - Sending Evaluation Reminders` flow that was never
 * exported (rules reconstructed from the PPT user guide — plan §2.3b).
 *
 * ── The one change that matters ─────────────────────────────────────────────
 *
 * The original asked `dateDifference(DOJ, utcNow()) == 30` and fired on exactly
 * one day per evaluation. A failed run, a throttled connector, a DOJ typed as
 * text, or an employee added to the sheet on day 31 all produced the same
 * outcome: the evaluation was skipped permanently, silently, and nobody found
 * out until a manager asked why they were never sent a form.
 *
 * This asks `due_date <= today`. Miss a day and tomorrow's run catches up. That
 * single change is most of the reason for the migration.
 *
 * ── Guards, carried over from the original flow ─────────────────────────────
 *   · completeness — DOJ, office email, RM name/email and PL email must exist
 *   · halt_process — the Excel "Halt_Process" column
 *   · confirmation — skip unless empty or "Extend for …"
 *   · employment   — never chase someone who has left
 *   · weekends     — handled at generation time, so due_date is already the
 *                    day the mail actually goes out
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { queueEmail } from '../services/notification.service.js';
import { notifyStaff } from '../services/inAppNotification.service.js';
import { runDeadlineAlerts } from '../services/confirmationDeadline.service.js';
import { todayIn, toDateString, addDays, toUtcMidnight } from '../utils/dateUtils.js';

let task = null;

/**
 * Reduce a timestamp to its calendar date at UTC midnight, so it can be
 * compared against `today` without the time of day affecting the answer.
 * @param {Date} value
 * @returns {Date}
 */
const startOfDay = (value) => toUtcMidnight(value);

/** Statuses meaning the link is out but no response has arrived. */
const AWAITING = ['email_sent', 'opened'];

/** Read a numeric setting with a fallback. */
async function numSetting(key, fallback) {
  const row = await prisma.pea_settings.findUnique({ where: { setting_key: key } });
  const n = Number(row?.setting_value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Employees eligible for any outbound mail at all.
 *
 * Expressed once here rather than repeated in the two sweeps below, so the
 * evaluation pass and the reminder pass can never drift apart on who is
 * eligible — which is precisely the kind of divergence that made the original
 * flows hard to reason about.
 */
const ELIGIBLE_EMPLOYEE = {
  halt_process: false,
  employment_status: 'active',
  OR: [{ confirmation_status: null }, { confirmation_status: { startsWith: 'Extend' } }],
  // The completeness guard the original applied before every send.
  NOT: [{ rm_email: '' }, { pl_email: '' }, { rm_name: '' }],
};

/**
 * Send evaluation links for everything now due.
 *
 * @param {{dryRun?: boolean}} [opts]
 * @returns {Promise<{due: number, sent: number, failed: number, rows: object[]}>}
 */
export async function runEvaluationSweep({ dryRun = false } = {}) {
  const today = todayIn(config.scheduler.timezone);

  const due = await prisma.pea_evaluation_cycles.findMany({
    where: {
      status: 'pending',
      // <= not ==. This is the self-healing property. See the header.
      due_date: { lte: today },
      employee: ELIGIBLE_EMPLOYEE,
    },
    include: { employee: true },
    orderBy: [{ due_date: 'asc' }, { employee_id: 'asc' }],
  });

  if (due.length === 0) {
    logger.info(`[sweep] nothing due as at ${toDateString(today)}`);
    return { due: 0, sent: 0, failed: 0, rows: [] };
  }

  logger.info(`[sweep] ${due.length} evaluation(s) due as at ${toDateString(today)}`);

  const validity = await numSetting('token_validity_days', 30);
  const rows = [];
  let sent = 0;
  let failed = 0;

  for (const cycle of due) {
    const label = `${cycle.employee.full_name} eval ${cycle.seq_no} (due ${toDateString(cycle.due_date)})`;

    if (dryRun) {
      rows.push({ cycle: label, to: cycle.employee.rm_email, action: 'would send' });
      continue;
    }

    // Per-row isolation: one bad mailbox must not stop everyone else's
    // evaluation going out. Copied from the ATS documentReminder pattern.
    try {
      const result = await queueEmail({ type: 'evaluation_link', cycle });

      if (result.status === 'failed') {
        failed += 1;
        // Leave it `pending` so the next sweep retries it. A transient Graph
        // outage should not cost someone their evaluation.
        rows.push({ cycle: label, to: result.to.join(', '), action: 'failed', error: result.error });
        continue;
      }

      await prisma.pea_evaluation_cycles.update({
        where: { id: cycle.id },
        data: {
          status: 'email_sent',
          sent_at: new Date(),
          token_expires_at: addDays(new Date(), validity),
          modified_at: new Date(),
        },
      });

      sent += 1;
      rows.push({ cycle: label, to: result.to.join(', '), action: result.status });
    } catch (err) {
      failed += 1;
      logger.error(`[sweep] ${label}: ${err.message}`);
      rows.push({ cycle: label, action: 'error', error: err.message });
    }
  }

  logger.info(`[sweep] evaluations — ${sent} sent, ${failed} failed of ${due.length} due`);

  if (failed > 0) {
    // A failed send is left pending and retried tomorrow — which is correct, but
    // it is also exactly the kind of quiet failure the old system hid. Say so.
    await notifyStaff({
      type: 'sweep_failures',
      title: `${failed} evaluation email(s) failed to send`,
      body: rows
        .filter((r) => r.action === 'failed' || r.action === 'error')
        .slice(0, 5)
        .map((r) => `${r.cycle}: ${r.error}`)
        .join('\n'),
      link: '/',
      severity: 'critical',
      dedupeKey: `sweep_failures:${toDateString(today)}`,
    });
  }

  return { due: due.length, sent, failed, rows };
}

/**
 * Chase evaluations that were sent but never submitted.
 *
 * Timing from the PPT user guide: two reminders, at day 32 and 34 for a fresher
 * whose evaluation fell on day 30, and 62/64 for someone experienced whose
 * evaluation fell on day 60 — i.e. +2 and +4 days.
 *
 * ── Counted from sent_at, NOT due_date ──────────────────────────────────────
 *
 * In the normal case the two are the same day, so this reproduces the
 * documented day 32/34 and 62/64 exactly.
 *
 * They diverge when the self-healing sweep catches up. If a run was missed and
 * an evaluation due on day 30 actually goes out on day 50, a due-date-based
 * rule would consider both reminders overdue and fire one in the very same
 * pass — the manager would receive the request and a "this is still awaiting
 * your response" chase within seconds of each other. Observed while testing.
 *
 * The manager's clock starts when the message reaches them, so sent_at is the
 * honest basis. It also means a reissued link (the adhoc resend, which clears
 * reminder_count) restarts the chase properly rather than immediately nagging.
 *
 * ⚠️ The reminder flow was never exported, so this timing is reconstructed and
 * HR must confirm it before go-live (plan §2.3b).
 *
 * @param {{dryRun?: boolean}} [opts]
 * @returns {Promise<{due: number, sent: number, failed: number, rows: object[]}>}
 */
export async function runReminderSweep({ dryRun = false } = {}) {
  const today = todayIn(config.scheduler.timezone);
  const maxReminders = await numSetting('reminder_max_count', 2);

  const offsetsRaw = await prisma.pea_settings.findUnique({
    where: { setting_key: 'reminder_offsets_days' },
  });
  const offsets = (offsetsRaw?.setting_value || '2,4')
    .split(',')
    .map((s) => Number(s.trim()))
    .filter(Number.isFinite);

  const outstanding = await prisma.pea_evaluation_cycles.findMany({
    where: {
      status: { in: AWAITING },
      reminder_count: { lt: maxReminders },
      employee: ELIGIBLE_EMPLOYEE,
    },
    include: { employee: true },
    orderBy: { due_date: 'asc' },
  });

  const rows = [];
  let sent = 0;
  let failed = 0;
  let dueCount = 0;

  for (const cycle of outstanding) {
    // The nth reminder is owed once we are past sent_at + offsets[n].
    const offset = offsets[cycle.reminder_count];
    if (offset === undefined) continue;

    // A cycle in an AWAITING status always has sent_at; fall back to due_date
    // defensively so a hand-edited row cannot make this crash.
    const basis = cycle.sent_at || cycle.due_date;
    const owedFrom = addDays(startOfDay(basis), offset);
    if (owedFrom > today) continue;

    dueCount += 1;
    const n = cycle.reminder_count + 1;
    const label = `${cycle.employee.full_name} eval ${cycle.seq_no} reminder ${n}`;

    if (dryRun) {
      rows.push({ cycle: label, to: cycle.employee.rm_email, action: 'would send' });
      continue;
    }

    try {
      const result = await queueEmail({
        type: 'reminder',
        cycle,
        context: { reminderNumber: n },
      });

      if (result.status === 'failed') {
        failed += 1;
        rows.push({ cycle: label, action: 'failed', error: result.error });
        continue;
      }

      await prisma.pea_evaluation_cycles.update({
        where: { id: cycle.id },
        data: { reminder_count: n, last_reminded_at: new Date(), modified_at: new Date() },
      });

      sent += 1;
      rows.push({ cycle: label, to: result.to.join(', '), action: result.status });
    } catch (err) {
      failed += 1;
      logger.error(`[sweep] ${label}: ${err.message}`);
      rows.push({ cycle: label, action: 'error', error: err.message });
    }
  }

  if (dueCount) logger.info(`[sweep] reminders — ${sent} sent, ${failed} failed of ${dueCount} due`);
  return { due: dueCount, sent, failed, rows };
}

/**
 * One full pass: evaluations, then reminders.
 * Exported so it can be triggered from the admin API and from tests.
 * @param {{dryRun?: boolean}} [opts]
 * @returns {Promise<object>}
 */
export async function runSweep(opts = {}) {
  const startedAt = new Date();
  const evaluations = await runEvaluationSweep(opts);
  const reminders = await runReminderSweep(opts);

  // Visibility only — never changes a record (decision 17 is still open).
  // Isolated so a problem here can never cost anyone an evaluation email.
  let deadlines;
  try {
    deadlines = await runDeadlineAlerts(opts);
  } catch (err) {
    logger.error(`[deadline] alert pass failed: ${err.message}`);
    deadlines = { error: err.message };
  }

  return {
    startedAt,
    finishedAt: new Date(),
    timezone: config.scheduler.timezone,
    today: toDateString(todayIn(config.scheduler.timezone)),
    dryRun: !!opts.dryRun,
    evaluations,
    reminders,
    deadlines,
  };
}

/**
 * Start the daily cron.
 *
 * The timezone is passed explicitly. The original ran on an 11:00 IST schedule
 * but did its date arithmetic in UTC, so for five and a half hours a day the
 * two disagreed about what "today" was — a likely contributor to the
 * intermittent misses. Plan R10.
 *
 * @returns {Promise<void>}
 */
export async function startScheduler() {
  if (!config.scheduler.enabled) {
    logger.warn('⏰ Scheduler DISABLED (PEA_SCHEDULER_ENABLED=false) — no evaluations will be sent');
    return;
  }

  const row = await prisma.pea_settings.findUnique({ where: { setting_key: 'sweep_cron' } });
  const expression = row?.setting_value || '0 11 * * *';
  const timezone = config.scheduler.timezone;

  if (!cron.validate(expression)) {
    logger.error(`⏰ Invalid sweep_cron "${expression}" — scheduler not started`);
    return;
  }

  task = cron.schedule(
    expression,
    async () => {
      try {
        const result = await runSweep();
        logger.info(
          `⏰ Daily sweep complete — evaluations: ${result.evaluations.sent} sent / ` +
            `${result.evaluations.failed} failed, reminders: ${result.reminders.sent} sent`
        );
      } catch (err) {
        // A silent scheduler is the single most dangerous failure mode here —
        // it is exactly what the old system suffered from — so this is loud.
        logger.error(`⏰ DAILY SWEEP FAILED: ${err.message}`, { stack: err.stack });
      }
    },
    { timezone }
  );

  logger.info(`⏰ Scheduler started — "${expression}" (${timezone})`);
}

/** Stop the cron on shutdown. */
export function stopScheduler() {
  if (task) {
    task.stop();
    task = null;
    logger.info('⏰ Scheduler stopped');
  }
}
