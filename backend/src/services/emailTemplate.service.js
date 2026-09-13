/**
 * emailTemplate.service.js — the bodies managers actually receive.
 *
 * Wording, layout and the rating table are carried over from the exported
 * Power Automate flow so cutover is invisible to the recipient (plan R9). The
 * greeting, the "As per the performance evaluation process at AAPNA…" sentence,
 * the period line and the rating structure table are all as they were.
 *
 * Two things deliberately changed, and both remove a step the manager used to
 * have to get right:
 *
 *   - The old "Points to be followed" told them to copy the employee's email
 *     into the form and pick the evaluation number by hand. The token carries
 *     both now, so that instruction is gone.
 *   - The employee's name and the period are stated in the button context
 *     rather than only in prose, because the form now shows them too.
 *
 * Defaults live here; overrides live in pea_settings under
 * `template.<key>.subject` / `.body`, so HR can reword without a deployment —
 * the same "changeable without development" principle behind
 * pea_evaluation_params.
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import { formatDisplay } from '../utils/dateUtils.js';
import { RATING_SCALE } from '../config/ratingScale.js';

/** Shared CSS, lifted from the flow's `Styling` compose action. */
const STYLE = `
  body, table, th, td { font-family: Calibri, sans-serif; font-size: 14.2px; line-height: 1.4; color:#22272b; }
  table.r { border-collapse: collapse; width: auto; margin: 8px 0 14px; }
  table.r th, table.r td { border: 1px solid #ccc; padding: 7px 10px; text-align: left; }
  table.r th { background-color: #345C72; color: white; }
  .btn { display:inline-block; background:#345C72; color:#ffffff !important; text-decoration:none;
         padding:12px 26px; border-radius:5px; font-weight:bold; }
  .muted { color:#5b6b78; }
`;

/**
 * Plain-text signature.
 *
 * The original embedded a base64 logo and half a dozen Outlook safelink-wrapped
 * social icons — tens of kilobytes on every send, and the safelinks were tied
 * to one sender's tenant rewrite. A text signature says the same thing, renders
 * everywhere, and keeps the message small.
 */
const SIGNATURE = `
  <p style="margin-top:22px">
    <strong style="color:#414042">Thanks &amp; Regards,</strong><br>
    <span style="color:#414042">AAPNA | HR Team</span>
  </p>`;

const ratingTable = () => `
  <table class="r">
    <tr><th>Rating</th><th style="text-align:center">Score</th><th style="text-align:center">%age</th></tr>
    ${RATING_SCALE.map(
      (r) =>
        `<tr><td>${r.label} <span class="muted">(${r.detail})</span></td>
             <td style="text-align:center"><strong>${r.value}</strong></td>
             <td style="text-align:center">${r.percent}</td></tr>`
    ).join('')}
  </table>`;

