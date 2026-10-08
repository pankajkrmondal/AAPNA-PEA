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
 * Extensions are NOT generated up front — they only exist once someone
 * actually chooses "Extend" on the final evaluation (the manager on the form,
 * or HR with "Record decision"):
 *
 *   Extend for 1 month   → one more evaluation, 30 days after the last one
 *   Extend for 2 months  → two more, 30 and 60 days after the last one
 *
 * ── The extension rule (HR, review points B1 / B2 / M2, 01-10-2026) ─────────
 *
 *   · Nobody's probation runs past 8 months. That is at most TWO extension
 *     evaluations per person, ever:
 *
 *       Fresher      6 evaluations + a 7th and an 8th
 *       Experienced  3 evaluations + a 4th and a 5th
 *
 *   · An extension evaluation covers the 30 days after the previous
 *     evaluation's period ended. It is dated from there — not from a fixed
 *     number of days after joining. Dating from joining is what made a second
 *     extension land on day 210 again: already past, mailed the next morning,
 *     and covering a month that had been rated once already (B1).
 *
 *   · What the final evaluation may offer follows from what is left:
 *
 *       extension evaluations already scheduled    the decision offers
 *       0                                          Confirm · Not confirm · Extend 1 · Extend 2
 *       1                                          Confirm · Not confirm · Extend 1
 *       2                                          Confirm · Not confirm
 *
 *     Asking for more than is left is refused, loudly. Before, anything past
 *     evaluation 8 was dropped in silence, which left someone "Extended" with
 *     no evaluation scheduled and a manager told a link was on its way (B2).
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
import AppError from '../utils/AppError.js';
import { addDays, shiftOffWeekend, toUtcMidnight, toDateString } from '../utils/dateUtils.js';

/** Cadence per employee type. Mirrors pea_settings, kept here as the fallback. */
export const CADENCE = Object.freeze({
  fresher: { intervalDays: 30, cycles: 6 },
  experienced: { intervalDays: 60, cycles: 3 },
});

/* B1 / M2 — replaced, kept for reference. Extensions were fixed offsets from
   the joining date, as the original flow had them:

export const EXTENSION_DAYS = Object.freeze({
  'Extend for 1 month': [210],
  'Extend for 2 months': [210, 240],
});
*/

/** How many extension evaluations each "Extend" decision adds. */
export const EXTENSION_MONTHS = Object.freeze({
  'Extend for 1 month': 1,
  'Extend for 2 months': 2,
});

/** An extension evaluation covers this many days, on either track. */
export const EXTENSION_INTERVAL_DAYS = 30;

/** No probation runs past 8 months: two extension evaluations at most. */
export const MAX_EXTENSION_CYCLES = 2;

/**
 * How many extension evaluations this person may still be given.
 * @param {Array<{is_extension: boolean}>} cycles - every cycle the employee has
 * @returns {number} 0, 1 or 2
 */
export function extensionsLeft(cycles = []) {
  const used = cycles.filter((c) => c.is_extension).length;
  return Math.max(0, MAX_EXTENSION_CYCLES - used);
}

/**
 * The decisions the final evaluation may offer, given what is left. Used by the
 * manager's form, by "Record decision" in the app, and by both when they
 * validate what comes back — so the three can never disagree.
 *
 * @param {number} left - from extensionsLeft()
 * @returns {string[]} confirmation_status values, in the order they are shown
 */
export function allowedDecisions(left) {
  return [
    'Confirmed',
    'Not Confirmed',
    ...Object.keys(EXTENSION_MONTHS).filter((status) => EXTENSION_MONTHS[status] <= left),
  ];
}

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
 * Pure — it does not know or check how many extensions are left. That is
 * generateExtensionCycles()'s job; this only works out the dates.
 *
 * Anchored on the period END of the last evaluation, not its due date: the due
 * date may have been moved off a weekend, and carrying that shift forward would
 * make every later period drift by a day or two.
 *
 * @param {{seq_no: number, period_to?: Date|string|null, due_date?: Date|string}} lastCycle
 *   the employee's highest-numbered evaluation
 * @param {string} confirmationStatus - 'Extend for 1 month' | 'Extend for 2 months'
 * @returns {Array<object>} same shape as buildSchedule(), or [] if not an extension
 */
export function buildExtensionSchedule(lastCycle, confirmationStatus) {
  const count = EXTENSION_MONTHS[confirmationStatus];
  if (!count) return [];

  const anchor = toUtcMidnight(lastCycle?.period_to || lastCycle?.due_date);
  if (!anchor) throw new Error('Cannot date an extension: the last evaluation has no period end');

  return Array.from({ length: count }, (_, i) => {
    const periodTo = addDays(anchor, EXTENSION_INTERVAL_DAYS * (i + 1));
    return {
      seq_no: lastCycle.seq_no + i + 1,
      due_date: shiftOffWeekend(periodTo),
      // Each one picks up where the one before stopped: after a fresher's
      // evaluation 6 that is month 6→7, then 7→8.
      period_from: addDays(anchor, EXTENSION_INTERVAL_DAYS * i),
      period_to: periodTo,
      is_extension: true,
    };
  });
}

/* B1 / M2 — replaced, kept for reference. Dated every extension from the
   joining date, so a second extension repeated day 210:

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
*/

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
 * Create extension cycles after someone chooses "Extend …".
 *
 * Called from the evaluation submit path and from HR's "Record decision", not
 * from the importer: an extension is a decision, not a property of the joining
 * date.
 *
 * Refuses, rather than quietly creating fewer, when the decision asks for more
 * extension evaluations than this person has left. Both callers offer only what
 * is allowed, so reaching the refusal means a stale form or a hand-made request.
 *
 * @param {bigint|number} employeeId
 * @param {string} confirmationStatus
 * @param {object} [tx]
 * @returns {Promise<number>} cycles created
 * @throws {AppError} 409 when the 8-month limit would be passed
 */
export async function generateExtensionCycles(employeeId, confirmationStatus, tx = prisma) {
  const wanted = EXTENSION_MONTHS[confirmationStatus] || 0;
  if (!wanted) return 0;

  const existing = await tx.pea_evaluation_cycles.findMany({
    where: { employee_id: employeeId },
    select: { seq_no: true, is_extension: true, period_to: true, due_date: true },
    orderBy: { seq_no: 'asc' },
  });
  if (existing.length === 0) throw new Error(`Employee ${employeeId} has no evaluations to extend from`);

  const left = extensionsLeft(existing);
  if (wanted > left) {
    throw new AppError(
      left === 0
        ? 'This probation has already been extended to the 8-month limit, so it can only be confirmed or not confirmed.'
        : 'Only one more month of extension is available — a probation cannot run past 8 months.',
      409
    );
  }

  const extras = buildExtensionSchedule(existing.at(-1), confirmationStatus);

  /* B2 / M2 — replaced, kept for reference. The old code dated the extras from
     the joining date and then dropped, without a word, any that already existed
     or fell past evaluation 8:

  const employee = await tx.pea_employees.findUnique({ where: { id: employeeId } });
  if (!employee) throw new Error(`Employee ${employeeId} not found`);

  const lastSeq = existing.length ? Math.max(...existing.map((c) => c.seq_no)) : 0;
  const taken = new Set(existing.map((c) => c.seq_no));

  const extras = buildExtensionSchedule(employee, confirmationStatus, lastSeq).filter(
    (c) => !taken.has(c.seq_no) && c.seq_no <= 8 // the sheet only ever had 8 columns
  );

  if (extras.length === 0) return 0;
  */

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
