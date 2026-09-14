/**
 * Tests for the evaluation scheduling rule.
 *
 * These encode the cadence reverse-engineered from the Power Automate flows.
 * If one of these ever fails, a real manager gets asked to rate the wrong
 * person at the wrong time — so they are the closest thing PEA has to a
 * specification.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSchedule,
  buildExtensionSchedule,
  CADENCE,
} from '../services/cycleGenerator.service.js';
import {
  toDateString,
  shiftOffWeekend,
  isWeekend,
  addDays,
  utcDate,
  todayIn,
  daysBetween,
} from '../utils/dateUtils.js';
import {
  parseTextDate,
  parseExcelDate,
  isOldUndecided,
  legacyCycleState,
} from '../services/excelImport.service.js';

describe('sheet import at go-live — old rows and unanswered MS Forms links', () => {
  const today = utcDate(2026, 9, 13);

  test('a blank status long after DOJ is old demo data → imported as Confirmed', () => {
    assert.equal(isOldUndecided({ doj: utcDate(2022, 9, 26), confirmation_status: null }, today), true);
  });

  test('an old "Extend for …" row is also imported as Confirmed', () => {
    assert.equal(isOldUndecided({ doj: utcDate(2025, 1, 1), confirmation_status: 'Extend for 1 month' }, today), true);
  });

  test('someone still inside 8 months is left in probation', () => {
    assert.equal(isOldUndecided({ doj: utcDate(2026, 3, 1), confirmation_status: null }, today), false);
  });

  test('a real final decision is never overwritten', () => {
    assert.equal(isOldUndecided({ doj: utcDate(2022, 1, 1), confirmation_status: 'Not Confirmed' }, today), false);
  });

  test('"Email Sent" with no answer is recognised as an unanswered MS Forms link', () => {
    assert.equal(legacyCycleState({ status: 'Email Sent' }), 'in_flight');
    assert.equal(legacyCycleState({ status: 'email sent ' }), 'in_flight');
  });

  test('a completed evaluation is completed; a blank one is left to the sweep', () => {
    assert.equal(legacyCycleState({ status: 'Completed' }), 'completed');
    assert.equal(legacyCycleState({ status: null }), null);
    assert.equal(legacyCycleState(undefined), null);
  });
});

describe('fresher cadence', () => {
  const schedule = buildSchedule({ doj: '2026-01-05', is_experienced: false });

  test('produces 6 evaluations', () => {
    assert.equal(schedule.length, 6);
    assert.equal(CADENCE.fresher.cycles, 6);
  });

  test('each evaluation is 30 days after the previous', () => {
    schedule.forEach((cycle, i) => {
      const expected = addDays(utcDate(2026, 1, 5), 30 * (i + 1));
      // due_date may be nudged off a weekend; the period end must not be.
      assert.equal(toDateString(cycle.period_to), toDateString(expected));
    });
  });

  test('periods are contiguous and cover exactly 6 months', () => {
    assert.equal(toDateString(schedule[0].period_from), '2026-01-05');
    for (let i = 1; i < schedule.length; i++) {
      assert.equal(
        toDateString(schedule[i].period_from),
        toDateString(schedule[i - 1].period_to),
        `gap between evaluation ${i} and ${i + 1}`
      );
    }
    assert.equal(daysBetween(utcDate(2026, 1, 5), schedule[5].period_to), 180);
  });

  test('no due date falls on a weekend', () => {
    for (const cycle of schedule) {
      assert.ok(!isWeekend(cycle.due_date), `evaluation ${cycle.seq_no} lands on a weekend`);
    }
  });
});

describe('experienced cadence', () => {
  const schedule = buildSchedule({ doj: '2026-01-05', is_experienced: true });

  test('produces 3 evaluations, 60 days apart', () => {
    assert.equal(schedule.length, 3);
    assert.equal(toDateString(schedule[0].period_to), '2026-03-06'); // +60
    assert.equal(toDateString(schedule[1].period_to), '2026-05-05'); // +120
    assert.equal(toDateString(schedule[2].period_to), '2026-07-04'); // +180
  });

  test('still completes at 6 months, like the fresher track', () => {
    assert.equal(daysBetween(utcDate(2026, 1, 5), schedule[2].period_to), 180);
  });
});

describe('extensions', () => {
  const employee = { doj: '2026-01-05' };

  test('"Extend for 1 month" adds one cycle at day 210', () => {
    const extra = buildExtensionSchedule(employee, 'Extend for 1 month', 6);
    assert.equal(extra.length, 1);
    assert.equal(extra[0].seq_no, 7);
    assert.equal(daysBetween(utcDate(2026, 1, 5), extra[0].period_to), 210);
    assert.ok(extra[0].is_extension);
  });

  test('"Extend for 2 months" adds cycles at days 210 and 240', () => {
    const extra = buildExtensionSchedule(employee, 'Extend for 2 months', 6);
    assert.equal(extra.length, 2);
    assert.deepEqual(extra.map((c) => c.seq_no), [7, 8]);
    assert.equal(daysBetween(utcDate(2026, 1, 5), extra[1].period_to), 240);
  });

  test('a non-extension status produces nothing', () => {
    assert.equal(buildExtensionSchedule(employee, 'Confirmed', 6).length, 0);
    assert.equal(buildExtensionSchedule(employee, null, 6).length, 0);
  });

  test('extension applies the same way regardless of fresher/experienced', () => {
    // The PPT is explicit: on extension both tracks move to a 30-day gap.
    const a = buildExtensionSchedule({ doj: '2026-01-05' }, 'Extend for 2 months', 6);
    const b = buildExtensionSchedule({ doj: '2026-01-05' }, 'Extend for 2 months', 3);
    assert.equal(toDateString(a[0].period_to), toDateString(b[0].period_to));
  });
});

describe('weekend handling', () => {
  test('Saturday moves to Monday', () => {
    assert.equal(toDateString(shiftOffWeekend(utcDate(2026, 1, 3))), '2026-01-05'); // Sat -> Mon
  });

  test('Sunday moves to Monday', () => {
    assert.equal(toDateString(shiftOffWeekend(utcDate(2026, 1, 4))), '2026-01-05');
  });

  test('a weekday is left alone', () => {
    assert.equal(toDateString(shiftOffWeekend(utcDate(2026, 1, 6))), '2026-01-06');
  });

  test('shifts forward, never backward — a period must have finished', () => {
    const sat = utcDate(2026, 1, 3);
    assert.ok(shiftOffWeekend(sat).getTime() > sat.getTime());
  });
});

describe('date parsing — the bug that broke the old system', () => {
  test('reads an Excel serial as a calendar date, with no timezone shift', () => {
    // Serial 44928 is 2 January 2023. Read through a Date in a UTC-behind
    // timezone this becomes 2023-01-01T18:29:50Z — the previous day. Observed
    // in the real workbook.
    const { date } = parseExcelDate({ t: 'n', v: 44928 });
    assert.equal(toDateString(date), '2023-01-02');
  });

  test('prefers the displayed text when a Date carries a time component', () => {
    const shifted = new Date('2023-01-01T18:29:50.000Z');
    const { date } = parseExcelDate({ t: 'd', v: shifted, w: '1/2/23' });
    assert.equal(toDateString(date), '2023-01-02');
  });

  test('accepts the dd-MMM-yyyy format the user guide asks for', () => {
    assert.equal(toDateString(parseTextDate('02-Jan-2023').date), '2023-01-02');
    assert.equal(toDateString(parseTextDate('25-12-2022').date), '2022-12-25');
  });

  test('accepts ISO', () => {
    assert.equal(toDateString(parseTextDate('2023-01-02').date), '2023-01-02');
  });

  test('resolves an unambiguous day-first value correctly', () => {
    // 25 cannot be a month, so this must be 25 December.
    assert.equal(toDateString(parseTextDate('25/12/2022').date), '2022-12-25');
  });

  test('rejects junk rather than guessing', () => {
    assert.equal(parseTextDate('not a date').date, null);
    assert.equal(parseTextDate('').date, null);
    assert.ok(parseTextDate('31/31/2023').error);
  });

  test('expands 2-digit years the way Excel does', () => {
    assert.equal(toDateString(parseTextDate('1/2/23').date), '2023-01-02');
    assert.equal(toDateString(parseTextDate('1/2/99').date), '1999-01-02');
  });
});

describe('timezone independence', () => {
  test('the same DOJ yields the same schedule regardless of server timezone', () => {
    // The original mixed an IST cron with UTC arithmetic, so for 5.5 hours a
    // day the two disagreed about what "today" was. Plan R10.
    const a = buildSchedule({ doj: '2026-01-05', is_experienced: false });
    const b = buildSchedule({ doj: new Date('2026-01-05T00:00:00.000Z'), is_experienced: false });
    assert.deepEqual(
      a.map((c) => toDateString(c.due_date)),
      b.map((c) => toDateString(c.due_date))
    );
  });

  test('todayIn returns a clean calendar date at UTC midnight', () => {
    const today = todayIn('Asia/Kolkata');
    assert.equal(today.getUTCHours(), 0);
    assert.equal(today.getUTCMinutes(), 0);
    assert.match(toDateString(today), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('invalid input', () => {
  test('an unparseable DOJ throws rather than producing a silent bad schedule', () => {
    assert.throws(() => buildSchedule({ doj: 'rubbish', is_experienced: false }), /Invalid date/);
  });
});
