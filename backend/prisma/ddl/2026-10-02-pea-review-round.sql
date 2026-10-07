-- ═══════════════════════════════════════════════════════════════════════════
--  2026-10-02-pea-review-round.sql
--
--  The review round of 01-10-2026 (docs/PEA-review-points.md). Most of it
--  changes behaviour and wording and needs nothing here. Two things it added
--  have nowhere to live yet:
--
--    1) pea_employees.decision_on / decision_reason / decision_by
--       pea_employees.left_on / left_reason                            — U10
--       "Record decision" and "Mark as left" are their own actions now, each
--       with a reason and a date, instead of two dropdowns inside Edit that
--       could end a probation with neither. The reason and date are kept on
--       the person as well as in the change history, so the page can show
--       them without reading the history back.
--
--    2) pea_evaluation_cycles.draft / draft_saved_at                   — P11
--       A manager's unsubmitted answers. The form asks for seven comments;
--       closing the tab, or opening the email on a phone and finishing on a
--       laptop, used to lose them. The draft is kept against the same link
--       and cleared when the evaluation is submitted. HR sees only WHEN a
--       draft was saved, never what is in it.
--
--    3) pea_evaluation_cycles.sent_to_name / sent_to_email / delegated
--       pea_evaluation_cycles.submitted_by_name / entered_by      — M3 M7 U13 B5
--       Who a link was issued to, and who answered it. A submission used to
--       be credited to whoever the reporting manager was on the day it
--       arrived, so a manager change handed the old manager's ratings to the
--       new one. `delegated` marks a link HR sent to an acting manager;
--       `entered_by` marks ratings HR typed in on a manager's behalf.
--
--    4) pea_evaluation_revisions                                        — M6
--       What a manager submitted before HR reopened the evaluation for
--       correction — kept, with who reopened it and why.
--
--    5) pea_evaluation_followups                                        — P8
--       What HR did about flagged feedback ("spoke to the manager", "no action
--       needed"). Until now there was only a per-person "read" mark.
--
--    6) pea_email_log.email_type gains 'evaluation_reopened'            — M6
--       and 'joiners_waiting' (new joiners waiting for review)          — H1, 07-10-2026
--
--    7) pea_employee_notes                                              — L7
--       HR's notes on a Commando: what does not belong in an evaluation.
--       Notes only — no attachments. Read through the signed-in HR screens
--       and nowhere else.
--
--    8) pea_employees.archived_at / archived_by / archive_reason /
--       restored_at                                                     — Archive, 07-10-2026
--       A Commando whose probation is over — Confirmed, Not Confirmed, or
--       left — is archived: out of the day-to-day lists, kept as a
--       read-only record, and restorable. Nothing is deleted.
--
--  All of it is additive. Nothing is dropped and no existing row is changed.
--  The application checks for each column before using it
--  (utils/schemaCapabilities.js), so the build works before this is applied:
--  a decision's reason then lives in the change history only, the manager's
--  form has no "Save draft" button, Reopen, "Send to someone else" and the
--  follow-up record are not offered, and the Commando page has no Notes card.
--
--  ⚠️  ONE constraint is replaced: pea_email_log_type_chk gains one value. Two
--      UPDATEs backfill the new name columns from data already held; neither
--      touches a row that already has a value.
--
--  Safe to re-run.
--
--  ┌──────────────────────────────────────────────────────────────────────────┐
--  │  ⚠️  DATABASE NAME — CHECK BEFORE RUNNING                                │
--  │  Connect as the PEA user and confirm the pea_ tables are present.        │
--  └──────────────────────────────────────────────────────────────────────────┘
-- ═══════════════════════════════════════════════════════════════════════════

-- 0) Refuse to run against a database that has no PEA tables at all.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'pea_evaluation_cycles'
  ) THEN
    RAISE EXCEPTION 'pea_evaluation_cycles not found — wrong database?';
  END IF;
END $$;


BEGIN;

-- 1) U10 — the reason and date HR gives with "Record decision". Set together,
--    and cleared together when a decision is taken back to "In probation".
--    2000 characters is what the dialog allows; the CHECK stops anything
--    longer arriving by the API.
ALTER TABLE pea_employees
  ADD COLUMN IF NOT EXISTS decision_on     DATE,
  ADD COLUMN IF NOT EXISTS decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS decision_by     VARCHAR(255);

ALTER TABLE pea_employees DROP CONSTRAINT IF EXISTS pea_employees_decision_reason_len_chk;
ALTER TABLE pea_employees ADD CONSTRAINT pea_employees_decision_reason_len_chk
  CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 2000);

