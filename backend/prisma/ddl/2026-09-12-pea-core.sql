-- ═══════════════════════════════════════════════════════════════════════════
--  PEA — Performance Evaluation Automation: core tables
--
--  File     : 2026-09-12-pea-core.sql
--  Author   : (dev)                          Reviewed by: ____________________
--  Run as   : appuser        (no superuser required — verified 2026-09-12)
--  Server   : 20.244.34.176:5432 · PostgreSQL 18.1 (Ubuntu) · max_connections 100
--
--  Creates 10 tables in the `public` schema, prefixed `pea_`, following the
--  same convention as the ATS `rpa_` tables they sit alongside.
--
--  Idempotent, additive, non-destructive — safe to run multiple times.
--  Contains NO DROP statements. Search the file — there are none.
--
--  ┌─────────────────────────────────────────────────────────────────────────┐
--  │  ⚠️  DATABASE NAME — CHECK BEFORE RUNNING                                │
--  │                                                                         │
--  │  This server has six databases, two differing only by capitalisation:   │
--  │                                                                         │
--  │      recruitmentautomationdb      ← ✅ RUN HERE (staging)                │
--  │      recruitmentAutomationDb      ← ❌ different database!               │
--  │      recruitmentautomationdbProd  ← production, Day 5 only               │
--  │                                                                         │
--  │  The pgAdmin tab must read:  recruitmentautomationdb/appuser@RPA        │
--  │  Section 0 below aborts the script if it is anything else.              │
--  └─────────────────────────────────────────────────────────────────────────┘
--
--  ┌─────────────────────────────────────────────────────────────────────────┐
--  │  ⚠️  NEVER RUN `prisma migrate` OR `prisma db push` IN THIS PROJECT      │
--  │                                                                         │
--  │  PEA's tables share the `public` schema with 48 ATS `rpa_` tables, and   │
--  │  the app connects as appuser, which OWNS them. Prisma treats its schema  │
--  │  file as the truth for the whole schema, so any table not in that file   │
--  │  reads as drift — and it will generate DROP TABLE for all 48. They would │
--  │  succeed.                                                               │
--  │                                                                         │
--  │  Controls (see prisma/ddl/README):                                      │
--  │    1. package.json has NO migrate/push script — only pull + generate.   │
--  │    2. prisma/schema.prisma is HAND-WRITTEN with pea_ models only.        │
--  │       `prisma db pull` has no table filter and would import all 48 ATS   │
--  │       models; do not run it against this database.                       │
--  │    3. pg_dump before every DDL run.                                      │
--  │    4. Ask for a restricted `peauser` — see section 5. That is the only   │
--  │       control that would refuse the DROP at the database level.          │
--  └─────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
--  NOTE — no explicit BEGIN/COMMIT.
--
--  Every statement here is idempotent (CREATE TABLE IF NOT EXISTS,
--  CREATE INDEX IF NOT EXISTS, INSERT ... ON CONFLICT DO NOTHING) and nothing
--  is destructive, so each statement auto-commits on its own and a partial run
--  is simply completed by running the file again.
--
--  An explicit transaction was tried and removed: running part of the file
--  left an OPEN transaction, so the new tables existed only inside that one
--  pgAdmin session and never appeared in the Object Explorer. Auto-commit
--  avoids that failure mode entirely.
--
--  The section 0 guard below still protects against the wrong database:
--  pgAdmin stops executing a script at the first error, and the guard raises.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 0) Guard — refuse to run against the wrong database
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF current_database() NOT IN ('recruitmentautomationdb', 'recruitmentautomationdbProd') THEN
    RAISE EXCEPTION
      'WRONG DATABASE: connected to "%". Expected recruitmentautomationdb '
      '(staging) or recruitmentautomationdbProd (production). Note that '
      'recruitmentAutomationDb is a DIFFERENT database — check the pgAdmin tab.',
      current_database();
  END IF;
  RAISE NOTICE 'Database check passed: %', current_database();
