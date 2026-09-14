import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { authenticate, requireMinRole, requireModule } from '../middleware/auth.js';
import { noStore } from '../middleware/noStore.js';
import {
  listManagers,
  listLinks,
  createLink,
  revokeLink,
  getTeamView,
} from '../services/managerPortal.service.js';

/** HR side — issue and revoke links. Mounted at /api/manager-links. */
export const managerLinksRouter = Router();

managerLinksRouter.use(authenticate, requireModule('manager_portal'));

managerLinksRouter.get('/managers', catchAsync(async (_req, res) => success(res, await listManagers())));
managerLinksRouter.get('/', catchAsync(async (_req, res) => success(res, await listLinks())));

managerLinksRouter.post(
  '/',
  requireMinRole('hr'),
  catchAsync(async (req, res) => {
    const link = await createLink(req.body, req.user.username);
    const e = link.email;
    return success(
      res,
      link,
      !e
        ? 'Link created — copy it to share'
        : e.status === 'failed'
          ? `Link created, but the email failed: ${e.error}`
          : e.status === 'suppressed'
            ? 'Link created — shadow mode is on, so the email was logged, not sent'
            : e.redirected
              ? `Link created and emailed to the test inbox (${e.sentTo.join(', ')}) — staging never mails managers`
              : 'Link created and emailed to the manager',
      201
    );
  })
);

managerLinksRouter.post(
  '/:id/revoke',
  requireMinRole('hr'),
  catchAsync(async (req, res) => success(res, await revokeLink(req.params.id, req.user.username), 'Link revoked'))
);

/**
 * PUBLIC — no authenticate middleware. Mounted at /api/manager.
 * The token is the credential, exactly as for the evaluation form.
 */
export const managerPublicRouter = Router();

managerPublicRouter.use(
  rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests. Please wait a few minutes and try again.',
  }),
  noStore
);

managerPublicRouter.get('/:token', catchAsync(async (req, res) => success(res, await getTeamView(req.params.token))));
