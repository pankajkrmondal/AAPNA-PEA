import { Router } from 'express';
import prisma from '../config/database.js';
import config from '../config/index.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import authRoutes from './auth.routes.js';
import employeeRoutes from './employee.routes.js';
import importRoutes from './import.routes.js';
import evaluationRoutes from './evaluation.routes.js';
import adminRoutes from './admin.routes.js';

const router = Router();

/**
 * GET /api/health
 *
 * Reports database reachability and — importantly — whether the app is
 * currently suppressing outbound mail. Both shadow mode and the non-prod email
 * guard are easy to leave in the wrong state, and either one silently means
 * "no manager receives anything", so surface them where anyone can check.
 */
router.get(
  '/health',
  catchAsync(async (_req, res) => {
    let database = 'up';
    let shadowMode = null;

    try {
      const setting = await prisma.pea_settings.findUnique({
        where: { setting_key: 'shadow_mode' },
      });
      shadowMode = setting?.setting_value === 'true';
    } catch {
      database = 'down';
    }

    return success(res, {
      service: 'pea-backend',
      status: database === 'up' ? 'ok' : 'degraded',
      env: config.env,
      port: config.port,
      database,
      email: {
        shadowMode,
        redirectInNonProd: config.email.redirectInNonProd,
        sender: config.microsoft.sender || '(not configured)',
      },
      scheduler: {
        enabled: config.scheduler.enabled,
        timezone: config.scheduler.timezone,
      },
      timestamp: new Date().toISOString(),
    });
  })
);

router.use('/auth', authRoutes);
router.use('/employees', employeeRoutes);
router.use('/import', importRoutes);
router.use('/admin', adminRoutes);

// PUBLIC — no authenticate middleware. The token in the URL is the credential;
// reporting managers have no PEA account. See evaluation.routes.js.
router.use('/evaluation', evaluationRoutes);

export default router;
