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
import { toDateString } from '../utils/dateUtils.js';

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
  const where = {};
  if (filters.type === 'fresher') where.is_experienced = false;
  if (filters.type === 'experienced') where.is_experienced = true;
  if (filters.employment_status) where.employment_status = filters.employment_status;

  const employees = await prisma.pea_employees.findMany({
    where,
    orderBy: { full_name: 'asc' },
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
      toDateString(e.doj),
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
    ['Employee', 'Office Email', 'Type', 'DOJ', 'Evaluation', 'Due', 'Status', 'Sent', 'Reminders', 'Average'],
  ];
  for (const e of employees) {
    for (const c of e.cycles) {
      statusRows.push([
        e.full_name,
        e.office_email,
        e.is_experienced ? 'Experienced' : 'Fresher',
        toDateString(e.doj),
        c.seq_no,
        toDateString(c.due_date),
        c.status,
        c.sent_at ? toDateString(c.sent_at) : '',
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
  return `Performance Evaluation - ${toDateString(new Date())}.xlsx`;
}
