/**
 * auth.js — who is signed in, what their role allows, and which modules they
 * can open.
 *
 * Mirrors backend/src/config/roles.js and config/modules.js. The API enforces
 * every rule here on its own; this copy exists so nobody is shown a screen or
 * a button that would only refuse them.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import api, { unwrap, TOKEN_KEY, USER_KEY } from './api.js';

export const ROLE_RANK = { superadmin: 40, admin: 30, hr: 20 };
export const ROLE_LABEL = { superadmin: 'Super Admin', admin: 'Admin', hr: 'HR' };

const norm = (role) => (role || '').trim().toLowerCase();
const rankOf = (role) => ROLE_RANK[norm(role)] ?? 0;

export const isSuperadmin = (role) => norm(role) === 'superadmin';
/** Admin or super admin: opens the Admin Portal, never restricted by modules. */
export const isAdminTier = (role) => rankOf(role) >= ROLE_RANK.admin;
export const outranks = (requesterRole, targetRole) => rankOf(requesterRole) > rankOf(targetRole);

/**
 * The sidebar, in order. Each entry is one switch in Admin Portal → Module
 * Access; `key` must match backend/src/config/modules.js.
 *
 * ── Headers (28-10-2026) ────────────────────────────────────────────────────
 *
 * The HRD head could not tell from a screen's heading what it was for: the
 * wording was the build team's ("Microsoft 365 check", "Reconciliation report",
 * "What every manager said"). Every screen's words live here now, in HR's
 * language, so they can be read and changed in one place:
 *
 *   label  the sidebar entry and the top bar
 *   title  the heading on the screen
 *   intro  one or two plain sentences under it: what this is, what to do here
 *   desc   the short line in Admin Portal → Module Access
 *
 * components/PageHeader.jsx shows `title` and `intro`. Renamed in the menu:
 * "Link generation" → "Evaluation links" and, inside Settings, "Upload sheet"
 * → "Upload Excel". Every path is unchanged, so bookmarks still work. The
 * entries as they were:
 *
 *   { key: 'dashboard', …, label: 'Dashboard', desc: 'What needs action today, and how evaluations are trending' },
 *   { key: 'evaluations', …, label: 'Evaluations', desc: 'Every evaluation in one list — what is due, who it is waiting on, and what came back' },
 *   { key: 'employees', …, label: 'Commandos', desc: 'Search, update and manage Commando probation records' },
 *   { key: 'new_joiners', …, label: 'New joiners', desc: 'Review joiners and leavers found in Microsoft 365, and add anyone by hand' },
 *   { key: 'manager_portal', …, label: 'Link generation', desc: 'Create evaluation, team and Commando links to share' },
 *   { key: 'settings', …, label: 'Settings', desc: 'Email recipients, scheduling, the upload sheet and email templates' },
 */
export const MODULES = [
  {
    key: 'dashboard', path: '/', label: 'Dashboard', emoji: '📊',
    desc: 'What needs attention today, and how ratings are changing',
    title: 'Probation at a glance',
    intro: 'Who is on probation, which evaluations are waiting on managers, and what needs your attention today.',
  },
  {
    key: 'evaluations', path: '/evaluations', label: 'Evaluations', emoji: '📋',
    desc: 'Every evaluation — submitted, with the manager, or coming up',
    title: 'All evaluations',
    intro: 'Every probation evaluation in one place — which are submitted, which are still with the manager, and what each manager rated and wrote.',
  },
  {
    key: 'employees', path: '/employees', label: 'Commandos', emoji: '👥',
    desc: 'Everyone on probation, with their evaluations, ratings and decision',
    title: 'Commandos',
    intro: 'Everyone whose probation PEA tracks. Open a name to see their evaluations, ratings and decision.',
  },
  {
    key: 'new_joiners', path: '/new-joiners', label: 'New joiners', emoji: '🆕',
    desc: 'Confirm people with a new AAPNA email account, to start their probation',
    title: 'New joiners',
    intro: 'People who recently got an AAPNA email account. Check their details and confirm them to start their probation evaluations. People who may have left are listed further down.',
  },
  {
    key: 'manager_portal', path: '/manager-portal', label: 'Evaluation links', emoji: '🔗',
    desc: 'Get a link for a manager or a Commando, to copy or email',
    title: 'Evaluation links',
    intro: 'Get a link for someone who needs one — a manager’s evaluation form, a manager’s view of their team, or a Commando’s own progress page. Copy it or email it. Nobody needs to log in to open it.',
  },
  // Walkthrough (27-10-2026) W-12 — Raginee: "Can we add upload sheet and
  // email templates into settings part?" Both are Settings tabs now (see
  // NESTED_MODULES). They sat here, after Link generation:
  // { key: 'import_sheet', path: '/import', label: 'Upload sheet', emoji: '📤', desc: 'Load the master Excel workbook, or add anyone the Microsoft 365 check could not pick up' },
  // { key: 'email_templates', path: '/email-templates', label: 'Email templates', emoji: '✉️', desc: 'The subject and wording of every email PEA sends' },
  {
    key: 'settings', path: '/settings', label: 'Settings', emoji: '⚙️',
    desc: 'Who gets emails and when, new joiner rules, the Excel upload and email wording',
    title: 'Settings',
    intro: 'Who receives PEA’s emails and when, how new joiners are handled, the Excel upload and the wording of each email. Changes apply straight away.',
  },
];

