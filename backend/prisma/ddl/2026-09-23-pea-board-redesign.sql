-- ═══════════════════════════════════════════════════════════════════════════
--  2026-09-23-pea-board-redesign.sql
--
--  The "What every manager said" redesign (docs/New Design/images). Almost all
--  of it reads data PEA already holds — scores, remarks, reminder emails, open
--  and submit times. Two things it shows have nowhere to live yet:
--
--    1) pea_evaluation_cycles.confirmation_reason
--       "Reason for decision" — the manager's own words for WHY they did not
--       confirm, or extended. Shown on the board card, the evaluation profile,
--       the HR email and the print record, and required on the manager form
--       whenever the answer is not "Confirmed". Until now the decision was
--       recorded with no explanation at all, so HR had to email the manager
--       and ask.
--
--    2) pea_evaluation_reads
--       Which HR user has read which submitted evaluation. The Dashboard says
--       "Five evaluations came back this week. Three need a read." and puts a
--       "Read feedback" button on each one that needs attention; opening the
--       evaluation clears it FOR THAT PERSON ONLY, exactly as the bell does.
--       Per-user on purpose: one HR colleague reading an extension must not
--       hide it from the others.
--
--  Both are additive. Nothing is dropped and no existing row is changed. The
--  application checks for each object before using it (schemaCapabilities.js),
--  so the new screens work before this is applied — they simply show no reason
--  and treat every attention item as unread.
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

-- 1) The manager's reason for the confirmation decision. Captured on the final
--    cycle only, alongside confirmation_status. 2000 characters is what the
--    form allows; the CHECK stops anything longer arriving by the JSON route.
ALTER TABLE pea_evaluation_cycles
  ADD COLUMN IF NOT EXISTS confirmation_reason TEXT;

ALTER TABLE pea_evaluation_cycles DROP CONSTRAINT IF EXISTS pea_evaluation_cycles_reason_len_chk;
ALTER TABLE pea_evaluation_cycles ADD CONSTRAINT pea_evaluation_cycles_reason_len_chk
  CHECK (confirmation_reason IS NULL OR char_length(confirmation_reason) <= 2000);

COMMENT ON COLUMN pea_evaluation_cycles.confirmation_reason IS
  'Manager''s reason for the confirmation decision. Required by the form when the decision is not Confirmed.';


-- 2) Per-user read receipts for submitted evaluations.
CREATE TABLE IF NOT EXISTS pea_evaluation_reads (
  id        BIGSERIAL    PRIMARY KEY,
  cycle_id  BIGINT       NOT NULL REFERENCES pea_evaluation_cycles (id) ON DELETE CASCADE,
  user_id   INTEGER      NOT NULL REFERENCES pea_users (id) ON DELETE CASCADE,
  read_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uq_pea_evaluation_reads_cycle_user UNIQUE (cycle_id, user_id)
);

-- "Which of these has this user read?" is always asked for one user.
CREATE INDEX IF NOT EXISTS idx_pea_evaluation_reads_user
  ON pea_evaluation_reads (user_id, cycle_id);

COMMENT ON TABLE pea_evaluation_reads IS
  'Which HR user has opened which submitted evaluation. Drives "Read feedback" on the Dashboard.';

COMMIT;


-- 3) Grants. The PEA application user needs to read and write the new table
--    and use its sequence. Skipped quietly where the role does not exist
--    (a developer database with a different user name).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peauser') THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON pea_evaluation_reads TO peauser';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE pea_evaluation_reads_id_seq TO peauser';
  END IF;
END $$;


-- 4) Verification — every row should report ok = 1.
SELECT 'column pea_evaluation_cycles.confirmation_reason (expect 1)' AS object,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_name = 'pea_evaluation_cycles' AND column_name = 'confirmation_reason') AS ok
UNION ALL
SELECT 'table pea_evaluation_reads (expect 1)',
       (SELECT count(*) FROM information_schema.tables WHERE table_name = 'pea_evaluation_reads')
UNION ALL
SELECT 'unique (cycle_id, user_id) on reads (expect 1)',
       (SELECT count(*) FROM pg_constraint WHERE conname = 'uq_pea_evaluation_reads_cycle_user');
