/**
 * auth.service.js — password verification, JWT issuing, and session CRUD
 * against pea_sessions.
 *
 * Deliberately NOT shared with ATS. ATS login WRITES to rpa_sessions and
 * rpa_users, and an ATS logout deletes every session for a user — which would
 * silently log them out of PEA too. Sharing auth would also mean granting PEA
 * write access to ATS tables. See plan §5.4.
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { normalizeRole } from '../config/roles.js';

const BCRYPT_ROUNDS = 10;

/**
 * Hash a plaintext password.
 * @param {string} plain
 * @returns {Promise<string>}
 */
export function hashPassword(plain) {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Find a user by username or email, case-insensitively.
 *
 * The database enforces uniqueness on lower(username) / lower(email) via
 * expression indexes, which Prisma cannot model — so this normalises and uses
 * findFirst rather than findUnique. See the note in schema.prisma.
 *
 * @param {string} identifier - username or email
 * @returns {Promise<object|null>}
 */
export async function findUserByIdentifier(identifier) {
  const needle = (identifier || '').trim().toLowerCase();
  if (!needle) return null;

  return prisma.pea_users.findFirst({
    where: {
      OR: [
        { username: { equals: needle, mode: 'insensitive' } },
        { email: { equals: needle, mode: 'insensitive' } },
      ],
    },
  });
}

/**
 * Issue a signed JWT for a user.
 * @param {object} user - pea_users row
 * @returns {string}
 */
function signToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: normalizeRole(user.role),
      // A random nonce so two logins in the same second cannot produce an
      // identical JWT and collide on the pea_sessions.token unique index.
      jti: crypto.randomBytes(8).toString('hex'),
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
}

/**
 * Record a session row so a token can be revoked server-side.
 * @param {number} userId
 * @param {string} role
 * @param {string} token
 * @returns {Promise<object>}
 */
async function createSession(userId, role, token) {
  const decoded = jwt.decode(token);
  return prisma.pea_sessions.create({
    data: {
      token,
      user_id: userId,
      role,
      expires_at: new Date(decoded.exp * 1000),
    },
  });
}

/**
 * Authenticate a user and start a session.
 *
 * @param {string} identifier - username or email
 * @param {string} password
 * @returns {Promise<{token: string, user: object}>}
 * @throws {AppError} 401 on bad credentials, 403 if deactivated
 */
export async function login(identifier, password) {
  const user = await findUserByIdentifier(identifier);

  // Same message and roughly the same work either way, so the response does
  // not reveal whether the account exists.
  if (!user) {
    await bcrypt.compare(password, '$2a$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
    throw new AppError('Invalid credentials', 401);
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) throw new AppError('Invalid credentials', 401);

  if (!user.is_active) throw new AppError('This account has been deactivated', 403);

  const token = signToken(user);
  await createSession(user.id, normalizeRole(user.role), token);

  await prisma.pea_users.update({
    where: { id: user.id },
    data: { last_login_at: new Date() },
  });

  logger.info(`Login: ${user.username} (${user.role})`);

  return { token, user: publicUser(user) };
}

/**
 * End a session (single token).
 * @param {string} token
 * @returns {Promise<void>}
 */
export async function logout(token) {
  await prisma.pea_sessions.deleteMany({ where: { token } });
}

/**
 * Verify a JWT and confirm the session still exists and has not expired.
 * @param {string} token
 * @returns {Promise<object>} the pea_users row
 * @throws {AppError} 401
 */
export async function verifySession(token) {
  const decoded = jwt.verify(token, config.jwt.secret); // throws on bad/expired

  const session = await prisma.pea_sessions.findUnique({ where: { token } });
  if (!session) throw new AppError('Session has ended — please sign in again', 401);
  if (session.expires_at < new Date()) {
    await prisma.pea_sessions.deleteMany({ where: { token } });
    throw new AppError('Session expired — please sign in again', 401);
  }

  const user = await prisma.pea_users.findUnique({ where: { id: decoded.userId } });
  if (!user || !user.is_active) throw new AppError('Account is no longer active', 401);

  return user;
}

/**
 * Delete expired sessions. Called by the session cleanup job.
 * @returns {Promise<number>} rows removed
 */
export async function purgeExpiredSessions() {
  const { count } = await prisma.pea_sessions.deleteMany({
    where: { expires_at: { lt: new Date() } },
  });
  return count;
}

/**
 * Strip the password hash before a user object leaves the service layer.
 * @param {object} user
 * @returns {object}
 */
export function publicUser(user) {
  const { password_hash: _omit, ...rest } = user;
  return rest;
}
