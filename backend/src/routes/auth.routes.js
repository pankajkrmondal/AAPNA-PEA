import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { login, logout, me } from '../controllers/auth.controller.js';
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

router.post('/login', loginLimiter, login);
router.post('/logout', logout);
router.get('/me', authenticate, me);

export default router;
