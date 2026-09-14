import { Router } from 'express';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { authenticate, requireModule } from '../middleware/auth.js';
import { getAnalytics } from '../services/analytics.service.js';
import { findDeadlineBreaches } from '../services/confirmationDeadline.service.js';

const router = Router();

// Read-only reporting — every signed-in role with the Analytics module.
router.use(authenticate, requireModule('analytics'));

/** GET /api/analytics?from=YYYY-MM-DD&to=YYYY-MM-DD (or the older ?months=12) */
router.get('/', catchAsync(async (req, res) => {
  const { from, to, months } = req.query;
  success(res, await getAnalytics({ from, to, months }));
}));

/** GET /api/analytics/confirmation-deadlines — plan §2.7 */
router.get('/confirmation-deadlines', catchAsync(async (_req, res) => success(res, await findDeadlineBreaches())));

export default router;
