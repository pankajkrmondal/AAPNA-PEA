/**
 * Employee self-view disclosure rules. These tests ARE the written-down policy:
 * each level must show what HR chose and not one field more.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { shapeSelfView } from '../services/selfView.service.js';
import { utcDate } from '../utils/dateUtils.js';

const employee = {
  full_name: 'Priya Sharma',
  doj: utcDate(2026, 3, 2),
  is_experienced: false,
  rm_name: 'Chhavi Verma',
  confirmation_status: 'Extend for 1 month',
  office_email: 'psharma@aapnainfotech.com',
  cycles: [
    {
      seq_no: 1, is_extension: false, status: 'completed', avg_rating: '3.57',
      due_date: utcDate(2026, 4, 1), period_from: utcDate(2026, 3, 2), period_to: utcDate(2026, 4, 1),
      remarks: 'Good start.', submitted_by_email: 'cverma@aapnainfotech.com', submitted_ip: '10.0.0.5',
      token: '11111111-1111-1111-1111-111111111111',
      scores: [{ param_label: 'Meeting Deadline', rating: '4.0', comments: 'Always on time' }],
    },
    {
      seq_no: 2, is_extension: false, status: 'email_sent', avg_rating: null,
      due_date: utcDate(2026, 5, 1), period_from: utcDate(2026, 4, 1), period_to: utcDate(2026, 5, 1),
      token: '22222222-2222-2222-2222-222222222222',
    },
  ],
};

const json = (v) => JSON.stringify(v);

describe('employee self-view — what each level discloses', () => {
  test('schedule: dates and status, and no rating of any kind', () => {
    const v = shapeSelfView(employee, 'schedule');
    assert.equal(v.evaluations.length, 2);
    // The shared state names (frontend/src/evaluationStatus.js), told from the
    // employee's own side: "Submitted" is the same state HR and the manager
    // see under that name, so nobody meets two words for one thing.
    assert.equal(v.evaluations[0].status, 'Submitted');
    assert.equal(v.evaluations[1].status, 'With your manager');
    assert.equal('average' in v.evaluations[0], false);
    assert.equal('decision' in v, false, 'the confirmation decision is not schedule information');
    assert.equal(json(v).includes('3.57'), false);
    assert.equal(json(v).includes('Always on time'), false);
  });

  test('averages: adds the average and the decision, still no comments', () => {
    const v = shapeSelfView(employee, 'averages');
    assert.equal(v.evaluations[0].average, 3.57);
    assert.equal(v.evaluations[1].average, null, 'an unsubmitted evaluation has no average');
    assert.equal(v.decision, 'Extend for 1 month');
    assert.equal(json(v).includes('Always on time'), false);
    assert.equal(json(v).includes('Good start'), false);
  });

  test('full: adds per-parameter ratings, comments and remarks for completed evaluations only', () => {
    const v = shapeSelfView(employee, 'full');
    assert.deepEqual(v.evaluations[0].scores, [{ parameter: 'Meeting Deadline', rating: 4, comment: 'Always on time' }]);
    assert.equal(v.evaluations[0].remarks, 'Good start.');
    assert.equal('scores' in v.evaluations[1], false);
  });

  test('no level ever reveals the submitter, their IP, a form token or the office email', () => {
    for (const level of ['schedule', 'averages', 'full']) {
      const out = json(shapeSelfView(employee, level));
      assert.equal(out.includes('10.0.0.5'), false, `${level} leaked the IP`);
      assert.equal(out.includes('cverma@'), false, `${level} leaked the submitter`);
      assert.equal(out.includes('11111111-'), false, `${level} leaked a form token`);
      assert.equal(out.includes('psharma@'), false, `${level} leaked the office email`);
    }
  });
});
