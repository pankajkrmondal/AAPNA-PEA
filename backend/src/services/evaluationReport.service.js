/**
 * evaluationReport.service.js — R-05. One person's whole evaluation record, as
 * something HR can send to whoever asked for it.
 *
 * ── Why ────────────────────────────────────────────────────────────────────
 *
 * Subhajit, 15-Sep demo (19:44):
 *
 *   "If XYZ resource is reporting under Harish, Anuj is the super leader of
 *    Harish. Anuj drops an email to me that I want to know what is the current
 *    evolution status of XYZ resource… So I will be able to send the evolution
 *    report — whether it is evolution one, evolution two — within one click. I
 *    can send an email to Anuj keeping Rakhi ma'am in CC."
 *
 * and (21:13): "time and again it's required for me actually."
 *
 * Three details of that request drive the design:
 *
 *   · "within one click" — the recipient is arbitrary and typed at send time.
 *     A senior leader who asks today is not a role PEA can know in advance, so
 *     there is no configured recipient list, only a suggested CC.
 *   · "whether it is evolution one, evolution two" — read as "whatever exists
 *     so far", so the report covers the full history, not a chosen cycle.
 *   · "keeping Rakhi ma'am in CC" — the CC defaults to the standing HR list, so
 *     the request is answered the way HR answers it by hand today.
 *
 * ── On the attachment ──────────────────────────────────────────────────────
 *
 * The screen proposal asks for a PDF. No PDF library is installed and adding
 * one is a dependency decision, not a detail — so the file is an Excel workbook
 * built with the `xlsx` package already in use by the export feature, and the
 * email carries the full summary INLINE as an HTML table. That satisfies the
 * actual request (the recipient can read the answer without opening anything)
 * and leaves the PDF as a swap of this one function later.
 */
import * as XLSX from 'xlsx';
import prisma from '../config/database.js';
import AppError from '../utils/AppError.js';
import logger from '../config/logger.js';
import { queueEmail } from './notification.service.js';
import { getEmployeeTrend } from './analytics.service.js';
import { formatDisplay } from '../utils/dateUtils.js';

/** Someone must not be able to mail a report anywhere they like. */
const ALLOWED_DOMAIN = 'aapnainfotech.com';

const normEmail = (s) => String(s || '').trim().toLowerCase();

/**
 * Split and validate a recipient list.
 *
 * Restricted to the company domain on purpose: this report carries a named
 * person's ratings and their manager's written comments. One mistyped address
 * should not send that outside the company, and HR is typing under time
 * pressure from someone senior.
 *
 * @param {string|string[]} value
 * @param {string} label - for the error message
 * @returns {string[]}
 */
export function parseRecipients(value, label) {
  const list = (Array.isArray(value) ? value : String(value || '').split(/[;,]/))
    .map(normEmail)
    .filter(Boolean);

  const unique = [...new Set(list)];

  for (const address of unique) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      throw new AppError(`"${address}" in ${label} is not a valid email address.`, 400);
    }
    if (!address.endsWith(`@${ALLOWED_DOMAIN}`)) {
      throw new AppError(
        `${label} must be @${ALLOWED_DOMAIN} addresses. "${address}" is outside the company, ` +
          'and this report contains a person\'s ratings and manager comments.',
        400
      );
    }
  }

  return unique;
}

/**
 * Everything the report shows, gathered once so the email, the workbook and the
 * on-screen preview can never disagree with each other.
 *
 * @param {bigint|number|string} employeeId
 * @returns {Promise<object>}
 */
export async function buildReport(employeeId) {
  const employee = await prisma.pea_employees.findUnique({
    where: { id: BigInt(employeeId) },
    include: {
      cycles: {
        orderBy: { seq_no: 'asc' },
        include: { scores: { orderBy: { sort_order: 'asc' } } },
      },
    },
  });

  if (!employee) throw new AppError('Employee not found.', 404);

  // Reuses R-06's movement rules rather than recomputing them, so the report
  // and the screen cannot drift apart on what "growing" means.
  const trend = await getEmployeeTrend(employeeId);

  const completed = employee.cycles.filter((c) => c.status === 'completed');

  return {
    employee: {
      id: String(employee.id),
      name: employee.full_name,
      email: employee.office_email,
      doj: employee.doj,
      cohort: employee.is_experienced ? 'Experienced' : 'Fresher',
      rmName: employee.rm_name,
      rmEmail: employee.rm_email,
      plEmail: employee.pl_email,
      confirmationStatus: employee.confirmation_status,
      employmentStatus: employee.employment_status,
    },
    completedCount: completed.length,
    totalCount: employee.cycles.length,
    cycles: employee.cycles.map((c) => ({
      seqNo: c.seq_no,
      status: c.status,
      dueDate: c.due_date,
      submittedAt: c.submitted_at,
      avgRating: c.avg_rating === null ? null : Number(c.avg_rating),
      remarks: c.remarks,
      confirmationStatus: c.confirmation_status,
      isExtension: c.is_extension,
      legacy: !!c.legacy_format,
      scores: c.scores.map((s) => ({
        key: s.param_key,
        label: s.param_label,
        rating: s.rating === null ? null : Number(s.rating),
        comments: s.comments,
      })),
    })),
    trend,
  };
}

