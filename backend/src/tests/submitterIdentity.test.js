/**
 * Tests for R-01 — who an evaluation is recorded as coming from.
 *
 * Subhajit, 15-Sep demo (28:07): "Then I saw your email, so HR knows who
 * responded. If someone doesn't fill this, so we will not be able to understand
 * who has filled it." And (28:58): "You can remove this because it will be only
 * with the RM. RM will only be filling."
 *
 * The old form asked the manager to type their own address into an OPTIONAL
 * field. That fails two ways: left blank, HR cannot tell who responded — the
 * very thing the field existed for; filled in with another name, the record
 * credits the wrong person. The link is single-use and issued to one manager,
 * so the token already knows the answer.
 *
 * These tests pin the parsing boundary: whatever a client posts, the submitter
 * is not taken from the request body.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseBody } from '../controllers/evaluation.controller.js';

describe('R-01 — the submitter comes from the link, never from the form', () => {
  test('a posted submitted_by is dropped from an HTML form body', () => {
    const parsed = parseBody({
      rating_quality: '4',
      comments_quality: 'Good',
      remarks: 'Solid quarter',
      submitted_by: 'someone.else@aapnainfotech.com',
    });

    assert.equal(parsed.submitted_by, undefined);
    assert.equal(parsed.remarks, 'Solid quarter');
    assert.deepEqual(parsed.ratings.quality, { rating: '4', comments: 'Good' });
  });

  test('a posted submitted_by is dropped from a JSON body too', () => {
    // The JSON branch returns the body as-is, so the guarantee has to hold on
    // the path an API client uses, not only the browser one.
    const parsed = parseBody({
      ratings: { quality: { rating: 4 } },
      remarks: 'Fine',
      submitted_by: 'impostor@aapnainfotech.com',
    });

    assert.equal(
      parsed.submitted_by,
      undefined,
      'a JSON client must not be able to name the author of an evaluation'
    );
  });

  test('ratings and comments still parse normally', () => {
    const parsed = parseBody({
      rating_communication: '5',
      comments_communication: 'Clear',
      rating_deadline: '3',
      confirmation_status: 'Confirmed',
    });

    assert.deepEqual(parsed.ratings.communication, { rating: '5', comments: 'Clear' });
    assert.deepEqual(parsed.ratings.deadline, { rating: '3' });
    assert.equal(parsed.confirmation_status, 'Confirmed');
  });

  test('a parameter key containing an underscore survives the split', () => {
    // skill_development would break a naive split on '_'.
    const parsed = parseBody({ rating_skill_development: '4', comments_skill_development: 'Improving' });
    assert.deepEqual(parsed.ratings.skill_development, { rating: '4', comments: 'Improving' });
  });
});
