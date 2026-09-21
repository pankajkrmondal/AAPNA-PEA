/**
 * Checked once, before any spec runs.
 *
 * The suite drives a real app against a real database, so the two ways it can
 * be meaninglessly "run" are with the servers down and with no credentials. A
 * spec that fails on `expect(sidebar).toBeVisible()` because Vite is not
 * running sends you looking for a bug in the sidebar. These messages say what
 * is actually wrong and how to fix it.
 */
import { request } from '@playwright/test';
import { ROLES, isConfigured } from './helpers.js';

export default async function globalSetup(config) {
  const baseURL = config.projects[0].use.baseURL;
  const ctx = await request.newContext({ baseURL });

  // 1. Is the frontend up?
  try {
    const res = await ctx.get('/', { timeout: 10_000 });
    if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
  } catch (err) {
    throw new Error(
      `\n\nCannot reach the PEA frontend at ${baseURL} (${err.message}).\n` +
        'Start it first:  cd PEA-Local/frontend && npm run dev\n'
    );
  }

  // 2. Is the backend up behind the Vite proxy? An unauthenticated call to a
  //    protected route should be refused — a 401 proves the API is answering.
  //    A 500 or a timeout usually means the backend is down or the database is.
  try {
    const res = await ctx.get('/api/settings', { timeout: 10_000 });
    if (res.status() >= 500) {
      throw new Error(`the API answered ${res.status()} — is the database reachable?`);
    }
  } catch (err) {
    throw new Error(
      `\n\nCannot reach the PEA backend through ${baseURL}/api (${err.message}).\n` +
        'Start it first:  cd PEA-Local/backend && npm run dev\n'
    );
  }

  // 3. At least the super admin must be configured, or nothing can run.
  if (!isConfigured('superadmin')) {
    throw new Error(
      '\n\nNo super admin credentials.\n' +
        'Copy .env.e2e.example to .env.e2e and fill in E2E_SUPERADMIN_USER / _PASS.\n'
    );
  }

  // 4. Say which roles will be skipped, so a partial run is never mistaken for
  //    a full one. The role tests are the ones that catch a regression in the
  //    super-admin-only gating, so it matters that their absence is visible.
  const missing = Object.keys(ROLES).filter((r) => !isConfigured(r));
  if (missing.length) {
    console.warn(
      `\n⚠ Skipping role tests for: ${missing.join(', ')} — no password in .env.e2e.\n` +
        '  The negative half of the Settings role gating will NOT be verified.\n'
    );
  }

  await ctx.dispose();
}
