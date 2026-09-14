-- ═══════════════════════════════════════════════════════════════════════════
--  PEA — Performance Evaluation Automation: complete schema for PEA's OWN database
--
--  File     : pea-dedicated-database.sql
--  Written  : 13 September 2026            Reviewed by: ____________________
--  Replaces : 2026-09-12-pea-core.sql + 2026-09-12b-pea-joiner-intake.sql +
--             2026-09-13-pea-phase2-features.sql, for any NEW database.
--
--  ── Decision D5 (13 Sep 2026) ─────────────────────────────────────────────
--  PEA and ATS are separate projects with separate databases.
--    · ATS  — the hiring process for candidates.
--    · PEA  — probation tracking after someone joins, however they joined
--             (through ATS, a referral, or directly).
--  PEA reads NO ATS data. Nothing in this file references an ATS table, and
--  the guard in section 0 refuses to run inside an ATS database.
--
--  The three dated files above were written while PEA's tables were placed,
--  temporarily, inside the ATS staging database. They remain as the record of
--  that build. Use THIS file for PEA's own staging and production databases.
--
--  ── Before running ────────────────────────────────────────────────────────
--  1. Someone with CREATEDB creates the database — once per environment.
--     Names below are a PROPOSAL; confirm them with the DBA:
--
--         CREATE DATABASE pea_staging;
--         CREATE DATABASE pea_production;
--
--  2. Optionally, a least-privilege login for the application (recommended):
--
--         CREATE ROLE peauser WITH LOGIN PASSWORD '<generate a strong one>'
--           NOSUPERUSER NOCREATEDB NOCREATEROLE;
--         GRANT CONNECT ON DATABASE pea_staging TO peauser;
--
--     Section 7 grants it rights on PEA's tables. Never commit the password.
--
--  3. Connect pgAdmin to the NEW database, open this file, Ctrl+A, F5.
--
--  Idempotent: every statement is IF NOT EXISTS / ON CONFLICT DO NOTHING, so a
--  partial run is completed by running the file again. No DROP statements.
--
--  ⚠️  Prisma: schema.prisma is hand-written. Once PEA is on its own database,
--      `prisma migrate` can no longer harm ATS — but keep the SQL-first habit:
--      schema changes are a reviewed .sql file, then schema.prisma to match.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 0) Guard — refuse to run inside an ATS database
--
--    Checked by content, not by name: any rpa_ table means this is (or
--    contains) ATS, and PEA must not be created there.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  ats_tables INT;
BEGIN
  SELECT count(*) INTO ats_tables
    FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name LIKE 'rpa\_%';

  IF ats_tables > 0 THEN
    RAISE EXCEPTION
      'REFUSED: database "%" contains % ATS (rpa_) table(s). PEA has its own database '
      '(decision D5). Connect pgAdmin to the dedicated PEA database and run again.',
      current_database(), ats_tables;
  END IF;

  RAISE NOTICE 'Guard passed — creating PEA schema in "%".', current_database();
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) pea_users / pea_sessions — PEA's own sign-in
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_users (
  id              SERIAL       PRIMARY KEY,
  username        VARCHAR(100) NOT NULL,
  email           VARCHAR(255) NOT NULL,
  password_hash   TEXT         NOT NULL,
  first_name      VARCHAR(100),
  last_name       VARCHAR(100),
  role            VARCHAR(50)  NOT NULL DEFAULT 'hr',
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  -- Unused: Microsoft SSO was removed (13 Sep). Kept so schema.prisma matches.
  azure_object_id VARCHAR(100),
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pea_users_role_chk CHECK (role IN ('superadmin', 'admin', 'hr'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_users_username ON pea_users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_users_email    ON pea_users (lower(email));

CREATE TABLE IF NOT EXISTS pea_sessions (
  id         SERIAL      PRIMARY KEY,
  token      TEXT        NOT NULL,
  user_id    INT         REFERENCES pea_users(id) ON DELETE CASCADE,
  role       VARCHAR(50),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_sessions_token   ON pea_sessions (token);
CREATE INDEX        IF NOT EXISTS idx_pea_sessions_user    ON pea_sessions (user_id);
CREATE INDEX        IF NOT EXISTS idx_pea_sessions_expires ON pea_sessions (expires_at);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) pea_employees — the master record. Replaces Excel Sheet1 columns A–H.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_employees (
  id                    BIGSERIAL    PRIMARY KEY,
  full_name             VARCHAR(150) NOT NULL,
  office_email          VARCHAR(255) NOT NULL,
  personal_email        VARCHAR(255),

  is_experienced        BOOLEAN      NOT NULL DEFAULT FALSE,  -- Excel "Experience": Yes = TRUE
  doj                   DATE         NOT NULL,                -- a real DATE: kills the format bug

  rm_name               VARCHAR(150) NOT NULL,
  rm_email              VARCHAR(255) NOT NULL,
  pl_email              VARCHAR(255) NOT NULL,

  halt_process          BOOLEAN      NOT NULL DEFAULT FALSE,  -- Excel "Halt_Process"
  confirmation_status   VARCHAR(50),                          -- NULL = still in probation
  employment_status     VARCHAR(20)  NOT NULL DEFAULT 'active',

  -- How the record entered PEA — not how the person was hired.
  source                VARCHAR(20)  NOT NULL DEFAULT 'manual',

  -- Microsoft Entra link and signals (plan §13).
  azure_user_id         VARCHAR(100),
  license_assigned      BOOLEAN,
  azure_account_enabled BOOLEAN,
  azure_synced_at       TIMESTAMPTZ,
  azure_display_name    VARCHAR(150),   -- Entra's last-seen values, for "differs from Azure"
  azure_mail            VARCHAR(255),
  -- Fields HR has corrected; the Azure sync must never overwrite them (§6.5).
  locked_fields         TEXT[]       NOT NULL DEFAULT '{}',
  -- Leaver suggestion: raised when disabled AND unlicensed; HR confirms (§13.9).
  leaver_flagged_at     TIMESTAMPTZ,
  leaver_dismissed_at   TIMESTAMPTZ,

  created_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  modified_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT pea_employees_confirmation_chk CHECK (
    confirmation_status IS NULL OR confirmation_status IN (
      'Confirmed', 'Not Confirmed', 'Extend for 1 month', 'Extend for 2 months'
    )
  ),
  CONSTRAINT pea_employees_employment_chk CHECK (employment_status IN ('active', 'left')),
  CONSTRAINT pea_employees_source_chk     CHECK (source IN ('manual', 'excel', 'azure'))
);

-- Case-insensitive uniqueness: the master sheet has mixed case and trailing
-- spaces ("Shelly Jain ", "Priyanka Khurana "), so a plain UNIQUE is not enough.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_employees_office_email
  ON pea_employees (lower(trim(office_email)));
CREATE INDEX IF NOT EXISTS idx_pea_employees_personal_email
  ON pea_employees (lower(trim(personal_email)));
CREATE INDEX IF NOT EXISTS idx_pea_employees_sweep
  ON pea_employees (employment_status, halt_process);
CREATE INDEX IF NOT EXISTS idx_pea_employees_azure
  ON pea_employees (azure_user_id);
CREATE INDEX IF NOT EXISTS idx_pea_employees_leaver
  ON pea_employees (leaver_flagged_at) WHERE leaver_flagged_at IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) pea_evaluation_cycles — one row per employee per evaluation (1..8)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_evaluation_cycles (
  id                  BIGSERIAL    PRIMARY KEY,
  employee_id         BIGINT       NOT NULL REFERENCES pea_employees(id) ON DELETE CASCADE,
  seq_no              SMALLINT     NOT NULL,
  is_extension        BOOLEAN      NOT NULL DEFAULT FALSE,

  -- The sweep matches due_date <= CURRENT_DATE, so a missed day self-heals.
  due_date            DATE         NOT NULL,
  period_from         DATE,
  period_to           DATE,

  status              VARCHAR(20)  NOT NULL DEFAULT 'pending',

  token               UUID         NOT NULL DEFAULT gen_random_uuid(),
  token_expires_at    TIMESTAMPTZ,

  sent_at             TIMESTAMPTZ,
  opened_at           TIMESTAMPTZ,
  submitted_at        TIMESTAMPTZ,
  submitted_by_email  VARCHAR(255),
  submitted_ip        VARCHAR(64),

  reminder_count      SMALLINT     NOT NULL DEFAULT 0,
  last_reminded_at    TIMESTAMPTZ,

  avg_rating          NUMERIC(3,2),
  remarks             TEXT,
  confirmation_status VARCHAR(50),  -- captured on the final cycle only

  -- Verbatim pre-migration text for legacy rows deliberately not parsed (R5).
  legacy_raw          TEXT,
  legacy_format       VARCHAR(30),

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  modified_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT pea_evaluation_cycles_seq_chk      CHECK (seq_no BETWEEN 1 AND 8),
  CONSTRAINT pea_evaluation_cycles_status_chk   CHECK (
    status IN ('pending', 'email_sent', 'opened', 'completed', 'skipped')
  ),
  CONSTRAINT pea_evaluation_cycles_reminder_chk CHECK (reminder_count BETWEEN 0 AND 2)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_evaluation_cycles_emp_seq
  ON pea_evaluation_cycles (employee_id, seq_no);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_evaluation_cycles_token
  ON pea_evaluation_cycles (token);
CREATE INDEX IF NOT EXISTS idx_pea_evaluation_cycles_due
  ON pea_evaluation_cycles (due_date, status);
CREATE INDEX IF NOT EXISTS idx_pea_evaluation_cycles_reminder
  ON pea_evaluation_cycles (status, reminder_count, due_date);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) pea_evaluation_scores — per-parameter ratings
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_evaluation_scores (
  id          BIGSERIAL    PRIMARY KEY,
  cycle_id    BIGINT       NOT NULL REFERENCES pea_evaluation_cycles(id) ON DELETE CASCADE,
  param_key   VARCHAR(60)  NOT NULL,
  param_label VARCHAR(150) NOT NULL,   -- snapshot of the question as answered
  rating      NUMERIC(2,1),
  comments    TEXT,
  sort_order  SMALLINT     NOT NULL DEFAULT 0,
  CONSTRAINT pea_evaluation_scores_range_chk CHECK (rating IS NULL OR rating BETWEEN 1 AND 5)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_evaluation_scores_cycle_param
  ON pea_evaluation_scores (cycle_id, param_key);
CREATE INDEX IF NOT EXISTS idx_pea_evaluation_scores_cycle
  ON pea_evaluation_scores (cycle_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5) pea_evaluation_params — the form definition as data
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_evaluation_params (
  id          BIGSERIAL    PRIMARY KEY,
  template    VARCHAR(20)  NOT NULL,
  param_key   VARCHAR(60)  NOT NULL,
  param_label VARCHAR(150) NOT NULL,
  sort_order  SMALLINT     NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT TRUE,
  CONSTRAINT pea_evaluation_params_tmpl_chk CHECK (
    template IN ('fresher', 'experienced', 'legacy_4param')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_evaluation_params_tmpl_key
  ON pea_evaluation_params (template, param_key);


-- ═══════════════════════════════════════════════════════════════════════════
-- 6) pea_email_log, pea_settings, pea_employee_audit, pea_azure_sync_log
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_email_log (
  id              BIGSERIAL    PRIMARY KEY,
  cycle_id        BIGINT       REFERENCES pea_evaluation_cycles(id) ON DELETE SET NULL,
  employee_id     BIGINT       REFERENCES pea_employees(id) ON DELETE SET NULL,
  email_type      VARCHAR(50)  NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  cc_emails       TEXT,
  subject         VARCHAR(500),
  status          VARCHAR(20)  NOT NULL,   -- 'suppressed' = shadow mode, not sent
  error_message   TEXT,
  sent_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pea_email_log_status_chk CHECK (status IN ('sent', 'failed', 'suppressed')),
  CONSTRAINT pea_email_log_type_chk   CHECK (
    email_type IN ('evaluation_link', 'reminder', 'acknowledgement', 'extend_alert',
                   'hr_notification', 'it_report', 'manager_portal', 'deadline_alert',
                   -- account email (accountEmail.service.js)
                   'user_created', 'user_password_changed', 'password_reset_request')
  )
);
CREATE INDEX IF NOT EXISTS idx_pea_email_log_cycle ON pea_email_log (cycle_id);
CREATE INDEX IF NOT EXISTS idx_pea_email_log_sent  ON pea_email_log (sent_at DESC);

CREATE TABLE IF NOT EXISTS pea_settings (
  id            BIGSERIAL    PRIMARY KEY,
  setting_key   VARCHAR(100) NOT NULL,
  setting_value TEXT,
  description   TEXT,
  modified_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_settings_key ON pea_settings (setting_key);

CREATE TABLE IF NOT EXISTS pea_employee_audit (
  id            BIGSERIAL    PRIMARY KEY,
  employee_id   BIGINT       NOT NULL REFERENCES pea_employees(id) ON DELETE CASCADE,
  field_name    VARCHAR(60)  NOT NULL,
  old_value     TEXT,
  new_value     TEXT,
  changed_by    VARCHAR(255),
  change_source VARCHAR(20)  NOT NULL,
  changed_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pea_employee_audit_source_chk CHECK (
    change_source IN ('manual', 'azure', 'excel_import', 'system')
  )
);
CREATE INDEX IF NOT EXISTS idx_pea_employee_audit_employee
  ON pea_employee_audit (employee_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS pea_azure_sync_log (
  id                 BIGSERIAL   PRIMARY KEY,
  run_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  users_fetched      INT,
  users_created      INT,
  users_flagged_left INT,
  status             VARCHAR(20),
  error_message      TEXT,
  mode               VARCHAR(20),   -- scan | dry_run
  candidates_new     INT,
  candidates_updated INT,
  employees_checked  INT,
  duration_ms        INT,
  detail             JSONB
);
CREATE INDEX IF NOT EXISTS idx_pea_azure_sync_log_run ON pea_azure_sync_log (run_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 7) New Joiner Inbox, RM→PL map, notifications, manager portal links
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_joiner_candidates (
  id                  BIGSERIAL    PRIMARY KEY,
  azure_user_id       VARCHAR(100),                 -- Entra objectId
  source              VARCHAR(20)  NOT NULL DEFAULT 'azure',
  display_name        VARCHAR(150),
  office_email        VARCHAR(255),
  account_created_at  TIMESTAMPTZ,
  suggested_doj       DATE,
  doj_source          VARCHAR(20),                  -- account_created
  suggested_rm_name   VARCHAR(150),
  suggested_rm_email  VARCHAR(255),
  rm_source           VARCHAR(20),                  -- entra_manager
  suggested_pl_email  VARCHAR(255),
  pl_source           VARCHAR(20),                  -- rm_map
  status              VARCHAR(20)  NOT NULL DEFAULT 'pending',
  dismissed_reason    TEXT,
  employee_id         BIGINT REFERENCES pea_employees(id) ON DELETE SET NULL,
  reviewed_by         VARCHAR(255),
  reviewed_at         TIMESTAMPTZ,
  raw_graph           JSONB,                        -- what Entra actually said
  first_seen_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pea_joiner_candidates_status_chk CHECK (status IN ('pending', 'accepted', 'dismissed')),
  CONSTRAINT pea_joiner_candidates_source_chk CHECK (source IN ('azure'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_joiner_candidates_azure
  ON pea_joiner_candidates (azure_user_id) WHERE azure_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pea_joiner_candidates_status
  ON pea_joiner_candidates (status, account_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pea_joiner_candidates_email
  ON pea_joiner_candidates (lower(trim(office_email)));

CREATE TABLE IF NOT EXISTS pea_rm_pl_map (
  id           BIGSERIAL    PRIMARY KEY,
  rm_email     VARCHAR(255) NOT NULL,
  pl_email     VARCHAR(255),
  is_ambiguous BOOLEAN      NOT NULL DEFAULT FALSE,
  note         TEXT,
  source       VARCHAR(20)  NOT NULL DEFAULT 'sheet',
  modified_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pea_rm_pl_map_source_chk CHECK (source IN ('sheet', 'manual'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_rm_pl_map_rm ON pea_rm_pl_map (lower(trim(rm_email)));

CREATE TABLE IF NOT EXISTS pea_notifications (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     INT          NOT NULL REFERENCES pea_users(id) ON DELETE CASCADE,
  type        VARCHAR(40)  NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT,
  link        VARCHAR(300),
  severity    VARCHAR(10)  NOT NULL DEFAULT 'info',
  dedupe_key  VARCHAR(200),
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pea_notifications_severity_chk CHECK (severity IN ('info', 'warning', 'critical'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_notifications_dedupe
  ON pea_notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pea_notifications_user
  ON pea_notifications (user_id, read_at, created_at DESC);

-- Admin Portal → Module Access. A missing row means the module is ON; only
-- is_enabled = false restricts. See 2026-09-13b-pea-admin-portal.sql.
CREATE TABLE IF NOT EXISTS pea_module_permissions (
  id          SERIAL       PRIMARY KEY,
  user_id     INT          NOT NULL REFERENCES pea_users(id) ON DELETE CASCADE,
  module_key  VARCHAR(50)  NOT NULL,
  is_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_by  VARCHAR(100),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_pea_module_permissions_user_module UNIQUE (user_id, module_key)
);

CREATE TABLE IF NOT EXISTS pea_manager_links (
  id            BIGSERIAL    PRIMARY KEY,
  token         UUID         NOT NULL DEFAULT gen_random_uuid(),
  rm_email      VARCHAR(255) NOT NULL,
  rm_name       VARCHAR(150),
  created_by    VARCHAR(255),
  expires_at    TIMESTAMPTZ  NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ,
  use_count     INT          NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_manager_links_token ON pea_manager_links (token);
CREATE INDEX IF NOT EXISTS idx_pea_manager_links_rm ON pea_manager_links (lower(trim(rm_email)));


-- ═══════════════════════════════════════════════════════════════════════════
-- 8) Seed — the 7 evaluation parameters per template, plus the legacy scale
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pea_evaluation_params (template, param_key, param_label, sort_order) VALUES
  ('fresher',       'quality_of_work',   'Quality of Code / Work',       1),
  ('fresher',       'meeting_deadline',  'Meeting Deadline',             2),
  ('fresher',       'communication',     'Communication & Presentation', 3),
  ('fresher',       'proactiveness',     'Proactiveness',                4),
  ('fresher',       'skill_development', 'Skill Development',            5),
  ('fresher',       'cultural_fit',      'Cultural Fit',                 6),
  ('fresher',       'x_factor',          'X-Factor',                     7),
  ('experienced',   'quality_of_work',   'Quality of Code / Work',       1),
  ('experienced',   'meeting_deadline',  'Meeting Deadline',             2),
  ('experienced',   'communication',     'Communication & Presentation', 3),
  ('experienced',   'proactiveness',     'Proactiveness',                4),
  ('experienced',   'skill_development', 'Skill Development',            5),
  ('experienced',   'cultural_fit',      'Cultural Fit',                 6),
  ('experienced',   'x_factor',          'X-Factor',                     7),
  ('legacy_4param', 'skill',             'Skill',                        1),
  ('legacy_4param', 'quality_of_work',   'Quality of Work',              2),
  ('legacy_4param', 'timeliness',        'Timeliness of Work',           3),
  ('legacy_4param', 'x_factor',          'X-Factor',                     4)
ON CONFLICT (template, param_key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 9) Seed — settings
--
--    Only settings the application READS (18). The co-located build also
--    seeded 11 that nothing reads (cadence, sender, timezone…); they are
--    deliberately left out here. Safe defaults: shadow mode ON, every new
--    feature OFF.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pea_settings (setting_key, setting_value, description) VALUES
  ('shadow_mode',                          'false','Emergency pause. OFF = PEA sends (staging → test inbox, production → real people).'),
  ('cc_emails',
   'sroy@aapnainfotech.com;rsomani@aapnainfotech.com;sshukla@aapnainfotech.com;smaiti@aapnainfotech.com',
   'CC on evaluation emails, lifted from the Power Automate flow. HR to confirm.'),
  ('hr_notification_emails',               'sshukla@aapnainfotech.com;smaiti@aapnainfotech.com', 'Submission acknowledgements, extension alerts, deadline digest.'),
  ('it_report_emails',                     '',     '"Report to IT" recipients. Blank until IT names a list.'),
  ('token_validity_days',                  '30',   'Evaluation link lifetime.'),
  ('reminder_max_count',                   '2',    'Reminders per evaluation (0–2).'),
  ('reminder_offsets_days',                '2,4',  'Reminder days after sending. Reconstructed from the PPT — HR to confirm.'),
  ('sweep_cron',                           '0 11 * * *', 'Daily sweep, 11:00 IST.'),
  ('confirmation_deadline_months',         '6',    'Months from DOJ by which a decision is due.'),
  ('confirmation_deadline_extended_months','8',    'The same deadline once extended.'),
  ('deadline_alert_email_enabled',         'false','Daily HR digest of overdue confirmations (decision 17).'),
  ('azure_scan_enabled',                   'false','Nightly Entra scan. Leave off until after the shadow-mode cutover.'),
  ('azure_scan_cron',                      '0 9 * * *', 'Entra scan time, 09:00 IST.'),
  ('azure_scan_window_days',               '45',   'Look back this many days for new accounts.'),
  ('azure_email_domain',                   'aapnainfotech.com', 'Only accounts on this domain are joiners.'),
  ('azure_field_sync_enabled',             'false','Let the scan update unlocked names/emails from Entra.'),
  ('manager_link_validity_days',           '30',   'Manager portal link lifetime.'),
  ('employee_self_view',                   'averages', 'off | schedule | averages | full — HR chose averages (13 Sep).')
ON CONFLICT (setting_key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 10) Grants for `peauser` — PEA's own tables only (no-op if the role is absent)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peauser') THEN
    RAISE NOTICE 'Role peauser does not exist — grants skipped. Create it (see header) and re-run.';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO peauser';
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'pea\_%' LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO peauser', t);
  END LOOP;
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO peauser';
  RAISE NOTICE 'Grants applied to peauser on every pea_ table.';
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFICATION — if this grid does not appear, only a selection was run.
--  Click in the editor, Ctrl+A, F5.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT * FROM (
  SELECT 1 AS n, 'database' AS check_name, current_database()::text AS value
  UNION ALL SELECT 2, 'pea_ tables (expect 14)',
         (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'pea\_%')
  UNION ALL SELECT 3, 'ATS rpa_ tables in this database (expect 0)',
         (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'rpa\_%')
  UNION ALL SELECT 4, 'evaluation params (expect 18)',
         (SELECT count(*)::text FROM pea_evaluation_params)
  UNION ALL SELECT 5, 'settings (expect 18)',
         (SELECT count(*)::text FROM pea_settings)
  UNION ALL SELECT 6, 'shadow_mode (expect false)',
         (SELECT setting_value FROM pea_settings WHERE setting_key = 'shadow_mode')
) q ORDER BY n;
