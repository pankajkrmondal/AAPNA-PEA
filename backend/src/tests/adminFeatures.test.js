/**
 * Tests for settings validation and user-management safeguards — the two
 * places where one bad input can quietly stop the system working or lock
 * everyone out of it.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY, normaliseValue } from '../services/settings.service.js';
import { refuseChange, refuseDelete, assertPasswordAcceptable } from '../services/users.service.js';

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

  test('employee self-view is a fixed set of levels, defaulting to averages (HR, 13 Sep)', () => {
    assert.equal(def('employee_self_view').default, 'averages');
    assert.throws(() => normaliseValue(def('employee_self_view'), 'everything'), /one of/);
  });

  test('settings nothing reads are not editable', () => {
    for (const unread of ['fresher_cycle_count', 'sender_email', 'skip_weekends', 'sweep_timezone']) {
      assert.equal(def(unread), undefined, `${unread} must not appear as an editable setting`);
    }
  });
});

describe('user management follows the Super Admin > Admin > HR ladder', () => {
  const superA = { id: 1, role: 'superadmin', is_active: true };
  const superB = { id: 2, role: 'superadmin', is_active: true };
  const admin = { id: 3, role: 'admin', is_active: true };
  const admin2 = { id: 4, role: 'admin', is_active: true };
  const hr = { id: 5, role: 'hr', is_active: true };

  test('you cannot change your own role', () => {
    assert.match(refuseChange(superA, superA, { role: 'hr' }, 2), /own role/);
  });

  test('you cannot deactivate yourself', () => {
    assert.match(refuseChange(admin, admin, { is_active: false }, 1), /own account/);
  });

  test('your own password is changed from your menu, not the user editor', () => {
    assert.match(refuseChange(admin, admin, { password: 'long enough phrase' }, 1), /menu/);
  });

  test('anyone may save their own details', () => {
    assert.equal(refuseChange(hr, hr, { role: 'hr', is_active: true }, 1), null);
  });

  test('an admin manages HR — role, status and password', () => {
    assert.equal(refuseChange(admin, hr, { role: 'admin', is_active: false, password: 'x' }, 1), null);
  });

  test('an admin cannot manage a peer admin or a super admin', () => {
    assert.match(refuseChange(admin, admin2, { is_active: false }, 1), /below your role/);
    assert.match(refuseChange(admin, superA, {}, 1), /below your role/);
  });

  test('HR cannot manage anyone else', () => {
    assert.match(refuseChange(hr, { id: 6, role: 'hr', is_active: true }, {}, 1), /below your role/);
  });

  test('an admin cannot hand out the Super Admin role', () => {
    assert.match(refuseChange(admin, hr, { role: 'superadmin' }, 1), /Super Admin role/);
  });

  test("a super admin can edit a peer super admin's details, but not their password", () => {
    assert.equal(refuseChange(superA, superB, { role: 'superadmin', is_active: true }, 2), null);
    assert.match(refuseChange(superA, superB, { password: 'x' }, 2), /account owner/);
  });

  test('the last active super admin cannot be demoted or deactivated', () => {
    assert.match(refuseChange(superA, superB, { role: 'admin' }, 1), /last active Super Admin/);
    assert.match(refuseChange(superA, superB, { is_active: false }, 1), /last active Super Admin/);
  });

  test('a super admin can be demoted while another remains', () => {
    assert.equal(refuseChange(superA, superB, { role: 'admin' }, 2), null);
  });

  test('saving a super admin with their role unchanged is not a demotion', () => {
    assert.equal(refuseChange(superA, superB, { role: 'superadmin' }, 1), null);
  });
});

describe('deleting users', () => {
  const superA = { id: 1, role: 'superadmin', is_active: true };
  const superB = { id: 2, role: 'superadmin', is_active: true };
  const admin = { id: 3, role: 'admin', is_active: true };
  const hr = { id: 5, role: 'hr', is_active: true };

  test('only a super admin can delete', () => {
    assert.match(refuseDelete(admin, hr, 1), /Only a Super Admin/);
    assert.equal(refuseDelete(superA, hr, 1), null);
  });

  test('nobody can delete themselves', () => {
    assert.match(refuseDelete(superA, superA, 2), /own account/);
  });

  test('the last active super admin cannot be deleted', () => {
    assert.match(refuseDelete(superA, superB, 1), /last active Super Admin/);
    assert.equal(refuseDelete(superA, superB, 2), null);
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
