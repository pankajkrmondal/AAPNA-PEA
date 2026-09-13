/**
 * users.service.js — who can sign in to PEA.
 *
 * This is what actually delivers Enhancement E1. Harish's request was to stop
 * transferring the Excel file's ownership from Shweta to Subhajit to whoever is
 * next. A web app has no file owner — but only if people can be added and
 * removed as users. Until this existed the only way to do that was a seed
 * script, so E1 was solved on paper only.
 *
 * ── Safeguards ─────────────────────────────────────────────────────────────
 *   · Nobody can change their own role or deactivate themselves — the classic
 *     way to lock the last admin out.
 *   · The last active admin cannot be demoted or deactivated by anyone.
 *   · Deactivating, changing a role, or resetting a password ends that
 *     person's sessions immediately, so the change takes effect now rather
 *     than when their token happens to expire.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { ALL_ROLES, normalizeRole } from '../config/roles.js';
import { hashPassword } from './auth.service.js';
import bcrypt from 'bcryptjs';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 10;

/** Fields safe to return. Never the hash. */
const PUBLIC = {
  id: true,
  username: true,
  email: true,
  first_name: true,
  last_name: true,
  role: true,
  is_active: true,
  azure_object_id: true,
  last_login_at: true,
  created_at: true,
};

/**
 * Validate a new password.
 *
 * Pure, for tests. Length over complexity rules: a long passphrase is both
 * stronger and more likely to be remembered than "P@ssw0rd1".
 *
 * @param {string} password
 * @param {{username?: string, email?: string}} [context]
 * @throws {AppError} 400
 */
export function assertPasswordAcceptable(password, context = {}) {
  const p = String(password || '');
  if (p.length < MIN_PASSWORD) throw new AppError(`Password must be at least ${MIN_PASSWORD} characters`, 400);
  if (p.length > 200) throw new AppError('Password is too long', 400);

  const lower = p.toLowerCase();
  for (const part of [context.username, String(context.email || '').split('@')[0]]) {
    if (part && part.length >= 3 && lower.includes(part.toLowerCase())) {
      throw new AppError('Password must not contain the username or email name', 400);
    }
  }
  if (/^(.)\1+$/.test(p)) throw new AppError('Password must not be one repeated character', 400);
}

/**
 * Decide whether a change to a user is allowed.
 *
 * Pure, so the lock-out rules are testable without a database.
 *
 * @param {{id: number}} actor
 * @param {{id: number, role: string, is_active: boolean}} target
 * @param {{role?: string, is_active?: boolean}} change
 * @param {number} activeAdminCount - active admins right now, target included
 * @returns {string|null} the reason it is refused, or null when allowed
 */
export function refuseChange(actor, target, change, activeAdminCount) {
  const self = actor.id === target.id;
  const demoting = change.role !== undefined && normalizeRole(change.role) !== normalizeRole(target.role);
  const deactivating = change.is_active === false && target.is_active;

  if (self && demoting) return 'You cannot change your own role — ask another admin.';
  if (self && deactivating) return 'You cannot deactivate your own account — ask another admin.';

  const targetIsActiveAdmin = normalizeRole(target.role) === 'admin' && target.is_active;
  const losesAdmin = targetIsActiveAdmin && ((demoting && normalizeRole(change.role) !== 'admin') || deactivating);
  if (losesAdmin && activeAdminCount <= 1) {
    return 'This is the last active admin. Make someone else an admin first.';
  }

  return null;
}

const countActiveAdmins = () => prisma.pea_users.count({ where: { role: 'admin', is_active: true } });

/** End every session for a user, so a change is felt immediately. */
async function endSessions(userId) {
  const { count } = await prisma.pea_sessions.deleteMany({ where: { user_id: userId } });
  return count;
}

/** @returns {Promise<object[]>} */
export async function listUsers() {
  return prisma.pea_users.findMany({ select: PUBLIC, orderBy: [{ is_active: 'desc' }, { username: 'asc' }] });
}

/**
 * @param {object} input
 * @param {string} actorName
 * @returns {Promise<object>}
 */
