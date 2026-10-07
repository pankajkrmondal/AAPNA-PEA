/**
 * archive.service.js — Commandos whose probation is over. Archive (07-10-2026).
 *
 * Harish, 07-10-2026: once a probation is decided — Confirmed or Not Confirmed
 * — or the person has left, they should stop filling the day-to-day screens.
 * Before this they stayed "active" for good: in the Commandos list, with every
 * evaluation on the board, in the Dashboard and Trends, on their manager's team
 * link, and in the nightly Microsoft 365 leaver check.
 *
 * Decided with Harish:
 *
 *   · automatically AND by hand — HR can archive early, or restore anyone
 *   · straight away — the morning after the final decision or the exit; the
 *     wait is the setting `archive_after_days`, 0 to start with
 *   · Confirmed, Not Confirmed, and anyone marked as having left
 *   · a read-only record: out of the lists, the board, the Dashboard, Trends
 *     and the manager portal, and out of the Microsoft 365 checks; still found
 *     under the "Archived" filter and by search, their page and evaluations
 *     readable, Download / Share report working, and Restore to bring them back
 *
 * Nothing is deleted or moved. "Archived" is three columns on pea_employees
 * (2026-10-02-pea-review-round.sql); the filtering lives in utils/archiveScope.js.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { hasArchiveColumns } from '../utils/schemaCapabilities.js';
import { archiveRecord } from '../utils/archiveScope.js';
import { notifyStaff } from './inAppNotification.service.js';
import { unreadFlaggedByEmployee } from './evaluationBoard.service.js';
import { todayIn, dateIn, daysBetween, formatDisplay } from '../utils/dateUtils.js';

/** Who archived someone when the morning pass did it. */
export const AUTO_ACTOR = 'auto-archive';

/** The decisions that end a probation. */
const FINAL = ['Confirmed', 'Not Confirmed'];

const NEEDS_DDL = 'The archive needs the database update of 02-10-2026 (2026-10-02-pea-review-round.sql), which has not been applied here yet.';

/** What the probation ended with, in words. */
function outcomeOf(row) {
  if (row.employment_status === 'left') return 'Left';
  return row.confirmation_status;
}

/**
 * Is this Commando due to be archived by the morning pass? Pure.
 *
 *   · decided (Confirmed / Not Confirmed) or left, and not archived already
 *   · no evaluation link still out with a manager
 *   · no recent flagged feedback that nobody has read or followed up
 *   · the waiting period has passed since the decision or exit — counted in
 *     whole days, so 0 means "the morning after", never the same day
 *   · not restored since that decision or exit: a restore means HR wants them
 *     visible, and only a NEW decision or exit makes them due again
 *
 * @param {{confirmation_status: string|null, employment_status: string, archived_at?: Date|null,
 *   restored_at?: Date|null, settled_at?: Date|null, modified_at?: Date|null, has_open?: boolean,
 *   unread_flagged?: number}} row
 * @param {Date} today - UTC midnight in PEA's time zone
 * @param {number} [days=0] - the waiting period
 * @param {string} [timeZone]
 * @returns {boolean}
 */
export function archiveDue(row, today, days = 0, timeZone = config.scheduler.timezone) {
  if (row.archived_at) return false;
  const decided = FINAL.includes(row.confirmation_status);
  const left = row.employment_status === 'left';
  if (!decided && !left) return false;
  if (row.has_open) return false;
  if ((row.unread_flagged || 0) > 0) return false;

  const settled = row.settled_at || row.modified_at;
  if (!settled) return false;
  if (daysBetween(dateIn(settled, timeZone), today) <= Math.max(0, Number(days) || 0)) return false;

  if (row.restored_at && new Date(row.restored_at) >= new Date(settled)) return false;
  return true;
}

