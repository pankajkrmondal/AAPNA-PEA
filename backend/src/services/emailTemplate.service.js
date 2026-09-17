/**
 * emailTemplate.service.js — every email PEA sends, editable from the site.
 *
 * Each template is a SUBJECT and a BODY FRAGMENT containing {{placeholders}}.
 * The AAPNA header, logo, sign-off and footer are added by
 * emailLayout.service.js at send time — the same shell ATS uses — so HR edits
 * only the wording and can never break the design. The default wording is the
 * text carried over from the Power Automate flows (plan R9).
 *
 * Storage: an edit is saved in pea_settings as `template.<key>.subject` and
 * `template.<key>.body`. With no row the built-in default below is used, and
 * "Reset to default" deletes the rows. No table of its own, so no DDL.
 *
 * Placeholders come in two kinds:
 *   - text   {{employee_name}} — HTML-escaped when inserted, so a name, a
 *            remark or a note typed by someone can never inject markup;
 *   - blocks {{form_button}}, {{rating_table}}, {{overdue_table}} … — HTML the
 *            code builds (a button carrying the live link, a table built from
 *            a list). HR places, moves or deletes them like any other word.
 *            This is what makes even the deadline digest editable: its list is
 *            one block. The same idea as {{teams_line}} in ATS.
 */
import prisma from '../config/database.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import { formatDisplay } from '../utils/dateUtils.js';
import { RATING_SCALE } from '../config/ratingScale.js';
import { wrapBrandedEmail, brandedWrapperParts, BRAND } from './emailLayout.service.js';

/** Escape a value for HTML. */
function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const TOKEN = /\{\{\s*(\w+)\s*\}\}/g;

/** Placeholder names used in a piece of text. */
export function usedPlaceholders(text) {
  return [...String(text || '').matchAll(TOKEN)].map((m) => m[1]);
}

/** What each placeholder is, for the editor. `block` = HTML built by the code. */
export const PLACEHOLDERS = Object.freeze({
  employee_name: { label: 'Employee name' },
  first_name: { label: 'Employee first name' },
  employee_email: { label: 'Employee office email' },
  joining_date: { label: 'Date of joining' },
  manager_name: { label: 'Reporting manager name' },
  manager_email: { label: 'Reporting manager email' },
  project_leader_email: { label: 'Project leader email' },
  evaluation_number: { label: 'Evaluation number (1, 2, 3 …)' },
  evaluation_period: { label: 'Period being evaluated' },
  due_date: { label: 'Evaluation due date' },
  sent_date: { label: 'Date the evaluation was sent' },
  reminder_number: { label: 'Reminder number (1 or 2)' },
  form_link: { label: 'Evaluation form link, as plain text' },
  form_button: { label: 'Green "Open evaluation form" button with the link', block: true },
  rating_table: { label: 'Rating structure table (1–5)', block: true },
  average_rating: { label: 'Average rating given' },
  decision: { label: 'Confirmation decision (Confirmed, Extend for 1 month …)' },
  submitted_by: { label: 'Who submitted the evaluation' },
  remarks: { label: 'Manager’s overall remarks' },
  evaluation_summary_table: { label: 'Table: employee, evaluation, period, average, decision', block: true },
  remarks_block: { label: '"Overall remarks" paragraph — only when there are remarks', block: true },
  extension_summary: { label: 'Sentence saying how many extra evaluations were scheduled' },
  account_email: { label: 'Microsoft account email' },
  field_label: { label: 'Which field is wrong' },
  entra_value: { label: 'Value Microsoft Entra holds now' },
  correct_value: { label: 'Correct value' },
  reported_by: { label: 'Who reported it' },
  note: { label: 'Note for IT' },
  it_details_table: { label: 'Table: employee, account, field, current and correct value', block: true },
  note_block: { label: '"Note" paragraph — only when a note was written', block: true },
  portal_link: { label: 'Manager portal link, as plain text' },
  portal_button: { label: 'Green "Open my team" button with the link', block: true },
  expires_date: { label: 'Date the link expires' },
  overdue_count: { label: 'Number of overdue probations' },
  due_soon_count: { label: 'Number due within two weeks' },
  today: { label: 'Today’s date' },
  overdue_table: { label: 'Table of every overdue probation', block: true },
  due_soon_line: { label: '"A further N reach their deadline…" — only when there are some', block: true },

  // R-03 — Microsoft 365 check alert.
  problem_count: { label: 'Number of problems found' },
  headline: { label: 'One sentence saying what was found' },
  problem_table: { label: 'Table: what is wrong, who it is about, what it means', block: true },
  what_to_do: { label: '"What to do" paragraph — only when something is fixable by hand', block: true },
  scan_summary: { label: 'Table: accounts read, people checked, joiners found, leavers flagged', block: true },

  // R-05 — shared evaluation report.
  shared_by: { label: 'Who shared the report' },
  report_header_table: { label: 'Table: employee, manager, joined, type, decision, progress', block: true },
  report_history_table: { label: 'Table of every submitted evaluation with its average and remarks', block: true },
});

