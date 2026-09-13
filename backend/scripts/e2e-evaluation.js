/**
 * e2e-evaluation.js — drive the public evaluation form exactly as a manager would.
 *
 * Creates a test employee whose first evaluation is already due, opens the form
 * over HTTP, submits it as a browser does (urlencoded), and checks what landed
 * in the database. Then exercises the extension path on the final cycle.
 *
 * Usage:  node scripts/e2e-evaluation.js
 */
import { PrismaClient } from '@prisma/client';

const BASE = process.env.PEA_BASE || 'http://localhost:5002/api';
const USER = process.env.PEA_ADMIN_USERNAME || 'pankaj';
const PASS = process.env.PEA_ADMIN_PASSWORD;
if (!PASS) { console.error('Set PEA_ADMIN_PASSWORD to run this suite (no default).'); process.exit(1); }

const prisma = new PrismaClient();
const h = (s) => console.log(`\n${'─'.repeat(72)}\n${s}\n${'─'.repeat(72)}`);
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => {
  console.log(`  ❌ ${m}`);
  process.exitCode = 1;
};
const eq = (label, a, b) => (String(a) === String(b) ? ok(`${label}: ${a}`) : bad(`${label}: got ${a}, expected ${b}`));

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${json.message}`);
  return json;
}

const TEST_EMAIL = 'e2e.evaluation.test@aapnainfotech.com';

async function main() {
  const { data: auth } = await api('/auth/login', {
    method: 'POST',
    body: { identifier: USER, password: PASS },
  });
  const token = auth.token;

  // Clean slate for reruns.
  await prisma.pea_employees.deleteMany({ where: { office_email: TEST_EMAIL } });

  // ── Setup: an experienced joiner whose cycles are already due ────────────
  h('SETUP — experienced employee, joined 185 days ago (all 3 evaluations due)');
  const doj = new Date(Date.now() - 185 * 86_400_000).toISOString().slice(0, 10);
  const { data: employee } = await api('/employees', {
    method: 'POST',
    token,
    body: {
      full_name: 'E2E Test Person',
      office_email: TEST_EMAIL,
      is_experienced: true,
      doj,
      rm_name: 'Test Manager',
      rm_email: 'test.manager@aapnainfotech.com',
      pl_email: 'test.pl@aapnainfotech.com',
    },
  });
  ok(`created, DOJ ${doj}, ${employee.cycles.length} cycles`);
  eq('cycles for an experienced joiner', employee.cycles.length, 3);

  const cycle1 = employee.cycles[0];
  const dbCycle1 = await prisma.pea_evaluation_cycles.findUnique({ where: { id: BigInt(cycle1.id) } });

  // ── 1. GET the form as a browser ────────────────────────────────────────
  h('1. GET the form (as a browser)');
  const pageRes = await fetch(`${BASE}/evaluation/${dbCycle1.token}`);
  const html = await pageRes.text();
  eq('HTTP status', pageRes.status, 200);
  eq('content type', pageRes.headers.get('content-type')?.split(';')[0], 'text/html');

  for (const needle of [
    'E2E Test Person',
    'Quality of Code / Work',
    'Cultural Fit',
    'Exceptional',
    'Highly Dissatisfied',
  ]) {
    html.includes(needle) ? ok(`page shows "${needle}"`) : bad(`page missing "${needle}"`);
  }
  // The employee identity is displayed, not typed — the MS Form made the
  // manager type the email and pick the evaluation number by hand.
  html.includes('name="rating_quality_of_work"') ? ok('rating inputs rendered') : bad('rating inputs missing');
  !html.includes('name="confirmation_status"')
    ? ok('no confirmation dropdown on evaluation 1 (correct — not the final cycle)')
    : bad('confirmation dropdown shown too early');

  const opened = await prisma.pea_evaluation_cycles.findUnique({ where: { id: dbCycle1.id } });
  opened.opened_at ? ok(`opened_at stamped (${opened.opened_at.toISOString()})`) : bad('opened_at not set');
  eq('status after opening', opened.status, 'opened');

  // ── 2. Submit with a missing rating — must be rejected ──────────────────
  h('2. Submit incomplete (must be rejected, answers preserved)');
  const partial = new URLSearchParams({
    rating_quality_of_work: '4',
    comments_quality_of_work: 'Good work overall.',
    remarks: 'Half-finished on purpose.',
  });
  const badRes = await fetch(`${BASE}/evaluation/${dbCycle1.token}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: partial,
  });
  const badHtml = await badRes.text();
  eq('rejected with 400', badRes.status, 400);
  badHtml.includes('Please give a rating for')
    ? ok('explains which ratings are missing')
    : bad('no useful validation message');
  badHtml.includes('Half-finished on purpose')
    ? ok('typed answers preserved on re-render (no lost work)')
    : bad('answers lost on validation error');

  // ── 3. Submit properly ──────────────────────────────────────────────────
  h('3. Submit a complete evaluation');
  const full = new URLSearchParams({
    rating_quality_of_work: '4',
    comments_quality_of_work: 'Consistently good output.',
    rating_meeting_deadline: '3',
    comments_meeting_deadline: 'Mostly on time.',
    rating_communication: '4',
    comments_communication: 'Clear and concise.',
    rating_proactiveness: '3',
    comments_proactiveness: 'Improving.',
    rating_skill_development: '5',
    comments_skill_development: 'Learns very fast.',
    rating_cultural_fit: '4',
    comments_cultural_fit: 'Works well with the team.',
    rating_x_factor: '3',
    comments_x_factor: 'Solid contributor.',
    remarks: 'A good first period. Keep it up.',
    submitted_by: 'test.manager@aapnainfotech.com',
  });
  const goodRes = await fetch(`${BASE}/evaluation/${dbCycle1.token}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: full,
  });
  const thanks = await goodRes.text();
  eq('HTTP status', goodRes.status, 200);
  thanks.includes('Thank you') ? ok('thank-you page shown') : bad('no thank-you page');

  const done = await prisma.pea_evaluation_cycles.findUnique({
    where: { id: dbCycle1.id },
    include: { scores: { orderBy: { sort_order: 'asc' } } },
  });
  eq('status', done.status, 'completed');
  eq('scores stored', done.scores.length, 7);
  // (4+3+4+3+5+4+3) / 7 = 3.71
  eq('average rating', done.avg_rating, '3.71');
  eq('submitted_by', done.submitted_by_email, 'test.manager@aapnainfotech.com');
  done.submitted_at ? ok('submitted_at stamped') : bad('submitted_at missing');
  done.submitted_ip ? ok(`submitted_ip captured (${done.submitted_ip})`) : bad('submitted_ip missing');
  eq('remarks', done.remarks, 'A good first period. Keep it up.');
  console.log(
    '     ' + done.scores.map((s) => `${s.param_label.split(' ')[0]}=${s.rating}`).join('  ')
  );

  // ── 4. Reuse the link — must refuse ─────────────────────────────────────
  h('4. Reuse the same link (must refuse — one submission per token)');
  const reuse = await fetch(`${BASE}/evaluation/${dbCycle1.token}`);
  const reuseHtml = await reuse.text();
  eq('HTTP status', reuse.status, 410);
  reuseHtml.includes('already submitted')
    ? ok('explains it was already submitted')
    : bad('unclear message on reuse');

  // ── 5. Final cycle asks for a decision ──────────────────────────────────
  h('5. Final cycle (3 of 3) must ask for the confirmation decision');
  const cycle3 = await prisma.pea_evaluation_cycles.findFirst({
    where: { employee_id: BigInt(employee.id), seq_no: 3 },
  });
  const finalPage = await (await fetch(`${BASE}/evaluation/${cycle3.token}`)).text();
  finalPage.includes('name="confirmation_status"')
    ? ok('confirmation dropdown present on the final cycle')
    : bad('confirmation dropdown missing on the final cycle');
  finalPage.includes('Extend by 2 months') ? ok('extension options offered') : bad('extension options missing');

  // Submitting the final cycle without a decision must fail.
  const noDecision = new URLSearchParams();
  for (const k of [
    'quality_of_work', 'meeting_deadline', 'communication', 'proactiveness',
    'skill_development', 'cultural_fit', 'x_factor',
  ]) noDecision.append(`rating_${k}`, '3');

  const nd = await fetch(`${BASE}/evaluation/${cycle3.token}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: noDecision,
  });
  eq('final cycle without a decision is rejected', nd.status, 400);

  // ── 6. Extension creates new cycles ─────────────────────────────────────
  h('6. Choose "Extend for 2 months" — must create 2 more cycles');
  noDecision.append('confirmation_status', 'Extend for 2 months');
  noDecision.append('submitted_by', 'test.manager@aapnainfotech.com');
  const ext = await fetch(`${BASE}/evaluation/${cycle3.token}/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: noDecision,
  });
  const extHtml = await ext.text();
  eq('HTTP status', ext.status, 200);
  extHtml.includes('Extend for 2 months') ? ok('decision echoed on the thank-you page') : bad('decision not echoed');

  const after = await prisma.pea_evaluation_cycles.findMany({
    where: { employee_id: BigInt(employee.id) },
    orderBy: { seq_no: 'asc' },
  });
  eq('total cycles now', after.length, 5);
  eq('extension cycles', after.filter((c) => c.is_extension).length, 2);

  const emp = await prisma.pea_employees.findUnique({ where: { id: BigInt(employee.id) } });
  eq('employee confirmation_status', emp.confirmation_status, 'Extend for 2 months');

  const days = (d) => Math.round((new Date(d) - new Date(emp.doj)) / 86_400_000);
  const extras = after.filter((c) => c.is_extension);
  ok(`extension periods end at DOJ +${days(extras[0].period_to)} and +${days(extras[1].period_to)} days (expect 210, 240)`);

  // ── 7. Nothing was emailed ──────────────────────────────────────────────
  h('7. Email safety — shadow mode must have suppressed everything');
  const mails = await prisma.pea_email_log.findMany({
    where: { employee_id: BigInt(employee.id) },
    orderBy: { sent_at: 'asc' },
  });
  ok(`${mails.length} notification(s) logged`);
  const sent = mails.filter((m) => m.status !== 'suppressed');
  sent.length === 0
    ? ok('every notification suppressed — nothing left the system')
    : bad(`${sent.length} notification(s) were NOT suppressed`);
  for (const m of mails) console.log(`     [${m.status}] ${m.email_type} — ${m.subject}`);

  // ── 8. An unknown token must not leak information ───────────────────────
  h('8. Unknown token');
  const unknown = await fetch(`${BASE}/evaluation/11111111-2222-3333-4444-555555555555`);
  eq('HTTP status', unknown.status, 404);

  // Cleanup
  await prisma.pea_employees.deleteMany({ where: { office_email: TEST_EMAIL } });
  console.log(
    process.exitCode ? '\n❌ EVALUATION E2E FAILED\n' : '\n✅ EVALUATION E2E PASSED — test data cleaned up\n'
  );
}

main()
  .catch((e) => {
    console.error('\n💥', e.message, '\n');
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
