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
import { hasRecipientColumns } from '../utils/schemaCapabilities.js';
import { modulesFor } from './modulePermissions.service.js';
import { todayIn, toUtcMidnight, formatDisplay } from '../utils/dateUtils.js';

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

  /**
   * People who must not be copied merely for being the project leader.
   *
   * The old Power Automate flow deliberately left one address off; PEA copied
   * everyone, which Subhajit noticed in the 15-Sep demo. This suppresses the
   * PL slot only — being on the standing CC list, or being the reporting
   * manager, still copies them, because those are different reasons to be on
   * the mail.
   */
  const neverAsPl = new Set(
    split(await setting('never_cc_as_pl', '')).map((s) => s.toLowerCase())
  );
  const plFor = (employee) => {
    const pl = String(employee?.pl_email || '').trim();
    return pl && !neverAsPl.has(pl.toLowerCase()) ? [pl] : [];
  };

  switch (type) {
    case 'it_report':
      // To IT, cc HR so the correction is visible to the team that raised it.
      return { to: split(await setting('it_report_emails', '')), cc: hrList };

    case 'manager_portal': {
      // Subhajit, 15-Sep (18:40): "All the process which you have kept… Anuj
      // will be there in the CC as well… along with the HR." The team link was
      // the one evaluation email copying nobody, which made it the odd one out
      // rather than a deliberate exception.
      const copyTeamLinks = (await setting('cc_on_team_links', 'true')) !== 'false';
      return {
        to: [context.rmEmail].filter(Boolean),
        cc: copyTeamLinks ? [...new Set([...hrList, ...ccList])] : [],
      };
    }

    case 'evaluation_report':
      // R-05. The one type whose recipients are typed at send time: the person
      // who asked for the report is not a role PEA can know in advance
      // (Subhajit, 19:44 — a senior leader emails him out of the blue). Already
      // validated and domain-checked in evaluationReport.service.js.
      return {
        to: context.recipients?.to || [],
        cc: context.recipients?.cc || [],
      };

    case 'deadline_alert':
    // R-03. To HR only: it reports a problem with PEA's own plumbing, which is
    // not a manager's business and would only invite them to ignore PEA mail.
    case 'sync_alert':
      return { to: hrList, cc: [] };

    case 'evaluation_link':
    case 'reminder':
    case 'evaluation_reopened': {
      // To whoever holds the link, cc the project leader plus the standing
      // list. plFor() honours the "never copy as project leader" list.
      //
      // M3 / M7 — "whoever holds the link" is the person it was issued to:
      // normally the reporting manager, an acting manager when HR sent it to
      // one. A reminder must chase the person who can actually answer, and an
      // acting manager's emails copy the real manager so nothing is answered in
      // their name without their knowing. It was always the current manager:
      //
      // return {
      //   to: [employee.rm_email].filter(Boolean),
      //   cc: [...new Set([...plFor(employee), ...ccList].filter(Boolean))],
      // };
      const holder = String(context.sentTo?.email || employee.rm_email || '').trim();
      const to = [holder].filter(Boolean);
      const copyManager = context.sentTo?.delegated ? [employee.rm_email] : [];
      const cc = [...new Set([...plFor(employee), ...ccList, ...copyManager].filter(Boolean))]
        .filter((address) => address.toLowerCase() !== holder.toLowerCase());
      return { to, cc };
    }

    // H1 (07-10-2026) — new joiners waiting for review. Harish: to "the admin
    // and hr" — the PEA users who can act on it, not the HR recipients list.
    case 'joiners_waiting':
      return { to: await reviewRecipientsNow(), cc: [] };

    case 'acknowledgement':
    case 'extend_alert':
    case 'hr_notification':
      return { to: hrList, cc: [] };

    default:
      return { to: hrList, cc: [] };
  }
}

/**
 * Who is emailed when new joiners wait for review — H1 (07-10-2026). Pure.
 *
 * Every active super admin and admin, and every active HR user who can open
 * the New joiners screen: an HR user with that screen switched off could not
 * act on the email. The same people the bell tells. Each address once.
 *
 * @param {Array<{id: number, email: string, role: string, is_active: boolean}>} users
 * @param {Map<number, string[]>} modulesById - the modules each HR user can open
 * @returns {string[]}
 */
export function reviewRecipients(users, modulesById = new Map()) {
  const seen = new Set();
  const out = [];
  for (const u of users) {
    if (!u.is_active) continue;
    const role = String(u.role || '').trim().toLowerCase();
    const admin = role === 'superadmin' || role === 'admin';
    const hr = role === 'hr' && (modulesById.get(u.id) || []).includes('new_joiners');
    if (!admin && !hr) continue;
    const email = String(u.email || '').trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push(email);
  }
  return out;
}

/** reviewRecipients() for the users as they are now. */
async function reviewRecipientsNow() {
  const users = await prisma.pea_users.findMany({
    where: { is_active: true, role: { in: ['superadmin', 'admin', 'hr'] } },
    select: { id: true, email: true, role: true, is_active: true },
  });
  const modulesById = new Map();
  for (const u of users.filter((x) => x.role === 'hr')) {
    // eslint-disable-next-line no-await-in-loop
    modulesById.set(u.id, await modulesFor(u));
  }
  return reviewRecipients(users, modulesById);
}

