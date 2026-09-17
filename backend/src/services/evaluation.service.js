/**
 * evaluation.service.js — the tokenised evaluation form.
 *
 * This replaces Microsoft Forms plus the two "Submitted Response" flows.
 *
 * The old round trip was: email a generic MS Forms link → the manager types the
 * employee's email address and picks the evaluation number by hand → a webhook
 * fires → a flow matches the response back to a spreadsheet row by string
 * comparison. Every step in the middle could go wrong, and the two fields the
 * manager had to type are precisely the two that identify the record.
 *
 * Here the token IS the identity. The form already knows who is being rated,
 * which evaluation this is, and what period it covers, so there is nothing to
 * mistype and nothing to match afterwards.
 *
 * Modelled on the ATS interviewer scorecard (rpa_interview_scorecard +
 * scorecard.routes.js), which solves the same "send a form to someone with no
 * account" problem.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { isValidRating } from '../config/ratingScale.js';
import { generateExtensionCycles } from './cycleGenerator.service.js';
import { queueEmail } from './notification.service.js';
import { notifyStaff } from './inAppNotification.service.js';
import { toDateString, formatDisplay } from '../utils/dateUtils.js';

/** Statuses that mean the form is still open for submission. */
const OPEN_STATUSES = new Set(['pending', 'email_sent', 'opened']);

/**
 * Load a cycle by its token and assert the form may still be filled in.
 *
 * Deliberately vague on failure. This endpoint is public, so a precise message
 * would let anyone probing tokens learn whether one exists.
 *
 * @param {string} token
 * @returns {Promise<object>} cycle with employee attached
 * @throws {AppError} 404 / 410
 */
export async function loadByToken(token) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) {
    throw new AppError('This evaluation link is not valid.', 404);
  }

  const cycle = await prisma.pea_evaluation_cycles.findUnique({
    where: { token },
    include: { employee: true, scores: { orderBy: { sort_order: 'asc' } } },
  });

  if (!cycle) throw new AppError('This evaluation link is not valid.', 404);

  if (cycle.status === 'completed') {
    throw new AppError(
      `This evaluation was already submitted on ${toDateString(cycle.submitted_at)}. ` +
        'Thank you — there is nothing further to do.',
      410
    );
  }

  if (cycle.status === 'skipped') {
    throw new AppError('This evaluation is no longer required.', 410);
  }

  if (cycle.token_expires_at && cycle.token_expires_at < new Date()) {
    throw new AppError(
      'This evaluation link has expired. Please contact HR for a new one.',
      410
    );
  }

  if (cycle.employee.halt_process) {
    throw new AppError('Evaluations for this employee are currently paused.', 410);
  }

  // R-02 — a link already in a manager's inbox must stop working once the
  // person has left, not merely stop being resent. The sweep guard alone would
  // still let yesterday's email be opened and submitted today.
  if (cycle.employee.employment_status === 'left') {
    throw new AppError('This employee has left the organisation, so this evaluation is no longer required.', 410);
  }

  if (await leaverHoldApplies(cycle.employee)) {
    throw new AppError(
      'This evaluation is on hold: our Microsoft 365 records show this person may have left. ' +
        'Please contact HR if that is not correct.',
      410
    );
  }

  return cycle;
}

/**
 * Is the automatic leaver hold in force for this employee? — R-02.
 *
 * True only when the setting is on, Entra has flagged the account, and HR has
 * not since dismissed that flag. Read at request time rather than cached: HR
 * dismissing a wrong flag should reopen the link immediately, not after a
 * restart.
 *
 * @param {{leaver_flagged_at: Date|null, leaver_dismissed_at: Date|null}} employee
 * @returns {Promise<boolean>}
 */
export async function leaverHoldApplies(employee) {
  if (!employee?.leaver_flagged_at) return false;

  const row = await prisma.pea_settings.findUnique({
    where: { setting_key: 'hold_evaluations_for_leavers' },
  });
  // Default on: the failure this guard prevents (an evaluation mailed to
  // someone who has left) is worse than the one it causes (a link held for a
  // person HR can un-flag in one click).
  const enabled = row?.setting_value === undefined || row?.setting_value === null
    ? true
    : String(row.setting_value).trim().toLowerCase() === 'true';
  if (!enabled) return false;

  const dismissed =
    employee.leaver_dismissed_at && employee.leaver_dismissed_at >= employee.leaver_flagged_at;

  return !dismissed;
}

