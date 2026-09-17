/**
 * syncAlert.service.js — R-03. Tell HR when the Microsoft 365 check cannot do
 * its job, instead of failing quietly.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Subhajit, 15-Sep demo (15:39), on being asked to trust the automation:
 *
 *   "If I am taking care of the performance evaluation, I will be very much
 *    dependent and I will be believing that everything is getting synced… if
 *    for 6 months it gets run, it becomes my habit. So that manual thing goes
 *    away from me actually."
 *
 * and then (16:14): "If any data is not being synced properly from the AD, we
 * should be getting an email alert so that we can take it up manually."
 *
 * That is the whole design brief. The danger of a good automation is that
 * people stop checking it, so a silent failure becomes an invisible missed
 * evaluation. Every problem raised here is therefore something a person has to
 * act on, and every one names the person it is about.
 *
 * ── Paired with the sheet upload ───────────────────────────────────────────
 *
 * An alert is only half an answer: it says something is wrong but not how to
 * fix it. The remedy is the Excel upload (R-07), which Pankaj built for exactly
 * this case and Subhajit approved — "This is a good idea. I agree" (15:05). So
 * every fixable problem points there.
 *
 * ── Not every silence is a failure ─────────────────────────────────────────
 *
 * A scan that legitimately finds nothing is not a problem, and saying so would
 * train HR to ignore the alert — the precise failure this is meant to prevent.
 * Only these are raised:
 *
 *   · the scan errored, or could not reach Microsoft 365 at all
 *   · the scan has not run for longer than it should have
 *   · a record arrived that cannot produce an evaluation (no manager, no
 *     joining date, no email)
 *
 * ── Said once, not nightly ─────────────────────────────────────────────────
 *
 * Each problem carries a dedupe key, so a record that stays broken for a
 * fortnight produces one alert, not fourteen. The key includes what is wrong,
 * so a record that develops a second, different fault is announced again.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { queueEmail } from './notification.service.js';
import { notifyStaff } from './inAppNotification.service.js';
import { todayIn, toDateString, formatDisplay } from '../utils/dateUtils.js';

/** How long without a successful scan before that is itself the problem. */
const STALE_SCAN_HOURS = 36;

/** @param {string} key @param {boolean} fallback */
async function boolSetting(key, fallback) {
  const row = await prisma.pea_settings.findUnique({ where: { setting_key: key } });
  if (row?.setting_value === undefined || row?.setting_value === null) return fallback;
  return String(row.setting_value).trim().toLowerCase() === 'true';
}

/**
 * Problems in the records themselves — joiners waiting in the inbox that could
 * never become an evaluation, however long HR leaves them there.
 *
 * Only `pending` candidates are examined. A rejected one is HR's decision and a
 * converted one is already an employee; neither is a fault.
 *
 * @returns {Promise<object[]>}
 */
async function findUnusableCandidates() {
  let rows = [];
  try {
    rows = await prisma.$queryRaw`
      SELECT id::text AS id,
             display_name,
             office_email,
             suggested_rm_email,
             suggested_doj,
             account_created_at
        FROM pea_joiner_candidates
       WHERE status = 'pending'
       ORDER BY account_created_at DESC NULLS LAST
       LIMIT 200`;
  } catch (err) {
    // The table arrives with 2026-09-12b-pea-joiner-intake.sql. Before that it
    // is absent, which is a known state, not a fault to alert HR about.
    logger.warn(`[sync-alert] could not read the joiner inbox: ${err.message}`);
    return [];
  }

  const problems = [];

  for (const r of rows) {
    const who = r.display_name || r.office_email || `candidate ${r.id}`;

    if (!r.suggested_rm_email || !String(r.suggested_rm_email).trim()) {
      problems.push({
        key: `candidate:${r.id}:no-manager`,
        title: 'No reporting manager',
        subject: who,
        detail:
          'Microsoft 365 has no manager for this account, so there is nobody to send the ' +
          'evaluation to. Add the manager by hand before confirming this joiner.',
        fixable: true,
        link: '/new-joiners',
        severity: 'warning',
      });
    }

    if (!r.suggested_doj && !r.account_created_at) {
      problems.push({
        key: `candidate:${r.id}:no-doj`,
        title: 'No joining date',
        subject: who,
        detail:
          'The account has no usable creation date, so the evaluation schedule cannot be ' +
          'worked out. Enter the joining date by hand, or upload the sheet.',
        fixable: true,
        link: '/new-joiners',
        severity: 'warning',
      });
    }

    if (!r.office_email || !String(r.office_email).trim()) {
      problems.push({
        key: `candidate:${r.id}:no-email`,
        title: 'No office email',
        subject: who,
        detail: 'Without an office email this person cannot be matched or evaluated.',
        fixable: true,
        link: '/new-joiners',
        severity: 'critical',
      });
    }
  }

  return problems;
}

/**
 * Problems with the scan itself — it errored, or has not run recently enough.
 * @returns {Promise<object[]>}
 */
