-- ═══════════════════════════════════════════════════════════════════════════
--  PEA — Admin Portal: Super Admin > Admin > HR, and per-user Module Access
--
--  ⚠️ INTERIM (decision D5, 13 Sep 2026). Applied to recruitmentautomationdb, where
--     PEA runs for now. For PEA's own database later, use
--     pea-dedicated-database.sql, which already contains all of this.
--
--  File     : 2026-09-13b-pea-admin-portal.sql
--  Author   : (dev)                          Reviewed by: ____________________
--  Run as   : appuser        (no superuser required)
--  Requires : 2026-09-12-pea-core.sql
--
--  ⏳ STATUS: NOT YET APPLIED. Until it is, the app keeps working: no module is
--     restricted and the Module Access switches are read-only.
--
--  Idempotent. Contains NO DROP TABLE and NO DROP COLUMN.
--
--  ⚠️  Rows ARE changed (section 1), inside one transaction:
--      · every `viewer` account becomes `hr` — the viewer role is retired;
--      · if no active super admin exists, the EARLIEST-CREATED ACTIVE ADMIN is
--        promoted to `superadmin`, so the portal always has one.
--  ⚠️  ONE constraint is replaced: pea_users_role_chk.
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


-- ═══════════════════════════════════════════════════════════════════════════
-- 0) Guard
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF current_database() NOT IN ('recruitmentautomationdb', 'recruitmentautomationdbProd') THEN
    RAISE EXCEPTION
      'WRONG DATABASE: connected to "%". Expected recruitmentautomationdb '
      '(staging) or recruitmentautomationdbProd (production).', current_database();
  END IF;

  IF to_regclass('public.pea_users') IS NULL THEN
    RAISE EXCEPTION 'pea_users does not exist. Apply 2026-09-12-pea-core.sql first.';
  END IF;
END $$;


BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Roles — superadmin > admin > hr
--
--    Order matters: viewers are moved BEFORE the new CHECK (which no longer
--    allows them), and the promotion runs AFTER it (the old CHECK does not
--    allow superadmin).
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE pea_users SET role = 'hr', modified_at = now() WHERE role = 'viewer';

ALTER TABLE pea_users DROP CONSTRAINT IF EXISTS pea_users_role_chk;
ALTER TABLE pea_users ADD CONSTRAINT pea_users_role_chk
  CHECK (role IN ('superadmin', 'admin', 'hr'));

UPDATE pea_users
   SET role = 'superadmin', modified_at = now()
 WHERE id = (SELECT id FROM pea_users
              WHERE role = 'admin' AND is_active
              ORDER BY created_at, id
              LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM pea_users WHERE role = 'superadmin' AND is_active);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) pea_module_permissions — Module Access in the Admin Portal
--
--    One row per user per sidebar module. A MISSING row means the module is
--    ON; only is_enabled = false restricts (modulePermissions.service.js
--    explains why this differs from ATS). Keys are validated in code
--    (config/modules.js) rather than by a CHECK, so adding a module needs no
--    DDL. Admins and super admins ignore this table entirely.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_module_permissions (
  id          SERIAL       PRIMARY KEY,
  user_id     INT          NOT NULL REFERENCES pea_users(id) ON DELETE CASCADE,
  module_key  VARCHAR(50)  NOT NULL,
  is_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_by  VARCHAR(100),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT uq_pea_module_permissions_user_module UNIQUE (user_id, module_key)
);

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) Grants for a restricted `peauser` (no-op if the role does not exist)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peauser') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON pea_module_permissions TO peauser;
    GRANT USAGE, SELECT ON SEQUENCE pea_module_permissions_id_seq  TO peauser;
    RAISE NOTICE 'Grants applied to peauser.';
  ELSE
    RAISE NOTICE 'Role peauser does not exist — grants skipped.';
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) Verification
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'pea_module_permissions (expect 1)' AS object,
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'pea_module_permissions') AS ok
UNION ALL
SELECT 'role CHECK allows superadmin (expect 1)',
       (SELECT count(*) FROM pg_constraint
         WHERE conname = 'pea_users_role_chk'
           AND pg_get_constraintdef(oid) LIKE '%superadmin%')
UNION ALL
SELECT 'viewer accounts left (expect 0)',
       (SELECT count(*) FROM pea_users WHERE role = 'viewer')
UNION ALL
SELECT 'active super admins (expect at least 1)',
       (SELECT count(*) FROM pea_users WHERE role = 'superadmin' AND is_active)
UNION ALL
SELECT 'ATS rpa_ tables still intact (expect 48)',
       (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name LIKE 'rpa\_%');
