/**
 * users.service.js — who can sign in to PEA, and who may change whom.
 *
 * This is what actually delivers Enhancement E1. Harish's request was to stop
 * transferring the Excel file's ownership from Shweta to Subhajit to whoever is
 * next. A web app has no file owner — but only if people can be added and
 * removed as users. Until this existed the only way to do that was a seed
 * script, so E1 was solved on paper only.
 *
 * ── Hierarchy (the ATS Admin Portal rules) ─────────────────────────────────
 *   superadmin > admin > hr. An account can be managed by its owner or by
 *   anyone of a strictly higher role. A super admin may also edit a peer
 *   super admin's details — but never their password. Only a super admin may
 *   delete an account.
 *
 * ── Safeguards ─────────────────────────────────────────────────────────────
 *   · Nobody can change their own role, or deactivate or delete themselves.
 *   · The last active super admin cannot be demoted, deactivated or deleted.
 *   · Deactivating, changing a role, or setting a password ends that person's
 *     sessions immediately, so the change takes effect now rather than when
 *     their token happens to expire.
 */
import bcrypt from 'bcryptjs';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import {
  ROLES,
  ROLE_LABEL,
  ALL_ROLES,
  normalizeRole,
  outranks,
  isSuperadmin,
  assignableRoles,
} from '../config/roles.js';
import { hashPassword } from './auth.service.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// `@` is allowed because, as in ATS, a blank username defaults to the email.
const USERNAME = /^[a-z0-9._@-]{3,100}$/;
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
 * Pure, so the hierarchy and lock-out rules are testable without a database.
 *
 * @param {{id: number, role: string}} actor
 * @param {{id: number, role: string, is_active: boolean}} target
 * @param {{role?: string, is_active?: boolean, password?: string}} change
 * @param {number} activeSuperadminCount - active super admins right now, target included
 * @returns {string|null} the reason it is refused, or null when allowed
 */
export function refuseChange(actor, target, change, activeSuperadminCount) {
  const self = actor.id === target.id;
  const targetRole = normalizeRole(target.role);
  const peerSuper = !self && isSuperadmin(actor.role) && isSuperadmin(targetRole);
  const roleChanging = change.role !== undefined && normalizeRole(change.role) !== targetRole;
  const deactivating = change.is_active === false && target.is_active;
  const settingPassword = change.password !== undefined;

  if (!self && !peerSuper && !outranks(actor.role, targetRole)) {
    return 'You can only manage your own account and accounts below your role.';
  }
  if (self && roleChanging) return 'You cannot change your own role — ask another admin.';
  if (self && deactivating) return 'You cannot deactivate your own account — ask another admin.';
  if (self && settingPassword) return 'Change your own password from the menu under your name.';
  if (peerSuper && settingPassword) return "A Super Admin's password can only be changed by the account owner.";

  if (roleChanging && !assignableRoles(actor.role).includes(normalizeRole(change.role))) {
    return `You cannot give someone the ${ROLE_LABEL[normalizeRole(change.role)] || change.role} role.`;
  }

  const losesSuperadmin = isSuperadmin(targetRole) && target.is_active && (roleChanging || deactivating);
  if (losesSuperadmin && activeSuperadminCount <= 1) {
    return 'This is the last active Super Admin. Make someone else a Super Admin first.';
  }

  return null;
}

/**
 * Decide whether an account may be deleted. Pure.
 *
 * @param {{id: number, role: string}} actor
 * @param {{id: number, role: string, is_active: boolean}} target
 * @param {number} activeSuperadminCount
 * @returns {string|null}
 */
export function refuseDelete(actor, target, activeSuperadminCount) {
  if (!isSuperadmin(actor.role)) return 'Only a Super Admin can delete users.';
  if (actor.id === target.id) return 'You cannot delete your own account.';
  if (isSuperadmin(target.role) && target.is_active && activeSuperadminCount <= 1) {
    return 'This is the last active Super Admin. Make someone else a Super Admin first.';
  }
  return null;
}

const countActiveSuperadmins = () =>
  prisma.pea_users.count({ where: { role: ROLES.SUPERADMIN, is_active: true } });

async function findUser(id) {
  const user = await prisma.pea_users.findUnique({ where: { id: Number(id) } });
  if (!user) throw new AppError('User not found', 404);
  return user;
}

/** End every session for a user, so a change is felt immediately. */
async function endSessions(userId) {
  const { count } = await prisma.pea_sessions.deleteMany({ where: { user_id: userId } });
  return count;
}

