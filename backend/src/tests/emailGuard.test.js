/**
 * Tests for the staging email rule: outside production, nobody but the test
 * inbox may ever receive mail from PEA.
 *
 * Two locks are tested separately on purpose. applyRedirect() rewrites
 * recipients; assertRecipientsAllowed() refuses anything that slipped past.
 * Either one alone would stop a real manager being mailed — both together mean
 * a single mistake in either cannot.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import config from '../config/index.js';
import { applyRedirect } from '../services/notification.service.js';
import { assertRecipientsAllowed, sendMail } from '../services/graphMailer.service.js';

describe('staging email rule', () => {
  test('the redirect is on outside production, regardless of any env flag', () => {
    assert.notEqual(config.env, 'production');
    assert.equal(config.email.redirectInNonProd, true);
  });

  test('a test inbox is configured', () => {
    assert.ok(config.email.testRecipients.length > 0);
  });

  test('applyRedirect replaces every real recipient and clears cc', () => {
    const out = applyRedirect({
      to: ['rm@aapnainfotech.com', 'candidate@gmail.com'],
      cc: ['pl@aapnainfotech.com', 'sroy@aapnainfotech.com'],
    });

    assert.deepEqual(out.to, config.email.testRecipients);
    assert.deepEqual(out.cc, []);
    assert.equal(out.redirected, true);
  });

  test('the transport accepts the test inbox', () => {
    assert.doesNotThrow(() => assertRecipientsAllowed(config.email.testRecipients, []));
  });

  test('the transport refuses a real recipient in to', () => {
    assert.throws(() => assertRecipientsAllowed(['rm@aapnainfotech.com'], []), /Blocked/);
  });

  test('the transport refuses a real recipient hidden in cc', () => {
    assert.throws(
      () => assertRecipientsAllowed(config.email.testRecipients, ['pl@aapnainfotech.com']),
      /Blocked/
    );
  });

  test('the transport refuses before any network call is attempted', async () => {
    // If this reached Graph it would need credentials and time out or 401;
    // a synchronous "Blocked" rejection proves it stopped first.
    await assert.rejects(
      sendMail({ to: ['someone@aapnainfotech.com'], subject: 't', html: '<p>t</p>' }),
      /Blocked/
    );
  });

  test('case and whitespace cannot be used to slip past the allow-list', () => {
    const inbox = config.email.testRecipients[0];
    assert.doesNotThrow(() => assertRecipientsAllowed([` ${inbox.toUpperCase()} `], []));
  });

  test('redirectActive is on here, which is what both locks read', () => {
    assert.equal(config.email.redirectActive, true);
  });
});

/**
 * The production rule (22 Sep 2026), tested as pure decisions.
 *
 * config/index.js reads NODE_ENV once at import and the suite runs in a single
 * environment, so these assert the RULE rather than a re-imported config: the
 * same two expressions config builds, against every combination that matters.
 * If someone changes the rule in config without changing it here, the
 * duplicated expression below stops matching and this file is the reminder.
 */
describe('production email rule — EMAIL_REDIRECT_TO_TEST', () => {
  const bool = (v, fallback = false) =>
    v === undefined ? fallback : String(v).toLowerCase() === 'true';

  /** Exactly the expressions in config/index.js. */
  const decide = (nodeEnv, flag) => {
    const redirectInNonProd = nodeEnv !== 'production';
    const redirectInProd = nodeEnv === 'production' && bool(flag, false);
    return { redirectInNonProd, redirectInProd, redirectActive: redirectInNonProd || redirectInProd };
  };

  test('production with the flag false sends to real recipients', () => {
    assert.equal(decide('production', 'false').redirectActive, false);
  });

  test('production with the flag UNSET sends to real recipients', () => {
    // The default matters: a missing line must not silently swallow every
    // evaluation email in the one environment that is supposed to send.
    assert.equal(decide('production', undefined).redirectActive, false);
  });

  test('production with the flag true diverts to the test inbox', () => {
    const d = decide('production', 'true');
    assert.equal(d.redirectActive, true);
    assert.equal(d.redirectInProd, true);
  });

  test('staging diverts whatever the flag says — false cannot unlock it', () => {
    for (const flag of ['false', 'true', undefined, 'FALSE', 'no']) {
      assert.equal(decide('staging', flag).redirectActive, true, `flag=${flag}`);
    }
  });

  test('development diverts whatever the flag says', () => {
    assert.equal(decide('development', 'false').redirectActive, true);
  });

  test('only production can ever reach real recipients', () => {
    for (const env of ['staging', 'development', 'test', 'qa', '']) {
      assert.equal(decide(env, 'false').redirectActive, true, `env=${env}`);
    }
  });
});
