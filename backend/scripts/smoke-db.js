/**
 * smoke-db.js — prove the Prisma layer works against the real database.
 *
 * Checks, in order:
 *   1. The client connects at all.
 *   2. Seeded reference data is readable through the models.
 *   3. ATS tables are readable via $queryRaw — the mechanism the "Recruitment
 *      History" panel depends on, since they are not Prisma models here.
 *   4. The ATS tables are intact (48) and untouched by anything PEA did.
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

async function main() {
  console.log('\n── 1. Connection ────────────────────────────────────────────');
  await prisma.$connect();
  const [{ db, usr }] = await prisma.$queryRaw`
    SELECT current_database() AS db, current_user AS usr`;
  eq('database', db, 'recruitmentautomationdb');
  pass(`connected as ${usr}`);

  console.log('\n── 2. PEA models readable ───────────────────────────────────');
  eq('pea_evaluation_params rows', await prisma.pea_evaluation_params.count(), 18);
  eq('pea_settings rows',          await prisma.pea_settings.count(), 17);
  eq('pea_employees rows',         await prisma.pea_employees.count(), 0);
  eq('pea_evaluation_cycles rows', await prisma.pea_evaluation_cycles.count(), 0);

  const shadow = await prisma.pea_settings.findUnique({
    where: { setting_key: 'shadow_mode' },
  });
  eq('shadow_mode', shadow?.setting_value, 'true');

  const fresher = await prisma.pea_evaluation_params.findMany({
    where: { template: 'fresher' },
    orderBy: { sort_order: 'asc' },
    select: { param_label: true },
  });
  eq('fresher form questions', fresher.length, 7);
  console.log(`     ${fresher.map((p) => p.param_label).join(' · ')}`);

  console.log('\n── 3. ATS readable via $queryRaw ────────────────────────────');
  // Not Prisma models on purpose: adding them would mean db pull, which has no
  // table filter and would import all 48 ATS tables. Raw SQL keeps every ATS
  // read explicit and greppable.
  const [{ n: pipelines }] = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM rpa_candidate_pipeline`;
  pass(`rpa_candidate_pipeline readable (${pipelines} rows)`);

  const [{ n: offers }] = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM rpa_offers WHERE joining_date IS NOT NULL`;
  pass(`rpa_offers with a joining_date: ${offers} — the ATS→PEA handoff (plan R4)`);

  console.log('\n── 4. ATS schema intact ─────────────────────────────────────');
  const [{ n: rpa }] = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM pg_tables
     WHERE schemaname = 'public' AND tablename LIKE 'rpa\\_%'`;
  eq('rpa_ tables', rpa, 48);

  const [{ n: pea }] = await prisma.$queryRaw`
    SELECT count(*)::int AS n FROM pg_tables
     WHERE schemaname = 'public' AND tablename LIKE 'pea\\_%'`;
  eq('pea_ tables', pea, 10);
}

main()
  .catch((e) => { console.error('\n💥', e.message); process.exitCode = 1; })
  .finally(async () => {
    await prisma.$disconnect();
    console.log(
      process.exitCode ? '\n❌ SMOKE TEST FAILED\n' : '\n✅ ALL CHECKS PASSED\n'
    );
  });
