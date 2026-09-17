/**
 * formatDate.js — one date format across every screen.
 *
 * PEA showed three: `2026-09-15` in tables, `15-Sep-2026` in date pickers, and
 * whatever the browser felt like in the manager portal. The last is the worst,
 * because 09/10/2026 means two different days either side of the Atlantic and
 * the reader cannot tell which they are looking at.
 *
 * `15-Sep-2026` is the one HR already reads in the evaluation emails, and the
 * spelled-out month makes it unambiguous everywhere.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

  return `${String(d).padStart(2, '0')}-${MONTHS[m - 1]}-${y}`;
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
