/**
 * joinerAction.js — the page behind Confirm / Not confirm in the new joiner
 * review email. Walkthrough (27-10-2026) W-09.
 *
 * Server-rendered for the same reasons as evaluationForm.js: it is opened from
 * an email, once, and must simply work. It needs no script — one form, one
 * button — so it also runs under helmet's default content security policy.
 *
 * Opening the page changes nothing. Only the button does, which is what keeps
 * a mail scanner that pre-opens every link from confirming anyone.
 */
import config from '../config/index.js';
import { formatDisplay, dateIn } from '../utils/dateUtils.js';

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const inboxLink = () => `${String(config.frontendUrl || '').replace(/\/+$/, '')}/new-joiners`;

const STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  body { margin: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    font-size: 15px; line-height: 1.5; color: #1f2a17; background: #f5f8ee; }
  header { background: linear-gradient(135deg, #5c8727 0%, #6b9a30 50%, #47691f 100%); color: #fff; padding: 26px 16px; text-align: center; }
  header h1 { margin: 0; font-size: 22px; }
  header p { margin: 6px 0 0; opacity: .9; font-size: 14px; }
  main { max-width: 560px; margin: 24px auto; padding: 0 16px; }
  .card { background: #fff; border: 1px solid #dfe8cf; border-radius: 14px; padding: 22px; box-shadow: 0 2px 10px rgba(34,52,15,.06); }
  .who { font-size: 18px; font-weight: 700; margin: 0; }
  .sub { color: #6b7563; font-size: 13.5px; margin: 2px 0 16px; word-break: break-all; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 18px; }
  th { text-align: left; font-weight: 600; color: #6b7563; font-size: 13px; padding: 7px 10px 7px 0; vertical-align: top; width: 44%; }
  td { padding: 7px 0; font-size: 14px; border-bottom: 1px solid #eef3e4; }
  th { border-bottom: 1px solid #eef3e4; }
  .hint { font-size: 12.5px; color: #6b7563; }
  .btn { display: inline-block; border: 0; border-radius: 8px; padding: 12px 22px; font-size: 15px; font-weight: 700; cursor: pointer; text-decoration: none; }
  .btn-ok { background: #5c8727; color: #fff; }
  .btn-no { background: #b42318; color: #fff; }
  .btn-link { background: transparent; color: #47691f; padding: 12px 6px; }
  .note { border-radius: 10px; padding: 12px 14px; font-size: 14px; margin: 0 0 16px; }
  .note-warn { background: #fff7e6; border: 1px solid #f5d38f; color: #7a4b00; }
  .note-ok { background: #eef6e2; border: 1px solid #c9dfa8; color: #2f4d12; }
  .note-err { background: #fdecea; border: 1px solid #f3b9b3; color: #8a1c13; }
  .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
  footer { text-align: center; color: #9aa393; font-size: 12.5px; margin: 22px 0; }
`;

function page(title, heading, sub, body) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%235c8727'/%3E%3Ctext x='32' y='42' font-family='Arial' font-size='24' font-weight='700' fill='%23fff' text-anchor='middle'%3EPEA%3C/text%3E%3C/svg%3E">
<title>${esc(title)}</title>
<style>${STYLES}</style>
</head>
<body>
<header><h1>${esc(heading)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</header>
<main>${body}</main>
<footer>AAPNA | HR Team &middot; Probation Period Evaluation Platform</footer>
</body>
</html>`;
}

/** The details Confirm would save, as the email showed them. */
function details(joiner, values) {
  const created = joiner.account_created_at ? formatDisplay(dateIn(joiner.account_created_at, config.scheduler.timezone)) : '';
  const track = values.is_experienced === true ? 'Experienced' : values.is_experienced === false ? 'Fresher' : '—';
  const rows = [
    ['Account creation date', created ? `${esc(created)} <span class="hint">(Microsoft 365 / AD)</span>` : '—'],
    ['Evaluations counted from', values.doj ? esc(formatDisplay(values.doj)) : '—'],
    ['Fresher or experienced', `${esc(track)}${joiner.job_title ? ` <span class="hint">from “${esc(joiner.job_title)}”</span>` : ''}`],
    ['Reporting manager', values.rm_email ? `${esc(values.rm_name || '')}<br><span class="hint">${esc(values.rm_email)}</span>` : '—'],
    ['Project leader', esc(values.pl_email || '—')],
  ];
  return `<table>${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
}

/**
 * The page a link opens: what will happen, and one button to do it.
 * @param {{action: 'confirm'|'dismiss', joiner: object, values: object, blocker: string|null}} data
 * @returns {string} HTML
 */
export function renderActionPage({ action, joiner, values, blocker }) {
  const name = joiner.display_name || joiner.office_email;
  const head = `<p class="who">${esc(name)}</p><p class="sub">${esc(joiner.office_email || '')}</p>`;
  const portal = `<a class="btn btn-link" href="${esc(inboxLink())}">Open New joiners in PEA</a>`;

  if (action === 'confirm' && blocker) {
    return page('Review in PEA', 'Please confirm this joiner in PEA', 'This one cannot be confirmed from the email', `
      <div class="card">${head}
        <div class="note note-warn">${esc(blocker)}. Nothing has been changed.</div>
        ${details(joiner, values)}
        <div class="actions">${portal}</div>
      </div>`);
  }

  if (action === 'confirm') {
    return page('Confirm new joiner', 'Confirm new joiner', 'Check the details, then confirm', `
      <div class="card">${head}
        ${details(joiner, values)}
        <p class="hint">Confirming adds ${esc(name)} as a Commando and schedules their evaluations with the details above. If anything is wrong, open PEA instead and correct it there.</p>
        <form method="post" class="actions">
          <button type="submit" class="btn btn-ok">Confirm and schedule evaluations</button>
          ${portal}
        </form>
      </div>`);
  }

  return page('Not a new joiner', 'Not confirm this joiner', 'They will be removed from the New joiners inbox', `
    <div class="card">${head}
      <p>Not confirming removes this account from the New joiners inbox. No evaluation is scheduled, and it does not come back on later checks. Use this for accounts that are not new joiners.</p>
      <form method="post" class="actions">
        <button type="submit" class="btn btn-no">Not confirm — remove from the inbox</button>
        ${portal}
      </form>
    </div>`);
}

/**
 * After the button: what was done.
 * @param {{action: string, joiner: object, employee?: object}} result
 * @returns {string} HTML
 */
export function renderActionDone({ action, joiner, employee }) {
  const name = joiner.display_name || joiner.office_email;
  const cycles = employee?.cycles?.length;
  const body = action === 'confirm'
    ? `<div class="note note-ok"><strong>${esc(name)} is confirmed.</strong> ${cycles ? `${cycles} evaluation${cycles === 1 ? ' is' : 's are'} scheduled; ` : ''}the reporting manager will be emailed when each one is due.</div>`
    : `<div class="note note-ok"><strong>${esc(name)} was removed</strong> from the New joiners inbox. No evaluation was scheduled.</div>`;
  return page('Done', 'Done', 'You can close this tab', `
    <div class="card">${body}
      <div class="actions"><a class="btn btn-link" href="${esc(inboxLink())}">Open New joiners in PEA</a></div>
    </div>`);
}

/**
 * A link that cannot be used: expired, invalid, or already handled.
 * @param {string} message
 * @param {number} [status]
 * @returns {string} HTML
 */
export function renderActionProblem(message, status = 400) {
  const handled = status === 409 && /already/i.test(message);
  return page(
    handled ? 'Already done' : 'Link cannot be used',
    handled ? 'Already done' : 'This link cannot be used',
    handled ? 'Someone has already dealt with this joiner' : '',
    `<div class="card">
      <div class="note ${handled ? 'note-ok' : 'note-err'}">${esc(message)}</div>
      <div class="actions"><a class="btn btn-link" href="${esc(inboxLink())}">Open New joiners in PEA</a></div>
    </div>`
  );
}
