/**
 * managerPortal.service.js — a reporting manager's "my team" view. Plan §10.
 *
 * Managers still get no PEA account (plan §5.4). Instead, the same trust model
 * as the evaluation form: a UUID in a link is the credential. One link shows one
 * manager their own reports only, expires, and can be revoked by HR.
 *
 * What a manager sees: each person who reports to them, every evaluation's due
 * date and status, their own submitted averages, and a direct "open form" button
 * for anything waiting on them — so a lost email no longer means a missed
 * evaluation.
 *
 * What a manager does NOT see: other managers' teams, per-parameter comments
 * written by anyone else, audit history, or anything about leavers.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { queueEmail } from './notification.service.js';
import { addDays, formatDisplay, toDateString, todayIn } from '../utils/dateUtils.js';

const norm = (v) => (v || '').trim().toLowerCase() || null;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Every reporting manager on the active roster, for HR's picker.
 * @returns {Promise<object[]>}
 */
export async function listManagers() {
  const rows = await prisma.$queryRaw`
    SELECT lower(trim(rm_email))            AS rm_email,
           max(rm_name)                     AS rm_name,
           count(*)::int                    AS team_size,
           count(*) FILTER (WHERE confirmation_status IS NULL
                              OR confirmation_status LIKE 'Extend%')::int AS in_probation
      FROM pea_employees
     WHERE employment_status = 'active' AND coalesce(trim(rm_email), '') <> ''
     GROUP BY lower(trim(rm_email))
     ORDER BY max(rm_name)`;
  return rows;
}

/**
 * Links HR has issued, newest first.
 * @returns {Promise<object[]>}
 */
export async function listLinks() {
  const links = await prisma.pea_manager_links.findMany({ orderBy: { created_at: 'desc' }, take: 200 });
  const now = new Date();
  return links.map((l) => ({
    ...l,
    id: String(l.id),
    state: l.revoked_at ? 'revoked' : l.expires_at < now ? 'expired' : 'active',
    url: portalUrl(l.token),
  }));
}

/** The SPA route a manager opens. Served by index.html behind nginx. */
function portalUrl(token) {
  return `${config.frontendUrl.replace(/\/+$/, '')}/manager/${token}`;
}

/**
 * Issue a link for one manager, optionally emailing it.
 *
 * Any earlier active link for the same manager is revoked, so there is only
 * ever one live credential per manager to reason about.
 *
 * @param {{rm_email: string, send?: boolean}} input
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function createLink(input, actor) {
  const rmEmail = norm(input.rm_email);
  if (!rmEmail) throw new AppError('Choose a reporting manager', 400);

  const [team] = await prisma.$queryRaw`
    SELECT max(rm_name) AS rm_name, count(*)::int AS n
      FROM pea_employees
     WHERE employment_status = 'active' AND lower(trim(rm_email)) = ${rmEmail}`;

  if (!team?.n) throw new AppError(`${rmEmail} has nobody reporting to them on the active roster`, 404);

  const validityRow = await prisma.pea_settings.findUnique({
    where: { setting_key: 'manager_link_validity_days' },
  });
  const validity = Number(validityRow?.setting_value) || 30;

  const now = new Date();
  const [, link] = await prisma.$transaction([
    prisma.pea_manager_links.updateMany({
      where: { rm_email: rmEmail, revoked_at: null, expires_at: { gt: now } },
      data: { revoked_at: now },
    }),
    prisma.pea_manager_links.create({
      data: {
        rm_email: rmEmail,
        rm_name: team.rm_name,
        created_by: actor,
        expires_at: addDays(now, validity),
      },
    }),
  ]);

  let email = null;
  if (input.send) {
    // Through the choke point: outside production this reaches only the test
    // inbox, whatever the manager's real address is.
    email = await queueEmail({
      type: 'manager_portal',
      context: {
        rmEmail,
        rmName: team.rm_name,
        portalUrl: portalUrl(link.token),
        expiresLabel: formatDisplay(link.expires_at),
      },
    });
  }

  logger.info(`Manager link issued by ${actor} for ${rmEmail} (${team.n} report(s))${email ? ` — email ${email.status}` : ''}`);

  return {
    id: String(link.id),
    rm_email: rmEmail,
    rm_name: team.rm_name,
    teamSize: team.n,
    expires_at: link.expires_at,
    url: portalUrl(link.token),
    email: email && { status: email.status, redirected: email.redirected, sentTo: email.to, error: email.error },
  };
}

/**
 * Revoke a link immediately.
 * @param {string|number} id
 * @param {string} actor
 */