const shell = (inner) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLE}</style></head>
   <body>${inner}${SIGNATURE}</body></html>`;

/** Built-in templates. Each returns { subject, body }. */
const TEMPLATES = {
  /** The evaluation request — the flow's "Evaluation N" email. */
  evaluation_link: (v) => ({
    subject: `Performance Evaluation ${v.seqNo} - ${v.employeeName}`,
    body: shell(`
      <p>Hello ${v.rmName},</p>
      <p>Greetings!</p>
      <p>As per the performance evaluation process at AAPNA, we request you to evaluate the
         performance of <strong>${v.employeeName}</strong> (email id: ${v.officeEmail})
         who joined us on <strong>${v.dojLabel}</strong>.</p>
      <p>Evaluation will be done on the parameters shared in the form for
         <strong>${v.periodLabel}</strong>.</p>

      <p style="margin:22px 0"><a class="btn" href="${v.formUrl}">Open evaluation form</a></p>
      <p class="muted" style="font-size:13px">
        If the button does not work, paste this link into your browser:<br>${v.formUrl}
      </p>

      <p><strong>Please note:</strong></p>
      <ol>
        <li>The form already knows who you are rating and which evaluation this is — there is
            nothing to fill in by hand.</li>
        <li>Please give a rating and a comment against each parameter; the comments are what
            help ${v.firstName} improve.</li>
        <li>The link can be submitted once.</li>
      </ol>

      <p><strong>Rating Structure:</strong></p>
      ${ratingTable()}`),
  }),

  /** Reminder. Same link, shorter body. */
  reminder: (v) => ({
    subject: `Reminder ${v.reminderNumber} - Performance Evaluation ${v.seqNo} - ${v.employeeName}`,
    body: shell(`
      <p>Hello ${v.rmName},</p>
      <p>This is a gentle reminder that the performance evaluation for
         <strong>${v.employeeName}</strong> covering <strong>${v.periodLabel}</strong>
         is still awaiting your response.</p>
      <p>It was sent on ${v.sentLabel}.</p>

      <p style="margin:22px 0"><a class="btn" href="${v.formUrl}">Open evaluation form</a></p>
      <p class="muted" style="font-size:13px">
        If the button does not work, paste this link into your browser:<br>${v.formUrl}
      </p>

      <p>If you have already responded, please ignore this message.</p>`),
  }),

  /** HR notification when a manager submits. */
  acknowledgement: (v) => ({
    subject: `Performance Evaluation ${v.seqNo} submitted - ${v.employeeName}`,
    body: shell(`
      <p>Hello,</p>
      <p><strong>${v.submittedBy || v.rmName}</strong> has submitted performance evaluation
         ${v.seqNo} for <strong>${v.employeeName}</strong>.</p>
      <table class="r">
        <tr><th>Employee</th><td>${v.employeeName}</td></tr>
        <tr><th>Evaluation</th><td>${v.seqNo}</td></tr>
        <tr><th>Period</th><td>${v.periodLabel}</td></tr>
        <tr><th>Average rating</th><td><strong>${v.average} / 5</strong></td></tr>
        ${v.confirmation ? `<tr><th>Decision</th><td><strong>${v.confirmation}</strong></td></tr>` : ''}
      </table>
      ${v.remarks ? `<p><strong>Overall remarks:</strong><br>${v.remarks}</p>` : ''}`),
  }),

  /** The flow's "Alert - Performance Evaluation Extended" email. */
  extend_alert: (v) => ({
    subject: `Alert - Performance Evaluation extended for ${v.employeeName}`,
    body: shell(`
      <p>Hello,</p>
      <p>The probation period for <strong>${v.employeeName}</strong> has been
         <strong>${v.confirmation}</strong> by ${v.submittedBy || v.rmName}.</p>
      <p>${v.extensionCycles} further evaluation${v.extensionCycles === 1 ? '' : 's'}
         ${v.extensionCycles === 1 ? 'has' : 'have'} been scheduled automatically, and the
         reporting manager will receive a link when ${v.extensionCycles === 1 ? 'it is' : 'they are'} due.</p>`),
  }),

  /** Generic HR notice. */
  hr_notification: (v) => ({
    subject: v.subject || 'Performance Evaluation notification',
    body: shell(`<p>Hello,</p><p>${v.message || ''}</p>`),
  }),

  /**
   * "Report to IT" — Entra holds a wrong value. Plan §6.5 Part 3: HR fixes it
   * locally in PEA, and this asks IT to fix it at source so every other
   * Microsoft-connected system is corrected too.
   */
  it_report: (v) => ({
    subject: `Directory correction requested — ${v.employeeName}`,
    body: shell(`
      <p>Hello IT team,</p>
      <p>HR has found a value in Microsoft Entra that appears to be wrong, and has
         corrected it locally in the Performance Evaluation system. Please update the
         directory so other systems pick up the correct value as well.</p>
      <table class="r">
        <tr><th>Employee</th><td>${esc(v.employeeName)}</td></tr>
        <tr><th>Account</th><td>${esc(v.accountEmail)}</td></tr>
        <tr><th>Field</th><td>${esc(v.fieldLabel)}</td></tr>
        <tr><th>Entra currently holds</th><td>${esc(v.azureValue) || '<em>(blank)</em>'}</td></tr>
        <tr><th>Correct value</th><td><strong>${esc(v.correctValue)}</strong></td></tr>
        <tr><th>Reported by</th><td>${esc(v.reportedBy)}</td></tr>
      </table>
      ${v.note ? `<p><strong>Note:</strong><br>${esc(v.note)}</p>` : ''}
      <p class="muted">Once the directory is updated, HR can unlock the field in PEA and it
         will follow Entra again.</p>`),
  }),

  /** A reporting manager's "my team" link. */
  manager_portal: (v) => ({
    subject: 'Your team’s performance evaluations',
    body: shell(`
      <p>Hello ${esc(v.rmName) || ''},</p>
      <p>You can now see every performance evaluation for the people who report to you in
         one place — what is due, what is waiting for you, and what you have already
         submitted.</p>
      <p style="margin:22px 0"><a class="btn" href="${v.portalUrl}">Open my team</a></p>
      <p class="muted" style="font-size:13px">
        If the button does not work, paste this link into your browser:<br>${v.portalUrl}
      </p>
      <p class="muted">No login is needed. The link is personal to you and expires on
         ${esc(v.expiresLabel)}.</p>`),
  }),

  /** Daily HR digest of probations past their confirmation deadline. Plan §2.7. */
  deadline_alert: (v) => ({
    subject: `${(v.overdue || []).length} probation(s) past the confirmation deadline`,
    body: shell(`
      <p>Hello,</p>
      <p>The following probations have passed their confirmation deadline — 6 months from
         the date of joining, or 8 once extended — with no final decision recorded.</p>
      <table class="r">
        <tr><th>Employee</th><th>Joined</th><th>Deadline</th><th>Days overdue</th><th>Manager</th></tr>
        ${(v.overdue || [])
          .map(
            (e) => `<tr><td>${esc(e.full_name)}</td><td>${e.doj}</td><td>${e.deadline}</td>
                        <td style="text-align:center"><strong>${e.daysOverdue}</strong></td>
                        <td>${esc(e.rm_name)}</td></tr>`
          )
          .join('')}
      </table>
      ${
        (v.dueSoon || []).length
          ? `<p>A further <strong>${v.dueSoon.length}</strong> reach their deadline within two weeks.</p>`
          : ''
      }`),
  }),
};

/** Escape a value for HTML. Several of the new templates carry HR-typed text. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Substitute {{placeholders}} in an HR-supplied override.
 * @param {string} text
 * @param {object} vars
 * @returns {string}
 */
function interpolate(text, vars) {
  return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) =>
    vars[key] === undefined || vars[key] === null ? '' : String(vars[key])
  );
}

/**
 * Build the variables every template can use.
 * @param {object} cycle - with `employee` included
 * @param {object} [extra]
 * @returns {object}
 */
export function buildVars(cycle, extra = {}) {
  const employee = cycle.employee || {};
  const base = config.frontendUrl.replace(/\/$/, '');

  return {
    employeeName: employee.full_name,
    firstName: (employee.full_name || '').split(' ')[0],
    officeEmail: employee.office_email,
    dojLabel: employee.doj ? formatDisplay(employee.doj) : '',
    rmName: employee.rm_name,
    rmEmail: employee.rm_email,
    plEmail: employee.pl_email,
    seqNo: cycle.seq_no,
    isExtension: cycle.is_extension,
    periodLabel:
      cycle.period_from && cycle.period_to
        ? `${formatDisplay(cycle.period_from)} to ${formatDisplay(cycle.period_to)}`
        : '',
    dueLabel: cycle.due_date ? formatDisplay(cycle.due_date) : '',
    sentLabel: cycle.sent_at ? formatDisplay(cycle.sent_at) : '',
    // The public form lives on the API host, not the SPA — it is server
    // rendered. Managers must reach it without a login.
    formUrl: `${base.replace(/\/+$/, '')}/api/evaluation/${cycle.token}`,
    ...extra,
  };
}

/**
 * Render a template, applying any pea_settings override.
 * @param {string} key - template key
 * @param {object} vars
 * @returns {Promise<{subject: string, body: string}>}
 */
export async function render(key, vars) {
  const builder = TEMPLATES[key];
  if (!builder) throw new Error(`Unknown email template "${key}"`);

  const built = builder(vars);

  const overrides = await prisma.pea_settings.findMany({
    where: { setting_key: { in: [`template.${key}.subject`, `template.${key}.body`] } },
  });

  const bySuffix = Object.fromEntries(
    overrides.map((o) => [o.setting_key.split('.').pop(), o.setting_value])
  );

  return {
    subject: bySuffix.subject ? interpolate(bySuffix.subject, vars) : built.subject,
    body: bySuffix.body ? shell(interpolate(bySuffix.body, vars)) : built.body,
  };
}

/** Template keys, for the admin screen. */
export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

/**
 * What each template is, which {{variables}} an override may use, and whether
 * it can be overridden at all.
 *
 * deadline_alert is not overridable: its body is a table built from a list, and
 * the {{placeholder}} syntax has no loops — an override could only ever drop
 * the list, which is the whole message.
 */
export const TEMPLATE_CATALOG = Object.freeze({
  evaluation_link: {
    label: 'Evaluation request (to reporting manager)',
    editable: true,
    variables: ['employeeName', 'firstName', 'officeEmail', 'dojLabel', 'rmName', 'seqNo', 'periodLabel', 'dueLabel', 'formUrl'],
  },
  reminder: {
    label: 'Reminder (to reporting manager)',
    editable: true,
    variables: ['employeeName', 'rmName', 'seqNo', 'periodLabel', 'sentLabel', 'reminderNumber', 'formUrl'],
  },
  acknowledgement: {
    label: 'Evaluation submitted (to HR)',
    editable: true,
    variables: ['employeeName', 'seqNo', 'periodLabel', 'average', 'confirmation', 'remarks', 'submittedBy', 'rmName'],
  },
  extend_alert: {
    label: 'Probation extended (to HR)',
    editable: true,
    variables: ['employeeName', 'confirmation', 'extensionCycles', 'submittedBy', 'rmName'],
  },
  hr_notification: { label: 'General HR notice', editable: true, variables: ['subject', 'message'] },
  it_report: {
    label: 'Report to IT',
    editable: true,
    variables: ['employeeName', 'accountEmail', 'fieldLabel', 'azureValue', 'correctValue', 'reportedBy', 'note'],
  },
  manager_portal: {
    label: 'Manager portal link (to reporting manager)',
    editable: true,
    variables: ['rmName', 'portalUrl', 'expiresLabel'],
  },
  deadline_alert: { label: 'Confirmation deadline digest (to HR)', editable: false, variables: [] },
});

/** Realistic sample values, so a preview reads like the real thing. */
const SAMPLE_VARS = {
  employeeName: 'Priya Sharma',
  firstName: 'Priya',
  officeEmail: 'psharma@aapnainfotech.com',
  dojLabel: '01-Jul-2026',
  rmName: 'Chhavi Verma',
  rmEmail: 'cverma@aapnainfotech.com',
  seqNo: 2,
  periodLabel: '31-Jul-2026 to 30-Aug-2026',
  dueLabel: '31-Aug-2026',
  sentLabel: '31-Aug-2026',
  reminderNumber: 1,
  formUrl: 'https://pea-staging.aapnainfotech.com/api/evaluation/00000000-0000-0000-0000-000000000000',
  average: '3.71',
  confirmation: 'Extend for 1 month',
  remarks: 'Strong progress on delivery; communication with the client still developing.',
  submittedBy: 'cverma@aapnainfotech.com',
  extensionCycles: 1,
  subject: 'Sample notice',
  message: 'This is how a general HR notice will look.',
  accountEmail: 'psharma@aapnainfotech.com',
  fieldLabel: 'Display name',
  azureValue: 'Priya S',
  correctValue: 'Priya Sharma',
  reportedBy: 'pankaj',
  note: 'Surname missing in Entra.',
  portalUrl: 'https://pea-staging.aapnainfotech.com/manager/00000000-0000-0000-0000-000000000000',
  expiresLabel: '13-Oct-2026',
  overdue: [
    { full_name: 'Pooja Goel', doj: '2022-09-20', deadline: '2023-03-20', daysOverdue: 1272, rm_name: 'Aroy' },
  ],
  dueSoon: [],
};

/**
 * Render a template for preview, with an unsaved override applied.
 * @param {string} key
 * @param {{subject?: string, body?: string}} [draft] - blank fields fall back to the built-in
 * @returns {{subject: string, body: string}}
 */
export function renderPreview(key, draft = {}) {
  const builder = TEMPLATES[key];
  if (!builder) throw new Error(`Unknown email template "${key}"`);
  const built = builder(SAMPLE_VARS);
  return {
    subject: draft.subject ? interpolate(draft.subject, SAMPLE_VARS) : built.subject,
    body: draft.body ? shell(interpolate(draft.body, SAMPLE_VARS)) : built.body,
  };
}
