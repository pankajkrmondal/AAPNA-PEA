import * as employeeService from '../services/employee.service.js';
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