/** @returns {Promise<object[]>} */
export async function listUsers() {
  return prisma.pea_users.findMany({ select: PUBLIC, orderBy: [{ is_active: 'desc' }, { created_at: 'desc' }] });
}

/**
 * @param {object} input
 * @param {{role: string, username: string}} actor
 * @returns {Promise<object>}
 */
export async function createUser(input, actor) {
  const email = String(input.email || '').trim().toLowerCase();
  if (!EMAIL.test(email)) throw new AppError('A valid email is required', 400);

  const username = String(input.username || '').trim().toLowerCase() || email;
  const role = normalizeRole(input.role || ROLES.HR);

  if (!USERNAME.test(username)) {
    throw new AppError('Username must be 3–100 characters: letters, digits, dot, dash, underscore or @', 400);
  }
  if (!ALL_ROLES.includes(role)) throw new AppError(`Role must be one of: ${ALL_ROLES.join(', ')}`, 400);
  if (!assignableRoles(actor.role).includes(role)) {
    throw new AppError(`You cannot create a ${ROLE_LABEL[role]} account`, 403);
  }
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

  logger.warn(`👤 User created by ${actor.username}: ${username} <${email}> as ${role}`);
  return user;
}

/**
 * Change names, username, email, role, active state or password.
 * A blank or absent password leaves the current one alone.
 *
 * @param {number|string} id
 * @param {object} input
 * @param {{id: number, role: string, username: string}} actor
 * @returns {Promise<object>}
 */
export async function updateUser(id, input, actor) {
  const target = await findUser(id);

  const data = {};
  const change = {};

  if (input.role !== undefined) {
    const role = normalizeRole(input.role);
    if (!ALL_ROLES.includes(role)) throw new AppError(`Role must be one of: ${ALL_ROLES.join(', ')}`, 400);
    data.role = change.role = role;
  }
  if (input.is_active !== undefined) {
    data.is_active = change.is_active = input.is_active === true || input.is_active === 'true';
  }
  if (input.password) change.password = String(input.password);
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

  if (input.username !== undefined) {
    const username = String(input.username || '').trim().toLowerCase() || data.email || target.email;
    if (!USERNAME.test(username)) {
      throw new AppError('Username must be 3–100 characters: letters, digits, dot, dash, underscore or @', 400);
    }
    const clash = await prisma.pea_users.findFirst({
      where: { username: { equals: username, mode: 'insensitive' }, NOT: { id: target.id } },
    });
    if (clash) throw new AppError(`Username "${username}" is taken`, 409);
    data.username = username;
  }

  const refusal = refuseChange(actor, target, change, await countActiveSuperadmins());
  if (refusal) throw new AppError(refusal, 403);

  if (change.password) {
    assertPasswordAcceptable(change.password, {
      username: data.username || target.username,
      email: data.email || target.email,
    });
    data.password_hash = await hashPassword(change.password);
  }

  const user = await prisma.pea_users.update({
    where: { id: target.id },
    data: { ...data, modified_at: new Date() },
    select: PUBLIC,
  });

  const roleChanged = data.role !== undefined && data.role !== normalizeRole(target.role);
  const deactivated = data.is_active === false && target.is_active;
  const ended = roleChanged || deactivated || change.password ? await endSessions(target.id) : 0;

  const { password_hash: _hash, ...logged } = data;
  logger.warn(
    `👤 User ${target.username} updated by ${actor.username}: ${JSON.stringify(logged)}` +
      (change.password ? ' + password set' : '') +
      (ended ? ` — ${ended} session(s) ended` : '')
  );

  return { ...user, sessionsEnded: ended };
}

/**
 * An admin sets a new password for someone below them who has forgotten theirs.
 * @param {number|string} id
 * @param {string} password
 * @param {{id: number, role: string, username: string}} actor
 */
export async function resetPassword(id, password, actor) {
  if (!password) throw new AppError('Enter a new password', 400);
  const { sessionsEnded } = await updateUser(id, { password }, actor);
  return { sessionsEnded };
}

/**
 * Permanently delete an account. Its sessions, notifications and module
 * access go with it (ON DELETE CASCADE); audit rows record usernames as text,
 * so history still names who did what.
 *
 * @param {number|string} id
 * @param {{id: number, role: string, username: string}} actor
 */
export async function deleteUser(id, actor) {
  const target = await findUser(id);

  const refusal = refuseDelete(actor, target, await countActiveSuperadmins());
  if (refusal) throw new AppError(refusal, 403);

  await prisma.pea_users.delete({ where: { id: target.id } });

  logger.warn(`🗑️ User ${target.username} <${target.email}> deleted by ${actor.username}`);
  return { id: target.id, username: target.username };
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
