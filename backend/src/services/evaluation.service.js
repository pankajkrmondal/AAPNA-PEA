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
import { isValidRating, REASON_MAX, CONFIRMATION_OPTIONS } from '../config/ratingScale.js';
import { generateExtensionCycles, extensionsLeft, allowedDecisions } from './cycleGenerator.service.js';
import { queueEmail, probationContext, probationNote } from './notification.service.js';
import { notifyStaff } from './inAppNotification.service.js';
import { currentLevel } from './selfView.service.js';
import { hasDecisionReason, hasDraftColumns, hasRecipientColumns } from '../utils/schemaCapabilities.js';
import config from '../config/index.js';
// H6 — toDateString printed the submitted date as 2026-09-22; every date a
// person reads is now dd-MM-yyyy.
// import { toDateString, formatDisplay } from '../utils/dateUtils.js';
import { dateIn, formatDisplay } from '../utils/dateUtils.js';

/** Statuses that mean the form is still open for submission. */
const OPEN_STATUSES = new Set(['pending', 'email_sent', 'opened']);

/** A decision that is not a plain confirmation must say why. */
export const reasonRequired = (decision) => !!decision && decision !== 'Confirmed';

/**
 * A validation failure listing every problem at once, so the form can say
 * "Please fix 2 things" rather than reveal them one submit at a time.
 * @param {{field: string, text: string}[]} problems
 */
function formProblems(problems) {
  const err = new AppError(problems.map((p) => p.text).join(' '), 400);
  err.problems = problems;
  return err;
}

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
      `This evaluation was already submitted on ${formatDisplay(dateIn(cycle.submitted_at, config.scheduler.timezone))}. ` +
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
    throw new AppError('Evaluations for this Commando are currently paused.', 410);
  }

  // R-02 — a link already in a manager's inbox must stop working once the
  // person has left, not merely stop being resent. The sweep guard alone would
  // still let yesterday's email be opened and submitted today.
  if (cycle.employee.employment_status === 'left') {
    throw new AppError('This Commando has left the organisation, so this evaluation is no longer required.', 410);
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
 * The decisions this person's final evaluation may offer — B2 / M2.
 *
 * Nobody's probation runs past 8 months, so "Extend" is offered only while
 * extension evaluations are left: both options with none used, "1 month" alone
 * with one used, neither with two. See cycleGenerator.service.js.
 *
 * @param {bigint|number} employeeId
 * @param {object} [tx]
 * @returns {Promise<{left: number, options: Array<{value: string, label: string, help: string}>}>}
 */
export async function decisionOptions(employeeId, tx = prisma) {
  const cycles = await tx.pea_evaluation_cycles.findMany({
    where: { employee_id: employeeId },
    select: { is_extension: true },
  });
  const left = extensionsLeft(cycles);
  const allowed = allowedDecisions(left);
  return { left, options: CONFIRMATION_OPTIONS.filter((o) => allowed.includes(o.value)) };
}

/** The longest comment or overall remark a draft keeps. */
export const DRAFT_TEXT_MAX = 5000;

/**
 * A draft as it is stored: the form's answers, with nothing required and
 * nothing trusted. Pure, so the rule is testable without a database.
 *
 * A draft is unfinished by definition, so a missing rating or comment is not a
 * problem here — submit() is still the gate. What is refused is anything that
 * could not be a real answer: a rating outside 1-5, a decision that is not one
 * of the four, text past the limit, or a pile of made-up question keys.
 *
 * @param {object} [body] - as parsed by the controller
 * @returns {{ratings: object, remarks: string, confirmation_status: string, confirmation_reason: string}}
 */
export function cleanDraft(body = {}) {
  const text = (v, max) => String(v ?? '').slice(0, max);
  const ratings = {};

  for (const [key, entry] of Object.entries(body.ratings || {}).slice(0, 30)) {
    if (!/^[a-z0-9_]{1,60}$/.test(key)) continue;
    const rating = isValidRating(entry?.rating) ? String(Number(entry.rating)) : '';
    const comments = text(entry?.comments, DRAFT_TEXT_MAX);
    if (rating || comments) ratings[key] = { rating, comments };
  }

  const decision = String(body.confirmation_status || '').trim();

  return {
    ratings,
    remarks: text(body.remarks, DRAFT_TEXT_MAX),
    confirmation_status: CONFIRMATION_OPTIONS.some((o) => o.value === decision) ? decision : '',
    confirmation_reason: text(body.confirmation_reason, REASON_MAX),
  };
}

/** "01-10-2026 14:05" in the office timezone — when a draft was last saved. */
function savedLabel(instant) {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.scheduler.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(instant));
  return `${formatDisplay(dateIn(instant, config.scheduler.timezone))} ${time}`;
}

