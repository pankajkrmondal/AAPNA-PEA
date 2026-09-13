/**
 * verify-phase2.js — exercise the Phase 2 read paths against a real database.
 *
 *     node scripts/verify-phase2.js
 *
 * READ-ONLY. Calls only functions that SELECT: analytics, deadline breaches,
 * the inbox, the manager list, one employee's detail, notifications, and a
 * DRY-RUN of the deadline alert pass (which returns before writing anything).
 * Sends no email, calls no Microsoft API, writes no row.
 *
 * Run it twice around applying 2026-09-13-pea-phase2-features.sql: before, the
 * features report "not set up" and nothing crashes; after, they report data.
 */
import prisma from '../src/config/database.js';
import { getAnalytics } from '../src/services/analytics.service.js';
import { findDeadlineBreaches, runDeadlineAlerts } from '../src/services/confirmationDeadline.service.js';
import { getInbox } from '../src/services/joinerIntake.service.js';
import { listManagers } from '../src/services/managerPortal.service.js';
import { getEmployee } from '../src/services/employee.service.js';
import { listForUser } from '../src/services/inAppNotification.service.js';
import { hasPhase2Features } from '../src/utils/schemaCapabilities.js';

const results = [];

async function check(name, fn) {
  try {
    const summary = await fn();
    results.push(['✅', name, summary]);
  } catch (err) {
    results.push(['❌', name, err.message.split('\n').slice(-1)[0]]);
    process.exitCode = 1;
  }
}

await check('2026-09-13 DDL applied', async () => ((await hasPhase2Features()) ? 'yes' : 'NO — features degrade until applied'));

await check('analytics', async () => {
  const a = await getAnalytics({ months: 24 });
  return `${a.summary.completed} completed, avg ${a.summary.average_rating ?? '—'}, ` +
    `${a.trend.length} trend month(s), ${a.parameters.length} parameter(s), ${a.managers.length} manager(s)`;
});

await check('confirmation deadlines', async () => {
  const d = await findDeadlineBreaches();
  return `${d.overdue.length} overdue, ${d.dueSoon.length} due soon (rule ${d.rule.months}/${d.rule.extendedMonths} months)`;
});

await check('deadline alerts (dry run)', async () => {
  const r = await runDeadlineAlerts({ dryRun: true });
  return `would consider ${r.overdue} overdue — nothing written`;
});

await check('new joiner inbox', async () => {
  const i = await getInbox();
  return `${i.counts.joiners} joiner(s), ${i.counts.leavers} leaver flag(s), setupRequired=${i.setupRequired}`;
});

await check('manager list', async () => {
  const m = await listManagers();
  return `${m.length} reporting manager(s)`;
});

await check('employee detail with Azure provenance', async () => {
  const first = await prisma.pea_employees.findFirst({ select: { id: true } });
  if (!first) return 'no employees to check';
  const e = await getEmployee(first.id);
  return `azure.linked=${e.azure.linked}, snapshot=${e.azure.snapshotAvailable}, fields=${Object.keys(e.azure.fields).join('/')}`;
});

await check('notifications', async () => {
  const u = await prisma.pea_users.findFirst({ select: { id: true } });
  const n = await listForUser(u.id);
  return n.available ? `${n.items.length} item(s), ${n.unread} unread` : 'table not present yet — bell shows empty';
});

const { listSettings, listTemplates, previewTemplate } = await import('../src/services/settings.service.js');
const { listUsers } = await import('../src/services/users.service.js');
const { currentLevel } = await import('../src/services/selfView.service.js');
const { ssoStatus } = await import('../src/services/sso.service.js');

await check('settings', async () => {
  const s = await listSettings();
  const editable = s.groups.reduce((n, g) => n + g.settings.length, 0);
  return `${editable} editable in ${s.groups.length} group(s), ${s.notInEffect.length} not in effect`;
});

await check('email templates render', async () => {
  const t = await listTemplates();
  for (const tpl of t) previewTemplate(tpl.key, {}); // throws on a broken template
  return `${t.length} template(s), ${t.filter((x) => x.overridden).length} customised — all preview`;
});

await check('users', async () => {
  const u = await listUsers();
  return `${u.length} user(s), ${u.filter((x) => x.role === 'admin' && x.is_active).length} active admin(s)`;
});

await check('employee self-view', async () => `level "${await currentLevel()}"`);

await check('Microsoft sign-in', async () => {
  const s = ssoStatus();
  return s.enabled ? 'enabled' : s.requested ? `requested but missing ${s.missing.join(', ')}` : 'off';
});

console.log('');
for (const [icon, name, summary] of results) console.log(`  ${icon} ${name.padEnd(40)} ${summary}`);
console.log('');

await prisma.$disconnect();
