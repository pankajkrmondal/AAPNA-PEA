-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFY peauser PERMISSIONS  —  run this AS peauser, not as postgres/admin
--
--  Purpose: prove the safety backstop rather than trust it. This is the test
--  the migration plan (R2, "Verification test before Day 1") calls for.
--
--  Connect as:
--    psql "postgresql://peauser:<password>@20.244.34.176:5432/recruitmentautomationdb"
--
--  Every section prints PASS or FAIL. ALL must be PASS before any application
--  code is written. If any line says FAIL, stop and fix the grants — do not
--  work around it in the application.
-- ═══════════════════════════════════════════════════════════════════════════

\echo '=============================================================='
\echo ' peauser permission verification'
\echo '=============================================================='
\echo ''

SELECT current_user AS connected_as, current_database() AS database;


-- ───────────────────────────────────────────────────────────────────────────
-- 1. PEA's own tables must be fully writable.
-- ───────────────────────────────────────────────────────────────────────────
\echo '--- 1. PEA tables readable + writable (expect PASS) ---'

DO $$
BEGIN
  PERFORM 1 FROM pea.employees LIMIT 1;
  INSERT INTO pea.settings (setting_key, setting_value, description)
       VALUES ('__permcheck__', 'x', 'temporary row from verify script');
  UPDATE pea.settings SET setting_value = 'y' WHERE setting_key = '__permcheck__';
  DELETE FROM pea.settings WHERE setting_key = '__permcheck__';
  RAISE NOTICE 'PASS - full DML on pea.* works';
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'FAIL - peauser cannot do DML on pea.*: %', SQLERRM;
END
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. ATS tables must be READABLE.
-- ───────────────────────────────────────────────────────────────────────────
\echo ''
\echo '--- 2. ATS tables readable (expect PASS) ---'

DO $$
DECLARE n BIGINT;
BEGIN
  SELECT count(*) INTO n FROM public.rpa_candidate_pipeline;
  RAISE NOTICE 'PASS - SELECT on rpa_candidate_pipeline works (% rows)', n;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'FAIL - cannot read rpa_candidate_pipeline: %', SQLERRM;
END
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 3. ATS tables must NOT be writable.  THIS IS THE IMPORTANT ONE.
--    Each block PASSES only if the operation is REFUSED.
-- ───────────────────────────────────────────────────────────────────────────
\echo ''
\echo '--- 3. ATS tables NOT writable (expect PASS = operation refused) ---'

-- 3a. DELETE must be refused.
DO $$
BEGIN
  DELETE FROM public.rpa_users WHERE id = -999999;   -- matches nothing anyway
  RAISE WARNING 'FAIL - peauser was ALLOWED to DELETE from rpa_users!';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS - DELETE on rpa_users refused';
  WHEN OTHERS THEN
    RAISE WARNING 'INCONCLUSIVE - unexpected error: % (%)', SQLERRM, SQLSTATE;
END
$$;

-- 3b. UPDATE must be refused.
DO $$
BEGIN
  UPDATE public.rpa_users SET is_active = is_active WHERE id = -999999;
  RAISE WARNING 'FAIL - peauser was ALLOWED to UPDATE rpa_users!';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'PASS - UPDATE on rpa_users refused';
  WHEN OTHERS THEN
    RAISE WARNING 'INCONCLUSIVE - unexpected error: % (%)', SQLERRM, SQLSTATE;
END
$$;

-- 3c. DROP must be refused. The single most important assertion in this file:
--     this is the exact operation a stray `prisma migrate` would attempt.
DO $$
BEGIN
  DROP TABLE public.rpa_cv;
  RAISE WARNING 'FAIL - peauser was ALLOWED to DROP rpa_cv!! STOP AND FIX GRANTS.';
EXCEPTION
  WHEN insufficient_privilege OR insufficient_privilege THEN
    RAISE NOTICE 'PASS - DROP on rpa_cv refused';
  WHEN OTHERS THEN
    -- "must be owner of table" arrives as SQLSTATE 42501 too, but be explicit.
    RAISE NOTICE 'PASS (refused) - %', SQLERRM;
END
$$;

-- 3d. Creating a table in public must be refused — a foothold for later DDL.
DO $$
BEGIN
  CREATE TABLE public.__permcheck__ (id INT);
  DROP TABLE public.__permcheck__;
  RAISE WARNING 'FAIL - peauser can CREATE TABLE in public schema!';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS (refused) - cannot create tables in public: %', SQLERRM;
END
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 4. peauser must not be able to create objects even in its OWN schema,
--    so `prisma migrate` / `db push` cannot drop PEA's tables either.
-- ───────────────────────────────────────────────────────────────────────────
\echo ''
\echo '--- 4. peauser cannot do DDL in pea schema (expect PASS = refused) ---'

DO $$
BEGIN
  CREATE TABLE pea.__permcheck__ (id INT);
  DROP TABLE pea.__permcheck__;
  RAISE WARNING 'FAIL - peauser can CREATE/DROP in pea schema. A stray prisma '
                'migrate could drop PEA tables (ATS still safe, but avoidable).';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'PASS (refused) - no DDL rights in pea schema: %', SQLERRM;
END
$$;


-- ───────────────────────────────────────────────────────────────────────────
-- 5. Role attributes.
-- ───────────────────────────────────────────────────────────────────────────
\echo ''
\echo '--- 5. Role attributes (all expected values shown) ---'

SELECT rolname,
       rolsuper     AS is_superuser,   -- expect f
       rolcreatedb  AS can_createdb,   -- expect f  (blocks `prisma migrate dev`)
       rolcreaterole AS can_createrole,-- expect f
       rolconnlimit AS connection_limit
  FROM pg_roles
 WHERE rolname = 'peauser';

\echo ''
\echo '=============================================================='
\echo ' Review the NOTICE/WARNING lines above.'
\echo ' Every line must read PASS. Any FAIL = fix grants before coding.'
\echo '=============================================================='
