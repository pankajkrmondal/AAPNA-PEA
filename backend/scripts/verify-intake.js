/**
 * verify-intake.js — confirm the New Joiner Inbox storage is in place.
 *
 * Run after applying prisma/ddl/2026-09-12b-pea-joiner-intake.sql:
 *
 *     node scripts/verify-intake.js
 *
 * Every statement is a SELECT on PEA's own tables. It writes nothing and sends
 * nothing — the same read-only discipline as smoke-db.js.
 *
 * It answers the two questions that actually go wrong, in this order:
 *   1. did the DDL run?                    (the tables and settings exist)
 *   2. does the generated client match?    (Prisma can address the new models)
 */
import prisma from '../src/config/database.js';

const rows = [];
const add = (label, value) => rows.push([label, value]);

try {
  add('pea_joiner_candidates rows', await prisma.pea_joiner_candidates.count());
  add('pea_rm_pl_map rows', await prisma.pea_rm_pl_map.count());
  add('pea_azure_sync_log runs', await prisma.pea_azure_sync_log.count());

  const settings = await prisma.pea_settings.findMany({
    where: { setting_key: { startsWith: 'azure_' } },
    select: { setting_key: true, setting_value: true },
    orderBy: { setting_key: 'asc' },
  });
  for (const s of settings) add(s.setting_key, s.setting_value);

  const [emp] = await prisma.$queryRaw`
    SELECT count(*)::int                                                AS active,
           count(*) FILTER (WHERE leaver_flagged_at IS NOT NULL)::int   AS flagged,
           count(*) FILTER (WHERE azure_user_id IS NOT NULL)::int       AS linked
      FROM pea_employees
     WHERE employment_status = 'active'`;
  add('active employees', emp.active);
  add('already leaver-flagged', emp.flagged);
  add('already linked to Entra', emp.linked);

  console.log('\n  ✅ New Joiner Inbox storage is reachable\n');
  for (const [k, v] of rows) console.log(`     ${String(k).padEnd(30)} ${v}`);

  if (settings.length === 0) {
    console.log(
      '\n  ⚠️  No azure_* settings found. Section 5 of the DDL seeds five rows —\n' +
        '      re-run the file if this is unexpected.'
    );
  }
  console.log('');
} catch (err) {
  console.error(`\n  ❌ ${err.message}\n`);
  console.error('     If this names a missing table or column, the 2026-09-12b DDL has not been');
  console.error('     applied to this database. If it names an unknown Prisma model, run');
  console.error('     `npx prisma generate` (stop the backend first — it locks the query engine).\n');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
