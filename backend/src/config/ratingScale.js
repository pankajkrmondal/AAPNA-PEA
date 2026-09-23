/**
 * ratingScale.js — the 1-5 Likert scale managers rate against.
 *
 * Recovered verbatim from the "Rating Structure" table inside the evaluation
 * email body in `PEA - Sending Evaluation Form Link Flow V2`. Managers have been
 * shown exactly this table for years, so the form must offer the same wording —
 * a manager who reads "Satisfied (Sometimes Exceeds Expectation)" in the email
 * and then sees different labels on the form will not rate consistently.
 *
 * ⚠️ KNOWN DISCREPANCY, PLAN §2.3.
 * The stored MS Forms answers use a DIFFERENT set of labels — "3- Satisfactory
 * to above average", "2- Satisfactory/ Neutral". The email table and the form
 * dropdown drifted apart at some point. We use the email version because that
 * is what the manager is looking at when they decide their score, but HR must
 * confirm. Only the number is ever stored, so historical data is unaffected
 * either way and switching later is a change to this file alone.
 */

export const RATING_SCALE = Object.freeze([
  { value: 5, label: 'Exceptional', detail: 'Sets New Standards of Performance', percent: '100%' },
  { value: 4, label: 'Highly Satisfied', detail: 'Always Exceeds Expectations', percent: '80%' },
  { value: 3, label: 'Satisfied', detail: 'Sometimes Exceeds Expectation', percent: '60%' },
  { value: 2, label: 'Dissatisfied', detail: 'Sometimes Meets Expectations', percent: '40%' },
  { value: 1, label: 'Highly Dissatisfied', detail: 'Needs Development', percent: '20%' },
]);

/**
 * A rating at or below this is a low rating: the HR email paints it red, the
 * board marks the row, and it is what "3 questions rated 2 or lower" counts on
 * the board and the Dashboard.
 *
 * It says nothing about comments. A comment is required on every question,
 * whatever the rating (HR, 23-Sep) — that rule has no threshold to hold.
 */
export const LOW_RATING_AT_OR_BELOW = 2;

/** The longest reason for a decision the form accepts. The DB CHECK agrees. */
export const REASON_MAX = 2000;

/** Confirmation options, offered only on an employee's final cycle. */
export const CONFIRMATION_OPTIONS = Object.freeze([
  {
    value: 'Confirmed',
    label: 'Confirm',
    help: 'Make this person permanent. No further evaluations.',
  },
  {
    value: 'Not Confirmed',
    label: 'Do not confirm',
    help: 'End the probation without confirming. No further evaluations.',
  },
  {
    value: 'Extend for 1 month',
    label: 'Extend by 1 month',
    help: 'One more evaluation, one month from now.',
  },
  {
    value: 'Extend for 2 months',
    label: 'Extend by 2 months',
    help: 'Two more evaluations, one and two months from now.',
  },
]);

/**
 * True if the value is a rating this scale accepts.
 * Half-points (3.5, 2.8) appear throughout the historical sheet, so they are
 * accepted on input — the DB CHECK allows anything from 1 to 5.
 * @param {*} value
 * @returns {boolean}
 */
export function isValidRating(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 && n <= 5;
}
