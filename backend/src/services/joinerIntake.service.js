/**
 * joinerIntake.service.js — the New Joiner Inbox. Plan §13.8.
 *
 * PEA notices a new Microsoft account, prefills everything Entra can honestly
 * supply, and puts it in a queue for HR to confirm. Eight columns typed by hand
 * today become two questions.
 *
 * ── What this does NOT do, on purpose ──────────────────────────────────────
 *
 *   · It never creates an employee by itself. A suggestion sits in the inbox
 *     until a person accepts it.
 *   · It never guesses a date of joining. `employeeHireDate` is 0% populated in
 *     the tenant, so the account-creation date is the only candidate — and it
 *     is a proxy, right within ±3 days 70% of the time but wrong by 799 days
 *     for a rejoiner whose old account was reused. A wrong DOJ shifts all six
 *     evaluation dates, so it is offered as a *suggestion* and HR confirms it.
 *     Plan §13.4.
 *   · It never guesses fresher vs experienced. `employeeType` is 0% populated.
 *     There is no source at all, so accept() refuses a payload that omits it
 *     rather than defaulting to "fresher" and quietly putting someone on the
 *     wrong six-evaluation cadence. Plan §13.6.
 *   · It never marks anyone as having left. It raises a flag; HR confirms it.
 *     Plan §13.9.
 *
 * ── The only source is PEA's own data plus Microsoft Entra ──────────────────
 *
 * PEA does not read the ATS database (decision D5). A joiner may have come
 * through ATS, a referral, or directly — PEA does not need to know which, and
 * treats every new Microsoft account the same way.
 *
 * ── Why it improves without being changed ──────────────────────────────────
 *
 * As IT begins populating `employeeHireDate`, `employeeType` and `manager` at
 * account creation (plan §13.7), the same code fills in more and the
 * confirmation step simply finds less to correct. Nothing here needs rewriting
 * for that to happen.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import config from '../config/index.js';
import AppError from '../utils/AppError.js';
import * as entra from './entraDirectory.service.js';
import { derivePl } from './rmPlMap.service.js';
import { createEmployee, updateEmployee } from './employee.service.js';
import { notifyStaff } from './inAppNotification.service.js';
import { hasPhase2Features } from '../utils/schemaCapabilities.js';
import { todayIn, toUtcMidnight, toDateString } from '../utils/dateUtils.js';

const DEFAULTS = {
  azure_scan_window_days: 45,
  azure_email_domain: 'aapnainfotech.com',
  // Off by default. Plan §6.5 designs the overwrite-unless-locked model, but a
  // first scan with it on could rename dozens of employees to whatever Entra
  // holds. With it off, the scan records the differences (visible as "differs
  // from Azure") and changes nothing — HR can see the blast radius first.
  azure_field_sync_enabled: 'false',
};

/** Read a pea_settings value with a fallback. */
async function setting(key) {
  const row = await prisma.pea_settings.findUnique({ where: { setting_key: key } });
  const value = row?.setting_value;
  return value === undefined || value === null || value === '' ? DEFAULTS[key] : value;
}

const norm = (v) => (v || '').trim().toLowerCase() || null;

/**
 * Build the suggestion PEA will show for one Entra account.
 *
 * Pure and exported so the provenance rules are testable without Graph or a
 * database: every value that is not certain arrives with a `*_source` saying
 * where it came from, which is what lets the UI label it "unverified".
 *
 * @param {object} account - a Graph user
 * @param {{displayName: string, mail: string}|null} manager
 * @param {{pl_email: string|null, ambiguous: boolean, note: string|null}} pl
 * @returns {object}
 */
