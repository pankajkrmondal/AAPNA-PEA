/**
 * directory.service.js — what PEA reads from the Microsoft 365 directory, and
 * the rules for using it.
 *
 * Three things live here, and they share one read of the directory:
 *
 *   U8   The people picker. HR chooses a reporting manager or a project leader
 *        by name instead of typing a name and an email address separately.
 *
 *   H1   The directory rules, lifted from the MRA Reconcile flow: which
 *        domains count, who is contract staff (the Contractor list), which
 *        addresses are system mailboxes or excluded. joinerIntake.service.js
 *        applies them; this file reads the settings and the two lists.
 *
 *   U8   The project leader from the directory: the first person up the
 *        reporting manager's chain who is on the Leaders list — and nobody
 *        else. Decided 02-10-2026: the Leaders list is the only source. The
 *        map learned from the roster (rmPlMap.service.js) is no longer asked.
 *
 * ── Every rule is a setting ─────────────────────────────────────────────────
 *
 * The two lists are group ids in Settings → New joiners, and they start at
 * the ids the flow uses. Clearing one switches its rule off: contract staff
 * are then not filtered, or no project leader is suggested and HR types one.
 *
 * Decided 02-10-2026, and what each setting therefore starts at: all three of
 * the flow's domains are followed, and a new account with no manager in
 * Microsoft 365 is left out until it has one — both as the flow does.
 *
 * ── The same lists as the flow, with the permission PEA already has ────────
 *
 * The flow reads each list's members (`/groups/{id}/members`). It signs in as
 * its own app registration, which may. PEA signs in as a different one
 * (HR_RPA) that holds User.Read.All and no group permission — the flow's two
 * list calls come back 403 from PEA (measured 01-10-2026) — and no new
 * permission is to be asked for.
 *
 * So PEA asks the question from the other end: for each enabled account,
 * which lists is it on (`/users/{id}/memberOf`)? That needs only
 * User.Read.All, and gives the same two sets of people. It costs one request
 * per account rather than one per list — about 280 for aapnainfotech.com —
 * so the answers are kept for ten minutes, and a form that needs one person's
 * answer asks about that person only.
 *
 * ── A list that cannot be read is never an empty list ──────────────────────
 *
 * Once a list IS set, a read that fails, or a list nobody turns out to be on,
 * stops whatever asked for it. An empty Contractor list must never be taken to
 * mean "there are no contractors" — that would let every one of them into the
 * New Joiner Inbox. The flow's own guard is the same. It also catches a
 * mistyped list id, which PEA has no permission to check directly.
 *
 * Read-only against Microsoft, like everything in entraDirectory.service.js.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';
import * as entra from './entraDirectory.service.js';
// U8 (decided 02-10-2026) — the project leader comes from the Leaders list
// only, so the roster map is no longer asked. It was:
// import { derivePl } from './rmPlMap.service.js';

/** How long one read of the directory is reused by the picker. */
const CACHE_MS = 10 * 60_000;

/** How far up a manager's chain the flow looks for a leader. */
export const LEADER_CHAIN_DEPTH = 6;

/** What to do with a new account that has no manager in Microsoft 365. */
export const WITHOUT_MANAGER = Object.freeze(['show', 'leave_out']);

/** How many accounts are asked about their lists at once. Graph throttles a burst. */
const MEMBERSHIP_CONCURRENCY = 8;

/**
 * The directory settings and what each is when its row is absent.
 *
 * The two lists and the four system mailboxes are the ones the flow names.
 * The lists started blank while it looked as though reading them needed a new
 * permission; it does not — see the file header.
 */
export const DIRECTORY_DEFAULTS = Object.freeze({
  // Decided 02-10-2026: follow all three domains the flow follows. It was
  // `azure_email_domain: 'aapnainfotech.com'`.
  //
  // The list has its own key, `azure_email_domains`, on purpose. The older key
  // holds ONE domain and is stored on staging; a build from before this change
  // reads it as a single domain, so a list saved into it would match no
  // account at all — and that build takes "no accounts" to mean everyone has
  // left. With a separate key the two builds can never misread each other,
  // whichever is running.
  // azure_email_domain: 'aapnainfotech.com',
  azure_email_domains: 'aapnainfotech.com,mera.work,karyakeeper.com',
  // azure_contractor_group_id: '',
  // azure_leaders_group_id: '',
  azure_contractor_group_id: 'd598b53f-9221-4c67-a1b4-fdd1ba9162d9',
  azure_leaders_group_id: 'a7faa0e9-353b-42a5-83ed-859f38abd0cd',
  azure_excluded_emails: '',
  azure_system_mailboxes:
    'hosting@aapnainfotech.com;helpdesk@aapnainfotech.com;' +
    'legaldepartment@aapnainfotech.com;it_notification@aapnainfotech.com',
  // Decided 02-10-2026: leave them out, as the flow does. It was 'show'.
  // azure_joiners_without_manager: 'show',
  azure_joiners_without_manager: 'leave_out',
});

