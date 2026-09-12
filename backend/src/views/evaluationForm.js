/**
 * evaluationForm.js — the page a reporting manager actually fills in.
 *
 * ── Why this is server-rendered when the admin UI will be React ─────────────
 *
 * This page has different constraints from the rest of the product. It is
 * opened once per evaluation, from a link in an email, by someone who has no
 * account and may be on a phone or a locked-down corporate browser. It must
 * simply work. A server-rendered form has no bundle to download, no build step,
 * no framework to fail, and degrades gracefully if JavaScript is blocked —
 * which is exactly what an emailed one-shot form wants.
 *
 * The HR admin screens are the opposite: repeat users, rich interaction, lots
 * of state. Those get React (Day 5), matching ATS.
 *
 * ── Design notes ───────────────────────────────────────────────────────────
 *
 * The layout deliberately mirrors the Microsoft Form managers have used for
 * years — same seven questions, same order, same labelled 1-5 scale — so
 * nobody has to relearn anything at cutover (plan R9).
 *
 * Two things are better than the MS Form, and both remove a failure mode:
 *   - The employee's name, joining date, evaluation number and period are shown
 *     rather than typed. On the old form the manager typed the employee's email
 *     and picked the evaluation number by hand; those two fields are precisely
 *     what identified the record, so a typo silently filed the rating against
 *     the wrong person or the wrong month.
 *   - The rating scale is on the form itself, not only in the covering email.
 */

/** Escape text for safe interpolation into HTML. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: Calibri, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 16px; line-height: 1.5; color: #22272b; background: #eef1f4;
  }
  .wrap { max-width: 860px; margin: 0 auto; padding: 16px; }
  header { background: #345C72; color: #fff; padding: 24px 16px; }
  header .wrap { padding: 0 16px; }
  header h1 { margin: 0 0 4px; font-size: 22px; font-weight: 600; }
  header p { margin: 0; opacity: .85; font-size: 15px; }

  .card { background: #fff; border: 1px solid #d9e0e6; border-radius: 8px;
          padding: 20px; margin: 16px 0; }

  .subject { display: grid; grid-template-columns: max-content 1fr; gap: 6px 20px; margin: 0; }
  .subject dt { color: #5b6b78; font-size: 14px; }
  .subject dd { margin: 0; font-weight: 600; }

  table.scale { border-collapse: collapse; width: 100%; font-size: 14px; }
  table.scale th, table.scale td { border: 1px solid #d9e0e6; padding: 7px 10px; text-align: left; }
  table.scale th { background: #345C72; color: #fff; font-weight: 600; }

  .q { border-top: 1px solid #e6ebef; padding: 18px 0; }
  .q:first-of-type { border-top: 0; padding-top: 4px; }
  .q h3 { margin: 0 0 10px; font-size: 16px; }
  .q h3 .num { color: #7b8a96; font-weight: 400; margin-right: 6px; }

  .opts { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
  .opts label {
    flex: 1 1 150px; display: flex; align-items: flex-start; gap: 8px;
    border: 1px solid #d9e0e6; border-radius: 6px; padding: 9px 11px;
    cursor: pointer; background: #fbfcfd; font-size: 14px;
  }
  .opts label:hover { border-color: #345C72; }
  .opts input { margin: 3px 0 0; flex: none; }
  .opts .n { font-weight: 700; }
  .opts .d { display: block; color: #6b7a86; font-size: 12.5px; }
  .opts input:checked + span { color: #1d4258; }
  .opts label:has(input:checked) { border-color: #345C72; background: #eaf1f5; box-shadow: inset 0 0 0 1px #345C72; }

  textarea, input[type=email], select {
    width: 100%; font: inherit; font-size: 15px; padding: 9px 11px;
    border: 1px solid #c9d3db; border-radius: 6px; background: #fff; color: inherit;
  }
  textarea { min-height: 64px; resize: vertical; }
  label.fld { display: block; font-size: 14px; color: #5b6b78; margin-bottom: 5px; }

  .req { color: #b3261e; }
  .hint { font-size: 13.5px; color: #6b7a86; margin: 6px 0 0; }

  button {
    background: #345C72; color: #fff; border: 0; border-radius: 6px;
    padding: 13px 26px; font: inherit; font-size: 16px; font-weight: 600; cursor: pointer;
  }
  button:hover { background: #27485b; }
  button:disabled { background: #9aa8b2; cursor: not-allowed; }

  .err {
    background: #fdecea; border: 1px solid #f5c6c2; color: #8c1d18;
    border-radius: 6px; padding: 12px 14px; margin: 0 0 16px;
  }
  .note { background: #fff8e6; border: 1px solid #f0dca8; border-radius: 6px;
          padding: 12px 14px; font-size: 14.5px; }
  footer { text-align: center; color: #7b8a96; font-size: 13px; padding: 8px 0 32px; }

  @media (max-width: 560px) {
    .opts label { flex: 1 1 100%; }
    .subject { grid-template-columns: 1fr; gap: 2px 0; }
    .subject dd { margin-bottom: 8px; }
  }
`;

function page(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${bodyHtml}
<footer>AAPNA | HR Team &middot; Performance Evaluation</footer>
</body>
</html>`;
}

/**
 * @param {object} data
 * @param {object} [opts]
 * @param {string} [opts.error]
 * @param {object} [opts.submitted]
 * @param {string} [opts.nonce] - CSP nonce from res.locals.cspNonce
 */

