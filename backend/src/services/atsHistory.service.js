/**
 * atsHistory.service.js — read-only access to ATS recruitment data.
 *
 * This is the payoff of the shared-database decision (plan §4.3): showing a
 * PEA employee's interview history is a SQL join, not an integration project.
 *
 * ── Why raw SQL and not Prisma models ──────────────────────────────────────
 *
 * Adding rpa_* models to schema.prisma would mean running `prisma db pull`,
 * which has no table filter and would import all 48 ATS tables — after which
 * PEA's generated client could read and write every one of them, and a later
 * "tidy up" of those models sets up a `migrate` that drops them. Raw SQL keeps
 * every ATS touch explicit and greppable: `grep -r "rpa_" src/` returns exactly
 * this file. Plan R2.
 *
 * EVERY query here is SELECT. Nothing in PEA writes to an ATS table, ever.
 *
 * ── Why matching is explicit, never automatic ──────────────────────────────
 *
 * ATS stores only the candidate's PERSONAL email (from their CV); PEA stores
 * their OFFICE email, which does not exist until IT creates the account after
 * they join. There is no office-email column anywhere in ATS, so the obvious
 * join returns zero rows every time (plan R4).
 *
 * Matching therefore happens one of two ways, both deliberate:
 *   1. HR creates the PEA employee from an accepted ATS offer, which sets
 *      ats_pipeline_id directly — a hard link, no guessing.
 *   2. HR searches and picks the right candidate by hand.
 *
 * Name matching is explicitly NOT offered. The master sheet contains entries
 * like "Shelly Jain " and "Priyanka Khurana " with trailing spaces, and a wrong
 * match here means showing one person's interview feedback on another person's
 * profile.
 */
import prisma from '../config/database.js';
import logger from '../config/logger.js';

/**
 * Full recruitment history for a linked employee.
 *
 * @param {bigint|number|null} pipelineId - pea_employees.ats_pipeline_id
 * @returns {Promise<object|null>} null when not linked
 */
export async function getHistory(pipelineId) {
  if (!pipelineId) return null;
  const id = BigInt(pipelineId);

  try {
    const [candidate] = await prisma.$queryRaw`
      SELECT p.id                    AS pipeline_id,
             p.current_stage_key,
             p.current_stage_status,
             p.final_outcome,
             p.source,
             p.created_at            AS pipeline_started_at,
             p.closed_at,
             s.candidate_name,
             s.candidate_email,
             s.position_applied,
             s.shortlisted_at,
             s.joined_at
        FROM rpa_candidate_pipeline p
        LEFT JOIN rpa_shortlisted_candidates s ON s.id = p.shortlist_id
       WHERE p.id = ${id}`;

    if (!candidate) return null;

    const [offer] = await prisma.$queryRaw`
      SELECT approval_status, candidate_decision, joining_date, shared_at, decision_at, remarks
        FROM rpa_offers WHERE pipeline_id = ${id}`;

    // One row per interview round, with the per-skill detail folded in.
    const scorecards = await prisma.$queryRaw`
      SELECT c.id, c.stage_key, c.card_type, c.recipient_name, c.recipient_email,
             c.final_rating, c.recommendation, c.comments, c.avg_score,
             c.submitted_at, c.status,
             COALESCE(
               json_agg(
                 json_build_object('skill', k.skill_label, 'rating', k.rating, 'remark', k.remark)
                 ORDER BY k.sort_order
               ) FILTER (WHERE k.id IS NOT NULL), '[]'
             ) AS skills
        FROM rpa_interview_scorecard c
        LEFT JOIN rpa_interview_scorecard_skill k ON k.scorecard_id = c.id
       WHERE c.pipeline_id = ${id} AND c.submitted_at IS NOT NULL
       GROUP BY c.id
       ORDER BY c.submitted_at`;

    const assessments = await prisma.$queryRaw`
      SELECT * FROM rpa_assessment_results WHERE pipeline_id = ${id} ORDER BY id`;

    return {
      linked: true,
      candidate,
      offer: offer || null,
      scorecards,
      assessments,
      summary: {
        interviewRounds: scorecards.length,
        averageInterviewRating: average(scorecards.map((s) => s.final_rating ?? s.avg_score)),
        outcome: candidate.final_outcome,
        joiningDate: offer?.joining_date ?? candidate.joined_at ?? null,
      },
    };
  } catch (err) {
    // The history panel is a bonus, never load-bearing. If an ATS table has
    // been restructured or a grant is missing, PEA's own screens must still
    // work — so this degrades rather than throwing.
    logger.warn(`ATS history unavailable for pipeline ${pipelineId}: ${err.message}`);
    return { linked: true, unavailable: true, reason: err.message };
  }
}

/** Mean of the numeric values present, to 2dp. */
function average(values) {
  const nums = values.map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
}

/**
 * Search ATS candidates so HR can link one by hand.
 *
 * @param {string} query - name or personal email
 * @param {number} [limit=10]
 * @returns {Promise<object[]>}
 */
export async function searchCandidates(query, limit = 10) {
  const needle = `%${String(query || '').trim().toLowerCase()}%`;
  if (needle.length < 5) return [];

  try {
    return await prisma.$queryRaw`
      SELECT p.id                AS pipeline_id,
             s.candidate_name,
             s.candidate_email,
             s.position_applied,
             p.final_outcome,
             o.joining_date,
             o.candidate_decision
        FROM rpa_candidate_pipeline p
        JOIN rpa_shortlisted_candidates s ON s.id = p.shortlist_id
        LEFT JOIN rpa_offers o ON o.pipeline_id = p.id
       WHERE lower(s.candidate_name) LIKE ${needle}
          OR lower(s.candidate_email) LIKE ${needle}
       ORDER BY o.joining_date DESC NULLS LAST, p.created_at DESC
       LIMIT ${limit}`;
  } catch (err) {
    logger.warn(`ATS candidate search failed: ${err.message}`);
    return [];
  }
}

/**
 * Accepted ATS offers with a joining date that have no PEA employee yet.
 *
 * This is the ATS→PEA handoff from plan R4, and it is the better half of the
 * feature. `rpa_offers.joining_date` is the DOJ agreed with the candidate,
 * already captured accurately during the offer process — so creating the PEA
 * employee from here removes the manual date entry that caused the format bug
 * the whole migration is trying to fix.
 *
 * @param {number} [limit=50]
 * @returns {Promise<object[]>}
 */
export async function pendingHandoffs(limit = 50) {
  try {
    return await prisma.$queryRaw`
      SELECT p.id            AS pipeline_id,
             s.candidate_name,
             s.candidate_email,
             s.position_applied,
             o.joining_date,
             o.candidate_decision,
             o.shared_at
        FROM rpa_offers o
        JOIN rpa_candidate_pipeline p ON p.id = o.pipeline_id
        JOIN rpa_shortlisted_candidates s ON s.id = p.shortlist_id
       WHERE o.candidate_decision = 'accepted'
         AND o.joining_date IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM pea_employees e WHERE e.ats_pipeline_id = p.id
         )
       ORDER BY o.joining_date DESC
       LIMIT ${limit}`;
  } catch (err) {
    logger.warn(`ATS handoff list unavailable: ${err.message}`);
    return [];
  }
}
