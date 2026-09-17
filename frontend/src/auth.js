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
 */
export const MODULES = [
  { key: 'dashboard', path: '/', label: 'Overview', emoji: '📊', desc: 'What needs action today, and how evaluations are trending' },
  { key: 'evaluations', path: '/evaluations', label: 'Evaluations', emoji: '📋', desc: 'Every evaluation in one list — what is due, who it is waiting on, and what came back' },
  { key: 'employees', path: '/employees', label: 'Employees', emoji: '👥', desc: 'Search, update and manage employee probation records' },
  { key: 'new_joiners', path: '/new-joiners', label: 'New joiners', emoji: '🆕', desc: 'Review joiners and leavers found in Microsoft 365, and add anyone by hand' },
  { key: 'manager_portal', path: '/manager-portal', label: 'Link generation', emoji: '🔗', desc: 'Create evaluation, team and employee links to share' },
  { key: 'settings', path: '/settings', label: 'Settings', emoji: '⚙️', desc: 'Email wording, scheduling, access — and the sheet upload' },
];

/**
 * Modules reachable through another screen rather than their own sidebar entry.
 *
 * `analytics` is Overview → Trends; `import_sheet` and `email_templates` are
 * tabs inside Settings. Their access switches still apply — the tab is hidden
 * for a user whose switch is off — so moving them changed where they live, not
 * who can see them. Their routes are kept so existing bookmarks still work.
 */
export const NESTED_MODULES = [
  { key: 'analytics', path: '/analytics', label: 'Trends', within: 'Overview' },
  { key: 'import_sheet', path: '/import', label: 'Upload sheet', within: 'Settings' },
  { key: 'email_templates', path: '/email-templates', label: 'Email templates', within: 'Settings' },
];

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
  return !Array.isArray(user?.modules) || user.modules.includes(moduleKey);
}

/** Where a user lands: the first module they can open. */
export function homePath(user) {
  return MODULES.find((m) => canUse(user, m.key))?.path ?? '/no-access';
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