export const CATEGORY_LABELS = Object.freeze({
  manager: 'To reporting manager',
  hr: 'To HR',
  it: 'To IT',
});

/** The built-in templates, in the order the screen lists them. */
const TEMPLATES = Object.freeze({
  evaluation_link: {
    name: 'Evaluation request',
    category: 'manager',
    recipient: 'Reporting manager · CC project leader and the CC list',
    description: 'Sent when an evaluation is due.',
    placeholders: [
      'employee_name', 'first_name', 'employee_email', 'joining_date', 'manager_name', 'project_leader_email',
      'evaluation_number', 'evaluation_period', 'due_date', 'form_link', 'form_button', 'rating_table',
    ],
    requiredAny: [['form_button', 'form_link']],
    subject: 'Performance Evaluation {{evaluation_number}} - {{employee_name}}',
    body: `<p>Hello {{manager_name}},</p>
<p>Greetings!</p>
<p>As per the performance evaluation process at AAPNA, we request you to evaluate the performance of <strong>{{employee_name}}</strong> (email id: {{employee_email}}) who joined us on <strong>{{joining_date}}</strong>.</p>
<p>Evaluation will be done on the parameters shared in the form for <strong>{{evaluation_period}}</strong>.</p>
{{form_button}}
<p><strong>Please note:</strong></p>
<ol>
<li>The form already knows who you are rating and which evaluation this is — there is nothing to fill in by hand.</li>
<li>Please give a rating and a comment against each parameter; the comments are what help {{first_name}} improve.</li>
<li>The link can be submitted once.</li>
</ol>
<p><strong>Rating Structure:</strong></p>
{{rating_table}}`,
  },

  reminder: {
    name: 'Evaluation reminder',
    category: 'manager',
    recipient: 'Reporting manager · CC project leader and the CC list',
    description: 'Sent when an evaluation is still not submitted (reminder 1 and 2).',
    placeholders: [
      'employee_name', 'first_name', 'manager_name', 'evaluation_number', 'evaluation_period', 'sent_date',
      'reminder_number', 'form_link', 'form_button', 'rating_table',
    ],
    requiredAny: [['form_button', 'form_link']],
    subject: 'Reminder {{reminder_number}} - Performance Evaluation {{evaluation_number}} - {{employee_name}}',
    body: `<p>Hello {{manager_name}},</p>
<p>This is a gentle reminder that the performance evaluation for <strong>{{employee_name}}</strong> covering <strong>{{evaluation_period}}</strong> is still awaiting your response.</p>
<p>It was sent on {{sent_date}}.</p>
{{form_button}}
<p>If you have already responded, please ignore this message.</p>`,
  },

  manager_portal: {
    name: 'Manager portal link',
    category: 'manager',
    recipient: 'Reporting manager',
    description: 'Sent when HR issues a manager their "my team" link.',
    placeholders: ['manager_name', 'portal_link', 'portal_button', 'expires_date'],
    requiredAny: [['portal_button', 'portal_link']],
    subject: 'Your team’s performance evaluations',
    body: `<p>Hello {{manager_name}},</p>
<p>You can now see every performance evaluation for the people who report to you in one place — what is due, what is waiting for you, and what you have already submitted.</p>
{{portal_button}}
<p>No login is needed. The link is personal to you and expires on {{expires_date}}.</p>`,
  },

  acknowledgement: {
    name: 'Evaluation submitted',
    category: 'hr',
    recipient: 'HR notification recipients',
    description: 'Sent when a manager submits an evaluation.',
    placeholders: [
      'employee_name', 'first_name', 'employee_email', 'manager_name', 'evaluation_number', 'evaluation_period',
      'average_rating', 'decision', 'submitted_by', 'remarks', 'evaluation_summary_table', 'remarks_block',
    ],
    requiredAny: [],
    subject: 'Performance Evaluation {{evaluation_number}} submitted - {{employee_name}}',
    body: `<p>Hello,</p>
<p><strong>{{submitted_by}}</strong> has submitted performance evaluation {{evaluation_number}} for <strong>{{employee_name}}</strong>.</p>
{{evaluation_summary_table}}
{{remarks_block}}`,
  },

  extend_alert: {
    name: 'Probation extended',
    category: 'hr',
    recipient: 'HR notification recipients',
    description: 'Sent when a manager extends a probation.',
    placeholders: [
      'employee_name', 'first_name', 'manager_name', 'evaluation_number', 'decision', 'submitted_by', 'extension_summary',
    ],
    requiredAny: [],
    subject: 'Alert - Probation extended for {{employee_name}}',
    body: `<p>Hello,</p>
<p>The probation period for <strong>{{employee_name}}</strong> has been extended — <strong>{{decision}}</strong> — by {{submitted_by}}.</p>
<p>{{extension_summary}}</p>`,
  },

  deadline_alert: {
    name: 'Confirmation deadline digest',
    category: 'hr',
    recipient: 'HR notification recipients',
    description: 'Daily list of probations past their confirmation deadline (when switched on in Settings).',
    placeholders: ['overdue_count', 'due_soon_count', 'today', 'overdue_table', 'due_soon_line'],
    requiredAny: [['overdue_table']],
    subject: '{{overdue_count}} probation(s) past the confirmation deadline — {{today}}',
    body: `<p>Hello,</p>
<p>The following probations have passed their confirmation deadline — 6 months from the date of joining, or 8 once extended — with no final decision recorded.</p>
{{overdue_table}}
{{due_soon_line}}`,
  },

  evaluation_report: {
    name: 'Evaluation report shared',
    category: 'hr',
    recipient: 'Whoever HR sends it to · CC as chosen',
    description:
      'Sent when HR shares one person\'s evaluation record from the employee page. Subhajit, ' +
      '15 Sep: a senior leader asks for a resource\'s current status and HR answers "within one click".',
    placeholders: [
      'employee_name', 'manager_name', 'joining_date', 'decision', 'shared_by', 'note',
      'report_header_table', 'report_history_table', 'note_block', 'today',
    ],
    requiredAny: [['report_history_table', 'report_header_table']],
    subject: 'Evaluation report — {{employee_name}}',
    body: `<p>Hello,</p>
<p>Here is the evaluation record for <strong>{{employee_name}}</strong> so far, shared by {{shared_by}}.</p>
{{note_block}}
{{report_header_table}}
{{report_history_table}}
<p>The attached spreadsheet has the same information, plus every parameter score and the manager's comments.</p>`,
  },

  sync_alert: {
    name: 'Microsoft 365 check alert',
    category: 'hr',
    recipient: 'HR notification recipients',
    description:
      'Sent when the nightly Microsoft 365 check fails, or finds records it cannot use. The point ' +
      'is that a silent failure becomes a missed evaluation nobody notices — Subhajit, 15 Sep: ' +
      '"if any data is not being synced properly from the AD, we should be getting an email alert".',
    placeholders: [
      'today', 'problem_count', 'headline', 'problem_table', 'what_to_do', 'scan_summary',
    ],
    requiredAny: [['problem_table', 'headline']],
    subject: 'Microsoft 365 check needs attention — {{today}}',
    body: `<p>Hello,</p>
<p>{{headline}}</p>
{{problem_table}}
{{what_to_do}}
{{scan_summary}}
<p>This alert is sent once per problem. It will not repeat every night for the same record.</p>`,
  },

  it_report: {
    name: 'Report to IT',
    category: 'it',
    recipient: '"Report to IT" recipients · CC HR',
    description: 'Sent when HR reports a wrong value in Microsoft Entra.',
    placeholders: [
      'employee_name', 'account_email', 'field_label', 'entra_value', 'correct_value', 'reported_by', 'note',
      'it_details_table', 'note_block',
    ],
    requiredAny: [['it_details_table', 'correct_value']],
    subject: 'Directory correction requested — {{employee_name}}',
    body: `<p>Hello IT team,</p>
<p>HR has found a value in Microsoft Entra that appears to be wrong, and has corrected it locally in the Performance Evaluation system. Please update the directory so other systems pick up the correct value as well.</p>
{{it_details_table}}
{{note_block}}
<p>Once the directory is updated, HR can unlock the field in PEA and it will follow Entra again.</p>`,
  },
});

