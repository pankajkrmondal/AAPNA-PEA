/**
 * Shared helpers: signing in, and the roles the suite knows about.
 *
 * ── Why sign in through the API rather than the login form ──────────────────
 *
 * The app keeps its session as a bearer token in localStorage (api.js), so a
 * test can obtain one from POST /auth/login and put it there directly. Driving
 * the login form instead would add a Turnstile widget and a page transition to
 * the front of every test, and would test the login screen over and over
 * rather than the screens under test. There is one spec that does use the real
 * form, so the seeded-token path can never diverge from it unnoticed.
 */
import { expect } from '@playwright/test';

const TOKEN_KEY = 'pea_token';
const USER_KEY = 'pea_user';

/**
 * The three roles, and where their credentials come from.
 *
 * `pass` being empty is the normal case for a role nobody has configured, and
 * means "skip", not "fail" — see `describeRole`.
 */
export const ROLES = {
  superadmin: {
    label: 'Super Admin',
    user: process.env.E2E_SUPERADMIN_USER,
    pass: process.env.E2E_SUPERADMIN_PASS,
    /** Sees the pea_settings column names and the "Not in effect" tab. */
    seesInternals: true,
  },
  admin: {
    label: 'Admin',
    user: process.env.E2E_ADMIN_USER,
    pass: process.env.E2E_ADMIN_PASS,
    seesInternals: false,
  },
  hr: {
    label: 'HR',
    user: process.env.E2E_HR_USER,
    pass: process.env.E2E_HR_PASS,
    seesInternals: false,
  },
};

/** @returns {boolean} whether this role has a password configured */
export const isConfigured = (role) => Boolean(ROLES[role]?.user && ROLES[role]?.pass);

/**
 * One login per role per run, cached here.
 *
 * /auth/login is rate limited to 10 attempts per 15 minutes — a real
 * brute-force guard that the suite must not need weakened to run. Calling
 * signIn() in a beforeEach across a dozen tests blows through that in seconds
 * and every later test fails with a confusing 429. The token is what the app
 * stores anyway, so obtaining it once and reusing it is both faster and closer
 * to how a signed-in person actually uses the app.
 *
 * Keyed by role. Cleared only when the process ends.
 */
const sessions = new Map();

/**
 * Obtain (or reuse) a token for `role`.
 * @returns {Promise<{token: string, user: object}>}
 */
async function sessionFor(page, role) {
  if (sessions.has(role)) return sessions.get(role);

  const who = ROLES[role];
  if (!isConfigured(role)) {
    throw new Error(`No credentials for "${role}" — set E2E_${role.toUpperCase()}_PASS in .env.e2e`);
  }

  // turnstileToken must be non-empty: login refuses a missing one with 400
  // "Please complete the security check" before it looks at the password.
  // Locally TURNSTILE_SECRET_KEY is Cloudflare's always-passes test secret
  // (1x0000…), so any value is accepted. Against an environment with a real
  // secret this login fails, which is correct — the suite is for local and CI.
  const res = await page.request.post('/api/auth/login', {
    data: { username: who.user, password: who.pass, turnstileToken: 'e2e' },
  });

  if (!res.ok()) {
    const hint = res.status() === 429
      ? 'the login rate limit (10 per 15 min) was hit — a spec is signing in too often'
      : 'check the credentials in .env.e2e and that the account is active';
    throw new Error(`Login failed for ${who.user} (HTTP ${res.status()}) — ${hint}.`);
  }

  const body = await res.json();
  const payload = body.data ?? body;
  const token = payload.token ?? payload.accessToken;
  const user = payload.user ?? payload;

  if (!token) throw new Error(`Login for ${who.user} returned no token: ${JSON.stringify(body).slice(0, 300)}`);

  const session = { token, user };
  sessions.set(role, session);
  return session;
}

/**
 * An authorized request context for `role`, for asserting on the API directly
 * without going through a page.
 */
export async function authHeaders(page, role) {
  const { token } = await sessionFor(page, role);
  return { Authorization: `Bearer ${token}` };
}

/**
 * Sign in as `role` and leave the page on `path`, authenticated.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'superadmin'|'admin'|'hr'} role
 * @param {string} [path] - where to land, default the dashboard
 */
export async function signIn(page, role, path = '/') {
  const { token, user } = await sessionFor(page, role);

  // The token has to be in localStorage before the app's first render, or the
  // React app bounces to /login before the test can act.
  await page.addInitScript(
    ([k, t, uk, u]) => {
      window.localStorage.setItem(k, t);
      window.localStorage.setItem(uk, JSON.stringify(u));
    },
    [TOKEN_KEY, token, USER_KEY, user]
  );

  await page.goto(path);
  // Every authenticated screen has the sidebar; waiting on it means later
  // assertions are not racing the first paint.
  await expect(page.locator('.pea-nav')).toBeVisible();

  return { token, user };
}

/** The sidebar entries, in order, as the user sees them. */
export async function sidebarLabels(page) {
  return page.locator('.pea-nav .ant-menu-title-content').allInnerTexts();
}

/**
 * The setting row for a given label, e.g. "Daily sweep time (cron)".
 * @returns {import('@playwright/test').Locator}
 */
export const settingRow = (page, label) =>
  page.locator('.pea-setting-row').filter({ hasText: label });

/** Open one of the tabs on the Settings screen. */
export async function openSettingsTab(page, name) {
  await page.getByRole('tab', { name, exact: true }).click();
}