COMMENT ON COLUMN pea_employees.decision_on IS
  'Date of the probation decision HR recorded with "Record decision". NULL when the manager decided on the form, or no decision yet.';
COMMENT ON COLUMN pea_employees.decision_reason IS
  'HR''s reason for the recorded decision. Required by the dialog for everything except Confirmed.';
COMMENT ON COLUMN pea_employees.decision_by IS
  'PEA username that recorded the decision.';


-- 2) U10 — the last working day and reason given with "Mark as left". Cleared
--    by "Mark as active again".
ALTER TABLE pea_employees
  ADD COLUMN IF NOT EXISTS left_on     DATE,
  ADD COLUMN IF NOT EXISTS left_reason TEXT;

ALTER TABLE pea_employees DROP CONSTRAINT IF EXISTS pea_employees_left_reason_len_chk;
ALTER TABLE pea_employees ADD CONSTRAINT pea_employees_left_reason_len_chk
  CHECK (left_reason IS NULL OR char_length(left_reason) <= 2000);

COMMENT ON COLUMN pea_employees.left_on IS
  'Last working day, as given with "Mark as left".';
COMMENT ON COLUMN pea_employees.left_reason IS
  'Reason for leaving, as given with "Mark as left" or when an exit is confirmed from the Microsoft 365 leaver flag.';


-- 3) P11 — a manager's unsubmitted answers, as the form posted them:
--    { ratings: { <param_key>: { rating, comments } }, remarks,
--      confirmation_status, confirmation_reason }.
--    Both columns are set by a save and set back to NULL by a submit.
ALTER TABLE pea_evaluation_cycles
  ADD COLUMN IF NOT EXISTS draft          JSONB,
  ADD COLUMN IF NOT EXISTS draft_saved_at TIMESTAMPTZ;

COMMENT ON COLUMN pea_evaluation_cycles.draft IS
  'The manager''s unsubmitted answers. Cleared when the evaluation is submitted. Never shown to HR.';
COMMENT ON COLUMN pea_evaluation_cycles.draft_saved_at IS
  'When the draft was last saved. Shown on the board as "draft saved <date>".';

-- 4) M3 / M7 / U13 / B5 — who a link went to, and who answered.
ALTER TABLE pea_evaluation_cycles
  ADD COLUMN IF NOT EXISTS sent_to_name      VARCHAR(150),
  ADD COLUMN IF NOT EXISTS sent_to_email     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS delegated         BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS submitted_by_name VARCHAR(150),
  ADD COLUMN IF NOT EXISTS entered_by        VARCHAR(255);

COMMENT ON COLUMN pea_evaluation_cycles.sent_to_email IS
  'Who the live link was issued to: the reporting manager at the time, or an acting manager. Reminders go here and the submission is credited here.';
COMMENT ON COLUMN pea_evaluation_cycles.delegated IS
  'TRUE when HR sent this evaluation to an acting manager instead of the reporting manager.';
COMMENT ON COLUMN pea_evaluation_cycles.submitted_by_name IS
  'Name of whoever answered, as it was when they answered.';
COMMENT ON COLUMN pea_evaluation_cycles.entered_by IS
  'PEA username, when HR entered the ratings in the app on the manager''s behalf. NULL when the manager submitted the form.';

-- Links that are out right now went to the current reporting manager.
UPDATE pea_evaluation_cycles c
   SET sent_to_name = e.rm_name, sent_to_email = lower(trim(e.rm_email))
  FROM pea_employees e
 WHERE e.id = c.employee_id
   AND c.status IN ('email_sent', 'opened')
   AND c.sent_to_email IS NULL
   AND coalesce(trim(e.rm_email), '') <> '';

-- An evaluation already submitted carries only the submitter's address. Where
-- that is still the reporting manager's, the name is known; where it is not
-- (the manager has changed since), it is left blank and the page shows the
-- address, which is the honest answer.
UPDATE pea_evaluation_cycles c
   SET submitted_by_name = e.rm_name
  FROM pea_employees e
 WHERE e.id = c.employee_id
   AND c.status = 'completed'
   AND c.submitted_by_name IS NULL
   AND c.submitted_by_email IS NOT NULL
   AND lower(trim(c.submitted_by_email)) = lower(trim(e.rm_email));


