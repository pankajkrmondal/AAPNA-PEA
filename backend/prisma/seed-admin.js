/**
 * seed-admin.js — create (or reset) the first PEA admin account.
 *
 * Run:  npm run seed:admin
 *
 * Idempotent: if the user already exists, the password is reset rather than a
 * duplicate created. Safe to re-run if someone forgets the password.
 *
 * PEA_ADMIN_PASSWORD is REQUIRED — there is no default. A default password
 * written in the repository becomes the admin password of every fresh database
 * someone forgets to set it on. Optional: PEA_ADMIN_USERNAME, PEA_ADMIN_EMAIL.
 *
 *   PEA_ADMIN_PASSWORD='<at least 10 characters>' npm run seed:admin
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const USERNAME = (process.env.PEA_ADMIN_USERNAME || 'pankaj').trim().toLowerCase();
const EMAIL = (process.env.PEA_ADMIN_EMAIL || 'n8npankajmondal@gmail.com').trim().toLowerCase();
const PASSWORD = process.env.PEA_ADMIN_PASSWORD || '';

async function main() {
  if (PASSWORD.length < 10) {
    console.error(
      '💥 Set PEA_ADMIN_PASSWORD to at least 10 characters. There is deliberately no default.\n' +
        "   PowerShell:  $env:PEA_ADMIN_PASSWORD='<password>'; npm run seed:admin\n" +
        "   bash:        PEA_ADMIN_PASSWORD='<password>' npm run seed:admin"
    );
    process.exitCode = 1;
    return;
  }

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

  // The password is not echoed: terminal scrollback and CI logs outlive the
  // moment someone needed to see it.
  console.log('\n   Sign in with');
  console.log(`     username : ${USERNAME}`);
  console.log(`     email    : ${EMAIL}`);
  console.log('     password : the value of PEA_ADMIN_PASSWORD\n');
}

main()
  .catch((e) => {
    console.error('💥', e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