END
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) pea_users / pea_sessions — PEA's own authentication
--
--    Deliberately NOT rpa_users: ATS login WRITES to rpa_sessions and
--    rpa_users, and an ATS logout deletes all of a user's sessions, which
--    would silently log them out of PEA too. See plan §5.4.
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
  -- Nullable now so Microsoft SSO (Phase 2) needs no migration later.
  azure_object_id VARCHAR(100),
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  modified_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pea_users_role_chk CHECK (role IN ('admin', 'hr', 'viewer'))
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
  id                  BIGSERIAL    PRIMARY KEY,
  full_name           VARCHAR(150) NOT NULL,
  office_email        VARCHAR(255) NOT NULL,
  -- Personal (CV) email. ATS stores ONLY this kind — it has no office-email
  -- column anywhere — so this is what makes an ATS link possible. Plan R4.
  personal_email      VARCHAR(255),

  is_experienced      BOOLEAN      NOT NULL DEFAULT FALSE,  -- Excel "Experience": Yes = TRUE
  doj                 DATE         NOT NULL,                -- real DATE: kills the format bug

  rm_name             VARCHAR(150) NOT NULL,
  rm_email            VARCHAR(255) NOT NULL,
  pl_email            VARCHAR(255) NOT NULL,

  halt_process        BOOLEAN      NOT NULL DEFAULT FALSE,  -- Excel "Halt_Process"
  confirmation_status VARCHAR(50),                          -- NULL = still in probation
  employment_status   VARCHAR(20)  NOT NULL DEFAULT 'active',

  source              VARCHAR(20)  NOT NULL DEFAULT 'manual',
  -- Soft link to rpa_candidate_pipeline.id. Deliberately NO foreign key: a FK
  -- into an ATS table would couple the two systems' lifecycles — ATS could not
  -- restructure that table without breaking PEA, and an ATS restore could fail
  -- on PEA's constraint. Integrity here is the application's job, by choice.
  ats_pipeline_id     BIGINT,
  azure_user_id       VARCHAR(100),
  license_assigned    BOOLEAN,
  -- Fields HR has explicitly corrected; the Azure sync must never overwrite
  -- these. See plan §6.5 ("what if the AD data is wrong?").
  locked_fields       TEXT[]       NOT NULL DEFAULT '{}',

  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  modified_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT pea_employees_confirmation_chk CHECK (
    confirmation_status IS NULL OR confirmation_status IN (
      'Confirmed', 'Not Confirmed', 'Extend for 1 month', 'Extend for 2 months'
    )
  ),
  CONSTRAINT pea_employees_employment_chk CHECK (employment_status IN ('active', 'left')),
  CONSTRAINT pea_employees_source_chk     CHECK (source IN ('manual', 'excel', 'ats', 'azure'))
);

-- Case-insensitive uniqueness: the master sheet contains names and addresses
-- with mixed case and trailing spaces ("Shelly Jain ", "Priyanka Khurana "),
-- so a plain UNIQUE would let duplicates through.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_employees_office_email
  ON pea_employees (lower(trim(office_email)));
CREATE INDEX IF NOT EXISTS idx_pea_employees_personal_email
  ON pea_employees (lower(trim(personal_email)));
CREATE INDEX IF NOT EXISTS idx_pea_employees_sweep
  ON pea_employees (employment_status, halt_process);
CREATE INDEX IF NOT EXISTS idx_pea_employees_ats
  ON pea_employees (ats_pipeline_id);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) pea_evaluation_cycles — one row per employee per evaluation (1..8).
