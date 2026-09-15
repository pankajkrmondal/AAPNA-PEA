/**
 * Cloudflare Turnstile — the "verify you are human" check on the login page.
 *
 * The browser widget hands the login form a one-time token; this asks
 * Cloudflare whether that token is genuine before any password is checked.
 * It fails CLOSED: if Cloudflare cannot be reached, nobody signs in, because a
 * check that quietly passes whenever it errors protects nothing.
 */
import config from '../config/index.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Cloudflare's documented maximum token length.
const MAX_TOKEN_LENGTH = 2048;

/**
 * Throws unless Cloudflare confirms the token. Does nothing when Turnstile is
 * not configured (local development without a key).
 *
 * @param {string} token     the widget's token, sent by the login form
 * @param {string} [remoteIp] the signer-in's IP, so Cloudflare can match it
 */
export async function verifyTurnstile(token, remoteIp) {
  if (!config.turnstile.enabled) return;

  if (!token || typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
    throw new AppError('Please complete the security check', 400);
  }

  let outcome;
  try {
    const body = new URLSearchParams({ secret: config.turnstile.secretKey, response: token });
    if (remoteIp) body.append('remoteip', remoteIp);

    const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    outcome = await res.json();
  } catch (err) {
    logger.error(`🛡️ Turnstile verification unreachable: ${err.message}`);
    throw new AppError('The security check could not be verified. Please try again.', 503);
  }

  if (!outcome?.success) {
    const codes = (outcome?.['error-codes'] || []).join(', ') || 'no reason given';
    logger.warn(`🛡️ Turnstile rejected a sign-in from ${remoteIp || 'unknown IP'}: ${codes}`);
    throw new AppError('Security check failed. Please try again.', 403);
  }
}
