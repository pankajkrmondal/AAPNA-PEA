/**
 * sso.service.js — "Sign in with Microsoft". Plan §5.4 Option 3.
 *
 * OpenID Connect authorization-code flow with PKCE against Entra, using the
 * app registration PEA already holds. No new dependency: the token exchange is
 * one POST, and the ID token is verified with Node's own crypto against
 * Microsoft's published signing keys.
 *
 * ── Deliberately OFF ───────────────────────────────────────────────────────
 * Needs SSO_ENABLED=true AND a redirect URI that IT has added to the app
 * registration. Until IT does that, Microsoft rejects the redirect and there is
 * nothing to test against — so it ships off, and password sign-in is
 * unaffected either way.
 *
 * ── Rules ──────────────────────────────────────────────────────────────────
 *   · SSO never creates accounts. Signing in with Microsoft requires an
 *     existing, active PEA user with the same email. Admins still decide who
 *     has access (Users screen).
 *   · On first Microsoft sign-in the user is bound to their Entra object id.
 *     After that, a different Microsoft account with the same email is refused
 *     — a recycled address must not inherit someone else's access.
 *   · Every check a spoofed token would need to pass is made: signature
 *     (RS256, Microsoft's JWKS), issuer = this tenant, audience = this app,
 *     expiry, tenant id, and the nonce bound to this browser's sign-in.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { startSessionFor } from './auth.service.js';

const TIMEOUT_MS = 15_000;
const STATE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 500;
const JWKS_TTL_MS = 24 * 60 * 60 * 1000;

/** state → { verifier, nonce, createdAt }. In memory: PEA runs one fork process. */
const pending = new Map();
let jwksCache = { keys: null, fetchedAt: 0 };

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** A PKCE verifier and its S256 challenge. Pure — exported for tests. */
export function pkcePair() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

/** Is SSO switched on and fully configured? */
export function ssoStatus() {
  const { clientId, clientSecret, tenantId } = config.microsoft;
  const missing = [
    !config.sso.redirectUri && 'SSO_REDIRECT_URI',
    !clientId && 'MS_CLIENT_ID',
    !clientSecret && 'MS_CLIENT_SECRET',
    !tenantId && 'MS_TENANT_ID',
  ].filter(Boolean);

  return { enabled: config.sso.enabled && missing.length === 0, requested: config.sso.enabled, missing };
}

/**
 * The Microsoft authorize URL for a fresh sign-in.
 * @returns {string}
 */
export function buildStartUrl() {
  const status = ssoStatus();
  if (!status.enabled) {
    throw new AppError(
      status.requested
        ? `Microsoft sign-in is misconfigured — missing ${status.missing.join(', ')}`
        : 'Microsoft sign-in is not enabled',
      503
    );
  }

  // Bound the map so a flood of abandoned starts cannot grow it without limit.
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > STATE_TTL_MS) pending.delete(k);
  if (pending.size >= MAX_PENDING) pending.delete(pending.keys().next().value);

  const state = b64url(crypto.randomBytes(24));
  const nonce = b64url(crypto.randomBytes(24));
  const { verifier, challenge } = pkcePair();
  pending.set(state, { verifier, nonce, createdAt: now });

  const params = new URLSearchParams({
    client_id: config.microsoft.clientId,
    response_type: 'code',
    redirect_uri: config.sso.redirectUri,
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });

  return `https://login.microsoftonline.com/${encodeURIComponent(config.microsoft.tenantId)}/oauth2/v2.0/authorize?${params}`;
}

/**
 * Check the claims of an ID token whose signature has already been verified.
 *
 * Pure — exported so every rule is covered by a test.
 *
 * @param {object} claims
 * @param {{tenantId: string, clientId: string, nonce: string, nowSec?: number}} expected
 * @throws {AppError} 401
 */
export function validateIdTokenClaims(claims, { tenantId, clientId, nonce, nowSec = Math.floor(Date.now() / 1000) }) {
  const fail = (why) => { throw new AppError(`Microsoft sign-in rejected: ${why}`, 401); };
  const SKEW = 120;

  if (!claims || typeof claims !== 'object') fail('no claims');
  if (claims.iss !== `https://login.microsoftonline.com/${tenantId}/v2.0`) fail('token issued by a different tenant');
  if ((Array.isArray(claims.aud) ? !claims.aud.includes(clientId) : claims.aud !== clientId)) fail('token issued for a different application');
  if (claims.tid !== tenantId) fail('account belongs to a different organisation');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW < nowSec) fail('token expired');
  if (typeof claims.nbf === 'number' && claims.nbf - SKEW > nowSec) fail('token not yet valid');
  if (!nonce || claims.nonce !== nonce) fail('sign-in session mismatch — start again');
  if (!claims.oid) fail('no account id in token');
}

