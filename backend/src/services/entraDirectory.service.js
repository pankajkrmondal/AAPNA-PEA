/**
 * entraDirectory.service.js — read-only Microsoft Graph directory access.
 *
 * ⏳ STATUS (12 Sep 2026): wired up and used by joinerIntake.service.js, but the
 *    tables it fills come from prisma/ddl/2026-09-12b-pea-joiner-intake.sql,
 *    which has NOT been applied yet. The scan will fail until it is.
 *
 * EVERY request in this file is a GET. PEA never creates, changes or deletes
 * anything in Entra, and it must stay that way: the directory is IT's system of
 * record, and a write from an HR tool would be both wrong and untraceable.
 *
 * ── What Entra can and cannot tell us ──────────────────────────────────────
 *
 * Measured across all 260 enabled @aapnainfotech.com accounts (plan §13.2):
 *
 *   displayName       100%   → full name              ✅
 *   mail              100%   → office email           ✅ the only source there is
 *   createdDateTime   100%   → DOJ *proxy* only       ⚠️ 70% within ±3 days,
 *                                                        worst case −799 days
 *   manager            47%   → RM (73% under 6 months, 88% correct when set)
 *   employeeHireDate    0%   → nothing
 *   employeeType        0%   → nothing
 *
 * So this service returns facts with their provenance attached and refuses to
 * dress a proxy up as a value. The two fields Microsoft genuinely does not hold
 * — date of joining and fresher/experienced — are asked of HR every time.
 *
 * Auth reuses getAccessToken() from graphMailer.service.js: the same app
 * registration, which already holds User.Read.All (plan §13.1 — R1 is closed,
 * the permission was granted all along).
 */
import { getAccessToken } from './graphMailer.service.js';
import logger from '../config/logger.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const REQUEST_TIMEOUT_MS = 30_000;

/** The only fields PEA reads. Kept narrow deliberately — see the file header. */
const USER_FIELDS = [
  'id',
  'displayName',
  'mail',
  'userPrincipalName',
  'accountEnabled',
  'createdDateTime',
  'assignedLicenses',
  // H1 (07-10-2026) — the designation, for SUGGESTING fresher or experienced in
  // the New Joiner Inbox. Microsoft 365 holds neither the years of experience
  // nor the date of joining, and will not; HR confirms both. A plain read,
  // covered by User.Read.All like every other field here.
  'jobTitle',
].join(',');

/** Each account's manager, read with the account rather than after it — U8. */
const MANAGER_EXPAND = 'manager($select=id,displayName,mail,userPrincipalName)';

/**
 * One authenticated GET against Graph.
 * @param {string} url - absolute, or a path beginning with '/'
 * @returns {Promise<object>}
 * @throws {Error} with the Graph status and message
 */
