/**
 * Tests for the AD sync rules lifted from the MRA Reconcile flow (H1, and the
 * sync half of U8) — the ones that can be checked without Microsoft Graph or a
 * database:
 *
 *   H1   who counts as a new joiner ("rateable"), rule by rule
 *   H1   which domains count
 *   U8   the project leader: the first person on the Leaders list at or above
 *        the reporting manager
 *   —    the settings that hold the rules
 *
 * Each one exists because getting it wrong is quiet: a contractor in the inbox
 * looks exactly like a joiner, and a project leader one level out is CC'd on
 * somebody's evaluation without anyone noticing.
 *
 * What these cannot cover — Graph actually returning the two lists, the scan
 * stopping when one comes back empty, a contractor leaving the inbox — needs
 * the tenant, and GroupMember.Read.All on PEA's app registration.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { rateable, NOT_RATEABLE, describeSkipped, buildSuggestion } from '../services/joinerIntake.service.js';
import {
  DIRECTORY_DEFAULTS,
  LEADER_CHAIN_DEPTH,
  parseList,
  managerMap,
  findLeader,
  chainOf,
  buildLists,
  suggestPl,
} from '../services/directory.service.js';
import { onDomains, managerOf } from '../services/entraDirectory.service.js';
import { REGISTRY, normaliseValue } from '../services/settings.service.js';

const account = (over = {}) => ({
  id: '00000000-1111-2222-3333-444444444444',
  displayName: 'Test Joiner',
  mail: 'TJoiner@aapnainfotech.com',
  userPrincipalName: 'tjoiner@aapnainfotech.com',
  accountEnabled: true,
  createdDateTime: '2026-09-01T06:30:00Z',
  assignedLicenses: [{ skuId: 'x' }],
  manager: { id: 'm1', displayName: 'Chhavi Verma', mail: 'CVerma@aapnainfotech.com' },
  ...over,
});

const rules = (over = {}) => ({
  domains: ['aapnainfotech.com'],
  systemMailboxes: new Set(['helpdesk@aapnainfotech.com']),
  excluded: new Set(['none@aapnainfotech.com']),
  contractors: new Set(['c-id-1', 'contractor@aapnainfotech.com']),
  withoutManager: 'show',
  ...over,
});

describe('who counts as a new joiner (H1)', () => {
  test('an enabled, licensed account on the domain, with a manager, counts', () => {
    assert.deepEqual(rateable(account(), rules()), { ok: true, reason: null });
  });

  test('a switched-off account does not', () => {
    assert.equal(rateable(account({ accountEnabled: false }), rules()).reason, 'disabled');
  });

  test('an account with no address at all does not', () => {
    assert.equal(rateable(account({ mail: null, userPrincipalName: null }), rules()).reason, 'no_mail');
  });

  test('an account on another domain does not', () => {
    assert.equal(rateable(account({ mail: 'guest@elsewhere.com' }), rules()).reason, 'domain');
  });

  test('an unlicensed account does not — meeting rooms and shared mailboxes are', () => {
    assert.equal(rateable(account({ assignedLicenses: [] }), rules()).reason, 'unlicensed');
  });

  test('a system mailbox does not', () => {
    assert.equal(rateable(account({ mail: 'HelpDesk@aapnainfotech.com' }), rules()).reason, 'system_mailbox');
  });

  test('an address on the excluded list does not', () => {
    assert.equal(rateable(account({ mail: 'none@aapnainfotech.com' }), rules()).reason, 'excluded');
  });

  test('a member of the Contractor list does not — by address', () => {
    assert.equal(rateable(account({ mail: 'Contractor@aapnainfotech.com' }), rules()).reason, 'contractor');
  });

  test('a member of the Contractor list does not — by Entra id, whatever their address', () => {
    assert.equal(rateable(account({ id: 'c-id-1' }), rules()).reason, 'contractor');
  });

  test('with no Contractor list set, the contractor rule is off — as PEA was before', () => {
    assert.equal(rateable(account({ id: 'c-id-1' }), rules({ contractors: null })).ok, true);
  });

  test('with "show" chosen, an account with no manager is still offered — PEA\'s earlier way', () => {
    assert.equal(rateable(account({ manager: null }), rules()).ok, true);
  });

  test('with "leave out" — the choice made on 02-10-2026 — it is not', () => {
    const leaveOut = rules({ withoutManager: 'leave_out' });
    assert.equal(rateable(account({ manager: null }), leaveOut).reason, 'no_manager');
    assert.equal(rateable(account({ manager: { id: 'm1' } }), leaveOut).reason, 'no_manager', 'a manager with no address is no manager');
    assert.equal(rateable(account(), leaveOut).ok, true);
  });

  test('the rules run in the flow\'s order — the first one that fails is the reason', () => {
    const everythingWrong = account({ accountEnabled: false, mail: 'x@elsewhere.com', assignedLicenses: [] });
    assert.equal(rateable(everythingWrong, rules()).reason, 'disabled');
    assert.equal(rateable({ ...everythingWrong, accountEnabled: true }, rules()).reason, 'domain');
  });

  test('an account with only a UPN is judged by it', () => {
    assert.equal(rateable(account({ mail: null }), rules()).ok, true);
  });

  test('every reason has words for the screen', () => {
    for (const reason of ['disabled', 'no_mail', 'domain', 'unlicensed', 'system_mailbox', 'excluded', 'contractor', 'no_manager']) {
      assert.ok(NOT_RATEABLE[reason], reason);
    }
    assert.equal(NOT_RATEABLE.contractor, 'Contract staff');
  });

  test('what a scan left out is said in words', () => {
    assert.equal(describeSkipped({ contractor: 2, unlicensed: 1 }), '2 contract staff, 1 no microsoft 365 licence');
    assert.equal(describeSkipped({}), '');
    assert.equal(describeSkipped(), '');
  });
});

describe('which domains count (H1)', () => {
  test('an address on any listed domain counts', () => {
    const domains = ['aapnainfotech.com', 'mera.work', 'karyakeeper.com'];
    assert.equal(onDomains('a@mera.work', domains), true);
    assert.equal(onDomains('A@KaryaKeeper.com', domains), true);
    assert.equal(onDomains('a@gmail.com', domains), false);
  });

  test('a domain is matched whole — a look-alike does not pass', () => {
    assert.equal(onDomains('a@notaapnainfotech.com', ['aapnainfotech.com']), false);
    assert.equal(onDomains('a@aapnainfotech.com.evil.io', ['aapnainfotech.com']), false);
  });

  test('a leading @ on a stored domain is harmless', () => {
    assert.equal(onDomains('a@aapnainfotech.com', ['@aapnainfotech.com']), true);
  });

  test('no address is never on a domain; no list means no filtering', () => {
    assert.equal(onDomains(null, ['aapnainfotech.com']), false);
    assert.equal(onDomains('a@anything.io', []), true);
  });
});

describe('the manager that comes with an account (U8)', () => {
  test('is read from the account, lower-cased', () => {
    assert.deepEqual(managerOf(account()), { id: 'm1', displayName: 'Chhavi Verma', mail: 'cverma@aapnainfotech.com' });
  });

  test('no manager is null, never an invented one', () => {
    assert.equal(managerOf(account({ manager: null })), null);
    assert.equal(managerOf({}), null);
    assert.equal(managerOf(null), null);
  });

  test('a manager with only a UPN is still usable', () => {
    assert.equal(managerOf({ manager: { id: 'm2', userPrincipalName: 'X@aapnainfotech.com' } }).mail, 'x@aapnainfotech.com');
  });
});

describe('project leader from the Leaders list (U8)', () => {
  // dev → lead → head → director, and the Leaders list holds head and director.
  const chain = new Map([
    ['dev@a.com', 'lead@a.com'],
    ['lead@a.com', 'head@a.com'],
    ['head@a.com', 'director@a.com'],
  ]);
  const leaders = new Set(['head@a.com', 'director@a.com']);

  test('a reporting manager who is on the list is their own team\'s leader', () => {
    assert.equal(findLeader('head@a.com', chain, leaders), 'head@a.com');
  });

  test('otherwise it is the first person up the chain who is on the list', () => {
    assert.equal(findLeader('lead@a.com', chain, leaders), 'head@a.com', 'not the director, who is further up');
    assert.equal(findLeader('dev@a.com', chain, leaders), 'head@a.com');
  });

  test('case and spacing in the manager\'s address do not matter', () => {
    assert.equal(findLeader('  Lead@A.com ', chain, leaders), 'head@a.com');
  });

  test('a chain that never reaches the list finds nobody — the roster map answers instead', () => {
    assert.equal(findLeader('lead@a.com', chain, new Set(['someone-else@a.com'])), null);
    assert.equal(findLeader('stranger@a.com', chain, leaders), null);
    assert.equal(findLeader(null, chain, leaders), null);
  });

  test('it looks at six people at most, as the flow does', () => {
    assert.equal(LEADER_CHAIN_DEPTH, 6);
    const long = new Map([1, 2, 3, 4, 5, 6, 7].map((n) => [`p${n}@a.com`, `p${n + 1}@a.com`]));
    assert.equal(findLeader('p1@a.com', long, new Set(['p6@a.com'])), 'p6@a.com', 'the sixth person is reached');
    assert.equal(findLeader('p1@a.com', long, new Set(['p7@a.com'])), null, 'the seventh is not');
  });

  test('a loop in the directory ends rather than running for ever', () => {
    const loop = new Map([['a@a.com', 'b@a.com'], ['b@a.com', 'a@a.com']]);
    assert.equal(findLeader('a@a.com', loop, new Set(['z@a.com'])), null);
  });

  test('the chain is built from enabled accounts only — it never runs through someone who has left', () => {
    const map = managerMap([
      account({ mail: 'dev@a.com', manager: { id: 'm', mail: 'Lead@a.com' } }),
      account({ mail: 'gone@a.com', accountEnabled: false, manager: { id: 'm', mail: 'lead@a.com' } }),
      account({ mail: 'top@a.com', manager: null }),
    ]);
    assert.deepEqual([...map], [['dev@a.com', 'lead@a.com']]);
  });

  test('the chain is the manager first, then each person above, six at most', () => {
    assert.deepEqual(chainOf('dev@a.com', chain), ['dev@a.com', 'lead@a.com', 'head@a.com', 'director@a.com']);
    assert.deepEqual(chainOf('  Lead@A.com ', chain, 2), ['lead@a.com', 'head@a.com']);
    assert.deepEqual(chainOf(null, chain), []);
    const loop = new Map([['a@a.com', 'b@a.com'], ['b@a.com', 'a@a.com']]);
    assert.equal(chainOf('a@a.com', loop).length, LEADER_CHAIN_DEPTH);
  });

  test('the Leaders list is the only source of a project leader (decided 02-10-2026)', async () => {
    assert.deepEqual(await suggestPl('lead@a.com', { managers: chain, leaders }), {
      pl_email: 'head@a.com',
      ambiguous: false,
      note: null,
      source: 'leaders_list',
    });
  });

  test('when nobody up the chain is on the list, nothing is suggested — the roster is not asked', async () => {
    const none = { pl_email: null, ambiguous: false, note: null, source: null };
    assert.deepEqual(await suggestPl('stranger@a.com', { managers: chain, leaders }), none);
    assert.deepEqual(await suggestPl('lead@a.com', { managers: chain, leaders: new Set(['elsewhere@a.com']) }), none);
  });

  test('with no Leaders list set, or no manager, nothing is suggested', async () => {
    const none = { pl_email: null, ambiguous: false, note: null, source: null };
    assert.deepEqual(await suggestPl('lead@a.com', { managers: chain, leaders: null }), none);
    assert.deepEqual(await suggestPl('lead@a.com'), none);
    assert.deepEqual(await suggestPl(null, { managers: chain, leaders }), none);
  });

  test('a suggestion says the Leaders list supplied it', () => {
    const s = buildSuggestion(account(), managerOf(account()), {
      pl_email: 'head@a.com',
      ambiguous: false,
      note: null,
      source: 'leaders_list',
    });
    assert.equal(s.suggested_pl_email, 'head@a.com');
    assert.equal(s.pl_source, 'leaders_list');
    assert.equal(s.suggested_rm_email, 'cverma@aapnainfotech.com');
  });
});

describe('the two lists, from what each account says it is on (H1 / U8)', () => {
  // PEA has User.Read.All and no group permission, so it cannot ask a list for
  // its members. It asks each account which lists it is on instead.
  const C = 'd598b53f-9221-4c67-a1b4-fdd1ba9162d9';
  const L = 'a7faa0e9-353b-42a5-83ed-859f38abd0cd';
  const people = [
    account({ id: 'u1', mail: 'Contractor@aapnainfotech.com' }),
    account({ id: 'u2', mail: 'Leader@aapnainfotech.com' }),
    account({ id: 'u3', mail: 'both@aapnainfotech.com' }),
    account({ id: 'u4', mail: 'neither@aapnainfotech.com' }),
  ];
  const groupsById = new Map([
    ['u1', new Set([C, 'some-other-list'])],
    ['u2', new Set([L])],
    ['u3', new Set([C, L])],
    ['u4', new Set(['some-other-list'])],
  ]);
  const both = { contractorGroupId: C, leadersGroupId: L };

  test('a contractor is recognised by Entra id and by address', () => {
    const { contractors } = buildLists(people, groupsById, both);
    assert.deepEqual([...contractors].sort(), ['both@aapnainfotech.com', 'contractor@aapnainfotech.com', 'u1', 'u3']);
  });

  test('leaders are addresses, because a chain of managers is walked by address', () => {
    const { leaders } = buildLists(people, groupsById, both);
    assert.deepEqual([...leaders].sort(), ['both@aapnainfotech.com', 'leader@aapnainfotech.com']);
  });

  test('a list that is not set is null — its rule is off, not empty', () => {
    const lists = buildLists(people, groupsById, { contractorGroupId: '', leadersGroupId: L });
    assert.equal(lists.contractors, null);
    assert.equal(lists.leaders.size, 2);
  });

  test('an account whose memberships were not read is on neither list', () => {
    const lists = buildLists([...people, account({ id: 'u5', mail: 'unread@aapnainfotech.com' })], groupsById, both);
    assert.ok(!lists.contractors.has('u5'));
    assert.ok(!lists.leaders.has('unread@aapnainfotech.com'));
  });

  test('the lists feed the joiner rule: the contractor is left out, the others are not', () => {
    const { contractors } = buildLists(people, groupsById, both);
    const verdicts = people.map((p) => rateable(p, rules({ contractors })).reason);
    assert.deepEqual(verdicts, ['contractor', null, 'contractor', null]);
  });
});

describe('the settings that hold the rules', () => {
  const def = (key) => REGISTRY.find((r) => r.key === key);

  test('every directory rule is an editable setting, under New joiners', () => {
    for (const key of Object.keys(DIRECTORY_DEFAULTS)) {
      assert.ok(def(key), `${key} is in the settings registry`);
      assert.equal(def(key).group, 'New joiners', key);
      assert.equal(def(key).default, DIRECTORY_DEFAULTS[key], `${key} shows the value the code falls back to`);
    }
  });

  test('both lists start at the ones the flow uses', () => {
    assert.equal(DIRECTORY_DEFAULTS.azure_contractor_group_id, 'd598b53f-9221-4c67-a1b4-fdd1ba9162d9');
    assert.equal(DIRECTORY_DEFAULTS.azure_leaders_group_id, 'a7faa0e9-353b-42a5-83ed-859f38abd0cd');
  });

  test('all three of the flow\'s domains are followed (decided 02-10-2026)', () => {
    assert.deepEqual(parseList(DIRECTORY_DEFAULTS.azure_email_domains), ['aapnainfotech.com', 'mera.work', 'karyakeeper.com']);
  });

  test('an account with no manager is left out until it has one (decided 02-10-2026)', () => {
    assert.equal(DIRECTORY_DEFAULTS.azure_joiners_without_manager, 'leave_out');
  });

  test('the list of domains has its own key — the one-domain key is not reused', () => {
    // A build from before this change reads azure_email_domain as ONE domain. A
    // list saved into it would match no account, and that build takes "no
    // accounts" to mean everyone has left.
    assert.ok(!('azure_email_domain' in DIRECTORY_DEFAULTS));
    assert.equal(def('azure_email_domain'), undefined, 'the old key is not an editable setting any more');
    assert.equal(def('azure_email_domains').type, 'domain_list');
  });

  test('the four system mailboxes the flow names are filled in', () => {
    assert.deepEqual(parseList(DIRECTORY_DEFAULTS.azure_system_mailboxes), [
      'hosting@aapnainfotech.com',
      'helpdesk@aapnainfotech.com',
      'legaldepartment@aapnainfotech.com',
      'it_notification@aapnainfotech.com',
    ]);
  });

  test('a stored list is read whatever separates it', () => {
    assert.deepEqual(parseList('A@x.com; b@x.com,\n a@x.com  c@x.com'), ['a@x.com', 'b@x.com', 'c@x.com']);
    assert.deepEqual(parseList(''), []);
    assert.deepEqual(parseList(null), []);
  });

  test('several domains are accepted, tidied and de-duplicated', () => {
    assert.equal(
      normaliseValue(def('azure_email_domains'), 'AapnaInfotech.com, @mera.work; karyakeeper.com mera.work'),
      'aapnainfotech.com,mera.work,karyakeeper.com'
    );
  });

  test('the domain list can never be emptied — blank would mean every domain', () => {
    assert.throws(() => normaliseValue(def('azure_email_domains'), '  '), /at least one domain/);
    assert.throws(() => normaliseValue(def('azure_email_domains'), 'aapnainfotech.com, nonsense'), /not a valid domain/);
  });

  test('a list id is a group id or blank, nothing else', () => {
    const id = 'D598B53F-9221-4C67-A1B4-FDD1BA9162D9';
    assert.equal(normaliseValue(def('azure_contractor_group_id'), ` ${id} `), id.toLowerCase());
    assert.equal(normaliseValue(def('azure_leaders_group_id'), ''), '', 'blank switches the rule off');
    assert.throws(() => normaliseValue(def('azure_contractor_group_id'), 'Contractor DL'), /group id/);
  });

  test('what to do without a manager is one of two choices', () => {
    assert.equal(normaliseValue(def('azure_joiners_without_manager'), 'leave_out'), 'leave_out');
    assert.throws(() => normaliseValue(def('azure_joiners_without_manager'), 'guess'), /one of/);
  });
});
