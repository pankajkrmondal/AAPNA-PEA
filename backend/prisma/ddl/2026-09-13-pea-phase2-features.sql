-- ═══════════════════════════════════════════════════════════════════════════
--  PEA — Phase 2 features: notifications, manager portal, Azure field locks,
--  Report-to-IT, confirmation deadline alert, ATS → inbox handoff
--
--  ⚠️ INTERIM (decision D5, 13 Sep 2026). Applied to recruitmentautomationdb, where
--     PEA runs for now. Its ATS-offer columns (personal_email, position_applied,
--     the ATS unique index) are no longer used. For PEA's own database later, use
--     pea-dedicated-database.sql.
--
--  File     : 2026-09-13-pea-phase2-features.sql
--  Author   : (dev)                          Reviewed by: ____________________
--  Run as   : appuser        (no superuser required)
--  Requires : 2026-09-12-pea-core.sql AND 2026-09-12b-pea-joiner-intake.sql
--
--  ✅ STATUS: APPLIED to recruitmentautomationdb on 13 Sep 2026 and verified
--     (node scripts/verify-phase2.js). Re-running is harmless: idempotent.
--
--  Idempotent and additive. Contains NO DROP TABLE and NO DROP COLUMN.
--
--  ⚠️  ONE constraint is replaced (section 1): the CHECK on
--      pea_email_log.email_type is dropped and re-added with three more allowed
--      values. No row is touched. A CHECK can only be widened by recreating it,
--      and every existing value remains valid under the new one.
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

  IF to_regclass('public.pea_joiner_candidates') IS NULL THEN
    RAISE EXCEPTION
      'pea_joiner_candidates does not exist. Apply 2026-09-12b-pea-joiner-intake.sql first.';
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 1) pea_email_log — three new message types
--
--    it_report       "Report to IT" — a wrong value in Entra, sent to IT
--    manager_portal  a reporting manager's "my team" link
--    deadline_alert  the 6 / 8-month confirmation-deadline digest to HR
--
--    All three go through notification.service.queueEmail(), so outside
--    production they are redirected to EMAIL_STAGING_RECIPIENTS like every
--    other message.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE pea_email_log DROP CONSTRAINT IF EXISTS pea_email_log_type_chk;
ALTER TABLE pea_email_log ADD CONSTRAINT pea_email_log_type_chk CHECK (
  email_type IN ('evaluation_link', 'reminder', 'acknowledgement',
                 'extend_alert', 'hr_notification',
                 'it_report', 'manager_portal', 'deadline_alert')
);


-- ═══════════════════════════════════════════════════════════════════════════
-- 2) pea_employees — what Entra last said, for the "differs from Azure" badge
--
--    Plan §6.5 Part 2. When HR locks a field, the sync stops overwriting it —
--    but the disagreement must stay VISIBLE, or a lock silently hides the fact
--    that IT's record is still wrong. These two columns are Entra's latest
--    values, refreshed on every scan whether or not the field is locked.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE pea_employees
  ADD COLUMN IF NOT EXISTS azure_display_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS azure_mail         VARCHAR(255);


-- ═══════════════════════════════════════════════════════════════════════════
-- 3) pea_joiner_candidates — accepted ATS offers join the same inbox
--
--    An ATS offer carries the one thing Entra never can: the joining date
--    agreed with the candidate. Queuing it beside the Entra detections lets HR
--    link the two when they are the same person, and take the exact date.
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE pea_joiner_candidates
  ADD COLUMN IF NOT EXISTS personal_email   VARCHAR(255),
  ADD COLUMN IF NOT EXISTS position_applied VARCHAR(255);

-- One inbox row per ATS pipeline, so a rescan refreshes instead of duplicating.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_joiner_candidates_ats
  ON pea_joiner_candidates (ats_pipeline_id)
  WHERE source = 'ats' AND ats_pipeline_id IS NOT NULL;


