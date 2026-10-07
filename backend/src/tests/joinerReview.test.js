/**
 * H1 follow-up (07-10-2026) — the joiner review stays, and admins and HR are
 * told when it is needed.
 *
 * Microsoft 365 holds neither the date of joining nor the years of experience,
 * and will not. So PEA SUGGESTS both — the day after the account was created,
 * and fresher or experienced from the designation — and nothing is final until
 * HR or an admin confirms the joiner. These tests cover the rules that can be
 * checked without a database or Microsoft 365.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { trackFromTitle, TITLE_WORD_DEFAULTS, parseList } from '../services/directory.service.js';
import { serialiseCandidate, joinerReviewRow, dailyReminderDue } from '../services/joinerIntake.service.js';
import { reviewRecipients } from '../services/notification.service.js';
import { TEMPLATE_DEFS, compile, buildVars, validateDraft } from '../services/emailTemplate.service.js';
import { REGISTRY, normaliseValue } from '../services/settings.service.js';

const day = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const WORDS = {
  fresherWords: parseList(TITLE_WORD_DEFAULTS.joiner_title_words_fresher),
  experiencedWords: parseList(TITLE_WORD_DEFAULTS.joiner_title_words_experienced),
};
const track = (title) => trackFromTitle(title, WORDS).isExperienced;

describe('fresher or experienced, suggested from the designation', () => {
  test('a trainee is suggested as a fresher', () => {
    assert.equal(track('Trainee Software Engineer'), false);
    assert.equal(track('Intern - QA'), false);
  });

  test('an associate is experienced — one to two years at AAPNA (Harish, 07-10-2026)', () => {
    assert.equal(track('Associate Software Engineer'), true);
  });

  test('senior titles are experienced, "Sr." included', () => {
    assert.equal(track('Senior QA Engineer'), true);
    assert.equal(track('Sr. QA Engineer'), true);
    assert.equal(track('Tech Lead'), true);
  });

  test('a title with no listed word gets no suggestion — HR chooses', () => {
    assert.equal(track('Software Engineer'), null);
  });

  test('whole words only: "Headcount Analyst" is not "head"', () => {
    assert.equal(track('Headcount Analyst'), null);
    assert.equal(track('Head of Delivery'), true);
  });

  test('a title with words from both lists is experienced', () => {
    assert.equal(track('Senior Trainer, Graduate Programme'), true);
  });

  test('capitals do not matter', () => {
    assert.equal(track('JUNIOR DEVELOPER'), false);
  });

  test('no title, or empty word lists, suggests nothing', () => {
    assert.equal(track(''), null);
    assert.equal(track(null), null);
    assert.equal(trackFromTitle('Trainee', {}).isExperienced, null);
  });

  test('it says which word decided it', () => {
    assert.equal(trackFromTitle('Associate Consultant', WORDS).matched, 'associate');
  });
});

describe('the inbox shows the suggestion, worked out when it is read', () => {
  const row = {
    id: 7n,
    employee_id: null,
    display_name: 'Rohan Mehta',
    office_email: 'rmehta@aapnainfotech.com',
    suggested_doj: day(2026, 10, 6),
    raw_graph: { jobTitle: 'Associate Software Engineer' },
  };

  test('the title and the suggested track come with the joiner', () => {
    const s = serialiseCandidate(row, WORDS);
    assert.equal(s.job_title, 'Associate Software Engineer');
    assert.equal(s.suggested_is_experienced, true);
    assert.equal(s.track_source, 'job_title');
    assert.equal(s.suggested_doj, '2026-10-06');
    assert.equal(s.id, '7');
  });

  test('a joiner stored before titles were read gets no suggestion', () => {
    const s = serialiseCandidate({ ...row, raw_graph: { displayName: 'Rohan Mehta' } }, WORDS);
    assert.equal(s.suggested_is_experienced, null);
    assert.equal(s.track_source, null);
  });

  test('without word lists nothing is suggested', () => {
    assert.equal(serialiseCandidate(row).suggested_is_experienced, null);
  });
});

describe('each joiner in the review email', () => {
  const today = day(2026, 10, 7);
  const candidate = {
    id: 9n,
    display_name: 'Sneha Iyer',
    office_email: 'siyer@aapnainfotech.com',
    account_created_at: new Date('2026-10-02T05:00:00Z'),
    suggested_doj: day(2026, 10, 3),
    suggested_rm_name: 'Chhavi Verma',
    suggested_rm_email: 'cverma@aapnainfotech.com',
    suggested_pl_email: null,
    first_seen_at: new Date('2026-10-04T20:45:00Z'), // 05-10 in India
    raw_graph: { jobTitle: 'Software Engineer' },
  };

  test('days waiting count from when PEA first saw them, in India time', () => {
    assert.equal(joinerReviewRow(candidate, WORDS, today, new Set(), 'Asia/Kolkata').waitingDays, 2);
  });

  test('says what is still needed: always the track and the date, and only what is missing', () => {
    const r = joinerReviewRow(candidate, WORDS, today, new Set(), 'Asia/Kolkata');
    assert.deepEqual(r.todo, ['Choose fresher or experienced', 'Confirm the joining date', 'Add the project leader']);
  });

  test('with a suggested track it asks to confirm it, not choose it', () => {
    const r = joinerReviewRow({ ...candidate, raw_graph: { jobTitle: 'Trainee Engineer' } }, WORDS, today);
    assert.equal(r.todo[0], 'Confirm fresher or experienced');
    assert.equal(r.isExperienced, false);
  });

  test('dates read dd-MM-yyyy, and a joiner this scan added is marked new', () => {
    const r = joinerReviewRow(candidate, WORDS, today, new Set(['9']), 'Asia/Kolkata');
    assert.equal(r.suggestedDoj, '03-10-2026');
    assert.equal(r.accountCreated, '02-10-2026');
    assert.equal(r.isNew, true);
  });
});

describe('the daily reminder goes once a day at most', () => {
  const today = day(2026, 10, 7);

  test('due when nobody has been emailed yet', () => {
    assert.equal(dailyReminderDue(null, today, 'Asia/Kolkata'), true);
  });

  test('not due when an email already went out today — an arrival email counts', () => {
    // 02:00 on 07-10 in India
    assert.equal(dailyReminderDue(new Date('2026-10-06T20:30:00Z'), today, 'Asia/Kolkata'), false);
  });

  test('due when the last one was yesterday', () => {
    assert.equal(dailyReminderDue(new Date('2026-10-06T05:30:00Z'), today, 'Asia/Kolkata'), true);
  });
});

describe('who is emailed: the admins and HR users who can act on it', () => {
  const users = [
    { id: 1, email: 'harish@aapnainfotech.com', role: 'superadmin', is_active: true },
    { id: 2, email: 'meera@aapnainfotech.com', role: 'admin', is_active: true },
    { id: 3, email: 'kavya@aapnainfotech.com', role: 'hr', is_active: true },
    { id: 4, email: 'ravi@aapnainfotech.com', role: 'hr', is_active: true },
    { id: 5, email: 'old@aapnainfotech.com', role: 'admin', is_active: false },
    { id: 6, email: 'HARISH@aapnainfotech.com', role: 'hr', is_active: true },
  ];
  const modules = new Map([
    [3, ['dashboard', 'new_joiners']],
    [4, ['dashboard', 'evaluations']],
    [6, ['new_joiners']],
  ]);

  test('admins always, HR only with New joiners, nobody inactive, nobody twice', () => {
    assert.deepEqual(reviewRecipients(users, modules), [
      'harish@aapnainfotech.com',
      'meera@aapnainfotech.com',
      'kavya@aapnainfotech.com',
    ]);
  });
});

describe('the "new joiners waiting for review" email', () => {
  const joiners = [
    {
      name: '<img src=x onerror=alert(1)>', email: 'x@aapnainfotech.com', isNew: true, waitingDays: 0,
      accountCreated: '05-10-2026', suggestedDoj: '06-10-2026', manager: 'Chhavi Verma', projectLeader: null,
      isExperienced: true, jobTitle: 'Associate Engineer', todo: ['Confirm fresher or experienced', 'Add the project leader'],
    },
  ];
  const out = compile(TEMPLATE_DEFS.joiners_waiting, buildVars(null, {
    joiners, newCount: 1, headline: 'Microsoft 365 found 1 new joiner.', today: '07-10-2026',
  }));

  test('the subject says how many are waiting', () => {
    assert.equal(out.subject, '1 new joiner(s) waiting for review — 07-10-2026');
  });

  test('a name is escaped, never run as HTML', () => {
    assert.doesNotMatch(out.body, /<img src=x/);
  });

  test('it shows the suggestion as a question, with the designation it came from', () => {
    assert.match(out.body, /Experienced\?/);
    assert.match(out.body, /from “Associate Engineer”/);
    assert.match(out.body, /06-10-2026\?/);
  });

  test('it links to the New joiners screen', () => {
    assert.match(out.body, /href="[^"]*\/new-joiners"/);
  });

  test('an edit that drops the link is refused', () => {
    assert.throws(() => validateDraft('joiners_waiting', { subject: 'Joiners', body: '<p>{{joiner_table}}</p>' }));
  });
});

describe('the designation word settings', () => {
  const def = REGISTRY.find((s) => s.key === 'joiner_title_words_experienced');

  test('start at the agreed words, associate among the experienced', () => {
    assert.ok(parseList(def.default).includes('associate'));
    assert.ok(!parseList(REGISTRY.find((s) => s.key === 'joiner_title_words_fresher').default).includes('associate'));
  });

  test('are stored lower-case, once each, separated by commas', () => {
    assert.equal(normaliseValue(def, 'Senior, LEAD; senior'), 'senior,lead');
  });

  test('blank is allowed — it switches the suggestion off', () => {
    assert.equal(normaliseValue(def, ''), '');
  });

  test('a phrase is refused: one word each', () => {
    assert.throws(() => normaliseValue(def, 'senior engineer'));
  });
});