export function buildSuggestion(account, manager, pl) {
  const created = account.createdDateTime ? new Date(account.createdDateTime) : null;
  const rmEmail = norm(manager?.mail);

  return {
    azure_user_id: account.id,
    source: 'azure',
    display_name: account.displayName || null,
    office_email: entra.accountEmail(account),
    account_created_at: created,

    // A proxy, flagged as one. Never the truth. Plan §13.4.
    suggested_doj: created ? toUtcMidnight(created) : null,
    doj_source: created ? 'account_created' : null,

    suggested_rm_name: manager?.displayName || null,
    suggested_rm_email: rmEmail,
    rm_source: rmEmail ? 'entra_manager' : null,

    // Absent when the RM→PL map is ambiguous for this manager — derivePl()
    // returns null rather than the majority, so HR chooses. Plan §13.5.
    suggested_pl_email: pl?.pl_email || null,
    pl_source: pl?.pl_email ? 'rm_map' : null,

    raw_graph: {
      id: account.id,
      displayName: account.displayName ?? null,
      mail: account.mail ?? null,
      userPrincipalName: account.userPrincipalName ?? null,
      accountEnabled: account.accountEnabled ?? null,
      createdDateTime: account.createdDateTime ?? null,
      licenceCount: Array.isArray(account.assignedLicenses) ? account.assignedLicenses.length : null,
      manager: manager ? { displayName: manager.displayName, mail: manager.mail } : null,
      plAmbiguous: pl?.ambiguous || false,
      plNote: pl?.note || null,
    },
  };
}

/**
 * Decide what the Azure sync may change for one employee. Plan §6.5 Part 2.
 *
 * Pure, so the lock rule is testable without Graph or a database:
 *   · a LOCKED field is never overwritten — the disagreement is only reported
 *   · an unlocked field is overwritten only when sync is switched on
 *   · employment_status is never touched here (leavers are suggestions, §13.9)
 *
 * @param {{full_name: string, office_email: string, locked_fields?: string[]}} employee
 * @param {object} account - a Graph user
 * @param {{syncEnabled: boolean}} opts
 * @returns {{updates: object, lockedDifferences: string[], unlockedDifferences: string[]}}
 */
export function planFieldSync(employee, account, { syncEnabled }) {
  const locked = employee.locked_fields || [];
  const updates = {};
  const lockedDifferences = [];
  const unlockedDifferences = [];

  const azureName = String(account?.displayName || '').replace(/\s+/g, ' ').trim();
  const ourName = String(employee.full_name || '').replace(/\s+/g, ' ').trim();
  const azureMail = entra.accountEmail(account);
  const ourMail = norm(employee.office_email);

  const consider = (field, theirs, ours) => {
    if (!theirs || theirs === ours) return;
    if (locked.includes(field)) {
      lockedDifferences.push(field);
    } else {
      unlockedDifferences.push(field);
      if (syncEnabled) updates[field] = theirs;
    }
  };

  consider('full_name', azureName, ourName);
  consider('office_email', azureMail, ourMail);

  return { updates, lockedDifferences, unlockedDifferences };
}

/**
 * Run one intake scan against Entra.
 *
 * Read-only against Microsoft and read-mostly against PEA: it writes to
 * pea_joiner_candidates and stamps Entra signals onto pea_employees, and it
 * sends no email of any kind.
 *
 * @param {{dryRun?: boolean, actor?: string}} [opts]
 * @returns {Promise<object>} the run report, also written to pea_azure_sync_log
 */
