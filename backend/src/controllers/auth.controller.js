import * as authService from '../services/auth.service.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import AppError from '../utils/AppError.js';
import { changeOwnPassword } from '../services/users.service.js';
import { modulesFor } from '../services/modulePermissions.service.js';
import { verifyTurnstile } from '../services/turnstile.service.js';
import { requestPasswordReset, resetPasswordWithToken } from '../services/passwordReset.service.js';

/** POST /api/auth/login  { identifier, password, turnstileToken } */
export const login = catchAsync(async (req, res) => {
  const { identifier, username, email, password, turnstileToken } = req.body || {};
  const id = identifier || username || email;

  if (!id || !password) {
    throw new AppError('Username/email and password are required', 400);
  }

  // Before the password is looked at: a bot that fails this learns nothing
  // about whether the account or password exists.
  await verifyTurnstile(turnstileToken, req.ip);

  const result = await authService.login(id, password);
  // The sidebar is built from this list, so the first screen after sign-in
  // already matches what Module Access allows.
  result.user.modules = await modulesFor(result.user);
  return success(res, result, 'Signed in');
});

/** POST /api/auth/logout */
export const logout = catchAsync(async (req, res) => {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    await authService.logout(header.slice(7));
  }
  return success(res, null, 'Signed out');
});

/** POST /api/auth/change-password  { current_password, new_password } */
export const changePassword = catchAsync(async (req, res) => {
  const token = (req.headers.authorization || '').slice(7);
  const r = await changeOwnPassword(req.user, req.body?.current_password, req.body?.new_password, token);
  return success(
    res,
    r,
    r.otherSessionsEnded ? `Password changed — signed out of ${r.otherSessionsEnded} other session(s)` : 'Password changed'
  );
});

/** POST /api/auth/forgot-password  { identifier, turnstileToken } */
export const forgotPassword = catchAsync(async (req, res) => {
  const { identifier, turnstileToken } = req.body || {};
  if (!String(identifier || '').trim()) throw new AppError('Enter your username or email', 400);

  // Every request can send an email, so bots are stopped before any work happens.
  await verifyTurnstile(turnstileToken, req.ip);
  await requestPasswordReset(identifier);

  // The same answer whether or not the account exists.
  return success(res, null, 'If an account exists for that username or email, a password reset link has been sent to its email address.');
});

/** POST /api/auth/reset-password  { token, new_password } */
export const resetPassword = catchAsync(async (req, res) => {
  await resetPasswordWithToken(req.body?.token, req.body?.new_password);
  return success(res, null, 'Password reset. Sign in with your new password.');
});

/**
 * GET /api/auth/me
 *
 * Polled by the frontend, so a role or module change made in the Admin Portal
 * reaches a browser that is already open.
 */
export const me = catchAsync(async (req, res) =>
  success(res, { ...authService.publicUser(req.user), modules: await modulesFor(req.user) })
);
