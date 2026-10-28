/**
 * The sidebar — points 2 and 8 of the 18-Sep review.
 *
 *   8. "Overview" is called "Dashboard" everywhere it appears.
 *   2. "Upload sheet" is a sidebar entry directly after "Link generation",
 *      not a tab buried inside Settings.
 *
 * Walkthrough (27-10-2026) W-12 reverses point 2: the HR lead asked for Upload
 * sheet and Email templates inside Settings. The two tests below now prove
 * that, and that the old addresses still arrive at the right tab.
 *
 * Headers (28-10-2026) — "Upload sheet" is "Upload Excel" and "Link
 * generation" is "Evaluation links"; every screen's heading is HR's words.
 */
import { test, expect } from '@playwright/test';
import { signIn, sidebarLabels } from './helpers.js';

test.describe('sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'superadmin');
  });

  test('the first entry is Dashboard, not Overview', async ({ page }) => {
    const labels = await sidebarLabels(page);

    expect(labels[0]).toBe('Dashboard');
    // The rename has to be complete: a stray "Overview" anywhere in the nav
    // means one of the two MODULES lists was missed.
    expect(labels).not.toContain('Overview');
  });

  // W-12 — before, these two read "Upload sheet sits directly after Link
  // generation" and "Upload sheet opens the real page, not a Settings tab".
  // Headers (28-10-2026) — the tab is "Upload Excel" now.
  test('Upload Excel and Email templates are not in the sidebar; Settings is', async ({ page }) => {
    const labels = await sidebarLabels(page);

    expect(labels).not.toContain('Upload Excel');
    expect(labels).not.toContain('Email templates');
    expect(labels.at(-1)).toBe('Settings');
  });

  // Headers (28-10-2026) — "Link generation" is "Evaluation links".
  test('the link screen is called Evaluation links', async ({ page }) => {
    const labels = await sidebarLabels(page);

    expect(labels).toContain('Evaluation links');
    expect(labels).not.toContain('Link generation');
  });

  test('the old addresses open the matching Settings tab', async ({ page }) => {
    await page.goto('/import');
    await expect(page).toHaveURL(/\/settings\?tab=upload-sheet$/);
    // Headers (28-10-2026) — were 'Upload sheet' and 'Drop the master Excel workbook here'.
    await expect(page.getByRole('tab', { name: 'Upload Excel', selected: true })).toBeVisible();
    await expect(page.getByText('Drop your filled-in Excel template here', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: /Download template/ })).toBeVisible();

    await page.goto('/email-templates');
    await expect(page).toHaveURL(/\/settings\?tab=email-templates$/);
    await expect(page.getByRole('tab', { name: 'Email templates', selected: true })).toBeVisible();
  });

  test('the dashboard says Dashboard, and never Overview', async ({ page }) => {
    await expect(page.locator('.pea-header-title')).toHaveText('Dashboard');
    // Headers (28-10-2026) — the heading says what the screen is, and the
    // greeting moved to the line above it. It expected a level-2 heading
    // matching /^Good (morning|afternoon|evening), /. What must never come
    // back is the old name.
    await expect(page.getByRole('heading', { name: 'Probation at a glance', level: 2 })).toBeVisible();
    await expect(page.getByText(/^Good (morning|afternoon|evening), /)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Overview' })).toHaveCount(0);
  });
});

// Headers (28-10-2026) — every screen says what it is for, in HR's words.
test.describe('screen headings', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'superadmin');
  });

  for (const [path, heading] of [
    ['/evaluations', 'All evaluations'],
    ['/evaluations/emails', 'Sent emails'],
    ['/employees', 'Commandos'],
    ['/new-joiners', 'New joiners'],
    ['/manager-portal', 'Evaluation links'],
    ['/settings', 'Settings'],
  ]) {
    test(`${path} has the heading "${heading}" and a description`, async ({ page }) => {
      await page.goto(path);
      const h = page.getByRole('heading', { name: heading, level: 2 });
      await expect(h).toBeVisible();
      await expect(h.locator('xpath=following-sibling::p[1]')).not.toBeEmpty();
    });
  }

  test('the build team\'s headings are gone', async ({ page }) => {
    await page.goto('/evaluations');
    await expect(page.getByRole('heading', { name: 'What every manager said' })).toHaveCount(0);
    await page.goto('/settings?tab=upload-sheet');
    await expect(page.getByText('Reconciliation report')).toHaveCount(0);
  });
});
