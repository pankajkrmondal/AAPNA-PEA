-- ═══════════════════════════════════════════════════════════════════════════
--  PEA — remove the 15 pea_ tables from the ATS staging database
--
--  File     : 2026-09-15-drop-pea-tables-from-recruitmentautomationdb.sql
--  Author   : (dev)                          Reviewed by: ____________________
--  Run as   : appuser, in pgAdmin, connected to recruitmentautomationdb
--
--  Why: since 15 Sep 2026 PEA runs on its own database peaStagingDB (login
--  peauser). Every pea_ row was copied there and verified (row counts equal).
--  Nothing reads the pea_ tables in recruitmentautomationdb any more.
--
--  🚨 THIS DELETES DATA PERMANENTLY. Before running:
--    1. Confirm PEA is working on peaStagingDB (sign in, open Dashboard).
--    2. Take a backup of the PEA tables in recruitmentautomationdb:
--       pgAdmin → right-click recruitmentautomationdb → Backup… →
--       Format: Custom → Objects: select only the 15 pea_ tables → Backup.
--    3. Recommended: wait until UAT sign-off, so the old copy stays as a fallback.
--
--  What it touches: ONLY the 15 pea_ tables (and the id sequences they own).
--  ATS rpa_ tables are not touched. No CASCADE: if anything outside PEA
--  depended on a pea_ table, DROP would fail instead of removing it silently.
--
--  ┌─────────────────────────────────────────────────────────────────────────┐
--  │  ⚠️  DATABASE NAME — CHECK THE pgAdmin TAB BEFORE RUNNING               │
--  │      recruitmentautomationdb      ← ✅ run here                          │
--  │      peaStagingDB                 ← ❌ NEVER — that is PEA's live data   │
--  │      recruitmentautomationdbProd  ← ❌ not this file                     │
--  └─────────────────────────────────────────────────────────────────────────┘
--
--  Click in the editor, Ctrl+A, F5 — run the WHOLE file. It is all-or-nothing:
--  if any check or DROP fails, nothing is dropped.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 0) Guards
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  fk_from_outside   INT;
  views_on_pea      INT;
BEGIN
  IF current_database() <> 'recruitmentautomationdb' THEN
    RAISE EXCEPTION
      'REFUSED: connected to "%". This file only runs in recruitmentautomationdb. '
      'PEA''s live database is peaStagingDB — never drop tables there.', current_database();
  END IF;

  -- A foreign key from a non-PEA table pointing at a pea_ table.
  SELECT count(*) INTO fk_from_outside
    FROM pg_constraint c
    JOIN pg_class child  ON child.oid  = c.conrelid
    JOIN pg_class parent ON parent.oid = c.confrelid
   WHERE c.contype = 'f'
     AND parent.relname LIKE 'pea\_%'
     AND child.relname NOT LIKE 'pea\_%';

  -- A view (outside PEA) built on a pea_ table.
  SELECT count(DISTINCT v.oid) INTO views_on_pea
    FROM pg_depend d
    JOIN pg_rewrite r ON r.oid = d.objid
    JOIN pg_class v   ON v.oid = r.ev_class
    JOIN pg_class t   ON t.oid = d.refobjid
   WHERE t.relname LIKE 'pea\_%'
     AND v.relname NOT LIKE 'pea\_%';

  IF fk_from_outside > 0 OR views_on_pea > 0 THEN
    RAISE EXCEPTION
      'REFUSED: % foreign key(s) and % view(s) outside PEA depend on pea_ tables. Nothing dropped.',
      fk_from_outside, views_on_pea;
  END IF;

  RAISE NOTICE 'Guards passed in "%": no ATS object depends on a pea_ table.', current_database();
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) Drop the 15 PEA tables — children before parents, one transaction
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

DROP TABLE IF EXISTS public.pea_evaluation_scores;
DROP TABLE IF EXISTS public.pea_email_log;
DROP TABLE IF EXISTS public.pea_employee_audit;
DROP TABLE IF EXISTS public.pea_joiner_candidates;
DROP TABLE IF EXISTS public.pea_evaluation_cycles;
DROP TABLE IF EXISTS public.pea_employees;
DROP TABLE IF EXISTS public.pea_sessions;
DROP TABLE IF EXISTS public.pea_notifications;
DROP TABLE IF EXISTS public.pea_module_permissions;
DROP TABLE IF EXISTS public.pea_users;
DROP TABLE IF EXISTS public.pea_evaluation_params;
DROP TABLE IF EXISTS public.pea_settings;
DROP TABLE IF EXISTS public.pea_azure_sync_log;
DROP TABLE IF EXISTS public.pea_rm_pl_map;
DROP TABLE IF EXISTS public.pea_manager_links;

COMMIT;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) Verification — if this grid does not appear, only a selection was run
-- ═══════════════════════════════════════════════════════════════════════════
SELECT * FROM (
  SELECT 1 AS n, 'database' AS check_name, current_database()::text AS value
  UNION ALL SELECT 2, 'pea_ tables left (expect 0)',
         (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'pea\_%')
  UNION ALL SELECT 3, 'pea_ sequences left (expect 0)',
         (SELECT count(*)::text FROM pg_class WHERE relkind = 'S' AND relname LIKE 'pea\_%')
  UNION ALL SELECT 4, 'ATS rpa_ tables (unchanged — expect 48)',
         (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'rpa\_%')
) q ORDER BY n;
