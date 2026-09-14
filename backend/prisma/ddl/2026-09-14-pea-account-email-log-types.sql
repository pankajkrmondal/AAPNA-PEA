-- ═══════════════════════════════════════════════════════════════════════════
--  PEA — allow account emails in pea_email_log (defect PEA-D-004)
--
--  ⚠️ INTERIM (decision D5, 13 Sep 2026). For PEA's own database later, use
--     pea-dedicated-database.sql, which already contains this.
--
--  File     : 2026-09-14-pea-account-email-log-types.sql
--  Author   : (dev)                          Reviewed by: ____________________
--  Run as   : appuser        (no superuser required)
--  Requires : 2026-09-12-pea-core.sql, 2026-09-13-pea-phase2-features.sql
--
--  ✅ STATUS: APPLIED to recruitmentautomationdb on 14 Sep 2026 (verification
--     returned 1 / 1). Before it, account emails (login details, password
--     reset) were sent but their pea_email_log row was refused.
--
--  Idempotent. Contains NO DROP TABLE and NO DROP COLUMN. No row is touched.
--
--  ⚠️  ONE constraint is replaced: pea_email_log_type_chk gains three values
--      used by accountEmail.service.js — user_created, user_password_changed,
--      password_reset_request. Every existing value remains valid.
--
--  ┌─────────────────────────────────────────────────────────────────────────┐
--  │  ⚠️  DATABASE NAME — CHECK BEFORE RUNNING                                │
--  │      recruitmentautomationdb      ← ✅ staging                           │
--  │      recruitmentAutomationDb      ← ❌ different database!               │
--  │      recruitmentautomationdbProd  ← production, at cutover only          │
--  └─────────────────────────────────────────────────────────────────────────┘
--
--  ⚠️  NEVER RUN `prisma migrate`, `db push` OR `db pull` IN THIS PROJECT.
-- ═══════════════════════════════════════════════════════════════════════════


-- 0) Guard
DO $$
BEGIN
  IF current_database() NOT IN ('recruitmentautomationdb', 'recruitmentautomationdbProd') THEN
    RAISE EXCEPTION
      'WRONG DATABASE: connected to "%". Expected recruitmentautomationdb '
      '(staging) or recruitmentautomationdbProd (production).', current_database();
  END IF;

  IF to_regclass('public.pea_email_log') IS NULL THEN
    RAISE EXCEPTION 'pea_email_log does not exist. Apply 2026-09-12-pea-core.sql first.';
  END IF;
END $$;


-- 1) Widen the email_type CHECK — drop and re-add in one transaction, so there
--    is never a moment without it.
BEGIN;

ALTER TABLE pea_email_log DROP CONSTRAINT IF EXISTS pea_email_log_type_chk;
ALTER TABLE pea_email_log ADD CONSTRAINT pea_email_log_type_chk CHECK (
  email_type IN ('evaluation_link', 'reminder', 'acknowledgement',
                 'extend_alert', 'hr_notification',
                 'it_report', 'manager_portal', 'deadline_alert',
                 'user_created', 'user_password_changed', 'password_reset_request')
);

COMMIT;


-- 2) Verification
SELECT 'email_type allows password_reset_request (expect 1)' AS object,
       (SELECT count(*) FROM pg_constraint
         WHERE conname = 'pea_email_log_type_chk'
           AND pg_get_constraintdef(oid) LIKE '%password_reset_request%') AS ok
UNION ALL
SELECT 'email_type allows it_report (expect 1)',
       (SELECT count(*) FROM pg_constraint
         WHERE conname = 'pea_email_log_type_chk'
           AND pg_get_constraintdef(oid) LIKE '%it_report%');
