/**
 * Excel import (28-10-2026) — loading previous data with half-done
 * evaluations, through the template.
 *
 * Every case builds a workbook in memory, in the template's own layout, and
 * runs the parser on it: no database. What is checked is what HR sees on
 * "Check file" — who is refused and why, what each Completed evaluation
 * imports with when ratings are missing, and who the next daily send emails.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  parseWorkbook,
  legacyCycleState,
  parseRating,
  ratingsFromText,
  resolveRating,
  probationEnded,
  scheduleFor,
  STATUS_WORDS,
} from '../services/excelImport.service.js';
import { buildTemplate } from '../services/export.service.js';

const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const TODAY = day(2026, 10, 28);

const SHEET1 = XLSX.utils.sheet_to_json(XLSX.read(buildTemplate(), { type: 'buffer' }).Sheets.Sheet1, { header: 1 })[0];
const SHEET2 = XLSX.utils.sheet_to_json(XLSX.read(buildTemplate(), { type: 'buffer' }).Sheets.Sheet2, { header: 1 })[0];

/** One Sheet1 row: a fresher in month 4 unless told otherwise. */
const person = (over = {}) => ({
  Names: 'Riya Sharma',
  'Office Email': 'riya@aapnainfotech.com',
  Experience: 'No',
  DOJ: '05-Jul-2026',
  'RM Name': 'Chhavi Verma',
  'RM Email': 'cverma@aapnainfotech.com',
  'PL Email': 'aroy@aapnainfotech.com',
  ...over,
});

/** All seven questions of evaluation n rated `r`. */
const allRated = (n, r = 4) => Object.fromEntries(
  SHEET2.filter((h) => h.startsWith(`E${n} `) && !h.endsWith('(Comments)') && !h.endsWith('Remarks')).map((h) => [h, r])
);

/** A workbook from Sheet1 rows (null = a blank row) and, if given, Sheet2 rows. */
function workbook(rows, ratings) {
  const wb = XLSX.utils.book_new();
  const aoa = [SHEET1, ...rows.map((r) => (r ? SHEET1.map((h) => r[h] ?? '') : []))];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Sheet1');
  if (ratings) {
    const s2 = [SHEET2, ...ratings.map((r) => SHEET2.map((h) => r[h] ?? ''))];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s2), 'Sheet2');
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

const parse = (rows, ratings) => parseWorkbook(workbook(rows, ratings), { today: TODAY });

describe('the template', () => {
  test('has Sheet1, Sheet2 and "How to fill", and an empty one parses to nothing', () => {
    const wb = XLSX.read(buildTemplate(), { type: 'buffer' });
    assert.deepEqual(wb.SheetNames, ['Sheet1', 'Sheet2', 'How to fill']);
    const out = parseWorkbook(buildTemplate(), { today: TODAY });
    assert.equal(out.report.rowsRead, 0);
    assert.equal(out.report.ratingsSheetFound, true);
    assert.deepEqual(out.report.warnings, []);
  });

  test('carries no example person on the sheets that are imported', () => {
    const wb = XLSX.read(buildTemplate(), { type: 'buffer' });
    assert.equal(XLSX.utils.sheet_to_json(wb.Sheets.Sheet1).length, 0);
    assert.equal(XLSX.utils.sheet_to_json(wb.Sheets.Sheet2).length, 0);
  });
});

describe('status words are exact', () => {
  test('the three words and blank', () => {
    assert.equal(legacyCycleState({ status: 'Completed' }), 'completed');
    assert.equal(legacyCycleState({ status: ' email  SENT ' }), 'in_flight');
    assert.equal(legacyCycleState({ status: 'Not Applicable' }), 'not_applicable');
    assert.equal(legacyCycleState({ status: '' }), null);
  });

  test('words the old pattern guessed at are refused, not guessed', () => {
    // /complete/i read these two as completed — never sent.
    assert.equal(legacyCycleState({ status: 'Incomplete' }), 'unknown');
    assert.equal(legacyCycleState({ status: 'Not completed' }), 'unknown');
    // These read as "nothing sent" — the manager was asked again.
    assert.equal(legacyCycleState({ status: 'Done' }), 'unknown');
    assert.equal(legacyCycleState({ status: 'Submitted' }), 'unknown');
  });

  test('a row with an unknown word is refused, saying which words to use', () => {
    const out = parse([person({ 'E1 Status': 'Done' })]);
    assert.equal(out.valid.length, 0);
    const why = out.rejected[0].reasons.join(' ');
    assert.match(why, /E1 Status: "Done"/);
    for (const w of STATUS_WORDS) assert.match(why, new RegExp(w));
  });
});