export const TEMPLATE_DEFS = TEMPLATES;
export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

// ── Blocks — the HTML the code builds ─────────────────────────────────────

const TH = `background:${BRAND.accent};color:#ffffff;border:1px solid #d1d5db;padding:8px 12px;text-align:left;font-size:14px`;
const TD = `border:1px solid #d1d5db;padding:8px 12px;font-size:14px;color:${BRAND.text}`;

const table = (rows) =>
  `<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:10px 0 16px 0">${rows}</table>`;

const pairs = (list) => list.map(([k, v]) => `<tr><th style="${TH}">${k}</th><td style="${TD}">${v}</td></tr>`).join('');

const multiline = (text) => esc(text).replace(/\r?\n/g, '<br>');

function button(url, label) {
  if (!url) return '';
  return `<p style="margin:22px 0 10px 0"><a href="${esc(url)}" style="background:${BRAND.accent};color:#ffffff;padding:12px 26px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block">${label}</a></p>`
    + `<p style="margin:0 0 16px 0;font-size:13px;color:${BRAND.muted}">If the button does not work, paste this link into your browser:<br>`
    + `<a href="${esc(url)}" style="color:${BRAND.accent};word-break:break-all">${esc(url)}</a></p>`;
}

function buildBlocks(v) {
  const overdue = v._overdue || [];
  const dueSoon = v._dueSoon || [];

  return {
    form_button: button(v.form_link, 'Open evaluation form'),
    portal_button: button(v.portal_link, 'Open my team'),

    rating_table: table(
      `<tr><th style="${TH}">Rating</th><th style="${TH};text-align:center">Score</th><th style="${TH};text-align:center">%age</th></tr>`
        + RATING_SCALE.map(
          (r) => `<tr><td style="${TD}">${esc(r.label)} <span style="color:${BRAND.muted}">(${esc(r.detail)})</span></td>`
            + `<td style="${TD};text-align:center"><strong>${r.value}</strong></td>`
            + `<td style="${TD};text-align:center">${r.percent}</td></tr>`
        ).join('')
    ),

    evaluation_summary_table: table(pairs([
      ['Employee', esc(v.employee_name)],
      ['Evaluation', esc(v.evaluation_number)],
      ['Period', esc(v.evaluation_period)],
      ['Average rating', `<strong>${esc(v.average_rating || '—')} / 5</strong>`],
      ...(v.decision ? [['Decision', `<strong>${esc(v.decision)}</strong>`]] : []),
    ])),

    remarks_block: v.remarks ? `<p><strong>Overall remarks:</strong><br>${multiline(v.remarks)}</p>` : '',

    it_details_table: table(pairs([
      ['Employee', esc(v.employee_name)],
      ['Account', esc(v.account_email)],
      ['Field', esc(v.field_label)],
      ['Entra currently holds', v.entra_value ? esc(v.entra_value) : '<em>(blank)</em>'],
      ['Correct value', `<strong>${esc(v.correct_value)}</strong>`],
      ['Reported by', esc(v.reported_by)],
    ])),

    note_block: v.note ? `<p><strong>Note:</strong><br>${multiline(v.note)}</p>` : '',

    overdue_table: overdue.length
      ? table(
        `<tr><th style="${TH}">Employee</th><th style="${TH}">Joined</th><th style="${TH}">Deadline</th><th style="${TH};text-align:center">Days overdue</th><th style="${TH}">Manager</th></tr>`
          + overdue.map(
            (e) => `<tr><td style="${TD}">${esc(e.full_name)}</td><td style="${TD}">${esc(e.doj)}</td><td style="${TD}">${esc(e.deadline)}</td>`
              + `<td style="${TD};text-align:center"><strong>${esc(e.daysOverdue)}</strong></td><td style="${TD}">${esc(e.rm_name)}</td></tr>`
          ).join('')
      )
      : '<p><em>No probation is past its confirmation deadline.</em></p>',

    due_soon_line: dueSoon.length
      ? `<p>A further <strong>${dueSoon.length}</strong> reach their deadline within two weeks.</p>`
      : '',

    // ── R-03: the Microsoft 365 check alert ──────────────────────────────
    problem_table: (v._problems || []).length
      ? table(
        `<tr><th style="${TH}">What is wrong</th><th style="${TH}">Who or what</th><th style="${TH}">What it means</th></tr>`
          + v._problems.map(
            (p) => `<tr><td style="${TD}"><strong>${esc(p.title)}</strong></td>`
              + `<td style="${TD}">${esc(p.subject || '—')}</td>`
              + `<td style="${TD}">${esc(p.detail)}</td></tr>`
          ).join('')
      )
      : '',

    what_to_do: (v._problems || []).some((p) => p.fixable)
      ? `<p><strong>What to do:</strong> add the missing people by hand on the New joiners screen, `
        + `or upload the sheet with their details. Everything else carries on as normal.</p>`
      : '',

    // ── R-05: the shared evaluation report ───────────────────────────────
    report_header_table: v._report
      ? table(pairs([
        ['Employee', esc(v._report.employee.name)],
        ['Reporting manager', esc(v._report.employee.rmName || '—')],
        ['Joined', esc(v.joining_date || '—')],
        ['Type', esc(v._report.employee.cohort)],
        ['Probation decision', `<strong>${esc(v._report.employee.confirmationStatus || 'In probation')}</strong>`],
        ['Evaluations submitted', `${v._report.completedCount} of ${v._report.totalCount}`],
      ]))
      : '',

    report_history_table: v._report && v._report.cycles.some((c) => c.status === 'completed')
      ? table(
        `<tr><th style="${TH}">Evaluation</th><th style="${TH}">Submitted</th>`
          + `<th style="${TH};text-align:center">Average</th><th style="${TH}">Decision</th><th style="${TH}">Remarks</th></tr>`
          + v._report.cycles
            .filter((c) => c.status === 'completed')
            .map((c) => {
              const label = c.isExtension ? `${c.seqNo} (extension)` : c.seqNo;
              // Real cycles carry a Date; the preview's samples carry strings.
              const when = c.submittedAt ? formatDisplay(new Date(c.submittedAt)) : '—';
              return `<tr><td style="${TD}">${esc(label)}</td>`
                + `<td style="${TD}">${esc(when)}</td>`
                + `<td style="${TD};text-align:center"><strong>${c.avgRating ?? '—'}</strong></td>`
                + `<td style="${TD}">${esc(c.confirmationStatus || '—')}</td>`
                + `<td style="${TD}">${c.remarks ? multiline(c.remarks) : '—'}</td></tr>`;
            })
            .join('')
      )
      : '<p><em>No evaluation has been submitted yet.</em></p>',

    scan_summary: v._scan
      ? table(pairs([
        ['Accounts read from Microsoft 365', esc(v._scan.accountsFetched ?? '—')],
        ['People checked', esc(v._scan.employeesChecked ?? '—')],
        ['New joiners found', esc(v._scan.candidatesNew ?? 0)],
        ['Possible leavers flagged', esc(v._scan.leaversFlagged ?? 0)],
      ]))
      : '',
  };
}