/**
 * True when this is the cycle on which the confirm/extend decision is asked.
 *
 * It is the highest-numbered cycle the employee currently has: 6 for a fresher,
 * 3 for someone experienced, and then the new final one after an extension is
 * granted. That matches the user guide — the decision is asked at evaluation 6
 * / 3, and again at the end of an extension.
 *
 * @param {object} cycle
 * @returns {Promise<boolean>}
 */
export async function isFinalCycle(cycle) {
  const max = await prisma.pea_evaluation_cycles.aggregate({
    where: { employee_id: cycle.employee_id },
    _max: { seq_no: true },
  });
  return cycle.seq_no === max._max.seq_no;
}

/**
 * Everything the form needs to render itself.
 * @param {string} token
 * @returns {Promise<object>}
 */
export async function getFormData(token) {
  const cycle = await loadByToken(token);

  const template = cycle.employee.is_experienced ? 'experienced' : 'fresher';
  const params = await prisma.pea_evaluation_params.findMany({
    where: { template, is_active: true },
    orderBy: { sort_order: 'asc' },
  });

  // First open: stamp it, so HR can see the manager received and opened the
  // link even before they submit. The old system had no visibility here at all.
  // An emailed link is 'email_sent', so that must move to 'opened' too.
  if (!cycle.opened_at) {
    await prisma.pea_evaluation_cycles.update({
      where: { id: cycle.id },
      data: {
        opened_at: new Date(),
        status: ['pending', 'email_sent'].includes(cycle.status) ? 'opened' : cycle.status,
      },
    });
  }

  return {
    token,
    cycle: {
      id: String(cycle.id),
      seq_no: cycle.seq_no,
      is_extension: cycle.is_extension,
      period_from: cycle.period_from,
      period_to: cycle.period_to,
      periodLabel: `${formatDisplay(cycle.period_from)} to ${formatDisplay(cycle.period_to)}`,
    },
    employee: {
      full_name: cycle.employee.full_name,
      office_email: cycle.employee.office_email,
      doj: cycle.employee.doj,
      dojLabel: formatDisplay(cycle.employee.doj),
      is_experienced: cycle.employee.is_experienced,
      rm_name: cycle.employee.rm_name,
    },
    params,
    askConfirmation: await isFinalCycle(cycle),
  };
}

/**
 * Record a submitted evaluation.
 *
 * Everything happens in one transaction: the scores, the average, the cycle
 * status, any extension cycles, and the notification rows. A half-written
 * submission would leave a manager believing they had responded while HR sees
 * nothing.
 *
 * @param {string} token
 * @param {object} body - { ratings: {param_key: {rating, comments}}, remarks, confirmation_status }
 * @param {string} [ip]
 * @returns {Promise<object>}
 */
