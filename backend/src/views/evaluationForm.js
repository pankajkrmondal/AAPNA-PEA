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
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    font-size: 15px; line-height: 1.5; color: #1f2a17; background: #f5f8ee;
  }
  .wrap { max-width: 860px; margin: 0 auto; padding: 16px; }
  header {
    background: linear-gradient(135deg, #5c8727 0%, #6b9a30 50%, #47691f 100%);
    color: #fff;
    padding: 30px 16px;
    text-align: center;
    box-shadow: 0 2px 10px rgba(34, 52, 15, 0.12);
  }
  header .wrap { padding: 0 16px; }
  header .brand { margin-bottom: 12px; }
  header .brand img {
    display: inline-block;
    max-width: 180px;
    height: auto;
  }
  header h1 {
    margin: 0 0 6px;
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.01em;
    color: #ffffff;
  }
  header p {
    margin: 0;
    color: #e8f1d7;
    font-size: 14px;
    font-weight: 500;
  }

  .card {
    background: #ffffff;
    border: 1px solid #e6ebdb;
    border-radius: 12px;
    padding: 24px;
    margin: 16px 0;
    box-shadow: 0 1px 3px rgba(34, 52, 15, 0.04), 0 6px 16px -8px rgba(34, 52, 15, 0.08);
  }

  .subject { display: grid; grid-template-columns: max-content 1fr; gap: 8px 24px; margin: 0; }
  .subject dt { color: #6b7566; font-size: 14px; font-weight: 500; }
  .subject dd { margin: 0; font-weight: 600; color: #1f2a17; }

  table.scale {
    border-collapse: collapse;
    width: 100%;
    font-size: 14px;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #e6ebdb;
  }
  table.scale th, table.scale td { border: 1px solid #e6ebdb; padding: 9px 12px; text-align: left; }
  table.scale th {
    background: #5c8727;
    color: #ffffff;
    font-weight: 700;
    letter-spacing: 0.01em;
  }
  table.scale tr:nth-child(even) td { background: #fafcf7; }

  .q { border-top: 1px solid #e6ebdb; padding: 20px 0; }
  .q:first-of-type { border-top: 0; padding-top: 4px; }
  .q h3 { margin: 0 0 12px; font-size: 16px; color: #1f2a17; font-weight: 600; }
  .q h3 .num { color: #5c8727; font-weight: 700; margin-right: 6px; }

  .opts { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  .opts label {
    flex: 1 1 150px; display: flex; align-items: flex-start; gap: 8px;
    border: 1px solid #e6ebdb; border-radius: 8px; padding: 10px 12px;
    cursor: pointer; background: #ffffff; font-size: 14px;
    transition: border-color 0.15s, background-color 0.15s, box-shadow 0.15s;
  }
  .opts label:hover { border-color: #5c8727; background: #fafcf7; }
  .opts input { margin: 3px 0 0; flex: none; accent-color: #5c8727; }
  .opts .n { font-weight: 700; color: #1f2a17; }
  .opts .d { display: block; color: #6b7566; font-size: 12.5px; margin-top: 2px; }
  .opts input:checked + span .n { color: #22340f; }
  .opts label:has(input:checked) {
    border-color: #5c8727;
    background: #f2f7e8;
    box-shadow: inset 0 0 0 1.5px #5c8727;
  }

  textarea, input[type=email], select {
    width: 100%; font: inherit; font-size: 15px; padding: 10px 12px;
    border: 1px solid #d6ddc6; border-radius: 8px; background: #ffffff; color: #1f2a17;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  textarea:focus, input[type=email]:focus, select:focus {
    outline: none;
    border-color: #5c8727;
    box-shadow: 0 0 0 3px rgba(92, 135, 39, 0.15);
  }
  textarea { min-height: 72px; resize: vertical; }
  label.fld { display: block; font-size: 14px; font-weight: 600; color: #47691f; margin-bottom: 6px; }

  .req { color: #dc2626; }
  .hint { font-size: 13.5px; color: #6b7566; margin: 6px 0 0; }

  button {
    background: #5c8727; color: #ffffff; border: 0; border-radius: 8px;
    padding: 13px 28px; font: inherit; font-size: 16px; font-weight: 700; cursor: pointer;
    transition: background-color 0.15s, transform 0.1s, box-shadow 0.15s;
    box-shadow: 0 2px 6px rgba(92, 135, 39, 0.25);
  }
  button:hover {
    background: #47691f;
    box-shadow: 0 4px 12px rgba(71, 105, 31, 0.3);
  }
  button:active { transform: translateY(1px); }
  button:disabled { background: #a6c974; cursor: not-allowed; box-shadow: none; }

  .err {
    background: #fef2f2; border: 1px solid #fecaca; color: #991b1b;
    border-radius: 8px; padding: 12px 16px; margin: 0 0 16px; font-size: 14.5px;
  }
  .err strong { display: block; margin-bottom: 4px; }
  .err ul { margin: 4px 0 0; padding-left: 20px; }
  .err a { color: #991b1b; }

  /* The rule box: dashed brand green, the same frame every required comment
     wears — the seven question comments and the decision reason. */
  .rule {
    border: 1.5px dashed #74a534; border-radius: 10px; background: #f7faf1;
    padding: 8px 12px; font-size: 13.5px; color: #47691f; margin: 0 0 10px;
  }
  .cmt { border-radius: 10px; }
  .cmt.need { border: 1.5px dashed #74a534; background: #f7faf1; padding: 10px 12px 12px; }
  .cmt .opt { font-weight: 500; color: #6b7566; }
  .cmt .must { display: none; font-weight: 500; color: #965406; font-size: 12.5px; margin-left: 4px; }
  .cmt.need .must { display: inline; }
  .cmt.need .opt { display: none; }
  .field-err { color: #b91c1c; font-size: 13px; margin: 6px 0 0; display: flex; gap: 6px; align-items: center; }
  textarea.invalid, select.invalid { border-color: #dc2626; box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.10); }
  .reason { margin-top: 14px; }
  .reason.hide { display: none; }
  .counter { text-align: right; font-size: 12px; color: #9aa393; margin-top: 4px; }
  .note {
    background: #f2f7e8; border: 1px solid #d3e4b3; border-radius: 8px;
    padding: 14px 18px; font-size: 14.5px; color: #22340f; line-height: 1.6;
  }
  footer { text-align: center; color: #6b7566; font-size: 13px; padding: 12px 0 36px; }

  @media (max-width: 560px) {
    .opts label { flex: 1 1 100%; }
    .subject { grid-template-columns: 1fr; gap: 2px 0; }
    .subject dd { margin-bottom: 8px; }
  }

  /* ── Thank-You & Status Screen ───────────────────────────────────────── */
  .header-compact {
    background: linear-gradient(135deg, #5c8727 0%, #6b9a30 50%, #47691f 100%);
    padding: 28px 16px 44px;
    text-align: center;
    color: #ffffff;
    box-shadow: 0 2px 10px rgba(34, 52, 15, 0.12);
  }
  .header-compact .brand { margin-bottom: 8px; }
  .header-compact .brand img { display: inline-block; max-width: 170px; height: auto; }
  .header-tag { margin: 0; color: #e8f1d7; font-size: 13.5px; font-weight: 500; }

  .wrap-thanks { max-width: 560px; margin: -26px auto 36px; padding: 0 16px; position: relative; z-index: 2; }
  .thanks-card {
    background: #ffffff;
    border: 1px solid #e6ebdb;
    border-radius: 16px;
    padding: 36px 28px;
    text-align: center;
    box-shadow: 0 4px 24px -4px rgba(34, 52, 15, 0.12), 0 2px 6px rgba(34, 52, 15, 0.04);
  }
  .success-icon-wrap {
    display: inline-flex; align-items: center; justify-content: center;
    width: 68px; height: 68px; margin-bottom: 18px; border-radius: 50%;
    background: #f2f7e8;
  }
  .success-icon { width: 52px; height: 52px; display: block; }
  .error-icon-wrap {
    display: inline-flex; align-items: center; justify-content: center;
    width: 68px; height: 68px; margin-bottom: 18px; border-radius: 50%;
    background: #fef2f2;
  }
  .error-icon { width: 44px; height: 44px; display: block; }

  .thanks-title { font-size: 24px; font-weight: 700; color: #1f2a17; margin: 0 0 8px; letter-spacing: -0.01em; }
  .thanks-subtitle { font-size: 14.5px; color: #6b7566; margin: 0 0 22px; line-height: 1.5; }

  .summary-box {
    background: #fbfcf7;
    border: 1px solid #e6ebdb;
    border-radius: 12px;
    padding: 18px 20px;
    margin-bottom: 20px;
    text-align: left;
  }
  .employee-row {
    display: flex; align-items: center; gap: 14px; padding-bottom: 16px; border-bottom: 1px solid #e6ebdb;
  }
  .avatar {
    width: 44px; height: 44px; border-radius: 50%; background: #5c8727; color: #ffffff;
    display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; flex-shrink: 0;
    box-shadow: 0 2px 6px rgba(92, 135, 39, 0.25);
  }
  .employee-meta { flex: 1; min-width: 0; }
  .emp-name { font-size: 16px; font-weight: 700; color: #1f2a17; line-height: 1.3; }
  .emp-cycle { font-size: 13px; color: #6b7566; margin-top: 2px; }

  .decision-badge {
    padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  .decision-badge.confirmed { background: #e0f5ed; color: #0d9f6e; border: 1px solid #a7f3d0; }
  .decision-badge.extended { background: #fdefdd; color: #e08113; border: 1px solid #fed7aa; }
  .decision-badge.not-confirmed { background: #fde9e9; color: #dc2626; border: 1px solid #fecaca; }

  .score-card { display: flex; align-items: center; justify-content: space-between; padding-top: 14px; }
  .score-left .score-label { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #6b7566; }
  .score-left .score-rating-text { font-size: 14px; font-weight: 700; color: #5c8727; margin-top: 3px; }
  .score-right { display: flex; align-items: baseline; gap: 4px; }
  .score-value { font-size: 32px; font-weight: 800; color: #1f2a17; line-height: 1; }
  .score-max { font-size: 16px; font-weight: 600; color: #9aa393; }

  .notice-box {
    display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; border-radius: 10px;
    font-size: 13.5px; line-height: 1.5; margin-bottom: 22px; text-align: left;
  }
  .notice-box svg { width: 20px; height: 20px; flex-shrink: 0; margin-top: 2px; }
  .notice-box.notice-success { background: #f2f7e8; border: 1px solid #d3e4b3; color: #22340f; }
  .notice-box.notice-success svg { stroke: #5c8727; }
  .notice-box.notice-warning { background: #fdefdd; border: 1px solid #fed7aa; color: #7c2d12; }
  .notice-box.notice-warning svg { stroke: #e08113; }
  .notice-box.notice-error { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
  .notice-box.notice-error svg { stroke: #dc2626; }

  .thanks-action { margin-top: 4px; }
  .btn-close {
    background: #5c8727; color: #ffffff; border: 0; border-radius: 8px; padding: 11px 28px;
    font-size: 15px; font-weight: 700; cursor: pointer; transition: background-color 0.15s, box-shadow 0.15s, transform 0.1s;
    box-shadow: 0 2px 6px rgba(92, 135, 39, 0.25);
  }
  .btn-close:hover { background: #47691f; box-shadow: 0 4px 12px rgba(71, 105, 31, 0.3); }
  .btn-close:active { transform: translateY(1px); }
  .close-hint { font-size: 13px; color: #9aa393; margin: 10px 0 0; }
`;

function page(title, bodyHtml) {
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
${bodyHtml}
<footer>AAPNA | HR Team &middot; Performance Evaluation</footer>
</body>
</html>`;
}

const COUNT_WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** "seven" for 7 — the rule box reads as a sentence, not a count. */
function countWord(n) {
  return COUNT_WORDS[n] || String(n);
}

/** Where on the page each kind of problem lives. */
function anchorFor(field) {
  if (field === 'confirmation_status') return '#decision';
  if (field === 'confirmation_reason') return '#reason';
  if (field.startsWith('comments_')) return `#c_${field.slice('comments_'.length)}`;
  return '';
}

/**
 * One line of the error summary, with the part it names ("Meeting Deadline",
 * "Extend for 1 month") as a link to the field.
 * @param {{field: string, text: string, label?: string}} p
 */
function problemLine(p) {
  const anchor = anchorFor(p.field);
  const at = p.label ? p.text.indexOf(p.label) : -1;
  if (!anchor || at < 0) return esc(p.text);
  return esc(p.text.slice(0, at))
    + `<a href="${esc(anchor)}">${esc(p.label)}</a>`
    + esc(p.text.slice(at + p.label.length));
}

/**
 * Render the evaluation form.
 * @param {object} data - from evaluation.service.getFormData()
 * @param {object} [opts]
 * @param {string} [opts.error] - validation message to show above the form
 * @param {object} [opts.submitted] - previously entered values, to refill on error
 * @param {string} [opts.nonce] - CSP nonce for the inline script
 * @returns {string} HTML
 */
export function renderForm(data, { error = '', problems = [], submitted = {}, nonce = '' } = {}) {
  const { employee, cycle, params, askConfirmation, token } = data;
  const ratings = submitted.ratings || {};
  const first = esc(employee.full_name.split(' ')[0]);
  const problemFor = (field) => problems.find((p) => p.field === field);

  // "Please fix 2 things before submitting — your answers are kept." Each item
  // links to the field it is about, so a long form is not a hunt.
  const errorBlock = problems.length
    ? `<div class="err" role="alert">
        <strong>Please fix ${problems.length} thing${problems.length === 1 ? '' : 's'} before submitting — your answers are kept.</strong>
        <ul>${problems.map((p) => `<li>${problemLine(p)}</li>`).join('')}</ul>
      </div>`
    : error ? `<div class="err" role="alert">${esc(error)}</div>` : '';

  const scaleRows = RATING_ROWS.map(
    (r) => `<tr><td>${esc(r.label)} <span style="color:#6b7566">(${esc(r.detail)})</span></td>
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

      // A comment is required on every question, whatever the rating, so every
      // box wears the required frame. `required` stops an empty one before the
      // round trip; the server is the gate either way.
      const missing = problemFor(`comments_${p.param_key}`);

      return `
    <div class="q">
      <h3><span class="num">${i + 1}.</span>${esc(p.param_label)} <span class="req">*</span></h3>
      <div class="opts">${opts}</div>
      <div class="cmt need">
        <label class="fld" for="c_${esc(p.param_key)}">
          Comment <span class="req">*</span>
          <span class="must">required — one line is enough</span>
        </label>
        <textarea id="c_${esc(p.param_key)}" name="comments_${esc(p.param_key)}" required${missing ? ' class="invalid"' : ''}
                  placeholder="Why this rating? Specific examples help ${first} improve."
        >${esc(current.comments || '')}</textarea>
        ${missing ? `<p class="field-err">⚠ Please explain this rating — HR and ${first} both need to understand it.</p>` : ''}
      </div>
    </div>`;
    })
    .join('');

  const decisionMissing = problemFor('confirmation_status');
  const reasonProblem = problemFor('confirmation_reason');
  const reasonText = String(submitted.confirmation_reason || '');
  // Hidden only for "Confirmed" and no choice yet. Without JavaScript it is
  // always shown, and its label says when it is required.
  const reasonHidden = !submitted.confirmation_status || submitted.confirmation_status === 'Confirmed';

  const confirmationBlock = askConfirmation
    ? `
  <div class="card" id="decision">
    <h2 style="margin:0 0 6px;font-size:18px">Confirmation decision <span class="req">*</span></h2>
    <p class="hint" style="margin-bottom:14px">
      This is the final evaluation of ${esc(employee.full_name)}'s probation period,
      so a decision is required.
    </p>
    <select name="confirmation_status" id="confirmation_status" required${decisionMissing ? ' class="invalid"' : ''}>
      <option value="">— Please choose —</option>
      ${CONFIRMATION_ROWS.map(
        (o) =>
          `<option value="${esc(o.value)}" ${
            submitted.confirmation_status === o.value ? 'selected' : ''
          }>${esc(o.label)} — ${esc(o.help)}</option>`
      ).join('')}
    </select>

    <div class="reason cmt need${reasonHidden ? ' hide' : ''}" id="reason">
      <label class="fld" for="confirmation_reason">
        Reason for this decision <span class="req">*</span>
        <span class="must">— required when you do not confirm or when you extend</span>
      </label>
      <textarea id="confirmation_reason" name="confirmation_reason" maxlength="${REASON_MAX}" style="min-height:90px"${reasonProblem ? ' class="invalid"' : ''}
        placeholder="What would need to change for ${first} to be confirmed? HR sees this with your ratings, and it goes on the employee's record."
      >${esc(reasonText)}</textarea>
      <div style="display:flex;justify-content:space-between;gap:12px">
        <span>${reasonProblem ? `<p class="field-err">⚠ ${esc(reasonProblem.field === 'confirmation_reason' && /limit/.test(reasonProblem.text) ? reasonProblem.text : `Please give a reason for ${String(submitted.confirmation_status || '').startsWith('Extend') ? 'extending the probation' : 'this decision'}.`)}</p>` : ''}</span>
        <span class="counter" id="reason_count">${reasonText.length} / ${REASON_MAX}</span>
      </div>
    </div>
  </div>`
    : '';

  return page(
    `Performance Evaluation ${cycle.seq_no} — ${employee.full_name}`,
    `
<header>
  <div class="wrap">
    <div class="brand">
      <img src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png" width="180" alt="AAPNA Infotech">
    </div>
    <h1>Performance Evaluation ${cycle.seq_no}${cycle.is_extension ? ' (extended period)' : ''}</h1>
    <p>AAPNA Infotech &middot; Performance Evaluation</p>
  </div>
</header>

<div class="wrap">
  ${errorBlock}

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
      <h2 style="margin:0 0 8px;font-size:18px">Your assessment</h2>
      <p class="rule">
        Rate every parameter and say why. A comment is <strong>required on all ${countWord(params.length)}</strong>,
        whatever the rating — one line is enough. ${first} sees these, and so does HR.
      </p>
      ${questions}
    </div>

    ${confirmationBlock}

    <div class="card">
      <label class="fld" for="remarks">Overall remarks <span class="opt" style="font-weight:500;color:#6b7566">(optional)</span></label>
      <textarea id="remarks" name="remarks" style="min-height:110px"
        placeholder="A short summary of ${first}'s performance this period."
      >${esc(submitted.remarks || '')}</textarea>
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
  var form = document.getElementById('evalForm');

  // The reason box appears for any decision that is not a plain confirmation.
  var decision = document.getElementById('confirmation_status');
  var reasonBox = document.getElementById('reason');
  var reason = document.getElementById('confirmation_reason');
  var counter = document.getElementById('reason_count');
  if (decision && reasonBox) {
    var sync = function () {
      var need = !!decision.value && decision.value !== 'Confirmed';
      reasonBox.classList.toggle('hide', !need);
      reason.required = need;
    };
    decision.addEventListener('change', sync);
    sync();
    reason.addEventListener('input', function () {
      counter.textContent = reason.value.length + ' / ${REASON_MAX}';
    });
  }

  form.addEventListener('submit', function () {
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
  const avgNum = Number(result.average) || 0;
  const pct = Math.round((avgNum / 5) * 100);

  let ratingLabel = 'Satisfied';
  for (const r of RATING_ROWS) {
    if (avgNum >= r.value - 0.5) {
      ratingLabel = r.label;
      break;
    }
  }

  const initials = String(result.employee || '')
    .trim()
    .split(/\s+/)
    .map((p) => p[0]?.toUpperCase() || '')
    .slice(0, 2)
    .join('') || 'PE';

  let decisionBadge = '';
  if (result.confirmation_status) {
    const isConf = result.confirmation_status === 'Confirmed';
    const isNotConf = result.confirmation_status === 'Not Confirmed';
    const badgeClass = isConf ? 'confirmed' : isNotConf ? 'not-confirmed' : 'extended';
    decisionBadge = `<span class="decision-badge ${badgeClass}">${esc(result.confirmation_status)}</span>`;
  }

  const noticeBlock = extended
    ? `
    <div class="notice-box notice-warning">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
      <div>
        <strong>Probation period extended (${esc(result.confirmation_status)}).</strong>
        <div>${result.extensionCyclesCreated} additional evaluation${
          result.extensionCyclesCreated === 1 ? '' : 's'
        } ${
          result.extensionCyclesCreated === 1 ? 'has' : 'have'
        } been scheduled, and you will receive a new link when due.</div>
      </div>
    </div>`
    : `
    <div class="notice-box notice-success">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      <div>
        <strong>HR team has been notified.</strong>
        <div>Your ratings and comments have been recorded. No further action is required from you.</div>
      </div>
    </div>`;

  return page(
    'Evaluation submitted',
    `
<header class="header-compact">
  <div class="wrap">
    <div class="brand">
      <img src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png" width="170" alt="AAPNA Infotech">
    </div>
    <p class="header-tag">AAPNA Infotech &middot; Performance Evaluation System</p>
  </div>
</header>

<div class="wrap wrap-thanks">
  <div class="thanks-card">
    <div class="success-icon-wrap">
      <svg class="success-icon" viewBox="0 0 48 48" fill="none">
        <circle cx="24" cy="24" r="22" fill="#e8f1d7" stroke="#5c8727" stroke-width="3"/>
        <path d="M14 24L21 31L34 17" stroke="#5c8727" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </div>
    <h1 class="thanks-title">Evaluation Submitted</h1>
    <p class="thanks-subtitle">Thank you for your assessment. Your response has been recorded.</p>

    <div class="summary-box">
      <div class="employee-row">
        <div class="avatar">${esc(initials)}</div>
        <div class="employee-meta">
          <div class="emp-name">${esc(result.employee)}</div>
          <div class="emp-cycle">Performance Evaluation Round ${esc(result.evaluation)}</div>
        </div>
        ${decisionBadge}
      </div>

      <div class="score-card">
        <div class="score-left">
          <div class="score-label">Overall Average Rating</div>
          <div class="score-rating-text">${esc(ratingLabel)} &middot; ${pct}%</div>
        </div>
        <div class="score-right">
          <span class="score-value">${esc(result.average)}</span>
          <span class="score-max">/ 5.0</span>
        </div>
      </div>
    </div>

    ${noticeBlock}

    <div class="thanks-action">
      <button type="button" onclick="window.close()" class="btn-close">Close This Window</button>
      <p class="close-hint">You can safely close this browser tab.</p>
    </div>
  </div>
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
  const isAlreadySubmitted = /already submitted/i.test(message || '');
  const isExpired = /expired/i.test(message || '');
  const isPaused = /paused/i.test(message || '');

  let iconHtml = '';
  let title = 'Unable to Open Evaluation';
  let subtitle = 'We could not verify this evaluation link.';
  let cardContentHtml = '';

  if (isAlreadySubmitted) {
    iconHtml = `
      <div class="success-icon-wrap">
        <svg class="success-icon" viewBox="0 0 48 48" fill="none">
          <circle cx="24" cy="24" r="22" fill="#e8f1d7" stroke="#5c8727" stroke-width="3"/>
          <path d="M14 24L21 31L34 17" stroke="#5c8727" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>`;
    title = 'Evaluation Already Submitted';
    subtitle = 'This evaluation has already been completed.';
    cardContentHtml = `
      <div class="summary-box">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-weight:700;font-size:14px;color:#1f2a17">Submission Record</span>
          <span class="decision-badge confirmed">Submitted</span>
        </div>
        <p style="margin:0;font-size:14.5px;color:#374151;line-height:1.6">${esc(message)}</p>
      </div>
      <div class="notice-box notice-success">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
        <div>
          <strong>No further action required</strong>
          <div>Your ratings and feedback are securely saved. You can safely close this window.</div>
        </div>
      </div>`;
  } else if (isExpired) {
    iconHtml = `
      <div class="error-icon-wrap" style="background:#fdefdd">
        <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="#e08113" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>`;
    title = 'Evaluation Link Expired';
    subtitle = 'The response window for this evaluation link has closed.';
    cardContentHtml = `
      <div class="notice-box notice-warning">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
        <div>
          <strong>Need a fresh link?</strong>
          <div>${esc(message)} Please reach out to the HR team if you still need to complete this review.</div>
        </div>
      </div>`;
  } else if (isPaused) {
    iconHtml = `
      <div class="error-icon-wrap" style="background:#e8effd">
        <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="10" y1="15" x2="10" y2="9"/><line x1="14" y1="15" x2="14" y2="9"/></svg>
      </div>`;
    title = 'Evaluation On Hold';
    subtitle = 'Evaluations for this employee are currently paused.';
    cardContentHtml = `
      <div class="notice-box" style="background:#e8effd;border:1px solid #bfdbfe;color:#1e3a8a">
        <svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div>
          <strong>Paused by HR</strong>
          <div>${esc(message)} No evaluation submission is accepted at this time.</div>
        </div>
      </div>`;
  } else {
    iconHtml = `
      <div class="error-icon-wrap">
        <svg class="error-icon" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      </div>`;
    title = status === 410 ? 'Evaluation Link Inactive' : 'Unable to Open Evaluation';
    subtitle = esc(message);
    cardContentHtml = `
      <div class="notice-box notice-error">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div>
          <strong>Need assistance?</strong>
          <div>If you believe this is a mistake or need a fresh link, please contact the <strong>AAPNA HR Team</strong>.</div>
        </div>
      </div>`;
  }

  return page(
    title,
    `
<header class="header-compact">
  <div class="wrap">
    <div class="brand">
      <img src="https://www.aapnainfotech.com/wp-content/uploads/2021/09/aapna-gptw-black.png" width="170" alt="AAPNA Infotech">
    </div>
    <p class="header-tag">AAPNA Infotech &middot; Performance Evaluation System</p>
  </div>
</header>

<div class="wrap wrap-thanks">
  <div class="thanks-card">
    ${iconHtml}
    <h1 class="thanks-title">${title}</h1>
    <p class="thanks-subtitle">${subtitle}</p>

    ${cardContentHtml}

    <div class="thanks-action">
      <button type="button" onclick="window.close()" class="btn-close">Close This Window</button>
      <p class="close-hint">You can safely close this browser tab.</p>
    </div>
  </div>
</div>`
  );
}

// Imported at the bottom to keep the rendering functions at the top of the file.
import {
  RATING_SCALE as RATING_ROWS,
  CONFIRMATION_OPTIONS as CONFIRMATION_ROWS,
  REASON_MAX,
} from '../config/ratingScale.js';
