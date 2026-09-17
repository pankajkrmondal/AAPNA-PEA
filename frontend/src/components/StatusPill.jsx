/**
 * StatusPill — the screen proposal's most repeated element.
 *
 * A small filled pill with a leading dot, in one of six fixed colours, used
 * wherever a state is shown: Overview, Evaluations, the employee page, New
 * joiners and the manager portal. It replaces the per-screen Ant <Tag>, whose
 * colours were chosen a screen at a time.
 *
 * `evaluationStatus.js` already unified the *names* on 16 Sep; this only adds
 * the appearance. The mapping from a state key to a tone therefore lives here
 * and nowhere else — a screen picks a state, never a colour.
 *
 * Colour is never the only signal: the pill always carries its text, so a
 * reader who cannot tell red from green loses nothing.
 */

/** The six tones. `mute` has no ink colour of its own — it reads as muted text. */
const TONES = ['ok', 'warn', 'crit', 'info', 'ext', 'mute'];

/**
 * State key → tone, for the states in evaluationStatus.js.
 *
 * Note `opened` is info, not the gold that EVALUATION_STATUS still names for
 * the Ant tag: the proposal has six tones and gold is not one of them. An
 * opened-but-unsubmitted evaluation is informational, not a warning — nobody
 * is late merely because a manager has the form open.
 */
const STATE_TONES = {
  pending: 'info',
  not_sent: 'crit',
  email_sent: 'warn',
  opened: 'info',
  completed: 'ok',
  skipped: 'mute',
};

/** The tone for an evaluation state key, for callers that have one. */
export function toneForState(key) {
  return STATE_TONES[key] || 'mute';
}

/**
 * @param {object}  props
 * @param {string}  [props.tone]   one of the six; ignored if `state` is given
 * @param {string}  [props.state]  an evaluationStatus key, which picks the tone
 * @param {boolean} [props.nodot]  drop the dot — for classification pills
 *                                 (Fresher, Experienced, extension) as opposed
 *                                 to state pills
 */
export default function StatusPill({ tone, state, nodot = false, children }) {
  const resolved = state ? toneForState(state) : tone;
  const safe = TONES.includes(resolved) ? resolved : 'mute';

  // `pea-status-pill`, not `pea-pill`: the latter is already the hero badge on
  // the manager portal and self-view, which is a different element.
  return (
    <span className={`pea-status-pill pea-status-pill--${safe}${nodot ? ' pea-status-pill--nodot' : ''}`}>
      {children}
    </span>
  );
}