export async function submit(token, body, ip) {
  const cycle = await loadByToken(token);

  // R-01 — Subhajit, 15-Sep demo (28:58): "You can remove this because it will
  // be only with the RM. RM will only be filling." The submitter is whoever the
  // single-use link was issued to, never a self-declared address: the old form
  // field was optional, so it could be left blank (HR then could not tell who
  // responded) or filled in with someone else's name.
  const submittedBy = (cycle.employee.rm_email || '').trim().toLowerCase() || null;

  const template = cycle.employee.is_experienced ? 'experienced' : 'fresher';
  const params = await prisma.pea_evaluation_params.findMany({
    where: { template, is_active: true },
    orderBy: { sort_order: 'asc' },
  });

  const ratings = body.ratings || {};
  const rows = [];
  const missing = [];

  for (const param of params) {
    const entry = ratings[param.param_key] || {};
    const raw = entry.rating;

    if (raw === undefined || raw === null || raw === '') {
      missing.push(param.param_label);
      continue;
    }
    if (!isValidRating(raw)) {
      throw new AppError(`"${param.param_label}" must be a rating between 1 and 5.`, 400);
    }

    rows.push({
      param_key: param.param_key,
      // Snapshot the label so renaming a question later never rewrites what
      // this manager was actually shown.
      param_label: param.param_label,
      rating: Number(raw),
      comments: (entry.comments || '').trim() || null,
      sort_order: param.sort_order,
    });
  }

  if (missing.length) {
    throw new AppError(`Please give a rating for: ${missing.join(', ')}.`, 400);
  }

  const askConfirmation = await isFinalCycle(cycle);
  let confirmation = (body.confirmation_status || '').trim() || null;

  if (askConfirmation && !confirmation) {
    throw new AppError(
      'This is the final evaluation, so a confirmation decision is required.',
      400
    );
  }
  if (!askConfirmation) confirmation = null; // ignore it if sent on a non-final cycle

  const avg = Number((rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(2));

  const result = await prisma.$transaction(async (tx) => {
    await tx.pea_evaluation_scores.createMany({
      data: rows.map((r) => ({ ...r, cycle_id: cycle.id })),
    });

    await tx.pea_evaluation_cycles.update({
      where: { id: cycle.id },
      data: {
        status: 'completed',
        submitted_at: new Date(),
        submitted_by_email: submittedBy,
        submitted_ip: ip || null,
        avg_rating: avg,
        remarks: (body.remarks || '').trim() || null,
        confirmation_status: confirmation,
        // One submission per link. Re-opening it shows the "already submitted"
        // message rather than allowing a second, conflicting set of ratings.
        token_expires_at: new Date(),
        modified_at: new Date(),
      },
    });

    let extensionCycles = 0;
    if (confirmation) {
      await tx.pea_employees.update({
        where: { id: cycle.employee_id },
        data: { confirmation_status: confirmation, modified_at: new Date() },
      });

      await tx.pea_employee_audit.create({
        data: {
          employee_id: cycle.employee_id,
          field_name: 'confirmation_status',
          old_value: cycle.employee.confirmation_status,
          new_value: confirmation,
          changed_by: submittedBy || cycle.employee.rm_email,
          change_source: 'manual',
        },
      });

      if (confirmation.startsWith('Extend')) {
        extensionCycles = await generateExtensionCycles(cycle.employee_id, confirmation, tx);
      } else {
        // Confirmed or Not Confirmed ends the process: close anything still
        // outstanding so no further email can go out for this person.
        await tx.pea_evaluation_cycles.updateMany({
          where: { employee_id: cycle.employee_id, status: { in: [...OPEN_STATUSES] } },
          data: { status: 'skipped', modified_at: new Date() },
        });
      }
    }

    return { extensionCycles };
  });

  // Notifications are queued outside the transaction: a mail failure must never
  // roll back a manager's submitted ratings.
  // Subjects come from the Email Templates screen, not from here.
  await queueEmail({
    type: 'acknowledgement',
    cycleId: cycle.id,
    employeeId: cycle.employee_id,
    context: {
      average: avg,
      confirmation,
      submittedBy,
      remarks: (body.remarks || '').trim() || null,
    },
  });

  if (confirmation && confirmation.startsWith('Extend')) {
    await queueEmail({
      type: 'extend_alert',
      cycleId: cycle.id,
      employeeId: cycle.employee_id,
      context: { confirmation, submittedBy, extensionCycles: result.extensionCycles },
    });
  }

  // The bell. Best-effort by construction — notifyStaff never throws, so a
  // missing notifications table cannot fail a manager's submission.
  await notifyStaff({
    type: confirmation ? 'decision_recorded' : 'evaluation_submitted',
    title: confirmation
      ? `${cycle.employee.full_name}: ${confirmation}`
      : `Evaluation ${cycle.seq_no} submitted — ${cycle.employee.full_name}`,
    body:
      `Average ${avg} / 5` +
      (result.extensionCycles ? ` · ${result.extensionCycles} extension evaluation(s) scheduled` : ''),
    link: `/employees/${cycle.employee_id}`,
    severity: confirmation && confirmation !== 'Confirmed' ? 'warning' : 'info',
    dedupeKey: `submitted:${cycle.id}`,
  });

  logger.info(
    `Evaluation ${cycle.seq_no} submitted for ${cycle.employee.full_name} ` +
      `— average ${avg}${confirmation ? `, decision: ${confirmation}` : ''}` +
      `${result.extensionCycles ? ` (+${result.extensionCycles} extension cycle(s))` : ''}`
  );

  return {
    employee: cycle.employee.full_name,
    evaluation: cycle.seq_no,
    average: avg,
    confirmation_status: confirmation,
    extensionCyclesCreated: result.extensionCycles,
  };
}
