/**
 * Walkthrough (27-10-2026) W-09 — Confirm / Not confirm from the new joiner
 * review email.
 *
 * 30-10-2026 — behind sign-in. The buttons open the New joiners screen on that
 * joiner instead of a public page that acted without one, so what is checked
 * here: the links carry no secret and point at New joiners, every joiner gets
 * both buttons, a link sent before the change is only redirected, the joiner
 * lookup needs a sign-in, and an action from the email says so in the history.
 * Plan: docs/PEA-Joiner-Email-Actions-Behind-Login-Plan-2026-10-30.md.
 */
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import app from '../app.js';
import {
  AUDIENCE, JOINER_REVIEW_TO_DEFAULT,
  confirmValues, emailReviewHint, joinerLink, verifyAction, actionLinks,
} from '../services/joinerEmailLink.service.js';
import { dismissReason } from '../services/joinerIntake.service.js';
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

/** An old link, signed the way the email signed them before 30-10-2026. */
const key = () => crypto.createHmac('sha256', config.jwt.secret).update(AUDIENCE).digest();
const oldLink = (payload, expiresIn = '72h') => jwt.sign(payload, key(), { expiresIn, audience: AUDIENCE });

describe('W-09 — what the Confirm dialog is prefilled with', () => {
  test('the values are exactly the suggestions the email showed', () => {
    assert.deepEqual(confirmValues(ready), {
      doj: '2026-10-21', is_experienced: true, rm_name: 'Chhavi Verma',
      rm_email: 'cverma@aapnainfotech.com', pl_email: 'aroy@aapnainfotech.com',
    });
  });

  test('a joiner with everything suggested and nothing past due needs no hint', () => {
    assert.equal(emailReviewHint(ready, TODAY), null);
  });

  test('anything missing is named, with what to do in the dialog', () => {
    assert.match(emailReviewHint({ ...ready, suggested_is_experienced: null }, TODAY), /Fresher or experienced .* after pressing Review/);
    assert.match(emailReviewHint({ ...ready, suggested_pl_email: null }, TODAY), /project leader/);
    assert.match(emailReviewHint({ ...ready, suggested_rm_email: null }, TODAY), /reporting manager/);
    assert.match(emailReviewHint({ ...ready, suggested_rm_name: null }, TODAY), /reporting manager/);
    assert.match(emailReviewHint({ ...ready, suggested_doj: null }, TODAY), /account creation date/);
  });

  test('evaluations already past due are named — the dialog asks what to do with them', () => {
    // A fresher's first evaluation falls due about 30 days in.
    const late = { ...ready, suggested_is_experienced: false, suggested_doj: '2026-08-01' };
    assert.match(emailReviewHint(late, TODAY), /past due/);
  });
});

describe('30-10-2026 — the links open New joiners, behind sign-in', () => {
  test('Confirm and Not confirm open that joiner on New joiners, marked as from the email', () => {
    const links = actionLinks(ready, { today: TODAY, base: 'https://pea.example/' });
    assert.equal(links.confirmUrl, 'https://pea.example/new-joiners?joiner=42&action=confirm&via=email');
    assert.equal(links.dismissUrl, 'https://pea.example/new-joiners?joiner=42&action=dismiss&via=email');
    assert.equal(links.hint, null);
  });

  test('the links carry no secret — no token, nothing signed', () => {
    const { confirmUrl, dismissUrl } = actionLinks(ready, { today: TODAY, base: 'https://pea.example' });
    for (const url of [confirmUrl, dismissUrl]) {
      assert.doesNotMatch(url, /joiner-action/);
      assert.deepEqual([...new URL(url).searchParams.keys()], ['joiner', 'action', 'via']);
    }
  });

  test('every joiner gets both buttons — with something missing, Confirm says what (D-1)', () => {
    const missing = actionLinks({ ...ready, suggested_pl_email: null }, { today: TODAY, base: 'https://pea.example' });
    assert.ok(missing.confirmUrl);
    assert.ok(missing.dismissUrl);
    assert.match(missing.hint, /project leader/);
  });

  test('without a frontend address the link is a path on this host', () => {
    assert.equal(joinerLink('', 7, 'dismiss'), '/new-joiners?joiner=7&action=dismiss&via=email');
  });
});

