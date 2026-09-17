import { Router } from 'express';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { authenticate, requireModule } from '../middleware/auth.js';
import { getAnalytics, getResourceTrends, getEmployeeTrend } from '../services/analytics.service.js';
import { findDeadlineBreaches } from '../services/confirmationDeadline.service.js';
import AppError from '../utils/AppError.js';

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

/**
 * GET /api/analytics/resource-trends?search=&cohort=fresher|experienced&trend=growing|declining|steady
 *
 * The Trends tab's lead table: who is growing, who is coming down. Subhajit,
 * 15-Sep demo (13:24) — "whether that new joiner is growing or not".
 *
 * Deliberately not date-ranged. A person's first evaluation is their baseline
 * whenever it happened, and cutting it off at a range boundary would report a
 * change measured from an arbitrary midpoint.
 */
router.get('/resource-trends', catchAsync(async (req, res) => {
  const { search, cohort, trend } = req.query;
  success(res, await getResourceTrends({ search, cohort, trend }));
}));

/** GET /api/analytics/resource-trends/:employeeId — one person, every parameter by evaluation. */
router.get('/resource-trends/:employeeId', catchAsync(async (req, res) => {
  if (!/^\d+$/.test(req.params.employeeId)) throw new AppError('Invalid employee id.', 400);

  const trend = await getEmployeeTrend(req.params.employeeId);
  if (!trend) throw new AppError('Employee not found.', 404);

  success(res, trend);
}));

export default router;
