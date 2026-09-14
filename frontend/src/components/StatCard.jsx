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
}) {
  const [colour, soft] = ACCENTS[accent] || ACCENTS.green;
  const pct = share == null ? null : Math.max(0, Math.min(100, Math.round(share * 100)));

  return (
    <div className="pea-stat" style={{ '--pea-accent': colour, '--pea-accent-soft': soft }}>
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
