/**
 * Playwright config for the PEA end-to-end suite.
 *
 * The suite covers the eight screen changes from the 18-Sep review: the sidebar
 * (Dashboard, Upload sheet), the Settings screen (no environment banner, no
 * "needs restart", super-admin-only internals) and the notice strip that
 * replaced the banner stacks on New joiners and Link generation.
 *
 * ── It runs against a server you are already running ────────────────────────
 *
 * There is deliberately no `webServer` block. PEA needs BOTH a Vite dev server
 * and the Express backend, and the backend needs a database with real data —
 * the notice strip only appears when the Microsoft 365 check has something to
 * report. Starting half of that automatically would produce a suite that
 * passes against an empty screen, which is worse than one that tells you to
 * start the app first. globalSetup fails loudly if either is missing.
 */
import { defineConfig, devices } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Read .env.e2e into process.env.
 *
 * Hand-rolled rather than pulling in dotenv: the file is a few KEY=value lines
 * and the frontend has no other use for the dependency. A value already set in
 * the environment wins, so CI can inject secrets without touching the file.
 */
try {
  for (const line of readFileSync(path.join(here, '.env.e2e'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue; // blank line or # comment
    const key = m[1];
    // Strip surrounding quotes, but keep a value like @Shreyanmondal3 intact.
    const value = m[2].trim().replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[key] === undefined) process.env[key] = value;
  }
} catch {
  // Absent is fine: globalSetup reports which credentials are missing, and
  // specs for an unconfigured role skip themselves.
}

export default defineConfig({
  testDir: './e2e',
  // Each spec asserts on a shared, stateful app. Running files in parallel
  // against one database invites a test changing a setting another is reading.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    // On failure these are what tell you what the screen actually looked like.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  globalSetup: './e2e/global-setup.js',

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
