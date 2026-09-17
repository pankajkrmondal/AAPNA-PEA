/**
 * Tests for R-05 — sharing one person's evaluation record.
 *
 * Subhajit, 15-Sep demo (19:44):
 *
 *   "Anuj drops an email to me that I want to know what is the current
 *    evolution status of XYZ resource… So I will be able to send the evolution
 *    report within one click. I can send an email to Anuj keeping Rakhi ma'am
 *    in CC."
 *
 * The recipient is typed at send time, which is the whole point — whoever asked
 * is not a role PEA can know in advance. That also makes it the one email type
 * where a typo sends a named person's ratings and their manager's written
 * comments to the wrong inbox, so the address rules are tested here rather than
 * trusted to the form.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipients, buildWorkbook, reportFilename } from '../services/evaluationReport.service.js';
import { renderPreview, TEMPLATE_KEYS } from '../services/emailTemplate.service.js';

describe('R-05 — who a report may be sent to', () => {
  test('a company address is accepted', () => {
    assert.deepEqual(parseRecipients('anuj@aapnainfotech.com', 'To'), ['anuj@aapnainfotech.com']);
  });

  test('a list is split on commas and semicolons', () => {
    assert.deepEqual(
      parseRecipients('a@aapnainfotech.com, b@aapnainfotech.com; c@aapnainfotech.com', 'CC'),
      ['a@aapnainfotech.com', 'b@aapnainfotech.com', 'c@aapnainfotech.com']
    );
  });

  test('case and padding do not create duplicates', () => {
    assert.deepEqual(
      parseRecipients(['  Anuj@Aapnainfotech.com ', 'anuj@aapnainfotech.com'], 'To'),
      ['anuj@aapnainfotech.com']
    );
  });

  test('an outside address is refused', () => {
    // The report carries ratings and manager comments. One mistyped domain
    // should not send that out of the company.
    assert.throws(
      () => parseRecipients('someone@gmail.com', 'To'),
      /outside the company/
    );
  });

  test('a lookalike domain is refused', () => {
    assert.throws(
      () => parseRecipients('attacker@aapnainfotech.com.evil.com', 'To'),
      /outside the company/
    );
  });

  test('a malformed address is refused before the domain rule', () => {
    assert.throws(() => parseRecipients('not-an-email', 'To'), /not a valid email address/);
  });

  test('an empty list is empty, not an error — CC is optional', () => {
    assert.deepEqual(parseRecipients('', 'CC'), []);
    assert.deepEqual(parseRecipients(undefined, 'CC'), []);
  });
});

describe('R-05 — the workbook', () => {
  const report = {
    employee: {
      name: 'Priya Sharma',
      email: 'psharma@aapnainfotech.com',
      doj: new Date('2026-05-07'),
      cohort: 'Fresher',
      rmName: 'Chhavi Verma',
      plEmail: 'aroy@aapnainfotech.com',
      confirmationStatus: null,
    },
    completedCount: 2,
    totalCount: 6,
    cycles: [
      {
        seqNo: 1, status: 'completed', dueDate: new Date('2026-06-06'),
        submittedAt: new Date('2026-06-07'), avgRating: 3.1, remarks: 'Settling in.',
        confirmationStatus: null, isExtension: false, legacy: false,
        scores: [{ key: 'quality', label: 'Quality of work', rating: 3, comments: 'Good' }],
      },
      {
        seqNo: 2, status: 'completed', dueDate: new Date('2026-07-06'),
        submittedAt: new Date('2026-07-07'), avgRating: 3.5, remarks: null,
        confirmationStatus: null, isExtension: false, legacy: false,
        scores: [{ key: 'quality', label: 'Quality of work', rating: 4, comments: null }],
      },
    ],
  };

  test('it produces a non-empty xlsx buffer', () => {
    const buf = buildWorkbook(report);
    assert.ok(Buffer.isBuffer(buf));
    assert.ok(buf.length > 0);
    // The xlsx magic bytes — it is a zip container.
    assert.equal(buf[0], 0x50);
    assert.equal(buf[1], 0x4b);
  });

  test('the filename is safe and names the person', () => {
    assert.equal(reportFilename(report), 'Priya-Sharma-evaluation-report.xlsx');
  });

  test('a name with punctuation cannot break out of the filename', () => {
    const odd = { employee: { name: 'A/B\\C:*?"<>|' } };
    const name = reportFilename(odd);
    assert.ok(!/[/\\:*?"<>|]/.test(name), `unsafe filename: ${name}`);
    assert.ok(name.endsWith('.xlsx'));
  });

  test('an empty name still yields a usable filename', () => {
    assert.equal(reportFilename({ employee: { name: '' } }), 'employee-evaluation-report.xlsx');
  });
});

describe('R-05 — the email', () => {
  test('the template is registered', () => {
    assert.ok(TEMPLATE_KEYS.includes('evaluation_report'));
  });

  test('it carries the record inline, not only as an attachment', () => {
    // The person who asked should be able to read the answer without opening
    // anything — that is what "within one click" means for the recipient too.
    const r = renderPreview('evaluation_report');
    assert.match(r.subject, /Evaluation report/);
    assert.ok(r.body.includes('Probation decision'), 'header table');
    assert.ok(r.body.includes('Settling in well'), 'per-evaluation remarks');
    assert.ok(r.body.includes('3.7'), 'the ratings themselves');
  });
});
