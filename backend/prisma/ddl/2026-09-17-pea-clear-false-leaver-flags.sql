-- ═══════════════════════════════════════════════════════════════════════════
--  2026-09-17-pea-clear-false-leaver-flags.sql
--
--  Cleans up after a bug introduced on 16 Sep 2026 and fixed on 17 Sep.
--
--  ── What went wrong ───────────────────────────────────────────────────────
--
--  The R-02 change that added "not showing in the AD" leaver detection treated
--  ANY employee with no matching Entra account as a possible leaver. That is
--  wrong: "not showing in the AD" means an account that USED TO BE THERE and
--  has gone. Someone who never had one — a contractor, a person on a different
--  mail domain, a row imported from the spreadsheet, a test record — has not
--  disappeared. PEA simply never found them.
--
--  On the development database one scan flagged 19 of 20 active employees.
--  Because `hold_evaluations_for_leavers` defaults to ON, every one of those
--  people silently stopped receiving evaluation emails.
--
--  ── The code fix ──────────────────────────────────────────────────────────
--
--  joinerIntake.service.js now requires `azure_user_id` to be set before it
--  will flag a missing account — the account must have been LINKED before it
--  can be GONE. Deploy that first; this script only cleans up rows the old
--  code already wrote.
--
--  ── What this script clears ───────────────────────────────────────────────
--
--  ONLY flags on employees that were never linked to an Entra account
--  (azure_user_id IS NULL), which is precisely the false-positive set. An
--  employee who WAS linked and whose account has genuinely vanished keeps the
--  flag, because for them the signal is real and HR should still be asked.
--
--  Safe to re-run. Touches no other column.
--
--  ┌──────────────────────────────────────────────────────────────────────────┐
--  │  ⚠️  Run this on EVERY environment whose scan has run since 16 Sep 2026. │
--  │  Development is already done. Staging and production are not.            │
--  └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- 0) Refuse to run against the wrong database.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'pea_employees'
  ) THEN
    RAISE EXCEPTION 'pea_employees not found — wrong database?';
  END IF;
END $$;


-- 1) BEFORE — how many flags exist, and how many are false positives.
--    Run this first and read it. If "false_positives" is 0 there is nothing to
--    do and the rest of the script is a no-op.
SELECT count(*) FILTER (WHERE leaver_flagged_at IS NOT NULL)                           AS flagged_total,
       count(*) FILTER (WHERE leaver_flagged_at IS NOT NULL AND azure_user_id IS NULL) AS false_positives,
       count(*) FILTER (WHERE leaver_flagged_at IS NOT NULL AND azure_user_id IS NOT NULL) AS genuine_kept
  FROM pea_employees;


-- 2) Who is about to be cleared. Worth eyeballing before step 3 — every row
--    here should be someone you would NOT expect PEA to have found in Entra.
SELECT full_name, office_email, to_char(leaver_flagged_at, 'YYYY-MM-DD HH24:MI') AS flagged_at
  FROM pea_employees
 WHERE leaver_flagged_at IS NOT NULL AND azure_user_id IS NULL
 ORDER BY full_name;


-- 3) Clear them. Their evaluations resume on the next sweep.
UPDATE pea_employees
   SET leaver_flagged_at = NULL
 WHERE leaver_flagged_at IS NOT NULL
   AND azure_user_id IS NULL;


-- 4) AFTER — false_positives must now be 0. Anything still flagged was
--    genuinely linked-then-vanished and is a real question for HR.
SELECT count(*) FILTER (WHERE leaver_flagged_at IS NOT NULL)                           AS flagged_total,
       count(*) FILTER (WHERE leaver_flagged_at IS NOT NULL AND azure_user_id IS NULL) AS false_positives_expect_0,
       count(*) FILTER (WHERE leaver_flagged_at IS NOT NULL AND azure_user_id IS NOT NULL) AS genuine_kept
  FROM pea_employees;
