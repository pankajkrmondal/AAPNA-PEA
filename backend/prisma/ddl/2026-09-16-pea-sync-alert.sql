-- ═══════════════════════════════════════════════════════════════════════════
--  2026-09-16-pea-sync-alert.sql
--
--  R-03 — "Microsoft 365 check alert", from Subhajit's 15-Sep review:
--
--    "If any data is not being synced properly from the AD, we should be
--     getting an email alert so that we can take it up manually."   (16:14)
--
--  Two changes, both additive:
--
--    1) email_type gains 'sync_alert', so the alert can be written to the
--       email log like every other message PEA sends. WITHOUT THIS the send
--       fails on the CHECK constraint and HR gets nothing — which is exactly
--       the silent failure the feature exists to prevent.
--
--    2) Three settings rows, so the behaviour is HR's to control:
--         sync_alert_enabled           — send the email at all
--         hold_evaluations_for_leavers — R-02, the automatic leaver hold
--         manual_pause_enabled         — R-02, show the manual pause button
--
--  Safe to re-run. Nothing is dropped and no existing row is changed.
--
--  ┌──────────────────────────────────────────────────────────────────────────┐
--  │  ⚠️  DATABASE NAME — CHECK BEFORE RUNNING                                │
--  │  PEA's tables currently sit inside the ATS staging database. Connect as  │
--  │  the PEA user and confirm the pea_ tables are present before running.    │
--  └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- 0) Refuse to run against a database that has no PEA tables at all.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'pea_email_log'
  ) THEN
    RAISE EXCEPTION 'pea_email_log not found — wrong database?';
  END IF;
END $$;


-- 1) Widen the email_type CHECK. Dropped and re-added inside one transaction so
--    there is never a moment where the column is unconstrained.
BEGIN;

ALTER TABLE pea_email_log DROP CONSTRAINT IF EXISTS pea_email_log_type_chk;
ALTER TABLE pea_email_log ADD CONSTRAINT pea_email_log_type_chk CHECK (
  email_type IN ('evaluation_link', 'reminder', 'acknowledgement',
                 'extend_alert', 'hr_notification',
                 'it_report', 'manager_portal', 'deadline_alert',
                 'sync_alert', 'evaluation_report',
                 'user_created', 'user_password_changed', 'password_reset_request')
);

COMMIT;


-- 2) Settings. ON CONFLICT DO NOTHING so re-running never overwrites a choice
--    HR has already made in the Settings screen.
INSERT INTO pea_settings (setting_key, setting_value, description)
VALUES
  ('sync_alert_enabled', 'true',
   'Email HR when the Microsoft 365 check fails, has not run, or finds a joiner that cannot be used. Each problem is reported once, not every night.'),
  ('hold_evaluations_for_leavers', 'true',
   'Stop evaluation emails as soon as the Microsoft 365 check finds an account switched off and unlicensed, before HR confirms the exit. R-02.'),
  ('manual_pause_enabled', 'false',
   'Show the manual pause button on the employee page. Off by default: exits are handled automatically, so the only remaining use is long leave.'),
  ('never_cc_as_pl', '',
   'People never copied on evaluation emails merely for being the project leader. The old Power Automate flow left one address off on purpose. Comma separated.'),
  ('cc_on_team_links', 'true',
   'Copy the HR notification recipients and the CC list on manager team-link emails, like every other evaluation email. Subhajit, 15 Sep.')
ON CONFLICT (setting_key) DO NOTHING;


-- 3) Verification — every row should report ok = 1.
SELECT 'email_type allows sync_alert (expect 1)' AS object,
       (SELECT count(*) FROM pg_constraint
         WHERE conname = 'pea_email_log_type_chk'
           AND pg_get_constraintdef(oid) LIKE '%sync_alert%') AS ok
UNION ALL
SELECT 'email_type allows evaluation_report (expect 1)',
       (SELECT count(*) FROM pg_constraint
         WHERE conname = 'pea_email_log_type_chk'
           AND pg_get_constraintdef(oid) LIKE '%evaluation_report%')
UNION ALL
SELECT 'email_type still allows deadline_alert (expect 1)',
       (SELECT count(*) FROM pg_constraint
         WHERE conname = 'pea_email_log_type_chk'
           AND pg_get_constraintdef(oid) LIKE '%deadline_alert%')
UNION ALL
SELECT 'setting sync_alert_enabled (expect 1)',
       (SELECT count(*) FROM pea_settings WHERE setting_key = 'sync_alert_enabled')
UNION ALL
SELECT 'setting hold_evaluations_for_leavers (expect 1)',
       (SELECT count(*) FROM pea_settings WHERE setting_key = 'hold_evaluations_for_leavers')
UNION ALL
SELECT 'setting manual_pause_enabled (expect 1)',
       (SELECT count(*) FROM pea_settings WHERE setting_key = 'manual_pause_enabled')
UNION ALL
SELECT 'setting never_cc_as_pl (expect 1)',
       (SELECT count(*) FROM pea_settings WHERE setting_key = 'never_cc_as_pl')
UNION ALL
SELECT 'setting cc_on_team_links (expect 1)',
       (SELECT count(*) FROM pea_settings WHERE setting_key = 'cc_on_team_links');