/**
 * Render the evaluation form.
 * @param {object} data - from evaluation.service.getFormData()
 * @param {object} [opts]
 * @param {string} [opts.error] - validation message to show above the form
 * @param {object} [opts.submitted] - previously entered values, to refill on error
 * @param {string} [opts.nonce] - CSP nonce for the inline script
 * @returns {string} HTML
 */
export function renderForm(data, { error = '', submitted = {}, nonce = '' } = {}) {
  const { employee, cycle, params, askConfirmation, token } = data;
  const ratings = submitted.ratings || {};

  const scaleRows = RATING_ROWS.map(
    (r) => `<tr><td>${esc(r.label)} <span style="color:#6b7a86">(${esc(r.detail)})</span></td>
             <td style="text-align:center"><strong>${r.value}</strong></td>
             <td style="text-align:center">${esc(r.percent)}</td></tr>`
  ).join('');

  const questions = params
    .map((p, i) => {
      const current = ratings[p.param_key] || {};
      const opts = RATING_ROWS.map(
        (r) => `
      <label>
        <input type="radio" name="rating_${esc(p.param_key)}" value="${r.value}"
               ${String(current.rating) === String(r.value) ? 'checked' : ''} required>
        <span><span class="n">${r.value} — ${esc(r.label)}</span>
              <span class="d">${esc(r.detail)}</span></span>
      </label>`
      ).join('');

      return `
    <div class="q">
      <h3><span class="num">${i + 1}.</span>${esc(p.param_label)} <span class="req">*</span></h3>
      <div class="opts">${opts}</div>
      <label class="fld" for="c_${esc(p.param_key)}">Comments</label>
      <textarea id="c_${esc(p.param_key)}" name="comments_${esc(p.param_key)}"
                placeholder="Why this rating? Specific examples help ${esc(employee.full_name.split(' ')[0])} improve."
      >${esc(current.comments || '')}</textarea>
    </div>`;
    })
    .join('');

  const confirmationBlock = askConfirmation
    ? `
  <div class="card">
    <h2 style="margin:0 0 6px;font-size:18px">Confirmation decision <span class="req">*</span></h2>
    <p class="hint" style="margin-bottom:14px">
      This is the final evaluation of ${esc(employee.full_name)}'s probation period,
      so a decision is required.
    </p>
    <select name="confirmation_status" required>
      <option value="">— Please choose —</option>
      ${CONFIRMATION_ROWS.map(
        (o) =>
          `<option value="${esc(o.value)}" ${
            submitted.confirmation_status === o.value ? 'selected' : ''
          }>${esc(o.label)} — ${esc(o.help)}</option>`
      ).join('')}
    </select>
  </div>`
    : '';

  return page(
    `Performance Evaluation ${cycle.seq_no} — ${employee.full_name}`,
    `
<header>
  <div class="wrap">
    <h1>Performance Evaluation ${cycle.seq_no}${cycle.is_extension ? ' (extended period)' : ''}</h1>
    <p>AAPNA Infotech &middot; Human Resources</p>
  </div>
</header>

<div class="wrap">
  ${error ? `<div class="err">${esc(error)}</div>` : ''}

  <div class="card">
    <dl class="subject">
      <dt>Employee</dt><dd>${esc(employee.full_name)}</dd>
      <dt>Office email</dt><dd>${esc(employee.office_email)}</dd>
      <dt>Date of joining</dt><dd>${esc(employee.dojLabel)}</dd>
      <dt>Category</dt><dd>${employee.is_experienced ? 'Experienced' : 'Fresher'}</dd>
      <dt>Period under review</dt><dd>${esc(cycle.periodLabel)}</dd>
    </dl>
  </div>

  <div class="card">
    <h2 style="margin:0 0 10px;font-size:17px">Rating scale</h2>
    <table class="scale">
      <tr><th>Rating</th><th style="width:70px;text-align:center">Score</th><th style="width:80px;text-align:center">%age</th></tr>
      ${scaleRows}
    </table>
  </div>

  <form method="POST" action="/api/evaluation/${esc(token)}/submit" id="evalForm">
    <div class="card">
      <h2 style="margin:0 0 4px;font-size:18px">Your assessment</h2>
      <p class="hint" style="margin-bottom:8px">
        Please rate each parameter and add a comment. All ratings are required.
      </p>
      ${questions}
    </div>

    ${confirmationBlock}

    <div class="card">
      <label class="fld" for="remarks">Overall remarks</label>
      <textarea id="remarks" name="remarks" style="min-height:110px"
        placeholder="A short summary of ${esc(employee.full_name.split(' ')[0])}'s performance this period."
      >${esc(submitted.remarks || '')}</textarea>

      <div style="margin-top:16px">
        <label class="fld" for="submitted_by">Your email <span class="hint">(so HR knows who responded)</span></label>
        <input type="email" id="submitted_by" name="submitted_by"
               value="${esc(submitted.submitted_by || '')}"
               placeholder="you@aapnainfotech.com">
      </div>
    </div>

    <div style="margin: 4px 0 28px">
      <button type="submit" id="btn">Submit evaluation</button>
      <p class="hint">This link can be submitted once. Please review before sending.</p>
    </div>
  </form>
</div>

<script${nonce ? ` nonce="${esc(nonce)}"` : ''}>
  // Progressive enhancement only — the form posts and validates server-side
  // without this, and the token is single-use regardless. It just stops a
  // double submit looking like a failure on a slow connection.
  document.getElementById('evalForm').addEventListener('submit', function () {
    var b = document.getElementById('btn');
    b.disabled = true;
    b.textContent = 'Submitting…';
  });
</script>
`
  );
}