// ── Variables ─────────────────────────────────────────────────────────────

/**
 * Build every placeholder value from the cycle (when there is one) and the
 * context the caller passed.
 * @param {object|null} cycle - with `employee` included
 * @param {object} [context]
 * @returns {object}
 */
export function buildVars(cycle, context = {}) {
  const c = cycle || {};
  // A shared report (R-05) has no cycle and no employee row loaded — its
  // subject is the report itself, so fall back to that rather than render an
  // email full of blanks.
  const reportEmployee = context.report?.employee;
  const e = c.employee || context.employee || (reportEmployee
    ? {
      full_name: reportEmployee.name,
      office_email: reportEmployee.email,
      doj: reportEmployee.doj,
      rm_name: reportEmployee.rmName,
      rm_email: reportEmployee.rmEmail,
      pl_email: reportEmployee.plEmail,
    }
    : {});
  const base = config.frontendUrl.replace(/\/+$/, '');
  const date = (d) => (d ? formatDisplay(d) : '');
  const average = context.average ?? context.avg;
  const extensions = Number(context.extensionCycles || 0);
  const name = e.full_name || context.employeeName || '';

  return {
    employee_name: name,
    first_name: String(name).split(' ')[0],
    employee_email: e.office_email || '',
    joining_date: date(e.doj),
    manager_name: e.rm_name || context.rmName || '',
    manager_email: e.rm_email || context.rmEmail || '',
    project_leader_email: e.pl_email || '',
    evaluation_number: c.seq_no ?? '',
    evaluation_period: c.period_from && c.period_to ? `${date(c.period_from)} to ${date(c.period_to)}` : '',
    due_date: date(c.due_date),
    sent_date: date(c.sent_at),
    reminder_number: context.reminderNumber ?? '',
    // The public form is server-rendered on the API host; managers need no login.
    form_link: c.token ? `${base}/api/evaluation/${c.token}` : '',
    average_rating: average === undefined || average === null ? '' : String(Number(average)),
    decision: context.confirmation || '',
    submitted_by: context.submittedBy || e.rm_email || '',
    remarks: context.remarks || '',
    extension_summary: extensions
      ? `${extensions} further evaluation${extensions === 1 ? ' has' : 's have'} been scheduled automatically, and the reporting manager will receive a link when ${extensions === 1 ? 'it is' : 'they are'} due.`
      : '',
    account_email: context.accountEmail || '',
    field_label: context.fieldLabel || '',
    entra_value: context.azureValue || '',
    correct_value: context.correctValue || '',
    reported_by: context.reportedBy || '',
    note: context.note || '',
    portal_link: context.portalUrl || '',
    expires_date: context.expiresLabel || '',
    overdue_count: context.overdue ? String(context.overdue.length) : '',
    due_soon_count: context.dueSoon ? String(context.dueSoon.length) : '',
    today: context.today || '',
    problem_count: context.problems ? String(context.problems.length) : '',
    headline: context.headline || '',
    _overdue: context.overdue || [],
    _dueSoon: context.dueSoon || [],
    _problems: context.problems || [],
    _scan: context.scan || null,
    shared_by: context.sharedBy || '',
    _report: context.report || null,
  };
}

