/**
 * ThemeToggle — the ATS animated sun/moon button that flips light/dark mode.
 * The morph is pure CSS (`.theme-toggle*` in styles/app.css); the circular
 * page reveal starts from this button via the click event passed to toggle.
 */
import { Tooltip } from 'antd';
import { useThemeMode } from '../theme.jsx';

const RAYS = Array.from({ length: 8 }, (_, i) => i);

export default function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  const dark = mode === 'dark';

  return (
    <Tooltip title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
      <button
        type="button"
        className={`theme-toggle${dark ? ' theme-toggle--dark' : ''}`}
        aria-label="Toggle theme"
        aria-pressed={dark}
        onClick={toggle}
      >
        <span className="theme-toggle__orb" aria-hidden="true" />
        <span className="theme-toggle__rays" aria-hidden="true">
          {RAYS.map((i) => (
            <i key={i} style={{ '--i': i }} />
          ))}
        </span>
      </button>
    </Tooltip>
  );
}