/**
 * Render the thank-you page.
 * @param {object} result - from evaluation.service.submit()
 * @returns {string} HTML
 */
export function renderThanks(result) {
  const extended = result.confirmation_status?.startsWith('Extend');

  return page(
    'Evaluation submitted',
    `
<header>
  <div class="wrap">
    <h1>Thank you</h1>
    <p>Your evaluation has been recorded.</p>
  </div>
</header>

<div class="wrap">
  <div class="card">
    <dl class="subject">
      <dt>Employee</dt><dd>${esc(result.employee)}</dd>
      <dt>Evaluation</dt><dd>${esc(result.evaluation)}</dd>
      <dt>Average rating</dt><dd>${esc(result.average)} / 5</dd>
      ${result.confirmation_status ? `<dt>Decision</dt><dd>${esc(result.confirmation_status)}</dd>` : ''}
    </dl>
  </div>

  ${
    extended
      ? `<div class="note">
      You chose <strong>${esc(result.confirmation_status)}</strong>.
      ${result.extensionCyclesCreated} further evaluation${
        result.extensionCyclesCreated === 1 ? '' : 's'
      } ${result.extensionCyclesCreated === 1 ? 'has' : 'have'} been scheduled, and you will
      receive a link when ${result.extensionCyclesCreated === 1 ? 'it is' : 'they are'} due.
    </div>`
      : `<div class="note">HR has been notified. No further action is needed from you.</div>`
  }

  <p class="hint" style="text-align:center;margin-top:20px">You can close this page.</p>
</div>`
  );
}

/**
 * Render an error page (expired link, already submitted, unknown token).
 * @param {string} message
 * @param {number} [status=400]
 * @returns {string} HTML
 */
export function renderError(message, status = 400) {
  return page(
    'Evaluation link',
    `
<header>
  <div class="wrap">
    <h1>${status === 410 ? 'This link is no longer active' : 'We could not open this evaluation'}</h1>
    <p>AAPNA Infotech &middot; Human Resources</p>
  </div>
</header>

<div class="wrap">
  <div class="card">
    <p style="margin:0">${esc(message)}</p>
  </div>
  <p class="hint" style="text-align:center">
    If you believe this is a mistake, please contact the HR team.
  </p>
</div>`
  );
}

// Imported at the bottom to keep the rendering functions at the top of the file.
import { RATING_SCALE as RATING_ROWS, CONFIRMATION_OPTIONS as CONFIRMATION_ROWS } from '../config/ratingScale.js';