/**
 * Who an evaluation's link was issued to, or null when nothing is recorded
 * (never sent, sent before the 2026-10-02 DDL, or no such columns here) — in
 * which case the reporting manager is used, as before. M3 / M7.
 *
 * Never throws: a reminder must not fail because this could not be read.
 *
 * @param {bigint} cycleId
 * @returns {Promise<{name: string, email: string, delegated: boolean}|null>}
 */
async function linkHolder(cycleId) {
  try {
    if (!(await hasRecipientColumns())) return null;
    const [row] = await prisma.$queryRaw`
      SELECT sent_to_name, sent_to_email, delegated FROM pea_evaluation_cycles WHERE id = ${cycleId}`;
    if (!row?.sent_to_email) return null;
    return { name: row.sent_to_name || row.sent_to_email, email: row.sent_to_email, delegated: !!row.delegated };
  } catch (err) {
    logger.warn(`Could not read who holds the link for evaluation ${cycleId}: ${err.message}`);
    return null;
  }
}

/**
 * The probation as scheduled, for the {{probation_…}} placeholders — H8.
 *
 * It ends when the last evaluation's period ends, so an extension moves it,
 * and it has as many evaluations as are scheduled. The start is the joining
 * date, which buildVars() already has.
 *
 * Never throws: an email must not go unsent because one line of context could
 * not be worked out. Without it the email simply leaves the line out.
 *
 * Exported for the bell notifications, which state the same timeline (H8).
 *
 * @param {bigint|number|null} employeeId
 * @returns {Promise<{end: Date|null, total: number}|null>}
 */
export async function probationContext(employeeId) {
  if (!employeeId) return null;
  try {
    const found = await prisma.pea_evaluation_cycles.aggregate({
      where: { employee_id: employeeId },
      _max: { period_to: true },
      _count: true,
    });
    return found._count ? { end: found._max.period_to, total: found._count } : null;
  } catch (err) {
    logger.warn(`Probation dates for employee ${employeeId} could not be read: ${err.message}`);
    return null;
  }
}

/**
 * The probation timeline in a bell notification — H8, extended 05-10-2026.
 *
 * HR asked for the probation to be stated in "all relevant emails/
 * notifications". The emails carry it in the subject and the probation line;
 * the bell is read on its own, so it says it too:
 *
 *   "Evaluation 3 of 6 · probation ends 28-12-2026"
 *   "Probation ends 28-12-2026"            (no evaluation, e.g. Record decision)
 *   "… · probation ended 28-12-2026"       (once the end date has passed)
 *
 * Pure, so it is testable without a database. Empty when nothing is known, and
 * the caller then words the notification as it did before.
 *
 * @param {{seqNo?: number|null, probation: {end: Date|null, total: number}|null, today?: Date}} p
 *   `today` is UTC midnight in PEA's time zone; it defaults to today
 * @returns {string}
 */
export function probationNote({ seqNo = null, probation, today = todayIn(config.scheduler.timezone) }) {
  if (!probation) return '';
  const parts = [];
  if (seqNo && probation.total) parts.push(`evaluation ${seqNo} of ${probation.total}`);
  if (probation.end) {
    const ended = toUtcMidnight(probation.end) < toUtcMidnight(today);
    parts.push(`probation ${ended ? 'ended' : 'ends'} ${formatDisplay(probation.end)}`);
  }
  const text = parts.join(' · ');
  return text ? text[0].toUpperCase() + text.slice(1) : '';
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
  // `redirectActive`, not `redirectInNonProd`: production diverts too when
  // EMAIL_REDIRECT_TO_TEST=true, which is how the first live run is rehearsed.
  if (!config.email.redirectActive) return { to, cc, redirected: false };

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
 *   hr_notification | it_report | manager_portal | deadline_alert | sync_alert
 * @param {object} [params.cycle] - cycle with `employee` included; required for templated types
 * @param {bigint} [params.cycleId]
 * @param {bigint} [params.employeeId]
 * @param {string} [params.subject] - overrides the template subject
 * @param {object} [params.context] - extra template variables
 * @param {Array<{name: string, contentType: string, content: Buffer}>} [params.attachments]
 *   Files to attach — R-05. Still subject to every guard below: in a non-
 *   production environment the mail (and therefore the attachment) is diverted
 *   to the test inbox, and in shadow mode nothing is sent at all.
 * @returns {Promise<{status: string, to: string[], redirected: boolean, error?: string}>}
 */
export async function queueEmail({
  type, cycle, cycleId, employeeId, subject, context = {}, attachments = [],
}) {
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

  // M3 / M7 — who holds this evaluation's link. A caller issuing a link says so
  // itself; a reminder, which only has the cycle, is told from the record.
  if (!context.sentTo && resolvedCycleId) {
    const sentTo = await linkHolder(resolvedCycleId);
    if (sentTo) context = { ...context, sentTo };
  }

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
  let rendered = { subject: subject || 'Probation Evaluation notification', body: '' };
  try {
    // H8 — every email about one person says where they are in their probation.
    // Was: buildVars(full, { ...context, employee })
    const probation = context.probation ?? (await probationContext(employee?.id ?? resolvedEmployeeId));
    rendered = await render(type, buildVars(full, { ...context, employee, probation }));
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
      attachments,
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
