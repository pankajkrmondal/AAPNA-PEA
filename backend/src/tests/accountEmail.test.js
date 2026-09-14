/**
 * Tests for account email (login details, password reset links) and the
 * forgot-password token.
 *
 * Account email is the one exception to the staging redirect, as in ATS, so
 * these pin down how narrow it is: only the account's own address, only when
 * the caller opts in — and a reset link that works once, for 30 minutes, and
 * never doubles as a sign-in token.
 */
import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import { sendMail } from '../services/graphMailer.service.js';
import { accountRecipient } from '../services/accountEmail.service.js';
import { signResetToken, decodeResetToken, passwordFingerprint } from '../services/passwordReset.service.js';

describe('account email reaches the account owner outside production', () => {
  afterEach(() => mock.restoreAll());

  test('this is a non-production run, where everything else is redirected', () => {
    assert.equal(config.email.redirectInNonProd, true);
  });

  test("the only recipient is the account's own address, normalised", () => {
    assert.equal(accountRecipient({ email: ' Pankaj.Mondal@AapnaInfotech.com ' }), 'pankaj.mondal@aapnainfotech.com');
  });

  test('an account without a valid email gets no recipient at all', () => {
    assert.equal(accountRecipient({ email: '' }), null);
    assert.equal(accountRecipient({ email: 'not-an-email' }), null);
    assert.equal(accountRecipient({}), null);
  });

  test('with allowRealRecipients the transport sends to the real address', async () => {
    const fetch = mock.method(globalThis, 'fetch', async (url) =>
      String(url).includes('oauth2')
        ? new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }))
        : new Response(null, { status: 202 })
    );

    await sendMail({ to: ['hr.user@aapnainfotech.com'], subject: 't', html: '<p>t</p>', allowRealRecipients: true });

    const graphCall = fetch.mock.calls.find((c) => String(c.arguments[0]).includes('/sendMail'));
    const payload = JSON.parse(graphCall.arguments[1].body);
    assert.equal(payload.message.toRecipients[0].emailAddress.address, 'hr.user@aapnainfotech.com');
  });

  test('without it, the same send is still blocked before any network call', async () => {
    const fetch = mock.method(globalThis, 'fetch', async () => new Response(null, { status: 202 }));
    await assert.rejects(sendMail({ to: ['hr.user@aapnainfotech.com'], subject: 't', html: '<p>t</p>' }), /Blocked/);
    assert.equal(fetch.mock.callCount(), 0);
  });
});

describe('password reset link', () => {
  const user = { id: 7, password_hash: '$2a$10$currenthashcurrenthashcurrenthashcurrenthashcurrentha' };

  test('a fresh link decodes to its account and current password', () => {
    const { userId, fp } = decodeResetToken(signResetToken(user));
    assert.equal(userId, 7);
    assert.equal(fp, passwordFingerprint(user.password_hash));
  });

  test('once the password changes, the link no longer matches (single use)', () => {
    const { fp } = decodeResetToken(signResetToken(user));
    assert.notEqual(fp, passwordFingerprint('$2a$10$adifferenthashafterthepasswordwasreset'));
  });

  test('a sign-in token cannot be used as a reset link', () => {
    const signIn = jwt.sign({ userId: 7, username: 'pankaj', role: 'superadmin' }, config.jwt.secret, { expiresIn: '8h' });
    assert.throws(() => decodeResetToken(signIn), /invalid/);
  });

  test('an expired link is refused, saying so', () => {
    const old = jwt.sign({ userId: 7, type: 'password-reset', fp: 'x' }, config.jwt.secret, { expiresIn: -10 });
    assert.throws(() => decodeResetToken(old), /expired/);
  });

  test('a forged or missing token is refused', () => {
    const forged = jwt.sign({ userId: 7, type: 'password-reset', fp: 'x' }, 'not-the-secret', { expiresIn: '30m' });
    assert.throws(() => decodeResetToken(forged), /invalid/);
    assert.throws(() => decodeResetToken(''), /invalid/);
    assert.throws(() => decodeResetToken(undefined), /invalid/);
  });

  test('refusals are 400, so the reset page is not bounced to sign-in', () => {
    assert.throws(() => decodeResetToken('garbage'), (err) => err.statusCode === 400 || err.status === 400);
  });
});