describe('blank rows', () => {
  test('a blank row does not shift the next person\'s joining date', () => {
    // The row number used to be counted, and the parser skips blank rows, so
    // the DOJ was read from the row above.
    const out = parse([person(), null, person({ 'Office Email': 'b@aapnainfotech.com', DOJ: '01-Aug-2026' })]);
    assert.equal(out.rejected.length, 0);
    assert.equal(out.valid[1].excelRow, 4);
    assert.deepEqual(out.valid[1].doj, day(2026, 8, 1));
  });
});

describe('ratings — Sheet2 and what happens without it', () => {
  test('1 · all seven in Sheet2 → full, average of the seven', () => {
    const out = parse([person({ 'E1 Status': 'Completed' })], [{ 'Office Email': 'riya@aapnainfotech.com', ...allRated(1, 4) }]);
    const r = out.valid[0].ratings[1];
    assert.equal(r.coverage, 'full');
    assert.equal(r.source, 'sheet2');
    assert.equal(r.average, 4);
    assert.equal(out.report.ratings.full, 1);
  });

  test('2 · five of seven → partly rated, average of the five', () => {
    const five = Object.fromEntries(Object.entries(allRated(1, 3)).slice(0, 5));
    five[Object.keys(five)[0]] = 5; // 5,3,3,3,3 → 3.4
    const out = parse([person({ 'E1 Status': 'Completed' })], [{ 'Office Email': 'riya@aapnainfotech.com', ...five }]);
    const r = out.valid[0].ratings[1];
    assert.equal(r.coverage, 'partial');
    assert.equal(Object.keys(r.ratings).length, 5);
    assert.equal(r.average, 3.4);
    assert.equal(out.report.ratingRows[0].coverage, 'partial');
  });

  test('3 · no Sheet2 at all, ratings written in Sheet1 → read from the text', () => {
    const out = parse([person({
      'E1 Status': 'Completed',
      'Evaluation 1': 'Quality of Code / Work - 4; Meeting Deadine - 3; Communication & Presentation - 4; '
        + 'Proactiveness - 4; Skill Development - 3; Cultural Fit - 5; X-Factor - 4',
    })]);
    assert.equal(out.report.ratingsSheetFound, false);
    const r = out.valid[0].ratings[1];
    assert.equal(r.source, 'sheet1_text');
    assert.equal(r.coverage, 'full');
    assert.equal(r.average, 3.86);
  });

  test('4 · one overall number → average only', () => {
    const out = parse(
      [person({ 'E1 Status': 'Completed' }), person({ 'Office Email': 'b@aapnainfotech.com', 'E1 Status': 'Completed', 'Evaluation 1': '3.6' })],
      [{ 'Office Email': 'riya@aapnainfotech.com', 'Evaluation 1': 3.2 }]
    );
    assert.deepEqual([out.valid[0].ratings[1].coverage, out.valid[0].ratings[1].average, out.valid[0].ratings[1].source],
      ['average_only', 3.2, 'sheet2_average']);
    assert.deepEqual([out.valid[1].ratings[1].coverage, out.valid[1].ratings[1].average, out.valid[1].ratings[1].source],
      ['average_only', 3.6, 'sheet1_number']);
    assert.equal(out.report.ratings.averageOnly, 2);
  });

  test('5 · nothing usable → imported without a rating, the text kept', () => {
    const out = parse([person({ 'E1 Status': 'Completed', 'Evaluation 1': 'Good work overall, needs speed' })]);
    const r = out.valid[0].ratings[1];
    assert.equal(r.coverage, 'none');
    assert.equal(r.average, null);
    assert.equal(out.valid[0].legacy_blobs[1].text, 'Good work overall, needs speed');
    assert.equal(out.report.ratings.none, 1);
  });

  test('a person missing from Sheet2 falls back the same way', () => {
    const out = parse(
      [person({ 'E1 Status': 'Completed', 'Evaluation 1': '4' })],
      [{ 'Office Email': 'someone.else@aapnainfotech.com', ...allRated(1) }]
    );
    assert.equal(out.valid[0].ratings[1].source, 'sheet1_number');
    assert.match(out.report.warnings[0].message, /someone\.else@aapnainfotech\.com is not on Sheet1/);
  });

  test('a rating that is not 1–5 refuses the person', () => {
    const out = parse([person({ 'E1 Status': 'Completed' })], [{ 'Office Email': 'riya@aapnainfotech.com', 'E1 Proactiveness': 'Good' }]);
    assert.equal(out.valid.length, 0);
    assert.match(out.rejected[0].reasons.join(' '), /E1 Proactiveness "Good" is not a number from 1 to 5/);
  });

  test('ratings on an evaluation that is not Completed are ignored, with a warning', () => {
    const out = parse([person({ 'E1 Status': 'Email Sent' })], [{ 'Office Email': 'riya@aapnainfotech.com', ...allRated(1) }]);
    assert.equal(out.valid[0].ratings[1], undefined);
    assert.match(out.report.warnings[0].message, /E1 Status is not Completed/);
  });

  test('a person twice in Sheet2 → their Sheet2 is ignored, with a warning', () => {
    const out = parse(
      [person({ 'E1 Status': 'Completed' })],
      [{ 'Office Email': 'riya@aapnainfotech.com', ...allRated(1, 4) }, { 'Office Email': 'riya@aapnainfotech.com', ...allRated(1, 2) }]
    );
    assert.equal(out.valid[0].ratings[1].coverage, 'none');
    assert.match(out.report.warnings[0].message, /more than once/);
  });

  test('text that is not exactly "Question - rating" is not half-read', () => {
    assert.equal(ratingsFromText('Quality of Code/Work - 4; Teamwork - 3'), null); // unknown question
    assert.equal(ratingsFromText('Quality of Code/Work - 7'), null); // out of range
    assert.equal(ratingsFromText('Quality - 4 and good'), null);
    assert.deepEqual(ratingsFromText('X-Factor - 4'), { ratings: { x_factor: 4 }, average: null });
  });

  test('parseRating and resolveRating, directly', () => {
    assert.deepEqual(parseRating(''), { value: null, error: null });
    assert.deepEqual(parseRating('3.5'), { value: 3.5, error: null });
    assert.equal(parseRating(0).error, '"0" is not a number from 1 to 5');
    assert.equal(resolveRating(undefined, null).coverage, 'none');
  });
});