export async function runIntakeScan({ dryRun = false, actor = 'system' } = {}) {
  const startedAt = Date.now();
  const domain = String(await setting('azure_email_domain'));
  const windowDays = Number(await setting('azure_scan_window_days')) || DEFAULTS.azure_scan_window_days;

  const today = todayIn(config.scheduler.timezone);
  const since = new Date(today.getTime() - windowDays * 86_400_000);

  const report = {
    dryRun,
    domain,
    windowDays,
    since: toDateString(since),
    accountsFetched: 0,
    candidatesNew: 0,
    candidatesUpdated: 0,
    alreadyEmployees: 0,
    employeesChecked: 0,
    leaversFlagged: 0,
    leaversCleared: 0,
    notFoundInEntra: 0,
    /** Of those, how many were newly flagged because the account has gone. */
    missingFlagged: 0,
    errors: [],
  };

  let accounts;
  try {
    accounts = await entra.listAccounts(domain);
  } catch (err) {
    await recordRun(report, 'failed', err.message, Date.now() - startedAt);
    throw new AppError(`The Microsoft 365 check failed: ${err.message}`, 502);
  }

  report.accountsFetched = accounts.length;

  const byEmail = new Map();
  for (const a of accounts) {
    const email = entra.accountEmail(a);
    if (email) byEmail.set(email, a);
  }

  // ── Pass 1: joiners ──────────────────────────────────────────────────────
  const recent = accounts.filter(
    (a) => a.accountEnabled && a.createdDateTime && new Date(a.createdDateTime) >= since
  );

  // Anyone already on the roster is not a new joiner, however new their account.
  const existing = await prisma.pea_employees.findMany({
    select: { id: true, office_email: true },
  });
  const employeeEmails = new Set(existing.map((e) => norm(e.office_email)));

  const fresh = recent.filter((a) => {
    const email = entra.accountEmail(a);
    if (email && employeeEmails.has(email)) {
      report.alreadyEmployees += 1;
      return false;
    }
    return !!email;
  });

  const managers = fresh.length ? await entra.fetchManagers(fresh) : new Map();

  for (const account of fresh) {
    try {
      const manager = managers.get(account.id) || null;
      const pl = manager?.mail ? await derivePl(manager.mail) : null;
      const suggestion = buildSuggestion(account, manager, pl);

      const [current] = await prisma.$queryRaw`
        SELECT id, status FROM pea_joiner_candidates
         WHERE azure_user_id = ${account.id} LIMIT 1`;

      if (dryRun) {
        if (current) report.candidatesUpdated += 1;
        else report.candidatesNew += 1;
        continue;
      }

      if (!current) {
        await prisma.pea_joiner_candidates.create({ data: suggestion });
        report.candidatesNew += 1;
      } else if (current.status === 'pending') {
        // Refresh the suggestion — a manager may have been filled in since the
        // last scan, which is the whole point of §13.7.
        await prisma.pea_joiner_candidates.update({
          where: { id: current.id },
          data: { ...suggestion, last_seen_at: new Date() },
        });
        report.candidatesUpdated += 1;
      } else {
        // Already accepted or dismissed. Note that it still exists, but never
        // resurrect a decision a person already made.
        await prisma.pea_joiner_candidates.update({
          where: { id: current.id },
          data: { last_seen_at: new Date() },
        });
      }
    } catch (err) {
      // One bad account must not sink the scan — the same per-row isolation the
      // sweep uses.
      report.errors.push(`${entra.accountEmail(account) || account.id}: ${err.message}`);
      logger.warn(`Intake scan: could not process ${account.id}: ${err.message}`);
    }
  }

  // Whether the Azure snapshot columns exist (2026-09-13 DDL / dedicated DB).
  const phase2 = await hasPhase2Features();

  // ── Pass 2: leavers, and what Entra says about everyone else ─────────────
  const syncEnabled = String(await setting('azure_field_sync_enabled')) === 'true';
  report.fieldSyncEnabled = syncEnabled;
  report.fieldsSynced = 0;
  report.lockedDifferences = 0;

  const byId = new Map(accounts.map((a) => [a.id, a]));

  const active = await prisma.pea_employees.findMany({
    where: { employment_status: 'active' },
    select: {
      id: true,
      full_name: true,
      office_email: true,
      leaver_flagged_at: true,
      azure_user_id: true,
      locked_fields: true,
    },
  });

  report.employeesChecked = active.length;

  for (const employee of active) {
    try {
      // The Entra id first: once linked, a changed mail address must still find
      // the same person — matching on email alone would lose them the moment IT
      // renamed the account, which is exactly the change worth noticing.
      const account =
        (employee.azure_user_id && byId.get(employee.azure_user_id)) ||
        byEmail.get(norm(employee.office_email)) ||
        null;

      if (!account) {
        // No Entra account on this domain.
        //
        // This case was previously counted and skipped, on the grounds that it
        // is ambiguous: a deleted account usually means a leaver, but a mail
        // alias mismatch or a contractor looks identical, and §13.9 measured
        // nothing about it. That caution is still right — which is why nothing
        // here marks anyone as having left.
        //
        // What changed is the cost of staying silent. Subhajit's actual words
        // (15-Sep, 5:39) were "if the resource is not showing in the AD, his or
        // her evolution will get paused automatically" — the disappeared
        // account IS the case he described, and it was the one the old
        // leaver rule never covered. So it is flagged like any other leaver
        // signal: evaluations pause, HR is asked, and one click either confirms
        // the exit or says "still here" and releases the hold.
        report.notFoundInEntra += 1;

        // ⚠️ ONLY an account that was LINKED and has since gone counts.
        //
        // "Not showing in the AD" means an account that used to be there. An
        // employee who never had one — a contractor, someone on a different mail
        // domain, an imported spreadsheet row, a test record — has not
        // disappeared; PEA simply never found them in the first place. Those are
        // completely different facts and only the first is evidence of an exit.
        //
        // Flagging both was measured against real data and was wrong for every
        // single row: 19 of 20 active employees were flagged in one scan,
        // including people on other mail domains who had never been linked. A
        // leaver signal that fires on almost everyone is worse than none,
        // because it trains HR to dismiss it — and it silently stopped their
        // evaluations meanwhile.
        if (employee.azure_user_id && !employee.leaver_flagged_at) {
          if (!dryRun) {
            await prisma.pea_employees.update({
              where: { id: employee.id },
              data: {
                leaver_flagged_at: new Date(),
                // Deliberately NOT azure_account_enabled: false. There is no
                // account to have read a state from, and writing one would
                // fabricate a measurement.
                azure_synced_at: new Date(),
              },
            });
          }
          report.leaversFlagged += 1;
          report.missingFlagged += 1;
        }

        continue;
      }

      const verdict = entra.assessLeaver(account);
      const alreadyFlagged = !!employee.leaver_flagged_at;

      const data = {
        azure_user_id: account.id,
        azure_account_enabled: verdict.accountEnabled,
        license_assigned: verdict.licensed,
        azure_synced_at: new Date(),
      };

      if (verdict.looksLeft && !alreadyFlagged) {
        // Keep the ORIGINAL flag time on a repeat scan: HR's dismissal is
        // compared against it, and refreshing it every night would silently
        // undo every dismissal.
        data.leaver_flagged_at = new Date();
        report.leaversFlagged += 1;
      } else if (!verdict.looksLeft && alreadyFlagged) {
        // Re-enabled or re-licensed. The signal is gone, so the suggestion goes.
        data.leaver_flagged_at = null;
        report.leaversCleared += 1;
      }

      const plan = planFieldSync(employee, account, { syncEnabled });
      report.lockedDifferences += plan.lockedDifferences.length;

      if (!dryRun) {
        await prisma.pea_employees.update({ where: { id: employee.id }, data });

        if (phase2) {
          // Refreshed whether or not the field is locked, so the detail screen
          // can always show "differs from Azure". Raw SQL — see schema.prisma.
          await prisma.$executeRaw`
            UPDATE pea_employees
               SET azure_display_name = ${account.displayName || null},
                   azure_mail = ${entra.accountEmail(account)}
             WHERE id = ${employee.id}`;
        }

        if (Object.keys(plan.updates).length) {
          // Through updateEmployee, so every overwrite is audited as
          // 'azure-sync' and an email clash is refused rather than duplicated.
          await updateEmployee(employee.id, plan.updates, 'azure-sync', 'azure');
          report.fieldsSynced += Object.keys(plan.updates).length;
        }
      } else {
        report.fieldsSynced += Object.keys(plan.updates).length;
      }
    } catch (err) {
      report.errors.push(`${employee.office_email}: ${err.message}`);
      logger.warn(`Intake scan: leaver/sync check failed for ${employee.office_email}: ${err.message}`);
    }
  }

  const durationMs = Date.now() - startedAt;
  await recordRun(report, report.errors.length ? 'partial' : 'success', null, durationMs);

  if (!dryRun) {
    if (report.candidatesNew > 0) {
      await notifyStaff({
        type: 'joiners_detected',
        title: `${report.candidatesNew} new joiner(s) waiting to be confirmed`,
        body: 'Found in Microsoft 365. Joining date and fresher/experienced need confirming.',
        link: '/new-joiners',
      });
    }
    if (report.leaversFlagged > 0) {
      await notifyStaff({
        type: 'leavers_flagged',
        title: `${report.leaversFlagged} employee(s) may have left`,
        body: 'Their Microsoft account is disabled and unlicensed. Nothing changes until you confirm.',
        link: '/new-joiners',
        severity: 'warning',
      });
    }
  }

  logger.info(
    `Entra intake scan (${dryRun ? 'dry run' : 'live'}) by ${actor}: ` +
      `${report.accountsFetched} accounts, ${report.candidatesNew} new joiners, ` +
      `${report.candidatesUpdated} refreshed, ${report.leaversFlagged} leaver flags raised, ` +
      `${report.leaversCleared} cleared, ${report.errors.length} errors — ${durationMs}ms`
  );

  return { ...report, durationMs };
}

