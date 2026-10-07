/**
 * formatDate.js — one date format across every screen.
 *
 * PEA showed three: `2026-09-15` in tables, `15-Sep-2026` in date pickers, and
 * whatever the browser felt like in the manager portal. The last is the worst,
 * because 09/10/2026 means two different days either side of the Atlantic and
 * the reader cannot tell which they are looking at.
 *
 * H6 / U4 (HR, 29-09-2026): the one format is `15-09-2026` — dd-MM-yyyy, the
 * format HRD settled on. It replaces `15-Sep-2026` here and in every date
 * picker; the backend's formatDisplay() does the same for emails and the
 * manager's form. Dates sent to and from the API stay `YYYY-MM-DD`.
 */

/** The same format for an antd DatePicker / RangePicker `format` prop. */
export const DATE_FORMAT = 'DD-MM-YYYY';

/* H6 / U4 — only the dd-MMM-yyyy format used these; kept for reference.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
*/

/**
 * @param {string|Date|null|undefined} value - a Date, an ISO string, or a
 *   plain `YYYY-MM-DD`, which is read as a calendar date and NOT shifted by
 *   the reader's timezone — a date of joining is the same day in every office.
 * @param {string} [fallback='—']
 * @returns {string}
 */
export function formatDate(value, fallback = '—') {
  if (!value) return fallback;

  let y;
  let m;
  let d;

  const plain = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.exec(value);
  if (plain) {
    [y, m, d] = value.slice(0, 10).split('-').map(Number);
  } else {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    y = date.getFullYear();
    m = date.getMonth() + 1;
    d = date.getDate();
  }

  // H6 / U4 — was: return `${String(d).padStart(2, '0')}-${MONTHS[m - 1]}-${y}`;
  return `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;
}

/**
 * The same, with the time — for "last scan" and other moments where the hour
 * genuinely matters.
 * @param {string|Date|null|undefined} value
 * @param {string} [fallback='—']
 * @returns {string}
 */
export function formatDateTime(value, fallback = '—') {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${formatDate(date)} ${hh}:${mm}`;
}