/** Realistic sample values, so a preview reads like the real thing. */
const SAMPLE_VARS = Object.freeze({
  employee_name: 'Priya Sharma',
  first_name: 'Priya',
  employee_email: 'psharma@aapnainfotech.com',
  joining_date: '01-Jul-2026',
  manager_name: 'Chhavi Verma',
  manager_email: 'cverma@aapnainfotech.com',
  project_leader_email: 'aroy@aapnainfotech.com',
  evaluation_number: '2',
  evaluation_period: '31-Jul-2026 to 30-Aug-2026',
  due_date: '31-Aug-2026',
  sent_date: '31-Aug-2026',
  reminder_number: '1',
  form_link: 'https://pea-staging.aapnainfotech.com/api/evaluation/00000000-0000-0000-0000-000000000000',
  average_rating: '3.71',
  decision: 'Extend for 1 month',
  submitted_by: 'cverma@aapnainfotech.com',
  remarks: 'Strong progress on delivery; communication with the client still developing.',
  extension_summary: '1 further evaluation has been scheduled automatically, and the reporting manager will receive a link when it is due.',
  account_email: 'psharma@aapnainfotech.com',
  field_label: 'Display name',
  entra_value: 'Priya S',
  correct_value: 'Priya Sharma',
  reported_by: 'pankaj',
  note: 'Surname missing in Entra.',
  portal_link: 'https://pea-staging.aapnainfotech.com/manager/00000000-0000-0000-0000-000000000000',
  expires_date: '13-Oct-2026',
  overdue_count: '1',
  due_soon_count: '0',
  today: '13-Sep-2026',
  _overdue: [{ full_name: 'Pooja Goel', doj: '2022-09-20', deadline: '2023-03-20', daysOverdue: 1272, rm_name: 'Aroy' }],
  _dueSoon: [],
  problem_count: '2',
  headline: 'The Microsoft 365 check ran last night but 2 records could not be used.',
  _problems: [
    {
      title: 'No reporting manager',
      subject: 'Kavya Pillai',
      detail: 'Microsoft 365 has no manager for this account, so no evaluation can be sent.',
      fixable: true,
    },
    {
      title: 'No joining date',
      subject: 'Arjun Nair',
      detail: 'The account has no usable creation date, so the evaluation schedule cannot be worked out.',
      fixable: true,
    },
  ],
  _scan: { accountsFetched: 260, employeesChecked: 48, candidatesNew: 3, leaversFlagged: 1 },
  shared_by: 'subhajit',
  _report: {
    employee: {
      name: 'Priya Sharma',
      rmName: 'Chhavi Verma',
      cohort: 'Fresher',
      confirmationStatus: null,
    },
    completedCount: 3,
    totalCount: 6,
    cycles: [
      { seqNo: 1, status: 'completed', submittedAt: '2026-08-01', avgRating: 3.1, remarks: 'Settling in well.', confirmationStatus: null, isExtension: false },
      { seqNo: 2, status: 'completed', submittedAt: '2026-08-31', avgRating: 3.5, remarks: 'Noticeably faster on delivery.', confirmationStatus: null, isExtension: false },
      { seqNo: 3, status: 'completed', submittedAt: '2026-09-30', avgRating: 3.7, remarks: 'Client communication still developing.', confirmationStatus: null, isExtension: false },
    ],
  },
});