async function findScanProblems() {
  let runs = [];
  try {
    // Only real scans count. A dry run is a preview HR asked for and proves
    // nothing about whether the nightly check is working.
    runs = await prisma.$queryRaw`
      SELECT id::text AS id, status, error_message, run_at
        FROM pea_azure_sync_log
       WHERE mode = 'scan'
       ORDER BY run_at DESC
       LIMIT 5`;
  } catch (err) {
    logger.warn(`[sync-alert] could not read the scan history: ${err.message}`);
    return [];
  }

  const problems = [];
  const last = runs[0];

  if (!last) {
    // Nothing has ever run. Worth saying once, but not a nightly alarm — the
    // scan may simply not be switched on yet.
    return [{
      key: 'scan:never-run',
      title: 'The Microsoft 365 check has never run',
      subject: '—',
      detail:
        'No scan has completed yet, so new joiners are not being picked up automatically. ' +
        'Add people by hand, or switch the nightly check on in Settings.',
      fixable: true,
      link: '/settings',
      severity: 'warning',
    }];
  }

  if (last.status === 'failed') {
    problems.push({
      // Keyed on the run, so a repeated failure of the SAME run is said once,
      // but tomorrow's fresh failure is a fresh alert.
      key: `scan:failed:${last.id}`,
      title: 'The Microsoft 365 check failed',
      subject: last.run_at ? formatDisplay(last.run_at) : '—',
      detail:
        `${last.error_message || 'The directory could not be read.'} ` +
        'New joiners are not being picked up until this succeeds.',
      fixable: false,
      link: '/new-joiners',
      severity: 'critical',
    });
    return problems;
  }

  const finished = last.run_at;
  if (finished) {
    const hours = (Date.now() - new Date(finished).getTime()) / 3_600_000;
    if (hours > STALE_SCAN_HOURS) {
      problems.push({
        key: `scan:stale:${toDateString(todayIn(config.scheduler.timezone))}`,
        title: 'The Microsoft 365 check has not run recently',
        subject: `last ran ${formatDisplay(finished)}`,
        detail:
          `No successful check for ${Math.floor(hours)} hours. New joiners may be missing. ` +
          'Run it now from the New joiners screen, or check the schedule in Settings.',
        fixable: false,
        link: '/new-joiners',
        severity: 'warning',
      });
    }
  }

  return problems;
}

/**
 * Find everything wrong, ring the bell for each, and send HR one digest.
 *
 * Deliberately one email covering everything rather than one per problem: HR
 * asked for an alert, not an inbox full of them.
 *
 * @param {{dryRun?: boolean, scan?: object}} [opts] - `scan` is the report from
 *   a scan that has just finished, included in the email as context.
 * @returns {Promise<{problems: number, notified: number, emailed: boolean, rows: object[]}>}
 */
export async function runSyncAlerts({ dryRun = false, scan = null } = {}) {
  const enabled = await boolSetting('sync_alert_enabled', true);
  if (!enabled) {
    return { problems: 0, notified: 0, emailed: false, rows: [], disabled: true };
  }

  const [scanProblems, recordProblems] = await Promise.all([
    findScanProblems(),
    findUnusableCandidates(),
  ]);

  // Scan-level problems first: if the check itself is broken, that explains the
  // record-level ones and is what HR should act on.
  const problems = [...scanProblems, ...recordProblems];

  if (dryRun) {
    return { dryRun: true, problems: problems.length, notified: 0, emailed: false, rows: problems };
  }

  if (problems.length === 0) {
    logger.info('[sync-alert] nothing to report');
    return { problems: 0, notified: 0, emailed: false, rows: [] };
  }

  let notified = 0;
  for (const p of problems) {
    notified += await notifyStaff({
      type: 'sync_problem',
      title: p.title,
      body: `${p.subject === '—' ? '' : `${p.subject}: `}${p.detail}`,
      link: p.link,
      severity: p.severity,
      dedupeKey: `sync:${p.key}`,
    });
  }

  // Nothing new got through the dedupe, so every one of these has already been
  // announced. Sending the digest anyway is exactly the nightly repeat HR was
  // promised would not happen.
  let emailed = false;
  if (notified > 0) {
    const critical = problems.filter((p) => p.severity === 'critical').length;
    const headline =
      problems.length === 1
        ? 'The Microsoft 365 check found something that needs your attention.'
        : `The Microsoft 365 check found ${problems.length} things that need your attention` +
          `${critical ? `, ${critical} of them urgent` : ''}.`;

    const result = await queueEmail({
      type: 'sync_alert',
      context: {
        problems,
        headline,
        scan,
        today: formatDisplay(todayIn(config.scheduler.timezone)),
      },
    });
    emailed = result.status !== 'failed';
  }

  logger.info(
    `[sync-alert] ${problems.length} problem(s), ${notified} newly raised` +
      `${emailed ? ', HR digest queued' : ''}`
  );

  return { problems: problems.length, notified, emailed, rows: problems };
}
