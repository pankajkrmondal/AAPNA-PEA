/**
 * excelImport.service.js — one-time migration of the master workbook.
 *
 * Implements the three-tier strategy from plan R5, because the source data is
 * not uniformly clean and pretending otherwise would either lose data or import
 * nonsense:
 *
 *   Tier 1  MUST import, structured   — Sheet1 columns A-H plus Confirmation
 *                                       Status and each "EN Status". Clean,
 *                                       parseable, and all the scheduler needs.
 *   Tier 2  BEST EFFORT, structured   — Sheet2's 7-parameter ratings, which
 *                                       import cleanly where present.
 *   Tier 3  DO NOT PARSE              — the free-text "Evaluation N" blobs in
 *                                       Sheet1 and everything in Sheet3 (an
 *                                       older 4-parameter instrument). Stored
 *                                       verbatim in legacy_raw so nothing is
 *                                       lost and nothing is corrupted.
 *
 * Every run produces a reconciliation report — rows read, imported, skipped,
 * and why — which HR signs off before cutover. The migration is never silent.
 */
import XLSX from 'xlsx';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import config from '../config/index.js';
import { generateCycles } from './cycleGenerator.service.js';
import { utcDate, toDateString, addMonths, todayIn, toUtcMidnight } from '../utils/dateUtils.js';
import { CONFIRMATION_STATUSES } from './employee.service.js';

/** Sheet1 column headers we depend on, exactly as they appear in the workbook. */
const COL = Object.freeze({
  name: 'Names',
  officeEmail: 'Office Email',
  halt: 'Halt_Process',
  experience: 'Experience',
  doj: 'DOJ',
  rmName: 'RM Name',
  rmEmail: 'RM Email',
  plEmail: 'PL Email',
  confirmation: 'Confirmation Status',
});

/** The 7 parameters in Sheet2, mapped to our param_key values. */
const SHEET2_PARAMS = Object.freeze([
  { key: 'quality_of_work', label: 'Quality of Code / Work', col: 'Quality of Code/Work' },
  // "Deadine" is misspelled in the workbook's own headers; match what is there.
  { key: 'meeting_deadline', label: 'Meeting Deadline', col: 'Meeting Deadine' },
  { key: 'communication', label: 'Communication & Presentation', col: 'Communication & Presentation' },
  { key: 'proactiveness', label: 'Proactiveness', col: 'Proactiveness' },
  { key: 'skill_development', label: 'Skill Development', col: 'Skill Development' },
  { key: 'cultural_fit', label: 'Cultural Fit', col: 'Cultural Fit' },
  { key: 'x_factor', label: 'X-Factor', col: 'X-Factor' },
]);

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const normEmail = (v) => clean(v).toLowerCase() || null;

/**
 * Read an Excel date cell as a calendar date, immune to timezone shifts.
 *
 * THIS IS THE IMPORTANT FUNCTION IN THIS FILE.
 *
 * Excel stores dates as serial numbers. Letting the xlsx library build a
 * JavaScript Date produces an instant, and in any timezone behind UTC that
 * instant lands on the PREVIOUS calendar day:
 *
 *     2 Jan 2023  ->  2023-01-01T18:29:50.000Z  ->  read as 1 Jan
 *
 * Observed in the real workbook. Unnoticed, it shifts every DOJ by a day and
 * therefore every evaluation due date by a day — the same class of silent,
 * invisible error the migration exists to eliminate.
 *
 * XLSX.SSF.parse_date_code() decodes the serial into calendar parts directly,
 * with no Date object and no timezone involved.
 *
 * @param {object} cell - raw cell object from the worksheet
 * @returns {{date: Date|null, error: string|null}}
 */
export function parseExcelDate(cell) {
  if (!cell) return { date: null, error: 'empty' };

  // Numeric serial — the normal case for a real date cell.
  if (cell.t === 'n' && typeof cell.v === 'number') {
    const parts = XLSX.SSF.parse_date_code(cell.v);
    if (!parts || !parts.y) return { date: null, error: `unrecognised serial ${cell.v}` };
    return { date: utcDate(parts.y, parts.m, parts.d), error: null };
  }

  // Already a Date (cellDates:true). Use its UTC parts, but if a time component
  // is present it came from the timezone conversion above — prefer the
  // formatted text `w`, which is what Excel actually displays.
  if (cell.t === 'd' && cell.v instanceof Date) {
    if (cell.w) {
      const fromText = parseTextDate(cell.w);
      if (fromText.date) return fromText;
    }
    const d = cell.v;
    return { date: utcDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), error: null };
  }

  // Text — HR typed it by hand. This is the case that broke the old system.
  if (cell.t === 's') return parseTextDate(cell.w || cell.v);

  return { date: null, error: `unsupported cell type "${cell.t}"` };
}

