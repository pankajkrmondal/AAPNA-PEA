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
    // The sending mailbox, which differs by environment (confirmed with HR,
    // 22 Sep 2026):
    //
    //   staging      pkmondal@aapnainfotech.com   a developer's own mailbox
    //   production   hr2@aapnainfotech.com        the HR mailbox
    //
    // Set per environment in `.env.<NODE_ENV>` via PEA_SENDER_EMAIL rather than
    // branched on NODE_ENV here: the environment file is what a deployer reads
    // and edits, so the address is visible where it is changed. The fallback
    // chain is kept so a file that predates this still starts.
    sender: process.env.PEA_SENDER_EMAIL || process.env.MS_DEFAULT_SENDER_EMAIL,
    replyTo: process.env.PEA_REPLY_TO || '',
  },

  email: {
    // Hard guard, mirroring ATS staging: outside production every recipient is
    // rewritten to testRecipients and CC is cleared. This is what stops a
    // half-tested build emailing 130 real reporting managers. Plan R8.
    //
    // Every evaluation email is redirected. The one exception, as in ATS
    // (NEVER_REDIRECT), is account email: login details and password reset
    // links go to the PEA user's own inbox in every environment, because a
    // redirected reset link is useless. See accountEmail.service.js.
    //
    // MANDATORY outside production (13 Sep 2026). It used to follow
    // EMAIL_REDIRECT_TO_TEST, so one mistyped line in .env.staging could email
    // real managers and candidates. It is now tied to NODE_ENV alone, and the
    // boot check below refuses to start if anyone tries to switch it off.
    //
    // ── EMAIL_REDIRECT_TO_TEST (22 Sep 2026) ────────────────────────────────
    //
    // The flag is honoured in PRODUCTION ONLY, where it defaults to false:
    //
    //   production  + false (or unset) → real recipients          ← normal
    //   production  + true             → EMAIL_STAGING_RECIPIENTS ← rehearsal
    //   staging/dev + anything         → EMAIL_STAGING_RECIPIENTS ← always
    //
    // Production defaults to sending for real, so a missing line cannot
    // silently swallow every evaluation email. The `true` case exists so the
    // first production run can be rehearsed against the real database, real
    // sender and real templates with the mail diverted to a test inbox — the
    // one thing staging cannot prove, because staging is a different database.
    //
    // Outside production the flag is ignored entirely and the boot check below
    // rejects `false` rather than appearing to accept it.
    redirectInNonProd: NODE_ENV !== 'production',
    redirectInProd: NODE_ENV === 'production' && bool(process.env.EMAIL_REDIRECT_TO_TEST, false),
    testRecipients: list(process.env.EMAIL_STAGING_RECIPIENTS),
  },

  // Cloudflare Turnstile on the login page. The site key lives in the
  // frontend build (VITE_TURNSTILE_SITE_KEY); only the secret is needed here.
  turnstile: {
    secretKey: process.env.TURNSTILE_SECRET_KEY || '',
    enabled: Boolean(process.env.TURNSTILE_SECRET_KEY),
  },

  scheduler: {
    enabled: bool(process.env.PEA_SCHEDULER_ENABLED, false),
    timezone: process.env.TZ || 'Asia/Kolkata',
  },

  logLevel: process.env.LOG_LEVEL || 'debug',
};

// The single question every send site asks: "is mail being diverted right now?"
//
// Derived rather than stored so the two reasons to divert — being outside
// production, or a deliberate production rehearsal — cannot drift apart or be
// checked in only one of the places that matter.
config.email.redirectActive = config.email.redirectInNonProd || config.email.redirectInProd;

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

// A deployed login page without the human check is exposed to password
// guessing from bots, and nobody would notice it was missing. Only local
// development may run without it.
if (!config.isDevelopment && !config.turnstile.enabled) {
  console.error(
    `💥 TURNSTILE_SECRET_KEY is empty, so the login page would have no Cloudflare check.\n` +
      `   Set it in .env.${NODE_ENV} (Cloudflare dashboard → Turnstile → your widget → Secret key).`
  );
  process.exit(1);
}

// ── FAIL CLOSED on the email guard ───────────────────────────────────────
// If the redirect is ON but no substitute inbox is configured, there is no safe
// address to send to — and treating an empty list as "no redirect needed" would
// do precisely what the guard exists to prevent, silently. Refusing to boot is
// recoverable; a real reporting manager emailed from staging is not.
// The same fail-closed rule for a production rehearsal: asking for the divert
// with nowhere to divert to would otherwise fall through to real recipients —
// the exact opposite of what was asked for, on the one environment where it is
// irreversible.
if (config.email.redirectInProd && config.email.testRecipients.length === 0) {
  console.error(
    '💥 EMAIL_REDIRECT_TO_TEST=true in production, but EMAIL_STAGING_RECIPIENTS is empty.\n' +
      '   There is no inbox to divert to, and sending to real recipients is not what was asked for.\n' +
      '   Set EMAIL_STAGING_RECIPIENTS in .env.production, or set EMAIL_REDIRECT_TO_TEST=false to send for real.'
  );
  process.exit(1);
}

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
