/**
 * ratings.js — the two averages PEA works out, in one place.
 *
 *   · averageOf()       one evaluation: the mean of its question ratings.
 *   · commandoAverage() one Commando: the mean of their own submitted
 *                       evaluations, each counting once.
 *
 * Commando average (28-10-2026) — "THIS IS per COMMANDO AVG RATING ONLY". It is
 * never taken across different people: the walkthrough (W-04) removed exactly
 * that, because fresher and experienced are rated on different tracks.
 *
 * Lives in utils, not in a service, so the Commando list, the evaluation page,
 * the shared report and the Excel import can all use it without importing one
 * another. Pure — nothing here touches the database.
 */

/**
 * The 2-decimal mean of some ratings, or null when there are none. The same
 * arithmetic recordSubmission() always used: (sum / n).toFixed(2).
 * @param {Array<number|string|null|undefined>} ratings
 * @returns {number|null}
 */
export function averageOf(ratings) {
  const values = (ratings || [])
    .filter((r) => r !== null && r !== undefined && r !== '')
    .map(Number)
    .filter((r) => !Number.isNaN(r));
  if (!values.length) return null;
  return Number((values.reduce((s, r) => s + r, 0) / values.length).toFixed(2));
}

/** The seven questions both tracks are rated on (2026-09-12-pea-core.sql). */
export const QUESTION_COUNT = 7;

/**
 * How much of a submitted evaluation's rating PEA has — Excel import
 * (28-10-2026). A manager's form always sends every question, so anything
 * short of 'full' is an imported evaluation whose sheet lacked ratings.
 *
 *   'full'          every question rated
 *   'partial'       some questions rated; the average is of those
 *   'average_only'  an overall number and no question ratings
 *   'none'          submitted, no rating at all
 *   null            not submitted
 *
 * @param {string} status
 * @param {number|string|null} avg - the evaluation's average
 * @param {number} rated - how many question ratings it has
 * @returns {'full'|'partial'|'average_only'|'none'|null}
 */
export function ratingCoverage(status, avg, rated) {
  if (status !== 'completed') return null;
  if (avg === null || avg === undefined) return 'none';
  if (!rated) return 'average_only';
  return rated < QUESTION_COUNT ? 'partial' : 'full';
}

/**
 * One Commando's overall average: their completed evaluations that carry an
 * average, each counting once. An imported evaluation with no rating is left
 * out, and `unrated` says how many were, so the screen can say so.
 *
 * @param {Array<{status: string, avg_rating: any}>} cycles - this Commando's own
 * @returns {{average: number|null, count: number, unrated: number}}
 */
export function commandoAverage(cycles) {
  const done = (cycles || []).filter((c) => c.status === 'completed');
  const rated = done.filter((c) => c.avg_rating !== null && c.avg_rating !== undefined);
  return {
    average: averageOf(rated.map((c) => c.avg_rating)),
    count: rated.length,
    unrated: done.length - rated.length,
  };
}

/**
 * A Commando's overall average in words, for the shared report's email and
 * spreadsheet: "3.57 / 5 from 3 evaluations".
 * @param {{average: number|null, count: number, unrated?: number}|undefined} overall
 * @returns {string}
 */
export function commandoAverageText(overall) {
  if (!overall || overall.average === null) return 'No rated evaluation yet';
  return `${overall.average.toFixed(2)} / 5 from ${overall.count} evaluation${overall.count === 1 ? '' : 's'}`
    + (overall.unrated ? ` (${overall.unrated} imported without a rating, not counted)` : '');
}
