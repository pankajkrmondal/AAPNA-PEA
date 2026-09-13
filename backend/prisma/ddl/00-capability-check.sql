-- ═══════════════════════════════════════════════════════════════════════════
--  PEA — capability check
--
--  ⚠️ OBSOLETE (decision D5, 13 Sep 2026): checked the temporary setup where
--     PEA sat inside the ATS database. PEA now has its own database — see
--     pea-dedicated-database.sql.
--
--  READ-ONLY. Creates nothing. Changes nothing. Drops nothing.
--  Safe to run any time, including working hours.
--
--  HOW TO RUN
--    1. Open pgAdmin
--    2. Connect:  Host 20.244.34.176 · Port 5432
--                 Database recruitmentautomationdb · User appuser
--    3. Right-click the database → Query Tool
--    4. Paste EVERYTHING below this comment block
--    5. Press F5 (or the ▶ Execute button)
--    6. Screenshot the result grid — it returns ONE grid with 16 rows
-- ═══════════════════════════════════════════════════════════════════════════

SELECT * FROM (
  SELECT  1 AS n, 'connected_as'            AS check_name, current_user::text                                        AS value
  UNION ALL SELECT  2, 'database',            current_database()::text
  UNION ALL SELECT  3, 'is_superuser',        (SELECT rolsuper::text      FROM pg_roles WHERE rolname = current_user)
  UNION ALL SELECT  4, '>> CAN_CREATE_ROLES', (SELECT rolcreaterole::text FROM pg_roles WHERE rolname = current_user)
  UNION ALL SELECT  5, 'can_create_db',       (SELECT rolcreatedb::text   FROM pg_roles WHERE rolname = current_user)

  UNION ALL SELECT  6, '>> CAN_CREATE_SCHEMA',
                       has_database_privilege(current_user, current_database(), 'CREATE')::text
  UNION ALL SELECT  7, 'can_create_in_public',
                       has_schema_privilege(current_user, 'public', 'CREATE')::text

  UNION ALL SELECT  8, 'max_connections',            current_setting('max_connections')
  UNION ALL SELECT  9, 'reserved_for_superuser',     current_setting('superuser_reserved_connections')
  UNION ALL SELECT 10, 'client_connections_now',
                       (SELECT count(*)::text FROM pg_stat_activity WHERE datname IS NOT NULL)

  UNION ALL SELECT 11, 'owner_of_rpa_tables',
                       (SELECT tableowner FROM pg_tables
                         WHERE schemaname = 'public' AND tablename LIKE 'rpa_%'
                         GROUP BY tableowner ORDER BY count(*) DESC LIMIT 1)
  UNION ALL SELECT 12, 'rpa_table_count',
                       (SELECT count(*)::text FROM pg_tables
                         WHERE schemaname = 'public' AND tablename LIKE 'rpa_%')
  UNION ALL SELECT 13, '>> I_OWN_ALL_RPA_TABLES',
                       (SELECT bool_and(tableowner = current_user)::text FROM pg_tables
                         WHERE schemaname = 'public' AND tablename LIKE 'rpa_%')

  UNION ALL SELECT 14, 'pea_schema_exists',
                       (SELECT count(*)::text FROM information_schema.schemata WHERE schema_name = 'pea')
  UNION ALL SELECT 15, 'peauser_role_exists',
                       (SELECT count(*)::text FROM pg_roles WHERE rolname = 'peauser')
  UNION ALL SELECT 16, 'stray_pea_tables_in_public',
                       (SELECT count(*)::text FROM pg_tables
                         WHERE schemaname = 'public' AND tablename LIKE 'pea_%')
) q
ORDER BY n;

-- ═══════════════════════════════════════════════════════════════════════════
--  The three rows marked ">>" are the ones that decide the build path.
--  Send the whole grid back — the other rows answer open questions too
--  (max_connections, table ownership, leftovers from any earlier attempt).
-- ═══════════════════════════════════════════════════════════════════════════
