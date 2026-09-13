import { Router } from 'express';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { authenticate } from '../middleware/auth.js';
import { getAnalytics } from '../services/analytics.service.js';
import { findDeadlineBreaches } from '../services/confirmationDeadline.service.js';

const router = Router();

// Read-only reporting — every signed-in role, viewer included.
router.use(authenticate);

/** GET /api/analytics?months=12 */
router.get('/', catchAsync(async (req, res) => success(res, await getAnalytics({ months: req.query.months }))));

/** GET /api/analytics/confirmation-deadlines — plan §2.7 */
router.get('/confirmation-deadlines', catchAsync(async (_req, res) => success(res, await findDeadlineBreaches())));

export default router;