describe('30-10-2026 — links sent before the change', () => {
  let server;
  let root;
  const front = String(config.frontendUrl || '').replace(/\/+$/, '');

  before(async () => {
    server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    root = `http://127.0.0.1:${server.address().port}/api`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  test('an old link still reads, for the redirect', () => {
    const p = verifyAction(oldLink({ cid: '42', act: 'confirm', fp: 'abc', to: 'hr2@aapnainfotech.com' }));
    assert.equal(p.cid, '42');
    assert.equal(p.act, 'confirm');
  });

  test('an expired, forged or sign-in token is not read', () => {
    assert.throws(() => verifyAction(oldLink({ cid: '1', act: 'confirm' }, -10)), (e) => e.statusCode === 410);
    const login = jwt.sign({ cid: '1', act: 'confirm' }, config.jwt.secret, { audience: AUDIENCE });
    assert.throws(() => verifyAction(login), (e) => e.statusCode === 400);
    const [h, , s] = oldLink({ cid: '7', act: 'dismiss' }).split('.');
    const forged = Buffer.from(JSON.stringify({ cid: '8', act: 'confirm', aud: AUDIENCE })).toString('base64url');
    assert.throws(() => verifyAction(`${h}.${forged}.${s}`), (e) => e.statusCode === 400);
  });

  test('opening one only redirects to that joiner on New joiners', async () => {
    const res = await fetch(`${root}/joiner-action/${oldLink({ cid: '42', act: 'dismiss', fp: 'x', to: '' })}`, { redirect: 'manual' });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), `${front}/new-joiners?joiner=42&action=dismiss&via=email`);
  });

  test('the old page\'s button does nothing either — it redirects too', async () => {
    const res = await fetch(`${root}/joiner-action/${oldLink({ cid: '42', act: 'confirm', fp: 'x', to: '' })}`, { method: 'POST', redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), `${front}/new-joiners?joiner=42&action=confirm&via=email`);
  });

  test('an expired or broken link opens the New joiners list', async () => {
    for (const token of [oldLink({ cid: '42', act: 'confirm' }, -10), 'not-a-link']) {
      const res = await fetch(`${root}/joiner-action/${token}`, { redirect: 'manual' });
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('location'), `${front}/new-joiners`);
    }
  });

  test('looking up, confirming or removing a joiner needs a sign-in', async () => {
    assert.equal((await fetch(`${root}/intake/joiners/42`)).status, 401);
    assert.equal((await fetch(`${root}/intake/joiners/42/accept`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${root}/intake/joiners/42/dismiss`, { method: 'POST' })).status, 401);
  });
});

describe('30-10-2026 (D-5) — the history says the email was used', () => {
  test('Not confirm from the email is recorded as "opened from the review email"', () => {
    assert.equal(dismissReason('Not a new joiner', 'email'), 'Not a new joiner (opened from the review email)');
  });

  test('from the screen itself, or with anything else in `via`, the reason is as before', () => {
    assert.equal(dismissReason('Not a new joiner'), 'Not a new joiner');
    assert.equal(dismissReason('Not a new joiner', 'elsewhere'), 'Not a new joiner');
    assert.equal(dismissReason('  '), 'No reason given');
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
  const confirmUrl = 'https://x/new-joiners?joiner=1&action=confirm&via=email';
  const dismissUrl = 'https://x/new-joiners?joiner=1&action=dismiss&via=email';

  test('sent to the review mailbox, each joiner has Confirm and Not confirm', () => {
    const body = render([{ ...base, actions: { confirmUrl, dismissUrl, hint: null } }]);
    assert.match(body, /href="https:\/\/x\/new-joiners\?joiner=1&amp;action=confirm&amp;via=email"[^>]*>Confirm</);
    assert.match(body, /href="https:\/\/x\/new-joiners\?joiner=1&amp;action=dismiss&amp;via=email"[^>]*>Not confirm</);
    assert.match(body, /Account created 20-10-2026/);
  });

  test('a joiner with something missing gets Review, Not confirm and the hint — no "review in PEA"', () => {
    const hint = 'The project leader is missing — add them after pressing Review';
    const body = render([{ ...base, actions: { confirmUrl, dismissUrl, hint } }]);
    assert.match(body, />Review</);
    assert.doesNotMatch(body, />Confirm</);
    assert.match(body, />Not confirm</);
    assert.match(body, /The project leader is missing — add them after pressing Review/);
    assert.doesNotMatch(body, /review in PEA/);
  });

  test('the email says the buttons open PEA and may ask for a sign-in', () => {
    const body = render([{ ...base, actions: { confirmUrl, dismissUrl, hint: null } }]);
    assert.match(body, /opens New joiners in PEA/);
    assert.match(body, /sign in if asked/);
    assert.doesNotMatch(body, /opens a page with one button/);
  });

  test('without links (no review mailbox) the table is as before, with no buttons', () => {
    const body = render([base]);
    assert.doesNotMatch(body, /action=confirm/);
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
