/**
 * employee.service.js — CRUD for the master record.
 *
 * Two behaviours here are not obvious from the table definition:
 *
 *  1. Every field change is written to pea_employee_audit. This is the concrete
 *     answer to "what if the data is wrong and I correct it?" — in the Excel
 *     file a correction was an untracked overwrite with no record of the old
 *     value, who changed it, or when. Plan §6.5.
 *
 *  2. Changing DOJ or fresher/experienced regenerates the schedule, but only
 *     for cycles nobody has acted on. See cycleGenerator.regenerateCycles().
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import config from '../config/index.js';
import {
  generateCycles,
  regenerateCycles,
  generateExtensionCycles,
  extensionsLeft,
  allowedDecisions,
  MAX_EXTENSION_CYCLES,
} from './cycleGenerator.service.js';
import { queueEmail, probationContext, probationNote } from './notification.service.js';
import { notifyStaff } from './inAppNotification.service.js';
import { cancelOpenLinks, reissueToManager } from './evaluationActions.service.js';
import {
  hasPhase2Features,
  hasDecisionColumns,
  hasRecipientColumns,
  hasEmployeeNotes,
} from '../utils/schemaCapabilities.js';
import { isAdminTier } from '../config/roles.js';
// Archive (07-10-2026) — an archived Commando is a read-only record.
import { notArchivedSql, archivedIds, archiveRecord, assertNotArchived } from '../utils/archiveScope.js';
import { hasArchiveColumns } from '../utils/schemaCapabilities.js';
import { REASON_MAX } from '../config/ratingScale.js';
import { toUtcMidnight, toDateString, todayIn, dateIn, daysBetween, formatDisplay } from '../utils/dateUtils.js';

/** Fields a user may set. Anything else in a request body is ignored. */
const WRITABLE = [
  'full_name',
  'office_email',
  'personal_email',
  'is_experienced',
  'doj',
  'rm_name',
  'rm_email',
  'pl_email',
  'halt_process',
  'confirmation_status',
  'employment_status',
];

/** Changing either of these invalidates the schedule. */
const SCHEDULE_FIELDS = ['doj', 'is_experienced'];

/**
 * Fields Entra supplies and the sync may overwrite — so the only ones where a
 * lock means anything. Plan §6.5 Part 2.
 *
 * employment_status is deliberately absent even though Entra informs it: the
 * scan never writes it (a leaver is only ever a suggestion — §13.9), so there
 * is nothing to lock it against.
 */
export const LOCKABLE_FIELDS = Object.freeze(['full_name', 'office_email']);

const FIELD_LABELS = { full_name: 'Display name', office_email: 'Email address' };

export const CONFIRMATION_STATUSES = Object.freeze([
  'Confirmed',
  'Not Confirmed',
  'Extend for 1 month',
  'Extend for 2 months',
]);

/** Decisions that end the probation, so no further evaluation is wanted. */
const ENDS_PROBATION = Object.freeze(['Confirmed', 'Not Confirmed']);

/** Normalise an email for storage and comparison. */
const normEmail = (v) => (v || '').trim().toLowerCase() || null;

/**
 * Validate and coerce an incoming payload.
 * @param {object} input
 * @param {boolean} isCreate
 * @returns {object} clean data ready for Prisma
 * @throws {AppError} 400
 */
function sanitize(input, isCreate) {
  const data = {};

  for (const key of WRITABLE) {
    if (input[key] === undefined) continue;

    switch (key) {
      case 'full_name':
        // Trailing and doubled spaces are rife in the source sheet
        // ("Shelly Jain ", "Priyanka Khurana "). Collapse on the way in so
        // they never reach a report or an email salutation.
        data.full_name = String(input.full_name).replace(/\s+/g, ' ').trim();
        break;

      case 'office_email':
      case 'personal_email':
      case 'rm_email':
      case 'pl_email':
        data[key] = normEmail(input[key]);
        break;

      case 'is_experienced':
      case 'halt_process':
        data[key] = input[key] === true || input[key] === 'true' || input[key] === 'Yes';
        break;

      case 'doj': {
        const d = toUtcMidnight(input.doj);
        if (!d) throw new AppError(`Invalid date of joining: "${input.doj}". Use YYYY-MM-DD.`, 400);
        data.doj = d;
        break;
      }

      case 'confirmation_status': {
        const v = (input.confirmation_status || '').trim();
        if (v && !CONFIRMATION_STATUSES.includes(v)) {
          throw new AppError(
            `Invalid confirmation status "${v}". Must be one of: ${CONFIRMATION_STATUSES.join(', ')}`,
            400
          );
        }
        data.confirmation_status = v || null;
        break;
      }

      case 'employment_status': {
        const v = (input.employment_status || 'active').trim();
        if (!['active', 'left'].includes(v)) {
          throw new AppError(`Invalid employment status "${v}". Must be "active" or "left".`, 400);
        }
        data.employment_status = v;
        break;
      }

      default:
        data[key] = input[key];
    }
  }

  if (isCreate) {
    const required = ['full_name', 'office_email', 'doj', 'rm_name', 'rm_email', 'pl_email'];
    const missing = required.filter((f) => !data[f]);
    if (missing.length) {
      throw new AppError(`Missing required field(s): ${missing.join(', ')}`, 400);
    }
  }

  return data;
}

/**
 * Write one audit row per changed field.
 * @param {bigint} employeeId
 * @param {object} before
 * @param {object} after
 * @param {string} changedBy
 * @param {string} source
 * @param {object} tx
 */
async function recordChanges(employeeId, before, after, changedBy, source, tx) {
  const rows = [];

  for (const [field, newValue] of Object.entries(after)) {
    const oldValue = before?.[field];
    const a = oldValue instanceof Date ? toDateString(oldValue) : oldValue;
    const b = newValue instanceof Date ? toDateString(newValue) : newValue;
    if (String(a ?? '') === String(b ?? '')) continue;

    rows.push({
      employee_id: employeeId,
      field_name: field,
      old_value: a === null || a === undefined ? null : String(a),
      new_value: b === null || b === undefined ? null : String(b),
      changed_by: changedBy,
      change_source: source,
    });
  }

  if (rows.length) await tx.pea_employee_audit.createMany({ data: rows });
  return rows.length;
}

/**
 * Find an employee by office email, case- and whitespace-insensitively.
 *
 * Not findUnique: the database enforces uniqueness on lower(trim(office_email))
 * via an expression index, which Prisma cannot model. See schema.prisma.
 *
 * @param {string} email
 * @param {object} [tx]
 * @returns {Promise<object|null>}
 */
export async function findByOfficeEmail(email, tx = prisma) {
  const needle = normEmail(email);
  if (!needle) return null;
  const rows = await tx.$queryRaw`
    SELECT * FROM pea_employees WHERE lower(trim(office_email)) = ${needle} LIMIT 1`;
  return rows[0] || null;
}

// ── Evaluations already past when someone is added, or resumed — B5 / U9 ────
//
// The daily send catches up on anything due and not sent. That is what makes it
// reliable, and it is also why adding someone who joined four months ago used
// to email their manager three or four forms the next morning. The Excel import
// has its own rule for this (closeStaleCycles); adding by hand, accepting a new
// joiner and resuming from a long hold did not, so they now ask.

/** What may be done with evaluations that are already past due. */
export const PAST_DUE_ACTIONS = Object.freeze(['send_all', 'send_latest', 'close']);

/**
 * `send_all` unless the caller chose otherwise — which is what happened before
 * there was a choice, so a caller that sends nothing behaves exactly as it did.
 * @param {*} value
 * @returns {string}
 * @throws {AppError} 400
 */
function pastDueChoice(value) {
  if (value === undefined || value === null || value === '') return 'send_all';
  if (!PAST_DUE_ACTIONS.includes(value)) {
    throw new AppError(`Invalid past_due_action "${value}". Must be one of: ${PAST_DUE_ACTIONS.join(', ')}`, 400);
  }
  return value;
}

