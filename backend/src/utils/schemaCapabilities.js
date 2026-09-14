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
