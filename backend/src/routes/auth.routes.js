import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, me, changePassword } from '../controllers/auth.controller.js';
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

export default router;
