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
 *
 * ── Excel import (28-10-2026) ──────────────────────────────────────────────
 *
 * HR now loads previous data with half-done evaluations through a template
 * (export.service.js buildTemplate). No AI reads the sheet: every rule is fixed
 * and anything PEA cannot read is refused with the reason.
 *
 *   · Tier 2 is real now. It was only described: Sheet2 was never read, so an
 *     imported evaluation had no rating at all. readRatingsSheet() reads it.
 *   · When Sheet2 has nothing for an evaluation, resolveRating() falls back in
 *     a fixed order — some questions, the "Question - 3; …" text the export
 *     writes in Sheet1, a single overall number — and says which one it used.
 *     A missing Sheet2 is never an error.
 *   · Status words are exact: Completed, Email Sent, Not Applicable or blank.
 *     "Done" used to read as "nothing sent" (the manager was asked again) and
 *     "Incomplete" as completed (never sent). Both are refused now.
 *   · "Extend for …" rows get their extension evaluations.
 *   · Old undecided rows are no longer imported as Confirmed (HR decision 16
 *     was for demo data). They import in probation and are listed as needing a
 *     decision.
 */
import XLSX from 'xlsx';
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import config from '../config/index.js';
// Excel import (28-10-2026) — the schedule rules too, so the preview can say
// how many evaluations each person gets and which go out first. It was:
// import { generateCycles } from './cycleGenerator.service.js';
import {
  generateCycles,
  generateExtensionCycles,
  buildSchedule,
  buildExtensionSchedule,
} from './cycleGenerator.service.js';
// It was: import { utcDate, toDateString, addMonths, todayIn, toUtcMidnight } from '../utils/dateUtils.js';
import { utcDate, toDateString, addMonths, addDays, todayIn, toUtcMidnight } from '../utils/dateUtils.js';
import { CONFIRMATION_STATUSES } from './employee.service.js';
import { activeParams } from './evaluation.service.js';
import { averageOf, ratingCoverage } from '../utils/ratings.js';

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

/**
 * The 7 parameters in Sheet2, mapped to our param_key values. `col` is the
 * workbook's own header (export.service.js PARAMS writes the same); `label` is
 * the form's wording, which the Sheet1 "Evaluation N" text may use instead.
 */
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

/** The most evaluation columns the sheet has: 6 plus two extensions. */
const MAX_EVALUATIONS = 8;

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const normEmail = (v) => clean(v).toLowerCase() || null;

/** A question's name reduced to its letters, so spacing and "/" never matter. */
const nameKey = (v) => clean(v).toLowerCase().replace(/[^a-z]/g, '');

/** Every spelling of a question the sheet may use → its param_key. */
const QUESTION_BY_NAME = new Map(
  SHEET2_PARAMS.flatMap((p) => [[nameKey(p.col), p.key], [nameKey(p.label), p.key], [nameKey(p.key), p.key]])
);

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
 *
 * Excel import (28-10-2026) — no longer applied: real previous data is loaded
 * now, and confirming someone nobody decided on is not the import's call. See
 * probationEnded(). Kept, with isOldUndecided(), for reference.
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
 * Every evaluation a row will have: the base schedule, plus the extension
 * evaluations an "Extend for …" status adds. Pure.
 * @param {{doj: Date, is_experienced: boolean, confirmation_status: string|null}} row
 * @returns {object[]} buildSchedule() shape
 */
export function scheduleFor(row) {
  const base = buildSchedule(row);
  return [...base, ...buildExtensionSchedule(base.at(-1), row.confirmation_status)];
}

/**
 * The day the probation ended, when it has ended with no final decision — the
 * people HR must decide on after the import. Null otherwise. Pure.
 *
 * Excel import (28-10-2026) — replaces isOldUndecided(): these people were
 * imported as Confirmed.
 *
 * @param {{doj: Date, is_experienced: boolean, confirmation_status: string|null}} row
 * @param {Date} today - UTC midnight
 * @returns {Date|null}
 */
export function probationEnded(row, today) {
  if (TERMINAL_STATUSES.has(row.confirmation_status)) return null;
  const end = scheduleFor(row).at(-1)?.period_to;
  return end && end < today ? end : null;
}

/** The E*n* Status words the sheet may use, as HR types them. */
export const STATUS_WORDS = Object.freeze(['Completed', 'Email Sent', 'Not Applicable']);

