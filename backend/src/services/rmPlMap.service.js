/**
 * rmPlMap.service.js — Project Leader derived from Reporting Manager.
 *
 * ⏳ STATUS (12 Sep 2026): wired up, but pea_rm_pl_map comes from
 *    prisma/ddl/2026-09-12b-pea-joiner-intake.sql, which has NOT been applied
 *    yet. Every function here fails until it is.
 *
 * PL is not a Microsoft concept and never will be. It does not need to be:
 * across all 54 rows of the master sheet, 21 of 22 reporting managers map to
 * exactly one project leader — 89% of staff. Plan §13.5.
 *
 * So instead of asking HR for the PL on every new joiner, PEA learns the
 * mapping from the roster it already holds and offers it as a prefill.
 *
 * ── The one rule that matters ──────────────────────────────────────────────
 *
 * A manager who has appeared with more than one project leader is recorded as
 * AMBIGUOUS and is never auto-applied. The known case is ragupta@, who shows
 * vtyagi@ four times and aroy@ twice. Taking the majority would silently CC the
 * wrong project leader on somebody's performance review — a quiet, plausible,
 * hard-to-notice error, which is exactly the class of failure this migration
 * exists to remove. HR settles it (plan §11.2, open decision 14) and the flag
 * clears itself on the next seed.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';
import AppError from '../utils/AppError.js';

const norm = (v) => (v || '').trim().toLowerCase() || null;

/**
 * Tally RM→PL pairs into map entries.
 *
 * Pure, so the ambiguity rule is testable without a database.
 *
 * @param {Array<{rm_email: string, pl_email: string}>} rows
 * @returns {Array<{rm_email: string, pl_email: string|null, is_ambiguous: boolean, note: string|null, total: number}>}
 */
