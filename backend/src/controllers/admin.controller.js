/**
 * admin.controller.js — operational controls.
 *
 * The manual send endpoint replaces `PEA - Adhoc Flow`, which was a Power
 * Automate button taking an employee email and an evaluation number. It existed
 * because the scheduler silently missed people and HR needed a way to recover.
 * The new sweep is self-healing, so this is now a deliberate override rather
 * than a repair tool — but HR still needs it for a manager who deleted the
 * email, or a link that expired.
 */
import crypto from 'crypto';
import prisma from '../config/database.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import AppError from '../utils/AppError.js';
import { runSweep } from '../jobs/evaluationScheduler.js';
import { queueEmail, shadowReport, isShadowMode } from '../services/notification.service.js';
import { verifyConnection } from '../services/graphMailer.service.js';
import { findByOfficeEmail } from '../services/employee.service.js';
import { addDays, toDateString, todayIn } from '../utils/dateUtils.js';
import config from '../config/index.js';

/**
 * POST /api/admin/sweep?dryRun=true
 * Run the daily sweep now. Dry run reports what would happen and sends nothing.
 */
export const sweepNow = catchAsync(async (req, res) => {
  const dryRun = req.query.dryRun === 'true';
  const result = await runSweep({ dryRun });

  return success(
    res,
    result,
    dryRun
      ? `Dry run: ${result.evaluations.due} evaluation(s) and ${result.reminders.due} reminder(s) would be sent`
      : `Sweep complete: ${result.evaluations.sent} evaluation(s), ${result.reminders.sent} reminder(s)`
  );
});

/**
 * POST /api/admin/send-evaluation
 * Body: { office_email, seq_no }  — replaces the Adhoc Flow.
 *
 * Re-issues a fresh token so an expired or lost link is replaced rather than
 * resurrected; the old link stops working, which is the intended behaviour when
 * HR deliberately reissues.
 */
export const sendEvaluationNow = catchAsync(async (req, res) => {
  const { office_email: officeEmail, seq_no: seqNo } = req.body || {};

  if (!officeEmail || !seqNo) {
    throw new AppError('office_email and seq_no are required.', 400);
  }

  const employee = await findByOfficeEmail(officeEmail);
  if (!employee) throw new AppError(`No employee found with office email ${officeEmail}`, 404);

  if (employee.halt_process) {
    throw new AppError(`Evaluations are paused for ${employee.full_name}. Resume them first.`, 409);
  }
  if (employee.employment_status !== 'active') {
    throw new AppError(`${employee.full_name} is marked as having left.`, 409);
  }

  const cycle = await prisma.pea_evaluation_cycles.findFirst({
    where: { employee_id: employee.id, seq_no: Number(seqNo) },
    include: { employee: true },
  });
  if (!cycle) throw new AppError(`${employee.full_name} has no evaluation ${seqNo}.`, 404);

  if (cycle.status === 'completed') {
    throw new AppError(
      `Evaluation ${seqNo} for ${employee.full_name} was already submitted on ` +
        `${toDateString(cycle.submitted_at)}. Re-sending would discard that response.`,
      409
    );
  }

  const validityRow = await prisma.pea_settings.findUnique({
    where: { setting_key: 'token_validity_days' },
  });
  const validity = Number(validityRow?.setting_value) || 30;

  // New token: the old link is invalidated so two live links can never produce
  // two conflicting submissions for the same cycle.
  const refreshed = await prisma.pea_evaluation_cycles.update({
    where: { id: cycle.id },
    data: {
      token: crypto.randomUUID(),
      token_expires_at: addDays(new Date(), validity),
      status: 'email_sent',
      sent_at: new Date(),
      // Reset the chase clock — the manager is getting a fresh ask.
      reminder_count: 0,
      last_reminded_at: null,
      modified_at: new Date(),
    },
    include: { employee: true },
  });

  const result = await queueEmail({ type: 'evaluation_link', cycle: refreshed });

  if (result.status === 'failed') {
    throw new AppError(`Could not send: ${result.error}`, 502);
  }

  return success(
    res,
    {
      employee: employee.full_name,
      evaluation: Number(seqNo),
      status: result.status,
      sentTo: result.to,
      redirected: result.redirected,
    },
    result.status === 'suppressed'
      ? 'Shadow mode is on — the send was logged but no email left the system.'
      : `Evaluation ${seqNo} sent to ${result.to.join(', ')}`
  );
});

/**
 * GET /api/admin/shadow-report?days=7
 * The R6 stage-1 comparison: what PEA would have sent, to diff against what
 * Power Automate actually sent.
 */
export const getShadowReport = catchAsync(async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days || '7', 10)));
  const rows = await shadowReport(days);

  return success(res, {
    days,
    shadowMode: await isShadowMode(),
    count: rows.length,
    rows,
  });
});

/**
 * GET /api/admin/diagnostics
 *
 * Answers "is this thing actually going to send anything?" in one call. Both
 * brakes and the Graph connection are easy to leave in the wrong state, and
 * each of them silently means no manager hears from us.
 */
export const diagnostics = catchAsync(async (_req, res) => {
  const today = todayIn(config.scheduler.timezone);
  const shadow = await isShadowMode();

  const [pendingDue, awaiting, graph] = await Promise.all([
    prisma.pea_evaluation_cycles.count({
      where: {
        status: 'pending',
        due_date: { lte: today },
        employee: { halt_process: false, employment_status: 'active' },
      },
    }),
    prisma.pea_evaluation_cycles.count({ where: { status: { in: ['email_sent', 'opened'] } } }),
    verifyConnection(),
  ]);

  const blockers = [];
  if (shadow) blockers.push('shadow_mode is true — nothing is sent');
  if (!config.scheduler.enabled) blockers.push('PEA_SCHEDULER_ENABLED is false — the sweep never runs');
  if (config.email.redirectInNonProd) {
    blockers.push(`non-prod guard on — mail is diverted to ${config.email.testRecipients.join(', ')}`);
  }
  if (!graph.ok) blockers.push(`Microsoft Graph: ${graph.detail}`);

  return success(res, {
    today: toDateString(today),
    timezone: config.scheduler.timezone,
    wouldSendNow: pendingDue,
    awaitingResponse: awaiting,
    graph,
    blockers,
    willActuallySendEmail: blockers.length === 0,
  });
});
