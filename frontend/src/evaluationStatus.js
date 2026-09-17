/**
 * evaluationStatus.js — one set of names for an evaluation's state.
 *
 * Until now each screen invented its own wording, so the SAME evaluation read
 * "Not yet sent" to HR and "Not yet due" to its manager, and a submitted one
 * was "Completed" on one page and "Submitted" on another. Two people looking at
 * one record could not agree on what it said.
 *
 * The wording here is from the 15-Sep screen proposal. Two rules:
 *
 *   · one name per state, everywhere — a manager sees the same words HR does,
 *     except where the sentence is addressed to them personally ("Waiting for
 *     you" rather than "Waiting for manager"), which is the same state said in
 *     the second person, not a different state;
 *   · "pending" is two states in the data. An evaluation not yet due is
 *     Scheduled; one past its due date that PEA has not sent is Not sent yet,
 *     which is a fault worth showing in red rather than a calm grey "pending".
 */

/** @type {Record<string, {label: string, colour: string}>} */
export const EVALUATION_STATUS = {
  pending: { label: 'Scheduled', colour: 'blue' },
  not_sent: { label: 'Not sent yet', colour: 'red' },
  email_sent: { label: 'Waiting for manager', colour: 'orange' },
  opened: { label: 'Opened by manager', colour: 'gold' },
  completed: { label: 'Submitted', colour: 'green' },
  skipped: { label: 'Closed', colour: 'default' },
};

/** The manager's own view says the same thing in the second person. */
const MANAGER_OVERRIDES = {
  email_sent: 'Waiting for you',
  not_sent: 'Not sent yet',
};

/**
 * Resolve a cycle to its display state.
 *
 * @param {{status: string, due_date?: string|Date, dueDate?: string|Date}} cycle
 * @param {{audience?: 'hr'|'manager'}} [opts]
 * @returns {{key: string, label: string, colour: string}}
 */
export function evaluationStatus(cycle, { audience = 'hr' } = {}) {
  const raw = cycle?.status;
  let key = raw;

  // A pending evaluation whose due date has passed has not been sent when it
  // should have been. Calling that "Scheduled" hides the only case here that
  // needs someone to do something.
  if (raw === 'pending') {
    const due = cycle.due_date ?? cycle.dueDate;
    if (due && new Date(due) < new Date(new Date().toDateString())) key = 'not_sent';
  }

  const entry = EVALUATION_STATUS[key] || { label: raw || '—', colour: 'default' };
  const label = (audience === 'manager' && MANAGER_OVERRIDES[key]) || entry.label;

  return { key, label, colour: entry.colour };
}
