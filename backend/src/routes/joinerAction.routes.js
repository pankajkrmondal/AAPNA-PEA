/**
 * joinerAction.routes.js — PUBLIC. Old Confirm / Not confirm links from the new
 * joiner review email. Walkthrough (27-10-2026) W-09.
 *
 * 30-10-2026 — a redirect only. The buttons open New joiners behind sign-in now
 * (joinerEmailLink.service.js), so this route no longer shows a page or changes
 * anything: a link sent before the change is sent on to the same joiner on the
 * New joiners screen, where PEA asks for sign-in. The links lasted 72 hours, so
 * delete this route — and verifyAction() — in the release after.
 *
 * It was GET → a page with one button (views/joinerAction.js) and POST → the
 * action without a sign-in (services/joinerEmailAction.service.js). Both files
 * are removed.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import config from '../config/index.js';
import { noStore } from '../middleware/noStore.js';
import { verifyAction, joinerLink } from '../services/joinerEmailLink.service.js';

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

/** The same joiner on New joiners; an expired or broken link opens the list. */
function target(token) {
  const base = String(config.frontendUrl || '').replace(/\/+$/, '');
  try {
    const p = verifyAction(token);
    return joinerLink(base, p.cid, p.act);
  } catch {
    return `${base}/new-joiners`;
  }
}

/** GET /api/joiner-action/:token — the button in an old email. */
router.get('/:token', (req, res) => res.redirect(302, target(req.params.token)));

/** POST /api/joiner-action/:token — the button on a page opened before the change. Does nothing either. */
router.post('/:token', (req, res) => res.redirect(303, target(req.params.token)));

export default router;
