/**
 * e2e-scheduler.js — exercise the daily sweep, reminders and adhoc resend.
 *
 * Builds employees whose cycles are due, runs the sweep, and checks what
 * happened — including that the self-healing property actually works and that
 * every guard from the original flow is still enforced.
 *
 * Usage:  node scripts/e2e-scheduler.js
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.PEA_BASE || 'http://localhost:5002/api';
const USER = process.env.PEA_ADMIN_USERNAME || 'pankaj';
const PASS = process.env.PEA_ADMIN_PASSWORD || 'PeaAdmin@2026';

const prisma = new PrismaClient();
const h = (s) => console.log(`\n${'─'.repeat(72)}\n${s}\n${'─'.repeat(72)}`);
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); process.exitCode = 1; };
const eq = (l, a, b) => (String(a) === String(b) ? ok(`${l}: ${a}`) : bad(`${l}: got ${a}, expected ${b}`));

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const PREFIX = 'e2e.sched';
const mk = (n) => `${PREFIX}.${n}@aapnainfotech.com`;

/** Create an employee whose DOJ is `daysAgo` in the past. */
async function makeEmployee(token, name, daysAgo, extra = {}) {
  const doj = new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const { json } = await api('/employees', {
    method: 'POST',
    token,
    body: {
      full_name: name,
      office_email: mk(name.toLowerCase().replace(/\W+/g, '')),
      is_experienced: false,
      doj,
      rm_name: `${name} Manager`,
      rm_email: `${name.toLowerCase().replace(/\W+/g, '')}.rm@aapnainfotech.com`,
      pl_email: 'sched.pl@aapnainfotech.com',
      ...extra,
    },
  });
  return json.data;
}

async function cleanup() {
  await prisma.pea_employees.deleteMany({ where: { office_email: { startsWith: PREFIX } } });
}

