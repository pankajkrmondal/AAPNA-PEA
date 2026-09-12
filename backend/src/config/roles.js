/**
 * roles.js — canonical roles for PEA.
 *
 * Deliberately smaller than the ATS role model. ATS has
 * superadmin/admin/recruiter/vendor scoped by company; PEA's actors are the HR
 * team plus read-only viewers. Reporting managers and project leaders are NOT
 * users — they act through a tokenised form link and never log in, which is
 * what removes the per-person file-ownership problem (plan Enhancement E1).
 *
 * Hierarchy:  admin > hr > viewer
 */

export const ROLES = Object.freeze({
  ADMIN: 'admin', // manage users and settings
  HR: 'hr', // manage employees, trigger and review evaluations
  VIEWER: 'viewer', // read-only reporting
});

/** Higher number = more privilege. Used for "can act on" checks. */
export const ROLE_RANK = Object.freeze({
  admin: 30,
  hr: 20,
  viewer: 10,
});

export const ALL_ROLES = Object.freeze(Object.values(ROLES));

/**
 * Normalize a role string (case-insensitive, trimmed, null-safe).
 * @param {string|null|undefined} role
 * @returns {string}
 */
export function normalizeRole(role) {
  return (role || '').trim().toLowerCase();
}

/**
 * True if the role is admin.
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function isAdmin(role) {
  return normalizeRole(role) === ROLES.ADMIN;
}

/**
 * True if the role may modify employees and evaluations (admin or hr).
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function canWrite(role) {
  return (ROLE_RANK[normalizeRole(role)] ?? 0) >= ROLE_RANK.hr;
}

/**
 * True if the requester's role strictly outranks the target's.
 * Equal ranks do not outrank each other.
 * @param {string|null|undefined} requesterRole
 * @param {string|null|undefined} targetRole
 * @returns {boolean}
 */
export function outranks(requesterRole, targetRole) {
  return (ROLE_RANK[normalizeRole(requesterRole)] ?? 0) > (ROLE_RANK[normalizeRole(targetRole)] ?? 0);
}