/** The waiting period from Settings; 0 when unset or unreadable. */
async function waitingDays() {
  const row = await prisma.pea_settings.findUnique({ where: { setting_key: 'archive_after_days' } });
  const n = Number(row?.setting_value);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/**
 * Everyone who could be archived, with what archiveDue() needs. Raw SQL: the
 * columns are newer than the Prisma model.
 *
 * `settled_at` is when the decision or exit happened: the latest change to
 * either in the change history, which every path writes (the manager's form,
 * Record decision, Mark as left, Edit, the Microsoft 365 exit confirmation).
 * `has_open` counts only links that are out — a decision or an exit already
 * closes them, so a pending one left from older data does not hold anyone back.
 */
async function candidates() {
  return prisma.$queryRaw`
    SELECT e.id, e.full_name, e.confirmation_status, e.employment_status,
           e.archived_at, e.restored_at, e.modified_at,
           (SELECT max(a.changed_at) FROM pea_employee_audit a
             WHERE a.employee_id = e.id
               AND a.field_name IN ('confirmation_status', 'employment_status')) AS settled_at,
           EXISTS (SELECT 1 FROM pea_evaluation_cycles c
                    WHERE c.employee_id = e.id AND c.status IN ('email_sent', 'opened')) AS has_open
      FROM pea_employees e
     WHERE e.archived_at IS NULL
       AND (e.confirmation_status IN ('Confirmed', 'Not Confirmed') OR e.employment_status = 'left')`;
}

/**
 * Archive one Commando: the columns, and a line in their change history.
 * @param {bigint} id
 * @param {{reason: string, actor: string}} opts
 */
async function writeArchive(id, { reason, actor }) {
  const now = new Date();
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE pea_employees
         SET archived_at = ${now}, archived_by = ${actor}, archive_reason = ${reason}, modified_at = ${now}
       WHERE id = ${id} AND archived_at IS NULL`,
    prisma.pea_employee_audit.create({
      data: {
        employee_id: id,
        field_name: '*',
        new_value: actor === AUTO_ACTOR ? `Archived automatically — ${reason}.` : `Archived by ${actor}. ${reason}`,
        changed_by: actor,
        change_source: actor === AUTO_ACTOR ? 'system' : 'manual',
      },
    }),
  ]);
}

/**
 * The morning pass: archive everyone due. Runs from the daily sweep's cron
 * (jobs/evaluationScheduler.js), after the evaluations have gone out.
 *
 * @param {{dryRun?: boolean}} [opts] - a dry run archives nobody and says who it would
 * @returns {Promise<{archived: number, names: string[], skipped?: string}>}
 */
export async function runAutoArchive({ dryRun = false } = {}) {
  if (!(await hasArchiveColumns())) return { archived: 0, names: [], skipped: 'no archive here yet' };

  const tz = config.scheduler.timezone;
  const today = todayIn(tz);
  const [rows, days, unread] = await Promise.all([candidates(), waitingDays(), unreadFlaggedByEmployee()]);

  const due = rows.filter((r) => archiveDue({ ...r, unread_flagged: unread.get(String(r.id)) || 0 }, today, days, tz));
  const names = due.map((r) => r.full_name);

  if (dryRun) {
    logger.info(`[archive] dry run: ${due.length} Commando(s) would be archived${names.length ? ` — ${names.slice(0, 20).join(', ')}${names.length > 20 ? ', …' : ''}` : ''}`);
    return { archived: 0, wouldArchive: due.length, names, dryRun: true };
  }

  let archived = 0;
  for (const r of due) {
    try {
      const when = r.settled_at || r.modified_at;
      // eslint-disable-next-line no-await-in-loop
      await writeArchive(r.id, { reason: `${outcomeOf(r)} on ${formatDisplay(dateIn(when, tz))}`, actor: AUTO_ACTOR });
      archived += 1;
    } catch (err) {
      logger.warn(`[archive] could not archive ${r.full_name}: ${err.message}`);
    }
  }

  if (archived) {
    await notifyStaff({
      type: 'commandos_archived',
      title: `${archived} Commando(s) archived`,
      body:
        'Their probation is over — confirmed, not confirmed, or left. Their records are kept and can be ' +
        'found under Commandos → Status → Archived, and restored from there.',
      link: '/employees?state=archived',
    });
  }
  logger.info(`[archive] ${archived} Commando(s) archived`);
  return { archived, names: names.slice(0, archived) };
}

/**
 * Archive one Commando by hand — HR, from their page. Only someone whose
 * probation is over: archiving a running probation would take it off every
 * screen while its evaluations were still due.
 *
 * Does not wait for unread feedback: HR is the one deciding.
 *
 * @param {bigint|number|string} id
 * @param {{reason?: string}} input
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function archiveEmployee(id, input = {}, actor) {
  if (!(await hasArchiveColumns())) throw new AppError(NEEDS_DDL, 503);

  const employeeId = BigInt(id);
  const employee = await prisma.pea_employees.findUnique({
    where: { id: employeeId },
    select: { id: true, full_name: true, confirmation_status: true, employment_status: true },
  });
  if (!employee) throw new AppError('Commando not found', 404);
  if (await archiveRecord(employeeId)) throw new AppError(`${employee.full_name} is already archived.`, 409);

  if (!FINAL.includes(employee.confirmation_status) && employee.employment_status !== 'left') {
    throw new AppError(
      `${employee.full_name}'s probation is not over yet. Only someone confirmed, not confirmed or marked as having left can be archived.`,
      409
    );
  }
  const out = await prisma.pea_evaluation_cycles.count({
    where: { employee_id: employeeId, status: { in: ['email_sent', 'opened'] } },
  });
  if (out) {
    throw new AppError(`An evaluation link for ${employee.full_name} is still with a manager. Close or finish it first.`, 409);
  }

  const reason = String(input.reason || '').trim();
  if (reason.length > 500) throw new AppError(`The reason is ${reason.length} characters; the limit is 500.`, 400);

  await writeArchive(employeeId, { reason: reason || `${outcomeOf(employee)}.`, actor });
  logger.info(`Commando ${employee.full_name} archived by ${actor}`);
  return { archived: true };
}

/**
 * Bring a Commando back from the archive. `restored_at` keeps the morning pass
 * from archiving them again until a new decision or exit.
 * @param {bigint|number|string} id
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function restoreEmployee(id, actor) {
  if (!(await hasArchiveColumns())) throw new AppError(NEEDS_DDL, 503);

  const employeeId = BigInt(id);
  const employee = await prisma.pea_employees.findUnique({ where: { id: employeeId }, select: { full_name: true } });
  if (!employee) throw new AppError('Commando not found', 404);
  const record = await archiveRecord(employeeId);
  if (!record) throw new AppError(`${employee.full_name} is not archived.`, 409);

  const now = new Date();
  await prisma.$transaction([
    prisma.$executeRaw`
      UPDATE pea_employees
         SET archived_at = NULL, archived_by = NULL, archive_reason = NULL, restored_at = ${now}, modified_at = ${now}
       WHERE id = ${employeeId}`,
    prisma.pea_employee_audit.create({
      data: {
        employee_id: employeeId,
        field_name: '*',
        new_value:
          `Restored from the archive by ${actor} (archived ${formatDisplay(dateIn(record.archived_at, config.scheduler.timezone))}` +
          `${record.archived_by ? ` by ${record.archived_by}` : ''}). It will not be archived again automatically until a new decision or exit.`,
        changed_by: actor,
        change_source: 'manual',
      },
    }),
  ]);
  logger.info(`Commando ${employee.full_name} restored from the archive by ${actor}`);
  return { restored: true };
}
