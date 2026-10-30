/**
 * returnTo.js — back to the address someone opened, once they have signed in.
 *
 * 30-10-2026 — the review email's Confirm / Not confirm open
 * /new-joiners?joiner=…&action=…; signed out, that address has to survive the
 * login page, or the email would only ever open the dashboard. The login page
 * carries it as ?next=. Plan: docs/PEA-Joiner-Email-Actions-Behind-Login-Plan-2026-10-30.md.
 *
 * No imports, so api.js can use it without importing auth.js back.
 */
const LOGIN = '/login';

/**
 * `next` when it is a path inside PEA, otherwise null — so the login page can
 * never be used to send someone to another site after they sign in.
 * @param {unknown} next
 * @returns {string|null}
 */
export function safeNext(next) {
  if (typeof next !== 'string' || next.length > 2000) return null;
  // "//host" and "/\host" are both another site to a browser.
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  if ([...next].some((ch) => ch.charCodeAt(0) < 32)) return null;
  if (next === LOGIN || next.startsWith(`${LOGIN}?`) || next.startsWith(`${LOGIN}/`)) return null;
  return next;
}

/**
 * The login page, remembering where to come back to.
 * @param {string} path - pathname + search of the page that needs a sign-in
 * @returns {string}
 */
export function loginPathFor(path) {
  const next = safeNext(path);
  return next && next !== '/' ? `${LOGIN}?next=${encodeURIComponent(next)}` : LOGIN;
}
