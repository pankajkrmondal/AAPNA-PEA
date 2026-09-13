/**
 * Tests for settings validation and user-management safeguards — the two
 * places where one bad input can quietly stop the system working or lock
 * everyone out of it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY, normaliseValue } from '../services/settings.service.js';
import { refuseChange, assertPasswordAcceptable } from '../services/users.service.js';

const def = (key) => REGISTRY.find((r) => r.key === key);

describe('settings validation', () => {
  test('booleans accept only on/off, case-insensitively', () => {
    assert.equal(normaliseValue(def('shadow_mode'), 'TRUE'), 'true');
    assert.throws(() => normaliseValue(def('shadow_mode'), 'yes'), /on or off/);
  });

  test('reminder count cannot exceed the database limit of 2', () => {
    assert.equal(normaliseValue(def('reminder_max_count'), '2'), '2');
    assert.throws(() => normaliseValue(def('reminder_max_count'), '3'), /at most 2/);
  });

  test('reminder offsets must be ascending whole numbers', () => {
    assert.equal(normaliseValue(def('reminder_offsets_days'), ' 2, 4 '), '2,4');
    assert.throws(() => normaliseValue(def('reminder_offsets_days'), '4,2'), /ascending/);
    assert.throws(() => normaliseValue(def('reminder_offsets_days'), '2,x'), /not a whole number/);
  });

  test('email lists are cleaned, de-duplicated and validated', () => {
    assert.equal(
      normaliseValue(def('cc_emails'), 'SRoy@aapnainfotech.com, sroy@aapnainfotech.com;rsomani@aapnainfotech.com'),
      'sroy@aapnainfotech.com;rsomani@aapnainfotech.com'
    );
    assert.throws(() => normaliseValue(def('cc_emails'), 'sroy@aapnainfotech'), /not a valid email/);
  });

  test('an empty email list is allowed (e.g. IT not yet named)', () => {
    assert.equal(normaliseValue(def('it_report_emails'), ''), '');
  });

  test('an invalid cron is refused rather than silently never running', () => {
    assert.equal(normaliseValue(def('sweep_cron'), '0 11 * * *'), '0 11 * * *');
    assert.throws(() => normaliseValue(def('sweep_cron'), 'every day at 11'), /cron/);
  });

  test('domains lose a leading @ and must look like a domain', () => {
    assert.equal(normaliseValue(def('azure_email_domain'), '@AapnaInfotech.com'), 'aapnainfotech.com');
    assert.throws(() => normaliseValue(def('azure_email_domain'), 'aapnainfotech'), /domain/);
  });

  test('employee self-view is a fixed set of levels, defaulting to off', () => {
    assert.equal(def('employee_self_view').default, 'off');
    assert.throws(() => normaliseValue(def('employee_self_view'), 'everything'), /one of/);
  });

  test('settings nothing reads are not editable', () => {
    for (const unread of ['fresher_cycle_count', 'sender_email', 'skip_weekends', 'sweep_timezone']) {
      assert.equal(def(unread), undefined, `${unread} must not appear as an editable setting`);
    }
  });
});

describe('user management cannot lock everyone out', () => {
  const admin = { id: 1, role: 'admin', is_active: true };
  const other = { id: 2, role: 'admin', is_active: true };
  const hr = { id: 3, role: 'hr', is_active: true };

  test('you cannot change your own role', () => {
    assert.match(refuseChange(admin, admin, { role: 'hr' }, 2), /own role/);
  });

  test('you cannot deactivate yourself', () => {
    assert.match(refuseChange(admin, admin, { is_active: false }, 2), /own account/);
  });

  test('the last active admin cannot be demoted by anyone', () => {
    assert.match(refuseChange({ id: 9 }, admin, { role: 'viewer' }, 1), /last active admin/);
  });

  test('the last active admin cannot be deactivated', () => {
    assert.match(refuseChange({ id: 9 }, admin, { is_active: false }, 1), /last active admin/);
  });

  test('an admin can be demoted while another admin remains', () => {
    assert.equal(refuseChange(admin, other, { role: 'hr' }, 2), null);
  });

  test('ordinary changes to an HR user are allowed', () => {
    assert.equal(refuseChange(admin, hr, { role: 'viewer', is_active: false }, 1), null);
  });

  test('saving an admin with their role unchanged is not a demotion', () => {
    assert.equal(refuseChange({ id: 9 }, admin, { role: 'admin' }, 1), null);
  });
});

describe('password rules', () => {
  test('at least 10 characters', () => {
    assert.throws(() => assertPasswordAcceptable('short1234'), /10 characters/);
    assert.doesNotThrow(() => assertPasswordAcceptable('purple monsoon ledger'));
  });

  test('must not contain the username or email name', () => {
    assert.throws(() => assertPasswordAcceptable('pankaj-2026-rules', { username: 'pankaj' }), /username/);
    assert.throws(() => assertPasswordAcceptable('xx-pkmondal-xx', { email: 'pkmondal@aapnainfotech.com' }), /email name/);
  });

  test('one repeated character is refused', () => {
    assert.throws(() => assertPasswordAcceptable('aaaaaaaaaaaa'), /repeated/);
  });
});
