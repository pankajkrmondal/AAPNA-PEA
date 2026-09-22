/**
 * settings.service.js — the admin screen's view of pea_settings.
 *
 * Every value the Power Automate flows hardcoded lives in pea_settings, so HR
 * can change it without a deployment. Until now changing one meant writing SQL
 * in pgAdmin. This service is the typed, validated way to do it.
 *
 * ── The rule this file exists to enforce ───────────────────────────────────
 *
 * Only settings the code ACTUALLY READS are editable. Nine rows seeded by the
 * core DDL are not read by anything (the cadence is fixed by the rule in
 * cycleGenerator.service.js; sender, reply-to and timezone come from .env). An
 * editable box that saves and does nothing is worse than no box — so those are
 * listed as "not in effect", read-only, with where the real control lives.
 */
import cron from 'node-cron';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { notifyStaff } from './inAppNotification.service.js';
import { TEMPLATE_DEFS, listTemplateCatalog, validateDraft, renderPreview } from './emailTemplate.service.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The editable settings. `critical` changes are announced to every admin via
 * the bell.
 *
 * Nothing here needs a restart. The three settings that drive a cron are
 * applied to the running process the moment they are saved — see RELOADS_JOB.
 */
export const REGISTRY = Object.freeze([
  // ── Email ──────────────────────────────────────────────────────────────
  {
    key: 'shadow_mode', group: 'Email', type: 'boolean', critical: true,
    label: 'Pause all email',
    help: 'Normally off. Off: PEA sends every email — on staging to the test inbox, on production to the real people. On (emergency only): emails are logged as "would have sent" and nothing leaves the system.',
  },
  {
    key: 'cc_emails', group: 'Email', type: 'email_list',
    label: 'CC on evaluation emails',
    help: 'Copied on every evaluation request and reminder, alongside the project leader. Lifted from the Power Automate flow.',
  },
  {
    key: 'hr_notification_emails', group: 'Email', type: 'email_list',
    label: 'HR notification recipients',
    help: 'Receive submission acknowledgements, extension alerts and the deadline digest.',
  },
  {
    key: 'it_report_emails', group: 'Email', type: 'email_list',
    label: '"Report to IT" recipients',
    help: 'Where directory corrections are sent. Required before Report to IT works in production.',
  },
  {
    key: 'never_cc_as_pl', group: 'Email', type: 'email_list',
    label: 'Never copy these as project leader',
    help: 'People who should not be copied on evaluation emails just because they are listed as the project leader. The old Power Automate flow left one address off on purpose; PEA copied everyone until now. They are still copied if they are the reporting manager, or if they are on the CC list above.',
  },
  {
    key: 'cc_on_team_links', group: 'Email', type: 'boolean',
    default: 'true',
    label: 'Copy HR on manager team-link emails',
    help: 'On: the "my team" link sent to a manager is copied to the HR notification recipients and the CC list, like every other evaluation email. Subhajit, 15 Sep: "Anuj will be there in the CC as well… along with the HR."',
  },

  // ── Evaluations ────────────────────────────────────────────────────────
  {
    key: 'token_validity_days', group: 'Evaluations', type: 'integer', min: 1, max: 180,
    label: 'Form link valid for (days)',
    help: 'How long a manager’s evaluation link works after it is sent.',
  },
  {
    key: 'reminder_max_count', group: 'Evaluations', type: 'integer', min: 0, max: 2,
    label: 'Reminders per evaluation',
    help: 'At most 2 — the database enforces it. 0 turns reminders off.',
  },
  {
    key: 'reminder_offsets_days', group: 'Evaluations', type: 'int_list', min: 1, max: 30,
    label: 'Reminder days after sending',
    help: 'Comma-separated, ascending, e.g. 2,4. Reconstructed from the PPT user guide — HR to confirm.',
  },
  {
    key: 'sweep_cron', group: 'Evaluations', type: 'cron',
    label: 'Daily sweep time (cron)',
    help: 'When evaluation emails and reminders go out, in IST. Default 0 11 * * * — 11:00, as the old flow.',
  },

  // ── Probation ──────────────────────────────────────────────────────────
  {
    key: 'confirmation_deadline_months', group: 'Probation', type: 'integer', min: 1, max: 24,
    label: 'Confirmation deadline (months)',
    help: 'A decision must be recorded this many months after joining.',
  },
  {
    key: 'confirmation_deadline_extended_months', group: 'Probation', type: 'integer', min: 1, max: 24,
    label: 'Deadline once extended (months)',
    help: 'The same deadline after an "Extend for…" decision.',
  },
  {
    key: 'deadline_alert_email_enabled', group: 'Probation', type: 'boolean',
    label: 'Email HR a daily deadline digest',
    help: 'Decision 17. The dashboard and bell show overdue probations either way.',
  },

  // ── New joiners (Entra) ────────────────────────────────────────────────
  {
    key: 'azure_scan_enabled', group: 'New joiners', type: 'boolean',
    label: 'Nightly Entra scan',
    help: 'Finds new joiners every night. "Scan now" works regardless.',
  },
  {
    key: 'azure_scan_cron', group: 'New joiners', type: 'cron',
    label: 'Scan time (cron)',
    help: 'Default 0 9 * * * — two hours before the evaluation sweep.',
  },
  {
    key: 'azure_scan_window_days', group: 'New joiners', type: 'integer', min: 1, max: 365,
    label: 'Look back for new accounts (days)',
    help: 'Wide enough for a delayed joining date; narrow enough not to enqueue years of staff.',
  },
  {
    key: 'azure_email_domain', group: 'New joiners', type: 'domain',
    label: 'Joiner email domain',
    help: 'Only accounts on this domain are treated as joiners.',
  },
  {
    key: 'azure_field_sync_enabled', group: 'New joiners', type: 'boolean', critical: true,
    label: 'Let the scan update names and emails',
    help: 'Overwrites unlocked names and office emails with Entra’s values. Run a dry-run scan first to see how many would change.',
  },
  {
    key: 'hold_evaluations_for_leavers', group: 'New joiners', type: 'boolean', critical: true,
    default: 'true',
    label: 'Hold evaluations when Microsoft 365 says someone has left',
    help: 'On: the moment the nightly check finds an account switched off and unlicensed, that person’s evaluation emails stop — before HR confirms the exit. This is the case Subhajit described on 15 Sep, where a forgotten pause let an evaluation go out to someone who had left. Off: emails keep going until HR marks them as left by hand.',
  },
  {
    key: 'sync_alert_enabled', group: 'New joiners', type: 'boolean', critical: true,
    default: 'true',
    label: 'Email HR when the Microsoft 365 check goes wrong',
    help: 'On: HR is emailed when the nightly check fails, has not run, or finds a joiner that cannot be used — someone with no manager or no joining date. Each problem is reported once, not every night. Off: problems are only visible in the app, which means a failure can go unnoticed.',
  },
  {
    key: 'manual_pause_enabled', group: 'New joiners', type: 'boolean',
    default: 'false',
    label: 'Show the manual pause button',
    help: 'Off by default. Exits are handled automatically by the setting above, so the only remaining use is long leave — a sabbatical or maternity leave where the Microsoft 365 account stays active. Anyone already paused keeps their pause and can still be resumed whether this is on or off.',
  },

  // ── Access ─────────────────────────────────────────────────────────────
  {
    key: 'manager_link_validity_days', group: 'Access', type: 'integer', min: 1, max: 180,
    label: 'Manager portal link valid for (days)',
    help: 'Issuing a new link revokes the previous one.',
  },
  {
    key: 'employee_self_view', group: 'Access', type: 'choice', critical: true,
    options: ['off', 'schedule', 'averages', 'full'],
    default: 'averages',
    label: 'Employee self-view',
    help: 'What an employee sees through their own link. off: nothing. schedule: dates and status only. averages: plus their average ratings. full: plus per-parameter ratings and manager comments. HR chose averages (13 Sep).',
  },
]);