/** Write the run to pea_azure_sync_log. Never throws — a log failure is not a scan failure. */
async function recordRun(report, status, errorMessage, durationMs) {
  try {
    await prisma.pea_azure_sync_log.create({
      data: {
        mode: report.dryRun ? 'dry_run' : 'scan',
        users_fetched: report.accountsFetched,
        users_created: 0, // employees are only ever created by a person accepting
        users_flagged_left: report.leaversFlagged,
        candidates_new: report.candidatesNew,
        candidates_updated: report.candidatesUpdated,
        employees_checked: report.employeesChecked,
        duration_ms: durationMs,
        status,
        error_message: errorMessage || (report.errors.length ? report.errors.join(' · ').slice(0, 2000) : null),
        detail: report,
      },
    });
  } catch (err) {
    logger.warn(`Could not write pea_azure_sync_log: ${err.message}`);
  }
}

/**
 * Everything waiting for HR: detected joiners and leaver flags.
 * @returns {Promise<object>}
 */
export async function getInbox() {
  let joiners = [];
  let leavers = [];
  let lastScan = null;
  let ambiguousPl = 0;
  let setupRequired = false;

  try {
    [joiners, leavers, lastScan, ambiguousPl] = await Promise.all([
      prisma.pea_joiner_candidates.findMany({
        // source = 'azure' only: rows once queued from ATS offers on the
        // temporary co-located database are ignored (decision D5).
        where: { status: 'pending', source: 'azure' },
        orderBy: [{ account_created_at: 'desc' }],
        take: 100,
      }),

      // A flag counts only if it was raised AFTER the last time HR dismissed it.
      prisma.$queryRaw`
        SELECT id, full_name, office_email, doj, rm_name,
               azure_account_enabled, license_assigned,
               leaver_flagged_at, azure_synced_at
          FROM pea_employees
         WHERE employment_status = 'active'
           AND leaver_flagged_at IS NOT NULL
           AND (leaver_dismissed_at IS NULL OR leaver_dismissed_at < leaver_flagged_at)
         ORDER BY leaver_flagged_at DESC
         LIMIT 100`,

      prisma.pea_azure_sync_log.findFirst({ orderBy: { run_at: 'desc' } }),

      prisma.pea_rm_pl_map.count({ where: { is_ambiguous: true } }),
    ]);
  } catch (err) {
    // The intake tables do not exist on this database yet. That is an expected
    // state, not a fault — so the screen says what is missing rather than
    // returning a 500 that looks like a bug.
    setupRequired = true;
    logger.warn(`New Joiner Inbox unavailable — have the intake tables been created? ${err.message}`);
  }

  return {
    setupRequired,
    joiners: joiners.map(serialiseCandidate),
    leavers: leavers.map((l) => ({ ...l, id: String(l.id) })),
    counts: {
      joiners: joiners.length,
      leavers: leavers.length,
      ambiguousPlMappings: ambiguousPl,
    },
    lastScan: lastScan
      ? {
          runAt: lastScan.run_at,
          mode: lastScan.mode,
          status: lastScan.status,
          accountsFetched: lastScan.users_fetched,
          durationMs: lastScan.duration_ms,
          error: lastScan.error_message,
        }
      : null,
  };
}

