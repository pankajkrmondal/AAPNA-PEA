import { Router } from 'express';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { authenticate, requireMinRole } from '../middleware/auth.js';
import { listUsers, createUser, updateUser, resetPassword } from '../services/users.service.js';

/**
 * User management — admin only (plan §5.4: admin manages users and settings).
 * Changing your OWN password lives at POST /api/auth/change-password.
 */
const router = Router();

router.use(authenticate, requireMinRole('admin'));

router.get('/', catchAsync(async (_req, res) => success(res, await listUsers())));

router.post(
  '/',
  catchAsync(async (req, res) => {
    const user = await createUser(req.body, req.user.username);
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

export default router;
