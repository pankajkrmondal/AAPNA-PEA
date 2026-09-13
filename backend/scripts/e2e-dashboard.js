/**
 * e2e-dashboard.js — dashboard, data quality, no-ATS check and Excel export.
 *
 * Usage:  node scripts/e2e-dashboard.js
 */
import fs from 'fs';
import { PrismaClient } from '@prisma/client';

const BASE = process.env.PEA_BASE || 'http://localhost:5002/api';
const USER = process.env.PEA_ADMIN_USERNAME || 'pankaj';
const PASS = process.env.PEA_ADMIN_PASSWORD;
if (!PASS) { console.error('Set PEA_ADMIN_PASSWORD to run this suite (no default).'); process.exit(1); }

const prisma = new PrismaClient();
const h = (s) => console.log(`\n${'─'.repeat(72)}\n${s}\n${'─'.repeat(72)}`);
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };

async function api(path, { method = 'GET', token, body, raw = false } = {}) {
  const headers = { Accept: raw ? '*/*' : 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()), headers: res.headers };
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

async function main() {
  const { json: auth } = await api('/auth/login', {
    method: 'POST',
    body: { identifier: USER, password: PASS },
  });
  const token = auth.data.token;

  // ── Dashboard ───────────────────────────────────────────────────────────
  h('1. DASHBOARD');
  const { json: dash } = await api('/dashboard', { token });
  const d = dash.data;
  console.log(`  as at ${d.today} (${d.timezone})\n`);
  console.table(d.employees);
  console.table(d.evaluations);

  typeof d.evaluations.overdue === 'number'
    ? ok('overdue count present — invisible in the spreadsheet')
    : bad('overdue missing');
  typeof d.evaluations.awaitingResponse === 'number'
    ? ok('awaiting-response count present — previously indistinguishable from "not sent"')
    : bad('awaitingResponse missing');

  if (d.recentSubmissions.length) {
    console.log('\n  Recent submissions:');
    console.table(
      d.recentSubmissions.map((r) => ({
        employee: r.employee, eval: r.seqNo, avg: r.average, decision: r.confirmation || '—',
      }))
    );
  }

  // ── Data quality ────────────────────────────────────────────────────────
  h('2. DATA QUALITY — makes silent failures visible');
  const { json: dq } = await api('/dashboard/data-quality', { token });
  console.table(dq.data.issues);
  ok('four classes of silent failure are now countable');
  if (dq.data.finishedWithoutDecision.length) {
    console.log('  Finished all evaluations but no decision recorded:');
    for (const e of dq.data.finishedWithoutDecision.slice(0, 5)) {
      console.log(`    · ${e.full_name} (${e.office_email})`);
    }
  }

  // ── No ATS coupling ─────────────────────────────────────────────────────
  // PEA and ATS are separate projects with separate databases (decision D5).
  // The ATS endpoints that once read recruitment data must not exist.
  h('3. NO ATS ENDPOINTS — PEA reads no ATS data');
  const anyEmployee = await prisma.pea_employees.findFirst({ orderBy: { id: 'asc' } });
  const probes = ['/ats/handoffs', '/ats/search?q=x'];
  if (anyEmployee) probes.push(`/employees/${anyEmployee.id}/ats-history`);
  for (const p of probes) {
    const { status: s } = await api(p, { token });
    s === 404 ? ok(`${p} → 404`) : bad(`${p} → ${s} (expected 404)`);
  }

  // ── Excel export ────────────────────────────────────────────────────────
  h('4. EXCEL EXPORT — same layout HR already reads');
  const { status, buffer, headers } = await api('/dashboard/export', { token, raw: true });
  status === 200 ? ok(`HTTP 200, ${buffer.length} bytes`) : bad(`export failed (${status})`);
  console.log(`     ${headers.get('content-disposition')}`);

  const out = 'E:/Performance Evaluation Automation/docs/sample-export.xlsx';
  fs.writeFileSync(out, buffer);
  ok(`saved → ${out}`);

  const XLSX = (await import('xlsx')).default;
  const wb = XLSX.read(buffer, { type: 'buffer' });
  console.log(`     sheets: ${wb.SheetNames.join(', ')}`);
  wb.SheetNames.includes('Sheet1') && wb.SheetNames.includes('Sheet2')
    ? ok('Sheet1 + Sheet2 match the master workbook layout')
    : bad('sheet names do not match the original');

  const hdrs = XLSX.utils.sheet_to_json(wb.Sheets.Sheet1, { header: 1 })[0];
  const expected = ['Names', 'Office Email', 'Halt_Process', 'Experience', 'DOJ', 'RM Name', 'RM Email', 'PL Email', 'Confirmation Status'];
  JSON.stringify(hdrs.slice(0, 9)) === JSON.stringify(expected)
    ? ok('Sheet1 headers are identical to the original, in the same order')
    : bad(`Sheet1 headers differ: ${hdrs.slice(0, 9).join(', ')}`);
  wb.SheetNames.includes('Evaluation Status')
    ? ok('plus an "Evaluation Status" sheet the original never had')
    : bad('status sheet missing');

  console.log(process.exitCode ? '\n❌ DASHBOARD E2E FAILED\n' : '\n✅ DASHBOARD E2E PASSED\n');
}

main()
  .catch((e) => { console.error('\n💥', e.message, '\n'); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
