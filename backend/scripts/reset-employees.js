/**
 * reset-employees.js — clear imported employee data for a clean re-test.
 *
 * Deletes every row in pea_employees (cycles, scores, audit and email log rows
 * cascade). Leaves pea_users, pea_settings and pea_evaluation_params alone.
 *
 * Development helper. It refuses to run in production, and it names every
 * table it touches explicitly, so it can never reach anything that is not PEA's.
 *
 * Usage:  node scripts/reset-employees.js --yes
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

if (process.env.NODE_ENV === 'production') {
  console.error('💥 Refusing to run in production.');
  process.exit(1);
}

if (!process.argv.includes('--yes')) {
  console.log('This deletes ALL employees and their evaluation history.');
  console.log('Re-run with --yes to confirm:  node scripts/reset-employees.js --yes');
  process.exit(0);
}

const prisma = new PrismaClient();

const main = async () => {
  const before = await prisma.pea_employees.count();
  // pea_evaluation_cycles, _scores, _employee_audit and _email_log all cascade
  // from pea_employees, so one delete is enough.
  const { count } = await prisma.pea_employees.deleteMany({});
  console.log(`✅ Deleted ${count} employee(s) (was ${before}); cycles and audit cascaded.`);
};

main()
  .catch((e) => {
    console.error('💥', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
