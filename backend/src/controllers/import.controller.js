import { parseWorkbook, importWorkbook } from '../services/excelImport.service.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import AppError from '../utils/AppError.js';
import { toDateString } from '../utils/dateUtils.js';

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
      preview: valid.slice(0, 20).map((v) => ({
        excelRow: v.excelRow,
        full_name: v.full_name,
        office_email: v.office_email,
        type: v.is_experienced ? 'experienced' : 'fresher',
        doj: toDateString(v.doj),
        rm_email: v.rm_email,
        confirmation_status: v.confirmation_status,
        auto_confirmed: v.auto_confirmed,
        halt_process: v.halt_process,
        evaluationsToCreate: v.is_experienced ? 3 : 6,
      })),
    },
    'Preview only — nothing has been saved'
  );
});

/**
 * POST /api/import/excel?dryRun=true   (multipart: file)
 * Imports the workbook. Idempotent on office_email.
 */
export const importExcel = catchAsync(async (req, res) => {
  if (!req.file) throw new AppError('No file uploaded. Attach the Excel workbook as "file".', 400);

  const dryRun = req.query.dryRun === 'true';
  const result = await importWorkbook(req.file.buffer, req.user.username, { dryRun });

  return success(
    res,
    result,
    dryRun
      ? `Dry run: ${result.createdRows.length} row(s) would import; ${result.rejected} rejected, ${result.skippedExisting} already present`
      : `Imported ${result.imported} employee(s); ${result.rejected} rejected, ${result.skippedExisting} already present`
  );
});
