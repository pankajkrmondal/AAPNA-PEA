/**
 * joinerEmailLink.service.js — the Confirm / Not confirm links in the new
 * joiner review email. Walkthrough (27-10-2026) W-09.
 *
 * Raginee: "What we need — just the email ID and the name of the person, and
 * on the right hand side a button of confirm or not confirm. That's it." The
 * email goes to one HR mailbox (hr2@aapnainfotech.com by default), which only
 * HR can open, so whoever can read that mailbox can act on it.
 *
 * ── How the link is kept safe ──────────────────────────────────────────────
 *
 *   · Signed with a key DERIVED from JWT_SECRET for this purpose only, so a link
 *     can never be replayed as a sign-in token, and a sign-in token can never
 *     be used here. Same approach as selfView.service.js.
 *   · Expires after LINK_HOURS.
 *   · Works once in practice: the joiner must still be pending, and confirming
 *     or dismissing them ends that.
 *   · Carries a fingerprint of the values the email showed. If a later scan
 *     changed any of them, Confirm refuses and sends HR to the portal — what
 *     gets saved is always what the reader saw.
 *   · Opening the link does nothing by itself: it shows a page with one button.
 *     Mail scanners that pre-open links therefore cannot confirm anyone.
 *
 * Nothing here touches the database, so the rules are unit-tested directly.
 */
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { buildSchedule } from './cycleGenerator.service.js';

export const AUDIENCE = 'pea-joiner-email-action';
/** Where the review email goes, with the buttons — the pea_settings default. */
export const JOINER_REVIEW_TO_DEFAULT = 'hr2@aapnainfotech.com';
/** How long a Confirm / Not confirm link works. */
export const LINK_HOURS = 72;
export const ACTIONS = Object.freeze(['confirm', 'dismiss']);

const signingKey = () => crypto.createHmac('sha256', config.jwt.secret).update(AUDIENCE).digest();

/**
 * The values Confirm would save, from a serialised candidate
 * (joinerIntake.service.js serialiseCandidate). Pure.
 * @param {object} row
 * @returns {{doj: string|null, is_experienced: boolean|null, rm_name: string|null, rm_email: string|null, pl_email: string|null}}
 */
export function confirmValues(row) {
  const track = row.suggested_is_experienced;
  return {
    doj: row.suggested_doj || null,
    is_experienced: track === true || track === false ? track : null,
    rm_name: row.suggested_rm_name || null,
    rm_email: row.suggested_rm_email || null,
    pl_email: row.suggested_pl_email || null,
  };
}

/**
 * A short hash of the values the email showed. Pure.
 * @param {object} row - a serialised candidate
 * @returns {string}
 */
export function fingerprint(row) {
  const v = confirmValues(row);
  return crypto
    .createHash('sha256')
    .update([v.doj, v.is_experienced, v.rm_email, v.pl_email].map((x) => String(x ?? '')).join('|').toLowerCase())
    .digest('hex')
    .slice(0, 16);
}

/**
 * Why this joiner cannot be confirmed straight from the email, or null when it
 * can. Pure. Anything that needs a person's choice goes to the portal instead.
 *
 * @param {object} row - a serialised candidate
 * @param {Date} today - UTC midnight in PEA's time zone
 * @returns {string|null}
 */
export function emailConfirmBlocker(row, today) {
  const v = confirmValues(row);
  if (!v.doj) return 'The account creation date is missing';
  if (v.is_experienced === null) return 'Fresher or experienced is not known';
  // The name as well as the email: the New joiners form requires both.
  if (!v.rm_email || !v.rm_name) return 'The reporting manager is missing';
  if (!v.pl_email) return 'The project leader is missing';

  // B5 / U9 — someone confirmed long after their account was created has
  // evaluations already past due, and what happens to those is HR's choice,
  // made on the screen. The email cannot ask it.
  const pastDue = buildSchedule({ doj: v.doj, is_experienced: v.is_experienced })
    .filter((c) => c.due_date <= today).length;
  if (pastDue) {
    return `${pastDue} evaluation${pastDue === 1 ? ' is' : 's are'} already past due — choose what to do with ${pastDue === 1 ? 'it' : 'them'} in PEA`;
  }
  return null;
}

/**
 * One signed link token.
 * @param {{candidateId: string|bigint, action: 'confirm'|'dismiss', fp: string, to: string}} p
 * @returns {string}
 */
export function signAction({ candidateId, action, fp, to }) {
  if (!ACTIONS.includes(action)) throw new Error(`Unknown joiner action "${action}"`);
  return jwt.sign(
    { cid: String(candidateId), act: action, fp, to: String(to || '') },
    signingKey(),
    { expiresIn: `${LINK_HOURS}h`, audience: AUDIENCE }
  );
}

/**
 * Check a link token.
 * @param {string} token
 * @returns {{cid: string, act: 'confirm'|'dismiss', fp: string, to: string}}
 * @throws {AppError} 410 when expired, 400 when not a valid link
 */
export function verifyAction(token) {
  try {
    const p = jwt.verify(String(token || ''), signingKey(), { audience: AUDIENCE });
    if (!ACTIONS.includes(p.act) || !/^\d+$/.test(String(p.cid))) throw new Error('bad payload');
    return p;
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      throw new AppError(`This link has expired — links in the review email work for ${LINK_HOURS} hours. Open New joiners in PEA instead.`, 410);
    }
    throw new AppError('This link is not valid. Open New joiners in PEA instead.', 400);
  }
}

/**
 * The action links for one joiner row in the email. Pure apart from signing.
 *
 * Not confirm is always offered — removing someone who is not a new joiner
 * needs no other detail. Confirm is offered only when nothing needs a choice.
 *
 * @param {object} row - a serialised candidate
 * @param {{today: Date, to: string, base: string}} ctx
 * @returns {{confirmUrl: string|null, dismissUrl: string, blocker: string|null}}
 */
export function actionLinks(row, { today, to, base }) {
  const root = `${String(base || '').replace(/\/+$/, '')}/api/joiner-action/`;
  const fp = fingerprint(row);
  const blocker = emailConfirmBlocker(row, today);
  return {
    confirmUrl: blocker ? null : root + signAction({ candidateId: row.id, action: 'confirm', fp, to }),
    dismissUrl: root + signAction({ candidateId: row.id, action: 'dismiss', fp, to }),
    blocker,
  };
}
