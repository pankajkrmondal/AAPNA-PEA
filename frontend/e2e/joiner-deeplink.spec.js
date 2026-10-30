/**
 * Review email links — 30-10-2026.
 *
 * Confirm / Not confirm in the new joiner review email open New joiners on that
 * joiner, behind sign-in, instead of a public page that acted without one.
 * Plan: docs/PEA-Joiner-Email-Actions-Behind-Login-Plan-2026-10-30.md.
 *
 * ── Nothing here writes ─────────────────────────────────────────────────────
 *
 * Every dialog and prompt the links open is cancelled, and the last test checks
 * the joiner is still waiting. The joiner used is the first one in the inbox;
 * with nobody waiting, the tests that need one skip rather than pass empty.
 */
import { test, expect } from '@playwright/test';
import { ROLES, signIn, authHeaders, isConfigured } from './helpers.js';

const link = (id, action) => `/new-joiners?joiner=${id}&action=${action}&via=email`;

/** The first joiner waiting in the inbox, or undefined. */
async function firstWaiting(page) {
  const res = await page.request.get('/api/intake/inbox', { headers: await authHeaders(page, 'superadmin') });
  expect(res.ok(), `GET /api/intake/inbox returned ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return (body.data ?? body).joiners?.[0];
}

test.describe('Signed out', () => {
  test('a link goes to sign-in, which remembers where it was going', async ({ page }) => {
    await page.goto(link(1, 'confirm'));
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(new URL(page.url()).searchParams.get('next')).toBe(link(1, 'confirm'));
    await expect(page.getByText('Sign in to continue to the page you opened')).toBeVisible();
  });

  test('a "next" that leaves PEA is ignored', async ({ page }) => {
    for (const next of ['//evil.example/x', '/\\evil.example', 'https://evil.example']) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await expect(page.getByText('Sign in to manage probation evaluations')).toBeVisible();
    }
  });
});

test.describe('Signed in', () => {
  test.skip(!isConfigured('superadmin'), 'No E2E_SUPERADMIN_PASS in .env.e2e');

  test('signing in on the real form goes on to the joiner the link opened', async ({ page }) => {
    const joiner = await firstWaiting(page);
    test.skip(!joiner, 'Nobody is waiting in the New joiners inbox');

    await page.goto(link(joiner.id, 'confirm'));
    await expect(page).toHaveURL(/\/login\?next=/);

    // The fields stay read-only until focused (Login.jsx), so click, then fill.
    const user = page.getByLabel('Username or email');
    await user.click();
    await user.fill(ROLES.superadmin.user);
    const pass = page.getByLabel('Password');
    await pass.click();
    await pass.fill(ROLES.superadmin.pass);
    // Locally the Turnstile site key is Cloudflare's always-passes test key.
    const submit = page.getByRole('button', { name: 'Sign in' });
    await expect(submit).toBeEnabled({ timeout: 20_000 });
    await submit.click();

    const dialog = page.getByRole('dialog', { name: `Confirm ${joiner.display_name}` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('Confirm opens the Confirm dialog for that joiner; Cancel changes nothing', async ({ page }) => {
    const joiner = await firstWaiting(page);
    test.skip(!joiner, 'Nobody is waiting in the New joiners inbox');

    await signIn(page, 'superadmin', link(joiner.id, 'confirm'));
    const dialog = page.getByRole('dialog', { name: `Confirm ${joiner.display_name}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Office email')).toHaveValue(joiner.office_email);
    // Read once: a refresh or Back must not open it again.
    await expect(page).toHaveURL(/\/new-joiners$/);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(`.pea-joiner-table tr[data-row-key="${joiner.id}"]`)).toHaveClass(/pea-row-focus/);
  });

  test('Not confirm opens "Remove from the inbox?" on that joiner\'s row; Cancel changes nothing', async ({ page }) => {
    const joiner = await firstWaiting(page);
    test.skip(!joiner, 'Nobody is waiting in the New joiners inbox');

    await signIn(page, 'superadmin', link(joiner.id, 'dismiss'));
    const row = page.locator(`.pea-joiner-table tr[data-row-key="${joiner.id}"]`);
    await expect(row).toHaveClass(/pea-row-focus/);
    const prompt = page.locator('.ant-popconfirm').filter({ hasText: 'Remove from the inbox?' });
    await expect(prompt).toBeVisible();

    await prompt.getByRole('button', { name: 'Cancel' }).click();
    await expect(prompt).toBeHidden();

    const still = await firstWaiting(page);
    expect(still, 'the inbox is empty after Cancel').toBeTruthy();
    const res = await page.request.get(`/api/intake/joiners/${joiner.id}`, { headers: await authHeaders(page, 'superadmin') });
    expect((await res.json()).data.status).toBe('pending');
  });

  test('a link to a joiner who is not there says so', async ({ page }) => {
    await signIn(page, 'superadmin', link(999999999, 'confirm'));
    await expect(page.locator('.ant-message')).toContainText('no longer in the inbox');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});