describe('extensions and probation that has already ended', () => {
  test('"Extend for 2 months" gives a fresher 8 evaluations, so E7 and E8 are read', () => {
    const row = { doj: day(2025, 12, 1), is_experienced: false, confirmation_status: 'Extend for 2 months' };
    assert.equal(scheduleFor(row).length, 8);
    const out = parse([person({ DOJ: '01-Dec-2025', 'Confirmation Status': 'Extend for 2 months', 'E7 Status': 'Completed', 'Evaluation 7': '3' })]);
    assert.equal(out.valid[0].evaluationCount, 8);
    assert.equal(out.valid[0].ratings[7].average, 3);
  });

  test('evaluation 7 for someone with 6 is ignored, with a warning', () => {
    const out = parse([person({ 'E7 Status': 'Completed' })]);
    assert.match(out.report.warnings[0].message, /Evaluation 7 has data/);
  });

  test('an old undecided row is NOT confirmed — it is listed as needing a decision', () => {
    const out = parse([person({ DOJ: '01-Jan-2025' })]);
    assert.equal(out.valid[0].confirmation_status, null);
    assert.equal(out.report.decisionNeeded, 1);
    assert.equal(out.report.decisionNeededRows[0].name, 'Riya Sharma');
  });

  test('probationEnded: only without a final decision, only once the last evaluation period is over', () => {
    const base = { doj: day(2026, 1, 1), is_experienced: true };
    assert.ok(probationEnded({ ...base, confirmation_status: null }, TODAY));
    assert.equal(probationEnded({ ...base, confirmation_status: 'Confirmed' }, TODAY), null);
    assert.equal(probationEnded({ ...base, doj: day(2026, 8, 1), confirmation_status: null }, TODAY), null);
  });
});

describe('who the next daily send emails', () => {
  test('due in the last 45 days and not Completed — "Email Sent" and never-sent alike', () => {
    // DOJ 5 Jul: E1 due ~4 Aug (over 45 days), E2 ~3 Sep (55 days), E3 ~5 Oct (23 days).
    const out = parse([person({ 'E1 Status': 'Completed', 'E3 Status': 'Email Sent' })]);
    const rows = out.report.toEmailRows.map((r) => [r.evaluation, r.wasSent]);
    assert.deepEqual(rows, [[3, true]]);
  });

  test('a paused person, or one with a final decision, is not emailed', () => {
    const out = parse([
      person({ Halt_Process: 'Yes' }),
      person({ 'Office Email': 'b@aapnainfotech.com', 'Confirmation Status': 'Confirmed' }),
    ]);
    assert.equal(out.report.toEmail, 0);
  });
});
