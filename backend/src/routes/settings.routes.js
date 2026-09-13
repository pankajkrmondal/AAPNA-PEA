import { Router } from 'express';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { authenticate, requireMinRole } from '../middleware/auth.js';
import {
  listSettings,
  updateSetting,
  listTemplates,
  saveTemplate,
  previewTemplate,
} from '../services/settings.service.js';

/**
 * Settings and email templates.
 *
 * Reading is open to hr and above — HR needs to see what CC list is in force.
 * Changing anything is admin-only: these values decide who gets emailed and
 * whether anything is sent at all (plan §5.4: admin manages users + settings).
 */
const router = Router();

router.use(authenticate, requireMinRole('hr'));

router.get('/', catchAsync(async (_req, res) => success(res, await listSettings())));

router.get('/templates', catchAsync(async (_req, res) => success(res, await listTemplates())));

router.post(
  '/templates/:key/preview',
  catchAsync(async (req, res) => success(res, previewTemplate(req.params.key, req.body || {}), 'Preview — nothing saved or sent'))
);

router.put(
  '/templates/:key',
  requireMinRole('admin'),
  catchAsync(async (req, res) => {
    const r = await saveTemplate(req.params.key, req.body || {}, req.user.username);
    return success(res, r, r.overridden ? 'Template saved' : 'Reset to the built-in wording');
  })
);

router.put(
  '/:key',
  requireMinRole('admin'),
  catchAsync(async (req, res) => {
    const r = await updateSetting(req.params.key, req.body?.value, req.user.username);
    return success(
      res,
      r,
      !r.changed ? 'No change' : r.restart ? 'Saved — takes effect after the backend restarts' : 'Saved'
    );
  })
);

export default router;
