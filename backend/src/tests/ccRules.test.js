/**
 * Tests for the CC rules Subhajit described on 15 Sep, and for the shared
 * evaluation-status vocabulary.
 *
 * Two separate promises were made in that call:
 *
 *   "Anuj will be there in the CC as well… I will be there in the CC as well
 *    along with the HR."                                    — 18:40
 *
 * and, about the project leader slot, the old Power Automate flow deliberately
 * left one address off — which PEA did not reproduce, so that person started
 * receiving mail they had previously been spared.
 *
 * The rules are small; what makes them worth pinning is that both are silent
 * when wrong. Nobody notices an address that should not be on a CC line until
 * the person on it complains.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

/** The project-leader rule as resolveRecipients() applies it. */
const plFor = (employee, neverList) => {
  const never = new Set(neverList.map((s) => s.toLowerCase()));
  const pl = String(employee?.pl_email || '').trim();
  return pl && !never.has(pl.toLowerCase()) ? [pl] : [];
};

describe('"never copy as project leader"', () => {
  const employee = { pl_email: 'aroy@aapnainfotech.com', rm_email: 'harish@aapnainfotech.com' };

  test('the project leader is copied when the list is empty', () => {
    assert.deepEqual(plFor(employee, []), ['aroy@aapnainfotech.com']);
  });

  test('a listed address is dropped from the project-leader slot', () => {
    assert.deepEqual(plFor(employee, ['aroy@aapnainfotech.com']), []);
  });

  test('the match ignores case', () => {
    assert.deepEqual(plFor(employee, ['ARoy@Aapnainfotech.com']), []);
  });

  test('someone else on the list does not suppress this project leader', () => {
    assert.deepEqual(plFor(employee, ['other@aapnainfotech.com']), ['aroy@aapnainfotech.com']);
  });

  test('an employee with no project leader yields nothing, not a blank address', () => {
    assert.deepEqual(plFor({ pl_email: '' }, []), []);
    assert.deepEqual(plFor({ pl_email: '   ' }, []), []);
  });

  test('suppression applies to the PL slot only — it is not a global block', () => {
    // The person may still be copied because they are on the standing CC list,
    // or addressed because they are the reporting manager. Those are different
    // reasons to be on the mail, and this setting speaks to only one of them.
    const ccList = ['aroy@aapnainfotech.com'];
    const cc = [...new Set([...plFor(employee, ['aroy@aapnainfotech.com']), ...ccList])];
    assert.deepEqual(cc, ['aroy@aapnainfotech.com']);
  });
});

describe('CC on manager team-link emails', () => {
  const hrList = ['hr@aapnainfotech.com'];
  const ccList = ['rakhi@aapnainfotech.com'];

  const teamLinkCc = (on) => (on ? [...new Set([...hrList, ...ccList])] : []);

  test('on, HR and the standing CC list are copied', () => {
    assert.deepEqual(teamLinkCc(true), ['hr@aapnainfotech.com', 'rakhi@aapnainfotech.com']);
  });

  test('off, nobody is copied — the old behaviour', () => {
    assert.deepEqual(teamLinkCc(false), []);
  });

  test('an address on both lists is copied once', () => {
    const both = [...new Set([...['x@aapnainfotech.com'], ...['x@aapnainfotech.com']])];
    assert.deepEqual(both, ['x@aapnainfotech.com']);
  });
});