/**
 * Parse a hand-typed date string.
 *
 * The workbook displays M/D/YY, and the PPT user guide asks for dd-MM-yyyy —
 * so both appear in practice. Ambiguous values like "1/2/23" are resolved as
 * M/D/YY to match what Excel itself renders for the stored serial.
 *
 * @param {string} text
 * @returns {{date: Date|null, error: string|null}}
 */
export function parseTextDate(text) {
  const s = clean(text);
  if (!s) return { date: null, error: 'empty' };

  // dd-MMM-yyyy  e.g. 02-Jan-2023
  const named = /^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{2,4})$/.exec(s);
  if (named) {
    const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const mi = MONTHS.indexOf(named[2].slice(0, 3).toLowerCase());
    if (mi >= 0) return { date: utcDate(fullYear(named[3]), mi + 1, Number(named[1])), error: null };
  }

  // ISO  yyyy-mm-dd
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return { date: utcDate(+iso[1], +iso[2], +iso[3]), error: null };

  // Slash or dash separated numbers.
  const parts = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(s);
  if (parts) {
    let [, a, b, y] = parts;
    a = Number(a);
    b = Number(b);
    // If the first number cannot be a month it must be the day (dd-MM-yyyy).
    const [month, day] = a > 12 ? [b, a] : [a, b];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { date: utcDate(fullYear(y), month, day), error: null };
    }
  }

  return { date: null, error: `unrecognised date format "${s}"` };
}

/** Expand a 2-digit year the way Excel does (00-29 → 2000s, 30-99 → 1900s). */
function fullYear(y) {
  const n = Number(y);
  if (n >= 100) return n;
  return n < 30 ? 2000 + n : 1900 + n;
}

/**
 * Months after DOJ past which a row with no final decision is old data — the
 * extended confirmation deadline. HR decision 16 (13 Sep): these sheet rows are
 * demo data, imported as Confirmed and deleted later.
 */
export const OLD_ROW_MONTHS = 8;

/**
 * True for an old row that never got a final decision (blank or "Extend for …").
 * Pure, so the rule is testable without a workbook.
 * @param {{doj: Date, confirmation_status: string|null}} row
 * @param {Date} today - UTC midnight
 * @returns {boolean}
 */
export function isOldUndecided({ doj, confirmation_status: status }, today) {
  if (status && !status.startsWith('Extend')) return false;
  const start = toUtcMidnight(doj);
  if (!start) return false;
  return addMonths(start, OLD_ROW_MONTHS) < today;
}

/**
 * What the sheet's "EN Status" says about one evaluation.
 *
 *   'completed' — the manager answered; never send again.
 *   'in_flight' — Power Automate emailed an MS Forms link ("Email Sent") and no
 *                 answer is recorded. At go-live every Power Automate flow and
 *                 the MS Forms are switched off, so that link is dead: the
 *                 cycle stays due and PEA sends a fresh link. Listed in the
 *                 preview so HR knows which managers get one.
 *   null        — nothing was sent; PEA's sweep handles it as normal.
 *
 * @param {{status?: string|null}} [blob]
 * @returns {'completed'|'in_flight'|null}
 */
export function legacyCycleState(blob) {
  const s = blob?.status || '';
  if (/complete/i.test(s)) return 'completed';
  if (/\bsent\b/i.test(s)) return 'in_flight';
  return null;
}

/**
 * Parse the workbook into rows plus a reconciliation report. No database writes,
 * so HR can review exactly what would happen before anything is committed.
 *
 * @param {Buffer|string} source - file buffer or path
 * @param {{today?: Date}} [opts]
 * @returns {{valid: object[], rejected: object[], report: object}}
 */
