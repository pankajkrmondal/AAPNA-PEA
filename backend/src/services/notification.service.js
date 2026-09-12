/**
 * notification.service.js — the single choke point for outbound mail.
 *
 * Day 3 records what WOULD be sent into pea_email_log. Day 4 adds the Microsoft
 * Graph transport behind the same function, so no caller changes.
 *
 * Splitting it this way is deliberate rather than incidental: it means the
 * shadow-mode comparison from plan R6 stage 1 works from the very first day.
 * PEA can run alongside Power Automate producing its "would have sent" list,
 * and if that list matches what the flows actually sent for three consecutive
 * days, the logic is proven before a single real email is at stake.
 *
 * THREE INDEPENDENT BRAKES stand between this function and a real mailbox:
 *   1. pea_settings.shadow_mode = 'true'  → nothing is sent at all
 *   2. EMAIL_REDIRECT_TO_TEST=true        → recipients rewritten to the test inbox
 *   3. PEA_SCHEDULER_ENABLED=false        → the sweep never runs
 * All three are reported by GET /api/health.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';

/** Read a setting, falling back when the row is absent. */
async function setting(key, fallback = null) {
  const row = await prisma.pea_settings.findUnique({ where: { setting_key: key } });
  return row?.setting_value ?? fallback;
}

/** True when shadow mode is on — log the intent, send nothing. */
export async function isShadowMode() {
  return (await setting('shadow_mode', 'true')) === 'true';
}

/**
 * Resolve the real recipients for a notification type.
 * @param {string} type
 * @param {object} employee
 * @returns {Promise<{to: string[], cc: string[]}>}
 */
async function resolveRecipients(type, employee) {
  const ccList = (await setting('cc_emails', '')).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const hrList = (await setting('hr_notification_emails', ''))
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  switch (type) {
    case 'evaluation_link':
    case 'reminder':
      // To the reporting manager, cc the project leader plus the standing list.
      return {
        to: [employee.rm_email].filter(Boolean),
        cc: [employee.pl_email, ...ccList].filter(Boolean),
      };

    case 'acknowledgement':
    case 'extend_alert':
    case 'hr_notification':
      return { to: hrList, cc: [] };

    default:
      return { to: hrList, cc: [] };
  }
}

/**
 * Apply the non-production guard.
 *
 * Mirrors the ATS staging behaviour: every recipient is replaced with the test
 * inbox and cc is cleared. PEA applies this with NO exceptions — ATS exempts
 * internal alerts and operator-typed addresses, but every PEA recipient is a
 * colleague who never asked to be emailed by a test system.
 *
 * @param {{to: string[], cc: string[]}} recipients
 * @returns {{to: string[], cc: string[], redirected: boolean}}
 */
export function applyRedirect({ to, cc }) {
  if (!config.email.redirectInNonProd) return { to, cc, redirected: false };

  // FAIL CLOSED. config/index.js refuses to boot when the redirect is on and no
  // test inbox is configured, so reaching here with an empty list would mean
  // the config was mutated at runtime. Returning the real recipients instead
  // would do exactly what the guard exists to prevent, silently.
  if (config.email.testRecipients.length === 0) {
    throw new Error(
      'Recipient redirect is ON but EMAIL_STAGING_RECIPIENTS is empty — refusing to send.'
    );
  }

  return { to: config.email.testRecipients, cc: [], redirected: true };
}

/**
 * Record (and, from Day 4, send) a notification.
 *
 * @param {object} params
 * @param {string} params.type - evaluation_link | reminder | acknowledgement | extend_alert | hr_notification
 * @param {bigint} [params.cycleId]
 * @param {bigint} [params.employeeId]
 * @param {string} params.subject
 * @param {object} [params.context] - extra detail for the log line
 * @returns {Promise<{status: string, to: string[], redirected: boolean}>}
 */
export async function queueEmail({ type, cycleId, employeeId, subject, context = {} }) {
  const employee = employeeId
    ? await prisma.pea_employees.findUnique({ where: { id: employeeId } })
    : null;

  const real = await resolveRecipients(type, employee || {});
  const { to, cc, redirected } = applyRedirect(real);

  const shadow = await isShadowMode();
  // 'suppressed' is the shadow-mode marker the R6 stage-1 diff reads.
  const status = shadow ? 'suppressed' : 'sent';

  await prisma.pea_email_log.create({
    data: {
      cycle_id: cycleId ?? null,
      employee_id: employeeId ?? null,
      email_type: type,
      recipient_email: to.join(', ') || '(none resolved)',
      cc_emails: cc.join(', ') || null,
      subject,
      status,
      error_message: shadow
        ? `SHADOW MODE — not sent. Would have gone to: ${real.to.join(', ') || '(none)'}` +
          (real.cc.length ? ` cc ${real.cc.join(', ')}` : '')
        : null,
    },
  });

  if (shadow) {
    logger.info(
      `📭 [shadow] ${type} NOT sent — would have gone to ${real.to.join(', ') || '(none)'}` +
        ` · "${subject}"` +
        (Object.keys(context).length ? ` · ${JSON.stringify(context)}` : '')
    );
  } else {
    // Day 4 replaces this branch with the Graph send.
    logger.info(
      `📧 ${type} → ${to.join(', ')}${redirected ? ' [REDIRECTED to test inbox]' : ''} · "${subject}"`
    );
  }

  return { status, to, redirected };
}

/**
 * The shadow-mode comparison report for plan R6 stage 1.
 *
 * Lists what PEA would have sent over a window, so it can be diffed against
 * what Power Automate actually sent. Three matching days is the evidence that
 * the migrated logic is correct — the cheapest possible validation, and it
 * costs no user-visible risk.
 *
 * @param {number} [days=7]
 * @returns {Promise<object[]>}
 */
export async function shadowReport(days = 7) {
  const since = new Date(Date.now() - days * 86_400_000);

  const rows = await prisma.pea_email_log.findMany({
    where: { sent_at: { gte: since } },
    orderBy: { sent_at: 'desc' },
    include: {
      employee: { select: { full_name: true, office_email: true, rm_email: true } },
      cycle: { select: { seq_no: true, due_date: true } },
    },
  });

  return rows.map((r) => ({
    when: r.sent_at,
    type: r.email_type,
    status: r.status,
    employee: r.employee?.full_name ?? null,
    evaluation: r.cycle?.seq_no ?? null,
    dueDate: r.cycle?.due_date ?? null,
    wouldHaveGoneTo: r.error_message?.replace(/^SHADOW MODE — not sent\. Would have gone to: /, '') ?? null,
    actualRecipient: r.recipient_email,
    subject: r.subject,
  }));
}