/**
 * What the sheet's "EN Status" says about one evaluation.
 *
 *   'completed'      — the manager answered; never send again.
 *   'in_flight'      — Power Automate emailed an MS Forms link ("Email Sent") and
 *                      no answer is recorded. At go-live every Power Automate flow
 *                      and the MS Forms are switched off, so that link is dead:
 *                      the cycle stays due and PEA sends a fresh link. Listed in
 *                      the preview so HR knows which managers get one.
 *   'not_applicable' — not needed; closed, never sent. The export writes it for
 *                      a closed evaluation.
 *   null             — nothing was sent; PEA's sweep handles it as normal.
 *   'unknown'        — any other word. The row is refused.
 *
 * Excel import (28-10-2026) — the words are exact now, ignoring case and
 * spacing. It was a pattern: /complete/i → completed (which caught
 * "Incomplete" and "Not completed"), /\bsent\b/i → in_flight (which caught
 * "Not sent"), anything else → nothing sent (so "Done" or "Submitted" got the
 * manager asked again).
 *
 * @param {{status?: string|null}} [blob]
 * @returns {'completed'|'in_flight'|'not_applicable'|'unknown'|null}
 */
export function legacyCycleState(blob) {
  const s = clean(blob?.status).toLowerCase();
  if (!s) return null;
  if (s === 'completed') return 'completed';
  if (s === 'email sent') return 'in_flight';
  if (s === 'not applicable') return 'not_applicable';
  return 'unknown';
}

/**
 * A rating cell: a number from 1 to 5, or blank. Pure.
 * @param {any} v
 * @returns {{value: number|null, error: string|null}}
 */
export function parseRating(v) {
  const s = clean(v);
  if (!s) return { value: null, error: null };
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1 || n > 5) return { value: null, error: `"${s}" is not a number from 1 to 5` };
  // pea_evaluation_scores.rating is DECIMAL(2,1).
  return { value: Math.round(n * 10) / 10, error: null };
}

/**
 * Ratings from a Sheet1 "Evaluation N" cell — only when it is in the shape the
 * export and the old flow write: "Quality of Code/Work - 3; Meeting Deadline -
 * 4; …". Every part must name a known question and carry a rating from 1 to 5,
 * or nothing is read and the text stays history, as before. A cell holding a
 * single number is that evaluation's average. Pure.
 *
 * @param {string|null} text
 * @returns {{ratings: Record<string, number>, average: number|null}|null}
 */
export function ratingsFromText(text) {
  const s = clean(text);
  if (!s) return null;

  if (/^\d+(\.\d+)?$/.test(s)) {
    const one = parseRating(s);
    return one.value === null ? null : { ratings: {}, average: one.value };
  }

  const ratings = {};
  for (const part of s.split(';').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*[-–:]\s*(\d+(?:\.\d+)?)$/.exec(part);
    if (!m) return null;
    const key = QUESTION_BY_NAME.get(nameKey(m[1]));
    const r = parseRating(m[2]);
    if (!key || r.value === null || key in ratings) return null;
    ratings[key] = r.value;
  }
  return Object.keys(ratings).length ? { ratings, average: null } : null;
}

/**
 * Read Sheet2 — each person's question ratings, comments, overall number and
 * remarks per evaluation, in the export's DETAIL_HEADERS layout. Pure.
 *
 * Nothing here refuses the import on its own: a bad rating is returned as an
 * error against that person (their Sheet1 row is refused), and anything that
 * cannot be matched is returned as a warning.
 *
 * @param {object} wb - the workbook
 * @returns {{found: boolean, byEmail: Map<string, {row: number, evals: object}>,
 *            errors: Map<string, string[]>, warnings: object[]}}
 */
