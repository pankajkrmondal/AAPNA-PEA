import { Router } from 'express';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { authenticate } from '../middleware/auth.js';
import { listForUser, markRead, markAllRead } from '../services/inAppNotification.service.js';

/**
 * The header bell. Every route is scoped to the signed-in user — there is no
 * way to read or clear anyone else's notifications.
 */
const router = Router();

router.use(authenticate);

/** GET /api/notifications?limit=30 */
router.get(
  '/',
  catchAsync(async (req, res) =>
    success(res, await listForUser(req.user.id, parseInt(req.query.limit || '30', 10)))
  )
);

/** POST /api/notifications/:id/read */
router.post(
  '/:id/read',
  catchAsync(async (req, res) => success(res, { updated: await markRead(req.user.id, req.params.id) }))
);

/** POST /api/notifications/read-all */
router.post(
  '/read-all',
  catchAsync(async (req, res) => success(res, { updated: await markAllRead(req.user.id) }, 'All marked as read'))
);

export default router;
