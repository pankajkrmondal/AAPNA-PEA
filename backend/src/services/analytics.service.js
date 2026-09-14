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
