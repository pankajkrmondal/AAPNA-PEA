-- ═══════════════════════════════════════════════════════════════════════════
--  PEA — Phase 2: New Joiner Inbox, RM→PL map, leaver suggestions
--
--  ⚠️ INTERIM (decision D5, 13 Sep 2026). Applied to recruitmentautomationdb, where
--     PEA runs for now. For PEA's own database later, use pea-dedicated-database.sql.
--
--  File     : 2026-09-12b-pea-joiner-intake.sql
--  Author   : (dev)                          Reviewed by: ____________________
--  Run as   : appuser        (no superuser required)
--  Server   : 20.244.34.176:5432 · PostgreSQL 18.1 (Ubuntu)
--  Requires : 2026-09-12-pea-core.sql must already have been applied.
--
--  ✅ STATUS: APPLIED to recruitmentautomationdb on 12 Sep 2026 and verified
--     (node scripts/verify-intake.js). Re-running is harmless: idempotent, no DROP.
--
--  Implements plan §13.8 (New Joiner Inbox), §13.5 (PL derived from RM) and
--  §13.9 (leaver detection needs accountEnabled AND licence, not licence alone).
--
--  Idempotent, additive, non-destructive — safe to run multiple times.
--  Contains NO DROP statements. Search the file — there are none.
--
--  ┌─────────────────────────────────────────────────────────────────────────┐
--  │  ⚠️  DATABASE NAME — CHECK BEFORE RUNNING                                │
--  │      recruitmentautomationdb      ← ✅ staging                           │
--  │      recruitmentAutomationDb      ← ❌ different database!               │
--  │      recruitmentautomationdbProd  ← production, at cutover only          │
--  │  Section 0 aborts the script if it is anything else.                    │
--  └─────────────────────────────────────────────────────────────────────────┘
--
--  ⚠️  NEVER RUN `prisma migrate`, `db push` OR `db pull` IN THIS PROJECT.
--      schema.prisma is hand-written; see 2026-09-12-pea-core.README.md.
--
--  NOTE — no explicit BEGIN/COMMIT, for the same reason as the core file:
--  every statement is idempotent and auto-commits, so a partial run is
--  completed simply by running the file again.
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

  IF to_regclass('public.pea_employees') IS NULL THEN
    RAISE EXCEPTION
      'pea_employees does not exist. Apply 2026-09-12-pea-core.sql first.';
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) pea_employees — the two Entra signals, and HR's answer to a leaver flag
--
--    Harish's stated rule was "no assigned licence = they have left". Measured
--    across 91 mailbox users it flags 68 people, most of them resource accounts,
--    guests, or unlicensed-but-present staff. `accountEnabled = false` alone
--    gives 16, and BOTH together give the same clean 16. So PEA stores the two
--    signals separately and requires both. Plan §13.9.
--
--    Nothing here ever changes employment_status by itself. A flag is a
--    suggestion in HR's inbox; only a person confirms a leaver.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE pea_employees
  ADD COLUMN IF NOT EXISTS azure_account_enabled BOOLEAN,
  ADD COLUMN IF NOT EXISTS azure_synced_at       TIMESTAMPTZ,
  -- Set when both signals say "gone". Cleared when either comes back.
  ADD COLUMN IF NOT EXISTS leaver_flagged_at     TIMESTAMPTZ,
  -- HR said "no, they are still here". A flag raised AFTER this timestamp is
  -- shown again; an older one stays dismissed. Storing the instant rather than
  -- a boolean is what lets someone genuinely leave later and be flagged afresh.
  ADD COLUMN IF NOT EXISTS leaver_dismissed_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_pea_employees_azure
  ON pea_employees (azure_user_id);
-- Partial index: the leaver queue is a handful of rows out of the whole table.
CREATE INDEX IF NOT EXISTS idx_pea_employees_leaver
  ON pea_employees (leaver_flagged_at)
  WHERE leaver_flagged_at IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) pea_joiner_candidates — the New Joiner Inbox
