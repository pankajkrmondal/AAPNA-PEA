import { CheckCircleFilled, ClockCircleOutlined, SafetyCertificateOutlined, StarFilled } from '@ant-design/icons';
import ThemeToggle from './ThemeToggle.jsx';

/** The six evaluations on the fresher track, as drawn on the preview card. */
const TRACK = [1, 2, 3, 4, 5, 6];

function Brand({ onDark = false }) {
  return (
    <div className={`pea-login-brand${onDark ? ' pea-auth-brand-dark' : ''}`}>
      <div className="pea-brand-mark">PEA</div>
      <div className="pea-brand-text">
        <span className="pea-brand-name">AAPNA</span>
        <span className="pea-brand-sub">Evaluation Platform</span>
      </div>
    </div>
  );
}

/**
 * The split layout shared by the sign-in, forgot-password and reset-password
 * pages: a brand panel that previews what PEA does, and the form beside it.
 * The panel is decorative and drops away on narrow screens.
 */
export default function AuthShell({ title, subtitle, eyebrow = 'HR workspace', children }) {
  return (
    <div className="pea-auth">
      <aside className="pea-auth-hero" aria-hidden="true">
        <span className="pea-auth-glow pea-auth-glow-a" />
        <span className="pea-auth-glow pea-auth-glow-b" />

        <Brand onDark />

        <div className="pea-auth-hero-body">
          <h1 className="pea-auth-headline">
            Probation reviews,
            <br />
            <em>on autopilot.</em>
          </h1>
          <p className="pea-auth-lead">
            Schedules built from the joining date, manager emails sent on time, reminders
            handled — and every decision in one place.
          </p>

          <div className="pea-auth-preview">
            <div className="pea-auth-glass pea-auth-track">
              <div className="pea-auth-glass-head">
                <span>Fresher track</span>
                <span className="pea-auth-chip">Evaluation 3 of 6</span>
              </div>
              <div className="pea-auth-steps">
                {TRACK.map((n) => (
                  <span
                    key={n}
                    className={`pea-auth-step${n < 3 ? ' is-done' : ''}${n === 3 ? ' is-current' : ''}`}
                  >
                    {n < 3 ? <CheckCircleFilled /> : n}
                  </span>
                ))}
              </div>
              <div className="pea-auth-glass-foot">
                <ClockCircleOutlined /> Sent to the reporting manager · reminder in 2 days
              </div>
            </div>

            <div className="pea-auth-glass pea-auth-float pea-auth-sweep">
              <span className="pea-auth-float-icon"><CheckCircleFilled /></span>
              <div>
                <strong>Daily sweep · 11:00 IST</strong>
                <span>Nothing due is left unsent</span>
              </div>
            </div>

            <div className="pea-auth-glass pea-auth-float pea-auth-rating">
              <StarFilled />
              <div>
                <strong>4.2 / 5</strong>
                <span>Average rating</span>
              </div>
            </div>
          </div>
        </div>

        <footer className="pea-auth-hero-foot">© {new Date().getFullYear()} AAPNA Infotech · All rights reserved</footer>
      </aside>

      <main className="pea-auth-panel">
        <div className="pea-auth-toolbar">
          <ThemeToggle />
        </div>

        <div className="pea-auth-form">
          <div className="pea-auth-mobile-brand">
            <Brand />
          </div>

          {eyebrow && (
            <span className="pea-auth-eyebrow">
              <span className="pea-pill-dot" />
              {eyebrow}
            </span>
          )}
          <h2 className="pea-auth-title">{title}</h2>
          <p className="pea-auth-subtitle">{subtitle}</p>

          {children}

          <p className="pea-auth-note">
            <SafetyCertificateOutlined /> For HR staff only. Reporting managers use the personal link in
            their evaluation email — no sign-in needed.
          </p>
        </div>
      </main>
    </div>
  );
}
