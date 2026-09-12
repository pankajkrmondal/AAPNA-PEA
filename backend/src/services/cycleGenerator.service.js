/**
 * cycleGenerator.service.js — turns a joining date into an evaluation schedule.
 *
 * This is the rule the whole product exists to run, reverse-engineered from
 * `PEA - Sending Evaluation Form Link Flow V2`:
 *
 *   Fresher      evaluation N due at DOJ + 30×N days, N = 1..6   (6 months)
 *   Experienced  evaluation N due at DOJ + 60×N days, N = 1..3   (6 months)
 *
 * Each evaluation covers the period since the previous one, which is what the
 * email tells the manager they are rating.
 *
 * Extensions are NOT generated up front — they only exist once a manager
 * actually chooses "Extend" on the final cycle:
 *
 *   Extend for 1 month   → one extra evaluation at DOJ + 210 days
 *   Extend for 2 months  → extras at DOJ + 210 and DOJ + 240 days
 *
 * ── Why this is generated into a table rather than computed on the fly ──────
 *
 * The original matched an EXACT elapsed-day count (`dateDifference(...) == 30`)
 * at 11:00 each day. That fires on precisely one day: if the run failed, was
 * throttled, or the DOJ cell was text instead of a date, the evaluation was
 * skipped permanently and silently. Nobody found out until a manager asked why
 * they were never sent a form.
 *
 * Materialising the schedule means the sweep can ask `due_date <= today AND
 * status = 'pending'`, which catches up automatically after any outage. It also
 * makes the whole plan visible in the database before a single email is sent.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import { addDays, shiftOffWeekend, toUtcMidnight, toDateString } from '../utils/dateUtils.js';

/** Cadence per employee type. Mirrors pea_settings, kept here as the fallback. */
export const CADENCE = Object.freeze({
  fresher: { intervalDays: 30, cycles: 6 },
  experienced: { intervalDays: 60, cycles: 3 },
});

/** Extension offsets in days from DOJ, as used by the original flow. */
export const EXTENSION_DAYS = Object.freeze({
  'Extend for 1 month': [210],
  'Extend for 2 months': [210, 240],
});

/**
 * Build the base evaluation schedule for an employee.
 *
 * Pure function — no database access — so the rule can be unit-tested and
 * previewed in the UI before anything is written.
 *
 * @param {{ doj: Date|string, is_experienced: boolean }} employee
 * @returns {Array<{seq_no: number, due_date: Date, period_from: Date, period_to: Date, is_extension: boolean}>}
 */
export function buildSchedule({ doj, is_experienced }) {
  const start = toUtcMidnight(doj);
  if (!start) throw new Error(`Invalid date of joining: ${doj}`);

  const { intervalDays, cycles } = is_experienced ? CADENCE.experienced : CADENCE.fresher;
  const schedule = [];

  for (let n = 1; n <= cycles; n++) {
    const periodFrom = addDays(start, intervalDays * (n - 1));
    const periodTo = addDays(start, intervalDays * n);

    schedule.push({
      seq_no: n,
      // The period end is when the evaluation becomes due; shifted off weekends
      // so the stored date is the day the email actually goes out.
      due_date: shiftOffWeekend(periodTo),
      period_from: periodFrom,
      period_to: periodTo,
      is_extension: false,
    });
  }

  return schedule;
}

/**
 * Build the extra cycles for an extension decision.
 *
 * @param {{ doj: Date|string }} employee
 * @param {string} confirmationStatus - 'Extend for 1 month' | 'Extend for 2 months'
 * @param {number} lastSeqNo - highest seq_no already used
 * @returns {Array<object>} same shape as buildSchedule(), or [] if not an extension
 */
export function buildExtensionSchedule({ doj }, confirmationStatus, lastSeqNo) {
  const offsets = EXTENSION_DAYS[confirmationStatus];
  if (!offsets) return [];

  const start = toUtcMidnight(doj);
  if (!start) throw new Error(`Invalid date of joining: ${doj}`);

  return offsets.map((days, i) => {
    const periodTo = addDays(start, days);
    return {
      seq_no: lastSeqNo + i + 1,
      due_date: shiftOffWeekend(periodTo),
      // An extension period runs from the previous milestone: the first extra
      // covers month 6→7 (180→210), the second 7→8 (210→240).
      period_from: addDays(start, days - 30),
      period_to: periodTo,
      is_extension: true,
    };
  });
}

