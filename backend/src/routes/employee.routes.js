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
  recordDecision,
  markLeft,
  markActive,
  archive,
  restore,
  managers,
  exportList,
  listNotes,
  addNote,
  deleteNote,
} from '../controllers/employee.controller.js';
import { employeeFull } from '../controllers/dashboard.controller.js';
import { authenticate, requireMinRole, requireModule } from '../middleware/auth.js';

const router = Router();

// Every employee route needs a signed-in user with the Employees module. The
// public, token-authenticated evaluation form is mounted separately — see
// routes/index.js.
router.use(authenticate, requireModule('employees'));

router.get('/', list);
// U5 / U6 — the list's manager filter and its export. Both sit above `/:id`,
// or Express would read "managers" and "export" as an employee id.
router.get('/managers', managers);
router.get('/export', exportList);
router.get('/:id', getOne);
router.get('/:id/full', employeeFull);
router.get('/:id/report', downloadReport);
// L7 — HR's notes. Only ever served here, behind a signed-in user: the
// Commando's own view and the manager portal have no route to them.
router.get('/:id/notes', listNotes);

// Writes need hr-tier or above.
router.post('/preview-schedule', requireMinRole('hr'), previewSchedule);
router.post('/', requireMinRole('hr'), create);
router.patch('/:id', requireMinRole('hr'), update);
router.post('/:id/halt', requireMinRole('hr'), setHalt);
// U10 — a decision and an exit are their own actions, each with a reason and a
// date, rather than dropdowns inside a general edit.
router.post('/:id/decision', requireMinRole('hr'), recordDecision);
router.post('/:id/mark-left', requireMinRole('hr'), markLeft);
router.post('/:id/mark-active', requireMinRole('hr'), markActive);
// Archive (07-10-2026) — the same people who may mark someone as having left.
router.post('/:id/archive', requireMinRole('hr'), archive);
router.post('/:id/restore', requireMinRole('hr'), restore);
router.post('/:id/report-to-it', requireMinRole('hr'), reportToIt);
// R-05 — sharing discloses a person's ratings and their manager's comments, so
// it is an hr-tier action and is recorded in the employee's change history.
router.post('/:id/share-report', requireMinRole('hr'), shareReport);
router.post('/:id/notes', requireMinRole('hr'), addNote);
router.delete('/:id/notes/:noteId', requireMinRole('hr'), deleteNote);

// Permanent delete — demo and test records only. Admin, and the name must be typed.
router.delete('/:id', requireMinRole('admin'), remove);

export default router;