export async function revokeLink(id, actor) {
  const { count } = await prisma.pea_manager_links.updateMany({
    where: { id: BigInt(id), revoked_at: null },
    data: { revoked_at: new Date() },
  });
  if (!count) throw new AppError('That link is already revoked or does not exist', 404);
  logger.info(`Manager link ${id} revoked by ${actor}`);
  return { revoked: true };
}

/**
 * The public team view behind a token.
 *
 * A bad, expired and revoked token all return the same 404, so the endpoint
 * cannot be used to learn which tokens once existed.
 *
 * @param {string} token
 * @returns {Promise<object>}
 */
export async function getTeamView(token) {
  const notFound = new AppError('This link is not valid. Ask HR for a new one.', 404);
  if (!UUID.test(String(token || ''))) throw notFound;

  const link = await prisma.pea_manager_links.findUnique({ where: { token } });
  if (!link || link.revoked_at || link.expires_at < new Date()) throw notFound;

  await prisma.pea_manager_links.update({
    where: { id: link.id },
    data: { last_used_at: new Date(), use_count: { increment: 1 } },
  });

  const today = todayIn(config.scheduler.timezone);
  const apiBase = config.frontendUrl.replace(/\/+$/, '');

  const team = await prisma.$queryRaw`
    SELECT id FROM pea_employees
     WHERE employment_status = 'active' AND lower(trim(rm_email)) = ${link.rm_email}`;

  const employees = await prisma.pea_employees.findMany({
    where: { id: { in: team.map((t) => t.id) } },
    orderBy: { doj: 'desc' },
    select: {
      id: true,
      full_name: true,
      doj: true,
      is_experienced: true,
      confirmation_status: true,
      halt_process: true,
      cycles: {
        orderBy: { seq_no: 'asc' },
        select: {
          seq_no: true,
          is_extension: true,
          due_date: true,
          period_from: true,
          period_to: true,
          status: true,
          token: true,
          token_expires_at: true,
          sent_at: true,
          submitted_at: true,
          avg_rating: true,
        },
      },
    },
  });

  let waiting = 0;

  const people = employees.map((e) => ({
    name: e.full_name,
    doj: toDateString(e.doj),
    type: e.is_experienced ? 'Experienced' : 'Fresher',
    decision: e.confirmation_status,
    paused: e.halt_process,
    evaluations: e.cycles.map((c) => {
      const open =
        ['email_sent', 'opened'].includes(c.status) &&
        !e.halt_process &&
        (!c.token_expires_at || c.token_expires_at > new Date());
      if (open) waiting += 1;

      return {
        number: c.seq_no,
        extension: c.is_extension,
        period: c.period_from && c.period_to ? `${toDateString(c.period_from)} → ${toDateString(c.period_to)}` : null,
        due: toDateString(c.due_date),
        status: c.status,
        overdue: c.status === 'pending' && c.due_date < today,
        sentAt: c.sent_at,
        submittedAt: c.submitted_at,
        average: c.avg_rating == null ? null : Number(c.avg_rating),
        // Only for something already sent to this manager and still open —
        // the same form link they were emailed, nothing more.
        formUrl: open ? `${apiBase}/api/evaluation/${c.token}` : null,
      };
    }),
  }));

  return {
    manager: link.rm_name || link.rm_email,
    expiresAt: link.expires_at,
    today: toDateString(today),
    waitingOnYou: waiting,
    people,
  };
}
