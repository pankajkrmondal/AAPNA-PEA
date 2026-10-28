/**
 * modules.js — the sidebar modules an admin can switch on or off per HR user.
 *
 * PEA's version of the ATS "Module Access" tab. The keys match the sidebar in
 * frontend/src/auth.js, and the routes behind each screen check the same key
 * with requireModule() — so hiding a menu item and refusing its API are one
 * decision, not two.
 *
 * Admins and super admins are never restricted. Users is not a module: it
 * moved into the Admin Portal, which is admin-tier by role.
 */
export const MODULES = Object.freeze([
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'evaluations', label: 'Evaluations' },
  { key: 'employees', label: 'Commandos' },
  { key: 'new_joiners', label: 'New joiners' },
  { key: 'analytics', label: 'Trends' },
  // Headers (28-10-2026) — renamed to match the screen; they were 'Upload
  // sheet' and 'Link generation'. The keys are unchanged.
  { key: 'import_sheet', label: 'Upload Excel' },
  { key: 'manager_portal', label: 'Evaluation links' },
  { key: 'email_templates', label: 'Email templates' },
  { key: 'settings', label: 'Settings' },
]);

// `evaluations` is new in this release and needs no seeding: modulePermissions
// treats a missing row as ON, so it starts available to everyone and only an
// explicit switch-off restricts it — the screen proposal's "nobody loses
// access" rule, already satisfied by the existing design.

export const MODULE_KEYS = Object.freeze(MODULES.map((m) => m.key));

/**
 * @param {string} key
 * @returns {boolean}
 */
export const isModuleKey = (key) => MODULE_KEYS.includes(key);
