/**
 * Tests for the New Joiner Inbox rules.
 *
 * These encode the measurements in plan §13 — what Entra can and cannot be
 * trusted for. Each one exists because getting it wrong produces a plausible,
 * quiet error rather than a visible failure:
 *
 *   · a majority-guess project leader CCs the wrong person on a review
 *   · a licence-only leaver rule marks 68 present colleagues as having left
 *   · an unflagged DOJ proxy shifts all six evaluation dates
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tallyRmToPl } from '../services/rmPlMap.service.js';
import { assessLeaver, accountEmail } from '../services/entraDirectory.service.js';
import { buildSuggestion } from '../services/joinerIntake.service.js';
import { toDateString } from '../utils/dateUtils.js';

describe('RM → PL derivation', () => {
  test('a manager seen with one project leader maps cleanly', () => {
    const map = tallyRmToPl([
      { rm_email: 'cverma@aapnainfotech.com', pl_email: 'sroy@aapnainfotech.com' },
      { rm_email: 'cverma@aapnainfotech.com', pl_email: 'sroy@aapnainfotech.com' },
    ]);

    assert.equal(map.length, 1);
    assert.equal(map[0].pl_email, 'sroy@aapnainfotech.com');
    assert.equal(map[0].is_ambiguous, false);
    assert.equal(map[0].total, 2);
  });

  test('the real ragupta@ case is flagged ambiguous, not resolved by majority', () => {
    // vtyagi ×4 vs aroy ×2 — the exact split measured across the 54 sheet rows.
    const rows = [
      ...Array(4).fill({ rm_email: 'ragupta@aapnainfotech.com', pl_email: 'vtyagi@aapnainfotech.com' }),
      ...Array(2).fill({ rm_email: 'ragupta@aapnainfotech.com', pl_email: 'aroy@aapnainfotech.com' }),
    ];

    const [entry] = tallyRmToPl(rows);

    assert.equal(entry.is_ambiguous, true);
    // The majority IS recorded — it is what HR will most likely confirm — but
    // derivePl() refuses to hand it out while the flag is set.
    assert.equal(entry.pl_email, 'vtyagi@aapnainfotech.com');
    assert.match(entry.note, /2 project leaders/);
    assert.match(entry.note, /vtyagi@aapnainfotech.com ×4/);
  });

  test('case and surrounding whitespace do not create duplicate managers', () => {
    const map = tallyRmToPl([
      { rm_email: 'CVerma@aapnainfotech.com ', pl_email: 'sroy@aapnainfotech.com' },
      { rm_email: ' cverma@AAPNAINFOTECH.com', pl_email: 'SRoy@aapnainfotech.com ' },
    ]);

    assert.equal(map.length, 1, 'the master sheet is full of trailing spaces and mixed case');
    assert.equal(map[0].is_ambiguous, false);
  });

  test('rows with a blank RM or PL are ignored rather than mapped to nothing', () => {
    const map = tallyRmToPl([
      { rm_email: '', pl_email: 'sroy@aapnainfotech.com' },
      { rm_email: 'cverma@aapnainfotech.com', pl_email: '' },
      { rm_email: null, pl_email: null },
    ]);

    assert.equal(map.length, 0);
  });
});

describe('leaver detection — plan §13.9', () => {
  const account = (accountEnabled, licences) => ({
    accountEnabled,
    assignedLicenses: Array(licences).fill({ skuId: 'x' }),
  });

  test('disabled AND unlicensed is the only combination that flags', () => {
    assert.equal(assessLeaver(account(false, 0)).looksLeft, true);
  });

  test('unlicensed alone does NOT flag — the stated rule over-flagged 68 of 91', () => {
    assert.equal(assessLeaver(account(true, 0)).looksLeft, false);
  });

  test('disabled but still licensed does not flag on its own', () => {
    assert.equal(assessLeaver(account(false, 2)).looksLeft, false);
  });

  test('an ordinary active account never flags', () => {
    assert.equal(assessLeaver(account(true, 3)).looksLeft, false);
  });

  test('a missing account is not evidence of anything', () => {
    const verdict = assessLeaver(null);
    assert.equal(verdict.looksLeft, false);
    assert.equal(verdict.accountEnabled, null);
    assert.equal(verdict.licensed, null);
  });

  test('both signals are reported, not just the verdict', () => {
    const verdict = assessLeaver(account(false, 0));
    assert.equal(verdict.accountEnabled, false);
    assert.equal(verdict.licensed, false);
  });
});

describe('joiner suggestions carry their provenance', () => {
  const account = {
    id: '00000000-1111-2222-3333-444444444444',
    displayName: 'Test Joiner',
    mail: 'TJoiner@aapnainfotech.com',
    userPrincipalName: 'tjoiner@aapnainfotech.com',
    accountEnabled: true,
    createdDateTime: '2026-09-01T06:30:00Z',
    assignedLicenses: [{ skuId: 'x' }],
  };

  test('the DOJ is offered as a proxy and labelled as one', () => {
    const s = buildSuggestion(account, null, null);

    assert.equal(toDateString(s.suggested_doj), '2026-09-01');
    assert.equal(
      s.doj_source,
      'account_created',
      'employeeHireDate is 0% populated, so the account date is all there is — ' +
        'and the UI must be able to say so'
    );
  });

  test('fresher vs experienced is never suggested — employeeType is 0% populated', () => {
    const s = buildSuggestion(account, null, null);
    assert.ok(!('is_experienced' in s));
    assert.ok(!('suggested_is_experienced' in s));
  });

  test('a manager from Entra is marked unverified rather than presented as fact', () => {
    const s = buildSuggestion(
      account,
      { displayName: 'Chhavi Verma', mail: 'cverma@aapnainfotech.com' },
      { pl_email: 'sroy@aapnainfotech.com', ambiguous: false, note: null }
    );

    assert.equal(s.suggested_rm_email, 'cverma@aapnainfotech.com');
    assert.equal(s.rm_source, 'entra_manager');
    assert.equal(s.suggested_pl_email, 'sroy@aapnainfotech.com');
    assert.equal(s.pl_source, 'rm_map');
  });

  test('no manager means a blank RM, never an invented one', () => {
    const s = buildSuggestion(account, null, null);
    assert.equal(s.suggested_rm_email, null);
    assert.equal(s.rm_source, null);
  });

  test('an ambiguous PL mapping yields no PL, and says why in the record', () => {
    const s = buildSuggestion(
      account,
      { displayName: 'Rahul Gupta', mail: 'ragupta@aapnainfotech.com' },
      { pl_email: null, ambiguous: true, note: 'Seen with 2 project leaders' }
    );

    assert.equal(s.suggested_pl_email, null);
    assert.equal(s.pl_source, null);
    assert.equal(s.raw_graph.plAmbiguous, true);
  });

  test('the office email is normalised — mixed case is rife in this tenant', () => {
    assert.equal(buildSuggestion(account, null, null).office_email, 'tjoiner@aapnainfotech.com');
  });

  test('an account with only a UPN is still usable', () => {
    assert.equal(accountEmail({ userPrincipalName: 'X@aapnainfotech.com' }), 'x@aapnainfotech.com');
    assert.equal(accountEmail({}), null);
  });

  test('what Entra actually said is kept verbatim for later disputes', () => {
    const s = buildSuggestion(account, null, null);
    assert.equal(s.raw_graph.createdDateTime, '2026-09-01T06:30:00Z');
    assert.equal(s.raw_graph.licenceCount, 1);
    assert.equal(s.raw_graph.accountEnabled, true);
  });
});
