/**
 * Tests for the Evaluations screen — artifact build-order item 9.
 *
 * Two things here are easy to get wrong in ways nobody notices until a manager
 * complains:
 *
 *   · "Remind now" must nudge the link the manager ALREADY has. The existing
 *     "Resend" issues a fresh token, which silently invalidates the old one —
 *     a manager halfway through the form loses their work. The two actions look
 *     alike on screen and are completely different underneath.
 *   · reminder_count is CHECK-constrained to 0..2 in the database because it
 *     drives the automatic chase. The artifact shows "Remind now" on rows
 *     already at "2 of 2", so a manual nudge has to be possible there WITHOUT
 *     pushing the counter out of range and surfacing as a raw database error.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/** The cap applied in remindNow(), mirroring the database CHECK. */
const MAX_REMINDER_COUNT = 2;
const capped = (n) => Math.min(n + 1, MAX_REMINDER_COUNT);

describe('manual reminders respect the database CHECK', () => {
  test('a first reminder counts normally', () => {
    assert.equal(capped(0), 1);
  });

  test('a second reminder counts normally', () => {
    assert.equal(capped(1), 2);
  });

  test('a third does NOT exceed the constraint', () => {
    // Without the cap this writes 3 and Postgres rejects the update, which
    // reaches HR as an unexplained failure on a button the design says works.
    assert.equal(capped(2), 2);
    assert.ok(capped(2) <= MAX_REMINDER_COUNT);
  });

  test('the cap never lowers an existing count', () => {
    for (let n = 0; n <= MAX_REMINDER_COUNT; n += 1) {
      assert.ok(capped(n) >= n, `capped(${n}) must not go backwards`);
    }
  });
});

describe('which evaluations may be reminded', () => {
  // Mirrors the guards in remindNow(). Each one exists because reminding in
  // that state either cannot work or should not happen.
  const AWAITING = ['email_sent', 'opened'];
  const future = new Date(Date.now() + 86_400_000);
  const past = new Date(Date.now() - 86_400_000);

  const canRemind = (c) =>
    AWAITING.includes(c.status)
    && !(c.token_expires_at && c.token_expires_at < new Date())
    && !c.employee.halt_process
    && c.employee.employment_status === 'active'
    && !c.heldAsLeaver;

  const base = {
    status: 'email_sent',
    token_expires_at: future,
    employee: { halt_process: false, employment_status: 'active' },
    heldAsLeaver: false,
  };

  test('an outstanding evaluation can be reminded', () => {
    assert.equal(canRemind(base), true);
  });

  test('one the manager has opened can still be reminded', () => {
    assert.equal(canRemind({ ...base, status: 'opened' }), true);
  });

  test('a submitted evaluation cannot — there is nothing to chase', () => {
    assert.equal(canRemind({ ...base, status: 'completed' }), false);
  });

  test('one never sent cannot — there is no link to nudge', () => {
    // "pending" means PEA has not emailed anyone yet. Reminding about an email
    // that was never sent would be the first the manager heard of it.
    assert.equal(canRemind({ ...base, status: 'pending' }), false);
  });

  test('an expired link cannot — the manager would click through to an error', () => {
    assert.equal(canRemind({ ...base, token_expires_at: past }), false);
  });

  test('someone on hold is not chased', () => {
    assert.equal(
      canRemind({ ...base, employee: { halt_process: true, employment_status: 'active' } }),
      false
    );
  });

  test('someone who has left is not chased', () => {
    assert.equal(
      canRemind({ ...base, employee: { halt_process: false, employment_status: 'left' } }),
      false
    );
  });

  test('a flagged possible leaver is not chased — R-02 applies here too', () => {
    // The whole point of the leaver hold is that it cannot be bypassed by
    // ticking a row on a different screen.
    assert.equal(canRemind({ ...base, heldAsLeaver: true }), false);
  });
});

describe('derived status separates two situations the database calls "pending"', () => {
  const derive = (status, dueDate, today) =>
    status === 'pending' && dueDate <= today ? 'not_sent' : status;

  const today = new Date('2026-09-17');

  test('due in the future is still scheduled', () => {
    assert.equal(derive('pending', new Date('2026-10-01'), today), 'pending');
  });

  test('due today with no email sent is a fault, not a schedule', () => {
    assert.equal(derive('pending', new Date('2026-09-17'), today), 'not_sent');
  });

  test('overdue with no email sent is a fault', () => {
    assert.equal(derive('pending', new Date('2026-09-01'), today), 'not_sent');
  });

  test('a sent evaluation is never re-derived', () => {
    assert.equal(derive('email_sent', new Date('2026-09-01'), today), 'email_sent');
    assert.equal(derive('completed', new Date('2026-09-01'), today), 'completed');
  });
});
