/**
 * export.service.js — Excel export in the layout HR already knows.
 *
 * Deliberately reproduces the master workbook: Sheet1 is the summary with the
 * same headers in the same order, Sheet2 the 7-parameter detail. HR has read
 * that layout for years, and at cutover the last thing anyone needs is a new
 * shape to learn on top of a new system (plan R9).
 *
 * It also matters for rollback: while Power Automate is still switched off but
 * not deleted (plan R6 stage 2), this export is what puts the data back into a
 * spreadsheet if we have to retreat.
 *
 * The exported file is a snapshot, not a system of record. Nothing reads it
 * back — the importer only ever runs on the original master sheet.
 */
import XLSX from 'xlsx';
import prisma from '../config/database.js';
// H6 / U4 — dates in the sheet are dd-MM-yyyy like everywhere else. They were
// YYYY-MM-DD through toDateString.
// import { toDateString } from '../utils/dateUtils.js';
import { formatDisplay } from '../utils/dateUtils.js';
import { employeeWhere, employeeOrder } from './employee.service.js';
import { archivedIds } from '../utils/archiveScope.js';

/** Sheet1 headers, in the master workbook's exact order. */
const SUMMARY_HEADERS = [
  'Names',
  'Office Email',
  'Halt_Process',
  'Experience',
  'DOJ',
  'RM Name',
  'RM Email',
  'PL Email',
  'Confirmation Status',
];
for (let n = 1; n <= 8; n++) {
  SUMMARY_HEADERS.push(`Evaluation ${n}`, `E${n} Status`, `Feedback ${n}`);
}

/** The 7 parameters, in form order. */
const PARAMS = [
  ['quality_of_work', 'Quality of Code/Work'],
  ['meeting_deadline', 'Meeting Deadine'], // spelled as in the original workbook
  ['communication', 'Communication & Presentation'],
  ['proactiveness', 'Proactiveness'],
  ['skill_development', 'Skill Development'],
  ['cultural_fit', 'Cultural Fit'],
  ['x_factor', 'X-Factor'],
];

/** Sheet2 headers: per evaluation, rating + comments for each parameter. */
const DETAIL_HEADERS = ['Names', 'Office Email'];
for (let n = 1; n <= 8; n++) {
  for (const [, label] of PARAMS) {
    DETAIL_HEADERS.push(`E${n} ${label}`, `E${n} ${label} (Comments)`);
  }
  DETAIL_HEADERS.push(`Evaluation ${n}`, `E${n} Remarks`);
}

/** Map an internal status onto the vocabulary the sheet used. */
function sheetStatus(cycle) {
  switch (cycle.status) {
    case 'completed':
      return 'Completed';
    case 'email_sent':
    case 'opened':
      return 'Email Sent';
    case 'skipped':
      return 'Not Applicable';
    default:
      return '';
  }
}

/**
 * Render the summary cell for one evaluation, in the "Skill - 3; …" shape the
 * original flow wrote.
 */
function summaryCell(cycle) {
  if (!cycle) return '';
  if (cycle.status !== 'completed') return '';

  if (cycle.scores?.length) {
    return cycle.scores.map((s) => `${s.param_label} - ${Number(s.rating)}`).join('; ');
  }
  // Imported history we deliberately never parsed (plan R5 tier 3) — give back
  // exactly what was in the original cell.
  if (cycle.legacy_raw) {
    try {
      return JSON.parse(cycle.legacy_raw).text || '';
    } catch {
      return cycle.legacy_raw;
    }
  }
  return '';
}

/**
 * Build the workbook.
 * @param {object} [filters] - same shape as the employee list filters
 * @returns {Promise<Buffer>}
 */
