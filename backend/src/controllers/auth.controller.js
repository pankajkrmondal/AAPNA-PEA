import * as authService from '../services/auth.service.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import AppError from '../utils/AppError.js';

/** POST /api/auth/login  { identifier, password } */
export const login = catchAsync(async (req, res) => {
  const { identifier, username, email, password } = req.body || {};
  const id = identifier || username || email;

  if (!id || !password) {
    throw new AppError('Username/email and password are required', 400);
  }

  const result = await authService.login(id, password);
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

/** GET /api/auth/me */
export const me = catchAsync(async (req, res) =>
  success(res, authService.publicUser(req.user))
);