const norm = (v) => String(v || '').trim().toLowerCase() || null;

// ── Fresher or experienced, suggested from the designation — H1 ───────────
//
// Harish, 07-10-2026: Microsoft 365 does not hold the years of experience and
// will not, so HR confirms fresher or experienced for every joiner. What the
// directory does hold is the job title, which is often a strong hint — so the
// inbox SUGGESTS a track from it, and nothing is final until HR or an admin
// confirms the joiner. "Associate" means one to two years' experience at AAPNA,
// so it counts as experienced.

/** The words that suggest each track, and what each setting is when its row is absent. */
export const TITLE_WORD_DEFAULTS = Object.freeze({
  joiner_title_words_fresher: 'intern,trainee,fresher,graduate,apprentice,junior',
  joiner_title_words_experienced:
    'associate,senior,sr,lead,manager,architect,principal,head,specialist,consultant',
});

/**
 * The track a job title suggests. Pure.
 *
 * Whole words only, ignoring case: "Head of QA" matches "head", "Headcount
 * Analyst" does not. A title that matches both lists counts as experienced —
 * "Senior Trainer" is not a fresher. One that matches neither, or no title at
 * all, suggests nothing, and HR chooses as before.
 *
 * @param {string|null|undefined} title
 * @param {{fresherWords?: string[], experiencedWords?: string[]}} words
 * @returns {{isExperienced: boolean|null, matched: string|null}}
 */
