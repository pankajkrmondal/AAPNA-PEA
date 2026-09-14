import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import { authenticate, requireMinRole, requireModule } from '../middleware/auth.js';
import { createSelfViewLink, getSelfView, currentLevel } from '../services/selfView.service.js';

/** HR side, mounted at /api/self-view-links. Issued from an employee's page. */
export const selfViewLinksRouter = Router();

selfViewLinksRouter.use(authenticate, requireModule('employees'));

selfViewLinksRouter.get('/level', catchAsync(async (_req, res) => success(res, { level: await currentLevel() })));

selfViewLinksRouter.post(
  '/:employeeId',
  requireMinRole('hr'),
  catchAsync(async (req, res) =>
    success(res, await createSelfViewLink(req.params.employeeId, req.user.username), 'Link created — copy it to the employee', 201)
  )
);

/** PUBLIC, mounted at /api/self-view. The signed link is the only credential. */
export const selfViewPublicRouter = Router();

selfViewPublicRouter.use(
  rateLimit({ windowMs: 10 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false })
);

selfViewPublicRouter.get('/:token', catchAsync(async (req, res) => success(res, await getSelfView(req.params.token))));
