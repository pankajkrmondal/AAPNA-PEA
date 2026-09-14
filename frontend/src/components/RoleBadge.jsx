import { ROLE_LABEL } from '../auth.js';

/** Coloured, uppercase role pill — the ATS `.role-badge` family. */
export default function RoleBadge({ role }) {
  const key = (role || '').toLowerCase();
  const known = Boolean(ROLE_LABEL[key]);
  return <span className={`role-badge role-badge--${known ? key : 'hr'}`}>{known ? ROLE_LABEL[key] : role || '—'}</span>;
}