/**
 * The manager's unsubmitted answers, or null — P11. Raw SQL because the
 * columns are newer than the Prisma model.
 * @param {bigint} cycleId
 * @returns {Promise<{values: object, savedAt: Date, savedLabel: string}|null>}
 */
async function readDraft(cycleId) {
  if (!(await hasDraftColumns())) return null;
  const [row] = await prisma.$queryRaw`
    SELECT draft, draft_saved_at FROM pea_evaluation_cycles WHERE id = ${cycleId}`;
  if (!row?.draft) return null;
  return { values: row.draft, savedAt: row.draft_saved_at, savedLabel: savedLabel(row.draft_saved_at) };
}

/**
 * Keep a manager's unfinished answers — P11.
 *
 * The form asks for seven comments. Closing the tab by accident, or opening
 * the email on a phone and finishing on a laptop, used to lose all of them. The
 * draft lives on the server, against the same link, so it is there on whatever
 * device the link is opened next. It is cleared when the evaluation is
 * submitted.
 *
 * @param {string} token
 * @param {object} body - as parsed by the controller
 * @returns {Promise<{savedAt: Date, savedLabel: string}>}
 */
export async function saveDraft(token, body) {
  const cycle = await loadByToken(token);
  if (!(await hasDraftColumns())) {
    throw new AppError('Drafts cannot be saved yet. Please submit the form when you have finished.', 503);
  }

  const savedAt = new Date();
  await prisma.$executeRaw`
    UPDATE pea_evaluation_cycles
       SET draft = ${JSON.stringify(cleanDraft(body))}::jsonb, draft_saved_at = ${savedAt}
     WHERE id = ${cycle.id}`;

  return { savedAt, savedLabel: savedLabel(savedAt) };
}

/**
 * The evaluation before this one, as the form shows it under each question —
 * P10. A manager rating progress needs to see what was said last time.
 *
 * The latest SUBMITTED evaluation with per-question scores. Imported history
 * holds free text on an older instrument, so it is skipped rather than shown
 * beside questions it never answered.
 *
 * @param {{employee_id: bigint, seq_no: number}} cycle
 * @returns {Promise<object|null>}
 */
async function previousEvaluation(cycle) {
  const prev = await prisma.pea_evaluation_cycles.findFirst({
    where: {
      employee_id: cycle.employee_id,
      seq_no: { lt: cycle.seq_no },
      status: 'completed',
      scores: { some: { rating: { not: null } } },
    },
    orderBy: { seq_no: 'desc' },
    include: { scores: { orderBy: { sort_order: 'asc' } } },
  });
  if (!prev) return null;

  return {
    seq_no: prev.seq_no,
    submittedLabel: prev.submitted_at ? formatDisplay(dateIn(prev.submitted_at, config.scheduler.timezone)) : '',
    average: prev.avg_rating === null ? null : Number(prev.avg_rating),
    remarks: prev.remarks || null,
    scores: Object.fromEntries(
      prev.scores.map((s) => [s.param_key, { rating: s.rating === null ? null : Number(s.rating), comments: s.comments || null }])
    ),
  };
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

  const askConfirmation = await isFinalCycle(cycle);
  const decision = askConfirmation ? await decisionOptions(cycle.employee_id) : { left: 0, options: [] };

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
    askConfirmation,
    // B2 / M2 — only the decisions still open to this person; "Extend" drops
    // out once the 8-month limit is reached.
    confirmationOptions: decision.options,
    extensionsLeft: decision.left,
    // B8 — the form may only say "<name> sees these" when it is true: the
    // person reads comments at the `full` self-view level and no other.
    employeeSeesComments: (await currentLevel()) === 'full',
    // P10 — last time's ratings and comments, shown under each question.
    previous: await previousEvaluation(cycle),
    // P11 — unfinished answers saved against this link, and whether this
    // database can hold them at all.
    draft: await readDraft(cycle.id),
    draftEnabled: await hasDraftColumns(),
  };
}

