/**
 * evaluationDisplay.js — how the redesign shows a rating, a status and a person.
 *
 * The board, the table, the evaluation profile, the employee journey and the
 * Dashboard all show the same things. The rules live here so a 2.57 is blue
 * and "Satisfied" on every one of them, and a status chip on the board is the
 * same colour as the pill on the profile.
 *
 * The server sends `band` and `bucket` already worked out
 * (evaluationBoard.service.js); these helpers exist for the places that only
 * have a number, and for the words and colours the server does not own.
 */
import { formatDate } from './formatDate.js';

/** The 1–5 scale, as the manager saw it. Mirrors backend config/ratingScale.js. */
export const RATING_WORDS = {
  5: 'Exceptional',
  4: 'Highly Satisfied',
  3: 'Satisfied',
  2: 'Dissatisfied',
  1: 'Highly Dissatisfied',
};

/**
 * The tone for a rating or an average: 1–2 red, 3 blue, 4–5 green — the legend
 * printed under the board's filters. An average is placed at its nearest point.
 * @param {number|null|undefined} value
 * @returns {'crit'|'info'|'ok'|'mute'}
 */
export function ratingTone(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 'mute';
  const point = Math.round(Number(value));
  if (point <= 2) return 'crit';
  if (point === 3) return 'info';
  return 'ok';
}

/** "Satisfied", "Highly Satisfied" … for a rating or an average. */
export function ratingWord(value) {
  if (value === null || value === undefined) return '';
  return RATING_WORDS[Math.min(5, Math.max(1, Math.round(Number(value))))] || '';
}

/** The tone for a confirmation decision. */
export function decisionTone(decision) {
  if (!decision) return 'mute';
  if (decision === 'Confirmed') return 'ok';
  if (decision === 'Not Confirmed') return 'crit';
  return 'ext';
}

/**
 * The status chips, in the design's order. `tone` feeds StatusPill; the chip
 * dot uses the same ink.
 */
export const BUCKETS = [
  { key: 'submitted', label: 'Submitted', pill: 'Submitted', tone: 'ok' },
  { key: 'waiting', label: 'Waiting', pill: 'Waiting for manager', tone: 'warn' },
  { key: 'opened', label: 'Opened', pill: 'Opened by manager', tone: 'info' },
  { key: 'scheduled', label: 'Scheduled', pill: 'Scheduled', tone: 'info' },
  { key: 'not_sent', label: 'Not sent', pill: 'Not sent yet', tone: 'crit' },
  { key: 'closed', label: 'Closed', pill: 'Closed', tone: 'mute' },
];

export const bucketMeta = (key) => BUCKETS.find((b) => b.key === key) || { key, label: key, pill: key, tone: 'mute' };

/**
 * Old Overview links used the work list's scope names. Map them onto the
 * board's so a bookmark or an old notification still opens the right list.
 */
export const LEGACY_SCOPE = {
  waiting: 'waiting',
  not_sent: 'not_sent',
  due_soon: 'scheduled',
  submitted: 'submitted',
  decisions: 'in_progress',
  all: 'all',
};

/** Up to two initials. "Amit Verma" → "AV". */
export function initials(name) {
  return String(name || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() || '')
    .join('') || '?';
}

/**
 * A stable avatar colour per person, so the same face is the same colour on
 * every screen. Six soft tones that read in both themes.
 */
const AVATAR_TONES = ['violet', 'rose', 'blue', 'amber', 'emerald', 'sky'];
export function avatarTone(name) {
  let h = 0;
  for (const ch of String(name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "22-Sep" — the board's compact date. A plain YYYY-MM-DD is never shifted by timezone. */
export function shortDate(value) {
  if (!value) return '—';
  const plain = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = plain ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}`;
}

/** "22-Sep · 10:05" — for the status timeline, where the hour matters. */
export function shortDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${shortDate(d)} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "22-Sep-2026" — re-exported so a page needs one import for dates. */
export { formatDate };

/** "2 days" / "1 day" / "today". */
export function daysLabel(n) {
  if (n === null || n === undefined) return '—';
  if (n <= 0) return 'today';
  return `${n} day${n === 1 ? '' : 's'}`;
}

/** "Evaluation 6 of 6 · final · Fresher" */
export function evaluationLine(r, { cohort = true } = {}) {
  const parts = [`Evaluation ${r.seqNo} of ${r.of}`];
  if (r.isExtension) parts.push('extension');
  else if (r.isFinal) parts.push('final');
  if (cohort) parts.push(r.cohort === 'experienced' ? 'Experienced' : 'Fresher');
  return parts.join(' · ');
}

/** "Submitted 22-Sep-2026 by Kavita Rao · 12 days after sending · 2 reminders" */
export function submittedLine(r) {
  const parts = [`Submitted ${formatDate(r.submittedAt)} by ${r.rmName || r.submittedBy || 'the manager'}`];
  if (r.daysAfterSending !== null && r.daysAfterSending !== undefined) {
    parts.push(r.daysAfterSending === 0 ? 'same day as sending' : `${daysLabel(r.daysAfterSending)} after sending`);
  }
  parts.push(r.reminderCount ? `${r.reminderCount} reminder${r.reminderCount === 1 ? '' : 's'}` : 'no reminders');
  return parts.join(' · ');
}

/** Two decimal places, always — 3 reads as "3.00" next to 2.57. */
export const avg = (v) => (v === null || v === undefined ? '—' : Number(v).toFixed(2));