/**
 * Which past-due evaluations a choice closes. Pure, so the rule is testable
 * without a database.
 *
 *   send_all     none — the manager is asked for every one
 *   send_latest  all but the most recent — the manager gets one form
 *   close        all of them — nothing goes out until the next due date
 *
 * Only evaluations nobody has been asked about yet: one already sent, opened
 * or answered is never touched.
 *
 * @param {Array<{seq_no: number, status: string, due_date: Date}>} cycles
 * @param {string} action
 * @param {Date} today - UTC midnight
 * @returns {object[]} the cycles to close, oldest first
 */
export function pastDueToClose(cycles, action, today) {
  const past = cycles
    .filter((c) => c.status === 'pending' && toUtcMidnight(c.due_date) <= today)
    .sort((a, b) => a.seq_no - b.seq_no);

  if (action === 'close') return past;
  if (action === 'send_latest') return past.slice(0, -1);
  return [];
}

/**
 * Close the past-due evaluations a choice says to close, and say so in the
 * change history. They become "Closed", not deleted: HR can still enter their
 * ratings in the app, or send one after all.
 *
 * @param {bigint} employeeId
 * @param {string} action - one of PAST_DUE_ACTIONS
 * @param {string} actor
 * @param {string} source
 * @param {object} tx
 * @returns {Promise<number>} evaluations closed
 */
async function applyPastDue(employeeId, action, actor, source, tx) {
  if (action === 'send_all') return 0;

  const cycles = await tx.pea_evaluation_cycles.findMany({
    where: { employee_id: employeeId },
    select: { id: true, seq_no: true, status: true, due_date: true },
  });
  const closing = pastDueToClose(cycles, action, todayIn(config.scheduler.timezone));
  if (!closing.length) return 0;

  await tx.pea_evaluation_cycles.updateMany({
    where: { id: { in: closing.map((c) => c.id) } },
    data: { status: 'skipped', modified_at: new Date() },
  });

  await tx.pea_employee_audit.create({
    data: {
      employee_id: employeeId,
      field_name: '*',
      new_value:
        `${closing.length} past-due evaluation(s) closed as history ` +
        `(evaluation ${closing.map((c) => c.seq_no).join(', ')}) — ` +
        (action === 'close'
          ? 'nothing is sent until the next due date.'
          : 'the manager is asked for the latest one only.') +
        ' Their ratings can still be entered in the app.',
      changed_by: actor,
      change_source: source,
    },
  });

  return closing.length;
}

/**
 * Create an employee and generate their evaluation schedule.
 * @param {object} input
 * @param {string} actor - username for the audit trail
 * @param {string} [source='manual']
 * @returns {Promise<object>} the employee, with cycles
 */
export async function createEmployee(input, actor, source = 'manual') {
  const data = sanitize(input, true);
  const pastDueAction = pastDueChoice(input.past_due_action);

  const clash = await findByOfficeEmail(data.office_email);
  if (clash) {
    throw new AppError(`A Commando with office email ${data.office_email} already exists`, 409);
  }

  return prisma.$transaction(async (tx) => {
    const employee = await tx.pea_employees.create({ data: { ...data, source } });

    const created = await generateCycles(employee.id, employee, tx);
    await recordChanges(employee.id, {}, data, actor, source, tx);

    // B5 / U9 — someone added months after joining has evaluations that are
    // already past. What happens to them is HR's choice, made on the screen.
    const closed = await applyPastDue(employee.id, pastDueAction, actor, source, tx);

    logger.info(
      `Employee created: ${employee.full_name} <${employee.office_email}> ` +
        `(${employee.is_experienced ? 'experienced' : 'fresher'}, DOJ ${toDateString(employee.doj)}) ` +
        `— ${created} evaluation cycles generated` +
        `${closed ? `, ${closed} past-due closed as history (${pastDueAction})` : ''}`
    );

    return tx.pea_employees.findUnique({
      where: { id: employee.id },
      include: { cycles: { orderBy: { seq_no: 'asc' } } },
    });
  });
}

/**
 * Update an employee, auditing every change and rescheduling if needed.
 * @param {bigint|number} id
 * @param {object} input
 * @param {string} actor
 * @param {string} [source='manual']
 * @returns {Promise<object>}
 */
export async function updateEmployee(id, input, actor, source = 'manual') {
  const employeeId = BigInt(id);
  const before = await prisma.pea_employees.findUnique({ where: { id: employeeId } });
  if (!before) throw new AppError('Commando not found', 404);
  await assertNotArchived(employeeId, before.full_name); // Archive (07-10-2026)

  const data = sanitize(input, false);

  // ── Field locks (plan §6.5 Part 2) ──────────────────────────────────────
  // lock_fields:   "Keep my value" — the Azure sync must never overwrite these.
  // unlock_fields: "Unlock / resync from Azure" — follow Entra again, and take
  //                its latest value now rather than waiting for the next scan.
  const toLock = pickLockable(input.lock_fields);
  const toUnlock = pickLockable(input.unlock_fields);

  if (toLock.length || toUnlock.length) {
    const current = before.locked_fields || [];
    const next = [...new Set([...current, ...toLock])].filter((f) => !toUnlock.includes(f)).sort();

    if (next.join(',') !== [...current].sort().join(',')) data.locked_fields = next;

    if (toUnlock.length) {
      const snapshot = await azureSnapshot(employeeId);
      if (toUnlock.includes('full_name') && snapshot?.azure_display_name && data.full_name === undefined) {
        data.full_name = snapshot.azure_display_name.replace(/\s+/g, ' ').trim();
      }
      if (toUnlock.includes('office_email') && snapshot?.azure_mail && data.office_email === undefined) {
        data.office_email = normEmail(snapshot.azure_mail);
      }
    }
  }

  if (data.office_email && data.office_email !== before.office_email) {
    const clash = await findByOfficeEmail(data.office_email);
    if (clash && String(clash.id) !== String(employeeId)) {
      throw new AppError(`A Commando with office email ${data.office_email} already exists`, 409);
    }
  }

  const reschedule = SCHEDULE_FIELDS.some(
    (f) =>
      data[f] !== undefined &&
      String(f === 'doj' ? toDateString(data.doj) : data[f]) !==
        String(f === 'doj' ? toDateString(before.doj) : before[f])
  );

  // M3 — a change of reporting manager. The email address is what identifies
  // them; a corrected spelling of the name alone moves nothing.
  const managerChanged =
    data.rm_email !== undefined && normEmail(data.rm_email) !== normEmail(before.rm_email);

  // It was `return prisma.$transaction(…)`; the result is held now so the links
  // can be re-sent after the change is committed.
  const saved = await prisma.$transaction(async (tx) => {
    await tx.pea_employees.update({
      where: { id: employeeId },
      data: { ...data, modified_at: new Date() },
    });

    const changes = await recordChanges(employeeId, before, data, actor, source, tx);

    // M3 — links already with the old manager stop working here, in the same
    // transaction as the change itself. The old manager's open link used to
    // keep working, and whatever they submitted was credited to the new one.
    const cancelledLinks = managerChanged ? await cancelOpenLinks(employeeId, tx) : [];

    // Confirmed / Not Confirmed ends the probation, whether the manager chose it
    // on the form or HR recorded it here: close whatever is still outstanding,
    // exactly as evaluation.service.submit() does.
    let closedEvaluations = 0;
    if (
      ENDS_PROBATION.includes(data.confirmation_status) &&
      data.confirmation_status !== before.confirmation_status
    ) {
      ({ count: closedEvaluations } = await tx.pea_evaluation_cycles.updateMany({
        where: { employee_id: employeeId, status: { in: ['pending', 'email_sent', 'opened'] } },
        data: { status: 'skipped', modified_at: new Date() },
      }));
      if (closedEvaluations) {
        logger.info(`Employee ${employeeId} ${data.confirmation_status}: ${closedEvaluations} open evaluation(s) closed`);
      }
    }

    let rescheduled = null;
    if (reschedule) {
      rescheduled = await regenerateCycles(employeeId, tx);
      logger.info(
        `Schedule recomputed for employee ${employeeId}: ` +
          `${rescheduled.updated} moved, ${rescheduled.created} added, ` +
          `${rescheduled.skipped} left alone (already sent or submitted)`
      );
    }

    const fresh = await tx.pea_employees.findUnique({
      where: { id: employeeId },
      include: { cycles: { orderBy: { seq_no: 'asc' } } },
    });

    // M3 — was: return { ...fresh, _meta: { auditedChanges: changes, rescheduled, closedEvaluations } };
    return { ...fresh, _meta: { auditedChanges: changes, rescheduled, closedEvaluations }, cancelledLinks };
  });

  // M3 — and now each of those evaluations goes to the new manager. After the
  // commit, because an email must never hold a database transaction open; one
  // that cannot be sent stays "not sent" and the daily send picks it up.
  const { cancelledLinks, ...employee } = saved;
  if (cancelledLinks.length) {
    const { sent, held } = await reissueToManager(employeeId, cancelledLinks);
    employee._meta.linksReissued = sent;
    employee._meta.linksHeld = held;

    await prisma.pea_employee_audit.create({
      data: {
        employee_id: employeeId,
        field_name: '*',
        new_value:
          `Reporting manager changed: ${cancelledLinks.length} open evaluation link(s) with ` +
          `${before.rm_name || before.rm_email} were cancelled` +
          (sent ? `; ${sent} sent to ${employee.rm_name || employee.rm_email}.` : '.') +
          (held ? ` ${held} could not be sent yet and will go with the next daily send.` : ''),
        changed_by: actor,
        change_source: source,
      },
    });

    // The cycles above were read before the re-send; give the caller what is true now.
    employee.cycles = await prisma.pea_evaluation_cycles.findMany({
      where: { employee_id: employeeId },
      orderBy: { seq_no: 'asc' },
    });
  }

  return employee;
}

