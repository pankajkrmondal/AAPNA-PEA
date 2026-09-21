/**
 * The Settings screen — points 1, 3, 4 and 5 of the 18-Sep review.
 *
 *   5. The "Environment: development — every email goes only to …" banner is
 *      gone, in every environment.
 *   4. No setting says "needs restart". Changing the sweep cron reschedules the
 *      running job, because HR cannot restart a server.
 *   2. "Upload sheet" is no longer a tab here (it has a sidebar entry).
 *   1/3. The pea_settings column names and the "Not in effect" tab are shown to
 *      a super admin and to nobody else.
 */
import { test, expect } from '@playwright/test';
import { signIn, isConfigured, settingRow, openSettingsTab, authHeaders, ROLES } from './helpers.js';

/** The current value of one setting, read straight from the API. */
async function storedValue(page, role, key) {
  const res = await page.request.get('/api/settings', { headers: await authHeaders(page, role) });
  const { data } = await res.json();
  return data.groups.flatMap((g) => g.settings).find((s) => s.key === key)?.value;
}

test.describe('Settings — everyone', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'superadmin', '/settings');
  });

  test('no environment banner', async ({ page }) => {
    // Point 5. It was an antd Alert naming the environment and the test inbox.
    await expect(page.getByText(/Environment:\s*(development|staging|production)/i)).toHaveCount(0);
    await expect(page.getByText('every email goes only to', { exact: false })).toHaveCount(0);
  });

  test('no setting claims to need a restart', async ({ page }) => {
    // Point 4, as HR sees it. The two that carried this badge were the sweep
    // cron and the Entra scan, so both tabs are checked rather than just one.
    for (const tab of ['Evaluations', 'New joiners']) {
      await openSettingsTab(page, tab);
      await expect(page.getByText('needs restart', { exact: false })).toHaveCount(0);
    }
  });

  test('Upload sheet is not a tab here any more', async ({ page }) => {
    // Point 2, the other half of the move proved in navigation.spec.js.
    await expect(page.getByRole('tab', { name: 'Upload sheet' })).toHaveCount(0);
  });
});

test.describe('Settings — what only a super admin sees', () => {
  test('a super admin sees the database keys and the Not in effect tab', async ({ page }) => {
    await signIn(page, 'superadmin', '/settings');

    // Point 3: the grey monospace pea_settings key under each label.
    await expect(page.locator('.pea-setting-key').first()).toBeVisible();
    await expect(settingRow(page, 'Pause all email').locator('.pea-setting-key')).toHaveText('shadow_mode');

    // Point 1: the tab listing rows nothing reads.
    await expect(page.getByRole('tab', { name: 'Not in effect' })).toBeVisible();

    await openSettingsTab(page, 'Not in effect');
    await expect(page.getByText('These rows exist in the database but nothing reads them')).toBeVisible();
    await expect(page.getByRole('cell', { name: 'sweep_timezone' })).toBeVisible();
  });

  // The negative half — the assertion that actually protects points 1 and 3.
  // Without a password for these roles the suite cannot prove the restriction,
  // so the test skips loudly rather than passing on a technicality.
  for (const role of ['admin', 'hr']) {
    test(`${ROLES[role].label} sees neither the keys nor the Not in effect tab`, async ({ page }) => {
      test.skip(
        !isConfigured(role),
        `No E2E_${role.toUpperCase()}_PASS in .env.e2e — cannot verify the ${role} restriction`
      );

      await signIn(page, role, '/settings');

      // The settings themselves are still there: this is about hiding internal
      // plumbing, not about taking a screen away.
      await expect(settingRow(page, 'Pause all email')).toBeVisible();

      // …but not one database column name.
      await expect(page.locator('.pea-setting-key')).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'Not in effect' })).toHaveCount(0);
    });
  }

  for (const role of ['admin', 'hr']) {
    test(`the API never sends the keys to ${role}`, async ({ page }) => {
      // Belt and braces for point 3. Hiding the caption in the browser would
      // leave the names readable in the network response; the gate is server
      // side, so assert on the payload itself.
      test.skip(!isConfigured(role), `No E2E_${role.toUpperCase()}_PASS in .env.e2e`);

      const res = await page.request.get('/api/settings', { headers: await authHeaders(page, role) });
      const { data } = await res.json();

      expect(data.notInEffect, 'notInEffect must be withheld').toBeNull();
      const rows = data.groups.flatMap((g) => g.settings);
      expect(rows.length, 'settings themselves must still be sent').toBeGreaterThan(0);
      expect(rows.every((s) => s.showKey === false), 'no row may be flagged to show its key').toBe(true);
    });
  }
});

test.describe('Settings — a schedule change applies without a restart', () => {
  // Point 4, the substance rather than the badge. This writes to the database,
  // so it restores the previous value even if an assertion fails.
  const KEY = 'sweep_cron';
  let original;

  test.beforeEach(async ({ page }) => {
    await signIn(page, 'superadmin', '/settings');
    original = await storedValue(page, 'superadmin', KEY);
  });

  test.afterEach(async ({ page }) => {
    // Always put it back: a test that leaves the sweep running at a changed
    // time would quietly alter when real evaluation emails go out.
    await page.request.put(`/api/settings/${KEY}`, {
      headers: await authHeaders(page, 'superadmin'),
      data: { value: original },
    });
  });

  test('saving a new sweep time succeeds and says nothing about restarting', async ({ page }) => {
    const next = original === '0 11 * * *' ? '0 12 * * *' : '0 11 * * *';

    // The cron lives on the Evaluations tab; the screen opens on Email.
    await openSettingsTab(page, 'Evaluations');

    const row = settingRow(page, 'Daily sweep time (cron)');
    await expect(row).toBeVisible();
    const input = row.locator('input');

    // fill() alone does not drive a React controlled input's onChange, so the
    // Save button would stay disabled. Typing does.
    await input.click();
    await input.press('ControlOrMeta+a');
    await input.pressSequentially(next);

    const save = row.getByRole('button', { name: 'Save' });
    await expect(save).toBeEnabled();

    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/settings/${KEY}`) && r.request().method() === 'PUT'),
      save.click(),
    ]);

    expect(res.status()).toBe(200);
    const body = await res.json();

    // The old message was "Saved — takes effect after the backend restarts".
    expect(body.message).toBe('Saved');
    expect(body.message).not.toMatch(/restart/i);
    // `applied: true` is the backend saying it rescheduled the live cron.
    expect(body.data.applied).toBe(true);

    await expect(input).toHaveValue(next);
  });

  test('an invalid cron is refused and the stored value is left alone', async ({ page }) => {
    // The flip side of making this editable by non-developers: a typo must not
    // silently stop every evaluation email going out.
    const res = await page.request.put(`/api/settings/${KEY}`, {
      headers: await authHeaders(page, 'superadmin'),
      data: { value: 'every day at 11' },
    });

    expect(res.status()).toBe(400);
    expect(await storedValue(page, 'superadmin', KEY)).toBe(original);
  });
});
