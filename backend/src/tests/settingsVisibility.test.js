/**
 * Two changes that are easy to undo by accident, so they are pinned here.
 *
 *   1. No setting claims to need a restart any more. HR are not developers and
 *      cannot restart a server; a setting they could change but not apply was a
 *      setting that depended on someone else. The three that drive a cron are
 *      applied to the running process as they are saved.
 *   2. The pea_settings column names, and the "not in effect" list, go to a
 *      super admin only. Everyone else keeps every setting and every label —
 *      what they lose is internal plumbing, not a capability.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY } from '../services/settings.service.js';
import { startScheduler, stopScheduler } from '../jobs/evaluationScheduler.js';
import { startIntakeScanner, stopIntakeScanner } from '../jobs/intakeScanner.js';

describe('no setting asks HR to restart the server', () => {
  test('nothing in the registry is marked as needing a restart', () => {
    const needsRestart = REGISTRY.filter((r) => r.restart).map((r) => r.key);
    assert.deepEqual(
      needsRestart,
      [],
      `these would tell HR to find a developer: ${needsRestart.join(', ')}`
    );
  });

  test('the cron settings are still present — they were unflagged, not removed', () => {
    for (const key of ['sweep_cron', 'azure_scan_cron', 'azure_scan_enabled']) {
      assert.ok(REGISTRY.some((r) => r.key === key), `${key} is missing from the registry`);
    }
  });
});

describe('the schedulers can be restarted in place', () => {
  // The reload path calls start* on a process that may already have a task
  // running. If that were not re-entrant the second call would leave two live
  // crons and every evaluation email would go out twice — the one failure mode
  // worse than the schedule not changing at all.
  test('starting twice does not throw, and stopping is idempotent', async () => {
    await startScheduler();
    await startScheduler();
    stopScheduler();
    stopScheduler();

    await startIntakeScanner();
    await startIntakeScanner();
    stopIntakeScanner();
    stopIntakeScanner();
  });

  test('stop accepts the quiet flag the reload path uses', () => {
    stopScheduler({ quiet: true });
    stopIntakeScanner({ quiet: true });
  });
});