// ── The Commandos list: filters and sorting — U5, U6 ────────────────────────
//
// The list could be narrowed by type and by decision only, and was always in
// the order people were added. HR could not ask it "who is on hold", "who has
// left" or "who reports to this manager", and could not sort or take the
// answer away as a file. The filter and the order are built here, once, so the
// list and its export cannot disagree about who matches.

/** The "Status" filter on the Commandos list — U5. */
export const LIST_STATES = Object.freeze([
  'in_probation',
  'extended',
  'confirmed',
  'not_confirmed',
  'paused',
  'held',
  'left',
  // Archive (07-10-2026) — probation over and moved out of the day-to-day lists.
  'archived',
]);

/** Columns the list may be sorted by — U6. Anything else is refused. */
export const LIST_SORTS = Object.freeze(['name', 'doj', 'manager', 'status']);

/**
 * A leaver flag HR has not dismissed since it was raised — the same test the
 * daily send applies before it holds someone's evaluations
 * (evaluationScheduler.js eligibleEmployee) and the New joiners inbox applies
 * before it lists them.
 * @returns {object} a Prisma `where` fragment
 */
const flaggedNotDismissed = () => ({
  leaver_flagged_at: { not: null },
  OR: [
    { leaver_dismissed_at: null },
    { leaver_dismissed_at: { lt: prisma.pea_employees.fields.leaver_flagged_at } },
  ],
});

/**
 * One "Status" choice as a Prisma `where` fragment.
 *
 * Everything except "left" means someone still here, so a person who has left
 * shows under Left only — not also under the decision they once had.
 *
 * @param {string} state - one of LIST_STATES
 * @returns {object}
 */
function stateWhere(state) {
  switch (state) {
    case 'in_probation':
      return { employment_status: 'active', confirmation_status: null };
    case 'extended':
      return { employment_status: 'active', confirmation_status: { startsWith: 'Extend' } };
    case 'confirmed':
      return { employment_status: 'active', confirmation_status: 'Confirmed' };
    case 'not_confirmed':
      return { employment_status: 'active', confirmation_status: 'Not Confirmed' };
    case 'paused':
      return { employment_status: 'active', halt_process: true };
    case 'held':
      return { employment_status: 'active', ...flaggedNotDismissed() };
    // Archive (07-10-2026) — whoever is archived, whatever their decision; the
    // archive itself is applied in employeeWhere(), which has the ids.
    case 'archived':
      return {};
    default:
      return { employment_status: 'left' };
  }
}

/**
 * The list's filters as one Prisma `where`. Used by the list and by its export.
 *
 *   search   name, office email, manager name or manager email contains it
 *   type     fresher | experienced
 *   state    one of LIST_STATES                                         (U5)
 *   rm       a reporting manager's email                                (U5)
 *
 * `employment_status`, `halt_process` and `confirmation_status` are the older
 * filters; they still work, for the callers that send them.
 *
 * Archive (07-10-2026) — `ctx.archived` is the ids of archived Commandos
 * (archivedIds()), or null when there is no archive here. Archived people are
 * left out unless the status is "Archived" — or a search is typed with no
 * status chosen, so an archived person can always be found by name. Without
 * `ctx` nothing is filtered for the archive, as before.
 *
 * @param {object} [q]
 * @param {{archived?: bigint[]|null}} [ctx]
 * @returns {object}
 * @throws {AppError} 400 for a status that is not on the list
 */
export function employeeWhere(q = {}, ctx = {}) {
  const and = [];

  const search = String(q.search || '').trim();
  if (search) {
    and.push({
      OR: [
        { full_name: { contains: search, mode: 'insensitive' } },
        { office_email: { contains: search, mode: 'insensitive' } },
        { rm_name: { contains: search, mode: 'insensitive' } },
        { rm_email: { contains: search, mode: 'insensitive' } },
      ],
    });
  }

  if (q.type === 'fresher') and.push({ is_experienced: false });
  if (q.type === 'experienced') and.push({ is_experienced: true });
  if (q.employment_status) and.push({ employment_status: q.employment_status });
  if (q.halt_process !== undefined) and.push({ halt_process: q.halt_process === 'true' });

  if (q.confirmation_status === 'pending') and.push({ confirmation_status: null });
  else if (q.confirmation_status) and.push({ confirmation_status: q.confirmation_status });

  if (q.state) {
    if (!LIST_STATES.includes(q.state)) {
      throw new AppError(`Invalid status "${q.state}". Must be one of: ${LIST_STATES.join(', ')}`, 400);
    }
    and.push(stateWhere(q.state));
  }

  const rm = normEmail(q.rm);
  if (rm) and.push({ rm_email: { equals: rm, mode: 'insensitive' } });

  // Archive (07-10-2026)
  if (ctx.archived !== undefined) {
    if (q.state === 'archived') {
      and.push({ id: { in: ctx.archived || [] } });
    } else if (!(search && !q.state) && ctx.archived && ctx.archived.length) {
      and.push({ id: { notIn: ctx.archived } });
    }
  }

  return and.length ? { AND: and } : {};
}

/**
 * The list's order — U6. Newest first unless a column is asked for.
 *
 * "Next due" is not offered: it is worked out from each person's evaluations,
 * so sorting by it needs a subquery the paged list does not have.
 *
 * @param {{sort?: string, order?: string}} [q]
 * @returns {object[]} a Prisma `orderBy`
 * @throws {AppError} 400 for a column that is not on the list
 */