export function parseWorkbook(source, { today = todayIn(config.scheduler.timezone) } = {}) {
  const wb =
    typeof source === 'string'
      ? XLSX.readFile(source, { cellDates: false })
      : XLSX.read(source, { type: 'buffer', cellDates: false });

  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new AppError('The workbook has no sheets', 400);

  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const range = XLSX.utils.decode_range(sheet['!ref']);

  // Map header name -> column letter, so date cells can be read raw (by
  // address) rather than through the stringified row.
  const headerCol = {};
  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: range.s.r, c });
    const h = clean(sheet[addr]?.v);
    if (h) headerCol[h] = c;
  }

  const missingHeaders = Object.values(COL).filter((h) => headerCol[h] === undefined);
  if (missingHeaders.length) {
    throw new AppError(
      `The workbook is missing expected column(s): ${missingHeaders.join(', ')}. ` +
        `Found: ${Object.keys(headerCol).slice(0, 12).join(', ')}…`,
      400
    );
  }

  const valid = [];
  const rejected = [];
  const seenEmails = new Map();

  rows.forEach((row, i) => {
    const excelRow = range.s.r + 2 + i; // 1-based, past the header
    const reasons = [];

    const name = clean(row[COL.name]);
    const officeEmail = normEmail(row[COL.officeEmail]);
    const rmName = clean(row[COL.rmName]);
    const rmEmail = normEmail(row[COL.rmEmail]);
    const plEmail = normEmail(row[COL.plEmail]);

    // Entirely blank row — skip silently, spreadsheets are full of them.
    if (!name && !officeEmail && !rmEmail) return;

    // The same completeness guard the original flow applied before sending.
    if (!name) reasons.push('missing Names');
    if (!officeEmail) reasons.push('missing Office Email');
    if (!rmName) reasons.push('missing RM Name');
    if (!rmEmail) reasons.push('missing RM Email');
    if (!plEmail) reasons.push('missing PL Email');

    const dojCell = sheet[XLSX.utils.encode_cell({ r: excelRow - 1, c: headerCol[COL.doj] })];
    const { date: doj, error: dojError } = parseExcelDate(dojCell);
    if (!doj) reasons.push(`DOJ: ${dojError}`);

    // "Experience" drives the entire cadence, so an unreadable value is fatal
    // rather than defaulted — guessing would silently give someone the wrong
    // number of evaluations.
    const expRaw = clean(row[COL.experience]).toLowerCase();
    let isExperienced = null;
    if (['yes', 'y', 'true'].includes(expRaw)) isExperienced = true;
    else if (['no', 'n', 'false'].includes(expRaw)) isExperienced = false;
    else reasons.push(`Experience: expected Yes or No, found "${clean(row[COL.experience])}"`);

    const confirmationRaw = clean(row[COL.confirmation]);
    let confirmation = null;
    if (confirmationRaw) {
      confirmation =
        CONFIRMATION_STATUSES.find((s) => s.toLowerCase() === confirmationRaw.toLowerCase()) || null;
      if (!confirmation) reasons.push(`unrecognised Confirmation Status "${confirmationRaw}"`);
    }

    if (officeEmail && seenEmails.has(officeEmail)) {
      reasons.push(`duplicate Office Email — also on row ${seenEmails.get(officeEmail)}`);
    } else if (officeEmail) {
      seenEmails.set(officeEmail, excelRow);
    }

    if (reasons.length) {
      rejected.push({ excelRow, name, officeEmail, reasons });
      return;
    }

    const parsed = {
      excelRow,
      full_name: name,
      office_email: officeEmail,
      is_experienced: isExperienced,
      doj,
      rm_name: rmName,
      rm_email: rmEmail,
      pl_email: plEmail,
      halt_process: ['yes', 'y', 'true'].includes(clean(row[COL.halt]).toLowerCase()),
      confirmation_status: confirmation,
      // Tier 3: kept verbatim, never parsed. Three incompatible formats appear
      // in this column across the years. Plan R5.
      legacy_blobs: collectLegacyBlobs(row),
      original_confirmation: confirmation,
      auto_confirmed: false,
    };

    if (isOldUndecided(parsed, today)) {
      parsed.confirmation_status = 'Confirmed';
      parsed.auto_confirmed = true;
    }

    valid.push(parsed);
  });

  const autoConfirmedRows = valid
    .filter((v) => v.auto_confirmed)
    .map((v) => ({
      excelRow: v.excelRow,
      name: v.full_name,
      office_email: v.office_email,
      doj: toDateString(v.doj),
      was: v.original_confirmation,
    }));

  // A final decision closes every open evaluation, so only still-open employees
  // can have an evaluation in flight.
  const inFlightRows = valid
    .filter((v) => !TERMINAL_STATUSES.has(v.confirmation_status))
    .flatMap((v) =>
      Object.entries(v.legacy_blobs)
        .filter(([, blob]) => legacyCycleState(blob) === 'in_flight')
        .map(([seq]) => ({
          excelRow: v.excelRow,
          name: v.full_name,
          office_email: v.office_email,
          rm_email: v.rm_email,
          evaluation: Number(seq),
        }))
    );

  return {
    valid,
    rejected,
    report: {
      sheetName: wb.SheetNames[0],
      rowsRead: rows.length,
      valid: valid.length,
      rejected: rejected.length,
      freshers: valid.filter((v) => !v.is_experienced).length,
      experienced: valid.filter((v) => v.is_experienced).length,
      withConfirmation: valid.filter((v) => v.confirmation_status).length,
      halted: valid.filter((v) => v.halt_process).length,
      autoConfirmed: autoConfirmedRows.length,
      autoConfirmedRows,
      inFlight: inFlightRows.length,
      inFlightRows,
    },
  };
}

