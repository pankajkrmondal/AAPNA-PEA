/**
 * Tests for the Admin Portal's role ladder and module access — the rules that
 * decide which screens an HR user can open.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModules } from '../services/modulePermissions.service.js';
import { MODULE_KEYS } from '../config/modules.js';
import { ALL_ROLES, outranks, assignableRoles, isAdminTier } from '../config/roles.js';

describe('role ladder: superadmin > admin > hr', () => {
  test('each role outranks the one below it, never its peer', () => {
    assert.ok(outranks('superadmin', 'admin'));
    assert.ok(outranks('admin', 'hr'));
    assert.ok(!outranks('admin', 'admin'));
    assert.ok(!outranks('hr', 'admin'));
  });

  test('the retired viewer role is gone and grants nothing', () => {
    assert.ok(!ALL_ROLES.includes('viewer'));
    assert.ok(!isAdminTier('viewer'));
    assert.ok(outranks('hr', 'viewer'));
  });

  test('only a super admin can hand out the Super Admin role', () => {
    assert.deepEqual(assignableRoles('superadmin'), ['superadmin', 'admin', 'hr']);
    assert.deepEqual(assignableRoles('admin'), ['admin', 'hr']);
    assert.deepEqual(assignableRoles('hr'), []);
  });

  test('roles match case-insensitively', () => {
    assert.ok(isAdminTier(' SuperAdmin '));
  });
});

describe('module access', () => {
  test('admins and super admins always get every module, whatever is stored', () => {
    assert.deepEqual(resolveModules('admin', [...MODULE_KEYS]), [...MODULE_KEYS]);
    assert.deepEqual(resolveModules('superadmin', ['settings']), [...MODULE_KEYS]);
  });

  test('an HR user with nothing stored gets every module — the deploy locks nobody out', () => {
    assert.deepEqual(resolveModules('hr', []), [...MODULE_KEYS]);
  });

  test('only modules explicitly switched off are withheld from HR', () => {
    const mine = resolveModules('hr', ['settings', 'import_sheet']);
    assert.ok(!mine.includes('settings'));
    assert.ok(!mine.includes('import_sheet'));
    assert.ok(mine.includes('employees'));
    assert.equal(mine.length, MODULE_KEYS.length - 2);
  });

  test('a stored key for a module that no longer exists changes nothing', () => {
    assert.deepEqual(resolveModules('hr', ['retired_module']), [...MODULE_KEYS]);
  });
});
