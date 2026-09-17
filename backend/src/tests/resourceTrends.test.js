/**
 * Tests for resource-wise trends — R-06, the headline ask from Subhajit's
 * 15-Sep review.
 *
 *   "What was his score in evaluation 1, what was his score in evaluation 2 —
 *    then that becomes an analytics. That person is growing, or that person is
 *    coming down."                                        — Subhajit, 11:09
 *
 * These encode the two judgements the feature rests on: when a change counts as
 * real movement, and what to do when an evaluation is missing. Both are ways to
 * report a rise or fall that nobody actually scored, which would mislead the
 * person making a confirmation decision.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { trendDirection, parameterMovement, TREND_BAND } from '../services/analytics.service.js';

describe('trend direction — when a change counts as movement', () => {
  test('the band is the proposed ±0.3', () => {
    assert.equal(TREND_BAND, 0.3);
  });

  test('a rise of the full band or more is growing', () => {
    assert.equal(trendDirection(0.3), 'growing');
    assert.equal(trendDirection(0.6), 'growing');
    assert.equal(trendDirection(2), 'growing');
  });

  test('a fall of the full band or more is coming down', () => {
    assert.equal(trendDirection(-0.3), 'declining');
    assert.equal(trendDirection(-0.7), 'declining');
  });

  test('anything inside the band is steady, in both directions', () => {
    assert.equal(trendDirection(0.29), 'steady');
    assert.equal(trendDirection(-0.29), 'steady');
    assert.equal(trendDirection(0), 'steady');
  });

  test('no measurement is not the same as no movement', () => {
    // A single evaluation has nothing to compare against. Reporting it as
    // "steady" would tell HR the person is holding level when in truth nobody
    // has rated them twice yet.
    assert.equal(trendDirection(null), null);
    assert.equal(trendDirection(undefined), null);
  });
});

describe('parameter movement — first and latest of what was actually scored', () => {
  test('compares the ends, not adjacent evaluations', () => {
    const m = parameterMovement({ 1: 3, 2: 4, 3: 4 }, [1, 2, 3]);
    assert.deepEqual(m, { first: 3, latest: 4, change: 1 });
  });

  test('a fall is negative — the "speed of work has decreased" case', () => {
    // Subhajit, 12:10: "the quality of the work has increased, but the speed of
    // the work has decreased". The two must be able to disagree.
    const quality = parameterMovement({ 1: 3, 2: 4, 3: 4 }, [1, 2, 3]);
    const speed = parameterMovement({ 1: 4, 2: 3.5, 3: 3.5 }, [1, 2, 3]);
    assert.equal(quality.change, 1);
    assert.equal(speed.change, -0.5);
  });

  test('a skipped evaluation is a gap, never a zero', () => {
    // Employee 35 in the QA data really does run 1, 2, 3, 6, 7 — cycles 4 and 5
    // were never submitted. Treating those as 0 would show a catastrophic drop.
    const m = parameterMovement({ 1: 4, 2: 3, 3: 2, 6: 4, 7: 4 }, [1, 2, 3, 6, 7]);
    assert.deepEqual(m, { first: 4, latest: 4, change: 0 });
  });

  test('a parameter added partway through compares only where it exists', () => {
    // X-Factor arriving at evaluation 2 must not read as a rise from nothing.
    const m = parameterMovement({ 2: 3, 3: 4 }, [1, 2, 3]);
    assert.deepEqual(m, { first: 3, latest: 4, change: 1 });
  });

  test('one score alone yields no change, not zero', () => {
    assert.deepEqual(parameterMovement({ 1: 4 }, [1, 2, 3]), {
      first: null, latest: null, change: null,
    });
  });

  test('no scores at all yields no change', () => {
    assert.deepEqual(parameterMovement({}, [1, 2]), {
      first: null, latest: null, change: null,
    });
  });

  test('an explicit null rating is absent, not a zero', () => {
    assert.deepEqual(parameterMovement({ 1: null, 2: 4 }, [1, 2]), {
      first: null, latest: null, change: null,
    });
  });

  test('ratings outside the comparable columns are ignored', () => {
    // A legacy cycle's scores must not leak into the comparison: four
    // parameters on a different scale are a different instrument, which is why
    // getAnalytics() already excludes them from parameter averages.
    const m = parameterMovement({ 1: 3, 2: 4, 9: 1 }, [1, 2]);
    assert.deepEqual(m, { first: 3, latest: 4, change: 1 });
  });

  test('fractional changes do not accumulate float noise', () => {
    // 3.7 - 3.1 is 0.5999999999999996 in IEEE 754; HR should see 0.6.
    assert.equal(parameterMovement({ 1: 3.1, 2: 3.7 }, [1, 2]).change, 0.6);
  });
});