// ── Compile, store, render ────────────────────────────────────────────────

/**
 * Fill in a subject and body and wrap the body in the branded shell. Pure, so
 * the rules are testable without a database.
 *
 * @param {{subject: string, body: string}} template
 * @param {object} vars - from buildVars()
 * @returns {{subject: string, body: string, bodyFragment: string}}
 */
export function compile({ subject, body }, vars) {
  const text = (k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k]));
  const blocks = buildBlocks(vars);

  // A subject is plain text, not HTML — values go in unescaped, newlines out.
  const compiledSubject = String(subject || '').replace(TOKEN, (_m, k) => text(k)).replace(/\s+/g, ' ').trim();
  const bodyFragment = String(body || '').replace(TOKEN, (_m, k) => (k in blocks ? blocks[k] : esc(text(k))));

  return {
    subject: compiledSubject,
    bodyFragment,
    body: wrapBrandedEmail(bodyFragment, { title: compiledSubject }),
  };
}

/** The stored subject/body for one template, or the built-in default. */
async function current(key) {
  const def = TEMPLATES[key];
  const rows = await prisma.pea_settings.findMany({
    where: { setting_key: { in: [`template.${key}.subject`, `template.${key}.body`] } },
  });
  const by = Object.fromEntries(rows.map((r) => [r.setting_key.split('.').pop(), r]));
  return {
    subject: by.subject?.setting_value || def.subject,
    body: by.body?.setting_value || def.body,
    rows: by,
  };
}

