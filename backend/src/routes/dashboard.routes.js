import { Router } from 'express';
import { getNeedsAction } from '../services/needsAction.service.js';
import { dashboard, dataQuality, exportExcel } from '../controllers/dashboard.controller.js';
import { authenticate, requireModule } from '../middleware/auth.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';

const router = Router();

router.use(authenticate, requireModule('dashboard'));

router.get('/', dashboard);
router.get('/data-quality', dataQuality);
router.get('/export', exportExcel);

/**
 * GET /api/dashboard/needs-action — the Overview's "Act on these first" list.
 *
 * One ranked list replacing four separate tables, each of which was capped at
 * 25 rows and sorted only within its own category — so the worst case was not
 * necessarily visible anywhere.
 */
router.get('/needs-action', catchAsync(async (req, res) =>
  success(res, await getNeedsAction({ limit: Number(req.query.limit) || 50, userId: req.user.id }))
));

export default router;