/**
 * Create the base cycles for an employee in the database.
 *
 * Idempotent: skips any seq_no that already exists, so re-running an import or
 * re-saving an employee never duplicates a schedule or resets a submitted one.
 *
 * @param {bigint|number} employeeId
 * @param {{ doj: Date|string, is_experienced: boolean }} employee
 * @param {object} [tx] - optional Prisma transaction client
 * @returns {Promise<number>} cycles created
 */
export async function generateCycles(employeeId, employee, tx = prisma) {
  const schedule = buildSchedule(employee);

  const existing = await tx.pea_evaluation_cycles.findMany({
    where: { employee_id: employeeId },
    select: { seq_no: true },
  });
  const taken = new Set(existing.map((c) => c.seq_no));

  const toCreate = schedule.filter((c) => !taken.has(c.seq_no));
  if (toCreate.length === 0) return 0;

  await tx.pea_evaluation_cycles.createMany({
    data: toCreate.map((c) => ({ ...c, employee_id: employeeId })),
  });

  return toCreate.length;
}

/**
 * Create extension cycles after a manager chooses "Extend …".
 *
 * Called from the evaluation submit path (Day 3), not from the importer:
 * an extension is a decision, not a property of the joining date.
 *
 * @param {bigint|number} employeeId
 * @param {string} confirmationStatus
 * @param {object} [tx]
 * @returns {Promise<number>} cycles created
 */
export async function generateExtensionCycles(employeeId, confirmationStatus, tx = prisma) {
  const employee = await tx.pea_employees.findUnique({ where: { id: employeeId } });
  if (!employee) throw new Error(`Employee ${employeeId} not found`);

  const existing = await tx.pea_evaluation_cycles.findMany({
    where: { employee_id: employeeId },
    select: { seq_no: true },
  });
  const lastSeq = existing.length ? Math.max(...existing.map((c) => c.seq_no)) : 0;
  const taken = new Set(existing.map((c) => c.seq_no));

  const extras = buildExtensionSchedule(employee, confirmationStatus, lastSeq).filter(
    (c) => !taken.has(c.seq_no) && c.seq_no <= 8 // the sheet only ever had 8 columns
  );

  if (extras.length === 0) return 0;

  await tx.pea_evaluation_cycles.createMany({
    data: extras.map((c) => ({ ...c, employee_id: employeeId })),
  });

  logger.info(
    `Extension: ${extras.length} extra cycle(s) for employee ${employeeId} (${confirmationStatus}) — ` +
      `due ${extras.map((c) => toDateString(c.due_date)).join(', ')}`
  );

  return extras.length;
}

/**
 * Recompute future cycles after a DOJ or fresher/experienced correction.
 *
 * Only untouched cycles are moved. A cycle that has been sent, opened or
 * submitted keeps its dates: a manager's submitted rating belongs to the period
 * they were actually shown, and silently re-dating it would rewrite history.
 *
 * @param {bigint|number} employeeId
 * @param {object} [tx]
 * @returns {Promise<{updated: number, created: number, skipped: number}>}
 */
export async function regenerateCycles(employeeId, tx = prisma) {
  const employee = await tx.pea_employees.findUnique({ where: { id: employeeId } });
  if (!employee) throw new Error(`Employee ${employeeId} not found`);

  const schedule = buildSchedule(employee);
  const existing = await tx.pea_evaluation_cycles.findMany({
    where: { employee_id: employeeId },
  });
  const bySeq = new Map(existing.map((c) => [c.seq_no, c]));

  let updated = 0;
  let created = 0;
  let skipped = 0;

  for (const target of schedule) {
    const current = bySeq.get(target.seq_no);

    if (!current) {
      await tx.pea_evaluation_cycles.create({
        data: { ...target, employee_id: employeeId },
      });
      created += 1;
      continue;
    }

    if (current.status !== 'pending') {
      skipped += 1;
      continue;
    }

    await tx.pea_evaluation_cycles.update({
      where: { id: current.id },
      data: {
        due_date: target.due_date,
        period_from: target.period_from,
        period_to: target.period_to,
        modified_at: new Date(),
      },
    });
    updated += 1;
  }

  // A fresher→experienced correction leaves cycles 4-6 orphaned. Remove only
  // untouched ones; anything already sent stays for the audit trail.
  const validSeqs = new Set(schedule.map((c) => c.seq_no));
  const orphans = existing.filter(
    (c) => !validSeqs.has(c.seq_no) && !c.is_extension && c.status === 'pending'
  );
  if (orphans.length) {
    await tx.pea_evaluation_cycles.deleteMany({
      where: { id: { in: orphans.map((c) => c.id) } },
    });
    logger.info(`Removed ${orphans.length} now-invalid pending cycle(s) for employee ${employeeId}`);
  }

  return { updated, created, skipped };
}