/**
 * The score rows a submission would store, and what is wrong with them: a
 * missing rating, or a missing comment. A comment is required on every
 * question, whatever the rating. This is the gate — the form's `required` is a
 * courtesy, and a JSON client must hit the same wall.
 *
 * @param {{param_key: string, param_label: string, sort_order: number}[]} params
 * @param {object} [ratings] - {param_key: {rating, comments}}
 * @returns {{rows: object[], problems: {field: string, text: string, label?: string}[]}}
 * @throws {AppError} 400 for a rating outside 1-5
 */
export function scoreProblems(params, ratings = {}) {
  const rows = [];
  const missing = [];

  for (const param of params) {
    const entry = ratings[param.param_key] || {};
    const raw = entry.rating;

    if (raw === undefined || raw === null || raw === '') {
      missing.push(param); // U2 — was: missing.push(param.param_label)
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
      comments: String(entry.comments || '').trim() || null,
      sort_order: param.sort_order,
    });
  }

  // U2 — a missing rating names its question, so the form can link to it and
  // mark it, exactly as it does for a missing comment. It used to be one
  // anonymous `field: 'rating'` per question:
  //
  // const problems = missing.map((label) => ({
  //   field: 'rating',
  //   text: `Please give a rating for ${label}.`,
  // }));
  const problems = missing.map((p) => ({
    field: `rating_${p.param_key}`,
    label: p.param_label,
    text: `${p.param_label} — choose a rating.`,
  }));

  for (const r of rows) {
    if (!r.comments) {
      problems.push({
        field: `comments_${r.param_key}`,
        label: r.param_label,
        text: `${r.param_label} — add a comment explaining the rating.`,
      });
    }
  }

  return { rows, problems };
}

/**
 * Who the live link for this evaluation was issued to — M3 / M7 / U13.
 *
 * Normally the reporting manager at the time it was sent; an acting manager
 * when HR sent it to someone else. Whoever it is, they are the one who
 * answers, so they are the one the submission is credited to — not whoever
 * happens to be the manager on the day the answer arrives. Before, a manager
 * change between sending and answering credited the new manager with the old
 * one's ratings (B4).
 *
 * Falls back to the employee's current manager when nothing was recorded: a
 * link sent before the 2026-10-02 DDL, or a database without it.
 *
 * @param {{id: bigint, employee?: {rm_name?: string, rm_email?: string}}} cycle
 * @param {object} [tx]
 * @returns {Promise<{name: string|null, email: string|null, delegated: boolean}>}
 */
export async function recipientOf(cycle, tx = prisma) {
  const fallback = {
    name: cycle.employee?.rm_name || null,
    email: (cycle.employee?.rm_email || '').trim().toLowerCase() || null,
    delegated: false,
  };
  if (!(await hasRecipientColumns())) return fallback;

  const [row] = await tx.$queryRaw`
    SELECT sent_to_name, sent_to_email, delegated FROM pea_evaluation_cycles WHERE id = ${cycle.id}`;
  if (!row?.sent_to_email) return fallback;

  return {
    name: row.sent_to_name || row.sent_to_email,
    email: row.sent_to_email.trim().toLowerCase(),
    delegated: !!row.delegated,
  };
}

