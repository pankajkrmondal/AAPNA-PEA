import { Router } from 'express';
import {
  sweepNow,
  sendEvaluationNow,
  getShadowReport,
  diagnostics,
} from '../controllers/admin.controller.js';
import { authenticate, requireMinRole } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// Read-only operational views: any signed-in user may check whether the system
// is actually going to send anything.
router.get('/diagnostics', diagnostics);
router.get('/shadow-report', getShadowReport);

// Actions that put mail on the wire need hr-tier or above.
router.post('/sweep', requireMinRole('hr'), sweepNow);
router.post('/send-evaluation', requireMinRole('hr'), sendEvaluationNow);

export default router;
