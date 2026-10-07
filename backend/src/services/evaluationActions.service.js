/**
 * evaluationActions.service.js — what HR can do to ONE evaluation.
 *
 * Until now there was exactly one such action: send (or re-send) the link. The
 * review of 01-10-2026 added four more, and all five are the same shape — check
 * the evaluation is in a state where the action makes sense, change it, tell
 * whoever needs telling, and leave a line in the person's change history:
 *
 *   issueLink / sendNow   send the link, or send it again            (existing)
 *   reissueToManager      a manager changed: cancel and re-send         M3
 *   delegate              send it to an acting manager instead          M7
 *   reopen                hand a submitted one back to be corrected     M6
 *   recordFollowUp        say what HR did about flagged feedback        P8
 *   recordByHr            HR types the ratings in for the manager       B5 / M8
 *
 * They live together because they share one rule that is easy to get wrong
 * four separate times: there is never more than one live link for an
 * evaluation. Every path that hands a form to someone goes through issueLink(),
 * which replaces the token, so the previous link stops working the moment a
 * new one exists.
 *
 * Everything here that needs the 2026-10-02 DDL says so plainly when it is
 * missing, rather than half-working.
 */
import crypto from 'crypto';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { queueEmail } from './notification.service.js';
import {
  leaverHoldApplies,
  recipientOf,
  recordSubmission,
  scoreProblems,
  decisionProblems,
  activeParams,
} from './evaluation.service.js';
import {
  hasRecipientColumns,
  hasDraftColumns,
  hasRevisions,
  hasFollowups,
  hasDecisionReason,
  hasEvaluationReads,
} from '../utils/schemaCapabilities.js';
import { addDays, formatDisplay } from '../utils/dateUtils.js';
import { assertNotArchived } from '../utils/archiveScope.js';

/** Statuses meaning an evaluation could still be sent or answered. */
const OPEN = ['pending', 'email_sent', 'opened'];

const NEEDS_DDL = 'This needs the database update of 02-10-2026 (2026-10-02-pea-review-round.sql), which has not been applied here yet.';

const normEmail = (v) => String(v || '').trim().toLowerCase();
const cleanName = (v) => String(v || '').replace(/\s+/g, ' ').trim();

/**
 * A cycle with its employee and scores, or a 404. Every action here loads its
 * evaluation through this, so it is also where an archived Commando's record is
 * kept read-only — Archive (07-10-2026).
 */
async function loadCycle(id) {
  if (!/^\d+$/.test(String(id))) throw new AppError('Evaluation not found', 404);
  const cycle = await prisma.pea_evaluation_cycles.findUnique({
    where: { id: BigInt(id) },
    include: { employee: true, scores: { orderBy: { sort_order: 'asc' } } },
  });
  if (!cycle) throw new AppError('Evaluation not found', 404);
  await assertNotArchived(cycle.employee_id, cycle.employee.full_name);
  return cycle;
}

/**
 * The holds that stop anything being sent about a person — the same three the
 * daily send applies, so no manual action can get round them.
 * @param {object} employee
 * @throws {AppError} 409
 */
async function assertSendable(employee) {
  await assertNotArchived(employee.id, employee.full_name); // Archive (07-10-2026)
  if (employee.halt_process) {
    throw new AppError(`Evaluations are on hold for ${employee.full_name}. Resume them first.`, 409);
  }
  if (employee.employment_status !== 'active') {
    throw new AppError(`${employee.full_name} is marked as having left.`, 409);
  }
  if (await leaverHoldApplies(employee)) {
    throw new AppError(
      `Evaluations for ${employee.full_name} are on hold: Microsoft 365 shows the account ` +
        'switched off and unlicensed. Confirm the exit, or mark them as still here, on the ' +
        'New joiners screen first.',
      409
    );
  }
}

/** One line in the person's change history. Never throws — it is a record, not a gate. */
async function note(employeeId, text, actor) {
  try {
    await prisma.pea_employee_audit.create({
      data: { employee_id: employeeId, field_name: '*', new_value: text, changed_by: actor, change_source: 'manual' },
    });
  } catch (err) {
    logger.warn(`Could not write the change history for employee ${employeeId}: ${err.message}`);
  }
}