export function trackFromTitle(title, { fresherWords = [], experiencedWords = [] } = {}) {
  const tokens = new Set(String(title || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
  if (!tokens.size) return { isExperienced: null, matched: null };

  const hit = (words) => words.map((w) => String(w).trim().toLowerCase()).find((w) => w && tokens.has(w)) || null;
  const experienced = hit(experiencedWords);
  if (experienced) return { isExperienced: true, matched: experienced };
  const fresher = hit(fresherWords);
  if (fresher) return { isExperienced: false, matched: fresher };
  return { isExperienced: null, matched: null };
}

/**
 * The two word lists as the settings hold them. A stored row wins even when it
 * is blank — blank is how an admin switches that suggestion off.
 * @returns {Promise<{fresherWords: string[], experiencedWords: string[]}>}
 */
export async function titleWordRules() {
  const keys = Object.keys(TITLE_WORD_DEFAULTS);
  const rows = await prisma.pea_settings.findMany({ where: { setting_key: { in: keys } } });
  const stored = new Map(rows.map((r) => [r.setting_key, r.setting_value]));
  const value = (key) => (stored.has(key) && stored.get(key) !== null ? stored.get(key) : TITLE_WORD_DEFAULTS[key]);
  return {
    fresherWords: parseList(value('joiner_title_words_fresher')),
    experiencedWords: parseList(value('joiner_title_words_experienced')),
  };
}

/**
 * A stored list — domains or addresses, separated by commas, semicolons or
 * spaces — as lower-cased, de-duplicated values. Pure.
 * @param {string|null|undefined} value
 * @returns {string[]}
 */
export function parseList(value) {
  return [...new Set(String(value || '').split(/[;,\s]+/).map((v) => v.trim().toLowerCase()).filter(Boolean))];
}

/**
 * The directory rules as the settings hold them.
 *
 * @returns {Promise<{domains: string[], contractorGroupId: string, leadersGroupId: string,
 *   excluded: Set<string>, systemMailboxes: Set<string>, withoutManager: 'show'|'leave_out'}>}
 */
export async function directoryRules() {
  const keys = Object.keys(DIRECTORY_DEFAULTS);
  const rows = await prisma.pea_settings.findMany({ where: { setting_key: { in: keys } } });
  const stored = new Map(rows.map((r) => [r.setting_key, r.setting_value]));

  // A stored row wins even when it is blank — blank is how an admin clears a
  // list. Only a row that is not there at all falls back to the default.
  const value = (key) => (stored.has(key) && stored.get(key) !== null ? stored.get(key) : DIRECTORY_DEFAULTS[key]);

  // It was value('azure_email_domain') — one domain; see DIRECTORY_DEFAULTS.
  const domains = parseList(value('azure_email_domains')).map((d) => d.replace(/^@/, ''));
  const withoutManager = String(value('azure_joiners_without_manager')).trim().toLowerCase();

  return {
    // A blank domain setting would mean "every domain", guests included; that
    // is never what a cleared box was meant to say.
    domains: domains.length ? domains : parseList(DIRECTORY_DEFAULTS.azure_email_domains),
    contractorGroupId: String(value('azure_contractor_group_id')).trim(),
    leadersGroupId: String(value('azure_leaders_group_id')).trim(),
    excluded: new Set(parseList(value('azure_excluded_emails'))),
    systemMailboxes: new Set(parseList(value('azure_system_mailboxes'))),
    // A stored value that is neither choice falls back to the default. It was 'show'.
    withoutManager: WITHOUT_MANAGER.includes(withoutManager)
      ? withoutManager
      : DIRECTORY_DEFAULTS.azure_joiners_without_manager,
  };
}

// ── One read, shared ────────────────────────────────────────────────────────

/** @type {Map<string, {at: number, value: object}>} */
const cache = new Map();

/**
 * Reuse a read for CACHE_MS. The key carries the settings the read depends on,
 * so changing a domain or a list id in Settings is seen at once.
 */
async function cached(key, fresh, load) {
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await load();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/**
 * Every account on the allowed domains, each with its manager.
 *
 * @param {{domains: string[]}} rules
 * @param {{fresh?: boolean}} [opts] - the scan always reads afresh; the picker reuses
 * @returns {Promise<{accounts: object[], complete: boolean}>}
 */
export async function readAccounts(rules, { fresh = false } = {}) {
  return cached(`accounts:${rules.domains.join(',')}`, fresh, () => entra.listDirectory(rules.domains));
}

/** userId → { at, groups } — which lists each account is on, kept for CACHE_MS. */
const memberships = new Map();

const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * The ids of the lists one account is on.
 *
 * Kept per account, so the scan's read of everyone also answers the form that
 * later asks about one person. Graph asked to slow down (429) or briefly
 * unavailable (503) is tried once more; anything else is the caller's to
 * handle, and is never turned into "on no lists".
 *
 * @param {string} userId - Entra objectId
 * @param {{fresh?: boolean}} [opts]
 * @returns {Promise<Set<string>>}
 * @throws {Error} with `status`
 */
async function groupsOf(userId, { fresh = false } = {}) {
  const hit = memberships.get(userId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.groups;

  let read;
  try {
    read = await entra.listMemberOf(userId);
  } catch (err) {
    if (err.status !== 429 && err.status !== 503) throw err;
    await pause(2000);
    read = await entra.listMemberOf(userId);
  }
  if (!read.complete) throw new Error('the list of memberships was cut short');

  const groups = new Set(read.groupIds);
  memberships.set(userId, { at: Date.now(), groups });
  return groups;
}

/**
 * The two lists, from what each account says it is on. Pure, so the rule is
 * testable without Graph.
 *
 *   contractors  Entra ids AND addresses, so a member is recognised by either
 *   leaders      addresses — a chain of managers is walked by address
 *
 * `null` for a list that is not set: the rule it drives is simply off.
 *
 * @param {object[]} people - Graph users
 * @param {Map<string, Set<string>>} groupsById - Entra id → the list ids that account is on
 * @param {{contractorGroupId?: string, leadersGroupId?: string}} rules
 * @returns {{contractors: Set<string>|null, leaders: Set<string>|null}}
 */
export function buildLists(people, groupsById, rules) {
  const contractors = rules.contractorGroupId ? new Set() : null;
  const leaders = rules.leadersGroupId ? new Set() : null;

  for (const person of people) {
    const groups = groupsById.get(person.id);
    if (!groups) continue;
    const email = entra.accountEmail(person);

    if (contractors && groups.has(rules.contractorGroupId)) {
      contractors.add(person.id);
      if (email) contractors.add(email);
    }
    if (leaders && email && groups.has(rules.leadersGroupId)) leaders.add(email);
  }

  return { contractors, leaders };
}

/**
 * The Contractor and Leaders lists, for whichever of them is set, worked out
 * from every enabled account's memberships.
 *
 * `null` means "not set". A list that IS set and cannot be established throws;
 * it is never returned as empty:
 *
 *   · any account's memberships could not be read — the lists would be
 *     incomplete, and an incomplete Contractor list lets contractors through
 *   · nobody is on the list — either Graph answered wrongly or the id in
 *     Settings is mistyped, and both look the same from here
 *
 * @param {{contractorGroupId: string, leadersGroupId: string, domains: string[]}} rules
 * @param {object[]} accounts - as read by readAccounts()
 * @param {{fresh?: boolean}} [opts] - the scan always reads afresh
 * @returns {Promise<{contractors: Set<string>|null, leaders: Set<string>|null}>}
 * @throws {AppError} 502
 */
export async function readLists(rules, accounts, { fresh = false } = {}) {
  if (!rules.contractorGroupId && !rules.leadersGroupId) return { contractors: null, leaders: null };

  const key = `lists:${rules.contractorGroupId}|${rules.leadersGroupId}|${rules.domains.join(',')}`;

  return cached(key, fresh, async () => {
    // Enabled accounts only: a switched-off account is never a joiner and is
    // never walked through on the way to a leader.
    const people = accounts.filter((a) => a.accountEnabled && a.id);
    const groupsById = new Map();
    let failed = 0;
    let firstError = null;

    for (let i = 0; i < people.length; i += MEMBERSHIP_CONCURRENCY) {
      await Promise.all(
        people.slice(i, i + MEMBERSHIP_CONCURRENCY).map(async (person) => {
          try {
            groupsById.set(person.id, await groupsOf(person.id, { fresh }));
          } catch (err) {
            failed += 1;
            firstError = firstError || err;
          }
        })
      );
    }

    if (failed) {
      throw new AppError(
        firstError.status === 403
          ? 'PEA could not read which lists an account is on — Microsoft 365 refused it (User.Read.All).'
          : `PEA could not read which lists ${failed} of ${people.length} accounts are on (${firstError.message}).`,
        502
      );
    }

    const lists = buildLists(people, groupsById, rules);
    const nobody = (label) =>
      new AppError(
        `Nobody on ${rules.domains.join(', ')} is on the ${label} — check its id in Settings → New joiners.`,
        502
      );
    if (lists.contractors && !lists.contractors.size) throw nobody('Contractor list');
    if (lists.leaders && !lists.leaders.size) throw nobody('Leaders list');

    return lists;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// H1 (AD sync, 01-10-2026) — the first way the lists were read, kept for
// reference: ask each list for its members, as the flow does. PEA's app
// registration has no permission for that call; see the file header.
// ─────────────────────────────────────────────────────────────────────────────
// /**
//  * One list's members as a set holding both their Entra ids and their
//  * addresses, so a member is recognised by either.
//  *
//  * @param {string} groupId
//  * @param {string} label - "Contractor list" / "Leaders list", for the message
//  * @returns {Promise<Set<string>>}
//  * @throws {AppError} 502 — unreadable, cut short or empty
//  */
// async function readList(groupId, label) {
//   let read;
//   try {
//     read = await entra.listGroupMembers(groupId);
//   } catch (err) {
//     throw new AppError(
//       err.status === 403
//         ? `PEA cannot read the ${label} — its app registration is missing GroupMember.Read.All.`
//         : err.status === 404
//           ? `The ${label} was not found in Microsoft 365 — check its id in Settings → New joiners.`
//           : `The ${label} could not be read: ${err.message}`,
//       502
//     );
//   }
//
//   if (!read.complete) throw new AppError(`The ${label} was cut short — Microsoft 365 returned more than PEA reads.`, 502);
//
//   const set = new Set();
//   for (const m of read.members) {
//     if (m.id) set.add(m.id);
//     if (m.mail) set.add(m.mail);
//   }
//   if (!read.members.length) throw new AppError(`The ${label} came back empty.`, 502);
//
//   return set;
// }
//
// /**
//  * The Contractor and Leaders lists, for whichever of them is set.
//  *
//  * `null` means "not set" — the rule that list drives is simply off. A list
//  * that IS set and cannot be read throws; it is never returned as empty.
//  *
//  * @param {{contractorGroupId: string, leadersGroupId: string}} rules
//  * @param {{fresh?: boolean}} [opts]
//  * @returns {Promise<{contractors: Set<string>|null, leaders: Set<string>|null}>}
//  * @throws {AppError} 502
//  */
// export async function readLists(rules, { fresh = false } = {}) {
//   return cached(`lists:${rules.contractorGroupId}|${rules.leadersGroupId}`, fresh, async () => ({
//     contractors: rules.contractorGroupId ? await readList(rules.contractorGroupId, 'Contractor list') : null,
//     leaders: rules.leadersGroupId ? await readList(rules.leadersGroupId, 'Leaders list') : null,
//   }));
// }

// ── The project leader from the directory — U8 ─────────────────────────────

/**
 * Who each person reports to, by address. Enabled accounts only: a chain must
 * not run through someone who has left.
 * @param {object[]} accounts - as read by readAccounts()
 * @returns {Map<string, string>} address → manager's address
 */
export function managerMap(accounts) {
  const map = new Map();
  for (const a of accounts) {
    if (!a.accountEnabled) continue;
    const email = entra.accountEmail(a);
    const manager = entra.managerOf(a)?.mail;
    if (email && manager) map.set(email, manager);
  }
  return map;
}

/**
 * The first person on the Leaders list at or above a reporting manager.
 *
 * The flow's rule, unchanged: start at the manager — a manager who is on the
 * list is their own team's leader — and walk up, looking at six people at
 * most. Pure, so the rule is testable without Graph. The depth limit is also
 * what stops a loop in the directory (A reports to B reports to A).
 *
 * @param {string} managerEmail
 * @param {Map<string, string>} managers - address → manager's address
 * @param {Set<string>} leaders - addresses on the Leaders list
 * @param {number} [maxDepth=LEADER_CHAIN_DEPTH]
 * @returns {string|null} the leader's address, or null when the chain finds nobody
 */
export function findLeader(managerEmail, managers, leaders, maxDepth = LEADER_CHAIN_DEPTH) {
  return chainOf(managerEmail, managers, maxDepth).find((email) => leaders.has(email)) || null;
}

/**
 * A reporting manager and the people above them, nearest first — the people
 * findLeader() looks at, in the order it looks. Pure.
 *
 * @param {string} managerEmail
 * @param {Map<string, string>} managers - address → manager's address
 * @param {number} [maxDepth=LEADER_CHAIN_DEPTH]
 * @returns {string[]} addresses, the manager's own first; six at most
 */
export function chainOf(managerEmail, managers, maxDepth = LEADER_CHAIN_DEPTH) {
  const chain = [];
  let current = norm(managerEmail);
  for (let depth = 0; current && depth < maxDepth; depth += 1) {
    chain.push(current);
    current = norm(managers.get(current));
  }
  return chain;
}

/**
 * The project leader to suggest for a reporting manager: the first person on
 * the Leaders list at or above them. When the chain reaches nobody, or no
 * Leaders list is set, nothing is suggested — the Leaders list is the only
 * source (decided 02-10-2026).
 *
 * Still async, though nothing here waits any more: its callers await it, and
 * it did wait while the roster map was the fallback.
 *
 * @param {string|null} rmEmail
 * @param {{managers?: Map<string, string>, leaders?: Set<string>|null}} [directory]
 * @returns {Promise<{pl_email: string|null, ambiguous: boolean, note: string|null, source: string|null}>}
 */
export async function suggestPl(rmEmail, { managers = new Map(), leaders = null } = {}) {
  const rm = norm(rmEmail);
  if (!rm) return { pl_email: null, ambiguous: false, note: null, source: null };

  if (leaders) {
    const leader = findLeader(rm, managers, leaders);
    if (leader) return { pl_email: leader, ambiguous: false, note: null, source: 'leaders_list' };
  }

  /* U8 (decided 02-10-2026) — the Leaders list only. When the chain reached
     nobody, the map learned from the roster used to answer:

  const fromMap = await derivePl(rm);
  return { ...fromMap, source: fromMap.pl_email ? 'rm_map' : null };
  */

  // Nobody on the Leaders list at or above this manager, or no Leaders list
  // set. No project leader is suggested; HR chooses one.
  return { pl_email: null, ambiguous: false, note: null, source: null };
}

/**
 * The same, for a screen: HR has just picked a reporting manager and the form
 * wants a project leader to offer. Never throws for a directory problem —
 * nothing is suggested, and HR can always type the address.
 *
 * @param {string} rmEmail
 * @returns {Promise<{pl_email: string|null, ambiguous: boolean, note: string|null, source: string|null}>}
 */
export async function projectLeaderFor(rmEmail) {
  let directory = {};
  try {
    const rules = await directoryRules();
    if (rules.leadersGroupId) {
      const { accounts } = await readAccounts(rules);
      const managers = managerMap(accounts);
      const idOf = new Map(
        accounts.filter((a) => a.accountEnabled).map((a) => [entra.accountEmail(a), a.id])
      );

      // Only the people on this manager's chain are asked about — six at most —
      // so the form has its answer in a moment. Reading every account's lists,
      // as the scan does, would keep HR waiting for a suggestion.
      const leaders = new Set();
      await Promise.all(
        chainOf(rmEmail, managers).map(async (email) => {
          const id = idOf.get(email);
          if (id && (await groupsOf(id)).has(rules.leadersGroupId)) leaders.add(email);
        })
      );

      directory = { managers, leaders };
    }
  } catch (err) {
    logger.warn(`Project leader lookup: the directory could not be read, so nothing is suggested (${err.message})`);
  }
  return suggestPl(rmEmail, directory);
}

// ── The people picker — U8 ─────────────────────────────────────────────────

/**
 * An account as the picker offers it, or null when it is not a person HR would
 * choose: switched off, without a name or an address, a system mailbox, or
 * unlicensed (meeting rooms and shared mailboxes are).
 *
 * @param {object} account - a Graph user
 * @param {Set<string>} [systemMailboxes]
 * @returns {{name: string, email: string}|null}
 */
export function toPerson(account, systemMailboxes = new Set()) {
  if (!account?.accountEnabled) return null;
  const email = entra.accountEmail(account);
  const name = String(account.displayName || '').replace(/\s+/g, ' ').trim();
  if (!email || !name || systemMailboxes.has(email)) return null;
  if (Array.isArray(account.assignedLicenses) && account.assignedLicenses.length === 0) return null;
  return { name, email };
}

/**
 * People whose name or address matches what was typed, best match first:
 * a name that starts with it, then a later word in the name, then the address,
 * then anywhere. Pure.
 *
 * @param {Array<{name: string, email: string}>} people
 * @param {string} q - two characters at least
 * @param {number} [limit=20]
 * @returns {Array<{name: string, email: string}>}
 */
export function searchPeople(people, q, limit = 20) {
  const needle = String(q || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (needle.length < 2) return [];

  const rank = (p) => {
    const name = p.name.toLowerCase();
    if (name.startsWith(needle)) return 0;
    if (name.split(' ').some((word) => word.startsWith(needle))) return 1;
    if (p.email.startsWith(needle)) return 2;
    if (name.includes(needle) || p.email.includes(needle)) return 3;
    return -1;
  };

  return people
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.p.name.localeCompare(b.p.name))
    .slice(0, limit)
    .map((x) => x.p);
}

/** When the directory last failed for the picker, plus a minute. */
let pickerDownUntil = 0;

/**
 * Search the directory for the picker.
 *
 * `available: false` is an answer, not an error: Microsoft 365 is unreachable
 * or not set up here, and the form carries on as two typed boxes. A directory
 * outage must never stop HR adding or editing someone.
 *
 * @param {string} q
 * @returns {Promise<{available: boolean, people: Array<{name: string, email: string}>, reason?: string}>}
 */
export async function findPeople(q) {
  const unavailable = {
    available: false,
    people: [],
    reason: 'Microsoft 365 could not be reached — type the name and email instead.',
  };

  // The picker asks as HR types. While the directory is down, one failed read
  // a minute is enough to notice it coming back; every keystroke waiting on a
  // Graph timeout is not.
  if (Date.now() < pickerDownUntil) return unavailable;

  try {
    const rules = await directoryRules();
    const { accounts } = await readAccounts(rules);
    const people = accounts.map((a) => toPerson(a, rules.systemMailboxes)).filter(Boolean);
    return { available: true, people: searchPeople(people, q) };
  } catch (err) {
    pickerDownUntil = Date.now() + 60_000;
    logger.warn(`People picker: the directory could not be read (${err.message})`);
    return unavailable;
  }
}