/** BigInt ids and a plain date for the UI. */
function serialiseCandidate(c) {
  return {
    ...c,
    id: String(c.id),
    employee_id: c.employee_id ? String(c.employee_id) : null,
    suggested_doj: c.suggested_doj ? toDateString(c.suggested_doj) : null,
  };
}

/**
 * Turn a detected account into a real employee, with HR's corrections applied.
 *
 * @param {bigint|number|string} id - pea_joiner_candidates.id
 * @param {object} input - HR's confirmed values; must include doj and is_experienced
 * @param {string} actor
 * @returns {Promise<object>} the created employee, with cycles
 */
export async function acceptCandidate(id, input, actor) {
  const candidateId = BigInt(id);
  const candidate = await prisma.pea_joiner_candidates.findUnique({ where: { id: candidateId } });

  if (!candidate) throw new AppError('This joiner is no longer in the inbox', 404);
  if (candidate.status !== 'pending') {
    throw new AppError(
      candidate.status === 'accepted'
        ? 'This joiner has already been added as an employee'
        : 'This joiner was dismissed. Re-run the scan if that was a mistake.',
      409
    );
  }

  // The two fields Microsoft genuinely does not hold. Refusing here is the
  // point: defaulting is_experienced to false would put an experienced hire on
  // the fresher cadence — six monthly evaluations instead of three two-monthly
  // ones — and nobody would notice for a month. Plan §13.6.
  if (input.is_experienced === undefined || input.is_experienced === null || input.is_experienced === '') {
    throw new AppError(
      'Fresher or experienced must be confirmed — Microsoft 365 does not record it.',
      400
    );
  }
  if (!input.doj) {
    throw new AppError(
      'Date of joining must be confirmed. The suggested date is the Microsoft account creation date, ' +
        'which is only a proxy — it is wrong by more than a week for about one joiner in four.',
      400
    );
  }

  const payload = {
    full_name: input.full_name || candidate.display_name,
    office_email: input.office_email || candidate.office_email,
    personal_email: input.personal_email || null,
    doj: input.doj,
    is_experienced: input.is_experienced,
    rm_name: input.rm_name || candidate.suggested_rm_name,
    rm_email: input.rm_email || candidate.suggested_rm_email,
    pl_email: input.pl_email || candidate.suggested_pl_email,
  };

  const employee = await createEmployee(payload, actor, 'azure');

  const reviewed = { status: 'accepted', employee_id: employee.id, reviewed_by: actor, reviewed_at: new Date() };

  await prisma.$transaction([
    prisma.pea_joiner_candidates.update({ where: { id: candidateId }, data: reviewed }),
    // Record which fields HR had to correct. Over time this is the evidence for
    // the §13.7 request to IT: it says exactly how often Entra was wrong or
    // silent, rather than asserting it.
    prisma.pea_employee_audit.create({
      data: {
        employee_id: employee.id,
        field_name: '*',
        new_value: describeCorrections(candidate, payload),
        changed_by: actor,
        change_source: 'azure',
      },
    }),
  ]);

  if (candidate.azure_user_id) {
    await prisma.pea_employees.update({
      where: { id: employee.id },
      data: { azure_user_id: candidate.azure_user_id },
    });

    // Entra's values as of the scan, so "differs from Azure", Report to IT and
    // Unlock / resync work straight away rather than only after the next scan.
    // Raw SQL — see schema.prisma.
    if (await hasPhase2Features()) {
      await prisma.$executeRaw`
        UPDATE pea_employees
           SET azure_display_name = ${candidate.display_name || null},
               azure_mail = ${candidate.office_email || null}
         WHERE id = ${employee.id}`;
    }
  }

  logger.info(`Joiner accepted by ${actor}: ${payload.full_name} <${payload.office_email}>`);
  return employee;
}

