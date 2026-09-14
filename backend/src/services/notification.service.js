/**
 * notification.service.js — the single choke point for outbound mail.
 *
 * Every message PEA sends passes through queueEmail(). Nothing calls the Graph
 * transport directly, so the decision about whether a send may happen is made
 * in exactly one place and cannot be sidestepped by reaching for a different
 * helper.
 *
 * Where mail goes (HR decision, 13 Sep — PEA sends everything itself):
 *   • staging / development → every email to EMAIL_STAGING_RECIPIENTS, cc cleared
 *   • production            → the real people
 *
 * Two switches can still stop mail, both reported by GET /api/health:
 *   1. pea_settings.shadow_mode = 'true'  → emergency pause: logged, not sent (off by default)
 *   2. PEA_SCHEDULER_ENABLED=false        → the sweep never runs
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import { sendMail } from './graphMailer.service.js';
import { render, buildVars } from './emailTemplate.service.js';

/** Read a setting, falling back when the row is absent. */
async function setting(key, fallback = null) {
  const row = await prisma.pea_settings.findUnique({ where: { setting_key: key } });
  return row?.setting_value ?? fallback;
}

/** True only when an admin has paused all email — log the intent, send nothing. */
export async function isShadowMode() {
  return (await setting('shadow_mode', 'false')) === 'true';
}

/**
 * Resolve the real recipients for a notification type.
 * @param {string} type
 * @param {object} employee
 * @returns {Promise<{to: string[], cc: string[]}>}
 */
async function resolveRecipients(type, employee, context = {}) {
  const split = (v) => String(v || '').split(/[;,]/).map((s) => s.trim()).filter(Boolean);
  const ccList = split(await setting('cc_emails', ''));
  const hrList = split(await setting('hr_notification_emails', ''));

  switch (type) {
    case 'it_report':
      // To IT, cc HR so the correction is visible to the team that raised it.
      return { to: split(await setting('it_report_emails', '')), cc: hrList };

    case 'manager_portal':
      // A manager's own "my team" link goes to that manager and nobody else.
      return { to: [context.rmEmail].filter(Boolean), cc: [] };

    case 'deadline_alert':
      return { to: hrList, cc: [] };

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
 * inbox and cc is cleared. Every evaluation email comes through here, with no
 * exceptions. Account email (login details, password reset links) never comes
 * through queueEmail: like ATS's NEVER_REDIRECT flows it goes to the account
 * owner in every environment — see accountEmail.service.js.
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
 * Render, guard and send one notification.
 *
 * Never throws on a send failure. A cycle's row is recorded as `failed` and the
 * caller continues — one manager's unreachable mailbox must not stop the sweep
 * for everyone else, and a mail failure must never roll back a submission that
 * was already committed.
 *
 * @param {object} params
 * @param {string} params.type - evaluation_link | reminder | acknowledgement | extend_alert |
 *   hr_notification | it_report | manager_portal | deadline_alert
 * @param {object} [params.cycle] - cycle with `employee` included; required for templated types
 * @param {bigint} [params.cycleId]
 * @param {bigint} [params.employeeId]
 * @param {string} [params.subject] - overrides the template subject
 * @param {object} [params.context] - extra template variables
 * @returns {Promise<{status: string, to: string[], redirected: boolean, error?: string}>}
 */
export async function queueEmail({ type, cycle, cycleId, employeeId, subject, context = {} }) {
  const resolvedCycleId = cycleId ?? cycle?.id ?? null;
  const resolvedEmployeeId = employeeId ?? cycle?.employee_id ?? null;

  // Load what the template needs if the caller passed only ids.
  const full =
    cycle ||
    (resolvedCycleId
      ? await prisma.pea_evaluation_cycles.findUnique({
          where: { id: resolvedCycleId },
          include: { employee: true },
        })
      : null);

  const employee =
    full?.employee ||
    (resolvedEmployeeId
      ? await prisma.pea_employees.findUnique({ where: { id: resolvedEmployeeId } })
      : null);

  const real = await resolveRecipients(type, employee || {}, context);

  let to;
  let cc;
  let redirected = false;
  try {
    ({ to, cc, redirected } = applyRedirect(real));
  } catch (err) {
    // applyRedirect fails closed. Record the refusal rather than sending.
    await logRow({ type, resolvedCycleId, resolvedEmployeeId, to: [], cc: [], subject, status: 'failed', error: err.message });
    logger.error(`✋ ${type} refused: ${err.message}`);
    return { status: 'failed', to: [], redirected: false, error: err.message };
  }

  // Render subject and body from the template HR controls on the Email
  // Templates screen. `subject` is only a fallback if rendering fails — a
  // caller's subject must never override the one HR wrote.
  let rendered = { subject: subject || 'Performance Evaluation notification', body: '' };
  try {
    rendered = await render(type, buildVars(full, { ...context, employee }));
  } catch (err) {
    logger.warn(`Template "${type}" could not be rendered: ${err.message}`);
  }

  const shadow = await isShadowMode();

  if (shadow) {
    // 'suppressed' is the marker the R6 stage-1 diff reads.
    await logRow({
      type,
      resolvedCycleId,
      resolvedEmployeeId,
      to,
      cc,
      subject: rendered.subject,
      status: 'suppressed',
      error:
        `SHADOW MODE — not sent. Would have gone to: ${real.to.join(', ') || '(none)'}` +
        (real.cc.length ? ` cc ${real.cc.join(', ')}` : ''),
    });

    logger.info(
      `📭 [shadow] ${type} NOT sent — would have gone to ${real.to.join(', ') || '(none)'} · "${rendered.subject}"`
    );
    return { status: 'suppressed', to, redirected };
  }

  try {
    await sendMail({
      to,
      cc,
      subject: rendered.subject,
      html: rendered.body,
      replyTo: config.microsoft.replyTo || undefined,
    });

    await logRow({
      type,
      resolvedCycleId,
      resolvedEmployeeId,
      to,
      cc,
      subject: rendered.subject,
      status: 'sent',
      error: redirected ? `Redirected from: ${real.to.join(', ')}` : null,
    });

    logger.info(
      `📧 ${type} → ${to.join(', ')}${redirected ? ' [REDIRECTED to test inbox]' : ''} · "${rendered.subject}"`
    );
    return { status: 'sent', to, redirected };
  } catch (err) {
    await logRow({
      type,
      resolvedCycleId,
      resolvedEmployeeId,
      to,
      cc,
      subject: rendered.subject,
      status: 'failed',
      error: err.message,
    });

    logger.error(`💥 ${type} failed for ${to.join(', ')}: ${err.message}`);
    return { status: 'failed', to, redirected, error: err.message };
  }
}

/** Write one pea_email_log row. */
async function logRow({ type, resolvedCycleId, resolvedEmployeeId, to, cc, subject, status, error }) {
  await prisma.pea_email_log.create({
    data: {
      cycle_id: resolvedCycleId,
      employee_id: resolvedEmployeeId,
      email_type: type,
      recipient_email: to.join(', ') || '(none resolved)',
      cc_emails: cc.join(', ') || null,
      subject,
      status,
      error_message: error || null,
    },
  });
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