/** Rows in pea_settings that nothing reads, and where the real control is. */
const NOT_IN_EFFECT = Object.freeze({
  fresher_cycle_count: 'Fixed at 6 by the evaluation rule in cycleGenerator.service.js.',
  fresher_interval_days: 'Fixed at 30 by the evaluation rule in cycleGenerator.service.js.',
  experienced_cycle_count: 'Fixed at 3 by the evaluation rule in cycleGenerator.service.js.',
  experienced_interval_days: 'Fixed at 60 by the evaluation rule in cycleGenerator.service.js.',
  extension_1month_day: 'Fixed at DOJ + 210 days by the extension rule in cycleGenerator.service.js.',
  extension_2month_day: 'Fixed at DOJ + 240 days by the extension rule in cycleGenerator.service.js.',
  sender_email: 'Set by PEA_SENDER_EMAIL / MS_DEFAULT_SENDER_EMAIL in the .env file.',
  reply_to_email: 'Set by PEA_REPLY_TO in the .env file.',
  sweep_timezone: 'Set by TZ in the .env file.',
  skip_weekends: 'Always on — due dates are moved off weekends when the schedule is generated.',
  rm_pl_map_seeded_at: 'Written automatically when the RM→PL map is rebuilt.',
});

const byKey = new Map(REGISTRY.map((r) => [r.key, r]));