async function graphGet(url) {
  const token = await getAccessToken();
  const res = await fetch(url.startsWith('http') ? url : `${GRAPH}${url}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      // Harmless on simple queries, required by the advanced ones ($filter on
      // createdDateTime among them). Sending it always avoids a class of
      // "works in one tenant, 400s in another" failures.
      ConsistencyLevel: 'eventual',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Graph GET failed (${res.status}): ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  return res.json();
}

/**
 * Follow @odata.nextLink until the collection is exhausted, and say whether it
 * was.
 *
 * `complete` is false when the page guard stopped the read with more still to
 * come. H1 — a caller that decides who is contract staff from a list must know
 * whether it has the whole list: half a Contractor list would let the other
 * half through as joiners.
 *
 * @param {string} firstUrl
 * @param {number} [maxPages=20] - a guard against an unbounded loop
 * @returns {Promise<{items: object[], complete: boolean}>}
 */
async function graphCollect(firstUrl, maxPages = 20) {
  const items = [];
  let url = firstUrl;
  let pages = 0;

  while (url && pages < maxPages) {
    const page = await graphGet(url);
    items.push(...(page.value || []));
    url = page['@odata.nextLink'];
    pages += 1;
  }

  if (url) {
    logger.warn(`Entra listing stopped at ${maxPages} pages with more results available.`);
  }

  return { items, complete: !url };
}

// ─────────────────────────────────────────────────────────────────────────────
// H1 (AD sync, 01-10-2026) — replaced by graphCollect() above, kept for
// reference. It returned the rows only, so a read cut short looked complete.
// ─────────────────────────────────────────────────────────────────────────────
// /**
//  * Follow @odata.nextLink until the collection is exhausted.
//  * @param {string} firstUrl
//  * @param {number} [maxPages=20] - a guard against an unbounded loop
//  * @returns {Promise<object[]>}
//  */
// async function graphGetAll(firstUrl, maxPages = 20) {
//   const out = [];
//   let url = firstUrl;
//   let pages = 0;
//
//   while (url && pages < maxPages) {
//     const page = await graphGet(url);
//     out.push(...(page.value || []));
//     url = page['@odata.nextLink'];
//     pages += 1;
//   }
//
//   if (url) {
//     logger.warn(
//       `Entra listing stopped at ${maxPages} pages with more results available — ` +
//         'narrow the scan window rather than raising the page limit.'
//     );
//   }
//
//   return out;
// }

/** The email PEA identifies an account by. `mail` first; some accounts only have a UPN. */
export const accountEmail = (u) =>
  String(u?.mail || u?.userPrincipalName || '').trim().toLowerCase() || null;

/** Lower-cased, trimmed, without a leading "@". */
const normDomain = (d) => String(d || '').trim().toLowerCase().replace(/^@/, '');

/**
 * Is this address on one of the given domains?
 * @param {string|null} email
 * @param {string[]} domains - an empty list means "any domain"
 * @returns {boolean}
 */
export function onDomains(email, domains = []) {
  const allowed = domains.map(normDomain).filter(Boolean);
  if (!allowed.length) return true;
  const domain = String(email || '').trim().toLowerCase().split('@').pop();
  return !!email && allowed.includes(domain);
}

/**
 * The manager that came with an account read by listDirectory(), or null.
 *
 * No manager is the normal case for roughly a quarter of new accounts, not an
 * error — plan §13.3. It is returned as null so the caller can leave the RM
 * blank for HR rather than inventing one.
 *
 * @param {object} account - a Graph user read with $expand=manager
 * @returns {{id: string, displayName: string|null, mail: string|null}|null}
 */
export function managerOf(account) {
  const m = account?.manager;
  if (!m?.id) return null;
  return {
    id: m.id,
    displayName: m.displayName || null,
    mail: String(m.mail || m.userPrincipalName || '').trim().toLowerCase() || null,
  };
}

/**
 * Every account on the given domains, enabled or not, each with its manager.
 *
 * H1 / U8 — one read, the way the MRA Reconcile flow does it
 * (`$expand=manager`), in place of a listing followed by one manager request
 * per new account. Two things differ from the flow, both on purpose:
 *
 *   · no `accountEnabled eq true` filter. The flow only looks for people to
 *     rate; PEA's leaver pass exists to find the DISABLED accounts, so a
 *     server-side filter would hide exactly the rows it needs.
 *   · several domains. The flow allows aapnainfotech.com, mera.work and
 *     karyakeeper.com; which of them PEA follows is a setting.
 *
 * @param {string[]} domains - e.g. ['aapnainfotech.com']; empty means no filtering
 * @returns {Promise<{accounts: object[], complete: boolean}>}
 */
export async function listDirectory(domains = []) {
  const { items, complete } = await graphCollect(
    `${GRAPH}/users?$select=${USER_FIELDS}&$expand=${MANAGER_EXPAND}&$top=999`
  );

  // Guests and resource accounts live on other domains and are not joiners.
  return { accounts: items.filter((u) => onDomains(accountEmail(u), domains)), complete };
}

/**
 * The ids of the groups and distribution lists one account belongs to — H1.
 *
 * This is how PEA finds out who is on the Contractor list and the Leaders
 * list. The MRA Reconcile flow asks the other way round — "who are the members
 * of this list?" (`/groups/{id}/members`) — and that call needs a group
 * permission. The flow signs in as its own app registration, which has one.
 * PEA signs in as a different registration (HR_RPA), which has User.Read.All
 * and no group permission: measured on 01-10-2026, the flow's two list calls
 * come back 403 when PEA makes them.
 *
 * Asking each ACCOUNT which lists it is on needs only User.Read.All — the
 * permission PEA already holds and already uses to read accounts. Graph
 * answers with each group's id and nothing else about it, and the id is all
 * that is wanted. So PEA reaches the flow's answer with no new permission.
 *
 * Direct memberships only, as the flow's own call is.
 *
 * @param {string} userId - the account's Entra objectId
 * @returns {Promise<{groupIds: string[], complete: boolean}>}
 * @throws {Error} with `status`
 */
export async function listMemberOf(userId) {
  const { items, complete } = await graphCollect(
    `${GRAPH}/users/${encodeURIComponent(userId)}/memberOf?$select=id&$top=999`
  );
  return { groupIds: items.map((g) => g.id).filter(Boolean), complete };
}

// ─────────────────────────────────────────────────────────────────────────────
// H1 (AD sync, 01-10-2026) — the flow's own call, not used, kept for
// reference. It is the direct way to read a list, but PEA's app registration
// has no permission for it (GroupMember.Read.All) and none is to be requested.
// listMemberOf() above reaches the same answer with User.Read.All.
// ─────────────────────────────────────────────────────────────────────────────
// export async function listGroupMembers(groupId) {
//   const { items, complete } = await graphCollect(
//     `${GRAPH}/groups/${encodeURIComponent(groupId)}/members` +
//       '?$select=id,mail,userPrincipalName,displayName&$top=999'
//   );
//
//   return {
//     members: items.map((m) => ({
//       id: m.id,
//       mail: String(m.mail || m.userPrincipalName || '').trim().toLowerCase() || null,
//       displayName: m.displayName || null,
//     })),
//     complete,
//   };
// }

// ─────────────────────────────────────────────────────────────────────────────
// H1 (AD sync, 01-10-2026) — replaced by listDirectory() above, kept for
// reference. It read one domain and no managers.
// ─────────────────────────────────────────────────────────────────────────────
// /**
//  * Every account on the given domain, enabled or not.
//  *
//  * Deliberately one unfiltered listing rather than a query per question. The
//  * tenant has ~260 accounts — two pages — and the intake scan needs both halves
//  * of it: enabled recent accounts are candidate joiners, and DISABLED accounts
//  * are what leaver detection looks for. A server-side `accountEnabled eq true`
//  * filter would hide exactly the rows the leaver pass exists to find, so the
//  * filtering happens here where both passes can see everything.
//  *
//  * @param {string} domain - e.g. 'aapnainfotech.com'; empty means no filtering
//  * @returns {Promise<object[]>}
//  */
// export async function listAccounts(domain) {
//   const suffix = `@${String(domain || '').trim().toLowerCase()}`;
//   const users = await graphGetAll(`${GRAPH}/users?$select=${USER_FIELDS}&$top=999`);
//
//   if (suffix === '@') return users;
//
//   // Guests and resource accounts live on other domains and are not joiners.
//   return users.filter((u) => (accountEmail(u) || '').endsWith(suffix));
// }

// ─────────────────────────────────────────────────────────────────────────────
// U8 (AD sync, 01-10-2026) — replaced by managerOf() above, kept for
// reference. The manager now comes with the account in listDirectory(), so
// there is no request per person.
// ─────────────────────────────────────────────────────────────────────────────
// /**
//  * The manager Entra holds for a user, or null.
//  *
//  * A 404 here is the normal case for roughly a quarter of new accounts, not an
//  * error — plan §13.3. It is returned as null so the caller can leave the RM
//  * blank for HR rather than inventing one.
//  *
//  * @param {string} userId - Entra objectId
//  * @returns {Promise<{id: string, displayName: string, mail: string}|null>}
//  */
// export async function getManager(userId) {
//   try {
//     const m = await graphGet(
//       `/users/${encodeURIComponent(userId)}/manager?$select=id,displayName,mail,userPrincipalName`
//     );
//     return {
//       id: m.id,
//       displayName: m.displayName || null,
//       mail: (m.mail || m.userPrincipalName || '').toLowerCase() || null,
//     };
//   } catch (err) {
//     if (err.status === 404) return null;
//     // Any other failure is worth knowing about but must not sink the whole
//     // scan: one unreadable manager should cost one blank RM, not the run.
//     logger.warn(`Could not read the manager for Entra user ${userId}: ${err.message}`);
//     return null;
//   }
// }

/**
 * Look up one account by its email address.
 * @param {string} email
 * @returns {Promise<object|null>}
 */
export async function getAccountByEmail(email) {
  const needle = String(email || '').trim().toLowerCase();
  if (!needle) return null;

  try {
    // Graph matches userPrincipalName on the /users/{upn} route, but PEA stores
    // the mail address, and the two differ for some accounts — so filter on
    // both rather than guessing which one this employee has.
    const page = await graphGet(
      `${GRAPH}/users?$select=${USER_FIELDS}&$top=2` +
        `&$filter=mail eq '${needle.replace(/'/g, "''")}'` +
        ` or userPrincipalName eq '${needle.replace(/'/g, "''")}'`
    );
    return (page.value || [])[0] || null;
  } catch (err) {
    logger.warn(`Entra lookup failed for ${needle}: ${err.message}`);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// U8 (AD sync, 01-10-2026) — no longer called, kept for reference. It asked
// Graph for each new account's manager in turn; see listDirectory().
// ─────────────────────────────────────────────────────────────────────────────
// /**
//  * Attach managers to a list of users, a few at a time.
//  *
//  * Serial would be slow and unlimited concurrency invites Graph throttling, so
//  * this walks the list in small batches. The counts involved are tens of users,
//  * not thousands.
//  *
//  * @param {object[]} users
//  * @param {number} [concurrency=4]
//  * @returns {Promise<Map<string, object|null>>} objectId → manager
//  */
// export async function fetchManagers(users, concurrency = 4) {
//   const result = new Map();
//
//   for (let i = 0; i < users.length; i += concurrency) {
//     const batch = users.slice(i, i + concurrency);
//     const managers = await Promise.all(batch.map((u) => getManager(u.id)));
//     batch.forEach((u, n) => result.set(u.id, managers[n]));
//   }
//
//   return result;
// }

/**
 * Does this account look like someone who has left?
 *
 * Harish's stated rule was "no assigned licence means they have left". Measured
 * across 91 mailbox users it flags 68 — mostly resource accounts, guests and
 * unlicensed-but-present staff. `accountEnabled = false` alone gives 16, and
 * requiring BOTH gives the same clean 16. Plan §13.9.
 *
 * This returns a suggestion. Nothing in PEA acts on it without HR.
 *
 * @param {object|null} account - as returned by Graph
 * @returns {{accountEnabled: boolean|null, licensed: boolean|null, looksLeft: boolean}}
 */
export function assessLeaver(account) {
  if (!account) return { accountEnabled: null, licensed: null, looksLeft: false };

  const accountEnabled = account.accountEnabled ?? null;
  const licensed = Array.isArray(account.assignedLicenses)
    ? account.assignedLicenses.length > 0
    : null;

  return {
    accountEnabled,
    licensed,
    looksLeft: accountEnabled === false && licensed === false,
  };
}

/**
 * Confirm directory access without reading anyone's record.
 * Surfaced by the admin diagnostics endpoint so a missing grant is discovered
 * deliberately rather than by an empty inbox nobody questions.
 *
 * H1 — when the Contractor or Leaders list is set, it also confirms PEA can
 * read which lists an account is on, the way the scan does (listMemberOf).
 * Both reads use User.Read.All. What this cannot confirm is that a list id is
 * right: PEA may not look a group up by id, so a wrong id shows up as a list
 * nobody is on, and the scan stops and says so.
 *
 * @param {Array<{label: string, id: string}>} [groups] - the lists PEA is set to read
 * @returns {Promise<{ok: boolean, detail: string}>}
 */
export async function verifyDirectoryAccess(groups = []) {
  try {
    const page = await graphGet(`${GRAPH}/users?$select=id&$top=1`);
    const reachable = Array.isArray(page.value);
    /* H1 — the answer before the group check, kept for reference:
    return {
      ok: reachable,
      detail: reachable
        ? 'Directory readable (User.Read.All is granted).'
        : 'Graph responded but returned no user collection.',
    };
    */
    if (!reachable) return { ok: false, detail: 'Graph responded but returned no user collection.' };

    /* H1 — the check that asked each list for its members, kept for reference.
       PEA's app registration has no permission for that call.

    for (const group of groups.filter((g) => g?.id)) {
      try {
        await graphGet(`${GRAPH}/groups/${encodeURIComponent(group.id)}/members?$select=id&$top=1`);
      } catch (err) {
        return {
          ok: false,
          detail:
            err.status === 403
              ? `Accounts are readable, but not the ${group.label} — the app registration is missing GroupMember.Read.All.`
              : err.status === 404
                ? `Accounts are readable, but the ${group.label} was not found — check its id in Settings → New joiners.`
                : `Accounts are readable, but the ${group.label} could not be read: ${err.message}`,
        };
      }
    }
    */

    const lists = groups.filter((g) => g?.id);
    if (lists.length && page.value[0]?.id) {
      try {
        await graphGet(`${GRAPH}/users/${encodeURIComponent(page.value[0].id)}/memberOf?$select=id&$top=1`);
      } catch (err) {
        return {
          ok: false,
          detail: `Accounts are readable, but not which lists they are on (${lists.map((g) => g.label).join(' and ')}): ${err.message}`,
        };
      }
    }

    return {
      ok: true,
      detail: lists.length
        ? 'Directory readable, including which lists an account is on (User.Read.All).'
        : 'Directory readable (User.Read.All is granted).',
    };
  } catch (err) {
    return {
      ok: false,
      detail:
        err.status === 403
          ? 'Graph refused the directory read — the app registration is missing User.Read.All.'
          : err.message,
    };
  }
}
