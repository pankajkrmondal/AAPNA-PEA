/**
 * render-sample-form.js — save the evaluation form to a file for review.
 *
 * Creates a throwaway employee whose first evaluation is due, fetches the
 * rendered page, writes it to docs/, then removes the test employee. Lets HR
 * see and comment on the form without anyone needing the app running.
 *
 * Usage:  node scripts/render-sample-form.js [outputPath]
 */
import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.PEA_BASE || 'http://localhost:5002/api';
const OUT =
  process.argv[2] || 'E:/Performance Evaluation Automation/docs/sample-evaluation-form.html';

const prisma = new PrismaClient();
const EMAIL = 'sample.form.preview@aapnainfotech.com';

async function main() {
  await prisma.pea_employees.deleteMany({ where: { office_email: EMAIL } });

  // Fresher, joined 32 days ago: evaluation 1 is due and it is NOT the final
  // cycle, so this shows the everyday case rather than the decision one.
  const doj = new Date(Date.now() - 32 * 86_400_000);
  doj.setUTCHours(0, 0, 0, 0);

  const employee = await prisma.pea_employees.create({
    data: {
      full_name: 'Sample Employee',
      office_email: EMAIL,
      is_experienced: false,
      doj,
      rm_name: 'Sample Manager',
      rm_email: 'sample.manager@aapnainfotech.com',
      pl_email: 'sample.pl@aapnainfotech.com',
      source: 'manual',
    },
  });

  const { buildSchedule } = await import('../src/services/cycleGenerator.service.js');
  await prisma.pea_evaluation_cycles.createMany({
    data: buildSchedule(employee).map((c) => ({ ...c, employee_id: employee.id })),
  });

  const cycle = await prisma.pea_evaluation_cycles.findFirst({
    where: { employee_id: employee.id, seq_no: 1 },
  });

  const res = await fetch(`${BASE}/evaluation/${cycle.token}`);
  const html = await res.text();

  const csp = res.headers.get('content-security-policy');

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, html, 'utf8');

  console.log(`✅ Saved ${Buffer.byteLength(html)} bytes → ${OUT}`);
  console.log(`   HTTP ${res.status} · ${res.headers.get('content-type')}`);
  console.log('\n   Content-Security-Policy:');
  for (const part of (csp || '').split(';')) if (part.trim()) console.log(`     ${part.trim()}`);

  await prisma.pea_employees.delete({ where: { id: employee.id } });
  console.log('\n   Test employee removed.');
}

main()
  .catch((e) => {
    console.error('💥', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
