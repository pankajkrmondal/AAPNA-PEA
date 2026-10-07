import { Router } from 'express';
import { findPeople, projectLeaderFor } from '../services/directory.service.js';
import { authenticate, requireMinRole, requireModule } from '../middleware/auth.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';

const router = Router();

// U8 — the people picker. It serves the forms that name a reporting manager or
// a project leader: Add and Edit on Commandos, Confirm on New joiners, and
// "Send to someone else" on an evaluation. Those are all hr-tier writes, so the
// picker is hr-tier too, and open to whoever has any one of the three modules.
router.use(authenticate, requireMinRole('hr'), requireModule('employees', 'new_joiners', 'evaluations'));

/**
 * GET /api/directory/people?q=
 *
 * People in Microsoft 365 whose name or address matches, best match first.
 * `available: false` when the directory cannot be read — the form then takes a
 * typed name and email, as it always has.
 */
router.get('/people', catchAsync(async (req, res) => success(res, await findPeople(req.query.q))));

/**
 * GET /api/directory/project-leader?rm_email=
 *
 * The project leader to offer once a reporting manager is chosen: from the
 * Leaders list when it is set, otherwise from the map learned from the roster.
 * An ambiguous mapping returns no address and a note saying why.
 */
router.get(
  '/project-leader',
  catchAsync(async (req, res) => success(res, await projectLeaderFor(req.query.rm_email)))
);

export default router;
