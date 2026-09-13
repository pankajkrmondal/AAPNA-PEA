/**
 * graphMailer.service.js — the Microsoft Graph transport.
 *
 * The ONLY place in PEA that can put a message on the wire. Everything else
 * goes through notification.service.js, which decides whether a send should
 * happen at all; this file just performs it.
 *
 * Auth is client credentials (app-only), reusing the ATS app registration —
 * decision D3, taken so Day 4 was not blocked waiting on IT to issue new
 * credentials. ⚠️ That secret now backs TWO systems: when it expires, ATS and
 * PEA both stop sending. Its expiry date needs recording.
 */
import config from '../config/index.js';
import logger from '../config/logger.js';

const TOKEN_TIMEOUT_MS = 30_000;
const SEND_TIMEOUT_MS = 30_000;

let cachedToken = null;
let tokenExpiry = null;

/**
 * Get an app-only Graph access token, cached until shortly before it expires.
 * @returns {Promise<string>}
 */
export async function getAccessToken() {
  if (cachedToken && tokenExpiry && Date.now() < tokenExpiry) return cachedToken;

  const { clientId, clientSecret, tenantId } = config.microsoft;
  if (!clientId || !clientSecret || !tenantId) {
    throw new Error(
      'Microsoft credentials are not configured (MS_CLIENT_ID / MS_CLIENT_SECRET / MS_TENANT_ID).'
    );
  }

  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      scope: 'https://graph.microsoft.com/.default',
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }).toString(),
    signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // A lapsed client secret surfaces here first, and the raw Graph message is
    // unhelpful — say what it usually means.
    throw new Error(
      `Could not obtain a Microsoft access token (${res.status}). ` +
        'If this started suddenly, check whether the app registration secret has expired. ' +
        detail.slice(0, 300)
    );
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiry = Date.now() + data.expires_in * 1000 - 300_000; // 5 min early
  return cachedToken;
}

/**
 * Refuse any recipient outside the test inbox when not in production.
 *
 * Checked in the transport, not only upstream, so the rule holds by
 * construction rather than by every caller remembering it. Throws before a
 * token is even requested — a blocked message never reaches Microsoft.
 *
 * @param {string[]} to
 * @param {string[]} [cc]
 * @throws {Error} when any address is not an approved test recipient
 */
export function assertRecipientsAllowed(to = [], cc = []) {
  if (!config.email.redirectInNonProd) return;

  const allowed = new Set(config.email.testRecipients.map((a) => a.trim().toLowerCase()));
  const offending = [...to, ...cc].filter((a) => !allowed.has(String(a || '').trim().toLowerCase()));

  if (allowed.size === 0 || offending.length) {
    throw new Error(
      `Blocked: ${config.env} may only email ${[...allowed].join(', ') || '(no test inbox configured)'}; ` +
        `refused ${offending.join(', ') || '(empty list)'}.`
    );
  }
}

/**
 * Send one HTML email through Graph.
 *
 * Takes recipients exactly as given — it does NOT apply the non-production
 * redirect. That happens upstream in notification.service.applyRedirect(), so
 * there is exactly one place where the divert decision is made and it cannot be
 * bypassed by calling a different helper.
 *
 * @param {object} params
 * @param {string[]} params.to
 * @param {string[]} [params.cc]
 * @param {string} params.subject
 * @param {string} params.html
 * @param {string} [params.replyTo]
 * @returns {Promise<{messageId: string|null}>}
 */
export async function sendMail({ to, cc = [], subject, html, replyTo }) {
  // Second, independent lock. notification.applyRedirect() already rewrites
  // recipients, but this is the last line before the wire: even a future code
  // path that forgets to call it cannot mail a real person outside production.
  assertRecipientsAllowed(to, cc);

  const sender = config.microsoft.sender;
  if (!sender) throw new Error('No sender mailbox configured (PEA_SENDER_EMAIL / MS_DEFAULT_SENDER_EMAIL).');
  if (!to || to.length === 0) throw new Error('No recipients resolved for this message.');

  const token = await getAccessToken();
  const address = (a) => ({ emailAddress: { address: a } });

  const payload = {
    message: {
      subject,
      body: { contentType: 'HTML', content: html },
      toRecipients: to.map(address),
      ...(cc.length ? { ccRecipients: cc.map(address) } : {}),
      ...(replyTo ? { replyTo: [address(replyTo)] } : {}),
    },
    saveToSentItems: true,
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    }
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Graph sendMail failed (${res.status}): ${detail.slice(0, 400)}`);
  }

  logger.debug(`Graph sendMail accepted: "${subject}" → ${to.join(', ')}`);
  // sendMail returns 202 with no body, so there is no message id to capture.
  return { messageId: null };
}

/**
 * Verify credentials and the sender mailbox without sending anything.
 * Used by the admin diagnostics endpoint so a misconfiguration is found on
 * purpose rather than on the morning of the first live sweep.
 * @returns {Promise<{ok: boolean, sender: string, detail: string}>}
 */
export async function verifyConnection() {
  const sender = config.microsoft.sender;
  try {
    const token = await getAccessToken();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}?$select=mail,displayName`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS) }
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return {
        ok: false,
        sender,
        detail: `Token obtained, but the mailbox could not be read (${res.status}). ${detail.slice(0, 200)}`,
      };
    }

    const user = await res.json();
    return { ok: true, sender, detail: `Mailbox reachable: ${user.displayName} <${user.mail}>` };
  } catch (err) {
    return { ok: false, sender, detail: err.message };
  }
}
