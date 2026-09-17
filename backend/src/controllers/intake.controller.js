/**
 * intake.controller.js — the New Joiner Inbox endpoints. Plan §13.8.
 *
 * Note what is missing: there is no endpoint that creates an employee from
 * Entra without a person in the loop, and no endpoint that marks anyone as
 * having left. Both are deliberate — see joinerIntake.service.js.
 */
import * as intake from '../services/joinerIntake.service.js';
import * as rmPlMap from '../services/rmPlMap.service.js';
import { runSyncAlerts } from '../services/syncAlert.service.js';
import catchAsync from '../utils/catchAsync.js';
import { success } from '../utils/apiResponse.js';

/** GET /api/intake/inbox */
export const inbox = catchAsync(async (_req, res) => success(res, await intake.getInbox()));

/**
 * GET /api/intake/sync-problems — R-03.
 *
 * What the nightly alert would report, read live. The New joiners screen shows
 * it so a problem is visible the moment HR opens the page, rather than only in
 * an email they may have missed.
 */
export const syncProblems = catchAsync(async (_req, res) =>
  success(res, await runSyncAlerts({ dryRun: true }))
);

/**
 * POST /api/intake/scan?dryRun=true
 *
 * Read-only against Microsoft Graph and sends no email. `dryRun` additionally
 * writes nothing to PEA, so the first run against a live tenant can be
 * inspected before it enqueues anything.
 */
export const scan = catchAsync(async (req, res) => {
  const dryRun = req.query.dryRun === 'true';
  const report = await intake.runIntakeScan({ dryRun, actor: req.user.username });

  // R-03 — a scan HR ran by hand should surface the same problems the nightly
  // one would. Never allowed to fail the scan itself: the scan succeeded, and
  // reporting on it is secondary.
  if (!dryRun) {
    try {
      await runSyncAlerts({ scan: report });
    } catch {
      // Already logged inside the service.
    }
  }

  return success(
    res,
    report,
    dryRun
      ? `Dry run — ${report.candidatesNew} new joiner(s) would be added to the inbox, nothing was saved`
      : `Scan complete — ${report.candidatesNew} new joiner(s), ${report.leaversFlagged} leaver flag(s) raised`
  );
});

/** POST /api/intake/joiners/:id/accept */
export const acceptJoiner = catchAsync(async (req, res) => {
  const employee = await intake.acceptCandidate(req.params.id, req.body, req.user.username);
  return success(
    res,
    employee,
    `${employee.full_name} added — ${employee.cycles.length} evaluations scheduled`,
    201
  );
});

/** POST /api/intake/joiners/:id/dismiss   { reason } */
export const dismissJoiner = catchAsync(async (req, res) => {
  const row = await intake.dismissCandidate(req.params.id, req.body?.reason, req.user.username);
  return success(res, row, 'Removed from the inbox');
});

/** POST /api/intake/leavers/:employeeId/confirm */
export const confirmLeaver = catchAsync(async (req, res) => {
  const employee = await intake.confirmLeaver(req.params.employeeId, req.user.username);
  return success(res, employee, `${employee.full_name} marked as having left — evaluations will stop`);
});

/** POST /api/intake/leavers/:employeeId/dismiss */
export const dismissLeaver = catchAsync(async (req, res) => {
  const row = await intake.dismissLeaver(req.params.employeeId, req.user.username);
  return success(res, row, 'Flag cleared — they will be flagged again only if Entra changes');
});

/** GET /api/intake/rm-pl-map */
export const listRmPlMap = catchAsync(async (_req, res) => success(res, await rmPlMap.listMap()));

/** POST /api/intake/rm-pl-map   { rm_email, pl_email, note? } */
export const upsertRmPlMap = catchAsync(async (req, res) => {
  const entry = await rmPlMap.upsertEntry(req.body, req.user.username);
  return success(res, entry, 'Mapping saved');
});

/** POST /api/intake/rm-pl-map/seed — rebuild from the current roster */
export const seedRmPlMap = catchAsync(async (req, res) => {
  const result = await rmPlMap.seedFromEmployees(req.user.username);
  return success(
    res,
    result,
    `${result.total} manager(s) mapped — ${result.created} added, ${result.updated} refreshed, ` +
      `${result.ambiguous} need HR to choose between two project leaders`
  );
});