async function main() {
  const { json: auth } = await api('/auth/login', {
    method: 'POST',
    body: { identifier: USER, password: PASS },
  });
  const token = auth.data.token;

  await cleanup();

  // ── Diagnostics first ───────────────────────────────────────────────────
  h('1. DIAGNOSTICS — will this actually send anything?');
  const { json: diag } = await api('/admin/diagnostics', { token });
  console.log(`  today: ${diag.data.today} (${diag.data.timezone})`);
  console.log(`  Graph: ${diag.data.graph.ok ? '✅' : '⚠️ '} ${diag.data.graph.detail}`);
  console.log('  blockers:');
  for (const b of diag.data.blockers) console.log(`    · ${b}`);
  diag.data.willActuallySendEmail === false
    ? ok('confirmed: no real email can leave the system')
    : bad('DANGER: the system would send real email');

  // ── Setup ───────────────────────────────────────────────────────────────
  h('2. SETUP');
  const dueNow = await makeEmployee(token, 'DueNow', 35);       // eval 1 due (day 30)
  const future = await makeEmployee(token, 'Future', 5);        // nothing due yet
  const halted = await makeEmployee(token, 'Halted', 35, { halt_process: true });
  const left = await makeEmployee(token, 'Left', 35, { employment_status: 'left' });
  const confirmed = await makeEmployee(token, 'Confirmed', 35, { confirmation_status: 'Confirmed' });
  ok('5 employees: due-now, future, halted, left, confirmed');

  // ── Dry run ─────────────────────────────────────────────────────────────
  h('3. DRY RUN — reports intent, sends nothing');
  const { json: dry } = await api('/admin/sweep?dryRun=true', { method: 'POST', token });
  console.log(`  ${dry.message}`);
  for (const r of dry.data.evaluations.rows) console.log(`    · ${r.cycle} → ${r.to}`);

  const dryNames = dry.data.evaluations.rows.map((r) => r.cycle).join(' ');
  dryNames.includes('DueNow') ? ok('DueNow is included') : bad('DueNow missing from the sweep');
  !dryNames.includes('Future') ? ok('Future excluded (not due yet)') : bad('Future wrongly included');
  !dryNames.includes('Halted') ? ok('Halted excluded (halt_process)') : bad('halt_process guard failed');
  !dryNames.includes('Left') ? ok('Left excluded (employment_status)') : bad('employment guard failed');
  !dryNames.includes('Confirmed') ? ok('Confirmed excluded (terminal status)') : bad('confirmation guard failed');

  const before = await prisma.pea_evaluation_cycles.count({ where: { status: 'email_sent' } });

  // ── Real sweep ──────────────────────────────────────────────────────────
  h('4. REAL SWEEP');
  const { json: sweep } = await api('/admin/sweep', { method: 'POST', token });
  console.log(`  ${sweep.message}`);
  eq('evaluations due', sweep.data.evaluations.due, 1);
  eq('failed', sweep.data.evaluations.failed, 0);
  // An overdue evaluation must not be chased in the pass that first sends it.
  eq('no reminder in the same pass as the send', sweep.data.reminders.sent, 0);

  const cyc = await prisma.pea_evaluation_cycles.findFirst({
    where: { employee_id: BigInt(dueNow.id), seq_no: 1 },
  });
  eq('cycle status', cyc.status, 'email_sent');
  cyc.sent_at ? ok('sent_at stamped') : bad('sent_at missing');
  cyc.token_expires_at ? ok(`token expires ${cyc.token_expires_at.toISOString().slice(0, 10)}`) : bad('no expiry set');

  // ── Idempotency ─────────────────────────────────────────────────────────
  h('5. SWEEP AGAIN — must not re-send');
  const { json: again } = await api('/admin/sweep', { method: 'POST', token });
  eq('evaluations due on second run', again.data.evaluations.due, 0);
  ok('no duplicate sends');

  // ── Self-healing ────────────────────────────────────────────────────────
  h('6. SELF-HEALING — the whole point of the migration');
  // Reset the cycle to pending and backdate it well past its due date, as if
  // several sweeps had failed. The old exact-day match would never fire again.
  await prisma.pea_evaluation_cycles.update({
    where: { id: cyc.id },
    data: { status: 'pending', sent_at: null, due_date: new Date(Date.now() - 20 * 86_400_000) },
  });
  const { json: heal } = await api('/admin/sweep', { method: 'POST', token });
  eq('a 20-day-late evaluation is picked up', heal.data.evaluations.sent, 1);
  ok('due_date <= today caught up after a simulated outage');

  // ── Reminders ───────────────────────────────────────────────────────────
  h('7. REMINDERS — two chases at sent_at +2 and +4 days');
  // Reset the chase clock to "sent today" so the offsets can be exercised
  // deliberately rather than depending on what earlier steps happened to do.
  const setSent = (daysAgo) =>
    prisma.pea_evaluation_cycles.update({
      where: { id: cyc.id },
      data: {
        status: 'email_sent',
        reminder_count: 0,
        last_reminded_at: null,
        sent_at: new Date(Date.now() - daysAgo * 86_400_000),
      },
    });

  await setSent(0);
  const r0 = await api('/admin/sweep', { method: 'POST', token });
  eq('no reminder on the day it was sent', r0.json.data.reminders.sent, 0);
  ok('a manager who just received the email is not chased in the same pass');

  await setSent(1);
  const rEarly = await api('/admin/sweep', { method: 'POST', token });
  eq('no reminder after 1 day (offset is 2)', rEarly.json.data.reminders.sent, 0);

  await setSent(2);
  const r1 = await api('/admin/sweep', { method: 'POST', token });
  eq('reminder 1 sent at +2 days', r1.json.data.reminders.sent, 1);

  let c = await prisma.pea_evaluation_cycles.findUnique({ where: { id: cyc.id } });
  eq('reminder_count', c.reminder_count, 1);

  // Still day +2: the second offset (+4) is not reached yet.
  const rGap = await api('/admin/sweep', { method: 'POST', token });
  eq('no second reminder before +4 days', rGap.json.data.reminders.sent, 0);

  await prisma.pea_evaluation_cycles.update({
    where: { id: cyc.id },
    data: { sent_at: new Date(Date.now() - 4 * 86_400_000) },
  });
  const r2 = await api('/admin/sweep', { method: 'POST', token });
  eq('reminder 2 sent at +4 days', r2.json.data.reminders.sent, 1);

  const r3 = await api('/admin/sweep', { method: 'POST', token });
  eq('no third reminder (max 2)', r3.json.data.reminders.sent, 0);

  c = await prisma.pea_evaluation_cycles.findUnique({ where: { id: cyc.id } });
  eq('final reminder_count', c.reminder_count, 2);

  // ── Adhoc resend ────────────────────────────────────────────────────────
  h('8. ADHOC RESEND — replaces the Power Automate Adhoc Flow');
  const oldToken = c.token;
  const { status, json: adhoc } = await api('/admin/send-evaluation', {
    method: 'POST',
    token,
    body: { office_email: dueNow.office_email, seq_no: 1 },
  });
  eq('HTTP status', status, 200);
  console.log(`  ${adhoc.message}`);

  c = await prisma.pea_evaluation_cycles.findUnique({ where: { id: cyc.id } });
  c.token !== oldToken ? ok('a new token was issued (old link invalidated)') : bad('token was reused');
  eq('reminder clock reset', c.reminder_count, 0);

  // Guard: refuse to resend a completed evaluation.
  await prisma.pea_evaluation_cycles.update({
    where: { id: cyc.id },
    data: { status: 'completed', submitted_at: new Date() },
  });
  const blocked = await api('/admin/send-evaluation', {
    method: 'POST',
    token,
    body: { office_email: dueNow.office_email, seq_no: 1 },
  });
  eq('resending a submitted evaluation is refused', blocked.status, 409);
  blocked.json.message.includes('discard') ? ok('explains why it refused') : bad('unclear refusal message');

  // Guard: halted employee.
  const haltedSend = await api('/admin/send-evaluation', {
    method: 'POST',
    token,
    body: { office_email: halted.office_email, seq_no: 1 },
  });
  eq('adhoc send to a halted employee is refused', haltedSend.status, 409);

  // ── Nothing escaped ─────────────────────────────────────────────────────
  h('9. EMAIL SAFETY');
  const logs = await prisma.pea_email_log.findMany({
    where: { employee: { office_email: { startsWith: PREFIX } } },
    orderBy: { sent_at: 'asc' },
  });
  ok(`${logs.length} notification(s) logged`);
  const escaped = logs.filter((l) => l.status === 'sent');
  escaped.length === 0
    ? ok('every notification suppressed — nothing left the system')
    : bad(`${escaped.length} notification(s) were actually SENT`);
  for (const l of logs) console.log(`     [${l.status}] ${l.email_type} — ${l.subject}`);

  // ── Shadow report ───────────────────────────────────────────────────────
  h('10. SHADOW REPORT — the R6 stage-1 cutover evidence');
  const { json: shadow } = await api('/admin/shadow-report?days=1', { token });
  console.log(`  shadowMode: ${shadow.data.shadowMode}, ${shadow.data.count} row(s) in the last day`);
  const sample = shadow.data.rows.filter((r) => r.employee?.startsWith('DueNow')).slice(0, 3);
  for (const r of sample) {
    console.log(`    · ${r.type} eval ${r.evaluation} → would have gone to: ${r.wouldHaveGoneTo}`);
  }
  sample.length && sample[0].wouldHaveGoneTo?.includes('@')
    ? ok('report shows the REAL intended recipient, not the diverted one')
    : bad('shadow report does not show the intended recipient');

  await cleanup();
  console.log(process.exitCode ? '\n❌ SCHEDULER E2E FAILED\n' : '\n✅ SCHEDULER E2E PASSED — test data cleaned up\n');
}

main()
  .catch(async (e) => {
    console.error('\n💥', e.message, '\n');
    process.exitCode = 1;
    await cleanup().catch(() => {});
  })
  .finally(() => prisma.$disconnect());
