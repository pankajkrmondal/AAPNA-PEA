import { Router } from 'express';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { authenticate, requireMinRole } from '../middleware/auth.js';
import { listUsers, createUser, updateUser, resetPassword, deleteUser } from '../services/users.service.js';
import { getModuleAccess, setModuleAccess } from '../services/modulePermissions.service.js';

/**
 * The Admin Portal API — User Management and Module Access.
 *
 * Admin tier only. Who may change whom below that (super admin > admin > hr)
 * is decided in users.service.js, so every route applies the same ladder.
 * Changing your OWN password lives at POST /api/auth/change-password.
 */
const router = Router();

router.use(authenticate, requireMinRole('admin'));

router.get('/', catchAsync(async (_req, res) => success(res, await listUsers())));

router.post(
  '/',
  catchAsync(async (req, res) => {
    const user = await createUser(req.body, req.user);
    return success(res, user, `${user.username} can now sign in`, 201);
  })
);

router.patch(
  '/:id',
  catchAsync(async (req, res) => {
    const user = await updateUser(req.params.id, req.body, req.user);
    return success(
      res,
      user,
      user.sessionsEnded ? `Saved — ${user.username} has been signed out everywhere` : 'Saved'
    );
  })
);

router.post(
  '/:id/reset-password',
  catchAsync(async (req, res) => {
    const r = await resetPassword(req.params.id, req.body?.password, req.user);
    return success(res, r, 'Password reset — they have been signed out everywhere');
  })
);

router.delete(
  '/:id',
  requireMinRole('superadmin'),
  catchAsync(async (req, res) => {
    const r = await deleteUser(req.params.id, req.user);
    return success(res, r, `${r.username} has been deleted`);
  })
);

router.get('/:id/modules', catchAsync(async (req, res) => success(res, await getModuleAccess(req.params.id))));

router.put(
  '/:id/modules/:key',
  catchAsync(async (req, res) => {
    const r = await setModuleAccess(req.params.id, req.params.key, req.body?.is_enabled, req.user);
    const m = r.modules.find((x) => x.key === req.params.key);
    return success(res, r, `${m.label} ${m.is_enabled ? 'enabled' : 'restricted'}`);
  })
);

export default router;
