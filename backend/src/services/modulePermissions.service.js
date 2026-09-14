/**
 * modulePermissions.service.js — which sidebar modules an HR user may open.
 *
 * PEA's port of the ATS "Module Access" tab, with one deliberate difference in
 * what a missing row means. ATS treats "no row" as switched off, so every
 * account has to be seeded. Here "no row" means switched ON, and only an
 * explicit `is_enabled = false` restricts:
 *
 *   · every HR user who existed before the Admin Portal keeps what they had —
 *     nobody is locked out by the deploy;
 *   · a module added to config/modules.js later is available to HR at once,
 *     rather than silently missing for everyone until an admin notices;
 *   · before the DDL is applied the table does not exist, which reads as
 *     "nothing restricted" instead of a 500 on every screen.
 *
 * Admins and super admins are never restricted, as in ATS.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { MODULES, MODULE_KEYS, isModuleKey } from '../config/modules.js';
import { isAdminTier, outranks } from '../config/roles.js';
import { hasModulePermissions } from '../utils/schemaCapabilities.js';

/**
 * The modules a user can open. Pure, for tests.
 * @param {string} role
 * @param {string[]} [disabledKeys] - module keys explicitly switched off
 * @returns {string[]}
 */
export function resolveModules(role, disabledKeys = []) {
  if (isAdminTier(role)) return [...MODULE_KEYS];
  const off = new Set(disabledKeys);
  return MODULE_KEYS.filter((key) => !off.has(key));
}

async function disabledKeysFor(userId) {
  if (!(await hasModulePermissions())) return [];
  const rows = await prisma.pea_module_permissions.findMany({
    where: { user_id: userId, is_enabled: false },
    select: { module_key: true },
  });
  return rows.map((r) => r.module_key);
}

/**
 * @param {{id: number, role: string}} user
 * @returns {Promise<string[]>}
 */
export async function modulesFor(user) {
  if (isAdminTier(user.role)) return [...MODULE_KEYS];
  return resolveModules(user.role, await disabledKeysFor(user.id));
}

async function findTarget(id) {
  const target = await prisma.pea_users.findUnique({ where: { id: Number(id) } });
  if (!target) throw new AppError('User not found', 404);
  return target;
}

/**
 * Every module with its state for one user — what the Module Access tab draws.
 * @param {number|string} userId
 * @returns {Promise<{user_id: number, bypass: boolean, available: boolean, modules: object[]}>}
 */
export async function getModuleAccess(userId) {
  const target = await findTarget(userId);
  const enabled = new Set(await modulesFor(target));
  return {
    user_id: target.id,
    bypass: isAdminTier(target.role),
    available: await hasModulePermissions(),
    modules: MODULES.map((m) => ({ ...m, is_enabled: enabled.has(m.key) })),
  };
}

/**
 * Switch one module on or off for one HR user.
 *
 * Takes effect on that user's next request: requireModule() reads the table
 * live, so unlike ATS no session has to be ended for the change to bite.
 *
 * @param {number|string} userId
 * @param {string} moduleKey
 * @param {boolean} enabled
 * @param {{role: string, username: string}} actor
 */
export async function setModuleAccess(userId, moduleKey, enabled, actor) {
  if (!isModuleKey(moduleKey)) throw new AppError(`Unknown module "${moduleKey}"`, 400);
  if (typeof enabled !== 'boolean') throw new AppError('is_enabled must be true or false', 400);

  const target = await findTarget(userId);
  if (isAdminTier(target.role)) {
    throw new AppError('Admins and Super Admins always have every module — module access applies to HR users', 400);
  }
  if (!outranks(actor.role, target.role)) {
    throw new AppError('You can only change module access for accounts below your role', 403);
  }
  if (!(await hasModulePermissions())) {
    throw new AppError('Module access is unavailable until prisma/ddl/2026-09-13b-pea-admin-portal.sql is applied', 503);
  }

  await prisma.pea_module_permissions.upsert({
    where: { user_id_module_key: { user_id: target.id, module_key: moduleKey } },
    create: { user_id: target.id, module_key: moduleKey, is_enabled: enabled, updated_by: actor.username },
    update: { is_enabled: enabled, updated_by: actor.username, updated_at: new Date() },
  });

  logger.warn(`🧩 Module "${moduleKey}" ${enabled ? 'enabled' : 'restricted'} for ${target.username} by ${actor.username}`);
  return getModuleAccess(target.id);
}
