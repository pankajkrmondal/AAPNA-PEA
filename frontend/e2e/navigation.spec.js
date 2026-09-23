/**
 * The sidebar — points 2 and 8 of the 18-Sep review.
 *
 *   8. "Overview" is called "Dashboard" everywhere it appears.
 *   2. "Upload sheet" is a sidebar entry directly after "Link generation",
 *      not a tab buried inside Settings.
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

  test('Upload sheet sits directly after Link generation', async ({ page }) => {
    const labels = await sidebarLabels(page);
    const link = labels.indexOf('Link generation');
    const upload = labels.indexOf('Upload sheet');

    expect(link, 'Link generation missing from the sidebar').toBeGreaterThan(-1);
    expect(upload, 'Upload sheet missing from the sidebar').toBeGreaterThan(-1);
    // "directly after" is the requirement, not merely "present somewhere".
    expect(upload).toBe(link + 1);
  });

  test('Upload sheet opens the real page, not a Settings tab', async ({ page }) => {
    await page.locator('.pea-nav').getByText('Upload sheet', { exact: true }).click();

    await expect(page).toHaveURL(/\/import$/);
    // The standalone page renders its own heading; the embedded variant does
    // not. Asserting on it proves we are not looking at the Settings tab.
    await expect(page.getByRole('heading', { name: 'Upload sheet', level: 2 })).toBeVisible();
    await expect(page.getByText('Drop the master Excel workbook here', { exact: false })).toBeVisible();
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