--    Replaces the "Evaluation N" / "EN Status" column pairs in Excel Sheet1.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_evaluation_cycles (
  id                  BIGSERIAL    PRIMARY KEY,
  employee_id         BIGINT       NOT NULL REFERENCES pea_employees(id) ON DELETE CASCADE,
  seq_no              SMALLINT     NOT NULL,
  is_extension        BOOLEAN      NOT NULL DEFAULT FALSE,

  -- The sweep matches due_date <= CURRENT_DATE. The Power Automate original
  -- matched an EXACT day count (== 30), so one failed run skipped that
  -- evaluation permanently and silently. See plan §3.1.
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

  -- Two reminders per cycle at due_date +2 and +4 days. Reconstructed from the
  -- PPT user guide (fresher day 32/34, experienced 62/64) because the
  -- "PEA - Sending Evaluation Reminders" flow was never exported. Plan §2.3b.
  reminder_count      SMALLINT     NOT NULL DEFAULT 0,
  last_reminded_at    TIMESTAMPTZ,

  avg_rating          NUMERIC(3,2),
  remarks             TEXT,
  confirmation_status VARCHAR(50),  -- captured on the final cycle only

  -- Verbatim pre-migration text for legacy rows we deliberately do NOT parse
  -- (Sheet1 free-text blobs, Sheet3's 4-parameter scale). Plan R5, tier 3.
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
-- The most important index in the schema: it serves the daily sweep.
CREATE INDEX IF NOT EXISTS idx_pea_evaluation_cycles_due
  ON pea_evaluation_cycles (due_date, status);
CREATE INDEX IF NOT EXISTS idx_pea_evaluation_cycles_reminder
  ON pea_evaluation_cycles (status, reminder_count, due_date);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) pea_evaluation_scores — per-parameter ratings.
--    Mirrors rpa_interview_scorecard_skill, the ATS pattern this reuses.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_evaluation_scores (
  id          BIGSERIAL    PRIMARY KEY,
  cycle_id    BIGINT       NOT NULL REFERENCES pea_evaluation_cycles(id) ON DELETE CASCADE,
  param_key   VARCHAR(60)  NOT NULL,
  -- Snapshotted at submit time so renaming a question later never rewrites
  -- what a manager actually saw and answered.
  param_label VARCHAR(150) NOT NULL,
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
-- 5) pea_evaluation_params — the form definition as DATA, so HR can change the
--    questions without a code deployment.
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
-- 6) pea_email_log — audit of every send. Nothing equivalent exists today:
--    a failed Power Automate send currently leaves no trace at all.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_email_log (
  id              BIGSERIAL    PRIMARY KEY,
  cycle_id        BIGINT       REFERENCES pea_evaluation_cycles(id) ON DELETE SET NULL,
  employee_id     BIGINT       REFERENCES pea_employees(id) ON DELETE SET NULL,
  email_type      VARCHAR(50)  NOT NULL,
  recipient_email VARCHAR(255) NOT NULL,
  cc_emails       TEXT,
  subject         VARCHAR(500),
  status          VARCHAR(20)  NOT NULL,
  error_message   TEXT,
  sent_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- 'suppressed' is what shadow mode writes instead of sending, so PEA's
  -- "would have sent" list can be diffed against what Power Automate actually
  -- sent, before cutover. Plan R6, stage 1.
  CONSTRAINT pea_email_log_status_chk CHECK (status IN ('sent', 'failed', 'suppressed')),
  CONSTRAINT pea_email_log_type_chk   CHECK (
    email_type IN ('evaluation_link', 'reminder', 'acknowledgement',
                   'extend_alert', 'hr_notification')
  )
);
CREATE INDEX IF NOT EXISTS idx_pea_email_log_cycle ON pea_email_log (cycle_id);
CREATE INDEX IF NOT EXISTS idx_pea_email_log_sent  ON pea_email_log (sent_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 7) pea_settings — key/value config. Everything the flows hardcoded lives here.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_settings (
  id            BIGSERIAL    PRIMARY KEY,
  setting_key   VARCHAR(100) NOT NULL,
  setting_value TEXT,
  description   TEXT,
  modified_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_settings_key ON pea_settings (setting_key);


-- ═══════════════════════════════════════════════════════════════════════════
-- 8) pea_employee_audit — who changed what, when, from which source.
--    The concrete answer to "what if the AD data is wrong?" (plan §6.5):
--    corrections are attributable and reversible, which Excel never was.
-- ═══════════════════════════════════════════════════════════════════════════
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
    change_source IN ('manual', 'azure', 'excel_import', 'ats', 'system')
  )
);
CREATE INDEX IF NOT EXISTS idx_pea_employee_audit_employee
  ON pea_employee_audit (employee_id, changed_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 9) pea_azure_sync_log — Phase 2. Created now to avoid a later DDL round-trip.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_azure_sync_log (
  id                 BIGSERIAL   PRIMARY KEY,
  run_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  users_fetched      INT,
  users_created      INT,
  users_flagged_left INT,
  status             VARCHAR(20),
  error_message      TEXT
);


