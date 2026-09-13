import { Router } from 'express';
import {
  list,
  getOne,
  create,
  update,
  setHalt,
  previewSchedule,
  reportToIt,
} from '../controllers/employee.controller.js';
import { employeeFull } from '../controllers/dashboard.controller.js';
import { authenticate, requireMinRole } from '../middleware/auth.js';

const router = Router();

// Every employee route needs a signed-in user. The public, token-authenticated
// evaluation form is mounted separately — see routes/index.js.
router.use(authenticate);

router.get('/', list);
router.get('/:id', getOne);
router.get('/:id/full', employeeFull);

// Writes need hr-tier or above; `viewer` is read-only reporting.
router.post('/preview-schedule', requireMinRole('hr'), previewSchedule);
router.post('/', requireMinRole('hr'), create);
router.patch('/:id', requireMinRole('hr'), update);
router.post('/:id/halt', requireMinRole('hr'), setHalt);
router.post('/:id/report-to-it', requireMinRole('hr'), reportToIt);

export default router;
