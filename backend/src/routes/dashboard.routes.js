import { Router } from 'express';
import {
  dashboard,
  dataQuality,
  exportExcel,
  searchAts,
  handoffs,
  createFromHandoff,
} from '../controllers/dashboard.controller.js';
import { authenticate, requireMinRole } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', dashboard);
router.get('/data-quality', dataQuality);
router.get('/export', exportExcel);

export default router;

/** ATS-facing routes, mounted separately at /api/ats. */
export const atsRouter = Router();
atsRouter.use(authenticate);
atsRouter.get('/search', searchAts);
atsRouter.get('/handoffs', handoffs);
atsRouter.post('/handoffs/:pipelineId/create', requireMinRole('hr'), createFromHandoff);
