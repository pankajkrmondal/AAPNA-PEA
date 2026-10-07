/**
 * Tests for the review round's Phase 4 rules — the ones that can be checked
 * without a database:
 *
 *   B5 / U9  which past-due evaluations a choice closes
 *   M6       when a submitted evaluation may be reopened
 *   P8       the follow-up outcomes, and that the database accepts the same list
 *   M3 / M7  who an evaluation email greets
 *
 * What these cannot cover — the link actually moving to a new manager, the
 * earlier version being stored, HR's entry being saved — needs the 2026-10-02
 * DDL and is on the staging checklist in docs/PEA-implementation-plan.md.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PAST_DUE_ACTIONS, pastDueToClose } from '../services/employee.service.js';
import { reopenBlocker, FOLLOW_UP_OUTCOMES } from '../services/evaluationActions.service.js';
import { TEMPLATE_DEFS, compile, buildVars, validateDraft } from '../services/emailTemplate.service.js';

const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

describe('past-due evaluations when adding late or resuming (B5 / U9)', () => {
  // Joined four months ago, added today: three evaluations are already due.
  const today = day(2026, 10, 1);
  const cycles = [
    { id: 1n, seq_no: 1, status: 'pending', due_date: day(2026, 7, 1) },
    { id: 2n, seq_no: 2, status: 'pending', due_date: day(2026, 8, 1) },
    { id: 3n, seq_no: 3, status: 'pending', due_date: day(2026, 9, 1) },
    { id: 4n, seq_no: 4, status: 'pending', due_date: day(2026, 11, 1) },
  ];
  const closed = (action, list = cycles) => pastDueToClose(list, action, today).map((c) => c.seq_no);

  test('the choices are the three the screens send', () => {
    assert.deepEqual([...PAST_DUE_ACTIONS], ['send_all', 'send_latest', 'close']);
  });

  test('"all of them" closes nothing — what happened before there was a choice', () => {
    assert.deepEqual(closed('send_all'), []);
  });

  test('"latest one only" closes every past-due one but the most recent', () => {
    assert.deepEqual(closed('send_latest'), [1, 2]);
  });

  test('"keep blank" closes every past-due one', () => {
    assert.deepEqual(closed('close'), [1, 2, 3]);
  });

  test('an evaluation not yet due is never closed', () => {
    for (const action of PAST_DUE_ACTIONS) assert.ok(!closed(action).includes(4), action);
  });

  test('one due today counts as past due — the daily send would take it today', () => {
    const list = [{ id: 1n, seq_no: 1, status: 'pending', due_date: today }];
    assert.deepEqual(closed('close', list), [1]);
  });

  test('with a single past-due evaluation, "latest one only" closes nothing', () => {
    assert.deepEqual(closed('send_latest', cycles.slice(2)), []);
  });

  test('one already sent, opened, answered or closed is left alone', () => {
    const list = [
      { id: 1n, seq_no: 1, status: 'completed', due_date: day(2026, 7, 1) },
      { id: 2n, seq_no: 2, status: 'email_sent', due_date: day(2026, 8, 1) },
      { id: 3n, seq_no: 3, status: 'opened', due_date: day(2026, 8, 15) },
      { id: 4n, seq_no: 4, status: 'skipped', due_date: day(2026, 9, 1) },
      { id: 5n, seq_no: 5, status: 'pending', due_date: day(2026, 9, 15) },
    ];
    assert.deepEqual(closed('close', list), [5]);
  });

  test('the order the rows arrive in does not change which one is "latest"', () => {
    assert.deepEqual(closed('send_latest', [cycles[2], cycles[0], cycles[1]]), [1, 2]);
  });
});

describe('reopening a submitted evaluation (M6)', () => {
  const employee = { full_name: 'Priya Sharma', employment_status: 'active' };
  const scores = [{ param_key: 'quality', rating: 3 }];
  const submitted = { seq_no: 2, status: 'completed', legacy_format: false, employee, scores };

  test('the latest submitted evaluation can be reopened', () => {
    const siblings = [
      { seq_no: 1, status: 'completed', sent_at: day(2026, 7, 1) },
      { seq_no: 3, status: 'pending', sent_at: null },
    ];
    assert.equal(reopenBlocker(submitted, siblings), null);
  });

  test('one that was never submitted cannot', () => {
    for (const status of ['pending', 'email_sent', 'opened', 'skipped']) {
      assert.match(reopenBlocker({ ...submitted, status }), /Only a submitted evaluation/, status);
    }
  });

  test('an earlier one cannot, once a later one is submitted', () => {
    const siblings = [{ seq_no: 3, status: 'completed', sent_at: day(2026, 9, 1) }];
    assert.match(reopenBlocker(submitted, siblings), /Evaluation 3 was submitted after this one/);
  });

  test('nor while a later one is with the manager', () => {
    for (const status of ['email_sent', 'opened']) {
      const siblings = [{ seq_no: 3, status, sent_at: day(2026, 9, 1) }];
      assert.match(reopenBlocker(submitted, siblings), /Evaluation 3 has already gone to the manager/, status);
    }
  });

  test('a later one that was closed does not block it', () => {
    const siblings = [{ seq_no: 3, status: 'skipped', sent_at: null }];
    assert.equal(reopenBlocker(submitted, siblings), null);
  });

  test('an imported free-text evaluation has no ratings to correct', () => {
    assert.match(reopenBlocker({ ...submitted, legacy_format: true }), /imported from the spreadsheet/);
    assert.match(reopenBlocker({ ...submitted, scores: [] }), /imported from the spreadsheet/);
  });

  test('not for someone who has left', () => {
    const left = { ...submitted, employee: { ...employee, employment_status: 'left' } };
    assert.match(reopenBlocker(left), /Priya Sharma is marked as having left/);
  });
});

describe('recording what was done about a flagged evaluation (P8)', () => {
  test('the five outcomes HR chooses from', () => {
    assert.deepEqual(Object.values(FOLLOW_UP_OUTCOMES), [
      'Spoke to the manager',
      'Spoke to the Commando',
      'Improvement plan started',
      'No action needed',
      'Other',
    ]);
  });

  test('the database accepts exactly the outcomes the app offers', () => {
    // The table's CHECK is written by hand in the DDL. One list drifting from
    // the other would show as a 500 on save, on staging, after the DDL is run.
    const ddl = readFileSync(
      fileURLToPath(new URL('../../prisma/ddl/2026-10-02-pea-review-round.sql', import.meta.url)),
      'utf8'
    );
    const check = /outcome IN \(([^)]+)\)/.exec(ddl);
    assert.ok(check, 'the outcome CHECK is in the DDL');
    const allowed = check[1].split(',').map((s) => s.trim().replace(/'/g, ''));
    assert.deepEqual(allowed.sort(), Object.keys(FOLLOW_UP_OUTCOMES).sort());
  });
});

describe('who an evaluation email is addressed to (M3 / M7)', () => {
  const cycle = {
    seq_no: 2,
    token: '11111111-1111-1111-1111-111111111111',
    period_from: day(2026, 7, 31),
    period_to: day(2026, 8, 30),
    employee: {
      full_name: 'Priya Sharma',
      office_email: 'psharma@aapnainfotech.com',
      doj: day(2026, 7, 1),
      rm_name: 'Chhavi Verma',
      rm_email: 'cverma@aapnainfotech.com',
    },
  };

  test('the reporting manager, when the link is with them', () => {
    assert.equal(buildVars(cycle, {}).manager_name, 'Chhavi Verma');
  });

  test('the acting manager, when HR sent it to one', () => {
    const vars = buildVars(cycle, { sentTo: { name: 'Rohit Jain', email: 'rjain@aapnainfotech.com', delegated: true } });
    assert.equal(vars.manager_name, 'Rohit Jain');
    assert.match(compile(TEMPLATE_DEFS.evaluation_link, vars).body, /Hello Rohit Jain,/);
  });

  test('whoever submitted it, on the emails sent after submission', () => {
    const vars = buildVars(cycle, { submittedByName: 'Rohit Jain', sentTo: { name: 'Someone Else' } });
    assert.equal(vars.manager_name, 'Rohit Jain');
  });
});

describe('the "reopened" email (M6)', () => {
  const cycle = {
    seq_no: 3,
    token: '22222222-2222-2222-2222-222222222222',
    period_from: day(2026, 8, 31),
    period_to: day(2026, 9, 29),
    employee: { full_name: 'Priya Sharma', doj: day(2026, 7, 1), rm_name: 'Chhavi Verma', rm_email: 'cverma@aapnainfotech.com' },
  };
  const vars = buildVars(cycle, {
    reason: 'Two ratings were entered against the wrong question.',
    reopenedBy: 'subhajit',
    probation: { end: day(2026, 12, 28), total: 6 },
  });
  const out = compile(TEMPLATE_DEFS.evaluation_reopened, vars);

  test('the subject says it is reopened, and which evaluation', () => {
    assert.equal(out.subject, 'Reopened - Probation Evaluation 3 of 6 - Priya Sharma');
  });

  test('the reason is given, headed as a reason for reopening — not for a decision', () => {
    assert.match(out.body, /Reason for reopening/);
    assert.doesNotMatch(out.body, /Reason for this decision/);
    assert.match(out.body, /Two ratings were entered against the wrong question\./);
  });

  test('it carries the new link, and says the old one no longer works', () => {
    assert.match(out.body, /href="[^"]*\/api\/evaluation\/22222222-2222-2222-2222-222222222222"/);
    assert.match(out.body, /The link you used before no longer works/);
  });

  test('an edit that drops the form link is refused, as for the first request', () => {
    assert.throws(() => validateDraft('evaluation_reopened', { subject: 'Reopened', body: '<p>Please correct it.</p>' }));
  });
});