/**
 * Settings that change a running cron, and the job that owns each one.
 *
 * Saving one of these used to say "takes effect after the backend restarts",
 * which put HR in the position of needing a developer to apply their own
 * change. Both jobs read their settings inside their start function and stop
 * any previous task first, so re-running that function is all it takes.
 */
const RELOADS_JOB = Object.freeze({
  sweep_cron: 'scheduler',
  azure_scan_cron: 'intake',
  azure_scan_enabled: 'intake',
});

/**
 * Apply a schedule change to the running process.
 *
 * Imported lazily because the jobs import this service — a static import would
 * be a cycle. Never throws: the value is already saved, and failing to restart
 * a cron must not make a successful save look like a failed one. The worst case
 * is the old behaviour, a schedule that waits for the next restart.
 *
 * @param {string} job - 'scheduler' | 'intake'
 * @returns {Promise<boolean>} whether the job was restarted
 */
async function reloadJob(job) {
  try {
    if (job === 'scheduler') {
      const { startScheduler } = await import('../jobs/evaluationScheduler.js');
      await startScheduler();
    } else {
      const { startIntakeScanner } = await import('../jobs/intakeScanner.js');
      await startIntakeScanner();
    }
    return true;
  } catch (err) {
    logger.error(`⏰ Could not apply the new schedule without a restart: ${err.message}`);
    return false;
  }
}

/**
 * Validate and normalise one value.
 *
 * Pure, so the rules are testable without a database.
 *
 * @param {object} def - a REGISTRY entry
 * @param {*} raw
 * @returns {string} the value as stored
 * @throws {AppError} 400
 */