export function employeeOrder(q = {}) {
  if (!q.sort) return [{ created_at: 'desc' }, { id: 'desc' }];
  if (!LIST_SORTS.includes(q.sort)) {
    throw new AppError(`Cannot sort by "${q.sort}". Must be one of: ${LIST_SORTS.join(', ')}`, 400);
  }

  const dir = q.order === 'desc' ? 'desc' : 'asc';

  switch (q.sort) {
    case 'name':
      return [{ full_name: dir }, { id: 'asc' }];
    case 'doj':
      return [{ doj: dir }, { full_name: 'asc' }, { id: 'asc' }];
    case 'manager':
      return [{ rm_name: dir }, { full_name: 'asc' }, { id: 'asc' }];
    default:
      // Status: people still here before people who left, then by decision,
      // with "in probation" (no decision yet) ahead of the decided ones.
      return [
        { employment_status: dir },
        { confirmation_status: { sort: dir, nulls: dir === 'asc' ? 'first' : 'last' } },
        { full_name: 'asc' },
        { id: 'asc' },
      ];
  }
}

/**
 * Whether Microsoft 365 says this person may have left and HR has not yet
 * said otherwise. Pure — the same rule as flaggedNotDismissed(), for a row
 * already in hand.
 * @param {{employment_status: string, leaver_flagged_at: Date|null, leaver_dismissed_at: Date|null}} employee
 * @returns {boolean}
 */
export function mayHaveLeft(employee) {
  if (employee.employment_status !== 'active' || !employee.leaver_flagged_at) return false;
  return !(employee.leaver_dismissed_at && employee.leaver_dismissed_at >= employee.leaver_flagged_at);
}

/** A true/false pea_settings value, with a fallback for a row that is not there. */
async function settingIsOn(key, fallback) {
  const row = await prisma.pea_settings.findUnique({ where: { setting_key: key } });
  return row?.setting_value === undefined || row?.setting_value === null
    ? fallback
    : String(row.setting_value).trim().toLowerCase() === 'true';
}

/**
 * Reporting managers, for the list's manager filter — U5.
 *
 * Its own query rather than the board's managerOptions(): the board lists
 * managers of people still here, and this list can also show people who left.
 *
 * @returns {Promise<Array<{email: string, name: string, people: number}>>}
 */
export async function listManagers() {
  // Archive (07-10-2026) — managers of archived people only are not listed.
  // The table is aliased `e` for that; the query is otherwise as it was.
  return prisma.$queryRaw`
    SELECT lower(trim(e.rm_email)) AS email, min(e.rm_name) AS name, count(*)::int AS people
      FROM pea_employees e
     WHERE coalesce(trim(e.rm_email), '') <> ''
       ${await notArchivedSql('e')}
     GROUP BY lower(trim(e.rm_email))
     ORDER BY min(e.rm_name)`;
}

/**
 * List employees with search, filters, sorting and pagination.
 * @param {object} q - see employeeWhere() and employeeOrder()
 * @returns {Promise<{rows: object[], total: number}>}
 */
export async function listEmployees(q = {}) {
  const page = Math.max(1, parseInt(q.page || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(q.limit || '25', 10)));

  /* U5 — the filters before the status and manager filters, kept for
     reference. They are in employeeWhere() now, unchanged, so the export can
     use the same ones.

  const where = {};

  if (q.search) {
    where.OR = [
      { full_name: { contains: q.search, mode: 'insensitive' } },
      { office_email: { contains: q.search, mode: 'insensitive' } },
      { rm_name: { contains: q.search, mode: 'insensitive' } },
      { rm_email: { contains: q.search, mode: 'insensitive' } },
    ];
  }

  if (q.type === 'fresher') where.is_experienced = false;
  if (q.type === 'experienced') where.is_experienced = true;
  if (q.employment_status) where.employment_status = q.employment_status;
  if (q.halt_process !== undefined) where.halt_process = q.halt_process === 'true';

  if (q.confirmation_status === 'pending') where.confirmation_status = null;
  else if (q.confirmation_status) where.confirmation_status = q.confirmation_status;
  */
  // Archive (07-10-2026) — was: const where = employeeWhere(q);
  const archived = await archivedIds();
  const where = employeeWhere(q, { archived });
  const archivedSet = new Set((archived || []).map(String));

  const [rows, total, holdLeavers] = await Promise.all([
    prisma.pea_employees.findMany({
      where,
      // U6 — was: orderBy: [{ created_at: 'desc' }],
      orderBy: employeeOrder(q),
      skip: (page - 1) * limit,
      take: limit,
      include: {
        cycles: {
          orderBy: { seq_no: 'asc' },
          select: {
            id: true,
            seq_no: true,
            due_date: true,
            status: true,
            avg_rating: true,
            submitted_at: true,
            is_extension: true,
          },
        },
      },
    }),
    prisma.pea_employees.count({ where }),
    settingIsOn('hold_evaluations_for_leavers', true),
  ]);

  // U5 — the list says who Microsoft 365 thinks may have left, and whether
  // their evaluations are on hold because of it, so the "Held" filter has
  // something to show. It was: return { rows: rows.map(withProgress), total, page, limit };
  return {
    rows: rows.map((r) => {
      const flagged = mayHaveLeft(r);
      // Archive (07-10-2026) — `archived`, for the pill on a row a search found.
      return {
        ...withProgress(r),
        mayHaveLeft: flagged,
        heldAsLeaver: holdLeavers && flagged,
        archived: archivedSet.has(String(r.id)),
      };
    }),
    total,
    page,
    limit,
  };
}

/**
 * Attach a small progress summary — what HR scanned the sheet for at a glance.
 * @param {object} employee
 * @returns {object}
 */
function withProgress(employee) {
  const cycles = employee.cycles || [];
  const completed = cycles.filter((c) => c.status === 'completed').length;
  const today = new Date();

  return {
    ...employee,
    progress: {
      total: cycles.length,
      completed,
      pending: cycles.filter((c) => c.status === 'pending').length,
      awaitingResponse: cycles.filter((c) => c.status === 'email_sent' || c.status === 'opened').length,
      // Due and still nobody has been asked — the failure the old system could
      // not surface at all.
      overdue: cycles.filter((c) => c.status === 'pending' && c.due_date < today).length,
      nextDue: cycles.find((c) => c.status === 'pending')?.due_date ?? null,
    },
  };
}

/**
 * One employee with full cycle and score detail.
 * @param {bigint|number} id
 * @returns {Promise<object>}
 */