/**
 * Give an evaluation a fresh link and email it.
 *
 * A new token every time: the previous link is invalidated, so two live links
 * can never produce two conflicting submissions for one evaluation.
 *
 * If nothing reaches the recipient — the send failed, or "Pause all email" is
 * on — the evaluation is put back exactly as it was, old link included, so it
 * is not shown as "Waiting for manager" when nobody was asked.
 *
 * @param {object} cycle - with `employee` included
 * @param {object} [opts]
 * @param {{name: string, email: string}} [opts.recipient] - defaults to the reporting manager
 * @param {boolean} [opts.delegated] - the recipient is an acting manager (M7)
 * @param {string} [opts.type='evaluation_link'] - the email template
 * @param {object} [opts.context] - extra template variables
 * @param {boolean} [opts.dropDraft] - clear a saved draft: it belonged to whoever had the link before
 * @returns {Promise<{status: string, to: string[], redirected: boolean, error?: string, recipient: object}>}
 */
export async function issueLink(cycle, {
  recipient = null, delegated = false, type = 'evaluation_link', context = {}, dropDraft = false,
} = {}) {
  const validityRow = await prisma.pea_settings.findUnique({ where: { setting_key: 'token_validity_days' } });
  const validity = Number(validityRow?.setting_value) || 30;

  const to = recipient
    ? { name: cleanName(recipient.name) || normEmail(recipient.email), email: normEmail(recipient.email) }
    : { name: cycle.employee.rm_name, email: normEmail(cycle.employee.rm_email) };

  const storeRecipient = await hasRecipientColumns();
  const [recipientBefore] = storeRecipient
    ? await prisma.$queryRaw`
        SELECT sent_to_name, sent_to_email, delegated FROM pea_evaluation_cycles WHERE id = ${cycle.id}`
    : [null];

  const now = new Date();
  const refreshed = await prisma.pea_evaluation_cycles.update({
    where: { id: cycle.id },
    data: {
      token: crypto.randomUUID(),
      token_expires_at: addDays(now, validity),
      status: 'email_sent',
      sent_at: now,
      // A new link has not been opened by anyone yet.
      opened_at: null,
      // Reset the chase clock — the recipient is getting a fresh ask.
      reminder_count: 0,
      last_reminded_at: null,
      modified_at: now,
    },
    include: { employee: true },
  });

  if (storeRecipient) {
    await prisma.$executeRaw`
      UPDATE pea_evaluation_cycles
         SET sent_to_name = ${to.name}, sent_to_email = ${to.email}, delegated = ${!!delegated}
       WHERE id = ${cycle.id}`;
  }

  const result = await queueEmail({
    type,
    cycle: refreshed,
    context: { ...context, sentTo: { ...to, delegated: !!delegated } },
  });

  if (result.status === 'failed' || result.status === 'suppressed') {
    await prisma.pea_evaluation_cycles.update({
      where: { id: cycle.id },
      data: {
        token: cycle.token,
        token_expires_at: cycle.token_expires_at,
        status: cycle.status,
        sent_at: cycle.sent_at,
        opened_at: cycle.opened_at,
        reminder_count: cycle.reminder_count,
        last_reminded_at: cycle.last_reminded_at,
        modified_at: new Date(),
      },
    });
    if (storeRecipient) {
      await prisma.$executeRaw`
        UPDATE pea_evaluation_cycles
           SET sent_to_name = ${recipientBefore?.sent_to_name ?? null},
               sent_to_email = ${recipientBefore?.sent_to_email ?? null},
               delegated = ${recipientBefore?.delegated ?? false}
         WHERE id = ${cycle.id}`;
    }
  } else if (dropDraft && (await hasDraftColumns())) {
    await prisma.$executeRaw`
      UPDATE pea_evaluation_cycles SET draft = NULL, draft_saved_at = NULL WHERE id = ${cycle.id}`;
  }

  return { ...result, recipient: to };
}

/**
 * Send, or re-send, one evaluation to its reporting manager now — the action
 * behind "Send" and "Resend". Replaces the old Power Automate Adhoc Flow.
 *
 * @param {object} employee - the pea_employees row
 * @param {number} seqNo
 * @returns {Promise<object>} queueEmail's result plus `recipient`
 */
