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
  { key: 'employees', label: 'Employees' },
  { key: 'new_joiners', label: 'New joiners' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'import_sheet', label: 'Import sheet' },
  { key: 'manager_portal', label: 'Manager portal' },
  { key: 'email_templates', label: 'Email templates' },
  { key: 'settings', label: 'Settings' },
]);

export const MODULE_KEYS = Object.freeze(MODULES.map((m) => m.key));

/**
 * @param {string} key
 * @returns {boolean}
 */
export const isModuleKey = (key) => MODULE_KEYS.includes(key);
