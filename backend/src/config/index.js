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
    // Hard guard: outside production every recipient is rewritten to the test
    // inbox and CC is cleared. This is what stops a half-tested build emailing
    // 130 real managers. Plan R8.
    redirectInNonProd: bool(process.env.EMAIL_REDIRECT_TO_TEST, true) && NODE_ENV !== 'production',
    testRecipients: list(process.env.EMAIL_STAGING_RECIPIENTS),
    uatAllowlist: list(process.env.EMAIL_UAT_ALLOWLIST),
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

export default config;
