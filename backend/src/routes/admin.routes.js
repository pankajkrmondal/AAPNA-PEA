import { Router } from 'express';
import {
  sweepNow,
  sendEvaluationNow,
  getShadowReport,
  diagnostics,
} from '../controllers/admin.controller.js';
import { authenticate, requireMinRole, requireModule } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// Read-only operational views: any signed-in user may check whether the system
// is actually going to send anything.
router.get('/diagnostics', diagnostics);
router.get('/shadow-report', getShadowReport);

// Actions that put mail on the wire need hr-tier or above, plus the module of
// the screen they are triggered from.
router.post('/sweep', requireMinRole('hr'), requireModule('dashboard'), sweepNow);
router.post('/send-evaluation', requireMinRole('hr'), requireModule('employees'), sendEvaluationNow);

export default router;
