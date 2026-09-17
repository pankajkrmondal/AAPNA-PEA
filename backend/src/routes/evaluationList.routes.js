/**
 * evaluationList.routes.js — the Evaluations screen.
 *
 * Read routes need only the module; sending a reminder is a real email to a
 * real manager, so it needs hr-tier as every other send does.
 */
import { Router } from 'express';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { authenticate, requireMinRole, requireModule } from '../middleware/auth.js';
import {
  listEvaluations,
  getCounts,
  remindNow,
  listEmails,
} from '../services/evaluationList.service.js';

const router = Router();

router.use(authenticate, requireModule('evaluations'));

/** GET /api/evaluations?scope=&search=&rm=&cohort=&dueFrom=&dueTo=&page=&limit= */
router.get('/', catchAsync(async (req, res) => success(res, await listEvaluations(req.query))));

/** GET /api/evaluations/counts — the tab badges, and the Overview figures. */
router.get('/counts', catchAsync(async (_req, res) => success(res, await getCounts())));

/** GET /api/evaluations/emails — every email PEA has sent. */
router.get('/emails', catchAsync(async (req, res) => success(res, await listEmails(req.query))));

/**
 * POST /api/evaluations/remind   { ids: [...] }
 *
 * Nudges the link the manager already has. Unlike "Resend" on the employee
 * page this does not issue a new token, so a manager midway through the form
 * does not lose their work.
 */
router.post('/remind', requireMinRole('hr'), catchAsync(async (req, res) => {
  const result = await remindNow(req.body?.ids, req.user.username);

  const parts = [`${result.sent} reminder${result.sent === 1 ? '' : 's'} sent`];
  if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);

  return success(res, result, parts.join(', '));
}));

export default router;
