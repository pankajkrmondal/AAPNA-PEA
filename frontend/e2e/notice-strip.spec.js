/**
 * The notice strip — points 6 and 7 of the 18-Sep review.
 *
 * New joiners carried three stacked Alert banners and Link generation two, each
 * several lines tall, between the page heading and the first table. The content
 * was worth keeping; the space it took was not. They now collapse to one line
 * that expands on demand.
 *
 * ── What these tests actually guard ─────────────────────────────────────────
 *
 * The easy assertion is "the strip exists". The one that matters is that it
 * stays SHORT — the whole point was vertical space — and that collapsing it
 * did not lose any of the wording. So the strip's height is asserted, and so is
 * the presence of the detail text once expanded.
 */
import { test, expect } from '@playwright/test';
import { signIn } from './helpers.js';

/** A strip that has not been expanded must not grow into the banner it replaced. */
const COLLAPSED_MAX_PX = 56;

test.describe('New joiners', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'superadmin', '/new-joiners');
  });

  test('the old stacked banners are gone', async ({ page }) => {
    // The permanent explainer moved into the ⓘ on "Detected in Entra", and the
    // leaver card's banner duplicated its own hint. Neither should render as a
    // full-width antd Alert any more.
    await expect(page.getByText('Two things always need a person')).toHaveCount(0);
    await expect(
      page.getByText('Flagged only when the account is BOTH disabled and unlicensed', { exact: false })
    ).toHaveCount(0);
  });

  test('notices collapse to a single line', async ({ page }) => {
    const strip = page.locator('.pea-notice');

    // The seeded database has sync problems to report. If that ever stops being
    // true this test is meaningless, so it says so rather than passing empty.
    await expect(strip, 'no notice strip — has the seed data changed?').toBeVisible();

    const box = await strip.boundingBox();
    expect(
      box.height,
      `collapsed strip is ${Math.round(box.height)}px — it should stay near one line`
    ).toBeLessThan(COLLAPSED_MAX_PX);
  });

  test('expanding reveals the full wording, and collapsing hides it again', async ({ page }) => {
    const strip = page.locator('.pea-notice');
    const toggle = strip.locator('.pea-notice-toggle');
    await expect(toggle).toBeVisible();

    await toggle.click();

    // The detail body is the text that used to be in the banners.
    const body = strip.locator('.pea-notice-body');
    await expect(body).toBeVisible();
    await expect(toggle).toContainText('Hide');

    // The remedy link HR needs is still reachable from inside the strip.
    await expect(body.getByRole('link', { name: /upload the sheet/i })).toBeVisible();

    await toggle.click();
    await expect(body).toBeHidden();
    await expect(toggle).toContainText('Details');
  });

  test('the two tables sit close together', async ({ page }) => {
    // Point 6's actual complaint: "gap of table are not too much distance".
    const entra = page.locator('.pea-card').filter({ hasText: 'Detected in Entra' });
    const leavers = page.locator('.pea-card').filter({ hasText: 'Possible leavers' });

    await expect(entra).toBeVisible();
    await expect(leavers).toBeVisible();

    const a = await entra.boundingBox();
    const b = await leavers.boundingBox();
    const gap = b.y - (a.y + a.height);

    // One standard page gap (18px in app.css) plus a little slack.
    expect(gap, `${Math.round(gap)}px between the two cards`).toBeLessThan(40);
  });
});

test.describe('Link generation', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'superadmin', '/manager-portal');
  });

  test('the revoke warning is a hint on the heading, not a banner', async ({ page }) => {
    const card = page.locator('.pea-card').filter({ hasText: 'Issue a link' });

    // It must still be discoverable…
    await expect(card.locator('.pea-section-title .pea-hint')).toBeVisible();
    // …but not occupying a block of the card.
    await expect(
      page.getByText("Creating a new link revokes that manager's previous one", { exact: false })
    ).toHaveCount(0);
  });

  test('Issued links is visible without scrolling', async ({ page }) => {
    // The banner used to push this below the fold, which was the complaint.
    const issued = page.locator('.pea-card').filter({ hasText: 'Issued links' });
    await expect(issued).toBeVisible();

    const box = await issued.boundingBox();
    const viewport = page.viewportSize();
    expect(
      box.y,
      `"Issued links" starts at ${Math.round(box.y)}px, below the ${viewport.height}px fold`
    ).toBeLessThan(viewport.height);
  });

  test("the employee tab's disclosure notice is one line", async ({ page }) => {
    await page.getByRole('tab', { name: "Employee's own view" }).click();

    const strip = page.locator('.pea-notice');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Employees currently see');

    // Nothing to expand when the setting is healthy, so no toggle is offered.
    const box = await strip.boundingBox();
    expect(box.height).toBeLessThan(COLLAPSED_MAX_PX);
  });
});