/**
 * Modules reachable through another screen rather than their own sidebar entry.
 *
 * `analytics` is Dashboard → Trends. Its access switch still applies — the tab
 * is hidden for a user whose switch is off — so nesting it changed where it
 * lives, not who can see it. Its route is kept so existing bookmarks work.
 *
 * `email_templates` and `import_sheet` both used to be here. Both are back in
 * MODULES with their own sidebar entry, for the same reason: each is a screen
 * HR works in rather than a value they adjust, and burying one in a settings
 * tab made it hard to find.
 *
 * Walkthrough (27-10-2026) W-12 — and back inside Settings again, as tabs, at
 * the HR lead's request. Each keeps its own access switch: the tab shows only
 * for a user whose switch is on, and Settings appears in the sidebar for
 * anyone with any one of the three.
 */
export const NESTED_MODULES = [
  {
    key: 'analytics', path: '/analytics', label: 'Trends', within: 'Dashboard',
    title: 'Trends',
    intro: 'How each Commando’s ratings change from one evaluation to the next.',
  },
  // Headers (28-10-2026) — label was 'Upload sheet'.
  {
    key: 'import_sheet', path: '/import', label: 'Upload Excel', within: 'Settings', tab: 'upload-sheet',
    title: 'Upload Excel',
    intro: 'Add Commandos and their past evaluations from Excel. Download the template, fill it in, check it, then import. Nothing is saved until the last step.',
  },
  {
    key: 'email_templates', path: '/email-templates', label: 'Email templates', within: 'Settings', tab: 'email-templates',
    title: 'Email templates',
    intro: 'The wording of every email PEA sends. The AAPNA logo, header and footer are added automatically.',
  },
];

/**
 * Headers (28-10-2026) — screens that are not a module of their own, in the
 * same shape. The Email log is admin-only, inside Evaluations; its old heading
 * was "Email log" / "Every email PEA has sent — to whom, about whom, and
 * whether it went".
 */
export const PAGES = {
  email_log: {
    title: 'Sent emails',
    intro: 'Every email PEA has sent: who it went to, who it was about, and whether it was delivered. For admins.',
  },
};

/**
 * A screen's heading and description.
 * @param {string} key - a MODULES / NESTED_MODULES key, or a PAGES key
 * @returns {{title: string, intro: string}}
 */
export function pageCopy(key) {
  const m = [...MODULES, ...NESTED_MODULES].find((x) => x.key === key) || PAGES[key] || {};
  return { title: m.title || m.label || '', intro: m.intro || '' };
}

/** W-12 — the access switches that each open part of the Settings screen. */
export const SETTINGS_MODULES = ['settings', 'import_sheet', 'email_templates'];

/**
 * W-12 — what opens a sidebar entry: its own switch, or for Settings any of
 * the three behind its tabs.
 * @param {string} key - a MODULES key
 * @returns {string|string[]}
 */
export const gateOf = (key) => (key === 'settings' ? SETTINGS_MODULES : key);

/** @returns {object} the signed-in user as last stored, or {} */
export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || '{}');
  } catch {
    return {};
  }
}

export function setUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

/**
 * A user stored before Module Access shipped has no `modules` list; treat that
 * as everything, exactly as the API does for a user with no rows.
 */
export function canUse(user, moduleKey) {
  if (isAdminTier(user?.role)) return true;
  // W-12 — a list means "any of these": Settings opens for anyone who may use
  // one of its tabs.
  if (Array.isArray(moduleKey)) return moduleKey.some((k) => canUse(user, k));
  return !Array.isArray(user?.modules) || user.modules.includes(moduleKey);
}

/** Where a user lands: the first module they can open. */
export function homePath(user) {
  // W-12 — was canUse(user, m.key).
  return MODULES.find((m) => canUse(user, gateOf(m.key)))?.path ?? '/no-access';
}

export const initialsOf = (user) =>
  ((user?.first_name?.[0] || user?.username?.[0] || '?') + (user?.last_name?.[0] || '')).toUpperCase();

/**
 * The signed-in account, kept fresh from /auth/me so a role or module change
 * made in the Admin Portal reaches a browser that is already open. The API
 * applies such changes immediately either way; this only keeps the sidebar
 * honest.
 */
export function useCurrentUser() {
  const { data } = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get('/auth/me').then(unwrap),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (data) setUser(data);
  }, [data]);

  return data || getUser();
}

/**
 * End the session here and on the server.
 * @param {import('@tanstack/react-query').QueryClient} [queryClient] - cleared
 *   so the next person to sign in on this browser never sees cached data
 */
export async function signOut(queryClient) {
  try {
    await api.post('/auth/logout');
  } catch {
    /* signing out locally is what matters */
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  queryClient?.clear();
}
