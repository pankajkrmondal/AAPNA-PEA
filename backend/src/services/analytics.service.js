/**
 * analytics.service.js — rating trends, parameter strengths, manager
 * responsiveness. Plan §10.
 *
 * Read-only. Every query is a SELECT over pea_ tables; no ATS table is touched.
 *
 * ── Two honesty rules ──────────────────────────────────────────────────────
 *
 *   · Imported history has no real submission time (the spreadsheet never
 *     recorded one), so trends place those evaluations at their due date and
 *     say so via `basis`. Mixing the two silently would draw a spike on the
 *     import day.
 *   · Response-time and reminder figures only count evaluations PEA actually
 *     sent (sent_at is set). A legacy row has no send, and counting it as
 *     "answered instantly without a reminder" would flatter every manager.
 *
 * ── Date range ─────────────────────────────────────────────────────────────
 *
 *   Every evaluation-based figure is limited to the selected range, using the
 *   same date the trend chart plots: the IST submission date, or the due date
 *   when there is none. Probation outcomes are a snapshot of employees, not
 *   evaluations, so they are not filtered.
 */
import { Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { todayIn, toUtcMidnight, toDateString, utcDate, addMonths } from '../utils/dateUtils.js';

const TZ = 'Asia/Kolkata';

/**
 * Turn the query into a valid, inclusive [from, to] range.
 *
 * `to` defaults to today and can never be in the future; `from` defaults to the
 * start of the month `months - 1` before `to` (the old period selector). A
 * reversed range is swapped rather than rejected.
 *
 * @param {{from?: string, to?: string, months?: number|string}} opts
 * @returns {{from: string, to: string}} 'YYYY-MM-DD'
 */
export function resolveRange({ from, to, months } = {}) {
  const today = todayIn(TZ);
  let end = toUtcMidnight(to) || today;
  if (end > today) end = today;

  let start = toUtcMidnight(from);
  if (!start) {
    const window = Math.min(60, Math.max(1, parseInt(months, 10) || 12));
    const monthStart = utcDate(end.getUTCFullYear(), end.getUTCMonth() + 1, 1);
    start = addMonths(monthStart, -(window - 1));
  }
  if (start > end) [start, end] = [end, start];

  return { from: toDateString(start), to: toDateString(end) };
}

/**
 * @param {{from?: string, to?: string, months?: number|string}} [opts]
 * @returns {Promise<object>}
 */
export async function getAnalytics(opts = {}) {
  const range = resolveRange(opts);

  /** The date an evaluation counts on, for column alias `c`. */
  const inRange = (c) => Prisma.sql`
    coalesce((${Prisma.raw(c)}.submitted_at AT TIME ZONE ${TZ})::date, ${Prisma.raw(c)}.due_date)
      BETWEEN ${range.from}::date AND ${range.to}::date`;

  const [summary, trend, parameters, managers, outcomes, distribution] = await Promise.all([
    prisma.$queryRaw`
      SELECT count(*) FILTER (WHERE status = 'completed')::int                           AS completed,
             count(*) FILTER (WHERE status IN ('email_sent','opened'))::int              AS awaiting,
             count(*) FILTER (WHERE status = 'pending' AND due_date < CURRENT_DATE)::int AS overdue,
             round(avg(avg_rating) FILTER (WHERE status = 'completed')::numeric, 2)::float AS average_rating,
             round((avg(EXTRACT(EPOCH FROM (submitted_at - sent_at)) / 86400)
                    FILTER (WHERE submitted_at IS NOT NULL AND sent_at IS NOT NULL))::numeric, 1)::float
                                                                                          AS avg_response_days,
             count(*) FILTER (WHERE status = 'completed' AND sent_at IS NOT NULL)::int   AS sent_by_pea,
             count(*) FILTER (WHERE status = 'completed' AND sent_at IS NOT NULL
                                AND reminder_count = 0)::int                             AS without_reminder
        FROM pea_evaluation_cycles c
       WHERE ${inRange('c')}`,

    prisma.$queryRaw`
      SELECT to_char(date_trunc('month', coalesce((submitted_at AT TIME ZONE ${TZ})::date, due_date)), 'YYYY-MM') AS month,
             round(avg(avg_rating)::numeric, 2)::float                   AS average,
             count(*)::int                                               AS evaluations,
             count(*) FILTER (WHERE submitted_at IS NULL)::int           AS placed_by_due_date
        FROM pea_evaluation_cycles c
       WHERE status = 'completed' AND avg_rating IS NOT NULL
         AND ${inRange('c')}
       GROUP BY 1
       ORDER BY 1`,

    // Legacy 4-parameter rows are a different instrument on a different scale
    // (plan R5), so they are excluded rather than averaged in.
    prisma.$queryRaw`
      SELECT s.param_key,
             max(s.param_label)                                                          AS label,
             min(s.sort_order)::int                                                      AS sort_order,
             round(avg(s.rating) FILTER (WHERE NOT e.is_experienced)::numeric, 2)::float AS fresher,
             round(avg(s.rating) FILTER (WHERE e.is_experienced)::numeric, 2)::float     AS experienced,
             round(avg(s.rating)::numeric, 2)::float                                     AS overall,
             count(*)::int                                                               AS ratings
        FROM pea_evaluation_scores s
        JOIN pea_evaluation_cycles c ON c.id = s.cycle_id
        JOIN pea_employees e         ON e.id = c.employee_id
       WHERE s.rating IS NOT NULL AND c.legacy_format IS NULL
         AND ${inRange('c')}
       GROUP BY s.param_key
       ORDER BY min(s.sort_order)`,

    prisma.$queryRaw`
      SELECT lower(trim(e.rm_email))                                                     AS rm_email,
             max(e.rm_name)                                                              AS rm_name,
             count(DISTINCT e.id)::int                                                   AS employees,
             count(*) FILTER (WHERE c.status = 'completed')::int                         AS completed,
             count(*) FILTER (WHERE c.status IN ('email_sent','opened'))::int            AS awaiting,
             count(*) FILTER (WHERE c.status = 'pending' AND c.due_date < CURRENT_DATE)::int AS overdue,
             round(avg(c.avg_rating) FILTER (WHERE c.status = 'completed')::numeric, 2)::float AS average_rating,
             round((avg(EXTRACT(EPOCH FROM (c.submitted_at - c.sent_at)) / 86400)
                    FILTER (WHERE c.submitted_at IS NOT NULL AND c.sent_at IS NOT NULL))::numeric, 1)::float
                                                                                         AS avg_response_days,
             count(*) FILTER (WHERE c.status = 'completed' AND c.sent_at IS NOT NULL)::int AS sent_by_pea,
             count(*) FILTER (WHERE c.status = 'completed' AND c.sent_at IS NOT NULL
                                AND c.reminder_count = 0)::int                           AS without_reminder
        FROM pea_employees e
        JOIN pea_evaluation_cycles c ON c.employee_id = e.id
       WHERE coalesce(trim(e.rm_email), '') <> ''
         AND ${inRange('c')}
       GROUP BY lower(trim(e.rm_email))
       ORDER BY max(e.rm_name)`,

    prisma.$queryRaw`
      SELECT coalesce(confirmation_status, 'In probation') AS outcome, count(*)::int AS employees
        FROM pea_employees
       WHERE employment_status = 'active' OR confirmation_status IS NOT NULL
       GROUP BY 1
       ORDER BY 2 DESC`,

    prisma.$queryRaw`
      SELECT floor(avg_rating)::int AS band, count(*)::int AS evaluations
        FROM pea_evaluation_cycles c
       WHERE status = 'completed' AND avg_rating IS NOT NULL
         AND ${inRange('c')}
       GROUP BY 1
       ORDER BY 1`,
  ]);

  const s = summary[0] || {};

  return {
    ...range,
    summary: {
      ...s,
      onTimeRate: s.sent_by_pea ? Math.round((s.without_reminder / s.sent_by_pea) * 100) : null,
    },
    trend,
    trendBasis:
      'Evaluations PEA sent are placed in the month they were submitted. Imported history has no ' +
      'submission time, so it is placed in the month it was due.',
    parameters,
    managers: managers.map((m) => ({
      ...m,
      onTimeRate: m.sent_by_pea ? Math.round((m.without_reminder / m.sent_by_pea) * 100) : null,
    })),
    outcomes,
    distribution: [1, 2, 3, 4, 5].map((band) => ({
      band,
      label: band === 5 ? '5' : `${band}–${band + 1}`,
      evaluations: distribution.find((d) => d.band === band)?.evaluations || 0,
    })),
  };
}

/* ══ Resource trends ═══════════════════════════════════════════════════════
 *
 * Subhajit, 15-Sep demo (11:09): "We don't want the analytics of how many
 * evaluations have been completed... You can think of giving resource-wise
 * analytics. What was his score in evaluation 1, what was his score in
 * evaluation 2 — then that becomes an analytics. That person is growing, or
 * that person is coming down." And (12:10): "even if the quality of the work
 * has increased, but the speed of the work has decreased."
 *
 * So these two functions answer "how is this person doing?", where
 * getAnalytics() above answers "how is the process doing?".
 *
 * ── A third honesty rule, on top of the file's two ────────────────────────
 *
 * Legacy rows are a DIFFERENT INSTRUMENT: four parameters on their own scale,
 * which is why getAnalytics() excludes them from parameter averages. Comparing
 * one against a current seven-parameter evaluation would manufacture a rise or
 * fall that nobody actually scored — the opposite of the judgement Subhajit
 * wants to make. Legacy cycles are therefore excluded from every movement
 * figure here and reported separately as `legacyCycles` so the UI can say the
 * history is shortened rather than silently drawing a shorter line.
 */

/** A change of this much or more since the first evaluation is a real move. */
export const TREND_BAND = 0.3;

/**
 * Growing / Coming down / Steady, per the proposed ±0.3 threshold.
 * @param {number|null} change
 * @returns {'growing'|'declining'|'steady'|null}
 */
export function trendDirection(change) {
  if (change === null || change === undefined) return null;
  if (change >= TREND_BAND) return 'growing';
  if (change <= -TREND_BAND) return 'declining';
  return 'steady';
}

/** @param {number|null} n */
const round2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

/**
 * Movement between the ends of what was ACTUALLY scored for one parameter.
 *
 * A missing evaluation is a gap, not a zero: cycles can be skipped, and a
 * parameter can be added partway through the probation. Comparing against a
 * column nobody filled in would invent a change. Fewer than two real scores
 * means there is nothing to compare, which is reported as null rather than 0 —
 * "no movement measured" and "measured, did not move" are different answers.
 *
 * @param {Record<number, number>} ratings - seq_no → rating
 * @param {number[]} columns - the comparable evaluation numbers, in order
 * @returns {{first: number|null, latest: number|null, change: number|null}}
 */
export function parameterMovement(ratings, columns) {
  const present = columns.filter((n) => ratings[n] !== undefined && ratings[n] !== null);
  if (present.length < 2) return { first: null, latest: null, change: null };

  const first = ratings[present[0]];
  const latest = ratings[present[present.length - 1]];
  return { first, latest, change: round2(latest - first) };
}

/** Completed, non-legacy, actually scored — the rows a trend may be drawn from. */
const COMPARABLE = Prisma.sql`c.status = 'completed' AND c.avg_rating IS NOT NULL AND c.legacy_format IS NULL`;

/**
 * Every employee with at least two comparable evaluations, with their first and
 * latest average, the change between them, and the parameter that fell most.
 *
 * Two evaluations is the floor because movement is the entire point: a single
 * evaluation has nothing to be compared against and would only pad the list.
 *
 * @param {{search?: string, cohort?: 'fresher'|'experienced', trend?: 'growing'|'declining'|'steady'}} [opts]
 * @returns {Promise<object[]>}
 */
export async function getResourceTrends(opts = {}) {
  const search = String(opts.search || '').trim();
  const cohort = opts.cohort === 'fresher' ? false : opts.cohort === 'experienced' ? true : null;

  const rows = await prisma.$queryRaw`
    WITH ranked AS (
      SELECT c.employee_id,
             c.avg_rating::float                                            AS avg_rating,
             row_number() OVER (PARTITION BY c.employee_id ORDER BY c.seq_no)      AS first_rank,
             row_number() OVER (PARTITION BY c.employee_id ORDER BY c.seq_no DESC) AS last_rank,
             count(*)    OVER (PARTITION BY c.employee_id)::int             AS done
        FROM pea_evaluation_cycles c
       WHERE ${COMPARABLE}
    ),
    overall AS (
      SELECT employee_id,
             max(done)                                     AS done,
             max(avg_rating) FILTER (WHERE first_rank = 1) AS first_avg,
             max(avg_rating) FILTER (WHERE last_rank = 1)  AS last_avg
        FROM ranked
       GROUP BY employee_id
      HAVING max(done) >= 2
    ),
    -- The biggest faller per person, by the same first-vs-latest comparison.
    param_ranked AS (
      SELECT c.employee_id,
             s.param_key,
             max(s.param_label)                                                     AS param_label,
             s.rating::float                                                        AS rating,
             row_number() OVER (PARTITION BY c.employee_id, s.param_key ORDER BY c.seq_no)      AS first_rank,
             row_number() OVER (PARTITION BY c.employee_id, s.param_key ORDER BY c.seq_no DESC) AS last_rank
        FROM pea_evaluation_scores s
        JOIN pea_evaluation_cycles c ON c.id = s.cycle_id
       WHERE ${COMPARABLE} AND s.rating IS NOT NULL
       GROUP BY c.employee_id, s.param_key, s.rating, c.seq_no
    ),
    param_move AS (
      SELECT employee_id,
             param_key,
             max(param_label)                             AS param_label,
             max(rating) FILTER (WHERE last_rank = 1)
               - max(rating) FILTER (WHERE first_rank = 1) AS change
        FROM param_ranked
       GROUP BY employee_id, param_key
    ),
    worst AS (
      SELECT DISTINCT ON (employee_id) employee_id, param_label, change
        FROM param_move
       WHERE change < 0
       ORDER BY employee_id, change ASC, param_label
    )
    SELECT e.id::text                                          AS employee_id,
           e.full_name,
           e.office_email,
           e.is_experienced,
           e.rm_name,
           e.rm_email,
           e.employment_status,
           e.confirmation_status,
           e.halt_process,
           to_char(e.doj, 'YYYY-MM-DD')                        AS doj,
           o.done,
           round(o.first_avg::numeric, 2)::float               AS first_avg,
           round(o.last_avg::numeric, 2)::float                AS latest_avg,
           round((o.last_avg - o.first_avg)::numeric, 2)::float AS change,
           w.param_label                                       AS biggest_drop_label,
           round(w.change::numeric, 2)::float                  AS biggest_drop_change,
           (SELECT count(*)::int FROM pea_evaluation_cycles lc
             WHERE lc.employee_id = e.id AND lc.legacy_format IS NOT NULL
               AND lc.status = 'completed')                    AS legacy_cycles,
           (SELECT count(*)::int FROM pea_evaluation_cycles tc
             WHERE tc.employee_id = e.id)                      AS total_cycles
      FROM overall o
      JOIN pea_employees e ON e.id = o.employee_id
      LEFT JOIN worst w    ON w.employee_id = o.employee_id
     WHERE (${search} = '' OR e.full_name ILIKE ${`%${search}%`} OR e.office_email ILIKE ${`%${search}%`})
       AND (${cohort}::boolean IS NULL OR e.is_experienced = ${cohort}::boolean)
     ORDER BY e.full_name`;

  const trends = rows.map((r) => ({
    employeeId: r.employee_id,
    name: r.full_name,
    email: r.office_email,
    doj: r.doj,
    haltProcess: r.halt_process,
    cohort: r.is_experienced ? 'experienced' : 'fresher',
    rmName: r.rm_name,
    rmEmail: r.rm_email,
    employmentStatus: r.employment_status,
    confirmationStatus: r.confirmation_status,
    done: r.done,
    totalCycles: r.total_cycles,
    firstAvg: r.first_avg,
    latestAvg: r.latest_avg,
    change: r.change,
    direction: trendDirection(r.change),
    biggestDrop: r.biggest_drop_label
      ? { label: r.biggest_drop_label, change: r.biggest_drop_change }
      : null,
    legacyCycles: r.legacy_cycles,
  }));

  return opts.trend ? trends.filter((t) => t.direction === opts.trend) : trends;
}

/**
 * One person's every parameter, evaluation by evaluation — the expanded row and
 * the Employee page's "Parameters by evaluation" table.
 *
 * @param {bigint|number|string} employeeId
 * @returns {Promise<object|null>} null when there is no such employee
 */
export async function getEmployeeTrend(employeeId) {
  const id = BigInt(employeeId);

  const [employee] = await prisma.$queryRaw`
    SELECT e.id::text AS employee_id, e.full_name, e.office_email, e.is_experienced,
           e.rm_name, e.rm_email, e.pl_email, e.confirmation_status, e.employment_status,
           e.halt_process, to_char(e.doj, 'YYYY-MM-DD') AS doj
      FROM pea_employees e
     WHERE e.id = ${id}`;
  if (!employee) return null;

  const [cycles, scores] = await Promise.all([
    prisma.$queryRaw`
      SELECT c.seq_no::int                      AS seq_no,
             c.status,
             c.avg_rating::float                AS avg_rating,
             to_char(c.due_date, 'YYYY-MM-DD')  AS due_date,
             to_char((c.submitted_at AT TIME ZONE ${TZ})::date, 'YYYY-MM-DD') AS submitted_on,
             c.legacy_format
        FROM pea_evaluation_cycles c
       WHERE c.employee_id = ${id}
       ORDER BY c.seq_no`,

    prisma.$queryRaw`
      SELECT c.seq_no::int  AS seq_no,
             s.param_key,
             s.param_label,
             s.sort_order::int AS sort_order,
             s.rating::float   AS rating
        FROM pea_evaluation_scores s
        JOIN pea_evaluation_cycles c ON c.id = s.cycle_id
       WHERE c.employee_id = ${id} AND s.rating IS NOT NULL
         AND c.status = 'completed' AND c.legacy_format IS NULL
       ORDER BY s.sort_order, s.param_key, c.seq_no`,
  ]);

  // Only comparable cycles become columns — see the instrument note above.
  const columns = cycles
    .filter((c) => c.status === 'completed' && c.avg_rating !== null && !c.legacy_format)
    .map((c) => c.seq_no);

  const byParam = new Map();
  for (const s of scores) {
    if (!byParam.has(s.param_key)) {
      byParam.set(s.param_key, {
        key: s.param_key,
        label: s.param_label,
        sortOrder: s.sort_order,
        ratings: {},
      });
    }
    byParam.get(s.param_key).ratings[s.seq_no] = s.rating;
  }

  const parameters = [...byParam.values()]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label))
    .map((p) => {
      const m = parameterMovement(p.ratings, columns);
      return {
        key: p.key,
        label: p.label,
        ratings: columns.map((n) => (p.ratings[n] ?? null)),
        ...m,
        direction: trendDirection(m.change),
      };
    });

  const averages = columns.map(
    (n) => cycles.find((c) => c.seq_no === n)?.avg_rating ?? null
  );
  const overallChange =
    averages.length >= 2 ? round2(averages[averages.length - 1] - averages[0]) : null;

  return {
    employee: {
      employeeId: employee.employee_id,
      name: employee.full_name,
      email: employee.office_email,
      doj: employee.doj,
      cohort: employee.is_experienced ? 'experienced' : 'fresher',
      rmName: employee.rm_name,
      rmEmail: employee.rm_email,
      plEmail: employee.pl_email,
      confirmationStatus: employee.confirmation_status,
      employmentStatus: employee.employment_status,
      haltProcess: employee.halt_process,
    },
    columns,
    parameters,
    averages,
    firstAvg: averages[0] ?? null,
    latestAvg: averages[averages.length - 1] ?? null,
    change: overallChange,
    direction: trendDirection(overallChange),
    // Every cycle, comparable or not, so the page can still show the schedule.
    cycles: cycles.map((c) => ({
      seqNo: c.seq_no,
      status: c.status,
      avgRating: c.avg_rating,
      dueDate: c.due_date,
      submittedOn: c.submitted_on,
      legacy: Boolean(c.legacy_format),
    })),
    legacyCycles: cycles.filter((c) => c.legacy_format && c.status === 'completed').length,
    basis:
      'Movement compares the first and most recent submitted evaluation. Evaluations imported ' +
      'from the old Excel sheet used a different set of parameters, so they are listed but left ' +
      'out of the comparison.',
    trendBand: TREND_BAND,
  };
}
