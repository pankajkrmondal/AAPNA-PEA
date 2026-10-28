/**
 * PageHeader — a screen's heading and what it is for, in plain words.
 *
 * Headers (28-10-2026). The HRD head should understand any screen from its
 * heading and the line under it. The words come from auth.js (pageCopy), so
 * every screen's copy is in one place; this only lays it out, with the same
 * `pea-page-head` markup the screens used.
 *
 * @param {object} props
 * @param {string} props.module - a module key, or a PAGES key (auth.js)
 * @param {import('react').ReactNode} [props.note] - a live line under the
 *   description, e.g. when New joiners last checked
 * @param {import('react').ReactNode} [props.actions] - buttons on the right
 */
import { pageCopy } from '../auth.js';

export default function PageHeader({ module, note, actions }) {
  const { title, intro } = pageCopy(module);
  return (
    <div className="pea-page-head">
      <div>
        <h2>{title}</h2>
        {intro && <p>{intro}</p>}
        {note && <p className="pea-page-note">{note}</p>}
      </div>
      {actions}
    </div>
  );
}
