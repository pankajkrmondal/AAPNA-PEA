/**
 * joinerAction.routes.js — PUBLIC. Confirm / Not confirm from the new joiner
 * review email. Walkthrough (27-10-2026) W-09.
 *
 * No authenticate middleware, like the manager's evaluation form: the signed
 * link is the credential (joinerEmailLink.service.js). GET only shows what will
 * happen; POST — the page's one button — does it.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import logger from '../config/logger.js';
import { noStore } from '../middleware/noStore.js';
import { loadAction, performAction } from '../services/joinerEmailAction.service.js';
import { renderActionPage, renderActionDone, renderActionProblem } from '../views/joinerAction.js';

const router = Router();

// Tight enough that the link space cannot be probed; HR opens a handful a day.
const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please wait a few minutes and try again.',
});

router.use(limiter, noStore);

/** Any refusal becomes a page, never JSON: a person opened this from an email. */
function problem(res, err) {
  // AppError carries the number in statusCode; its `status` is 'fail' / 'error'.
  const status = Number.isInteger(err?.statusCode) ? err.statusCode : 500;
  if (status >= 500) logger.error(`Joiner email action failed: ${err?.message}`);
  return res
    .status(status)
    .type('html')
    .send(renderActionProblem(status >= 500 ? 'Something went wrong. Open New joiners in PEA instead.' : err.message, status));
}

/** GET /api/joiner-action/:token — what the button will do. Changes nothing. */
router.get('/:token', async (req, res) => {
  try {
    const data = await loadAction(req.params.token);
    return res.type('html').send(renderActionPage(data));
  } catch (err) {
    return problem(res, err);
  }
});

/** POST /api/joiner-action/:token — the button. */
router.post('/:token', async (req, res) => {
  try {
    const result = await performAction(req.params.token);
    return res.type('html').send(renderActionDone(result));
  } catch (err) {
    return problem(res, err);
  }
});

export default router;
