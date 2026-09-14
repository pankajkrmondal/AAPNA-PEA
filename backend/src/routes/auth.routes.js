import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, me, changePassword, forgotPassword, resetPassword } from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// Brute-force guard on the credential endpoint only.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many sign-in attempts. Try again in 15 minutes.' },
});

// Username + password only. Microsoft SSO was removed on 13 Sep (HR decision).
router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.get('/me', authenticate, me);
// Same limiter as login: it also accepts a password guess.
router.post('/change-password', loginLimiter, authenticate, changePassword);

// Each request can send an email, so tighter than sign-in.
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'fail', message: 'Too many password reset requests. Try again in 15 minutes.' },
});

// Public: "Forgot password?" on the sign-in page, and the emailed link.
router.post('/forgot-password', forgotLimiter, forgotPassword);
router.post('/reset-password', loginLimiter, resetPassword);

export default router;
