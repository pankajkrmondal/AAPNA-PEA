/**
 * index.js — environment loading and typed config.
 *
 * Loads `.env.<NODE_ENV>` (not plain `.env`, which is reserved for the Prisma
 * CLI — it only ever reads that filename). Mirrors the ATS convention so the
 * same deploy muscle memory applies.
 */
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = path.resolve(__dirname, '../../', `.env.${NODE_ENV}`);

if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
} else {
  // Fall back to plain .env so the app still starts in a bare environment,
  // but say so loudly — a missing env file is usually a deploy mistake.
  dotenv.config();
  console.warn(`⚠️  ${envFile} not found — fell back to .env`);
}

/** Split a semicolon- or comma-separated env value into a clean array. */
const list = (v) =>
  (v || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);

const bool = (v, fallback = false) =>
  v === undefined ? fallback : String(v).toLowerCase() === 'true';

const config = {
  env: NODE_ENV,
  isProduction: NODE_ENV === 'production',
  isDevelopment: NODE_ENV === 'development',

  // 5000 = ATS staging, 5001 = ATS production. PEA uses 5002/5003.
  port: parseInt(process.env.PORT || '5002', 10),

  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',

  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    refreshExpiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d',
  },

  microsoft: {
    clientId: process.env.MS_CLIENT_ID,
    clientSecret: process.env.MS_CLIENT_SECRET,
    tenantId: process.env.MS_TENANT_ID,
    // Shared mailbox once IT provisions it; otherwise the ATS default sender.
    // Switching over is this one value plus a restart. Plan R16.
    sender: process.env.PEA_SENDER_EMAIL || process.env.MS_DEFAULT_SENDER_EMAIL,
    replyTo: process.env.PEA_REPLY_TO || '',
  },

  email: {
    // Hard guard, mirroring ATS staging: outside production every recipient is
    // rewritten to testRecipients and CC is cleared. This is what stops a
    // half-tested build emailing 130 real reporting managers. Plan R8.
    //
    // PEA applies this with NO exceptions. ATS exempts internal alerts and
    // operator-typed addresses; PEA has no equivalent case — every recipient
    // here is a colleague who never asked to be mailed from a test system.
    //
    // MANDATORY outside production (13 Sep 2026). It used to follow
    // EMAIL_REDIRECT_TO_TEST, so one mistyped line in .env.staging could email
    // real managers and candidates. It is now tied to NODE_ENV alone, and the
    // boot check below refuses to start if anyone tries to switch it off.
    redirectInNonProd: NODE_ENV !== 'production',
    testRecipients: list(process.env.EMAIL_STAGING_RECIPIENTS),
  },

  // Microsoft sign-in. Off unless explicitly enabled AND a redirect URI that IT
  // has registered on the app registration is configured. Plan §5.4 Option 3.
  sso: {
    enabled: bool(process.env.SSO_ENABLED, false),
    redirectUri: process.env.SSO_REDIRECT_URI || '',
  },

  scheduler: {
    enabled: bool(process.env.PEA_SCHEDULER_ENABLED, false),
    timezone: process.env.TZ || 'Asia/Kolkata',
  },

  logLevel: process.env.LOG_LEVEL || 'debug',
};

// ── Fail fast on missing essentials ──────────────────────────────────────
const required = [['DATABASE_URL', process.env.DATABASE_URL], ['JWT_SECRET', config.jwt.secret]];

const missing = required.filter(([, v]) => !v).map(([k]) => k);
if (missing.length) {
  console.error(`💥 Missing required env vars: ${missing.join(', ')} (from .env.${NODE_ENV})`);
  process.exit(1);
}

if (config.isProduction && config.jwt.secret.includes('change-me')) {
  console.error('💥 JWT_SECRET is still the development placeholder. Refusing to start in production.');
  process.exit(1);
}

// ── FAIL CLOSED on the email guard ───────────────────────────────────────
// If the redirect is ON but no substitute inbox is configured, there is no safe
// address to send to — and treating an empty list as "no redirect needed" would
// do precisely what the guard exists to prevent, silently. Refusing to boot is
// recoverable; a real reporting manager emailed from staging is not.
if (config.email.redirectInNonProd && config.email.testRecipients.length === 0) {
  console.error(
    `💥 NODE_ENV is "${NODE_ENV}", so every email must be redirected — but EMAIL_STAGING_RECIPIENTS is empty.\n` +
      '   There is no safe address to divert mail to, so PEA will not start.\n' +
      `   Set EMAIL_STAGING_RECIPIENTS in .env.${NODE_ENV}.`
  );
  process.exit(1);
}

// Refuse rather than silently ignore: someone who writes
// EMAIL_REDIRECT_TO_TEST=false on staging believes real people will be mailed.
// Starting anyway would leave them debugging "why did nobody get it", and
// honouring it would mail real managers from a test system. Neither is safe.
if (config.email.redirectInNonProd && process.env.EMAIL_REDIRECT_TO_TEST !== undefined
    && !bool(process.env.EMAIL_REDIRECT_TO_TEST, true)) {
  console.error(
    `💥 EMAIL_REDIRECT_TO_TEST=false is not allowed when NODE_ENV is "${NODE_ENV}".\n` +
      '   Outside production every email is redirected to EMAIL_STAGING_RECIPIENTS, always.\n' +
      '   Real recipients are only ever mailed with NODE_ENV=production.'
  );
  process.exit(1);
}

export default config;
