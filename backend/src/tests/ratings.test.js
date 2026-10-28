/**
 * Commando average (28-10-2026) — "THIS IS per COMMANDO AVG RATING ONLY".
 *
 * One Commando's average across their own submitted evaluations, each counting
 * once, and the label an imported evaluation carries when its sheet lacked
 * ratings. Pure, so no database.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  averageOf, commandoAverage, commandoAverageText, ratingCoverage, QUESTION_COUNT,
} from '../utils/ratings.js';

describe('averageOf — one evaluation', () => {
  test('the 2-decimal mean, as the form always worked it out', () => {
    assert.equal(averageOf([4, 3, 4, 4, 3, 5, 4]), 3.86);
    assert.equal(averageOf(['3.5', 4]), 3.75);
  });

  test('blanks are absent, not zero; nothing at all is null', () => {
    assert.equal(averageOf([4, null, undefined, '']), 4);
    assert.equal(averageOf([]), null);
  });
});

describe('commandoAverage — one person, their own evaluations', () => {
  test('each submitted evaluation counts once', () => {
    const cycles = [
      { status: 'completed', avg_rating: 3.2 },
      { status: 'completed', avg_rating: '3.60' },
      { status: 'completed', avg_rating: 3.9 },
    ];
    assert.deepEqual(commandoAverage(cycles), { average: 3.57, count: 3, unrated: 0 });
  });

  test('evaluations not submitted do not count', () => {
    const cycles = [
      { status: 'completed', avg_rating: 4 },
      { status: 'email_sent', avg_rating: null },
      { status: 'pending', avg_rating: null },
      { status: 'skipped', avg_rating: null },
    ];
    assert.deepEqual(commandoAverage(cycles), { average: 4, count: 1, unrated: 0 });
  });

  test('an imported evaluation without a rating is left out and counted as unrated', () => {
    const cycles = [{ status: 'completed', avg_rating: 3 }, { status: 'completed', avg_rating: null }];
    assert.deepEqual(commandoAverage(cycles), { average: 3, count: 1, unrated: 1 });
  });

  test('nothing submitted → null, never 0', () => {
    assert.deepEqual(commandoAverage([{ status: 'pending', avg_rating: null }]), { average: null, count: 0, unrated: 0 });
    assert.deepEqual(commandoAverage(undefined), { average: null, count: 0, unrated: 0 });
  });

  test('in words for the shared report', () => {
    assert.equal(commandoAverageText({ average: 3.57, count: 3, unrated: 0 }), '3.57 / 5 from 3 evaluations');
    assert.equal(commandoAverageText({ average: 4, count: 1, unrated: 1 }), '4.00 / 5 from 1 evaluation (1 imported without a rating, not counted)');
    assert.equal(commandoAverageText({ average: null, count: 0 }), 'No rated evaluation yet');
  });
});

describe('ratingCoverage — how much of a rating came with the sheet', () => {
  test('a manager-submitted evaluation is full', () => {
    assert.equal(ratingCoverage('completed', 3.86, QUESTION_COUNT), 'full');
  });

  test('imported gaps', () => {
    assert.equal(ratingCoverage('completed', 3.4, 5), 'partial');
    assert.equal(ratingCoverage('completed', 3.6, 0), 'average_only');
    assert.equal(ratingCoverage('completed', null, 0), 'none');
  });

  test('not submitted has no coverage', () => {
    assert.equal(ratingCoverage('pending', null, 0), null);
  });
});
