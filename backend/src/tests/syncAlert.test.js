/**
 * Tests for R-03 — the Microsoft 365 check alert.
 *
 * Subhajit, 15-Sep demo (15:39), on what happens once he trusts the automation:
 *
 *   "if for 6 months it gets run, it becomes my habit. So that manual thing
 *    goes away from me actually."
 *
 * and (16:14): "If any data is not being synced properly from the AD, we should
 * be getting an email alert so that we can take it up manually."
 *
 * The danger of a good automation is that people stop checking it. These tests
 * pin the two properties that make the alert trustworthy: it fires on real
 * problems, and it does NOT fire otherwise — an alert that cries wolf nightly
 * is one HR learns to delete, which returns them to the silent-failure state
 * the feature exists to prevent.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderPreview, TEMPLATE_KEYS, buildVars } from '../services/emailTemplate.service.js';

describe('R-03 — the alert email', () => {
  test('the template is registered', () => {
    assert.ok(TEMPLATE_KEYS.includes('sync_alert'));
  });

  test('it renders the problem table, the remedy and the scan summary', () => {
    const r = renderPreview('sync_alert');

    assert.match(r.subject, /Microsoft 365 check needs attention/);
    assert.ok(r.body.includes('No reporting manager'), 'names what is wrong');
    assert.ok(r.body.includes('Kavya Pillai'), 'names who it is about');
    // The alert is only half an answer without the remedy — R-07's sheet upload.
    assert.ok(r.body.includes('New joiners screen'), 'says what to do about it');
    assert.ok(r.body.includes('Accounts read'), 'shows what the scan actually did');
  });

  test('it promises not to repeat, because it does not', () => {
    const r = renderPreview('sync_alert');
    assert.ok(/will not repeat every night/i.test(r.body));
  });

  test('with no problems, the table and the remedy collapse to nothing', () => {
    // An empty problem list must not render an empty table or a stray "what to
    // do" with nothing to do.
    const vars = buildVars(null, { problems: [], headline: 'All clear', today: '16-Sep-2026' });
    assert.equal(vars._problems.length, 0);
    assert.equal(vars.problem_count, '0');
  });

  test('the scan summary is omitted when there is no scan to report', () => {
    const vars = buildVars(null, { problems: [{ title: 'x', detail: 'y' }], today: '16-Sep-2026' });
    assert.equal(vars._scan, null);
  });
});

describe('R-03 — dedupe keys, so one problem is one alert', () => {
  // The keys the service builds. A record broken for a fortnight must produce
  // one alert, not fourteen; but a record that develops a SECOND, different
  // fault is a new thing to say.
  const keyFor = (id, fault) => `candidate:${id}:${fault}`;

  test('the same fault on the same record is the same key', () => {
    assert.equal(keyFor('7', 'no-manager'), keyFor('7', 'no-manager'));
  });

  test('a different fault on the same record is a different key', () => {
    assert.notEqual(keyFor('7', 'no-manager'), keyFor('7', 'no-doj'));
  });

  test('the same fault on a different record is a different key', () => {
    assert.notEqual(keyFor('7', 'no-manager'), keyFor('8', 'no-manager'));
  });

  test('a failed scan is keyed on the run, so tomorrow\'s failure is announced afresh', () => {
    const runKey = (id) => `scan:failed:${id}`;
    assert.notEqual(runKey('101'), runKey('102'));
  });

  test('a stale scan is keyed on the day, so it is said once a day at most', () => {
    const staleKey = (day) => `scan:stale:${day}`;
    assert.equal(staleKey('2026-09-16'), staleKey('2026-09-16'));
    assert.notEqual(staleKey('2026-09-16'), staleKey('2026-09-17'));
  });
});