/** A one-line account of what was suggested versus what HR confirmed. */
function describeCorrections(candidate, payload) {
  const parts = [`Added from the New Joiner Inbox (Microsoft 365 account ${candidate.azure_user_id}).`];

  const compare = [
    ['name', candidate.display_name, payload.full_name],
    ['office email', candidate.office_email, payload.office_email],
    [
      'DOJ',
      candidate.suggested_doj ? toDateString(candidate.suggested_doj) : null,
      payload.doj,
    ],
    ['reporting manager', candidate.suggested_rm_email, payload.rm_email],
    ['project leader', candidate.suggested_pl_email, payload.pl_email],
  ];

  const corrected = compare
    .filter(([, suggested, confirmed]) => String(suggested ?? '') !== String(confirmed ?? ''))
    .map(([field, suggested, confirmed]) => `${field}: "${suggested ?? '(blank)'}" → "${confirmed}"`);

  parts.push(
    corrected.length
      ? `HR corrected ${corrected.length} field(s) — ${corrected.join('; ')}.`
      : 'HR accepted every suggested value unchanged.'
  );

  return parts.join(' ');
}

/**
 * Take a detected account off the list.
 * @param {bigint|number|string} id
 * @param {string} reason
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function dismissCandidate(id, reason, actor) {
  const candidateId = BigInt(id);
  const candidate = await prisma.pea_joiner_candidates.findUnique({ where: { id: candidateId } });

  if (!candidate) throw new AppError('This joiner is no longer in the inbox', 404);
  if (candidate.status === 'accepted') {
    throw new AppError('This joiner has already been added as an employee', 409);
  }

  const updated = await prisma.pea_joiner_candidates.update({
    where: { id: candidateId },
    data: {
      status: 'dismissed',
      dismissed_reason: String(reason || '').trim() || 'No reason given',
      reviewed_by: actor,
      reviewed_at: new Date(),
    },
  });

  logger.info(`Joiner dismissed by ${actor}: ${candidate.office_email} — ${updated.dismissed_reason}`);
  return serialiseCandidate(updated);
}

/**
 * HR confirms a flagged employee has left.
 *
 * Routed through updateEmployee so the change is audited and the evaluation
 * sweep stops chasing them from the next run — exactly as a manual edit would.
 *
 * @param {bigint|number|string} employeeId
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function confirmLeaver(employeeId, actor) {
  const id = BigInt(employeeId);
  const employee = await prisma.pea_employees.findUnique({ where: { id } });
  if (!employee) throw new AppError('Employee not found', 404);

  const updated = await updateEmployee(id, { employment_status: 'left' }, actor, 'azure');

  await prisma.pea_employees.update({
    where: { id },
    data: { leaver_flagged_at: null },
  });

  // The pop-up promises "all outstanding evaluations stop immediately", and
  // until now that was only half true: the sweep stopped sending, but a link
  // already in a manager's inbox still opened and could still be submitted.
  // Expiring the tokens makes the promise real.
  //
  // `skipped`, not `completed`: nobody rated this person, and recording a
  // non-existent submission would corrupt every average that counts it.
  const now = new Date();
  const closed = await prisma.pea_evaluation_cycles.updateMany({
    where: {
      employee_id: id,
      status: { in: ['pending', 'email_sent', 'opened'] },
    },
    data: {
      status: 'skipped',
      token_expires_at: now,
      modified_at: now,
    },
  });

  logger.info(
    `Leaver confirmed by ${actor}: ${employee.full_name} <${employee.office_email}>` +
      `${closed.count ? ` — ${closed.count} open evaluation(s) closed and their links expired` : ''}`
  );

  return { ...updated, evaluationsClosed: closed.count };
}

/**
 * HR says the flag is wrong and the person is still here.
 *
 * Records the instant rather than a boolean, so if they genuinely leave later
 * the next scan raises a fresh flag instead of being silenced forever.
 *
 * @param {bigint|number|string} employeeId
 * @param {string} actor
 * @returns {Promise<{id: string, dismissedAt: Date}>}
 */
export async function dismissLeaver(employeeId, actor) {
  const id = BigInt(employeeId);
  const employee = await prisma.pea_employees.findUnique({ where: { id } });
  if (!employee) throw new AppError('Employee not found', 404);

  const now = new Date();

  await prisma.$transaction([
    prisma.pea_employees.update({ where: { id }, data: { leaver_dismissed_at: now } }),
    prisma.pea_employee_audit.create({
      data: {
        employee_id: id,
        field_name: '*',
        new_value:
          'Leaver suggestion dismissed — Microsoft 365 shows the account disabled and unlicensed, ' +
          'but HR confirmed the employee is still here.',
        changed_by: actor,
        change_source: 'azure',
      },
    }),
  ]);

  logger.info(`Leaver flag dismissed by ${actor}: ${employee.full_name}`);
  return { id: String(id), dismissedAt: now };
}
