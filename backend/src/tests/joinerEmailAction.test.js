/**
 * Walkthrough (27-10-2026) W-09 — Confirm / Not confirm from the new joiner
 * review email.
 *
 * The rules that make an emailed button safe enough to act on, checked without
 * a database: the link is signed for this purpose only, it expires, it is tied
 * to what the email showed, and Confirm is offered only when nothing needs a
 * person's choice.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import {
  AUDIENCE, LINK_HOURS, JOINER_REVIEW_TO_DEFAULT,
  confirmValues, fingerprint, emailConfirmBlocker, signAction, verifyAction, actionLinks,
} from '../services/joinerEmailLink.service.js';
import { TEMPLATE_DEFS, compile, buildVars } from '../services/emailTemplate.service.js';
import { REGISTRY, normaliseValue } from '../services/settings.service.js';

const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

/** A serialised candidate with everything Confirm needs. */
const ready = {
  id: '42',
  display_name: 'Rohan Mehta',
  office_email: 'rmehta@aapnainfotech.com',
  suggested_doj: '2026-10-21',
  suggested_is_experienced: true,
  suggested_rm_name: 'Chhavi Verma',
  suggested_rm_email: 'cverma@aapnainfotech.com',
  suggested_pl_email: 'aroy@aapnainfotech.com',
};
const TODAY = day(2026, 10, 27);

describe('W-09 — what Confirm from the email may save', () => {
  test('the values are exactly the suggestions the email showed', () => {
    assert.deepEqual(confirmValues(ready), {
      doj: '2026-10-21', is_experienced: true, rm_name: 'Chhavi Verma',
      rm_email: 'cverma@aapnainfotech.com', pl_email: 'aroy@aapnainfotech.com',
    });
  });

  test('a joiner with everything suggested and nothing past due can be confirmed', () => {
    assert.equal(emailConfirmBlocker(ready, TODAY), null);
  });

  test('anything missing sends HR to PEA instead', () => {
    assert.match(emailConfirmBlocker({ ...ready, suggested_is_experienced: null }, TODAY), /Fresher or experienced/);
    assert.match(emailConfirmBlocker({ ...ready, suggested_pl_email: null }, TODAY), /project leader/);
    assert.match(emailConfirmBlocker({ ...ready, suggested_rm_email: null }, TODAY), /reporting manager/);
    assert.match(emailConfirmBlocker({ ...ready, suggested_rm_name: null }, TODAY), /reporting manager/);
    assert.match(emailConfirmBlocker({ ...ready, suggested_doj: null }, TODAY), /account creation date/);
  });

  test('evaluations already past due need a choice on the screen, so not from the email', () => {
    // A fresher's first evaluation falls due about 30 days in.
    const late = { ...ready, suggested_is_experienced: false, suggested_doj: '2026-08-01' };
    assert.match(emailConfirmBlocker(late, TODAY), /past due/);
  });

  test('the fingerprint changes when any saved value changes', () => {
    const fp = fingerprint(ready);
    assert.equal(fingerprint({ ...ready }), fp);
    assert.notEqual(fingerprint({ ...ready, suggested_doj: '2026-10-22' }), fp);
    assert.notEqual(fingerprint({ ...ready, suggested_is_experienced: false }), fp);
    assert.notEqual(fingerprint({ ...ready, suggested_pl_email: 'other@aapnainfotech.com' }), fp);
  });
});

