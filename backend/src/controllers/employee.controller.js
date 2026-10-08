import * as employeeService from '../services/employee.service.js';
import * as reportService from '../services/evaluationReport.service.js';
import * as archiveService from '../services/archive.service.js';
import { buildWorkbook, exportFilename } from '../services/export.service.js';
import { buildSchedule } from '../services/cycleGenerator.service.js';
import catchAsync from '../utils/catchAsync.js';
import { success, paginated } from '../utils/apiResponse.js';
import { toDateString, todayIn } from '../utils/dateUtils.js';
import config from '../config/index.js';

/** GET /api/employees */
export const list = catchAsync(async (req, res) => {
  const { rows, total, page, limit } = await employeeService.listEmployees(req.query);
  return paginated(res, rows, page, limit, total);
});

/** GET /api/employees/managers — reporting managers, for the list's manager filter (U5). */
export const managers = catchAsync(async (_req, res) => success(res, await employeeService.listManagers()));

/**
 * GET /api/employees/export?search=&type=&state=&rm=&sort=&order= — U6.
 *
 * The Commandos list as a file: the same workbook the Dashboard exports,
 * narrowed and ordered the way the list on screen is.
 */
export const exportList = catchAsync(async (req, res) => {
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

/** GET /api/employees/:id */
export const getOne = catchAsync(async (req, res) =>
  success(res, await employeeService.getEmployee(req.params.id))
);

/** GET /api/employees/:id/notes — HR's notes on this Commando (L7). */
export const listNotes = catchAsync(async (req, res) =>
  success(res, await employeeService.listNotes(req.params.id, req.user))
);

/** POST /api/employees/:id/notes   { body } */
export const addNote = catchAsync(async (req, res) => {
  const note = await employeeService.addNote(req.params.id, req.body, req.user.username);
  return success(res, note, 'Note added', 201);
});

/** DELETE /api/employees/:id/notes/:noteId — whoever wrote it, or an admin. */
export const deleteNote = catchAsync(async (req, res) => {
  const result = await employeeService.deleteNote(req.params.id, req.params.noteId, req.user);
  return success(res, result, 'Note deleted');
});

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
  return success(res, employee, 'Commando added and evaluation schedule created', 201);
});

/**
 * PATCH /api/employees/:id
 *
 * U10 — a decision and an exit are no longer part of a general edit: each has
 * its own route below, with a reason and a date. So the two fields are dropped
 * here whatever a client sends. The service still accepts them, for the
 * callers that are not HR typing into a form.
 */
export const update = catchAsync(async (req, res) => {
  // U10 — was: updateEmployee(req.params.id, req.body, req.user.username)
  const { confirmation_status: _decision, employment_status: _employment, ...body } = req.body || {};
  const employee = await employeeService.updateEmployee(req.params.id, body, req.user.username);
  return success(res, employee, 'Commando updated');
});

/**
 * POST /api/employees/:id/decision   { decision, reason, date? }
 *
 * `decision` is Confirmed, Not Confirmed, Extend for 1 month, Extend for 2
 * months, or blank to go back to "In probation".
 */
export const recordDecision = catchAsync(async (req, res) => {
  const employee = await employeeService.recordDecision(req.params.id, req.body, req.user.username);
  const meta = employee._meta;
  return success(
    res,
    employee,
    meta.extensionCycles
      ? `Decision recorded — ${meta.extensionCycles} extension evaluation${meta.extensionCycles === 1 ? '' : 's'} scheduled`
      : meta.closedEvaluations
        ? `Decision recorded — ${meta.closedEvaluations} open evaluation${meta.closedEvaluations === 1 ? '' : 's'} closed`
        : 'Decision recorded'
  );
});

/** POST /api/employees/:id/mark-left   { reason, left_on? } */
export const markLeft = catchAsync(async (req, res) => {
  const employee = await employeeService.markLeft(req.params.id, req.body, req.user.username);
  return success(res, employee, `${employee.full_name} marked as having left — evaluations will stop`);
});

/**
 * POST /api/employees/:id/archive   { reason? }
 *
 * Archive (07-10-2026) — someone whose probation is over (confirmed, not
 * confirmed, or left) moves out of the day-to-day lists, as a read-only record.
 */
export const archive = catchAsync(async (req, res) => {
  await archiveService.archiveEmployee(req.params.id, req.body, req.user.username);
  const employee = await employeeService.getEmployee(req.params.id);
  return success(res, employee, `${employee.full_name} archived — find them under Commandos → Status → Archived`);
});

/** POST /api/employees/:id/restore — Archive (07-10-2026): back into the lists. */
export const restore = catchAsync(async (req, res) => {
  await archiveService.restoreEmployee(req.params.id, req.user.username);
  const employee = await employeeService.getEmployee(req.params.id);
  return success(res, employee, `${employee.full_name} restored from the archive`);
});

/** POST /api/employees/:id/mark-active   { reason } */
export const markActive = catchAsync(async (req, res) => {
  const employee = await employeeService.markActive(req.params.id, req.body, req.user.username);
  return success(res, employee, `${employee.full_name} marked as active again`);
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
  // B5 — `past_due_action` says what to do with evaluations that fell due
  // during the hold: send_all (as before), send_latest, or close. It was:
  //   const employee = await employeeService.setHalt(req.params.id, halt, req.user.username);
  //   return success(res, employee, halt ? 'Evaluations paused' : 'Evaluations resumed');
  const employee = await employeeService.setHalt(req.params.id, halt, req.user.username, req.body?.past_due_action);
  const closed = employee._meta?.pastDueClosed;
  return success(
    res,
    employee,
    halt
      ? 'Evaluations paused'
      : closed
        ? `Evaluations resumed — ${closed} past-due evaluation${closed === 1 ? '' : 's'} closed as history`
        : 'Evaluations resumed'
  );
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

  // B5 / U9 — which of them are already past, so the screen can ask what to do
  // with those before anything is saved.
  const today = todayIn(config.scheduler.timezone);

  return success(
    res,
    schedule.map((c) => ({
      seq_no: c.seq_no,
      due_date: toDateString(c.due_date),
      period_from: toDateString(c.period_from),
      period_to: toDateString(c.period_to),
      past_due: c.due_date <= today,
    })),
    'Schedule preview — nothing has been saved'
  );
});
