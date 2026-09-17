import { Router } from 'express';
import {
  list,
  getOne,
  create,
  update,
  setHalt,
  previewSchedule,
  reportToIt,
  shareReport,
  downloadReport,
  remove,
} from '../controllers/employee.controller.js';
import { employeeFull } from '../controllers/dashboard.controller.js';
import { authenticate, requireMinRole, requireModule } from '../middleware/auth.js';

const router = Router();

// Every employee route needs a signed-in user with the Employees module. The
// public, token-authenticated evaluation form is mounted separately — see
// routes/index.js.
router.use(authenticate, requireModule('employees'));

router.get('/', list);
router.get('/:id', getOne);
router.get('/:id/full', employeeFull);
router.get('/:id/report', downloadReport);

// Writes need hr-tier or above.
router.post('/preview-schedule', requireMinRole('hr'), previewSchedule);
router.post('/', requireMinRole('hr'), create);
router.patch('/:id', requireMinRole('hr'), update);
router.post('/:id/halt', requireMinRole('hr'), setHalt);
router.post('/:id/report-to-it', requireMinRole('hr'), reportToIt);
// R-05 — sharing discloses a person's ratings and their manager's comments, so
// it is an hr-tier action and is recorded in the employee's change history.
router.post('/:id/share-report', requireMinRole('hr'), shareReport);

// Permanent delete — demo and test records only. Admin, and the name must be typed.
router.delete('/:id', requireMinRole('admin'), remove);

export default router;
