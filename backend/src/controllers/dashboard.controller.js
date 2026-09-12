import { getDashboard, getDataQuality } from '../services/dashboard.service.js';
import { getHistory, searchCandidates, pendingHandoffs } from '../services/atsHistory.service.js';
import { buildWorkbook, exportFilename } from '../services/export.service.js';
import { createEmployee, getEmployee, updateEmployee } from '../services/employee.service.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';
import AppError from '../utils/AppError.js';
import prisma from '../config/database.js';
import { toDateString } from '../utils/dateUtils.js';

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

/** GET /api/employees/:id/ats-history */
export const atsHistory = catchAsync(async (req, res) => {
  const employee = await prisma.pea_employees.findUnique({
    where: { id: BigInt(req.params.id) },
    select: { id: true, full_name: true, ats_pipeline_id: true, personal_email: true },
  });
  if (!employee) throw new AppError('Employee not found', 404);

  const history = await getHistory(employee.ats_pipeline_id);

  return success(res, {
    employee: { id: String(employee.id), full_name: employee.full_name },
    // Being explicit about "not linked" matters: ATS holds only the personal
    // email and PEA holds the office one, so there is no automatic match and an
    // empty panel must not read as "this person had no interviews". Plan R4.
    ...(history || {
      linked: false,
      reason:
        'Not linked to an ATS record. ATS stores only the personal (CV) email and PEA stores the ' +
        'office email, so the link is made explicitly — either by creating the employee from an ' +
        'accepted offer, or by searching for the candidate.',
    }),
  });
});

/** GET /api/ats/search?q= */
export const searchAts = catchAsync(async (req, res) =>
  success(res, await searchCandidates(req.query.q, 10))
);

/** GET /api/ats/handoffs — accepted offers with no PEA employee yet */
export const handoffs = catchAsync(async (_req, res) => {
  const rows = await pendingHandoffs(50);
  return success(
    res,
    rows.map((r) => ({
      ...r,
      pipeline_id: String(r.pipeline_id),
      joining_date: r.joining_date ? toDateString(r.joining_date) : null,
    })),
    `${rows.length} accepted offer(s) not yet tracked in PEA`
  );
});

/**
 * POST /api/ats/handoffs/:pipelineId/create
 *
 * Create a PEA employee from an accepted ATS offer.
 *
 * The DOJ comes from rpa_offers.joining_date — the date actually agreed with
 * the candidate during the offer process. That removes the manual date entry
 * that caused the format problem the migration set out to fix, and sets a hard
 * ats_pipeline_id link with no guessing.
 */
export const createFromHandoff = catchAsync(async (req, res) => {
  const pipelineId = BigInt(req.params.pipelineId);

  const [row] = await prisma.$queryRaw`
    SELECT s.candidate_name, s.candidate_email, o.joining_date, o.candidate_decision
      FROM rpa_offers o
      JOIN rpa_candidate_pipeline p ON p.id = o.pipeline_id
      JOIN rpa_shortlisted_candidates s ON s.id = p.shortlist_id
     WHERE p.id = ${pipelineId}`;

  if (!row) throw new AppError('No ATS offer found for that pipeline id', 404);
  if (!row.joining_date) throw new AppError('That ATS offer has no joining date recorded', 400);

  const { office_email: officeEmail, rm_name: rmName, rm_email: rmEmail, pl_email: plEmail, is_experienced } =
    req.body || {};

  if (!officeEmail || !rmName || !rmEmail || !plEmail) {
    throw new AppError(
      'office_email, rm_name, rm_email and pl_email are required — ATS does not hold any of these.',
      400
    );
  }

  const employee = await createEmployee(
    {
      full_name: row.candidate_name,
      office_email: officeEmail,
      personal_email: row.candidate_email,
      doj: toDateString(row.joining_date),
      is_experienced: is_experienced === true || is_experienced === 'true',
      rm_name: rmName,
      rm_email: rmEmail,
      pl_email: plEmail,
      ats_pipeline_id: String(pipelineId),
    },
    req.user.username,
    'ats'
  );

  return success(res, employee, `Created from ATS offer — DOJ ${toDateString(row.joining_date)}`, 201);
});

/** POST /api/employees/:id/link-ats  { pipeline_id } */
export const linkAts = catchAsync(async (req, res) => {
  const { pipeline_id: pipelineId } = req.body || {};
  if (!pipelineId) throw new AppError('pipeline_id is required', 400);

  const employee = await updateEmployee(
    req.params.id,
    { ats_pipeline_id: pipelineId },
    req.user.username,
    'ats'
  );

  return success(res, employee, 'Linked to the ATS record');
});

/** GET /api/employees/:id/full — employee detail plus ATS history in one call */
export const employeeFull = catchAsync(async (req, res) => {
  const employee = await getEmployee(req.params.id);
  const history = await getHistory(employee.ats_pipeline_id);
  return success(res, { ...employee, atsHistory: history || { linked: false } });
});