export async function sendNow(employee, seqNo) {
  await assertSendable(employee);

  const cycle = await prisma.pea_evaluation_cycles.findFirst({
    where: { employee_id: employee.id, seq_no: Number(seqNo) },
    include: { employee: true },
  });
  if (!cycle) throw new AppError(`${employee.full_name} has no evaluation ${seqNo}.`, 404);

  if (cycle.status === 'completed') {
    throw new AppError(
      `Evaluation ${seqNo} for ${employee.full_name} was already submitted. ` +
        'Re-sending would discard that response — use Reopen to have it corrected.',
      409
    );
  }

  // A plain send always goes to the reporting manager, which is also how a
  // link that was with an acting manager comes back (M7).
  const before = await recipientOf(cycle);
  const result = await issueLink(cycle, { dropDraft: before.delegated });
  if (result.status === 'failed') throw new AppError(`Could not send: ${result.error}`, 502);
  return result;
}

/**
 * A reporting manager changed: every link that is out goes to the new one — M3.
 *
 * The old manager's link is cancelled FIRST, inside the caller's transaction
 * (see cancelOpenLinks), so it stops working even if the email to the new
 * manager then fails. This is the second half: send each one on. An evaluation
 * whose email does not go out is left "not sent", where the daily send picks
 * it up the next morning.
 *
 * @param {bigint} employeeId
 * @param {bigint[]} cycleIds - from cancelOpenLinks()
 * @returns {Promise<{sent: number, held: number}>}
 */
export async function reissueToManager(employeeId, cycleIds) {
  let sent = 0;
  let held = 0;
  if (!cycleIds.length) return { sent, held };

  const employee = await prisma.pea_employees.findUnique({ where: { id: employeeId } });
  try {
    await assertSendable(employee);
  } catch (err) {
    // On hold or left: the old links are already dead, and nothing new goes out.
    logger.info(`Links for employee ${employeeId} not re-sent after a manager change: ${err.message}`);
    return { sent, held: cycleIds.length };
  }

  for (const id of cycleIds) {
    // eslint-disable-next-line no-await-in-loop
    const cycle = await prisma.pea_evaluation_cycles.findUnique({ where: { id }, include: { employee: true } });
    if (!cycle || cycle.status !== 'pending') continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const result = await issueLink(cycle, { dropDraft: true });
      if (result.status === 'sent') sent += 1;
      else held += 1;
    } catch (err) {
      held += 1;
      logger.error(`Could not re-send evaluation ${cycle.seq_no} for employee ${employeeId}: ${err.message}`);
    }
  }
  return { sent, held };
}

/**
 * Kill every link that is out for a person, without sending anything — the
 * first half of a manager change (M3). Runs inside the caller's transaction.
 *
 * Each one goes back to "not sent" with a NEW token, so the email already in
 * the old manager's inbox opens an "invalid link" page. Their draft goes too:
 * a half-written opinion belongs to the person who wrote it.
 *
 * @param {bigint} employeeId
 * @param {object} tx
 * @returns {Promise<bigint[]>} the ids, for reissueToManager()
 */
export async function cancelOpenLinks(employeeId, tx) {
  const out = await tx.pea_evaluation_cycles.findMany({
    where: { employee_id: employeeId, status: { in: ['email_sent', 'opened'] } },
    select: { id: true },
  });
  const dropDrafts = await hasDraftColumns();
  const clearRecipient = await hasRecipientColumns();

  for (const { id } of out) {
    // eslint-disable-next-line no-await-in-loop
    await tx.pea_evaluation_cycles.update({
      where: { id },
      data: {
        token: crypto.randomUUID(),
        token_expires_at: null,
        status: 'pending',
        sent_at: null,
        opened_at: null,
        reminder_count: 0,
        last_reminded_at: null,
        modified_at: new Date(),
      },
    });
    if (dropDrafts) {
      // eslint-disable-next-line no-await-in-loop
      await tx.$executeRaw`UPDATE pea_evaluation_cycles SET draft = NULL, draft_saved_at = NULL WHERE id = ${id}`;
    }
    if (clearRecipient) {
      // eslint-disable-next-line no-await-in-loop
      await tx.$executeRaw`
        UPDATE pea_evaluation_cycles SET sent_to_name = NULL, sent_to_email = NULL, delegated = FALSE WHERE id = ${id}`;
    }
  }
  return out.map((c) => c.id);
}

