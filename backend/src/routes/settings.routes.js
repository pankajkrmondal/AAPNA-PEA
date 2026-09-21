import { Router } from 'express';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { authenticate, requireMinRole, requireModule } from '../middleware/auth.js';
import {
  listSettings,
  updateSetting,
  listTemplates,
  saveTemplate,
  resetTemplate,
  previewTemplate,
} from '../services/settings.service.js';

/**
 * Settings and email templates.
 *
 * Reading is open to hr and above — HR needs to see what CC list is in force —
 * provided the Settings or Email templates module is switched on for them.
 * Changing anything is admin-only: these values decide who gets emailed and
 * whether anything is sent at all (plan §5.4: admin manages users + settings).
 * Admins are never restricted by module access, so the write routes need only
 * the role check.
 */
const router = Router();

router.use(authenticate, requireMinRole('hr'));

router.get('/', requireModule('settings'), catchAsync(async (req, res) => success(res, await listSettings(req.user))));

router.get(
  '/templates',
  requireModule('email_templates'),
  catchAsync(async (_req, res) => success(res, await listTemplates()))
);

router.post(
  '/templates/:key/preview',
  requireModule('email_templates'),
  catchAsync(async (req, res) => success(res, previewTemplate(req.params.key, req.body || {}), 'Preview — nothing saved or sent'))
);

router.put(
  '/templates/:key',
  requireMinRole('admin'),
  catchAsync(async (req, res) => {
    const r = await saveTemplate(req.params.key, req.body || {}, req.user.username);
    return success(res, r, r.overridden ? 'Template saved' : 'Saved — this is the default wording');
  })
);

router.delete(
  '/templates/:key',
  requireMinRole('admin'),
  catchAsync(async (req, res) =>
    success(res, await resetTemplate(req.params.key, req.user.username), 'Reset to the default wording')
  )
);

router.put(
  '/:key',
  requireMinRole('admin'),
  catchAsync(async (req, res) => {
    const r = await updateSetting(req.params.key, req.body?.value, req.user.username);
    // A schedule change is applied to the running cron as it is saved, so the
    // usual answer is simply "Saved". `applied: false` means only the restart
    // failed — the value itself is stored and will be picked up either way.
    return success(
      res,
      r,
      !r.changed
        ? 'No change'
        : r.applied
          ? 'Saved'
          : 'Saved — but the new schedule could not be applied yet; it will take effect at the next restart'
    );
  })
);

export default router;