-- ═══════════════════════════════════════════════════════════════════════════
-- 10) Seed data — evaluation parameters
--     The 7 parameters, identical for both templates. Taken from the two
--     exported "Submitted Response" flows, which compose exactly these.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pea_evaluation_params (template, param_key, param_label, sort_order) VALUES
  ('fresher',      'quality_of_work',   'Quality of Code / Work',       1),
  ('fresher',      'meeting_deadline',  'Meeting Deadline',             2),
  ('fresher',      'communication',     'Communication & Presentation', 3),
  ('fresher',      'proactiveness',     'Proactiveness',                4),
  ('fresher',      'skill_development', 'Skill Development',            5),
  ('fresher',      'cultural_fit',      'Cultural Fit',                 6),
  ('fresher',      'x_factor',          'X-Factor',                     7),
  ('experienced',  'quality_of_work',   'Quality of Code / Work',       1),
  ('experienced',  'meeting_deadline',  'Meeting Deadline',             2),
  ('experienced',  'communication',     'Communication & Presentation', 3),
  ('experienced',  'proactiveness',     'Proactiveness',                4),
  ('experienced',  'skill_development', 'Skill Development',            5),
  ('experienced',  'cultural_fit',      'Cultural Fit',                 6),
  ('experienced',  'x_factor',          'X-Factor',                     7),
  -- Historical only: Sheet3's older instrument. Never offered on a new form;
  -- present so legacy imports display on their own scale instead of being
  -- silently mixed into the 7-parameter data.
  ('legacy_4param','skill',             'Skill',                        1),
  ('legacy_4param','quality_of_work',   'Quality of Work',              2),
  ('legacy_4param','timeliness',        'Timeliness of Work',           3),
  ('legacy_4param','x_factor',          'X-Factor',                     4)
ON CONFLICT (template, param_key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 11) Seed data — settings. Values recovered from the exported flow definitions.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pea_settings (setting_key, setting_value, description) VALUES
  ('sweep_cron',                '0 11 * * *',
   'Daily evaluation sweep, 11:00 Asia/Kolkata — matches the Power Automate recurrence.'),
  ('sweep_timezone',            'Asia/Kolkata',
   'Explicit TZ. The original mixed an IST schedule with UTC date maths (plan R10).'),
  ('fresher_interval_days',     '30',  'Fresher evaluation every 30 days.'),
  ('fresher_cycle_count',       '6',   'Number of fresher evaluations.'),
  ('experienced_interval_days', '60',  'Experienced evaluation every 60 days.'),
  ('experienced_cycle_count',   '3',   'Number of experienced evaluations.'),
  ('extension_1month_day',      '210', 'Extension cycle offset, "Extend for 1 month".'),
  ('extension_2month_day',      '240', 'Extension cycle offset, "Extend for 2 months".'),
  ('reminder_offsets_days',     '2,4',
   'Reminder 1 and 2, as days after a cycle due_date. Reconstructed from the PPT '
   'user guide (fresher 32/34, experienced 62/64) — plan §2.3b. CONFIRM WITH HR.'),
  ('reminder_max_count',        '2',   'Reminders per cycle before giving up.'),
  ('skip_weekends',             'true','Shift sends off Sat/Sun, as the original flow did.'),
  ('cc_emails',
   'sroy@aapnainfotech.com;rsomani@aapnainfotech.com;sshukla@aapnainfotech.com;smaiti@aapnainfotech.com',
   'CC list, lifted from the scheduler flow where it was hardcoded. Now editable — that is the point.'),
  ('hr_notification_emails',    'sshukla@aapnainfotech.com;smaiti@aapnainfotech.com',
   'Recipients of submit notifications and extend alerts (from the response flows).'),
  ('sender_email',              '',
   'Shared mailbox once IT provisions it. Empty = fall back to MS_DEFAULT_SENDER_EMAIL (plan R16).'),
  ('reply_to_email',            '',
   'Reply-To so manager replies reach HR, not an unmonitored mailbox.'),
  ('token_validity_days',       '30',  'Evaluation link lifetime.'),
  ('shadow_mode',               'true',
   'TRUE = write pea_email_log rows with status=suppressed instead of sending. This '
   'is the R6 stage-1 cutover check. MUST be set false to go live.')
