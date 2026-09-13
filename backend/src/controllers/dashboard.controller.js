import { getDashboard, getDataQuality } from '../services/dashboard.service.js';
import { buildWorkbook, exportFilename } from '../services/export.service.js';
import { getEmployee } from '../services/employee.service.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';

/** GET /api/dashboard */
export const dashboard = catchAsync(async (_req, res) => success(res, await getDashboard()));

/** GET /api/dashboard/data-quality */
export const dataQuality = catchAsync(async (_req, res) => success(res, await getDataQuality()));

/** GET /api/dashboard/export?type=&employment_status= */
export const exportExcel = catchAsync(async (req, res) => {
  const buffer = await buildWorkbook(req.query);
  res
    .status(200)
    .set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${exportFilename()}"`,
      'Content-Length': buffer.length,
    })
    .send(buffer);
});

/**
 * GET /api/employees/:id/full — the employee detail screen in one call.
 *
 * PEA reads only its own data. It is a separate project from ATS with its own
 * database (decision D5, 13 Sep 2026): ATS covers hiring, PEA covers probation
 * after joining — whether the person came through ATS, a referral, or directly.
 */
export const employeeFull = catchAsync(async (req, res) => success(res, await getEmployee(req.params.id)));
