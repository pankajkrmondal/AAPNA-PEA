/**
 * Tests for the Cloudflare Turnstile check on sign-in.
 *
 * Cloudflare is never called for real: fetch is replaced per test, so these
 * prove what PEA does with each kind of answer — including no answer at all,
 * where the check must fail closed rather than let the sign-in through.
 */
import { test, describe, mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import config from '../config/index.js';
import { verifyTurnstile } from '../services/turnstile.service.js';

/** Make the next fetch answer with this Cloudflare response body. */
const cloudflareSays = (body) =>
  mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body)));

describe('login security check (Turnstile)', () => {
  afterEach(() => mock.restoreAll());

  test('is switched on locally, with the Cloudflare test secret', () => {
    assert.equal(config.turnstile.enabled, true);
  });

  test('a missing token is refused without asking Cloudflare', async () => {
    const fetch = cloudflareSays({ success: true });
    await assert.rejects(verifyTurnstile('', '203.0.113.7'), /complete the security check/);
    assert.equal(fetch.mock.callCount(), 0);
  });

  test('an oversized token is refused without asking Cloudflare', async () => {
    const fetch = cloudflareSays({ success: true });
    await assert.rejects(verifyTurnstile('x'.repeat(2049)), /complete the security check/);
    assert.equal(fetch.mock.callCount(), 0);
  });

  test('a token Cloudflare accepts passes, sending the secret, token and IP', async () => {
    const fetch = cloudflareSays({ success: true });
    await verifyTurnstile('good-token', '203.0.113.7');

    const [url, init] = fetch.mock.calls[0].arguments;
    assert.match(url, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify$/);
    assert.equal(init.body.get('secret'), config.turnstile.secretKey);
    assert.equal(init.body.get('response'), 'good-token');
    assert.equal(init.body.get('remoteip'), '203.0.113.7');
  });

  test('a token Cloudflare rejects is refused', async () => {
    cloudflareSays({ success: false, 'error-codes': ['invalid-input-response'] });
    await assert.rejects(verifyTurnstile('bad-token', '203.0.113.7'), /Security check failed/);
  });

  test('fails closed when Cloudflare cannot be reached', async () => {
    mock.method(globalThis, 'fetch', async () => {
      throw new Error('getaddrinfo ENOTFOUND challenges.cloudflare.com');
    });
    await assert.rejects(verifyTurnstile('good-token'), /could not be verified/);
  });
});
