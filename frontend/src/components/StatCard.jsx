import HintIcon from './HintIcon.jsx';

const ACCENTS = {
  green: ['var(--pea-green-600)', 'var(--pea-green-50)'],
  blue: ['var(--pea-blue)', 'var(--pea-blue-soft)'],
  orange: ['var(--pea-orange)', 'var(--pea-orange-soft)'],
  red: ['var(--pea-red)', 'var(--pea-red-soft)'],
  emerald: ['var(--pea-emerald)', 'var(--pea-emerald-soft)'],
  violet: ['var(--pea-violet)', 'var(--pea-violet-soft)'],
};

/**
 * The ATS statistic tile: accent rule, icon chip, uppercase label, large value.
 *
 * `share` is a genuine proportion of a real denominator — never decoration. If a
 * figure has nothing meaningful to be a fraction of, leave it out and the bar
 * is not drawn at all.
 *
 * ── compact ────────────────────────────────────────────────────────────────
 *
 * The 17-Sep screen proposal uses a lighter tile on the Overview: no icon chip,
 * no accent rule, a sentence-case label, and the *figure* carrying the colour
 * rather than the card. It is a variant rather than a second component because
 * Analytics and the Overview KPI strip still render the full tile, and the two
 * must not drift apart. (The old Dashboard screen also used it; that screen was
 * deleted on 22 Sep 2026 once staging served Overview.)
 *
 * In compact form `accent` colours the figure only, and only when the tone is
 * not the neutral green — a screen of five coloured numbers says nothing.
 */
export default function StatCard({
  label,
  value,
  suffix,
  icon,
  accent = 'green',
  hint,
  foot,
  share,
  compact = false,
}) {
  const [colour, soft] = ACCENTS[accent] || ACCENTS.green;
  const pct = share == null ? null : Math.max(0, Math.min(100, Math.round(share * 100)));

  if (compact) {
    // Green is the neutral tone here, so it is left as ordinary ink; a zero is
    // left uncoloured too, since "0 not sent yet" is good news, not an alarm.
    const lit = accent !== 'green' && Number(value) > 0;

    return (
      <div className="pea-stat pea-stat--compact">
        <div className="pea-stat-label">
          {label}
          {hint && <HintIcon title={hint} />}
        </div>

        <div className="pea-stat-value" style={lit ? { color: colour } : undefined}>
          {value}
          {suffix && <small> {suffix}</small>}
        </div>

        {foot && <div className="pea-stat-foot">{foot}</div>}

        {/* Still only drawn when there is a real denominator to be a share of. */}
        {pct != null && (
          <div className="pea-stat-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    );
  }

  // The accent is per-card, so it rides on a local custom property. It is
  // deliberately NOT called --pea-accent: that is a global token now, and
  // shadowing it here would recolour any status pill rendered inside the tile.
  return (
    <div className="pea-stat" style={{ '--pea-stat-accent': colour, '--pea-stat-accent-soft': soft }}>
      <div className="pea-stat-icon">{icon}</div>

      <div className="pea-stat-label">
        {label}
        {hint && <HintIcon title={hint} />}
      </div>

      <div className="pea-stat-value" style={value > 0 && accent === 'red' ? { color: colour } : undefined}>
        {value}
        {suffix && <small> {suffix}</small>}
      </div>

      {foot && <div className="pea-stat-foot">{foot}</div>}

      {pct != null && (
        <div className="pea-stat-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
