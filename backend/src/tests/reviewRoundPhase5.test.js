/**
 * Tests for the review round's Phase 5 rules — the ones that can be checked
 * without a database or Microsoft Graph:
 *
 *   U5   the Commandos list's status and manager filters
 *   U6   which columns it may be sorted by
 *   U8   who the people picker offers, and in what order
 *   L7   what a note may be, and who may delete one
 *
 * What these cannot cover — the list actually filtering, the export matching
 * it, a note being saved — needs a database (and, for notes, the 2026-10-02
 * DDL) and is on the staging checklist in docs/PEA-implementation-plan.md.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  LIST_STATES,
  LIST_SORTS,
  employeeWhere,
  employeeOrder,
  mayHaveLeft,
  NOTE_MAX,
  cleanNote,
  mayDeleteNote,
} from '../services/employee.service.js';
import { toPerson, searchPeople } from '../services/directory.service.js';

/** The fragments of a filter, whatever order they were added in. */
const parts = (q) => employeeWhere(q).AND || [];

describe('Commandos list filters (U5)', () => {
  test('no filter at all is an empty where — everyone', () => {
    assert.deepEqual(employeeWhere(), {});
    assert.deepEqual(employeeWhere({ search: '   ' }), {});
  });

  // Archive (07-10-2026) — "archived" is the eighth status. Before it:
  //   test('the seven statuses are the ones the screen offers', …
  //     ['in_probation', 'extended', 'confirmed', 'not_confirmed', 'paused', 'held', 'left']
  test('the eight statuses are the ones the screen offers', () => {
    assert.deepEqual(
      [...LIST_STATES],
      ['in_probation', 'extended', 'confirmed', 'not_confirmed', 'paused', 'held', 'left', 'archived']
    );
  });

  // Archive (07-10-2026) — "archived" is whoever is archived, here or not; the
  // archive itself is applied with the ids (see archive.test.js). The loop
  // covered every status before; it skips that one now.
  test('every status but "left" and "archived" means someone still here', () => {
    for (const state of LIST_STATES.filter((s) => s !== 'archived')) {
      const [where] = parts({ state });
      assert.equal(where.employment_status, state === 'left' ? 'left' : 'active', state);
    }
  });

  test('"in probation" is no decision yet; "extended" is either extension', () => {
    assert.equal(parts({ state: 'in_probation' })[0].confirmation_status, null);
    assert.deepEqual(parts({ state: 'extended' })[0].confirmation_status, { startsWith: 'Extend' });
    assert.equal(parts({ state: 'confirmed' })[0].confirmation_status, 'Confirmed');
    assert.equal(parts({ state: 'not_confirmed' })[0].confirmation_status, 'Not Confirmed');
  });

  test('"held" is a leaver flag HR has not dismissed since', () => {
    const [where] = parts({ state: 'held' });
    assert.deepEqual(where.leaver_flagged_at, { not: null });
    assert.equal(where.OR.length, 2, 'never dismissed, or dismissed before the flag was raised');
    assert.deepEqual(where.OR[0], { leaver_dismissed_at: null });
  });

  test('a status that is not on the list is refused, not ignored', () => {
    assert.throws(() => employeeWhere({ state: 'everyone' }), /Invalid status/);
  });

  test('the manager filter matches the address whatever its case or spacing', () => {
    assert.deepEqual(parts({ rm: '  CVerma@AapnaInfotech.com ' }), [
      { rm_email: { equals: 'cverma@aapnainfotech.com', mode: 'insensitive' } },
    ]);
  });

  test('filters combine — a search, a status and a manager are all applied', () => {
    const where = parts({ search: 'roy', state: 'paused', rm: 'x@aapnainfotech.com', type: 'fresher' });
    assert.equal(where.length, 4);
    assert.equal(where[0].OR.length, 4, 'search covers name, email, manager name and manager email');
  });

  test('the filters that were there before still work', () => {
    assert.deepEqual(parts({ type: 'experienced' }), [{ is_experienced: true }]);
    assert.deepEqual(parts({ employment_status: 'left' }), [{ employment_status: 'left' }]);
    assert.deepEqual(parts({ confirmation_status: 'pending' }), [{ confirmation_status: null }]);
    assert.deepEqual(parts({ halt_process: 'true' }), [{ halt_process: true }]);
  });
});