export function readRatingsSheet(wb) {
  const out = { found: false, byEmail: new Map(), errors: new Map(), warnings: [] };
  const name = wb.SheetNames.find((n) => clean(n).toLowerCase() === 'sheet2');
  if (!name) return out;
  out.found = true;

  const sheet = wb.Sheets[name];
  if (!sheet['!ref']) return out;
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });
  const duplicates = new Set();

  rows.forEach((raw) => {
    // 1-based; blank rows are skipped by the parser, so not counted from i.
    const sheetRow = raw.__rowNum__ + 1;
    // Headers as written, with spacing evened out.
    const row = Object.fromEntries(Object.entries(raw).map(([k, v]) => [clean(k), v]));
    const email = normEmail(row['Office Email']);

    const evals = {};
    const problems = [];
    for (let n = 1; n <= MAX_EVALUATIONS; n++) {
      const ratings = {};
      const comments = {};
      for (const p of SHEET2_PARAMS) {
        const r = parseRating(row[`E${n} ${p.col}`]);
        if (r.error) problems.push(`Sheet2 row ${sheetRow}: E${n} ${p.col} ${r.error}`);
        if (r.value !== null) ratings[p.key] = r.value;
        const comment = clean(row[`E${n} ${p.col} (Comments)`]);
        if (comment) comments[p.key] = comment;
      }
      const overall = parseRating(row[`Evaluation ${n}`]);
      if (overall.error) problems.push(`Sheet2 row ${sheetRow}: Evaluation ${n} ${overall.error}`);
      const remarks = clean(row[`E${n} Remarks`]) || null;
      if (Object.keys(ratings).length || overall.value !== null || Object.keys(comments).length || remarks) {
        evals[n] = { ratings, comments, average: overall.value, remarks };
      }
    }

    if (!email) {
      if (Object.keys(evals).length) {
        out.warnings.push({ sheet: 'Sheet2', row: sheetRow, message: 'Ratings with no Office Email — ignored.' });
      }
      return;
    }
    if (out.byEmail.has(email)) {
      duplicates.add(email);
      return;
    }
    out.byEmail.set(email, { row: sheetRow, evals });
    if (problems.length) out.errors.set(email, problems);
  });

  for (const email of duplicates) {
    out.warnings.push({
      sheet: 'Sheet2',
      row: out.byEmail.get(email).row,
      message: `${email} appears more than once — their Sheet2 ratings are ignored.`,
    });
    out.byEmail.delete(email);
    out.errors.delete(email);
  }
  return out;
}

/**
 * The rating a Completed evaluation imports with — the best the sheet has, in
 * this order (Excel import, 28-10-2026):
 *
 *   1–2  Sheet2 question ratings, all or some      → 'sheet2'
 *   3    the Sheet1 "Question - 3; …" text          → 'sheet1_text'
 *   4    one overall number, Sheet2 then Sheet1     → 'sheet2_average' / 'sheet1_number'
 *   5    nothing                                    → null
 *
 * Pure.
 *
 * @param {{ratings: object, comments: object, average: number|null, remarks: string|null}|undefined} s2
 * @param {string|null} text - the Sheet1 "Evaluation N" cell
 * @returns {{ratings: Record<string, number>, comments: Record<string, string>, average: number|null,
 *            coverage: string, source: string|null, remarks: string|null}}
 */