export async function createUser(input, actorName) {
  const username = String(input.username || '').trim().toLowerCase();
  const email = String(input.email || '').trim().toLowerCase();
  const role = normalizeRole(input.role || 'hr');

  if (!/^[a-z0-9._-]{3,100}$/.test(username)) {
    throw new AppError('Username must be 3–100 characters: letters, digits, dot, dash or underscore', 400);
  }
  if (!EMAIL.test(email)) throw new AppError('A valid email is required', 400);
  if (!ALL_ROLES.includes(role)) throw new AppError(`Role must be one of: ${ALL_ROLES.join(', ')}`, 400);
  assertPasswordAcceptable(input.password, { username, email });

  const clash = await prisma.pea_users.findFirst({
    where: {
      OR: [
        { username: { equals: username, mode: 'insensitive' } },
        { email: { equals: email, mode: 'insensitive' } },
      ],
    },
    select: { username: true, email: true },
  });
  if (clash) {
    throw new AppError(
      clash.username.toLowerCase() === username ? `Username "${username}" is taken` : `${email} already has an account`,
      409
    );
  }

  const user = await prisma.pea_users.create({
    data: {
      username,
      email,
      role,
      first_name: String(input.first_name || '').trim() || null,
      last_name: String(input.last_name || '').trim() || null,
      password_hash: await hashPassword(input.password),
      is_active: true,
    },
    select: PUBLIC,
  });

  logger.warn(`👤 User created by ${actorName}: ${username} <${email}> as ${role}`);
  return user;
}

/**
 * Change role, active state, names or email.
 * @param {number|string} id
 * @param {object} input
 * @param {{id: number, username: string}} actor
 * @returns {Promise<object>}
 */
export async function updateUser(id, input, actor) {
  const target = await prisma.pea_users.findUnique({ where: { id: Number(id) } });
  if (!target) throw new AppError('User not found', 404);

  const data = {};
  if (input.role !== undefined) {
    const role = normalizeRole(input.role);
    if (!ALL_ROLES.includes(role)) throw new AppError(`Role must be one of: ${ALL_ROLES.join(', ')}`, 400);
    data.role = role;
  }
  if (input.is_active !== undefined) data.is_active = input.is_active === true || input.is_active === 'true';
  if (input.first_name !== undefined) data.first_name = String(input.first_name || '').trim() || null;
  if (input.last_name !== undefined) data.last_name = String(input.last_name || '').trim() || null;
  if (input.email !== undefined) {
    const email = String(input.email || '').trim().toLowerCase();
    if (!EMAIL.test(email)) throw new AppError('A valid email is required', 400);
    const clash = await prisma.pea_users.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, NOT: { id: target.id } },
    });
    if (clash) throw new AppError(`${email} already has an account`, 409);
    data.email = email;
  }

  const refusal = refuseChange(actor, target, data, await countActiveAdmins());
  if (refusal) throw new AppError(refusal, 400);

  const user = await prisma.pea_users.update({
    where: { id: target.id },
    data: { ...data, modified_at: new Date() },
    select: PUBLIC,
  });

  const roleChanged = data.role !== undefined && data.role !== normalizeRole(target.role);
  const deactivated = data.is_active === false && target.is_active;
  const ended = roleChanged || deactivated ? await endSessions(target.id) : 0;

  logger.warn(
    `👤 User ${target.username} updated by ${actor.username}: ${JSON.stringify(data)}` +
      (ended ? ` — ${ended} session(s) ended` : '')
  );

  return { ...user, sessionsEnded: ended };
}

/**
 * An admin sets a new password for someone who has forgotten theirs.
 * @param {number|string} id
 * @param {string} password
 * @param {{username: string}} actor
 */
export async function resetPassword(id, password, actor) {
  const target = await prisma.pea_users.findUnique({ where: { id: Number(id) } });
  if (!target) throw new AppError('User not found', 404);
  assertPasswordAcceptable(password, target);

  await prisma.pea_users.update({
    where: { id: target.id },
    data: { password_hash: await hashPassword(password), modified_at: new Date() },
  });
  const ended = await endSessions(target.id);

  logger.warn(`🔑 Password reset for ${target.username} by ${actor.username} — ${ended} session(s) ended`);
  return { sessionsEnded: ended };
}

/**
 * A signed-in user changes their own password. Requires the current one, so a
 * session left open on a shared machine cannot be used to take the account.
 *
 * Other sessions are ended; the one making the change is kept.
 *
 * @param {{id: number, username: string, email: string}} user
 * @param {string} currentPassword
 * @param {string} newPassword
 * @param {string} currentToken
 */
export async function changeOwnPassword(user, currentPassword, newPassword, currentToken) {
  const row = await prisma.pea_users.findUnique({ where: { id: user.id } });
  if (!row) throw new AppError('User not found', 404);

  if (!(await bcrypt.compare(String(currentPassword || ''), row.password_hash))) {
    throw new AppError('Current password is incorrect', 400);
  }
  if (currentPassword === newPassword) throw new AppError('The new password must be different', 400);
  assertPasswordAcceptable(newPassword, row);

  await prisma.pea_users.update({
    where: { id: row.id },
    data: { password_hash: await hashPassword(newPassword), modified_at: new Date() },
  });

  const { count } = await prisma.pea_sessions.deleteMany({
    where: { user_id: row.id, NOT: { token: currentToken } },
  });

  logger.info(`🔑 ${row.username} changed their password — ${count} other session(s) ended`);
  return { otherSessionsEnded: count };
}
