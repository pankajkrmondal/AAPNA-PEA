/**
 * Tests for the 23-Sep redesign — "What every manager said".
 *
 * The rules pinned here are the ones the design prints on screen, so a change
 * to any of them would make the screen say something untrue:
 *
 *   · "Needs attention" — not confirmed, extended, an average below 2.5, or any
 *     question rated 2 or lower (the board's filter banner);
 *   · an average is described by its nearest point on the manager's scale
 *     (2.57 "Satisfied", 1.71 "Dissatisfied");
 *   · the manager form requires a comment for a rating of 2 or lower, and a
 *     reason for any decision that is not "Confirmed" — and says so;
 *   · the HR email carries the reason, every question comment and a link to
 *     the evaluation in PEA.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { attentionReasons, ratingBand } from '../services/evaluationBoard.service.js';
import { reasonRequired } from '../services/evaluation.service.js';
import { parseBody } from '../controllers/evaluation.controller.js';
import { renderForm } from '../views/evaluationForm.js';
import { compile, buildVars, TEMPLATE_DEFS } from '../services/emailTemplate.service.js';

const submitted = (over = {}) => ({
  status: 'completed',
  confirmation_status: null,
  avg_rating: 3.4,
  scores: [{ rating: 3 }, { rating: 4 }, { rating: 3 }],
  ...over,
});

describe('needs attention', () => {
  test('a good, undecided evaluation needs nothing', () => {
    assert.deepEqual(attentionReasons(submitted()), []);
  });

  test('not confirmed, and extended, each need a read', () => {
    assert.deepEqual(attentionReasons(submitted({ confirmation_status: 'Not Confirmed' })), ['Not confirmed']);
    assert.deepEqual(attentionReasons(submitted({ confirmation_status: 'Extend for 1 month' })), ['Probation extended']);
    assert.deepEqual(attentionReasons(submitted({ confirmation_status: 'Confirmed' })), []);
  });

  test('an average below 2.5 needs a read; 2.5 itself does not', () => {
    const scores = [{ rating: 3 }];
    assert.ok(attentionReasons(submitted({ avg_rating: 2.49, scores })).includes('Average below 2.5'));
    assert.deepEqual(attentionReasons(submitted({ avg_rating: 2.5, scores })), []);
  });

  test('any single question at 2 or lower needs a read, and says how many', () => {
    assert.deepEqual(
      attentionReasons(submitted({ scores: [{ rating: 2 }, { rating: 4 }, { rating: 1 }] })),
      ['2 questions rated 2 or lower']
    );
  });

  test('nothing that is not submitted ever needs attention', () => {
    assert.deepEqual(attentionReasons(submitted({ status: 'opened', avg_rating: 1 })), []);
  });
});

describe('the word for a rating', () => {
  test('an average takes its nearest point on the scale', () => {
    assert.deepEqual(ratingBand(2.57), { label: 'Satisfied', tone: 'info' });
    assert.deepEqual(ratingBand(1.71), { label: 'Dissatisfied', tone: 'crit' });
    assert.deepEqual(ratingBand(3.71), { label: 'Highly Satisfied', tone: 'ok' });
    assert.deepEqual(ratingBand(4.6), { label: 'Exceptional', tone: 'ok' });
  });

  test('no rating has no word', () => {
    assert.equal(ratingBand(null), null);
  });
});

describe('the manager form', () => {
  const params = [
    { param_key: 'quality_of_work', param_label: 'Quality of Code / Work', sort_order: 1 },
    { param_key: 'meeting_deadline', param_label: 'Meeting Deadline', sort_order: 2 },
  ];
  const data = {
    token: '00000000-0000-0000-0000-000000000000',
    askConfirmation: true,
    params,
    cycle: { seq_no: 6, is_extension: false, periodLabel: '10-Aug-2026 to 09-Sep-2026' },
    employee: { full_name: 'Amit Verma', office_email: 'a@example.com', dojLabel: '10-Mar-2026', is_experienced: false },
  };

  test('only a plain confirmation needs no reason', () => {
    assert.equal(reasonRequired('Confirmed'), false);
    assert.equal(reasonRequired('Not Confirmed'), true);
    assert.equal(reasonRequired('Extend for 2 months'), true);
    assert.equal(reasonRequired(null), false);
  });

  test('the reason for the decision survives the form post', () => {
    const parsed = parseBody({ rating_x: '2', confirmation_status: 'Not Confirmed', confirmation_reason: 'Three below-par months.' });
    assert.equal(parsed.confirmation_reason, 'Three below-par months.');
  });

  test('every problem is listed at once, each linking to its field, with answers kept', () => {
    const html = renderForm(data, {
      problems: [
        { field: 'comments_meeting_deadline', label: 'Meeting Deadline', text: 'Meeting Deadline is rated 2 — add a comment explaining the rating.' },
        { field: 'confirmation_reason', label: 'Extend for 1 month', text: 'You chose Extend for 1 month — give a reason for the decision.' },
      ],
      submitted: {
        ratings: { quality_of_work: { rating: '4', comments: 'Kept text' }, meeting_deadline: { rating: '2', comments: '' } },
        confirmation_status: 'Extend for 1 month',
      },
    });
    assert.match(html, /Please fix 2 things before submitting — your answers are kept\./);
    assert.match(html, /<a href="#c_meeting_deadline">Meeting Deadline<\/a> is rated 2/);
    assert.match(html, /<a href="#reason">Extend for 1 month<\/a>/);
    assert.match(html, /Kept text/);
  });

  test('a rating of 2 renders its comment as required; a 4 does not', () => {
    const html = renderForm(data, {
      submitted: { ratings: { quality_of_work: { rating: '4' }, meeting_deadline: { rating: '2' } } },
    });
    assert.match(html, /class="cmt need" id="box_meeting_deadline"/);
    assert.match(html, /class="cmt" id="box_quality_of_work"/);
  });

  test('user text in the form is escaped', () => {
    const html = renderForm(data, {
      submitted: { ratings: { quality_of_work: { rating: '3', comments: '<script>x</script>' } } },
    });
    assert.ok(!html.includes('<script>x</script>'));
  });
});

describe('the HR "evaluation submitted" email', () => {
  const cycle = {
    id: 4821n,
    seq_no: 6,
    period_from: new Date('2026-08-10'),
    period_to: new Date('2026-09-09'),
    employee: { full_name: 'Amit Verma', office_email: 'a@example.com', rm_name: 'Kavita Rao', rm_email: 'k@example.com' },
  };
  const vars = buildVars(cycle, {
    average: 2.57,
    confirmation: 'Extend for 1 month',
    reason: 'Not yet independent <b>here</b>.',
    remarks: 'Effort is there.',
    isFinal: true,
    scores: [
      { param_label: 'Quality of Code / Work', rating: 2, comments: 'Two bugs.' },
      { param_label: 'Cultural Fit', rating: 3, comments: null },
    ],
    nextCycle: { seq_no: 7, due_date: new Date('2026-10-22') },
  });
  const { body } = compile(TEMPLATE_DEFS.acknowledgement, vars);

  test('says it was the final evaluation, with the decision and the band', () => {
    assert.match(body, /It was the final evaluation of the probation, and the decision is <strong>Extend for 1 month<\/strong>/);
    assert.match(body, /6 \(final\)/);
    assert.match(body, /2\.57 \/ 5<\/strong> — Satisfied/);
  });

  test('carries the reason (escaped), each question comment, and "No comment" where there is none', () => {
    assert.match(body, /Reason for this decision:/);
    assert.match(body, /Not yet independent &lt;b&gt;here&lt;\/b&gt;\./);
    assert.match(body, /Two bugs\./);
    assert.match(body, /No comment/);
  });

  test('says when the extension goes out, and links to the evaluation in PEA', () => {
    assert.match(body, /Evaluation 7 \(extension\) has been scheduled for 22-Oct-2026, and Kavita will receive a new link/);
    assert.match(body, /\/evaluations\/4821/);
    assert.match(body, /Open in PEA/);
  });
});