-- ═══════════════════════════════════════════════════════════════════════════
-- 4) pea_notifications — the in-app bell
--
--    One row per user per event, so read state is personal: Shweta reading an
--    alert does not clear it for Subhajit. dedupe_key stops a nightly job
--    re-announcing the same overdue probation every morning.
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pea_notifications (
  id          BIGSERIAL    PRIMARY KEY,
  user_id     INT          NOT NULL,
  type        VARCHAR(40)  NOT NULL,
  title       VARCHAR(200) NOT NULL,
  body        TEXT,
  link        VARCHAR(300),
  severity    VARCHAR(10)  NOT NULL DEFAULT 'info',
  dedupe_key  VARCHAR(200),
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT pea_notifications_user_fk
    FOREIGN KEY (user_id) REFERENCES pea_users(id) ON DELETE CASCADE,
  CONSTRAINT pea_notifications_severity_chk
    CHECK (severity IN ('info', 'warning', 'critical'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_notifications_dedupe
  ON pea_notifications (user_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pea_notifications_user
  ON pea_notifications (user_id, read_at, created_at DESC);


-- ═══════════════════════════════════════════════════════════════════════════
-- 5) pea_manager_links — a reporting manager's "my team" view, no login
--
--    Same trust model as the evaluation form: a UUID in a link is the
--    credential. It shows one manager their own reports only, expires, and can
--    be revoked. Managers still get no PEA account (plan §5.4).
-- ═══════════════════════════════════════════════════════════════════════════
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_pea_manager_links_token
  ON pea_manager_links (token);
CREATE INDEX IF NOT EXISTS idx_pea_manager_links_rm
  ON pea_manager_links (lower(trim(rm_email)));


-- ═══════════════════════════════════════════════════════════════════════════
-- 6) Settings
-- ═══════════════════════════════════════════════════════════════════════════
INSERT INTO pea_settings (setting_key, setting_value, description) VALUES
  ('it_report_emails', '',
   'Where "Report to IT" messages go (semicolon-separated). Blank until IT names a distribution list. Outside production every message is redirected to the test inbox regardless.'),
  ('confirmation_deadline_months', '6',
   'Months from DOJ by which Confirmation Status must be filled in. Plan §2.7.'),
  ('confirmation_deadline_extended_months', '8',
   'The same deadline once an extension has been granted. Plan §2.7.'),
  ('deadline_alert_email_enabled', 'false',
   'Email HR a daily digest of probations past their confirmation deadline. Off until HR answers decision 17. The dashboard shows the list either way.'),
  ('manager_link_validity_days', '30',
   'How long a reporting manager''s "my team" link stays valid.'),
  ('azure_field_sync_enabled', 'false',
   'Let the Entra scan overwrite an employee''s name and email with Entra''s values, except fields HR has locked (plan §6.5). Off by default: with it off the scan only records differences, so HR can see how many records would change before any do.')
ON CONFLICT (setting_key) DO NOTHING;


-- ═══════════════════════════════════════════════════════════════════════════
-- 7) Grants for a restricted `peauser` (no-op if the role does not exist)
-- ═══════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peauser') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON pea_notifications  TO peauser;
    GRANT SELECT, INSERT, UPDATE, DELETE ON pea_manager_links  TO peauser;
    GRANT USAGE, SELECT ON SEQUENCE pea_notifications_id_seq   TO peauser;
    GRANT USAGE, SELECT ON SEQUENCE pea_manager_links_id_seq   TO peauser;
    RAISE NOTICE 'Grants applied to peauser.';
  ELSE
    RAISE NOTICE 'Role peauser does not exist — grants skipped.';
  END IF;
END $$;


-- ═══════════════════════════════════════════════════════════════════════════
-- 8) Verification — every row should read 1, and the last should read 48
-- ═══════════════════════════════════════════════════════════════════════════
SELECT 'pea_notifications' AS object,
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'pea_notifications') AS ok
UNION ALL
SELECT 'pea_manager_links',
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'pea_manager_links')
UNION ALL
SELECT 'pea_employees.azure_display_name',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_employees' AND column_name = 'azure_display_name')
UNION ALL
SELECT 'pea_joiner_candidates.personal_email',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_joiner_candidates' AND column_name = 'personal_email')
UNION ALL
SELECT 'email_type allows it_report',
       (SELECT count(*) FROM pg_constraint
         WHERE conname = 'pea_email_log_type_chk'
           AND pg_get_constraintdef(oid) LIKE '%it_report%')
UNION ALL
SELECT 'deadline settings seeded',
       (SELECT count(*) FROM pea_settings WHERE setting_key = 'confirmation_deadline_months')
UNION ALL
SELECT 'ATS rpa_ tables still intact (expect 48)',
       (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name LIKE 'rpa\_%');
