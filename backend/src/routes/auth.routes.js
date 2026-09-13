import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, me, changePassword } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import config from '../config/index.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import { success } from '../utils/apiResponse.js';
import { ssoStatus, buildStartUrl, completeSignIn } from '../services/sso.service.js';

const router = Router();

// Brute-force guard on the credential endpoint only.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many sign-in attempts. Try again in 15 minutes.' },
});

router.post('/login', loginLimiter, login);

// ── Microsoft sign-in ─────────────────────────────────────────────────────
// The browser is redirected, not called with fetch, so outcomes return as a
// redirect to the login page. The session token travels in the URL FRAGMENT:
// a fragment is never sent to a server, so it never lands in nginx access logs
// or a Referer header.
const loginPage = () => `${config.frontendUrl.replace(/\/+$/, '')}/login`;

router.get('/sso/config', (_req, res) => success(res, { enabled: ssoStatus().enabled }));

router.get('/sso/start', loginLimiter, (_req, res) => {
  try {
    res.redirect(302, buildStartUrl());
  } catch (err) {
    res.redirect(302, `${loginPage()}#sso_error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/sso/callback', loginLimiter, async (req, res) => {
  try {
    const { token } = await completeSignIn(req.query);
    res.redirect(302, `${loginPage()}#sso_token=${encodeURIComponent(token)}`);
  } catch (err) {
    const message = err instanceof AppError ? err.message : 'Microsoft sign-in failed';
    if (!(err instanceof AppError)) logger.error(`SSO callback error: ${err.message}`, { stack: err.stack });
    res.redirect(302, `${loginPage()}#sso_error=${encodeURIComponent(message)}`);
  }
});
router.post('/logout', logout);
router.get('/me', authenticate, me);
// Same limiter as login: it also accepts a password guess.
router.post('/change-password', loginLimiter, authenticate, changePassword);

export default router;