export async function buildWorkbook(filters = {}) {
  /* U6 — the export's own two filters, kept for reference. The Commandos list
     exports what it is showing now, so the filters and the order come from the
     same two functions the list uses. `type` and `employment_status` behave
     exactly as they did here.

  const where = {};
  if (filters.type === 'fresher') where.is_experienced = false;
  if (filters.type === 'experienced') where.is_experienced = true;
  if (filters.employment_status) where.employment_status = filters.employment_status;
  */
  // Archive (07-10-2026) — the same archive rule as the list. Was: employeeWhere(filters)
  const where = employeeWhere(filters, { archived: await archivedIds() });

  const employees = await prisma.pea_employees.findMany({
    where,
    // U6 — by name unless the list was sorted. It was: orderBy: { full_name: 'asc' },
    orderBy: filters.sort ? employeeOrder(filters) : [{ full_name: 'asc' }],
    include: {
      cycles: {
        orderBy: { seq_no: 'asc' },
        include: { scores: { orderBy: { sort_order: 'asc' } } },
      },
    },
  });

  const summaryRows = [SUMMARY_HEADERS];
  const detailRows = [DETAIL_HEADERS];

  for (const e of employees) {
    const bySeq = new Map(e.cycles.map((c) => [c.seq_no, c]));

    const summary = [
      e.full_name,
      e.office_email,
      e.halt_process ? 'Yes' : 'No',
      e.is_experienced ? 'Yes' : 'No',
      formatDisplay(e.doj),
      e.rm_name,
      e.rm_email,
      e.pl_email,
      e.confirmation_status || '',
    ];

    const detail = [e.full_name, e.office_email];

    for (let n = 1; n <= 8; n++) {
      const c = bySeq.get(n);
      summary.push(summaryCell(c), c ? sheetStatus(c) : '', c?.remarks || '');

      const byKey = new Map((c?.scores || []).map((s) => [s.param_key, s]));
      for (const [key] of PARAMS) {
        const s = byKey.get(key);
        detail.push(s ? Number(s.rating) : '', s?.comments || '');
      }
      detail.push(c?.avg_rating ? Number(c.avg_rating) : '', c?.remarks || '');
    }

    summaryRows.push(summary);
    detailRows.push(detail);
  }

  const wb = XLSX.utils.book_new();

  const sheet1 = XLSX.utils.aoa_to_sheet(summaryRows);
  sheet1['!cols'] = SUMMARY_HEADERS.map((hdr, i) => ({
    wch: i === 0 ? 26 : i === 1 ? 34 : Math.min(40, Math.max(12, hdr.length + 2)),
  }));
  sheet1['!freeze'] = { xSplit: 2, ySplit: 1 };
  XLSX.utils.book_append_sheet(wb, sheet1, 'Sheet1');

  const sheet2 = XLSX.utils.aoa_to_sheet(detailRows);
  sheet2['!cols'] = DETAIL_HEADERS.map((_, i) => ({ wch: i < 2 ? 28 : 18 }));
  XLSX.utils.book_append_sheet(wb, sheet2, 'Sheet2');

  // A third sheet the original never had: what is actually outstanding.
  const statusRows = [
    ['Commando', 'Office Email', 'Type', 'DOJ', 'Evaluation', 'Due', 'Status', 'Sent', 'Reminders', 'Average'],
  ];
  for (const e of employees) {
    for (const c of e.cycles) {
      statusRows.push([
        e.full_name,
        e.office_email,
        e.is_experienced ? 'Experienced' : 'Fresher',
        formatDisplay(e.doj),
        c.seq_no,
        formatDisplay(c.due_date),
        c.status,
        c.sent_at ? formatDisplay(c.sent_at) : '',
        c.reminder_count,
        c.avg_rating ? Number(c.avg_rating) : '',
      ]);
    }
  }
  const sheet3 = XLSX.utils.aoa_to_sheet(statusRows);
  sheet3['!cols'] = [{ wch: 26 }, { wch: 34 }, { wch: 14 }, { wch: 12 }, { wch: 11 }, { wch: 12 }, { wch: 13 }, { wch: 12 }, { wch: 11 }, { wch: 10 }];
  XLSX.utils.book_append_sheet(wb, sheet3, 'Evaluation Status');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Filename for the download, dated so successive exports do not collide. */
export function exportFilename() {
  return `Probation Evaluation - ${formatDisplay(new Date())}.xlsx`;
}

// ── Excel import template (28-10-2026) ─────────────────────────────────────
//
// The empty workbook HR fills in to load previous data. Its Sheet1 and Sheet2
// are this export's own headers, so a template, an export and what the
// importer reads (excelImport.service.js) are one layout. No example rows on
// those two sheets — a sample person must never be imported by accident; the
// example lives on "How to fill". SheetJS (community) cannot write dropdowns,
// so the allowed values are listed there instead.

const QUESTION_NAMES = PARAMS.map(([, label]) => label).join(', ');

/** The "How to fill" sheet: one row per column, then an example. */
const TEMPLATE_GUIDE = [
  ['How to fill in this template'],
  ['Fill in Sheet1 — one row per Commando. Sheet2 (ratings) is optional: leave it empty if you do not have the ratings.'],
  ['Do not rename the sheets or the column headings. Upload the file on Settings → Upload Excel, press Check file, then Trial import, then Import.'],
  [],
  ['Column', 'Sheet', 'Required?', 'What to enter'],
  ['Names', 'Sheet1', 'Yes', 'The Commando\'s full name.'],
  ['Office Email', 'Sheet1', 'Yes', 'Their AAPNA email. One row per person — the same email twice is refused. Someone already in PEA is skipped, not changed.'],
  ['Halt_Process', 'Sheet1', 'No', 'Yes to keep their evaluation emails paused. Otherwise leave blank or write No.'],
  ['Experience', 'Sheet1', 'Yes', 'Yes = experienced (3 evaluations, one every 2 months). No = fresher (6 evaluations, one every month).'],
  ['DOJ', 'Sheet1', 'Yes', 'Date of joining. Use an Excel date, or type it like 05-Mar-2026. Do not type 05/03/2026 — it is read as 3 May.'],
  ['RM Name / RM Email', 'Sheet1', 'Yes', 'The reporting manager. Evaluation emails go to this address.'],
  ['PL Email', 'Sheet1', 'Yes', 'The project leader, copied on evaluation emails.'],
  ['Confirmation Status', 'Sheet1', 'No', 'Blank while still in probation, or exactly one of: Confirmed, Not Confirmed, Extend for 1 month, Extend for 2 months. "Extend" adds the extra evaluations.'],
  ['E1 Status … E8 Status', 'Sheet1', 'No', 'Exactly one of: Completed (the manager answered — never sent again), Email Sent (sent before but not answered — PEA sends a new link if it was due in the last 45 days), Not Applicable (not needed — closed). Blank = not sent yet. Any other word is refused.'],
  ['Evaluation 1 … Evaluation 8', 'Sheet1', 'No', `For a Completed evaluation: the ratings written as "Quality of Code/Work - 3; Meeting Deadine - 4; …", or one overall number such as 3.6. Used only when Sheet2 has no ratings for it. Anything else is kept as text.`],
  ['Feedback 1 … Feedback 8', 'Sheet1', 'No', 'The manager\'s overall comment for that evaluation.'],
  ['Names / Office Email', 'Sheet2', 'If used', 'The same email as on Sheet1, so the ratings reach the right person.'],
  ['E1 <question> … E8 <question>', 'Sheet2', 'No', `A rating from 1 to 5 for each question of a Completed evaluation. The questions: ${QUESTION_NAMES}. Rate all seven if you can; with some missing the evaluation is imported as "Partly rated".`],
  ['E1 <question> (Comments) …', 'Sheet2', 'No', 'The manager\'s comment on that question.'],
  ['Evaluation 1 … Evaluation 8', 'Sheet2', 'No', 'One overall number from 1 to 5. Used only when that evaluation has no question ratings — it is imported as "Average only".'],
  ['E1 Remarks … E8 Remarks', 'Sheet2', 'No', 'Overall comment, used when Feedback on Sheet1 is blank.'],
  [],
  ['When ratings are missing'],
  ['A Completed evaluation is still imported. PEA uses Sheet2\'s question ratings; if there are none, the ratings written in Sheet1 "Evaluation N"; if there are none, one overall number; otherwise it is imported without a rating. Check file shows which is which, and HR can add missing ratings later on the evaluation\'s page.'],
  [],
  ['Example — a fresher in month 3, two evaluations done'],
  ['Names', 'Office Email', 'Halt_Process', 'Experience', 'DOJ', 'RM Name', 'RM Email', 'PL Email', 'Confirmation Status', 'E1 Status', 'E2 Status', 'E3 Status'],
  ['First Last', 'first.last@aapnainfotech.com', '', 'No', '05-Jul-2026', 'Manager Name', 'manager.name@aapnainfotech.com', 'leader.name@aapnainfotech.com', '', 'Completed', 'Completed', 'Email Sent'],
];

/**
 * The import template: Sheet1 and Sheet2 headers only, and "How to fill".
 * @returns {Buffer}
 */
export function buildTemplate() {
  const wb = XLSX.utils.book_new();

  const sheet1 = XLSX.utils.aoa_to_sheet([SUMMARY_HEADERS]);
  sheet1['!cols'] = SUMMARY_HEADERS.map((_, i) => ({ wch: i < 9 ? 22 : 18 }));
  XLSX.utils.book_append_sheet(wb, sheet1, 'Sheet1');

  const sheet2 = XLSX.utils.aoa_to_sheet([DETAIL_HEADERS]);
  sheet2['!cols'] = DETAIL_HEADERS.map((_, i) => ({ wch: i < 2 ? 28 : 18 }));
  XLSX.utils.book_append_sheet(wb, sheet2, 'Sheet2');

  const guide = XLSX.utils.aoa_to_sheet(TEMPLATE_GUIDE);
  guide['!cols'] = [{ wch: 30 }, { wch: 30 }, { wch: 12 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, guide, 'How to fill');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Filename for the template download. */
export const TEMPLATE_FILENAME = 'PEA - Excel upload template.xlsx';