describe('Commandos list sorting (U6)', () => {
  test('newest first unless a column is asked for', () => {
    assert.deepEqual(employeeOrder(), [{ created_at: 'desc' }, { id: 'desc' }]);
  });

  test('the sortable columns are name, joining date, manager and status', () => {
    assert.deepEqual([...LIST_SORTS], ['name', 'doj', 'manager', 'status']);
    for (const sort of LIST_SORTS) assert.ok(employeeOrder({ sort }).length >= 2, sort);
  });

  test('ascending unless descending is asked for', () => {
    assert.deepEqual(employeeOrder({ sort: 'name' })[0], { full_name: 'asc' });
    assert.deepEqual(employeeOrder({ sort: 'name', order: 'desc' })[0], { full_name: 'desc' });
    assert.deepEqual(employeeOrder({ sort: 'doj', order: 'sideways' })[0], { doj: 'asc' });
  });

  test('status puts people still here first, and "in probation" ahead of the decided', () => {
    const [employment, decision] = employeeOrder({ sort: 'status' });
    assert.deepEqual(employment, { employment_status: 'asc' });
    assert.deepEqual(decision, { confirmation_status: { sort: 'asc', nulls: 'first' } });
  });

  test('every order ends on the id, so pages never overlap', () => {
    for (const sort of [undefined, ...LIST_SORTS]) {
      assert.ok('id' in employeeOrder({ sort }).at(-1), String(sort));
    }
  });

  test('a column that is not on the list is refused — "next due" among them', () => {
    assert.throws(() => employeeOrder({ sort: 'next_due' }), /Cannot sort by/);
    assert.throws(() => employeeOrder({ sort: 'office_email; DROP TABLE' }), /Cannot sort by/);
  });
});

describe('who Microsoft 365 says may have left (U5)', () => {
  const flagged = new Date('2026-09-20T03:30:00Z');
  const person = (over = {}) => ({
    employment_status: 'active',
    leaver_flagged_at: flagged,
    leaver_dismissed_at: null,
    ...over,
  });

  test('flagged and never dismissed', () => {
    assert.equal(mayHaveLeft(person()), true);
  });

  test('never flagged', () => {
    assert.equal(mayHaveLeft(person({ leaver_flagged_at: null })), false);
  });

  test('HR said "still here" after the flag — no longer', () => {
    assert.equal(mayHaveLeft(person({ leaver_dismissed_at: new Date('2026-09-21T05:00:00Z') })), false);
  });

  test('flagged again after an earlier dismissal — a fresh flag counts', () => {
    assert.equal(mayHaveLeft(person({ leaver_dismissed_at: new Date('2026-09-01T05:00:00Z') })), true);
  });

  test('someone already marked as left is not "may have left"', () => {
    assert.equal(mayHaveLeft(person({ employment_status: 'left' })), false);
  });
});

