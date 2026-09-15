/**
 * passwordReset.service.js — "Forgot password?" on the sign-in page.
 *
 * The ATS design: a stateless, single-use reset token. It is a short-lived JWT
 * carrying a fingerprint of the account's CURRENT password hash. Setting a new
 * password changes the hash, so the fingerprint stops matching and the link
 * cannot be used twice — or after the password is changed any other way. No
 * token table, so no database change.
 *
 * Every error is 400, never 401: the frontend treats 401 as "session over" and
 * bounces to the login page, but the reset page must show the message inline.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { findUserByIdentifier, hashPassword } from './auth.service.js';
import { assertPasswordAcceptable } from './users.service.js';
import { sendPasswordResetEmail } from './accountEmail.service.js';

const PURPOSE = 'password-reset';
const RESET_TOKEN_EXPIRY = '30m';

const INVALID = 'This password reset link is invalid. Please request a new one.';
const EXPIRED = 'This password reset link has expired. Please request a new one.';
const USED = 'This password reset link has already been used. Please request a new one.';

/**
 * Fingerprint of a stored password hash. Pure, for tests.
 * @param {string} passwordHash
 * @returns {string}
 */
export function passwordFingerprint(passwordHash) {
  return crypto.createHash('sha256').update(passwordHash || '').digest('hex').slice(0, 16);
}

/**
 * @param {{id: number, password_hash: string}} user
 * @returns {string} a JWT valid for 30 minutes
 */
export function signResetToken(user) {
  return jwt.sign(
    { userId: user.id, type: PURPOSE, fp: passwordFingerprint(user.password_hash) },
    config.jwt.secret,
    { expiresIn: RESET_TOKEN_EXPIRY }
  );
}

/**
 * Verify a reset token's signature, expiry and purpose. Pure (no database).
 * A sign-in token is signed with the same secret, so `type` is what stops one
 * being used as a reset link.
 *
 * @param {string} token
 * @returns {{userId: number, fp: string}}
 * @throws {AppError} 400
 */
export function decodeResetToken(token) {
  if (!token || typeof token !== 'string') throw new AppError(INVALID, 400);

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwt.secret);
  } catch (err) {
    throw new AppError(err?.name === 'TokenExpiredError' ? EXPIRED : INVALID, 400);
  }

  if (decoded.type !== PURPOSE || !decoded.userId || !decoded.fp) throw new AppError(INVALID, 400);
  return { userId: decoded.userId, fp: decoded.fp };
}

/**
 * Email a reset link if the username/email belongs to an active account.
 * Silent either way — the caller always gives the same answer, so this cannot
 * be used to find out which accounts exist.
 *
 * @param {string} identifier - username or email
 */
export async function requestPasswordReset(identifier) {
  const user = await findUserByIdentifier(identifier);
  if (!user || !user.is_active) {
    logger.info(`🔑 Password reset requested for unknown or inactive login "${identifier}" — no email sent`);
    return;
  }

  const resetUrl = `${config.frontendUrl.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(signResetToken(user))}`;
  if (config.isDevelopment) logger.info(`[dev] Password reset URL for ${user.username}: ${resetUrl}`);

  // Not awaited: the response takes the same time whether or not an account
  // matched. sendPasswordResetEmail never throws and logs its own outcome.
  void sendPasswordResetEmail({ user, resetUrl });
}

/**
 * Set a new password from a reset link, then sign the account out everywhere.
 *
 * @param {string} token
 * @param {string} newPassword
 */
export async function resetPasswordWithToken(token, newPassword) {
  const { userId, fp } = decodeResetToken(token);

  const user = await prisma.pea_users.findUnique({ where: { id: Number(userId) } });
  if (!user || !user.is_active) throw new AppError(INVALID, 400);
  if (fp !== passwordFingerprint(user.password_hash)) throw new AppError(USED, 400);

  assertPasswordAcceptable(newPassword, user);

  await prisma.pea_users.update({
    where: { id: user.id },
    data: { password_hash: await hashPassword(newPassword), modified_at: new Date() },
  });
  const { count } = await prisma.pea_sessions.deleteMany({ where: { user_id: user.id } });

  logger.info(`🔑 ${user.username} reset their password by email link — ${count} session(s) ended`);
}
