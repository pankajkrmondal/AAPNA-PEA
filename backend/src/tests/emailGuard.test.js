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
});
