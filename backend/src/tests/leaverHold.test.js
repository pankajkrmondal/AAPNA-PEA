/**
 * Tests for R-02 — evaluations stop on their own when someone leaves.
 *
 * The incident that motivated the whole feature, in Subhajit's words
 * (15-Sep demo, 5:39):
 *
 *   "One of the resources, I forgot to pause the evaluation and the evaluation
 *    got triggered and email got shot. So that's why we thought of getting this
 *    linked with the AD… if the resource is not showing in the AD, his or her
 *    evolution will get paused automatically."
 *
 * The signal is already measured and already stored. entraDirectory.service
 * §13.9 records that an exited account is switched off AND unlicensed — that
 * pair gives 16 clean hits across 91 sampled users, where "no licence" alone
 * gives 68 false positives. What was missing is that the flag did nothing to
 * the sweep: `employment_status` is HR's decision and is never written by the
 * scan, so until HR confirmed the exit the emails kept going. These tests pin
 * the rule that closes that window.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assessLeaver } from '../services/entraDirectory.service.js';

/**
 * The dismissal rule, as both the sweep query and the form guard apply it.
 * A hold is in force when Entra has flagged the account and HR has not since
 * said "no, they are still here".
 */
const holdApplies = (employee, enabled = true) => {
  if (!enabled || !employee.leaver_flagged_at) return false;
  const dismissed =
    employee.leaver_dismissed_at && employee.leaver_dismissed_at >= employee.leaver_flagged_at;
  return !dismissed;
};

const DAY = 86_400_000;
const flagged = new Date('2026-09-10T00:00:00Z');

describe('R-02 — which Entra accounts count as having left', () => {
  test('switched off AND unlicensed is a leaver', () => {
    const v = assessLeaver({ accountEnabled: false, assignedLicenses: [] });
    assert.equal(v.looksLeft, true);
  });

  test('unlicensed alone is NOT a leaver', () => {
    // The measured false-positive case: resource accounts, guests and
    // unlicensed-but-present staff. 68 of 91 sampled users would be wrongly
    // held if this counted.
    const v = assessLeaver({ accountEnabled: true, assignedLicenses: [] });
    assert.equal(v.looksLeft, false);
  });

  test('switched off but still licensed is NOT a leaver', () => {
    const v = assessLeaver({ accountEnabled: false, assignedLicenses: [{ skuId: 'x' }] });
    assert.equal(v.looksLeft, false);
  });

  test('an ordinary active account is not a leaver', () => {
    const v = assessLeaver({ accountEnabled: true, assignedLicenses: [{ skuId: 'x' }] });
    assert.equal(v.looksLeft, false);
  });

  test('no account at all is not asserted either way', () => {
    // A missing account is suggestive but was never measured — it is equally a
    // mail-alias mismatch or a contractor. Deliberately not a leaver verdict.
    const v = assessLeaver(null);
    assert.equal(v.looksLeft, false);
    assert.equal(v.accountEnabled, null);
  });
});

describe('R-02 — when the hold is in force', () => {
  test('an unflagged employee is never held', () => {
    assert.equal(holdApplies({ leaver_flagged_at: null, leaver_dismissed_at: null }), false);
  });

  test('a flagged employee is held — this is the forgotten-pause case', () => {
    assert.equal(holdApplies({ leaver_flagged_at: flagged, leaver_dismissed_at: null }), true);
  });

  test('HR dismissing the flag releases the hold', () => {
    // "No, they are still here." The link must reopen at once, not after a restart.
    assert.equal(
      holdApplies({ leaver_flagged_at: flagged, leaver_dismissed_at: new Date(+flagged + DAY) }),
      false
    );
  });

  test('a dismissal OLDER than the flag does not release it', () => {
    // Someone dismissed once, stayed, then genuinely left later and was flagged
    // afresh. The stale dismissal must not silence the new flag forever.
    assert.equal(
      holdApplies({ leaver_flagged_at: flagged, leaver_dismissed_at: new Date(+flagged - DAY) }),
      true
    );
  });

  test('a dismissal at the same instant as the flag counts as dismissed', () => {
    assert.equal(
      holdApplies({ leaver_flagged_at: flagged, leaver_dismissed_at: new Date(+flagged) }),
      false
    );
  });

  test('switching the setting off restores the old behaviour', () => {
    assert.equal(holdApplies({ leaver_flagged_at: flagged, leaver_dismissed_at: null }, false), false);
  });
});