/**
 * The report as an Excel workbook: one sheet of evaluations, one of parameter
 * scores. Mirrors the shape of the existing export so the two read alike.
 *
 * @param {object} report - from buildReport()
 * @returns {Buffer}
 */
export function buildWorkbook(report) {
  const e = report.employee;
  const date = (d) => (d ? formatDisplay(d) : '');

  const summary = [
    ['Evaluation report'],
    [],
    ['Name', e.name],
    ['Office email', e.email],
    ['Joined', date(e.doj)],
    ['Type', e.cohort],
    ['Reporting manager', e.rmName],
    ['Project leader', e.plEmail],
    ['Probation decision', e.confirmationStatus || 'In probation'],
    ['Evaluations submitted', `${report.completedCount} of ${report.totalCount}`],
    [],
    ['Evaluation', 'Due', 'Submitted', 'Average', 'Decision', 'Remarks'],
    ...report.cycles.map((c) => [
      c.isExtension ? `${c.seqNo} (extension)` : c.seqNo,
      date(c.dueDate),
      date(c.submittedAt),
      c.avgRating ?? '',
      c.confirmationStatus || '',
      c.remarks || '',
    ]),
  ];

  // One row per parameter per evaluation — the detail a leader asks for when
  // the average alone does not answer their question.
  const detail = [['Evaluation', 'Parameter', 'Rating', 'Comments']];
  for (const c of report.cycles) {
    for (const s of c.scores) {
      detail.push([c.seqNo, s.label, s.rating ?? '', s.comments || '']);
    }
  }

  const wb = XLSX.utils.book_new();
  const sheet1 = XLSX.utils.aoa_to_sheet(summary);
  sheet1['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 14 }, { wch: 10 }, { wch: 20 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, sheet1, 'Summary');

  if (detail.length > 1) {
    const sheet2 = XLSX.utils.aoa_to_sheet(detail);
    sheet2['!cols'] = [{ wch: 12 }, { wch: 30 }, { wch: 10 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, sheet2, 'Parameter scores');
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** A filename that sorts and reads well in someone's downloads folder. */
export function reportFilename(report) {
  const safe = String(report.employee.name || 'employee').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `${safe}-evaluation-report.xlsx`;
}

/**
 * Send the report to whoever asked for it.
 *
 * @param {bigint|number|string} employeeId
 * @param {{to: string|string[], cc?: string|string[], note?: string}} body
 * @param {string} actor - the signed-in username, for the audit trail
 * @returns {Promise<object>}
 */
export async function shareReport(employeeId, body, actor) {
  const to = parseRecipients(body?.to, 'To');
  if (to.length === 0) throw new AppError('Enter at least one recipient.', 400);

  const cc = parseRecipients(body?.cc, 'CC');
  const note = String(body?.note || '').trim();

  const report = await buildReport(employeeId);

  if (report.completedCount === 0) {
    throw new AppError(
      `No evaluation has been submitted for ${report.employee.name} yet, so there is nothing to report.`,
      409
    );
  }

  const workbook = buildWorkbook(report);
  const filename = reportFilename(report);

  const result = await queueEmail({
    type: 'evaluation_report',
    employeeId: BigInt(employeeId),
    context: {
      report,
      note,
      sharedBy: actor,
      recipients: { to, cc },
      today: formatDisplay(new Date()),
    },
    attachments: [{
      name: filename,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      content: workbook,
    }],
  });

  // Recorded on the employee, so "who has seen this person's ratings" is
  // answerable later. A share is a disclosure, not just a message.
  try {
    await prisma.pea_employee_audit.create({
      data: {
        employee_id: BigInt(employeeId),
        field_name: 'evaluation_report_shared',
        old_value: null,
        new_value: `to: ${to.join(', ')}${cc.length ? ` · cc: ${cc.join(', ')}` : ''}`,
        changed_by: actor,
        change_source: 'manual',
      },
    });
  } catch (err) {
    // The report went out; failing the request now would tell HR it did not.
    logger.warn(`Could not record the report share for employee ${employeeId}: ${err.message}`);
  }

  return {
    sent: result.status !== 'failed',
    status: result.status,
    to,
    cc,
    filename,
    evaluations: report.completedCount,
  };
}