export function normaliseValue(def, raw) {
  const s = raw === null || raw === undefined ? '' : String(raw).trim();
  const fail = (msg) => { throw new AppError(`${def.label}: ${msg}`, 400); };

  switch (def.type) {
    case 'boolean':
      if (!['true', 'false'].includes(s.toLowerCase())) fail('must be on or off');
      return s.toLowerCase();

    case 'integer': {
      if (!/^-?\d+$/.test(s)) fail('must be a whole number');
      const n = Number(s);
      if (def.min !== undefined && n < def.min) fail(`must be at least ${def.min}`);
      if (def.max !== undefined && n > def.max) fail(`must be at most ${def.max}`);
      return String(n);
    }

    case 'int_list': {
      const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
      if (!parts.length) fail('enter at least one number, e.g. 2,4');
      const nums = parts.map((p) => {
        if (!/^\d+$/.test(p)) fail(`"${p}" is not a whole number`);
        return Number(p);
      });
      nums.forEach((n) => {
        if (n < def.min || n > def.max) fail(`each value must be between ${def.min} and ${def.max}`);
      });
      if (nums.some((n, i) => i > 0 && n <= nums[i - 1])) fail('values must be in ascending order');
      return nums.join(',');
    }

    case 'email_list': {
      const list = s.split(/[;,\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
      const bad = list.filter((e) => !EMAIL.test(e));
      if (bad.length) fail(`not a valid email: ${bad.join(', ')}`);
      return [...new Set(list)].join(';');
    }

    case 'cron':
      if (!cron.validate(s)) fail(`"${s}" is not a valid cron expression`);
      return s;

    case 'domain': {
      const d = s.toLowerCase().replace(/^@/, '');
      if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) fail('must be a domain such as aapnainfotech.com');
      return d;
    }

    case 'choice':
      if (!def.options.includes(s)) fail(`must be one of: ${def.options.join(', ')}`);
      return s;

    default:
      return s;
  }
}

/**
 * All settings, grouped, with what is and is not in effect.
 *
 * ── Why the database column names are withheld ──────────────────────────────
 *
 * `setting_key` is the pea_settings primary key — internal plumbing. It is
 * meaningful to whoever maintains the system and noise to HR, who work from the
 * label and the help text. "Not in effect" is the same thing taken further: it
 * is a list of database rows that exist only to stop a maintainer changing one
 * in pgAdmin expecting an effect, which is not a question HR ever asks.
 *
 * So both are served only to a super admin. Everyone else gets the same
 * settings, the same labels and the same ability to change them — the screen
 * loses a monospace caption, not a capability. Filtering here rather than in
 * the browser means the keys are never sent, so they cannot be read out of the
 * network response either.
 *
 * @param {{role?: string}} [viewer] - the signed-in user
 * @returns {Promise<object>}
 */
export async function listSettings(viewer = {}) {
  const rows = await prisma.pea_settings.findMany();
  const stored = new Map(rows.map((r) => [r.setting_key, r]));
  const showsInternals = String(viewer.role || '').trim().toLowerCase() === 'superadmin';

  const editable = REGISTRY.map((def) => {
    const row = stored.get(def.key);
    return {
      ...def,
      // Always present, because the browser saves by it. `key` is what the PUT
      // addresses; `showKey` is what the screen is allowed to print.
      showKey: showsInternals,
      value: row?.setting_value ?? def.default ?? '',
      modifiedAt: row?.modified_at ?? null,
      stored: !!row,
    };
  });

  const notInEffect = showsInternals
    ? rows
      .filter((r) => NOT_IN_EFFECT[r.setting_key])
      .map((r) => ({ key: r.setting_key, value: r.setting_value, reason: NOT_IN_EFFECT[r.setting_key] }))
    : null;

  return {
    environment: config.env,
    emailRedirect: config.email.redirectActive ? config.email.testRecipients : null,
    groups: [...new Set(REGISTRY.map((r) => r.group))].map((g) => ({
      name: g,
      settings: editable.filter((s) => s.group === g),
    })),
    notInEffect,
  };
}

/**
 * Change one setting.
 * @param {string} key
 * @param {*} value
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function updateSetting(key, value, actor) {
  const def = byKey.get(key);
  if (!def) {
    throw new AppError(
      NOT_IN_EFFECT[key]
        ? `${key} is not read by the application — ${NOT_IN_EFFECT[key]}`
        : `Unknown setting "${key}"`,
      400
    );
  }

  const next = normaliseValue(def, value);

  // Cross-field rule: a reminder with no day to send it on would never go out.
  if (key === 'reminder_max_count' || key === 'reminder_offsets_days') {
    const rows = await prisma.pea_settings.findMany({
      where: { setting_key: { in: ['reminder_max_count', 'reminder_offsets_days'] } },
    });
    const current = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    const count = Number(key === 'reminder_max_count' ? next : current.reminder_max_count ?? 2);
    const offsets = String(key === 'reminder_offsets_days' ? next : current.reminder_offsets_days ?? '2,4').split(',');
    if (offsets.length < count) {
      throw new AppError(
        `${count} reminder(s) need ${count} day offset(s), but only ${offsets.length} are set (${offsets.join(',')}).`,
        400
      );
    }
  }

  const before = await prisma.pea_settings.findUnique({ where: { setting_key: key } });
  if (before?.setting_value === next) return { key, value: next, changed: false, applied: true };

  await prisma.pea_settings.upsert({
    where: { setting_key: key },
    create: { setting_key: key, setting_value: next, description: def.help },
    update: { setting_value: next, modified_at: new Date() },
  });

  logger.warn(`⚙️ Setting ${key} changed by ${actor}: ${JSON.stringify(before?.setting_value ?? null)} → ${JSON.stringify(next)}`);

  // pea_settings has no history of its own, so a change that alters what the
  // system sends or who sees what is announced to every admin — the record of
  // who flipped it, and when.
  if (def.critical) {
    await notifyStaff({
      type: 'setting_changed',
      title: `${def.label} changed to "${next}"`,
      body: `By ${actor}. Was "${before?.setting_value ?? '(unset)'}".`,
      link: '/settings',
      severity: 'warning',
      roles: ['superadmin', 'admin'],
    });
  }

  // A schedule change is applied to the running process here, so HR never has
  // to ask anyone to restart a server to make their own change take effect.
  const applied = RELOADS_JOB[key] ? await reloadJob(RELOADS_JOB[key]) : true;

  return { key, value: next, changed: true, applied };
}

// ── Email templates ─────────────────────────────────────────────────────────

/**
 * Every email PEA sends, with its current subject and body and the
 * placeholders it may use.
 * @returns {Promise<object[]>}
 */
export async function listTemplates() {
  return listTemplateCatalog();
}

/**
 * Save the subject and body HR edited. Saving the built-in wording unchanged
 * stores nothing, so the email keeps following the default.
 * @param {string} key
 * @param {{subject?: string, body?: string}} input
 * @param {string} actor
 * @returns {Promise<{key: string, overridden: boolean}>}
 */
export async function saveTemplate(key, input, actor) {
  const { subject, body } = validateDraft(key, input || {});
  const def = TEMPLATE_DEFS[key];

  if (subject === def.subject.trim() && body === def.body.trim()) return resetTemplate(key, actor);

  for (const [suffix, value] of [['subject', subject], ['body', body]]) {
    const settingKey = `template.${key}.${suffix}`;
    await prisma.pea_settings.upsert({
      where: { setting_key: settingKey },
      create: { setting_key: settingKey, setting_value: value, description: `Email template: ${def.name}` },
      update: { setting_value: value, modified_at: new Date() },
    });
  }

  logger.warn(`✉️ Email template "${def.name}" saved by ${actor}`);
  return { key, overridden: true };
}

/**
 * Go back to the built-in wording.
 * @param {string} key
 * @param {string} actor
 * @returns {Promise<{key: string, overridden: boolean}>}
 */
export async function resetTemplate(key, actor) {
  const def = TEMPLATE_DEFS[key];
  if (!def) throw new AppError(`Unknown email template "${key}"`, 404);

  await prisma.pea_settings.deleteMany({
    where: { setting_key: { in: [`template.${key}.subject`, `template.${key}.body`] } },
  });

  logger.warn(`✉️ Email template "${def.name}" reset to default by ${actor}`);
  return { key, overridden: false };
}

/**
 * Render a draft with sample data. Nothing is saved or sent.
 * @param {string} key
 * @param {{subject?: string, body?: string}} draft
 */
export function previewTemplate(key, draft) {
  return renderPreview(key, draft);
}