describe('people picker (U8)', () => {
  const account = (over = {}) => ({
    id: 'a1',
    displayName: 'Chhavi  Verma ',
    mail: 'CVerma@aapnainfotech.com',
    accountEnabled: true,
    assignedLicenses: [{ skuId: 'x' }],
    ...over,
  });

  test('an account becomes a tidy name and a lower-case address', () => {
    assert.deepEqual(toPerson(account()), { name: 'Chhavi Verma', email: 'cverma@aapnainfotech.com' });
  });

  test('switched-off, nameless, unlicensed and system accounts are not offered', () => {
    assert.equal(toPerson(account({ accountEnabled: false })), null);
    assert.equal(toPerson(account({ displayName: ' ' })), null);
    assert.equal(toPerson(account({ assignedLicenses: [] })), null, 'meeting rooms and shared mailboxes');
    assert.equal(toPerson(account({ mail: null, userPrincipalName: null })), null);
    assert.equal(
      toPerson(account({ mail: 'helpdesk@aapnainfotech.com' }), new Set(['helpdesk@aapnainfotech.com'])),
      null
    );
  });

  const people = [
    { name: 'Anuj Roy', email: 'aroy@aapnainfotech.com' },
    { name: 'Roya Khan', email: 'rkhan@aapnainfotech.com' },
    { name: 'Subhajit Roy', email: 'sroy@aapnainfotech.com' },
    { name: 'Vikas Tyagi', email: 'vtyagi@aapnainfotech.com' },
    { name: 'Royston D', email: 'zz@aapnainfotech.com' },
  ];
  const names = (q, limit) => searchPeople(people, q, limit).map((p) => p.name);

  test('fewer than two characters asks for nothing', () => {
    assert.deepEqual(names(''), []);
    assert.deepEqual(names('r'), []);
  });

  test('a name starting with it comes before a surname starting with it', () => {
    assert.deepEqual(names('roy'), ['Roya Khan', 'Royston D', 'Anuj Roy', 'Subhajit Roy']);
  });

  test('an address finds its person', () => {
    assert.deepEqual(names('vtyagi'), ['Vikas Tyagi']);
    assert.deepEqual(names('VTYAGI@aapna'), ['Vikas Tyagi']);
  });

  test('a match anywhere still counts, after the better ones', () => {
    assert.deepEqual(names('ubha'), ['Subhajit Roy']);
  });

  test('the list is capped', () => {
    assert.equal(names('roy', 2).length, 2);
  });
});

describe('HR notes (L7)', () => {
  test('a note is trimmed and its line endings evened out', () => {
    assert.equal(cleanNote('  On leave until the 14th.\r\nBack on the 15th.  '), 'On leave until the 14th.\nBack on the 15th.');
  });

  test('an empty note is refused', () => {
    assert.throws(() => cleanNote(''), /Write the note/);
    assert.throws(() => cleanNote('   \n  '), /Write the note/);
    assert.throws(() => cleanNote(undefined), /Write the note/);
  });

  test('a note over the limit is refused, and told its length', () => {
    assert.equal(cleanNote('x'.repeat(NOTE_MAX)).length, NOTE_MAX);
    assert.throws(() => cleanNote('x'.repeat(NOTE_MAX + 1)), new RegExp(`limit is ${NOTE_MAX}`));
  });

  test('whoever wrote a note may delete it, and so may an admin — nobody else', () => {
    const note = { created_by: 'Priya' };
    assert.equal(mayDeleteNote(note, { username: 'priya', role: 'hr' }), true, 'case does not matter');
    assert.equal(mayDeleteNote(note, { username: 'someone-else', role: 'hr' }), false);
    assert.equal(mayDeleteNote(note, { username: 'boss', role: 'admin' }), true);
    assert.equal(mayDeleteNote(note, { username: 'root', role: 'superadmin' }), true);
    assert.equal(mayDeleteNote(note, {}), false);
  });

  test('the database enforces the same length the page allows', () => {
    const ddl = readFileSync(
      fileURLToPath(new URL('../../prisma/ddl/2026-10-02-pea-review-round.sql', import.meta.url)),
      'utf8'
    );
    assert.match(ddl, /CREATE TABLE IF NOT EXISTS pea_employee_notes/);
    const check = /pea_employee_notes_body_chk\s+CHECK \([^;]*char_length\(body\) <= (\d+)\)/.exec(ddl);
    assert.ok(check, 'the body length CHECK is in the DDL');
    assert.equal(Number(check[1]), NOTE_MAX);
  });
});