/**
 * Write an answered evaluation: the scores, the average, the cycle status, the
 * decision and what follows from it.
 *
 * One transaction, so a half-written submission can never leave a manager
 * believing they had responded while HR sees nothing. Three callers share it
 * and so cannot drift apart: the manager's form (submit below), a manager
 * resubmitting an evaluation HR reopened (M6), and HR entering ratings in the
 * app on a manager's behalf (B5).
 *
 * It does not validate — each caller has its own rules about what is required
 * — and it sends no email.
 *
 * @param {object} cycle - with `employee` included
 * @param {object} answer
 * @param {object[]} answer.rows - from scoreProblems()
 * @param {string|null} [answer.remarks]
 * @param {string|null} [answer.confirmation] - only on a final evaluation
 * @param {string|null} [answer.reason]
 * @param {{name: string|null, email: string|null}} answer.submittedBy - whose answers these are
 * @param {string|null} [answer.ip]
 * @param {string|null} [answer.enteredBy] - HR username, when HR typed them in
 * @returns {Promise<{average: number, extensionCycles: number, nextCycle: object|null}>}
 */
export async function recordSubmission(cycle, {
  rows, remarks = null, confirmation = null, reason = null, submittedBy, ip = null, enteredBy = null,
}) {
  const average = Number((rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(2));
  // Stored only when the column exists; the decision itself never waits on it.
  const storeReason = !!reason && (await hasDecisionReason());
  const clearDraft = await hasDraftColumns();
  const storeNames = await hasRecipientColumns();
  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // Replace, never add to: a reopened evaluation has had its rows removed
    // already, but nothing here should depend on that.
    await tx.pea_evaluation_scores.deleteMany({ where: { cycle_id: cycle.id } });
    await tx.pea_evaluation_scores.createMany({
      data: rows.map((r) => ({ ...r, cycle_id: cycle.id })),
    });

    await tx.pea_evaluation_cycles.update({
      where: { id: cycle.id },
      data: {
        status: 'completed',
        submitted_at: now,
        submitted_by_email: submittedBy.email,
        submitted_ip: ip || null,
        avg_rating: average,
        remarks,
        confirmation_status: confirmation,
        // One submission per link. Re-opening it shows the "already submitted"
        // message rather than allowing a second, conflicting set of ratings.
        token_expires_at: now,
        modified_at: now,
      },
    });

    // Raw SQL because the columns are newer than the Prisma model — see
    // prisma/ddl/2026-09-23-pea-board-redesign.sql and 2026-10-02-pea-review-round.sql.
    if (storeReason) {
      await tx.$executeRaw`
        UPDATE pea_evaluation_cycles SET confirmation_reason = ${reason} WHERE id = ${cycle.id}`;
    }

    // P11 — the answers are submitted, so the draft has done its job.
    if (clearDraft) {
      await tx.$executeRaw`
        UPDATE pea_evaluation_cycles SET draft = NULL, draft_saved_at = NULL WHERE id = ${cycle.id}`;
    }

    // U13 / B5 — who answered, by name, and who typed it in if that was HR.
    if (storeNames) {
      await tx.$executeRaw`
        UPDATE pea_evaluation_cycles
           SET submitted_by_name = ${submittedBy.name}, entered_by = ${enteredBy}
         WHERE id = ${cycle.id}`;
    }

    let extensionCycles = 0;
    if (confirmation) {
      await tx.pea_employees.update({
        where: { id: cycle.employee_id },
        data: { confirmation_status: confirmation, modified_at: now },
      });

      await tx.pea_employee_audit.create({
        data: {
          employee_id: cycle.employee_id,
          field_name: 'confirmation_status',
          old_value: cycle.employee.confirmation_status,
          new_value: confirmation,
          changed_by: enteredBy || submittedBy.email || cycle.employee.rm_email,
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
          data: { status: 'skipped', modified_at: now },
        });
      }
    }

    // The first evaluation of any extension just scheduled — the HR email says
    // when it goes out.
    const nextCycle = extensionCycles
      ? await tx.pea_evaluation_cycles.findFirst({
        where: { employee_id: cycle.employee_id, seq_no: { gt: cycle.seq_no } },
        orderBy: { seq_no: 'asc' },
        select: { seq_no: true, due_date: true },
      })
      : null;

    return { extensionCycles, nextCycle };
  });

  return { average, ...result };
}

