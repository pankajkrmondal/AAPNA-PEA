/**
 * Tests for deleting an employee. Deletion cannot be undone, so the one rule
 * that matters is that it never happens by accident.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { assertDeleteConfirmed } from '../services/employee.service.js';

describe('delete employee — the typed name must match', () => {
  const employee = { full_name: 'Priyanka Khurana' };

  test('the exact name is accepted', () => {
    assert.doesNotThrow(() => assertDeleteConfirmed(employee, 'Priyanka Khurana'));
  });

  test('case and extra spaces do not matter (the sheet has "Priyanka Khurana ")', () => {
    assert.doesNotThrow(() => assertDeleteConfirmed(employee, '  priyanka   KHURANA '));
  });

  test('a blank or missing name is refused', () => {
    assert.throws(() => assertDeleteConfirmed(employee, ''), /type the employee's full name/);
    assert.throws(() => assertDeleteConfirmed(employee, undefined), /type the employee's full name/);
  });

  test('a different or partial name is refused', () => {
    assert.throws(() => assertDeleteConfirmed(employee, 'Priyanka'), /Priyanka Khurana/);
    assert.throws(() => assertDeleteConfirmed(employee, 'Shelly Jain'), /Priyanka Khurana/);
  });
});