export function resolveRating(s2, text) {
  const fromText = ratingsFromText(text);
  let ratings = {};
  let comments = {};
  let overall = null;
  let source = null;

  if (s2 && Object.keys(s2.ratings).length) {
    ({ ratings, comments } = s2);
    source = 'sheet2';
  } else if (fromText && Object.keys(fromText.ratings).length) {
    ({ ratings } = fromText);
    comments = s2?.comments || {};
    source = 'sheet1_text';
  } else if (s2?.average != null) {
    overall = s2.average;
    source = 'sheet2_average';
  } else if (fromText?.average != null) {
    overall = fromText.average;
    source = 'sheet1_number';
  }

  const rated = Object.keys(ratings).length;
  const average = rated ? averageOf(Object.values(ratings)) : overall;
  return {
    ratings,
    comments,
    average,
    coverage: ratingCoverage('completed', average, rated),
    source,
    remarks: s2?.remarks || null,
  };
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

  // Excel import (28-10-2026) — Sheet2 first, so a bad rating can refuse the
  // Sheet1 row it belongs to.
  const sheet2 = readRatingsSheet(wb);
  const warnings = [...sheet2.warnings];

  const valid = [];
  const rejected = [];
  const seenEmails = new Map();

  rows.forEach((row) => {
    // 1-based. Excel import (28-10-2026) — from the row's own number: the
    // parser skips blank rows, so the count used before (range.s.r + 2 + i)
    // fell behind after the first one and the DOJ was read from the wrong row.
    const excelRow = row.__rowNum__ + 1;
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

    // Excel import (28-10-2026) — every status must be one of the exact words.
    const blobs = collectLegacyBlobs(row);
    for (const [n, blob] of Object.entries(blobs)) {
      if (legacyCycleState(blob) === 'unknown') {
        reasons.push(`E${n} Status: "${blob.status}" — use ${STATUS_WORDS.join(', ')} or leave it blank`);
      }
    }
    // A rating in Sheet2 that is not 1–5 refuses the person, like any other
    // unreadable value.
    reasons.push(...(officeEmail ? sheet2.errors.get(officeEmail) || [] : []));

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
      legacy_blobs: blobs,
      // Excel import (28-10-2026) — the rating each Completed evaluation brings,
      // by evaluation number. Replaces `original_confirmation` and
      // `auto_confirmed`: nothing is confirmed on the sheet's behalf now.
      ratings: {},
    };

    /* Excel import (28-10-2026) — removed, kept for reference:
    if (isOldUndecided(parsed, today)) {
      parsed.confirmation_status = 'Confirmed';
      parsed.auto_confirmed = true;
    } */

    const schedule = scheduleFor(parsed);
    parsed.evaluationCount = schedule.length;
    const s2 = sheet2.byEmail.get(officeEmail);

    for (let n = 1; n <= MAX_EVALUATIONS; n++) {
      const blob = blobs[n];
      const fromSheet2 = s2?.evals[n];
      if (!blob && !fromSheet2) continue;

      if (n > schedule.length) {
        warnings.push({
          sheet: 'Sheet1',
          row: excelRow,
          message: `${name}: Evaluation ${n} has data, but ${isExperienced ? 'an experienced' : 'a fresher'} ` +
            `Commando${confirmation?.startsWith('Extend') ? ` with "${confirmation}"` : ''} has ${schedule.length} evaluations — ignored.`,
        });
        continue;
      }

      const state = legacyCycleState(blob);
      if (state === 'completed') {
        parsed.ratings[n] = resolveRating(fromSheet2, blob?.text);
      } else if (fromSheet2 && (Object.keys(fromSheet2.ratings).length || fromSheet2.average !== null)) {
        warnings.push({
          sheet: 'Sheet2',
          row: s2.row,
          message: `${name}: Evaluation ${n} has ratings, but E${n} Status is not Completed — the ratings are ignored.`,
        });
      }
    }

    valid.push(parsed);
  });

  // Sheet2 rows for nobody on Sheet1.
  for (const [email, s2] of sheet2.byEmail) {
    if (!seenEmails.has(email)) {
      warnings.push({ sheet: 'Sheet2', row: s2.row, message: `${email} is not on Sheet1 — their ratings are ignored.` });
    }
  }

  /* Excel import (28-10-2026) — the confirmed-by-the-import list. Nothing is
     confirmed on the sheet's behalf now; decisionNeededRows below replaces it.
  const autoConfirmedRows = valid
    .filter((v) => v.auto_confirmed)
    .map((v) => ({
      excelRow: v.excelRow,
      name: v.full_name,
      office_email: v.office_email,
      doj: toDateString(v.doj),
      was: v.original_confirmation,
    }));
  */

  // Excel import (28-10-2026) — the probation has run its course with no final
  // decision: HR decides on these after the import.
  const decisionNeededRows = valid
    .map((v) => ({ v, ended: probationEnded(v, today) }))
    .filter(({ ended }) => ended)
    .map(({ v, ended }) => ({
      excelRow: v.excelRow,
      name: v.full_name,
      office_email: v.office_email,
      doj: toDateString(v.doj),
      ended: toDateString(ended),
      status: v.confirmation_status,
    }));

  /* Excel import (28-10-2026) — replaced by toEmailRows, which lists every
     evaluation the next daily send will email, not only the "Email Sent" ones.
     A final decision closes every open evaluation, so only still-open
     employees could have one in flight:
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
  */
  const staleBefore = addDays(today, -STALE_CYCLE_DAYS);
  const toEmailRows = valid
    // A final decision closes every open evaluation; a paused person is not
    // emailed until HR resumes them.
    .filter((v) => !TERMINAL_STATUSES.has(v.confirmation_status) && !v.halt_process)
    .flatMap((v) =>
      scheduleFor(v)
        .filter((c) => c.due_date <= today && c.due_date >= staleBefore)
        .map((c) => ({ c, state: legacyCycleState(v.legacy_blobs[c.seq_no]) }))
        .filter(({ state }) => state !== 'completed' && state !== 'not_applicable')
        .map(({ c, state }) => ({
          excelRow: v.excelRow,
          name: v.full_name,
          office_email: v.office_email,
          rm_email: v.rm_email,
          evaluation: c.seq_no,
          due: toDateString(c.due_date),
          wasSent: state === 'in_flight',
        }))
    );

  // Excel import (28-10-2026) — what each Completed evaluation imports with.
  const ratingRows = valid.flatMap((v) =>
    Object.entries(v.ratings).map(([n, r]) => ({
      excelRow: v.excelRow,
      name: v.full_name,
      office_email: v.office_email,
      evaluation: Number(n),
      coverage: r.coverage,
      rated: Object.keys(r.ratings).length,
      average: r.average,
      source: r.source,
    }))
  );
  const countCoverage = (k) => ratingRows.filter((r) => r.coverage === k).length;

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
      // Excel import (28-10-2026) — were autoConfirmed / autoConfirmedRows and
      // inFlight / inFlightRows.
      decisionNeeded: decisionNeededRows.length,
      decisionNeededRows,
      toEmail: toEmailRows.length,
      toEmailRows,
      ratingsSheetFound: sheet2.found,
      ratings: {
        full: countCoverage('full'),
        partial: countCoverage('partial'),
        averageOnly: countCoverage('average_only'),
        none: countCoverage('none'),
      },
      // The full ones need no reading; the gaps do.
      ratingRows: ratingRows.filter((r) => r.coverage !== 'full'),
      warnings,
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
  for (let n = 1; n <= MAX_EVALUATIONS; n++) {
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
 * The questions each track is rated on, by param_key — labels and order for
 * the imported ratings, exactly as the form would have stored them.
 * @returns {Promise<{fresher: Map<string, object>, experienced: Map<string, object>}>}
 */
async function questionsByTrack() {
  const [fresher, experienced] = await Promise.all([
    activeParams({ is_experienced: false }),
    activeParams({ is_experienced: true }),
  ]);
  const byKey = (list) => new Map(list.map((p) => [p.param_key, p]));
  return { fresher: byKey(fresher), experienced: byKey(experienced) };
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
  // Excel import (28-10-2026) — read once, not per row.
  const questions = dryRun ? null : await questionsByTrack();

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
        // Excel import (28-10-2026) — `ratings` and `evaluationCount` are the
        // parser's, not columns; `auto_confirmed` / `original_confirmation` are
        // gone. It was:
        // const { excelRow: _row, legacy_blobs: blobs, auto_confirmed: autoConfirmed,
        //   original_confirmation: wasStatus, ...data } = row;
        const {
          excelRow: _row,
          legacy_blobs: blobs,
          ratings = {},
          evaluationCount: _count,
          ...data
        } = row;
        let inFlight = 0;
        let rated = 0;

        const employee = await tx.pea_employees.create({
          data: { ...data, source: 'excel' },
        });

        await generateCycles(employee.id, employee, tx);
        // Excel import (28-10-2026) — the sheet already holds the decision, so
        // its extension evaluations are scheduled now, before the evaluation
        // text below looks for a cycle 7 or 8 to sit on.
        if (String(employee.confirmation_status || '').startsWith('Extend')) {
          await generateExtensionCycles(employee.id, employee.confirmation_status, tx);
        }

        const track = row.is_experienced ? questions.experienced : questions.fresher;

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
          const rating = state === 'completed' ? ratings[seqNo] : null;

          await tx.pea_evaluation_cycles.update({
            where: { id: cycle.id },
            data: {
              legacy_raw: JSON.stringify(blob),
              legacy_format: 'sheet1_freetext',
              // A completed evaluation must not be re-sent to the manager. One
              // Power Automate emailed but nobody answered stays due: its MS
              // Forms link stops working at go-live, so PEA sends a fresh one.
              // Excel import (28-10-2026) — "Not Applicable" closes it. It was:
              // status: state === 'completed' ? 'completed' : cycle.status,
              status: state === 'completed' ? 'completed' : state === 'not_applicable' ? 'skipped' : cycle.status,
              // It was: remarks: blob.feedback || null,
              remarks: blob.feedback || rating?.remarks || null,
              // Excel import (28-10-2026) — the rating the sheet had, if any.
              // submitted_at stays empty: this is history, not feedback that
              // came back this week.
              ...(rating ? { avg_rating: rating.average } : {}),
            },
          });

          const keys = Object.keys(rating?.ratings || {});
          if (keys.length) {
            const fallback = new Map(SHEET2_PARAMS.map((p, i) => [p.key, { param_label: p.label, sort_order: i + 1 }]));
            await tx.pea_evaluation_scores.createMany({
              data: keys.map((key) => {
                const q = track.get(key) || fallback.get(key);
                return {
                  cycle_id: cycle.id,
                  param_key: key,
                  param_label: q.param_label,
                  rating: rating.ratings[key],
                  comments: rating.comments[key] || null,
                  sort_order: q.sort_order,
                };
              }),
            });
          }
          if (rating?.average != null) rated += 1;
        }

        const closed = await closeStaleCycles(employee, tx);

        await tx.pea_employee_audit.create({
          data: {
            employee_id: employee.id,
            field_name: '*',
            old_value: null,
            // Excel import (28-10-2026) — the "set to Confirmed (old demo row …;
            // HR decision 16)" part is gone with the rule; the ratings part is new.
            new_value:
              `imported from Excel row ${row.excelRow}` +
              (rated ? ` — ratings imported for ${rated} evaluation(s)` : '') +
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
