/**
 * smoke-db.js — prove the Prisma layer works against PEA's database.
 *
 * Checks, in order:
 *   1. The client connects, and says which database it reached.
 *   2. Seeded reference data is readable through the models.
 *   3. PEA's core tables are all present.
 *
 * PEA reads no ATS data (decision D5), so nothing here touches an ATS table.
 *
 * Run:  node scripts/smoke-db.js
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const pass = (m) => console.log(`  ✅ ${m}`);
const fail = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };
const eq = (label, actual, expected) =>
  actual === expected ? pass(`${label}: ${actual}`)
                      : fail(`${label}: got ${actual}, expected ${expected}`);

const CORE_TABLES = [
  'pea_users', 'pea_sessions', 'pea_employees', 'pea_evaluation_cycles', 'pea_evaluation_scores',
  'pea_evaluation_params', 'pea_email_log', 'pea_settings', 'pea_employee_audit', 'pea_azure_sync_log',
];

async function main() {
  console.log('\n── 1. Connection ────────────────────────────────────────────');
  await prisma.$connect();
  const [{ db, usr }] = await prisma.$queryRaw`
    SELECT current_database() AS db, current_user AS usr`;
  pass(`database: ${db}`);
  pass(`connected as ${usr}`);

  console.log('\n── 2. PEA models readable ───────────────────────────────────');
  eq('pea_evaluation_params rows', await prisma.pea_evaluation_params.count(), 18);
  pass(`pea_settings rows: ${await prisma.pea_settings.count()}`);

  const employees = await prisma.pea_employees.count();
  const cycles = await prisma.pea_evaluation_cycles.count();
  pass(`pea_employees rows: ${employees}`);
  pass(`pea_evaluation_cycles rows: ${cycles}`);

  // Every employee must have a schedule. A zero-cycle employee means the
  // generator was skipped, and nobody would ever be asked to rate them.
  if (employees > 0) {
    const orphans = await prisma.$queryRaw`
      SELECT count(*)::int AS n FROM pea_employees e
       WHERE NOT EXISTS (SELECT 1 FROM pea_evaluation_cycles c WHERE c.employee_id = e.id)`;
    eq('employees with no schedule', orphans[0].n, 0);
  }

  const shadow = await prisma.pea_settings.findUnique({ where: { setting_key: 'shadow_mode' } });
  pass(`shadow_mode: ${shadow?.setting_value ?? '(unset)'}`);

  const fresher = await prisma.pea_evaluation_params.findMany({
    where: { template: 'fresher' },
    orderBy: { sort_order: 'asc' },
    select: { param_label: true },
  });
  eq('fresher form questions', fresher.length, 7);
  console.log(`     ${fresher.map((p) => p.param_label).join(' · ')}`);

  console.log('\n── 3. PEA schema present ────────────────────────────────────');
  const present = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'pea\\_%'`;
  const names = new Set(present.map((r) => r.tablename));
  for (const t of CORE_TABLES) (names.has(t) ? pass : fail)(`${t}${names.has(t) ? '' : ' MISSING'}`);
}

main()
  .catch((e) => { console.error('\n💥', e.message); process.exitCode = 1; })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(process.exitCode ? '\n❌ SMOKE TEST FAILED\n' : '\n✅ ALL CHECKS PASSED\n');
  });