--
--    PEA detects a new Microsoft account, prefills what Entra can tell it, and
--    HR confirms the rest. Measured coverage across all 260 enabled accounts
--    (plan §13.2, §13.6) is what each column can and cannot promise:
--
--      displayName      100%  → full_name              ✅ trustworthy
--      mail             100%  → office_email           ✅ the only source
--      createdDateTime  100%  → DOJ *suggestion* only  ⚠️ 70% within ±3 days,
--                                                         worst case −799 days
--      manager           73% for accounts under 6 months, 88% correct when set
--      employeeHireDate   0%  → nothing
--      employeeType       0%  → nothing (fresher/experienced is always asked)
--
--    Hence the *_source columns: every prefilled value carries where it came
--    from, so the UI can mark it "unverified — from Entra" rather than present
--    a guess as a fact. A wrong DOJ shifts all six evaluation dates, so it is
--    never auto-accepted.
--
--    This table is a queue, not a second employee register. Accepting a row
--    creates a pea_employees record and the row becomes history.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_joiner_candidates (
  id                  BIGSERIAL    PRIMARY KEY,

  -- Entra objectId. The identity of the row: a rescan updates, never duplicates.
  azure_user_id       VARCHAR(100),
  source              VARCHAR(20)  NOT NULL DEFAULT 'azure',  -- azure | ats

  display_name        VARCHAR(150),
  office_email        VARCHAR(255),
  account_created_at  TIMESTAMPTZ,          -- Entra createdDateTime

  -- ── Prefilled suggestions, each with its provenance ────────────────────
  suggested_doj       DATE,
  doj_source          VARCHAR(20),          -- ats_offer | account_created
  suggested_rm_name   VARCHAR(150),
  suggested_rm_email  VARCHAR(255),
  rm_source           VARCHAR(20),          -- entra_manager
  suggested_pl_email  VARCHAR(255),
  pl_source           VARCHAR(20),          -- rm_map
  -- Deliberately never suggested: employeeType is 0% populated, so PEA has no
  -- basis at all for fresher vs experienced. HR always answers this one.
  -- Plan §13.6.

  ats_pipeline_id     BIGINT,               -- soft link, no FK (as pea_employees)

  status              VARCHAR(20)  NOT NULL DEFAULT 'pending',
  dismissed_reason    TEXT,
  employee_id         BIGINT,               -- set once accepted
  reviewed_by         VARCHAR(255),
  reviewed_at         TIMESTAMPTZ,

  -- Exactly the Graph fields PEA selected, kept verbatim. When HR disputes a
  -- prefilled value the question is always "what did Entra actually say?", and
  -- without this the honest answer is "we no longer know".
  raw_graph           JSONB,

  first_seen_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT pea_joiner_candidates_status_chk
    CHECK (status IN ('pending', 'accepted', 'dismissed')),
  CONSTRAINT pea_joiner_candidates_source_chk
    CHECK (source IN ('azure', 'ats')),
  CONSTRAINT pea_joiner_candidates_employee_fk
    FOREIGN KEY (employee_id) REFERENCES pea_employees(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_joiner_candidates_azure
  ON pea_joiner_candidates (azure_user_id)
  WHERE azure_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pea_joiner_candidates_status
  ON pea_joiner_candidates (status, account_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pea_joiner_candidates_email
  ON pea_joiner_candidates (lower(trim(office_email)));


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) pea_rm_pl_map — Project Leader derived from Reporting Manager
--
--    PL is not a Microsoft concept and never will be. It does not need to be:
--    across all 54 rows of the master sheet, 21 of 22 reporting managers map to
--    exactly one project leader — 89% of staff. Plan §13.5.
--
--    The one exception is ragupta@, who appears against vtyagi@ (×4) and aroy@
--    (×2). That is recorded as is_ambiguous rather than resolved by picking the
--    majority: guessing here silently CCs the wrong project leader on somebody's
--    performance review. HR settles it (open decision 14) and the flag clears.
--
--    Seeded from the live pea_employees rows by the application rather than
--    hardcoded here, so the map reflects the data actually imported. See
--    rmPlMap.service.js → seedFromEmployees().
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_rm_pl_map (
  id           BIGSERIAL    PRIMARY KEY,
  rm_email     VARCHAR(255) NOT NULL,
  pl_email     VARCHAR(255),
  -- TRUE when the source data showed this manager with more than one PL.
  -- pl_email then holds the most common one but must not be applied unasked.
  is_ambiguous BOOLEAN      NOT NULL DEFAULT FALSE,
  note         TEXT,
  source       VARCHAR(20)  NOT NULL DEFAULT 'sheet',   -- sheet | manual
  modified_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT pea_rm_pl_map_source_chk CHECK (source IN ('sheet', 'manual'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_rm_pl_map_rm
  ON pea_rm_pl_map (lower(trim(rm_email)));


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) pea_azure_sync_log — widen the Phase 1 placeholder
--
--    The core file created this with counts only. A scan that finds nothing and
--    a scan that failed halfway both leave "0 created", so record what the run
--    actually did.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE pea_azure_sync_log
  ADD COLUMN IF NOT EXISTS mode                 VARCHAR(20),  -- scan | dry_run
  ADD COLUMN IF NOT EXISTS candidates_new       INT,
  ADD COLUMN IF NOT EXISTS candidates_updated   INT,
  ADD COLUMN IF NOT EXISTS employees_checked    INT,
  ADD COLUMN IF NOT EXISTS duration_ms          INT,
  ADD COLUMN IF NOT EXISTS detail               JSONB;

CREATE INDEX IF NOT EXISTS idx_pea_azure_sync_log_run
  ON pea_azure_sync_log (run_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5) Seed data — settings for the intake scan
--
--    Defaults are deliberately conservative. The scan is READ-ONLY against
--    Microsoft Graph and sends no email, but it is still a new data source
--    arriving mid-cutover (plan §10), so it stays off until someone turns it on.
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pea_settings (setting_key, setting_value, description) VALUES
  ('azure_scan_enabled',      'false',
   'Master switch for the scheduled Entra intake scan. The manual "Scan now" button works regardless. Off by default — see plan §10: the New Joiner Inbox should land after the shadow-mode cutover, not during it.'),
  ('azure_scan_cron',         '0 9 * * *',
   'When the intake scan runs, in the scheduler timezone. 09:00 IST — two hours before the evaluation sweep, so a new joiner detected today is in the inbox before HR starts.'),
  ('azure_scan_window_days',  '45',
   'How far back to look for newly created Entra accounts. Wide enough to catch an account made before a delayed joining date, narrow enough that the first run does not enqueue four years of staff.'),
  ('azure_email_domain',      'aapnainfotech.com',
   'Only accounts on this domain are considered joiners. Guests and resource accounts on other domains are ignored.'),
  ('rm_pl_map_seeded_at',     '',
   'Timestamp of the last RM→PL map seed from pea_employees. Blank until first run.')
ON CONFLICT (setting_key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Forward-compatible grants for a restricted `peauser`
--
--    Mirrors section 12 of the core file. No-ops silently if the role does not
--    exist yet, so this file is safe to run before the role is created.
--    peauser keeps SELECT-only on every rpa_* table — nothing here changes that.
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peauser') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON pea_joiner_candidates TO peauser;
    GRANT SELECT, INSERT, UPDATE, DELETE ON pea_rm_pl_map          TO peauser;
    GRANT USAGE, SELECT ON SEQUENCE pea_joiner_candidates_id_seq   TO peauser;
    GRANT USAGE, SELECT ON SEQUENCE pea_rm_pl_map_id_seq           TO peauser;
    RAISE NOTICE 'Grants applied to peauser.';
  ELSE
    RAISE NOTICE 'Role peauser does not exist — grants skipped. Re-run this section after creating it.';
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7) Verification — run this after the script and read the output
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'pea_joiner_candidates' AS object,
       (SELECT count(*) FROM information_schema.tables
         WHERE table_name = 'pea_joiner_candidates') AS exists
UNION ALL
SELECT 'pea_rm_pl_map',
       (SELECT count(*) FROM information_schema.tables
         WHERE table_name = 'pea_rm_pl_map')
UNION ALL
SELECT 'pea_employees.leaver_flagged_at',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_employees' AND column_name = 'leaver_flagged_at')
UNION ALL
SELECT 'pea_azure_sync_log.mode',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_azure_sync_log' AND column_name = 'mode')
UNION ALL
SELECT 'ATS rpa_ tables still intact (expect 48)',
       (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name LIKE 'rpa\_%');