-- 5) M6 — earlier versions of a reopened evaluation. `snapshot` is what was
--    submitted: the scores with their comments, the average, the remarks, the
--    decision and its reason, who submitted and when.
CREATE TABLE IF NOT EXISTS pea_evaluation_revisions (
  id          BIGSERIAL    PRIMARY KEY,
  cycle_id    BIGINT       NOT NULL REFERENCES pea_evaluation_cycles (id) ON DELETE CASCADE,
  snapshot    JSONB        NOT NULL,
  reason      TEXT         NOT NULL,
  reopened_by VARCHAR(255) NOT NULL,
  reopened_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pea_evaluation_revisions_cycle
  ON pea_evaluation_revisions (cycle_id, reopened_at DESC);

COMMENT ON TABLE pea_evaluation_revisions IS
  'What a manager had submitted each time HR reopened an evaluation for correction, with who reopened it and why.';


-- 6) P8 — what HR did about flagged feedback. One row per thing done; the
--    latest is what the board shows, and any row takes the evaluation out of
--    "Needs attention" for everyone.
CREATE TABLE IF NOT EXISTS pea_evaluation_followups (
  id          BIGSERIAL    PRIMARY KEY,
  cycle_id    BIGINT       NOT NULL REFERENCES pea_evaluation_cycles (id) ON DELETE CASCADE,
  outcome     VARCHAR(40)  NOT NULL,
  note        TEXT,
  recorded_by VARCHAR(255) NOT NULL,
  recorded_at TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pea_evaluation_followups_outcome_chk CHECK (
    outcome IN ('spoke_to_manager', 'spoke_to_commando', 'improvement_plan', 'no_action', 'other')
  ),
  CONSTRAINT pea_evaluation_followups_note_len_chk CHECK (note IS NULL OR char_length(note) <= 2000)
);

CREATE INDEX IF NOT EXISTS idx_pea_evaluation_followups_cycle
  ON pea_evaluation_followups (cycle_id, recorded_at DESC);

COMMENT ON TABLE pea_evaluation_followups IS
  'What HR recorded doing about a flagged evaluation. Any row means it no longer needs attention.';


-- 7) M6 — widen the email_type CHECK for the "evaluation reopened" email.
--    H1 (07-10-2026) — and for "new joiners waiting for review", the email
--    admins and HR get when the Microsoft 365 check finds new joiners and each
--    day while anyone waits (joinerIntake.service.js notifyJoinersWaiting).
--    Dropped and re-added inside this transaction so there is never a moment
--    where the column is unconstrained. Every value already allowed is kept.
ALTER TABLE pea_email_log DROP CONSTRAINT IF EXISTS pea_email_log_type_chk;
ALTER TABLE pea_email_log ADD CONSTRAINT pea_email_log_type_chk CHECK (
  email_type IN ('evaluation_link', 'reminder', 'acknowledgement',
                 'extend_alert', 'hr_notification',
                 'it_report', 'manager_portal', 'deadline_alert',
                 'sync_alert', 'evaluation_report',
                 'user_created', 'user_password_changed', 'password_reset_request',
                 'evaluation_reopened', 'joiners_waiting')
);


-- 8) L7 — HR's notes on a Commando. One row per note; a note is never edited,
--    only added or deleted, so there is no modified_at. They go with the
--    Commando when a demo or test record is deleted (ON DELETE CASCADE), as
--    the evaluations and the change history do. 4000 characters is what the
--    page allows; the CHECK stops anything longer arriving by the API.
CREATE TABLE IF NOT EXISTS pea_employee_notes (
  id          BIGSERIAL    PRIMARY KEY,
  employee_id BIGINT       NOT NULL REFERENCES pea_employees (id) ON DELETE CASCADE,
  body        TEXT         NOT NULL,
  created_by  VARCHAR(255) NOT NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT pea_employee_notes_body_chk
    CHECK (char_length(btrim(body)) > 0 AND char_length(body) <= 4000)
);

CREATE INDEX IF NOT EXISTS idx_pea_employee_notes_employee
  ON pea_employee_notes (employee_id, created_at DESC);

COMMENT ON TABLE pea_employee_notes IS
  'HR''s notes on a Commando. Shown on the Commando page to signed-in PEA users only — never on the Commando''s own view or the manager portal.';


-- 8b) Archive (07-10-2026) — a Commando whose probation is over. Set the
--     morning after the final decision or the exit (archive.service.js
--     runAutoArchive), or by hand; cleared by Restore, which stamps
--     restored_at so the morning pass does not archive them again until a new
--     decision or exit. No row is moved or deleted.
ALTER TABLE pea_employees
  ADD COLUMN IF NOT EXISTS archived_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS archived_by    VARCHAR(255),
  ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(500),
  ADD COLUMN IF NOT EXISTS restored_at    TIMESTAMPTZ;

-- Most queries ask for the people who are NOT archived.
CREATE INDEX IF NOT EXISTS idx_pea_employees_not_archived
  ON pea_employees (id) WHERE archived_at IS NULL;

