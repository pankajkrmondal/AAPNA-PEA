/**
 * Archive (07-10-2026) — Commandos whose probation is over.
 *
 * Decided with Harish: archived automatically the morning after the final
 * decision (Confirmed / Not Confirmed) or the exit, and by hand; restorable;
 * a read-only record, out of the day-to-day lists. These are the rules that
 * can be checked without a database.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { archiveDue } from '../services/archive.service.js';
import { employeeWhere } from '../services/employee.service.js';
import { REGISTRY, normaliseValue } from '../services/settings.service.js';

const TZ = 'Asia/Kolkata';
const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const today = day(2026, 10, 8);

// Decided on 07-10-2026 at 15:00 India time.
const decided = {
  confirmation_status: 'Confirmed',
  employment_status: 'active',
  archived_at: null,
  restored_at: null,
  settled_at: new Date('2026-10-07T09:30:00Z'),
  modified_at: new Date('2026-10-07T09:30:00Z'),
  has_open: false,
  unread_flagged: 0,
};
const due = (row, days = 0, when = today) => archiveDue({ ...decided, ...row }, when, days, TZ);

describe('who the morning pass archives', () => {
  test('Confirmed, Not Confirmed and Left are archived the morning after', () => {
    assert.equal(due({}), true);
    assert.equal(due({ confirmation_status: 'Not Confirmed' }), true);
    assert.equal(due({ confirmation_status: null, employment_status: 'left' }), true);
  });

  test('not the same day the decision was recorded', () => {
    assert.equal(due({}, 0, day(2026, 10, 7)), false);
  });

  test('a probation still running is never archived — in probation or extended', () => {
    assert.equal(due({ confirmation_status: null }), false);
    assert.equal(due({ confirmation_status: 'Extend for 1 month' }), false);
  });

  test('not while an evaluation link is still with a manager', () => {
    assert.equal(due({ has_open: true }), false);
  });

  test('not before the waiting period from Settings has passed', () => {
    assert.equal(due({}, 30), false);
    assert.equal(due({}, 30, day(2026, 11, 7)), true);
  });

  test('not while flagged feedback nobody has read is waiting — then the next morning', () => {
    assert.equal(due({ unread_flagged: 1 }), false);
    assert.equal(due({ unread_flagged: 0 }), true);
  });

  test('a Commando HR restored stays out of the archive …', () => {
    assert.equal(due({ restored_at: new Date('2026-10-08T03:00:00Z') }, 0, day(2026, 10, 9)), false);
  });

  test('… until a new decision or exit after the restore', () => {
    assert.equal(
      due({ restored_at: new Date('2026-10-08T03:00:00Z'), settled_at: new Date('2026-10-09T06:00:00Z') }, 0, day(2026, 10, 10)),
      true
    );
  });

  test('someone already archived is not archived again', () => {
    assert.equal(due({ archived_at: new Date('2026-10-08T05:30:00Z') }), false);
  });

  test('with no change history, the record\'s last change stands in for the decision date', () => {
    assert.equal(due({ settled_at: null }), true);
  });
});

describe('the Commandos list and the archive', () => {
  const ids = [11n, 12n];
  const parts = (q) => employeeWhere(q, { archived: ids }).AND || [];

  test('by default archived people are left out', () => {
    assert.deepEqual(parts({}), [{ id: { notIn: ids } }]);
  });

  test('every other status leaves them out too, "Left" included', () => {
    const where = parts({ state: 'left' });
    assert.deepEqual(where.at(-1), { id: { notIn: ids } });
  });

  test('"Archived" shows only them', () => {
    assert.deepEqual(parts({ state: 'archived' }), [{}, { id: { in: ids } }]);
  });

  test('a search with no status finds them too, so anyone can be found by name', () => {
    const where = parts({ search: 'Asha' });
    assert.equal(where.length, 1);
    assert.ok(where[0].OR, 'only the name search');
  });

  test('before the archive exists here nothing changes, and "Archived" shows nobody', () => {
    assert.deepEqual(employeeWhere({}, { archived: null }), {});
    assert.deepEqual(employeeWhere({ state: 'archived' }, { archived: null }).AND.at(-1), { id: { in: [] } });
  });

  test('a caller that knows nothing of the archive gets the list as before', () => {
    assert.deepEqual(employeeWhere({}), {});
  });
});

describe('the waiting-period setting', () => {
  const def = REGISTRY.find((s) => s.key === 'archive_after_days');

  test('starts at 0 — the morning after, as decided', () => {
    assert.equal(def.default, '0');
  });

  test('takes 0 to 365 days', () => {
    assert.equal(normaliseValue(def, '30'), '30');
    assert.throws(() => normaliseValue(def, '-1'));
    assert.throws(() => normaliseValue(def, '400'));
  });
});
