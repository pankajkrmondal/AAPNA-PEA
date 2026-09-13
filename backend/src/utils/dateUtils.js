/**
 * dateUtils.js — all date arithmetic for PEA.
 *
 * Everything here works on CALENDAR DAYS with no time component and no
 * timezone, because every date PEA cares about (DOJ, due dates, evaluation
 * periods) is a calendar date, not an instant.
 *
 * This matters more than it sounds. Two real defects come from getting it wrong:
 *
 *   1. The Power Automate original ran on an 11:00 IST schedule but computed
 *      `dateDifference(DOJ, utcNow())` in UTC. For 5.5 hours a day the UTC date
 *      and the IST date disagree, so an evaluation due "today" could be missed
 *      or fired twice. Plan R10.
 *
 *   2. Excel stores 2 Jan 2023 as a serial number, and reading it through a
 *      Date object in a UTC-behind timezone yields 2023-01-01T18:29:50Z — which
 *      is 1 January. Every DOJ, and therefore every evaluation date, shifts by
 *      a day. Observed in the real workbook; see excelImport.service.js.
 *
 * The defence is to never let a Date's time component or timezone participate:
 * dates are handled as {y, m, d} and formatted as 'YYYY-MM-DD'.
 */

/** Day-of-week constants for readability. */
const SATURDAY = 6;
const SUNDAY = 0;

/**
 * Build a timezone-neutral Date at UTC midnight.
 *
 * Using UTC midnight consistently means `getUTCDay()`, date arithmetic and
 * ISO formatting all agree regardless of the server's local timezone — so the
 * same DOJ produces the same schedule whether the app runs in Kolkata, on a
 * UTC container, or on a developer laptop in another timezone.
 *
 * @param {number} y - full year
 * @param {number} m - month, 1-12 (not 0-based)
 * @param {number} d - day of month
 * @returns {Date}
 */
export function utcDate(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Parse 'YYYY-MM-DD' (or a Date) into a UTC-midnight Date.
 * @param {string|Date} value
 * @returns {Date|null} null if unparseable
 */
export function toUtcMidnight(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    // Take the UTC calendar parts; a Date coming out of Prisma for a DATE
    // column is already UTC midnight.
    return utcDate(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || '').trim());
  if (!m) return null;
  return utcDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

/**
 * Format a Date as 'YYYY-MM-DD' using its UTC parts.
 * @param {Date} date
 * @returns {string}
 */
export function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

/**
 * Add whole days to a date.
 * @param {Date} date
 * @param {number} days
 * @returns {Date} a new Date; the input is not mutated
 */
export function addDays(date, days) {
  const out = new Date(date.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Add whole calendar months, clamping to the last day of a shorter month.
 *
 * 31 Aug + 6 months is 28/29 Feb, not 3 March. JavaScript's setUTCMonth rolls
 * the overflow forward into the next month, which would push a confirmation
 * deadline past the date HR actually expects.
 *
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
export function addMonths(date, months) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(targetYear, targetMonth, Math.min(date.getUTCDate(), lastDay)));
}

/**
 * Whole days between two dates (b - a). Both are treated as calendar dates.
 * @param {Date} a
 * @param {Date} b
 * @returns {number}
 */
export function daysBetween(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/**
 * True if the date falls on a Saturday or Sunday.
 * @param {Date} date
 * @returns {boolean}
 */
export function isWeekend(date) {
  const day = date.getUTCDay();
  return day === SATURDAY || day === SUNDAY;
}

/**
 * Move a date forward to the next weekday if it lands on a weekend.
 *
 * The Power Automate flows handled weekends with `Delay` actions inside the
 * run. Doing it at generation time instead means the stored due_date is
 * already the day the email will actually go out, so the schedule is
 * inspectable in the database rather than only knowable at runtime.
 *
 * Forward, never backward: moving an evaluation earlier would mean asking a
 * manager to rate a period that has not finished.
 *
 * @param {Date} date
 * @returns {Date}
 */
export function shiftOffWeekend(date) {
  let out = date;
  while (isWeekend(out)) out = addDays(out, 1);
  return out;
}

/**
 * Today's calendar date in a given IANA timezone, as a UTC-midnight Date.
 *
 * This is what the daily sweep compares due_date against. Deriving it from the
 * timezone rather than the server clock is what stops the UTC/IST boundary from
 * shifting which employees are considered due.
 *
 * @param {string} [timeZone='Asia/Kolkata']
 * @returns {Date}
 */
export function todayIn(timeZone = 'Asia/Kolkata') {
  // en-CA formats as YYYY-MM-DD, which parses unambiguously.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return toUtcMidnight(ymd);
}

/**
 * Format a date for display in emails, e.g. '02-Jan-2023'.
 * Matches the `dd-MMM-yyyy` format the original flow used in its email bodies,
 * so managers see the same thing they are used to.
 * @param {Date} date
 * @returns {string}
 */
export function formatDisplay(date) {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${d}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}