export async function getEmployee(id) {
  const employee = await prisma.pea_employees.findUnique({
    where: { id: BigInt(id) },
    include: {
      cycles: {
        orderBy: { seq_no: 'asc' },
        include: { scores: { orderBy: { sort_order: 'asc' } } },
      },
      // U12 — the page shows the latest 20 and offers "Show all", so it needs
      // more than the 50 this used to stop at.
      // audit: { orderBy: { changed_at: 'desc' }, take: 50 },
      audit: { orderBy: { changed_at: 'desc' }, take: 500 },
    },
  });

  if (!employee) throw new AppError('Commando not found', 404);

  const snapshot = await azureSnapshot(employee.id);

  // R-02 — the detail screen needs these to decide whether to offer a manual
  // pause and whether to explain an automatic hold. Carried on the employee
  // response rather than read from /settings, which needs the settings module:
  // an HR user without it must still see why evaluations have stopped.
  const [pauseSetting, holdSetting] = await Promise.all([
    prisma.pea_settings.findUnique({ where: { setting_key: 'manual_pause_enabled' } }),
    prisma.pea_settings.findUnique({ where: { setting_key: 'hold_evaluations_for_leavers' } }),
  ]);
  const isOn = (row, fallback) =>
    row?.setting_value === undefined || row?.setting_value === null
      ? fallback
      : String(row.setting_value).trim().toLowerCase() === 'true';

  const holdLeavers = isOn(holdSetting, true);
  const dismissed =
    employee.leaver_dismissed_at && employee.leaver_flagged_at
      ? employee.leaver_dismissed_at >= employee.leaver_flagged_at
      : false;

  // U13 / M7 / B5 — who each evaluation's link went to, who answered it, and
  // whether HR typed it in. Merged onto the cycles the page already shows.
  const people = await cyclePeople(employee.id);
  employee.cycles = employee.cycles.map((c) => ({ ...c, ...(people.get(String(c.id)) || {}) }));

  return {
    ...withProgress(employee),
    // U11 / U10 — when the probation ends, what may still be decided, and the
    // reason and date HR gave for the last decision or exit.
    probation: probationSummary(employee, employee.cycles, todayIn(config.scheduler.timezone)),
    record: await decisionRecord(employee.id),
    // Archive (07-10-2026) — whether the archive exists here, and this person's
    // record in it. An archived Commando's page is read-only, with Restore.
    archive: await archiveInfo(employee.id),
    evaluationHold: {
      manualPauseEnabled: isOn(pauseSetting, false),
      holdLeaversEnabled: holdLeavers,
      // True when evaluations have stopped on their own, with nothing for HR to
      // have done — the state the employee page has to be able to explain.
      heldAsLeaver: holdLeavers && !!employee.leaver_flagged_at && !dismissed,
      leaverFlaggedAt: employee.leaver_flagged_at,
      leaverDismissedAt: employee.leaver_dismissed_at,
    },
    // Per-field Azure provenance for the detail screen: where the value came
    // from, whether HR has locked it, and whether Entra currently disagrees.
    azure: {
      linked: !!employee.azure_user_id,
      snapshotAvailable: snapshot !== null,
      fields: Object.fromEntries(
        LOCKABLE_FIELDS.map((f) => {
          const azureValue = f === 'full_name' ? snapshot?.azure_display_name : snapshot?.azure_mail;
          const ours = f === 'office_email' ? normEmail(employee[f]) : employee[f];
          const theirs = f === 'office_email' ? normEmail(azureValue) : azureValue?.replace(/\s+/g, ' ').trim();
          return [
            f,
            {
              label: FIELD_LABELS[f],
              locked: (employee.locked_fields || []).includes(f),
              azureValue: azureValue ?? null,
              differs: !!theirs && theirs !== ours,
            },
          ];
        })
      ),
    },
  };
}

/**
 * The reason and date recorded with the last decision and with an exit, or
 * null when the 2026-10-02 DDL is not applied here yet. Raw SQL on purpose —
 * the columns are newer than the Prisma model.
 * @param {bigint} employeeId
 * @returns {Promise<object|null>}
 */
async function decisionRecord(employeeId) {
  if (!(await hasDecisionColumns())) return null;
  const [row] = await prisma.$queryRaw`
    SELECT decision_on, decision_reason, decision_by, left_on, left_reason
      FROM pea_employees WHERE id = ${BigInt(employeeId)}`;
  if (!row) return null;
  return {
    decisionOn: row.decision_on ? toDateString(row.decision_on) : null,
    decisionReason: row.decision_reason,
    decisionBy: row.decision_by,
    leftOn: row.left_on ? toDateString(row.left_on) : null,
    leftReason: row.left_reason,
  };
}

/**
 * Per evaluation: who the link went to, who answered, whether an acting
 * manager had it, and whether HR entered it. Empty until the 2026-10-02 DDL is
 * applied. Raw SQL on purpose — the columns are newer than the Prisma model.
 * @param {bigint} employeeId
 * @returns {Promise<Map<string, object>>} by cycle id
 */
async function cyclePeople(employeeId) {
  if (!(await hasRecipientColumns())) return new Map();
  const rows = await prisma.$queryRaw`
    SELECT id::text AS id, sent_to_name, sent_to_email, submitted_by_name, delegated, entered_by
      FROM pea_evaluation_cycles WHERE employee_id = ${BigInt(employeeId)}`;
  return new Map(rows.map(({ id, ...rest }) => [id, rest]));
}

/** Only real, lockable field names survive — anything else in a request is ignored. */
function pickLockable(value) {
  const arr = Array.isArray(value) ? value : value ? [value] : [];
  return arr.map(String).filter((f) => LOCKABLE_FIELDS.includes(f));
}

/**
 * Entra's last-seen values for an employee, or null when the 2026-09-13 DDL is
 * not applied here yet. Raw SQL on purpose — see the note in schema.prisma.
 * @param {bigint} employeeId
 * @returns {Promise<{azure_display_name: string|null, azure_mail: string|null}|null>}
 */
async function azureSnapshot(employeeId) {
  if (!(await hasPhase2Features())) return null;
  const [row] = await prisma.$queryRaw`
    SELECT azure_display_name, azure_mail FROM pea_employees WHERE id = ${BigInt(employeeId)}`;
  return row || null;
}

/**
 * "Report to IT" — Entra holds a wrong value. Plan §6.5 Part 3.
 *
 * Fixing a value only in PEA leaves every other Microsoft-connected system
 * wrong, so this sends IT the field, what Entra holds and what is correct.
 *
 * Server-side on purpose rather than a mailto: link. A mailto opens the user's
 * own Outlook and would reach the real IT team from staging; going through
 * queueEmail means the non-production redirect applies like every other send.
 *
 * @param {bigint|number|string} id
 * @param {{field: string, correct_value: string, note?: string}} input
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function reportToIt(id, input, actor) {
  const employeeId = BigInt(id);
  const employee = await prisma.pea_employees.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError('Commando not found', 404);
  await assertNotArchived(employeeId, employee.full_name); // Archive (07-10-2026)

  const field = String(input.field || '');
  if (!LOCKABLE_FIELDS.includes(field)) {
    throw new AppError(`Only values that come from Microsoft 365 can be reported: ${LOCKABLE_FIELDS.join(', ')}`, 400);
  }

  const correct = String(input.correct_value || '').trim();
  if (!correct) throw new AppError('Say what the correct value is', 400);

  const snapshot = await azureSnapshot(employeeId);
  const azureValue =
    (field === 'full_name' ? snapshot?.azure_display_name : snapshot?.azure_mail) ?? input.azure_value ?? null;

  // In production an empty IT list would resolve to no recipients and fail
  // quietly in the log. Say so up front instead. Outside production the
  // redirect supplies the test inbox, so this cannot block testing.
  if (!config.email.redirectInNonProd) {
    const row = await prisma.pea_settings.findUnique({ where: { setting_key: 'it_report_emails' } });
    if (!String(row?.setting_value || '').trim()) {
      throw new AppError('No IT address is configured. Set it_report_emails in settings first.', 400);
    }
  }

  const result = await queueEmail({
    type: 'it_report',
    employeeId,
    context: {
      employeeName: employee.full_name,
      accountEmail: snapshot?.azure_mail || employee.office_email,
      fieldLabel: FIELD_LABELS[field],
      azureValue,
      correctValue: correct,
      reportedBy: actor,
      note: input.note ? String(input.note).slice(0, 2000) : null,
    },
  });

  await prisma.pea_employee_audit.create({
    data: {
      employee_id: employeeId,
      field_name: '*',
      new_value:
        `Reported to IT: ${FIELD_LABELS[field]} in Microsoft 365 is "${azureValue ?? '(blank)'}", ` +
        `should be "${correct}" (${result.status}).`,
      changed_by: actor,
      change_source: 'manual',
    },
  });

  logger.info(`Report to IT by ${actor}: ${employee.office_email} ${field} → ${result.status}`);
  return { status: result.status, redirected: result.redirected, sentTo: result.to, error: result.error };
}

/**
 * Pause or resume evaluations (the Excel "Halt_Process" column).
 * @param {bigint|number} id
 * @param {boolean} halt
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function setHalt(id, halt, actor, pastDueAction) {
  const employee = await updateEmployee(id, { halt_process: halt }, actor);

  // B5 — resuming after a long hold used to send every evaluation that fell due
  // in the meantime, all at once, the next morning. HR chooses, as when adding.
  const action = pastDueChoice(pastDueAction);
  if (halt || action === 'send_all') return employee;

  const closed = await prisma.$transaction((tx) => applyPastDue(BigInt(id), action, actor, 'manual', tx));
  if (!closed) return employee;

  return {
    ...employee,
    cycles: await prisma.pea_evaluation_cycles.findMany({
      where: { employee_id: BigInt(id) },
      orderBy: { seq_no: 'asc' },
    }),
    _meta: { ...employee._meta, pastDueClosed: closed },
  };
}

/* B5 — setHalt before the past-due choice, kept for reference:
export async function setHalt(id, halt, actor) {
  return updateEmployee(id, { halt_process: halt }, actor);
}
*/