/**
 * Send one evaluation to an acting manager — M7.
 *
 * For when the reporting manager is away. It is that ONE evaluation: the next
 * one goes to the reporting manager again, and a plain Resend brings this one
 * back. The reporting manager is copied, so nothing is answered in their name
 * without their knowing. Reminders follow the link, and the submission is
 * recorded under the acting manager's own name.
 *
 * @param {string|number} cycleId
 * @param {{name?: string, email?: string, note?: string}} input
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function delegate(cycleId, input = {}, actor) {
  if (!(await hasRecipientColumns())) throw new AppError(NEEDS_DDL, 503);

  const cycle = await loadCycle(cycleId);
  if (!OPEN.includes(cycle.status)) {
    throw new AppError(
      cycle.status === 'completed'
        ? 'This evaluation has already been submitted.'
        : 'This evaluation is closed, so there is nothing to send.',
      409
    );
  }
  await assertSendable(cycle.employee);

  const name = cleanName(input.name);
  const email = normEmail(input.email);
  if (!name) throw new AppError('Give the acting manager\'s name.', 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('Give a valid email address for the acting manager.', 400);
  if (email === normEmail(cycle.employee.rm_email)) {
    throw new AppError(`${email} is the reporting manager. Use Resend to send it to them.`, 400);
  }
  if (email === normEmail(cycle.employee.office_email)) {
    throw new AppError('An evaluation cannot be sent to the person being evaluated.', 400);
  }

  const result = await issueLink(cycle, { recipient: { name, email }, delegated: true, dropDraft: true });
  if (result.status === 'failed') throw new AppError(`Could not send: ${result.error}`, 502);

  const reason = String(input.note || '').trim();
  if (result.status === 'sent') {
    await note(
      cycle.employee_id,
      `Evaluation ${cycle.seq_no} sent to ${name} <${email}> as acting manager, in place of ${cycle.employee.rm_name}.` +
        (reason ? ` Note: ${reason}` : ''),
      actor
    );
  }

  logger.info(`Evaluation ${cycle.seq_no} for employee ${cycle.employee_id} delegated to ${email} by ${actor} (${result.status})`);
  return { status: result.status, sentTo: result.to, redirected: result.redirected, recipient: result.recipient };
}

/**
 * Why a submitted evaluation cannot be reopened, or null when it can — M6.
 *
 * Pure, so the rule is testable without a database.
 *
 * Only the person's LATEST submitted evaluation, and only while nothing after
 * it has gone out. Reopening an earlier one would leave a later evaluation
 * comparing itself against answers that have since changed, and a later one
 * already with the manager would be asking about a period whose predecessor is
 * being rewritten.
 *
 * @param {object} cycle - with `employee` and `scores`
 * @param {Array<{seq_no: number, status: string, sent_at: Date|null}>} siblings - the person's other cycles
 * @returns {string|null}
 */
export function reopenBlocker(cycle, siblings = []) {
  if (cycle.status !== 'completed') return 'Only a submitted evaluation can be reopened.';
  if (cycle.legacy_format || !(cycle.scores || []).length) {
    return 'This evaluation was imported from the spreadsheet as free text, so it has no ratings to correct.';
  }
  if (cycle.employee?.employment_status !== 'active') {
    return `${cycle.employee?.full_name || 'This person'} is marked as having left.`;
  }

  const later = siblings.filter((s) => s.seq_no > cycle.seq_no).sort((a, b) => a.seq_no - b.seq_no);
  const submitted = later.find((s) => s.status === 'completed');
  if (submitted) {
    return `Evaluation ${submitted.seq_no} was submitted after this one. Only the latest submitted evaluation can be reopened.`;
  }
  const out = later.find((s) => s.status === 'email_sent' || s.status === 'opened' || (s.status === 'pending' && s.sent_at));
  if (out) {
    return `Evaluation ${out.seq_no} has already gone to the manager. Reopen this one only once that is answered or closed.`;
  }
  return null;
}