export function tallyRmToPl(rows) {
  /** @type {Map<string, Map<string, number>>} rm → (pl → count) */
  const tally = new Map();

  for (const row of rows) {
    const rm = norm(row.rm_email);
    const pl = norm(row.pl_email);
    if (!rm || !pl) continue;

    if (!tally.has(rm)) tally.set(rm, new Map());
    const pls = tally.get(rm);
    pls.set(pl, (pls.get(pl) || 0) + 1);
  }

  const out = [];

  for (const [rm, pls] of tally) {
    const ranked = [...pls.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const total = ranked.reduce((sum, [, n]) => sum + n, 0);
    const ambiguous = ranked.length > 1;

    out.push({
      rm_email: rm,
      // The most common PL is still recorded when ambiguous — it is what HR
      // will most likely confirm — but is_ambiguous stops it being applied
      // unasked.
      pl_email: ranked[0][0],
      is_ambiguous: ambiguous,
      note: ambiguous
        ? `Seen with ${ranked.length} project leaders: ${ranked
            .map(([pl, n]) => `${pl} ×${n}`)
            .join(', ')}. Confirm which is correct.`
        : null,
      total,
    });
  }

  return out.sort((a, b) => a.rm_email.localeCompare(b.rm_email));
}

/**
 * Rebuild the map from the current employee roster.
 *
 * Entries HR has edited by hand (source = 'manual') are left alone — the point
 * of editing one is that the sheet was wrong, so re-deriving it from the sheet
 * would undo the correction on the next run.
 *
 * @param {string} actor
 * @returns {Promise<{created: number, updated: number, keptManual: number, ambiguous: number}>}
 */
export async function seedFromEmployees(actor = 'system') {
  const rows = await prisma.pea_employees.findMany({
    select: { rm_email: true, pl_email: true },
  });

  const derived = tallyRmToPl(rows);
  const existing = await prisma.pea_rm_pl_map.findMany();
  const byRm = new Map(existing.map((e) => [norm(e.rm_email), e]));

  let created = 0;
  let updated = 0;
  let keptManual = 0;

  for (const entry of derived) {
    const current = byRm.get(entry.rm_email);

    if (!current) {
      await prisma.pea_rm_pl_map.create({
        data: {
          rm_email: entry.rm_email,
          pl_email: entry.pl_email,
          is_ambiguous: entry.is_ambiguous,
          note: entry.note,
          source: 'sheet',
        },
      });
      created += 1;
      continue;
    }

    if (current.source === 'manual') {
      keptManual += 1;
      continue;
    }

    const unchanged =
      norm(current.pl_email) === entry.pl_email &&
      current.is_ambiguous === entry.is_ambiguous &&
      (current.note || null) === entry.note;

    if (unchanged) continue;

    await prisma.pea_rm_pl_map.update({
      where: { id: current.id },
      data: {
        pl_email: entry.pl_email,
        is_ambiguous: entry.is_ambiguous,
        note: entry.note,
        modified_at: new Date(),
      },
    });
    updated += 1;
  }

  const ambiguous = derived.filter((e) => e.is_ambiguous).length;

  await prisma.pea_settings.upsert({
    where: { setting_key: 'rm_pl_map_seeded_at' },
    create: {
      setting_key: 'rm_pl_map_seeded_at',
      setting_value: new Date().toISOString(),
      description: 'Timestamp of the last RM→PL map seed from pea_employees.',
    },
    update: { setting_value: new Date().toISOString(), modified_at: new Date() },
  });

  logger.info(
    `RM→PL map seeded by ${actor}: ${created} added, ${updated} refreshed, ` +
      `${keptManual} manual entries left alone, ${ambiguous} ambiguous`
  );

  return { created, updated, keptManual, ambiguous, total: derived.length };
}

/**
 * The project leader for a reporting manager, if the map is confident.
 *
 * @param {string} rmEmail
 * @returns {Promise<{pl_email: string|null, ambiguous: boolean, note: string|null}>}
 */
export async function derivePl(rmEmail) {
  const needle = norm(rmEmail);
  if (!needle) return { pl_email: null, ambiguous: false, note: null };

  const [entry] = await prisma.$queryRaw`
    SELECT * FROM pea_rm_pl_map WHERE lower(trim(rm_email)) = ${needle} LIMIT 1`;

  if (!entry) return { pl_email: null, ambiguous: false, note: null };

  return {
    // An ambiguous entry deliberately returns no value. HR sees the note and
    // chooses; PEA does not pick for them.
    pl_email: entry.is_ambiguous ? null : entry.pl_email,
    ambiguous: entry.is_ambiguous,
    note: entry.note,
  };
}

/**
 * The whole map, with how many employees back each entry.
 * @returns {Promise<object[]>}
 */
export async function listMap() {
  const [entries, rows] = await Promise.all([
    prisma.pea_rm_pl_map.findMany({ orderBy: { rm_email: 'asc' } }),
    prisma.pea_employees.findMany({ select: { rm_email: true, pl_email: true } }),
  ]);

  const counts = new Map(tallyRmToPl(rows).map((e) => [e.rm_email, e.total]));

  return entries.map((e) => ({
    ...e,
    id: String(e.id),
    employeeCount: counts.get(norm(e.rm_email)) || 0,
  }));
}

/**
 * Set or correct one entry by hand. Marks it 'manual', which protects it from
 * the next seed.
 *
 * @param {{rm_email: string, pl_email: string, note?: string}} input
 * @param {string} actor
 * @returns {Promise<object>}
 */
export async function upsertEntry(input, actor) {
  const rm = norm(input.rm_email);
  const pl = norm(input.pl_email);
  if (!rm) throw new AppError('A reporting manager email is required', 400);
  if (!pl) throw new AppError('A project leader email is required', 400);

  const [existing] = await prisma.$queryRaw`
    SELECT * FROM pea_rm_pl_map WHERE lower(trim(rm_email)) = ${rm} LIMIT 1`;

  const data = {
    rm_email: rm,
    pl_email: pl,
    // A hand-set entry is by definition no longer ambiguous — someone decided.
    is_ambiguous: false,
    note: input.note || `Set by ${actor} on ${new Date().toISOString().slice(0, 10)}`,
    source: 'manual',
    modified_at: new Date(),
  };

  const saved = existing
    ? await prisma.pea_rm_pl_map.update({ where: { id: existing.id }, data })
    : await prisma.pea_rm_pl_map.create({ data });

  logger.info(`RM→PL entry set by ${actor}: ${rm} → ${pl}`);
  return { ...saved, id: String(saved.id) };
}
