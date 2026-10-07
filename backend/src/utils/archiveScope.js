/**
 * archiveScope.js — who is archived, for every query that leaves them out.
 *
 * Archive (07-10-2026). A Commando whose probation is over — Confirmed, Not
 * Confirmed, or left — is archived: out of the Commandos list, the Evaluations
 * board, the Dashboard, Trends and the manager's team link, with their record
 * kept and readable. See services/archive.service.js for when it happens.
 *
 * The columns are newer than the Prisma model (2026-10-02-pea-review-round.sql)
 * and the model is not changed, so:
 *
 *   · raw-SQL queries add notArchivedSql('e')
 *   · Prisma queries add notInIds(await archivedIds())
 *
 * Both are no-ops until the DDL is applied, so every list behaves exactly as
 * before on a database without it.
 *
 * Lives in utils, not in a service, so the services that filter by it can
 * import it without importing one another.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import AppError from './AppError.js';
import { hasArchiveColumns } from './schemaCapabilities.js';

/**
 * `AND <alias>.archived_at IS NULL`, or nothing before the DDL.
 * @param {string} [alias='e'] - the pea_employees alias in the query
 * @returns {Promise<import('@prisma/client').Prisma.Sql>}
 */
export async function notArchivedSql(alias = 'e') {
  if (!(await hasArchiveColumns())) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(alias)}.archived_at IS NULL`;
}

/**
 * The same for a query over evaluations that does not join pea_employees:
 * `AND <alias>.employee_id NOT IN (archived people)`, or nothing before the DDL.
 * @param {string} [alias='c'] - the pea_evaluation_cycles alias in the query
 * @returns {Promise<import('@prisma/client').Prisma.Sql>}
 */
export async function notArchivedCycleSql(alias = 'c') {
  if (!(await hasArchiveColumns())) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(alias)}.employee_id NOT IN (SELECT id FROM pea_employees WHERE archived_at IS NOT NULL)`;
}

/**
 * The ids of archived Commandos, or null when there is no archive here yet.
 * @returns {Promise<bigint[]|null>}
 */
export async function archivedIds() {
  if (!(await hasArchiveColumns())) return null;
  const rows = await prisma.$queryRaw`SELECT id FROM pea_employees WHERE archived_at IS NOT NULL`;
  return rows.map((r) => r.id);
}

/**
 * A Prisma `where` fragment leaving the given ids out; {} when there are none.
 * @param {bigint[]|null} ids
 * @param {string} [key='id'] - `employee_id` on a cycle query
 * @returns {object}
 */
export function notInIds(ids, key = 'id') {
  return ids && ids.length ? { [key]: { notIn: ids } } : {};
}

/**
 * The archive record of one Commando, or null when they are not archived (or
 * there is no archive here yet).
 * @param {bigint|number|string} id
 * @returns {Promise<{archived_at: Date, archived_by: string|null, archive_reason: string|null}|null>}
 */
export async function archiveRecord(id) {
  if (!(await hasArchiveColumns())) return null;
  const [row] = await prisma.$queryRaw`
    SELECT archived_at, archived_by, archive_reason
      FROM pea_employees WHERE id = ${BigInt(id)} AND archived_at IS NOT NULL`;
  return row || null;
}

/**
 * Refuse a change to an archived Commando: their record is read-only until
 * they are restored.
 * @param {bigint|number|string} id
 * @param {string} [name]
 * @throws {AppError} 409
 */
export async function assertNotArchived(id, name = null) {
  if (await archiveRecord(id)) {
    throw new AppError(
      `${name || 'This Commando'} is archived, so the record is read-only. Restore them first to make changes.`,
      409
    );
  }
}