COMMENT ON COLUMN pea_employees.archived_at IS
  'When the Commando was archived. NULL = not archived. Archived people are out of the lists, the board, the Dashboard, Trends and the manager portal; their record stays readable.';
COMMENT ON COLUMN pea_employees.archived_by IS
  'Who archived them: a PEA username, or ''auto-archive'' for the morning pass.';
COMMENT ON COLUMN pea_employees.archive_reason IS
  'Why, in words: the decision or exit for an automatic archive, or what HR typed.';
COMMENT ON COLUMN pea_employees.restored_at IS
  'Last restore from the archive. The morning pass leaves a restored person alone until a later decision or exit.';

COMMIT;


-- 9) Grants. The new columns need none: they sit on tables the PEA application
--    user can already read and write. The three new tables do. Skipped quietly
--    where the role does not exist (a developer database with another user).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peauser') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON pea_evaluation_revisions TO peauser';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE pea_evaluation_revisions_id_seq TO peauser';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON pea_evaluation_followups TO peauser';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE pea_evaluation_followups_id_seq TO peauser';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON pea_employee_notes TO peauser';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE pea_employee_notes_id_seq TO peauser';
  END IF;
END $$;


-- 10) Verification — every row should report ok = 1.
SELECT 'column pea_employees.decision_on (expect 1)' AS object,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_employees' AND column_name = 'decision_on') AS ok
UNION ALL
SELECT 'column pea_employees.decision_reason (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_employees' AND column_name = 'decision_reason')
UNION ALL
SELECT 'column pea_employees.decision_by (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_employees' AND column_name = 'decision_by')
UNION ALL
SELECT 'column pea_employees.left_on (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_employees' AND column_name = 'left_on')
UNION ALL
SELECT 'column pea_employees.left_reason (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_employees' AND column_name = 'left_reason')
UNION ALL
SELECT 'column pea_employees.archived_at (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_employees' AND column_name = 'archived_at')
UNION ALL
SELECT 'column pea_employees.archived_by (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_employees' AND column_name = 'archived_by')
UNION ALL
SELECT 'column pea_employees.archive_reason (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_employees' AND column_name = 'archive_reason')
UNION ALL
SELECT 'column pea_employees.restored_at (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_employees' AND column_name = 'restored_at')
UNION ALL
SELECT 'column pea_evaluation_cycles.draft (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_evaluation_cycles' AND column_name = 'draft')
UNION ALL
SELECT 'column pea_evaluation_cycles.draft_saved_at (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_evaluation_cycles' AND column_name = 'draft_saved_at')
UNION ALL
SELECT 'check on decision_reason length (expect 1)',
       (SELECT count(*) FROM pg_constraint WHERE conname = 'pea_employees_decision_reason_len_chk')
UNION ALL
SELECT 'check on left_reason length (expect 1)',
       (SELECT count(*) FROM pg_constraint WHERE conname = 'pea_employees_left_reason_len_chk')
UNION ALL
SELECT 'column pea_evaluation_cycles.sent_to_email (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_evaluation_cycles' AND column_name = 'sent_to_email')
UNION ALL
SELECT 'column pea_evaluation_cycles.submitted_by_name (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_evaluation_cycles' AND column_name = 'submitted_by_name')
UNION ALL
SELECT 'column pea_evaluation_cycles.delegated (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_evaluation_cycles' AND column_name = 'delegated')
UNION ALL
SELECT 'column pea_evaluation_cycles.entered_by (expect 1)',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_evaluation_cycles' AND column_name = 'entered_by')
UNION ALL
SELECT 'table pea_evaluation_revisions (expect 1)',
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'pea_evaluation_revisions')
UNION ALL
SELECT 'table pea_evaluation_followups (expect 1)',
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'pea_evaluation_followups')
UNION ALL
SELECT 'table pea_employee_notes (expect 1)',
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'pea_employee_notes')
UNION ALL
SELECT 'email_type allows evaluation_reopened (expect 1)',
       (SELECT count(*) FROM pg_constraint
         WHERE conname = 'pea_email_log_type_chk'
           AND pg_get_constraintdef(oid) LIKE '%evaluation_reopened%')
UNION ALL
SELECT 'email_type allows joiners_waiting (expect 1)',
       (SELECT count(*) FROM pg_constraint
         WHERE conname = 'pea_email_log_type_chk'
           AND pg_get_constraintdef(oid) LIKE '%joiners_waiting%')
UNION ALL
SELECT 'email_type still allows evaluation_link (expect 1)',
       (SELECT count(*) FROM pg_constraint
         WHERE conname = 'pea_email_log_type_chk'
           AND pg_get_constraintdef(oid) LIKE '%evaluation_link%');