// ── Probation decisions and exits — U10, B3, U11 ───────────────────────────
//
// Until now a decision or an exit was a dropdown inside Edit: one click could
// end a probation with no reason and no date, and "Extend for 1 month" chosen
// there saved the status but scheduled nothing (B3). They are their own actions
// now, each with a reason and a date, and an extension recorded here creates
// its evaluation exactly as one chosen on the manager's form does.

/** Statuses meaning an evaluation could still be sent or answered. */
const OPEN_CYCLE_STATUSES = ['pending', 'email_sent', 'opened'];

const isExtendDecision = (status) => !!status && status.startsWith('Extend');

/**
 * Where a probation stands against its own schedule — U11.
 *
 * Pure, so the rule is testable without a database. "Ends on" is the end of
 * the last evaluation's period, so it moves when an extension is granted.
 *
 * @param {{confirmation_status: string|null, employment_status: string}} employee
 * @param {Array<{period_to: Date|null, is_extension: boolean}>} cycles
 * @param {Date} today - UTC midnight
 * @returns {{endsOn: string|null, extensionsUsed: number, extensionsLeft: number,
 *            decisionOptions: string[], decided: boolean, daysPastEnd: number}}
 */
export function probationSummary(employee, cycles = [], today) {
  const ends = cycles
    .map((c) => toUtcMidnight(c.period_to))
    .filter(Boolean)
    .sort((a, b) => a - b)
    .at(-1) || null;

  const left = extensionsLeft(cycles);
  const decided = ENDS_PROBATION.includes(employee.confirmation_status);
  const open = !decided && employee.employment_status === 'active';

  return {
    endsOn: ends ? toDateString(ends) : null,
    extensionsUsed: MAX_EXTENSION_CYCLES - left,
    extensionsLeft: left,
    // What "Record decision" may offer — the same rule the manager's form uses.
    decisionOptions: allowedDecisions(left),
    decided,
    // Past the end with no final decision: the page says so in red.
    daysPastEnd: open && ends ? Math.max(0, daysBetween(ends, today)) : 0,
  };
}

/**
 * A date HR typed for a decision or an exit: today when blank, never in the
 * future.
 * @param {string|undefined} value - 'YYYY-MM-DD'
 * @param {string} what - for the error message
 * @returns {Date} UTC midnight
 */
function recordedDate(value, what) {
  const today = todayIn(config.scheduler.timezone);
  if (value === undefined || value === null || value === '') return today;
  const d = toUtcMidnight(value);
  if (!d) throw new AppError(`Invalid ${what}: "${value}". Use YYYY-MM-DD.`, 400);
  if (d > today) throw new AppError(`The ${what} cannot be in the future.`, 400);
  return d;
}

/**
 * HR records a probation decision — U10, and the fix for B3.
 *
 *   Confirmed / Not Confirmed   ends the probation; open evaluations are closed
 *   Extend for 1 / 2 months     schedules the extension evaluation(s), under the
 *                               same 8-month limit as the manager's form
 *   (blank)                     back to "In probation"; an extension evaluation
 *                               nobody has been sent yet is withdrawn with it
 *
 * A reason is required for everything except a plain confirmation — the same
 * rule the manager's form applies.
 *
 * @param {bigint|number|string} id
 * @param {{decision?: string|null, reason?: string, date?: string}} input
 * @param {string} actor
 * @returns {Promise<object>} the employee, with `_meta`
 */
export async function recordDecision(id, input = {}, actor) {
  const employeeId = BigInt(id);
  const employee = await prisma.pea_employees.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError('Commando not found', 404);
  await assertNotArchived(employeeId, employee.full_name); // Archive (07-10-2026)
  if (employee.employment_status !== 'active') {
    throw new AppError(`${employee.full_name} is marked as having left. Mark them as active again before recording a decision.`, 409);
  }

  const decision = String(input.decision || '').trim() || null;
  const reason = String(input.reason || '').trim();
  const on = recordedDate(input.date, 'decision date');

  if (decision && !CONFIRMATION_STATUSES.includes(decision)) {
    throw new AppError(`Invalid decision "${decision}". Must be one of: ${CONFIRMATION_STATUSES.join(', ')}`, 400);
  }
  if (!decision && !employee.confirmation_status) {
    throw new AppError(`${employee.full_name} has no decision recorded, so there is nothing to clear.`, 400);
  }
  if (decision !== 'Confirmed' && !reason) {
    throw new AppError(
      decision ? `Give a reason for "${decision}" — it goes on the record.` : 'Say why the decision is being cleared.',
      400
    );
  }
  if (reason.length > REASON_MAX) {
    throw new AppError(`The reason is ${reason.length} characters; the limit is ${REASON_MAX}.`, 400);
  }

  const storeColumns = await hasDecisionColumns();
  const now = new Date();

  const meta = await prisma.$transaction(async (tx) => {
    const cycles = await tx.pea_evaluation_cycles.findMany({
      where: { employee_id: employeeId },
      select: { is_extension: true },
    });
    const left = extensionsLeft(cycles);
    if (decision && !allowedDecisions(left).includes(decision)) {
      throw new AppError(
        left === 0
          ? 'This probation has already been extended to the 8-month limit, so it can only be confirmed or not confirmed.'
          : 'Only one more month of extension is available — a probation cannot run past 8 months.',
        409
      );
    }

    await tx.pea_employees.update({
      where: { id: employeeId },
      data: { confirmation_status: decision, modified_at: now },
    });

    // Raw SQL because the columns are newer than the Prisma model — see
    // prisma/ddl/2026-10-02-pea-review-round.sql.
    if (storeColumns) {
      await tx.$executeRaw`
        UPDATE pea_employees
           SET decision_on = ${decision ? toDateString(on) : null}::date,
               decision_reason = ${decision ? reason || null : null},
               decision_by = ${decision ? actor : null}
         WHERE id = ${employeeId}`;
    }

    let extensionCycles = 0;
    let closedEvaluations = 0;
    let withdrawn = 0;

    if (isExtendDecision(decision)) {
      // B3 — choosing "Extend" in Edit used to stop here, with nothing scheduled.
      extensionCycles = await generateExtensionCycles(employeeId, decision, tx);
    } else if (decision) {
      ({ count: closedEvaluations } = await tx.pea_evaluation_cycles.updateMany({
        where: { employee_id: employeeId, status: { in: OPEN_CYCLE_STATUSES } },
        data: { status: 'skipped', token_expires_at: now, modified_at: now },
      }));
    } else if (isExtendDecision(employee.confirmation_status)) {
      ({ count: withdrawn } = await tx.pea_evaluation_cycles.deleteMany({
        where: { employee_id: employeeId, is_extension: true, status: 'pending', sent_at: null },
      }));
    }

    const nextCycle = extensionCycles
      ? await tx.pea_evaluation_cycles.findFirst({
        where: { employee_id: employeeId, status: 'pending', is_extension: true },
        orderBy: { seq_no: 'asc' },
        select: { seq_no: true, due_date: true },
      })
      : null;

    const rows = [];
    if ((employee.confirmation_status || null) !== decision) {
      rows.push({
        employee_id: employeeId,
        field_name: 'confirmation_status',
        old_value: employee.confirmation_status,
        new_value: decision,
        changed_by: actor,
        change_source: 'manual',
      });
    }
    rows.push({
      employee_id: employeeId,
      field_name: '*',
      new_value:
        (decision
          ? `Decision recorded by HR: ${decision}, dated ${formatDisplay(on)}.`
          : `Decision cleared by HR on ${formatDisplay(on)} — back to in probation.`) +
        (reason ? ` Reason: ${reason}` : '') +
        (extensionCycles
          ? ` ${extensionCycles} extension evaluation(s) scheduled` +
            (nextCycle ? `, the first due ${formatDisplay(nextCycle.due_date)}.` : '.')
          : '') +
        (closedEvaluations ? ` ${closedEvaluations} open evaluation(s) closed.` : '') +
        (withdrawn ? ` ${withdrawn} extension evaluation(s) not yet sent were withdrawn.` : ''),
      changed_by: actor,
      change_source: 'manual',
    });
    await tx.pea_employee_audit.createMany({ data: rows });

    return {
      extensionCycles,
      closedEvaluations,
      withdrawn,
      nextDue: nextCycle ? toDateString(nextCycle.due_date) : null,
    };
  });

  logger.info(
    `Decision recorded by ${actor} for employee ${employeeId}: ${decision || '(cleared)'}` +
      `${meta.extensionCycles ? ` (+${meta.extensionCycles} extension cycle(s))` : ''}` +
      `${meta.closedEvaluations ? ` (${meta.closedEvaluations} open evaluation(s) closed)` : ''}`
  );

  // H8 (05-10-2026) — the bell states the probation timeline, as the emails do.
  // Read after the decision, so an extension's new end date is the one shown.
  const timeline = probationNote({ probation: await probationContext(employeeId) });
  await notifyStaff({
    type: 'decision_recorded',
    title: `${employee.full_name}: ${decision || 'decision cleared'}`,
    body:
      `Recorded by ${actor}.` +
      (reason ? ` “${reason.length > 120 ? `${reason.slice(0, 120).trimEnd()}…` : reason}”` : '') +
      (meta.extensionCycles ? ` ${meta.extensionCycles} extension evaluation(s) scheduled.` : '') +
      // Before H8 reached the bell, the body ended at the line above.
      (timeline ? ` ${timeline}.` : ''),
    link: `/employees/${employeeId}`,
    severity: decision && decision !== 'Confirmed' ? 'warning' : 'info',
  });

  return { ...(await getEmployee(employeeId)), _meta: meta };
}

