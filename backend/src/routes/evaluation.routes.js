import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { getForm, submitForm } from '../controllers/evaluation.controller.js';
import { noStore } from '../middleware/noStore.js';

const router = Router();

/**
 * PUBLIC routes — intentionally NO authenticate middleware.
 *
 * Reporting managers and project leaders have no PEA account and never will;
 * requiring one would recreate the access problem the migration exists to
 * remove. The UUID token in the URL is the only credential, validated in the
 * service: it identifies exactly one evaluation cycle, is single-use, and
 * expires on submission.
 *
 * This mirrors ATS scorecard.routes.js, which solves the same problem for
 * interviewers.
 */

// Generous, because a manager may legitimately reload, hit a validation error
// and resubmit several times. Tight enough that the token space cannot be
// probed at speed.
const formLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please wait a few minutes and try again.',
});

router.use(formLimiter);

// The page depends on state HR can change at any moment (pause, resume,
// re-send, submit), so a browser must never reuse an earlier response.
router.use(noStore);

// Form bodies arrive urlencoded from the browser; app.js also parses JSON for
// API clients.
router.get('/:token', getForm);
router.post('/:token/submit', submitForm);

export default router;
