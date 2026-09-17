/**
 * Tests for the editable email templates and the AAPNA branded shell.
 *
 * Every PEA email is now HR-editable, so these pin the two things an edit must
 * never be able to break: the recipient always gets something to act on, and
 * nothing typed by a person can inject markup.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEMPLATE_KEYS,
  TEMPLATE_DEFS,
  PLACEHOLDERS,
  compile,
  renderPreview,
  validateDraft,
  buildVars,
  usedPlaceholders,
} from '../services/emailTemplate.service.js';
import { wrapBrandedEmail, hasOwnSignature } from '../services/emailLayout.service.js';

describe('built-in templates', () => {
  for (const key of TEMPLATE_KEYS) {
    test(`${key}: default wording passes its own validation`, () => {
      const def = TEMPLATE_DEFS[key];
      assert.doesNotThrow(() => validateDraft(key, { subject: def.subject, body: def.body }));
    });

    test(`${key}: every placeholder it declares is in the PLACEHOLDERS registry`, () => {
      // listTemplateCatalog() reads PLACEHOLDERS[name].label for each declared
      // placeholder. A template that names one the registry does not have took
      // the ENTIRE Email templates screen down with "Cannot read properties of
      // undefined (reading 'label')" — a whole page lost to one missing label.
      // The lookup is defensive now; this makes the omission fail here instead.
      const missing = TEMPLATE_DEFS[key].placeholders.filter((name) => !PLACEHOLDERS[name]);
      assert.deepEqual(
        missing,
        [],
        `template "${key}" declares placeholders missing from PLACEHOLDERS: ${missing.join(', ')}`
      );
    });

    test(`${key}: preview fills every placeholder and uses the AAPNA shell`, () => {
      const out = renderPreview(key, {});
      assert.doesNotMatch(out.subject, /\{\{/);
      assert.doesNotMatch(out.body, /\{\{/);
      assert.match(out.body, /aapna-gptw-black\.png/); // logo
      assert.match(out.body, /AAPNA \| HR Team/); // sign-off
      assert.match(out.body, /performance evaluation system/); // footer
      assert.ok(out.body.includes(out.subject.replace(/&/g, '&amp;').replace(/'/g, '\'')), 'subject is the header headline');
    });
  }
});

describe('sending with real values', () => {
  const cycle = {
    seq_no: 1,
    token: '11111111-1111-1111-1111-111111111111',
    period_from: new Date(Date.UTC(2026, 2, 12)),
    period_to: new Date(Date.UTC(2026, 4, 11)),
    employee: { full_name: 'E2E Test Person', office_email: 'e2e@aapnainfotech.com', rm_name: 'Test Manager', rm_email: 'tm@aapnainfotech.com' },
  };

  test('evaluation submitted shows the average — not "undefined"', () => {
    const vars = buildVars(cycle, { average: 4, submittedBy: 'tm@aapnainfotech.com', remarks: 'Good work' });
    const def = TEMPLATE_DEFS.acknowledgement;
    const out = compile(def, vars);
    assert.match(out.body, /<strong>4 \/ 5<\/strong>/);
    assert.doesNotMatch(out.body, /undefined/);
    assert.match(out.body, /Good work/);
    assert.equal(out.subject, 'Performance Evaluation 1 submitted - E2E Test Person');
  });

  test('the old caller name "avg" is still understood', () => {
    assert.equal(buildVars(cycle, { avg: 3.5 }).average_rating, '3.5');
  });

  test('the evaluation request carries the live form link in the button', () => {
    const out = compile(TEMPLATE_DEFS.evaluation_link, buildVars(cycle));
    assert.match(out.body, /href="[^"]*\/api\/evaluation\/11111111-1111-1111-1111-111111111111"/);
  });

  test('extension wording reads correctly', () => {
    const vars = buildVars(cycle, { confirmation: 'Extend for 2 months', submittedBy: 'Test Manager', extensionCycles: 2 });
    const out = compile(TEMPLATE_DEFS.extend_alert, vars);
    assert.match(out.body, /has been extended — <strong>Extend for 2 months<\/strong> — by Test Manager/);
    assert.match(out.body, /2 further evaluations have been scheduled/);
  });

  test('text typed by a person is escaped, never run as HTML', () => {
    const vars = buildVars({ ...cycle, employee: { ...cycle.employee, full_name: '<img src=x onerror=alert(1)>' } }, { remarks: '<script>x</script>' });
    const out = compile(TEMPLATE_DEFS.acknowledgement, vars);
    assert.doesNotMatch(out.body, /<img src=x/);
    assert.doesNotMatch(out.body, /<script>/);
    assert.match(out.body, /&lt;script&gt;/);
  });

  test('an unknown or empty placeholder becomes blank, not the raw token', () => {
    const out = compile({ subject: 'Hi {{manager_name}}', body: '<p>{{remarks}}</p>' }, buildVars(null, {}));
    assert.equal(out.subject, 'Hi');
    assert.doesNotMatch(out.body, /\{\{/);
  });
});

describe('saving an edit — what is refused', () => {
  const base = TEMPLATE_DEFS.evaluation_link;

  test('removing the form link is refused — the manager would have nothing to click', () => {
    const body = base.body.replace('{{form_button}}', '');
    assert.throws(() => validateDraft('evaluation_link', { subject: base.subject, body }), /form_button.*or.*form_link/);
  });

  test('the plain link alone is enough', () => {
    const body = base.body.replace('{{form_button}}', '<p>{{form_link}}</p>');
    assert.doesNotThrow(() => validateDraft('evaluation_link', { subject: base.subject, body }));
  });

  test('a mistyped placeholder is refused and the valid ones are listed', () => {
    assert.throws(
      () => validateDraft('evaluation_link', { subject: base.subject, body: `${base.body} {{employe_name}}` }),
      /Unknown placeholder\(s\): \{\{employe_name\}\}.*\{\{employee_name\}\}/
    );
  });

  test('a placeholder that belongs to another email is refused', () => {
    assert.throws(() => validateDraft('reminder', { subject: 'x {{overdue_table}}', body: '{{form_button}}' }), /Unknown/);
  });

  test('scripts, event handlers and javascript: links are refused', () => {
    for (const bad of ['<script>x</script>', '<a onclick="x()">a</a>', '<a href="javascript:x">a</a>']) {
      assert.throws(() => validateDraft('evaluation_link', { subject: 's', body: `{{form_button}}${bad}` }), /not allowed/);
    }
  });

  test('a whole HTML document is refused — the shell is added automatically', () => {
    assert.throws(() => validateDraft('reminder', { subject: 's', body: '<html><body>{{form_button}}</body></html>' }), /header, logo and footer/);
  });

  test('an empty subject or body is refused', () => {
    assert.throws(() => validateDraft('reminder', { subject: '  ', body: '{{form_button}}' }), /subject is required/);
    assert.throws(() => validateDraft('reminder', { subject: 's', body: '' }), /cannot be empty/);
  });
});

describe('AAPNA branded shell', () => {
  test('wraps a body once — an already wrapped email is left alone', () => {
    const once = wrapBrandedEmail('<p>Hi</p>', { title: 'Hello' });
    assert.equal(wrapBrandedEmail(once, { title: 'Hello' }), once);
  });

  test('the subject in the header is escaped', () => {
    assert.match(wrapBrandedEmail('<p>x</p>', { title: 'C++ & <b>.NET</b>' }), /C\+\+ &amp; &lt;b&gt;\.NET&lt;\/b&gt;/);
  });

  test('a body with its own sign-off does not get a second one', () => {
    assert.equal(hasOwnSignature('<p>Thanks &amp; Regards,<br>Pankaj</p>'), true);
    const out = wrapBrandedEmail('<p>Body</p><p>Thanks &amp; Regards,<br>Pankaj</p>');
    assert.equal(out.match(/Thanks &amp; Regards/g).length, 1);
  });

  test('placeholder scan finds every token', () => {
    assert.deepEqual(usedPlaceholders('{{a}} x {{ b }}'), ['a', 'b']);
  });
});
