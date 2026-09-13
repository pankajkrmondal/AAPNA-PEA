/**
 * e2e-import.js — drive the import API end to end against a running server.
 *
 * Usage:
 *   node scripts/e2e-import.js "<path to workbook.xlsx>"
 *
 * Exists because PowerShell 5.1 has no multipart support (`-Form` is 7.x only),
 * and because a repeatable script beats a one-off curl when the real master
 * sheet arrives and this has to be run for real.
 */
import fs from 'fs';
import path from 'path';

const BASE = process.env.PEA_BASE || 'http://localhost:5002/api';
const USER = process.env.PEA_ADMIN_USERNAME || 'pankaj';
const PASS = process.env.PEA_ADMIN_PASSWORD;
if (!PASS) { console.error('Set PEA_ADMIN_PASSWORD to run this suite (no default).'); process.exit(1); }

const file =
  process.argv[2] ||
  'E:/Performance Evaluation Automation/PEA-DOC/Performance Evaluation Excel Sheet - Format for Automation - Demo.xlsx';

const h = (s) => console.log(`\n${'─'.repeat(70)}\n${s}\n${'─'.repeat(70)}`);

async function api(pathname, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status}: ${json.message || 'unknown'}`);
  return json;
}

function workbookForm() {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(file)]), path.basename(file));
  return fd;
}

async function main() {
  console.log(`Workbook: ${file}`);

  const { data: auth } = await api('/auth/login', {
    method: 'POST',
    body: { identifier: USER, password: PASS },
  });
  const token = auth.token;

  // ── 1. Preview — parses only, writes nothing ────────────────────────────
  h('1. PREVIEW  (reconciliation report — nothing saved)');
  const { data: prev } = await api('/import/preview', {
    method: 'POST',
    token,
    form: workbookForm(),
  });

  console.log(
    `sheet "${prev.sheetName}"   rows read: ${prev.rowsRead}   ` +
      `valid: ${prev.valid}   rejected: ${prev.rejected}`
  );
  console.log(
    `freshers: ${prev.freshers}   experienced: ${prev.experienced}   ` +
      `already confirmed: ${prev.withConfirmation}   halted: ${prev.halted}`
  );

  console.log('\nRows that would import:');
  console.table(
    prev.preview.map((p) => ({
      row: p.excelRow,
      name: p.full_name,
      type: p.type,
      DOJ: p.doj,
      evals: p.evaluationsToCreate,
      confirmation: p.confirmation_status || '—',
    }))
  );

  if (prev.rejectedRows.length) {
    console.log('\n⚠️  Rejected rows — HR must review these before sign-off:');
    console.table(
      prev.rejectedRows.map((r) => ({
        row: r.excelRow,
        name: r.name || '—',
        email: r.officeEmail || '—',
        why: r.reasons.join('; '),
      }))
    );
  }

  // ── 2. Import ───────────────────────────────────────────────────────────
  h('2. IMPORT');
  const imp = await api('/import/excel', { method: 'POST', token, form: workbookForm() });
  console.log(imp.message);
  if (imp.data.failedRows.length) console.table(imp.data.failedRows);

  // ── 3. Idempotency — a second run must not duplicate ────────────────────
  h('3. RE-IMPORT  (must skip, not duplicate — cutover will be rehearsed)');
  const again = await api('/import/excel', { method: 'POST', token, form: workbookForm() });
  console.log(again.message);

  // ── 4. What HR sees ─────────────────────────────────────────────────────
  h('4. EMPLOYEE LIST');
  const list = await api('/employees?limit=50', { token });
  console.log(`total: ${list.pagination.total}\n`);
  console.table(
    list.data.map((e) => ({
      name: e.full_name,
      type: e.is_experienced ? 'experienced' : 'fresher',
      DOJ: String(e.doj).slice(0, 10),
      cycles: e.progress.total,
      done: e.progress.completed,
      overdue: e.progress.overdue,
      nextDue: e.progress.nextDue ? String(e.progress.nextDue).slice(0, 10) : '—',
      status: e.confirmation_status || 'in probation',
    }))
  );

  // ── 5. The generated schedule for one employee ──────────────────────────
  const first = list.data[0];
  h(`5. SCHEDULE for ${first.full_name} (${first.is_experienced ? 'experienced' : 'fresher'})`);
  const { data: detail } = await api(`/employees/${first.id}`, { token });
  console.table(
    detail.cycles.map((c) => ({
      '#': c.seq_no,
      due: String(c.due_date).slice(0, 10),
      period: `${String(c.period_from).slice(0, 10)} → ${String(c.period_to).slice(0, 10)}`,
      status: c.status,
      legacy: c.legacy_format || '—',
    }))
  );

  // ── 6. Preview endpoint for a brand-new hire ────────────────────────────
  h('6. SCHEDULE PREVIEW for a new fresher joining 2026-09-15');
  const { data: preview } = await api('/employees/preview-schedule', {
    method: 'POST',
    token,
    body: { doj: '2026-09-15', is_experienced: false },
  });
  console.table(preview);

  console.log('\n✅ e2e import flow complete\n');
}

main().catch((e) => {
  console.error('\n💥', e.message, '\n');
  process.exitCode = 1;
});
