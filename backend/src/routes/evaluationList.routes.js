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
  // H4 (HR, 29-09-2026) — the work list is removed; see the route below.
  // listEvaluations,
  getCounts,
  remindNow,
  listEmails,
} from '../services/evaluationList.service.js';
import { getBoard, getEvaluation, markRead } from '../services/evaluationBoard.service.js';
import { delegate, reopen, recordFollowUp, recordByHr } from '../services/evaluationActions.service.js';

const router = Router();

router.use(authenticate, requireModule('evaluations'));

// H4 (HR, 29-09-2026) — removed, kept for reference. This fed the work list
// screen, which duplicated the board; the board reads /board below.
//
// /** GET /api/evaluations?scope=&search=&rm=&cohort=&dueFrom=&dueTo=&page=&limit= */
// router.get('/', catchAsync(async (req, res) => success(res, await listEvaluations(req.query))));

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

/**
 * GET /api/evaluations/board?status=&search=&rm=&cohort=&from=&to=&sections=1&page=&limit=
 *
 * "What every manager said" — each evaluation with its overall comment, the
 * reason for the decision and every question comment.
 */
router.get('/board', catchAsync(async (req, res) => success(res, await getBoard(req.query, req.user.id))));

/**
 * GET /api/evaluations/:id?status=&search=… — one evaluation, as the profile
 * shows it. The board filters ride along so Previous / Next walk the same list.
 *
 * Registered after every named route above: `/counts`, `/emails` and `/board`
 * would otherwise be read as an id.
 */
router.get('/:id', catchAsync(async (req, res) =>
  success(res, await getEvaluation(req.params.id, req.query, req.user.id))
));

// ── What HR can do to one evaluation — M7, M6, P8, B5 ───────────────────────
// Each changes a record or sends an email, so each needs hr-tier.

/**
 * POST /api/evaluations/:id/delegate   { name, email, note? }
 * Send this one evaluation to an acting manager. The reporting manager is copied.
 */
router.post('/:id/delegate', requireMinRole('hr'), catchAsync(async (req, res) => {
  const result = await delegate(req.params.id, req.body, req.user.username);
  return success(
    res,
    result,
    result.status === 'suppressed'
      ? '"Pause all email" is on — nothing was sent and the evaluation is unchanged.'
      : `Sent to ${result.recipient.name} (${result.sentTo.join(', ')})`
  );
}));

/**
 * POST /api/evaluations/:id/reopen   { reason }
 * Hand a submitted evaluation back to whoever answered it, to be corrected.
 */
router.post('/:id/reopen', requireMinRole('hr'), catchAsync(async (req, res) => {
  const result = await reopen(req.params.id, req.body, req.user.username);
  return success(
    res,
    result,
    result.status === 'sent'
      ? `Reopened and sent back to ${result.sentTo.join(', ')}`
      : 'Reopened. The email could not be sent just now — it goes with the next daily send.'
  );
}));

/** POST /api/evaluations/:id/follow-up   { outcome, note? } — what HR did about flagged feedback. */
router.post('/:id/follow-up', requireMinRole('hr'), catchAsync(async (req, res) =>
  success(res, await recordFollowUp(req.params.id, req.body, req.user.username), 'Follow-up recorded')
));

/**
 * POST /api/evaluations/:id/record   { ratings, remarks?, confirmation_status?, confirmation_reason? }
 * HR enters the ratings in the app on the manager's behalf.
 */
router.post('/:id/record', requireMinRole('hr'), catchAsync(async (req, res) => {
  const result = await recordByHr(req.params.id, req.body, req.user.username);
  return success(res, result, `Evaluation recorded — average ${result.average.toFixed(2)} / 5`);
}));

/** POST /api/evaluations/:id/read — this user has read it; clears "Read feedback" for them only. */
router.post('/:id/read', catchAsync(async (req, res) =>
  success(res, { stored: await markRead(req.params.id, req.user.id) })
));

export default router;