/**
 * How far back an imported cycle may be and still be worth sending.
 * Beyond this it is history, not a pending action.
 */
export const STALE_CYCLE_DAYS = 45;

/** Confirmation statuses that end the probation process for good. */
const TERMINAL_STATUSES = new Set(['Confirmed', 'Not Confirmed']);

/**
 * Close cycles that are historical rather than actionable.
 *
 * WHY THIS EXISTS. The new sweep matches `due_date <= today`, which is
 * deliberately self-healing — miss a day and it catches up (plan §3.1). But
 * applied to imported history that same property is a liability: the master
 * sheet contains people who joined in 2022 with evaluations that were never
 * completed. Importing them verbatim would leave cycles due three years ago in
 * `pending`, and the first live sweep would email their managers asking them to
 * rate a period that ended in 2023.
 *
 * The old system could never do this — an exact day-count match simply stopped
 * matching — so migrating without this guard would introduce a fault that did
 * not previously exist, on day one, to every manager at once.
 *
 * Two rules, both mirroring guards the original flow already applied:
 *
 *   1. A terminal Confirmation Status (Confirmed / Not Confirmed) ends the
 *      process — the flow skipped those rows entirely, so nothing further is
 *      owed. "Extend for …" is NOT terminal and stays active.
 *   2. Anything still pending but older than STALE_CYCLE_DAYS is history.
 *
 * Closed cycles become `skipped`, not deleted: the row remains visible to HR
 * with its legacy text intact, it is simply never sent.
 *
 * @param {object} employee
 * @param {object} tx - Prisma transaction client
 * @returns {Promise<number>} cycles closed
 */
async function closeStaleCycles(employee, tx) {
  const isTerminal = TERMINAL_STATUSES.has(employee.confirmation_status);
  const cutoff = new Date(Date.now() - STALE_CYCLE_DAYS * 86_400_000);

  const { count } = await tx.pea_evaluation_cycles.updateMany({
    where: {
      employee_id: employee.id,
      status: 'pending',
      // A terminal decision closes everything outstanding; otherwise only the
      // cycles that are too old to ask about.
      ...(isTerminal ? {} : { due_date: { lt: cutoff } }),
    },
    data: { status: 'skipped', modified_at: new Date() },
  });

  return count;
}

/** Capture the unparsed "Evaluation N" free text for each cycle. */
function collectLegacyBlobs(row) {
  const blobs = {};
  for (let n = 1; n <= 8; n++) {
    const text = clean(row[`Evaluation ${n}`]);
    const status = clean(row[`E${n} Status`]);
    const feedback = clean(row[`Feedback ${n}`]);
    if (text || status || feedback) {
      blobs[n] = { text: text || null, status: status || null, feedback: feedback || null };
    }
  }
  return blobs;
}

/**
 * Import parsed rows into the database.
 *
 * Idempotent on office_email: an existing employee is left alone and reported
 * as "skipped (already present)" rather than duplicated or silently overwritten
 * — the real sheet will be imported more than once during cutover rehearsal.
 *
 * @param {object[]} validRows - from parseWorkbook()
 * @param {string} actor
 * @param {{dryRun?: boolean}} [opts]
 * @returns {Promise<object>} result report
 */