describe('W-09 — the signed link', () => {
  test('a link verifies and says which joiner and which action', () => {
    const t = signAction({ candidateId: 42, action: 'confirm', fp: 'abc', to: 'hr2@aapnainfotech.com' });
    const p = verifyAction(t);
    assert.equal(p.cid, '42');
    assert.equal(p.act, 'confirm');
    assert.equal(p.fp, 'abc');
    assert.equal(p.to, 'hr2@aapnainfotech.com');
  });

  test('it expires after the stated hours', () => {
    const t = signAction({ candidateId: 1, action: 'dismiss', fp: 'x', to: '' });
    const { exp, iat } = jwt.decode(t);
    assert.equal(exp - iat, LINK_HOURS * 3600);
  });

  test('an expired link is refused with 410 and says how long links last', () => {
    // Signed with the real derived key, so only the expiry can fail it.
    const key = crypto.createHmac('sha256', config.jwt.secret).update(AUDIENCE).digest();
    const expired = jwt.sign({ cid: '1', act: 'confirm', fp: 'x', to: '' }, key, { expiresIn: -10, audience: AUDIENCE });
    assert.throws(() => verifyAction(expired), (e) => e.statusCode === 410 && /72 hours/.test(e.message));
  });

  test('a sign-in token — signed with JWT_SECRET itself — is not a valid link', () => {
    const login = jwt.sign({ cid: '1', act: 'confirm', fp: 'x' }, config.jwt.secret, { audience: AUDIENCE });
    assert.throws(() => verifyAction(login), (e) => e.statusCode === 400);
  });

  test('a tampered link is refused', () => {
    const t = signAction({ candidateId: 7, action: 'dismiss', fp: 'x', to: '' });
    const [h, , s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ cid: '8', act: 'confirm', fp: 'x', aud: AUDIENCE })).toString('base64url');
    assert.throws(() => verifyAction(`${h}.${forged}.${s}`), (e) => e.statusCode === 400);
  });

  test('only Confirm and Not confirm exist', () => {
    assert.throws(() => signAction({ candidateId: 1, action: 'delete', fp: 'x', to: '' }));
  });

  test('Not confirm is always offered; Confirm only when nothing needs a choice', () => {
    const ok = actionLinks(ready, { today: TODAY, to: 'hr2@aapnainfotech.com', base: 'https://pea.example/' });
    assert.match(ok.confirmUrl, /^https:\/\/pea\.example\/api\/joiner-action\//);
    assert.match(ok.dismissUrl, /^https:\/\/pea\.example\/api\/joiner-action\//);
    assert.equal(ok.blocker, null);

    const blocked = actionLinks({ ...ready, suggested_pl_email: null }, { today: TODAY, to: 'x', base: 'https://pea.example' });
    assert.equal(blocked.confirmUrl, null);
    assert.ok(blocked.dismissUrl);
    assert.match(blocked.blocker, /project leader/);
  });
});

describe('W-09 — the review email', () => {
  const base = {
    name: 'Rohan Mehta', email: 'rmehta@aapnainfotech.com', isNew: true, waitingDays: 0,
    accountCreated: '20-10-2026', suggestedDoj: '21-10-2026', manager: 'Chhavi Verma',
    projectLeader: 'aroy@aapnainfotech.com', isExperienced: true, jobTitle: 'Associate Engineer', todo: [],
  };
  const render = (joiners) => compile(TEMPLATE_DEFS.joiners_waiting, buildVars(null, {
    joiners, newCount: 1, headline: 'Microsoft 365 found 1 new joiner.', today: '27-10-2026',
  })).body;

  test('sent to the review mailbox, each joiner has Confirm and Not confirm', () => {
    const body = render([{ ...base, actions: { confirmUrl: 'https://x/api/joiner-action/c', dismissUrl: 'https://x/api/joiner-action/d', blocker: null } }]);
    assert.match(body, /href="https:\/\/x\/api\/joiner-action\/c"[^>]*>Confirm</);
    assert.match(body, /href="https:\/\/x\/api\/joiner-action\/d"[^>]*>Not confirm</);
    assert.match(body, /Account created 20-10-2026/);
  });

  test('a joiner who needs a choice gets Not confirm and "review in PEA", never Confirm', () => {
    const body = render([{ ...base, actions: { confirmUrl: null, dismissUrl: 'https://x/d', blocker: 'The project leader is missing' } }]);
    assert.doesNotMatch(body, />Confirm</);
    assert.match(body, />Not confirm</);
    assert.match(body, /The project leader is missing — <a [^>]*>review in PEA/);
  });

  test('without links (no review mailbox) the table is as before, with no buttons', () => {
    const body = render([base]);
    assert.doesNotMatch(body, /joiner-action/);
    assert.match(body, /Joining date \(suggested\)/);
  });
});

describe('W-09 — the review mailbox setting', () => {
  const def = REGISTRY.find((s) => s.key === 'joiner_review_email_to');

  test('it exists, defaults to hr2@, and is announced to admins when changed', () => {
    assert.ok(def);
    assert.equal(def.default, JOINER_REVIEW_TO_DEFAULT);
    assert.equal(JOINER_REVIEW_TO_DEFAULT, 'hr2@aapnainfotech.com');
    assert.equal(def.critical, true);
  });

  test('blank is allowed — it switches the buttons off', () => {
    assert.equal(normaliseValue(def, ''), '');
  });
});