/**
 * Hand a submitted evaluation back to be corrected — M6.
 *
 * What the manager submitted is kept, as an earlier version, with who reopened
 * it and why. Their answers go into the form as a draft, so they correct
 * rather than retype. If the evaluation carried a decision, the decision is
 * taken back with it: the person returns to where they stood before, and an
 * extension evaluation it scheduled is withdrawn (it has not gone out — that
 * is one of the conditions).
 *
 * @param {string|number} cycleId
 * @param {{reason?: string}} input
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function reopen(cycleId, input = {}, actor) {
  if (!(await hasRevisions()) || !(await hasDraftColumns())) throw new AppError(NEEDS_DDL, 503);

  const cycle = await loadCycle(cycleId);
  const reason = String(input.reason || '').trim();
  if (!reason) throw new AppError('Say why this evaluation is being reopened — the manager is told, and it is kept on the record.', 400);
  if (reason.length > 2000) throw new AppError(`The reason is ${reason.length} characters; the limit is 2000.`, 400);

  const siblings = await prisma.pea_evaluation_cycles.findMany({
    where: { employee_id: cycle.employee_id, id: { not: cycle.id } },
    select: { id: true, seq_no: true, status: true, sent_at: true, is_extension: true },
  });
  const blocker = reopenBlocker(cycle, siblings);
  if (blocker) throw new AppError(blocker, 409);
  await assertSendable(cycle.employee);

  const who = await recipientOf(cycle);

  const decisionReason = (await hasDecisionReason())
    ? (await prisma.$queryRaw`SELECT confirmation_reason FROM pea_evaluation_cycles WHERE id = ${cycle.id}`)[0]?.confirmation_reason || null
    : null;
  const names = (await hasRecipientColumns())
    ? (await prisma.$queryRaw`SELECT submitted_by_name, entered_by FROM pea_evaluation_cycles WHERE id = ${cycle.id}`)[0] || {}
    : {};

  const snapshot = {
    seq_no: cycle.seq_no,
    submitted_at: cycle.submitted_at,
    submitted_by_email: cycle.submitted_by_email,
    submitted_by_name: names.submitted_by_name || null,
    entered_by: names.entered_by || null,
    avg_rating: cycle.avg_rating === null ? null : Number(cycle.avg_rating),
    remarks: cycle.remarks,
    confirmation_status: cycle.confirmation_status,
    confirmation_reason: decisionReason,
    scores: cycle.scores.map((s) => ({
      param_key: s.param_key,
      param_label: s.param_label,
      rating: s.rating === null ? null : Number(s.rating),
      comments: s.comments,
      sort_order: s.sort_order,
    })),
  };

  // The manager's own answers, as the form's draft, so they correct them.
  const draft = {
    ratings: Object.fromEntries(
      cycle.scores.map((s) => [s.param_key, { rating: s.rating === null ? '' : String(Number(s.rating)), comments: s.comments || '' }])
    ),
    remarks: cycle.remarks || '',
    confirmation_status: cycle.confirmation_status || '',
    confirmation_reason: decisionReason || '',
  };

  const decision = cycle.confirmation_status;
  const clearReason = await hasDecisionReason();
  const clearNames = await hasRecipientColumns();
  const clearReads = await hasEvaluationReads();
  const now = new Date();

  const outcome = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO pea_evaluation_revisions (cycle_id, snapshot, reason, reopened_by)
      VALUES (${cycle.id}, ${JSON.stringify(snapshot)}::jsonb, ${reason}, ${actor})`;

    let withdrawn = 0;
    let restoredStatus;
    if (decision) {
      if (decision.startsWith('Extend')) {
        ({ count: withdrawn } = await tx.pea_evaluation_cycles.deleteMany({
          where: {
            employee_id: cycle.employee_id,
            seq_no: { gt: cycle.seq_no },
            is_extension: true,
            status: 'pending',
            sent_at: null,
          },
        }));
      }

      // Take the decision back only if it is still the one on the person —
      // a later decision recorded by HR stands.
      if (cycle.employee.confirmation_status === decision) {
        const made = await tx.pea_employee_audit.findFirst({
          where: { employee_id: cycle.employee_id, field_name: 'confirmation_status', new_value: decision },
          orderBy: { changed_at: 'desc' },
          select: { old_value: true },
        });
        restoredStatus = made?.old_value || null;
        await tx.pea_employees.update({
          where: { id: cycle.employee_id },
          data: { confirmation_status: restoredStatus, modified_at: now },
        });
        await tx.pea_employee_audit.create({
          data: {
            employee_id: cycle.employee_id,
            field_name: 'confirmation_status',
            old_value: decision,
            new_value: restoredStatus,
            changed_by: actor,
            change_source: 'manual',
          },
        });
      }
    }

    await tx.pea_evaluation_scores.deleteMany({ where: { cycle_id: cycle.id } });
    await tx.pea_evaluation_cycles.update({
      where: { id: cycle.id },
      data: {
        // "Not sent" for the moment between this and issueLink() below; if the
        // email does not go out, the daily send picks it up from here.
        status: 'pending',
        token: crypto.randomUUID(),
        token_expires_at: null,
        sent_at: null,
        opened_at: null,
        submitted_at: null,
        submitted_by_email: null,
        submitted_ip: null,
        avg_rating: null,
        remarks: null,
        confirmation_status: null,
        reminder_count: 0,
        last_reminded_at: null,
        modified_at: now,
      },
    });
    await tx.$executeRaw`
      UPDATE pea_evaluation_cycles SET draft = ${JSON.stringify(draft)}::jsonb, draft_saved_at = ${now} WHERE id = ${cycle.id}`;
    if (clearReason) {
      await tx.$executeRaw`UPDATE pea_evaluation_cycles SET confirmation_reason = NULL WHERE id = ${cycle.id}`;
    }
    if (clearNames) {
      await tx.$executeRaw`UPDATE pea_evaluation_cycles SET submitted_by_name = NULL, entered_by = NULL WHERE id = ${cycle.id}`;
    }
    // The corrected version is new feedback: nobody has read it yet.
    if (clearReads) {
      await tx.$executeRaw`DELETE FROM pea_evaluation_reads WHERE cycle_id = ${cycle.id}`;
    }

    await tx.pea_employee_audit.create({
      data: {
        employee_id: cycle.employee_id,
        field_name: '*',
        new_value:
          `Evaluation ${cycle.seq_no} reopened for correction. Reason: ${reason}` +
          (decision ? ` Its decision (${decision}) was taken back.` : '') +
          (withdrawn ? ` ${withdrawn} extension evaluation(s) it had scheduled were withdrawn.` : ''),
        changed_by: actor,
        change_source: 'manual',
      },
    });

    return { withdrawn, decisionTakenBack: restoredStatus !== undefined };
  });

  // Back to whoever answered it — an acting manager if that is who it was.
  const fresh = await prisma.pea_evaluation_cycles.findUnique({ where: { id: cycle.id }, include: { employee: true } });
  const result = await issueLink(fresh, {
    type: 'evaluation_reopened',
    recipient: who.email ? { name: who.name, email: who.email } : null,
    delegated: who.delegated,
    context: { reason, reopenedBy: actor },
  });

  logger.info(
    `Evaluation ${cycle.seq_no} for employee ${cycle.employee_id} reopened by ${actor} (${result.status})` +
      `${outcome.withdrawn ? `, ${outcome.withdrawn} extension cycle(s) withdrawn` : ''}`
  );

  return {
    status: result.status,
    sentTo: result.to,
    redirected: result.redirected,
    error: result.error,
    ...outcome,
  };
}

/** What HR can say it did about flagged feedback — P8. */
export const FOLLOW_UP_OUTCOMES = Object.freeze({
  spoke_to_manager: 'Spoke to the manager',
  spoke_to_commando: 'Spoke to the Commando',
  improvement_plan: 'Improvement plan started',
  no_action: 'No action needed',
  other: 'Other',
});

