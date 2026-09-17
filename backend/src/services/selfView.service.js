/**
 * selfView.service.js — an employee sees their own probation. Plan §10.
 *
 * HR chose `averages` on 13 Sep. What it reveals is still a setting HR can
 * change (pea_settings.employee_self_view), not a decision made in code:
 *
 *   off       nothing — links cannot be issued and existing ones stop working
 *   schedule  evaluation dates and whether each is done; no ratings at all
 *   averages  plus the average rating per evaluation, and the final decision
 *   full      plus per-parameter ratings, the manager's comments and remarks
 *
 * Never revealed at any level: who submitted, from which IP, form tokens, the
 * audit trail, or anything about another employee.
 *
 * ── Why a signed link rather than a stored one ─────────────────────────────
 *
 * No new table, so no DDL round-trip for a feature that may never be switched
 * on. The trade-off is that one link cannot be revoked on its own. Two things
 * cover that: links expire after 14 days, and they stop working at once if the
 * setting is turned off or the employee is marked as having left.
 *
 * The signing key is DERIVED from JWT_SECRET for this purpose only, so a
 * self-view link can never be replayed as a sign-in token (and verifySession
 * would reject it anyway — there is no session row behind it).
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { toDateString } from '../utils/dateUtils.js';

export const LEVELS = Object.freeze(['off', 'schedule', 'averages', 'full']);
const LINK_DAYS = 14;
const AUDIENCE = 'pea-employee-self-view';

const signingKey = () => crypto.createHmac('sha256', config.jwt.secret).update(AUDIENCE).digest();

/** The level HR has chosen. Anything unrecognised is treated as off. */
export async function currentLevel() {
  const row = await prisma.pea_settings.findUnique({ where: { setting_key: 'employee_self_view' } });
  return LEVELS.includes(row?.setting_value) ? row.setting_value : 'off';
}

/**
 * Shape what an employee may see at a given level.
 *
 * Pure, so the disclosure rules are testable without a database — these
 * tests are the written-down policy.
 *
 * @param {object} employee - with cycles and scores
 * @param {string} level
 * @returns {object}
 */
export function shapeSelfView(employee, level) {
  const showAverages = level === 'averages' || level === 'full';
  const showDetail = level === 'full';

  // The same states the rest of PEA uses (frontend/src/evaluationStatus.js),
  // told from the employee's side. "Waiting for manager" would read oddly to
  // the person being evaluated, so it stays "With your manager" — but the
  // states themselves match, so nobody sees two names for one thing.
  const STATUS = {
    pending: 'Scheduled',
    email_sent: 'With your manager',
    opened: 'With your manager',
    completed: 'Submitted',
    skipped: 'Closed',
  };

  return {
    level,
    name: employee.full_name,
    doj: toDateString(employee.doj),
    type: employee.is_experienced ? 'Experienced' : 'Fresher',
    manager: employee.rm_name,
    ...(showAverages ? { decision: employee.confirmation_status || null } : {}),
    evaluations: (employee.cycles || []).map((c) => ({
      number: c.seq_no,
      extension: c.is_extension,
      period: c.period_from && c.period_to ? `${toDateString(c.period_from)} → ${toDateString(c.period_to)}` : null,
      due: toDateString(c.due_date),
      status: STATUS[c.status] || c.status,
      ...(showAverages
        ? { average: c.status === 'completed' && c.avg_rating != null ? Number(c.avg_rating) : null }
        : {}),
      ...(showDetail && c.status === 'completed'
        ? {
            remarks: c.remarks || null,
            scores: (c.scores || []).map((s) => ({
              parameter: s.param_label,
              rating: s.rating == null ? null : Number(s.rating),
              comment: s.comments || null,
            })),
          }
        : {}),
    })),
  };
}

/**
 * Issue a link for one employee.
 * @param {bigint|number|string} employeeId
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function createSelfViewLink(employeeId, actor) {
  const level = await currentLevel();
  if (level === 'off') {
    throw new AppError('Employee self-view is switched off. An admin can choose what employees see in Settings → Access.', 400);
  }

  const employee = await prisma.pea_employees.findUnique({ where: { id: BigInt(employeeId) } });
  if (!employee) throw new AppError('Employee not found', 404);
  if (employee.employment_status !== 'active') {
    throw new AppError(`${employee.full_name} is marked as having left — no link can be issued.`, 409);
  }

  const token = jwt.sign({ sub: String(employee.id) }, signingKey(), {
    audience: AUDIENCE,
    expiresIn: `${LINK_DAYS}d`,
  });

  await prisma.pea_employee_audit.create({
    data: {
      employee_id: employee.id,
      field_name: '*',
      new_value: `Self-view link issued (shows: ${level}, valid ${LINK_DAYS} days).`,
      changed_by: actor,
      change_source: 'manual',
    },
  });

  logger.info(`Self-view link issued by ${actor} for ${employee.office_email} at level "${level}"`);

  return {
    url: `${config.frontendUrl.replace(/\/+$/, '')}/me/${token}`,
    level,
    expiresAt: new Date(Date.now() + LINK_DAYS * 86_400_000),
  };
}

/**
 * The public view behind a link. Every failure returns the same message, so
 * the endpoint reveals nothing about why a link was refused.
 * @param {string} token
 * @returns {Promise<object>}
 */
export async function getSelfView(token) {
  const refused = new AppError('This link is not valid or has expired. Ask HR for a new one.', 404);

  let claims;
  try {
    claims = jwt.verify(String(token || ''), signingKey(), { audience: AUDIENCE, algorithms: ['HS256'] });
  } catch {
    throw refused;
  }

  const level = await currentLevel();
  if (level === 'off') throw refused;

  const employee = await prisma.pea_employees.findUnique({
    where: { id: BigInt(claims.sub) },
    include: {
      cycles: {
        orderBy: { seq_no: 'asc' },
        include: level === 'full' ? { scores: { orderBy: { sort_order: 'asc' } } } : undefined,
      },
    },
  });

  if (!employee || employee.employment_status !== 'active') throw refused;

  return { ...shapeSelfView(employee, level), expiresAt: new Date(claims.exp * 1000) };
}
