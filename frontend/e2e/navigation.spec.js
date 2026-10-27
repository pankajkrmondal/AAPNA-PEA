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
  test('Upload sheet and Email templates are not in the sidebar; Settings is', async ({ page }) => {
    const labels = await sidebarLabels(page);

    expect(labels).not.toContain('Upload sheet');
    expect(labels).not.toContain('Email templates');
    expect(labels.at(-1)).toBe('Settings');
  });

  test('the old addresses open the matching Settings tab', async ({ page }) => {
    await page.goto('/import');
    await expect(page).toHaveURL(/\/settings\?tab=upload-sheet$/);
    await expect(page.getByRole('tab', { name: 'Upload sheet', selected: true })).toBeVisible();
    await expect(page.getByText('Drop the master Excel workbook here', { exact: false })).toBeVisible();

    await page.goto('/email-templates');
    await expect(page).toHaveURL(/\/settings\?tab=email-templates$/);
    await expect(page.getByRole('tab', { name: 'Email templates', selected: true })).toBeVisible();
  });

  test('the dashboard says Dashboard, and never Overview', async ({ page }) => {
    await expect(page.locator('.pea-header-title')).toHaveText('Dashboard');
    // Since the 23-Sep redesign the page opens with a greeting ("Good morning,
    // Meenal") rather than repeating the word in a heading; what must never
    // come back is the old name.
    await expect(page.getByRole('heading', { name: /^Good (morning|afternoon|evening), /, level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Overview' })).toHaveCount(0);
  });
});