/**
 * Render a template for sending.
 * @param {string} key
 * @param {object} vars - from buildVars()
 * @returns {Promise<{subject: string, body: string}>}
 */
export async function render(key, vars) {
  if (!TEMPLATES[key]) throw new Error(`Unknown email template "${key}"`);
  const { subject, body } = await current(key);
  const out = compile({ subject, body }, vars);
  return { subject: out.subject, body: out.body };
}

/**
 * Render an unsaved draft with sample data. Nothing is saved or sent.
 * @param {string} key
 * @param {{subject?: string, body?: string}} [draft] - blank falls back to the default
 * @returns {{subject: string, body: string}}
 */
export function renderPreview(key, draft = {}) {
  const def = TEMPLATES[key];
  if (!def) throw new AppError(`Unknown email template "${key}"`, 404);
  const out = compile({ subject: draft.subject || def.subject, body: draft.body || def.body }, SAMPLE_VARS);
  return { subject: out.subject, body: out.body };
}

/**
 * Check an edited subject and body before it is saved. Pure.
 *
 * @param {string} key
 * @param {{subject?: string, body?: string}} draft
 * @returns {{subject: string, body: string}} trimmed
 * @throws {AppError} 400
 */
export function validateDraft(key, draft) {
  const def = TEMPLATES[key];
  if (!def) throw new AppError(`Unknown email template "${key}"`, 404);

  const subject = String(draft.subject ?? '').trim();
  const body = String(draft.body ?? '').trim();
  const fail = (msg) => { throw new AppError(msg, 400); };

  if (!subject) fail('A subject is required.');
  if (subject.length > 300) fail('The subject must be 300 characters or fewer.');
  if (!body) fail('The email body cannot be empty. Use "Reset to default" to go back to the built-in wording.');
  if (body.length > 50_000) fail('The email body is too long (50,000 characters at most).');
  if (/<script[\s>]|\son\w+\s*=|javascript:/i.test(body)) {
    fail('Scripts, event handlers and javascript: links are not allowed in an email.');
  }
  if (/<!DOCTYPE|<html[\s>]|<body[\s>]/i.test(body)) {
    fail('Enter only the message body — the AAPNA header, logo and footer are added automatically.');
  }

  const used = usedPlaceholders(`${subject} ${body}`);
  const unknown = [...new Set(used.filter((p) => !def.placeholders.includes(p)))];
  if (unknown.length) {
    fail(
      `Unknown placeholder(s): ${unknown.map((p) => `{{${p}}}`).join(', ')}. ` +
        `This email can use: ${def.placeholders.map((p) => `{{${p}}}`).join(', ')}`
    );
  }

  for (const group of def.requiredAny || []) {
    if (!group.some((p) => used.includes(p))) {
      fail(
        `This email must contain ${group.map((p) => `{{${p}}}`).join(' or ')} — without it the recipient has nothing to act on.`
      );
    }
  }

  return { subject, body };
}