export async function importRows(validRows, actor, { dryRun = false } = {}) {
  const created = [];
  const skipped = [];
  const failed = [];

  for (const row of validRows) {
    try {
      const existing = await prisma.$queryRaw`
        SELECT id, full_name FROM pea_employees
         WHERE lower(trim(office_email)) = ${row.office_email} LIMIT 1`;

      if (existing.length) {
        skipped.push({
          excelRow: row.excelRow,
          office_email: row.office_email,
          reason: `already present (id ${existing[0].id})`,
        });
        continue;
      }

      if (dryRun) {
        created.push({ excelRow: row.excelRow, office_email: row.office_email, dryRun: true });
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const {
          excelRow: _row,
          legacy_blobs: blobs,
          auto_confirmed: autoConfirmed,
          original_confirmation: wasStatus,
          ...data
        } = row;
        let inFlight = 0;

        const employee = await tx.pea_employees.create({
          data: { ...data, source: 'excel' },
        });

        await generateCycles(employee.id, employee, tx);

        // Attach the untouched legacy text to the matching cycle so HR can
        // still read the history without it being reinterpreted.
        for (const [seq, blob] of Object.entries(blobs)) {
          const seqNo = Number(seq);
          const cycle = await tx.pea_evaluation_cycles.findFirst({
            where: { employee_id: employee.id, seq_no: seqNo },
          });
          if (!cycle) continue;

          const state = legacyCycleState(blob);
          if (state === 'in_flight' && cycle.status === 'pending') inFlight += 1;

          await tx.pea_evaluation_cycles.update({
            where: { id: cycle.id },
            data: {
              legacy_raw: JSON.stringify(blob),
              legacy_format: 'sheet1_freetext',
              // A completed evaluation must not be re-sent to the manager. One
              // Power Automate emailed but nobody answered stays due: its MS
              // Forms link stops working at go-live, so PEA sends a fresh one.
              status: state === 'completed' ? 'completed' : cycle.status,
              remarks: blob.feedback || null,
            },
          });
        }

        const closed = await closeStaleCycles(employee, tx);

        await tx.pea_employee_audit.create({
          data: {
            employee_id: employee.id,
            field_name: '*',
            old_value: null,
            new_value:
              `imported from Excel row ${row.excelRow}` +
              (autoConfirmed
                ? ` — Confirmation Status set to Confirmed (old demo row, was ${wasStatus || 'blank'}; HR decision 16)`
                : '') +
              (inFlight ? ` — ${inFlight} unanswered Power Automate evaluation(s) left due for a fresh PEA link` : '') +
              (closed ? ` — ${closed} historical cycle(s) closed as no longer actionable` : ''),
            changed_by: actor,
            change_source: 'excel_import',
          },
        });

        created.push({
          excelRow: row.excelRow,
          id: String(employee.id),
          office_email: row.office_email,
        });
      });
    } catch (err) {
      failed.push({ excelRow: row.excelRow, office_email: row.office_email, error: err.message });
      logger.error(`Import failed for row ${row.excelRow}: ${err.message}`);
    }
  }

  logger.info(
    `Excel import${dryRun ? ' (dry run)' : ''} by ${actor}: ` +
      `${created.length} created, ${skipped.length} skipped, ${failed.length} failed`
  );

  return { created, skipped, failed, dryRun };
}

/**
 * Parse and import in one call, returning the full reconciliation report.
 * @param {Buffer|string} source
 * @param {string} actor
 * @param {{dryRun?: boolean}} [opts]
 * @returns {Promise<object>}
 */
export async function importWorkbook(source, actor, opts = {}) {
  const { valid, rejected, report } = parseWorkbook(source);
  const outcome = await importRows(valid, actor, opts);

  return {
    ...report,
    dryRun: !!opts.dryRun,
    imported: outcome.created.length,
    skippedExisting: outcome.skipped.length,
    failed: outcome.failed.length,
    // The rejected list is the part HR must actually read and sign off.
    rejectedRows: rejected,
    skippedRows: outcome.skipped,
    failedRows: outcome.failed,
    createdRows: outcome.created,
  };
}
