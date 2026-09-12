/**
 * seed-admin.js — create (or reset) the first PEA admin account.
 *
 * Run:  npm run seed:admin
 *
 * Idempotent: if the user already exists, the password is reset rather than a
 * duplicate created. Safe to re-run if someone forgets the password.
 *
 * Override the defaults with env vars:
 *   PEA_ADMIN_USERNAME · PEA_ADMIN_EMAIL · PEA_ADMIN_PASSWORD
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const USERNAME = (process.env.PEA_ADMIN_USERNAME || 'pankaj').trim().toLowerCase();
const EMAIL = (process.env.PEA_ADMIN_EMAIL || 'n8npankajmondal@gmail.com').trim().toLowerCase();
const PASSWORD = process.env.PEA_ADMIN_PASSWORD || 'PeaAdmin@2026';

async function main() {
  const password_hash = await bcrypt.hash(PASSWORD, 10);

  const existing = await prisma.pea_users.findFirst({
    where: {
      OR: [
        { username: { equals: USERNAME, mode: 'insensitive' } },
        { email: { equals: EMAIL, mode: 'insensitive' } },
      ],
    },
  });

  if (existing) {
    await prisma.pea_users.update({
      where: { id: existing.id },
      data: { password_hash, role: 'admin', is_active: true, modified_at: new Date() },
    });
    console.log(`↻ Existing user "${existing.username}" updated — password reset, role set to admin.`);
  } else {
    const user = await prisma.pea_users.create({
      data: {
        username: USERNAME,
        email: EMAIL,
        password_hash,
        first_name: 'Pankaj',
        role: 'admin',
        is_active: true,
      },
    });
    console.log(`✅ Admin created: ${user.username} <${user.email}> (id ${user.id})`);
  }

  console.log('\n   Sign in with');
  console.log(`     username : ${USERNAME}`);
  console.log(`     email    : ${EMAIL}`);
  console.log(`     password : ${PASSWORD}`);
  console.log('\n   ⚠️  Change this password before the app is reachable from staging.');
  console.log('      Re-run with PEA_ADMIN_PASSWORD=<new> to reset it.\n');
}

main()
  .catch((e) => {
    console.error('💥', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