/** The identity PEA uses from a validated token. Pure. */
export function pickIdentity(claims) {
  const email = String(claims.preferred_username || claims.email || claims.upn || '').trim().toLowerCase();
  return { oid: claims.oid, email, name: claims.name || null };
}

async function signingKeyFor(kid) {
  const fresh = jwksCache.keys && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  let key = fresh ? jwksCache.keys.find((k) => k.kid === kid) : null;

  // An unknown kid on a cached set usually means Microsoft rotated keys —
  // refetch once before refusing.
  if (!key) {
    const res = await fetch(
      `https://login.microsoftonline.com/${encodeURIComponent(config.microsoft.tenantId)}/discovery/v2.0/keys`,
      { signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!res.ok) throw new AppError('Could not fetch Microsoft signing keys', 502);
    const body = await res.json();
    jwksCache = { keys: body.keys || [], fetchedAt: Date.now() };
    key = jwksCache.keys.find((k) => k.kid === kid);
  }

  if (!key) throw new AppError('Microsoft sign-in rejected: unknown signing key', 401);
  return crypto.createPublicKey({ key, format: 'jwk' });
}

/**
 * Complete a sign-in from Microsoft's redirect.
 * @param {{code?: string, state?: string, error?: string, error_description?: string}} query
 * @returns {Promise<{token: string, user: object}>}
 */
export async function completeSignIn(query) {
  if (!ssoStatus().enabled) throw new AppError('Microsoft sign-in is not enabled', 503);

  if (query.error) {
    throw new AppError(
      query.error === 'access_denied' ? 'Sign-in was cancelled' : `Microsoft reported: ${String(query.error_description || query.error).slice(0, 200)}`,
      401
    );
  }

  const entry = pending.get(String(query.state || ''));
  pending.delete(String(query.state || '')); // single use, success or not
  if (!entry || Date.now() - entry.createdAt > STATE_TTL_MS) {
    throw new AppError('Sign-in session expired or was already used — start again', 401);
  }
  if (!query.code) throw new AppError('Microsoft returned no authorisation code', 401);

  const { clientId, clientSecret, tenantId } = config.microsoft;

  const tokenRes = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code: String(query.code),
      redirect_uri: config.sso.redirectUri,
      code_verifier: entry.verifier,
      scope: 'openid profile email',
    }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.id_token) {
    logger.warn(`SSO token exchange failed (${tokenRes.status}): ${tokens.error_description || tokens.error || 'no id_token'}`);
    throw new AppError('Microsoft sign-in could not be completed. If this persists, the redirect URI may not be registered.', 401);
  }

  const header = jwt.decode(tokens.id_token, { complete: true })?.header;
  if (!header?.kid || header.alg !== 'RS256') throw new AppError('Microsoft sign-in rejected: unexpected token format', 401);

  let claims;
  try {
    claims = jwt.verify(tokens.id_token, await signingKeyFor(header.kid), { algorithms: ['RS256'] });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Microsoft sign-in rejected: signature check failed', 401);
  }

  validateIdTokenClaims(claims, { tenantId, clientId, nonce: entry.nonce });
  const identity = pickIdentity(claims);

  // Bound account first; otherwise an unbound account with the same email.
  let user = await prisma.pea_users.findFirst({ where: { azure_object_id: identity.oid } });

  if (!user) {
    if (!identity.email) throw new AppError('Your Microsoft account has no email address PEA can match', 403);
    const byEmail = await prisma.pea_users.findFirst({
      where: { email: { equals: identity.email, mode: 'insensitive' } },
    });
    if (byEmail?.azure_object_id && byEmail.azure_object_id !== identity.oid) {
      logger.warn(`SSO refused: ${identity.email} is bound to a different Entra account`);
      throw new AppError('This PEA account is linked to a different Microsoft account. Ask an admin.', 403);
    }
    user = byEmail;
  }

  if (!user) {
    logger.info(`SSO refused: no PEA user for ${identity.email}`);
    throw new AppError(`${identity.email} does not have a PEA account. Ask an admin to add you.`, 403);
  }
  if (!user.is_active) throw new AppError('This account has been deactivated', 403);

  if (!user.azure_object_id) {
    user = await prisma.pea_users.update({ where: { id: user.id }, data: { azure_object_id: identity.oid } });
    logger.info(`SSO: ${user.username} bound to Entra account ${identity.oid}`);
  }

  return startSessionFor(user, 'microsoft');
}