/**
 * The decision part of an answer, checked — shared by the manager's form and
 * HR entry so the 8-month rule and the reason rule are stated once.
 *
 * @param {object} cycle
 * @param {object} body - { confirmation_status, confirmation_reason }
 * @param {{required: boolean}} opts - the manager's form requires a decision on
 *   a final evaluation; HR entering history may leave it out
 * @returns {Promise<{askConfirmation: boolean, confirmation: string|null, reason: string|null, problems: object[]}>}
 */
export async function decisionProblems(cycle, body, { required }) {
  const problems = [];
  const askConfirmation = await isFinalCycle(cycle);
  let confirmation = (body.confirmation_status || '').trim() || null;
  let reason = String(body.confirmation_reason || '').trim() || null;

  if (askConfirmation && !confirmation && required) {
    problems.push({
      field: 'confirmation_status',
      text: 'This is the final evaluation, so a confirmation decision is required.',
    });
  }
  if (!askConfirmation) {
    confirmation = null; // ignore it if sent on a non-final cycle
    reason = null;
  }
  // B2 / M2 — the form offers only what is allowed, but a form opened before
  // an extension was granted, or a hand-made POST, can still send more.
  if (askConfirmation && confirmation) {
    const { left, options } = await decisionOptions(cycle.employee_id);
    if (!options.some((o) => o.value === confirmation)) {
      problems.push({
        field: 'confirmation_status',
        text: confirmation.startsWith('Extend')
          ? left === 0
            ? 'This probation has reached the 8-month limit and cannot be extended again. Please confirm or do not confirm.'
            : 'This probation can be extended by one more month at most — it cannot run past 8 months.'
          : 'Please choose one of the decisions listed.',
      });
    }
  }
  if (askConfirmation && reasonRequired(confirmation) && !reason) {
    problems.push({
      field: 'confirmation_reason',
      label: confirmation,
      text: `You chose ${confirmation} — give a reason for the decision.`,
    });
  }
  if (reason && reason.length > REASON_MAX) {
    problems.push({
      field: 'confirmation_reason',
      text: `The reason for the decision is ${reason.length} characters; the limit is ${REASON_MAX}.`,
    });
  }

  return { askConfirmation, confirmation, reason, problems };
}

/** The questions a person on this track is rated on, in form order. */
export async function activeParams(employee) {
  return prisma.pea_evaluation_params.findMany({
    where: { template: employee.is_experienced ? 'experienced' : 'fresher', is_active: true },
    orderBy: { sort_order: 'asc' },
  });
}

/**
 * Record a submitted evaluation — the manager's form.
 *
 * Validates everything at once, writes it through recordSubmission(), then
 * tells HR. A mail failure never rolls back a manager's submitted ratings.
 *
 * @param {string} token
 * @param {object} body - { ratings: {param_key: {rating, comments}}, remarks, confirmation_status, confirmation_reason }
 * @param {string} [ip]
 * @returns {Promise<object>}
 */
