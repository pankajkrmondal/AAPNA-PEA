/**
 * roles.js — canonical roles for PEA.
 *
 * The same ladder as the ATS Admin Portal, one rung shorter. ATS runs
 * superadmin > admin > recruiter > vendor; PEA's staff are the HR team, so PEA
 * runs superadmin > admin > hr. Reporting managers and project leaders are
 * still NOT users — they act through a tokenised form link and never log in,
 * which is what removes the per-person file-ownership problem (plan
 * Enhancement E1).
 *
 *   superadmin  everything, including deleting accounts and managing other
 *               super admins
 *   admin       accounts below them, module access, settings, final import
 *   hr          day-to-day work, limited to the modules switched on for them
 *
 * `viewer` was retired with the Admin Portal (13 Sep): its accounts became hr,
 * and switching modules off per person replaces a read-only role. See
 * prisma/ddl/2026-09-13b-pea-admin-portal.sql.
 */

export const ROLES = Object.freeze({
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  HR: 'hr',
});

/** Higher number = more privilege. Used for "can act on" checks. */
export const ROLE_RANK = Object.freeze({
  superadmin: 40,
  admin: 30,
  hr: 20,
});

export const ALL_ROLES = Object.freeze(Object.values(ROLES));

export const ROLE_LABEL = Object.freeze({
  superadmin: 'Super Admin',
  admin: 'Admin',
  hr: 'HR',
});

/**
 * Normalize a role string (case-insensitive, trimmed, null-safe).
 * @param {string|null|undefined} role
 * @returns {string}
 */
export function normalizeRole(role) {
  return (role || '').trim().toLowerCase();
}

const rankOf = (role) => ROLE_RANK[normalizeRole(role)] ?? 0;

/**
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function isSuperadmin(role) {
  return normalizeRole(role) === ROLES.SUPERADMIN;
}

/**
 * Admin or super admin — the roles that open the Admin Portal and are never
 * restricted by module access.
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function isAdminTier(role) {
  return rankOf(role) >= ROLE_RANK.admin;
}

/**
 * True if the role may modify employees and evaluations.
 * @param {string|null|undefined} role
 * @returns {boolean}
 */
export function canWrite(role) {
  return rankOf(role) >= ROLE_RANK.hr;
}

/**
 * True if the requester's role strictly outranks the target's.
 * Equal ranks do not outrank each other.
 * @param {string|null|undefined} requesterRole
 * @param {string|null|undefined} targetRole
 * @returns {boolean}
 */
export function outranks(requesterRole, targetRole) {
  return rankOf(requesterRole) > rankOf(targetRole);
}

/**
 * Roles a requester may hand out. Mirrors ATS: an admin can create admins and
 * HR; only a super admin can create another super admin.
 * @param {string|null|undefined} requesterRole
 * @returns {string[]}
 */
export function assignableRoles(requesterRole) {
  if (isSuperadmin(requesterRole)) return [...ALL_ROLES];
  if (isAdminTier(requesterRole)) return [ROLES.ADMIN, ROLES.HR];
  return [];
}