/**
 * HR records that someone has left — U10.
 *
 * Their history stays; nothing more is sent. Open evaluations are closed and
 * their links expired, so an email already in a manager's inbox stops working
 * rather than merely not being re-sent. The New joiners screen's "confirm
 * exit" uses this too, so there is one way of leaving, not two.
 *
 * @param {bigint|number|string} id
 * @param {{left_on?: string, reason?: string}} input
 * @param {string} actor
 * @param {string} [source='manual'] - 'azure' when confirmed from a leaver flag
 * @returns {Promise<object>} the employee, with `evaluationsClosed`
 */
export async function markLeft(id, input = {}, actor, source = 'manual') {
  const employeeId = BigInt(id);
  const employee = await prisma.pea_employees.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError('Commando not found', 404);
  await assertNotArchived(employeeId, employee.full_name); // Archive (07-10-2026)
  if (employee.employment_status === 'left') {
    throw new AppError(`${employee.full_name} is already marked as having left.`, 409);
  }

  const reason = String(input.reason || '').trim();
  if (!reason) throw new AppError('Give the reason for leaving — it goes on the record.', 400);
  if (reason.length > REASON_MAX) {
    throw new AppError(`The reason is ${reason.length} characters; the limit is ${REASON_MAX}.`, 400);
  }
  const on = recordedDate(input.left_on, 'last working day');

  const storeColumns = await hasDecisionColumns();
  const now = new Date();

  const evaluationsClosed = await prisma.$transaction(async (tx) => {
    await tx.pea_employees.update({
      where: { id: employeeId },
      data: { employment_status: 'left', leaver_flagged_at: null, modified_at: now },
    });

    if (storeColumns) {
      await tx.$executeRaw`
        UPDATE pea_employees SET left_on = ${toDateString(on)}::date, left_reason = ${reason} WHERE id = ${employeeId}`;
    }

    // `skipped`, not `completed`: nobody rated this person, and recording a
    // submission that never happened would corrupt every average counting it.
    const { count } = await tx.pea_evaluation_cycles.updateMany({
      where: { employee_id: employeeId, status: { in: OPEN_CYCLE_STATUSES } },
      data: { status: 'skipped', token_expires_at: now, modified_at: now },
    });

    await tx.pea_employee_audit.createMany({
      data: [
        {
          employee_id: employeeId,
          field_name: 'employment_status',
          old_value: employee.employment_status,
          new_value: 'left',
          changed_by: actor,
          change_source: source,
        },
        {
          employee_id: employeeId,
          field_name: '*',
          new_value:
            `Marked as left, last working day ${formatDisplay(on)}. Reason: ${reason}` +
            (count ? ` ${count} open evaluation(s) closed and their links expired.` : ''),
          changed_by: actor,
          change_source: source,
        },
      ],
    });

    return count;
  });

  logger.info(
    `Marked as left by ${actor}: ${employee.full_name} <${employee.office_email}>` +
      `${evaluationsClosed ? ` — ${evaluationsClosed} open evaluation(s) closed and their links expired` : ''}`
  );

  return { ...(await getEmployee(employeeId)), evaluationsClosed };
}

/**
 * Undo "Mark as left" — the person is here after all. Evaluations that were
 * closed stay closed: HR re-sends the ones still wanted from the schedule, so
 * nothing goes to a manager without someone deciding it should.
 *
 * @param {bigint|number|string} id
 * @param {{reason?: string}} input
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function markActive(id, input = {}, actor) {
  const employeeId = BigInt(id);
  const employee = await prisma.pea_employees.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError('Commando not found', 404);
  await assertNotArchived(employeeId, employee.full_name); // Archive (07-10-2026)
  if (employee.employment_status !== 'left') {
    throw new AppError(`${employee.full_name} is not marked as having left.`, 409);
  }

  const reason = String(input.reason || '').trim();
  if (!reason) throw new AppError('Say why they are being marked as active again.', 400);

  const storeColumns = await hasDecisionColumns();

  await prisma.$transaction(async (tx) => {
    await tx.pea_employees.update({
      where: { id: employeeId },
      data: { employment_status: 'active', modified_at: new Date() },
    });
    if (storeColumns) {
      await tx.$executeRaw`
        UPDATE pea_employees SET left_on = NULL, left_reason = NULL WHERE id = ${employeeId}`;
    }
    await tx.pea_employee_audit.createMany({
      data: [
        {
          employee_id: employeeId,
          field_name: 'employment_status',
          old_value: 'left',
          new_value: 'active',
          changed_by: actor,
          change_source: 'manual',
        },
        {
          employee_id: employeeId,
          field_name: '*',
          new_value: `Marked as active again. Reason: ${reason} Evaluations that were closed stay closed until re-sent.`,
          changed_by: actor,
          change_source: 'manual',
        },
      ],
    });
  });

  logger.info(`Marked as active again by ${actor}: ${employee.full_name} <${employee.office_email}>`);
  return getEmployee(employeeId);
}

// ── HR notes on a Commando — L7 ────────────────────────────────────────────
//
// Somewhere to write what does not belong in an evaluation: "on medical leave
// until the 14th", "manager asked for a mentor". Read through the signed-in
// HR routes only — the Commando's own view and the manager portal never touch
// this table. Notes only: attachments wait for a decision on where files are
// stored and backed up.

/** The longest note the page and the database accept. */
export const NOTE_MAX = 4000;

