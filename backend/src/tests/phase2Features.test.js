/**
 * Tests for the Phase 2 rules that are easy to get quietly wrong:
 * the confirmation deadline, calendar-month arithmetic, and the Azure field
 * lock.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assessDeadline } from '../services/confirmationDeadline.service.js';
import { planFieldSync } from '../services/joinerIntake.service.js';
import { addMonths, utcDate, toDateString } from '../utils/dateUtils.js';

describe('addMonths — calendar months, clamped', () => {
  test('an ordinary date moves by whole months', () => {
    assert.equal(toDateString(addMonths(utcDate(2026, 1, 15), 6)), '2026-07-15');
  });

  test('31 Aug + 6 months is the end of February, not early March', () => {
    assert.equal(toDateString(addMonths(utcDate(2025, 8, 31), 6)), '2026-02-28');
    assert.equal(toDateString(addMonths(utcDate(2027, 8, 31), 6)), '2028-02-29', 'leap year');
  });

  test('crosses year boundaries', () => {
    assert.equal(toDateString(addMonths(utcDate(2026, 11, 30), 8)), '2027-07-30');
  });
});

describe('confirmation deadline — plan §2.7', () => {
  const today = utcDate(2026, 9, 12);

  test('Confirmed and Not Confirmed are closed, however old', () => {
    assert.equal(assessDeadline({ doj: '2022-09-20', confirmation_status: 'Confirmed' }, today).state, 'closed');
    assert.equal(assessDeadline({ doj: '2022-09-20', confirmation_status: 'Not Confirmed' }, today).state, 'closed');
  });

  test('Pooja Goel — blank status, joined Sep 2022 — is overdue by years', () => {
    const a = assessDeadline({ doj: '2022-09-20', confirmation_status: null }, today);
    assert.equal(a.state, 'overdue');
    assert.equal(toDateString(a.deadline), '2023-03-20');
    assert.ok(a.daysOverdue > 1200);
  });

  test('a blank status inside 6 months is fine', () => {
    assert.equal(assessDeadline({ doj: '2026-06-01', confirmation_status: null }, today).state, 'ok');
  });

  test('within two weeks of the deadline is flagged as due soon', () => {
    const a = assessDeadline({ doj: '2026-03-20', confirmation_status: null }, today);
    assert.equal(a.state, 'due_soon');
    assert.equal(toDateString(a.deadline), '2026-09-20');
  });

  test('an extension moves the deadline to 8 months — but still needs a final decision', () => {
    const inside = assessDeadline({ doj: '2026-02-01', confirmation_status: 'Extend for 2 months' }, today);
    assert.equal(inside.extended, true);
    assert.equal(toDateString(inside.deadline), '2026-10-01');
    assert.equal(inside.state, 'ok');

    const past = assessDeadline({ doj: '2025-12-01', confirmation_status: 'Extend for 1 month' }, today);
    assert.equal(past.state, 'overdue', '"Extend for…" is filled in, but it is not an ending');
  });

  test('the month lengths come from settings when given', () => {
    const a = assessDeadline({ doj: '2026-03-01', confirmation_status: null }, today, { months: 3 });
    assert.equal(a.state, 'overdue');
  });

  test('exactly on the deadline is not yet overdue', () => {
    const a = assessDeadline({ doj: '2026-03-12', confirmation_status: null }, today);
    assert.notEqual(a.state, 'overdue');
  });
});

describe('Azure field sync respects locks — plan §6.5 Part 2', () => {
  const account = { displayName: 'Pooja  Goel', mail: 'POOJA.GOEL@aapnainfotech.com' };

  test('with sync off, differences are reported and nothing changes', () => {
    const p = planFieldSync(
      { full_name: 'Pooja G', office_email: 'pgoel@aapnainfotech.com', locked_fields: [] },
      account,
      { syncEnabled: false }
    );
    assert.deepEqual(p.updates, {});
    assert.deepEqual(p.unlockedDifferences.sort(), ['full_name', 'office_email']);
  });

  test('with sync on, unlocked fields follow Entra', () => {
    const p = planFieldSync(
      { full_name: 'Pooja G', office_email: 'pgoel@aapnainfotech.com', locked_fields: [] },
      account,
      { syncEnabled: true }
    );
    assert.equal(p.updates.full_name, 'Pooja Goel', 'whitespace collapsed');
    assert.equal(p.updates.office_email, 'pooja.goel@aapnainfotech.com', 'email normalised');
  });

  test('a locked field is NEVER overwritten, even with sync on', () => {
    const p = planFieldSync(
      { full_name: 'Pooja G', office_email: 'pgoel@aapnainfotech.com', locked_fields: ['full_name'] },
      account,
      { syncEnabled: true }
    );
    assert.equal(p.updates.full_name, undefined);
    assert.deepEqual(p.lockedDifferences, ['full_name']);
    assert.equal(p.updates.office_email, 'pooja.goel@aapnainfotech.com');
  });

  test('trailing spaces and case do not count as a difference', () => {
    const p = planFieldSync(
      { full_name: 'Pooja Goel ', office_email: 'Pooja.Goel@aapnainfotech.com', locked_fields: [] },
      account,
      { syncEnabled: true }
    );
    assert.deepEqual(p.updates, {});
  });

  test('a blank Entra value never wipes a real one', () => {
    const p = planFieldSync(
      { full_name: 'Pooja Goel', office_email: 'pgoel@aapnainfotech.com', locked_fields: [] },
      { displayName: '', mail: null, userPrincipalName: null },
      { syncEnabled: true }
    );
    assert.deepEqual(p.updates, {});
  });

  test('employment_status is never part of the sync — leavers are suggestions', () => {
    const p = planFieldSync(
      { full_name: 'X', office_email: 'x@aapnainfotech.com', locked_fields: [] },
      { displayName: 'Y', mail: 'y@aapnainfotech.com', accountEnabled: false, assignedLicenses: [] },
      { syncEnabled: true }
    );
    assert.equal('employment_status' in p.updates, false);
  });
});
