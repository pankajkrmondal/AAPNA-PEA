/**
 * schemaCapabilities.js — "has this DDL been applied here yet?"
 *
 * PEA's schema arrives as reviewed SQL files applied by hand (decision D2), so
 * for a while after a release the code can be ahead of a given database. Rather
 * than let a missing column turn into a 500 on an unrelated screen, features
 * that depend on a newer DDL ask first and degrade.
 *
 * An object that exists is cached for the life of the process. One that is
 * missing is re-checked after a minute, so applying the DDL takes effect
 * without restarting the server.
 */
import prisma from '../config/database.js';

const present = new Set();
const absentUntil = new Map();
const RECHECK_MS = 60_000;

/**
 * @param {string} key - cache key
 * @param {() => Promise<object[]>} lookup - resolves to one row when the object exists
 * @returns {Promise<boolean>}
 */
async function probe(key, lookup) {
  if (present.has(key)) return true;
  if ((absentUntil.get(key) || 0) > Date.now()) return false;

  const [row] = await lookup();

  if (row) {
    present.add(key);
    absentUntil.delete(key);
    return true;
  }

  absentUntil.set(key, Date.now() + RECHECK_MS);
  return false;
}

/**
 * @param {string} table
 * @param {string} column
 * @returns {Promise<boolean>}
 */
export const hasColumn = (table, column) =>
  probe(`${table}.${column}`, () => prisma.$queryRaw`
    SELECT 1 AS ok FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}
     LIMIT 1`);

/**
 * @param {string} table
 * @returns {Promise<boolean>}
 */
export const hasTable = (table) =>
  probe(table, () => prisma.$queryRaw`
    SELECT 1 AS ok FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ${table}
     LIMIT 1`);

/** True once 2026-09-13-pea-phase2-features.sql has been applied. */
export const hasPhase2Features = () => hasColumn('pea_employees', 'azure_display_name');

/** True once 2026-09-13b-pea-admin-portal.sql has been applied. */
export const hasModulePermissions = () => hasTable('pea_module_permissions');

/** True once 2026-09-23-pea-board-redesign.sql has been applied (reason for decision). */
export const hasDecisionReason = () => hasColumn('pea_evaluation_cycles', 'confirmation_reason');

/** True once 2026-09-23-pea-board-redesign.sql has been applied (per-user read receipts). */
export const hasEvaluationReads = () => hasTable('pea_evaluation_reads');

/**
 * True once 2026-10-02-pea-review-round.sql has been applied — the reason and
 * date HR gives with "Record decision" and "Mark as left" (U10). Until then
 * both still work and the reason is kept in the change history only.
 */
export const hasDecisionColumns = () => hasColumn('pea_employees', 'decision_reason');

/**
 * True once 2026-10-02-pea-review-round.sql has been applied — a manager's
 * unsubmitted answers (P11). Until then the form has no "Save draft".
 */
export const hasDraftColumns = () => hasColumn('pea_evaluation_cycles', 'draft');

/**
 * True once 2026-10-02-pea-review-round.sql has been applied — who a link was
 * issued to and who answered it (M3, M7, U13), and who typed the ratings in
 * when HR entered them (B5). Until then an evaluation is credited to the
 * reporting manager of the day, as before, and a link cannot be sent to an
 * acting manager.
 */
export const hasRecipientColumns = () => hasColumn('pea_evaluation_cycles', 'sent_to_email');

/** True once 2026-10-02-pea-review-round.sql has been applied — earlier versions of a reopened evaluation (M6). */
export const hasRevisions = () => hasTable('pea_evaluation_revisions');

/** True once 2026-10-02-pea-review-round.sql has been applied — what HR did about flagged feedback (P8). */
export const hasFollowups = () => hasTable('pea_evaluation_followups');

/**
 * True once 2026-10-02-pea-review-round.sql has been applied — HR's notes on a
 * Commando (L7). Until then the Commando page has no Notes card.
 */
export const hasEmployeeNotes = () => hasTable('pea_employee_notes');

/**
 * True when pea_email_log accepts this email type — H1 (07-10-2026).
 *
 * queueEmail writes its log row AFTER the email has gone, so a type the
 * database still refuses would throw once the email was already out. A sender
 * of a type added by a DDL not yet applied here asks first and skips the email.
 * `joiners_waiting` arrives with 2026-10-02-pea-review-round.sql.
 *
 * @param {string} type
 * @returns {Promise<boolean>}
 */
export const hasEmailType = (type) =>
  probe(`email_type:${type}`, () => prisma.$queryRaw`
    SELECT 1 AS ok FROM pg_constraint
     WHERE conname = 'pea_email_log_type_chk'
       AND pg_get_constraintdef(oid) LIKE ${`%'${type}'%`}
     LIMIT 1`);

/**
 * True once 2026-10-02-pea-review-round.sql has been applied — the archive
 * (07-10-2026). Until then nobody is archived and every list is as before.
 */
export const hasArchiveColumns = () => hasColumn('pea_employees', 'archived_at');
