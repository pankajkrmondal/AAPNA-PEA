import { verifySession } from '../services/auth.service.js';
import AppError from '../utils/AppError.js';
import catchAsync from '../utils/catchAsync.js';
import { normalizeRole, ROLE_RANK } from '../config/roles.js';
import { modulesFor } from '../services/modulePermissions.service.js';

/**
 * Require access to at least one of the given sidebar modules. Use after
 * `authenticate`.
 *
 * Admins and super admins always pass. An HR user passes unless an admin has
 * switched every one of these modules off for them in the Admin Portal — see
 * services/modulePermissions.service.js.
 *
 * @param {...string} keys - config/modules.js keys
 * @returns {Function} Express middleware
 */
export function requireModule(...keys) {
  return catchAsync(async (req, _res, next) => {
    if (!req.user) throw new AppError('Not signed in', 401);
    const mine = await modulesFor(req.user);
    if (!keys.some((key) => mine.includes(key))) {
      throw new AppError('This module is not enabled for your account — ask an admin', 403);
    }
    next();
  });
}

/**
 * Require a valid session. Attaches `req.user`.
 *
 * NOTE: the evaluation form routes are intentionally NOT behind this —
 * reporting managers have no PEA account and authenticate with a token in the
 * URL instead. See routes/evaluation.routes.js.
 */
export const authenticate = catchAsync(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    throw new AppError('Not signed in', 401);
  }

  req.user = await verifySession(header.slice(7));
  next();
});

/**
 * Require one of the given roles. Use after `authenticate`.
 * @param {...string} allowed
 * @returns {Function} Express middleware
 */
export function requireRole(...allowed) {
  const permitted = allowed.map(normalizeRole);
  return (req, _res, next) => {
    if (!req.user) return next(new AppError('Not signed in', 401));
    if (!permitted.includes(normalizeRole(req.user.role))) {
      return next(new AppError('You do not have permission to do that', 403));
    }
    next();
  };
}

/**
 * Require at least the given role's rank — so `requireMinRole('hr')` also
 * admits admins, without every route having to list them.
 * @param {string} minimum
 * @returns {Function} Express middleware
 */
export function requireMinRole(minimum) {
  const floor = ROLE_RANK[normalizeRole(minimum)] ?? Infinity;
  return (req, _res, next) => {
    if (!req.user) return next(new AppError('Not signed in', 401));
    if ((ROLE_RANK[normalizeRole(req.user.role)] ?? 0) < floor) {
      return next(new AppError('You do not have permission to do that', 403));
    }
    next();
  };
}