const NOTES_NEED_DDL =
  'Notes need the database update of 02-10-2026 (2026-10-02-pea-review-round.sql), which has not been applied here yet.';

/**
 * A note as it is stored: line endings evened out, no blank edges, not empty
 * and not over the limit. Pure, so the rule is testable without a database.
 * @param {*} value
 * @returns {string}
 * @throws {AppError} 400
 */
export function cleanNote(value) {
  const body = String(value ?? '').replace(/\r\n?/g, '\n').trim();
  if (!body) throw new AppError('Write the note before saving it.', 400);
  if (body.length > NOTE_MAX) {
    throw new AppError(`The note is ${body.length} characters; the limit is ${NOTE_MAX}.`, 400);
  }
  return body;
}

/**
 * Who may delete a note: whoever wrote it, or an admin. Pure.
 * @param {{created_by: string}} note
 * @param {{username?: string, role?: string}} user
 * @returns {boolean}
 */
export function mayDeleteNote(note, user = {}) {
  if (isAdminTier(user.role)) return true;
  const mine = String(user.username || '').trim().toLowerCase();
  return !!mine && mine === String(note.created_by || '').trim().toLowerCase();
}

/** The employee, or a 404 — notes hang off a real person. */
/**
 * The Commando page's archive block — Archive (07-10-2026).
 * @param {bigint} id
 * @returns {Promise<{available: boolean, archived: boolean, archivedAt?: Date, archivedBy?: string|null, reason?: string|null}>}
 */
async function archiveInfo(id) {
  if (!(await hasArchiveColumns())) return { available: false, archived: false };
  const record = await archiveRecord(id);
  return record
    ? { available: true, archived: true, archivedAt: record.archived_at, archivedBy: record.archived_by, reason: record.archive_reason }
    : { available: true, archived: false };
}

async function noteOwner(id) {
  const employee = await prisma.pea_employees.findUnique({
    where: { id: BigInt(id) },
    select: { id: true, full_name: true },
  });
  if (!employee) throw new AppError('Commando not found', 404);
  return employee;
}

/**
 * HR's notes on one Commando, newest first.
 *
 * `available` is false until the 2026-10-02 DDL is applied, and the page then
 * shows no Notes card. Raw SQL on purpose — the table is newer than the Prisma
 * model.
 *
 * @param {bigint|number|string} id
 * @param {{username?: string, role?: string}} user - decides `can_delete`
 * @returns {Promise<{available: boolean, max: number, notes: object[]}>}
 */
export async function listNotes(id, user = {}) {
  const employee = await noteOwner(id);
  if (!(await hasEmployeeNotes())) return { available: false, max: NOTE_MAX, notes: [] };

  const rows = await prisma.$queryRaw`
    SELECT id::text AS id, body, created_by, created_at
      FROM pea_employee_notes
     WHERE employee_id = ${employee.id}
     ORDER BY created_at DESC, id DESC`;

  return {
    available: true,
    max: NOTE_MAX,
    notes: rows.map((n) => ({ ...n, can_delete: mayDeleteNote(n, user) })),
  };
}

/**
 * Add a note.
 * @param {bigint|number|string} id
 * @param {{body?: string}} input
 * @param {string} actor
 * @returns {Promise<object>} the note
 */
export async function addNote(id, input = {}, actor) {
  const employee = await noteOwner(id);
  await assertNotArchived(id, employee.full_name); // Archive (07-10-2026)
  if (!(await hasEmployeeNotes())) throw new AppError(NOTES_NEED_DDL, 503);

  const body = cleanNote(input.body);

  const [note] = await prisma.$queryRaw`
    INSERT INTO pea_employee_notes (employee_id, body, created_by)
    VALUES (${employee.id}, ${body}, ${actor})
    RETURNING id::text AS id, body, created_by, created_at`;

  logger.info(`Note added by ${actor} on ${employee.full_name} (employee ${employee.id}, ${body.length} characters)`);
  return { ...note, can_delete: true };
}

/**
 * Delete a note. Whoever wrote it may, and so may an admin. That a note was
 * deleted — not what it said — goes into the change history, so a record never
 * disappears without trace.
 *
 * @param {bigint|number|string} id - the employee
 * @param {bigint|number|string} noteId
 * @param {{username: string, role: string}} user
 * @returns {Promise<{id: string}>}
 */
export async function deleteNote(id, noteId, user) {
  const employee = await noteOwner(id);
  await assertNotArchived(id, employee.full_name); // Archive (07-10-2026)
  if (!(await hasEmployeeNotes())) throw new AppError(NOTES_NEED_DDL, 503);

  if (!/^\d+$/.test(String(noteId))) throw new AppError('Note not found', 404);

  const [note] = await prisma.$queryRaw`
    SELECT id, created_by, created_at
      FROM pea_employee_notes
     WHERE id = ${BigInt(noteId)} AND employee_id = ${employee.id}`;
  if (!note) throw new AppError('Note not found', 404);

  if (!mayDeleteNote(note, user)) {
    throw new AppError(`Only ${note.created_by}, who wrote this note, or an admin can delete it.`, 403);
  }

  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM pea_employee_notes WHERE id = ${note.id}`,
    prisma.pea_employee_audit.create({
      data: {
        employee_id: employee.id,
        field_name: '*',
        new_value:
          `A note written by ${note.created_by} on ` +
          `${formatDisplay(dateIn(note.created_at, config.scheduler.timezone))} was deleted.`,
        changed_by: user.username,
        change_source: 'manual',
      },
    }),
  ]);

  logger.info(`Note ${note.id} on ${employee.full_name} deleted by ${user.username}`);
  return { id: String(note.id) };
}

const normName = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The typed name must match the employee's, so a misclick can never delete a
 * record. Pure, so the rule is testable without a database.
 * @param {{full_name: string}} employee
 * @param {string} typedName
 * @throws {AppError} 400
 */
export function assertDeleteConfirmed(employee, typedName) {
  if (!normName(typedName) || normName(typedName) !== normName(employee.full_name)) {
    throw new AppError(`To delete, type the Commando's full name exactly: "${employee.full_name}".`, 400);
  }
}

/**
 * Delete an employee permanently — for demo and test records (HR decision,
 * 13 Sep). Someone who really left is marked "left" instead, which keeps
 * their history.
 *
 * Evaluations, ratings and change history go with the employee (ON DELETE
 * CASCADE). The email log and the joiner inbox keep their rows, unlinked
 * (ON DELETE SET NULL). The change history is deleted too, so the record of
 * the deletion itself is the log line and the admins' bell.
 *
 * @param {bigint|number|string} id
 * @param {string} typedName
 * @param {string} actor
 * @returns {Promise<{id: string, full_name: string, cycles: number}>}
 */
export async function deleteEmployee(id, typedName, actor) {
  const employeeId = BigInt(id);
  const employee = await prisma.pea_employees.findUnique({ where: { id: employeeId } });
  if (!employee) throw new AppError('Commando not found', 404);

  assertDeleteConfirmed(employee, typedName);

  const cycles = await prisma.pea_evaluation_cycles.count({ where: { employee_id: employeeId } });
  await prisma.pea_employees.delete({ where: { id: employeeId } });

  logger.warn(
    `🗑️ Employee deleted by ${actor}: ${employee.full_name} <${employee.office_email}> ` +
      `(id ${employeeId}, ${cycles} evaluation(s))`
  );

  await notifyStaff({
    type: 'employee_deleted',
    title: `Commando deleted — ${employee.full_name}`,
    body: `By ${actor}. ${employee.office_email}, ${cycles} evaluation(s) removed.`,
    link: '/employees',
    severity: 'warning',
    roles: ['superadmin', 'admin'],
  });

  return { id: String(employeeId), full_name: employee.full_name, cycles };
}
