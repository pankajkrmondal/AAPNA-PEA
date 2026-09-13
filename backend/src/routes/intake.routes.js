import { Router } from 'express';
import {
  inbox,
  scan,
  acceptJoiner,
  dismissJoiner,
  confirmLeaver,
  dismissLeaver,
  listRmPlMap,
  upsertRmPlMap,
  seedRmPlMap,
} from '../controllers/intake.controller.js';
import { authenticate, requireMinRole } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

// Read-only: any signed-in user may see what is waiting.
router.get('/inbox', inbox);
router.get('/rm-pl-map', listRmPlMap);

// Everything that changes the roster needs hr-tier or above. Accepting a joiner
// creates an employee and generates six months of evaluation dates, so it is a
// write in every sense.
router.post('/scan', requireMinRole('hr'), scan);
router.post('/joiners/:id/accept', requireMinRole('hr'), acceptJoiner);
router.post('/joiners/:id/dismiss', requireMinRole('hr'), dismissJoiner);
router.post('/leavers/:employeeId/confirm', requireMinRole('hr'), confirmLeaver);
router.post('/leavers/:employeeId/dismiss', requireMinRole('hr'), dismissLeaver);
router.post('/rm-pl-map', requireMinRole('hr'), upsertRmPlMap);
router.post('/rm-pl-map/seed', requireMinRole('hr'), seedRmPlMap);

export default router;