ON CONFLICT (setting_key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 12) Forward-compatible grants for a restricted `peauser`
--
--     No-op today: the role does not exist, because appuser lacks CREATEROLE.
--     Since PEA now shares the `public` schema with the ATS tables, this role
--     is the ONLY control that would refuse a destructive Prisma command at
--     the database level. Worth asking for.
--
--     Someone with CREATEROLE runs, once:
--
--         CREATE ROLE peauser WITH LOGIN PASSWORD 'Pea9kQm4vXt7bLzR2nWsYd6H'
--           NOSUPERUSER NOCREATEDB NOCREATEROLE;
--         GRANT CONNECT ON DATABASE recruitmentautomationdb TO peauser;
--
--     ...then re-run THIS FILE. appuser owns all 48 rpa_ tables, so it can
--     issue every grant below itself — no superuser needed. Then change
--     DATABASE_URL from appuser to peauser. No code change.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t TEXT;
  pea_tables TEXT[] := ARRAY[
    'pea_users', 'pea_sessions', 'pea_employees', 'pea_evaluation_cycles',
    'pea_evaluation_scores', 'pea_evaluation_params', 'pea_email_log',
    'pea_settings', 'pea_employee_audit', 'pea_azure_sync_log'
  ];
  ats_readable TEXT[] := ARRAY[
    'rpa_candidate_pipeline',         -- join target for ats_pipeline_id
    'rpa_shortlisted_candidates',     -- candidate name + personal email
    'rpa_offers',                     -- joining_date: the ATS→PEA handoff (R4)
    'rpa_interview_scorecard',        -- interview feedback to display
    'rpa_interview_scorecard_skill',  -- per-skill interview ratings
    'rpa_assessment_results'          -- assessment scores to display
  ];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peauser') THEN
    RAISE NOTICE 'peauser role does not exist — PEA will connect as appuser.';
    RAISE NOTICE 'To harden later: create the role (see section 12 header) and re-run';
    RAISE NOTICE 'this file. No application change is required.';
    RETURN;
  END IF;

  RAISE NOTICE 'peauser found — applying least-privilege grants.';
  EXECUTE 'GRANT USAGE ON SCHEMA public TO peauser';

  -- Read/write on PEA's own tables only.
  FOREACH t IN ARRAY pea_tables LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO peauser', t);
  END LOOP;
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO peauser';

  -- Read-only on the handful of ATS tables the history panel needs.
  FOREACH t IN ARRAY ats_readable LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('GRANT SELECT ON public.%I TO peauser', t);
      RAISE NOTICE '  GRANT SELECT on % -> peauser', t;
    ELSE
      RAISE WARNING '  Table % not found in this database — skipped', t;
    END IF;
  END LOOP;
END
$$;


-- ═══════════════════════════════════════════════════════════════════════════
--  VERIFICATION  (informational, safe to re-run)
--
--  If this grid does not appear after running, you executed only a SELECTION
--  rather than the whole file. In pgAdmin, F5 runs the selected text when
--  anything is highlighted. Click in the editor, press Ctrl+A, then F5.
-- ═══════════════════════════════════════════════════════════════════════════
SELECT * FROM (
  SELECT 1 AS n, 'database (must be recruitmentautomationdb)' AS check_name,
         current_database()::text AS value
  UNION ALL SELECT 2, 'pea_ tables created (expect 10)',
         (SELECT count(*)::text FROM pg_tables
           WHERE schemaname = 'public' AND tablename LIKE 'pea\_%')
  UNION ALL SELECT 3, 'evaluation params seeded (expect 18)',
         (SELECT count(*)::text FROM pea_evaluation_params)
  UNION ALL SELECT 4, 'settings seeded (expect 17)',
         (SELECT count(*)::text FROM pea_settings)
  UNION ALL SELECT 5, 'shadow_mode (expect true)',
         (SELECT setting_value FROM pea_settings WHERE setting_key = 'shadow_mode')
  UNION ALL SELECT 6, 'ATS rpa_ tables untouched (expect 48)',
         (SELECT count(*)::text FROM pg_tables
           WHERE schemaname = 'public' AND tablename LIKE 'rpa\_%')
  UNION ALL SELECT 7, 'total tables in public (expect 59)',
         (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public')
) q ORDER BY n;
