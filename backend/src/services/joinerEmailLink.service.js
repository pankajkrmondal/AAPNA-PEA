/**
 * joinerEmailLink.service.js — the Confirm / Not confirm links in the new
 * joiner review email. Walkthrough (27-10-2026) W-09.
 *
 * Raginee: "What we need — just the email ID and the name of the person, and
 * on the right hand side a button of confirm or not confirm. That's it." The
 * email goes to one HR mailbox (hr2@aapnainfotech.com by default).
 *
 * ── Behind sign-in (30-10-2026) ────────────────────────────────────────────
 *
 * Pankaj: the buttons opened a public page that needed no sign-in, so anyone
 * holding the email could act, and the history named the mailbox instead of
 * the person. Each button now opens the New joiners screen itself:
 *
 *   /new-joiners?joiner=<id>&action=confirm|dismiss&via=email
 *
 * PEA asks for sign-in first when needed, then opens the Confirm dialog or the
 * "Remove from the inbox?" prompt for that joiner. The action goes through the
 * signed-in API, so the person who pressed the button is recorded.
 *
 * The link holds no secret — the id opens nothing without a sign-in — so it is
 * no longer signed, and needs no fingerprint: HR saves what the dialog shows,
 * having seen it. Plan: docs/PEA-Joiner-Email-Actions-Behind-Login-Plan-2026-10-30.md.
 *
 * Until then each link was a signed token for /api/joiner-action/:token. Those
 * already sent are still read (verifyAction) so they can be redirected to the
 * new address; remove that with the redirect route.
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
/** How long an old signed link lasted — only to read those already sent. */
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
 * What HR will have to fill in or choose in the Confirm dialog, in one line, or
 * null when the suggestions are complete. Pure.
 *
 * 30-10-2026 — this was emailConfirmBlocker(), and a joiner with a blocker got
 * no Confirm button, only Not confirm and "review in PEA". The button opens the
 * dialog now, where the missing detail can be filled in, so every joiner gets
 * it; this only changes its label to Review and says what to do.
 *
 * @param {object} row - a serialised candidate
 * @param {Date} today - UTC midnight in PEA's time zone
 * @returns {string|null}
 */
export function emailReviewHint(row, today) {
  const v = confirmValues(row);
  if (!v.doj) return 'The account creation date is missing — enter the date after pressing Review';
  if (v.is_experienced === null) return 'Fresher or experienced is not known — choose it after pressing Review';
  // The name as well as the email: the New joiners form requires both.
  if (!v.rm_email || !v.rm_name) return 'The reporting manager is missing — add them after pressing Review';
  if (!v.pl_email) return 'The project leader is missing — add them after pressing Review';

  // B5 / U9 — someone confirmed long after their account was created has
  // evaluations already past due; the dialog asks what happens to those.
  const pastDue = buildSchedule({ doj: v.doj, is_experienced: v.is_experienced })
    .filter((c) => c.due_date <= today).length;
  if (pastDue) {
    return `${pastDue} evaluation${pastDue === 1 ? ' is' : 's are'} already past due — choose what to do with ${pastDue === 1 ? 'it' : 'them'} after pressing Review`;
  }
  return null;
}

/**
 * The New joiners screen, opened on one joiner. Pure.
 * @param {string} base - config.frontendUrl; blank gives a path on this host
 * @param {string|bigint} candidateId
 * @param {'confirm'|'dismiss'} action
 * @returns {string}
 */
export function joinerLink(base, candidateId, action) {
  const query = new URLSearchParams({ joiner: String(candidateId), action, via: 'email' });
  return `${String(base || '').replace(/\/+$/, '')}/new-joiners?${query}`;
}

/**
 * Read an old signed link (sent before 30-10-2026), only to redirect it.
 * @param {string} token
 * @returns {{cid: string, act: 'confirm'|'dismiss'}}
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
 * The buttons for one joiner row in the email. Pure.
 *
 * Every joiner gets both (decision D-1, 30-10-2026): Confirm — labelled Review
 * when `hint` says something is missing — and Not confirm.
 *
 * @param {object} row - a serialised candidate
 * @param {{today: Date, base: string}} ctx
 * @returns {{confirmUrl: string, dismissUrl: string, hint: string|null}}
 */
export function actionLinks(row, { today, base }) {
  return {
    confirmUrl: joinerLink(base, row.id, 'confirm'),
    dismissUrl: joinerLink(base, row.id, 'dismiss'),
    hint: emailReviewHint(row, today),
  };
}
