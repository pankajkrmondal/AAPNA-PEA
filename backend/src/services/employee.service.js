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
import { generateCycles, regenerateCycles } from './cycleGenerator.service.js';
import { queueEmail } from './notification.service.js';
import { notifyStaff } from './inAppNotification.service.js';
import { hasPhase2Features } from '../utils/schemaCapabilities.js';
import { toUtcMidnight, toDateString } from '../utils/dateUtils.js';

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

/**
 * Create an employee and generate their evaluation schedule.
 * @param {object} input
 * @param {string} actor - username for the audit trail
 * @param {string} [source='manual']
 * @returns {Promise<object>} the employee, with cycles
 */
export async function createEmployee(input, actor, source = 'manual') {
  const data = sanitize(input, true);

  const clash = await findByOfficeEmail(data.office_email);
  if (clash) {
    throw new AppError(`An employee with office email ${data.office_email} already exists`, 409);
  }

  return prisma.$transaction(async (tx) => {
    const employee = await tx.pea_employees.create({ data: { ...data, source } });

    const created = await generateCycles(employee.id, employee, tx);
    await recordChanges(employee.id, {}, data, actor, source, tx);

    logger.info(
      `Employee created: ${employee.full_name} <${employee.office_email}> ` +
        `(${employee.is_experienced ? 'experienced' : 'fresher'}, DOJ ${toDateString(employee.doj)}) ` +
        `— ${created} evaluation cycles generated`
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
  if (!before) throw new AppError('Employee not found', 404);

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
      throw new AppError(`An employee with office email ${data.office_email} already exists`, 409);
    }
  }

  const reschedule = SCHEDULE_FIELDS.some(
    (f) =>
      data[f] !== undefined &&
      String(f === 'doj' ? toDateString(data.doj) : data[f]) !==
        String(f === 'doj' ? toDateString(before.doj) : before[f])
  );

  return prisma.$transaction(async (tx) => {
    await tx.pea_employees.update({
      where: { id: employeeId },
      data: { ...data, modified_at: new Date() },
    });

    const changes = await recordChanges(employeeId, before, data, actor, source, tx);

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

    return { ...fresh, _meta: { auditedChanges: changes, rescheduled } };
  });
}

/**
 * List employees with search, filters and pagination.
 * @param {object} q
 * @returns {Promise<{rows: object[], total: number}>}
 */
export async function listEmployees(q = {}) {
  const page = Math.max(1, parseInt(q.page || '1', 10));
  const limit = Math.min(200, Math.max(1, parseInt(q.limit || '25', 10)));

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

  const [rows, total] = await Promise.all([
    prisma.pea_employees.findMany({
      where,
      orderBy: [{ created_at: 'desc' }],
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
  ]);

  return { rows: rows.map(withProgress), total, page, limit };
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
      audit: { orderBy: { changed_at: 'desc' }, take: 50 },
    },
  });

  if (!employee) throw new AppError('Employee not found', 404);

  const snapshot = await azureSnapshot(employee.id);

  return {
    ...withProgress(employee),
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
  if (!employee) throw new AppError('Employee not found', 404);

  const field = String(input.field || '');
  if (!LOCKABLE_FIELDS.includes(field)) {
    throw new AppError(`Only Entra-sourced fields can be reported: ${LOCKABLE_FIELDS.join(', ')}`, 400);
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
        `Reported to IT: ${FIELD_LABELS[field]} in Entra is "${azureValue ?? '(blank)'}", ` +
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
export async function setHalt(id, halt, actor) {
  return updateEmployee(id, { halt_process: halt }, actor);
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
    throw new AppError(`To delete, type the employee's full name exactly: "${employee.full_name}".`, 400);
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
  if (!employee) throw new AppError('Employee not found', 404);

  assertDeleteConfirmed(employee, typedName);

  const cycles = await prisma.pea_evaluation_cycles.count({ where: { employee_id: employeeId } });
  await prisma.pea_employees.delete({ where: { id: employeeId } });

  logger.warn(
    `🗑️ Employee deleted by ${actor}: ${employee.full_name} <${employee.office_email}> ` +
      `(id ${employeeId}, ${cycles} evaluation(s))`
  );

  await notifyStaff({
    type: 'employee_deleted',
    title: `Employee deleted — ${employee.full_name}`,
    body: `By ${actor}. ${employee.office_email}, ${cycles} evaluation(s) removed.`,
    link: '/employees',
    severity: 'warning',
    roles: ['superadmin', 'admin'],
  });

  return { id: String(employeeId), full_name: employee.full_name, cycles };
}
