/**
 * intakeScanner.js — the nightly Entra intake scan. Plan §13.8.
 *
 * Separate from evaluationScheduler.js on purpose. That job puts mail in front
 * of real managers; this one reads a directory and fills a queue. Sharing a cron
 * would mean a Graph outage in the directory read could interfere with the send
 * that people actually depend on, and a single switch would turn both on.
 *
 * ── Two independent switches, both off by default ───────────────────────────
 *
 *   PEA_SCHEDULER_ENABLED   the process-level brake, shared with the sweep
 *   pea_settings.azure_scan_enabled   this job specifically
 *
 * The second exists because of plan §10: the New Joiner Inbox should land AFTER
 * the shadow-mode cutover. A second source of employees appearing mid-cutover
 * would make any discrepancy between PEA and Power Automate harder to attribute
 * — which is the one thing the shadow period is for. The "Scan now" button
 * works regardless, so the feature can be exercised without scheduling it.
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { runIntakeScan } from '../services/joinerIntake.service.js';
import { runSyncAlerts } from '../services/syncAlert.service.js';

let task = null;

/**
 * Start the nightly scan, if both switches allow it.
 *
 * Safe to call again at any time: the previous task is stopped first, so
 * switching the scan on or off, or changing its time, in Settings takes effect
 * immediately rather than on the next restart. Reading both settings here means
 * one call covers azure_scan_enabled and azure_scan_cron alike.
 *
 * @returns {Promise<void>}
 */
export async function startIntakeScanner() {
  // Re-entrant: two live crons would run the scan twice a night.
  stopIntakeScanner({ quiet: true });

  if (!config.scheduler.enabled) {
    logger.warn('🔎 Entra intake scan not started (PEA_SCHEDULER_ENABLED=false)');
    return;
  }

  let enabled = false;
  let expression = '0 9 * * *';

  try {
    const rows = await prisma.pea_settings.findMany({
      where: { setting_key: { in: ['azure_scan_enabled', 'azure_scan_cron'] } },
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    enabled = byKey.azure_scan_enabled === 'true';
    expression = byKey.azure_scan_cron || expression;
  } catch (err) {
    // The settings rows arrive with 2026-09-12b-pea-joiner-intake.sql. Before
    // that DDL is applied this is the expected state, not a fault — so it says
    // so rather than looking like a failure.
    logger.warn(
      `🔎 Entra intake scan not started — could not read its settings (${err.message}). ` +
        'Has 2026-09-12b-pea-joiner-intake.sql been applied?'
    );
    return;
  }

  if (!enabled) {
    logger.info('🔎 Entra intake scan DISABLED (pea_settings.azure_scan_enabled = false)');
    return;
  }

  if (!cron.validate(expression)) {
    logger.error(`🔎 Invalid azure_scan_cron "${expression}" — intake scan not started`);
    return;
  }

  task = cron.schedule(
    expression,
    async () => {
      let report = null;
      try {
        report = await runIntakeScan({ actor: 'scheduled-scan' });
        logger.info(
          `🔎 Intake scan complete — ${report.candidatesNew} new joiner(s) in the inbox, ` +
            `${report.leaversFlagged} leaver flag(s) raised`
        );
      } catch (err) {
        // Loud, but never fatal: a failed directory read must not affect the
        // evaluation sweep, which is the job that actually matters.
        logger.error(`🔎 INTAKE SCAN FAILED: ${err.message}`, { stack: err.stack });
      }

      // R-03 — runs whether or not the scan above succeeded, because a failed
      // scan is the single most important thing to tell HR about. A log line is
      // not a notification: nobody reads the log, which is how a silent failure
      // becomes a missed evaluation (Subhajit, 15-Sep, 16:14).
      try {
        await runSyncAlerts({ scan: report });
      } catch (err) {
        logger.error(`🔎 Sync alert pass failed: ${err.message}`, { stack: err.stack });
      }
    },
    { timezone: config.scheduler.timezone }
  );

  logger.info(`🔎 Entra intake scan started — "${expression}" (${config.scheduler.timezone})`);
}

/**
 * Stop the cron — on shutdown, or before rescheduling.
 * @param {{quiet?: boolean}} [opts]
 */
export function stopIntakeScanner({ quiet = false } = {}) {
  if (task) {
    task.stop();
    task = null;
    if (!quiet) logger.info('🔎 Entra intake scan stopped');
  }
}
