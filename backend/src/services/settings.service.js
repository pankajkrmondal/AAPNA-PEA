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
import { TEMPLATE_CATALOG, renderPreview } from './emailTemplate.service.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The editable settings. `restart` marks values read once at boot.
 * `critical` changes are announced to every admin via the bell.
 */
export const REGISTRY = Object.freeze([
  // ── Email ──────────────────────────────────────────────────────────────
  {
    key: 'shadow_mode', group: 'Email', type: 'boolean', critical: true,
    label: 'Shadow mode',
    help: 'On: every email is logged as "would have sent" and nothing leaves the system. Off: emails are sent — outside production, only ever to the test inbox.',
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
    key: 'sweep_cron', group: 'Evaluations', type: 'cron', restart: true,
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
    key: 'azure_scan_enabled', group: 'New joiners', type: 'boolean', restart: true,
    label: 'Nightly Entra scan',
    help: 'Plan §10: leave off until after the shadow-mode cutover. "Scan now" works regardless.',
  },
  {
    key: 'azure_scan_cron', group: 'New joiners', type: 'cron', restart: true,
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

  // ── Access ─────────────────────────────────────────────────────────────
  {
    key: 'manager_link_validity_days', group: 'Access', type: 'integer', min: 1, max: 180,
    label: 'Manager portal link valid for (days)',
    help: 'Issuing a new link revokes the previous one.',
  },
  {
    key: 'employee_self_view', group: 'Access', type: 'choice', critical: true,
    options: ['off', 'schedule', 'averages', 'full'],
    default: 'off',
    label: 'Employee self-view',
    help: 'What an employee sees through their own link. off: nothing. schedule: dates and status only. averages: plus their average ratings. full: plus per-parameter ratings and manager comments. Needs an HR policy decision.',
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
 * @returns {Promise<object>}
 */
export async function listSettings() {
  const rows = await prisma.pea_settings.findMany();
  const stored = new Map(rows.map((r) => [r.setting_key, r]));

  const editable = REGISTRY.map((def) => {
    const row = stored.get(def.key);
    return {
      ...def,
      value: row?.setting_value ?? def.default ?? '',
      modifiedAt: row?.modified_at ?? null,
      stored: !!row,
    };
  });

  const notInEffect = rows
    .filter((r) => NOT_IN_EFFECT[r.setting_key])
    .map((r) => ({ key: r.setting_key, value: r.setting_value, reason: NOT_IN_EFFECT[r.setting_key] }));

  return {
    environment: config.env,
    emailRedirect: config.email.redirectInNonProd ? config.email.testRecipients : null,
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
  if (before?.setting_value === next) return { key, value: next, changed: false, restart: !!def.restart };

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
      roles: ['admin'],
    });
  }

  return { key, value: next, changed: true, restart: !!def.restart };
}

// ── Email templates ─────────────────────────────────────────────────────────

/**
 * Every template, with any saved override.
 * @returns {Promise<object[]>}
 */
export async function listTemplates() {
  const overrides = await prisma.pea_settings.findMany({
    where: { setting_key: { startsWith: 'template.' } },
  });
  const map = new Map(overrides.map((o) => [o.setting_key, o]));

  return Object.entries(TEMPLATE_CATALOG).map(([key, meta]) => ({
    key,
    ...meta,
    override: {
      subject: map.get(`template.${key}.subject`)?.setting_value || '',
      body: map.get(`template.${key}.body`)?.setting_value || '',
    },
    overridden: !!(map.get(`template.${key}.subject`)?.setting_value || map.get(`template.${key}.body`)?.setting_value),
  }));
}

/**
 * Save an override. A blank subject or body falls back to the built-in wording.
 * @param {string} key
 * @param {{subject?: string, body?: string}} input
 * @param {string} actor
 */
export async function saveTemplate(key, input, actor) {
  const meta = TEMPLATE_CATALOG[key];
  if (!meta) throw new AppError(`Unknown template "${key}"`, 400);
  if (!meta.editable) throw new AppError(`${meta.label} cannot be overridden — it is built from a list.`, 400);

  const subject = String(input.subject || '').trim().slice(0, 300);
  const body = String(input.body || '').trim().slice(0, 50_000);

  // Catch a typo'd placeholder before it goes out as a blank in a real email.
  const unknown = [...`${subject} ${body}`.matchAll(/\{\{\s*(\w+)\s*\}\}/g)]
    .map((m) => m[1])
    .filter((v) => !meta.variables.includes(v));
  if (unknown.length) {
    throw new AppError(
      `Unknown placeholder(s): ${[...new Set(unknown)].map((v) => `{{${v}}}`).join(', ')}. ` +
        `Available: ${meta.variables.map((v) => `{{${v}}}`).join(', ')}`,
      400
    );
  }

  for (const [suffix, value] of [['subject', subject], ['body', body]]) {
    const settingKey = `template.${key}.${suffix}`;
    if (value) {
      await prisma.pea_settings.upsert({
        where: { setting_key: settingKey },
        create: { setting_key: settingKey, setting_value: value, description: `Override for ${meta.label}` },
        update: { setting_value: value, modified_at: new Date() },
      });
    } else {
      await prisma.pea_settings.deleteMany({ where: { setting_key: settingKey } });
    }
  }

  logger.warn(`✉️ Template ${key} ${subject || body ? 'overridden' : 'reset to built-in'} by ${actor}`);
  return { key, overridden: !!(subject || body) };
}

/**
 * Render a draft with sample data. Nothing is saved or sent.
 * @param {string} key
 * @param {{subject?: string, body?: string}} draft
 */
export function previewTemplate(key, draft) {
  if (!TEMPLATE_CATALOG[key]) throw new AppError(`Unknown template "${key}"`, 400);
  return renderPreview(key, draft);
}
