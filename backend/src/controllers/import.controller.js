import { parseWorkbook, importWorkbook } from '../services/excelImport.service.js';
import { buildTemplate, TEMPLATE_FILENAME } from '../services/export.service.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import AppError from '../utils/AppError.js';
import { toDateString } from '../utils/dateUtils.js';
import { isAdminTier } from '../config/roles.js';

/**
 * POST /api/import/preview   (multipart: file)
 *
 * Parses the workbook and returns the reconciliation report WITHOUT writing
 * anything. This is the screen HR reviews and signs off before the real import
 * — plan R5 requires the migration to be reviewed, not silent.
 */
export const preview = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded. Attach the Excel workbook as "file".', 400);

  const { valid, rejected, report } = parseWorkbook(req.file.buffer);

  return success(
    res,
    {
      ...report,
      rejectedRows: rejected,
      // Excel import (28-10-2026) — `auto_confirmed` is gone with the rule, and
      // the count includes extension evaluations. It was:
      // auto_confirmed: v.auto_confirmed, evaluationsToCreate: v.is_experienced ? 3 : 6,
      preview: valid.slice(0, 20).map((v) => ({
        excelRow: v.excelRow,
        full_name: v.full_name,
        office_email: v.office_email,
        type: v.is_experienced ? 'experienced' : 'fresher',
        doj: toDateString(v.doj),
        rm_email: v.rm_email,
        confirmation_status: v.confirmation_status,
        halt_process: v.halt_process,
        evaluationsToCreate: v.evaluationCount,
      })),
    },
    'Checked — nothing has been saved'
  );
});

/**
 * GET /api/import/template — the empty workbook to fill in (Excel import,
 * 28-10-2026). The layout the importer reads, with a "How to fill" sheet.
 */
export const template = catchAsync(async (_req, res) => {
  const buffer = buildTemplate();
  res
    .status(200)
    .set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${TEMPLATE_FILENAME}"`,
      'Content-Length': buffer.length,
    })
    .send(buffer);
});

/**
 * POST /api/import/excel?dryRun=true   (multipart: file)
 * Imports the workbook. Idempotent on office_email.
 */
export const importExcel = catchAsync(async (req, res) => {
  const dryRun = req.query.dryRun === 'true';
  // A test run writes nothing, so HR may run it; only the real import is admin-only.
  if (!dryRun && !isAdminTier(req.user.role)) {
    throw new AppError('You do not have permission to do that', 403);
  }

  if (!req.file) throw new AppError('No file uploaded. Attach the Excel workbook as "file".', 400);

  const result = await importWorkbook(req.file.buffer, req.user.username, { dryRun });

  return success(
    res,
    result,
    dryRun
      ? `Test run: ${result.createdRows.length} row(s) would import; ${result.rejected} rejected, ${result.skippedExisting} already in PEA. Nothing was saved.`
      : `Imported ${result.imported} Commando(s); ${result.rejected} rejected, ${result.skippedExisting} already in PEA`
  );
});
