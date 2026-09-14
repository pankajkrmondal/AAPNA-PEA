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
  { key: 'dashboard', path: '/', label: 'Dashboard', emoji: '📊', desc: 'Probation overview and what needs attention today' },
  { key: 'employees', path: '/employees', label: 'Employees', emoji: '👥', desc: 'Search, update and manage employee probation records' },
  { key: 'new_joiners', path: '/new-joiners', label: 'New joiners', emoji: '🆕', desc: 'Review joiners and leavers detected from Entra and ATS' },
  { key: 'analytics', path: '/analytics', label: 'Analytics', emoji: '📈', desc: 'Track evaluation outcomes and confirmation trends' },
  { key: 'import_sheet', path: '/import', label: 'Import sheet', emoji: '📤', desc: 'Preview and import the probation Excel sheet' },
  { key: 'manager_portal', path: '/manager-portal', label: 'Manager portal', emoji: '🔗', desc: "Issue and revoke reporting managers' team links" },
  { key: 'email_templates', path: '/email-templates', label: 'Email templates', emoji: '✉️', desc: 'View and preview the wording of every email PEA sends' },
  { key: 'settings', path: '/settings', label: 'Settings', emoji: '⚙️', desc: 'View scheduler, reminder and email configuration' },
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
