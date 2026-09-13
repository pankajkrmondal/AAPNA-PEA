/**
 * Microsoft sign-in checks. Each test is one way a forged, replayed or
 * misdirected token must be refused.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { pkcePair, validateIdTokenClaims, pickIdentity, ssoStatus } from '../services/sso.service.js';

const TENANT = '96875b81-ae26-4741-b919-67a6739aa8bc';
const CLIENT = '11111111-2222-3333-4444-555555555555';
const NOW = 1_800_000_000;

const good = () => ({
  iss: `https://login.microsoftonline.com/${TENANT}/v2.0`,
  aud: CLIENT,
  tid: TENANT,
  oid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  exp: NOW + 3600,
  nbf: NOW - 10,
  nonce: 'n-123',
  preferred_username: 'PKMondal@aapnainfotech.com',
  name: 'Pan Mondal',
});

const check = (claims, over = {}) =>
  validateIdTokenClaims(claims, { tenantId: TENANT, clientId: CLIENT, nonce: 'n-123', nowSec: NOW, ...over });

describe('Microsoft sign-in — ID token claims', () => {
  test('a valid token passes', () => {
    assert.doesNotThrow(() => check(good()));
  });

  test('a token from another tenant is refused', () => {
    assert.throws(() => check({ ...good(), iss: 'https://login.microsoftonline.com/other/v2.0' }), /different tenant/);
  });

  test('a token issued to another application is refused', () => {
    assert.throws(() => check({ ...good(), aud: 'someone-elses-app' }), /different application/);
  });

  test('a guest from another organisation is refused', () => {
    assert.throws(() => check({ ...good(), tid: 'other-tenant' }), /different organisation/);
  });

  test('an expired token is refused (beyond two minutes of clock skew)', () => {
    assert.throws(() => check({ ...good(), exp: NOW - 600 }), /expired/);
    assert.doesNotThrow(() => check({ ...good(), exp: NOW - 60 }), 'within skew is tolerated');
  });

  test('a replayed token from another sign-in attempt is refused by the nonce', () => {
    assert.throws(() => check({ ...good(), nonce: 'someone-elses-nonce' }), /session mismatch/);
  });

  test('a token with no account id is refused', () => {
    const c = good();
    delete c.oid;
    assert.throws(() => check(c), /account id/);
  });
});

describe('Microsoft sign-in — helpers', () => {
  test('PKCE challenge is the S256 of the verifier', () => {
    const { verifier, challenge } = pkcePair();
    const expected = crypto.createHash('sha256').update(verifier).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    assert.equal(challenge, expected);
    assert.ok(verifier.length >= 43, 'RFC 7636 minimum length');
  });

  test('identity uses the lower-cased email and the object id', () => {
    assert.deepEqual(pickIdentity(good()), {
      oid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      email: 'pkmondal@aapnainfotech.com',
      name: 'Pan Mondal',
    });
  });

  test('SSO is off unless explicitly enabled', () => {
    assert.equal(ssoStatus().enabled, false);
  });
});