/**
 * Every template with its current wording, for the Email Templates screen.
 * @returns {Promise<object[]>}
 */
export async function listTemplateCatalog() {
  const rows = await prisma.pea_settings.findMany({ where: { setting_key: { startsWith: 'template.' } } });
  const byKey = new Map(rows.map((r) => [r.setting_key, r]));

  return TEMPLATE_KEYS.map((key) => {
    const def = TEMPLATES[key];
    const s = byKey.get(`template.${key}.subject`);
    const b = byKey.get(`template.${key}.body`);
    const subject = s?.setting_value || def.subject;
    const body = b?.setting_value || def.body;
    const stamps = [s?.modified_at, b?.modified_at].filter(Boolean).map((d) => new Date(d).getTime());

    return {
      key,
      name: def.name,
      category: def.category,
      categoryLabel: CATEGORY_LABELS[def.category],
      recipient: def.recipient,
      description: def.description,
      subject,
      body,
      defaultSubject: def.subject,
      defaultBody: def.body,
      overridden: !!(s?.setting_value || b?.setting_value),
      modifiedAt: stamps.length ? new Date(Math.max(...stamps)) : null,
      // Falls back rather than throwing: a placeholder added to a template but
      // not to PLACEHOLDERS used to take the whole screen down with
      // "Cannot read properties of undefined (reading 'label')", which told
      // nobody which placeholder or which template was at fault. One unlabelled
      // row is a far smaller failure than no page at all.
      placeholders: def.placeholders.map((name) => ({
        name,
        label: PLACEHOLDERS[name]?.label || name,
        block: !!PLACEHOLDERS[name]?.block,
      })),
      requiredAny: def.requiredAny || [],
      wrapper: brandedWrapperParts({ title: subject, bodyHtml: body }),
    };
  });
}
