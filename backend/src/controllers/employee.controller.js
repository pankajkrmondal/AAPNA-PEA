import * as employeeService from '../services/employee.service.js';
import * as reportService from '../services/evaluationReport.service.js';
import { buildSchedule } from '../services/cycleGenerator.service.js';
import catchAsync from '../utils/catchAsync.js';
import { success, paginated } from '../utils/apiResponse.js';
import { toDateString } from '../utils/dateUtils.js';

/** GET /api/employees */
export const list = catchAsync(async (req, res) => {
  const { rows, total, page, limit } = await employeeService.listEmployees(req.query);
  return paginated(res, rows, page, limit, total);
});

/** GET /api/employees/:id */
export const getOne = catchAsync(async (req, res) =>
  success(res, await employeeService.getEmployee(req.params.id))
);

/**
 * POST /api/employees/:id/share-report — R-05.
 *
 * Subhajit, 15-Sep (19:44): a senior leader asks for a resource's current
 * status and HR answers "within one click". The recipient is typed here
 * because it is whoever happened to ask.
 */
export const shareReport = catchAsync(async (req, res) => {
  const result = await reportService.shareReport(req.params.id, req.body, req.user.username);

  return success(
    res,
    result,
    result.sent
      ? `Report sent to ${result.to.join(', ')}`
      : `The report could not be sent (${result.status}). Nothing was delivered.`
  );
});

/**
 * GET /api/employees/:id/report — the same report as a file, for HR to attach
 * to a Teams chat or take into a meeting.
 */
export const downloadReport = catchAsync(async (req, res) => {
  const report = await reportService.buildReport(req.params.id);
  const buffer = reportService.buildWorkbook(report);
  const filename = reportService.reportFilename(report);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(buffer);
});

/** POST /api/employees */
export const create = catchAsync(async (req, res) => {
  const employee = await employeeService.createEmployee(req.body, req.user.username);
  return success(res, employee, 'Employee added and evaluation schedule created', 201);
});

/** PATCH /api/employees/:id */
export const update = catchAsync(async (req, res) => {
  const employee = await employeeService.updateEmployee(req.params.id, req.body, req.user.username);
  return success(res, employee, 'Employee updated');
});

/**
 * POST /api/employees/:id/report-to-it   { field, correct_value, note? }
 * Goes through the email choke point, so outside production it reaches only
 * the test inbox.
 */
export const reportToIt = catchAsync(async (req, res) => {
  const result = await employeeService.reportToIt(req.params.id, req.body, req.user.username);
  return success(
    res,
    result,
    result.status === 'failed'
      ? `Could not send: ${result.error}`
      : result.status === 'suppressed'
        ? 'Logged — "Pause all email" is on, so nothing was sent'
        : result.redirected
          ? `Sent to the test inbox (${result.sentTo.join(', ')}) — staging never mails IT directly`
          : 'Sent to IT'
  );
});

/** DELETE /api/employees/:id   { confirm_name } — admin only. */
export const remove = catchAsync(async (req, res) => {
  const result = await employeeService.deleteEmployee(req.params.id, req.body?.confirm_name, req.user.username);
  return success(res, result, `${result.full_name} deleted`);
});

/** POST /api/employees/:id/halt   { halt: true|false } */
export const setHalt = catchAsync(async (req, res) => {
  const halt = req.body?.halt !== false;
  const employee = await employeeService.setHalt(req.params.id, halt, req.user.username);
  return success(res, employee, halt ? 'Evaluations paused' : 'Evaluations resumed');
});

/**
 * POST /api/employees/preview-schedule   { doj, is_experienced }
 *
 * Shows the dates an employee WOULD get, before saving. Cheap to provide and
 * it makes the cadence rule visible to HR instead of implicit — the old system
 * offered no way to see the schedule at all.
 */
export const previewSchedule = catchAsync(async (req, res) => {
  const schedule = buildSchedule({
    doj: req.body.doj,
    is_experienced: req.body.is_experienced === true || req.body.is_experienced === 'true',
  });

  return success(
    res,
    schedule.map((c) => ({
      seq_no: c.seq_no,
      due_date: toDateString(c.due_date),
      period_from: toDateString(c.period_from),
      period_to: toDateString(c.period_to),
    })),
    'Schedule preview — nothing has been saved'
  );
});