export async function submit(token, body, ip) {
  const cycle = await loadByToken(token);

  // R-01 — Subhajit, 15-Sep demo (28:58): "You can remove this because it will
  // be only with the RM. RM will only be filling." The submitter is whoever the
  // single-use link was issued to, never a self-declared address.
  //
  // M3 — and that is the person the link was SENT to, not whoever the manager
  // is today. It used to read the employee's current manager here.
  const submittedBy = await recipientOf(cycle);

  const params = await activeParams(cycle.employee);
  const scored = scoreProblems(params, body.ratings);
  const decided = await decisionProblems(cycle, body, { required: true });
  const problems = [...scored.problems, ...decided.problems];
  if (problems.length) throw formProblems(problems);

  const { rows } = scored;
  const { askConfirmation, confirmation, reason } = decided;
  const remarks = (body.remarks || '').trim() || null;

  const result = await recordSubmission(cycle, { rows, remarks, confirmation, reason, submittedBy, ip });
  const avg = result.average;

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
      reason,
      submittedBy: submittedBy.email,
      submittedByName: submittedBy.name,
      remarks,
      isFinal: askConfirmation,
      scores: rows,
      nextCycle: result.nextCycle,
    },
  });

  if (confirmation && confirmation.startsWith('Extend')) {
    await queueEmail({
      type: 'extend_alert',
      cycleId: cycle.id,
      employeeId: cycle.employee_id,
      context: { confirmation, reason, submittedBy: submittedBy.email, extensionCycles: result.extensionCycles },
    });
  }

  // The bell. Best-effort by construction — notifyStaff never throws, so a
  // missing notifications table cannot fail a manager's submission.
  //
  // It opens the EVALUATION, not the employee page: the alert is about what
  // this manager just said, and that is where it is said in full.
  const quote = remarks ? ` · “${remarks.length > 90 ? `${remarks.slice(0, 90).trimEnd()}…` : remarks}”` : '';
  const commented = rows.filter((r) => r.comments).length;
  // H8 (05-10-2026) — the bell states the probation timeline, as the emails do:
  // "Evaluation 3 of 6 submitted", and "Evaluation 3 of 6 · probation ends
  // 28-12-2026" in the body. Read after the submission, so an extension it
  // granted is already counted and the end date is the new one.
  const probation = await probationContext(cycle.employee_id);
  const timeline = probationNote({ seqNo: cycle.seq_no, probation });
  const ofTotal = probation?.total ? ` of ${probation.total}` : '';
  await notifyStaff({
    type: confirmation ? 'decision_recorded' : 'evaluation_submitted',
    title: confirmation
      ? `${cycle.employee.full_name}: ${confirmation}`
      : `Evaluation ${cycle.seq_no}${ofTotal} submitted — ${cycle.employee.full_name}`,
    // Before H8 reached the bell:
    //   : `Evaluation ${cycle.seq_no} submitted — ${cycle.employee.full_name}`,
    // and the body began `Evaluation ${cycle.seq_no} · ${avg.toFixed(2)} / 5`.
    body:
      `${timeline || `Evaluation ${cycle.seq_no}`} · ${avg.toFixed(2)} / 5` +
      (quote || ` · No overall comment · ${commented} of ${rows.length} questions commented`) +
      (result.extensionCycles ? ` · ${result.extensionCycles} extension evaluation(s) scheduled` : ''),
    link: `/evaluations/${cycle.id}`,
    severity: confirmation && confirmation !== 'Confirmed' ? 'warning' : 'info',
    dedupeKey: `submitted:${cycle.id}`,
  });

  logger.info(
    `Evaluation ${cycle.seq_no} submitted for ${cycle.employee.full_name} by ${submittedBy.email || 'unknown'} ` +
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

// ─────────────────────────────────────────────────────────────────────────────
// M3 / M6 / B5 — replaced, kept for reference: submit() as one function, which
// credited every submission to the employee's CURRENT manager (B4) and whose
// write half could not be reused. It is now recipientOf() + decisionProblems()
// + recordSubmission() + submit() above.
// ─────────────────────────────────────────────────────────────────────────────
// /**
//  * Record a submitted evaluation.
//  *
//  * Everything happens in one transaction: the scores, the average, the cycle
//  * status, any extension cycles, and the notification rows. A half-written
//  * submission would leave a manager believing they had responded while HR sees
//  * nothing.
//  *
//  * @param {string} token
//  * @param {object} body - { ratings: {param_key: {rating, comments}}, remarks, confirmation_status }
//  * @param {string} [ip]
//  * @returns {Promise<object>}
//  */
// export async function submit(token, body, ip) {
//   const cycle = await loadByToken(token);
//
//   // R-01 — Subhajit, 15-Sep demo (28:58): "You can remove this because it will
//   // be only with the RM. RM will only be filling." The submitter is whoever the
//   // single-use link was issued to, never a self-declared address: the old form
//   // field was optional, so it could be left blank (HR then could not tell who
//   // responded) or filled in with someone else's name.
//   const submittedBy = (cycle.employee.rm_email || '').trim().toLowerCase() || null;
//
//   const template = cycle.employee.is_experienced ? 'experienced' : 'fresher';
//   const params = await prisma.pea_evaluation_params.findMany({
//     where: { template, is_active: true },
//     orderBy: { sort_order: 'asc' },
//   });
//
//   const { rows, problems } = scoreProblems(params, body.ratings);
//
//   const askConfirmation = await isFinalCycle(cycle);
//   let confirmation = (body.confirmation_status || '').trim() || null;
//   let reason = String(body.confirmation_reason || '').trim() || null;
//
//   if (askConfirmation && !confirmation) {
//     problems.push({
//       field: 'confirmation_status',
//       text: 'This is the final evaluation, so a confirmation decision is required.',
//     });
//   }
//   if (!askConfirmation) {
//     confirmation = null; // ignore it if sent on a non-final cycle
//     reason = null;
//   }
//   // B2 / M2 — the form offers only what is allowed, but a form opened before
//   // an extension was granted, or a hand-made POST, can still send more.
//   if (askConfirmation && confirmation) {
//     const { left, options } = await decisionOptions(cycle.employee_id);
//     if (!options.some((o) => o.value === confirmation)) {
//       problems.push({
//         field: 'confirmation_status',
//         text: confirmation.startsWith('Extend')
//           ? left === 0
//             ? 'This probation has reached the 8-month limit and cannot be extended again. Please confirm or do not confirm.'
//             : 'This probation can be extended by one more month at most — it cannot run past 8 months.'
//           : 'Please choose one of the decisions listed.',
//       });
//     }
//   }
//   if (askConfirmation && reasonRequired(confirmation) && !reason) {
//     problems.push({
//       field: 'confirmation_reason',
//       label: confirmation,
//       text: `You chose ${confirmation} — give a reason for the decision.`,
//     });
//   }
//   if (reason && reason.length > REASON_MAX) {
//     problems.push({
//       field: 'confirmation_reason',
//       text: `The reason for the decision is ${reason.length} characters; the limit is ${REASON_MAX}.`,
//     });
//   }
//
//   if (problems.length) throw formProblems(problems);
//
//   const avg = Number((rows.reduce((s, r) => s + r.rating, 0) / rows.length).toFixed(2));
//   // Stored only when the column exists; the decision itself never waits on it.
//   const storeReason = !!reason && (await hasDecisionReason());
//   const clearDraft = await hasDraftColumns();
//
//   const result = await prisma.$transaction(async (tx) => {
//     await tx.pea_evaluation_scores.createMany({
//       data: rows.map((r) => ({ ...r, cycle_id: cycle.id })),
//     });
//
//     await tx.pea_evaluation_cycles.update({
//       where: { id: cycle.id },
//       data: {
//         status: 'completed',
//         submitted_at: new Date(),
//         submitted_by_email: submittedBy,
//         submitted_ip: ip || null,
//         avg_rating: avg,
//         remarks: (body.remarks || '').trim() || null,
//         confirmation_status: confirmation,
//         // One submission per link. Re-opening it shows the "already submitted"
//         // message rather than allowing a second, conflicting set of ratings.
//         token_expires_at: new Date(),
//         modified_at: new Date(),
//       },
//     });
//
//     // Raw SQL because the column is newer than the Prisma model — see
//     // prisma/ddl/2026-09-23-pea-board-redesign.sql.
//     if (storeReason) {
//       await tx.$executeRaw`
//         UPDATE pea_evaluation_cycles SET confirmation_reason = ${reason} WHERE id = ${cycle.id}`;
//     }
//
//     // P11 — the answers are submitted, so the draft has done its job.
//     if (clearDraft) {
//       await tx.$executeRaw`
//         UPDATE pea_evaluation_cycles SET draft = NULL, draft_saved_at = NULL WHERE id = ${cycle.id}`;
//     }
//
//     let extensionCycles = 0;
//     if (confirmation) {
//       await tx.pea_employees.update({
//         where: { id: cycle.employee_id },
//         data: { confirmation_status: confirmation, modified_at: new Date() },
//       });
//
//       await tx.pea_employee_audit.create({
//         data: {
//           employee_id: cycle.employee_id,
//           field_name: 'confirmation_status',
//           old_value: cycle.employee.confirmation_status,
//           new_value: confirmation,
//           changed_by: submittedBy || cycle.employee.rm_email,
//           change_source: 'manual',
//         },
//       });
//
//       if (confirmation.startsWith('Extend')) {
//         extensionCycles = await generateExtensionCycles(cycle.employee_id, confirmation, tx);
//       } else {
//         // Confirmed or Not Confirmed ends the process: close anything still
//         // outstanding so no further email can go out for this person.
//         await tx.pea_evaluation_cycles.updateMany({
//           where: { employee_id: cycle.employee_id, status: { in: [...OPEN_STATUSES] } },
//           data: { status: 'skipped', modified_at: new Date() },
//         });
//       }
//     }
//
//     // The first evaluation of any extension just scheduled — the HR email says
//     // when it goes out.
//     const nextCycle = extensionCycles
//       ? await tx.pea_evaluation_cycles.findFirst({
//         where: { employee_id: cycle.employee_id, seq_no: { gt: cycle.seq_no } },
//         orderBy: { seq_no: 'asc' },
//         select: { seq_no: true, due_date: true },
//       })
//       : null;
//
//     return { extensionCycles, nextCycle };
//   });
//
//   const remarks = (body.remarks || '').trim() || null;
//
//   // Notifications are queued outside the transaction: a mail failure must never
//   // roll back a manager's submitted ratings.
//   // Subjects come from the Email Templates screen, not from here.
//   await queueEmail({
//     type: 'acknowledgement',
//     cycleId: cycle.id,
//     employeeId: cycle.employee_id,
//     context: {
//       average: avg,
//       confirmation,
//       reason,
//       submittedBy,
//       submittedByName: cycle.employee.rm_name,
//       remarks,
//       isFinal: askConfirmation,
//       scores: rows,
//       nextCycle: result.nextCycle,
//     },
//   });
//
//   if (confirmation && confirmation.startsWith('Extend')) {
//     await queueEmail({
//       type: 'extend_alert',
//       cycleId: cycle.id,
//       employeeId: cycle.employee_id,
//       context: { confirmation, reason, submittedBy, extensionCycles: result.extensionCycles },
//     });
//   }
//
//   // The bell. Best-effort by construction — notifyStaff never throws, so a
//   // missing notifications table cannot fail a manager's submission.
//   //
//   // It opens the EVALUATION, not the employee page: the alert is about what
//   // this manager just said, and that is where it is said in full.
//   const quote = remarks ? ` · “${remarks.length > 90 ? `${remarks.slice(0, 90).trimEnd()}…` : remarks}”` : '';
//   const commented = rows.filter((r) => r.comments).length;
//   await notifyStaff({
//     type: confirmation ? 'decision_recorded' : 'evaluation_submitted',
//     title: confirmation
//       ? `${cycle.employee.full_name}: ${confirmation}`
//       : `Evaluation ${cycle.seq_no} submitted — ${cycle.employee.full_name}`,
//     body:
//       `Evaluation ${cycle.seq_no} · ${avg.toFixed(2)} / 5` +
//       (quote || ` · No overall comment · ${commented} of ${rows.length} questions commented`) +
//       (result.extensionCycles ? ` · ${result.extensionCycles} extension evaluation(s) scheduled` : ''),
//     link: `/evaluations/${cycle.id}`,
//     severity: confirmation && confirmation !== 'Confirmed' ? 'warning' : 'info',
//     dedupeKey: `submitted:${cycle.id}`,
//   });
//
//   logger.info(
//     `Evaluation ${cycle.seq_no} submitted for ${cycle.employee.full_name} ` +
//       `— average ${avg}${confirmation ? `, decision: ${confirmation}` : ''}` +
//       `${result.extensionCycles ? ` (+${result.extensionCycles} extension cycle(s))` : ''}`
//   );
//
//   return {
//     employee: cycle.employee.full_name,
//     evaluation: cycle.seq_no,
//     average: avg,
//     confirmation_status: confirmation,
//     extensionCyclesCreated: result.extensionCycles,
//   };
// }
