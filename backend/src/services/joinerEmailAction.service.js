/**
 * joinerEmailAction.service.js — what happens when HR presses Confirm or Not
 * confirm in the new joiner review email. Walkthrough (27-10-2026) W-09.
 *
 * The link and its rules are joinerEmailLink.service.js. This file reads the
 * joiner and does the work through the same functions the New joiners screen
 * uses — acceptCandidate() and dismissCandidate() — so a joiner confirmed from
 * the email is exactly what one confirmed in PEA would be.
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { todayIn } from '../utils/dateUtils.js';
import { titleWordRules } from './directory.service.js';
import { acceptCandidate, dismissCandidate, serialiseCandidate } from './joinerIntake.service.js';
import { verifyAction, fingerprint, emailConfirmBlocker, confirmValues } from './joinerEmailLink.service.js';

/** Who the change history names. reviewed_by is VARCHAR(255). */
const actorFor = (p) => `review email (${p.to || 'HR mailbox'})`.slice(0, 255);

/**
 * Check a link and read the joiner it is about.
 *
 * @param {string} token
 * @returns {Promise<{action: 'confirm'|'dismiss', joiner: object, values: object, blocker: string|null}>}
 * @throws {AppError} when the link is invalid or expired, the joiner is gone or
 *   already handled, or — for Confirm — the details changed since the email
 */
export async function loadAction(token) {
  const p = verifyAction(token);
  const candidate = await prisma.pea_joiner_candidates.findUnique({ where: { id: BigInt(p.cid) } });
  if (!candidate) throw new AppError('This joiner is no longer in the New joiners inbox.', 404);

  if (candidate.status !== 'pending') {
    const when = candidate.reviewed_at ? ` on ${candidate.reviewed_at.toISOString().slice(0, 10).split('-').reverse().join('-')}` : '';
    const who = candidate.reviewed_by ? ` by ${candidate.reviewed_by}` : '';
    throw new AppError(
      candidate.status === 'accepted'
        ? `${candidate.display_name || 'This joiner'} has already been confirmed${who}${when}. Nothing more to do.`
        : `${candidate.display_name || 'This joiner'} has already been removed from the inbox${who}${when}. Nothing more to do.`,
      409
    );
  }

  let words = {};
  try { words = await titleWordRules(); } catch { /* no suggestion, so Confirm is blocked below */ }
  const joiner = serialiseCandidate(candidate, words);

  // Confirm saves what the email showed, or nothing. Not confirm needs no detail.
  const changed = fingerprint(joiner) !== p.fp;
  const blocker = p.act === 'confirm'
    ? (changed
      ? 'The details changed after the email was sent (a newer Microsoft 365 check updated them)'
      : emailConfirmBlocker(joiner, todayIn(config.scheduler.timezone)))
    : null;

  return { action: p.act, joiner, values: confirmValues(joiner), blocker, payload: p };
}

/**
 * Do what the link says.
 * @param {string} token
 * @returns {Promise<{action: string, joiner: object, employee?: object}>}
 */
export async function performAction(token) {
  const { action, joiner, values, blocker, payload } = await loadAction(token);
  const actor = actorFor(payload);

  if (action === 'dismiss') {
    await dismissCandidate(joiner.id, 'Not confirmed from the review email', actor);
    return { action, joiner };
  }

  if (blocker) throw new AppError(`${blocker}. Open New joiners in PEA to confirm this joiner.`, 409);
  const employee = await acceptCandidate(joiner.id, values, actor);
  return { action, joiner, employee };
}