/**
 * Record what HR did about a flagged evaluation — P8.
 *
 * Until now the only trace was a per-person "read" mark, which says someone
 * opened it and nothing about what happened next. An outcome is for everyone:
 * once one is recorded the evaluation leaves "Needs attention" for the whole
 * team, not just for whoever wrote it.
 *
 * @param {string|number} cycleId
 * @param {{outcome?: string, note?: string}} input
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function recordFollowUp(cycleId, input = {}, actor) {
  if (!(await hasFollowups())) throw new AppError(NEEDS_DDL, 503);

  const cycle = await loadCycle(cycleId);
  if (cycle.status !== 'completed') throw new AppError('There is nothing to follow up until the evaluation is submitted.', 409);

  const outcome = String(input.outcome || '').trim();
  if (!FOLLOW_UP_OUTCOMES[outcome]) {
    throw new AppError(`Choose what was done: ${Object.values(FOLLOW_UP_OUTCOMES).join(', ')}.`, 400);
  }
  const text = String(input.note || '').trim();
  if (outcome === 'other' && !text) throw new AppError('Say what was done.', 400);
  if (text.length > 2000) throw new AppError(`The note is ${text.length} characters; the limit is 2000.`, 400);

  await prisma.$executeRaw`
    INSERT INTO pea_evaluation_followups (cycle_id, outcome, note, recorded_by)
    VALUES (${cycle.id}, ${outcome}, ${text || null}, ${actor})`;

  await note(
    cycle.employee_id,
    `Follow-up on evaluation ${cycle.seq_no}: ${FOLLOW_UP_OUTCOMES[outcome]}.${text ? ` ${text}` : ''}`,
    actor
  );

  logger.info(`Follow-up recorded on evaluation ${cycle.id} by ${actor}: ${outcome}`);
  return { outcome, label: FOLLOW_UP_OUTCOMES[outcome], note: text || null, by: actor, at: new Date() };
}

/**
 * HR enters an evaluation's ratings in the app, on the manager's behalf — B5.
 *
 * For history: someone added to PEA months after joining has evaluations that
 * fell due before PEA knew about them. HR can leave those blank, or type in
 * what the manager said at the time. The ratings are required; a comment on
 * each is not, because history often has none. It is marked as entered by HR,
 * and no "evaluation submitted" email goes out — HR is the one who did it.
 *
 * @param {string|number} cycleId
 * @param {object} body - { ratings, remarks, confirmation_status, confirmation_reason }
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function recordByHr(cycleId, body = {}, actor) {
  // Without `entered_by` the entry would be stored as if the manager had
  // submitted it, which is the one thing it must never look like.
  if (!(await hasRecipientColumns())) throw new AppError(NEEDS_DDL, 503);

  const cycle = await loadCycle(cycleId);
  if (cycle.status === 'completed') {
    throw new AppError('This evaluation has already been submitted. Use Reopen to have it corrected.', 409);
  }

  const params = await activeParams(cycle.employee);
  const scored = scoreProblems(params, body.ratings || {});
  const decided = await decisionProblems(cycle, body, { required: false });
  const problems = [
    // A comment is the manager's to give; HR entering history may not have one.
    ...scored.problems.filter((p) => !p.field.startsWith('comments_')),
    ...decided.problems,
  ];
  if (problems.length) {
    const err = new AppError(problems.map((p) => p.text).join(' '), 400);
    err.problems = problems;
    throw err;
  }

  const submittedBy = await recipientOf(cycle);
  const remarks = String(body.remarks || '').trim() || null;
  const result = await recordSubmission(cycle, {
    rows: scored.rows,
    remarks,
    confirmation: decided.confirmation,
    reason: decided.reason,
    submittedBy,
    enteredBy: actor,
  });

  await note(
    cycle.employee_id,
    `Evaluation ${cycle.seq_no} entered by HR on behalf of ${submittedBy.name || 'the reporting manager'} — ` +
      `average ${result.average.toFixed(2)} / 5` +
      (decided.confirmation ? `, decision ${decided.confirmation}` : '') + '.',
    actor
  );

  logger.info(`Evaluation ${cycle.seq_no} for employee ${cycle.employee_id} entered by HR (${actor}) — average ${result.average}`);
  return {
    id: String(cycle.id),
    average: result.average,
    confirmation_status: decided.confirmation,
    extensionCyclesCreated: result.extensionCycles,
    enteredOn: formatDisplay(new Date()),
  };
}
