import { Router } from 'express';
import {
  inbox,
  syncProblems,
  scan,
  acceptJoiner,
  dismissJoiner,
  confirmLeaver,
  dismissLeaver,
  listRmPlMap,
  upsertRmPlMap,
  seedRmPlMap,
} from '../controllers/intake.controller.js';
import { authenticate, requireMinRole, requireModule } from '../middleware/auth.js';

const router = Router();

// The New joiners module. The RM/PL map is also seeded from Import sheet, so
// its routes admit either module.
const joiners = requireModule('new_joiners');
const rmPlMap = requireModule('new_joiners', 'import_sheet');

router.use(authenticate);

// Read-only: any signed-in user with the module may see what is waiting.
router.get('/inbox', joiners, inbox);
router.get('/sync-problems', joiners, syncProblems);
router.get('/rm-pl-map', rmPlMap, listRmPlMap);

// Everything that changes the roster needs hr-tier or above. Accepting a joiner
// creates an employee and generates six months of evaluation dates, so it is a
// write in every sense.
router.post('/scan', requireMinRole('hr'), joiners, scan);
router.post('/joiners/:id/accept', requireMinRole('hr'), joiners, acceptJoiner);
router.post('/joiners/:id/dismiss', requireMinRole('hr'), joiners, dismissJoiner);
router.post('/leavers/:employeeId/confirm', requireMinRole('hr'), joiners, confirmLeaver);
router.post('/leavers/:employeeId/dismiss', requireMinRole('hr'), joiners, dismissLeaver);
router.post('/rm-pl-map', requireMinRole('hr'), rmPlMap, upsertRmPlMap);
router.post('/rm-pl-map/seed', requireMinRole('hr'), rmPlMap, seedRmPlMap);

export default router;
